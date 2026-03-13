"""
autocompare_service.py — AutoCompare engine for PDF + pre-chunked XML comparison.

Pipeline
────────
1. Accept OLD PDF, NEW PDF, and multiple **pre-chunked** XML files.
2. Extract text from both PDFs page-by-page using PyMuPDF.
3. Compare OLD vs NEW PDF text to detect changes.
4. Align PDF text with each pre-chunked XML file.
5. Per-chunk: detect emphasis elements, generate diff lines, produce AI XML suggestions.
6. Save/download individual chunk XMLs — no merge step.

The XML files are already chunked (e.g. BF-UKPARAct-00030_VER012126.innod_00001.xml).
This module does NOT perform XML chunking.

Change types
────────────
    added      — text present in NEW but not OLD (green)
    removed    — text present in OLD but not NEW (red)
    modified   — text present in both but changed (yellow)
    unchanged  — no change detected

Storage layout
──────────────
    /tmp/autocompare/<session_id>/
        ORIGINAL/   old.pdf  new.pdf
        CHUNKED/    <original_filename>.xml  …
        COMPARE/    diff_00001.json  …
"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
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


def _session_dir(session_id: str) -> Path:
    return BASE_STORAGE / session_id


def _ensure_dirs(session_id: str) -> dict[str, Path]:
    base = _session_dir(session_id)
    dirs = {
        "base": base,
        "original": base / "ORIGINAL",
        "chunked": base / "CHUNKED",
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


# ── Text diff utilities ────────────────────────────────────────────────────────

def _normalise(text: str) -> str:
    """Collapse whitespace for comparison."""
    return " ".join(text.split()).lower()


def _compute_similarity(old: str, new: str) -> float:
    """Return 0.0–1.0 similarity ratio."""
    if not old and not new:
        return 1.0

    # Avoid very expensive full-document matching on huge chunks.
    if max(len(old), len(new)) > LARGE_TEXT_THRESHOLD:
        old_sample = (old[:LARGE_TEXT_SAMPLE] + old[-LARGE_TEXT_SAMPLE:]) if len(old) > (2 * LARGE_TEXT_SAMPLE) else old
        new_sample = (new[:LARGE_TEXT_SAMPLE] + new[-LARGE_TEXT_SAMPLE:]) if len(new) > (2 * LARGE_TEXT_SAMPLE) else new
        return difflib.SequenceMatcher(None, _normalise(old_sample), _normalise(new_sample)).ratio()

    return difflib.SequenceMatcher(None, _normalise(old), _normalise(new)).ratio()


def _extract_xml_reference_profile(xml_text: str) -> tuple[set[str], set[str]]:
    """Build token and bigram sets from XML text content for chunk-local matching."""
    if not xml_text:
        return set(), set()

    # Strip tags and collapse whitespace so matching is based on textual content.
    plain = re.sub(r"<[^>]+>", " ", xml_text)
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-/]{2,}", plain.lower())
    words = [w for w in words if w not in STOPWORDS and not w.isdigit() and len(w) >= 4]

    capped_words = words[:3000]
    terms = set(capped_words)
    bigrams = {
        f"{capped_words[i]} {capped_words[i + 1]}"
        for i in range(len(capped_words) - 1)
    }
    return terms, bigrams


def _is_line_relevant_to_xml(line_text: str, ref_terms: set[str], ref_bigrams: set[str]) -> bool:
    """Return True when a PDF line appears relevant to the chunk's XML content."""
    # Never fall back to matching all lines. If we cannot derive references
    # from the uploaded XML chunk, treat the line as non-relevant.
    if not ref_terms and not ref_bigrams:
        return False

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
    line_bigrams = {
        f"{line_words[i]} {line_words[i + 1]}"
        for i in range(len(line_words) - 1)
    }
    bigram_hits = sum(1 for bg in line_bigrams if bg in ref_bigrams)
    overlap_ratio = overlap / max(len(set(line_words)), 1)

    # Strong signal: explicit phrase overlap from the chunk XML.
    if bigram_hits >= 1 and overlap >= 1:
        return True

    # If chunk profile has phrase data, require stronger lexical overlap.
    if ref_bigrams:
        if len(ref_terms) < 120:
            return overlap >= 4 and overlap_ratio >= 0.50
        if len(ref_terms) < 300:
            return overlap >= 4 and overlap_ratio >= 0.42
        return overlap >= 3 and overlap_ratio >= 0.45

    # Stricter thresholds for shorter/narrower XML chunks.
    if len(ref_terms) < 120:
        return overlap >= 4 and overlap_ratio >= 0.50
    if len(ref_terms) < 300:
        return overlap >= 4 and overlap_ratio >= 0.42

    if overlap >= 5:
        return True
    return overlap >= 3 and overlap_ratio >= 0.45


