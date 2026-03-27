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

# ── Performance knobs (all env-overridable) ────────────────────────────────────
# Hard limit on diff lines stored/returned — prevents giant JSON payloads.
MAX_DIFF_LINES: int = int(os.getenv("AUTOCOMPARE_MAX_DIFF_LINES", "200"))

# Hard cap on text fed into SequenceMatcher — the single biggest CPU bottleneck.
# 50 000 chars ≈ 6-7 dense legal pages; enough for all real changes.
MAX_DIFF_INPUT: int = int(os.getenv("AUTOCOMPARE_MAX_DIFF_INPUT", "50000"))

# Number of diff_lines returned per paginated page.
DIFF_PAGE_SIZE: int = int(os.getenv("AUTOCOMPARE_DIFF_PAGE_SIZE", "30"))

# Jaccard similarity above which we skip the expensive line-level diff entirely.
SIMILARITY_SKIP_THRESHOLD: float = float(
    os.getenv("AUTOCOMPARE_SIMILARITY_SKIP", "0.95")
)

# Char-level span diff cap — strings longer than this fall back to whole-string.
MAX_CHAR_DIFF: int = int(os.getenv("AUTOCOMPARE_MAX_CHAR_DIFF", "2000"))

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


def _is_noise_line(line: str) -> bool:
    """
    Return True for lines that are very likely cosmetic/page furniture.

    These lines generate noisy add/remove diffs during PDF reflow but carry
    little semantic value for contract/content comparison.
    """
    if not line:
        return True
    s = line.strip()
    if not s:
        return True
    # Ignore standalone page markers and mostly punctuation separators.
    if re.fullmatch(r"(?:page\s+)?\d+(?:\s*/\s*\d+)?", s, flags=re.IGNORECASE):
        return True
    if re.fullmatch(r"[-_=~.\s]{3,}", s):
        return True
    return False


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


def _score_page_against_vocab(
    page_text: str, ref_terms: set[str], ref_bigrams: set[str]
) -> float:
    """
    Score a full PDF page against the XML vocabulary.
    Returns a float — higher = more relevant.  Used for page-anchor only.
    """
    if not ref_terms and not ref_bigrams:
        return 0.0
    norm = _normalise(page_text)
    words = [
        w for w in re.findall(r"[a-z0-9][a-z0-9'\-/]{2,}", norm)
        if w not in STOPWORDS and not w.isdigit() and len(w) >= 4
    ]
    if not words:
        return 0.0
    term_hits = sum(1 for w in words if w in ref_terms)
    if ref_bigrams:
        word_pairs = {f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)}
        bigram_hits = sum(1 for bg in word_pairs if bg in ref_bigrams)
        return term_hits + bigram_hits * 3.0   # bigrams weighted higher
    return float(term_hits)


def _find_best_page_window(
    pages_text: list[str],
    ref_terms: set[str],
    ref_bigrams: set[str],
    window: int = PAGE_WINDOW,
) -> tuple[int, int]:
    """
    Score every page and return (page_start_0based_exclusive, page_end_inclusive)
    for the highest-scoring cluster of pages.
    Returns (0, min(10, total)) when no pages score above zero.
    """
    scores = [
        _score_page_against_vocab(pt, ref_terms, ref_bigrams)
        for pt in pages_text
    ]
    total = len(scores)
    if not any(s > 0 for s in scores):
        return 0, min(10, total)

    # Find the page with the highest score, then grow a window around it
    peak = max(range(total), key=lambda i: scores[i])
    lo = max(0, peak - window)
    hi = min(total - 1, peak + window)

    # Expand window while neighbouring pages still score significantly
    threshold = scores[peak] * 0.15
    while lo > 0 and scores[lo - 1] >= threshold:
        lo -= 1
    while hi < total - 1 and scores[hi + 1] >= threshold:
        hi += 1

    # page numbers are 1-based in our line-chunk tuples
    return lo, hi + 1   # (exclusive-start, inclusive-end) in 1-based page space


