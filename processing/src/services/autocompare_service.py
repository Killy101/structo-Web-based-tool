"""
autocompare_service.py — AutoCompare engine for PDF + XML comparison.

Pipeline
────────
1. Accept OLD PDF, NEW PDF, and one or more XML files (chunked or whole).
2. Extract text from both PDFs page-by-page using PyMuPDF.
3. For each uploaded XML file: locate its matching pages in both PDFs via
   page-anchor scoring, then diff old vs new text for those pages.
4. Per XML file: generate diff lines, produce AI XML update suggestions.
5. Save/download individual XML files.

Users may upload:
  - A single whole XML representing the entire document, or
  - Multiple XMLs (one per section/chapter/chunk).
Either way each uploaded file is treated as one independent unit.

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

# ── Noise-line patterns (false positive filtering) ────────────────────────────

_NOISE_KEYWORDS_RE   = re.compile(r'\b(font|footnote)\b', re.IGNORECASE)
_PAGE_NUMBER_ONLY_RE = re.compile(r'^\s*\d+\s*$')
_NUMBERING_ONLY_RE   = re.compile(
    r'^\s*(\d+\.|[a-z]\)|\([a-z0-9]+\)|[ivxlcdm]+\.)\s*$', re.IGNORECASE
)


def _is_noise_line(text: str) -> bool:
    """Return True for lines that are likely false-positive diff noise."""
    s = text.strip()
    if len(s) < 3:
        return True
    if _PAGE_NUMBER_ONLY_RE.match(s):
        return True
    if _NUMBERING_ONLY_RE.match(s):
        return True
    if _NOISE_KEYWORDS_RE.search(s):
        return True
    return False

# Configurable page-anchor expansion window (pages around top anchor matches).
# Override via env var AUTOCOMPARE_PAGE_WINDOW (default 3).
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
_session_locks: dict[str, asyncio.Lock] = {}  # per-session lock for /start race prevention


def _get_session_lock(session_id: str) -> asyncio.Lock:
    """Return (creating if absent) the asyncio.Lock for a session."""
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
    # If profile is empty let the page-bound fallback in the caller handle it.
    # We never hard-block here; we just signal "no terms to match against".
    if not ref_terms and not ref_bigrams:
        return True  # empty profile → caller falls back to page window

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


def _distributed_sample(text: str, sample_size: int) -> str:
    """Return head + middle + tail sample of text to avoid missing middle-of-document changes."""
    if len(text) <= sample_size:
        return text
    third = sample_size // 3
    mid_start = len(text) // 2 - third // 2
    return text[:third] + text[mid_start: mid_start + third] + text[-third:]


def _classify_change(old_text: str, new_text: str) -> str:
    """Classify change between two text blocks."""
    if not old_text.strip() and new_text.strip():
        return "added"
    if old_text.strip() and not new_text.strip():
        return "removed"

    if old_text == new_text:
        return "unchanged"

    # Fast-path for very large text: use MD5 hash first (exact), then distributed
    # head+middle+tail sampling to avoid missing changes in the middle of long docs.
    if max(len(old_text), len(new_text)) > LARGE_TEXT_THRESHOLD:
        if (hashlib.md5(old_text.encode("utf-8", errors="replace")).hexdigest() ==
                hashlib.md5(new_text.encode("utf-8", errors="replace")).hexdigest()):
            return "unchanged"
        old_sample = _distributed_sample(old_text, LARGE_TEXT_SAMPLE * 3)
        new_sample = _distributed_sample(new_text, LARGE_TEXT_SAMPLE * 3)
        if _normalise(old_sample) == _normalise(new_sample):
            return "unchanged"
        return "modified"

    if _normalise(old_text) == _normalise(new_text):
        return "unchanged"
    return "modified"


def _blocks_are_cosmetic(
    old_block: list[str],
    new_block: list[str],
) -> bool:
    """
    Return True when two diff blocks differ only in line-wrapping (same words,
    different line breaks).  Used to skip spurious "modified" entries that arise
    when a reflowed paragraph is compared at the line level.
    """
    old_words = " ".join(old_block).split()
    new_words = " ".join(new_block).split()
    return old_words == new_words


def _build_diff_groups(diff_lines: list[dict]) -> list[dict]:
    """
    Group diff_lines by category into the DiffGroup structure expected by the
    DiffPanel frontend component.  Provided for backward-compatibility — the
    current flat-timeline DiffPanel ignores groups, but older API consumers or
    other tooling may still rely on this field being present in the chunk payload.
    """
    order = ["addition", "removal", "modification", "mismatch", "emphasis"]
    labels = {
        "addition":     "Additions",
        "removal":      "Removals",
        "modification": "Modifications",
        "mismatch":     "Mismatch",
        "emphasis":     "Emphasis",
    }
    _type_to_cat = {
        "added":    "addition",
        "removed":  "removal",
        "modified": "modification",
    }
    buckets: dict[str, list[dict]] = {k: [] for k in order}
    for line in diff_lines:
        cat = line.get("category") or _type_to_cat.get(line.get("type", ""), "modification")
        if cat not in buckets:
            cat = "modification"
        buckets[cat].append(line)

    return [
        {"category": cat, "label": labels[cat], "lines": buckets[cat]}
        for cat in order
        if buckets[cat]
    ]


def _char_diff_spans(old_line: str, new_line: str) -> tuple[list[dict], list[dict]]:
    """
    Return (old_spans, new_spans) where each span is {"text": str, "changed": bool}.
    Used for inline char-level highlighting in the Diff Panel.
    """
    import difflib
    sm = difflib.SequenceMatcher(None, old_line, new_line, autojunk=False)
    old_spans: list[dict] = []
    new_spans: list[dict] = []
    for opcode, i1, i2, j1, j2 in sm.get_opcodes():
        if opcode == "equal":
            old_spans.append({"text": old_line[i1:i2], "changed": False})
            new_spans.append({"text": new_line[j1:j2], "changed": False})
        elif opcode == "replace":
            old_spans.append({"text": old_line[i1:i2], "changed": True})
            new_spans.append({"text": new_line[j1:j2], "changed": True})
        elif opcode == "delete":
            old_spans.append({"text": old_line[i1:i2], "changed": True})
        elif opcode == "insert":
            new_spans.append({"text": new_line[j1:j2], "changed": True})
    return old_spans, new_spans


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
            "old_text": old_text,
            "new_text": new_text,
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

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue
        elif opcode == "delete":
            for offset, line in enumerate(old_lines[i1:i2]):
                stripped = line.rstrip("\n")
                if _is_noise_line(stripped):
                    continue
                old_page = old_pages[i1 + offset] if old_pages else None
                if _append(
                    "removed", line,
                    old_page=old_page, new_page=None,
                    old_text=stripped, new_text="",
                    old_spans=[{"text": stripped, "changed": True}],
                    new_spans=[],
                ):
                    return result
        elif opcode == "insert":
            for offset, line in enumerate(new_lines[j1:j2]):
                stripped = line.rstrip("\n")
                if _is_noise_line(stripped):
                    continue
                new_page = new_pages[j1 + offset] if new_pages else None
                if _append(
                    "added", line,
                    old_page=None, new_page=new_page,
                    old_text="", new_text=stripped,
                    old_spans=[],
                    new_spans=[{"text": stripped, "changed": True}],
                ):
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
                    # Skip if normalised text is identical (whitespace-only diff)
                    if _normalise(old_ln) == _normalise(new_ln):
                        continue
                    # Skip if both sides are noise
                    if _is_noise_line(old_ln) and _is_noise_line(new_ln):
                        continue
                    old_spans, new_spans = _char_diff_spans(old_ln, new_ln)
                    # Skip if no span is actually marked changed (false positive)
                    if not any(s["changed"] for s in old_spans) and \
                       not any(s["changed"] for s in new_spans):
                        continue
                    if _append(
                        "modified",
                        f"{old_ln} -> {new_ln}",
                        old_page=old_page,
                        new_page=new_page,
                        old_text=old_ln,
                        new_text=new_ln,
                        old_spans=old_spans,
                        new_spans=new_spans,
                    ):
                        return result
                elif old_ln:
                    if not _is_noise_line(old_ln):
                        if _append(
                            "removed", old_ln,
                            old_page=old_page, new_page=None,
                            old_text=old_ln, new_text="",
                            old_spans=[{"text": old_ln, "changed": True}],
                            new_spans=[],
                        ):
                            return result
                elif new_ln:
                    if not _is_noise_line(new_ln):
                        if _append(
                            "added", new_ln,
                            old_page=None, new_page=new_page,
                            old_text="", new_text=new_ln,
                            old_spans=[],
                            new_spans=[{"text": new_ln, "changed": True}],
                        ):
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
    """
    Initialise a session. Saves files to disk.
    xml_files is a list of (filename, content_bytes) for each uploaded XML file.
    """
    session_id = str(uuid.uuid4())
    dirs = _ensure_dirs(session_id)

    # Persist uploaded PDFs
    (dirs["original"] / "old.pdf").write_bytes(old_pdf_bytes)
    (dirs["original"] / "new.pdf").write_bytes(new_pdf_bytes)

    old_pages = _count_pdf_pages(old_pdf_bytes)
    new_pages = _count_pdf_pages(new_pdf_bytes)

    # Persist each uploaded XML file. Keep only metadata in memory;
    # XML content is loaded lazily when a file is opened for review.
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
    Background coroutine: extract text from both PDFs, compare against
    each uploaded XML file, build diff data.
    Each uploaded XML (chunked or whole) is treated as one independent unit.
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
        extraction_total_batches = max(1, old_batches_total + new_batches_total)
        extraction_done_batches = 0

        old_pages_text: list[str] = []
        for _, batch, _ in _stream_pdf_pages(old_pdf_bytes, batch_size):
            old_pages_text.extend(batch)
            extraction_done_batches += 1
            session["progress"] = min(29, int((extraction_done_batches / extraction_total_batches) * 30))
            await asyncio.sleep(0)

        new_pages_text: list[str] = []
        for _, batch, _ in _stream_pdf_pages(new_pdf_bytes, batch_size):
            new_pages_text.extend(batch)
            extraction_done_batches += 1
            session["progress"] = min(29, int((extraction_done_batches / extraction_total_batches) * 30))
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

    # ── Step 2: Process each XML file against the PDF diff ───────────────────
    # Page-anchor scoring locates which pages of each PDF correspond to each
    # XML file, regardless of whether the XML covers one section or the whole doc.
    xml_file_list = session["xml_file_list"]
    total_chunks = len(xml_file_list)

    enriched_chunks: list[dict] = []
    changed_count = 0

    for i, cf in enumerate(xml_file_list):
        p_start = 0   # page-anchor replaces fixed window; kept for fallback only
        p_end = len(old_pages_text)

        xml_path = base / "XML" / cf["filename"]
        xml_content = ""
        if xml_path.exists():
            try:
                xml_content = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                xml_content = xml_path.read_bytes().decode("utf-8", errors="replace")

        ref_terms, ref_bigrams = _extract_xml_reference_profile(xml_content)

        # ── Page-anchor step: find which PDF pages best match the XML content ──
        # This prevents generic terms from pulling in lines from the whole document.
        old_page_scores: dict[int, float] = {}
        for ln, pg in all_old_line_chunks:
            if _is_line_relevant_to_xml(ln, ref_terms, ref_bigrams):
                old_page_scores[pg] = old_page_scores.get(pg, 0) + 1

        # Pick the top-scoring pages (up to 10) as the anchor window.
        # Window size is configurable via AUTOCOMPARE_PAGE_WINDOW env var.
        if old_page_scores:
            top_old_pages = sorted(old_page_scores, key=lambda p: -old_page_scores[p])[:10]
            anchor_min = min(top_old_pages)
            anchor_max = max(top_old_pages)
            page_start_idx = max(0, anchor_min - PAGE_WINDOW)
            page_end_idx = anchor_max + PAGE_WINDOW
        else:
            page_start_idx = p_start
            page_end_idx = min(p_end, p_start + 10)

        # Restrict both PDFs to the anchored window
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
            # Unchanged chunks are pre-flagged so the frontend can mark them
            # "reviewed" automatically without requiring a user click.
            "auto_reviewed": not has_changes,
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

def _reconstruct_session_from_disk(session_id: str) -> Optional[dict]:
    """
    Rebuild a session dict from on-disk artefacts after a server restart.
    Returns the session (also stored in _sessions) or None if irreparable.
    """
    session_dir = _session_dir(session_id)
    if not session_dir.exists():
        return None

    original_dir = session_dir / "ORIGINAL"
    xml_dir      = session_dir / "XML"
    compare_dir  = session_dir / "COMPARE"
    summary_path = session_dir / "summary.json"

    if not original_dir.exists():
        return None

    # Load summary (present only when processing completed)
    summary: Optional[dict] = None
    status = "uploaded"
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            status  = "done"
        except Exception:
            pass

    # Page counts from stored PDFs
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

    # XML file list from disk
    xml_file_list: list[dict] = []
    if xml_dir.exists():
        for i, xp in enumerate(sorted(xml_dir.glob("*.xml")), start=1):
            xml_file_list.append({
                "index": i,
                "filename": xp.name,
                "original_filename": xp.name,
                "xml_size": xp.stat().st_size,
            })

    # Chunks from diff JSON files
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
        "session_id":    session_id,
        "source_name":   source_name,
        "status":        status,
        "progress":      100 if status == "done" else 0,
        "error":         None,
        "old_pages":     (summary or {}).get("old_pages", old_pages),
        "new_pages":     (summary or {}).get("new_pages", new_pages),
        "xml_file_count": len(xml_file_list),
        "chunks":        chunks,
        "xml_file_list": xml_file_list,
        "summary":       summary,
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
    logger.info(
        "Reconstructed session %s from disk — status=%s chunks=%d",
        session_id, status, len(chunks),
    )
    return session


def get_session(session_id: str) -> Optional[dict]:
    """Return session from memory; reconstruct from disk on cache miss."""
    session = _sessions.get(session_id)
    if session is not None:
        return session
    return _reconstruct_session_from_disk(session_id)


def get_chunks_list(session_id: str) -> list[dict]:
    """Return lightweight XML file rows."""
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
    """Return full XML file data including diff_lines."""
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

    # Load XML content lazily from disk when a file is opened for review.
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

    # Build page-scoped text and diff on demand using page-anchor scoring.
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
                    page_text = str(old_doc[p].get_text("text"))
                    old_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

                new_line_chunks: list[tuple[str, int]] = []
                for p in range(len(new_doc)):
                    page_no = p + 1
                    page_text = str(new_doc[p].get_text("text"))
                    new_line_chunks.extend((ln, page_no) for ln in page_text.splitlines(keepends=True))

                ref_terms, ref_bigrams = _extract_xml_reference_profile(chunk.get("xml_content", ""))

                # Page-anchor: score all pages by XML term overlap, take the top window
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

                # Persist resolved texts so re-opening doesn't re-read PDFs
                try:
                    cache_path = base / "COMPARE" / f"text_{chunk['index']:05d}.json"
                    import json as _json
                    cache_path.write_text(
                        _json.dumps(
                            {"old_text": old_text, "new_text": new_text,
                             "page_start": chunk["page_start"], "page_end": chunk["page_end"]},
                            ensure_ascii=False,
                        ),
                        encoding="utf-8",
                    )
                except Exception:
                    pass
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
        src_path = base / "XML" / chunk["filename"]
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
        _session_locks.pop(sid, None)
        if session:
            base_path = session.get("storage", {}).get("base")
            if base_path:
                shutil.rmtree(base_path, ignore_errors=True)
            removed += 1

    # Also purge orphaned disk sessions (session_dir exists but not in memory)
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
    """
    Build a JSON-serialisable status report for all chunks in a session.
    Returns a dict with session metadata and a per-chunk rows list.
    Suitable for download as JSON or conversion to CSV on the client.
    """
    session = get_session(session_id)
    if not session:
        raise KeyError(f"Session {session_id} not found")

    rows: list[dict] = []
    for chunk in session.get("chunks", []):
        xml_saved   = chunk.get("xml_saved")
        xml_content = chunk.get("xml_content", "")
        if not xml_content:
            # Load lazily for report
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
        "session_id":  session_id,
        "source_name": session.get("source_name", ""),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary":     session.get("summary", {}),
        "chunks":      rows,
    }