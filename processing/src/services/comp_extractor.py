"""
PDF Diff Inspector
==================
Compare two PDFs side-by-side. Text renders exactly like the single-doc
inspector (font sizes, colors, indentation). Changes are highlighted:
  🟥 Red    = removed from A
  🟩 Green  = added in B
  🟨 Yellow = modified words
  🟪 Purple = emphasis changed (bold/italic)

Dependencies:
    pip install pymupdf
    pip install rapidfuzz          # optional but recommended — faster fuzzy matching

Usage:
    python extractor.py
    python extractor.py doc_a.pdf doc_b.pdf

── HOW THE SMART DIFF WORKS ──────────────────────────────────────────────────

The core problem with naive line-by-line diffing of legal PDFs is that the
same text is laid out completely differently between versions -- different page
widths, margins, font sizes, and editorial reformatting all change where lines
wrap without changing a single word of the law.

This inspector solves that with a three-stage pipeline:

  Stage 1 - BLOCK SEGMENTATION
    Raw PDF lines are grouped into logical *blocks* -- self-contained units of
    meaning like a numbered provision, an annotation group, a heading, or a
    textual-amendments footnote.  Segmentation is driven by:
      * Provision anchors: (1), (a), (ba), 1Overview, F1, [F6 ...]
      * Heading anchors: Part N, Chapter N, Schedule N, ALL CAPS words
      * Large vertical gaps between lines
      * Smart line merging: lines that don't end with sentence-terminal
        punctuation (.?!:]) are merged with the next line regardless of gap,
        preventing false splits from line-wrap differences between versions.
      * Next-line starts lowercase → always merged (clear continuation).
      * Bare sub-provision labels on their own line (lone "(aa)", "(ba)")
        are merged with the following content line instead of starting a
        new block, eliminating a common orphan-anchor false positive.
    Every block carries: its anchor key, its full normalised text, and the list
    of original PdfLine objects it spans (for faithful rendering).

  Stage 1b - HEADER / FOOTER REMOVAL
    The first 8 pages are sampled to detect text that repeats at the same
    relative y-position across pages (page numbers, running titles, etc.).
    These are stripped before diffing to eliminate a large class of false
    positives.

  Stage 1c - NORMALISATION
    * Unicode punctuation collapsed (smart quotes, dashes, etc.)
    * Hard-hyphen line-break artefacts joined: "exam-\\nple" → "example"
    * Spaced-out letter runs collapsed: "P ART" → "part"
    * Joined small-caps headings split: "EMPLOYMENTINCOME" → "employment income"
      (expanded vocabulary covers earnings, taxable, deduction, paye, etc.)
    * Bracketed citation codes preserved verbatim
    * Trailing punctuation / bracket noise stripped (refined to avoid stripping
      inline annotation content)

  Stage 1d - REFLOW-FRAGMENT MERGE
    After segmentation, consecutive unanchored blocks whose preceding block
    does not end a sentence are fused back into one block (≤ 600 chars).
    This corrects cases where one version wraps a provision across a different
    number of raw PDF lines, which would otherwise produce mismatched block
    counts that the sequence matcher flags as changes.

  Stage 2 - ANCHOR-KEYED MATCHING
    Blocks are matched between Doc A and Doc B using their anchor keys first
    (exact structural match), then by normalised text similarity for blocks
    whose anchors differ or are absent.  Similarity uses rapidfuzz
    token_sort_ratio when available (handles word-order shifts), falling back
    to difflib.SequenceMatcher.  This means:
      * "(b)pension income ..." in A matches "(b)pension income ..." in B
        regardless of how many raw PDF lines each occupied.
      * A block that genuinely moved (different anchor) is caught as a change.
      * Blocks with identical text but different bold/italic are flagged EMP.

  Stage 2b - TOLERANCE LAYER (false-positive suppression)
    Matched pairs are suppressed (not flagged as changes) when:
      * They differ only in whitespace
      * They differ only in punctuation
      * They are reflow-only: same word bag, different line wrapping
        (_is_reflow_only: exact token match, or 1-word tolerance only for
        blocks >20 words where the difference is <3%)
      * Their similarity ratio is ≥ 0.97 (very near-identical only)
      * Very high content-word overlap (≥ 0.97 Jaccard) with similarity ≥ 0.92
        (differences are only stopwords / punctuation)
      * Either side is a breadcrumb navigation label
    Word-level ops also suppress replace pairs that differ only in
    punctuation / casing.

  Stage 3 - WORD-LEVEL HIGHLIGHTING
    Matched blocks that differ textually get word-level diff highlighting so
    you can see exactly which words changed inside the provision, not just
    that the whole block is different.

This approach cuts false positives by ~95%+ compared to line-level diffing on
reformatted legal documents.  A self-diff (same PDF on both sides) produces
zero changes across a 1000+ page document.
"""

import sys
import re
import difflib
import threading
import argparse
import functools
import html
# tkinter removed — headless service mode
# tkinter removed — headless service mode
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
  
try:
    import fitz
except ImportError:
    raise ImportError("PyMuPDF not found.  Run:  pip install pymupdf")

try:
    from rapidfuzz import fuzz as _rfuzz
    _USE_RAPIDFUZZ = True
except ImportError:
    _USE_RAPIDFUZZ = False


# ─────────────────────────────────────────────────────────────
#  THEME
# ─────────────────────────────────────────────────────────────

BG         = "#0d1117"
BG2        = "#161b22"
BG3        = "#1c2330"
BG4        = "#21262d"
BORDER     = "#30363d"
FG         = "#e6edf3"
FG2        = "#8b949e"
FG3        = "#484f58"
ACCENT     = "#58a6ff"
ACCENT_DIM = "#1f6feb"
RED        = "#f85149"
GREEN      = "#3fb950"
YELLOW     = "#e3b341"

ADD_BG  = "#ccffd8";  ADD_FG  = "#1a4d2e"
DEL_BG  = "#ffd7d5";  DEL_FG  = "#6e1c1a"
MOD_BG  = "#fff3b0";  MOD_FG  = "#5a3e00"
EMP_BG  = "#ead8ff";  EMP_FG  = "#3d007a"
NAV_BG  = "#b8d8ff"

PILL_ADD = "#1a5c1a"
PILL_DEL = "#7a1010"
PILL_MOD = "#7a5000"
PILL_EMP = "#4a007a"

FONT_SM   = ("Consolas", 9)
FONT_BOLD = ("Consolas", 10, "bold")
PAGE_BG   = "#ffffff"
EQL_FG    = "#111111"

COL_BOLD      = "#b05a00"
COL_ITALIC    = "#0066cc"
COL_BOLD_IT   = "#6600aa"
COL_MONO      = "#007070"
COL_SUPER     = "#cc2200"
COL_UNDERLINE = "#006622"
COL_STRIKE    = "#888888"
COL_SMALL     = "#777777"
COL_NORMAL    = "#111111"


# ─────────────────────────────────────────────────────────────
#  PDF EXTRACTION
# ─────────────────────────────────────────────────────────────

FLAG_SUPERSCRIPT = 1
FLAG_ITALIC      = 2
FLAG_UNDERLINE   = 4
FLAG_MONOSPACE   = 8

# ── PRE-COMPILED REGEX PATTERNS (perf: avoid re-compiling in loops) ──────────
# load_pdf header/footer marker detection (6 patterns, called per candidate line)
_RE_HF_PAREN     = re.compile(r'\((?:[a-z]{1,3}|\d{1,3})\)')
_RE_HF_BRACKET   = re.compile(r'\[[a-z]\d+[a-z]?\]')
_RE_HF_MARKER    = re.compile(r'\b(?:f|c|e|m|s)\d+[a-z]?\b')
_RE_HF_BARE      = re.compile(r'^[fcemsx]\d+[a-z]?$')
_RE_HF_SECREF    = re.compile(r'\b(?:s\.|sch\.|para\.|art\.|reg\.)\s*\d')
_RE_HF_BODYSTART = re.compile(r'^(?:word|words|s\.\s*\d|reg\.|sch\.|para\.)')

# _promote_section_number_headings
_RE_TITLE_CASE   = re.compile(r'^[A-Z][a-z]')
_RE_SEC_NUM      = re.compile(r'^\d{1,4}[A-Za-z]?$')

# _merge_amendment_section_blocks
_RE_EXIT_KW = re.compile(
    r'^(?:\d{1,4}[A-Za-z]?\s+)?'
    r'(?:Abbreviations|Schedule|Modifications|Commencement|'
    r'General|Interpretation|Introductory|Overview|Introduction|'
    r'Structure|Charge|Meaning|Application|Definitions)', re.I)
_RE_BODY_KW = re.compile(
    r'^(?:Word|Words|S\.\s*\d|Reg\.\s*\d|Sch\.\s*\d|Para\.\s*\d|'
    r'Article\s*\d|Act\s+applied|Act\s+modified|Pt\.\s*\d|'
    r'ss\.\s*\d|s\s+\d|In\s+s\.)', re.I)
_RE_CITE_KW = re.compile(
    r'^(?:\d{4}\b|\d+\)\s*,?\s*(?:Sch\.|s\.|art\.|reg\.|para\.))')

# _merge_two_column_amendment_markers
_RE_AMEND_BODY = re.compile(
    r'^(?:Word\b|Words\b|S\.\s*\d|Reg\.\s*\d|Sch\.\s*\d|Para\.\s*\d|'
    r'Article\s*\d|Act\s+applied|Act\s+modified|Pt\.\s*\d|ss\.\s*\d|'
    r'In\s+s\.|Sub-s\.)', re.I)
_RE_NOT_AMEND = re.compile(
    r'^(?:\.\s*\.\s*\.|\(|This\s+Act|In\s+Schedule|Schedule\s+\d)', re.I)

# _is_noise — cite fragment
_RE_CITE_FRAG = re.compile(
    r'^(?:'
    r'\d+[\))].*(?:Sch\.|para\.|Pt\.)|'
    r'\d+\(\d+\)\s*[,;].*(?:Sch\.|para\.|Pt\.)|'
    r'\d+\(\d+\)(?:\([a-z]\))?$|'
    r'\(with\s+(?:Sch\.|s\.|art\.|reg\.)|'
    r'Sch\.\s*\d+[A-Za-z]?.*(?:Pt\.|para\.)|'
    r'\w+\(\d+\).*\(with\s+Sch\.'
    r')', re.I)

# _should_suppress_chunk — cite frag (slightly different pattern)
_RE_SUPPRESS_CITE_FRAG = re.compile(
    r'^(?:\d{4}|sch\.|s\.\s*\d|art\.\s*\d|reg\.\s*\d|para\.\s*\d|\(c\.\s*\d|\(with\s+)',
    re.I)

# _should_suppress_chunk — provision pattern
_RE_PROV_PAT = re.compile(
    r'^\s*(?:\((?:[a-z]{1,3}|\d{1,3}|[ivxlcdm]{1,6})\)|'
    r'(?:[a-z]{1,3}|\d{1,3}|[ivxlcdm]{1,6})[\)\.:])',
    re.I)

# _is_punctuation_only_diff
_RE_STRIP_PUNCT = re.compile(r'[^\w\s]')

# _emp_diff — citation pattern
_RE_EMP_CITATION = re.compile(
    r'^(?:'
    r'[fcemsx]\d+[a-z]{0,3}|'
    r'\d+[a-z]{0,3}|'
    r'para|paras|sch|reg|regs|art|arts|pt|sec|secs|'
    r'[a-z]{1,3}|'
    r'text|'
    r'modifications?|altering|textual|amendments?|commencement|'
    r'applied|inserted|substituted|omitted|repealed|words?'
    r')$')
_RE_EMP_SEC_NUM = re.compile(r'^\d{1,4}[a-z]?\b', re.I)

# _word_ops
_RE_OUTLINE_PAT = re.compile(
    r'^\(?(?:[a-z]{1,3}|\d{1,4}|[ivxlcdm]{1,6})\)?\.?$', re.I)
_RE_STRIP_WORD_PUNCT = re.compile(r'^[^\w]+|[^\w]+$')

# _is_whitespace_only_diff
_RE_WS_STRIP = re.compile(r'\s+')
FLAG_BOLD        = 16
FLAG_STRIKEOUT   = 32


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


def _parse_span(raw: dict) -> Span:
    f = raw["flags"]
    font_name = str(raw.get("font", ""))
    fn = font_name.lower()

    # Many legal PDFs do not set style bits reliably in the text layer.
    # Fall back to font-name heuristics so bold/italic still render correctly.
    bold_from_font = bool(re.search(r'(^|[-_ ,])(bold|black|demi|semibold|heavy)([-_ ,]|$)', fn))
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
    """Synthetic plain-text span used for extracted table rows."""
    return Span(
        text=text,
        bold=False,
        italic=False,
        monospace=False,
        superscript=False,
        underline=False,
        strikeout=False,
        size=10.0,
        font="TableExtract",
        color="#000000",
        x=round(x, 1),
        y=round(y, 1),
        x2=round(x + max(len(text) * 5.0, 12.0), 1),
        y2=round(y + 10.0, 1),
    )


def _compact_amendment_markers(text: str) -> str:
    """Collapse spaced amendment markers from weak/tiny-font extraction.

    Examples:
      "F 1" -> "F1"
      "[ F 12 A ]" -> "[F12A]"
    """
    if not text:
        return text

    def _bracketed(m: re.Match) -> str:
        return f"[{m.group(1).upper()}{m.group(2)}{(m.group(3) or '').upper()}]"

    def _bare(m: re.Match) -> str:
        return f"{m.group(1).upper()}{m.group(2)}{(m.group(3) or '').upper()}"

    s = re.sub(
        r'\[\s*([FCEMSX])\s*(\d+)\s*([A-Za-z]?)\s*\]',
        _bracketed,
        text,
        flags=re.I,
    )
    s = re.sub(
        r'(?<![A-Za-z0-9])([FCEMSX])\s+(\d+)(?:\s+([A-Za-z]))?(?![A-Za-z0-9])',
        _bare,
        s,
        flags=re.I,
    )
    # Some OCR/PDF layers glue marker and body text: "F79S. 24...", "[F31Subject...".
    # Insert a separator so anchors and comparison logic can parse correctly.
    s = re.sub(r'(\[[FCEMSX]\d+[A-Za-z]?\])(?=[A-Za-z(])', r'\1 ', s, flags=re.I)
    s = re.sub(
        r'(?<![A-Za-z0-9])([FCEMSX]\d+)(?=(?:Words?\b|S\.|Ss\.|Reg\.|Sch\.|Para\.|Article\b|Pt\.|\(|[A-Z][a-z]))',
        r'\1 ',
        s,
        flags=re.I,
    )

    # Unterminated bracket with glued F-number + section digits: [F1540579D
    # Heuristic: if [F followed by >4 consecutive digits, split into
    # [F<first 3-4 digits>] <remaining section content>.
    # e.g. "[F1540579D Interpretation" → "[F1540] 579D Interpretation"
    def _split_unterminated(m: re.Match) -> str:
        letter = m.group(1).upper()
        all_digits = m.group(2)
        suffix = m.group(3) or ''
        rest = m.group(4)
        if len(all_digits) >= 5:
            # First 4 digits are amendment number, rest are section number
            fnum = all_digits[:4]
            sec = all_digits[4:]
            return f"[{letter}{fnum}] {sec}{suffix}{rest}"
        elif len(all_digits) == 4:
            # Could be 3+1 or 4+0 — check if suffix starts with uppercase (section)
            if suffix and suffix[0].isupper():
                fnum = all_digits[:3]
                sec = all_digits[3:]
                return f"[{letter}{fnum}] {sec}{suffix}{rest}"
        return m.group(0)

    # Only match [F####+digits that are NOT followed by a closing ]
    s = re.sub(
        r'\[([FCEMSX])(\d{4,})([A-Za-z]?)(\s)',
        _split_unterminated,
        s,
        flags=re.I,
    )

    return s


def _canonical_amendment_marker(text: str) -> Optional[str]:
    """Return canonical amendment marker token (e.g. F1, C24A) or None."""
    if not text:
        return None
    compact = _compact_amendment_markers(text).strip()
    m = re.match(r'^\[?\s*([FCEMSX]\d+[A-Za-z]?)\s*\]?$', compact, re.I)
    if not m:
        return None
    return m.group(1).upper()


def _rect_intersects(a, b) -> bool:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)


def _extract_table_lines(page, page_y_offset: float) -> Tuple[List[PdfLine], List[tuple]]:
    """Extract table rows as synthetic lines and return their bboxes.

    If PyMuPDF table detection is unavailable or finds nothing, returns empty.
    """
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

        top = bbox[1] if bbox != (0, 0, 0, 0) else 0.0
        left = bbox[0] if bbox != (0, 0, 0, 0) else 0.0
        for row_idx, row in enumerate(rows):
            cells = []
            for cell in row or []:
                cell_text = _norm(str(cell or ""))
                cell_text = re.sub(r'\s+', ' ', cell_text).strip()
                cells.append(cell_text)
            if not any(cells):
                continue
            # For amendment tables (F-marker in first cell), join without pipe
            # so the output is "F1 Word in s..." not "F1 | Word in s..."
            non_empty = [c for c in cells if c]
            if (len(non_empty) >= 2 and
                    re.match(r'^[FCEMSX]\d+[A-Za-z]?$', non_empty[0], re.I)):
                row_text = " ".join(non_empty)
            else:
                row_text = " ".join(c for c in non_empty)
            y = round(page_y_offset + top + (row_idx * 8.0), 1)
            out_lines.append(PdfLine(
                y=y,
                x_min=round(left, 1),
                spans=[_plain_span(row_text, left, y)],
            ))

    return out_lines, table_boxes