def _filter_line_chunks_by_xml(
    line_chunks: list[tuple[str, int]],
    ref_terms: set[str],
    ref_bigrams: set[str],
) -> list[tuple[str, int]]:
    """Filter per-line PDF chunks down to lines relevant to the XML reference terms."""
    return [
        (ln, pg)
        for ln, pg in line_chunks
        if _is_line_relevant_to_xml(ln, ref_terms, ref_bigrams)
    ]


def _classify_change(old_text: str, new_text: str) -> str:
    """Classify change between two text blocks."""
    if not old_text.strip() and new_text.strip():
        return "added"
    if old_text.strip() and not new_text.strip():
        return "removed"

    if old_text == new_text:
        return "unchanged"

    # Fast-path for very large text chunks: compare normalized head/tail samples.
    if max(len(old_text), len(new_text)) > LARGE_TEXT_THRESHOLD:
        old_sample = (
            old_text[:LARGE_TEXT_SAMPLE] + old_text[-LARGE_TEXT_SAMPLE:]
            if len(old_text) > (2 * LARGE_TEXT_SAMPLE)
            else old_text
        )
        new_sample = (
            new_text[:LARGE_TEXT_SAMPLE] + new_text[-LARGE_TEXT_SAMPLE:]
            if len(new_text) > (2 * LARGE_TEXT_SAMPLE)
            else new_text
        )
        if _normalise(old_sample) == _normalise(new_sample):
            return "unchanged"
        return "modified"

    if _normalise(old_text) == _normalise(new_text):
        return "unchanged"
    return "modified"


