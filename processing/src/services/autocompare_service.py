"""
autocompare_service.py — AutoCompare engine for PDF + XML comparison.

Pipeline
────────
1. Accept OLD PDF, NEW PDF, and one or more XML files (chunked or whole).
2. Extract text from both PDFs page-by-page using PyMuPDF.
3. For each uploaded XML file: locate its matching pages in BOTH PDFs via
   page-anchor scoring (XML used as structural reference only).
4. Diff OLD PDF text vs NEW PDF text for those pages — only show real
   content changes, filtering out cosmetic line-wrap differences.
5. Save/download individual XML files.

Diff axis
─────────
   Left  side = OLD PDF text  (what the document used to say)
   Right side = NEW PDF text  (what the document now says)

   The XML is the converted form of the OLD PDF. It is used ONLY to:
     • locate which page window to examine in both PDFs (page-anchor scoring)
     • provide structural section labels in the UI

Change types
────────────
    added      — text in NEW PDF but not OLD   (green)
    removed    — text in OLD PDF but not NEW   (red)
    modified   — same section, content changed (yellow)
    unchanged  — no meaningful difference

Noise filtering
───────────────
   Pure line-wrap differences (same words, different line breaks due to
   PDF reflow between versions) are collapsed and excluded. Only
   semantically different content is shown in the diff panel.

Storage layout
──────────────
    /tmp/autocompare/<session_id>/
        ORIGINAL/   old.pdf  new.pdf
        XML/        <original_filename>.xml  …
        COMPARE/    diff_00001.json  …
"""

from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
import logging
import math
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF
import lxml.etree as etree

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

BATCH_SIZE = 50
MAX_PAGES_INLINE = 500
SESSION_TTL = 3600
BASE_STORAGE = Path(tempfile.gettempdir()) / "autocompare"
MAX_DIFF_LINES = 2000
LARGE_TEXT_THRESHOLD = 500_000
LARGE_TEXT_SAMPLE = 100_000

PAGE_WINDOW = int(os.getenv("AUTOCOMPARE_PAGE_WINDOW", "3"))

CHANGE_COLORS = {
    "added": "green",
    "removed": "red",
    "modified": "yellow",
    "unchanged": "none",
}

STOPWORDS = {
    "the", "and", "for", "that", "with", "from", "this", "have", "are", "was", "were",
    "has", "had", "will", "shall", "would", "could", "should", "into", "than", "then",
    "such", "here", "there", "their", "they", "them", "your", "ours", "ourselves",
    "which", "when", "where", "what", "while", "whose", "who", "whom", "been", "being",
    "under", "over", "between", "within", "without", "upon", "about", "above", "below",
    "part", "section", "article", "clause", "schedule", "annex", "table", "row", "cell",
    "old", "new", "pdf", "xml", "chunk", "line", "page", "pages", "text", "content",
}

# ── Session storage ────────────────────────────────────────────────────────────

_sessions: dict[str, dict] = {}
_session_locks: dict[str, asyncio.Lock] = {}


def _get_session_lock(session_id: str) -> asyncio.Lock:
    if session_id not in _session_locks:
        _session_locks[session_id] = asyncio.Lock()
    return _session_locks[session_id]


def _session_dir(session_id: str) -> Path:
    return BASE_STORAGE / session_id


