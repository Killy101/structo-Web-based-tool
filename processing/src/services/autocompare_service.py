"""
autocompare_service.py — AutoCompare engine for large PDF + XML comparison.

Pipeline
────────
1. Stream OLD and NEW PDFs page-by-page using PyMuPDF (handles up to 20,000 pages).
2. Batch pages into configurable groups (default 50 pages/batch).
3. For each batch, extract text, detect differences between old/new.
4. Chunk the XML by semantic sections using lxml.
5. Align PDF batches ↔ XML chunks by index.
6. Per-chunk AI-assisted XML update generation using difflib + heuristics.
7. Save intermediate results to disk for large jobs.

Change types
────────────
    added      — text present in NEW but not OLD (green)
    removed    — text present in OLD but not NEW (red)
    modified   — text present in both but changed (yellow)
    unchanged  — no change detected

Storage layout (disk-backed for large PDFs)
────────────────────────────────────────────
    /tmp/autocompare/<session_id>/
        ORIGINAL/   old.pdf  new.pdf  source.xml
        CHUNKED/    chunk_00001.xml  chunk_00002.xml  ...
        COMPARE/    diff_00001.json  diff_00002.json  ...
        MERGED/     final_output.xml
"""

from __future__ import annotations

import asyncio
import difflib
import io
import json
import logging
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF
from lxml import etree

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

BATCH_SIZE = 50          # pages per processing batch
MAX_PAGES_INLINE = 500   # below this, keep chunks in memory only (no disk write)
SESSION_TTL = 3600       # seconds before a session is eligible for cleanup
BASE_STORAGE = Path(tempfile.gettempdir()) / "autocompare"

# Change-type colours (returned to frontend for CSS class mapping)
CHANGE_COLORS = {
    "added":     "green",
    "removed":   "red",
    "modified":  "yellow",
    "unchanged": "none",
}


# ── Session storage ────────────────────────────────────────────────────────────

# In-memory session registry.  Large binary data lives on disk; only metadata
# and small diffs are kept in memory.
_sessions: dict[str, dict] = {}


def _session_dir(session_id: str) -> Path:
    return BASE_STORAGE / session_id


