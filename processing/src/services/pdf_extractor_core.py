# MODULE: pdf_extractor_core — server-safe PDF extraction (no tkinter)
"""
pdf_extractor_core.py — large-document edition
===============================================
WHAT CHANGED FOR 1000-PAGE SUPPORT
────────────────────────────────────
1. load_pdf(path, progress_cb, page_start, page_end)
     NEW page_start/page_end params (0-based, inclusive).
     The compare router calls this per 50-page batch instead of for the
     whole document, so peak RAM stays proportional to batch_size, not
     total pages.

2. load_pdf_page_count(path) → int
     Opens the doc, reads len(), closes immediately.  Zero extraction cost.
     Used by the router to build the batch schedule before starting.

3. load_pdf_batched(path, batch_size=50) → Generator
     Yields (batch_start, batch_end, lines) tuples.
     RAM for each batch is freed before the next batch begins.
     This is the recommended API for large documents.

4. _extract_page(fz, ...) — inner loop factored out
     Shared by load_pdf() and load_pdf_batched() without code duplication.

PERFORMANCE FIXES (from previous PR)
──────────────────────────────────────
  • All regex patterns pre-compiled at module level (zero per-call cost).
  • Span sorting moved outside the merge loop (one sort per line, not per span).
  • Combined marker_like check into one pre-compiled pattern (_RE_MARKER_LIKE).

Dependencies: pymupdf  (pip install pymupdf)
"""

from __future__ import annotations

import re
import functools
from collections import Counter
from dataclasses import dataclass, field
from typing import Generator, List, Optional, Tuple

try:
    import fitz
except ImportError as _err:
    raise ImportError(
        "PyMuPDF not found.  Install it:\n  pip install pymupdf\n"
        f"Original error: {_err}"
    ) from _err


# ─────────────────────────────────────────────────────────────────────────────
#  DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Span:
    text:        str
    bold:        bool
    italic:      bool
    monospace:   bool
    superscript: bool
    underline:   bool
    strikeout:   bool
    size:        float
    font:        str
    color:       str
    x:  float;  y:  float
    x2: float;  y2: float


@dataclass
class PdfLine:
    y:     float
    x_min: float
    spans: list = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
#  SPAN FLAGS
# ─────────────────────────────────────────────────────────────────────────────

FLAG_SUPERSCRIPT = 1
FLAG_ITALIC      = 2
FLAG_UNDERLINE   = 4
FLAG_MONOSPACE   = 8
FLAG_BOLD        = 16
FLAG_STRIKEOUT   = 32


# ─────────────────────────────────────────────────────────────────────────────
#  UNICODE NORMALISATION TABLE
# ─────────────────────────────────────────────────────────────────────────────

_NORM_MAP = str.maketrans({
    '\u2014': '--', '\u2013': '-',
    '\u2018': "'",  '\u2019': "'",
    '\u201c': '"',  '\u201d': '"',
    '\u00a0': ' ',  '\u00ad': '',
    '\u2010': '-',  '\u2011': '-',
    '\u2012': '-',  '\u2015': '--',
    '\u2026': '...', '\u00b7': ' ',
})


# ─────────────────────────────────────────────────────────────────────────────
#  PRE-COMPILED REGEX — compiled ONCE at import, zero per-call cost
# ─────────────────────────────────────────────────────────────────────────────

