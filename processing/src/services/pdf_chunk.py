"""
pdf_chunk.py — PDF chunking & XML change-detection service.

Pipeline per request
────────────────────
1. Extract text from OLD PDF  — uses pdf_extractor_core.load_pdf() (smart
   block-segmentation pipeline) when available, falls back to legacy extractor
2. Extract text from NEW PDF  (same pipeline)
3. Chunk BOTH with structural heading splits
4. Chunk the XML file with the existing xml_compare.chunk_xml helper
5. Align NEW-PDF chunks ↔ XML chunks by position index
6. Detect changes: compare each NEW-PDF chunk against its OLD-PDF counterpart
7. Return structured result consumed by ChunkPanel.tsx

pdf_extractor_core integration
───────────────────────────────
pdf_extractor_core.py wraps extractor.py's pure PDF logic with tkinter stubs
so it can be imported in a headless server environment. It provides:
  load_pdf(path)  — full block-segmentation pipeline
  _line_text()    — PdfLine → plain text
  _norm_cmp()     — normalisation

Dependencies
────────────
    pip install pymupdf

The XML chunking still relies on src.services.xml_compare.
"""

from __future__ import annotations

import io
import os
import tempfile
import logging
import re
import hashlib
import functools
import concurrent.futures
from collections import Counter
from typing import Optional, Any

import fitz  # PyMuPDF

from src.services.xml_compare import chunk_xml, chunk_xml_smart
from src.services.word_compare import compare_words, chunk_has_real_changes
try:
    from src.services.word_compare import build_inline_diff
except ImportError:
    def build_inline_diff(old_text: str, new_text: str) -> list:  # type: ignore[misc]
        return []

# ── Smart extractor import ─────────────────────────────────────────────────────
# Import pdf_extractor_core (server-safe wrapper around extractor.py).
#
# Strategy — three attempts in order:
#   1. src.services.pdf_extractor_core  (normal package import from project root)
#   2. pdf_extractor_core               (flat import, cwd = src/services/)
#   3. importlib spec_from_file_location (direct path relative to THIS file)
#      — works regardless of sys.path, covers any project layout
#
# All failures are LOGGED so the real error is visible in server output.

_extractor_load_pdf   = None
_extractor_line_text  = None
_extractor_norm_cmp   = None
_EXTRACTOR_AVAILABLE  = False

def _try_load_extractor_core() -> bool:
    global _extractor_load_pdf, _extractor_line_text, _extractor_norm_cmp, _EXTRACTOR_AVAILABLE
    import importlib as _il
    import importlib.util as _ilu
    import os as _os
    import logging as _log
    _lg = _log.getLogger(__name__)

    # Attempt 1 & 2: standard importlib
    for _mod_path in ("src.services.pdf_extractor_core", "pdf_extractor_core"):
        try:
            _m = _il.import_module(_mod_path)
            _extractor_load_pdf  = _m.load_pdf
            _extractor_line_text = _m._line_text
            _extractor_norm_cmp  = _m._norm_cmp
            _lg.info("pdf_chunk: pdf_extractor_core loaded via '%s' ✓", _mod_path)
            return True
        except ImportError:
            pass  # expected when path not on sys.path
        except Exception as _e:
            _lg.warning("pdf_chunk: import '%s' failed: %s", _mod_path, _e)

    # Attempt 3: direct file path — always works once the file is deployed
    _here = _os.path.dirname(_os.path.abspath(__file__))
    _candidates = [
        _os.path.join(_here, "pdf_extractor_core.py"),               # same dir
        _os.path.join(_here, "services", "pdf_extractor_core.py"),   # src/services/
        _os.path.join(_here, "..", "services", "pdf_extractor_core.py"),
    ]
    for _fpath in _candidates:
        if not _os.path.exists(_fpath):
            continue
        try:
            _spec = _ilu.spec_from_file_location("pdf_extractor_core", _fpath)
            _m2   = _ilu.module_from_spec(_spec)  # type: ignore[arg-type]
            _spec.loader.exec_module(_m2)          # type: ignore[union-attr]
            _extractor_load_pdf  = _m2.load_pdf
            _extractor_line_text = _m2._line_text
            _extractor_norm_cmp  = _m2._norm_cmp
            _lg.info("pdf_chunk: pdf_extractor_core loaded from '%s' ✓", _fpath)
            return True
        except Exception as _e:
            _lg.warning("pdf_chunk: load from '%s' failed: %s", _fpath, _e)

    return False

_EXTRACTOR_AVAILABLE = _try_load_extractor_core()

logger = logging.getLogger(__name__)
if _EXTRACTOR_AVAILABLE:
    logger.info("pdf_chunk: smart extractor pipeline active ✓")
else:
    logger.warning(
        "pdf_chunk: pdf_extractor_core.py not found or failed to load — "
        "check that pdf_extractor_core.py is in src/services/ alongside pdf_chunk.py. "
        "Falling back to legacy legislation extractor."
    )


# ── PDF helpers ────────────────────────────────────────────────────────────────

# ── UK legislation PDF clean-text extractor ───────────────────────────────────
# These PDFs (e.g. legislation.gov.uk) have a specific layout:
#   • Main legal text: x0 ≈ 60–180
#   • Footnote/amendment markers in margin: x0 < 90, short F1/C1 labels
#   • Footnote bodies: x0 ≈ 95–120, starts with "Word in s.", "S. 1(2) repealed", etc.
#   • Footnote overflow from previous page: x0 ≈ 95–120, y0 < ~225
#   • Centered headings (PART 1, CHAPTER 2): x0 > 200
#
# The standard get_text("text") call interleaves all of these because it sorts
# blocks by y-position on the page, causing footnotes that overflow to the next
# page to appear between the preamble and the section headings.
#
# This extractor uses block-level layout (get_text("blocks")) to classify and
# filter, producing clean legal prose only.

_LEGISLATION_FOOTNOTE_REF = re.compile(
    r'^(?:[FCfc]\d+[a-z]?(?:\s+[FCfc]\d+[a-z]?)*)\s*$'
)
_LEGISLATION_SKIP = re.compile(
    r'^(?:'
    r'Word\b|Words\b|S\.\s*\d|Ss?\.\s*\d|Sub-s\b|'
    r'Pt\.\s+\d|Pts\.\s+\d|'
    r'Act applied\b|Act extended\b|Act modified\b|'
    r'inserted\b|repealed\b|omitted\b|substituted\b|'
    r'applied\b|amended\b|excluded\b|modified\b|restricted\b|'
    r'saved\b|extended\b|added\b|renumbered\b|'
    r'\d{4}\s+\(c\.\s*\d|'           # "2011 (c. 11), Sch."
    r'\(c\.\s*\d+\),\s+Sch|'         # "(c. 14), Sch. 1"
    r'arts?\.\s*\d|regs?\.\s*\d|'
    r'Sch\.\s+\d+\s+para|'
    r'\(S\.I\.\s*\d|S\.I\.\s*\d{4}|'
    r'Finance Act \d{4} \(c\.|'
    r'Income Tax Act \d{4}|'
    r'Corporation Tax Act\b|'
    r'Her Majesty.s Revenue and Customs'
    r')',
    re.IGNORECASE,
)
_LEGISLATION_SECTION_LABEL = re.compile(
    r'^(?:Textual Amendments?|Modifications? etc\.?(?:\s+\(not altering text\))?|'
    r'Commencement Information|Editorial Information|Marginal Citations?|'
    r'Subordinate Legislation|Extent Information)\s*$',
    re.IGNORECASE,
)

def _classify_legislation_block(x0: float, y0: float, text: str) -> str:
    """Classify a PDF block from a UK legislation PDF. Returns 'KEEP', 'HEAD', or 'SKIP'."""
    t = text.strip()
    if not t:
        return "SKIP"
    # Footnote/cross-ref markers (F1, C2, F3 F4, etc.)
    if _LEGISLATION_FOOTNOTE_REF.match(t):
        return "SKIP"
    # Footnote body overflow from previous page (top of page, indented ~102)
    if 95 <= x0 <= 122 and y0 < 230:
        return "SKIP"
    # Footnote body text (x0 ~95-122, starts with known annotation phrases)
    if 95 <= x0 <= 122 and _LEGISLATION_SKIP.match(t):
        return "SKIP"
    # Section labels like "Textual Amendments"
    if _LEGISLATION_SECTION_LABEL.match(t):
        return "SKIP"
    # Centered section headings (x0 > 200 = can't be left-justified legal text)
    if x0 > 200:
        return "HEAD"
    return "KEEP"


def _is_bare_legislation_marker(text: str) -> bool:
    """True for short Fn/Cn reference markers — NOT substantive annotation bodies."""
    return bool(_LEGISLATION_FOOTNOTE_REF.match(text.strip()))


def _clean_legislation_block(text: str) -> str:
    """Strip bracket insertion markers and normalise whitespace within a block."""
    # Fix mid-block bracket splits: "[\nsome text\n" → "some text "
    text = re.sub(r'\[\s*\n\s*', '', text)
    text = re.sub(r'\s*\]\s*', ' ', text)
    # Remove any stray brackets
    text = re.sub(r'\[', '', text)
    text = re.sub(r'\]', '', text)
    # Normalise each line; drop blanks
    lines = [' '.join(ln.split()) for ln in text.split('\n')]
    return '\n'.join(ln for ln in lines if ln.strip())

_legislation_pdf_cache: dict[str, bool] = {}

def _is_legislation_pdf(pdf_bytes: bytes) -> bool:
    """
    Quick heuristic: peek at page 1 blocks to see if this looks like a
    UK legislation PDF with the characteristic footnote-at-top-of-page layout.
    Result is cached by MD5 hash of first 16 KB — zero overhead on repeated
    calls with the same PDF (e.g. once per chunk in detect_pdf_changes).
    """
    h = hashlib.md5(pdf_bytes[:16384]).hexdigest()
    if h in _legislation_pdf_cache:
        return _legislation_pdf_cache[h]
    result = False
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if len(doc) > 0:
            page = doc[0]
            blocks = page.get_text("blocks")
            doc.close()
            for b in blocks[:20]:
                x0, y0 = b[0], b[1]
                text = b[4].strip() if len(b) > 4 else ""
                if 95 <= x0 <= 122 and y0 < 200 and _LEGISLATION_SKIP.match(text):
                    result = True
                    break
                if x0 < 90 and y0 < 60 and _LEGISLATION_FOOTNOTE_REF.match(text):
                    result = True
                    break
        else:
            doc.close()
    except Exception:
        pass
    _legislation_pdf_cache[h] = result
    return result