def _ensure_dirs(session_id: str) -> dict[str, Path]:
    base = _session_dir(session_id)
    dirs = {
        "base":     base,
        "original": base / "ORIGINAL",
        "chunked":  base / "CHUNKED",
        "compare":  base / "COMPARE",
        "merged":   base / "MERGED",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


# ── PDF page streaming ─────────────────────────────────────────────────────────

def _stream_pdf_pages(pdf_bytes: bytes, batch_size: int = BATCH_SIZE):
    """
    Generator that yields (batch_index, [page_text, ...]) for each batch.
    Uses PyMuPDF to extract text page-by-page without loading the entire PDF
    text into memory at once.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total = len(doc)
    batch: list[str] = []
    batch_idx = 0

    for page_num in range(total):
        page = doc[page_num]
        text = page.get_text("text")
        batch.append(text)

        if len(batch) >= batch_size:
            yield batch_idx, batch, total
            batch = []
            batch_idx += 1

    if batch:
        yield batch_idx, batch, total

    doc.close()


def _count_pdf_pages(pdf_bytes: bytes) -> int:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n = len(doc)
    doc.close()
    return n


# ── Text diff utilities ────────────────────────────────────────────────────────

def _normalise(text: str) -> str:
    """Collapse whitespace for comparison."""
    return " ".join(text.split()).lower()


def _compute_similarity(old: str, new: str) -> float:
    """Return 0.0–1.0 similarity ratio."""
    return difflib.SequenceMatcher(None, _normalise(old), _normalise(new)).ratio()


def _classify_change(old_text: str, new_text: str) -> str:
    """Classify change between two text blocks."""
    if not old_text.strip() and new_text.strip():
        return "added"
    if old_text.strip() and not new_text.strip():
        return "removed"
    if _normalise(old_text) == _normalise(new_text):
        return "unchanged"
    return "modified"


def _generate_diff_lines(old_text: str, new_text: str) -> list[dict]:
    """
    Produce a line-level diff suitable for the Diff Panel.

    Returns a list of { "type": "added"|"removed"|"unchanged", "text": str, "line": int }.
    """
    old_lines = old_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    result: list[dict] = []
    line_num = 0

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            for line in old_lines[i1:i2]:
                result.append({"type": "unchanged", "text": line.rstrip("\n"), "line": line_num})
                line_num += 1
        elif opcode == "delete":
            for line in old_lines[i1:i2]:
                result.append({"type": "removed", "text": line.rstrip("\n"), "line": line_num})
                line_num += 1
        elif opcode == "insert":
            for line in new_lines[j1:j2]:
                result.append({"type": "added", "text": line.rstrip("\n"), "line": line_num})
                line_num += 1
        elif opcode == "replace":
            for line in old_lines[i1:i2]:
                result.append({"type": "removed", "text": line.rstrip("\n"), "line": line_num})
                line_num += 1
            for line in new_lines[j1:j2]:
                result.append({"type": "added", "text": line.rstrip("\n"), "line": line_num})
                line_num += 1

    return result


# ── XML chunking (lxml-based) ──────────────────────────────────────────────────

def _chunk_xml_lxml(
    xml_content: str,
    tag_name: str = "section",
    max_chars: int = 4000,
) -> list[dict]:
    """
    Parse XML with lxml and split by tag_name elements.
    Falls back to character-based chunking if no matching tags are found.

    Returns list of { index, label, xml_content, xml_size }.
    """
    try:
        root = etree.fromstring(xml_content.encode("utf-8"))
    except etree.XMLSyntaxError:
        # Wrap in a root element if bare XML fragment
        try:
            wrapped = f"<root>{xml_content}</root>"
            root = etree.fromstring(wrapped.encode("utf-8"))
        except etree.XMLSyntaxError as exc:
            raise ValueError(f"Invalid XML: {exc}") from exc

    # Find elements matching tag_name (case-insensitive local name)
    elements = root.findall(f".//{tag_name}")
    if not elements:
        # Try any child elements as chunks
        elements = list(root)

    if not elements:
        # Fall back: split by character count
        return _chunk_by_chars(xml_content, max_chars)

    chunks: list[dict] = []
    for i, elem in enumerate(elements, start=1):
        chunk_xml = etree.tostring(elem, encoding="unicode", pretty_print=True)
        label = elem.get("id") or elem.get("name") or elem.get("title") or f"{tag_name}_{i:05d}"
        chunks.append({
            "index":       i,
            "label":       label,
            "xml_content": chunk_xml,
            "xml_size":    len(chunk_xml),
        })

    return chunks


def _chunk_by_chars(xml_content: str, max_chars: int) -> list[dict]:
    """Emergency fallback: split XML string by character count."""
    chunks: list[dict] = []
    total = len(xml_content)
    i = 0
    idx = 1
    while i < total:
        chunk = xml_content[i : i + max_chars]
        chunks.append({
            "index":       idx,
            "label":       f"chunk_{idx:05d}",
            "xml_content": chunk,
            "xml_size":    len(chunk),
        })
        i += max_chars
        idx += 1
    return chunks


# ── AI-assisted XML update generation ─────────────────────────────────────────

def _generate_xml_suggestion(
    xml_chunk: str,
    old_pdf_text: str,
    new_pdf_text: str,
) -> str:
    """
    Generate a suggested XML update based on changes between OLD and NEW PDF text.

    Approach:
    1. Build a mapping of changed sentences (old → new).
    2. For each changed sentence found verbatim in the XML chunk, replace it.
    3. Return the updated XML string.

    This is a heuristic approach; for production, hook in an LLM API call here.
    """
    if not new_pdf_text.strip():
        return xml_chunk

    # Sentence-level diff
    old_sentences = re.split(r"(?<=[.!?])\s+", old_pdf_text.strip())
    new_sentences = re.split(r"(?<=[.!?])\s+", new_pdf_text.strip())

    matcher = difflib.SequenceMatcher(None, old_sentences, new_sentences)
    updated_xml = xml_chunk

    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "replace" and (i2 - i1) == (j2 - j1):
            # One-to-one sentence replacement
            for old_sent, new_sent in zip(old_sentences[i1:i2], new_sentences[j1:j2]):
                if len(old_sent) > 10 and old_sent in updated_xml:
                    updated_xml = updated_xml.replace(old_sent, new_sent, 1)

    return updated_xml


# ── Core processing pipeline ───────────────────────────────────────────────────

def process_upload(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes,
    source_name: str,
) -> dict:
    """
    Initialise a session.  Saves files to disk, counts pages, returns session_id.
    Called synchronously by the /upload endpoint.
    """
    session_id = str(uuid.uuid4())
    dirs = _ensure_dirs(session_id)

    # Persist original files
    (dirs["original"] / "old.pdf").write_bytes(old_pdf_bytes)
    (dirs["original"] / "new.pdf").write_bytes(new_pdf_bytes)
    (dirs["original"] / "source.xml").write_bytes(xml_bytes)

    old_pages = _count_pdf_pages(old_pdf_bytes)
    new_pages = _count_pdf_pages(new_pdf_bytes)

    try:
        xml_content = xml_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        shutil.rmtree(dirs["base"], ignore_errors=True)
        raise ValueError("XML file must be valid UTF-8") from exc

    session: dict[str, Any] = {
        "session_id":  session_id,
        "source_name": source_name.strip(),
        "status":      "uploaded",       # uploaded | processing | done | error
        "progress":    0,                # 0–100
        "error":       None,
        "old_pages":   old_pages,
        "new_pages":   new_pages,
        "xml_size":    len(xml_bytes),
        "chunks":      [],               # populated by start_processing()
        "summary":     None,
        "storage":     {
            "base":     str(dirs["base"]),
            "original": str(dirs["original"]),
            "chunked":  str(dirs["chunked"]),
            "compare":  str(dirs["compare"]),
            "merged":   str(dirs["merged"]),
        },
        "created_at":  time.time(),
    }
    _sessions[session_id] = session
    return session


async def start_processing(
    session_id: str,
    tag_name: str = "section",
    batch_size: int = BATCH_SIZE,
    max_chars: int = 4000,
) -> None:
    """
    Background coroutine: reads PDFs from disk in batches, compares text,
    aligns with XML chunks, writes per-chunk diff JSON to COMPARE/ folder.

    For large PDFs (>MAX_PAGES_INLINE), intermediate chunks are written to disk
    so memory stays bounded.  Small PDFs are fully in-memory.

    Designed to be scheduled with asyncio.create_task().
    """
    session = _sessions.get(session_id)
    if not session:
        return

    session["status"]   = "processing"
    session["progress"] = 0

    dirs = session["storage"]
    base = Path(dirs["base"])

    try:
        old_pdf_bytes = (base / "ORIGINAL" / "old.pdf").read_bytes()
        new_pdf_bytes = (base / "ORIGINAL" / "new.pdf").read_bytes()
        xml_bytes     = (base / "ORIGINAL" / "source.xml").read_bytes()
        xml_content   = xml_bytes.decode("utf-8")
    except Exception as exc:
        session["status"] = "error"
        session["error"]  = f"Could not read uploaded files: {exc}"
        return

    # ── Step 1: Extract text from both PDFs in streaming batches ──────────────
    old_batches: list[list[str]] = []
    new_batches: list[list[str]] = []
    total_old_pages = session["old_pages"]
    total_new_pages = session["new_pages"]

    try:
        # Collect old PDF batches
        for _, batch, _ in _stream_pdf_pages(old_pdf_bytes, batch_size):
            old_batches.append(batch)
            # Yield to event loop periodically
            await asyncio.sleep(0)

        # Collect new PDF batches
        for _, batch, _ in _stream_pdf_pages(new_pdf_bytes, batch_size):
            new_batches.append(batch)
            await asyncio.sleep(0)

    except Exception as exc:
        session["status"] = "error"
        session["error"]  = f"PDF extraction failed: {exc}"
        return

    # Flatten batches to full page lists for alignment
    old_pages_text = [p for b in old_batches for p in b]
    new_pages_text = [p for b in new_batches for p in b]

    session["progress"] = 30

    # ── Step 2: Chunk XML ──────────────────────────────────────────────────────
    try:
        xml_chunks = _chunk_xml_lxml(xml_content, tag_name=tag_name, max_chars=max_chars)
    except Exception as exc:
        session["status"] = "error"
        session["error"]  = f"XML chunking failed: {exc}"
        return

    session["progress"] = 50

    # ── Step 3: Align PDF pages ↔ XML chunks ──────────────────────────────────
    total_xml = len(xml_chunks)
    total_new = len(new_pages_text)
    total_old = len(old_pages_text)

    # Distribute pages evenly across XML chunks
    pages_per_chunk = max(1, total_new // max(total_xml, 1))

    enriched_chunks: list[dict] = []
    changed_count   = 0
    source_safe     = re.sub(r"[^\w\-]", "_", session["source_name"]).strip("_") or "Document"

    for i, xml_chunk in enumerate(xml_chunks):
        # Page range for this chunk
        p_start = i * pages_per_chunk
        p_end   = p_start + pages_per_chunk

        old_text = "\n".join(old_pages_text[p_start:p_end]) if p_start < total_old else ""
        new_text = "\n".join(new_pages_text[p_start:p_end]) if p_start < total_new else ""

        change_type = _classify_change(old_text, new_text)
        has_changes = change_type != "unchanged"
        similarity  = _compute_similarity(old_text, new_text) if old_text or new_text else 1.0
        diff_lines  = _generate_diff_lines(old_text, new_text) if has_changes else []

        if has_changes:
            changed_count += 1

        # AI-generated XML suggestion
        suggested_xml = (
            _generate_xml_suggestion(xml_chunk["xml_content"], old_text, new_text)
            if has_changes else xml_chunk["xml_content"]
        )

        idx = xml_chunk["index"]
        filename = f"{source_safe}_innod.{idx:05d}.xml"

        chunk_data: dict = {
            "index":          idx,
            "label":          xml_chunk["label"],
            "filename":       filename,
            "old_text":       old_text,
            "new_text":       new_text,
            "has_changes":    has_changes,
            "change_type":    change_type,
            "similarity":     round(similarity, 3),
            "diff_lines":     diff_lines,
            "xml_content":    xml_chunk["xml_content"],
            "xml_suggested":  suggested_xml,
            "xml_saved":      None,      # set after user edits + saves
            "xml_size":       xml_chunk["xml_size"],
            "page_start":     p_start,
            "page_end":       p_end,
        }

        # Write XML chunk to CHUNKED/
        chunked_path = base / "CHUNKED" / filename
        chunked_path.write_text(xml_chunk["xml_content"], encoding="utf-8")

        # Write diff JSON to COMPARE/
        diff_path = base / "COMPARE" / f"diff_{idx:05d}.json"
        diff_summary = {k: v for k, v in chunk_data.items() if k not in ("old_text", "new_text", "diff_lines")}
        diff_path.write_text(json.dumps(diff_summary, ensure_ascii=False, indent=2), encoding="utf-8")

        # Keep full data in memory for small/medium jobs; strip large text for huge jobs
        if total_new > MAX_PAGES_INLINE:
            # For very large PDFs, only keep summary in memory
            chunk_data["old_text"] = old_text[:500] + "..." if len(old_text) > 500 else old_text
            chunk_data["new_text"] = new_text[:500] + "..." if len(new_text) > 500 else new_text
            chunk_data["diff_lines"] = diff_lines[:50]  # cap at 50 diff lines in memory

        enriched_chunks.append(chunk_data)

        # Update progress (50%–95% range covers chunking)
        session["progress"] = 50 + int(45 * (i + 1) / total_xml)
        await asyncio.sleep(0)

    # ── Step 4: Write summary ──────────────────────────────────────────────────
    summary = {
        "total":        total_xml,
        "changed":      changed_count,
        "unchanged":    total_xml - changed_count,
        "old_pages":    total_old_pages,
        "new_pages":    total_new_pages,
        "source_name":  session["source_name"],
    }
    (base / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    session["chunks"]   = enriched_chunks
    session["summary"]  = summary
    session["status"]   = "done"
    session["progress"] = 100

    logger.info(
        "AutoCompare session %s done: %d chunks, %d changed",
        session_id, total_xml, changed_count,
    )


# ── Public helpers (used by router) ───────────────────────────────────────────

def get_session(session_id: str) -> Optional[dict]:
    return _sessions.get(session_id)


def get_chunks_list(session_id: str) -> list[dict]:
    """Return lightweight chunk rows (no large text fields)."""
    session = _sessions.get(session_id)
    if not session:
        return []
    return [
        {
            "index":       c["index"],
            "label":       c["label"],
            "filename":    c["filename"],
            "has_changes": c["has_changes"],
            "change_type": c.get("change_type", "unchanged"),
            "similarity":  c.get("similarity", 1.0),
            "xml_size":    c.get("xml_size", 0),
            "page_start":  c.get("page_start", 0),
            "page_end":    c.get("page_end", 0),
        }
        for c in session.get("chunks", [])
    ]


def get_chunk_detail(session_id: str, chunk_id: str) -> Optional[dict]:
    """
    Return full chunk data (with diff_lines).  For large jobs, re-reads from disk.
    """
    session = _sessions.get(session_id)
    if not session:
        return None

    chunks = session.get("chunks", [])

    # Resolve chunk by index or filename
    try:
        idx   = int(chunk_id)
        chunk = next((c for c in chunks if c["index"] == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c["filename"] == chunk_id), None)

    if not chunk:
        return None

    # If diff_lines was truncated for a large job, reload from disk
    base      = Path(session["storage"]["base"])
    diff_path = base / "COMPARE" / f"diff_{chunk['index']:05d}.json"
    if diff_path.exists() and len(chunk.get("diff_lines", [])) == 0 and chunk["has_changes"]:
        try:
            saved = json.loads(diff_path.read_text(encoding="utf-8"))
            chunk.update(saved)
        except Exception:
            pass

    # Reload full PDF text from disk for very large sessions
    if len(chunk.get("old_text", "")) <= 503 and chunk.get("page_start") is not None:
        p_start = chunk["page_start"]
        p_end   = chunk["page_end"]
        old_pdf = base / "ORIGINAL" / "old.pdf"
        new_pdf = base / "ORIGINAL" / "new.pdf"
        if old_pdf.exists() and new_pdf.exists():
            try:
                old_doc = fitz.open(str(old_pdf))
                new_doc = fitz.open(str(new_pdf))
                old_text = "\n".join(
                    old_doc[p].get_text("text") for p in range(p_start, min(p_end, len(old_doc)))
                )
                new_text = "\n".join(
                    new_doc[p].get_text("text") for p in range(p_start, min(p_end, len(new_doc)))
                )
                old_doc.close()
                new_doc.close()
                chunk["old_text"]   = old_text
                chunk["new_text"]   = new_text
                chunk["diff_lines"] = _generate_diff_lines(old_text, new_text)
            except Exception:
                pass

    return chunk


def save_chunk_xml(session_id: str, chunk_id: str, xml_content: str) -> dict:
    """Persist user-edited XML for a chunk. Validates XML before saving."""
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    # Validate XML
    try:
        etree.fromstring(xml_content.encode("utf-8"))
        valid = True
        errors: list[str] = []
    except etree.XMLSyntaxError as exc:
        valid  = False
        errors = [str(exc)]

    chunks = session.get("chunks", [])
    try:
        idx   = int(chunk_id)
        chunk = next((c for c in chunks if c["index"] == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c["filename"] == chunk_id), None)

    if not chunk:
        raise KeyError(f"Chunk {chunk_id} not found in session {session_id}")

    if valid:
        chunk["xml_saved"] = xml_content
        # Write to CHUNKED folder
        base     = Path(session["storage"]["base"])
        out_path = base / "CHUNKED" / chunk["filename"]
        out_path.write_text(xml_content, encoding="utf-8")

    return {"valid": valid, "errors": errors}


def merge_all_chunks(session_id: str) -> str:
    """
    Merge all saved (or original) XML chunks into a single final XML document.
    Writes to MERGED/final_output.xml and returns the merged string.
    """
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    chunks  = session.get("chunks", [])
    base    = Path(session["storage"]["base"])
    parts: list[str] = []

    for chunk in sorted(chunks, key=lambda c: c["index"]):
        content = chunk.get("xml_saved") or chunk.get("xml_content", "")
        parts.append(content.strip())

    source_name = session["source_name"]
    safe_name   = re.sub(r"[^\w\-]", "_", source_name).strip("_") or "Document"
    merged_xml  = "\n\n".join(parts)
    final_xml   = f'<?xml version="1.0" encoding="UTF-8"?>\n<document source="{source_name}">\n{merged_xml}\n</document>'

    out_path = base / "MERGED" / "final_output.xml"
    out_path.write_text(final_xml, encoding="utf-8")

    return final_xml


def cleanup_old_sessions(ttl: int = SESSION_TTL) -> int:
    """Remove expired sessions from memory and disk. Returns count removed."""
    now     = time.time()
    to_del  = [sid for sid, s in _sessions.items() if now - s.get("created_at", 0) > ttl]
    removed = 0
    for sid in to_del:
        sess = _sessions.pop(sid, None)
        if sess:
            shutil.rmtree(sess["storage"]["base"], ignore_errors=True)
            removed += 1
    return removed
