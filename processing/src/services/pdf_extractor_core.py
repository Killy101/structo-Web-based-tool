# MODULE: pdf_extractor_core — server-safe PDF extraction (no tkinter)
"""
pdf_extractor_core.py
=====================
Server-safe PDF text extraction library.

This module provides the three functions that pdf_chunk.py imports:
    load_pdf(path)      — full block-segmentation pipeline → list[PdfLine]
    _line_text(line)    — PdfLine → plain text string
    _norm_cmp(text)     — normalise text for comparison (lowercase, unicode, etc.)

It is a headless reimplementation of the logic from extractor.py with ALL
tkinter / GUI dependencies removed so it can run inside a FastAPI server.

Dependencies: pymupdf  (pip install pymupdf)
"""

from __future__ import annotations

import re
import functools
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

try:
    import fitz
except ImportError as _fitz_err:
    raise ImportError(
        "PyMuPDF not found. Install it in your venv: "
        "pip install pymupdf\n"
        f"Original error: {_fitz_err}"
    ) from _fitz_err

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
    '\u00a0': ' ',  '\u00ad': '',    # soft hyphen → remove
    '\u2010': '-',  '\u2011': '-',
    '\u2012': '-',  '\u2015': '--',
    '\u2026': '...', '\u00b7': ' ',
})