def _generate_diff_lines(
    old_text: str,
    new_text: str,
    old_line_pages: Optional[list[int]] = None,
    new_line_pages: Optional[list[int]] = None,
) -> list[dict]:
    """
    Line-level diff for the Diff Panel.
    Returns list of { "type": "added"|"removed"|"modified", "text": str, "line": int }.
    Unchanged lines are intentionally omitted.
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
        old_text: Optional[str] = None,
        new_text: Optional[str] = None,
    ) -> bool:
        nonlocal line_num
        result.append({
            "type": kind,
            "text": text.rstrip("\n"),
            "line": line_num,
            "old_page": old_page,
            "new_page": new_page,
            "old_text": old_text,
            "new_text": new_text,
        })
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

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue
        elif opcode == "delete":
            for offset, line in enumerate(old_lines[i1:i2]):
                old_page = old_pages[i1 + offset] if old_pages else None
                if _append("removed", line, old_page=old_page, new_page=None, old_text=line.rstrip("\n"), new_text=""):
                    return result
        elif opcode == "insert":
            for offset, line in enumerate(new_lines[j1:j2]):
                new_page = new_pages[j1 + offset] if new_pages else None
                if _append("added", line, old_page=None, new_page=new_page, old_text="", new_text=line.rstrip("\n")):
                    return result
        elif opcode == "replace":
            old_block = [ln.rstrip("\n") for ln in old_lines[i1:i2]]
            new_block = [ln.rstrip("\n") for ln in new_lines[j1:j2]]
            pair_count = max(len(old_block), len(new_block))

            for k in range(pair_count):
                old_ln = old_block[k] if k < len(old_block) else ""
                new_ln = new_block[k] if k < len(new_block) else ""
                old_page = old_pages[i1 + k] if old_pages and (i1 + k) < len(old_pages) else None
                new_page = new_pages[j1 + k] if new_pages and (j1 + k) < len(new_pages) else None

                if old_ln and new_ln:
                    if _append(
                        "modified",
                        f"{old_ln} -> {new_ln}",
                        old_page=old_page,
                        new_page=new_page,
                        old_text=old_ln,
                        new_text=new_ln,
                    ):
                        return result
                elif old_ln:
                    if _append("removed", old_ln, old_page=old_page, new_page=None, old_text=old_ln, new_text=""):
                        return result
                elif new_ln:
                    if _append("added", new_ln, old_page=None, new_page=new_page, old_text="", new_text=new_ln):
                        return result

                if len(result) >= MAX_DIFF_LINES:
                    return result

    return result


# ── AI-assisted XML update generation ─────────────────────────────────────────

def _remove_text_preserve_xml_structure(xml_chunk: str, text_to_remove: str) -> Optional[str]:
    """
    Remove text from XML text nodes/tails while preserving tag structure.
    Returns updated XML or None when no safe removal could be applied.
    """
    target = (text_to_remove or "").strip()
    if not target:
        return None

    try:
        parser = etree.XMLParser(recover=True, remove_blank_text=False)
        root = etree.fromstring(xml_chunk.encode("utf-8"), parser=parser)
    except Exception:
        return None

    words = [w for w in re.split(r"\s+", target) if w]
    fuzzy_pat = None
    if len(words) >= 3:
        fuzzy_pat = re.compile(r"\s+".join(re.escape(w) for w in words), flags=re.IGNORECASE)

    def _remove_from_value(value: str) -> tuple[str, bool]:
        if target in value:
            return value.replace(target, "", 1), True
        if fuzzy_pat:
            next_val, n = fuzzy_pat.subn("", value, count=1)
            if n > 0:
                return next_val, True
        return value, False

    changed = False
    for el in root.iter():
        if el.text:
            new_text, did = _remove_from_value(el.text)
            if did:
                el.text = new_text
                changed = True
                break
        if el.tail:
            new_tail, did = _remove_from_value(el.tail)
            if did:
                el.tail = new_tail
                changed = True
                break

    if not changed:
        return None

    return etree.tostring(root, encoding="unicode")

def _generate_xml_suggestion(
    xml_chunk: str,
    old_pdf_text: str,
    new_pdf_text: str,
    focus_old_text: Optional[str] = None,
    focus_new_text: Optional[str] = None,
    focus_text: Optional[str] = None,
) -> str:
    """
    Generate a suggested XML update based on changes between OLD and NEW PDF text.

    1. Build sentence-level diff (old → new).
    2. Replace matching sentences in the XML chunk.
    3. Handle paragraph-level changes as fallback.
    """
    updated_xml = xml_chunk

    # Targeted line-level replacement when the UI provides a selected diff line.
    # This keeps right-click Generate scoped to the chosen change whenever possible.
    f_old = (focus_old_text or "").strip()
    f_new = (focus_new_text or "").strip()
    f_any = (focus_text or "").strip()
    if f_old or f_new or f_any:
        if f_old and f_new and f_old in updated_xml:
            return updated_xml.replace(f_old, f_new, 1)
        if f_old and not f_new:
            removed = _remove_text_preserve_xml_structure(updated_xml, f_old)
            if removed is not None:
                return removed
            if f_old in updated_xml:
                return updated_xml.replace(f_old, "", 1)
        if f_old and f_old in updated_xml:
            return updated_xml.replace(f_old, f_new or "", 1)
        if f_new and f_new not in updated_xml:
            close_match = re.search(r"(</[^>]+>\s*)$", updated_xml)
            if close_match:
                insert_pos = close_match.start()
                return updated_xml[:insert_pos] + f"\n{f_new}\n" + updated_xml[insert_pos:]
            return updated_xml + f"\n{f_new}\n"
        if f_any and f_any in updated_xml:
            return updated_xml

    if not new_pdf_text.strip():
        return xml_chunk

    # Sentence-level diff
    old_sentences = re.split(r"(?<=[.!?])\s+", old_pdf_text.strip())
    new_sentences = re.split(r"(?<=[.!?])\s+", new_pdf_text.strip())

    matcher = difflib.SequenceMatcher(None, old_sentences, new_sentences)

    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "replace" and (i2 - i1) == (j2 - j1):
            for old_sent, new_sent in zip(old_sentences[i1:i2], new_sentences[j1:j2]):
                if len(old_sent) > 10 and old_sent in updated_xml:
                    updated_xml = updated_xml.replace(old_sent, new_sent, 1)
        elif opcode == "insert":
            for new_sent in new_sentences[j1:j2]:
                if len(new_sent) > 10:
                    close_match = re.search(r"(</[^>]+>\s*)$", updated_xml)
                    if close_match:
                        insert_pos = close_match.start()
                        updated_xml = (
                            updated_xml[:insert_pos]
                            + f"\n{new_sent}\n"
                            + updated_xml[insert_pos:]
                        )

    # Paragraph-level fallback
    if updated_xml == xml_chunk and old_pdf_text.strip() != new_pdf_text.strip():
        old_paras = [p.strip() for p in old_pdf_text.split("\n\n") if p.strip()]
        new_paras = [p.strip() for p in new_pdf_text.split("\n\n") if p.strip()]
        para_matcher = difflib.SequenceMatcher(None, old_paras, new_paras)

        for opcode, i1, i2, j1, j2 in para_matcher.get_opcodes():
            if opcode == "replace":
                for old_p, new_p in zip(old_paras[i1:i2], new_paras[j1:j2]):
                    if len(old_p) > 15 and old_p in updated_xml:
                        updated_xml = updated_xml.replace(old_p, new_p, 1)

    return updated_xml


# ── Core processing pipeline ───────────────────────────────────────────────────

def process_upload(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_files: list[tuple[str, bytes]],
    source_name: str,
) -> dict:
    """
    Initialise a session. Saves files to disk.
    xml_files is a list of (filename, content_bytes) for each pre-chunked XML.
    """
    session_id = str(uuid.uuid4())
    dirs = _ensure_dirs(session_id)

    # Persist original PDFs
    (dirs["original"] / "old.pdf").write_bytes(old_pdf_bytes)
    (dirs["original"] / "new.pdf").write_bytes(new_pdf_bytes)

    old_pages = _count_pdf_pages(old_pdf_bytes)
    new_pages = _count_pdf_pages(new_pdf_bytes)

    # Persist each pre-chunked XML file. Keep only metadata in memory;
    # XML content is loaded lazily when a chunk is opened.
    chunk_files: list[dict] = []
    for i, (filename, xml_bytes) in enumerate(xml_files, start=1):
        safe_filename = re.sub(r"[^\w.\-]", "_", filename)
        out_path = dirs["chunked"] / safe_filename
        out_path.write_bytes(xml_bytes)

        chunk_files.append({
            "index": i,
            "filename": safe_filename,
            "original_filename": filename,
            "xml_size": len(xml_bytes),
        })

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
        "chunk_files": chunk_files,
        "summary": None,
        "storage": {
            "base": str(dirs["base"]),
            "original": str(dirs["original"]),
            "chunked": str(dirs["chunked"]),
            "compare": str(dirs["compare"]),
        },
        "created_at": time.time(),
    }
    _sessions[session_id] = session
    return session


async def start_processing(
    session_id: str,
    batch_size: int = BATCH_SIZE,
) -> None:
    """
    Background coroutine: extract text from both PDFs, compare against
    each pre-chunked XML file, build diff data.

    No XML chunking — XML files are already chunked.
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
        old_pages_text: list[str] = []
        for _, batch, _ in _stream_pdf_pages(old_pdf_bytes, batch_size):
            old_pages_text.extend(batch)
            await asyncio.sleep(0)

        new_pages_text: list[str] = []
        for _, batch, _ in _stream_pdf_pages(new_pdf_bytes, batch_size):
            new_pages_text.extend(batch)
            await asyncio.sleep(0)
    except Exception as exc:
        session["status"] = "error"
        session["error"] = f"PDF extraction failed: {exc}"
        return

    session["progress"] = 30

    # Build full-document line pools once so each XML chunk can be matched
    # against relevant lines across the entire PDFs (not fixed page slices).
    all_old_line_chunks: list[tuple[str, int]] = []
    for p, page_text in enumerate(old_pages_text):
        page_no = p + 1
        all_old_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

    all_new_line_chunks: list[tuple[str, int]] = []
    for p, page_text in enumerate(new_pages_text):
        page_no = p + 1
        all_new_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

    # ── Step 2: Process each pre-chunked XML against PDF diffs ───────────────
    # Use each chunk XML as reference so we compare only chunk-relevant lines,
    # not full-page/document text.
    chunk_files = session["chunk_files"]
    total_chunks = len(chunk_files)
    total_old = len(old_pages_text)
    total_new = len(new_pages_text)

    pages_per_chunk = max(1, max(total_old, total_new) // max(total_chunks, 1))

    enriched_chunks: list[dict] = []
    changed_count = 0

    for i, cf in enumerate(chunk_files):
        p_start = i * pages_per_chunk
        p_end = p_start + pages_per_chunk

        xml_path = base / "CHUNKED" / cf["filename"]
        xml_content = ""
        if xml_path.exists():
            try:
                xml_content = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                xml_content = xml_path.read_bytes().decode("utf-8", errors="replace")

        ref_terms, ref_bigrams = _extract_xml_reference_profile(xml_content)

        old_relevant = _filter_line_chunks_by_xml(all_old_line_chunks, ref_terms, ref_bigrams)
        new_relevant = _filter_line_chunks_by_xml(all_new_line_chunks, ref_terms, ref_bigrams)

        old_text = "".join(line for line, _ in old_relevant)
        new_text = "".join(line for line, _ in new_relevant)

        relevant_pages = [pg for _, pg in old_relevant] + [pg for _, pg in new_relevant]
        if relevant_pages:
            page_start_idx = max(0, min(relevant_pages) - 1)
            page_end_idx = max(relevant_pages)
        else:
            page_start_idx = p_start
            page_end_idx = p_end

        change_type = _classify_change(old_text, new_text)
        has_changes = change_type != "unchanged"
        similarity = _compute_similarity(old_text, new_text) if old_text or new_text else 1.0
        if has_changes:
            changed_count += 1

        # Defer expensive operations (diff generation, XML parsing, AI suggestion)
        # until chunk detail/validate/autogenerate is requested.
        diff_lines: list[dict] = []

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
            "diff_lines": diff_lines,
            "xml_content": "",
            "xml_suggested": "",
            "xml_saved": None,
            "xml_size": cf["xml_size"],
            "page_start": page_start_idx,
            "page_end": page_end_idx,
        }

        diff_path = base / "COMPARE" / f"diff_{cf['index']:05d}.json"
        diff_summary = {
            k: v
            for k, v in chunk_data.items()
            if k not in ("old_text", "new_text", "diff_lines")
        }
        diff_path.write_text(
            json.dumps(diff_summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        enriched_chunks.append(chunk_data)
        session["progress"] = 30 + int(65 * (i + 1) / total_chunks)
        await asyncio.sleep(0)

    # ── Step 3: Write summary ─────────────────────────────────────────────────
    summary = {
        "total": total_chunks,
        "changed": changed_count,
        "unchanged": total_chunks - changed_count,
        "old_pages": session["old_pages"],
        "new_pages": session["new_pages"],
        "source_name": session["source_name"],
    }
    (base / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )

    session["chunks"] = enriched_chunks
    session["summary"] = summary
    session["status"] = "done"
    session["progress"] = 100

    logger.info(
        "AutoCompare session %s done: %d chunks, %d changed",
        session_id,
        total_chunks,
        changed_count,
    )


# ── Public helpers ─────────────────────────────────────────────────────────────

def get_session(session_id: str) -> Optional[dict]:
    return _sessions.get(session_id)


def get_chunks_list(session_id: str) -> list[dict]:
    """Return lightweight chunk rows."""
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
        }
        for c in session.get("chunks", [])
    ]