def _anchor_new_pdf(
    old_text: str,
    new_pages_text: list[str],
    old_anchor: tuple[int, int],
    window: int = PAGE_WINDOW + 2,
) -> tuple[int, int]:
    """
    Find the best matching page window in the NEW PDF for a given old text block.
    Scores each new-PDF page by similarity to the old text, then returns a window
    around the best-scoring page.

    Falls back to the old anchor range (±2 pages) when no new page scores well.
    """
    if not old_text.strip() or not new_pages_text:
        lo, hi = old_anchor
        return max(0, lo - 2), min(len(new_pages_text), hi + 2)

    old_norm = _normalise(old_text)
    old_words = set(old_norm.split())

    best_idx, best_score = -1, 0.0
    for i, pt in enumerate(new_pages_text):
        if not pt.strip():
            continue
        new_norm = _normalise(pt)
        new_words = set(new_norm.split())
        overlap = len(old_words & new_words) / max(len(old_words), 1)
        if overlap > best_score:
            best_score = overlap
            best_idx = i

    FALLBACK_THRESHOLD = 0.10
    if best_score < FALLBACK_THRESHOLD or best_idx < 0:
        lo, hi = old_anchor
        return max(0, lo - 2), min(len(new_pages_text), hi + 2)

    lo = max(0, best_idx - window)
    hi = min(len(new_pages_text) - 1, best_idx + window)
    return lo, hi + 1   # (exclusive-start, inclusive-end) in 1-based page space


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