# ─────────────────────────────────────────────────────────────────────────────
#  TEXT NORMALISATION (used by pdf_chunk.py via _norm_cmp)
# ─────────────────────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=65536)
def _norm_cmp(t: str) -> str:
    """
    Full normalisation for equality comparison:
    - Lowercase
    - Collapse unicode punctuation
    - Dehyphenate line-break artefacts
    - Collapse whitespace
    """
    if not t:
        return ""
    s = t.translate(_NORM_MAP)
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.lower()
    # Fix hard-hyphen line-break artefacts
    s = re.sub(r'([a-z])-\s+([a-z])', r'\1\2', s)
    # Collapse spaced-letter artefacts: "P ART" → "part"
    s = re.sub(r'\b([a-z]) ([a-z]{2,})\b', lambda m: m.group(1) + m.group(2), s)
    # Bracket/space normalisation
    s = re.sub(r'([\[\(])\s+', r'\1', s)
    s = re.sub(r'\s+([,\)\]])', r'\1', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def _norm(t: str) -> str:
    """Light normalisation: unicode chars only, preserve case."""
    if not t:
        return ""
    s = t.translate(_NORM_MAP)
    s = re.sub(r'\n', ' ', s)
    s = re.sub(r'-\s+', '', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


# ─────────────────────────────────────────────────────────────────────────────
#  LINE TEXT HELPER (used by pdf_chunk.py via _line_text)
# ─────────────────────────────────────────────────────────────────────────────

def _line_text(line: PdfLine) -> str:
    """Return the raw display text of a PdfLine."""
    raw = ' '.join(' '.join(s.text for s in line.spans).split())
    return _compact_amendment_markers(raw)


# ─────────────────────────────────────────────────────────────────────────────
#  AMENDMENT MARKER HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _compact_amendment_markers(text: str) -> str:
    """Collapse spaced amendment markers: 'F 1' → 'F1', '[ F 12 A ]' → '[F12A]'"""
    if not text:
        return text

    def _bracketed(m: re.Match) -> str:
        return f"[{m.group(1).upper()}{m.group(2)}{(m.group(3) or '').upper()}]"

    def _bare(m: re.Match) -> str:
        return f"{m.group(1).upper()}{m.group(2)}{(m.group(3) or '').upper()}"

    s = re.sub(
        r'\[\s*([FCEMSX])\s*(\d+)\s*([A-Za-z]?)\s*\]',
        _bracketed, text, flags=re.I,
    )
    s = re.sub(
        r'(?<![A-Za-z0-9])([FCEMSX])\s+(\d+)(?:\s+([A-Za-z]))?(?![A-Za-z0-9])',
        _bare, s, flags=re.I,
    )
    return s


# ─────────────────────────────────────────────────────────────────────────────
#  SPAN PARSING
# ─────────────────────────────────────────────────────────────────────────────

def _parse_span(raw: dict) -> Span:
    f = raw["flags"]
    font_name = str(raw.get("font", ""))
    fn = font_name.lower()

    bold_from_font   = bool(re.search(r'(^|[-_ ,])(bold|black|demi|semibold|heavy)([-_ ,]|$)', fn))
    italic_from_font = bool(re.search(r'(^|[-_ ,])(italic|oblique|slanted)([-_ ,]|$)', fn))

    return Span(
        text        = raw["text"],
        bold        = bool(f & FLAG_BOLD) or bold_from_font,
        italic      = bool(f & FLAG_ITALIC) or italic_from_font,
        monospace   = bool(f & FLAG_MONOSPACE),
        superscript = bool(f & FLAG_SUPERSCRIPT),
        underline   = bool(f & FLAG_UNDERLINE),
        strikeout   = bool(f & FLAG_STRIKEOUT),
        size        = round(raw["size"], 2),
        font        = font_name,
        color       = f"#{raw['color']:06x}",
        x  = round(raw["bbox"][0], 1),  y  = round(raw["bbox"][1], 1),
        x2 = round(raw["bbox"][2], 1),  y2 = round(raw["bbox"][3], 1),
    )


def _plain_span(text: str, x: float, y: float) -> Span:
    return Span(
        text=text, bold=False, italic=False, monospace=False,
        superscript=False, underline=False, strikeout=False,
        size=10.0, font="TableExtract", color="#000000",
        x=round(x, 1), y=round(y, 1),
        x2=round(x + max(len(text) * 5.0, 12.0), 1),
        y2=round(y + 10.0, 1),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  HEADER / FOOTER DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _detect_header_footer_patterns(doc) -> set:
    """Sample pages to find repeating header/footer text."""
    total = len(doc)
    if total <= 20:
        sample_indices = list(range(total))
    else:
        step = total / 20
        sample_indices = [int(i * step) for i in range(20)]

    from collections import Counter
    page_entries: List[List[tuple]] = []
    for i in sample_indices:
        fz = doc[i]
        h  = fz.rect.height or 1
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

    noise: set = set()
    counter_exact: Counter = Counter()
    counter_pos:   Counter = Counter()

    for entries in page_entries:
        seen_this_page: set = set()
        for rel_top, rel_bot, txt in entries:
            bucket_top = round(rel_top * 33) / 33
            if rel_top <= 0.15 or rel_bot <= 0.15:
                if txt not in seen_this_page:
                    counter_exact[txt] += 1
                    counter_pos[(bucket_top, txt)] += 1
                    seen_this_page.add(txt)

    n_sample  = len(page_entries)
    threshold = max(3, n_sample // 3)

    for (_, txt), cnt in counter_pos.items():
        if cnt >= threshold:
            noise.add(txt)
    for txt, cnt in counter_exact.items():
        if cnt >= threshold:
            noise.add(txt)

    return noise


# ─────────────────────────────────────────────────────────────────────────────
#  NOISE DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _is_noise(t: str) -> bool:
    t = t.strip()
    if not t:
        return True
    if re.match(r'^[FCEMSX]\d+[A-Za-z]?$', t, re.I):
        return False
    if len(t) <= 1:
        return True
    if re.match(r'^(\[?\s*[A-Z][0-9]+[A-Za-z]?\s*\]?\s*)?[.\s\xb7]{6,}$', t):
        return True
    if re.match(r'^\d{1,4}$', t):
        return True
    return False


def _is_bare_marker(text: str) -> bool:
    raw = text.strip()
    if not raw:
        return False
    raw = re.sub(r'^[\[(]+', '', raw)
    raw = re.sub(r'[\]).:;,-]+$', '', raw)
    if re.fullmatch(r'\d{1,3}', raw):
        return True
    if re.fullmatch(r'[A-Za-z]{1,3}', raw):
        low = raw.lower()
        if low in {'a', 'i'}:
            return True
        if low in {'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in',
                   'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
                   'up', 'us', 'we', 'act', 'and', 'are', 'but', 'for', 'has',
                   'her', 'his', 'not', 'see', 'tax', 'the', 'was'}:
            return False
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
#  TABLE EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def _rect_intersects(a, b) -> bool:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)


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

    out_lines: List[PdfLine] = []
    table_boxes: List[tuple] = []

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
            cells = []
            for cell in (row or []):
                cell_text = _norm(str(cell or ""))
                cell_text = re.sub(r'\s+', ' ', cell_text).strip()
                cells.append(cell_text)
            if not any(cells):
                continue
            non_empty = [c for c in cells if c]
            if (len(non_empty) >= 2 and
                    re.match(r'^[FCEMSX]\d+[A-Za-z]?$', non_empty[0], re.I)):
                row_text = " ".join(non_empty)
            else:
                row_text = " ".join(c for c in non_empty)
            y = round(page_y_offset + top + (row_idx * 8.0), 1)
            out_lines.append(PdfLine(
                y=y, x_min=round(left, 1),
                spans=[_plain_span(row_text, left, y)],
            ))

    return out_lines, table_boxes


# ─────────────────────────────────────────────────────────────────────────────
#  PROVISION MARKER PROMOTERS
# ─────────────────────────────────────────────────────────────────────────────

def _promote_isolated_provision_markers(lines: List[PdfLine]) -> None:
    if len(lines) < 3:
        return
    _RE_HEADING_KW = re.compile(r'^(Part|Chapter|Schedule|Section|Appendix|Annex)\s+\d', re.I)
    _RE_ALLCAPS    = re.compile(r'^[A-Z][A-Z\s]{3,}$')

    for i in range(1, len(lines) - 1):
        line = lines[i]
        raw  = _line_text(line).strip()
        if not _is_bare_marker(raw):
            continue

        canonical = re.sub(r'^[\[(]+', '', raw)
        canonical = re.sub(r'[\]).:;,-]+$', '', canonical).strip()
        if not canonical:
            continue

        next_line = lines[i + 1]
        next_text = _line_text(next_line).strip()
        if not next_text:
            continue
        if next_line.y - line.y > 24:
            continue
        if _RE_HEADING_KW.match(next_text) or _RE_ALLCAPS.match(next_text):
            continue
        prev_text = _line_text(lines[i - 1]).strip()
        if not prev_text:
            continue
        if line.x_min > next_line.x_min + 12:
            continue

        if line.spans:
            line.spans[0].text = f"({canonical})"
            for extra in line.spans[1:]:
                extra.text = ""


def _attach_isolated_amendment_markers(lines: List[PdfLine]) -> None:
    """Attach standalone F1/C2 markers to the next text line."""
    if len(lines) < 2:
        return

    amend_body_re = re.compile(
        r'^(?:Word|Words|S\.|Reg\.|Sch\.|Para\.|Article|[A-Z][\w\s]*\d+[A-Za-z]?\s*\()',
        re.I,
    )
    attached: set = set()

    for i in range(len(lines)):
        if i in attached:
            continue
        cur      = lines[i]
        cur_text = _line_text(cur).strip()
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
            if nxt.y - cur.y > 120:
                break
            if cur.x_min > nxt.x_min + 20:
                break
            if amend_body_re.match(nxt_text) or re.match(r'^[A-Z][\w\s]', nxt_text):
                if nxt.spans:
                    nxt.spans[0].text = f"{marker} {nxt.spans[0].text}"
                if cur.spans:
                    cur.spans[0].text = ""
                    for sp in cur.spans[1:]:
                        sp.text = ""
                attached.add(i)
                attached.add(j)
                break


def _canonical_amendment_marker(text: str) -> Optional[str]:
    if not text:
        return None
    compact = _compact_amendment_markers(text).strip()
    m = re.match(r'^\[?\s*([FCEMSX]\d+[A-Za-z]?)\s*\]?$', compact, re.I)
    if not m:
        return None
    return m.group(1).upper()


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN LOAD FUNCTION (the one pdf_chunk.py calls)
# ─────────────────────────────────────────────────────────────────────────────

def load_pdf(path: str, progress_cb=None) -> List[PdfLine]:
    """
    Load a PDF file and return a list of PdfLine objects for the whole document.

    This is the function that pdf_chunk.py imports as _extractor_load_pdf.
    It performs:
      1. Header/footer detection and removal
      2. Span extraction with bold/italic/formatting metadata
      3. Table extraction
      4. Line merging (same y-coordinate within 6pt tolerance)
      5. Amendment marker attachment
      6. Provision marker promotion

    Parameters
    ----------
    path : str
        File system path to the PDF.
    progress_cb : callable, optional
        Called as progress_cb(current_page, total_pages) after each page.

    Returns
    -------
    list[PdfLine]
        All lines from all pages concatenated, with y-coordinates offset
        by page number so they are globally unique.
    """
    doc   = fitz.open(path)
    total = len(doc)

    hf_noise = _detect_header_footer_patterns(doc)

    lines:    List[PdfLine] = []
    page_gap: float         = 80.0

    for i in range(total):
        fz  = doc[i]
        h   = fz.rect.height or 1
        page_y_offset = i * (h + page_gap)

        flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
        try:
            flags |= fitz.TEXT_DEHYPHENATE
        except AttributeError:
            pass

        raw = fz.get_text("dict", flags=flags)
        if not isinstance(raw, dict):
            continue
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

                # Skip header/footer lines (top or bottom 12% of page)
                rel_top = local_y / h
                rel_bot = (h - local_y) / h
                if rel_top <= 0.12 or rel_bot <= 0.12:
                    line_txt = _norm_cmp(' '.join(s.text for s in spans))
                    # Keep amendment markers even in header/footer zone
                    marker_like = (
                        bool(re.search(r'\((?:[a-z]{1,3}|\d{1,3})\)', line_txt)) or
                        bool(re.match(r'^[fcemsx]\d+[a-z]?$', line_txt)) or
                        bool(re.search(r'\b(?:s\.|sch\.|para\.|art\.|reg\.)\s*\d', line_txt))
                    )
                    if line_txt in hf_noise and not marker_like:
                        continue

                all_lines.append(PdfLine(y=y, x_min=xmin, spans=spans))

        all_lines.extend(table_lines)

        # Sort by y then x
        all_lines.sort(key=lambda l: (round(l.y / 2) * 2, l.x_min))

        # Merge spans on the same physical line (y within 6pt)
        merged: List[PdfLine] = []
        for pl in all_lines:
            if merged and abs(pl.y - merged[-1].y) <= 6:
                merged[-1].spans.extend(pl.spans)
                merged[-1].x_min = min(merged[-1].x_min, pl.x_min)
                merged[-1].spans.sort(key=lambda s: s.x)
            else:
                merged.append(PdfLine(
                    y=pl.y, x_min=pl.x_min,
                    spans=sorted(pl.spans, key=lambda s: s.x),
                ))

        _promote_isolated_provision_markers(merged)
        lines.extend(merged)

        if progress_cb:
            progress_cb(i + 1, total)

    _attach_isolated_amendment_markers(lines)
    doc.close()
    return lines


# ─────────────────────────────────────────────────────────────────────────────
#  QUICK SELF-TEST  (python pdf_extractor_core.py some.pdf)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python pdf_extractor_core.py <path_to.pdf>")
        sys.exit(1)

    path = sys.argv[1]
    print(f"Loading {path} …")
    pdf_lines = load_pdf(path)
    print(f"Extracted {len(pdf_lines)} lines")
    for line in pdf_lines[:30]:
        print(f"  y={line.y:7.1f}  x={line.x_min:5.1f}  {_line_text(line)[:100]}")