def get_chunk_detail(session_id: str, chunk_id: str) -> Optional[dict]:
    """Return full chunk data including diff_lines."""
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

    # Load XML content lazily from disk.
    if not chunk.get("xml_content"):
        xml_path = base / "CHUNKED" / chunk["filename"]
        if xml_path.exists():
            try:
                chunk["xml_content"] = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                chunk["xml_content"] = xml_path.read_bytes().decode("utf-8", errors="replace")
        chunk["xml_suggested"] = chunk.get("xml_saved") or chunk.get("xml_content", "")

    # Build XML-scoped page text and diff on demand.
    if chunk.get("page_start") is not None:
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
                    page_text = str(old_doc[p].get_text("text"))
                    old_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

                new_line_chunks: list[tuple[str, int]] = []
                for p in range(len(new_doc)):
                    page_no = p + 1
                    page_text = str(new_doc[p].get_text("text"))
                    new_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

                ref_terms, ref_bigrams = _extract_xml_reference_profile(chunk.get("xml_content", ""))
                old_relevant = _filter_line_chunks_by_xml(old_line_chunks, ref_terms, ref_bigrams)
                new_relevant = _filter_line_chunks_by_xml(new_line_chunks, ref_terms, ref_bigrams)

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
                chunk["has_changes"] = chunk["change_type"] != "unchanged"
                chunk["similarity"] = round(
                    _compute_similarity(old_text, new_text) if old_text or new_text else 1.0,
                    3,
                )
                chunk["diff_lines"] = (
                    _generate_diff_lines(
                        old_text,
                        new_text,
                        old_line_pages=[pg for _, pg in old_relevant],
                        new_line_pages=[pg for _, pg in new_relevant],
                    )
                    if chunk.get("has_changes")
                    else []
                )
            except Exception:
                pass

    return chunk