def _ensure_dirs(session_id: str) -> dict[str, Path]:
    base = _session_dir(session_id)
    dirs = {
        "base": base,
        "original": base / "ORIGINAL",
        "xml": base / "XML",
        "compare": base / "COMPARE",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


# ── PDF page streaming ─────────────────────────────────────────────────────────

def _stream_pdf_pages(pdf_bytes: bytes, batch_size: int = BATCH_SIZE):
    """Yield (batch_index, [page_text, ...], total_pages) per batch."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total = len(doc)
    batch: list[str] = []
    batch_idx = 0
    for page_num in range(total):
        page = doc[page_num]
        text = str(page.get_text("text"))
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


# ── Text normalisation & noise filtering ──────────────────────────────────────

def _normalise(text: str) -> str:
    """Collapse whitespace for comparison."""
    return " ".join(text.split()).lower()


def _blocks_are_cosmetic(old_lines: list[str], new_lines: list[str]) -> bool:
    """
    Return True when two blocks differ ONLY in line-wrap positions, not content.

    PDF documents frequently reflow text across line breaks between versions
    (e.g. wider margins, font changes, layout tweaks). This produces thousands
    of spurious "replace" opcodes where the actual words are identical.
    Joining the lines and normalising whitespace reveals these as no-ops.
    """
    old_joined = _normalise(" ".join(old_lines))
    new_joined = _normalise(" ".join(new_lines))
    return old_joined == new_joined


def _compute_similarity(old: str, new: str) -> float:
    """Return 0.0–1.0 similarity ratio."""
    if not old and not new:
        return 1.0
    if max(len(old), len(new)) > LARGE_TEXT_THRESHOLD:
        def _sample(t: str) -> str:
            s = LARGE_TEXT_SAMPLE
            mid = len(t) // 2
            return (t[:s] + t[mid - s // 2:mid + s // 2] + t[-s:]) if len(t) > s * 2 else t
        return difflib.SequenceMatcher(None, _normalise(_sample(old)), _normalise(_sample(new))).ratio()
    return difflib.SequenceMatcher(None, _normalise(old), _normalise(new)).ratio()


# ── XML reference profiling (page-anchor only) ────────────────────────────────

def _extract_xml_reference_profile(xml_text: str) -> tuple[set[str], set[str]]:
    """
    Build token and bigram sets from XML text content for page-anchor scoring.
    The XML is the converted form of the old PDF — its vocabulary tells us
    which pages of both PDFs belong to this chunk.
    """
    if not xml_text:
        return set(), set()
    plain = re.sub(r"<[^>]+>", " ", xml_text)
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-/]{2,}", plain.lower())
    words = [w for w in words if w not in STOPWORDS and not w.isdigit() and len(w) >= 4]
    capped = words[:3000]
    terms = set(capped)
    bigrams = {f"{capped[i]} {capped[i+1]}" for i in range(len(capped) - 1)}
    return terms, bigrams


def _is_line_relevant_to_xml(line_text: str, ref_terms: set[str], ref_bigrams: set[str]) -> bool:
    """Return True when a PDF line appears relevant to the chunk's XML vocabulary."""
    if not ref_terms and not ref_bigrams:
        return True
    norm = _normalise(line_text)
    if not norm:
        return False
    line_words = [
        w for w in re.findall(r"[a-z0-9][a-z0-9'\-/]{2,}", norm)
        if w not in STOPWORDS and not w.isdigit() and len(w) >= 4
    ]
    if not line_words:
        return False
    overlap = sum(1 for w in line_words if w in ref_terms)
    line_bigrams = {f"{line_words[i]} {line_words[i+1]}" for i in range(len(line_words) - 1)}
    bigram_hits = sum(1 for bg in line_bigrams if bg in ref_bigrams)
    overlap_ratio = overlap / max(len(set(line_words)), 1)
    if bigram_hits >= 1 and overlap >= 1:
        return True
    if ref_bigrams:
        if len(ref_terms) < 120:
            return overlap >= 4 and overlap_ratio >= 0.50
        if len(ref_terms) < 300:
            return overlap >= 4 and overlap_ratio >= 0.42
        return overlap >= 3 and overlap_ratio >= 0.45
    if len(ref_terms) < 120:
        return overlap >= 4 and overlap_ratio >= 0.50
    if len(ref_terms) < 300:
        return overlap >= 4 and overlap_ratio >= 0.42
    if overlap >= 5:
        return True
    return overlap >= 3 and overlap_ratio >= 0.45


def _distributed_sample(text: str, sample_size: int) -> str:
    if len(text) <= sample_size:
        return text
    third = sample_size // 3
    mid = len(text) // 2 - third // 2
    return text[:third] + text[mid:mid + third] + text[-third:]


def _classify_change(old_text: str, new_text: str) -> str:
    """Classify change between two text blocks."""
    if not old_text.strip() and new_text.strip():
        return "added"
    if old_text.strip() and not new_text.strip():
        return "removed"
    if old_text == new_text:
        return "unchanged"
    if max(len(old_text), len(new_text)) > LARGE_TEXT_THRESHOLD:
        if (hashlib.md5(old_text.encode("utf-8", errors="replace")).hexdigest() ==
                hashlib.md5(new_text.encode("utf-8", errors="replace")).hexdigest()):
            return "unchanged"
        old_s = _distributed_sample(old_text, LARGE_TEXT_SAMPLE * 3)
        new_s = _distributed_sample(new_text, LARGE_TEXT_SAMPLE * 3)
        if _normalise(old_s) == _normalise(new_s):
            return "unchanged"
        return "modified"
    if _normalise(old_text) == _normalise(new_text):
        return "unchanged"
    return "modified"


def _char_diff_spans(old_line: str, new_line: str) -> tuple[list[dict], list[dict]]:
    """Return (old_spans, new_spans) for inline char-level highlighting."""
    sm = difflib.SequenceMatcher(None, old_line, new_line, autojunk=False)
    old_spans: list[dict] = []
    new_spans: list[dict] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            old_spans.append({"text": old_line[i1:i2], "changed": False})
            new_spans.append({"text": new_line[j1:j2], "changed": False})
        elif op == "replace":
            old_spans.append({"text": old_line[i1:i2], "changed": True})
            new_spans.append({"text": new_line[j1:j2], "changed": True})
        elif op == "delete":
            old_spans.append({"text": old_line[i1:i2], "changed": True})
        elif op == "insert":
            new_spans.append({"text": new_line[j1:j2], "changed": True})
    return old_spans, new_spans


# ── Core diff generator ────────────────────────────────────────────────────────

def _generate_diff_lines(
    old_text: str,
    new_text: str,
    old_line_pages: Optional[list[int]] = None,
    new_line_pages: Optional[list[int]] = None,
) -> list[dict]:
    """
    Line-level diff between OLD PDF text (left) and NEW PDF text (right).

    Noise filtering — cosmetic line-wrap differences are skipped:
      When a replace opcode's old and new blocks contain the same words
      just reflowed across different line breaks, it is silently skipped.
      This eliminates thousands of false positives from PDF reflow between
      document versions and shows only real content changes.

    Result entries:
      added    → line in new PDF not in old  → new content
      removed  → line in old PDF not in new  → deleted content
      modified → both sides present, content differs → edited content
    """
    old_lines = old_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    result: list[dict] = []
    line_num = 0

    old_pages = old_line_pages if old_line_pages and len(old_line_pages) == len(old_lines) else []
    new_pages = new_line_pages if new_line_pages and len(new_line_pages) == len(new_lines) else []

    def _append(
        kind: str,
        text: str,
        old_page: Optional[int] = None,
        new_page: Optional[int] = None,
        old_text_val: Optional[str] = None,
        new_text_val: Optional[str] = None,
        old_spans: Optional[list] = None,
        new_spans: Optional[list] = None,
    ) -> bool:
        nonlocal line_num
        entry: dict = {
            "type": kind,
            "text": text.rstrip("\n"),
            "line": line_num,
            "old_page": old_page,
            "new_page": new_page,
            "old_text": old_text_val,
            "new_text": new_text_val,
        }
        if old_spans is not None:
            entry["old_spans"] = old_spans
        if new_spans is not None:
            entry["new_spans"] = new_spans
        result.append(entry)
        line_num += 1
        if len(result) >= MAX_DIFF_LINES:
            result.append({
                "type": "modified",
                "text": "... diff truncated for performance ...",
                "line": line_num,
                "old_page": None,
                "new_page": None,
            })
            return True
        return False

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue

        elif opcode == "delete":
            for offset, line in enumerate(old_lines[i1:i2]):
                old_page = old_pages[i1 + offset] if old_pages else None
                stripped = line.rstrip("\n")
                if not stripped.strip():
                    continue
                if _append("removed", stripped,
                           old_page=old_page, new_page=None,
                           old_text_val=stripped, new_text_val=""):
                    return result

        elif opcode == "insert":
            for offset, line in enumerate(new_lines[j1:j2]):
                new_page = new_pages[j1 + offset] if new_pages else None
                stripped = line.rstrip("\n")
                if not stripped.strip():
                    continue
                if _append("added", stripped,
                           old_page=None, new_page=new_page,
                           old_text_val="", new_text_val=stripped):
                    return result

        elif opcode == "replace":
            old_block = [ln.rstrip("\n") for ln in old_lines[i1:i2]]
            new_block = [ln.rstrip("\n") for ln in new_lines[j1:j2]]

            # ── Cosmetic noise filter ─────────────────────────────────────
            # Skip blocks that differ only in how lines are wrapped.
            # Joining both sides and normalising whitespace reveals whether
            # the actual words are the same — if so, nothing changed.
            if _blocks_are_cosmetic(old_block, new_block):
                continue

            # Real content change — emit each line pair
            pair_count = max(len(old_block), len(new_block))
            for k in range(pair_count):
                old_ln = old_block[k] if k < len(old_block) else ""
                new_ln = new_block[k] if k < len(new_block) else ""
                old_page = old_pages[i1 + k] if old_pages and (i1 + k) < len(old_pages) else None
                new_page = new_pages[j1 + k] if new_pages and (j1 + k) < len(new_pages) else None

                if not old_ln.strip() and not new_ln.strip():
                    continue

                if old_ln and new_ln:
                    old_spans, new_spans = _char_diff_spans(old_ln, new_ln)
                    if _append(
                        "modified",
                        f"{old_ln} -> {new_ln}",
                        old_page=old_page,
                        new_page=new_page,
                        old_text_val=old_ln,
                        new_text_val=new_ln,
                        old_spans=old_spans,
                        new_spans=new_spans,
                    ):
                        return result
                elif old_ln.strip():
                    if _append("removed", old_ln,
                               old_page=old_page, new_page=None,
                               old_text_val=old_ln, new_text_val=""):
                        return result
                elif new_ln.strip():
                    if _append("added", new_ln,
                               old_page=None, new_page=new_page,
                               old_text_val="", new_text_val=new_ln):
                        return result

                if len(result) >= MAX_DIFF_LINES:
                    return result

    return result


# ── Core processing pipeline ───────────────────────────────────────────────────

def process_upload(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_files: list[tuple[str, bytes]],
    source_name: str,
) -> dict:
    """Initialise a session. Saves files to disk."""
    session_id = str(uuid.uuid4())
    dirs = _ensure_dirs(session_id)

    (dirs["original"] / "old.pdf").write_bytes(old_pdf_bytes)
    (dirs["original"] / "new.pdf").write_bytes(new_pdf_bytes)

    old_pages = _count_pdf_pages(old_pdf_bytes)
    new_pages = _count_pdf_pages(new_pdf_bytes)

    xml_file_list: list[dict] = []
    for i, (filename, xml_bytes) in enumerate(xml_files, start=1):
        safe_filename = re.sub(r"[^\w.\-]", "_", filename)
        out_path = dirs["xml"] / safe_filename
        out_path.write_bytes(xml_bytes)
        xml_file_list.append({
            "index": i,
            "filename": safe_filename,
            "original_filename": filename,
            "xml_size": len(xml_bytes),
        })

    created_at = time.time()
    session: dict[str, Any] = {
        "session_id": session_id,
        "source_name": source_name.strip(),
        "status": "uploaded",
        "progress": 0,
        "error": None,
        "old_pages": old_pages,
        "new_pages": new_pages,
        "xml_file_count": len(xml_files),
        "chunks": [],
        "xml_file_list": xml_file_list,
        "summary": None,
        "storage": {
            "base": str(dirs["base"]),
            "original": str(dirs["original"]),
            "xml": str(dirs["xml"]),
            "compare": str(dirs["compare"]),
        },
        "created_at": created_at,
        "expires_at": created_at + SESSION_TTL,
    }
    _sessions[session_id] = session
    return session


async def start_processing(
    session_id: str,
    batch_size: int = BATCH_SIZE,
) -> None:
    """
    Background coroutine: extract text from both PDFs, use XML only for
    page-anchor scoring, then diff OLD PDF text vs NEW PDF text per chunk.

    The XML is the converted form of the old PDF. It is used ONLY to locate
    which pages of both PDFs correspond to this XML chunk. The actual diff
    is always old_pdf_text ←→ new_pdf_text, filtered to remove line-wrap noise.
    """
    session = _sessions.get(session_id)
    if not session:
        return

    session["status"] = "processing"
    session["progress"] = 0

    base = Path(session["storage"]["base"])

    try:
        old_pdf_bytes = (base / "ORIGINAL" / "old.pdf").read_bytes()
        new_pdf_bytes = (base / "ORIGINAL" / "new.pdf").read_bytes()
    except Exception as exc:
        session["status"] = "error"
        session["error"] = f"Could not read uploaded files: {exc}"
        return

    # ── Step 1: Extract text from both PDFs ──────────────────────────────────
    try:
        old_batches_total = max(1, math.ceil(max(session.get("old_pages", 0), 1) / max(batch_size, 1)))
        new_batches_total = max(1, math.ceil(max(session.get("new_pages", 0), 1) / max(batch_size, 1)))
        total_batches = max(1, old_batches_total + new_batches_total)
        done_batches = 0

        old_pages_text: list[str] = []
        for _, batch, _ in _stream_pdf_pages(old_pdf_bytes, batch_size):
            old_pages_text.extend(batch)
            done_batches += 1
            session["progress"] = min(29, int((done_batches / total_batches) * 30))
            await asyncio.sleep(0)

        new_pages_text: list[str] = []
        for _, batch, _ in _stream_pdf_pages(new_pdf_bytes, batch_size):
            new_pages_text.extend(batch)
            done_batches += 1
            session["progress"] = min(29, int((done_batches / total_batches) * 30))
            await asyncio.sleep(0)
    except Exception as exc:
        session["status"] = "error"
        session["error"] = f"PDF extraction failed: {exc}"
        return

    session["progress"] = 30

    # Build full-document line pools for both PDFs
    all_old_line_chunks: list[tuple[str, int]] = []
    for p, page_text in enumerate(old_pages_text):
        page_no = p + 1
        all_old_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

    all_new_line_chunks: list[tuple[str, int]] = []
    for p, page_text in enumerate(new_pages_text):
        page_no = p + 1
        all_new_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

    # ── Step 2: Process each XML file ────────────────────────────────────────
    xml_file_list = session["xml_file_list"]
    total_chunks = len(xml_file_list)
    enriched_chunks: list[dict] = []
    changed_count = 0

    for i, cf in enumerate(xml_file_list):
        xml_path = base / "XML" / cf["filename"]
        xml_content = ""
        if xml_path.exists():
            try:
                xml_content = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                xml_content = xml_path.read_bytes().decode("utf-8", errors="replace")

        # Build vocabulary profile from XML (which mirrors old PDF content)
        # to locate the correct page window in both PDFs
        ref_terms, ref_bigrams = _extract_xml_reference_profile(xml_content)

        # Page-anchor on OLD PDF (XML ≈ old PDF)
        old_page_scores: dict[int, float] = {}
        for ln, pg in all_old_line_chunks:
            if _is_line_relevant_to_xml(ln, ref_terms, ref_bigrams):
                old_page_scores[pg] = old_page_scores.get(pg, 0) + 1

        if old_page_scores:
            top_old_pages = sorted(old_page_scores, key=lambda p: -old_page_scores[p])[:10]
            anchor_min = min(top_old_pages)
            anchor_max = max(top_old_pages)
            page_start_idx = max(0, anchor_min - PAGE_WINDOW)
            page_end_idx = anchor_max + PAGE_WINDOW
        else:
            page_start_idx = 0
            page_end_idx = min(len(old_pages_text), 10)

        # Extract the page-windowed text from BOTH PDFs
        old_relevant = [
            (ln, pg) for ln, pg in all_old_line_chunks
            if page_start_idx < pg <= page_end_idx
        ]
        new_relevant = [
            (ln, pg) for ln, pg in all_new_line_chunks
            if page_start_idx < pg <= page_end_idx
        ]

        old_text = "".join(line for line, _ in old_relevant)
        new_text = "".join(line for line, _ in new_relevant)

        # Classify using normalised comparison (ignores line-wrap noise)
        change_type = _classify_change(old_text, new_text)
        has_changes = change_type != "unchanged"
        similarity = _compute_similarity(old_text, new_text) if old_text or new_text else 1.0
        if has_changes:
            changed_count += 1

        label = cf["original_filename"]
        if label.lower().endswith(".xml"):
            label = label[:-4]

        chunk_data: dict = {
            "index": cf["index"],
            "label": label,
            "filename": cf["filename"],
            "original_filename": cf["original_filename"],
            "old_text": "",
            "new_text": "",
            "has_changes": has_changes,
            "change_type": change_type,
            "similarity": round(similarity, 3),
            "diff_lines": [],
            "xml_content": "",
            "xml_suggested": "",
            "xml_saved": None,
            "xml_size": cf["xml_size"],
            "page_start": page_start_idx,
            "page_end": page_end_idx,
            "auto_reviewed": not has_changes,
        }

        diff_path = base / "COMPARE" / f"diff_{cf['index']:05d}.json"
        diff_summary = {k: v for k, v in chunk_data.items() if k not in ("old_text", "new_text", "diff_lines")}
        diff_path.write_text(json.dumps(diff_summary, ensure_ascii=False, indent=2), encoding="utf-8")

        enriched_chunks.append(chunk_data)
        session["progress"] = 30 + int(65 * (i + 1) / total_chunks)
        await asyncio.sleep(0)

    summary = {
        "total": total_chunks,
        "changed": changed_count,
        "unchanged": total_chunks - changed_count,
        "old_pages": session["old_pages"],
        "new_pages": session["new_pages"],
        "source_name": session["source_name"],
    }
    (base / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    session["chunks"] = enriched_chunks
    session["summary"] = summary
    session["status"] = "done"
    session["progress"] = 100

    logger.info(
        "AutoCompare session %s done: %d chunks, %d changed",
        session_id, total_chunks, changed_count,
    )


# ── Public helpers ─────────────────────────────────────────────────────────────

def _reconstruct_session_from_disk(session_id: str) -> Optional[dict]:
    session_dir = _session_dir(session_id)
    if not session_dir.exists():
        return None
    original_dir = session_dir / "ORIGINAL"
    xml_dir      = session_dir / "XML"
    compare_dir  = session_dir / "COMPARE"
    summary_path = session_dir / "summary.json"
    if not original_dir.exists():
        return None

    summary: Optional[dict] = None
    status = "uploaded"
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            status  = "done"
        except Exception:
            pass

    old_pages = new_pages = 0
    for which, attr in (("old.pdf", "old_pages"), ("new.pdf", "new_pages")):
        pdf_path = original_dir / which
        if pdf_path.exists():
            try:
                val = _count_pdf_pages(pdf_path.read_bytes())
                if attr == "old_pages":
                    old_pages = val
                else:
                    new_pages = val
            except Exception:
                pass

    xml_file_list: list[dict] = []
    if xml_dir.exists():
        for i, xp in enumerate(sorted(xml_dir.glob("*.xml")), start=1):
            xml_file_list.append({
                "index": i,
                "filename": xp.name,
                "original_filename": xp.name,
                "xml_size": xp.stat().st_size,
            })

    chunks: list[dict] = []
    if compare_dir.exists() and status == "done":
        for diff_path in sorted(compare_dir.glob("diff_*.json")):
            try:
                chunk_data = json.loads(diff_path.read_text(encoding="utf-8"))
                chunk_data.setdefault("old_text", "")
                chunk_data.setdefault("new_text", "")
                chunk_data.setdefault("diff_lines", [])
                chunk_data.setdefault("auto_reviewed", not chunk_data.get("has_changes", True))
                chunks.append(chunk_data)
            except Exception:
                pass

    created_at = session_dir.stat().st_ctime
    source_name = (summary or {}).get("source_name", session_id[:8])
    session: dict = {
        "session_id":     session_id,
        "source_name":    source_name,
        "status":         status,
        "progress":       100 if status == "done" else 0,
        "error":          None,
        "old_pages":      (summary or {}).get("old_pages", old_pages),
        "new_pages":      (summary or {}).get("new_pages", new_pages),
        "xml_file_count": len(xml_file_list),
        "chunks":         chunks,
        "xml_file_list":  xml_file_list,
        "summary":        summary,
        "storage": {
            "base":     str(session_dir),
            "original": str(original_dir),
            "xml":      str(xml_dir),
            "compare":  str(compare_dir),
        },
        "created_at": created_at,
        "expires_at": created_at + SESSION_TTL,
    }
    _sessions[session_id] = session
    logger.info("Reconstructed session %s from disk — status=%s chunks=%d", session_id, status, len(chunks))
    return session


def get_session(session_id: str) -> Optional[dict]:
    session = _sessions.get(session_id)
    if session is not None:
        return session
    return _reconstruct_session_from_disk(session_id)


def get_chunks_list(session_id: str) -> list[dict]:
    session = _sessions.get(session_id)
    if not session:
        return []
    return [
        {
            "index": c["index"],
            "label": c["label"],
            "filename": c["filename"],
            "original_filename": c.get("original_filename", c["filename"]),
            "has_changes": c["has_changes"],
            "change_type": c.get("change_type", "unchanged"),
            "similarity": c.get("similarity", 1.0),
            "xml_size": c.get("xml_size", 0),
            "page_start": c.get("page_start", 0),
            "page_end": c.get("page_end", 0),
            "auto_reviewed": c.get("auto_reviewed", not c["has_changes"]),
        }
        for c in session.get("chunks", [])
    ]


def get_chunk_detail(session_id: str, chunk_id: str) -> Optional[dict]:
    """
    Return full chunk data including diff_lines.

    old_text = OLD PDF text for the page window
    new_text = NEW PDF text for the same page window
    diff_lines = real content changes only (line-wrap noise removed)
    XML is available in xml_content for display in the editor.
    """
    session = _sessions.get(session_id)
    if not session:
        return None

    chunks = session.get("chunks", [])
    try:
        idx = int(chunk_id)
        chunk = next((c for c in chunks if c["index"] == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c["filename"] == chunk_id), None)

    if not chunk:
        return None

    base = Path(session["storage"]["base"])

    # Load XML content lazily (for editor display — not used in diff)
    if not chunk.get("xml_content"):
        xml_path = base / "XML" / chunk["filename"]
        if xml_path.exists():
            try:
                chunk["xml_content"] = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                chunk["xml_content"] = xml_path.read_bytes().decode("utf-8", errors="replace")
        chunk["xml_suggested"] = chunk.get("xml_saved") or chunk.get("xml_content", "")

    # Load from cache if texts were already resolved
    cache_path = base / "COMPARE" / f"text_{chunk['index']:05d}.json"
    if cache_path.exists() and not chunk.get("old_text") and not chunk.get("new_text"):
        try:
            import json as _json
            cached = _json.loads(cache_path.read_text(encoding="utf-8"))
            chunk["old_text"] = cached.get("old_text", "")
            chunk["new_text"] = cached.get("new_text", "")
            chunk["page_start"] = cached.get("page_start", chunk.get("page_start", 0))
            chunk["page_end"] = cached.get("page_end", chunk.get("page_end", 0))
            if chunk.get("has_changes") and not chunk.get("diff_lines"):
                chunk["diff_lines"] = _generate_diff_lines(
                    chunk["old_text"], chunk["new_text"]
                )
        except Exception:
            pass

    # Build page-scoped text and diff on demand
    if chunk.get("page_start") is not None and not chunk.get("old_text"):
        p_start = chunk["page_start"]
        p_end = chunk["page_end"]
        old_pdf = base / "ORIGINAL" / "old.pdf"
        new_pdf = base / "ORIGINAL" / "new.pdf"
        if old_pdf.exists() and new_pdf.exists():
            try:
                old_doc = fitz.open(str(old_pdf))
                new_doc = fitz.open(str(new_pdf))

                old_line_chunks: list[tuple[str, int]] = []
                for p in range(len(old_doc)):
                    page_no = p + 1
                    for ln in str(old_doc[p].get_text("text")).splitlines(keepends=True):
                        old_line_chunks.append((ln, page_no))

                new_line_chunks: list[tuple[str, int]] = []
                for p in range(len(new_doc)):
                    page_no = p + 1
                    for ln in str(new_doc[p].get_text("text")).splitlines(keepends=True):
                        new_line_chunks.append((ln, page_no))

                xml_content = chunk.get("xml_content", "")
                ref_terms, ref_bigrams = _extract_xml_reference_profile(xml_content)

                # Page-anchor on OLD PDF
                old_page_scores: dict[int, float] = {}
                for ln, pg in old_line_chunks:
                    if _is_line_relevant_to_xml(ln, ref_terms, ref_bigrams):
                        old_page_scores[pg] = old_page_scores.get(pg, 0) + 1

                if old_page_scores:
                    top_pages = sorted(old_page_scores, key=lambda p: -old_page_scores[p])[:10]
                    anchor_min = min(top_pages)
                    anchor_max = max(top_pages)
                    p_lo = max(0, anchor_min - PAGE_WINDOW)
                    p_hi = anchor_max + PAGE_WINDOW
                else:
                    p_lo = max(0, p_start - 1)
                    p_hi = min(p_end + 2, p_start + 15)

                old_relevant = [(ln, pg) for ln, pg in old_line_chunks if p_lo < pg <= p_hi]
                new_relevant = [(ln, pg) for ln, pg in new_line_chunks if p_lo < pg <= p_hi]

                old_text = "".join(line for line, _ in old_relevant)
                new_text = "".join(line for line, _ in new_relevant)

                relevant_pages = [pg for _, pg in old_relevant] + [pg for _, pg in new_relevant]
                if relevant_pages:
                    chunk["page_start"] = max(0, min(relevant_pages) - 1)
                    chunk["page_end"] = max(relevant_pages)

                old_doc.close()
                new_doc.close()

                chunk["old_text"] = old_text
                chunk["new_text"] = new_text
                chunk["change_type"] = _classify_change(old_text, new_text)

                try:
                    import json as _json
                    cp = base / "COMPARE" / f"text_{chunk['index']:05d}.json"
                    cp.write_text(
                        _json.dumps({
                            "old_text": old_text, "new_text": new_text,
                            "page_start": chunk["page_start"], "page_end": chunk["page_end"],
                        }, ensure_ascii=False),
                        encoding="utf-8",
                    )
                except Exception:
                    pass

                chunk["has_changes"] = chunk["change_type"] != "unchanged"
                chunk["similarity"] = round(
                    _compute_similarity(old_text, new_text) if old_text or new_text else 1.0, 3
                )
                chunk["diff_lines"] = (
                    _generate_diff_lines(
                        old_text, new_text,
                        old_line_pages=[pg for _, pg in old_relevant],
                        new_line_pages=[pg for _, pg in new_relevant],
                    )
                    if chunk.get("has_changes") else []
                )
            except Exception:
                pass

    return chunk


def save_chunk_xml(session_id: str, chunk_id: str, xml_content: str) -> dict:
    """Persist user-edited XML for a file. Validates XML before saving."""
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    try:
        etree.fromstring(xml_content.encode("utf-8"))
        valid = True
        errors: list[str] = []
    except etree.XMLSyntaxError as exc:
        valid = False
        errors = [str(exc)]

    chunks = session.get("chunks", [])
    try:
        idx = int(chunk_id)
        chunk = next((c for c in chunks if c["index"] == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c["filename"] == chunk_id), None)

    if not chunk:
        raise KeyError(f"Chunk {chunk_id} not found in session {session_id}")

    if not chunk.get("xml_content"):
        base = Path(session["storage"]["base"])
        src_path = base / "XML" / chunk["filename"]
        if src_path.exists():
            try:
                chunk["xml_content"] = src_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                chunk["xml_content"] = src_path.read_bytes().decode("utf-8", errors="replace")

    if valid:
        chunk["xml_saved"] = xml_content
        base = Path(session["storage"]["base"])
        out_path = base / "XML" / chunk["filename"]
        out_path.write_text(xml_content, encoding="utf-8")

    return {"valid": valid, "errors": errors}


def validate_chunk_xml(session_id: str, chunk_id: str) -> dict:
    """Validate a chunk's XML and report status."""
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    chunks = session.get("chunks", [])
    try:
        idx = int(chunk_id)
        chunk = next((c for c in chunks if c["index"] == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c["filename"] == chunk_id), None)

    if not chunk:
        raise KeyError(f"Chunk {chunk_id} not found in session {session_id}")

    if not chunk.get("xml_content"):
        base = Path(session["storage"]["base"])
        src_path = base / "XML" / chunk["filename"]
        if src_path.exists():
            try:
                chunk["xml_content"] = src_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                chunk["xml_content"] = src_path.read_bytes().decode("utf-8", errors="replace")

    xml_content = chunk.get("xml_saved") or chunk.get("xml_content", "")
    original_xml = chunk.get("xml_content", "")

    try:
        etree.fromstring(xml_content.encode("utf-8"))
        xml_valid = True
        xml_errors: list[str] = []
    except etree.XMLSyntaxError as exc:
        xml_valid = False
        xml_errors = [str(exc)]

    is_updated = chunk.get("xml_saved") is not None
    is_modified = is_updated and xml_content != original_xml
    has_pdf_changes = chunk.get("has_changes", False)
    needs_further_changes = False
    change_details: list[str] = []

    if has_pdf_changes and not is_updated:
        needs_further_changes = True
        change_details.append("PDF changes detected but XML has not been updated yet.")
    if has_pdf_changes and is_updated and xml_content == original_xml:
        needs_further_changes = True
        change_details.append("Changes detected but XML content is still the same as the original.")
    if not xml_valid:
        needs_further_changes = True
        change_details.append("XML has syntax errors that need to be fixed.")

    if not has_pdf_changes:
        status = "no_changes"
        message = "No changes detected between Old and New PDFs for this chunk."
    elif is_modified and xml_valid and not needs_further_changes:
        status = "updated"
        message = "XML has been updated and changes have been applied successfully."
    elif is_updated and not is_modified:
        status = "saved_unchanged"
        message = "XML was saved but content is identical to the original."
    elif needs_further_changes:
        status = "needs_review"
        message = "Further modifications are still required."
    else:
        status = "pending"
        message = "Changes detected — review and update the XML."

    return {
        "status": status,
        "message": message,
        "xml_valid": xml_valid,
        "xml_errors": xml_errors,
        "is_updated": is_updated,
        "is_modified": is_modified,
        "has_pdf_changes": has_pdf_changes,
        "needs_further_changes": needs_further_changes,
        "change_details": change_details,
    }


def validate_all_chunks(session_id: str) -> dict:
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    chunks = session.get("chunks", [])
    results: list[dict] = []
    counts = {"updated": 0, "no_changes": 0, "saved_unchanged": 0,
              "needs_review": 0, "pending": 0, "invalid_xml": 0}

    for chunk in chunks:
        chunk_id = str(chunk.get("index"))
        result = validate_chunk_xml(session_id, chunk_id)
        status = result.get("status", "pending")
        if status in counts:
            counts[status] += 1
        if not result.get("xml_valid", False):
            counts["invalid_xml"] += 1
        results.append({
            "chunk_id": chunk_id,
            "index": chunk.get("index"),
            "label": chunk.get("label", chunk.get("filename", chunk_id)),
            "filename": chunk.get("filename"),
            **result,
        })

    needs_action = [r for r in results if r.get("needs_further_changes") or not r.get("xml_valid", True)]
    return {
        "session_id": session_id,
        "total": len(results),
        "summary": counts,
        "needs_action_count": len(needs_action),
        "results": results,
    }


def reupload_xml_files(session_id: str, xml_files: list[tuple[str, bytes]]) -> dict:
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    base = Path(session["storage"]["base"])
    xml_dir = base / "XML"
    for f in xml_dir.iterdir():
        f.unlink()

    new_xml_files: list[dict] = []
    for i, (filename, xml_bytes) in enumerate(xml_files, start=1):
        safe_filename = re.sub(r"[^\w.\-]", "_", filename)
        out_path = xml_dir / safe_filename
        out_path.write_bytes(xml_bytes)
        new_xml_files.append({
            "index": i,
            "filename": safe_filename,
            "original_filename": filename,
            "xml_size": len(xml_bytes),
        })

    session["xml_file_list"] = new_xml_files
    session["xml_file_count"] = len(xml_files)
    session["chunks"] = []
    session["summary"] = None
    session["status"] = "uploaded"
    session["progress"] = 0
    return session


def get_chunk_xml_content(session_id: str, chunk_id: str) -> tuple[str, str]:
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")
    chunks = session.get("chunks", [])
    try:
        idx = int(chunk_id)
        chunk = next((c for c in chunks if c["index"] == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c["filename"] == chunk_id), None)
    if not chunk:
        raise KeyError(f"Chunk {chunk_id} not found")
    xml_content = chunk.get("xml_saved") or chunk.get("xml_content", "")
    filename = chunk.get("original_filename", chunk["filename"])
    return filename, xml_content


def cleanup_old_sessions(ttl: int = SESSION_TTL) -> int:
    now = time.time()
    to_del = [sid for sid, s in _sessions.items() if now - s.get("created_at", 0) > ttl]
    removed = 0
    for sid in to_del:
        session = _sessions.pop(sid, None)
        _session_locks.pop(sid, None)
        if session:
            base_path = session.get("storage", {}).get("base")
            if base_path:
                shutil.rmtree(base_path, ignore_errors=True)
            removed += 1

    if BASE_STORAGE.exists():
        for session_dir in BASE_STORAGE.iterdir():
            if not session_dir.is_dir():
                continue
            sid = session_dir.name
            if sid in _sessions:
                continue
            try:
                ctime = session_dir.stat().st_ctime
                if now - ctime > ttl:
                    shutil.rmtree(session_dir, ignore_errors=True)
                    removed += 1
            except Exception:
                pass
    return removed


def export_session_report(session_id: str) -> dict:
    session = get_session(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    rows: list[dict] = []
    for chunk in session.get("chunks", []):
        xml_saved   = chunk.get("xml_saved")
        xml_content = chunk.get("xml_content", "")
        if not xml_content:
            base = Path(session["storage"]["base"])
            xml_path = base / "XML" / chunk["filename"]
            if xml_path.exists():
                try:
                    xml_content = xml_path.read_text(encoding="utf-8")
                except Exception:
                    xml_content = ""
        is_updated  = xml_saved is not None
        is_modified = is_updated and xml_saved != xml_content
        rows.append({
            "index":          chunk.get("index"),
            "label":          chunk.get("label", ""),
            "filename":       chunk.get("filename", ""),
            "change_type":    chunk.get("change_type", "unchanged"),
            "has_changes":    chunk.get("has_changes", False),
            "similarity_pct": round(chunk.get("similarity", 1.0) * 100, 1),
            "page_start":     chunk.get("page_start", 0) + 1,
            "page_end":       chunk.get("page_end", 0),
            "xml_size_bytes": chunk.get("xml_size", 0),
            "is_updated":     is_updated,
            "is_modified":    is_modified,
            "auto_reviewed":  chunk.get("auto_reviewed", False),
        })

    return {
        "session_id":   session_id,
        "source_name":  session.get("source_name", ""),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary":      session.get("summary", {}),
        "chunks":       rows,
    }