def _char_diff_spans(
    old_line: str,
    new_line: str,
    *,
    enabled: bool = False,           # OPT-5: disabled by default — major perf win
) -> tuple[list[dict], list[dict]]:
    """
    Return (old_spans, new_spans) for inline char-level highlighting.

    Disabled by default (enabled=False) because SequenceMatcher on long legal
    sentences is O(n²) and is the single biggest source of UI freezes.
    When disabled, the whole strings are returned as single changed spans.
    Hard-capped at MAX_CHAR_DIFF chars even when enabled.
    """
    if not enabled or len(old_line) > MAX_CHAR_DIFF or len(new_line) > MAX_CHAR_DIFF:
        # Fast path: mark whole strings as changed — still shows OLD/NEW content.
        return (
            [{"text": old_line, "changed": True}],
            [{"text": new_line, "changed": True}],
        )

    # Enabled, within cap — run the proper char-level diff.
    sm = difflib.SequenceMatcher(None, old_line, new_line, autojunk=True)
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
    *,
    include_spans: bool = False,          # OPT-5: spans off by default
    max_lines: int = MAX_DIFF_LINES,      # OPT-1: caller can tighten further
) -> list[dict]:
    """
    Line-level diff between OLD PDF text (left) and NEW PDF text (right).

    include_spans  — when True, compute char-level old_spans/new_spans on
                     modified lines (expensive; disabled by default).
    max_lines      — hard ceiling on returned diff_lines count.
    """
    old_lines = old_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    result: list[dict] = []
    line_num = 0

    old_pages = old_line_pages if old_line_pages and len(old_line_pages) == len(old_lines) else []
    new_pages = new_line_pages if new_line_pages and len(new_line_pages) == len(new_lines) else []

    _INNOD_RE = re.compile(
        r"</?(?:innod:|Change|Revision|Para|Clause|Section|Article|Schedule|Annex|Table|Row|Cell)\b",
        re.IGNORECASE,
    )

    def _derive_category(kind: str) -> str:
        """Return the same value as `kind` — category IS the type."""
        return kind  # "added" | "removed" | "modified"

    def _derive_sub_type(old_t: str, new_t: str, combined: str) -> str:
        """Derive XML operation sub-type."""
        if _INNOD_RE.search(combined):
            return "innodreplace"
        delta = abs(len(old_t) - len(new_t))
        return "edit" if delta <= 60 else "textual"

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
        old_t   = (old_text_val or "").strip()
        new_t   = (new_text_val or "").strip()
        combined = old_t + new_t + text
        entry: dict = {
            "type":     kind,
            "category": _derive_category(kind),
            "sub_type": _derive_sub_type(old_t, new_t, combined),
            "text":     text.rstrip("\n"),
            "line":     line_num,
            "old_page": old_page,
            "new_page": new_page,
            "old_text": old_text_val,
            "new_text": new_text_val,
        }
        # OPT-1/5: only attach spans when explicitly requested
        if include_spans:
            if old_spans is not None:
                entry["old_spans"] = old_spans
            if new_spans is not None:
                entry["new_spans"] = new_spans
        result.append(entry)
        line_num += 1
        if len(result) >= max_lines:
            result.append({
                "type":     "modified",
                "category": "modified",
                "sub_type": "textual",
                "text":     f"... diff truncated at {max_lines} lines for performance ...",
                "line":     line_num,
                "old_page": None,
                "new_page": None,
                "old_text": None,
                "new_text": None,
            })
            return True
        return False

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue

        elif opcode == "delete":
            for offset, line in enumerate(old_lines[i1:i2]):
                stripped = line.rstrip("\n")
                if _is_noise_line(stripped):
                    continue
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
                stripped = line.rstrip("\n")
                if _is_noise_line(stripped):
                    continue
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
            # Skip blocks that differ only in line-wrap (same words, different breaks).
            if _blocks_are_cosmetic(old_block, new_block):
                continue

            # ── Sentence-level diff within the block ──────────────────────
            # Instead of pairing lines positionally (which creates spurious
            # "modified" entries when block sizes differ), join each side into
            # a single string and re-diff at sentence/phrase level.
            old_joined = " ".join(ln for ln in old_block if ln.strip())
            new_joined = " ".join(ln for ln in new_block if ln.strip())

            if not old_joined and not new_joined:
                continue

            old_page_blk = old_pages[i1] if old_pages and i1 < len(old_pages) else None
            new_page_blk = new_pages[j1] if new_pages and j1 < len(new_pages) else None

            if not old_joined:
                if _append("added", new_joined,
                           old_page=None, new_page=new_page_blk,
                           old_text_val="", new_text_val=new_joined):
                    return result
            elif not new_joined:
                if _append("removed", old_joined,
                           old_page=old_page_blk, new_page=None,
                           old_text_val=old_joined, new_text_val=""):
                    return result
            else:
                # Split each joined block into sentences/clauses for finer diff
                def _split_sentences(text: str) -> list[str]:
                    # Split on sentence-ending punctuation, semicolons, or \n
                    parts = re.split(r"(?<=[.;!?])\s+|\n", text)
                    return [p.strip() for p in parts if p.strip()]

                old_sents = _split_sentences(old_joined)
                new_sents = _split_sentences(new_joined)

                if not old_sents:
                    old_sents = [old_joined]
                if not new_sents:
                    new_sents = [new_joined]

                sent_matcher = difflib.SequenceMatcher(None, old_sents, new_sents, autojunk=True)
                for s_op, si1, si2, sj1, sj2 in sent_matcher.get_opcodes():
                    if s_op == "equal":
                        continue

                    s_old_block = old_sents[si1:si2]
                    s_new_block = new_sents[sj1:sj2]

                    # Skip cosmetic sentence-level differences too
                    if _blocks_are_cosmetic(s_old_block, s_new_block):
                        continue

                    s_old = " ".join(s_old_block)
                    s_new = " ".join(s_new_block)

                    # Page approximation: interpolate within the block range
                    s_old_page = old_page_blk
                    s_new_page = new_page_blk
                    if old_pages and i2 > i1:
                        frac = si1 / max(len(old_sents), 1)
                        idx  = i1 + int(frac * (i2 - i1))
                        s_old_page = old_pages[min(idx, len(old_pages) - 1)]
                    if new_pages and j2 > j1:
                        frac = sj1 / max(len(new_sents), 1)
                        idx  = j1 + int(frac * (j2 - j1))
                        s_new_page = new_pages[min(idx, len(new_pages) - 1)]

                    if s_op == "delete":
                        if _append("removed", s_old,
                                   old_page=s_old_page, new_page=None,
                                   old_text_val=s_old, new_text_val=""):
                            return result
                    elif s_op == "insert":
                        if _append("added", s_new,
                                   old_page=None, new_page=s_new_page,
                                   old_text_val="", new_text_val=s_new):
                            return result
                    else:  # replace
                        old_spans, new_spans = _char_diff_spans(
                            s_old, s_new, enabled=include_spans
                        )
                        if _append(
                            "modified",
                            f"{s_old} -> {s_new}",
                            old_page=s_old_page,
                            new_page=s_new_page,
                            old_text_val=s_old,
                            new_text_val=s_new,
                            old_spans=old_spans,
                            new_spans=new_spans,
                        ):
                            return result

                    if len(result) >= MAX_DIFF_LINES:
                        return result

    return result