def save_chunk_xml(session_id: str, chunk_id: str, xml_content: str) -> dict:
    """Persist user-edited XML for a chunk. Validates XML before saving."""
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
        src_path = base / "CHUNKED" / chunk["filename"]
        if src_path.exists():
            try:
                chunk["xml_content"] = src_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                chunk["xml_content"] = src_path.read_bytes().decode("utf-8", errors="replace")

    if valid:
        chunk["xml_saved"] = xml_content
        base = Path(session["storage"]["base"])
        out_path = base / "CHUNKED" / chunk["filename"]
        out_path.write_text(xml_content, encoding="utf-8")

    return {"valid": valid, "errors": errors}


def validate_chunk_xml(session_id: str, chunk_id: str) -> dict:
    """
    Validate a chunk's XML and report status:
    - Whether the XML has been updated by the user
    - Whether changes were detected and applied
    - Whether further modifications are required
    """
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
        src_path = base / "CHUNKED" / chunk["filename"]
        if src_path.exists():
            try:
                chunk["xml_content"] = src_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                chunk["xml_content"] = src_path.read_bytes().decode("utf-8", errors="replace")

    xml_content = chunk.get("xml_saved") or chunk.get("xml_content", "")
    original_xml = chunk.get("xml_content", "")

    # XML syntax validation
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
        change_details.append(
            "Changes detected but XML content is still the same as the original."
        )

    if not xml_valid:
        needs_further_changes = True
        change_details.append("XML has syntax errors that need to be fixed.")

    # Determine overall status
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
    """
    Validate all chunks in a session and return aggregated status summary.
    """
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    chunks = session.get("chunks", [])

    results: list[dict] = []
    counts = {
        "updated": 0,
        "no_changes": 0,
        "saved_unchanged": 0,
        "needs_review": 0,
        "pending": 0,
        "invalid_xml": 0,
    }

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

    needs_action = [
        r for r in results
        if (r.get("needs_further_changes") or (not r.get("xml_valid", True)))
    ]

    return {
        "session_id": session_id,
        "total": len(results),
        "summary": counts,
        "needs_action_count": len(needs_action),
        "results": results,
    }