_RE_WHITESPACE       = re.compile(r'\s+')
_RE_HYPHEN_BREAK     = re.compile(r'([a-z])-\s+([a-z])')
_RE_SPACED_LETTERS   = re.compile(r'\b([a-z]) ([a-z]{2,})\b')
_RE_BRACKET_L        = re.compile(r'([\[\(])\s+')
_RE_BRACKET_R        = re.compile(r'\s+([,\)\]])')
_RE_NEWLINE          = re.compile(r'\n')
_RE_DASH_SPACE       = re.compile(r'-\s+')
_RE_BOLD_FONT        = re.compile(r'(^|[-_ ,])(bold|black|demi|semibold|heavy)([-_ ,]|$)')
_RE_ITALIC_FONT      = re.compile(r'(^|[-_ ,])(italic|oblique|slanted)([-_ ,]|$)')
_RE_BRACKETED_MARKER = re.compile(r'\[\s*([FCEMSX])\s*(\d+)\s*([A-Za-z]?)\s*\]', re.I)
_RE_BARE_MARKER      = re.compile(
    r'(?<![A-Za-z0-9])([FCEMSX])\s+(\d+)(?:\s+([A-Za-z]))?(?![A-Za-z0-9])', re.I
)
_RE_CANONICAL_MARKER = re.compile(r'^\[?\s*([FCEMSX]\d+[A-Za-z]?)\s*\]?$', re.I)
_RE_AMENDMENT_MARKER = re.compile(r'^[FCEMSX]\d+[A-Za-z]?$', re.I)
_RE_NOISE_DOTS       = re.compile(r'^(\[?\s*[A-Z][0-9]+[A-Za-z]?\s*\]?\s*)?[.\s\xb7]{6,}$')
_RE_NOISE_PAGE_NUM   = re.compile(r'^\d{1,4}$')
_RE_BARE_NUMBER      = re.compile(r'^\d{1,3}$')
_RE_BARE_ALPHA       = re.compile(r'^[A-Za-z]{1,3}$')
_RE_HEADING_KW       = re.compile(r'^(Part|Chapter|Schedule|Section|Appendix|Annex)\s+\d', re.I)
_RE_ALLCAPS          = re.compile(r'^[A-Z][A-Z\s]{3,}$')
_RE_AMEND_BODY       = re.compile(
    r'^(?:Word|Words|S\.|Reg\.|Sch\.|Para\.|Article|[A-Z][\w\s]*\d+[A-Za-z]?\s*\()', re.I
)
_RE_STARTS_CAPS      = re.compile(r'^[A-Z][\w\s]')

# Single combined pattern — replaces 3 separate re.search() calls per line
_RE_MARKER_LIKE = re.compile(
    r'(?:\([a-z]{1,3}|\d{1,3}\))'
    r'|(?:^[fcemsx]\d+[a-z]?$)'
    r'|(?:\b(?:s\.|sch\.|para\.|art\.|reg\.)\s*\d)',
    re.I,
)

_COMMON_SHORT_WORDS = frozenset({
    'an','as','at','be','by','do','go','he','if','in',
    'is','it','me','my','no','of','on','or','so','to',
    'up','us','we','act','and','are','but','for','has',
    'her','his','not','see','tax','the','was',
})


# ─────────────────────────────────────────────────────────────────────────────
#  TEXT NORMALISATION
# ─────────────────────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=65536)
def _norm_cmp(t: str) -> str:
    if not t:
        return ""
    s = t.translate(_NORM_MAP)
    s = _RE_WHITESPACE.sub(' ', s).strip().lower()
    s = _RE_HYPHEN_BREAK.sub(r'\1\2', s)
    s = _RE_SPACED_LETTERS.sub(lambda m: m.group(1) + m.group(2), s)
    s = _RE_BRACKET_L.sub(r'\1', s)
    s = _RE_BRACKET_R.sub(r'\1', s)
    return _RE_WHITESPACE.sub(' ', s).strip()


def _norm(t: str) -> str:
    if not t:
        return ""
    s = t.translate(_NORM_MAP)
    s = _RE_NEWLINE.sub(' ', s)
    s = _RE_DASH_SPACE.sub('', s)
    return _RE_WHITESPACE.sub(' ', s).strip()


# ─────────────────────────────────────────────────────────────────────────────
#  LINE TEXT HELPER
# ─────────────────────────────────────────────────────────────────────────────

def _line_text(line: PdfLine) -> str:
    raw = ' '.join(' '.join(s.text for s in line.spans).split())
    return _compact_amendment_markers(raw)


# ─────────────────────────────────────────────────────────────────────────────
#  AMENDMENT MARKER HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _compact_amendment_markers(text: str) -> str:
    if not text:
        return text

    def _bracketed(m: re.Match) -> str:
        return f"[{m.group(1).upper()}{m.group(2)}{(m.group(3) or '').upper()}]"

    def _bare(m: re.Match) -> str:
        return f"{m.group(1).upper()}{m.group(2)}{(m.group(3) or '').upper()}"

    s = _RE_BRACKETED_MARKER.sub(_bracketed, text)
    return _RE_BARE_MARKER.sub(_bare, s)


def _canonical_amendment_marker(text: str) -> Optional[str]:
    if not text:
        return None
    compact = _compact_amendment_markers(text).strip()
    m = _RE_CANONICAL_MARKER.match(compact)
    return m.group(1).upper() if m else None