def _extract_legislation_text(
    pdf_bytes: bytes,
    page_start: int | None = None,
    page_end:   int | None = None,
) -> str:
    """
    Extract clean legal prose from a UK legislation PDF, stripping all
    footnote annotations, textual amendment markers, and section labels.
    Returns plain text with page separators (── Page N ──).
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total   = len(doc)
    p_start = max(0, (page_start or 1) - 1)
    p_end   = min(total, page_end or total)

    parts: list[str] = []

    for pg_num in range(p_start, p_end):
        page   = doc[pg_num]
        blocks = sorted(page.get_text("blocks"), key=lambda b: b[1])
        parts.append(f"\n── Page {pg_num + 1} ──\n")

        # Track the bottom edge (y1) of the last SUBSTANTIVE annotation block
        # skipped.  Bare F1/C2 markers do NOT update this tracker — they sit
        # inline beside the main text and must not absorb the legal provision
        # that immediately follows them on the same y-line.
        last_substantive_skip_y1: float = -999.0

        for b in blocks:
            x0, y0, x1, y1 = b[0], b[1], b[2], b[3]
            text = (b[4] if len(b) > 4 else "").strip()
            if not text:
                continue

            cls = _classify_legislation_block(x0, y0, text)

            # Continuation detection: if this block is at the footnote indent
            # (x0 ~95-122) and its top edge is within 25pt of the bottom of the
            # last substantive annotation block, it's a continuation line of that
            # annotation paragraph (e.g. "Housing Benefit and Council Tax Benefit…"
            # following "Act applied (with modifications)…").
            if cls == "KEEP" and 95 <= x0 <= 122:
                if y0 - last_substantive_skip_y1 < 25:
                    last_substantive_skip_y1 = y1
                    continue

            if cls == "SKIP":
                # Only substantive annotation bodies update the continuation tracker;
                # bare F1/C2 markers do not.
                if not _is_bare_legislation_marker(text):
                    last_substantive_skip_y1 = y1
            else:
                last_substantive_skip_y1 = -999.0  # main content resets the chain

            if cls == "SKIP":
                continue

            cleaned = _clean_legislation_block(text)
            if cleaned:
                parts.append(cleaned)

    doc.close()
    return '\n'.join(parts)


def _extract_pdf_text(
    pdf_bytes: bytes,
    page_start: int | None = None,
    page_end:   int | None = None,
) -> str:
    """
    Extract plain-text from a PDF.
    Uses the clean UK legislation extractor when the PDF matches that layout,
    otherwise falls back to the standard single-pass extractor.
    """
    if _is_legislation_pdf(pdf_bytes):
        return _extract_legislation_text(pdf_bytes, page_start, page_end)
    text, _, _ = _single_pass_extract(pdf_bytes, "part")
    return text


def _extractor_pdf_to_text(pdf_bytes: bytes) -> str:
    """
    Extract plain text using pdf_extractor_core.load_pdf() (the smart
    block-segmentation pipeline from extractor.py, server-safe version).

    Writes bytes to a temp file (load_pdf needs a path), runs the pipeline,
    then converts PdfLine objects to plain text with paragraph gaps preserved.
    Falls back to _extract_pdf_text() if the core is not available.
    """
    if not _EXTRACTOR_AVAILABLE:
        return _extract_pdf_text(pdf_bytes)

    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fh:
            fh.write(pdf_bytes)
            tmp = fh.name

        lines = _extractor_load_pdf(tmp)   # type: ignore[misc]
        text_parts: list[str] = []
        prev_y: float = -1.0
        PARA_GAP = 20.0

        for line in lines:
            raw = _extractor_line_text(line).strip()   # type: ignore[misc]
            if not raw:
                continue
            if prev_y >= 0 and (line.y - prev_y) > PARA_GAP:
                text_parts.append("")
            text_parts.append(raw)
            prev_y = line.y

        return "\n".join(text_parts)

    except Exception as exc:
        logger.warning(
            "_extractor_pdf_to_text: smart pipeline failed (%s); "
            "falling back to legacy extractor", exc
        )
        return _extract_pdf_text(pdf_bytes)
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def _single_pass_extract(
    pdf_bytes: bytes,
    tag_name: str,
) -> tuple[str, list[tuple[int, str]], list[int]]:
    """
    Extract text + detect headings in ONE single pass through the PDF.

    Heading detection uses ONLY:
      1. Structural pattern match (PART N, CHAPTER N, etc.)
      2. Isolation criterion (first/second line of a short block)

    Font size is intentionally ignored — UK legislation PDFs use the same
    font size for headings and body text, so size-based detection adds
    expensive iteration with zero benefit.
    """
    _NOISE = re.compile(r'^\s*(?:page\s+\d+(?:\s+of\s+\d+)?|\d{1,4})\s*$', re.IGNORECASE)
    _EXACT_HEADING = re.compile(
        r'^(?:PART|Part|CHAPTER|Chapter|SECTION|Section|ARTICLE|Article)\s+'
        r'(?:\d+[A-Za-z]?|[IVXLCDM]+)$',
        re.IGNORECASE,
    )
    pattern = _HEADING_PATTERNS.get(tag_name.lower(), _GENERIC_HEADING)

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # For UK legislation PDFs use the clean block-level extractor per page
    # so that footnote annotations are stripped before heading detection.
    use_clean = _is_legislation_pdf(pdf_bytes)

    page_texts: list[str] = []
    raw_candidates: list[tuple[int, str]] = []  # (page_num, heading_text)

    for page_num, page in enumerate(doc):
        if use_clean:
            # Use clean per-page extraction (strip footnotes)
            blocks = sorted(page.get_text("blocks"), key=lambda b: b[1])
            clean_lines: list[str] = []
            last_substantive_skip_y1: float = -999.0
            for b in blocks:
                x0, y0, x1, y1 = b[0], b[1], b[2], b[3]
                text = (b[4] if len(b) > 4 else "").strip()
                if not text:
                    continue
                cls = _classify_legislation_block(x0, y0, text)
                if cls == "KEEP" and 95 <= x0 <= 122:
                    if y0 - last_substantive_skip_y1 < 25:
                        last_substantive_skip_y1 = y1
                        continue
                if cls == "SKIP":
                    if not _is_bare_legislation_marker(text):
                        last_substantive_skip_y1 = y1
                else:
                    last_substantive_skip_y1 = -999.0
                if cls == "SKIP":
                    continue
                cleaned = _clean_legislation_block(text)
                if cleaned:
                    clean_lines.append(cleaned)
            page_lines_raw = '\n'.join(clean_lines).splitlines()
        else:
            page_text_raw = page.get_text("text")
            page_lines_raw = page_text_raw.splitlines()

        page_lines: list[str] = []
        for ln in page_lines_raw:
            line = ln.strip()
            if not line or _NOISE.match(line):
                continue
            page_lines.append(line)

            # Heading detection: pattern match + isolation
            if pattern.search(line):
                is_exact = bool(_EXACT_HEADING.fullmatch(line))
                if is_exact:
                    raw_candidates.append((page_num, line))

        page_texts.append("\n".join(page_lines))

    doc.close()

    # Build full text and page offsets
    full_text = "\n\n".join(page_texts)
    page_offsets: list[int] = []
    offset = 0
    for pt in page_texts:
        page_offsets.append(offset)
        offset += len(pt) + 2

    logger.info("_single_pass_extract: %d pages, %d heading candidates, tag=%r",
                len(page_texts), len(raw_candidates), tag_name)

    if not raw_candidates:
        return full_text, [], []

    # Deduplicate by ordinal
    first_by_ordinal: dict[int, tuple[int, str]] = {}
    first_by_key:     dict[str, tuple[int, str]] = {}
    for page_num, htxt in raw_candidates:
        ordinal = _heading_ordinal(htxt)
        key     = _heading_key(htxt)
        if ordinal is not None:
            if ordinal not in first_by_ordinal:
                first_by_ordinal[ordinal] = (page_num, htxt)
        else:
            if key not in first_by_key:
                first_by_key[key] = (page_num, htxt)

    all_kept = sorted(
        list(first_by_ordinal.values()) + list(first_by_key.values()),
        key=lambda t: t[0],
    )

    # Enforce monotone ordinals
    ordinal_entries = [(pn, _heading_ordinal(h), h) for pn, h in all_kept if _heading_ordinal(h) is not None]
    no_ord_entries  = [(pn, h) for pn, h in all_kept if _heading_ordinal(h) is None]
    if ordinal_entries:
        min_ord = min(o for _, o, _ in ordinal_entries)
        best: list[tuple[int, str]] = []
        for si, (pn, so, sh) in enumerate(ordinal_entries):
            if so != min_ord:
                continue
            seq: list[tuple[int, str]] = [(pn, sh)]
            last_o = so
            for pn2, o2, h2 in ordinal_entries[si + 1:]:
                if o2 > last_o:
                    seq.append((pn2, h2))
                    last_o = o2
            if len(seq) > len(best):
                best = seq
        final_page_headings = sorted(best + no_ord_entries, key=lambda t: t[0])
    else:
        final_page_headings = no_ord_entries

    # Convert page numbers → char offsets
    result: list[tuple[int, str]] = []
    result_pages: list[int] = []
    for page_num, htxt in final_page_headings:
        p_start = page_offsets[page_num] if page_num < len(page_offsets) else 0
        p_end   = page_offsets[page_num + 1] if page_num + 1 < len(page_offsets) else len(full_text)
        idx = full_text.find(htxt, p_start, p_end)
        if idx == -1:
            idx = full_text.find(htxt, max(0, p_start - 200), min(len(full_text), p_end + 200))
        if idx != -1:
            result.append((idx, htxt))
            result_pages.append(page_num + 1)

    paired = sorted(zip(result, result_pages), key=lambda x: x[0][0])
    result       = [r for r, _ in paired]
    result_pages = [p for _, p in paired]

    logger.info("_single_pass_extract: %d final headings", len(result))
    return full_text, result, result_pages


def _detect_headings_from_pdf(pdf_bytes: bytes, tag_name: str) -> list[tuple[int, str]]:
    """Thin wrapper — kept for backward compatibility. Uses _single_pass_extract."""
    _, headings, pages = _single_pass_extract(pdf_bytes, tag_name)
    _detect_headings_from_pdf._last_pages = pages  # type: ignore[attr-defined]
    return headings


# ── Structural heading patterns ────────────────────────────────────────────────

_HEADING_PATTERNS: dict[str, re.Pattern] = {
    "chapter": re.compile(
        r'^(?:CHAPTER\s+(?:\d+|[IVXLCDM]+|[A-Z])\b|Chapter\s+(?:\d+|[IVXLCDM]+|[A-Z])\b)',
        re.MULTILINE,
    ),
    "section": re.compile(
        r'^(?:(?:SECTION|Section|SEC\.?)\s+[\d\.]+\b|§\s*[\d\.]+\b|\d+\.\s+[A-Z][A-Za-z]|\d+\.\d+\s+[A-Z][A-Za-z])',
        re.MULTILINE,
    ),
    "part": re.compile(
        r'^(?:PART|Part)\s+(?:\d+[A-Z]?|[IVXLCDM]+|[A-Z])\b',
        re.MULTILINE | re.IGNORECASE,
    ),
    "chapter": re.compile(
        r'^(?:CHAPTER|Chapter)\s+(?:\d+[A-Z]?|[IVXLCDM]+|[A-Z])\b',
        re.MULTILINE | re.IGNORECASE,
    ),
    "article": re.compile(
        r'^(?:ARTICLE\s+(?:\d+|[IVXLCDM]+)\b|Article\s+(?:\d+|[IVXLCDM]+)\b)',
        re.MULTILINE,
    ),
    "paragraph": re.compile(
        r'^(?:¶\s*\d+|PARAGRAPH\s+\d+)',
        re.MULTILINE,
    ),
}

_GENERIC_HEADING = re.compile(
    r'^(?:[A-Z][A-Z\s\-\d\.]{3,60}|[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,6})\s*$',
    re.MULTILINE,
)


# ── Heading ordinal extraction ─────────────────────────────────────────────────

_ROMAN = {"i":1,"ii":2,"iii":3,"iv":4,"v":5,"vi":6,"vii":7,"viii":8,"ix":9,
           "x":10,"xi":11,"xii":12,"xiii":13,"xiv":14,"xv":15,"xvi":16,
           "xvii":17,"xviii":18,"xix":19,"xx":20,"xxi":21,"xxii":22,"xxiii":23,
           "xxiv":24,"xxv":25,"xxx":30,"xl":40,"l":50,"lx":60,"lxx":70,
           "lxxx":80,"xc":90,"c":100}

def _heading_ordinal(text: str) -> float | None:
    """
    Extract the numeric ordinal from a heading like 'Chapter 3', 'PART IV',
    'Part 7A', 'Section 2.1' etc.

    Returns a float so lettered suffixes (7A, 7B) sort correctly after their
    base number and don't collide with it:
        Part 7  → 7.0
        Part 7A → 7.1  (A=1, B=2, ...)
        Part 7B → 7.2
        Part 8  → 8.0

    Returns None if no ordinal found.
    """
    t = text.strip().splitlines()[0].strip().lower()
    # Arabic numeral with optional letter suffix: "part 7a", "chapter 12b"
    m = re.search(r'(\d+)([a-z])?', t)
    if m:
        base   = int(m.group(1))
        suffix = m.group(2)
        offset = (ord(suffix) - ord('a') + 1) * 0.1 if suffix else 0.0
        return base + offset
    # Roman numeral  e.g. "part iv"
    words = t.split()
    for w in reversed(words):
        clean = w.strip('.,;:')
        if clean in _ROMAN:
            return float(_ROMAN[clean])
    return None


def _heading_key(text: str) -> str:
    """
    Canonical key from a heading's first line, lowercased + whitespace-collapsed.
    Used to detect exact duplicate heading text.
    """
    first = text.strip().splitlines()[0].strip()
    return re.sub(r'\s+', ' ', first.lower())


def _extract_pdf_text_with_headings(pdf_bytes: bytes, tag_name: str) -> tuple[str, list[tuple[int, str]], list[int]]:
    """
    Extract text + detect structural headings in a single PDF pass.
    Returns (text, headings, heading_page_numbers).
    """
    return _single_pass_extract(pdf_bytes, tag_name)



def _structural_chunks(
    text: str,
    tag_name: str,
    fallback_chunk_size: int = 1500,
    fallback_chunk_overlap: int = 150,
    headings: list[tuple[int, str]] | None = None,
) -> list[tuple[str, str]]:
    """
    Split *text* at structural boundaries.

    If *headings* (pre-detected via font metadata) are provided, use those
    offsets directly — no regex needed, no gap-filter heuristics.

    Otherwise falls back to regex + gap-filter heuristics.
    """
    MIN_BODY_CHARS = 300

    # ── Font-metadata path (preferred) ────────────────────────────────────────
    if headings and len(headings) >= 2:
        logger.info("_structural_chunks: using %d font-detected headings", len(headings))
        segments: list[tuple[str, str]] = []

        preamble = text[: headings[0][0]].strip()
        if len(preamble) >= MIN_BODY_CHARS:
            segments.append(("", preamble))

        for i, (offset, htxt) in enumerate(headings):
            end = headings[i + 1][0] if i + 1 < len(headings) else len(text)
            body = text[offset:end].strip()
            segments.append((_heading_key(htxt).title(), body))

        result: list[tuple[str, str]] = []
        for heading, body in segments:
            if result and len(body) < MIN_BODY_CHARS:
                prev_h, prev_b = result[-1]
                result[-1] = (prev_h, prev_b + "\n\n" + body)
            else:
                result.append((heading, body))

        logger.info("_structural_chunks: font-path → %d final chunks", len(result))
        return result

    # ── Regex fallback path ───────────────────────────────────────────────────
    logger.info("_structural_chunks: no font headings; using regex+gap fallback for tag=%r", tag_name)
    pattern = _HEADING_PATTERNS.get(tag_name.lower(), _GENERIC_HEADING)
    raw_matches = list(pattern.finditer(text))

    if not raw_matches:
        return [("", c) for c in _langchain_chunks(text, fallback_chunk_size, fallback_chunk_overlap)]

    real_candidates: list[re.Match] = []
    for i, m in enumerate(raw_matches):
        next_start = raw_matches[i + 1].start() if i + 1 < len(raw_matches) else len(text)
        if (next_start - m.end()) >= MIN_BODY_CHARS:
            real_candidates.append(m)

    if not real_candidates:
        return [("", c) for c in _langchain_chunks(text, fallback_chunk_size, fallback_chunk_overlap)]

    first_by_ordinal: dict[int, re.Match] = {}
    first_by_key_r:   dict[str, re.Match] = {}
    for m in real_candidates:
        ordinal = _heading_ordinal(m.group(0))
        key     = _heading_key(m.group(0))
        if ordinal is not None:
            if ordinal not in first_by_ordinal:
                first_by_ordinal[ordinal] = m
        else:
            if key not in first_by_key_r:
                first_by_key_r[key] = m

    om = sorted(
        [(m.start(), _heading_ordinal(m.group(0)), m) for m in first_by_ordinal.values()],
        key=lambda t: t[0],
    )

    if om:
        min_ord = min(o for _, o, _ in om)
        best_seq_m: list[re.Match] = []
        for si, (sp, so, sm) in enumerate(om):
            if so != min_ord:
                continue
            seq_m = [sm]
            last_o = so
            for _, o, m2 in om[si + 1:]:
                if o > last_o:  # type: ignore
                    seq_m.append(m2)
                    last_o = o  # type: ignore
            if len(seq_m) > len(best_seq_m):
                best_seq_m = seq_m

        boundaries = sorted(
            best_seq_m + list(first_by_key_r.values()),
            key=lambda m: m.start(),
        )
    else:
        boundaries = sorted(first_by_key_r.values(), key=lambda m: m.start())

    if len(boundaries) < 2:
        return [("", c) for c in _langchain_chunks(text, fallback_chunk_size, fallback_chunk_overlap)]

    segs2: list[tuple[str, str]] = []
    preamble2 = text[: boundaries[0].start()].strip()
    if len(preamble2) >= MIN_BODY_CHARS:
        segs2.append(("", preamble2))
    for i, m in enumerate(boundaries):
        end = boundaries[i + 1].start() if i + 1 < len(boundaries) else len(text)
        segs2.append((_heading_key(m.group(0)).title(), text[m.start():end].strip()))

    result2: list[tuple[str, str]] = []
    for heading, body in segs2:
        if result2 and len(body) < MIN_BODY_CHARS:
            prev_h, prev_b = result2[-1]
            result2[-1] = (prev_h, prev_b + "\n\n" + body)
        else:
            result2.append((heading, body))

    return result2


def _langchain_chunks(
    text: str,
    chunk_size: int = 1500,
    chunk_overlap: int = 150,
) -> list[str]:
    """
    Split plain text into chunks using a recursive character splitter
    (avoids mid-sentence splits). Native replacement for LangChain's
    RecursiveCharacterTextSplitter.
    """
    separators = ["\n\n", "\n", ". ", " ", ""]

    def _split(t: str, seps: list[str]) -> list[str]:
        if not seps:
            return [t] if t else []
        sep = seps[0]
        parts = t.split(sep) if sep else list(t)
        chunks: list[str] = []
        current = ""
        for part in parts:
            segment = part + (sep if sep else "")
            if len(current) + len(segment) <= chunk_size:
                current += segment
            else:
                if current:
                    chunks.append(current.rstrip())
                if len(segment) > chunk_size:
                    chunks.extend(_split(segment, seps[1:]))
                    current = ""
                else:
                    current = segment
        if current.strip():
            chunks.append(current.rstrip())
        return chunks

    raw = _split(text, separators)

    # Apply overlap: each chunk starts with the tail of the previous one
    if chunk_overlap <= 0 or len(raw) < 2:
        return raw

    result: list[str] = [raw[0]]
    for chunk in raw[1:]:
        overlap_text = result[-1][-chunk_overlap:]
        result.append(overlap_text + chunk)
    return result


# ── Change detection ───────────────────────────────────────────────────────────

def _texts_differ(old: str, new: str) -> bool:
    """
    Coarse guard: normalise whitespace then compare.
    Used only as a pre-filter before word_compare runs.
    """
    norm = lambda s: " ".join(s.split()).lower()
    return norm(old) != norm(new)


def _trim_chunk_to_heading(text: str, heading: str) -> str:
    """
    Trim chunk text so it starts AT the heading line, not before it.

    When _structural_chunks slices `text[offset:end]`, the offset is the
    character position of the heading string itself, so in theory the heading
    IS the first line.  In practice, page-break noise or trailing lines from the
    previous chunk (bleed-in from page boundaries) sometimes precede it.

    Algorithm:
      0. Strict structural match — for bare structural headings like "Part 2"
         require an exact ordinal fullmatch so running headers ("Part 2
         Employment Income: ...") are never chosen as the cut point.
      1. Exact or substring match on the first 60 chars of each line vs. heading.
      2. Fuzzy word-overlap fallback (≥80% — raised from 60% to prevent short
         headings from matching lines that merely share the tag word).
      3. Returns text FROM the matched line onward (inclusive).

    If the heading cannot be found the original text is returned unchanged.
    """
    if not heading or not text:
        return text
    needle = heading.strip().lower()
    lines = text.splitlines()

    # Detect whether needle is a bare structural heading e.g. "part 2" / "part 2a"
    _struct_re = re.compile(
        r'^(part|chapter|schedule|article|section)\s+[\dIVXivx]+[a-zA-Z]?\s*$',
        re.IGNORECASE,
    )
    _struct_line_re = re.compile(
        r'^(part|chapter|schedule|article|section)\s+[\dIVXivx]+[a-zA-Z]?\s*$',
        re.IGNORECASE,
    )

    # Pass 0: strict structural — only accept a line that IS the heading alone
    if _struct_re.match(needle):
        needle_ord = re.search(r'[\dIVXivx]+[a-zA-Z]?$', needle)
        for i, line in enumerate(lines):
            ll = line.strip().lower()
            if not ll:
                continue
            if _struct_line_re.match(ll):
                line_ord = re.search(r'[\dIVXivx]+[a-zA-Z]?$', ll)
                if needle_ord and line_ord and needle_ord.group().lower() == line_ord.group().lower():
                    return "\n".join(lines[i:])

    # Pass 1: exact / substring match
    for i, line in enumerate(lines):
        ll = line.strip().lower()
        if not ll:
            continue
        if needle == ll or needle[:60] in ll or ll[:60] in needle:
            return "\n".join(lines[i:])

    # Pass 2: fuzzy word-overlap (≥80% of words with len ≥ 3 — raised from 60%)
    needle_words = [w for w in needle.split() if len(w) >= 3]
    if needle_words:
        threshold = max(1, round(len(needle_words) * 0.80))
        for i, line in enumerate(lines):
            ll = line.strip().lower()
            if sum(1 for w in needle_words if w in ll) >= threshold:
                return "\n".join(lines[i:])

    return text


def _classify_chunk_changes(
    old_text: str,
    new_text: str,
    old_heading: str = "",
    new_heading: str = "",
) -> dict:
    """
    Classify change types between two text chunks using word_compare as the
    authoritative diff engine.

    Each chunk text is first trimmed to start at its own heading so that
    trailing content from the previous part is never compared.

    Returns
    -------
    {
        "change_types":   list[str],   # ordered: addition / modification / removal
        "change_summary": {
            "addition":     int,
            "removal":      int,
            "modification": int,
            "emphasis":     int,   # always 0 here — plain text has no formatting
                                   # metadata; emphasis is detected by /detect-chunk
                                   # via compare_pdfs_layout / detect_pdf_changes.
        },
    }

    NOTE on emphasis
    ----------------
    Plain-text chunking has no access to PDF span-level formatting (bold/italic).
    Emphasis is therefore always 0 at this stage.  The key is included so the
    summary shape is consistent with DetectSummary in ChunkPanel/ComparePanel, and
    so /detect-chunk can increment it without changing the shape contract.
    """
    _EMPTY: dict = {
        "change_types":   [],
        "change_summary": {"addition": 0, "removal": 0, "modification": 0, "emphasis": 0},
    }

    # Trim each chunk to start at its own heading — prevents the tail of the
    # previous part from being diffed as additions/removals.
    if old_heading:
        old_text = _trim_chunk_to_heading(old_text, old_heading)
    if new_heading:
        new_text = _trim_chunk_to_heading(new_text, new_heading)

    # Gate: is there anything meaningful at all?
    meaningful, word_result = chunk_has_real_changes(old_text, new_text)
    if not meaningful:
        return _EMPTY

    summary = {
        "addition":     word_result["summary"]["addition"],
        "removal":      word_result["summary"]["removal"],
        "modification": word_result["summary"]["modification"],
        "emphasis":     0,   # populated on-demand by /detect-chunk
    }

    # Secondary gate: require at least 2 changed words OR a change_ratio ≥ 0.8%
    # Lowered from (3 words / 1.5%) so single real-word substitutions are
    # captured here and surfaced as "Changed" in the chunk list without waiting
    # for the user to open /detect-chunk.  The /detect-chunk span pass then
    # provides the precise per-line breakdown.
    changed_words = (
        summary["addition"] + summary["removal"] + summary["modification"]
    )
    if changed_words < 2 and word_result.get("change_ratio", 0) < 0.008:
        return _EMPTY

    ORDER = ["addition", "modification", "removal"]
    return {
        "change_types":   [t for t in ORDER if summary[t] > 0],
        "change_summary": summary,
    }


def _sanitize_source_name(name: str) -> str:
    """Sanitize source name for use in filenames."""
    # Remove or replace invalid filename chars
    sanitized = re.sub(r'[^\w\-]', '_', name)
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized.strip('_') or 'Document'


def _build_xml_chunk_filename(source_name: str, index: int) -> str:
    """
    Generate XML chunk filename in the format:
    SourceName_innod.NNNNN.xml
    """
    safe = _sanitize_source_name(source_name)
    return f"{safe}_innod.{str(index).zfill(5)}.xml"


def _build_xml_chunk_content(
    source_name: str,
    chunk_index: int,
    xml_content: str,
    has_changes: bool,
) -> str:
    """
    Wrap an existing XML chunk slice in the standard _innod file envelope.
    If xml_content is empty (no XML was provided), returns empty string —
    we never generate XML from PDF text.
    """
    if not xml_content.strip():
        return ""

    safe_name = _sanitize_source_name(source_name)
    chunk_num = str(chunk_index).zfill(5)
    status = 'changed' if has_changes else 'unchanged'

    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<!-- Chunk: {safe_name}_innod.{chunk_num}.xml -->\n'
        f'<!-- Source: {source_name} -->\n'
        f'<!-- Status: {status} -->\n'
        f'{xml_content.strip()}\n'
    )


# ── Public API ─────────────────────────────────────────────────────────────────

def chunk_pdfs_and_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_content: str,
    tag_name: str,
    source_name: str = "Document",
    attribute: Optional[str] = None,
    value: Optional[str] = None,
    max_file_size: Optional[int] = None,
    chunk_size: int = 1500,
    chunk_overlap: int = 150,
    progress_callback: Optional[Any] = None,
) -> dict[str, Any]:
    """
    Full chunking pipeline.

    progress_callback(pct: int, stage: str) — called after each chunk is
    processed so the caller can update a job-store progress field.
    pct is 0-100; stage is a human-readable description of the current step.
    """
    def _emit(pct: int, stage: str) -> None:
        if progress_callback:
            try:
                progress_callback(pct, stage)
            except Exception:
                pass

    import time as _time
    _t0 = _time.time()
    def _tick(label: str) -> None:
        logger.warning("TIMING %s: %.2fs", label, _time.time() - _t0)

    # 1 & 2 — extract text + headings
    # When pdf_extractor_core is available we run its load_pdf() pipeline for
    # the text body (block segmentation, amendment merging, header/footer removal)
    # while _single_pass_extract handles heading detection — both PDFs in parallel.
    _emit(5, "Extracting text from PDFs")

    def _extract_old():
        headings_text, font_headings, heading_pages = _single_pass_extract(old_pdf_bytes, tag_name)
        # UK legislation PDFs are already cleaned during _single_pass_extract,
        # so running the smart extractor again just duplicates the most
        # expensive pass with little benefit.
        if _EXTRACTOR_AVAILABLE and not _is_legislation_pdf(old_pdf_bytes):
            body_text = _extractor_pdf_to_text(old_pdf_bytes)
        else:
            body_text = headings_text
        return body_text, font_headings, heading_pages

    def _extract_new():
        headings_text, font_headings, heading_pages = _single_pass_extract(new_pdf_bytes, tag_name)
        if _EXTRACTOR_AVAILABLE and not _is_legislation_pdf(new_pdf_bytes):
            body_text = _extractor_pdf_to_text(new_pdf_bytes)
        else:
            body_text = headings_text
        return body_text, font_headings, heading_pages

    # Run both PDFs in parallel — they are independent and each blocks on I/O
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as _pool:
        _fut_old = _pool.submit(_extract_old)
        _fut_new = _pool.submit(_extract_new)
        old_text, old_font_headings, old_heading_pages = _fut_old.result()
        new_text, new_font_headings, new_heading_pages = _fut_new.result()
    _tick("parallel_extract OLD+NEW")
    # Derive total page counts from text (count \n\n separators = page count)
    # This avoids two extra fitz.open() calls just to get page count.
    old_total_pages = old_text.count("\n\n") + 1 if old_text else 1
    new_total_pages = new_text.count("\n\n") + 1 if new_text else 1

    # 3 — Structural split using font-detected headings (falls back to regex)
    old_structural = _structural_chunks(old_text, tag_name, chunk_size, chunk_overlap, old_font_headings)
    new_structural = _structural_chunks(new_text, tag_name, chunk_size, chunk_overlap, new_font_headings)
    _tick("structural_chunks")

    old_headings = [h for h, _ in old_structural]
    old_chunks   = [b for _, b in old_structural]
    new_headings = [h for h, _ in new_structural]
    new_chunks   = [b for _, b in new_structural]

    # Build heading → page-number lookup (1-based) from font detection results
    def _norm_heading(h: str) -> str:
        return h.strip().lower()

    old_page_by_hkey: dict[str, int] = {}
    for i, (_, htxt) in enumerate(old_font_headings):
        k = _norm_heading(htxt)
        if k not in old_page_by_hkey and i < len(old_heading_pages):
            old_page_by_hkey[k] = old_heading_pages[i]

    new_page_by_hkey: dict[str, int] = {}
    for i, (_, htxt) in enumerate(new_font_headings):
        k = _norm_heading(htxt)
        if k not in new_page_by_hkey and i < len(new_heading_pages):
            new_page_by_hkey[k] = new_heading_pages[i]

    # 4 — XML chunks: skip entirely when no XML was provided (2-file mode)
    _emit(22, "Aligning XML sections")
    xml_chunks: list[Any] = []
    if xml_content and xml_content.strip():
        try:
            xml_chunks = chunk_xml_smart(
                xml_content=xml_content,
                tag_name=tag_name,
                attribute=attribute,
                value=value,
                max_file_size=max_file_size,
            )
            logger.info("chunk_xml_smart: %d XML chunks from tag=%r", len(xml_chunks), tag_name)
        except Exception as exc:
            logger.warning("chunk_xml_smart failed (%s); continuing without XML chunks", exc)
            xml_chunks = []
    _tick("xml_chunking")

    # 5 — Align old ↔ new chunks
    # Strategy (fast):
    #   Pass 1: exact heading match  — "Part 3" → "Part 3"  (microseconds)
    #   Pass 2: word-set Jaccard on first 500 chars for unmatched  (milliseconds)
    # Avoids trigram Jaccard on full 40k-char bodies (was ~1.5s for 14 chunks).
    _emit(30, "Aligning PDF sections")

    def _norm_text(t: str) -> str:
        return " ".join(t.lower().split())

    def _word_sim(a: str, b: str) -> float:
        """Word-set Jaccard — fast and good enough for chunk alignment."""
        wa = set(a.lower().split())
        wb = set(b.lower().split())
        if not wa and not wb: return 1.0
        if not wa or  not wb: return 0.0
        inter = len(wa & wb)
        union = len(wa | wb)
        return inter / union

    n_old, n_new = len(old_chunks), len(new_chunks)

    # Pass 1: heading-exact match (handles "Part N", "Chapter N" etc. instantly)
    new_used: set[int] = set()
    aligned_pairs: list[tuple[int | None, int | None]] = [None] * n_old  # type: ignore

    new_heading_index: dict[str, int] = {}
    for j, h in enumerate(new_headings):
        key = _norm_text(h)
        if key and key not in new_heading_index:
            new_heading_index[key] = j

    for i, h in enumerate(old_headings):
        key = _norm_text(h)
        j = new_heading_index.get(key, -1)
        if j >= 0 and j not in new_used:
            aligned_pairs[i] = (i, j)
            new_used.add(j)

    # Pass 2: word-set similarity on first 500 chars for unmatched chunks
    unmatched_old = [i for i in range(n_old) if aligned_pairs[i] is None]
    unmatched_new = [j for j in range(n_new) if j not in new_used]

    if unmatched_old and unmatched_new:
        # Truncate to 500 chars for speed
        old_short = [old_chunks[i][:500] for i in unmatched_old]
        new_short = [new_chunks[j][:500] for j in unmatched_new]

        sim = [
            [_word_sim(old_short[ii], new_short[jj]) for jj in range(len(unmatched_new))]
            for ii in range(len(unmatched_old))
        ]

        no, nn = len(unmatched_old), len(unmatched_new)
        dp = [[0.0] * (nn + 1) for _ in range(no + 1)]
        for ii in range(1, no + 1):
            for jj in range(1, nn + 1):
                dp[ii][jj] = max(
                    dp[ii-1][jj-1] + sim[ii-1][jj-1],
                    dp[ii-1][jj],
                    dp[ii][jj-1],
                )
        ii, jj = no, nn
        while ii > 0 and jj > 0:
            if dp[ii][jj] == dp[ii-1][jj-1] + sim[ii-1][jj-1]:
                aligned_pairs[unmatched_old[ii-1]] = (unmatched_old[ii-1], unmatched_new[jj-1])
                new_used.add(unmatched_new[jj-1])
                ii -= 1; jj -= 1
            elif dp[ii-1][jj] >= dp[ii][jj-1]:
                ii -= 1
            else:
                jj -= 1

    # Fill still-unmatched old chunks as (i, None), append new-only as (None, j)
    for i in range(n_old):
        if aligned_pairs[i] is None:
            aligned_pairs[i] = (i, None)
    for j in range(n_new):
        if j not in new_used:
            aligned_pairs.append((None, j))

    # Filter out any None placeholders (shouldn't happen but safety check)
    aligned_pairs = [p for p in aligned_pairs if p is not None]  # type: ignore

    logger.info(
        "chunk_pdfs_and_xml: aligned %d pairs from %d old + %d new chunks",
        len(aligned_pairs), n_old, n_new,
    )

    # Build lookup dicts: index → (text, heading)
    old_by_idx: dict[int, tuple[str, str]] = {
        i: (old_chunks[i], old_headings[i]) for i in range(n_old)
    }
    new_by_idx: dict[int, tuple[str, str]] = {
        i: (new_chunks[i], new_headings[i]) for i in range(n_new)
    }

    # ── Align XML chunks to NEW-PDF chunks by content similarity ─────────────
    # Previously XML chunks were assigned sequentially (chunk 1 → xml 1, etc.)
    # which broke whenever the PDF and XML had different numbers of sections,
    # or when pages didn't map 1-to-1 to XML tags.
    #
    # New strategy: build a similarity matrix between each new-PDF chunk's
    # plain text and each XML chunk's plain text (tags stripped), then find
    # the best monotone 1-to-1 alignment via the same DP used for PDF pairs.
    # Each PDF chunk gets the XML chunk that best matches its content.
    # Unmatched PDF chunks get no XML; unmatched XML chunks are discarded.

    def _strip_xml_tags(s: str) -> str:
        """Remove XML tags and collapse whitespace — for similarity scoring."""
        import re as _re
        return " ".join(_re.sub(r"<[^>]+>", " ", s).split()).lower()

    n_xml = len(xml_chunks)
    xml_by_new_idx: dict[int, dict] = {}   # new-PDF chunk index → best xml chunk

    if n_xml > 0 and n_new > 0:
        # ── XML alignment strategy ────────────────────────────────────────────
        # For UK legislation, full-body trigram Jaccard fails because all parts
        # share the same dense legal vocabulary. Instead we:
        # 1. Extract the heading/title text from each XML chunk (first 200 chars
        #    of stripped text, which typically contains the part/chapter title)
        # 2. Match that against the PDF chunk heading
        # 3. Fall back to sequential assignment when heading match fails

        def _xml_heading(xc: dict) -> str:
            """
            Extract the structural heading from an XML chunk for matching.
            Handles both standard tags (<part>, <chapter>) and Innodata-specific
            tags (<innodLevel last-path="PART 1">, <innodHeading>).
            """
            import re as _re
            content = xc.get("content", "")
            attrs   = xc.get("attributes", {})

            # Innodata: last-path attribute on innodLevel e.g. "PART 1", "CHAPTER 3"
            last_path = attrs.get("last-path", "")
            if last_path:
                return " ".join(last_path.split()).lower()

            # Standard: <innodHeading>, <title>, <heading> element text
            title_m = _re.search(
                r'<(?:innodHeading|title|heading)[^>]*>([^<]{1,120})',
                content, _re.IGNORECASE,
            )
            if title_m:
                raw = _re.sub(r'<[^>]+>', ' ', title_m.group(1))
                return " ".join(raw.split()).lower()

            # Fallback: first 200 chars of stripped content
            return _strip_xml_tags(content)[:200].lower()

        xml_headings = [_xml_heading(xc) for xc in xml_chunks]
        new_headings_norm = [_norm_text(new_headings[j]) for j in range(n_new)]

        # Build exact-match index for XML headings
        xml_heading_index: dict[str, int] = {}
        for xi, xh in enumerate(xml_headings):
            if xh and xh not in xml_heading_index:
                xml_heading_index[xh] = xi

        # Pass 1: exact normalized heading match (e.g. "part 7a" == "part 7a")
        xi_used: set[int] = set()
        for nj in range(n_new):
            nh = new_headings_norm[nj]
            if not nh:
                continue
            xi = xml_heading_index.get(nh, -1)
            if xi >= 0 and xi not in xi_used:
                xml_by_new_idx[nj] = xml_chunks[xi]
                xi_used.add(xi)

        # Pass 2: word-overlap for unmatched (e.g. PDF heading "Part 7A" vs XML "part 7a employment income")
        for nj in range(n_new):
            if nj in xml_by_new_idx:
                continue
            nh = new_headings_norm[nj]
            if not nh:
                continue
            best_score = 0.0
            best_xi = -1
            # Extract the key ordinal token from heading e.g. "7a" from "part 7a"
            nh_tokens = nh.split()
            for xi in range(n_xml):
                if xi in xi_used:
                    continue
                xh = xml_headings[xi]
                # Exact token overlap — every token in PDF heading must appear in XML heading
                matches = sum(1 for t in nh_tokens if t in xh.split())
                score = matches / max(len(nh_tokens), 1)
                if score > best_score and score >= 1.0:  # ALL tokens must match
                    best_score = score
                    best_xi = xi
            if best_xi >= 0:
                xml_by_new_idx[nj] = xml_chunks[best_xi]
                xi_used.add(best_xi)

        # For any unmatched PDF chunks, fall back to trigram similarity on body text
        if len(xml_by_new_idx) < min(n_xml, n_new):
            xml_texts = [_strip_xml_tags(xc.get("content", "")) for xc in xml_chunks]
            new_texts_norm = [_norm_text(new_chunks[j]) for j in range(n_new)]

            xml_sim: list[list[float]] = [
                [_word_sim(xml_texts[i][:500], new_texts_norm[j][:500]) for j in range(n_new)]
                for i in range(n_xml)
            ]
            xdp = [[0.0] * (n_new + 1) for _ in range(n_xml + 1)]
            for xi in range(1, n_xml + 1):
                for nj in range(1, n_new + 1):
                    xdp[xi][nj] = max(
                        xdp[xi-1][nj-1] + xml_sim[xi-1][nj-1],
                        xdp[xi-1][nj],
                        xdp[xi][nj-1],
                    )
            xi, nj = n_xml, n_new
            while xi > 0 and nj > 0:
                if xdp[xi][nj] == xdp[xi-1][nj-1] + xml_sim[xi-1][nj-1]:
                    if nj - 1 not in xml_by_new_idx and xi - 1 not in xi_used:
                        if xml_sim[xi-1][nj-1] > 0.03:
                            xml_by_new_idx[nj-1] = xml_chunks[xi-1]
                    xi -= 1; nj -= 1
                elif xdp[xi-1][nj] >= xdp[xi][nj-1]:
                    xi -= 1
                else:
                    nj -= 1

        # Last resort: sequential assignment for any still-unmatched PDF chunks
        seq_xi = 0
        for nj in range(n_new):
            if nj not in xml_by_new_idx:
                while seq_xi in xi_used and seq_xi < n_xml:
                    seq_xi += 1
                if seq_xi < n_xml:
                    xml_by_new_idx[nj] = xml_chunks[seq_xi]
                    seq_xi += 1

        logger.info(
            "chunk_pdfs_and_xml: xml-aligned %d/%d xml chunks to pdf chunks",
            len(xml_by_new_idx), n_xml,
        )

    # 6 — Build aligned result chunks from similarity pairs
    result_chunks: list[dict[str, Any]] = []
    safe_source = _sanitize_source_name(source_name)

    total_pairs = len(aligned_pairs)
    for chunk_index, (oi, ni) in enumerate(aligned_pairs, start=1):
        # Emit progress: 40% → 95% spread across all chunks
        chunk_pct = 40 + int((chunk_index / max(total_pairs, 1)) * 55)
        _emit(chunk_pct, f"Processing chunk {chunk_index} of {total_pairs}")

        old_text_chunk = old_by_idx[oi][0] if oi is not None else ""
        old_heading    = old_by_idx[oi][1] if oi is not None else ""
        new_text_chunk = new_by_idx[ni][0] if ni is not None else ""
        new_heading    = new_by_idx[ni][1] if ni is not None else ""

        # Trim chunk text to start at its own heading — removes any preamble
        # bleed from the previous page/chunk that inflates word counts.
        # We do this ONCE here so both word-count computation and _classify_chunk_changes
        # work on the same clean text (no double-trimming needed later).
        if old_heading and old_text_chunk:
            old_text_chunk = _trim_chunk_to_heading(old_text_chunk, old_heading)
        if new_heading and new_text_chunk:
            new_text_chunk = _trim_chunk_to_heading(new_text_chunk, new_heading)

        # Canonical heading: prefer old heading (the "source of truth" document),
        # fall back to new heading, then a numbered fallback.
        # IMPORTANT: for chunks where one side has no counterpart (oi=None or
        # ni=None), the canonical heading must come from whichever side exists.
        # Previously "Chunk N" appeared whenever new_heading was also empty —
        # this happened when the DP alignment left an old Part 14 unmatched and
        # appended it as (None, j) with an empty new heading.
        canonical_heading = (
            old_heading.strip()
            or new_heading.strip()
            or (f"Part {chunk_index}" if tag_name.lower() == "part" else f"Chunk {chunk_index}")
        )

        # XML chunk: use content-aligned match (keyed on new-PDF chunk index)
        xml_chunk = xml_by_new_idx.get(ni) if ni is not None else None

        filename = _build_xml_chunk_filename(source_name, chunk_index)
        xml_chunk_content = xml_chunk["content"] if xml_chunk else ""

        # ── Compute page ranges FIRST (needed by span detection) ─────────────
        hkey_old = _norm_heading(old_heading) if old_heading else ""
        hkey_new = _norm_heading(new_heading) if new_heading else ""

        old_chunk_page_start: int | None = old_page_by_hkey.get(hkey_old) or (1 if chunk_index == 1 else None)
        new_chunk_page_start: int | None = new_page_by_hkey.get(hkey_new) or (1 if chunk_index == 1 else None)

        old_chunk_page_end: int | None = None
        new_chunk_page_end: int | None = None

        if chunk_index < len(aligned_pairs):
            next_oi, next_ni = aligned_pairs[chunk_index]
            next_hkey_old = _norm_heading(old_by_idx[next_oi][1]) if next_oi is not None else ""
            next_hkey_new = _norm_heading(new_by_idx[next_ni][1]) if next_ni is not None else ""
            next_old_start = old_page_by_hkey.get(next_hkey_old)
            next_new_start = new_page_by_hkey.get(next_hkey_new)
            old_chunk_page_end = next_old_start if next_old_start else old_total_pages
            new_chunk_page_end = next_new_start if next_new_start else new_total_pages
        else:
            old_chunk_page_end = old_total_pages
            new_chunk_page_end = new_total_pages

        line_change_info = _classify_chunk_changes(
            old_text_chunk, new_text_chunk,
            old_heading="",
            new_heading="",
        )
        has_changes      = bool(line_change_info["change_types"])
        detected_changes: list[dict] = []   # populated on-demand by /detect-chunk
        detect_summary: dict = {
            "addition":     line_change_info["change_summary"].get("addition", 0),
            "removal":      line_change_info["change_summary"].get("removal", 0),
            "modification": line_change_info["change_summary"].get("modification", 0),
            "emphasis":     line_change_info["change_summary"].get("emphasis", 0),
            "mismatch": 0,
        }

        xml_chunk_file = _build_xml_chunk_content(
            source_name=source_name,
            chunk_index=chunk_index,
            xml_content=xml_chunk_content,
            has_changes=has_changes,
        ) if xml_chunk_content.strip() else ""

        # Build chunk_change_info from line-diff
        if has_changes:
            chunk_change_info = line_change_info
        else:
            chunk_change_info = {"change_types": [], "change_summary": {"addition": 0, "removal": 0, "modification": 0, "emphasis": 0}}

        result_chunks.append({
            "index":             chunk_index,
            "label":             f"chunk{str(chunk_index).zfill(2)}",
            "filename":          filename,
            "old_text":          old_text_chunk,
            "new_text":          new_text_chunk,
            "old_heading":       canonical_heading,
            "new_heading":       canonical_heading,
            # Raw per-side headings — used by the modal to detect misalignment
            # (e.g. old Part 14 paired with new Part 13 shows both labels).
            "old_heading_raw":   old_heading.strip() or canonical_heading,
            "new_heading_raw":   new_heading.strip() or canonical_heading,
            "has_changes":       has_changes,
            "change_types":      chunk_change_info["change_types"],
            "change_summary":    chunk_change_info["change_summary"],
            "xml_content":       xml_chunk_content,
            "xml_chunk_file":    xml_chunk_file,
            "xml_tag":           xml_chunk["tag"]        if xml_chunk else "",
            "xml_attributes":    xml_chunk["attributes"] if xml_chunk else {},
            "xml_size":          xml_chunk["size"]       if xml_chunk else 0,
            # Separate page ranges for each PDF
            "page_start":        old_chunk_page_start,
            "page_end":          old_chunk_page_end,
            "old_page_start":    old_chunk_page_start,
            "old_page_end":      old_chunk_page_end,
            "new_page_start":    new_chunk_page_start,
            "new_page_end":      new_chunk_page_end,
            # Anchor texts — first heading of this chunk, used to trim spans during detect
            "old_anchor":        old_heading or canonical_heading,
            "new_anchor":        new_heading or canonical_heading,
            # Pre-computed span-level changes — consumed directly by ComparePanel
            # so it never needs to call /detect on chunk open.
            "detected_changes":  detected_changes,
            "detect_summary":    detect_summary,
        })

    changed   = sum(1 for c in result_chunks if c["has_changes"])
    unchanged = len(result_chunks) - changed
    _tick(f"TOTAL ({len(result_chunks)} chunks, {changed} changed)")

    folder_base = f"Documents/Innodata/{safe_source}"

    return {
        "pdf_chunks": result_chunks,
        "summary": {
            "total":     len(result_chunks),
            "changed":   changed,
            "unchanged": unchanged,
        },
        "old_pdf_chunk_count": len(old_chunks),
        "new_pdf_chunk_count": len(new_chunks),
        "xml_chunk_count":     len(xml_chunks),
        "source_name":         source_name,
        "folder_structure": {
            "base":    folder_base,
            "chunked": f"{folder_base}/CHUNKED",
            "compare": f"{folder_base}/COMPARE",
            "merge":   f"{folder_base}/MERGE",
        },
    }


# ── PDF Compare / Merge helpers ────────────────────────────────────────────────

def _text_to_xml(text: str) -> str:
    """
    Wrap plain extracted PDF text into a simple XML document so it can be
    processed by compare_xml / merge_xml.  Each non-empty paragraph becomes a
    <paragraph> element.
    """
    import html as _html

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text.strip()] if text.strip() else ["(empty)"]

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<document>"]
    for i, para in enumerate(paragraphs):
        escaped = _html.escape(para)
        lines.append(f'  <paragraph index="{i}">{escaped}</paragraph>')
    lines.append("</document>")
    return "\n".join(lines)


def compare_pdfs_with_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes,
) -> dict:
    """
    Extract text from two PDF files, run a structural + line-level diff, and
    include the raw XML file for sidebar reference.

    Returns a dict matching the /compare/diff JSON contract:
      {
        "diff":         { additions, removals, modifications, mismatches, summary },
        "line_diff":    [ … ],
        "xml_content":  str,   # raw XML for reference display
      }
    """
    from src.services.xml_compare import compare_xml, line_diff as xml_line_diff

    old_text = _extract_pdf_text(old_pdf_bytes)
    new_text = _extract_pdf_text(new_pdf_bytes)

    # Line-level diff on raw extracted text
    lines = xml_line_diff(old_text, new_text)

    # Structural diff by wrapping paragraphs in XML
    old_xml = _text_to_xml(old_text)
    new_xml = _text_to_xml(new_text)
    diff = compare_xml(old_xml, new_xml)

    xml_content = ""
    try:
        xml_content = xml_bytes.decode("utf-8")
    except Exception:
        pass

    return {
        "diff": diff,
        "line_diff": lines,
        "xml_content": xml_content,
    }


def merge_pdfs_with_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes,
    accept: list,
    reject: list,
) -> str:
    """
    Merge the PDF-derived XML representations based on accept/reject decisions.
    The supplied XML file is used as an initial reference; the merge result is
    the paragraph-level XML derived from the two PDFs with changes applied.

    Returns a merged XML string.
    """
    from src.services.xml_compare import merge_xml

    old_text = _extract_pdf_text(old_pdf_bytes)
    new_text = _extract_pdf_text(new_pdf_bytes)

    old_xml = _text_to_xml(old_text)
    new_xml = _text_to_xml(new_text)

    return merge_xml(old_xml, new_xml, accept, reject)


# ── Span-level PDF change detection ────────────────────────────────────────────

def _extract_pdf_spans(
    pdf_bytes: bytes,
    page_start: Optional[int] = None,
    page_end:   Optional[int] = None,
) -> list[dict]:
    """
    Extract every text span from a PDF with its font / colour metadata.
    page_start / page_end (1-based, inclusive) constrain extraction to a page range.
    """
    spans: list[dict] = []
    page_count = 0
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        # Convert to 0-based index range
        p0 = (page_start - 1) if page_start is not None else 0
        p1 = (page_end - 1)   if page_end   is not None else page_count - 1
        p0 = max(0, p0)
        p1 = min(page_count - 1, p1)
        for page_num in range(p0, p1 + 1):
            page = doc[page_num]
            # Collect underline / strikethrough annotation rects for this page
            underline_rects: list = []
            strikeout_rects: list = []
            try:
                for annot in page.annots():
                    atype = annot.type[1] if annot.type else ""
                    if atype == "Underline":
                        underline_rects.append(annot.rect)
                    elif atype in ("StrikeOut", "StrikeThrough"):
                        strikeout_rects.append(annot.rect)
            except Exception:
                pass

            def _bbox_overlaps(bbox: list, rects: list) -> bool:
                for r in rects:
                    if bbox[0] < r.x1 and bbox[2] > r.x0 and bbox[1] < r.y1 and bbox[3] > r.y0:
                        return True
                return False

            try:
                raw = page.get_text("rawdict", flags=0)
                # For UK legislation PDFs, pre-build a set of block y0 values to skip
                # (footnote overflow blocks at top of page, footnote body blocks)
                _legis = _is_legislation_pdf(pdf_bytes) if page_num == p0 else getattr(_extract_pdf_spans, '_legis_cache', False)
                if page_num == p0:
                    _extract_pdf_spans._legis_cache = _legis  # type: ignore[attr-defined]

                for block in raw.get("blocks", []):
                    if block.get("type") != 0:        # 0 = text block
                        continue

                    # Legislation PDF: skip footnote/annotation blocks entirely
                    if _legis:
                        bx0  = block.get("bbox", [0, 0, 0, 0])[0]
                        by0  = block.get("bbox", [0, 0, 0, 0])[1]
                        # Collect full block text for pattern matching
                        btxt = " ".join(
                            sp.get("text", "")
                            for ln in block.get("lines", [])
                            for sp in ln.get("spans", [])
                        ).strip()
                        cls  = _classify_legislation_block(bx0, by0, btxt)
                        if cls == "SKIP":
                            continue
                        # Also skip footnote reference markers inline (Fn labels)
                        if _LEGISLATION_FOOTNOTE_REF.match(btxt):
                            continue

                    for line in block.get("lines", []):
                        raw_spans = line.get("spans", [])
                        if not raw_spans:
                            continue

                        # Detect character-level PDF encoding: if most spans are
                        # 1 character wide, merge them into a single line span so
                        # the SequenceMatcher gets meaningful units to compare.
                        nonempty = [s for s in raw_spans if s.get("text", "").strip()]
                        char_level = nonempty and (
                            sum(len(s.get("text", "").strip()) for s in nonempty) / len(nonempty) < 2
                        )

                        if char_level:
                            # Merge all spans in this line into one synthetic span,
                            # inheriting formatting from the first non-empty span.
                            merged_text = "".join(s.get("text", "") for s in raw_spans)
                            merged_stripped = merged_text.strip()
                            if not merged_stripped:
                                continue
                            first = nonempty[0]
                            f = first.get("flags", 0)
                            c = first.get("color", 0)
                            bbox = list(first.get("bbox", [0, 0, 0, 0]))
                            spans.append({
                                "text":          merged_text,
                                "text_norm":     " ".join(merged_stripped.split()).lower(),
                                "bold":          bool(f & 0x10),
                                "italic":        bool(f & 0x02),
                                "underline":     _bbox_overlaps(bbox, underline_rects),
                                "strikethrough": _bbox_overlaps(bbox, strikeout_rects),
                                "color":         c,
                                "is_colored":    c not in (0, 16777215),
                                "size":          round(first.get("size", 12), 1),
                                "page":          page_num + 1,
                                "bbox":          bbox,
                            })
                        else:
                            for span in raw_spans:
                                text = span.get("text", "")
                                stripped = text.strip()
                                if not stripped:
                                    continue
                                flags  = span.get("flags", 0)
                                color  = span.get("color", 0)
                                bbox   = list(span.get("bbox", [0, 0, 0, 0]))
                                spans.append({
                                    "text":          text,
                                    "text_norm":     " ".join(stripped.split()).lower(),
                                    "bold":          bool(flags & 0x10),
                                    "italic":        bool(flags & 0x02),
                                    "underline":     _bbox_overlaps(bbox, underline_rects),
                                    "strikethrough": _bbox_overlaps(bbox, strikeout_rects),
                                    "color":         color,
                                    "is_colored":    color not in (0, 16777215),  # not black/white
                                    "size":          round(span.get("size", 12), 1),
                                    "page":          page_num + 1,
                                    "bbox":          bbox,
                                })
            except Exception:
                # Fallback: plain text extraction when rawdict fails for this page
                try:
                    plain = page.get_text("text") or ""
                    for line in plain.splitlines():
                        stripped = line.strip()
                        if not stripped:
                            continue
                        spans.append({
                            "text":          stripped,
                            "text_norm":     " ".join(stripped.split()).lower(),
                            "bold":          False,
                            "italic":        False,
                            "underline":     False,
                            "strikethrough": False,
                            "color":         0,
                            "is_colored":    False,
                            "size":          12.0,
                            "page":          page_num + 1,
                            "bbox":          [0, 0, 0, 0],
                        })
                except Exception:
                    pass
        doc.close()
    except Exception as exc:
        logger.warning("PDF span extraction failed: %s", exc)
    logger.debug("Extracted %d spans from PDF (%d pages)", len(spans), page_count)
    return spans


def _parse_xml_tree(xml_content: str):
    """
    Parse xml_content into an ElementTree root, returning None on any error.
    Shared by _find_xml_path_for_text and callers that want to avoid re-parsing.
    """
    from xml.etree import ElementTree as ET
    if not xml_content or not xml_content.strip():
        return None
    try:
        return ET.fromstring(xml_content)
    except Exception:
        return None


def _find_xml_path_for_text(
    xml_content: str,
    search: str,
    *,
    _root=None,  # pre-parsed root; avoids re-parsing for every call
) -> str | None:
    """
    Return the XPath-like path of the deepest XML element whose concatenated
    text content best matches *search* (case-insensitive, fuzzy).
    Uses SequenceMatcher to handle whitespace/line-break differences.
    Returns None when no acceptable match is found or the XML is invalid.
    """
    import difflib

    if not search:
        return None
    needle = " ".join(search.split()).lower()
    # Skip very short tokens — too noisy for path mapping
    if not needle or len(needle) < 3:
        return None

    root = _root if _root is not None else _parse_xml_tree(xml_content)
    if root is None:
        return None

    best_path: str | None = None
    best_score: float = 0.0
    _MAX_DEPTH = 200  # guard against pathological deeply-nested XML

    def _visit(elem, path: str, depth: int) -> None:
        nonlocal best_path, best_score
        if depth > _MAX_DEPTH:
            return
        try:
            full = " ".join(("".join(elem.itertext())).split()).lower()
        except Exception:
            return
        if not full:
            return
        # Substring match gives a guaranteed score boost
        if needle in full:
            ratio = 1.0 - (len(full) - len(needle)) / max(len(full), 1) * 0.3
        else:
            ratio = difflib.SequenceMatcher(None, needle, full).ratio()
        # Prefer deeper (more specific) elements, break ties in favour of children
        if ratio > best_score and ratio > 0.35:
            best_score = ratio
            best_path = path
        for idx, child in enumerate(elem):
            try:
                tag = child.tag if isinstance(child.tag, str) else "node"
            except Exception:
                tag = "node"
            _visit(child, f"{path}/{tag}[{idx}]", depth + 1)

    _visit(root, f"/{root.tag}", 0)
    return best_path


def _build_xml_text_index(xml_content: str, xml_root) -> list[dict]:
    """
    Pre-build a flat index of {path, norm, full} for every element in xml_root.
    Built once per detect call; queried per change — much faster than re-parsing.
    Sorted deepest (most specific) element first.
    """
    if xml_root is None:
        return []
    index: list[dict] = []
    _MAX_DEPTH = 200

    def _visit(elem, path: str, depth: int) -> None:
        if depth > _MAX_DEPTH:
            return
        try:
            full = "".join(elem.itertext())
            norm = " ".join(full.split()).lower()
        except Exception:
            return
        if norm:
            index.append({"path": path, "norm": norm, "full": full})
        for idx, child in enumerate(elem):
            try:
                tag = child.tag if isinstance(child.tag, str) else "node"
            except Exception:
                tag = "node"
            _visit(child, f"{path}/{tag}[{idx}]", depth + 1)

    _visit(xml_root, f"/{xml_root.tag}", 0)
    index.sort(key=lambda x: x["path"].count("/"), reverse=True)
    return index


def _find_xml_path_for_text_indexed(text: str, xml_index: list[dict]) -> str | None:
    """
    Fast O(n) xml-path lookup using a pre-built index.
    Pass 1: exact substring (deepest match wins). Pass 2: fuzzy ratio > 0.40.
    """
    import difflib
    if not text or not xml_index:
        return None
    needle = " ".join(text.split()).lower()
    if len(needle) < 3:
        return None
    for entry in xml_index:
        if needle in entry["norm"]:
            return entry["path"]
    best_path:  str | None = None
    best_score: float = 0.0
    for entry in xml_index:
        ratio = difflib.SequenceMatcher(None, needle, entry["norm"]).ratio()
        if ratio > best_score and ratio > 0.40:
            best_score = ratio
            best_path  = entry["path"]
    return best_path


def _emphasis_tag(span: dict) -> str | None:
    """
    Return a suggested XML emphasis fragment for the given span.

    Maps PDF formatting to standard XML emphasis tags:
      bold          → <b>
      italic        → <i>
      underline     → <u>
      strikethrough → <s>
      colored       → <em>  (only when no other tag applies)
    """
    tags: list[str] = []
    if span.get("bold"):
        tags.append("b")
    if span.get("italic"):
        tags.append("i")
    if span.get("underline"):
        tags.append("u")
    if span.get("strikethrough"):
        tags.append("s")
    if span.get("is_colored") and not tags:
        tags.append("em")
    if not tags:
        return None
    text   = span.get("text", "…").strip()
    open_  = "".join(f"<{t}>" for t in tags)
    close_ = "".join(f"</{t}>" for t in reversed(tags))
    return f"{open_}{text}{close_}"


def _spans_to_lines(spans: list[dict]) -> list[dict]:
    """
    Merge raw PDF spans into logical lines.

    WHY THIS EXISTS
    ───────────────
    PyMuPDF splits text into spans at every font/colour/size boundary.
    A single sentence like "The **quick** brown fox" becomes 3–5 spans.
    Comparing spans directly with SequenceMatcher produces massive false
    positives because adjacent spans look completely different even though
    they belong to the same unchanged sentence.

    This function groups consecutive spans that share the same PDF line
    (same block + line index) into one "line" dict that carries:
      • the full joined text of the line
      • a normalised version for diffing
      • the constituent spans (for formatting lookup)
      • page number and first bbox

    The result is a list of line-level units — one entry per visual line
    in the PDF — which is what you naturally compare when proof-reading.
    """
    if not spans:
        return []

    lines: list[dict] = []
    # Group by (page, block_bbox_y0, line_bbox_y0) — a stable identity for
    # a visual line even across re-encoded PDFs.
    # We use a simple sequential merge: consecutive spans whose y-centres
    # are within 2pt of each other are on the same line.

    def _y_centre(bbox: list) -> float:
        return (bbox[1] + bbox[3]) / 2.0 if len(bbox) >= 4 else 0.0

    current_page:   int         = spans[0]["page"]
    current_y:      float       = _y_centre(spans[0]["bbox"])
    current_spans:  list[dict]  = []

    def _flush(buf: list[dict]) -> None:
        if not buf:
            return
        joined      = " ".join(s["text"].strip() for s in buf if s["text"].strip())
        joined_norm = " ".join(joined.lower().split())
        if not joined_norm:
            return

        # ── Majority-vote formatting ───────────────────────────────────────────
        # A line is bold/italic/etc. if >40% of its characters carry that attribute.
        # Using character weight (not "longest span") eliminates false "emphasis
        # changed" flags where one PDF edition splits a heading into more spans
        # and the longest non-bold span incorrectly wins the dominant-span vote.
        total_chars         = sum(len(s.get("text","").strip()) for s in buf) or 1
        bold_chars          = sum(len(s["text"].strip()) for s in buf if s.get("bold"))
        italic_chars        = sum(len(s["text"].strip()) for s in buf if s.get("italic"))
        underline_chars     = sum(len(s["text"].strip()) for s in buf if s.get("underline"))
        strikethrough_chars = sum(len(s["text"].strip()) for s in buf if s.get("strikethrough"))
        colored_chars       = sum(len(s["text"].strip()) for s in buf if s.get("is_colored"))
        THRESHOLD = 0.40
        dominant = max(buf, key=lambda s: len(s.get("text", "")))  # color/size fallback
        lines.append({
            "text":          joined,
            "text_norm":     joined_norm,
            "page":          buf[0]["page"],
            "bbox":          buf[0]["bbox"],
            "spans":         buf,
            "bold":          bold_chars          / total_chars > THRESHOLD,
            "italic":        italic_chars        / total_chars > THRESHOLD,
            "underline":     underline_chars     / total_chars > THRESHOLD,
            "strikethrough": strikethrough_chars / total_chars > THRESHOLD,
            "color":         dominant["color"],
            "is_colored":    colored_chars       / total_chars > THRESHOLD,
            "size":          dominant.get("size", 12.0),
        })

    Y_TOLERANCE = 3.0   # pts — spans within this vertical distance = same line

    for span in spans:
        pg = span["page"]
        y  = _y_centre(span["bbox"])

        if pg != current_page or abs(y - current_y) > Y_TOLERANCE:
            _flush(current_spans)
            current_spans = [span]
            current_page  = pg
            current_y     = y
        else:
            current_spans.append(span)

    _flush(current_spans)

    # ── Sentence-level merging ────────────────────────────────────────────────
    # PDFs frequently wrap long sentences across multiple visual lines.
    # Comparing line-by-line produces false positives when the same sentence
    # is reflowed differently between PDF editions (different margins/fonts).
    #
    # Strategy: if a line does NOT end with terminal punctuation (. ? ! : ;)
    # and the next line is on the SAME page, merge them into one unit.
    # This mirrors how a human reads — one sentence = one comparison unit.
    _TERMINAL = re.compile(r'[.?!;:]\s*$')

    merged_lines: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Accumulate continuation lines on the same page
        while (
            i + 1 < len(lines)
            and lines[i + 1]["page"] == line["page"]
            and not _TERMINAL.search(line["text"].rstrip())
            and len(line["text"]) > 8   # don't merge headings / very short lines
        ):
            next_line = lines[i + 1]
            joined_text      = line["text"].rstrip() + " " + next_line["text"].lstrip()
            joined_norm      = " ".join(joined_text.lower().split())
            all_spans        = line.get("spans", []) + next_line.get("spans", [])
            total_chars      = sum(len(s.get("text","").strip()) for s in all_spans) or 1
            bold_chars       = sum(len(s["text"].strip()) for s in all_spans if s.get("bold"))
            italic_chars     = sum(len(s["text"].strip()) for s in all_spans if s.get("italic"))
            underline_chars  = sum(len(s["text"].strip()) for s in all_spans if s.get("underline"))
            strike_chars     = sum(len(s["text"].strip()) for s in all_spans if s.get("strikethrough"))
            colored_chars    = sum(len(s["text"].strip()) for s in all_spans if s.get("is_colored"))
            THRESHOLD        = 0.40
            dominant         = max(all_spans, key=lambda s: len(s.get("text", ""))) if all_spans else line
            line = {
                "text":          joined_text,
                "text_norm":     joined_norm,
                "page":          line["page"],
                "bbox":          line["bbox"],
                "spans":         all_spans,
                "bold":          bold_chars      / total_chars > THRESHOLD,
                "italic":        italic_chars    / total_chars > THRESHOLD,
                "underline":     underline_chars / total_chars > THRESHOLD,
                "strikethrough": strike_chars    / total_chars > THRESHOLD,
                "color":         dominant.get("color", 0),
                "is_colored":    colored_chars   / total_chars > THRESHOLD,
                "size":          dominant.get("size", 12.0),
            }
            i += 1

        merged_lines.append(line)
        i += 1

    return merged_lines


# ── noise patterns reused across functions ─────────────────────────────────────

_LINE_NOISE = re.compile(
    r'^(?:'
    r'\s*\d{1,4}\s*'                    # bare page numbers
    r'|page\s+\d+(?:\s+of\s+\d+)?'     # "page N of M"
    r'|[^\w]{0,3}'                       # pure punctuation / whitespace
    r')\s*$',
    re.IGNORECASE,
)

_LIGATURE_TABLE = str.maketrans({
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl",
    # Soft hyphen / NBSP — invisible or whitespace in PDFs
    "\u00ad": "",    # soft hyphen (PDF line-break artifact)
    "\u00a0": " ",   # non-breaking space
    # Curly quotes → straight (PDF fonts often encode these differently)
    "\u2019": "'", "\u2018": "'",
    "\u201c": '"',  "\u201d": '"',
    # All dash variants → plain hyphen so "re-enact" == "re–enact" == "re—enact"
    "\u2013": "-",  # en dash
    "\u2014": "-",  # em dash
    "\u2012": "-",  # figure dash
    "\u2015": "-",  # horizontal bar
    "\u2212": "-",  # minus sign
    "\u2026": "...",
    # Bullet / mid-dot variants → plain space (avoid noise in list items)
    "\u2022": " ", "\u00b7": " ", "\u2023": " ",
})


def _norm_line(text: str) -> str:
    """
    Normalise a line for diffing: NFKC + ligatures + collapse whitespace + lowercase.

    Extra rules that boost accuracy:
    • Remove soft-hyphens (U+00AD) inserted by PDF line-break algorithms.
    • Normalise all dash variants (en/em/hyphen-minus) to a plain hyphen so
      "re-enact" and "re–enact" compare equal.
    • Do NOT strip trailing punctuation — preserves sentence boundaries.
    """
    import unicodedata
    text = unicodedata.normalize("NFKC", text).translate(_LIGATURE_TABLE)
    # Remove PDF soft-hyphen line-break artifacts: "hyphen-" + newline joins
    text = re.sub(r"-\s*\n\s*", "", text)   # handles pre-joined strings too
    return " ".join(text.split()).lower()


def detect_pdf_changes(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes = b"",
    # Legacy single range (standalone mode)
    page_start: Optional[int] = None,
    page_end:   Optional[int] = None,
    # Separate ranges for chunk mode
    old_page_start: Optional[int] = None,
    old_page_end:   Optional[int] = None,
    new_page_start: Optional[int] = None,
    new_page_end:   Optional[int] = None,
    # Anchor texts — first heading of this chunk in each PDF
    old_anchor_text: Optional[str] = None,
    new_anchor_text: Optional[str] = None,
) -> dict:
    """
    Compare OLD and NEW PDFs **line by line**.

    Core approach
    ─────────────
    1. Extract spans from each PDF (PyMuPDF rawdict).
    2. Merge spans into visual lines (_spans_to_lines) — this is the key
       change that eliminates span-level false positives.  A "line" is one
       visual row of text as a reader sees it, regardless of how many font
       changes are inside it.
    3. Normalise each line (ligatures, unicode, whitespace, lowercase).
    4. Run difflib.SequenceMatcher on the normalised line list.
    5. For equal lines, do a secondary per-span formatting check to catch
       emphasis changes (bold/italic/underline added or removed).
    6. For changed lines, report a single change entry per line (not per span).

    This produces one change entry per changed sentence/heading/bullet —
    matching how a human reviewer reads a document.
    """
    import difflib

    # ── Resolve page ranges ───────────────────────────────────────────────────
    eff_old_start = old_page_start or page_start
    eff_old_end   = old_page_end   or page_end
    eff_new_start = new_page_start or page_start
    eff_new_end   = new_page_end   or page_end

    old_spans = _extract_pdf_spans(old_pdf_bytes, page_start=eff_old_start, page_end=eff_old_end)
    new_spans = _extract_pdf_spans(new_pdf_bytes, page_start=eff_new_start, page_end=eff_new_end)

    # ── Anchor-text trimming ──────────────────────────────────────────────────
    def _trim_to_anchor(spans: list[dict], anchor: Optional[str]) -> list[dict]:
        if not anchor or not spans:
            return spans
        needle = " ".join(anchor.lower().split())
        for i, s in enumerate(spans):
            if needle[:30] in s["text_norm"] or s["text_norm"][:30] in needle:
                return spans[i:]
        words = [w for w in needle.split() if len(w) > 4]
        if words:
            for i, s in enumerate(spans):
                if any(w in s["text_norm"] for w in words[:3]):
                    return spans[i:]
        return spans

    old_spans = _trim_to_anchor(old_spans, old_anchor_text)
    new_spans = _trim_to_anchor(new_spans, new_anchor_text)

    # ── Merge spans → lines ───────────────────────────────────────────────────
    old_lines = _spans_to_lines(old_spans)
    new_lines = _spans_to_lines(new_spans)

    # ── Drop noise lines (page numbers, blank, pure punctuation) ─────────────
    def _is_noise(line: dict) -> bool:
        t = line["text_norm"]
        return len(t) <= 2 or bool(_LINE_NOISE.match(t))

    old_lines = [l for l in old_lines if not _is_noise(l)]
    new_lines = [l for l in new_lines if not _is_noise(l)]

    # ── Normalise text_norm with ligature fixes ───────────────────────────────
    for l in old_lines:
        l["text_norm"] = _norm_line(l["text"])
    for l in new_lines:
        l["text_norm"] = _norm_line(l["text"])

    logger.debug(
        "detect_pdf_changes: old=%d lines, new=%d lines (after merge+trim)",
        len(old_lines), len(new_lines),
    )

    # ── XML path index (built once, queried per change) ───────────────────────
    xml_content = ""
    try:
        if xml_bytes:
            xml_content = xml_bytes.decode("utf-8")
    except Exception:
        pass

    xml_root  = _parse_xml_tree(xml_content) if xml_content else None
    xml_index = _build_xml_text_index(xml_content, xml_root) if xml_root else []

    # ── Diff ──────────────────────────────────────────────────────────────────
    old_norms = [l["text_norm"] for l in old_lines]
    new_norms = [l["text_norm"] for l in new_lines]

    # isjunk: skip lines that are purely numeric / punctuation / very short
    # as difflib anchors.  These create false-positive "equal" anchors that
    # cause surrounding real changes to misalign.
    # autojunk=False: never auto-discard repeated lines (would break headings).
    def _isjunk(s: str) -> bool:
        return len(s) <= 2 or bool(re.match(r'^[\d\s.,;:\-\(\)]+$', s))

    matcher = difflib.SequenceMatcher(_isjunk, old_norms, new_norms, autojunk=False)

    changes: list[dict] = []
    cid     = 0
    summary: dict[str, int] = {
        "addition": 0, "removal": 0,
        "modification": 0, "emphasis": 0, "mismatch": 0,
    }

    def _fmt(line: dict) -> dict:
        return {
            "bold":          line["bold"],
            "italic":        line["italic"],
            "underline":     line["underline"],
            "strikethrough": line["strikethrough"],
            "color":         line["color"],
            "is_colored":    line["is_colored"],
        }

    def _make(
        ctype:    str,
        text:     str,
        old_line: Optional[dict],
        new_line: Optional[dict],
        page:     int,
    ) -> dict:
        nonlocal cid
        cid += 1

        xml_path = (
            _find_xml_path_for_text_indexed(text, xml_index)
            if xml_index else None
        )

        old_text = old_line["text"].strip() if old_line else None
        new_text = new_line["text"].strip() if new_line else None

        fmt_old  = _fmt(old_line) if old_line else None
        fmt_new  = _fmt(new_line) if new_line else None

        emphasis: list[str] = []
        if new_line:
            if new_line["bold"]:           emphasis.append("bold")
            if new_line["italic"]:         emphasis.append("italic")
            if new_line["underline"]:      emphasis.append("underline")
            if new_line["strikethrough"]:  emphasis.append("strikethrough")
            if new_line["is_colored"] and not emphasis:
                emphasis.append("color")

        # Suggested XML markup
        if ctype in ("modification", "mismatch"):
            if old_text and new_text:
                sug = f"<del>{old_text}</del><ins>{new_text}</ins>"

                # ── Word-level diff tokens for UI rendering ────────────────
                # Computed in backend so the frontend just renders pre-built
                # tokens — no LCS logic in the browser, no crash on long lines.
                try:
                    word_diff_tokens = build_inline_diff(old_text, new_text)
                    wd = compare_words(old_text, new_text)
                    word_diff_result = {
                        "tokens":         word_diff_tokens,
                        "has_changes":    wd["has_changes"],
                        "change_ratio":   wd["change_ratio"],
                        "summary":        wd["summary"],
                        "old_word_count": wd["old_word_count"],
                        "new_word_count": wd["new_word_count"],
                    }
                except Exception:
                    word_diff_result = None
            elif new_text:
                sug = f"<ins>{new_text}</ins>"
                word_diff_result = None
            else:
                sug = None
                word_diff_result = None
        elif ctype == "removal":
            sug = f"<del>{text}</del>"
            word_diff_result = None
        elif ctype == "addition":
            sug = f"<ins>{text}</ins>"
            word_diff_result = None
        elif ctype == "emphasis":
            sug = _emphasis_tag(new_line) if new_line else None
            word_diff_result = None
        else:
            sug = None
            word_diff_result = None

        old_page_num = old_line["page"] if old_line else None
        new_page_num = new_line["page"] if new_line else None

        return {
            "id":             f"chg_{cid:03d}",
            "type":           ctype,
            "text":           text,
            "old_text":       old_text,
            "new_text":       new_text,
            "old_formatting": fmt_old,
            "new_formatting": fmt_new,
            "emphasis":       emphasis,
            "xml_path":       xml_path,
            "page":           page,
            "old_page":       old_page_num,
            "new_page":       new_page_num,
            "suggested_xml":  sug,
            "word_diff":      word_diff_result,
        }

    for op, i1, i2, j1, j2 in matcher.get_opcodes():

        if op == "equal":
            # Lines match — only flag if BOTH bold AND italic changed simultaneously,
            # or a clearly meaningful formatting change occurred.
            # We intentionally IGNORE font-size-only differences (same word, same
            # bold/italic, different size) because size varies across editions.
            for k in range(i2 - i1):
                ol = old_lines[i1 + k]
                nl = new_lines[j1 + k]
                # Count how many formatting axes changed
                fmt_changes = sum([
                    ol["bold"]          != nl["bold"],
                    ol["italic"]        != nl["italic"],
                    ol["underline"]     != nl["underline"],
                    ol["strikethrough"] != nl["strikethrough"],
                ])
                # Only flag as emphasis change if at least one SEMANTIC formatting
                # axis (bold/italic/underline/strikethrough) actually changed.
                # Color-only changes are ignored (colour rendering differs across
                # PDF viewers and doesn't affect document meaning).
                if fmt_changes >= 1:
                    changes.append(_make("emphasis", nl["text"].strip(), ol, nl, nl["page"]))
                    summary["emphasis"] += 1

        elif op == "insert":
            # Lines only in new PDF
            for k in range(j1, j2):
                nl = new_lines[k]
                changes.append(_make("addition", nl["text"].strip(), None, nl, nl["page"]))
                summary["addition"] += 1

        elif op == "delete":
            # Lines only in old PDF
            for k in range(i1, i2):
                ol = old_lines[k]
                changes.append(_make("removal", ol["text"].strip(), ol, None, ol["page"]))
                summary["removal"] += 1

        elif op == "replace":
            # Lines changed — pair them up and classify each pair
            old_block = old_lines[i1:i2]
            new_block = new_lines[j1:j2]
            paired    = min(len(old_block), len(new_block))

            for k in range(paired):
                ol = old_block[k]
                nl = new_block[k]

                # CRITICAL: if normalised text is identical (ignoring trailing
                # punctuation which varies between PDF editions), the lines are
                # the same — only flag as emphasis if formatting actually differs.
                _PUNCT = str.maketrans("", "", ".,;: \t")
                ol_core = ol["text_norm"].translate(_PUNCT)
                nl_core = nl["text_norm"].translate(_PUNCT)
                if ol_core == nl_core:
                    fmt_changes = sum([
                        ol["bold"]          != nl["bold"],
                        ol["italic"]        != nl["italic"],
                        ol["underline"]     != nl["underline"],
                        ol["strikethrough"] != nl["strikethrough"],
                    ])
                    if fmt_changes >= 1:
                        changes.append(_make("emphasis", nl["text"].strip(), ol, nl, nl["page"]))
                        summary["emphasis"] += 1
                    continue  # skip modification/mismatch classification

                ratio = difflib.SequenceMatcher(
                    None, ol["text_norm"], nl["text_norm"]
                ).ratio()
                # ≥ 0.82 similarity → modification (same sentence, words changed).
                # Raised to 0.82 to further cut false "modification" flags on
                # lines that share common legal boilerplate words but are
                # structurally different sentences.
                # < 0.82 similarity → mismatch (structurally different lines).
                ctype = "modification" if ratio >= 0.82 else "mismatch"

                # ── Word-level false-positive guard ───────────────────────
                # Before emitting, verify at least one real word changed.
                # Purely cosmetic diffs (smart quotes, NBSP, ligatures,
                # en-dash vs hyphen) are suppressed to cut false positives.
                meaningful, _wd = chunk_has_real_changes(
                    ol["text"], nl["text"],
                    change_ratio_threshold=0.004,
                    min_changed_words=1,
                )
                if not meaningful:
                    fmt_changes = sum([
                        ol["bold"]          != nl["bold"],
                        ol["italic"]        != nl["italic"],
                        ol["underline"]     != nl["underline"],
                        ol["strikethrough"] != nl["strikethrough"],
                    ])
                    if fmt_changes >= 1:
                        changes.append(_make("emphasis", nl["text"].strip(), ol, nl, nl["page"]))
                        summary["emphasis"] += 1
                    continue  # suppress cosmetic-only false positive

                changes.append(_make(ctype, nl["text"].strip(), ol, nl, nl["page"]))
                summary[ctype] += 1

            # Unpaired old lines → removals
            for ol in old_block[paired:]:
                changes.append(_make("removal", ol["text"].strip(), ol, None, ol["page"]))
                summary["removal"] += 1

            # Unpaired new lines → additions
            for nl in new_block[paired:]:
                changes.append(_make("addition", nl["text"].strip(), None, nl, nl["page"]))
                summary["addition"] += 1

    logger.debug("detect_pdf_changes: %d changes detected: %s", len(changes), summary)

    # ── Full text for the text-diff viewer ───────────────────────────────────
    # Use the layout-aware extractor (_extract_pdf_text) which correctly follows
    # the PDF's block/paragraph structure — including UK legislation footnote
    # filtering, proper paragraph breaks, and heading separation.
    #
    # We do NOT reconstruct from span-merged lines here because that pipeline
    # is tuned for *diffing* (sentence merging, noise suppression) and produces
    # a flat word-stream that loses paragraph and structural context.
    #
    # Page ranges are respected so the viewer shows exactly the same slice that
    # was compared, not the whole document.
    def _spans_to_full_text_fallback(lines: list[dict]) -> str:
        """Emergency fallback: join span lines with page separators and paragraph breaks."""
        parts: list[str] = []
        last_page = None
        prev_text = ""
        for line in lines:
            pg = line.get("page")
            text = line.get("text", "").strip()
            if not text:
                continue
            if pg is not None and pg != last_page:
                if parts:
                    parts.append("")
                parts.append(f"── Page {pg} ──")
                parts.append("")
                last_page = pg
            elif prev_text and (
                prev_text[-1] in ".?!:" or
                re.match(r'^(?:PART|CHAPTER|SECTION|SCHEDULE|\([a-z0-9]+\)|\d+\.)\s', text, re.I)
            ):
                parts.append("")
            parts.append(text)
            prev_text = text
        return "\n".join(parts)

    def _layout_full_text(pdf_bytes: bytes, p_start: Optional[int], p_end: Optional[int], span_lines: list[dict]) -> str:
        try:
            return _extract_pdf_text(pdf_bytes, page_start=p_start, page_end=p_end)
        except Exception as exc:
            logger.warning("_layout_full_text fallback to span reconstruction: %s", exc)
            return _spans_to_full_text_fallback(span_lines)

    old_full_text = _layout_full_text(old_pdf_bytes, eff_old_start, eff_old_end, old_lines)
    new_full_text = _layout_full_text(new_pdf_bytes, eff_new_start, eff_new_end, new_lines)

    return {
        "changes":        changes,
        "xml_content":    xml_content,
        "summary":        summary,
        "old_full_text":  old_full_text,
        "new_full_text":  new_full_text,
    }


# ── XML Validation ─────────────────────────────────────────────────────────────

def validate_xml_chunk(xml_content: str) -> dict:
    """
    Validate an XML chunk for structure, required tags, and syntax.
    Returns { valid: bool, errors: list[str], warnings: list[str] }
    """
    from xml.etree import ElementTree as ET

    errors: list[str] = []
    warnings: list[str] = []

    if not xml_content.strip():
        errors.append("XML content is empty")
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Check syntax
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as exc:
        errors.append(f"XML syntax error: {exc}")
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Check for missing text content
    all_text = "".join(root.itertext()).strip()
    if not all_text:
        warnings.append("XML has no text content")

    # Check for elements missing closing tags (already caught by ParseError, but warn about unusual structures)
    def check_elem(elem: ET.Element, depth: int = 0):
        if depth > 50:
            warnings.append("XML structure is deeply nested (>50 levels)")
            return
        for child in elem:
            check_elem(child, depth + 1)

    check_elem(root)

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


# ── Merge XML chunks ───────────────────────────────────────────────────────────

def merge_xml_chunks(
    chunks: list[dict],
    source_name: str = "Document",
) -> str:
    """
    Merge multiple XML chunks into a single final XML file.

    Parameters
    ----------
    chunks : list of dicts with keys:
        filename  : str  – chunk filename
        xml_content : str  – XML content of the chunk
        has_changes : bool
    source_name : str

    Returns
    -------
    str – merged XML string
    """
    import html as _html
    from xml.etree import ElementTree as ET

    safe_name = _sanitize_source_name(source_name)
    merged_parts: list[str] = []
    missing: list[int] = []

    for i, chunk in enumerate(chunks):
        xml_c = chunk.get("xml_content", "").strip()
        if not xml_c:
            missing.append(i + 1)
            continue

        # Try to parse and extract the inner body
        try:
            root = ET.fromstring(xml_c)
            # Skip XML declaration wrapper if present
            inner = ET.tostring(root, encoding="unicode")
            merged_parts.append(f'  <!-- chunk {i + 1}: {chunk.get("filename", "")} -->\n  {inner}')
        except ET.ParseError:
            # Use raw content if parsing fails
            merged_parts.append(f'  <!-- chunk {i + 1}: {chunk.get("filename", "")} -->\n  {xml_c}')

    missing_comment = ""
    if missing:
        missing_comment = f'  <!-- WARNING: Missing chunks: {missing} -->\n'

    body = "\n".join(merged_parts)
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<!-- Merged: {_html.escape(source_name)}_final.xml -->\n'
        f'<!-- Total chunks: {len(chunks)} | Missing: {len(missing)} -->\n'
        f'<document source="{_html.escape(source_name)}">\n'
        f'{missing_comment}'
        f'{body}\n'
        f'</document>\n'
    )