def reupload_xml_files(
    session_id: str,
    xml_files: list[tuple[str, bytes]],
) -> dict:
    """
    Replace the XML chunks in an existing session with newly uploaded files.
    Resets processing state so it can be re-run against the same PDFs.
    """
    session = _sessions.get(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    base = Path(session["storage"]["base"])
    chunked_dir = base / "CHUNKED"

    for f in chunked_dir.iterdir():
        f.unlink()

    chunk_files: list[dict] = []
    for i, (filename, xml_bytes) in enumerate(xml_files, start=1):
        safe_filename = re.sub(r"[^\w.\-]", "_", filename)
        out_path = chunked_dir / safe_filename
        out_path.write_bytes(xml_bytes)

        chunk_files.append({
            "index": i,
            "filename": safe_filename,
            "original_filename": filename,
            "xml_size": len(xml_bytes),
        })

    session["chunk_files"] = chunk_files
    session["xml_file_count"] = len(xml_files)
    session["chunks"] = []
    session["summary"] = None
    session["status"] = "uploaded"
    session["progress"] = 0

    return session


def get_chunk_xml_content(session_id: str, chunk_id: str) -> tuple[str, str]:
    """Return (filename, xml_content) for download."""
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
    """Remove expired sessions from memory and disk."""
    now = time.time()
    to_del = [
        sid for sid, s in _sessions.items() if now - s.get("created_at", 0) > ttl
    ]
    removed = 0
    for sid in to_del:
        session = _sessions.pop(sid, None)
        if session:
            base_path = session.get("storage", {}).get("base")
            if base_path:
                shutil.rmtree(base_path, ignore_errors=True)
            removed += 1
    return removed