# ── Build grouped diff structure ──────────────────────────────────────────────

_CATEGORY_ORDER = ["added", "removed", "modified", "mismatch"]
_CATEGORY_LABELS = {
    "added":    "Additions",
    "removed":  "Removals",
    "modified": "Modifications",
    "mismatch": "Mismatch",
}


def _build_diff_groups(diff_lines: list[dict]) -> list[dict]:
    """
    Group diff_lines by category into the DiffGroup structure expected by
    the DiffPanel frontend component.
    """
    buckets: dict[str, list[dict]] = {c: [] for c in _CATEGORY_ORDER}
    for line in diff_lines:
        cat = line.get("category", "modified")
        if cat == "emphasis":
            continue
        # Normalize legacy category names
        if cat == "addition":     cat = "added"
        elif cat == "removal":    cat = "removed"
        elif cat == "modification": cat = "modified"
        if cat not in buckets:
            cat = "modified"
        buckets[cat].append(line)

    return [
        {"category": cat, "label": _CATEGORY_LABELS[cat], "lines": buckets[cat]}
        for cat in _CATEGORY_ORDER
        if buckets[cat]
    ]


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
        "phase": "upload_files",
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
    session["phase"] = "extracting_pdf"
    session["progress"] = 0

    base = Path(session["storage"]["base"])

    try:
        old_pdf_bytes = (base / "ORIGINAL" / "old.pdf").read_bytes()
        new_pdf_bytes = (base / "ORIGINAL" / "new.pdf").read_bytes()
    except Exception as exc:
        session["status"] = "error"
        session["error"] = f"Could not read uploaded files: {exc}"
        return

    # ── Step 1: Extract text from both PDFs (run in thread — CPU-bound) ────────
    def _extract_all_pages(pdf_bytes: bytes) -> list[str]:
        pages: list[str] = []
        for _, batch, _ in _stream_pdf_pages(pdf_bytes, batch_size):
            pages.extend(batch)
        return pages

    try:
        loop = asyncio.get_event_loop()
        session["progress"] = 5
        old_pages_text, new_pages_text = await asyncio.gather(
            loop.run_in_executor(None, _extract_all_pages, old_pdf_bytes),
            loop.run_in_executor(None, _extract_all_pages, new_pdf_bytes),
        )
        session["progress"] = 28
        await asyncio.sleep(0)
    except Exception as exc:
        session["status"] = "error"
        session["error"] = f"PDF extraction failed: {exc}"
        return

    session["phase"] = "parsing_xml"
    session["progress"] = 30

    # ── Pre-compute page word-sets once (reused across all chunks) ──────────
    # Normalising + tokenising every page for every chunk is O(pages × chunks).
    # Computing once and caching as frozensets gives O(pages + chunks × window).
    def _page_wordset(text: str) -> frozenset[str]:
        return frozenset(_normalise(text).split())

    old_page_wordsets: list[frozenset[str]] = [_page_wordset(pt) for pt in old_pages_text]
    new_page_wordsets: list[frozenset[str]] = [_page_wordset(pt) for pt in new_pages_text]

    # Pre-tokenise pages for vocab scoring (strip stopwords once)
    def _page_tokens(text: str) -> list[str]:
        norm = _normalise(text)
        return [
            w for w in re.findall(r"[a-z0-9][a-z0-9'\-/]{2,}", norm)
            if w not in STOPWORDS and not w.isdigit() and len(w) >= 4
        ]

    old_page_tokens: list[list[str]] = [_page_tokens(pt) for pt in old_pages_text]

    # ── Step 2: Process each XML file ────────────────────────────────────────
    xml_file_list = session["xml_file_list"]
    total_chunks = len(xml_file_list)
    enriched_chunks: list[dict] = []
    changed_count = 0

    session["phase"] = "comparing_chunks"

    for i, cf in enumerate(xml_file_list):
        xml_path = base / "XML" / cf["filename"]
        xml_content = ""
        if xml_path.exists():
            try:
                xml_content = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                xml_content = xml_path.read_bytes().decode("utf-8", errors="replace")

        # ── Page-anchor (fast): uses pre-tokenised pages ────────────────────────
        ref_terms, ref_bigrams = _extract_xml_reference_profile(xml_content)

        # Score only old-PDF pages using pre-computed token lists
        old_scores: list[float] = []
        for tokens in old_page_tokens:
            if not tokens:
                old_scores.append(0.0)
                continue
            hits = sum(1 for w in tokens if w in ref_terms)
            if ref_bigrams:
                pairs = {f"{tokens[j]} {tokens[j+1]}" for j in range(len(tokens) - 1)}
                hits += sum(1 for bg in pairs if bg in ref_bigrams) * 3.0
            old_scores.append(float(hits))

        if any(s > 0 for s in old_scores):
            peak = max(range(len(old_scores)), key=lambda j: old_scores[j])
            threshold = old_scores[peak] * 0.15
            old_lo = peak
            old_hi = peak
            while old_lo > 0 and old_scores[old_lo - 1] >= threshold:
                old_lo -= 1
            while old_hi < len(old_scores) - 1 and old_scores[old_hi + 1] >= threshold:
                old_hi += 1
            old_lo = max(0, old_lo - PAGE_WINDOW)
            old_hi = min(len(old_pages_text) - 1, old_hi + PAGE_WINDOW)
        else:
            old_lo, old_hi = 0, min(9, len(old_pages_text) - 1)

        # Extract full page text for the old window
        old_text = "".join(old_pages_text[p] for p in range(old_lo, old_hi + 1))

        # Anchor new PDF: use pre-computed wordsets, search only near old_lo..old_hi
        old_words = old_page_wordsets[old_lo] if old_lo < len(old_page_wordsets) else frozenset()
        for p in range(old_lo, old_hi + 1):
            if p < len(old_page_wordsets):
                old_words = old_words | old_page_wordsets[p]

        # Search new PDF in a generous band around the old anchor
        search_lo = max(0, old_lo - PAGE_WINDOW - 2)
        search_hi = min(len(new_pages_text) - 1, old_hi + PAGE_WINDOW + 2)
        best_new_idx, best_new_score = old_lo, 0.0   # fallback = same index
        for p in range(search_lo, search_hi + 1):
            if p >= len(new_page_wordsets):
                break
            nw = new_page_wordsets[p]
            if not nw:
                continue
            score = len(old_words & nw) / max(len(old_words), 1)
            if score > best_new_score:
                best_new_score = score
                best_new_idx = p

        if best_new_score < 0.05:
            # Very low overlap — fall back to same page range ± 2
            new_lo = max(0, old_lo - 2)
            new_hi = min(len(new_pages_text) - 1, old_hi + 2)
        else:
            new_lo = max(0, best_new_idx - PAGE_WINDOW)
            new_hi = min(len(new_pages_text) - 1, best_new_idx + PAGE_WINDOW)

        new_text = "".join(new_pages_text[p] for p in range(new_lo, new_hi + 1))

        # Store page bounds for the UI
        page_start_idx = old_lo
        page_end_idx   = old_hi + 1   # 1-based exclusive upper bound

        # line-page mappings for diff
        old_relevant_pairs: list[tuple[str, int]] = []
        for p in range(old_lo, old_hi + 1):
            pg_no = p + 1
            for ln in old_pages_text[p].splitlines(keepends=True):
                old_relevant_pairs.append((ln, pg_no))

        new_relevant_pairs: list[tuple[str, int]] = []
        for p in range(new_lo, new_hi + 1):
            pg_no = p + 1
            for ln in new_pages_text[p].splitlines(keepends=True):
                new_relevant_pairs.append((ln, pg_no))

        # Classify using normalised comparison (ignores line-wrap noise)
        change_type = _classify_change(old_text, new_text)
        has_changes = change_type != "unchanged"

        # Fast similarity via wordset intersection (avoids O(n²) SequenceMatcher)
        if old_text or new_text:
            old_ws = frozenset(_normalise(old_text).split())
            new_ws = frozenset(_normalise(new_text).split())
            denom  = max(len(old_ws | new_ws), 1)
            similarity = len(old_ws & new_ws) / denom   # Jaccard similarity
        else:
            similarity = 1.0
        # F: skip expensive diff when content is nearly identical (>= 95% similar)
        if has_changes and similarity >= 0.95:
            has_changes = False
            change_type = "unchanged"
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

        # ── Generate diff lines ───────────────────────────────────────────────
        diff_lines: list[dict] = []
        diff_groups: list[dict] = []

        # Yield to the event loop BEFORE the CPU-heavy diff (OPT-6)
        await asyncio.sleep(0)

        if has_changes:
            # OPT-4: hard cap input to prevent O(n²) SequenceMatcher blowup
            _old_diff = old_text[:MAX_DIFF_INPUT]
            _new_diff = new_text[:MAX_DIFF_INPUT]
            _old_lp   = [pg for _, pg in old_relevant_pairs]
            _new_lp   = [pg for _, pg in new_relevant_pairs]

            # OPT-6: run diff in thread pool — CPU-bound, never blocks event loop
            diff_lines = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: _generate_diff_lines(
                    _old_diff, _new_diff,
                    _old_lp, _new_lp,
                    include_spans=False,        # OPT-5: spans off at processing time
                    max_lines=MAX_DIFF_LINES,   # OPT-1: strict ceiling
                ),
            )
            diff_groups = _build_diff_groups(diff_lines)

        chunk_data["diff_lines"]  = diff_lines
        chunk_data["diff_groups"] = diff_groups
        # Always expose extracted text so the UI can render side-by-side text
        # even for "unchanged" chunks.
        chunk_data["old_text"] = old_text
        chunk_data["new_text"] = new_text

        # ── Inline XML validation ─────────────────────────────────────────────
        xml_valid        = True
        xml_errors: list[str] = []
        if xml_content.strip():
            try:
                etree.fromstring(xml_content.encode("utf-8"))
            except etree.XMLSyntaxError as exc:
                xml_valid  = False
                xml_errors = [str(exc)]

        # Determine the validation status for this chunk at processing time
        if not xml_valid:
            validation_status = "invalid_xml"
            validation_message = f"XML has syntax errors: {xml_errors[0]}" if xml_errors else "Invalid XML"
        elif not has_changes:
            validation_status = "no_changes"
            validation_message = "No changes detected between Old and New PDFs for this chunk."
        else:
            validation_status = "needs_update"
            validation_message = f"{len(diff_lines)} change(s) detected — XML needs to be updated."

        chunk_data["xml_valid"]          = xml_valid
        chunk_data["xml_errors"]         = xml_errors
        chunk_data["validation_status"]  = validation_status
        chunk_data["validation_message"] = validation_message

        # Expose per-chunk validation result in session for live status polling
        session.setdefault("chunk_validations", {})[str(cf["index"])] = {
            "index":              cf["index"],
            "label":              label,
            "filename":           cf["filename"],
            "has_changes":        has_changes,
            "change_type":        change_type,
            "similarity":         round(similarity, 3),
            "xml_valid":          xml_valid,
            "xml_errors":         xml_errors,
            "validation_status":  validation_status,
            "validation_message": validation_message,
            "diff_count":         len(diff_lines) if has_changes else 0,
        }

        # OPT-8: build the full on-disk record (contains all large fields)
        disk_record = dict(chunk_data)
        disk_record["diff_lines"]  = diff_lines
        disk_record["diff_groups"] = diff_groups
        disk_record["old_text"]    = old_text
        disk_record["new_text"]    = new_text
        disk_record["xml_content"] = xml_content   # full XML stored only on disk

        # Yield to the event loop before disk write (OPT-6)
        await asyncio.sleep(0)

        # Write full record to disk in a thread (OPT-6)
        diff_path = base / "COMPARE" / f"diff_{cf['index']:05d}.json"
        _json_bytes = json.dumps(disk_record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        await asyncio.get_event_loop().run_in_executor(
            None, diff_path.write_bytes, _json_bytes
        )

        # OPT-8: clear large blobs from in-memory chunk — only keep lightweight metadata.
        # All heavy fields are loaded on demand from disk by get_chunk_detail().
        chunk_data["old_text"]    = ""
        chunk_data["new_text"]    = ""
        chunk_data["diff_lines"]  = []
        chunk_data["diff_groups"] = []
        # xml_content was never put in chunk_data — nothing to clear.

        enriched_chunks.append(chunk_data)
        # Progress: 30-85% for comparing, 85-95% for building index / validating
        session["progress"] = 30 + int(55 * (i + 1) / total_chunks)
        await asyncio.sleep(0)

    # ── Phase 3: Validation summary ───────────────────────────────────────────
    session["phase"]    = "validating_xml"
    session["progress"] = 86

    invalid_count    = sum(1 for c in enriched_chunks if not c.get("xml_valid", True))
    needs_update_count = sum(1 for c in enriched_chunks if c.get("validation_status") == "needs_update")
    no_changes_count   = sum(1 for c in enriched_chunks if c.get("validation_status") == "no_changes")

    await asyncio.sleep(0)

    session["phase"]    = "building_index"
    session["progress"] = 96

    summary = {
        "total":            total_chunks,
        "changed":          changed_count,
        "unchanged":        total_chunks - changed_count,
        "needs_update":     needs_update_count,
        "no_changes":       no_changes_count,
        "invalid_xml":      invalid_count,
        "old_pages":        session["old_pages"],
        "new_pages":        session["new_pages"],
        "source_name":      session["source_name"],
    }
    (base / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    session["chunks"]   = enriched_chunks
    session["summary"]  = summary
    session["status"]   = "done"
    session["phase"]    = "done"
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

    # OPT-8: load only lightweight metadata from each diff file — NOT the heavy
    # old_text/new_text/diff_lines/xml_content blobs. Those are loaded on demand
    # by get_chunk_detail(). This prevents the server from consuming GBs of RAM
    # just from reconstructing a session with many large chunks.
    _METADATA_KEYS = {
        "index", "label", "filename", "original_filename",
        "has_changes", "change_type", "similarity", "xml_size",
        "page_start", "page_end", "auto_reviewed",
        "xml_valid", "xml_errors", "validation_status", "validation_message",
        "xml_saved",
    }
    chunks: list[dict] = []
    if compare_dir.exists() and status == "done":
        for diff_path in sorted(compare_dir.glob("diff_*.json")):
            try:
                full = json.loads(diff_path.read_text(encoding="utf-8"))
                # Extract only the lightweight keys
                chunk_meta = {k: full[k] for k in _METADATA_KEYS if k in full}
                chunk_meta.setdefault("old_text", "")
                chunk_meta.setdefault("new_text", "")
                chunk_meta.setdefault("diff_lines", [])
                chunk_meta.setdefault("diff_groups", [])
                chunk_meta.setdefault("auto_reviewed", not chunk_meta.get("has_changes", True))
                chunks.append(chunk_meta)
            except Exception:
                pass

    created_at = session_dir.stat().st_ctime
    source_name = (summary or {}).get("source_name", session_id[:8])
    session: dict = {
        "session_id":     session_id,
        "source_name":    source_name,
        "status":         status,
        "phase":          "done" if status == "done" else "upload_files",
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


def get_chunk_detail(
    session_id: str,
    chunk_id: str,
    *,
    include_text: bool = False,      # OPT-3: lazy-load old_text/new_text
    include_spans: bool = False,     # OPT-1/5: spans off by default
    diff_page: int = 1,              # OPT-2: paginated diff_lines (1-based)
    diff_limit: int = DIFF_PAGE_SIZE,
) -> Optional[dict]:
    """
    Return chunk data for the detail view.

    include_text   — when False (default) old_text/new_text are omitted from
                     the response, saving significant payload size.
    include_spans  — when False (default) old_spans/new_spans are stripped
                     from every diff_line before returning.
    diff_page      — 1-based page number for paginated diff_lines.
    diff_limit     — number of diff_lines per page (default DIFF_PAGE_SIZE).
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

    # ── OPT-8: load from disk cache using explicit field checks ──────────────
    # Use explicit == "" / missing-key checks — NOT truthiness — because diff_lines
    # starts as [] (falsy) and old_text starts as "" (falsy).
    needs_disk_load = (
        chunk.get("old_text", "") == "" or
        not chunk.get("diff_lines")
    )
    if needs_disk_load:
        diff_path = base / "COMPARE" / f"diff_{chunk['index']:05d}.json"
        if diff_path.exists():
            try:
                cached = json.loads(diff_path.read_text(encoding="utf-8"))
                # Load heavy fields from disk — never rely on cleared in-memory copy
                chunk["old_text"]    = cached.get("old_text", "")
                chunk["new_text"]    = cached.get("new_text", "")
                chunk["diff_lines"]  = cached.get("diff_lines", [])
                chunk["diff_groups"] = cached.get("diff_groups", [])
                for key in ("xml_valid", "xml_errors", "validation_status", "validation_message"):
                    if key not in chunk:
                        chunk[key] = cached.get(key)
            except Exception as exc:
                logger.warning("get_chunk_detail: disk load failed for chunk %s: %s", chunk["index"], exc)

    # ── Back-fill diff_groups (old cache files may not have it) ──────────────
    if chunk.get("diff_lines") and not chunk.get("diff_groups"):
        chunk["diff_groups"] = _build_diff_groups(chunk["diff_lines"])

    # ── OPT-3: load XML fresh from disk — never cache in session RAM ─────────
    xml_content_on_disk = ""
    xml_path = base / "XML" / chunk["filename"]
    if xml_path.exists():
        try:
            xml_content_on_disk = xml_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            xml_content_on_disk = xml_path.read_bytes().decode("utf-8", errors="replace")

    xml_for_response = chunk.get("xml_saved") or xml_content_on_disk

    # ── OPT-2: paginate diff_lines ────────────────────────────────────────────
    all_diff_lines: list[dict] = chunk.get("diff_lines", [])
    total_diff_lines = len(all_diff_lines)
    page_offset = max(0, (diff_page - 1)) * diff_limit
    paged_lines = all_diff_lines[page_offset: page_offset + diff_limit]

    # ── OPT-1/5: strip spans unless requested ────────────────────────────────
    if not include_spans and paged_lines:
        stripped: list[dict] = []
        for dl in paged_lines:
            entry = {k: v for k, v in dl.items() if k not in ("old_spans", "new_spans")}
            stripped.append(entry)
        paged_lines = stripped

    # ── Build response — never mutate the in-memory chunk ────────────────────
    response: dict = {
        # Metadata (always returned)
        "index":              chunk.get("index"),
        "label":              chunk.get("label", ""),
        "filename":           chunk.get("filename", ""),
        "original_filename":  chunk.get("original_filename", chunk.get("filename", "")),
        "has_changes":        chunk.get("has_changes", False),
        "change_type":        chunk.get("change_type", "unchanged"),
        "similarity":         chunk.get("similarity", 1.0),
        "xml_size":           chunk.get("xml_size", 0),
        "page_start":         chunk.get("page_start", 0),
        "page_end":           chunk.get("page_end", 0),
        "auto_reviewed":      chunk.get("auto_reviewed", False),
        "xml_valid":          chunk.get("xml_valid", True),
        "xml_errors":         chunk.get("xml_errors", []),
        "validation_status":  chunk.get("validation_status"),
        "validation_message": chunk.get("validation_message"),
        # XML (always returned — editor needs it)
        "xml_content":        xml_content_on_disk,
        "xml_suggested":      xml_for_response,
        "xml_saved":          chunk.get("xml_saved"),
        # OPT-2: paginated diff
        "diff_lines":         paged_lines,
        "diff_groups":        chunk.get("diff_groups", []),
        "diff_total":         total_diff_lines,
        "diff_page":          diff_page,
        "diff_limit":         diff_limit,
        "diff_has_more":      (page_offset + diff_limit) < total_diff_lines,
    }

    # OPT-3: only include heavy text fields when explicitly requested
    if include_text:
        response["old_text"] = chunk.get("old_text", "")
        response["new_text"] = chunk.get("new_text", "")
    else:
        response["old_text"] = ""
        response["new_text"] = ""

    # OPT-8: clear large blobs from in-memory chunk after building response
    chunk.pop("old_text", None)
    chunk.pop("new_text", None)
    chunk.pop("diff_lines", None)
    chunk.pop("diff_groups", None)

    return response


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

    # Prefer saved version; fall back to disk file
    xml_content = chunk.get("xml_saved", "")
    if not xml_content:
        base = Path(session["storage"]["base"])
        xml_path = base / "XML" / chunk["filename"]
        if xml_path.exists():
            try:
                xml_content = xml_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                xml_content = xml_path.read_bytes().decode("utf-8", errors="replace")

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