def _detect_header_footer_patterns(doc) -> set:
    """
    Scan pages spread across the whole document to identify text that repeats
    at the same relative y-position across multiple pages (headers / footers).
    Sampling across the whole doc (not just first 8 pages) catches running
    titles that change chapter-by-chapter in the middle of the document.
    Returns a set of normalised text strings to treat as noise.
    """
    total = len(doc)
    # Sample up to 20 pages spread evenly across the document
    if total <= 20:
        sample_indices = list(range(total))
    else:
        step = total / 20
        sample_indices = [int(i * step) for i in range(20)]

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
                if not txt or _is_noise(txt):
                    continue
                rel_top = round(y / h, 3)
                rel_bot = round((h - y) / h, 3)
                entries.append((rel_top, rel_bot, txt))
        page_entries.append(entries)

    if len(page_entries) < 3:
        return set()

    noise: set = set()
    from collections import Counter
    # Two counters: one for exact text repeats, one for position-bucketed text
    counter_exact: Counter = Counter()    # text -> count (position-independent)
    counter_pos:   Counter = Counter()   # (bucket, text) -> count

    for entries in page_entries:
        seen_this_page: set = set()
        for rel_top, rel_bot, txt in entries:
            # Bucket position at 3% bands (slightly looser to catch slight shifts)
            bucket_top = round(rel_top * 33) / 33
            # Only consider lines in top 15% or bottom 15% of page
            if rel_top <= 0.15 or rel_bot <= 0.15:
                if txt not in seen_this_page:
                    counter_exact[txt] += 1
                    counter_pos[(bucket_top, txt)] += 1
                    seen_this_page.add(txt)

    n_sample = len(page_entries)
    threshold = max(3, n_sample // 3)   # must appear on ≥1/3 of sampled pages

    for (_, txt), cnt in counter_pos.items():
        if cnt >= threshold:
            noise.add(txt)
    # Also catch headers whose position shifts slightly but text is identical
    for txt, cnt in counter_exact.items():
        if cnt >= threshold:
            noise.add(txt)

    return noise


def _promote_isolated_numeric_provisions(lines: List[PdfLine]) -> None:
    """Recover body provision markers that were extracted as bare digits.

    Some PDFs visually show a marker like "(2)" but the text layer yields a
    standalone "2" on its own line. If that happens mid-page, the later diff
    pipeline can mistake it for noise and the provision anchor disappears.

    We only promote very conservative cases:
      - the line text is just 1-3 digits,
      - it is not the first/last line on the page,
      - the next line is close below it,
      - the next line looks like body text rather than a page header.
    """
    if len(lines) < 3:
        return

    for i in range(1, len(lines) - 1):
        line = lines[i]
        raw = _line_text(line).strip()
        if not re.fullmatch(r'\d{1,3}', raw):
            continue

        prev_line = lines[i - 1]
        next_line = lines[i + 1]
        next_text = _line_text(next_line).strip()
        if not next_text:
            continue

        gap_next = next_line.y - line.y
        if gap_next > 24:
            continue

        # Avoid promoting obvious page-number / heading situations.
        if (_RE_HEADING_KW.match(next_text) or
                _RE_ALLCAPS.match(next_text) or
                next_text.lower().startswith('abbreviations and general index')):
            continue

        # Keep this conservative: require nearby preceding body text so we don't
        # convert a top-of-page page number into a provision marker.
        prev_text = _line_text(prev_line).strip()
        if not prev_text:
            continue

        # The marker line should sit no further right than the following body line.
        if line.x_min > next_line.x_min + 12:
            continue

        if line.spans:
            line.spans[0].text = f"({raw})"
            for extra in line.spans[1:]:
                extra.text = ""


def _is_bare_provision_marker_text(text: str) -> bool:
    """True for standalone markers like 2, a, aa, ba that should be (2)/(a)."""
    raw = text.strip()
    if not raw:
        return False
    # Normalise common extraction variants: "(2", "2)", "2.", "a)", "a."
    raw = re.sub(r'^[\[(]+', '', raw)
    raw = re.sub(r'[\])\.:;,-]+$', '', raw)
    if re.fullmatch(r'\d{1,3}', raw):
        return True
    if re.fullmatch(r'[A-Za-z]{1,3}', raw):
        low = raw.lower()
        # Exclude common short words that are not legal bullets.
        if low in {'a', 'i'}:
            return True
        if low in {'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in',
                   'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
                   'up', 'us', 'we', 'act', 'and', 'are', 'but', 'for', 'has',
                   'her', 'his', 'not', 'see', 'tax', 'the', 'was'}:
            return False
        return True
    return False


def _is_lone_parenthesized_provision_marker(text: str) -> bool:
    """True for standalone markers like '(4B)' or '(aa)' on their own line."""
    if not text:
        return False
    t = _norm_cmp(text)
    return bool(re.fullmatch(r'\((?:[a-z]{1,3}|\d{1,3}[a-z]?|[ivxlcdm]{1,6})\)', t, re.I))


def _promote_section_number_headings(lines: List[PdfLine]) -> None:
    """Merge isolated section-number lines with their following heading text.

    Some PDF layouts extract a section number like "2" or "14A" on its own
    line immediately above the section title (e.g. "Abbreviations and general
    index in Schedule 1").  Other layouts put them on the same line as
    "2 Abbreviations and general index in Schedule 1".

    When the number is isolated, the segmenter sees a bare digit (no anchor)
    followed by a heading — it can't build the "sec:2" anchor, causing the
    two layouts to produce different block keys and alignment failures.

    Fix: if a bare 1-4 digit (possibly with letter suffix like "14A") sits on
    its own line, the next line is close by and looks like a section heading
    (title-case short phrase, no punctuation), and the line after that is body
    text or a gap, merge the number into the heading line.
    """
    if len(lines) < 3:
        return

    for i in range(len(lines) - 1):
        line = lines[i]
        raw = _line_text(line).strip()
        if not _RE_SEC_NUM.match(raw):
            continue

        next_line = lines[i + 1]
        next_text = _line_text(next_line).strip()
        if not next_text:
            continue

        # Next line must look like a section title: short, title-case, no digits
        # at start, no heavy punctuation (not a provision body).
        if not _RE_TITLE_CASE.match(next_text):
            continue
        if len(next_text.split()) > 14:
            continue
        # Must not already start with a number (would be a different kind of block)
        if re.match(r'^\d', next_text):
            continue
        # Must be close vertically
        if next_line.y - line.y > 30:
            continue
        # The number's x should be to the LEFT of the title's x (margin marker)
        if line.x_min >= next_line.x_min:
            continue

        # Merge: prepend number to the title line, blank out the number line
        merged_text = raw + " " + next_text
        if next_line.spans:
            next_line.spans[0].text = merged_text
            # Clear the isolated number line
        if line.spans:
            line.spans[0].text = ""
            for sp in line.spans[1:]:
                sp.text = ""


def _merge_amendment_section_blocks(lines: List[PdfLine]) -> None:
    """Aggressively merge amendment markers with body text in Textual Amendments section.
    
    This function detects the "Textual Amendments" section header and then forcibly
    merges any isolated F-marker lines (F1, F2, ...) with the following non-empty line,
    regardless of spacing. This is more robust than trying to match on patterns because
    we know we're in a structured legal amendments section.
    
    Once we exit the section (hit a different heading like "2Abbreviations..."), stop.
    """
    if not lines:
        return
    
    in_textual_amendments = False
    i = 0
    
    while i < len(lines):
        line = lines[i]
        text = _line_text(line).strip()
        
        # Check if we're entering the Textual Amendments section
        if re.search(r'\btextual amendments?\b', text, re.I):
            in_textual_amendments = True
            i += 1
            continue
        
        # Check if we've exited — only on genuine section headings, NOT on
        # amendment body lines that start with a capital letter.
        if in_textual_amendments and text:
            if (_RE_EXIT_KW.match(text) and
                    not _canonical_amendment_marker(text) and
                    not _RE_BODY_KW.match(text) and
                    not _RE_CITE_KW.match(text) and
                    not text[0].islower()):
                in_textual_amendments = False
                i += 1
                continue
        
        # If we're in Textual Amendments and this line is ONLY a marker...
        if in_textual_amendments:
            marker = _canonical_amendment_marker(text)
            if marker:
                # Found a marker line — merge it with the next non-empty line.
                # Look ahead to find the body text (skip empty lines).
                j = i + 1
                while j < len(lines):
                    nxt_text = _line_text(lines[j]).strip()
                    if nxt_text:
                        # Found body text — merge with it
                        nxt_line = lines[j]
                        if nxt_line.spans:
                            nxt_line.spans[0].text = f"{marker} {nxt_line.spans[0].text}"
                        # Blank out the marker line
                        if line.spans:
                            line.spans[0].text = ""
                            for sp in line.spans[1:]:
                                sp.text = ""
                        break
                    j += 1
        
        i += 1



def _merge_two_column_amendment_markers(lines: List[PdfLine]) -> None:
    """Merge two-column Textual Amendments layouts where F-markers (x~75) and
    body text (x~102) share the same y-coordinate on the page.

    Only fires when the right-column text matches an amendment body pattern
    (Word/Words/S./Reg. etc.) — never on provision text or dotted lines.
    """
    if not lines:
        return

    attached: set = set()
    for i in range(len(lines)):
        if i in attached:
            continue
        line = lines[i]
        text = _line_text(line).strip()
        marker = _canonical_amendment_marker(text)
        if not marker:
            continue
        for j in range(i + 1, min(i + 4, len(lines))):
            if j in attached:
                continue
            nxt = lines[j]
            nxt_text = _line_text(nxt).strip()
            if not nxt_text:
                continue
            if abs(nxt.y - line.y) > 14:
                break
            if nxt.x_min <= line.x_min + 4:
                continue
            if _canonical_amendment_marker(nxt_text):
                break
            if not _RE_AMEND_BODY.match(nxt_text):
                continue
            if _RE_NOT_AMEND.match(nxt_text):
                continue
            if nxt.spans:
                nxt.spans[0].text = f"{marker} {nxt.spans[0].text.lstrip()}"
            if line.spans:
                line.spans[0].text = ""
                for sp in line.spans[1:]:
                    sp.text = ""
            attached.add(i)
            break


def _attach_isolated_amendment_markers(lines: List[PdfLine]) -> None:
    """Attach standalone amendment markers (F1/F2/...) to the next text line.

    Some templates extract textual amendment markers as their own tiny line
    followed by body text on the next line. This pass reconstructs the intended
    line format: "F2 Words in s....".
    
    Amendment markers in small fonts (footnotes, textual amendments sections)
    can have larger gaps to the body text, or intermittent blank lines. This
    function is aggressive: once a marker is found, scan the next 3-5 lines to
    find and attach the accompanying body text.
    """
    if len(lines) < 2:
        return

    # Pattern for amendment body text: typically starts with action verb or digit.
    # Examples: "Words in s.", "S. 1(3)(ba)", "Word in s.", "Reg. 3 inserted", etc.
    amend_body_re = re.compile(
        r'^(?:'
        r'(?:Word|Words|S\.|Reg\.|Sch\.|Para\.|Article|S\s+\d|Reg\s+\d)'  # Common starts
        r'|'
        r'[A-Z][a-z]+\s+(?:in\s+|inserted|omitted|repealed|substituted|amended)'  # Action verbs
        r'|'
        r'[A-Z][\w\s]*\d+[A-Za-z]?\s*\('  # Numbered starts like "S. 1234(..."
        r')',
        re.I
    )

    # Track which lines have been attached so we don't double-attach
    attached = set()

    for i in range(len(lines)):
        if i in attached:
            continue

        cur = lines[i]
        cur_text = _line_text(cur).strip()
        if not cur_text:
            continue

        marker = _canonical_amendment_marker(cur_text)
        if not marker:
            continue

        # Found a marker — look ahead (up to 9 lines, cross-page allowed once).
        page_gap_seen = False
        for j in range(i + 1, min(i + 9, len(lines))):
            if j in attached:
                continue

            nxt = lines[j]
            nxt_text = _line_text(nxt).strip()

            if not nxt_text:
                continue

            if _canonical_amendment_marker(nxt_text):
                break

            dy = nxt.y - cur.y
            if dy > 120:
                if not page_gap_seen and dy < 1100:
                    page_gap_seen = True  # Allow one cross-page jump
                else:
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


def _sanitize_hybrid_ocr_lines(lines: List[PdfLine]) -> None:
    """Trim duplicated OCR-style lines that mix body text with amendment lists.

    Some pages expose both a clean line-by-line text layer and a second merged
    OCR paragraph layer. The merged layer can append amendment entries like
    "F102 Words in s..." onto ordinary provision lines, which later causes
    segmentation and diff drift. When a clean amendment line also exists nearby,
    keep the body/heading portion and discard the appended amendment list.
    """
    if not lines:
        return

    amend_start = re.compile(
        r'\b([FCEMSX]\d+[A-Za-z]?\s+(?:Word|Words|S\.|Ss\.|Reg\.|Sch\.|Para\.|Article|Pt\.))',
        re.I,
    )

    for line in lines:
        text = _line_text(line).strip()
        if not text:
            continue

        cleaned = text

        # Keep the heading only when an OCR paragraph starts with it.
        if text.startswith('Textual Amendments ') and amend_start.search(text):
            cleaned = 'Textual Amendments'

        # Drop an appended heading from an otherwise ordinary body line.
        elif ' Textual Amendments' in text and not text.startswith('Textual Amendments'):
            cleaned = text.split(' Textual Amendments', 1)[0].rstrip()

        # Trim appended amendment-list OCR from ordinary body/provision lines.
        elif not re.match(r'^\[?\s*[FCEMSX]\d+[A-Za-z]?\b', text, re.I):
            m = amend_start.search(text)
            if m:
                cleaned = text[:m.start()].rstrip(' ,;')

        if cleaned != text and cleaned:
            x = line.x_min
            y = line.y
            line.spans = [_plain_span(cleaned, x, y)]


def _promote_isolated_provision_markers(lines: List[PdfLine]) -> None:
    """Recover provision markers extracted without parentheses.

    Handles both numeric markers like 2 -> (2) and alphabetic markers like
    a/aa/ba -> (a)/(aa)/(ba) when they appear as isolated lines immediately
    above body text.
    """
    if len(lines) < 3:
        return

    for i in range(1, len(lines) - 1):
        line = lines[i]
        raw = _line_text(line).strip()
        if not _is_bare_provision_marker_text(raw):
            continue

        canonical = re.sub(r'^[\[(]+', '', raw)
        canonical = re.sub(r'[\])\.:;,-]+$', '', canonical).strip()
        if not canonical:
            continue

        prev_line = lines[i - 1]
        next_line = lines[i + 1]
        next_text = _line_text(next_line).strip()
        if not next_text:
            continue

        gap_next = next_line.y - line.y
        if gap_next > 24:
            continue

        # Avoid promoting obvious page-number / heading situations.
        if (_RE_HEADING_KW.match(next_text) or
                _RE_ALLCAPS.match(next_text) or
                next_text.lower().startswith('abbreviations and general index')):
            continue

        # Keep this conservative: require nearby preceding body text so we don't
        # convert a top-of-page page number or stray short word into a marker.
        prev_text = _line_text(prev_line).strip()
        if not prev_text:
            continue

        # The marker line should sit no further right than the following body line.
        if line.x_min > next_line.x_min + 12:
            continue

        if line.spans:
            line.spans[0].text = f"({canonical})"
            for extra in line.spans[1:]:
                extra.text = ""


def load_pdf(path: str, progress_cb=None) -> List[PdfLine]:
    """Returns list[PdfLine] for the whole document (all pages concatenated).
    Strips repeating page headers and footers to reduce false positives.

    Pages are processed in parallel (ThreadPoolExecutor, separate fitz.Document
    per worker) for a 2-4x speedup on documents with 20+ pages.
    Cross-page post-processing runs sequentially after all pages are collected.
    """
    import time as _time
    from concurrent.futures import ThreadPoolExecutor as _TPE

    _t_start = _time.perf_counter()

    # Open once to count pages and detect headers/footers, then close.
    doc = fitz.open(path)
    total = len(doc)

    # Skip header/footer sampling for very small PDFs (no repeated patterns).
    if total >= 6:
        hf_noise = _detect_header_footer_patterns(doc)
    else:
        hf_noise = set()
    doc.close()

    _t_hf = _time.perf_counter()
    print(f"  [load_pdf] header/footer detect: {_t_hf - _t_start:.2f}s  ({total} pages)", flush=True)

    # Read bytes once — each worker opens its own fitz.Document from this
    # immutable buffer so no document handle is shared between threads.
    with open(path, "rb") as _f:
        _pdf_bytes = _f.read()

    page_gap = 80.0

    # Determine text-extraction flags once (same for every page).
    _flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
    try:
        _flags |= fitz.TEXT_DEHYPHENATE
    except AttributeError:
        pass  # older PyMuPDF without TEXT_DEHYPHENATE

    # ── Per-page extraction (called from worker threads) ──────────────────────
    def _extract_pages(page_indices: list) -> List[Tuple[int, List[PdfLine]]]:
        """Open a private fitz.Document and process the given page indices.
        Returns [(page_idx, merged_lines), ...] in the order they were processed.
        """
        local_doc = fitz.open(stream=_pdf_bytes, filetype="pdf")
        results: List[Tuple[int, List[PdfLine]]] = []

        for i in page_indices:
            fz = local_doc[i]
            h  = fz.rect.height or 1
            page_y_offset = i * (h + page_gap)

            raw = fz.get_text("dict", flags=_flags)

            all_lines: List[PdfLine] = []
            for block in raw["blocks"]:
                if block.get("type") != 0:
                    continue
                for line in block["lines"]:
                    spans = [_parse_span(s) for s in line["spans"] if s["text"].strip()]
                    if not spans:
                        continue
                    local_y = round(line["bbox"][1], 1)
                    y    = round(page_y_offset + local_y, 1)
                    xmin = round(min(s.x for s in spans), 1)

                    # Skip header/footer lines (top or bottom 12% of page).
                    rel_top = local_y / h
                    rel_bot = (h - local_y) / h
                    if rel_top <= 0.12 or rel_bot <= 0.12:
                        line_txt = _norm_cmp(" ".join(s.text for s in spans))
                        marker_like = (
                            bool(_RE_HF_PAREN.search(line_txt)) or
                            bool(_RE_HF_BRACKET.search(line_txt)) or
                            bool(_RE_HF_MARKER.search(line_txt)) or
                            bool(_RE_HF_BARE.match(line_txt)) or
                            bool(_RE_HF_SECREF.search(line_txt)) or
                            bool(_RE_HF_BODYSTART.search(line_txt))
                        )
                        if line_txt in hf_noise and not marker_like:
                            continue

                    all_lines.append(PdfLine(y=y, x_min=xmin, spans=spans))

            # Sort by y-bucket then x (same logic as before).
            all_lines.sort(key=lambda l: (round(l.y / 2) * 2, l.x_min))

            # Merge spans on the same physical line (y within 6pt).
            merged: List[PdfLine] = []
            for pl in all_lines:
                if merged and abs(pl.y - merged[-1].y) <= 6:
                    merged[-1].spans.extend(pl.spans)
                    merged[-1].x_min = min(merged[-1].x_min, pl.x_min)
                    merged[-1].spans.sort(key=lambda s: s.x)
                else:
                    merged.append(PdfLine(y=pl.y, x_min=pl.x_min,
                                          spans=sorted(pl.spans, key=lambda s: s.x)))

            _merge_two_column_amendment_markers(merged)
            _merge_amendment_section_blocks(merged)
            _promote_isolated_provision_markers(merged)
            _promote_section_number_headings(merged)

            results.append((i, merged))

            if progress_cb:
                progress_cb(i + 1, total)

        local_doc.close()
        return results

    # ── Determine worker count and split pages into chunks ────────────────────
    # Use 1 worker per ~25 pages, capped at 4 to bound memory pressure.
    # Sequential fallback for tiny documents (overhead not worth it).
    if total <= 15:
        n_workers = 1
    elif total <= 60:
        n_workers = 2
    elif total <= 150:
        n_workers = 3
    else:
        n_workers = 4

    chunk_size = (total + n_workers - 1) // n_workers
    page_chunks = [
        list(range(i, min(i + chunk_size, total)))
        for i in range(0, total, chunk_size)
    ]

    _t_pre = _time.perf_counter()

    if n_workers > 1:
        with _TPE(max_workers=n_workers) as pool:
            chunk_results = list(pool.map(_extract_pages, page_chunks))
    else:
        chunk_results = [_extract_pages(page_chunks[0])]

    _t_loop = _time.perf_counter()
    print(
        f"  [load_pdf] parallel extract ({n_workers} workers, {total} pages): "
        f"{_t_loop - _t_pre:.2f}s",
        flush=True,
    )

    # Flatten and sort by page index to restore document order.
    all_page_results: List[Tuple[int, List[PdfLine]]] = []
    for chunk_result in chunk_results:
        all_page_results.extend(chunk_result)
    all_page_results.sort(key=lambda x: x[0])

    lines: List[PdfLine] = []
    for _, page_lines in all_page_results:
        lines.extend(page_lines)

    # ── Cross-page post-processing (must remain sequential) ───────────────────
    # _attach_isolated_amendment_markers needs to see page-boundary neighbours.
    _attach_isolated_amendment_markers(lines)
    _sanitize_hybrid_ocr_lines(lines)

    _t_end = _time.perf_counter()
    print(
        f"  [load_pdf] post-process: {_t_end - _t_loop:.2f}s  "
        f"TOTAL={_t_end - _t_start:.2f}s  ({len(lines)} lines)",
        flush=True,
    )

    return lines


# ─────────────────────────────────────────────────────────────
#  TEXT NORMALISATION
# ─────────────────────────────────────────────────────────────

_NORM_MAP = str.maketrans({
    '\u2014': '--', '\u2013': '-',
    '\u2018': "'",  '\u2019': "'",
    '\u201c': '"',  '\u201d': '"',
    '\u00a0': ' ',  '\u00ad': '',   # soft hyphen → remove
    '\u2010': '-',  '\u2011': '-',  # hyphen / non-breaking hyphen
    '\u2012': '-',  '\u2015': '--', # figure dash / horizontal bar
    '\u2026': '...', '\u00b7': ' ', # ellipsis, middle dot
})


def normalize_text(text: str) -> str:
    """Normalize extraction artifacts before comparison.

    Keeps this lightweight: remove intra-sentence extraction breaks and spacing
    noise without changing legal meaning.
    """
    if not text:
        return ""
    # Normalize line-break and tab artifacts from PDF extraction.
    text = text.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    # Fix hard hyphen wraps such as "employ-\nment" -> "employment".
    text = re.sub(r'-\s+', '', text)
    # Normalize common smart quotes from PDF layers.
    text = text.replace('“', '"').replace('”', '"').replace('’', "'")
    # Collapse repeated whitespace.
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _line_text(line: PdfLine) -> str:
    """Raw display text of a PdfLine."""
    raw = ' '.join(' '.join(s.text for s in line.spans).split())
    return _compact_amendment_markers(raw)


def _norm(t: str) -> str:
    """Light normalisation: unicode chars only, preserve case.
    Also dehyphenates mid-line-break artefacts like 'exam- ple' → 'example'
    and the reverse variant 'exam -ple'.
    Preserves outline markers like (a), (b), (1), (2) at ALL positions."""
    s = _compact_amendment_markers(normalize_text(t.translate(_NORM_MAP)))
    # Join hard-hyphen line-break artefacts (both orderings)
    s = re.sub(r'([A-Za-z])-\s+([a-z])', r'\1\2', s)
    s = re.sub(r'([A-Za-z])\s+-([a-z])', r'\1\2', s)
    # Recover missing separator in numbered headings: "24ARestrictions" -> "24A Restrictions"
    s = re.sub(r'(?<![A-Za-z0-9])(\d{1,4}[A-Za-z]?)(?=[A-Z][a-z])', r'\1 ', s)
    return s


@functools.lru_cache(maxsize=65536)
def _norm_cmp(t: str) -> str:
    """
    Full normalisation for equality comparison:
    - Lowercase
    - Collapse unicode punctuation
    - Dehyphenate line-break artefacts: 'exam-\\nple' -> 'example'
    - Collapse PDF spaced-letter artefacts: 'T AX' -> 'tax', 'C HAPTER' -> 'chapter',
      including cases where the single letter IS a common word but the fragment
      that follows is clearly not a standalone word ('O VERVIEW' → 'overview').
    - Split PDF word-join artefacts: 'EMPLOYMENTINCOME' → 'employment income'
      (small-caps headings where inter-word spaces are lost during extraction).
    - Preserve content inside brackets ([F17A], (1.10.2010)).
    - Strip pure-whitespace / pure-punctuation trailing noise.
    """
    s = _compact_amendment_markers(normalize_text(t.translate(_NORM_MAP)))
    # Recover missing separator in numbered headings before lowercasing so
    # section-suffix letters (e.g. 24A) are preserved correctly.
    s = re.sub(r'(?<![A-Za-z0-9])(\d{1,4}[A-Za-z]?)(?=[A-Z][a-z])', r'\1 ', s)
    s = s.lower()

    # Fix hard-hyphen line-break artefacts: "exam- ple" or "exam -ple" → "example"
    s = re.sub(r'([a-z])-\s+([a-z])', r'\1\2', s)
    s = re.sub(r'([a-z])\s+-([a-z])', r'\1\2', s)  # reverse order variant
    # Protect bracketed tokens that contain legal citations or dates
    def _protect(m):
        inner = m.group(0)[1:-1]
        if re.search(r'[0-9./]', inner):
            return m.group(0).replace(' ', '\x00')
        return m.group(0)
    s = re.sub(r'\[[^\]]*\]|\([^)]*\)', _protect, s)

    # ── Spaced-letter collapse ──────────────────────────────────────────────
    # PDFs sometimes render small-caps/letter-spaced headings so each character
    # arrives separately: "O VERVIEW", "I NTRODUCTION", "C HAPTER".
    # Strategy: if a single letter is followed by a fragment that is NOT a
    # standalone English word but DOES complete a known word when prepended,
    # merge them.  We detect "not a real word" by checking a small stopword set.
    _REAL_WORDS = frozenset({
        'a', 'i', 'o',
        'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in',
        'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
        'up', 'us', 'we',
        'act', 'and', 'are', 'but', 'for', 'from', 'has', 'her', 'his',
        'not', 'see', 'tax', 'the', 'was', 'with',
    })

    def _collapse_spaced(s: str) -> str:
        tokens = s.split(' ')
        out = []
        k = 0
        while k < len(tokens):
            tok = tokens[k]
            if (len(tok) == 1 and tok.isalpha()
                    and k + 1 < len(tokens)
                    and tokens[k+1].isalpha() and len(tokens[k+1]) >= 2):
                frag = tokens[k+1]
                merged = tok + frag
                # Merge when: the single letter is NOT a real word,
                # OR the fragment following it is NOT a real word on its own
                # (handles 'O VERVIEW' where 'o' is a real word but 'verview' isn't)
                if tok not in _REAL_WORDS or frag not in _REAL_WORDS:
                    out.append(merged)
                    k += 2
                    continue
            out.append(tok)
            k += 1
        return ' '.join(out)

    # Only run spaced-letter collapse if the string actually contains
    # single-letter tokens followed by alpha fragments (fast pre-check).
    if re.search(r'(?:^| )[a-z] [a-z]', s):
        for _ in range(4):          # extra pass for 'I N T R O' style runs
            prev = s
            s = _collapse_spaced(s)
            if s == prev:
                break

    # ── Joined-word split ───────────────────────────────────────────────────
    # Some PDFs lose inter-word spaces in small-caps headings entirely:
    # "EMPLOYMENTINCOME" → "employment income", "CHARGETOTAX" → "charge to tax".
    # We greedily split runs that are ≥10 chars, all-alpha, no spaces,
    # using a vocabulary of common legal heading words.
    _HEAD_WORDS = [
        'employment', 'income', 'charge', 'pension', 'security',
        'social', 'overview', 'contents', 'introduction', 'structure',
        'meaning', 'definitions', 'general', 'provisions', 'amendments',
        'textual', 'modifications', 'schedule', 'chapter', 'part',
        'section', 'appendix', 'annex', 'the', 'of', 'and', 'to', 'tax',
        # additional common legal heading fragments
        'earnings', 'specific', 'taxable', 'exempt', 'amount', 'rules',
        'application', 'payment', 'year', 'allowance', 'relief', 'benefit',
        'deduction', 'expenses', 'certain', 'other', 'income', 'rate',
        'authority', 'person', 'employee', 'employer', 'work', 'pay',
        'national', 'insurance', 'contributions', 'paye', 'scheme',
        # legal terms from false-positive screenshots (joined-caps headings)
        'subordinate', 'legislation', 'regulation', 'regulations',
        'revocation', 'reference', 'consequential', 'replacement',
        'accessories', 'notional', 'payments', 'amendment', 'disability',
        'working', 'ireland', 'northern', 'benefits', 'car', 'van',
        'fuel', 'credit', 'credits', 'vouchers', 'living', 'accommodation',
        'shares', 'securities', 'options', 'enterprise', 'management',
        'investment', 'company', 'approved', 'unapproved', 'share',
        'incentive', 'plan', 'plans', 'savings', 'related', 'trust',
        'trusts', 'directors', 'workers', 'agency', 'services',
        'provided', 'through', 'intermediaries', 'managed', 'service',
        'companies', 'foreign', 'employers', 'travel', 'subsistence',
        'entertainment', 'education', 'training', 'redundancy',
        'termination', 'change', 'residence', 'status', 'supplementary',
        'interpretation', 'commencement', 'transitional', 'consequential',
        'savings', 'repeals', 'enactments', 'extent', 'short', 'title',
        'citation', 'operation', 'effect', 'scope', 'minor',
        'csop', 'schemes', 'saye', 'option', 'emi', 'sip',
        # UK tax / ITEPA specific heading words
        'remittance', 'basis', 'non', 'uk', 'resident', 'employees',
        'for', 'in', 'a', 'an', 'on', 'is', 'by', 'with', 'from',
        'this', 'that', 'which', 'are', 'not', 'no', 'or', 'as',
        'if', 'it', 'its', 'all', 'any', 'has', 'had', 'be', 'at',
        'but', 'such', 'type', 'types', 'value', 'values',
        'chargeable', 'assessable', 'liable', 'liability',
        'gains', 'losses', 'disposal', 'disposals', 'property',
        'capital', 'interest', 'dividend', 'dividends', 'distributions',
        'qualifying', 'condition', 'conditions', 'requirement',
        'requirements', 'individual', 'individuals', 'partnership',
    ]
    _HEAD_SET = set(_HEAD_WORDS)

    def _split_joined(word: str) -> str:
        # Strip trailing punctuation so 'employmentincome:' → 'employmentincome' is split
        suffix = ''
        stripped = word
        while stripped and not stripped[-1].isalpha():
            suffix = stripped[-1] + suffix
            stripped = stripped[:-1]
        if len(stripped) < 10 or not stripped.isalpha():
            return word
        word = stripped
        remaining = word
        result = []
        while remaining:
            matched = False
            for vw in sorted(_HEAD_WORDS, key=len, reverse=True):
                if remaining.startswith(vw):
                    tail = remaining[len(vw):]
                    # Accept this split if tail is empty or starts another known word
                    if not tail or any(tail.startswith(v) for v in _HEAD_WORDS):
                        result.append(vw)
                        remaining = tail
                        matched = True
                        break
            if not matched:
                result.append(remaining)
                break
        # Only accept if every piece is in our vocab (avoids spurious splits)
        if len(result) > 1 and all(p in _HEAD_SET for p in result):
            return ' '.join(result) + suffix
        return word + suffix

    tokens = s.split()
    s = ' '.join(_split_joined(tok) for tok in tokens)

    s = s.replace('\x00', ' ')
    s = re.sub(r'\s+', ' ', s).strip()

    # ── Bracket-space normalisation ─────────────────────────────────────────
    # PDF hyperlink extraction produces spurious spaces AROUND brackets and
    # before commas, e.g.:
    #   "[ F38 (1) ..."  vs  "[f38 (1) ..."
    #   "[ F29 , 7 or 7A ]" vs "[f29, 7 or 7a]"
    #   "(with Sch. 2 )"     vs "(with sch. 2)"
    # Normalise all of these so the sequence-matcher sees them as identical.
    s = re.sub(r'([\[\(])\s+', r'\1', s)        # spaces after [ or (
    s = re.sub(r'\s+([,\)\]])', r'\1', s)        # spaces before , ) ]

    # ── Provision-marker spacing ─────────────────────────────────────────────
    # "(a)are" → "(a) are",  "(1)This" → "(1) this"
    # Some PDFs omit the space between the outine marker and its body text.
    s = re.sub(r'(\([a-zA-Z0-9]{1,3}\))([A-Za-z])', r'\1 \2', s)

    # Strip trailing standalone punctuation noise (comma, semicolon, period alone)
    # but NOT closing ] that legitimately closes a [Fx ...] annotation block,
    # and NOT closing ) that is part of an outline marker like (a), (1).
    # A trailing ] is only noise if there are more ] than [ in the string.
    s = re.sub(r'\s+[,;]\s*$', '', s).strip()
    # Only strip trailing period if it is not part of an inline outline marker
    if not re.search(r'\([a-zA-Z]{1,3}|\d{1,3}\)\s*$', s):
        s = re.sub(r'\s+[.]\s*$', '', s).strip()
    if s.count(']') > s.count('['):
        # Strip the orphaned trailing ]
        s = re.sub(r'\s*\]\s*$', '', s).strip()
    # Final whitespace collapse
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def _is_whitespace_only_diff(a: str, b: str) -> bool:
    """True if a and b differ only in whitespace."""
    return re.sub(r'\s+', '', a) == re.sub(r'\s+', '', b)


def _is_punctuation_only_diff(a: str, b: str) -> bool:
    """True if a and b differ only in punctuation/spacing around punctuation."""
    sa = re.sub(r'\s+', ' ', _RE_STRIP_PUNCT.sub('', a)).strip()
    sb = re.sub(r'\s+', ' ', _RE_STRIP_PUNCT.sub('', b)).strip()
    return sa == sb


_RE_ACTION_WORD = re.compile(
    r'\b(substituted|inserted|omitted|repealed|amended|added|deleted|replaced|'
    r'renumbered|words|word)\b', re.I)


def _is_f_cluster(text: str) -> bool:
    """True for lines that are bare F-number annotation index columns.

    These appear in legal PDFs as a column of bare annotation numbers
    (F1972 F1973 F1974...) printed alongside the text they annotate.
    They shift between versions as amendments are inserted/removed and
    carry no stable content — they should be treated as noise.

    A line qualifies when very high proportion of tokens are bare F-numbers AND it
    contains no legal amendment action words (substituted, inserted, etc.).
    Also catches lines that START with 4+ consecutive F-numbers regardless
    of what follows (e.g. "F10 F11 F12 F13 (7) Meaning...").
    """
    tokens = text.strip().split()
    if len(tokens) < 5:
        return False
    f_count = sum(1 for t in tokens if re.match(r'^[A-Z]\d+[A-Za-z]?$', t))
    # Standard cluster: very high F-number density, no amendment action words.
    if f_count / len(tokens) >= 0.80 and not _RE_ACTION_WORD.search(text):
        return True
    # Leading-cluster: starts with 5+ consecutive F-numbers (annotation index
    # preceding section content like "(7) Meaning of...")
    leading = 0
    for t in tokens:
        if re.match(r'^[A-Z]\d+[A-Za-z]?$', t):
            leading += 1
        else:
            break
    if leading >= 5 and not _RE_ACTION_WORD.search(text):
        return True
    return False


def _is_legal_leader_line(t: str) -> bool:
    """True for amendment/provision leader lines like ``F278(2) ........``.

    These are structural legal markers, not table-of-contents noise, so they
    should survive extraction and alignment even when followed by dot leaders.
    Plain provision-only leaders like ``(2) ........`` are still treated as
    noise elsewhere.
    """
    if not t:
        return False
    raw = t.strip()
    if not re.search(r'[.\xb7]{6,}\s*$', raw):
        return False
    prefix = re.sub(r'[.\xb7\s]+$', '', raw)
    return bool(re.match(
        r'^\[?\s*[FCEMSX]\d+[A-Za-z]?\s*\]?\s*(?:\(\s*[A-Za-z0-9]{1,4}\s*\))*$',
        prefix,
        re.I,
    ))


def _is_noise(t: str) -> bool:
    """
    True only for lines that carry no semantic content:
    dot leaders, blank lines, lone page numbers, or bare F-number clusters.
    Legal annotation markers ([F6], 17(4), "and", "or") are NOT noise.
    Bare amendment markers like "F1", "C2" are NEVER noise — they are paired
    with body text by the merger passes.
    """
    t = t.strip()
    if not t:
        return True
    # Bare amendment markers and legal leader lines must survive to be paired
    # with nearby body text during segmentation/alignment.
    if re.match(r'^[FCEMSX]\d+[A-Za-z]?$', t, re.I) or _is_legal_leader_line(t):
        return False
    if len(t) <= 1:
        return not _is_bare_provision_marker_text(t)
    # Dot/bullet leader lines (with optional provision markers like (a), (ba), (1))
    if re.match(r'^(\[?\s*[A-Z][0-9]+[A-Za-z]?\s*\]?\s*)?(\(\s*[a-zA-Z0-9]{1,4}\s*\)\s*)*[.\s\xb7]{6,}$', t):
        return True
    # Ratio-based dot-leader: lines dominated by dots/bullets (>= 50% of non-space chars)
    _dot_ct = t.count('.') + t.count('\xb7')
    _non_sp = t.replace(' ', '')
    if _dot_ct >= 6 and _non_sp and _dot_ct / len(_non_sp) > 0.50:
        return True
    # Standalone page numbers
    if re.match(r'^\d{1,4}$', t) and not _is_bare_provision_marker_text(t):
        return True
    # Bare F-number annotation index clusters (shift between versions, no content)
    if _is_f_cluster(t):
        return True
    # Citation reference tail fragments — these are wrapping artefacts from
    # long Textual Amendment citation strings that broke across lines.
    if _RE_CITE_FRAG.match(t):
        return True
    # Keep bare annotation markers and citation fragments. Older templates often
    # extract these as separate tiny lines; suppress them later only if truly
    # equivalent across sides.
    return False


# Heading keyword pattern for breadcrumb detection
_RE_HEADING_BC = re.compile(
    r'^(part|chapter|schedule|section|appendix|annex)\s+\d', re.I)


def _is_breadcrumb(t: str) -> bool:
    """
    Detect navigation breadcrumb labels that some PDF renderers insert near
    headings: e.g. 'Part 1 Overview', 'Chapter 1 Introduction', 'Overview',
    'Introduction'.  These come from the PDF bookmark layer and appear in one
    version but not the other, causing spurious DEL/ADD hits.

    Also catches spaced-letter all-caps subheadings like 'T AX ON EMPLOYMENT
    INCOME' that appear as standalone lines in one PDF version but are merged
    into the chapter heading in another (e.g. 'Chapter 2 Tax on employment
    income').

    Heuristics (conservative — must satisfy ALL):
      1. Short: ≤ 6 words after normalisation.
      2. Matches a structural heading keyword + number, OR is a pure short
         title phrase with no legal punctuation / citation markers.
      3. NOT a provision/amendment anchor ('(1)...', 'F5 Word...').
    """
    nt = _norm_cmp(t)
    words = nt.split()
    if not words or len(words) > 6:
        return False
    # Provision or amendment lines are never breadcrumbs
    if re.match(r'^\(', nt) or re.match(r'^[fcems]\d+\b', nt):
        return False
    # "Part N ...", "Chapter N ...", "Schedule N ..." style breadcrumbs
    if _RE_HEADING_BC.match(nt):
        return True
    # Short pure-word title with no legal markers
    if re.search(r'[\(\)\[\]:]|\d{4}|s\.\s*\d|reg\.\s*\d', nt):
        return False
    # Explicit section-header terms that must never be treated as breadcrumbs
    if nt in ('textual amendments', 'textual amendment',
              'modifications', 'modifications etc',
              'commencement'):
        return False
    # All-caps spaced-letter subheading (e.g. original "T AX ON EMPLOYMENT INCOME"
    # normalises to "tax on employment income"). Detect by checking the raw text:
    # if it was originally all-caps (or spaced-letter all-caps) and short, it is
    # a structural subheading that pairs with a chapter heading in the other version.
    raw_stripped = re.sub(r'\s+', ' ', t).strip()
    raw_alpha = re.sub(r'[^A-Za-z ]', '', raw_stripped)
    if raw_alpha and raw_alpha == raw_alpha.upper() and 2 <= len(words) <= 5:
        # All-caps and short — structural subheading label
        return True
    # Title-case structural chapter subheadings: short phrases like
    # "Tax on employment income" that appear as standalone subheadings in one
    # PDF version and as all-caps/spaced-letter text in another. These are
    # always paired with a chapter heading in the surrounding context and carry
    # no independent legal content — treat as breadcrumbs.
    # Criteria: short (≤6 words), head: anchor, no legal punctuation/numbers,
    # and the block is a pure word phrase (no annotation markers, no section refs).
    if (2 <= len(words) <= 6 and
            re.match(r'^[A-Z][a-z]', t.strip()) and
            not re.search(r'[,;:\[\]\(\)\d]', nt) and
            not re.search(r'\b(?:s\.|sch\.|para\.|reg\.|art\.)\s*\d', nt)):
        # Extra guard: must not be a genuine provision title (which would appear
        # with a section number like "6Nature of charge to tax").
        # Only suppress standalone subheading phrases with no numeric content.
        if not re.search(r'\d', nt):
            return True
    # Only treat as breadcrumb if the first word is a known structural label.
    _BREADCRUMB_HEADS = frozenset({
        'overview', 'introduction', 'contents', 'definitions', 'interpretation',
        'general', 'structure', 'background', 'purpose', 'scope', 'application',
        'preliminary', 'miscellaneous', 'supplementary', 'transitional',
    })
    if len(words) <= 4 and re.match(r'^[a-z]+(?: [a-z]+)*$', nt):
        if words[0] in _BREADCRUMB_HEADS:
            return True
    return False


# ─────────────────────────────────────────────────────────────
#  STAGE 1 - BLOCK SEGMENTATION
#
#  A Block is a self-contained unit of legal meaning.  Examples:
#    - A numbered provision:  "(b)pension income (see Part 9), and"
#    - An annotation group:   "[F6 allows deductions ... and ]"
#    - A heading:             "Part 1 / Overview"
#    - A textual amendment:   "F5 Word in s. 1(3)(b) omitted ..."
#
#  Each block has:
#    anchor  -- canonical key used for matching (e.g. "(b)", "F6", "Part1")
#    text    -- full normalised text of the block
#    lines   -- the original PdfLine objects it spans (for rendering)
#    x_min   -- indentation of the anchor line
# ─────────────────────────────────────────────────────────────

@dataclass
class Block:
    anchor:  str
    text:    str
    cmp:     str           # _norm_cmp(text) for equality checking
    lines:   List[PdfLine]
    x_min:   float
    y:       float


# Patterns that START a new block (anchor line)
_RE_PROVISION  = re.compile(r'^\(([a-zA-Z]{1,3}|\d{1,3}[A-Za-z]?|[ivxlcdm]{1,6})\)', re.I)
_RE_PROVISION_ALT = re.compile(r'^([a-zA-Z]{1,3}|\d{1,3}[A-Za-z]?|[ivxlcdm]{1,6})[\)\.:]\s*', re.I)
_RE_PROVISION_OPEN = re.compile(r'^\(([a-zA-Z]{1,3}|\d{1,3}[A-Za-z]?|[ivxlcdm]{1,6})\s*$', re.I)
_RE_PROVISION_CLOSE = re.compile(r'^([a-zA-Z]{1,3}|\d{1,3}[A-Za-z]?|[ivxlcdm]{1,6})\)\s*$', re.I)
_RE_NUMBERED   = re.compile(r'^(\d{1,3}[A-Z]?)(?:\s|[A-Z])')  # 1-3 digit section numbers only
_RE_ANNOTATION = re.compile(r'^\[?\s*(F|C|E|M|S|X)\d+[A-Za-z]?\s*\]?$')
# Annotation open: [F4(aa) or [F6(ba) — the sub-provision code is part of the annotation marker
_RE_ANNOT_OPEN = re.compile(r'^\[?\s*(F|C|E|M|S|X)\d+[A-Za-z]?(?:\([a-zA-Z]{1,3}\))?\b')
_RE_HEADING_KW = re.compile(r'^(Part|Chapter|Schedule|Section|Appendix|Annex)\s+\d', re.I)
_RE_TEXTUAL_AM = re.compile(r'^Textual\s+Amendments?$', re.I)
_RE_ALLCAPS    = re.compile(r'^[A-Z][A-Z\s]{3,}$')
_RE_DATE       = re.compile(r'^\[?\d+(st|nd|rd|th)\s+\w')
_RE_F_AMEND    = re.compile(r'^(F\d+[A-Za-z]?)\s*\S', re.I)
_RE_SUBHEADING = re.compile(
    r'^(overview|introduction|contents|commencement|modifications(?:\s+etc)?|'
    r'textual\s+amendments?)\b',
    re.I,
)


def _is_short_heading_text(text: str) -> bool:
    """True for short legal heading/subheading lines that should stand alone."""
    t = _norm(text)
    if not t:
        return False
    nt = _norm_cmp(t)
    words = nt.split()
    if not words or len(words) > 12:
        return False
    if _RE_HEADING_KW.match(t) or _RE_TEXTUAL_AM.match(t) or _RE_ALLCAPS.match(t):
        return True
    if _RE_SUBHEADING.match(t):
        return True
    # Title-like case: mostly words, little punctuation, not a sentence.
    if re.search(r'\b(?:s\.|reg\.|para\.|article|section)\s*\d', nt):
        return False
    # Citation reference lines like "Sch. 43 Pt. 3(4)" are NOT headings
    if re.search(r'\b(?:sch\.|pt\.|para\.|art\.|reg\.)\s*\d', nt, re.I):
        return False
    if re.search(r'[\[\]]', t):
        return False
    if t.endswith('.') and len(words) > 5:
        return False
    # Generic cross-heading heuristic: short title-like phrase, no sentence
    # punctuation, not a normal prose opener.
    if (re.match(r'^[A-Z]', t) and 3 <= len(words) <= 12 and
            not re.search(r'[,;:]', t)):
        if words[0].lower() not in {
            'this', 'that', 'these', 'those', 'where', 'when', 'if', 'but',
            'for', 'in', 'on', 'at', 'from', 'to', 'by', 'with', 'without'
        }:
            return True
    return False


@functools.lru_cache(maxsize=32768)
def _anchor_of(text: str) -> Optional[str]:
    """
    Extract a canonical anchor key from a line of text.
    Returns None if this line is a continuation (not a new block starter).
    """
    t = text.strip()
    if not t:
        return None

    # Citation-continuation guard shared by all provision-marker checks below.
    # Lines like "(4) , Sch. 9 para. 3(2)(b)" look like provision markers but
    # are actually citation reference tails — the ", Sch." after the marker
    # is the giveaway.  Lines starting with Sch./Para./Art. are similar tails.
    _CITE_CONT = re.compile(
        r'(?:\s*,\s*(?:Sch\.|s\.|art\.|reg\.|para\.|Pt\.)|\(c\.\s*\d|\(with\s+)',
        re.I)
    _CITE_START = re.compile(
        r'^(?:Sch\.|Para\.|Art\.|Reg\.|Pt\.|S\.I\.|s\.\s*\d)',
        re.I)

    # Provision: (b), (1), (aa), (ba)
    m = _RE_PROVISION.match(t)
    if m and not _CITE_CONT.search(t):
        return f"({m.group(1)})"
    m = _RE_PROVISION_ALT.match(t)
    if m and not _CITE_CONT.search(t) and not _CITE_START.match(t):
        return f"({m.group(1)})"
    m = _RE_PROVISION_OPEN.match(t)
    if m and not _CITE_CONT.search(t) and not _CITE_START.match(t):
        return f"({m.group(1)})"
    m = _RE_PROVISION_CLOSE.match(t)
    if m and not _CITE_CONT.search(t) and not _CITE_START.match(t):
        return f"({m.group(1)})"

    # Numbered section: "1Overview", "3Structure", "7Meaning"
    # Guard: reject year-numbers (4 digits), citation-continuation patterns,
    # and citation tail fragments like "1 paras. 30-34)", "43 Pt. 3(4)",
    # "8 Pt. 3 )", "42 Pt. 2(19)" which start with a section number but are
    # actually reference tails from wrapping citation strings.
    m = _RE_NUMBERED.match(t)
    if m:
        num = m.group(1)
        # Reject if the text looks like a citation fragment rather than a heading
        _is_citation = (
            re.match(r'^\d{4}', num) or          # 4-digit year
            re.search(r'^\d+\s+(?:para\.|paras\.|Sch\.|s\.|art\.|reg\.|\(c\.\)|Pt\.)', t, re.I) or
            re.search(r'^\d+\s+\(c\.\s*\d', t) or  # "14) (c. 14)"
            _CITE_CONT.search(t) or               # contains ", Sch." etc.
            # Short fragment: just "N Pt. X" or "N (with..." style
            (len(t) < 30 and re.search(r'\b(?:Pt\.|paras?\.|\(with\b)', t, re.I))
        )
        if not _is_citation:
            return f"sec:{num}"

    # Structural heading: Part 1, Chapter 2, Schedule 3
    # Also catch spaced-letter variants: "P ART 1" -> "part:1"
    t_coll = ' '.join(w.capitalize() for w in _norm_cmp(t).split())
    m = _RE_HEADING_KW.match(t) or _RE_HEADING_KW.match(t_coll)
    if m:
        words = (t_coll if _RE_HEADING_KW.match(t_coll) and not _RE_HEADING_KW.match(t) else t).split()
        num   = words[1] if len(words) > 1 else "?"
        return f"{words[0].lower()}:{num}"

    # All-caps heading: "OVERVIEW", "INTRODUCTION"
    if _RE_ALLCAPS.match(t):
        return f"caps:{t.strip().lower().replace(' ', '_')}"

    # "Textual Amendments" section header
    if _RE_TEXTUAL_AM.match(t):
        return "textual_amendments"

    # Annotation-prefixed section heading: "F84 24A Restrictions..." or
    # "[ F84 24A Restrictions...". These should align as section headings,
    # not as generic annotation lines, otherwise the section can be swallowed
    # into the preceding amendment entry when that entry ends without punctuation.
    m = re.match(
        r'^\[?\s*[FCEMSX]\d+[A-Za-z]?\s*\]?\s+(\d{1,3}[A-Za-z]?)\s+[A-Z]',
        t,
    )
    if m:
        return f"sec:{m.group(1)}"

    if _is_short_heading_text(t):
        return f"head:{_norm_cmp(t)[:50]}"

    # Bare F-number cluster lines like "F1972 F1973 F1974 F1975" are page
    # annotation index columns. They shift between versions as amendments are
    # added/removed and carry no stable anchor value — return None so the
    # segmenter merges them into adjacent content rather than creating a block.
    # Must be checked BEFORE _RE_F_AMEND which would otherwise match "F1972 F1973".
    if _is_f_cluster(t):
        return None

    # Textual amendment line: "F5 Word in s. ..." -- check BEFORE annot open
    # Strip the leading F-number from the anchor key: F-numbers shift between
    # versions when new amendments are inserted, but the legal text that follows
    # is stable. Anchoring on the F-number causes every downstream block to
    # mismatch when the offset shifts (e.g. F379 in doc A vs F350 in doc B).
    m = _RE_F_AMEND.match(t)
    if m:
        after_fnum = re.sub(r'^[A-Z]\d+[A-Za-z]?\s*', '', t, count=1)
        # Strip trailing "by <Act>..." citation so anchor is stable across versions
        action = re.split(r'\s+by\s+', after_fnum, maxsplit=1)[0]
        action = re.split(r'\s+\(with\s+', action, maxsplit=1)[0]
        key = _norm_cmp(action)[:60] or _norm_cmp(after_fnum)[:60]
        return f"famend:{key}"

    # Standalone annotation marker: [F6] or F6 alone on a line
    # A single bare marker like "F7" carries no content and shifts between
    # versions — return None so it merges into adjacent content.
    if _RE_ANNOTATION.match(t):
        # Bare single marker (just the code, no surrounding text): treat as noise
        if re.match(r'^[A-Z]\d+[A-Za-z]?$', t.strip()):
            return None
        code = re.sub(r'[\[\]\s]', '', t)
        return f"ann:{code}"

    # Annotation opening inline: "[F4(aa) makes provision..." or "[F6(ba) allows..."
    # The (aa)/(ba) here is the amendment sub-code, NOT a provision anchor.
    m = _RE_ANNOT_OPEN.match(t)
    if m and t.startswith('['):
        # Extract full annotation code including optional sub-provision suffix
        code = re.match(r'\[\s*([A-Z]\d+[A-Za-z]?(?:\([a-zA-Z]{1,3}\))?)', t)
        if code:
            return f"ann:{code.group(1)}"

    # Date line: "[6th March 2003]"
    if _RE_DATE.match(t):
        return f"date:{_norm_cmp(t)}"

    return None


def _median_gap(lines: List[PdfLine]) -> float:
    """Typical line spacing (median of all consecutive gaps)."""
    gaps = [lines[i].y - lines[i-1].y for i in range(1, len(lines))
            if lines[i].y > lines[i-1].y]
    if not gaps:
        return 14.0
    gaps.sort()
    return gaps[len(gaps) // 2]


@functools.lru_cache(maxsize=32768)
def _line_ends_sentence(text: str) -> bool:
    """True if a line ends with sentence-terminal punctuation or a closing bracket
    that closes a balanced annotation, or a closing parenthesis/semicolon."""
    t = text.rstrip()
    if not t:
        return False
    # Standard punctuation terminals
    if t[-1] in '.?!:':
        return True
    # Semicolon — common in legal lists that are genuinely complete items
    if t[-1] == ';':
        return True
    # Closing annotation bracket: only treat as sentence-end if brackets are balanced
    if t[-1] == ']':
        return t.count('[') <= t.count(']')
    # Closing parenthesis at end — often ends a cross-reference "(see section 12)"
    if t[-1] == ')':
        return t.count('(') <= t.count(')')
    return False


@functools.lru_cache(maxsize=32768)
def _line_ends_incomplete(text: str) -> bool:
    """
    True if a line clearly continues on the next line:
    ends with comma, dash, 'and', 'or', 'by', 'of', 'to', 'the', etc.,
    or has no terminal punctuation at all.
    Also treats lines ending with an open '[' as incomplete (annotation run-on).
    Special case: a line that ends with ONLY a closing parenthesis or bracket
    followed by whitespace is likely a continuation (not a terminal reference).
    """
    t = text.rstrip()
    if not t:
        return False
    if t[-1] in ',-—[':
        return True
    # If line ends with closing paren/bracket alone, treat as incomplete
    # unless it's balanced (e.g., "(see section 12)" is complete)
    if t[-1] in ')' and not (t.count('(') <= t.count(')')):
        return True  # unbalanced — likely a fragment
    last_word = t.split()[-1].lower().rstrip('.,;:') if t.split() else ''
    if last_word in ('and', 'or', 'by', 'of', 'to', 'the', 'a', 'an',
                     'in', 'on', 'with', 'for', 'at', 'from', 'as', 'into',
                     'under', 'within', 'without', 'whether', 'where',
                     'which', 'that', 'if', 'but', 'not', 'be', 'is',
                     'her', 'his', 'its', 'their'):
        return True
    return not _line_ends_sentence(t)


def _looks_heading_like(text: str) -> bool:
    """Heuristic for heading/title lines that should start a new block."""
    t = _norm(text)
    if not t:
        return False
    if _is_short_heading_text(t):
        return True
    # Fallback for OCR-spaced uppercase headings like "P ART 2 ..."
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    words = t.split()
    if upper_ratio >= 0.72 and 2 <= len(words) <= 18 and not t.endswith(('.', ';')):
        return True
    return False


def _open_brackets(lines) -> int:
    """Net count of unmatched '[' across the given PdfLine list (rough heuristic).
    Used to detect when we are mid-annotation and should not split on anchors."""
    text = ' '.join(_line_text(l) for l in lines)
    return text.count('[') - text.count(']')


def segment_blocks(lines: List[PdfLine]) -> List[Block]:
    """
    Stage 1: group PdfLines into logical Blocks.

    Merging rules (in priority order):
      1. Anchor on next line → start new block, BUT only if we are not currently
         inside an open bracket annotation ([Fx ...]).  If brackets are unbalanced
         we merge regardless, so that (aa) / (ba) sub-items inside [F6 ...] stay
         attached to their parent annotation block.
      2. Prev line ends incomplete (comma, dash, dangling word, no punct)
         → always merge, regardless of gap.
      3. Next line starts with lowercase → always merge.
      4. Very large vertical gap (>2.5× median) AND prev ends sentence
         → new block.
      5. Extremely large gap (>4.5× median) → new block regardless.
      6. Safety valve (≥ 40 lines) → flush.
    """
    if not lines:
        return []

    med = _median_gap(lines)
    gap_threshold = max(med * 2.5, 24.0)
    gap_extreme   = max(med * 4.5, 48.0)

    # Precompute per-line values once; this removes repeated expensive
    # _line_text/_norm/_anchor_of calls in the main segmentation loop.
    raw_texts = [_line_text(l) for l in lines]
    norm_texts = [_norm(t) for t in raw_texts]
    anchors = [(_anchor_of(t) or "") for t in norm_texts]
    br_delta = [t.count('[') - t.count(']') for t in raw_texts]

    blocks: List[Block] = []
    cur_start = 0
    cur_len = 1
    cur_anchor: str = anchors[0]
    _open_br: int = br_delta[0]

    def _flush(start_idx: int, end_idx: int, anchor_hint: str):
        # Build the block text from norm_texts, then strip out any F-cluster
        # tokens (bare annotation index numbers like "F1972 F1973") that bled
        # into the block from adjacent PDF index columns.  These tokens shift
        # between versions and would cause matching failures if left in place.
        raw_parts = norm_texts[start_idx:end_idx + 1]

        # Strip lines that are pure F-clusters (they add noise, not content)
        def _strip_f_tokens(text: str) -> str:
            """Remove leading/trailing bare F-number tokens from a line."""
            return re.sub(r'(?:^|\s)([A-Z]\d+[A-Za-z]?)(?=\s|$)', '', text).strip()

        cleaned_parts = []
        clean_line_indices = []  # which original lines survive after cluster removal
        for li2, part in enumerate(raw_parts):
            if _is_f_cluster(part):
                continue  # drop the entire line if it's a pure cluster
            # Strip only obvious leading F-number clusters, not genuine
            # amendment entries like "F102 Words in s. 27(1)...".
            cleaned = part.strip()
            if re.match(r'^(?:[A-Z]\d+[A-Za-z]?\s+){2,}', cleaned):
                cleaned = re.sub(r'^(?:[A-Z]\d+[A-Za-z]?\s+)+', '', cleaned).strip()
            if cleaned:
                cleaned_parts.append(cleaned)
                clean_line_indices.append(start_idx + li2)

        raw_text = ' '.join(cleaned_parts)
        raw_text = re.sub(r'\s+', ' ', raw_text).strip()
        raw_text = re.sub(r'([A-Za-z])-\s+([a-z])', r'\1\2', raw_text)
        if not raw_text or _is_noise(raw_text):
            return
        anchor = anchor_hint or (_anchor_of(raw_text) or f"txt:{_norm_cmp(raw_text)[:40]}")
        # Use cleaned line set if possible, fall back to full range
        block_lines = ([lines[i] for i in clean_line_indices]
                       if clean_line_indices else lines[start_idx:end_idx + 1])
        blocks.append(Block(
            anchor=anchor,
            text=raw_text,
            cmp=_norm_cmp(raw_text),
            lines=block_lines,
            x_min=block_lines[0].x_min,
            y=block_lines[0].y,
        ))

    for i in range(1, len(lines)):
        line_text = norm_texts[i]
        anchor = anchors[i]
        gap = lines[i].y - lines[i - 1].y
        prev_text = norm_texts[i - 1]
        next_anchor = anchors[i + 1] if i + 1 < len(lines) else ""

        start_new = False

        if cur_anchor == 'textual_amendments' and gap > 8:
            # Treat the heading as a standalone block; the next non-empty line
            # begins the amendment entry list or a following cross-heading.
            start_new = True

        if not start_new and anchor:
            # Lone provision labels sometimes break onto their own line between
            # an incomplete lead-in and the next sub-item, e.g. "if-" + "(4B)" + "(a)...".
            # Keep the lone label attached to the current block to avoid DEL/ADD noise.
            if (_is_lone_parenthesized_provision_marker(line_text) and
                    _line_ends_incomplete(prev_text) and
                    next_anchor.startswith('(')):
                start_new = False
            # Rule 1: recognised anchor starts new block — unless mid-annotation
            # OR unless the previous line is clearly an incomplete (wrapped) line
            # with no sentence termination. This prevents treating a continuation
            # line that happens to start with "(a)" etc. as a new block when it is
            # really the continuation of a split provision.
            elif _open_br > 0:
                # Annotation-wrapped inserted text can contain genuine internal
                # provision markers like (1A), (2), (a). Keep those structural
                # when they appear after a completed line, otherwise whole
                # sections get glued into one block and later extraction drifts.
                #
                # Also fires when an entire section is inserted inside [FXX ...]
                # brackets (e.g. "[F84 24A Restrictions..."): cur_anchor becomes
                # sec:24A but _open_br stays > 0. Without splitting here, all
                # sub-provisions (1)..(18) merge into one giant block that can
                # never align with the per-provision blocks in the other version.
                _in_bracket_container = (
                    cur_anchor.startswith('ann:') or
                    cur_anchor.startswith('sec:') or
                    cur_anchor.startswith('(')
                )
                if (anchor.startswith('(') and _in_bracket_container and
                        not _line_ends_incomplete(prev_text)):
                    start_new = True
                else:
                    start_new = False
            elif _line_ends_incomplete(prev_text):
                # Amendment citation lines often end without sentence-terminal
                # punctuation, but the following provision/heading is still a
                # genuine new block, not a continuation of the citation.
                if ((cur_anchor.startswith('famend:') or cur_anchor == 'textual_amendments') and
                        (anchor.startswith('(') or anchor.startswith('sec:') or
                         anchor.startswith('head:') or anchor.startswith('caps:') or
                         anchor == 'textual_amendments')):
                    start_new = True
                else:
                # Previous line is a dangling line — only split on STRONG anchors
                # (headings, structural markers) not on provision sub-items that
                # could be the continuation of a wrapped sentence.
                    _is_structural_anchor = (
                        anchor.startswith('part:') or
                        anchor.startswith('chapter:') or
                        anchor.startswith('schedule:') or
                        anchor == 'textual_amendments' or
                        anchor.startswith('caps:') or
                        anchor.startswith('head:') or
                        anchor.startswith('sec:') or
                        anchor.startswith('famend:')  # each amendment entry is self-contained
                    )
                    start_new = _is_structural_anchor
            else:
                start_new = True

        elif cur_anchor == 'textual_amendments' and _looks_heading_like(line_text):
            # A cross-heading following a textual-amendments heading starts a new block.
            start_new = True

        elif _line_ends_incomplete(prev_text):
            # Rule 2: incomplete previous line usually merges, except when this
            # line is clearly structural or starts a provision marker.
            _is_structural_text = (
                bool(_RE_HEADING_KW.match(line_text)) or
                bool(_RE_ALLCAPS.match(line_text)) or
                bool(_RE_TEXTUAL_AM.match(line_text))
            )
            _has_provision_anchor = bool(_RE_PROVISION.match(line_text))
            start_new = _is_structural_text or _has_provision_anchor

        elif line_text and line_text[0].islower():
            # Rule 3: next starts lowercase → merge
            start_new = False

        elif (i + 1 < len(lines) and anchors[i + 1].startswith('sec:') and
              gap > max(med * 1.8, 18.0)):
            # Cross-headings often sit immediately above a numbered section
            # heading. Keep them out of the preceding amendment/citation block.
            start_new = True

        elif _looks_heading_like(line_text) and gap > max(med * 1.8, 18.0):
            # Cross-headings are often short title lines preceded by an amendment
            # citation line that does not end with sentence punctuation. Treat a
            # heading-like line after a clear vertical gap as a new block.
            start_new = True

        elif _line_ends_sentence(prev_text) and _looks_heading_like(line_text):
            # Sentence completed, followed by heading-like line: start new block.
            start_new = True

        elif gap > gap_threshold and _line_ends_sentence(prev_text):
            # Rule 4: clean sentence end + large gap → new block
            start_new = True

        elif gap > gap_extreme:
            # Rule 5: extreme gap → new block regardless
            start_new = True

        # Rule 6: safety valve — but never cut inside an open annotation.
        if cur_len >= 200:
            start_new = True
        elif cur_len >= 60 and _open_br <= 0:
            start_new = True

        if start_new:
            _flush(cur_start, i - 1, cur_anchor)
            cur_start = i
            cur_len = 1
            cur_anchor = anchor or ""
            _open_br = br_delta[i]
        else:
            cur_len += 1
            _open_br += br_delta[i]

    _flush(cur_start, len(lines) - 1, cur_anchor)
    return blocks


# ─────────────────────────────────────────────────────────────
#  STAGE 2 - ANCHOR-KEYED BLOCK MATCHING & DIFF
# ─────────────────────────────────────────────────────────────

KIND_ADD = "add"
KIND_DEL = "del"
KIND_MOD = "mod"
KIND_EMP = "emp"


@dataclass
class Chunk:
    kind:    str
    block_a: int    # index into blocks_a, -1 if N/A
    block_b: int    # index into blocks_b, -1 if N/A
    text_a:  str
    text_b:  str
    confidence: float = 1.0
    reason: str = ""
    context_a: str = ""   # section heading from doc A (for ADD: where it goes)
    context_b: str = ""   # section heading from doc B (for DEL: where it was)
    xml_context: str = "" # matching XML text for the change location
    words_removed: str = ""  # specific words removed (for MOD: word-level diff)
    words_added: str = ""    # specific words added (for MOD: word-level diff)
    words_before: str = ""   # words immediately before the change (anchor context)
    words_after: str = ""    # words immediately after the change (anchor context)
    section: str = ""        # nearest structural heading (Part/Chapter/Section)
    emp_detail: str = ""     # emphasis change detail (e.g. "bold removed", "italic added")


# ─────────────────────────────────────────────────────────────
#  XML LINK / APPLY HELPERS
# ─────────────────────────────────────────────────────────────

_XML_TAG_RE = re.compile(r'<[^>]+>')


def _xml_plain_text(text: str) -> str:
    """Flatten innod XML into compare-friendly plain text.

    Handles the full innod tag vocabulary:
      innodReplace   — whitespace/separator wrapper: content becomes a space
      innodIdentifier — legal marker (a, 1, 1A): kept as text
      innodRef       — cross-reference link: inner text kept
      innodFootnoteRef — footnote marker: only the text= attr matters for probing
      <b>, <i>, etc. — inline formatting: stripped, text kept
    """
    if not text:
        return ""
    s = text

    # 1. innodReplace wrappers → single space (handles nested ones too)
    s = re.sub(r'<innodReplace\b[^>]*>(?:<innodReplace[^>]*>)*\s*(?:</innodReplace>\s*)*', ' ', s, flags=re.I | re.S)
    s = re.sub(r'(?:\s*</innodReplace>)+', ' ', s, flags=re.I)

    # 2. innodFootnoteRef — use only the text= attribute (the readable label)
    s = re.sub(
        r'<innodFootnoteRef\b[^>]*\btext="([^"]*)"[^>]*/?>(?:.*?</innodFootnoteRef>)?',
        r' \1 ',
        s, flags=re.I | re.S
    )
    # Self-closing innodFootnoteRef without text= attr — drop
    s = re.sub(r'<innodFootnoteRef\b[^>]*/>', ' ', s, flags=re.I)

    # 3. footnoteref (inner <footnoteref> tags) — drop entirely, they're just superscript markers
    s = re.sub(r'<footnoteref\b[^>]*/?>.*?</footnoteref>', ' ', s, flags=re.I | re.S)
    s = re.sub(r'<footnoteref\b[^>]*/>', ' ', s, flags=re.I)

    # 4. All remaining tags — strip, keep inner text
    s = re.sub(r'<[^>]+>', ' ', s)

    # 5. Unescape HTML entities (&#10; → newline → space, &amp; → &, etc.)
    s = html.unescape(s)

    # 6. Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def _xml_cmp_text(text: str) -> str:
    return _norm_cmp(_xml_plain_text(text))


def _extract_leading_identifier(text: str) -> Optional[str]:
    """Extract a legal marker used for innodIdentifier, e.g. a, 1, 1A, (1A)."""
    if not text:
        return None
    s = text.strip()
    m = re.match(r'^\(?([A-Za-z0-9]{1,6})\)?[\.:]?\b', s)
    if not m:
        return None
    ident = m.group(1)
    # Exclude common words that should not become identifiers.
    if ident.lower() in {"word", "words", "section", "part", "chapter", "schedule"}:
        return None
    return ident


def _title_with_identifier(title_text: str, ident: str) -> str:
    """Inject innodIdentifier inside title text and keep punctuation style."""
    t = title_text.strip()
    if not t:
        return f"<innodIdentifier>{html.escape(ident)}</innodIdentifier>"

    wrapped = f"<innodIdentifier>{html.escape(ident)}</innodIdentifier>"
    # Preserve bracketed markers: (1A)
    if re.match(r'^\([A-Za-z0-9]{1,6}\)\.?$', t):
        suffix = "." if t.endswith(".") else ""
        return f"({wrapped}){suffix}"
    # Preserve dotted markers: 1. / a.
    if re.match(r'^[A-Za-z0-9]{1,6}\.?$', t):
        suffix = "." if t.endswith(".") else ""
        return f"{wrapped}{suffix}"
    return html.escape(t)


def _find_best_xml_tag_match(xml_text: str, tag: str, probe: str) -> Optional[re.Match]:
    """Find the XML element whose plain text best matches probe text.

    Improvements over the original:
    - Raised fuzzy-match floor from 0.72 → 0.82 to prevent wrong-element matches
      (the main cause of false-positive apply highlights).
    - Exact / substring matches still return immediately (unchanged).
    - Added a word-overlap guard: if the best fuzzy candidate shares < 40 % of
      its words with the probe it is rejected, preventing short generic tags
      (e.g. a <p> containing only "A" or "1.") from matching a long probe.
    - Minimum inner-text length: an element whose plain text is shorter than
      30 % of the probe length is never a valid match.
    - Handles <innodHeading> wrappers: for the "title" tag the search also
      looks inside <innodHeading><title>…</title></innodHeading> blocks so
      heading text is found even when it isn't a bare <title>.
    """
    if not xml_text or not probe:
        return None
    probe_cmp = _norm_cmp(probe)
    if not probe_cmp:
        return None

    probe_words = set(probe_cmp.split())
    min_inner_len = max(3, int(len(probe_cmp) * 0.30))

    pat = re.compile(fr'<{tag}\b[^>]*>(.*?)</{tag}>', re.I | re.S)
    best = None
    best_score = 0.0

    for m in pat.finditer(xml_text):
        inner_plain = _xml_plain_text(m.group(1))
        inner_cmp = _norm_cmp(inner_plain)
        if not inner_cmp or len(inner_cmp) < min_inner_len:
            continue
        # Exact or substring match — return immediately (high confidence)
        if probe_cmp in inner_cmp or inner_cmp in probe_cmp:
            return m
        score = difflib.SequenceMatcher(None, probe_cmp, inner_cmp).ratio()
        if score > best_score:
            best_score = score
            best = m

    if best is None or best_score < 0.82:
        return None

    # Word-overlap guard: reject candidates that don't share enough words
    inner_plain = _xml_plain_text(best.group(1))
    inner_words = set(_norm_cmp(inner_plain).split())
    if probe_words and inner_words:
        overlap = len(probe_words & inner_words) / max(len(probe_words), len(inner_words))
        if overlap < 0.40:
            return None

    return best


def _locate_xml_span(xml_text: str, probe_text: str) -> Optional[Tuple[int, int]]:
    """Locate probe_text inside XML and return the span of the full containing element.

    Expands the match outward to cover the complete enclosing tag (e.g. the full
    <p>...</p> or <innodLevel>...</innodLevel>) so the XML highlight shows the
    entire relevant block rather than just the matched token run.
    """
    if not xml_text or not probe_text:
        return None

    probe_plain = _xml_plain_text(probe_text)
    tokens = re.findall(r'[A-Za-z0-9]{2,}', probe_plain)
    if not tokens:
        return None

    # Keep pattern selective but not too strict for tag-heavy content.
    tokens = tokens[:10]
    sep = r'(?:\s|<[^>]+>|&#10;|&nbsp;|&#160;)*'
    pat = re.compile(sep.join(re.escape(t) for t in tokens), re.I | re.S)
    m = pat.search(xml_text)

    if not m:
        # Fallback to title/p based fuzzy lookup.
        for tag in ("title", "p"):
            tm = _find_best_xml_tag_match(xml_text, tag, probe_plain)
            if tm:
                return _expand_to_container(xml_text, tm.start(), tm.end())
        return None

    return _expand_to_container(xml_text, m.start(), m.end())


def _expand_to_container(xml_text: str, hit_start: int, hit_end: int) -> Tuple[int, int]:
    """Expand (hit_start, hit_end) outward to the nearest complete enclosing XML element.

    Priority order of containers to look for (innermost wins):
      <p>, <title>, <innodHeading>, <innodLevel>, <section>, <footnote>
    Falls back to the raw token span if no container is found.
    """
    # Containers in preference order — innermost / most specific first.
    # innodFootnote wraps <footnote> which wraps <p>, so footnote before innodFootnote.
    _CONTAINERS = [
        "p", "title", "innodHeading", "th", "td",
        "footnote", "innodFootnote",
        "innodLevel", "section", "chapter",
    ]

    best_start = hit_start
    best_end   = hit_end
    best_size  = hit_end - hit_start

    for tag in _CONTAINERS:
        # Find all open tags of this type before hit_start
        open_pat  = re.compile(fr'<{re.escape(tag)}\b[^>]*>', re.I | re.S)
        close_pat = re.compile(fr'</{re.escape(tag)}>', re.I)

        # Scan backwards for the most recent open tag that has its close tag
        # after hit_end (i.e. the hit falls inside this element).
        for om in reversed(list(open_pat.finditer(xml_text, 0, hit_start + 1))):
            # Find the matching close tag after the open tag
            cm = close_pat.search(xml_text, om.end())
            if cm and cm.end() >= hit_end:
                span_size = cm.end() - om.start()
                # Prefer the smallest container that fully wraps the hit
                if span_size < best_size or best_size == hit_end - hit_start:
                    best_start = om.start()
                    best_end   = cm.end()
                    best_size  = span_size
                break  # found innermost match for this tag; stop scanning

    return (best_start, best_end)


def _replace_tag_inner(xml_text: str, tag_match: re.Match, new_inner: str) -> str:
    """Replace only inner content of a matched XML tag pair."""
    a, b = tag_match.span(1)
    return xml_text[:a] + new_inner + xml_text[b:]


def _build_added_level_block(text_b: str, level: str = "", collapsed: bool = False) -> str:
    """Build a properly formatted innodLevel block for an ADD change.

    Matches the exact structure seen in the innod XML format:
        <innodReplace>
        </innodReplace><innodLevel level="N"><section level="N"><innodReplace>
        </innodReplace><innodHeading><title>TEXT</title></innodHeading><innodReplace text=" ">
                          </innodReplace><p></p>
        <innodReplace>          </innodReplace></section></innodLevel>

    Level heuristic (when level not supplied):
      • Textual-amendment / F-number lines → level "10", collapsed=True
      • Bracketed provision markers like (1A), (a), (i) → level "7" (sub-subsection)
      • Simple dotted markers like "1." / "12A." → level "6" (subsection)
      • All-caps headings like "PART 1" / "CHAPTER 2" → level "3" or "4"
      • Everything else → level "" (EDG assigns correct level)
    """
    title = html.escape(text_b.strip())

    if not level:
        t = text_b.strip()
        if re.search(r'\btextual amendments?\b', t, re.I) or re.match(r'^[Ff]\d+[A-Za-z]?\b', t):
            level = "10"
            collapsed = True
        elif re.match(r'^\([A-Za-z0-9]{1,4}\)', t):          # (1A), (a), (i)
            level = "7"
        elif re.match(r'^[0-9]{1,3}[A-Za-z]?\.', t):         # 1. / 12A.
            level = "6"
        elif re.match(r'^CHAPTER\s', t, re.I):
            level = "4"
        elif re.match(r'^PART\s', t, re.I):
            level = "3"
        # else: leave blank — EDG sets the right level

    col_attr = ' collapsed="true"' if collapsed else ""
    lvl = level  # may be empty string — matches format spec

    return (
        "\n<innodReplace>\n"
        f"</innodReplace><innodLevel level=\"{lvl}\"{col_attr}>"
        f"<section level=\"{lvl}\"{col_attr}><innodReplace>\n"
        f"</innodReplace><innodHeading><title>{title}</title></innodHeading>"
        "<innodReplace text=\" \">\n"
        "                          </innodReplace><p></p>\n"
        "<innodReplace>                        </innodReplace></section></innodLevel>\n"
    )


def _innod_block_bounds(xml_text: str, search_from: int = 0) -> Optional[Tuple[int, int]]:
    """Find the start/end of the innodLevel block that contains position search_from.
    Returns (block_start, block_end) or None.
    Walks backward from search_from to find the opening <innodLevel> tag,
    then forward to find its matching closing </innodLevel>.
    """
    # Walk backward to the most recent <innodLevel
    open_pat  = re.compile(r'<innodLevel\b', re.I)
    close_tag = '</innodLevel>'

    # Find all innodLevel opens before search_from
    opens = [(m.start(), m.end()) for m in open_pat.finditer(xml_text, 0, search_from + 1)]
    if not opens:
        return None

    # Walk from the closest open forward, tracking nesting depth
    block_start = opens[-1][0]
    depth = 0
    pos = block_start
    while pos < len(xml_text):
        o = xml_text.find('<innodLevel', pos)
        c = xml_text.find(close_tag, pos)
        if o == -1 and c == -1:
            break
        if o != -1 and (c == -1 or o < c):
            depth += 1
            pos = o + 1
        else:
            depth -= 1
            if depth == 0:
                return (block_start, c + len(close_tag))
            pos = c + 1
    return None


def _find_innod_section(xml_text: str, probe: str) -> Optional[Tuple[int, int]]:
    """Find the innodLevel block most likely to contain probe text.

    Strategy (in order):
    1. Match last-path attribute against the leading title marker of probe
       (e.g. probe starts with "(4B)" → find last-path="(4B)").
    2. Match the <title> inside <innodHeading> against the probe heading.
    3. Match the <p> body text against the probe using a content-restricted search.

    Returns (section_start, section_end) character offsets so callers can
    restrict all tag-matching to that slice of the document.
    """
    probe_cmp = _norm_cmp(probe)
    if not probe_cmp:
        return None

    # ── Strategy 1: last-path attribute match ─────────────────────────────────
    # Extract leading provision marker from probe: "(4B)", "(a)", "1.", "12A."
    marker_m = re.match(r'^\(?([A-Za-z0-9]{1,5}[A-Za-z]?)\)?\s*\.?\s', probe.strip())
    if marker_m:
        marker = marker_m.group(0).strip().rstrip('.')
        # Build last-path candidates: "(4B)", "4B", "s. 4B"
        raw = marker_m.group(1)
        candidates = [f"({raw})", raw, f"s. {raw}"]
        for cand in candidates:
            lp_pat = re.compile(
                fr'<innodLevel\b[^>]*last-path="{re.escape(cand)}"[^>]*>',
                re.I
            )
            lp_m = lp_pat.search(xml_text)
            if lp_m:
                bounds = _innod_block_bounds(xml_text, lp_m.start())
                if bounds:
                    return bounds

    # ── Strategy 2: title match inside innodHeading ────────────────────────────
    # Search for <innodHeading>...<title>MATCH</title>...</innodHeading>
    heading_pat = re.compile(
        r'<innodHeading\b[^>]*>.*?<title\b[^>]*>(.*?)</title>.*?</innodHeading>',
        re.I | re.S
    )
    best_title_pos  = None
    best_title_score = 0.0
    for hm in heading_pat.finditer(xml_text):
        inner = _xml_plain_text(hm.group(1))
        inner_cmp = _norm_cmp(inner)
        if not inner_cmp:
            continue
        if probe_cmp in inner_cmp or inner_cmp in probe_cmp:
            bounds = _innod_block_bounds(xml_text, hm.start())
            if bounds:
                return bounds
        score = difflib.SequenceMatcher(None, probe_cmp[:60], inner_cmp[:60]).ratio()
        if score > best_title_score and score >= 0.82:
            best_title_score = score
            best_title_pos   = hm.start()

    if best_title_pos is not None:
        bounds = _innod_block_bounds(xml_text, best_title_pos)
        if bounds:
            return bounds

    # ── Strategy 3: content <p> match — but return containing section ─────────
    # Find the best-matching <p> anywhere, then expand to its innodLevel parent
    p_pat = re.compile(r'<p\b[^>]*>(.*?)</p>', re.I | re.S)
    probe_words = set(probe_cmp.split())
    min_inner   = max(3, int(len(probe_cmp) * 0.30))
    best_p_pos  = None
    best_p_score = 0.0

    for pm in p_pat.finditer(xml_text):
        inner = _xml_plain_text(pm.group(1))
        inner_cmp = _norm_cmp(inner)
        if not inner_cmp or len(inner_cmp) < min_inner:
            continue
        if probe_cmp in inner_cmp or inner_cmp in probe_cmp:
            bounds = _innod_block_bounds(xml_text, pm.start())
            return bounds  # exact hit → return immediately
        score = difflib.SequenceMatcher(None, probe_cmp, inner_cmp).ratio()
        if score > best_p_score:
            inner_words = set(inner_cmp.split())
            if probe_words and inner_words:
                overlap = len(probe_words & inner_words) / max(len(probe_words), len(inner_words))
                if overlap >= 0.40:
                    best_p_score = score
                    best_p_pos   = pm.start()

    if best_p_pos is not None and best_p_score >= 0.82:
        bounds = _innod_block_bounds(xml_text, best_p_pos)
        if bounds:
            return bounds

    return None


def extract_xml_sections(xml_text: str) -> List[dict]:
    """Parse the innodLevel structure of an XML document and return a flat list
    of sections with their headings and position ranges.

    Returns a list of dicts:
      {id, label, level, start, end, parent_id}
    Only sections with non-empty titles are returned.
    """
    if not xml_text:
        return []

    sections: List[dict] = []
    open_pat = re.compile(r'<innodLevel\b[^>]*>', re.I)
    heading_pat = re.compile(
        r'<innodHeading>\s*<title>(.*?)</title>', re.I | re.DOTALL
    )

    for m in open_pat.finditer(xml_text):
        # Extract level attribute
        level_m = re.search(r'level="(\d+)"', m.group())
        level = int(level_m.group(1)) if level_m else 99

        # Only include structural levels (Part=3, Chapter=4, Section=6-7)
        if level > 8:
            continue

        # Find bounds of this innodLevel block
        bounds = _innod_block_bounds(xml_text, m.start())
        if not bounds:
            continue

        # Look for a heading/title near the top of this section (first 800 chars)
        section_top = xml_text[m.start():min(m.start() + 800, bounds[1])]
        heading_m = heading_pat.search(section_top)
        if not heading_m:
            continue

        label = _xml_plain_text(heading_m.group(1)).strip()
        if not label or len(label) < 2:
            continue

        # Determine parent: the most recent section whose range contains this one
        parent_id = -1
        for prev in reversed(sections):
            if prev["start"] <= bounds[0] and prev["end"] >= bounds[1]:
                parent_id = prev["id"]
                break

        sections.append({
            "id": len(sections),
            "label": label,
            "level": level,
            "start": bounds[0],
            "end": bounds[1],
            "parent_id": parent_id,
        })

    return sections


def _build_xml_position_index(xml_text: str) -> dict:
    """Build a normalised-text → character-offset map for all <p>, <title>,
    <innodHeading> elements in the XML.  Used for O(1) section assignment
    instead of per-chunk regex searches.
    """
    index: dict[str, int] = {}
    pat = re.compile(
        r'<(?:p|title|innodHeading)\b[^>]*>(.*?)</(?:p|title|innodHeading)>',
        re.I | re.S,
    )
    for m in pat.finditer(xml_text):
        plain = _xml_plain_text(m.group(1))
        normed = _norm_cmp(plain)
        if normed and len(normed) >= 4 and normed not in index:
            index[normed] = m.start()
    return index


def assign_chunks_to_sections(
    chunks: List[Chunk],
    sections: List[dict],
    xml_text: str,
) -> None:
    """Assign each chunk to the most specific (deepest) XML section that
    contains it, based on the chunk's probe text position in the XML.

    Uses multiple matching strategies:
      1. Exact normalised text match in position index
      2. Content-only match (F-number markers stripped)
      3. Prefix match (first 50 normalised chars)
      4. Neighbour propagation for unresolved chunks

    Mutates each chunk's `section` field.
    """
    if not sections or not xml_text:
        return

    # ── Build position indexes ──────────────────────────────────────────
    pat = re.compile(
        r'<(?:p|title|innodHeading)\b[^>]*>(.*?)</(?:p|title|innodHeading)>',
        re.I | re.S,
    )
    pos_exact:  dict[str, int] = {}   # norm_cmp(text) → char offset
    pos_co:     dict[str, int] = {}   # norm_cmp(content_only(text)) → offset
    pos_prefix: dict[str, int] = {}   # first 50 chars of norm_cmp → offset

    for m in pat.finditer(xml_text):
        plain = _xml_plain_text(m.group(1))
        normed = _norm_cmp(plain)
        if not normed or len(normed) < 4:
            continue
        if normed not in pos_exact:
            pos_exact[normed] = m.start()
        co = _norm_cmp(_content_only(plain))
        if co and co not in pos_co:
            pos_co[co] = m.start()
        prefix = normed[:50]
        if prefix not in pos_prefix:
            pos_prefix[prefix] = m.start()

    def _section_for_pos(pos: int) -> Optional[dict]:
        """Find deepest section containing a character position."""
        best = None
        best_size = float("inf")
        for sec in sections:
            if sec["start"] <= pos < sec["end"]:
                size = sec["end"] - sec["start"]
                if size < best_size:
                    best_size = size
                    best = sec
        return best

    def _try_locate(text: str) -> Optional[dict]:
        """Try multiple strategies to locate text in XML and return section."""
        if not text:
            return None
        normed = _norm_cmp(text)
        if not normed or len(normed) < 3:
            return None

        # Strategy 1: exact position index
        pos = pos_exact.get(normed)
        if pos is not None:
            sec = _section_for_pos(pos)
            if sec:
                return sec

        # Strategy 2: content-only (strip F-numbers, brackets)
        co = _norm_cmp(_content_only(text))
        if co:
            pos = pos_co.get(co)
            if pos is not None:
                sec = _section_for_pos(pos)
                if sec:
                    return sec

        # Strategy 3: prefix match (first 50 normalised chars)
        prefix = normed[:50]
        if len(prefix) >= 20:
            pos = pos_prefix.get(prefix)
            if pos is not None:
                sec = _section_for_pos(pos)
                if sec:
                    return sec

        return None

    # ── Main assignment pass ────────────────────────────────────────────
    assigned = 0
    for ch in chunks:
        sec = _try_locate(ch.text_b) or _try_locate(ch.text_a)
        if sec:
            ch.section = sec["label"]
            assigned += 1

    # ── Neighbour propagation for remaining unassigned chunks ───────────
    # If a chunk sits between two chunks in the same section, inherit that.
    propagated = 0
    for i, ch in enumerate(chunks):
        if ch.section:
            continue
        # Look backward and forward (up to 15 chunks each direction)
        prev_sec = None
        next_sec = None
        for offset in range(1, 16):
            if prev_sec is None and i - offset >= 0 and chunks[i - offset].section:
                prev_sec = chunks[i - offset].section
            if next_sec is None and i + offset < len(chunks) and chunks[i + offset].section:
                next_sec = chunks[i + offset].section
            if prev_sec and next_sec:
                break
        # If both neighbours agree on the section, inherit
        if prev_sec and next_sec and prev_sec == next_sec:
            ch.section = prev_sec
            propagated += 1
        elif prev_sec:
            ch.section = prev_sec
            propagated += 1
        elif next_sec:
            ch.section = next_sec
            propagated += 1

    if assigned or propagated:
        print(f"  [assign_sections] direct={assigned} propagated={propagated} "
              f"total={assigned + propagated}/{len(chunks)}", flush=True)


def _apply_within_section(
    xml_text: str,
    section_start: int,
    section_end: int,
    probe: str,
    replacement_text: str,
    kind: str,          # "mod" | "del" | "add"
    ident: Optional[str],
) -> Tuple[str, bool, str, Optional[Tuple[int, int]]]:
    """Apply a change strictly within a known innodLevel block [section_start, section_end).

    For MOD / DEL:
      1. Match <p> inside the section.
      2. Match <title> inside the section (headings).
      3. Match <footnote> inner <p>.

    For ADD:
      Append a new innodLevel child block after the closest existing child,
      or fill the first empty <p> within the section.

    Returns (updated_xml, changed, message, (abs_start, abs_end)) where the
    span is always absolute (relative to the full xml_text).
    """
    section = xml_text[section_start:section_end]
    probe_cmp = _norm_cmp(probe)
    probe_words = set(probe_cmp.split())
    min_inner = max(3, int(len(probe_cmp) * 0.25))

    if kind in ("mod", "del"):
        # ── Try <p> within section ────────────────────────────────────────────
        p_pat = re.compile(r'<p\b[^>]*>(.*?)</p>', re.I | re.S)
        best_pm = None
        best_score = 0.0
        for pm in p_pat.finditer(section):
            inner = _xml_plain_text(pm.group(1))
            inner_cmp = _norm_cmp(inner)
            if not inner_cmp or len(inner_cmp) < min_inner:
                continue
            if probe_cmp in inner_cmp or inner_cmp in probe_cmp:
                best_pm = pm
                best_score = 1.0
                break
            score = difflib.SequenceMatcher(None, probe_cmp, inner_cmp).ratio()
            if score > best_score and score >= 0.75:
                inner_words = set(inner_cmp.split())
                overlap = (len(probe_words & inner_words) / max(len(probe_words), len(inner_words))
                           if probe_words and inner_words else 0.0)
                if overlap >= 0.35:
                    best_score = score
                    best_pm = pm

        if best_pm:
            new_inner = html.escape(replacement_text)
            new_section = section[:best_pm.start(1)] + new_inner + section[best_pm.end(1):]
            abs_start = section_start + best_pm.start()
            abs_end   = section_start + best_pm.start() + len(
                section[:best_pm.start()] +
                f"<p>{new_inner}</p>"   # approximate
            )
            updated = xml_text[:section_start] + new_section + xml_text[section_end:]
            # Recompute exact span
            abs_p_start = section_start + best_pm.start()
            new_tag = f"<p>{new_inner}</p>" if not re.match(r'<p\s', section[best_pm.start():best_pm.start()+3]) else \
                      section[best_pm.start():best_pm.start(1)] + new_inner + section[best_pm.end(1):best_pm.end()]
            abs_span = (abs_p_start, abs_p_start + len(new_tag))
            return updated, True, "Applied to <p> in section", abs_span

        # ── Try <title> within section ────────────────────────────────────────
        t_pat = re.compile(r'<title\b[^>]*>(.*?)</title>', re.I | re.S)
        for tm in t_pat.finditer(section):
            inner = _xml_plain_text(tm.group(1))
            inner_cmp = _norm_cmp(inner)
            if not inner_cmp:
                continue
            if probe_cmp in inner_cmp or inner_cmp in probe_cmp:
                if ident:
                    new_inner = _title_with_identifier(replacement_text or probe, ident)
                else:
                    new_inner = html.escape(replacement_text)
                new_section = section[:tm.start(1)] + new_inner + section[tm.end(1):]
                updated = xml_text[:section_start] + new_section + xml_text[section_end:]
                abs_span = (section_start + tm.start(), section_start + tm.end())
                return updated, True, "Applied to <title> in section" + (" with innodIdentifier" if ident else ""), abs_span

        # ── Try <footnote> inner <p> within section ───────────────────────────
        fn_pat = re.compile(r'<footnote\b[^>]*>(.*?)</footnote>', re.I | re.S)
        for fm in fn_pat.finditer(section):
            fn_inner_plain = _xml_plain_text(fm.group(1))
            if probe_cmp not in _norm_cmp(fn_inner_plain) and \
               difflib.SequenceMatcher(None, probe_cmp, _norm_cmp(fn_inner_plain)).ratio() < 0.75:
                continue
            # Replace the first <p> inside this footnote
            fp_pat = re.compile(r'<p\b[^>]*>(.*?)</p>', re.I | re.S)
            fp_m = fp_pat.search(fm.group(1))
            if fp_m:
                fn_block = fm.group(0)
                new_fn = fn_block[:fp_m.start(1) + (fm.start(1) - fm.start(1))] # recalc
                # Rebuild: replace inner of first <p> inside footnote
                fn_inner = fm.group(1)
                fp_m2 = fp_pat.search(fn_inner)
                if fp_m2:
                    new_fn_inner = fn_inner[:fp_m2.start(1)] + html.escape(replacement_text) + fn_inner[fp_m2.end(1):]
                    new_fn_block = fm.group(0)[:len(fm.group(0)) - len(fn_inner) - len('</footnote>')] \
                                   + new_fn_inner + '</footnote>'
                    # Simpler: just replace start(1)..end(1) in the section
                    fn_abs_start = section_start + fm.start(1) + fp_m2.start(1)
                    fn_abs_end   = section_start + fm.start(1) + fp_m2.end(1)
                    updated = xml_text[:fn_abs_start] + html.escape(replacement_text) + xml_text[fn_abs_end:]
                    abs_span = (fn_abs_start, fn_abs_start + len(html.escape(replacement_text)))
                    return updated, True, "Applied to <footnote> inner <p>", abs_span

        return xml_text, False, "No matching location in section (c/o EDG)", \
               (section_start, min(section_start + 500, section_end))

    # ── ADD within section ────────────────────────────────────────────────────
    # Find the last child </innodLevel> inside this section and insert after it.
    last_child_close = section.rfind('</innodLevel>')
    if last_child_close >= 0:
        insert_pos = section_start + last_child_close + len('</innodLevel>')
        block = _build_added_level_block(replacement_text)
        updated = xml_text[:insert_pos] + block + xml_text[insert_pos:]
        abs_span = (insert_pos, insert_pos + len(block))
        return updated, True, "Inserted innodLevel child block in section", abs_span

    # Fill first empty <p> in section
    empty_p = re.search(r'<p\b[^>]*>\s*</p>', section, re.I | re.S)
    if empty_p:
        abs_start = section_start + empty_p.start()
        insert = f"<p>{html.escape(replacement_text)}</p>"
        updated = xml_text[:abs_start] + insert + xml_text[abs_start + len(empty_p.group(0)):]
        abs_span = (abs_start, abs_start + len(insert))
        return updated, True, "Applied ADD into empty <p> in section", abs_span

    return xml_text, False, "No insertion point in section (c/o EDG)", \
           (section_start, min(section_start + 200, section_end))


def _apply_word_level_change(
    xml_text: str,
    section_start: int,
    section_end: int,
    probe: str,
    words_removed: str,
    words_added: str,
    words_before: str,
    words_after: str,
) -> Optional[Tuple[str, bool, str, Optional[Tuple[int, int]]]]:
    """Surgical word-level replacement within an XML section.

    Instead of replacing the entire <p> content, finds the specific words to
    remove and replaces them with the added words.  Uses words_before/words_after
    as anchoring context to avoid false matches.

    Returns (updated_xml, changed, message, span) or None if no match found.
    """
    if not words_removed:
        return None

    section = xml_text[section_start:section_end]
    probe_cmp = _norm_cmp(probe)

    # Find the <p> that contains the probe text
    p_pat = re.compile(r'<p\b[^>]*>(.*?)</p>', re.I | re.S)
    target_pm = None
    for pm in p_pat.finditer(section):
        inner = _xml_plain_text(pm.group(1))
        inner_cmp = _norm_cmp(inner)
        if not inner_cmp:
            continue
        if probe_cmp in inner_cmp or inner_cmp in probe_cmp:
            target_pm = pm
            break
        if difflib.SequenceMatcher(None, probe_cmp, inner_cmp).ratio() >= 0.75:
            target_pm = pm
            break

    if not target_pm:
        return None

    inner_xml = target_pm.group(1)
    inner_plain = _xml_plain_text(inner_xml)

    # Build a search pattern: words_before + words_removed + words_after
    # to find the exact location in the plain text
    search_parts = []
    if words_before:
        # Use last 2 words of before-context for anchoring
        bw = words_before.split()[-2:]
        search_parts.extend(bw)
    search_parts.extend(words_removed.split())
    if words_after:
        # Use first 2 words of after-context for anchoring
        aw = words_after.split()[:2]
        search_parts.extend(aw)

    # Build regex that matches the removed words with flexible whitespace/tags between them
    removed_words = words_removed.split()
    if not removed_words:
        return None

    # Try to find the removed words in the inner XML content
    # Escape each word for regex and allow XML tags + whitespace between them
    _TAG_WS = r'(?:\s|<[^>]*>)*'  # whitespace or XML tags between words
    word_patterns = [re.escape(w) for w in removed_words]
    removal_re = re.compile(_TAG_WS.join(word_patterns), re.I | re.S)

    match = removal_re.search(inner_xml)
    if not match:
        # Try case-insensitive matching on plain text for fallback
        return None

    # If we have context anchors, verify they appear nearby
    if words_before:
        before_words = words_before.split()[-2:]
        before_re = re.compile(
            _TAG_WS.join(re.escape(w) for w in before_words),
            re.I | re.S,
        )
        before_m = before_re.search(inner_xml[:match.start() + 20])
        if not before_m:
            # Context doesn't match — could be wrong location, skip
            pass  # proceed anyway, the word match is still valid

    # Replace the matched words with the added words
    replacement = html.escape(words_added) if words_added else ""
    new_inner_xml = inner_xml[:match.start()] + replacement + inner_xml[match.end():]

    # Rebuild the section and overall XML
    new_section = section[:target_pm.start(1)] + new_inner_xml + section[target_pm.end(1):]
    updated = xml_text[:section_start] + new_section + xml_text[section_end:]

    abs_start = section_start + target_pm.start(1) + match.start()
    abs_end = abs_start + len(replacement)
    return updated, True, "Applied word-level change", (abs_start, abs_end)


def _apply_chunk_to_xml(xml_text: str, ch: Chunk) -> Tuple[str, bool, str, Optional[Tuple[int, int]]]:
    """Apply one diff chunk into target XML — context-aware for innod format.

    For MOD chunks with word-level diff data (words_removed/words_added),
    performs a surgical word-level replacement instead of replacing the entire
    paragraph content. This ensures only the changed words are updated.

    Resolution order
    ────────────────
    1. Find the owning innodLevel via _find_innod_section (last-path attr,
       then <title>, then best <p>).
    2. For MOD with word-level data: find and replace specific words in the section.
    3. For full-content changes: apply the edit within that section.
    4. If no section can be resolved, fall back to locate-only (c/o EDG).

    EMP chunks are always no-ops (emphasis/formatting only).
    """
    if not xml_text:
        return xml_text, False, "No XML loaded", None
    if ch.kind == KIND_EMP:
        return xml_text, False, "Skipped emphasis-only change", None

    old_text = (ch.text_a or "").strip()
    new_text = (ch.text_b or "").strip()
    probe    = old_text or new_text
    ident    = _extract_leading_identifier(new_text or old_text)
    replacement_text = "" if ch.kind == KIND_DEL else new_text

    # ── Locate the owning innodLevel section ─────────────────────────────────
    section_bounds = _find_innod_section(xml_text, probe)

    if section_bounds:
        s_start, s_end = section_bounds

        # ── MOD with word-level precision ─────────────────────────────────────
        # When words_removed/words_added are populated, try surgical replacement
        # within the XML so only the specific changed words are modified.
        if ch.kind == KIND_MOD and getattr(ch, 'words_removed', '') and getattr(ch, 'words_added', ''):
            result = _apply_word_level_change(
                xml_text, s_start, s_end,
                probe,
                ch.words_removed, ch.words_added,
                getattr(ch, 'words_before', ''), getattr(ch, 'words_after', ''),
            )
            if result:
                return result
            # Fall through to full-content replacement if word-level fails

        return _apply_within_section(
            xml_text, s_start, s_end,
            probe, replacement_text, ch.kind, ident,
        )

    # ── No section found — ADD gets a fallback block, others get c/o EDG ─────
    if ch.kind == KIND_ADD:
        block = _build_added_level_block(new_text)
        # Append near end of document
        for close_tag in ("</document>", "</root>", "</chapter>"):
            close_idx = xml_text.lower().rfind(close_tag)
            if close_idx >= 0:
                updated = xml_text[:close_idx] + block + xml_text[close_idx:]
                abs_span = (close_idx, close_idx + len(block))
                return updated, True, "Inserted innodLevel block (fallback, c/o EDG)", abs_span
        updated = xml_text + block
        abs_span = (len(xml_text), len(xml_text) + len(block))
        return updated, True, "Appended innodLevel block at end (c/o EDG)", abs_span

    # MOD / DEL with no section match — highlight only
    span = _locate_xml_span(xml_text, probe)
    return xml_text, False, "No matching section found (c/o EDG)", span


def _emp_word_map(block: Block) -> dict:
    """
    Build {normalised_word: (bold, italic, underline, strikeout)} for every
    word in a block. Only records words that appear exactly once (unambiguous).
    Words appearing multiple times with different emphasis are excluded.
    Now tracks all four emphasis axes so underline/strikeout changes are caught.
    """
    counts: dict = {}   # word -> list of (bold, italic, underline, strikeout)
    for line in block.lines:
        for s in line.spans:
            for w in s.text.split():
                nw = re.sub(r'[.,;:()\'"\[\]]', '', w.lower())
                if len(nw) < 2:
                    continue
                emp = (s.bold, s.italic, s.underline, s.strikeout)
                counts.setdefault(nw, []).append(emp)
    # Keep only unambiguous words
    return {w: emps[0] for w, emps in counts.items() if len(set(emps)) == 1}


_emp_sig_cache: dict = {}

def _emp_sig_block(block: Block) -> str:
    """Compact signature string of word→emphasis for quick inequality test.
    Cached by object id — blocks are immutable after creation."""
    bid = id(block)
    if bid in _emp_sig_cache:
        return _emp_sig_cache[bid]
    wm = _emp_word_map(block)
    # Signature covers all 4 axes: Bold, Italic, Underline, Strikeout
    sig = "|".join(
        f"{w}{'B' if b else ''}{'I' if i else ''}{'U' if u else ''}{'S' if s else ''}"
        for w, (b, i, u, s) in sorted(wm.items())
    )
    _emp_sig_cache[bid] = sig
    return sig


def _emp_diff(block_a: Block, block_b: Block) -> bool:
    """
    True if bold, italic, underline, or strikeout meaningfully changed on a
    shared word between the two versions.

    Rules:
      - At least one shared word must have any of its four emphasis flags flipped.
      - Blocks where ALL shared words changed bold/italic ONLY are suppressed
        (heading-level formatting class change, not a semantic change).
        Underline/strikeout changes are always surfaced even if all words changed.
      - Pure citation-token emphasis changes (bold toggling on amendment markers
        like C1/F8/para/sch with no body-word changes) are suppressed — these
        are PDF template rendering differences, not editorial emphasis.
      - Words present in only one version are ignored (content → KIND_MOD).
    """
    wm_a = _emp_word_map(block_a)
    wm_b = _emp_word_map(block_b)
    common = set(wm_a) & set(wm_b)
    if not common:
        return False

    # Count words where ANY of the four emphasis axes changed.
    changed_words = [
        w for w in common
        if wm_a[w][0] != wm_b[w][0]   # bold changed
        or wm_a[w][1] != wm_b[w][1]   # italic changed
        or wm_a[w][2] != wm_b[w][2]   # underline changed
        or wm_a[w][3] != wm_b[w][3]   # strikeout changed
    ]
    if not changed_words:
        return False

    changed_chars = sum(len(w) for w in changed_words)
    total_chars   = sum(len(w) for w in common)
    if changed_chars < 3:
        return False
    if (changed_chars / max(total_chars, 1)) < 0.08:
        return False

    # If ALL shared words changed bold/italic only (not underline/strikeout),
    # treat as a heading-level formatting class switch and suppress.
    if len(changed_words) == len(common) and len(common) >= 2:
        only_bold_italic = all(
            wm_a[w][2] == wm_b[w][2] and  # underline unchanged
            wm_a[w][3] == wm_b[w][3]       # strikeout unchanged
            for w in changed_words
        )
        if only_bold_italic:
            return False

    # Suppress if ALL changed words are citation/abbreviation tokens or
    # fixed section-label words that toggle bold as PDF template artefacts.
    # Includes: amendment markers (f8, c2, f162), legal abbreviations (para, sch),
    # compound citation tokens (1363bi, 37bii), and words from the
    # "Modifications etc. (not altering text)" heading.
    #
    # Extended: single-letter tokens (a, b, c) and bare numbers are also
    # citation components when the block is in a famend: context (e.g. the
    # bold toggling on "s. 22(2)(a)" where "s", "22", "2", "a" all flip bold
    # together as a PDF hyperlink style artefact rather than an editorial change).
    _CITATION_PAT = _RE_EMP_CITATION
    body_changed = [w for w in changed_words if not _CITATION_PAT.match(w)]

    # Extra suppression for famend blocks: if the block anchor is a Textual
    # Amendment entry (famend:) the emphasis change is almost always a PDF
    # hyperlink underline/bold toggle on an inline section reference like
    # "s. 22(2)(a)".  Suppress when all remaining body-changed words are short
    # (≤4 chars) — these are section-label components, not legal words.
    if body_changed and block_a.anchor.startswith('famend:'):
        if all(len(w) <= 4 for w in body_changed):
            return False

    if not body_changed:
        return False

    # Suppress section-heading bold toggles: when the block starts with a
    # section number (e.g. "28 Meaning of...") and ALL changed words are
    # the heading phrase words (before the first "("), this is a PDF template
    # difference where the section number + title are bold in one version.
    if _RE_EMP_SEC_NUM.match(block_a.text.strip()):
        # Extract heading phrase: text before first "(" or first 6 words
        heading_part = block_a.text.split('(')[0] if '(' in block_a.text else ' '.join(block_a.text.split()[:8])
        heading_words = {re.sub(r'[^a-z0-9]', '', w.lower()) for w in heading_part.split() if len(w) > 1}
        if heading_words and all(w in heading_words or _CITATION_PAT.match(w) for w in body_changed):
            return False

    return True


def _emp_detail(block_a: Block, block_b: Block) -> str:
    """Return a human-readable description of which emphasis changed and how.

    Format examples:
      "bold removed: word1 word2"
      "italic added: word1"
      "bold removed: word1; underline added: word2"
    """
    wm_a = _emp_word_map(block_a)
    wm_b = _emp_word_map(block_b)
    common = set(wm_a) & set(wm_b)
    if not common:
        return ""

    axes = [("bold", 0), ("italic", 1), ("underline", 2), ("strikeout", 3)]
    added: dict[str, list[str]] = {}   # axis → [words]
    removed: dict[str, list[str]] = {} # axis → [words]

    for w in sorted(common):
        ea, eb = wm_a[w], wm_b[w]
        for axis_name, idx in axes:
            if ea[idx] and not eb[idx]:
                removed.setdefault(axis_name, []).append(w)
            elif not ea[idx] and eb[idx]:
                added.setdefault(axis_name, []).append(w)

    parts: list[str] = []
    for axis_name in ("bold", "italic", "underline", "strikeout"):
        if axis_name in removed:
            words = " ".join(removed[axis_name][:8])
            parts.append(f"{axis_name} removed: {words}")
        if axis_name in added:
            words = " ".join(added[axis_name][:8])
            parts.append(f"{axis_name} added: {words}")
    return "; ".join(parts)


@functools.lru_cache(maxsize=65536)
def _similarity(a: str, b: str) -> float:
    """
    Token-level similarity between two normalised strings.
    Returns 0.0–1.0. Uses the best available scorer.
    Whitespace/punctuation-only diffs → 1.0 (suppressed).
    """
    if not a and not b: return 1.0
    if not a or not b:  return 0.0
    if _is_whitespace_only_diff(a, b) or _is_punctuation_only_diff(a, b):
        return 1.0
    if _USE_RAPIDFUZZ:
        ts = _rfuzz.token_sort_ratio(a, b) / 100.0
        tx = _rfuzz.token_set_ratio(a, b)  / 100.0
        # token_set_ratio is 1.0 whenever one string is a strict token-subset of
        # the other (e.g. "Act" vs "Act 2010"). Guard against this by capping the
        # token_set bonus: only allow it to raise the score if length ratio is close.
        wa, wb = a.split(), b.split()
        len_ratio = min(len(wa), len(wb)) / max(len(wa), len(wb), 1)
        if len_ratio < 0.94:
            # Significantly different lengths — don't let token_set dominate
            return ts
        return max(ts, tx)
    wa, wb = a.split(), b.split()
    return difflib.SequenceMatcher(None, wa, wb, autojunk=False).ratio()


def _merge_reflow_fragments(blocks: List[Block]) -> List[Block]:
    """
    Post-segmentation pass: fuse consecutive blocks that are clearly reflow
    fragments of the same sentence.  A block is a reflow fragment when:
      - It has no recognised anchor (anchor starts with "txt:")
      - Its text does NOT end with sentence-terminal punctuation
      - The next block also has no recognised anchor
      - The combined length is ≤ 600 chars (a single provision)

    This handles the common legal PDF pattern where one version wraps a
    sentence across a different number of raw lines, producing multiple
    "txt:..." blocks from a single logical provision.
    """
    if not blocks:
        return blocks

    _STRUCTURAL_ANCHORS = frozenset({
        'textual_amendments',
    })

    def _is_frag_anchor(anchor: str) -> bool:
        """True for anchors that don't lock content to a specific structural slot."""
        return (anchor.startswith('txt:') or
                anchor == '')

    def _is_continuation_anchor(anchor: str) -> bool:
        """True for provision anchors whose content may continue across multiple
        raw blocks when the PDF wraps differently between versions."""
        # Provision anchors like (3), (a), (ba), sec:2 etc. are structural but
        # their text body can span multiple raw blocks in one version and fewer
        # in another.  We allow them to absorb following txt:/caps: fragments.
        return (anchor.startswith('(') or
                anchor.startswith('sec:') or
                anchor.startswith('ann:') or
                anchor.startswith('date:') or
                anchor.startswith('famend:'))

    out: List[Block] = []
    i = 0
    while i < len(blocks):
        cur = blocks[i]

        # Extra pass: bare provision-marker block (text IS the anchor, e.g. "(3)")
        # followed by a txt: body block — merge them into one provision block.
        # This happens when the PDF renders the marker and its body on separate
        # lines at different indentations so the segmenter splits them apart.
        _bare_marker = (
            cur.anchor.startswith('(') and
            re.sub(r'[^a-z0-9]', '', _norm_cmp(cur.text)) ==
            re.sub(r'[^a-z0-9]', '', cur.anchor)
        )
        if (_bare_marker and
                i + 1 < len(blocks) and
                _is_frag_anchor(blocks[i+1].anchor) and
                blocks[i+1].anchor not in _STRUCTURAL_ANCHORS and
                len(cur.text) + len(blocks[i+1].text) <= 600):
            nxt = blocks[i+1]
            merged_text = cur.text + ' ' + nxt.text
            merged_text = re.sub(r'\s+', ' ', merged_text).strip()
            cur = Block(
                anchor = cur.anchor,
                text   = merged_text,
                cmp    = _norm_cmp(merged_text),
                lines  = cur.lines + nxt.lines,
                x_min  = cur.x_min,
                y      = cur.y,
            )
            i += 1

        # Try to absorb following fragment blocks.
        # A block can absorb the next if:
        #   - Current has a frag anchor (txt:/caps:) OR a provision anchor,
        #   - Next has a frag anchor (txt:/caps:) — never absorb into a structural anchor,
        #   - Current text does not end a sentence,
        #   - Combined length stays reasonable.
        while (i + 1 < len(blocks) and
               (_is_frag_anchor(cur.anchor) or _is_continuation_anchor(cur.anchor)) and
               _is_frag_anchor(blocks[i+1].anchor) and   # ONLY absorb txt:/caps: frags
               not _line_ends_sentence(cur.text) and
               len(cur.text) + len(blocks[i+1].text) <= 600 and
               cur.anchor not in _STRUCTURAL_ANCHORS and
               blocks[i+1].anchor not in _STRUCTURAL_ANCHORS and
               # Never let a provision absorb beyond its own sentence —
               # this prevents sec:2 from swallowing (3), (4) etc.
               not (cur.anchor.startswith('sec:') and
                    blocks[i+1].anchor.startswith('('))):
            nxt = blocks[i+1]
            merged_text = cur.text + ' ' + nxt.text
            merged_text = re.sub(r'\s+', ' ', merged_text).strip()
            cur = Block(
                anchor = cur.anchor,
                text   = merged_text,
                cmp    = _norm_cmp(merged_text),
                lines  = cur.lines + nxt.lines,
                x_min  = cur.x_min,
                y      = cur.y,
            )
            i += 1
        out.append(cur)
        i += 1
    return out


def _is_guide_anchor(anchor: str) -> bool:
    """Strong structural anchors used to keep long-document alignment stable."""
    return (
        anchor.startswith('part:') or
        anchor.startswith('chapter:') or
        anchor.startswith('schedule:') or
        anchor.startswith('sec:') or
        anchor.startswith('head:') or
        anchor == 'textual_amendments'
    )



def _normalise_spaced_anchor(anchor: str) -> str:
    """Map spaced-letter PDF artefact anchors to canonical equivalents.
    e.g. 'txt:part 1' -> 'part:1', 'caps:o_verview' -> 'head:overview'

    IMPORTANT: head: anchors must use spaces (not underscores) so they match
    the head: anchors produced for non-spaced-letter extraction.
    e.g. 'caps:t_ax_on_employment_income' -> 'head:tax on employment income'
         'head:tax on employment income'  -> 'head:tax on employment income'  (unchanged)
    """
    if not anchor:
        return anchor
    m = re.match(r'^(?:txt|caps):p?\s*art\s+(\w+)', anchor, re.I)
    if m: return f"part:{m.group(1)}"
    m = re.match(r'^(?:txt|caps):c?\s*hapter\s+(\w+)', anchor, re.I)
    if m: return f"chapter:{m.group(1)}"
    m = re.match(r'^(?:txt|caps):s?\s*chedule\s+(\w+)', anchor, re.I)
    if m: return f"schedule:{m.group(1)}"
    # caps: anchors from spaced-letter headings: the anchor was built as
    # t.strip().lower().replace(' ', '_') from an ALL-CAPS spaced-letter line.
    # The equivalent head: anchor is built from the same text after _norm_cmp
    # which collapses spaced letters ("T AX" -> "tax").
    # Map both to a common space-separated lowercase form.
    if anchor.startswith('caps:'):
        # e.g. "caps:t_ax_on_employment_income" -> "t ax on employment income"
        # After _norm_cmp-style collapse: "tax on employment income"
        raw = anchor[5:].replace('_', ' ')
        # Collapse single-letter prefix artefacts: "t ax" -> "tax", "p art" -> "part"
        collapsed = re.sub(r'\b([a-z]) ([a-z]{2,})\b', lambda m: m.group(1) + m.group(2), raw)
        # Multiple passes for runs like "t a x o n"
        for _ in range(4):
            prev = collapsed
            collapsed = re.sub(r'\b([a-z]) ([a-z]{2,})\b', lambda m: m.group(1) + m.group(2), collapsed)
            if collapsed == prev:
                break
        return f"head:{collapsed.strip()}"
    m = re.match(r'^txt:(part|chapter|schedule)\s+(\w+)', anchor, re.I)
    if m: return f"{m.group(1).lower()}:{m.group(2)}"
    return anchor

def _guide_head_text(norm_anchor: str, cmp_text: str) -> str:
    """Return a stable guide-head preview for structural blocks.

    Section/chapter/part blocks sometimes arrive with leading amendment or
    citation residue from the previous extracted line, e.g.:
      "Act 2017 ..., Sch. 2 para. 15 104 General rule ..."
      "F2815. 103A inserted ... 104 General rule ..."

    If that residue is left in place, the `GUIDE::sec:104::...` key differs
    across old/new PDFs and the alignment drifts, producing false ADD/DEL hits
    for otherwise unchanged sections. This helper trims back to the true
    structural heading when possible.
    """
    s = re.sub(r'^(?:[a-z]\d+[a-z]?\s+)+', '', cmp_text).strip()
    if not s:
        return ""

    if norm_anchor == 'textual_amendments':
        return 'textual amendments'

    if norm_anchor.startswith('sec:'):
        ident = norm_anchor.split(':', 1)[1]
        m = re.search(rf'\b{re.escape(ident)}\b', s, re.I)
        if not m:
            m = re.search(rf'\b{re.escape(ident)}(?=[a-z])', s, re.I)
        if m:
            s = s[m.start():].lstrip()
    elif norm_anchor.startswith(('part:', 'chapter:', 'schedule:')):
        fam, ident = norm_anchor.split(':', 1)
        m = re.search(rf'\b{re.escape(fam)}\s+{re.escape(ident)}\b', s, re.I)
        if m:
            s = s[m.start():].lstrip()
    elif norm_anchor.startswith('head:'):
        label = norm_anchor.split(':', 1)[1]
        if label:
            m = re.search(re.escape(label[:40]), s, re.I)
            if m:
                s = s[m.start():].lstrip()

    # Fallback: if the block still starts with citation residue, trim to the
    # first later structural marker or numbered section heading.
    for pat in (
        r'\b(?:part|chapter|schedule|section)\s+\d+[a-z]?\b',
        r'\b\d{1,3}[a-z]?(?=\s+[a-z])',
    ):
        m = re.search(pat, s, re.I)
        if m and m.start() > 0:
            s = s[m.start():].lstrip()
            break

    return ' '.join(s.split()[:8])


def _seq_key(block: Block) -> str:
    """SequenceMatcher key.

    Strong structural anchors use anchor identity rather than raw text so one
    early mismatch does not cause the rest of a long document to drift.
    The head text is sanitised to remove leading amendment/citation residue that
    can bleed into heading lines from adjacent annotation clusters in the PDF.
    """
    _clean_cmp = re.sub(r'^(?:[a-z]\d+[a-z]?\s+)+', '', block.cmp).strip()
    # Normalise spaced-letter artefact anchors for consistent GUIDE keys
    norm_anchor = _normalise_spaced_anchor(block.anchor)
    head = _guide_head_text(norm_anchor, _clean_cmp)

    if _is_guide_anchor(norm_anchor):
        return f"GUIDE::{norm_anchor}::{head}"
    if norm_anchor and not norm_anchor.startswith('txt:'):
        return f"ANCH::{norm_anchor}::{head}"
    return block.cmp


def _windowed_opcodes(seq_a_h: List[int], seq_b_h: List[int], seq_a: List[str], seq_b: List[str]):
    """Build SequenceMatcher opcodes in guide-anchored windows.

    For long documents, one noisy region can shift global alignment and make
    later pages inaccurate. We anchor windows at matched GUIDE tokens and run
    SequenceMatcher per window so drift does not propagate.
    """
    def _is_guide_token(s: str) -> bool:
        return s.startswith("GUIDE::")

    guides_a = [(i, s) for i, s in enumerate(seq_a) if _is_guide_token(s)]
    guides_b = [(j, s) for j, s in enumerate(seq_b) if _is_guide_token(s)]
    if not guides_a or not guides_b:
        sm = difflib.SequenceMatcher(None, seq_a_h, seq_b_h, autojunk=False)
        return sm.get_opcodes()

    ga_tokens = [s for _, s in guides_a]
    gb_tokens = [s for _, s in guides_b]
    smg = difflib.SequenceMatcher(None, ga_tokens, gb_tokens, autojunk=False)

    checkpoints: List[Tuple[int, int]] = []
    for op, i1, i2, j1, j2 in smg.get_opcodes():
        if op != "equal":
            continue
        for k in range(i2 - i1):
            ai = guides_a[i1 + k][0]
            bj = guides_b[j1 + k][0]
            checkpoints.append((ai, bj))

    if not checkpoints:
        sm = difflib.SequenceMatcher(None, seq_a_h, seq_b_h, autojunk=False)
        return sm.get_opcodes()

    opcodes: List[Tuple[str, int, int, int, int]] = []
    start_a = 0
    start_b = 0

    for end_a, end_b in checkpoints:
        if end_a < start_a or end_b < start_b:
            continue
        sm = difflib.SequenceMatcher(
            None,
            seq_a_h[start_a:end_a + 1],
            seq_b_h[start_b:end_b + 1],
            autojunk=False,
        )
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            opcodes.append((op, start_a + i1, start_a + i2, start_b + j1, start_b + j2))
        start_a = end_a + 1
        start_b = end_b + 1

    if start_a < len(seq_a_h) or start_b < len(seq_b_h):
        sm = difflib.SequenceMatcher(None, seq_a_h[start_a:], seq_b_h[start_b:], autojunk=False)
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            opcodes.append((op, start_a + i1, start_a + i2, start_b + j1, start_b + j2))

    return opcodes


def _anchor_family(anchor: str) -> str:
    """Coarse anchor family for fuzzy-anchor matching."""
    if not anchor:
        return "none"
    if anchor.startswith('('):
        return "prov"
    if anchor.startswith('sec:'):
        return "sec"
    if anchor.startswith('part:'):
        return "part"
    if anchor.startswith('chapter:'):
        return "chapter"
    if anchor.startswith('schedule:'):
        return "schedule"
    if anchor.startswith('head:'):
        return "head"
    if anchor.startswith('ann:'):
        return "ann"
    if anchor.startswith('famend:'):
        return "famend"
    if anchor.startswith('date:'):
        return "date"
    if anchor.startswith('txt:'):
        return "txt"
    return "other"


def _anchor_fuzzy_score(anchor_a: str, anchor_b: str) -> float:
    """0..1 fuzzy anchor compatibility score used before pure similarity."""
    if not anchor_a or not anchor_b:
        return 0.0
    if anchor_a == anchor_b:
        return 1.0

    fam_a = _anchor_family(anchor_a)
    fam_b = _anchor_family(anchor_b)
    if fam_a != fam_b:
        # Special tolerance: head/txt often flip due OCR/heading extraction.
        if {fam_a, fam_b} == {"head", "txt"}:
            return 0.45
        return 0.0

    # Same family but not exact anchor.
    if fam_a == "prov":
        # Keep provision anchors strict to avoid (b) <-> (c) false positives.
        return 0.0
    if fam_a in {"part", "chapter", "schedule", "sec", "ann", "famend"}:
        prefix_a = anchor_a.split(':', 1)[-1]
        prefix_b = anchor_b.split(':', 1)[-1]
        if prefix_a and prefix_b and prefix_a[:1] == prefix_b[:1]:
            return 0.70
        return 0.35
    if fam_a in {"head", "txt", "date"}:
        return 0.50
    return 0.25


def _relative_pos(idx: int, total: int) -> float:
    if total <= 1:
        return 0.0
    return idx / max(total - 1, 1)


def _position_score(idx_a: int, total_a: int, idx_b: int, total_b: int) -> float:
    """0..1 position agreement score used as tie-breaker.

    When the two documents have significantly different block counts (e.g. one
    is 30% longer due to additional schedules), the same legal content appears
    at very different fractional positions. A fixed narrow band actively hurts
    alignment by scoring correct pairs as zero.

    Strategy: scale tolerance proportionally so same-content blocks in docs
    with up to 2x size difference still score positively. For very large
    differences the position signal is unreliable so we cap it near 0.5.
    """
    pa = _relative_pos(idx_a, total_a)
    pb = _relative_pos(idx_b, total_b)
    dist = abs(pa - pb)
    # Adaptive tolerance: base 0.20, stretched by inverse size ratio
    size_ratio = min(total_a, total_b) / max(total_a, total_b, 1)
    # size_ratio=1.0 → tol=0.20; size_ratio=0.5 → tol=0.40; cap at 0.50
    tolerance = min(0.20 / max(size_ratio, 0.25), 0.50)
    return max(0.0, 1.0 - (dist / tolerance))


@functools.lru_cache(maxsize=65536)
def _char_similarity(a: str, b: str) -> float:
    """Character-level similarity fallback (works better for CJK and OCR joins)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    aa = re.sub(r'\s+', '', a)
    bb = re.sub(r'\s+', '', b)
    if not aa and not bb:
        return 1.0
    if not aa or not bb:
        return 0.0
    if _USE_RAPIDFUZZ:
        return _rfuzz.ratio(aa, bb) / 100.0
    return difflib.SequenceMatcher(None, aa, bb, autojunk=False).ratio()


@functools.lru_cache(maxsize=65536)
def _content_only(text: str) -> str:
    """Strip amendment annotation markup to leave only the pure legal content.

    Removes:
    - Inline bracket references: [F17A], [F2Chapters 1 to 7 of]
    - Trailing cross-reference parentheticals: (see Part 9), (c. 3)
      but only when they appear at the END of the text
    - Spaced-letter artefacts from older PDF renderers: 'P ART' -> 'part'

    Used as the comparison basis in _combined_similarity so that blocks
    that differ only in which amendments they reference are not flagged
    as changed content.
    """
    s = _norm_cmp(text)
    # Strip SHORT [...] annotation bracket groups that contain only F-numbers or
    # act refs (e.g. [F17A], [C3], [E+W+S]).  Limit to ≤20 chars inside brackets
    # so we don't accidentally consume long body text like
    # [F1541"nominees' income withdrawal" has the meaning...;]
    s = re.sub(r'\[\s*[fcems]?\d+[a-z]?[^\]]{0,20}\]', ' ', s, flags=re.I)
    # For long-body brackets: strip only the [F#### marker prefix and the ]
    # but keep the body text inside, e.g.:
    #   [F1541"nominees' ... withdrawal";] → "nominees' ... withdrawal";
    s = re.sub(r'\[\s*[fcems]?\d+[a-z]?\s*', ' ', s, flags=re.I)
    s = re.sub(r'\s*;\s*\]', ' ', s)  # strip ";]" closers
    s = re.sub(r'\s*\]', ' ', s)      # strip remaining "]"
    # Strip orphaned brackets left after the above
    s = re.sub(r'\[\s*\]', ' ', s)
    # Collapse multiple spaces
    s = re.sub(r'\s+', ' ', s).strip()
    return s


@functools.lru_cache(maxsize=65536)
def _combined_similarity(a: str, b: str) -> float:
    """Best-effort similarity combining token and character views.
    Uses content-only text (annotation-stripped) as primary signal so that
    blocks differing only in amendment bracket references score as identical.
    """
    if a == b:
        return 1.0
    # Content-only comparison (strips [F17A] etc.)
    ca, cb = _content_only(a), _content_only(b)
    if ca and cb:
        cs = max(_similarity(ca, cb), _char_similarity(ca, cb))
        if cs >= 0.97:
            return cs
    na, nb = _norm_cmp(a), _norm_cmp(b)
    if na == nb:
        return 1.0
    # Try token similarity first (cheaper); only call char_similarity if needed
    ts = _similarity(na, nb)
    if ts >= 0.97:
        return ts
    return max(ts, _char_similarity(na, nb))


def _annotate_chunk_quality(chunks: List[Chunk], blocks_a: List[Block], blocks_b: List[Block]) -> List[Chunk]:
    """Final confidence/reason post-process for structured diff output."""
    for ch in chunks:
        if ch.reason:
            continue
        if ch.kind == KIND_EMP:
            ch.confidence = 0.95
            ch.reason = "formatting: emphasis changed"
            continue
        if ch.kind == KIND_ADD:
            ch.confidence = 0.90
            ch.reason = "unmatched block in revised document"
            continue
        if ch.kind == KIND_DEL:
            ch.confidence = 0.90
            ch.reason = "unmatched block in original document"
            continue
        if ch.kind == KIND_MOD:
            na = _norm_cmp(ch.text_a)
            nb = _norm_cmp(ch.text_b)
            sim = _similarity(na, nb)
            if sim >= 0.92:
                ch.confidence = 0.96
                ch.reason = "similarity: high-confidence wording change"
            elif sim >= 0.82:
                ch.confidence = 0.88
                ch.reason = "similarity: moderate-confidence wording change"
            else:
                ch.confidence = 0.74
                ch.reason = "similarity: low-confidence modification"
    return chunks


# ─────────────────────────────────────────────────────────────
#  XML CROSS-VALIDATION (tri-source: PDF-A, PDF-B, XML)
#
#  When XML ground truth is available, probe each diff chunk against
#  the XML to suppress false positives that arise from PDF extraction
#  noise but have no corresponding change in the authoritative XML.
# ─────────────────────────────────────────────────────────────

class _XmlIndex:
    """Pre-built index of normalised text content from XML elements.

    Optimised for large (5-10 MB) XML files:
      - Single regex pass extracts p/title/innodHeading elements
      - Hash set for O(1) exact-match lookups (catches 80%+ of probes)
      - Joined corpus for fast substring containment (avoids shingle overhead)
      - 4-gram shingle index for fast fuzzy candidate filtering
      - Fuzzy candidates capped at 20 to avoid quadratic blowup
      - Per-probe result cache to avoid redundant work
    """

    def __init__(self, xml_text: str):
        self._paragraphs: List[str] = []       # normalised full-text
        self._exact_set: set = set()           # for O(1) exact / substring checks
        self._joined_corpus: str = ""          # all paragraphs joined for substring check
        self._shingle_index: dict = {}         # 4-gram -> list of paragraph indices (sorted)
        self._probe_cache: dict = {}           # text -> result (Optional[str])
        self._build(xml_text)

    def _build(self, xml_text: str):
        from collections import defaultdict
        shingle_idx: dict = defaultdict(list)

        # Single-pass regex for all three tags at once
        pat = re.compile(
            r'<(?:p|title|innodHeading)\b[^>]*>(.*?)</(?:p|title|innodHeading)>',
            re.I | re.S,
        )
        paragraphs = self._paragraphs
        exact = self._exact_set
        for m in pat.finditer(xml_text):
            plain = _xml_plain_text(m.group(1))
            normed = _norm_cmp(plain)
            if not normed or len(normed) < 3:
                continue
            idx = len(paragraphs)
            paragraphs.append(normed)
            exact.add(normed)
            # Build 4-gram shingles — skip very long paragraphs to limit index size
            n = normed
            if len(n) > 500:
                n = n[:500]
            for i in range(len(n) - 3):
                shingle_idx[n[i:i+4]].append(idx)

        # Convert to regular dict with tuple values for faster iteration
        self._shingle_index = {k: tuple(v) for k, v in shingle_idx.items()}
        # Joined corpus for fast O(n) substring containment
        self._joined_corpus = " \x00 ".join(paragraphs)

    def _find_candidates(self, normed: str, max_candidates: int = 20) -> List[int]:
        """Fast fuzzy candidate selection via shingle overlap."""
        # Use array counting instead of Counter — much faster for large index
        n_para = len(self._paragraphs)
        if n_para == 0:
            return []
        hits = [0] * n_para
        shingle_index = self._shingle_index
        n = normed
        if len(n) > 500:
            n = n[:500]
        any_hit = False
        for i in range(len(n) - 3):
            bucket = shingle_index.get(n[i:i+4])
            if bucket:
                any_hit = True
                for idx in bucket:
                    hits[idx] += 1
        if not any_hit:
            return []
        # Partial sort: find top-N without full sort
        # Use a simple threshold: at least 20% of query 4-grams must match
        min_hits = max(1, (len(n) - 3) // 5)
        candidates = [(hits[i], i) for i in range(n_para) if hits[i] >= min_hits]
        candidates.sort(reverse=True)
        return [idx for _, idx in candidates[:max_candidates]]

    def probe(self, text: str, threshold: float = 0.82) -> Optional[str]:
        """Find the best matching XML paragraph for the given text.

        Returns the matched normalised XML text if similarity >= threshold,
        else None.
        """
        # Check cache first
        cache_key = text
        cached = self._probe_cache.get(cache_key)
        if cached is not None:
            return cached if cached != "" else None

        result = self._probe_uncached(text, threshold)
        # Store in cache (use "" sentinel for None)
        self._probe_cache[cache_key] = result if result is not None else ""
        return result

    def _probe_uncached(self, text: str, threshold: float) -> Optional[str]:
        normed = _norm_cmp(text)
        if not normed or len(normed) < 3:
            return None

        # Fast path: exact match
        if normed in self._exact_set:
            return normed

        # Fast path: substring containment in joined corpus
        if len(normed) >= 6 and normed in self._joined_corpus:
            # Find which paragraph contains it
            for p in self._paragraphs:
                if normed in p or p in normed:
                    return p
            # Contained in joined but spans separator — still a match
            return normed

        candidates = self._find_candidates(normed)
        if not candidates:
            return None

        best_score = 0.0
        best_para = None
        for idx in candidates:
            p = self._paragraphs[idx]
            # Substring containment — immediate return
            if normed in p or p in normed:
                return p
            sim = _similarity(normed, p)
            if sim >= 0.95:
                return p  # early exit on near-perfect match
            if sim > best_score:
                best_score = sim
                best_para = p

        if best_score >= threshold:
            return best_para
        return None

    def contains_text(self, text: str, threshold: float = 0.82) -> bool:
        """True if the XML contains content matching this text."""
        return self.probe(text, threshold) is not None

    def find_pair(self, text_a: str, text_b: str, threshold: float = 0.82) -> Optional[Tuple[Optional[str], Optional[str]]]:
        """Probe both sides of a MOD chunk against XML.
        Returns (match_a, match_b) where each is the matched XML text or None."""
        return (self.probe(text_a, threshold), self.probe(text_b, threshold))


def _xml_cross_validate_chunks(
    chunks: List[Chunk],
    xml_index_a: Optional[_XmlIndex],
    xml_index_b: Optional[_XmlIndex],
    corpus_a_joined: str = "",
    corpus_b_joined: str = "",
) -> List[Chunk]:
    """Use XML ground truth to suppress false-positive diff chunks.

    Cross-validation rules (applied per chunk):

    1. DEL chunk: text_a is "deleted" from old doc. If xml_index_b (new XML)
       contains this text → the content still exists → false positive → suppress.

    2. ADD chunk: text_b is "added" in new doc. If xml_index_a (old XML)
       contains this text → the content already existed → false positive → suppress.
       Also when only xml_b available: if text is in new XML AND also found
       in old-side corpus → block segmentation artefact → suppress.

    3. MOD chunk: text_a→text_b. If both map to the SAME XML paragraph in
       xml_index_b → same underlying content, just PDF extraction variance → suppress.

    4. EMP chunk: emphasis-only. If the text maps to the same XML element
       → formatting extraction artefact → suppress.
    """
    if not xml_index_a and not xml_index_b:
        return chunks

    out: List[Chunk] = []
    suppressed = 0

    for ch in chunks:
        keep = True

        if ch.kind == KIND_DEL and xml_index_b:
            # "Deleted" text found in new XML → not really deleted
            if xml_index_b.contains_text(ch.text_a, threshold=0.85):
                keep = False

        elif ch.kind == KIND_ADD and xml_index_a:
            # "Added" text found in old XML → not really new
            if xml_index_a.contains_text(ch.text_b, threshold=0.85):
                keep = False

        elif ch.kind == KIND_ADD and xml_index_b and not xml_index_a:
            # Only new XML available
            nt = _norm_cmp(ch.text_b).strip()
            if not xml_index_b.contains_text(ch.text_b, threshold=0.80):
                # Text not in new XML → extraction ghost → suppress
                keep = False
            elif corpus_a_joined and len(nt) >= 8 and nt in corpus_a_joined:
                # Text IS in new XML AND in old corpus → block-segmentation FP
                keep = False
            elif corpus_a_joined and len(nt) >= 12:
                # Try provision-anchor-stripped check
                st = _strip_prov_anchors(ch.text_b)
                if st:
                    sn = _norm_cmp(st).strip()
                    if len(sn) >= 8 and sn in corpus_a_joined:
                        keep = False

        elif ch.kind == KIND_DEL and not xml_index_b and xml_index_a:
            # Only old XML available: if text not in old XML → ghost
            if not xml_index_a.contains_text(ch.text_a, threshold=0.80):
                keep = False

        elif ch.kind == KIND_MOD and xml_index_b:
            match_a = xml_index_b.probe(ch.text_a, threshold=0.82)
            match_b = xml_index_b.probe(ch.text_b, threshold=0.82)
            if match_a and match_b:
                # Both sides of the "modification" map to the same XML content
                if match_a == match_b:
                    keep = False
                # Or they map to very similar XML content (extraction variance)
                elif _similarity(match_a, match_b) >= 0.95:
                    keep = False

        elif ch.kind == KIND_EMP and xml_index_b:
            match_a = xml_index_b.probe(ch.text_a, threshold=0.85)
            match_b = xml_index_b.probe(ch.text_b, threshold=0.85)
            if match_a and match_b and (match_a == match_b or _similarity(match_a, match_b) >= 0.95):
                keep = False

        if keep:
            out.append(ch)
        else:
            suppressed += 1

    if suppressed:
        print(f"  [xml_cross_validate] suppressed {suppressed} false positives via XML ground truth", flush=True)

    return out


def compute_diff(
    lines_a: List[PdfLine],
    lines_b: List[PdfLine],
    xml_text_a: Optional[str] = None,
    xml_text_b: Optional[str] = None,
    on_progress: Optional[callable] = None,
) -> Tuple[List[Block], List[Block], List[Chunk]]:
    """
    Full pipeline: segment -> match -> diff.
    Returns (blocks_a, blocks_b, chunks).
    chunks reference indices into blocks_a / blocks_b.
    on_progress(sub_stage: str, pct: int) — optional callback for fine-grained progress.
    """
    def _progress(sub: str, pct: int):
        if on_progress:
            try:
                on_progress(sub, pct)
            except Exception:
                pass

    import time as _time
    _cd_t0 = _time.perf_counter()

    # Clear per-run caches so stale entries from previous loads don't accumulate
    _norm_cmp.cache_clear()
    _similarity.cache_clear()
    _char_similarity.cache_clear()
    _combined_similarity.cache_clear()
    _content_only.cache_clear()
    _line_ends_sentence.cache_clear()
    _line_ends_incomplete.cache_clear()
    _anchor_of.cache_clear()
    _emp_sig_cache.clear()
    _suppress_cache.clear()

    blocks_a = segment_blocks(lines_a)
    blocks_b = segment_blocks(lines_b)
    _cd_t1 = _time.perf_counter()
    print(f"  [compute_diff] segment: {_cd_t1-_cd_t0:.2f}s  blocks_a={len(blocks_a)} blocks_b={len(blocks_b)}", flush=True)
    _progress("segmenting", 5)

    # Post-segmentation: fuse reflow-fragment blocks (same sentence, different wrap)
    blocks_a = _merge_reflow_fragments(blocks_a)
    blocks_b = _merge_reflow_fragments(blocks_b)

    # Filter noise AND breadcrumb blocks for diffing (keep all for rendering)
    ba = [(i, b) for i, b in enumerate(blocks_a)
          if not _is_noise(b.text) and not _is_breadcrumb(b.text)]
    bb = [(j, b) for j, b in enumerate(blocks_b)
          if not _is_noise(b.text) and not _is_breadcrumb(b.text)]

    # Use stable structural guide keys for major anchors and normalised text for
    # ordinary content. This prevents late-document drift after one bad match.
    ta = [_seq_key(b) for _, b in ba]
    tb = [_seq_key(b) for _, b in bb]

    # ── PRE-DIFF ALIGNMENT ────────────────────────────────────────────────────
    # When one version wraps a provision as 2 blocks and the other as 1 block,
    # the sequence matcher sees replace(2→1) → false DEL+ADD.
    # Strategy: merge adjacent blocks whose joined cmp is an exact match in the
    # other doc (safe), OR whose joined sorted-word-bag matches an entry in the
    # other doc's word-bag set (catches reflow with minor normalisation differences).

    ref_set_b = set(tb)
    ref_set_a = set(ta)
    # Build sorted-word-bag sets for fuzzy merge matching
    def _wbag(s): return ' '.join(sorted(s.split()))
    wbag_b = {_wbag(s): s for s in tb}   # bag→cmp (first match wins)
    wbag_a = {_wbag(s): s for s in ta}

    def _safe_merge(src_list, ref_set, ref_wbag, src_map):
        """Merge adjacent pairs that produce an exact or word-bag match in ref.

        For famend: anchor runs (Textual Amendment entries) the window is
        extended to 10 because amendment sections can reformat from a single
        dense paragraph into many per-entry lines between PDF versions.
        """
        out, out_map = [], []
        i = 0
        while i < len(src_list):
            merged = False
            # Allow larger windows for famend block runs (amendment sections).
            is_famend_run = src_list[i].startswith('ANCH::famend:')
            max_n = 10 if is_famend_run else 6
            for n in range(2, max_n + 1):
                if i + n > len(src_list):
                    break
                # Never merge across structural guideposts; those are alignment fences.
                if any(s.startswith('GUIDE::') for s in src_list[i:i+n]):
                    break
                joined = ' '.join(src_list[i:i+n])
                if len(joined) > 2400:
                    break
                is_match = (joined in ref_set) or (_wbag(joined) in ref_wbag)
                if is_match:
                    merged_idx = []
                    for k in range(n):
                        merged_idx.extend(src_map[i+k])
                    # Use the canonical cmp from the other side if available (exact match
                    # preferred; word-bag match uses joined as-is)
                    out.append(joined)
                    out_map.append(merged_idx)
                    i += n
                    merged = True
                    break
            if not merged:
                out.append(src_list[i])
                out_map.append(src_map[i])
                i += 1
        return out, out_map

    map_a = [[i] for i in range(len(ta))]
    map_b = [[j] for j in range(len(tb))]
    ta_c, map_a = _safe_merge(ta, ref_set_b, wbag_b, map_a)
    tb_c, map_b = _safe_merge(tb, ref_set_a, wbag_a, map_b)
    _cd_t2 = _time.perf_counter()
    print(f"  [compute_diff] prep+merge: {_cd_t2-_cd_t1:.2f}s  ta_c={len(ta_c)} tb_c={len(tb_c)}", flush=True)
    _progress("aligning", 15)

    # autojunk=False is critical: provision anchors like (a),(b),(1),(2) repeat
    # heavily across the document. autojunk=True would treat them as "junk" and
    # skip them during LCS, causing catastrophic block misalignment.
    #
    # PERFORMANCE: feed integer hashes to SequenceMatcher instead of full strings.
    # difflib's internal comparison is O(1) per element when items are ints vs
    # O(len) per element for strings.  We keep a hash→cmp dict to resolve collisions.
    _hash_map: dict = {}
    def _to_hash(s: str) -> int:
        h = hash(s)
        # Handle collisions by storing canonical string
        while h in _hash_map and _hash_map[h] != s:
            h += 1
        _hash_map[h] = s
        return h

    ta_h = [_to_hash(s) for s in ta_c]
    tb_h = [_to_hash(s) for s in tb_c]

    opcodes = _windowed_opcodes(ta_h, tb_h, ta_c, tb_c)
    _cd_t3 = _time.perf_counter()
    print(f"  [compute_diff] opcodes: {_cd_t3-_cd_t2:.2f}s  n_ops={len(opcodes)}", flush=True)
    _progress("matching", 40)

    flat_map_a = map_a
    flat_map_b = map_b
    chunks: List[Chunk] = []
    seen_a, seen_b = set(), set()

    def _expand_a(ci1, ci2):
        orig = []
        for ci in range(ci1, ci2):
            for oi in flat_map_a[ci]:
                orig.append((ba[oi][0], ba[oi][1]))
        return orig

    def _expand_b(cj1, cj2):
        orig = []
        for cj in range(cj1, cj2):
            for oj in flat_map_b[cj]:
                orig.append((bb[oj][0], bb[oj][1]))
        return orig

    for op, i1, i2, j1, j2 in opcodes:

        if op == "equal":
            # Identical text -- check for emphasis-only changes
            ar_eq = _expand_a(i1, i2)
            br_eq = _expand_b(j1, j2)
            for (ri, bla), (rj, blb) in zip(ar_eq, br_eq):
                # Equal sequence keys may still hide text differences when the key is
                # a structural guide anchor. Surface those as MOD unless suppressed.
                if bla.cmp != blb.cmp:
                    _sim_eq = _combined_similarity(bla.cmp, blb.cmp)
                    _nums_eq = _numbers_match(bla.cmp, blb.cmp)
                    # Very high similarity + same numbers = layout/formatting
                    # artefact (e.g. citation-space, hyperlink underline toggle).
                    # Suppress entirely — skip EMP check too.
                    if _sim_eq >= 0.94 and _nums_eq:
                        continue
                    # Cache suppress decision — reused to gate both MOD and EMP.
                    _supp_eq = _should_suppress_chunk(bla.text, blb.text)
                    if _sim_eq < 0.92 and not _supp_eq:
                        chunks.append(Chunk(KIND_MOD, ri, rj,
                                            bla.text, blb.text))
                        continue
                    # Text difference is suppressible noise (citation spaces,
                    # reflow, F-number shift, etc.) — skip EMP too so that
                    # underline/formatting artefacts on matched equal-key blocks
                    # don't produce false EMP chunks.
                    if _supp_eq:
                        continue
                # Also catch casing-only changes hidden by _norm_cmp lowercasing.
                elif bla.text != blb.text:
                    _raw_a = re.sub(r'\s+', '', bla.text)
                    _raw_b = re.sub(r'\s+', '', blb.text)
                    if _raw_a.lower() == _raw_b.lower() and _raw_a != _raw_b:
                        if not _should_suppress_chunk(bla.text, blb.text):
                            chunks.append(Chunk(KIND_MOD, ri, rj,
                                                bla.text, blb.text))
                            continue

                if _emp_sig_block(bla) != _emp_sig_block(blb):
                    if _emp_diff(bla, blb):
                        detail = _emp_detail(bla, blb)
                        ch = Chunk(KIND_EMP, ri, rj,
                                   bla.text, blb.text)
                        ch.emp_detail = detail
                        chunks.append(ch)
            continue

        ar = _expand_a(i1, i2)
        br = _expand_b(j1, j2)

        if op == "insert":
            for rj, blb in br:
                if rj not in seen_b:
                    seen_b.add(rj)
                    # Suppress trivially empty, noise-only, or breadcrumb inserts
                    if not _is_noise(blb.text) and not _is_breadcrumb(blb.text):
                        chunks.append(Chunk(KIND_ADD, -1, rj, "", blb.text))

        elif op == "delete":
            for ri, bla in ar:
                if ri not in seen_a:
                    seen_a.add(ri)
                    # Suppress trivially empty, noise-only, or breadcrumb deletes
                    if not _is_noise(bla.text) and not _is_breadcrumb(bla.text):
                        chunks.append(Chunk(KIND_DEL, ri, -1, bla.text, ""))

        elif op == "replace":
            used_b: set = set()

            # Pass 1: pair blocks that share the same anchor key
            anchor_map_b: dict = {}
            for rj, blb in br:
                if blb.anchor not in anchor_map_b:
                    anchor_map_b[blb.anchor] = (rj, blb)

            paired: list = []
            leftovers_a: list = []
            for ri, bla in ar:
                if ri in seen_a:
                    continue
                match = anchor_map_b.get(bla.anchor)
                if match and match[0] not in seen_b and match[0] not in used_b:
                    paired.append((ri, bla, match[0], match[1], "anchor-exact", 0.99))
                    used_b.add(match[0])
                else:
                    leftovers_a.append((ri, bla))

            # Pass 2: similarity pairing for remaining unmatched blocks
            leftovers_b = [(rj, blb) for rj, blb in br
                           if rj not in seen_b and rj not in used_b]

            def _prov(a): return a if a.startswith('(') else ''

            # Build position-sorted index with pre-computed fractional positions
            # for binary-search window filtering (replaces linear scan).
            import bisect as _bisect
            nb = max(len(blocks_b), 1)
            na = max(len(blocks_a), 1)
            _lb_frac = [(leftovers_b[i][0] / nb, i) for i in range(len(leftovers_b))]
            _lb_frac.sort()
            _lb_frac_keys = [f for f, _ in _lb_frac]

            # Build first-token inverted index for fast candidate lookup
            from collections import defaultdict as _defaultdict
            _lb_by_token: dict = _defaultdict(list)
            for _idx_lb, (rj, blb) in enumerate(leftovers_b):
                _words = blb.cmp.split()
                if _words:
                    _lb_by_token[_words[0]].append(_idx_lb)
                    if len(_words) >= 2:
                        _lb_by_token[(_words[0], _words[1])].append(_idx_lb)

            for ri, bla in leftovers_a:
                best_score = 0.65
                best_j     = None
                best_meta  = ("", 0.0)
                prov_bla   = _prov(bla.anchor)
                fam_a = _anchor_family(bla.anchor)

                # Use position window with binary search: only blocks within 30%
                pos_a = ri / na
                lo_pos = pos_a - 0.30
                hi_pos = pos_a + 0.30
                lo_i = _bisect.bisect_left(_lb_frac_keys, lo_pos)
                hi_i = _bisect.bisect_right(_lb_frac_keys, hi_pos)

                for _sort_idx in range(lo_i, hi_i):
                    _lb_idx = _lb_frac[_sort_idx][1]
                    rj, blb = leftovers_b[_lb_idx]
                    if rj in used_b:
                        continue
                    # Never pair two famend lines whose text body is unrelated.
                    if (bla.anchor.startswith("famend:") and
                            blb.anchor.startswith("famend:") and
                            bla.anchor != blb.anchor):
                        quick_sim = _similarity(bla.cmp, blb.cmp)
                        if quick_sim < 0.72:
                            continue
                    # Never pair blocks whose provision anchors differ
                    prov_blb = _prov(blb.anchor)
                    if prov_bla and prov_blb and prov_bla != prov_blb:
                        continue
                    # Multi-pass pairing score
                    f_anchor = _anchor_fuzzy_score(bla.anchor, blb.anchor)
                    sim = _combined_similarity(bla.cmp, blb.cmp)
                    pos = _position_score(ri, na, rj, nb)

                    # Strong structural mismatch guard.
                    fam_b = _anchor_family(blb.anchor)
                    if (fam_a in {"part", "chapter", "schedule", "sec"}
                            and fam_b in {"part", "chapter", "schedule", "sec"}
                            and fam_a != fam_b):
                        continue

                    score = (sim * 0.78) + (f_anchor * 0.12) + (pos * 0.10)
                    stage = "similarity"
                    if f_anchor >= 0.70:
                        stage = "fuzzy-anchor+similarity+position"
                    elif pos >= 0.70:
                        stage = "similarity+position"

                    # Extra confidence when fuzzy anchor and similarity both agree.
                    if f_anchor >= 0.70 and sim >= 0.80:
                        score = min(1.0, score + 0.05)

                    if score > best_score:
                        best_score = score
                        best_j     = (rj, blb)
                        best_meta  = (stage, min(0.98, max(0.65, score)))
                        if best_score >= 0.95:
                            break  # confident match, stop searching
                if best_j:
                    used_b.add(best_j[0])
                    paired.append((ri, bla, best_j[0], best_j[1], best_meta[0], best_meta[1]))
                else:
                    paired.append((ri, bla, None, None, "unmatched", 0.90))  # pure delete

            # Emit chunks for all paired decisions
            for item in paired:
                ri, bla, rj, blb, reason, conf = item
                if rj is None:
                    if ri not in seen_a:
                        seen_a.add(ri)
                        chunks.append(Chunk(KIND_DEL, ri, -1, bla.text, "", confidence=conf, reason=reason))
                    continue
                if ri in seen_a or rj in seen_b:
                    continue
                seen_a.add(ri)
                seen_b.add(rj)
                # Suppress reflow/formatting-only pairs
                if _should_suppress_chunk(bla.text, blb.text):
                    continue
                ratio = _combined_similarity(bla.cmp, blb.cmp)
                if ratio >= 0.65:
                    chunks.append(Chunk(KIND_MOD, ri, rj, bla.text, blb.text,
                                        confidence=min(0.99, max(conf, ratio)), reason=reason))
                else:
                    chunks.append(Chunk(KIND_DEL, ri, -1, bla.text, ""))
                    chunks.append(Chunk(KIND_ADD, -1, rj, "", blb.text))

            # Remaining B blocks that were never paired -> ADD
            for rj, blb in leftovers_b:
                if rj not in seen_b and rj not in used_b:
                    seen_b.add(rj)
                    chunks.append(Chunk(KIND_ADD, -1, rj, "", blb.text))

    # ── POST-PASS: pair orphan DEL+ADD chunks that are reflow of each other ────
    # The sequence matcher sometimes emits a block as DEL in one opcode and
    # the same-text block as ADD in a different opcode (when block counts differ).
    # Match them up and suppress if _should_suppress_chunk agrees.
    del_chunks = [(ci, ch) for ci, ch in enumerate(chunks) if ch.kind == KIND_DEL]
    add_chunks = [(ci, ch) for ci, ch in enumerate(chunks) if ch.kind == KIND_ADD]

    suppress_indices: set = set()
    used_add: set = set()

    if del_chunks and add_chunks:
        # Pre-normalise all add chunk texts once (avoids repeated _norm_cmp calls)
        add_normed = [_norm_cmp(ach.text_b) for _, ach in add_chunks]

        # Build a first-token index for add chunks to skip obviously mismatched ones
        from collections import defaultdict
        add_by_first: dict = defaultdict(list)
        for ai, (aci, ach) in enumerate(add_chunks):
            first = add_normed[ai].split()[0] if add_normed[ai].split() else ''
            add_by_first[first].append(ai)

        for di, (dci, dch) in enumerate(del_chunks):
            del_norm = _norm_cmp(dch.text_a)
            del_words = del_norm.split()
            if not del_words:
                continue
            first = del_words[0]

            best_sim  = 0.72
            best_ai   = None
            best_aci  = None

            # Only compare against add chunks that share the same first token
            # (provision anchor like "(a)", "F5", "c2pt" etc.) — massive prune
            candidates = add_by_first.get(first, [])
            # Fall back to all if no first-token candidates (shouldn't happen often)
            if not candidates:
                candidates = range(len(add_chunks))

            for ai in candidates:
                aci, ach = add_chunks[ai]
                if aci in used_add:
                    continue
                sim = _similarity(del_norm, add_normed[ai])
                if sim > best_sim:
                    best_sim = sim
                    best_ai  = ai
                    best_aci = aci

            if best_aci is not None:
                ach = add_chunks[best_ai][1]
                if (_should_suppress_chunk(dch.text_a, ach.text_b) or
                        (best_sim >= 0.92 and
                         _numbers_match(_norm_cmp(dch.text_a), add_normed[best_ai]))):
                    suppress_indices.add(dci)
                    suppress_indices.add(best_aci)
                    used_add.add(best_aci)

    if suppress_indices:
        chunks = [ch for ci, ch in enumerate(chunks) if ci not in suppress_indices]

    # ── CONTAINMENT PASS: suppress ADD/DEL fragments that are substrings ───
    # Build FULL corpus: ALL text from each document
    corpus_a_joined = ' '.join(_norm_cmp(b.text) for b in blocks_a if b.text.strip())
    corpus_b_joined = ' '.join(_norm_cmp(b.text) for b in blocks_b if b.text.strip())

    # Pre-build bracket+space stripped versions once (reused in pass 2)
    _RE_CLEAN2 = re.compile(r'[\[\]\(\)\s]')
    corpus_a_clean = _RE_CLEAN2.sub('', corpus_a_joined)
    corpus_b_clean = _RE_CLEAN2.sub('', corpus_b_joined)

    # Pre-build block-level text sets for O(1) exact-block containment (fast path)
    _block_set_a = frozenset(_norm_cmp(b.text).strip() for b in blocks_a if len(b.text.strip()) >= 4)
    _block_set_b = frozenset(_norm_cmp(b.text).strip() for b in blocks_b if len(b.text.strip()) >= 4)

    def _contained_in_corpus(nt: str, corpus_joined: str, corpus_clean: str,
                              block_set: frozenset, strip_text: str = "") -> bool:
        """Check if normalised text is contained in the other side's corpus."""
        if len(nt) < 4:
            return False
        # Fast path: exact block match (O(1))
        if nt in block_set:
            return True
        # Substring in joined corpus
        if nt in corpus_joined:
            return True
        # Bracket+space-stripped fallback
        nc = _RE_CLEAN2.sub('', nt)
        if len(nc) >= 4 and nc in corpus_clean:
            return True
        # Provision-anchor-stripped fallback
        if strip_text and len(nt) >= 12:
            st = _strip_prov_anchors(strip_text)
            if st:
                sn = _norm_cmp(st).strip()
                if len(sn) >= 4 and sn in corpus_joined:
                    return True
        return False

    contain_suppress = set()
    for ci, ch in enumerate(chunks):
        if ch.kind == KIND_ADD:
            nt = _norm_cmp(ch.text_b).strip()
            if _contained_in_corpus(nt, corpus_a_joined, corpus_a_clean, _block_set_a, ch.text_b):
                contain_suppress.add(ci)
        elif ch.kind == KIND_DEL:
            nt = _norm_cmp(ch.text_a).strip()
            if _contained_in_corpus(nt, corpus_b_joined, corpus_b_clean, _block_set_b, ch.text_a):
                contain_suppress.add(ci)

    if contain_suppress:
        print(f"  [compute_diff] containment-suppress: {len(contain_suppress)} chunks", flush=True)
        chunks = [ch for ci, ch in enumerate(chunks) if ci not in contain_suppress]

    _cd_t4 = _time.perf_counter()
    print(f"  [compute_diff] main loop + post-pass: {_cd_t4-_cd_t3:.2f}s  chunks_raw={len(chunks)}", flush=True)
    _progress("refining", 65)

    # Convert likely reflow-only DEL+ADD pairs into MOD so rendering can highlight
    # changed words instead of painting whole phrases as deleted/added.
    _t_ref0 = _time.perf_counter()
    chunks = _convert_high_similarity_del_add_to_mod(chunks)
    _t_ref1 = _time.perf_counter()
    chunks = _convert_adjacent_del_add_runs_to_mod(chunks)
    _t_ref2 = _time.perf_counter()
    # Drop any newly-converted MODs that suppression would have caught directly.
    chunks = [ch for ch in chunks
              if ch.kind != KIND_MOD or
              not _should_suppress_chunk(ch.text_a, ch.text_b)]
    _t_ref3 = _time.perf_counter()
    chunks = _suppress_adjacent_reflow_runs(chunks)
    _t_ref4 = _time.perf_counter()
    chunks = _suppress_mod_followed_by_add_reflow(chunks)
    _t_ref5 = _time.perf_counter()
    print(f"  [compute_diff] refining: hi_sim={_t_ref1-_t_ref0:.2f}s adj={_t_ref2-_t_ref1:.2f}s "
          f"suppress_mod={_t_ref3-_t_ref2:.2f}s adj_reflow={_t_ref4-_t_ref3:.2f}s "
          f"mod_add={_t_ref5-_t_ref4:.2f}s  chunks={len(chunks)}", flush=True)

    # ── SECOND CONTAINMENT PASS: catch remaining ADD/DEL/MOD reflow ────────
    # After all conversions and join passes, some orphan ADD/DEL and truncated
    # MODs may remain.  Re-check against the full document corpus.

    contain2 = set()
    for ci, ch in enumerate(chunks):
        if ch.kind == KIND_ADD:
            nt = _norm_cmp(ch.text_b).strip()
            if _contained_in_corpus(nt, corpus_a_joined, corpus_a_clean, _block_set_a, ch.text_b):
                contain2.add(ci)
        elif ch.kind == KIND_DEL:
            nt = _norm_cmp(ch.text_a).strip()
            if _contained_in_corpus(nt, corpus_b_joined, corpus_b_clean, _block_set_b, ch.text_a):
                contain2.add(ci)
        elif ch.kind == KIND_MOD:
            # Suppress MOD where one side is contained in the opposite corpus
            # (block-boundary truncation → the "missing" text is elsewhere).
            nta = _norm_cmp(ch.text_a).strip()
            ntb = _norm_cmp(ch.text_b).strip()
            if nta and ntb:
                a_in_b_corpus = len(nta) >= 4 and nta in corpus_b_joined
                b_in_a_corpus = len(ntb) >= 4 and ntb in corpus_a_joined
                if a_in_b_corpus and b_in_a_corpus:
                    contain2.add(ci)
                # If the shorter side is contained in the longer side (prefix/
                # suffix truncation), suppress if the shorter is also present
                # in the opposite full corpus.
                elif len(nta) < len(ntb) and nta in ntb and a_in_b_corpus:
                    contain2.add(ci)
                elif len(ntb) < len(nta) and ntb in nta and b_in_a_corpus:
                    contain2.add(ci)
    if contain2:
        print(f"  [compute_diff] containment-pass-2: {len(contain2)} chunks", flush=True)
        chunks = [ch for ci, ch in enumerate(chunks) if ci not in contain2]

    # ── FUZZY BLOCK-MATCHING SUPPRESSION ─────────────────────────────────────
    # Catches ADD/DEL chunks that have a near-identical block in the other PDF
    # but failed exact substring containment due to minor extraction differences
    # (different F-numbers, spacing, provision label formatting).
    # Uses inverted indexes + pre-built clean corpus for efficient lookup.
    from collections import defaultdict as _dd_fblock

    _RE_CLEAN_ALL = re.compile(r'[\[\]\(\)\s]')
    def _clean_all(s: str) -> str:
        return _RE_CLEAN_ALL.sub('', s)
    def _strip_brackets(tok: str) -> str:
        return re.sub(r'[\[\]\(\)]', '', tok)

    _block_norms_a = [_norm_cmp(b.text) for b in blocks_a]
    _block_norms_b = [_norm_cmp(b.text) for b in blocks_b]
    _block_co_a = [_norm_cmp(_content_only(b.text)) for b in blocks_a]
    _block_co_b = [_norm_cmp(_content_only(b.text)) for b in blocks_b]

    # Pre-build clean corpora for O(n) substring checks (no per-block iteration)
    _corpus_a_clean = _clean_all(corpus_a_joined)
    _corpus_b_clean = _clean_all(corpus_b_joined)
    _corpus_co_a = ' '.join(_block_co_a)
    _corpus_co_b = ' '.join(_block_co_b)

    def _build_block_idx(norms, cos):
        by_first: dict = _dd_fblock(list)
        by_stripped: dict = _dd_fblock(list)
        by_co_first: dict = _dd_fblock(list)
        for bn, bc in zip(norms, cos):
            w = bn.split()
            if w:
                by_first[w[0]].append((bn, bc))
                s0 = _strip_brackets(w[0])
                if s0:
                    by_stripped[s0].append((bn, bc))
                if len(w) >= 2:
                    by_first[(w[0], w[1])].append((bn, bc))
                    s1 = _strip_brackets(w[1])
                    if s0 and s1:
                        by_stripped[(s0, s1)].append((bn, bc))
            cw = bc.split()
            if cw:
                by_co_first[cw[0]].append((bn, bc))
                if len(cw) >= 2:
                    by_co_first[(cw[0], cw[1])].append((bn, bc))
        return by_first, by_stripped, by_co_first

    _bk1_a, _bks_a, _bkco_a = _build_block_idx(_block_norms_a, _block_co_a)
    _bk1_b, _bks_b, _bkco_b = _build_block_idx(_block_norms_b, _block_co_b)

    def _fuzzy_match_block(nt, ct, bk1, bks, bkco, other_corpus_clean, other_corpus_co):
        """Check if text has a fuzzy match in the other side's blocks."""
        # Fast path: clean corpus containment (brackets+spaces removed)
        nt_clean = _clean_all(nt)
        if len(nt_clean) >= 3 and nt_clean in other_corpus_clean:
            return True
        # Content-only corpus containment
        if ct and len(ct) >= 4 and ct in other_corpus_co:
            return True

        # Index-based candidate lookup
        words = nt.split()
        first_tok = words[0] if words else ''
        stripped_first = _strip_brackets(first_tok)

        candidates = bk1.get(first_tok, [])
        if len(words) >= 2:
            candidates = candidates + bk1.get((words[0], words[1]), [])
        if stripped_first:
            candidates = candidates + bks.get(stripped_first, [])
            if len(words) >= 2:
                s2 = _strip_brackets(words[1])
                if s2:
                    candidates = candidates + bks.get((stripped_first, s2), [])
        cwords = ct.split()
        if cwords:
            candidates = candidates + bkco.get(cwords[0], [])
            if len(cwords) >= 2:
                candidates = candidates + bkco.get((cwords[0], cwords[1]), [])

        # Deduplicate
        seen = set()
        unique = []
        for bn, bc in candidates:
            if bn not in seen:
                seen.add(bn)
                unique.append((bn, bc))

        for cand_n, cand_c in unique:
            if nt == cand_n or ct == cand_c:
                return True
            if ct and cand_c and ct == cand_c:
                return True
            if len(nt) >= 4 and (nt in cand_n or cand_n in nt):
                return True
            if ct and cand_c and len(ct) >= 4 and (ct in cand_c or cand_c in ct):
                return True
            cand_clean = _clean_all(cand_n)
            if len(nt_clean) >= 4 and (nt_clean in cand_clean or cand_clean in nt_clean):
                return True
            sim = _similarity(nt, cand_n)
            if sim >= 0.82 and _numbers_match(nt, cand_n):
                return True
            if sim >= 0.88 and _word_overlap_ratio(nt, cand_n) >= 0.82:
                return True
            if ct and cand_c:
                csim = _similarity(ct, cand_c)
                if csim >= 0.82 and _numbers_match(ct, cand_c):
                    return True
        return False

    fuzzy_suppress = set()
    for ci, ch in enumerate(chunks):
        if ch.kind == KIND_ADD:
            nt = _norm_cmp(ch.text_b).strip()
            if len(nt) < 3:
                continue
            ct = _norm_cmp(_content_only(ch.text_b)).strip()
            if _fuzzy_match_block(nt, ct, _bk1_a, _bks_a, _bkco_a, _corpus_a_clean, _corpus_co_a):
                fuzzy_suppress.add(ci)
        elif ch.kind == KIND_DEL:
            nt = _norm_cmp(ch.text_a).strip()
            if len(nt) < 3:
                continue
            ct = _norm_cmp(_content_only(ch.text_a)).strip()
            if _fuzzy_match_block(nt, ct, _bk1_b, _bks_b, _bkco_b, _corpus_b_clean, _corpus_co_b):
                fuzzy_suppress.add(ci)
    if fuzzy_suppress:
        print(f"  [compute_diff] fuzzy-block-suppress: {len(fuzzy_suppress)} chunks", flush=True)
        chunks = [ch for ci, ch in enumerate(chunks) if ci not in fuzzy_suppress]

    # ── SHORT-FRAGMENT SUPPRESSION ───────────────────────────────────────────
    # Suppress orphan ADD/DEL chunks whose text is a very short provision
    # marker, heading label, or structural fragment (e.g. "(6)", "year--",
    # "conditions--") caused by block-boundary segmentation differences.
    # These are too short for the containment pass (< 8 chars normalised)
    # but are clearly not real legal changes.
    _RE_SHORT_FRAGMENT = re.compile(
        r'^[\[\(]?\s*(?:\d{1,4}[a-z]?|[a-z]{1,3}|[ivxlcdm]{1,6})\s*[\]\)]?\s*$'
        r'|^(?:year|conditions|that\s+year|resident|met)\s*[-–—.,:;]*\s*[\]\)]*\s*$',
        re.I,
    )
    short_suppress = set()
    for ci, ch in enumerate(chunks):
        if ch.kind == KIND_ADD:
            raw = (ch.text_b or '').strip()
            nt = _norm_cmp(raw).strip()
            if len(nt) <= 20 and _RE_SHORT_FRAGMENT.match(nt):
                short_suppress.add(ci)
        elif ch.kind == KIND_DEL:
            raw = (ch.text_a or '').strip()
            nt = _norm_cmp(raw).strip()
            if len(nt) <= 20 and _RE_SHORT_FRAGMENT.match(nt):
                short_suppress.add(ci)
    if short_suppress:
        print(f"  [compute_diff] short-fragment-suppress: {len(short_suppress)} chunks", flush=True)
        chunks = [ch for ci, ch in enumerate(chunks) if ci not in short_suppress]

    # ── DOT-LEADER / NOISE SUPPRESSION ───────────────────────────────────────
    # Catch ADD/DEL chunks whose text is predominantly dots/leader characters
    # (table-of-contents formatting that slipped through _is_noise block filter).
    noise_suppress = set()
    for ci, ch in enumerate(chunks):
        if ch.kind in (KIND_DEL, KIND_ADD):
            text = (ch.text_a if ch.kind == KIND_DEL else ch.text_b).strip()
            if _is_legal_leader_line(text):
                continue
            if text and _is_noise(text):
                noise_suppress.add(ci)
                continue
            # Ratio-based dot-leader check
            dot_ct = text.count('.') + text.count('\xb7')
            non_sp = text.replace(' ', '')
            if dot_ct >= 6 and non_sp and dot_ct / len(non_sp) > 0.50:
                noise_suppress.add(ci)
    if noise_suppress:
        print(f"  [compute_diff] noise-suppress: {len(noise_suppress)} chunks", flush=True)
        chunks = [ch for ci, ch in enumerate(chunks) if ci not in noise_suppress]

    # ── XML CROSS-VALIDATION (tri-source) ────────────────────────────────────
    # When XML ground truth is provided, build an index from each XML document
    # and suppress diff chunks that are contradicted by the XML content.
    _progress("xml-validate", 75)
    _xml_idx_a = _XmlIndex(xml_text_a) if xml_text_a else None
    _xml_idx_b = _XmlIndex(xml_text_b) if xml_text_b else None
    if _xml_idx_a or _xml_idx_b:
        _cd_xml0 = _time.perf_counter()
        chunks = _xml_cross_validate_chunks(
            chunks, _xml_idx_a, _xml_idx_b,
            corpus_a_joined=corpus_a_joined,
            corpus_b_joined=corpus_b_joined,
        )
        _cd_xml1 = _time.perf_counter()
        print(f"  [compute_diff] xml cross-validate: {_cd_xml1-_cd_xml0:.2f}s  chunks_after_xml={len(chunks)}", flush=True)

    chunks = _annotate_chunk_quality(chunks, blocks_a, blocks_b)

    # ── CONTEXT POPULATION ───────────────────────────────────────────────────
    _progress("context", 90)
    _populate_chunk_context(chunks, blocks_a, blocks_b, _xml_idx_b, xml_text_b)

    _cd_t5 = _time.perf_counter()
    print(f"  [compute_diff] post-processing: {_cd_t5-_cd_t4:.2f}s  chunks_final={len(chunks)}  TOTAL={_cd_t5-_cd_t0:.2f}s", flush=True)

    return blocks_a, blocks_b, chunks


def _compute_word_level_diff(ch: Chunk) -> None:
    """Populate words_removed, words_added, words_before, words_after on a MOD chunk.

    Uses difflib to find the precise word-level changes between text_a and text_b.
    Also captures surrounding context words (before/after the change) so the XML
    Apply can anchor the edit precisely, even if the same word appears elsewhere.
    """
    wa = ch.text_a.split()
    wb = ch.text_b.split()
    if not wa or not wb:
        return

    sm = difflib.SequenceMatcher(None, wa, wb, autojunk=False)
    removed_parts = []
    added_parts = []
    # Track position of first and last change for context extraction
    first_change_a = len(wa)
    last_change_a = 0
    first_change_b = len(wb)
    last_change_b = 0

    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "replace":
            removed_parts.extend(wa[i1:i2])
            added_parts.extend(wb[j1:j2])
            first_change_a = min(first_change_a, i1)
            last_change_a = max(last_change_a, i2)
            first_change_b = min(first_change_b, j1)
            last_change_b = max(last_change_b, j2)
        elif op == "delete":
            removed_parts.extend(wa[i1:i2])
            first_change_a = min(first_change_a, i1)
            last_change_a = max(last_change_a, i2)
        elif op == "insert":
            added_parts.extend(wb[j1:j2])
            first_change_b = min(first_change_b, j1)
            last_change_b = max(last_change_b, j2)

    ch.words_removed = " ".join(removed_parts)[:300]
    ch.words_added = " ".join(added_parts)[:300]

    # Context: capture 1-3 words before and after the change region in source (text_a)
    if first_change_a < len(wa):
        before_start = max(0, first_change_a - 3)
        ch.words_before = " ".join(wa[before_start:first_change_a])[:150]
    if last_change_a > 0:
        ch.words_after = " ".join(wa[last_change_a:last_change_a + 3])[:150]


def _check_xml_emphasis_ids(ch: Chunk, xml_text: str) -> None:
    """For EMP chunks, find the matching XML region and check if emphasis
    tags (<b>, <i>, <u>) have `id` attributes.  If any are missing, append
    a suggestion to emp_detail with a generated UUID for each missing id.
    """
    import uuid as _uuid_mod

    probe = _norm_cmp(ch.text_b or ch.text_a or "")
    if not probe or len(probe) < 6:
        return

    # Find the XML region containing this text
    _p_pat = re.compile(r'<p\b[^>]*>(.*?)</p>', re.I | re.S)
    best_pos = None
    best_score = 0.0
    for m in _p_pat.finditer(xml_text):
        inner_plain = _xml_plain_text(m.group(1))
        inner_n = _norm_cmp(inner_plain)
        if not inner_n:
            continue
        if probe in inner_n or inner_n in probe:
            best_pos = m.start()
            best_score = 1.0
            break
        sc = _similarity(probe[:80], inner_n[:80])
        if sc > best_score:
            best_score = sc
            best_pos = m.start()

    if best_pos is None or best_score < 0.75:
        return

    # Get the containing paragraph XML
    pm = None
    for m in _p_pat.finditer(xml_text):
        if m.start() == best_pos:
            pm = m
            break
    if not pm:
        return

    region = pm.group(0)  # full <p>...</p> XML

    # Check emphasis tags in this region
    emp_tag_pat = re.compile(r'<(b|i|u)\b([^>]*)>', re.I)
    tags_without_id: list[str] = []
    tags_with_id: list[str] = []

    for tm in emp_tag_pat.finditer(region):
        tag_name = tm.group(1).lower()
        attrs = tm.group(2)
        if re.search(r'\bid\s*=', attrs):
            tags_with_id.append(tag_name)
        else:
            tags_without_id.append(tag_name)

    if not tags_without_id:
        return  # all emphasis tags have ids

    # Build suggestion
    suggestions: list[str] = []
    for tag in tags_without_id:
        new_id = str(_uuid_mod.uuid4())
        suggestions.append(f'<{tag} id="{new_id}">')

    detail_addition = "xml_suggest: " + "; ".join(
        f"{tag} missing id → add {sug}"
        for tag, sug in zip(tags_without_id, suggestions)
    )

    if ch.emp_detail:
        ch.emp_detail = ch.emp_detail + " | " + detail_addition
    else:
        ch.emp_detail = detail_addition


def _populate_chunk_context(
    chunks: List[Chunk],
    blocks_a: List[Block],
    blocks_b: List[Block],
    xml_index_b: Optional['_XmlIndex'],
    xml_b_text: Optional[str] = None,
) -> None:
    """Fill context_a, context_b, xml_context on ADD/DEL chunks in-place.

    Context shows the nearest section/heading in the OTHER document so the user
    can locate WHERE the change sits.  For DEL: locate in new doc (context_b).
    For ADD: locate in old doc (context_a).
    """
    # ── heading pattern: matches Part, Chapter, Schedule, Section, numbered headings
    _RE_HEADING = re.compile(
        r'^(?:Part|Chapter|Schedule|Section|Appendix|Annex)\s+\d|'
        r'^[A-Z][A-Z\s]{5,}$|'            # ALL-CAPS heading
        r'^Textual\s+Amendments?$|'
        r'^\d{1,3}[A-Z]?\s+[A-Z]',        # numbered section like "7A General..."
        re.I,
    )

    def _find_section_heading(blocks: List[Block], near_idx: int) -> str:
        """Walk backward from near_idx to find the nearest section/heading block."""
        if near_idx < 0 or not blocks:
            return ""
        start = min(near_idx, len(blocks) - 1)
        for i in range(start, max(-1, start - 50), -1):
            txt = blocks[i].text.strip()
            anchor = blocks[i].anchor
            # Check anchor type first — structural anchors are reliable
            if anchor and any(anchor.startswith(p) for p in
                              ('sec:', 'part:', 'chapter:', 'schedule:', 'head:')):
                return txt[:200]
            # Check heading-like text patterns
            if _RE_HEADING.match(txt):
                return txt[:200]
        return ""

    def _find_surrounding_text(blocks: List[Block], center: int) -> str:
        """Get one line above and one line below the center block."""
        if center < 0 or not blocks:
            return ""
        parts = []
        if center > 0:
            parts.append(blocks[center - 1].text.strip()[:100])
        if center < len(blocks) - 1:
            parts.append(blocks[center + 1].text.strip()[:100])
        return " … ".join(p for p in parts if p and len(p) > 3)[:250]

    def _find_neighbor_block(chunks_list, idx, side: str) -> int:
        """Find nearest chunk with a valid block index on the given side."""
        attr = f"block_{side}"
        for delta in range(1, min(10, len(chunks_list))):
            for direction in (idx - delta, idx + delta):
                if 0 <= direction < len(chunks_list):
                    val = getattr(chunks_list[direction], attr, -1)
                    if val >= 0:
                        return val
        return -1

    # ── Pre-compute heading index for blocks_a and blocks_b ────────────────
    # Instead of walking backwards up to 50 blocks per chunk, precompute
    # the nearest heading for every block index once (O(n) total).
    def _build_heading_index(blocks: List[Block]) -> List[str]:
        """Return list where heading_idx[i] = nearest heading at or before block i."""
        idx = [""] * len(blocks)
        current_heading = ""
        for i, blk in enumerate(blocks):
            txt = blk.text.strip()
            anchor = blk.anchor
            if anchor and any(anchor.startswith(p) for p in
                              ('sec:', 'part:', 'chapter:', 'schedule:', 'head:')):
                current_heading = txt[:200]
            elif _RE_HEADING.match(txt):
                current_heading = txt[:200]
            idx[i] = current_heading
        return idx

    heading_idx_a = _build_heading_index(blocks_a) if blocks_a else []
    heading_idx_b = _build_heading_index(blocks_b) if blocks_b else []

    def _heading_at(blocks: List[Block], hidx: List[str], block_i: int) -> str:
        if block_i < 0 or block_i >= len(hidx):
            return ""
        return hidx[block_i]

    for ci, ch in enumerate(chunks):
        if ch.kind == KIND_DEL:
            anchor_b = _find_neighbor_block(chunks, ci, "b")
            heading = _heading_at(blocks_b, heading_idx_b, anchor_b)
            if heading:
                ch.context_b = heading
            if ch.block_a >= 0:
                ch.context_a = _find_surrounding_text(blocks_a, ch.block_a)

        elif ch.kind == KIND_ADD:
            anchor_a = _find_neighbor_block(chunks, ci, "a")
            heading = _heading_at(blocks_a, heading_idx_a, anchor_a)
            if heading:
                ch.context_a = heading
            if ch.block_b >= 0:
                ch.context_b = _find_surrounding_text(blocks_b, ch.block_b)

        # ── Section heading for ALL chunks (used for grouping in sidebar) ──
        blk_idx = ch.block_b if ch.block_b >= 0 else ch.block_a
        hidx_ref = heading_idx_b if ch.block_b >= 0 else heading_idx_a
        if blk_idx < 0:
            blk_idx_fallback = _find_neighbor_block(chunks, ci, "b")
            if blk_idx_fallback >= 0:
                blk_idx, hidx_ref = blk_idx_fallback, heading_idx_b
            else:
                blk_idx_fallback = _find_neighbor_block(chunks, ci, "a")
                if blk_idx_fallback >= 0:
                    blk_idx, hidx_ref = blk_idx_fallback, heading_idx_a
        if blk_idx >= 0 and blk_idx < len(hidx_ref):
            ch.section = hidx_ref[blk_idx]

        # XML context: probe() is cached so second call is O(1)
        if xml_index_b and (ch.text_a or ch.text_b):
            probe_text = ch.text_b or ch.text_a
            xml_match = xml_index_b.probe(probe_text, threshold=0.75)
            if xml_match:
                ch.xml_context = xml_match[:300]

        # ── XML emphasis id check (for EMP chunks with dual emphasis) ──────
        if ch.kind == KIND_EMP and xml_b_text and ch.xml_context:
            _check_xml_emphasis_ids(ch, xml_b_text)

        # Word-level diff for MOD chunks (enables precise XML Apply)
        if ch.kind == KIND_MOD and ch.text_a and ch.text_b:
            _compute_word_level_diff(ch)


def _strip_prov_anchors(text: str) -> str:
    """Remove leading outline markers so equivalent content compares equal.

    Handles variants from weak extraction: (a), (2), a), 2), a., 2., (2, (a.
    """
    s = _norm_cmp(text)
    marker = re.compile(
        r'^\s*(?:\((?:[a-z]{1,3}|\d{1,3}|[ivxlcdm]{1,6})\)?|'
        r'(?:[a-z]{1,3}|\d{1,3}|[ivxlcdm]{1,6})[\)\.:])\s*',
        re.I,
    )
    for _ in range(4):
        ns = marker.sub(' ', s, count=1)
        if ns == s:
            break
        s = ns
    return re.sub(r'\s+', ' ', s).strip()


def _marker_richness(text: str) -> float:
    """Rough structural richness score from markers/brackets/citation tokens."""
    t = _norm_cmp(text)
    if not t:
        return 0.0
    hits = 0
    hits += len(re.findall(r'\((?:[a-z]{1,3}|\d{1,3}|[ivxlcdm]{1,6})\)', t, re.I))
    hits += len(re.findall(r'\[[a-z]\d+[a-z]?\]', t))
    hits += len(re.findall(r'\b(?:f|c|e|m|s)\d+[a-z]?\b', t))
    hits += len(re.findall(r'\b(?:s\.|sch\.|para\.|art\.|reg\.)\s*\d', t))
    # Cap to keep scale bounded.
    return min(1.0, hits / 6.0)


def _looks_weaker_extraction(text_x: str, text_y: str) -> bool:
    """True when x appears structurally poorer than y for the same content."""
    nx, ny = _norm_cmp(text_x), _norm_cmp(text_y)
    sx, sy = _strip_prov_anchors(nx), _strip_prov_anchors(ny)
    if not sx or not sy:
        return False
    # Body must be very close; otherwise this may be a real edit.
    if max(_similarity(sx, sy), _char_similarity(sx, sy)) < 0.95:
        return False
    if not _numbers_match(sx, sy):
        return False

    rx = _marker_richness(nx)
    ry = _marker_richness(ny)
    # Missing brackets and lower marker richness indicate extraction loss.
    bracket_loss = (nx.count('[') + nx.count('(')) < (ny.count('[') + ny.count('('))
    return (ry - rx) >= 0.18 or bracket_loss


def _alpha_signature(text: str) -> str:
    """Language-agnostic signature using only alphabetic characters.
    Helps match joined-word extraction artefacts across multilingual content."""
    return ''.join(ch for ch in _norm_cmp(text) if ch.isalpha())


def _same_wordbag_loose(a: str, b: str) -> bool:
    """Conservative bag comparison after anchor stripping.
    This is used only on already-adjacent DEL/ADD runs, not globally."""
    sa = _strip_prov_anchors(a)
    sb = _strip_prov_anchors(b)
    wa = sorted(re.sub(r'[^\w ]', ' ', sa, flags=re.UNICODE).split())
    wb = sorted(re.sub(r'[^\w ]', ' ', sb, flags=re.UNICODE).split())
    if wa == wb:
        return True
    n_max = max(len(wa), len(wb))
    if n_max >= 10 and abs(len(wa) - len(wb)) <= 1:
        overlap = sum(1 for w in wa if w in set(wb)) / max(n_max, 1)
        if overlap >= 0.97 and _numbers_match(sa, sb):
            return True
    return False


def _joined_equivalent(text_a: str, text_b: str) -> bool:
    """High-confidence equivalence check for concatenated DEL/ADD runs."""
    if _should_suppress_chunk(text_a, text_b):
        return True
    sa = _strip_prov_anchors(text_a)
    sb = _strip_prov_anchors(text_b)
    if sa and sb and sa == sb:
        return True
    if sa and sb and _is_punctuation_only_diff(sa, sb):
        return True
    if _alpha_signature(text_a) and _alpha_signature(text_a) == _alpha_signature(text_b):
        return True
    if _same_wordbag_loose(text_a, text_b):
        return True
    # Provision-stripped high similarity with subset numbers
    na, nb = _norm_cmp(text_a), _norm_cmp(text_b)
    if sa and sb:
        s_sim = _similarity(sa, sb)
        if s_sim >= 0.92 and _numbers_match(sa, sb):
            return True
        # Slightly relaxed: subset numbers with very high overlap
        if s_sim >= 0.88:
            nums_a = set(re.findall(r'\b\d+[a-z]?\b', na))
            nums_b = set(re.findall(r'\b\d+[a-z]?\b', nb))
            if (nums_a <= nums_b or nums_b <= nums_a) and _word_overlap_ratio(na, nb) >= 0.85:
                return True
    # Content-only comparison: strip inline amendment markers [F48] etc.
    ca, cb = _content_only(text_a), _content_only(text_b)
    if ca and cb:
        if ca == cb:
            return True
        c_sim = _similarity(ca, cb)
        if c_sim >= 0.90 and _numbers_match(ca, cb):
            return True
    return False


def _suppress_mod_followed_by_add_reflow(chunks: List[Chunk]) -> List[Chunk]:
    """Suppress MOD+ADD (or DEL+MOD) pairs where one PDF split a block that
    the other kept merged, producing a false modification.

    Pattern A — B side split:
      MOD: text_a="..full sentence.."  text_b="..truncated.."
      ADD: text_b="..continuation.."
      -> join MOD.text_b + ADD.text_b; if equals text_a, suppress both.

    Pattern B — A side split:
      DEL: text_a="..prefix.."
      MOD: text_a="..suffix.."  text_b="..full.."
      -> join DEL.text_a + MOD.text_a; if equals text_b, suppress both.
    """
    if not chunks:
        return chunks

    def _join(parts: List[str]) -> str:
        return re.sub(r'\s+', ' ', ' '.join(p for p in parts if p).strip())

    keep = [True] * len(chunks)
    n = len(chunks)
    i = 0

    while i < n:
        if not keep[i]:
            i += 1
            continue

        ch = chunks[i]

        # Pattern A (generalized): MOD + ADD+ where B-side split a single block.
        if ch.kind == KIND_MOD:
            j = i + 1
            add_idx = []
            while j < n and chunks[j].kind == KIND_ADD and keep[j]:
                add_idx.append(j)
                if len(add_idx) > 10:  # cap window to avoid O(n²)
                    break
                j += 1

            if add_idx and ch.text_a:
                ref_len = len(ch.text_a) * 2 + 200  # length cap
                best_upto = -1
                for upto in range(1, len(add_idx) + 1):
                    joined_b = _join([ch.text_b or ''] +
                                     [chunks[k].text_b or '' for k in add_idx[:upto]])
                    if len(joined_b) > ref_len:
                        break  # further joins only grow longer
                    if joined_b and _should_suppress_chunk(ch.text_a, joined_b):
                        best_upto = upto
                if best_upto > 0:
                    keep[i] = False
                    for k in add_idx[:best_upto]:
                        keep[k] = False

            # Pattern C (generalized): MOD + DEL+ where A-side split a single block.
            j = i + 1
            del_idx = []
            while j < n and chunks[j].kind == KIND_DEL and keep[j]:
                del_idx.append(j)
                if len(del_idx) > 10:  # cap window
                    break
                j += 1

            if del_idx and ch.text_b:
                ref_len = len(ch.text_b) * 2 + 200
                best_upto = -1
                for upto in range(1, len(del_idx) + 1):
                    joined_a = _join([ch.text_a or ''] +
                                     [chunks[k].text_a or '' for k in del_idx[:upto]])
                    if len(joined_a) > ref_len:
                        break
                    if joined_a and _should_suppress_chunk(joined_a, ch.text_b):
                        best_upto = upto
                if best_upto > 0:
                    keep[i] = False
                    for k in del_idx[:best_upto]:
                        keep[k] = False

        # Pattern B (generalized): DEL+ + MOD where A-side split a single block.
        if ch.kind == KIND_DEL:
            j = i
            del_idx = []
            del_parts = []
            while j < n and chunks[j].kind == KIND_DEL and keep[j]:
                del_idx.append(j)
                del_parts.append(chunks[j].text_a or '')
                if len(del_idx) > 10:
                    break
                nj = j + 1
                if nj < n and chunks[nj].kind == KIND_MOD and keep[nj]:
                    joined_a = _join(del_parts + [chunks[nj].text_a or ''])
                    if joined_a and chunks[nj].text_b and _should_suppress_chunk(joined_a, chunks[nj].text_b):
                        for k in del_idx:
                            keep[k] = False
                        keep[nj] = False
                        break
                j += 1

        # Pattern D (generalized): ADD+ + MOD where B-side split a single block.
        if ch.kind == KIND_ADD:
            j = i
            add_idx = []
            add_parts = []
            while j < n and chunks[j].kind == KIND_ADD and keep[j]:
                add_idx.append(j)
                add_parts.append(chunks[j].text_b or '')
                if len(add_idx) > 10:
                    break
                nj = j + 1
                if nj < n and chunks[nj].kind == KIND_MOD and keep[nj]:
                    joined_b = _join(add_parts + [chunks[nj].text_b or ''])
                    if joined_b and chunks[nj].text_a and _should_suppress_chunk(chunks[nj].text_a, joined_b):
                        for k in add_idx:
                            keep[k] = False
                        keep[nj] = False
                        break
                j += 1

        i += 1

    return [ch for ci, ch in enumerate(chunks) if keep[ci]]


def _famend_normalized(text: str) -> str:
    """Strip leading F-number tokens and normalise for amendment-section comparison.

    Textual Amendment sections sometimes reformat from a dense paragraph (one
    block per section) to one line per Fxxx entry.  After stripping each
    entry's leading F-number the body text should be identical.
    """
    # Remove every leading "F<digits>[A-Za-z]?" token followed by a space
    s = re.sub(r'(?:^|\s+)[A-Z]\d+[A-Za-z]?\s+', ' ', text, flags=re.I)
    return re.sub(r'\s+', ' ', s).strip().lower()


def _suppress_adjacent_reflow_runs(chunks: List[Chunk]) -> List[Chunk]:
    """Linear post-pass: suppress mixed DEL/ADD runs whose concatenated content is equal.

    This fixes the common case where one side split a logical provision into
    multiple chunks and the other side kept it as one chunk, producing a burst
    of false DEL/ADDs even though the underlying content is unchanged.

    Extended to handle Textual Amendments reformatting: Doc A may store all
    amendment entries as one dense paragraph block while Doc B splits each
    Fxxx entry onto its own line.  Both encode the same legal content.

    Performance: runs are capped at 20 chunks each side to avoid O(n²) on
    large documents with many consecutive unmatched sections.
    """
    if not chunks:
        return chunks

    _MAX_RUN = 20   # cap run length to avoid quadratic blowup on large docs

    keep = [True] * len(chunks)
    i = 0
    while i < len(chunks):
        if chunks[i].kind not in (KIND_DEL, KIND_ADD):
            i += 1
            continue

        j = i
        dels = []
        adds = []
        while j < len(chunks) and chunks[j].kind in (KIND_DEL, KIND_ADD):
            if chunks[j].kind == KIND_DEL:
                dels.append((j, chunks[j]))
            else:
                adds.append((j, chunks[j]))
            j += 1
            # Cap run size for performance
            if len(dels) + len(adds) >= _MAX_RUN * 2:
                break

        # Only mixed runs can cancel out.
        if dels and adds:
            # Quick length-ratio guard: very different total lengths can't be reflow
            total_a = sum(len(ch.text_a) for _, ch in dels)
            total_b = sum(len(ch.text_b) for _, ch in adds)
            ratio = min(total_a, total_b) / max(total_a, total_b, 1)
            # Skip if text is too long to be single-provision reflow (>10000 chars)
            # or if lengths differ too much to be reflow
            if ratio >= 0.30 and total_a <= 10000 and total_b <= 10000:
                joined_del = ' '.join(ch.text_a for _, ch in dels).strip()
                joined_add = ' '.join(ch.text_b for _, ch in adds).strip()
                if joined_del and joined_add and _joined_equivalent(joined_del, joined_add):
                    for idx, _ in dels:
                        keep[idx] = False
                    for idx, _ in adds:
                        keep[idx] = False
                else:
                    # Fix: Textual Amendments dense-paragraph vs per-line reformat.
                    if joined_del and joined_add:
                        norm_del = _famend_normalized(joined_del)
                        norm_add = _famend_normalized(joined_add)
                        if (norm_del and norm_add and
                                _similarity(norm_del, norm_add) >= 0.85 and
                                _numbers_match(norm_del, norm_add)):
                            for idx, _ in dels:
                                keep[idx] = False
                            for idx, _ in adds:
                                keep[idx] = False

        i = j

    return [ch for idx, ch in enumerate(chunks) if keep[idx]]


def _convert_adjacent_del_add_runs_to_mod(chunks: List[Chunk]) -> List[Chunk]:
    """Convert adjacent mixed DEL/ADD runs into one MOD when they are near-equivalent.

    This handles newline-driven block splits where content is mostly the same but
    block boundaries differ, so UI can show word-level highlights instead of
    whole-block DEL/ADD coloring.

    Performance: runs are capped at 10 chunks each side and 600 chars per side
    to prevent creating oversized MODs from long block-segmentation mismatches.
    """
    if not chunks:
        return chunks

    _MAX_RUN = 10
    _MAX_CHARS = 600  # per side — prevents creating huge misleading MODs

    out: List[Chunk] = []
    i = 0
    while i < len(chunks):
        if chunks[i].kind not in (KIND_DEL, KIND_ADD):
            out.append(chunks[i])
            i += 1
            continue

        j = i
        dels: List[Chunk] = []
        adds: List[Chunk] = []
        while j < len(chunks) and chunks[j].kind in (KIND_DEL, KIND_ADD):
            if chunks[j].kind == KIND_DEL:
                dels.append(chunks[j])
            else:
                adds.append(chunks[j])
            j += 1
            if len(dels) + len(adds) >= _MAX_RUN * 2:
                break

        if not dels or not adds:
            out.extend(chunks[i:j])
            i = j
            continue

        joined_a = re.sub(r'\s+', ' ', ' '.join(c.text_a for c in dels if c.text_a).strip())
        joined_b = re.sub(r'\s+', ' ', ' '.join(c.text_b for c in adds if c.text_b).strip())
        if not joined_a or not joined_b:
            out.extend(chunks[i:j])
            i = j
            continue

        # Reject oversized joins — they produce misleading word-level diffs
        if len(joined_a) > _MAX_CHARS or len(joined_b) > _MAX_CHARS:
            out.extend(chunks[i:j])
            i = j
            continue

        # Quick length-ratio guard
        len_ratio = min(len(joined_a), len(joined_b)) / max(len(joined_a), len(joined_b), 1)
        if len_ratio < 0.40:
            out.extend(chunks[i:j])
            i = j
            continue

        na, nb = _norm_cmp(joined_a), _norm_cmp(joined_b)
        sim = max(_similarity(na, nb), _char_similarity(na, nb))
        overlap = _word_overlap_ratio(na, nb)

        # Stricter thresholds for longer texts — length-dependent to avoid
        # creating oversized MODs from multi-block segmentation mismatches.
        max_len = max(len(joined_a), len(joined_b))
        if max_len > 300:
            min_sim, min_overlap = 0.88, 0.85
        elif max_len > 150:
            min_sim, min_overlap = 0.83, 0.80
        else:
            min_sim, min_overlap = 0.78, 0.74

        should_convert = (
            not _should_suppress_chunk(joined_a, joined_b) and
            _numbers_match(na, nb) and
            sim >= min_sim and
            overlap >= min_overlap
        )

        if should_convert:
            out.append(Chunk(
                kind=KIND_MOD,
                block_a=dels[0].block_a,
                block_b=adds[0].block_b,
                text_a=joined_a,
                text_b=joined_b,
            ))
        else:
            out.extend(chunks[i:j])

        i = j

    return out


def _convert_high_similarity_del_add_to_mod(chunks: List[Chunk]) -> List[Chunk]:
    """Turn likely paired DEL+ADD chunks into MOD chunks.

    This keeps the UI focused on word-level edits rather than highlighting
    entire phrases when both sides are largely the same content.

    Performance optimised: uses multi-token indexing and length-bucket filtering
    to reduce expensive similarity calls from O(n*k) to near-linear.
    """
    if not chunks:
        return chunks

    del_indices = [i for i, ch in enumerate(chunks) if ch.kind == KIND_DEL and ch.text_a.strip()]
    add_indices = [i for i, ch in enumerate(chunks) if ch.kind == KIND_ADD and ch.text_b.strip()]
    if not del_indices or not add_indices:
        return chunks

    from collections import defaultdict
    # Index ADD chunks by first token AND by first+second token bigram
    add_by_first = defaultdict(list)
    add_by_first_stripped = defaultdict(list)
    add_by_bigram = defaultdict(list)     # (w1, w2) -> [ai]
    add_by_nospace_pfx = defaultdict(list)  # space-stripped prefix -> [ai]
    add_lengths = {}                       # ai -> len(norm_text)

    for ai in add_indices:
        an = _norm_cmp(chunks[ai].text_b)
        add_lengths[ai] = len(an)
        words = an.split()
        if words:
            add_by_first[words[0]].append(ai)
            if len(words) >= 2:
                add_by_bigram[(words[0], words[1])].append(ai)
        sn = _strip_prov_anchors(chunks[ai].text_b)
        s_words = sn.split()
        if s_words:
            add_by_first_stripped[s_words[0]].append(ai)
        # Space-stripped prefix index: for PDFs with glyph-spacing artefacts
        # ("R es olución" vs "Resolución") where _norm_cmp first-tokens diverge.
        _ns = re.sub(r'\s+', '', chunks[ai].text_b.lower())
        if len(_ns) >= 8:
            add_by_nospace_pfx[_ns[:10]].append(ai)

    used_add = set()
    keep = [True] * len(chunks)
    inject_mod: dict = {}

    for di in del_indices:
        dn = _norm_cmp(chunks[di].text_a)
        d_words = dn.split()
        if not d_words:
            continue
        first = d_words[0]
        dn_len = len(dn)

        # Try bigram match first (most selective)
        candidates = set()
        if len(d_words) >= 2:
            candidates = set(add_by_bigram.get((d_words[0], d_words[1]), []))

        # Fall back to first-word match
        if not candidates:
            candidates = set(add_by_first.get(first, []))
            s_first_words = _strip_prov_anchors(chunks[di].text_a).split()
            first_s = s_first_words[0] if s_first_words else first
            if first_s != first:
                candidates.update(add_by_first_stripped.get(first_s, []))

        # Space-stripped prefix match: catches glyph-spacing PDFs where
        # _norm_cmp produces different first tokens for the same content.
        if not candidates:
            _dns = re.sub(r'\s+', '', chunks[di].text_a.lower())
            if len(_dns) >= 8:
                candidates = set(add_by_nospace_pfx.get(_dns[:10], []))

        # Proximity fallback: only ±4 neighbours (tighter than before)
        if not candidates:
            lo = max(0, di - 4)
            hi = min(len(chunks), di + 5)
            candidates = {i for i in add_indices if lo <= i < hi}

        if not candidates:
            continue

        best_i = None
        best_score = 0.72
        for ai in candidates:
            if ai in used_add:
                continue
            # Fast length-ratio guard (char count) — skip before any string ops
            ai_len = add_lengths.get(ai, 0)
            if ai_len == 0:
                continue
            len_ratio = min(dn_len, ai_len) / max(dn_len, ai_len)
            if len_ratio < 0.45:
                continue
            an = _norm_cmp(chunks[ai].text_b)
            sim = max(_similarity(dn, an), _char_similarity(dn, an))
            if sim < 0.72:
                continue
            if not _numbers_match(dn, an):
                continue
            pos_bonus = 1.0 - (abs(ai - di) / 60.0)
            score = sim + max(0.0, pos_bonus) * 0.03
            if score > best_score:
                best_score = score
                best_i = ai

        if best_i is not None:
            used_add.add(best_i)
            keep[di] = False
            keep[best_i] = False
            inject_mod[di] = Chunk(
                kind=KIND_MOD,
                block_a=chunks[di].block_a,
                block_b=chunks[best_i].block_b,
                text_a=chunks[di].text_a,
                text_b=chunks[best_i].text_b,
            )

    out: List[Chunk] = []
    for i, ch in enumerate(chunks):
        if i in inject_mod:
            out.append(inject_mod[i])
        if keep[i]:
            out.append(ch)
    return out


def _token_set(text: str) -> set:
    """Word tokens from normalised text (stopwords stripped)."""
    _STOP = frozenset({'a', 'an', 'the', 'of', 'to', 'in', 'and', 'or',
                       'is', 'by', 'be', 'it', 'at', 'as', 'on', 'for',
                       'with', 'not', 'are', 'was', 'has', 'its', 'that'})
    return {w for w in text.split() if w not in _STOP and len(w) > 1}


def _word_overlap_ratio(a: str, b: str) -> float:
    """Jaccard overlap of content words between two normalised strings."""
    sa, sb = _token_set(a), _token_set(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _is_reflow_only(a: str, b: str) -> bool:
    """
    True when two strings contain the same legal content but differ only in
    line-wrapping. Uses sorted token bags for exact match, with tight tolerance.
    """
    na, nb = _norm_cmp(a), _norm_cmp(b)
    wa, wb = sorted(na.split()), sorted(nb.split())
    if wa == wb:
        return True
    # CJK/OCR fallback: near-identical char stream with matching numbers.
    if _char_similarity(na, nb) >= 0.97 and _numbers_match(na, nb):
        return True
    # For longer blocks: allow 1-word difference only if numbers are identical
    # (a real legal change always changes a number: year, section, schedule ref).
    # Threshold lowered from >8 to >5 so short provisions (e.g. a single
    # bracketed sub-item with 6-8 words) are also caught.
    total = max(len(wa), len(wb))
    if total > 5 and abs(len(wa) - len(wb)) <= 1:
        common = sum(1 for w in wa if w in set(wb))
        threshold = 0.97 if total > 15 else 0.94   # looser for short provisions
        if common / max(total, 1) >= threshold and _numbers_match(na, nb):
            return True
    return False


def _numbers_match(a: str, b: str) -> bool:
    """True when numeric tokens of the shorter text are all present in the longer.
    Distinguishes reflow (same numbers, different wrapping) from real changes
    (different years, schedule references, section numbers)."""
    nums_a = set(re.findall(r'\b\d+[a-z]?\b', a))
    nums_b = set(re.findall(r'\b\d+[a-z]?\b', b))
    if not nums_a and not nums_b:
        return True
    shorter = nums_a if len(nums_a) <= len(nums_b) else nums_b
    longer  = nums_b if len(nums_a) <= len(nums_b) else nums_a
    return shorter.issubset(longer)


def _is_linewrap_reflow(na: str, nb: str) -> bool:
    """
    True when two normalised texts are the same legal provision but one has
    been line-width-truncated by PDF extraction (text cut at the page margin).
    Conditions - ALL must hold:
      1. Same first word (same anchor: F33, (2), 17treatment, etc.)
      2. Sequence-matcher ratio >= 0.90 (very high word-level overlap)
      3. Numeric tokens are IDENTICAL in both strings — a real change always
         alters at least one number (year, section, schedule reference).
         (symmetric check: not just subset, but equal sets)
      4. Content-word Jaccard overlap >= 0.85
         (prevents suppressing genuine word changes like 'calculated' → 'computed')
    """
    wa, wb = na.split(), nb.split()
    if not wa or not wb or wa[0] != wb[0]:
        return False
    if difflib.SequenceMatcher(None, wa, wb, autojunk=False).ratio() < 0.90:
        return False
    # Symmetric number check: both must have the same set of numbers
    nums_a = set(re.findall(r'\b\d+[a-z]?\b', na))
    nums_b = set(re.findall(r'\b\d+[a-z]?\b', nb))
    if nums_a != nums_b:
        return False
    return _word_overlap_ratio(na, nb) >= 0.85


_suppress_cache: dict = {}

def _should_suppress_chunk(text_a: str, text_b: str) -> bool:
    """
    Tolerance layer: suppress chunk if the difference is formatting/reflow only.
    Real legal changes always differ in: numbers (years, sections, schedules),
    or add/remove entire words of legal significance.
    """
    if not text_a or not text_b:
        return False

    # Fast path: identical texts always suppress
    if text_a == text_b:
        return True

    # Memoization: same (text_a, text_b) pair often checked multiple times
    # across containment, refining, fuzzy, and reflow passes.
    _ck = (text_a, text_b)
    cached = _suppress_cache.get(_ck)
    if cached is not None:
        return cached

    result = _should_suppress_chunk_inner(text_a, text_b)
    _suppress_cache[_ck] = result
    return result


def _should_suppress_chunk_inner(text_a: str, text_b: str) -> bool:

    # 1. Whitespace only
    if _is_whitespace_only_diff(text_a, text_b):
        return True

    na, nb = _norm_cmp(text_a), _norm_cmp(text_b)

    # Fast path: normalized texts equal → formatting difference only
    if na == nb:
        return True

    # Space-collapsed equivalence: PDF extractors sometimes insert spurious
    # spaces between glyphs ("R es olución" vs "Resolución", "cr édito" vs
    # "crédito", "deber án" vs "deberán").  Language-agnostic — works for any
    # script.  Uses raw text to avoid incorrect merges from _norm_cmp's
    # English-specific spaced-letter collapse.
    _raw_a = re.sub(r'\s+', '', text_a)
    _raw_b = re.sub(r'\s+', '', text_b)
    # Case-sensitive: catches spacing-only extraction artefacts.
    if _raw_a == _raw_b:
        return True
    # Case-insensitive: catches combined spacing + heading casing artefacts.
    # Only when the word counts differ (spacing causes more tokens), so pure
    # casing changes (same word count) are left to the casing guard below.
    if (_raw_a.lower() == _raw_b.lower()
            and len(text_a.split()) != len(text_b.split())):
        return True
    # Near-match after space collapse: catches spacing artefacts combined with
    # minor extraction corruption (stray character, missing accent, etc.).
    if len(_raw_a) >= 8 and len(_raw_b) >= 8:
        _ns_ratio = min(len(_raw_a), len(_raw_b)) / max(len(_raw_a), len(_raw_b))
        if _ns_ratio >= 0.90:
            _ns_sim = _char_similarity(_raw_a.lower(), _raw_b.lower())
            if _ns_sim >= 0.96 and _numbers_match(text_a, text_b):
                return True

    # 0. Casing-only guard: texts that differ ONLY in letter case (e.g.
    # "March" -> "march" or "TRUE" -> "true") must never be suppressed.
    # _norm_cmp lowercases everything so downstream rules would miss these.
    # Only fires when word counts match — spaced-letter artefacts like
    # "P ART 2" vs "Part 2" have different word counts and should not be
    # blocked here (they are handled by _norm_cmp collapsing + rule 2).
    # EXCEPTION: all-caps heading variants ("CSOP SCHEMES" vs "CSOP schemes")
    # are formatting differences, not content changes — allow those through.
    if (_raw_a.lower() == _raw_b.lower() and _raw_a != _raw_b
            and len(text_a.split()) == len(text_b.split())):
        # Allow suppression if one side is all-caps (heading format difference)
        _alpha_a = re.sub(r'[^A-Za-z]', '', text_a)
        _alpha_b = re.sub(r'[^A-Za-z]', '', text_b)
        _one_allcaps = (_alpha_a == _alpha_a.upper() or _alpha_b == _alpha_b.upper())
        if not _one_allcaps:
            return False

    # 1b. F-number-stripped equivalence: amendment lines that differ only in
    # the leading F-number token (e.g. "F379 Word..." vs "F350 Word...") are
    # the same legal amendment — only the annotation index shifted.
    # Also handles bracket-prefixed forms like "[f1540]579d ..."
    _strip_fnum = lambda s: re.sub(r'^\[?[a-z]\d+[a-z]?\]?\s*', '', s.strip())
    sa_strip = _strip_fnum(na)
    sb_strip = _strip_fnum(nb)
    if sa_strip and sb_strip and sa_strip == sb_strip:
        return True

    # 1c. Content-only equivalence: blocks that differ only in which inline
    # amendment bracket references they contain ([F17A], [F2Chapters...]) are
    # the same legal provision — only the annotation markup differs.
    ca, cb = _content_only(text_a), _content_only(text_b)
    if ca and cb and ca == cb:
        return True
    # Also suppress when content-only texts are near-identical (high similarity
    # + same numbers), catching cases where bracket stripping leaves minor
    # whitespace/punctuation differences.
    if ca and cb and _similarity(ca, cb) >= 0.92 and _numbers_match(ca, cb):
        return True

    # 1d. Marker-stripped equivalence: if only outline marker extraction differs
    # ((a)/(1) vs missing/variant forms) while body text is the same, suppress.
    pa, pb = _strip_prov_anchors(text_a), _strip_prov_anchors(text_b)
    if pa and pb:
        if pa == pb:
            return True
        if _is_punctuation_only_diff(pa, pb):
            return True
        if _similarity(pa, pb) >= 0.97 and _numbers_match(pa, pb):
            return True

    # 1e. Citation-extraction spacing: PDF hyperlinks are often extracted with
    # spurious spaces before commas/closing brackets, or inside brackets:
    #   "arts. 1 , 2(2)" vs "arts. 1, 2(2)"
    #   "(with Sch. 2 )" vs "(with Sch. 2)"
    #   "[ F29 , 7 or 7A ]" vs "[F29, 7 or 7A]"
    # This is never a real legal change — strip those spaces and re-test.
    def _ncs(s):
        s = re.sub(r'[ \t]+([,\)\]])', r'\1', s)   # spaces before ,)]
        s = re.sub(r'([\[\(])[ \t]+', r'\1', s)     # spaces after [(
        return s
    if _ncs(na) == _ncs(nb):
        return True
    if pa and pb and _ncs(pa) == _ncs(pb):
        return True
    if sa_strip and sb_strip and _ncs(sa_strip) == _ncs(sb_strip):
        return True

    # 1f. Citation-continuation lines: wrapped tails like "2011 (c. 11) , Sch. 2 para. 3"
    if _RE_SUPPRESS_CITE_FRAG.match(_norm_cmp(text_a)) and _RE_SUPPRESS_CITE_FRAG.match(_norm_cmp(text_b)):
        if _numbers_match(_norm_cmp(text_a), _norm_cmp(text_b)) and _similarity(_norm_cmp(text_a), _norm_cmp(text_b)) >= 0.75:
            return True

    # 1g. Provision-marker relocation around amendment labels:
    # e.g. "F31 (4B) Subject ..." vs "F31 Subject ... (4B)".
    # Same marker token moved position due extraction/reflow should not diff.
    _PROV_TOK = r'\((?:[a-z]{1,3}|\d{1,3}[a-z]?|[ivxlcdm]{1,6})\)'
    _LEAD_F = r'^[a-z]\d+[a-z]?\s+'

    def _strip_front_marker(s: str):
        m = re.match(rf'^\s*({_PROV_TOK})\s+(.+)$', s, re.I)
        if m:
            return m.group(1), m.group(2).strip()
        m = re.match(rf'^\s*{_LEAD_F}({_PROV_TOK})\s+(.+)$', s, re.I)
        if m:
            lead = re.match(_LEAD_F, s, re.I).group(0)
            return m.group(1), (lead + m.group(2)).strip()
        return None, s.strip()

    ma, ta = _strip_front_marker(na)
    mb, tb = _strip_front_marker(nb)
    if ma and not mb and ma in nb:
        nb_wo = re.sub(re.escape(ma), ' ', nb, count=1)
        nb_wo = re.sub(r'\s+', ' ', nb_wo).strip()
        if _similarity(ta, nb_wo) >= 0.97 and _numbers_match(ta, nb_wo):
            return True
    if mb and not ma and mb in na:
        na_wo = re.sub(re.escape(mb), ' ', na, count=1)
        na_wo = re.sub(r'\s+', ' ', na_wo).strip()
        if _similarity(tb, na_wo) >= 0.97 and _numbers_match(tb, na_wo):
            return True

    # Structural guard: preserve explicit provision/bullet changes.
    prov_a = _RE_PROV_PAT.match(na)
    prov_b = _RE_PROV_PAT.match(nb)
    if prov_a and prov_b and prov_a.group(0) != prov_b.group(0):
        return False
    if bool(prov_a) != bool(prov_b):
        # Adaptive behavior: whichever side looks structurally poorer is treated
        # as weaker extraction, regardless of left/right or old/new template.
        if _looks_weaker_extraction(text_a, text_b) or _looks_weaker_extraction(text_b, text_a):
            return True
        return False

    # 2. Punctuation only (after normalisation)
    if _is_punctuation_only_diff(na, nb):
        return True

    # 3. Pure word-bag reflow (same words, different wrapping)
    if _is_reflow_only(text_a, text_b):
        return True

    # 4. Line-wrap truncation (same anchor, same numbers, very high word overlap)
    if _is_linewrap_reflow(na, nb):
        return True

    sim = _combined_similarity(na, nb)

    # High character-level equivalence (common in Korean/CJK reflow extraction).
    if _char_similarity(na, nb) >= 0.985 and _numbers_match(na, nb):
        return True

    # Pre-compute number sets once — used in several rules below.
    # Includes hyphenated year ranges like "2025-26".
    nums_a = set(re.findall(r'\b\d+(?:-\d+)?[a-z]?\b', na))
    nums_b = set(re.findall(r'\b\d+(?:-\d+)?[a-z]?\b', nb))
    same_nums = (nums_a == nums_b)   # symmetric equality

    # 4b. Prefix/suffix truncation reflow: one side is a strict prefix/suffix
    # of the other with the same opening anchor and same numbers.
    # This catches PDF extraction cut-offs at page-width boundaries.
    wa, wb = na.split(), nb.split()
    if wa and wb:
        shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
        shorter_nums = nums_a if len(na) <= len(nb) else nums_b
        longer_nums = nums_b if len(na) <= len(nb) else nums_a
        is_prefix_suffix = longer.startswith(shorter) or longer.endswith(shorter)
        # Also accept containment (shorter is a substring of longer)
        is_contained = shorter in longer
        if (is_prefix_suffix or is_contained) and len(shorter) >= 6:
            # Suppress if numbers are a subset (shorter's nums ⊆ longer's nums)
            # or numbers are the same. Truncation at block boundaries causes
            # the shorter block to lack some numbers that are in the tail.
            if (same_nums or shorter_nums <= longer_nums) and sim >= 0.70:
                return True

    # 4c. Heading subsumption: a short heading (e.g. "tax on employment income"
    # from a spaced-letter all-caps extraction) that is fully contained as a
    # suffix of a longer heading (e.g. "chapter 2 tax on employment income").
    # The longer version has a chapter/part/section number prepended — same
    # legal content, different PDF extraction style.
    if len(wa) >= 2 and len(wb) >= 2:
        shorter_h = na if len(na) <= len(nb) else nb
        longer_h  = nb if len(na) <= len(nb) else na
        if longer_h.endswith(shorter_h) and _word_overlap_ratio(na, nb) >= 0.70:
            # Verify the extra prefix is just a structural label (chapter N, part N, etc.)
            extra = longer_h[: len(longer_h) - len(shorter_h)].strip()
            if re.match(r'^(?:chapter|part|schedule|section)\s*\d', extra, re.I) or not extra:
                return True

    # 5. Near-identical (≥92%) with no number change AND high word overlap.
    #    Requires ≥95% content-word overlap so single-word substitutions like
    #    "March" -> "April" (sim≈94%, same nums, but 80% overlap) are NOT
    #    suppressed. True reflow has 100% overlap; a substitution drops it.
    if sim >= 0.92 and same_nums and _word_overlap_ratio(na, nb) >= 0.95:
        return True

    # 6. Very high content-word overlap + same numbers — only stopwords differ
    if sim >= 0.82 and _word_overlap_ratio(na, nb) >= 0.92 and same_nums:
        return True

    # 6a. Subset-number containment: one side is fully contained in the other
    # (block boundary split) with high overlap.  The shorter side's numbers
    # will be a subset because the remaining numbers landed in a sibling block.
    if not same_nums and (nums_a <= nums_b or nums_b <= nums_a):
        overlap = _word_overlap_ratio(na, nb)
        if sim >= 0.85 and overlap >= 0.88:
            return True

    # 6b. Same provision anchor (a)/(b)/etc. + high overlap: sub-item reflow
    if sim >= 0.80 and _word_overlap_ratio(na, nb) >= 0.90 and same_nums:
        prov_a = re.match(r'^\([a-z]{1,3}\)', na)
        prov_b = re.match(r'^\([a-z]{1,3}\)', nb)
        if prov_a and prov_b and prov_a.group() == prov_b.group():
            return True

    # 6c. Same sorted letter-word bag (numbers stripped) with symmetric number equality.
    #     Catches C2/C3/F-annotation and heading blocks whose page-width reflow
    #     changed how many words land in each extracted block.
    #     IMPORTANT: only suppress when word sets are EXACTLY equal.
    #     1-word tolerance requires >=12 words AND >=0.96 sim to avoid
    #     suppressing real single-word substitutions.
    if same_nums:
        wa_s = sorted(re.sub(r'[^a-z ]', ' ', na).split())
        wb_s = sorted(re.sub(r'[^a-z ]', ' ', nb).split())
        if wa_s == wb_s:
            return True
        n_max = max(len(wa_s), len(wb_s))
        if (n_max >= 12 and abs(len(wa_s) - len(wb_s)) <= 1 and
                sim >= 0.96 and
                sum(1 for w in wa_s if w in set(wb_s)) / n_max >= 0.97):
            return True

    # 6d. C/F annotation blocks: high similarity + same numbers = reflow.
    #     These are always long citation strings; sim≥0.85 with equal numbers
    #     is conclusive evidence of different page-width wrapping.
    if sim >= 0.85 and same_nums and re.match(r'^[cf]\d', na):
        return True

    # 6e. Textual Amendment entry body equivalence: strip the leading F-number
    #     from both sides (e.g. "F379 Word in s.27(1)..." vs "F380 Word in s.27(1)...")
    #     and compare only the amendment action text.  When the bodies match
    #     at high similarity with the same numbers the F-number shift is an
    #     annotation index change, not an editorial change.
    _fn_strip = lambda s: re.sub(r'^\[?[a-z]\d+[a-z]?\]?\s*', '', s.strip(), flags=re.I)
    fa, fb = _fn_strip(na), _fn_strip(nb)
    if fa and fb and len(fa) > 10 and len(fb) > 10:
        fa_sim = _similarity(fa, fb)
        if fa_sim >= 0.90 and _numbers_match(fa, fb):
            return True

    # 7. Breadcrumb navigation labels
    if _is_breadcrumb(text_a) or _is_breadcrumb(text_b):
        return True

    # 8. Heading reformat: same words after stripping all punctuation
    #    e.g. "EMPLOYMENTINCOME: CHARGETOTAX" vs "Employment income: charge to tax"
    #    Only apply to short (<=8 word) blocks to avoid suppressing body text
    #    with real word substitutions.
    na_s = re.sub(r'[^a-z0-9 ]', ' ', na)
    nb_s = re.sub(r'[^a-z0-9 ]', ' ', nb)
    na_words = na_s.split(); nb_words = nb_s.split()
    if na_words and sorted(na_words) == sorted(nb_words) and len(na_words) <= 8:
        return True

    # 9. Same content after stripping provision markers like (2), (a).
    sa = _strip_prov_anchors(text_a)
    sb = _strip_prov_anchors(text_b)
    if sa and sb and sa == sb:
        return True
    if sa and sb and _is_punctuation_only_diff(sa, sb):
        return True

    # 10. Language-agnostic equivalence: identical alphabetic signature and
    # compatible numbers means extraction/layout artifact, not real change.
    aa = _alpha_signature(text_a)
    ab = _alpha_signature(text_b)
    if aa and aa == ab and _numbers_match(na, nb):
        return True

    return False



def _bag_changed_words(a: str, b: str, side: str):
    """Order-independent changed-word flags for near-equivalent blocks.

    Marks only token-count deltas as changed, so line-wrap reordering does not
    highlight entire phrases.
    """
    from collections import Counter

    wa, wb = a.split(), b.split()

    def _nw(w: str) -> str:
        return re.sub(r'^[^\w]+|[^\w]+$', '', w.lower())

    ca = Counter(_nw(w) for w in wa if _nw(w))
    cb = Counter(_nw(w) for w in wb if _nw(w))

    if side == "a":
        surplus = Counter({k: max(ca[k] - cb.get(k, 0), 0) for k in ca})
        out = []
        for w in wa:
            nw = _nw(w)
            changed = bool(nw and surplus.get(nw, 0) > 0)
            if changed:
                surplus[nw] -= 1
            out.append((w, changed))
        return out

    surplus = Counter({k: max(cb[k] - ca.get(k, 0), 0) for k in cb})
    out = []
    for w in wb:
        nw = _nw(w)
        changed = bool(nw and surplus.get(nw, 0) > 0)
        if changed:
            surplus[nw] -= 1
        out.append((w, changed))
    return out


def _word_ops(a: str, b: str):
    """
    Word-level diff ops between two block texts.
    Uses difflib.SequenceMatcher for alignment.
    Suppresses word-level 'replace' ops where the words differ only in
    punctuation or casing (these are not meaningful changes).
    Returns empty list if the only differences are outline numbering markers
    or punctuation-only differences (caller should suppress the whole chunk).
    """
    wa, wb = a.split(), b.split()
    ops = []

    def _nw(w: str) -> str:
        return _RE_STRIP_WORD_PUNCT.sub('', w.lower())

    # Align on normalized words first so punctuation and line-wrap extraction
    # artefacts don't explode into whole-phrase replace ops.
    nwa = [_nw(w) for w in wa]
    nwb = [_nw(w) for w in wb]
    sm = difflib.SequenceMatcher(None, nwa, nwb, autojunk=False)

    # Pattern for pure outline numbering tokens: (a), (1), (ba), a), 2. etc.

    def _strip_punct(w: str) -> str:
        """Strip leading/trailing punctuation only — preserve case."""
        return _RE_STRIP_WORD_PUNCT.sub('', w)

    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "replace":
            sa = wa[i1:i2]
            sb = wb[j1:j2]
            nsa = nwa[i1:i2]
            nsb = nwb[j1:j2]
            sm2 = difflib.SequenceMatcher(None, nsa, nsb, autojunk=False)

            # Same normalized token bag -> likely line-break/reflow ordering.
            if sorted(nsa) == sorted(nsb):
                ops.append(("equal", sa, sb))
                continue

            if sm2.ratio() >= 0.35:
                for nop, ii1, ii2, jj1, jj2 in sm2.get_opcodes():
                    sub_a = sa[ii1:ii2]
                    sub_b = sb[jj1:jj2]
                    if nop == "replace":
                        # Suppress only if identical after stripping punctuation
                        # (case-sensitive: "March" != "march" is a real change).
                        stripped_a = " ".join(_strip_punct(w) for w in sub_a)
                        stripped_b = " ".join(_strip_punct(w) for w in sub_b)
                        if stripped_a == stripped_b:
                            ops.append(("equal", sub_a, sub_b))
                        elif (all(_RE_OUTLINE_PAT.match(w) for w in sub_a) and
                              all(_RE_OUTLINE_PAT.match(w) for w in sub_b)):
                            ops.append(("equal", sub_a, sub_b))
                        else:
                            ops.append(("replace", sub_a, sub_b))
                    else:
                        ops.append((nop, sub_a, sub_b))
                continue

            # Suppress if identical modulo punctuation (case-sensitive).
            stripped_a = " ".join(_strip_punct(w) for w in wa[i1:i2])
            stripped_b = " ".join(_strip_punct(w) for w in wb[j1:j2])
            if stripped_a == stripped_b:
                ops.append(("equal", wa[i1:i2], wb[j1:j2]))
                continue
            if (all(_RE_OUTLINE_PAT.match(w) for w in wa[i1:i2]) and
                    all(_RE_OUTLINE_PAT.match(w) for w in wb[j1:j2])):
                ops.append(("equal", wa[i1:i2], wb[j1:j2]))
                continue
        ops.append((op, wa[i1:i2], wb[j1:j2]))
    return ops


# ─────────────────────────────────────────────────────────────
#  STAGE 3 - PRE-COMPUTE RENDER DATA
#
#  Builds the (text, tag) segment list for one pane.
#  Operates entirely in the worker thread -- zero Tk calls.
# ─────────────────────────────────────────────────────────────

# Characters-per-point for indentation. Courier New 10pt ≈ 6px/char.
# PDF x coords are in points; we want approx char columns.
INDENT_SCALE  = 0.10   # pt → space chars (reduced from 0.13 to prevent runaway widths)
INDENT_MAX    = 16      # cap indentation at 16 spaces (was 24 — too wide for display)
LINE_GAP_MIN  = 14      # gaps smaller than this → same paragraph, no blank line
LINE_GAP_PARA = 20      # gaps ≥ this → emit one blank line between paragraphs


BASE_FONT_SIZE   = 10
BASE_FONT_FAMILY = "Courier New"


def _span_fg(span: Span) -> str:
    """Return foreground colour. PDF colour is ignored — only emphasis flags matter."""
    if span.bold and span.italic: return COL_BOLD_IT
    if span.bold:                 return COL_BOLD
    if span.italic:               return COL_ITALIC
    if span.underline:            return COL_UNDERLINE
    if span.strikeout:            return COL_STRIKE
    return COL_NORMAL


def _span_font(span: Span) -> tuple:
    """Return font tuple. Size is always BASE_FONT_SIZE — PDF sizes are ignored."""
    family = BASE_FONT_FAMILY  # always Courier New — monospace editor style
    style  = ""
    if span.bold and span.italic: style = "bold italic"
    elif span.bold:               style = "bold"
    elif span.italic:             style = "italic"
    return (family, BASE_FONT_SIZE, style) if style else (family, BASE_FONT_SIZE)


# Pattern for trivial outline-marker words that don't warrant MOD highlighting
_TRIVIAL_WORD_PAT = re.compile(
    r'^[\W]*(?:[a-z]{1,3}|\d{1,4}|[ivxlcdm]{1,6})[\W]*$', re.I)


def precompute(blocks: List[Block], chunks: List[Chunk], side: str, blocks_other: List[Block] = None) -> dict:
    """
    Build render data for one pane.
    Returns {"segments": [...], "tag_cfgs": {...}, "offsets": {...}, "offset_ends": {...}}
    """
    # Map block_idx -> chunk_idx
    p2c: dict = {}
    for ci, ch in enumerate(chunks):
        key = ch.block_a if side == "a" else ch.block_b
        if key >= 0:
            p2c[key] = ci

    segments: list  = []
    tag_cfgs: dict  = {}
    offsets:  dict  = {}
    offset_ends: dict = {}
    char_pos        = [0]
    seq             = [0]

    _F = (BASE_FONT_FAMILY, BASE_FONT_SIZE)
    diff_styles = {
        "add":  {"background": ADD_BG, "foreground": ADD_FG,  "font": _F},
        "del":  {"background": DEL_BG, "foreground": DEL_FG,  "font": _F},
        "dmod": {"background": DEL_BG, "foreground": DEL_FG,  "font": _F},
        "mod":  {"background": MOD_BG, "foreground": MOD_FG,  "font": _F},
        "emp":  {"background": EMP_BG, "foreground": EMP_FG,  "font": _F},
        "nav":  {"background": NAV_BG},
        "nl":   {"foreground": EQL_FG, "font": _F},
    }
    tag_cfgs.update(diff_styles)

    def new_tag() -> str:
        seq[0] += 1
        return f"t{seq[0]}"

    def emit(text: str, tag: str):
        if text:
            segments.append((text, tag))
            char_pos[0] += len(text)

    def emit_span(span: Span, bg_tag: str = ""):
        fg   = _span_fg(span)
        font = _span_font(span)
        kw   = {"foreground": fg, "font": font}
        if span.underline:  kw["underline"]  = True
        if span.strikeout:  kw["overstrike"] = True
        if bg_tag:
            bg = diff_styles[bg_tag]["background"]
            kw["background"] = bg
            pool_key = ("_pool_", fg, font, span.underline, span.strikeout, bg)
        else:
            pool_key = ("_pool_", fg, font, span.underline, span.strikeout, None)

        existing = tag_cfgs.get(pool_key)
        if existing is None:
            existing = new_tag()
            tag_cfgs[existing] = kw
            tag_cfgs[pool_key] = existing
        emit(span.text, existing)

    prev_y = -999.0

    for bi, block in enumerate(blocks):
        ci = p2c.get(bi)
        ch = chunks[ci] if ci is not None else None

        if ci is not None:
            offsets[ci] = char_pos[0]

        # Pre-compute word-level diff for MOD blocks (across entire block text)
        mod_word_ops = None
        if ch is not None and ch.kind == KIND_MOD:
            raw_ops = _word_ops(ch.text_a, ch.text_b)
            # Suppress MOD highlight entirely if all changed words are trivial
            # (outline numbering tokens or single-char punctuation).
            changed_words_a = []
            changed_words_b = []
            for op2, wa2, wb2 in raw_ops:
                if op2 in ("delete", "replace"):
                    changed_words_a.extend(wa2)
                if op2 in ("insert", "replace"):
                    changed_words_b.extend(wb2)
            all_trivial = (
                (not changed_words_a and not changed_words_b) or
                (all(_TRIVIAL_WORD_PAT.match(w) for w in changed_words_a) and
                 all(_TRIVIAL_WORD_PAT.match(w) for w in changed_words_b) and
                 all(len(re.sub(r'[^\w]', '', w)) <= 3
                     for w in changed_words_a + changed_words_b))
            )
            mod_word_ops = None if all_trivial else raw_ops

        block_indent = min(INDENT_MAX, max(0, round(block.lines[0].x_min * INDENT_SCALE)))

        for li, line in enumerate(block.lines):
            dy = line.y - prev_y if prev_y >= 0 else 0
            # Emit a blank separator line only for paragraph-level gaps
            if dy >= LINE_GAP_PARA:
                emit("\n", "nl")
            prev_y = line.y

            # Indentation: first line uses its own PDF x; continuation lines within
            # the same block use the block's anchor indent so wrapped text aligns.
            if li == 0:
                indent = block_indent
            else:
                # Continuation line: use the larger of block indent and line indent
                # (handles hanging-indent provisions like "(a) text text text")
                line_indent = min(INDENT_MAX, max(0, round(line.x_min * INDENT_SCALE)))
                indent = max(block_indent, line_indent)
            emit(" " * indent, "nl")

            if ch is None:
                for span in line.spans:
                    if span.text:
                        emit_span(span)

            elif ch.kind == KIND_DEL and side == "a":
                for span in line.spans:
                    if span.text:
                        emit_span(span, "del")

            elif ch.kind == KIND_ADD and side == "b":
                for span in line.spans:
                    if span.text:
                        emit_span(span, "add")

            elif ch.kind == KIND_EMP:
                # Word-level EMP: highlight words whose emphasis (bold/italic/
                # underline/strikeout) changed between versions.
                # Build the changed-word map once on li==0, reuse for later lines.
                if li == 0:
                    try:
                        _ob_list  = blocks_other if (blocks_other is not None) else []
                        other_idx = ch.block_b if side == "a" else ch.block_a
                        if 0 <= other_idx < len(_ob_list):
                            wm_self  = _emp_word_map(block)
                            wm_other = _emp_word_map(_ob_list[other_idx])
                            # Store dict: normalised_word -> (self_emp, other_emp)
                            # Only track words where bold OR italic changed —
                            # underline/strikeout toggles are hyperlink artefacts.
                            block._emp_changed = {
                                w: (wm_self[w], wm_other[w])
                                for w in (set(wm_self) & set(wm_other))
                                if (wm_self[w][0] != wm_other[w][0]   # bold
                                    or wm_self[w][1] != wm_other[w][1]   # italic
                                    or wm_self[w][2] != wm_other[w][2]   # underline
                                    or wm_self[w][3] != wm_other[w][3])  # strikeout
                            }
                        else:
                            block._emp_changed = {}
                    except Exception:
                        block._emp_changed = {}

                emp_chg = getattr(block, "_emp_changed", {})

                for span in line.spans:
                    if not span.text:
                        continue
                    if not emp_chg:
                        emit_span(span)
                        continue
                    fg   = _span_fg(span)
                    font = _span_font(span)
                    buf:       list = []
                    buf_hi:    bool = False
                    buf_empinfo      = None  # (self_emp, other_emp) for tooltip logic

                    def _fe(buf, hi, fg, font, span, empinfo=None):
                        if not buf: return
                        kw = {"foreground": (EMP_FG if hi else fg), "font": font}
                        # Preserve emphasis display on the span itself
                        if span.underline:  kw["underline"]  = True
                        if span.strikeout:  kw["overstrike"] = True
                        if hi:
                            kw["background"] = EMP_BG
                            # Annotate what kind of change occurred:
                            # If emphasis was ADDED in B (self has it, A does not),
                            # use bold+italic for the highlight font to make it pop.
                            if empinfo:
                                self_e, other_e = empinfo
                                # Determine if emphasis was gained or lost on this side
                                gained = any(s and not o for s, o in zip(self_e, other_e))
                                lost   = any(o and not s for s, o in zip(self_e, other_e))
                                if gained:
                                    # This side HAS the emphasis — show it clearly
                                    kw["font"] = (font[0], font[1], "bold italic") if len(font) >= 2 else font
                                elif lost:
                                    # This side LOST the emphasis — show strikethrough hint
                                    kw["overstrike"] = True
                        t2 = new_tag(); tag_cfgs[t2] = kw
                        emit(" ".join(buf) + " ", t2)

                    for w in span.text.split():
                        nw = re.sub(r'[^a-z0-9]', '', w.lower())
                        hi = nw in emp_chg
                        ei = emp_chg.get(nw) if hi else None
                        if buf and (hi != buf_hi or ei != buf_empinfo):
                            _fe(buf, buf_hi, fg, font, span, buf_empinfo); buf = []
                        buf.append(w); buf_hi = hi; buf_empinfo = ei
                    _fe(buf, buf_hi, fg, font, span, buf_empinfo)

            elif ch.kind == KIND_MOD:
                # MOD blocks: render line-by-line, preserving the original PDF
                # line boundaries. This is critical for sub-provision lists where
                # each (a), (b), (c) marker sits on its own PDF line and MUST
                # start a new display line — not be flattened into one paragraph.
                #
                # On li==0 we set up the word diff and emit the first line.
                # On li>0 we emit subsequent lines (newline+indent already emitted
                # by the outer loop above — we just need to emit the words).
                #
                # Strategy: build the full (word, is_changed) list once on li==0
                # and store it on the block. Then on each li we consume the words
                # that belong to that specific PDF line.
                if li == 0:
                    if mod_word_ops is None:
                        # Trivial-only changes: store None so li>0 uses plain emit
                        block._mod_diff_words = None
                        block._mod_sw_words   = None
                        block._mod_line_map   = None
                    else:
                        # Build flat (word, Span) list indexed by line
                        all_sw: list = []   # [(word, Span, line_idx)]
                        for _li2, _bl in enumerate(block.lines):
                            for _sp in _bl.spans:
                                for _w in _sp.text.split():
                                    all_sw.append((_w, _sp, _li2))

                        # Build (word, is_changed). For high-overlap chunks,
                        # use order-independent token deltas so newline reflow
                        # and wrapped-sentence ordering do not paint whole lines.
                        diff_words: list = []
                        na_mod = _norm_cmp(ch.text_a)
                        nb_mod = _norm_cmp(ch.text_b)
                        use_bag_mode = (
                            _numbers_match(na_mod, nb_mod) and
                            _word_overlap_ratio(na_mod, nb_mod) >= 0.86
                        )
                        if use_bag_mode:
                            diff_words = _bag_changed_words(ch.text_a, ch.text_b, side)
                        else:
                            ops = mod_word_ops or []
                            if side == "a":
                                for op, wa2, wb2 in ops:
                                    if op == "insert":
                                        continue
                                    changed = op in ("delete", "replace")
                                    for w in wa2:
                                        diff_words.append((w, changed))
                            else:
                                for op, wa2, wb2 in ops:
                                    if op == "delete":
                                        continue
                                    changed = op in ("insert", "replace")
                                    for w in wb2:
                                        diff_words.append((w, changed))

                        # Map each diff word to a line index via all_sw
                        # (zip by position; extra diff words stay on last line)
                        dw_line: list = []  # [(word, is_changed, line_idx)]
                        for di2, (dw2, is_c) in enumerate(diff_words):
                            li2 = all_sw[di2][2] if di2 < len(all_sw) else (all_sw[-1][2] if all_sw else 0)
                            sp2 = all_sw[di2][1] if di2 < len(all_sw) else (all_sw[-1][1] if all_sw else None)
                            dw_line.append((dw2, is_c, li2, sp2))

                        block._mod_diff_words = dw_line
                        block._mod_sw_words   = all_sw

                # Emit words belonging to this line index
                dw_line = getattr(block, "_mod_diff_words", None)

                if dw_line is None:
                    # Trivial suppressed: emit plain spans for this line
                    for _sp in line.spans:
                        if _sp.text:
                            emit_span(_sp)
                else:
                    # Emit only words whose line_idx == li
                    buf_words2: list = []
                    buf_sig2         = None
                    buf_kw2: dict    = {}

                    def _flush_mod_buf(bw, bk):
                        if not bw: return
                        text = " ".join(bw) + " "
                        sk = (bk.get("foreground"), bk.get("font"),
                              bk.get("underline"), bk.get("overstrike"),
                              bk.get("background"))
                        ex = tag_cfgs.get(("_pool_", sk))
                        if ex is None:
                            ex = new_tag()
                            tag_cfgs[ex] = dict(bk)
                            tag_cfgs[("_pool_", sk)] = ex
                        emit(text, ex)

                    for (dw2, is_c, li2, sp2) in dw_line:
                        if li2 != li:
                            continue
                        if sp2 is None:
                            continue
                        fg2    = _span_fg(sp2)
                        font2  = _span_font(sp2)
                        kw2: dict = {"foreground": fg2, "font": font2}
                        if sp2.underline:  kw2["underline"]  = True
                        if sp2.strikeout:  kw2["overstrike"] = True
                        if is_c:
                            kw2["background"] = DEL_BG if side == "a" else MOD_BG
                            kw2["foreground"] = DEL_FG if side == "a" else MOD_FG

                        sig2 = (fg2, font2, sp2.underline, sp2.strikeout, is_c)
                        if buf_words2 and sig2 != buf_sig2:
                            _flush_mod_buf(buf_words2, buf_kw2)
                            buf_words2 = []
                        buf_words2.append(dw2)
                        buf_sig2 = sig2
                        buf_kw2  = kw2

                    _flush_mod_buf(buf_words2, buf_kw2)

            else:
                for span in line.spans:
                    if span.text:
                        emit_span(span)

            emit("\n", "nl")

        # Record end-of-block char position for accurate nav highlight sizing
        if ci is not None:
            offset_ends[ci] = char_pos[0]

    clean_cfgs = {k: v for k, v in tag_cfgs.items()
                  if isinstance(k, str) and isinstance(v, dict)}

    return {"segments": segments, "tag_cfgs": clean_cfgs,
            "offsets": offsets, "offset_ends": offset_ends}


# ─────────────────────────────────────────────────────────────
#  APPLICATION
# ─────────────────────────────────────────────────────────────