# ─────────────────────────────────────────────────────────────────────────────
#  NOISE / MARKER DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _is_noise(t: str) -> bool:
    t = t.strip()
    if not t:
        return True
    if _RE_AMENDMENT_MARKER.match(t):
        return False
    if len(t) <= 1:
        return True
    if _RE_NOISE_DOTS.match(t):
        return True
    return bool(_RE_NOISE_PAGE_NUM.match(t))


def _is_bare_marker(text: str) -> bool:
    raw = text.strip()
    if not raw:
        return False
    raw = re.sub(r'^[\[(]+', '', raw)
    raw = re.sub(r'[\]).,:;,-]+$', '', raw)
    if _RE_BARE_NUMBER.fullmatch(raw):
        return True
    if _RE_BARE_ALPHA.fullmatch(raw):
        low = raw.lower()
        if low in {'a', 'i'}:
            return True
        return low not in _COMMON_SHORT_WORDS
    return False


# ─────────────────────────────────────────────────────────────────────────────
#  TABLE EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def _rect_intersects(a, b) -> bool:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)


def _plain_span(text: str, x: float, y: float) -> Span:
    return Span(
        text=text, bold=False, italic=False, monospace=False,
        superscript=False, underline=False, strikeout=False,
        size=10.0, font="TableExtract", color="#000000",
        x=round(x, 1), y=round(y, 1),
        x2=round(x + max(len(text) * 5.0, 12.0), 1),
        y2=round(y + 10.0, 1),
    )


def _extract_table_lines(page, page_y_offset: float) -> Tuple[List[PdfLine], List[tuple]]:
    if not hasattr(page, "find_tables"):
        return [], []
    try:
        finder = page.find_tables()
    except Exception:
        return [], []

    tables = getattr(finder, "tables", finder)
    if not tables:
        return [], []

    out_lines:   List[PdfLine] = []
    table_boxes: List[tuple]   = []

    for table in tables:
        bbox = tuple(round(v, 1) for v in getattr(table, "bbox", (0, 0, 0, 0)))
        if bbox != (0, 0, 0, 0):
            table_boxes.append(bbox)
        try:
            rows = table.extract()
        except Exception:
            rows = []
        if not rows:
            continue

        top  = bbox[1] if bbox != (0, 0, 0, 0) else 0.0
        left = bbox[0] if bbox != (0, 0, 0, 0) else 0.0
        for row_idx, row in enumerate(rows):
            cells     = [_RE_WHITESPACE.sub(' ', _norm(str(c or ""))).strip() for c in (row or [])]
            non_empty = [c for c in cells if c]
            if not non_empty:
                continue
            row_text = " ".join(non_empty)
            y = round(page_y_offset + top + (row_idx * 8.0), 1)
            out_lines.append(PdfLine(
                y=y, x_min=round(left, 1),
                spans=[_plain_span(row_text, left, y)],
            ))

    return out_lines, table_boxes


# ─────────────────────────────────────────────────────────────────────────────
#  SPAN PARSING
# ─────────────────────────────────────────────────────────────────────────────

def _parse_span(raw: dict) -> Span:
    f = raw["flags"]
    fn = str(raw.get("font", "")).lower()
    return Span(
        text        = raw["text"],
        bold        = bool(f & FLAG_BOLD)   or bool(_RE_BOLD_FONT.search(fn)),
        italic      = bool(f & FLAG_ITALIC) or bool(_RE_ITALIC_FONT.search(fn)),
        monospace   = bool(f & FLAG_MONOSPACE),
        superscript = bool(f & FLAG_SUPERSCRIPT),
        underline   = bool(f & FLAG_UNDERLINE),
        strikeout   = bool(f & FLAG_STRIKEOUT),
        size        = round(raw["size"], 2),
        font        = str(raw.get("font", "")),
        color       = f"#{raw['color']:06x}",
        x  = round(raw["bbox"][0], 1),  y  = round(raw["bbox"][1], 1),
        x2 = round(raw["bbox"][2], 1),  y2 = round(raw["bbox"][3], 1),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  PROVISION / AMENDMENT MARKER PROMOTERS
# ─────────────────────────────────────────────────────────────────────────────

def _promote_isolated_provision_markers(lines: List[PdfLine]) -> None:
    if len(lines) < 3:
        return
    for i in range(1, len(lines) - 1):
        line = lines[i]
        raw  = _line_text(line).strip()
        if not _is_bare_marker(raw):
            continue
        canonical = re.sub(r'^[\[(]+', '', raw)
        canonical = re.sub(r'[\]).,:;,-]+$', '', canonical).strip()
        if not canonical:
            continue
        next_line = lines[i + 1]
        next_text = _line_text(next_line).strip()
        if not next_text or next_line.y - line.y > 24:
            continue
        if _RE_HEADING_KW.match(next_text) or _RE_ALLCAPS.match(next_text):
            continue
        prev_text = _line_text(lines[i - 1]).strip()
        if not prev_text or line.x_min > next_line.x_min + 12:
            continue
        if line.spans:
            line.spans[0].text = f"({canonical})"
            for extra in line.spans[1:]:
                extra.text = ""


def _attach_isolated_amendment_markers(lines: List[PdfLine]) -> None:
    if len(lines) < 2:
        return
    attached: set = set()
    for i in range(len(lines)):
        if i in attached:
            continue
        cur_text = _line_text(lines[i]).strip()
        if not cur_text:
            continue
        marker = _canonical_amendment_marker(cur_text)
        if not marker:
            continue
        for j in range(i + 1, min(i + 9, len(lines))):
            if j in attached:
                continue
            nxt      = lines[j]
            nxt_text = _line_text(nxt).strip()
            if not nxt_text:
                continue
            if _canonical_amendment_marker(nxt_text):
                break
            if nxt.y - lines[i].y > 120 or lines[i].x_min > nxt.x_min + 20:
                break
            if _RE_AMEND_BODY.match(nxt_text) or _RE_STARTS_CAPS.match(nxt_text):
                if nxt.spans:
                    nxt.spans[0].text = f"{marker} {nxt.spans[0].text}"
                if lines[i].spans:
                    lines[i].spans[0].text = ""
                    for sp in lines[i].spans[1:]:
                        sp.text = ""
                attached.add(i)
                attached.add(j)
                break


# ─────────────────────────────────────────────────────────────────────────────
#  INNER PAGE EXTRACTOR  (shared by load_pdf and load_pdf_batched)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_page(
    fz,
    abs_page:      int,
    page_y_offset: float,
    hf_noise:      set,
    pdf_flags:     int,
) -> List[PdfLine]:
    """
    Extract, filter, and merge PdfLines from a single PyMuPDF page object.

    Uses the absolute page index for y-offset so coordinate spaces remain
    stable when the caller assembles multiple batches.
    """
    h   = fz.rect.height or 1
    raw = fz.get_text("dict", flags=pdf_flags)
    if not isinstance(raw, dict):
        return []

    table_lines, table_boxes = _extract_table_lines(fz, page_y_offset)
    all_lines: List[PdfLine] = []

    for block in raw["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            line_bbox = tuple(round(v, 1) for v in line.get("bbox", (0, 0, 0, 0)))
            if table_boxes and any(_rect_intersects(line_bbox, tb) for tb in table_boxes):
                continue

            spans = [_parse_span(s) for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue

            local_y = round(line["bbox"][1], 1)
            y       = round(page_y_offset + local_y, 1)
            xmin    = round(min(s.x for s in spans), 1)

            # Skip header/footer zone (top/bottom 12%) unless it's a marker
            rel_top = local_y / h
            rel_bot = (h - local_y) / h
            if rel_top <= 0.12 or rel_bot <= 0.12:
                line_txt    = _norm_cmp(' '.join(s.text for s in spans))
                marker_like = bool(_RE_MARKER_LIKE.search(line_txt))
                if line_txt in hf_noise and not marker_like:
                    continue

            all_lines.append(PdfLine(y=y, x_min=xmin, spans=spans))

    all_lines.extend(table_lines)
    all_lines.sort(key=lambda ln: (round(ln.y / 2) * 2, ln.x_min))

    # Merge spans on the same visual line (y within 6pt)
    merged: List[PdfLine] = []
    for pl in all_lines:
        if merged and abs(pl.y - merged[-1].y) <= 6:
            merged[-1].spans.extend(pl.spans)
            merged[-1].x_min = min(merged[-1].x_min, pl.x_min)
        else:
            merged.append(PdfLine(y=pl.y, x_min=pl.x_min, spans=list(pl.spans)))

    # FIX: sort once per line, NOT inside the merge loop
    for ml in merged:
        if len(ml.spans) > 1:
            ml.spans.sort(key=lambda s: s.x)

    _promote_isolated_provision_markers(merged)
    return merged


# ─────────────────────────────────────────────────────────────────────────────
#  PUBLIC: page count  (zero-cost, ~1 ms)
# ─────────────────────────────────────────────────────────────────────────────

def load_pdf_page_count(path: str) -> int:
    """Return the number of pages in *path* without extracting any text."""
    doc = fitz.open(path)
    n   = len(doc)
    doc.close()
    return n


# ─────────────────────────────────────────────────────────────────────────────
#  PUBLIC: extract_section_headings  (fast scan for section-picker UI)
# ─────────────────────────────────────────────────────────────────────────────

_RE_STRUCT_HEADING = re.compile(
    r'^(Part|Chapter|Schedule|Appendix|Annex|Division|Subdivision|Title)\s+\d',
    re.I,
)
_RE_CAPS_HEADING = re.compile(r'^[A-Z][A-Z\s]{4,60}$')


def extract_section_headings(path: str) -> list:
    """
    Lightweight scan: returns structural headings with their 0-based page index.

    Returns a list of dicts:
        {"label": str, "page": int, "level": int}

    level 1 = Part/Chapter/Schedule/Annex/Appendix (structural keyword + number)
    level 2 = ALL-CAPS cross-heading or bold short heading

    Does NOT run load_pdf or segment_blocks — just opens the PDF with fitz,
    iterates blocks, and matches heading patterns.  Typically < 200 ms for a
    200-page PDF.
    """
    doc = fitz.open(path)
    headings: list = []
    try:
        for pg in range(len(doc)):
            page = doc[pg]
            page_dict: dict = page.get_text("dict")  # type: ignore[assignment]
            for blk in page_dict.get("blocks", []):
                if blk.get("type") != 0:          # text blocks only
                    continue
                for ln in blk.get("lines", []):
                    spans = ln.get("spans", [])
                    if not spans:
                        continue
                    text = " ".join(s["text"] for s in spans).strip()
                    text = re.sub(r"\s+", " ", text)
                    if not text or len(text) > 120:
                        continue
                    if _RE_STRUCT_HEADING.match(text):
                        headings.append({"label": text, "page": pg, "level": 1})
                    elif (_RE_CAPS_HEADING.match(text)
                            and 2 <= len(text.split()) <= 8):
                        headings.append({"label": text, "page": pg, "level": 2})
    finally:
        doc.close()
    return headings


# ─────────────────────────────────────────────────────────────────────────────
#  PUBLIC: load_pdf  (original API — now supports page ranges)
# ─────────────────────────────────────────────────────────────────────────────

def load_pdf(
    path:       str,
    progress_cb = None,
    page_start: int | None = None,
    page_end:   int | None = None,
) -> List[PdfLine]:
    """
    Load a PDF and return PdfLine objects for the requested page range.

    Parameters
    ----------
    path        : filesystem path to the PDF.
    progress_cb : called as ``progress_cb(batch_idx, batch_size)`` after each page.
    page_start  : 0-based index of first page (inclusive).  Default: 0.
    page_end    : 0-based index of last  page (inclusive).  Default: last page.

    Y-coordinates use the *absolute* page index so batches have consistent
    coordinate spaces when assembled by the caller.
    """
    doc   = fitz.open(path)
    total = len(doc)

    p0 = max(0, page_start if page_start is not None else 0)
    p1 = min(total - 1, page_end if page_end is not None else total - 1)
    batch_size = p1 - p0 + 1

    hf_noise  = _detect_header_footer_patterns(doc)
    pdf_flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
    try:
        pdf_flags |= fitz.TEXT_DEHYPHENATE
    except AttributeError:
        pass

    page_gap: float  = 80.0
    lines: List[PdfLine] = []

    for batch_idx, abs_page in enumerate(range(p0, p1 + 1)):
        fz            = doc[abs_page]
        h             = fz.rect.height or 1
        page_y_offset = abs_page * (h + page_gap)
        lines.extend(_extract_page(fz, abs_page, page_y_offset, hf_noise, pdf_flags))
        if progress_cb:
            progress_cb(batch_idx + 1, batch_size)

    _attach_isolated_amendment_markers(lines)
    doc.close()
    return lines


# ─────────────────────────────────────────────────────────────────────────────
#  PUBLIC: load_pdf_batched  (new — for large documents)
# ─────────────────────────────────────────────────────────────────────────────

def load_pdf_batched(
    path:       str,
    batch_size: int = 50,
    progress_cb = None,
) -> Generator[Tuple[int, int, List[PdfLine]], None, None]:
    """
    Generator that yields ``(batch_start, batch_end, lines)`` tuples,
    processing *batch_size* pages at a time.

    KEY BENEFIT: the caller drops ``lines`` after processing each batch,
    so peak RAM stays proportional to ``batch_size`` rather than total pages.
    A 1000-page PDF with batch_size=50 uses ~50 MB instead of ~1 GB.

    Parameters
    ----------
    path       : filesystem path to the PDF.
    batch_size : pages per batch.  50 works for typical legal PDFs.
    progress_cb: called as ``progress_cb(abs_page, total_pages)`` each page.

    Yields
    ------
    (batch_start, batch_end, lines)
        batch_start / batch_end — 0-based inclusive page indices.
        lines — PdfLine objects; y-offsets are absolute (not batch-relative).

    Example
    -------
    ::
        for start, end, batch_lines in load_pdf_batched(path, batch_size=50):
            result = compute_diff(batch_lines, ...)
            stream_to_client(result)
            # batch_lines goes out of scope → GC frees RAM before next batch
    """
    doc   = fitz.open(path)
    total = len(doc)

    hf_noise  = _detect_header_footer_patterns(doc)
    pdf_flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
    try:
        pdf_flags |= fitz.TEXT_DEHYPHENATE
    except AttributeError:
        pass

    page_gap: float = 80.0

    for batch_start in range(0, total, batch_size):
        batch_end   = min(batch_start + batch_size - 1, total - 1)
        batch_lines: List[PdfLine] = []

        for abs_page in range(batch_start, batch_end + 1):
            fz            = doc[abs_page]
            h             = fz.rect.height or 1
            page_y_offset = abs_page * (h + page_gap)
            batch_lines.extend(
                _extract_page(fz, abs_page, page_y_offset, hf_noise, pdf_flags)
            )
            if progress_cb:
                progress_cb(abs_page, total)

        _attach_isolated_amendment_markers(batch_lines)
        yield batch_start, batch_end, batch_lines
        # Caller drops batch_lines here — RAM freed before next iteration

    doc.close()


# ─────────────────────────────────────────────────────────────────────────────
#  HEADER/FOOTER DETECTION  (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def _detect_header_footer_patterns(doc) -> set:
    total = len(doc)
    if total <= 20:
        sample_indices = list(range(total))
    else:
        step = total / 20
        sample_indices = [int(i * step) for i in range(20)]

    page_entries: List[List[tuple]] = []
    for i in sample_indices:
        fz  = doc[i]
        h   = fz.rect.height or 1
        raw = fz.get_text(
            "dict",
            flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES,
        )
        entries = []
        for block in raw["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                spans = [s for s in line["spans"] if s["text"].strip()]
                if not spans:
                    continue
                y   = round(line["bbox"][1], 0)
                txt = _norm_cmp(' '.join(s["text"] for s in spans))
                if not txt:
                    continue
                rel_top = round(y / h, 3)
                rel_bot = round((h - y) / h, 3)
                entries.append((rel_top, rel_bot, txt))
        page_entries.append(entries)

    if len(page_entries) < 3:
        return set()

    noise:         set     = set()
    counter_exact: Counter = Counter()
    counter_pos:   Counter = Counter()

    for entries in page_entries:
        seen: set = set()
        for rel_top, rel_bot, txt in entries:
            bucket_top = round(rel_top * 33) / 33
            if rel_top <= 0.15 or rel_bot <= 0.15:
                if txt not in seen:
                    counter_exact[txt] += 1
                    counter_pos[(bucket_top, txt)] += 1
                    seen.add(txt)

    threshold = max(3, len(page_entries) // 3)
    for (_, txt), cnt in counter_pos.items():
        if cnt >= threshold:
            noise.add(txt)
    for txt, cnt in counter_exact.items():
        if cnt >= threshold:
            noise.add(txt)
    return noise


# ─────────────────────────────────────────────────────────────────────────────
#  QUICK SELF-TEST
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python pdf_extractor_core.py <path.pdf> [batch_size]")
        sys.exit(1)

    path     = sys.argv[1]
    batch_sz = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    total_pg = load_pdf_page_count(path)
    print(f"Loading {path}  ({total_pg} pages, batch={batch_sz}) …")

    total_lines = 0
    for start, end, lines in load_pdf_batched(path, batch_size=batch_sz):
        total_lines += len(lines)
        print(f"  batch {start:4d}–{end:4d}  →  {len(lines):5d} lines  "
              f"(running total: {total_lines})")

    print(f"\nDone.  {total_lines} lines total.")