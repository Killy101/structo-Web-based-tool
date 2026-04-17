from __future__ import annotations

import io
import re
import difflib
import unicodedata
import logging
from typing import Any, Optional
from collections import Counter

logger = logging.getLogger(__name__)

# ── pdfminer imports ───────────────────────────────────────────────────────────

try:
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import (
        LTTextBox, LTTextLine, LTChar, LTAnno,
    )
    from pdfminer.layout import LAParams
    _PDFMINER_OK = True
except Exception as e:
    extract_pages = None
    LTTextBox = None
    LTTextLine = None
    LTChar = None
    LTAnno = None
    LAParams = None
    _PDFMINER_OK = False
    logger.warning(f"pdfminer import failed: {e}")


# ── Normalisation ──────────────────────────────────────────────────────────────

_LIGATURE = str.maketrans({
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl",
    "\u00ad": "",   "\u00a0": " ",
    "\u2019": "'",  "\u2018": "'",
    "\u201c": '"',  "\u201d": '"',
    "\u2013": "-",  "\u2014": "-",  "\u2212": "-",
    "\u2026": "...",
})

_NOISE_LINE = re.compile(
    r'^\s*(?:'
    r'\d{1,4}'                          # bare page number
    r'|page\s+\d+(?:\s+of\s+\d+)?'     # "page 3 of 10"
    r'|[^\w]{0,3}'                      # punctuation-only: ], [, ),
    r'|[FC]\d{1,4}'                     # bare footnote markers: F1, C2, F12
    r'|\d{1,3}[A-Za-z]'                 # fragments like "7A", "10B"
    r'|textual\s+amendments?'           # "Textual Amendments"
    r'|modifications?\s+etc'            # "Modifications etc."
    r'|commencement'                    # commencement notices
    r')\s*$',
    re.IGNORECASE,
)

def _norm(text: str) -> str:
    """Normalise text for comparison: NFKC + ligatures + whitespace + lower."""
    text = unicodedata.normalize("NFKC", text).translate(_LIGATURE)
    return " ".join(text.split()).lower()


# ── Data structures ────────────────────────────────────────────────────────────

class Span:
    """One run of text with uniform formatting."""
    __slots__ = ("text", "bold", "italic", "size", "page", "x0", "y0", "x1", "y1")

    def __init__(self, text: str, bold: bool, italic: bool,
                 size: float, page: int, bbox: tuple):
        self.text   = text
        self.bold   = bold
        self.italic = italic
        self.size   = round(size, 1)
        self.page   = page
        self.x0, self.y0, self.x1, self.y1 = bbox

    @property
    def norm(self) -> str:
        return _norm(self.text)


class Line:
    """One visual line — a list of Spans."""
    def __init__(self, spans: list[Span], page: int):
        self.spans  = spans
        self.page   = page
        self.text   = " ".join(s.text.strip() for s in spans if s.text.strip())
        self.norm   = _norm(self.text)
        # Dominant formatting: majority character weight
        total = sum(len(s.text) for s in spans) or 1
        self.bold   = sum(len(s.text) for s in spans if s.bold)   / total > 0.4
        self.italic = sum(len(s.text) for s in spans if s.italic) / total > 0.4
        self.size   = max((s.size for s in spans), default=0.0)
        self.y0     = min(s.y0 for s in spans) if spans else 0.0
        # Bounding box covering all spans on this line [x0, y0, x1, y1]
        self.bbox   = [
            min(s.x0 for s in spans) if spans else 0.0,
            min(s.y0 for s in spans) if spans else 0.0,
            max(s.x1 for s in spans) if spans else 0.0,
            max(s.y1 for s in spans) if spans else 0.0,
        ]


class Block:
    """
    A semantic block: one heading line + its body paragraph lines.
    This is the unit we align across documents.
    """
    def __init__(self, heading: Optional[Line], body: list[Line], page: int):
        self.heading = heading
        self.body    = body
        self.page    = page

        heading_text = heading.text if heading else ""
        body_text    = " ".join(l.text for l in body)
        self.text    = (heading_text + " " + body_text).strip()
        self.norm    = _norm(self.text)

        # Heading key for fast lookup (e.g. "part 1", "chapter 3")
        self.heading_key = _norm(heading_text)[:80] if heading_text else ""

    @property
    def all_lines(self) -> list[Line]:
        return ([self.heading] if self.heading else []) + self.body

    def __repr__(self):
        return f"Block(page={self.page}, heading={self.heading_key!r}, lines={len(self.body)})"


# ── PDF extraction ─────────────────────────────────────────────────────────────

def _is_bold(fontname: str) -> bool:
    fn = fontname.lower()
    return any(x in fn for x in ("bold", "black", "heavy", "demi", "semibold", "medium"))


def _is_italic(fontname: str) -> bool:
    fn = fontname.lower()
    return any(x in fn for x in ("italic", "oblique", "slant"))


def _extract_lines(
    pdf_bytes: bytes,
    page_start: int | None = None,
    page_end:   int | None = None,
) -> list[Line]:
    """
    Extract all text lines from a PDF using pdfminer's layout engine.
    page_start/page_end are 1-based inclusive — only those pages are processed.
    Returns lines in reading order with formatting metadata including bbox.
    """
    if not _PDFMINER_OK:
        raise RuntimeError("pdfminer.six is required: pip install pdfminer.six")

    assert LAParams is not None
    assert extract_pages is not None
    assert LTTextBox is not None
    assert LTTextLine is not None
    assert LTChar is not None
    assert LTAnno is not None

    laparams = LAParams(
        line_margin=0.3,
        word_margin=0.1,
        char_margin=2.0,
        boxes_flow=0.5,
        detect_vertical=False,
    )

    all_lines: list[Line] = []
    pdf_file = io.BytesIO(pdf_bytes)

    try:
        for page_num, page_layout in enumerate(
            extract_pages(pdf_file, laparams=laparams), start=1
        ):
            # Skip pages outside the requested range
            if page_start is not None and page_num < page_start:
                continue
            if page_end is not None and page_num > page_end:
                break
            # Collect text boxes sorted top→bottom, left→right
            textboxes: list[Any] = [
                el for el in page_layout
                if isinstance(el, LTTextBox)
            ]
            textboxes.sort(key=lambda b: (-b.y1, b.x0))

            for tbox in textboxes:
                for tline in getattr(tbox, "_objs", []):
                    if not isinstance(tline, LTTextLine):
                        continue

                    # Group chars into spans by font
                    spans: list[Span] = []
                    cur_text    = ""
                    cur_bold    = False
                    cur_italic  = False
                    cur_size    = 12.0
                    cur_x0      = 0.0
                    cur_y0      = tline.y0

                    for char in tline:
                        if isinstance(char, LTAnno):
                            cur_text += char.get_text()
                            continue
                        if not isinstance(char, LTChar):
                            continue

                        ch_text   = char.get_text()
                        ch_bold   = _is_bold(char.fontname)
                        ch_italic = _is_italic(char.fontname)
                        ch_size   = char.size

                        # Flush span when formatting changes
                        if cur_text and (ch_bold != cur_bold or ch_italic != cur_italic
                                         or abs(ch_size - cur_size) > 0.5):
                            spans.append(Span(
                                cur_text, cur_bold, cur_italic, cur_size,
                                page_num,
                                (cur_x0, cur_y0, char.x0, tline.y1),
                            ))
                            cur_text = ""
                            cur_x0   = char.x0

                        if not cur_text:
                            cur_x0   = char.x0
                            cur_bold   = ch_bold
                            cur_italic = ch_italic
                            cur_size   = ch_size

                        cur_text += ch_text

                    if cur_text.strip():
                        spans.append(Span(
                            cur_text, cur_bold, cur_italic, cur_size,
                            page_num,
                            (cur_x0, cur_y0, cur_x0 + len(cur_text)*cur_size*0.5, tline.y1),
                        ))

                    if not spans:
                        continue

                    line = Line(spans, page_num)
                    # Drop noise (page numbers, blank lines)
                    if line.text.strip() and not _NOISE_LINE.match(line.norm):
                        all_lines.append(line)

    except Exception as exc:
        logger.error("pdfminer extraction failed: %s", exc)
        raise

    logger.info("_extract_lines: extracted %d lines from PDF", len(all_lines))
    return all_lines


# ── Semantic block builder ─────────────────────────────────────────────────────

# Patterns that indicate a structural heading (real section boundaries)
_HEADING_RE = re.compile(
    r'^(?:'
    r'(?:part|chapter|section|article|schedule)\s+(?:\d+[a-z]?|[ivxlcdm]+)\b'
    r'|\d+[a-z]?\.\s+[a-z]'
    r'|\d+[a-z]?\s+[a-z][a-z\s]{3,}'
    r')',
    re.IGNORECASE,
)

# Lines that are noise regardless of content (running headers, page numbers, etc.)
_NOISE_LINE_RE = re.compile(
    r'^(?:'
    r'\d{1,4}'                          # bare page number
    r'|page\s+\d+'                      # "page 66"
    r'|(?:part|chapter|section)\s+\d+[a-z]?\s*[:–\-].*'  # "Part 10: Employment"
    r'|(?:part|chapter|section)\s+\d+[a-z]?\s+[A-Z][A-Z\s,;]{4,}'  # FIX Bug 6: running header "PART 2  EMPLOYMENT INCOME..."
    r'|(?:textual\s+amendments?)'        # "Textual Amendments"
    r'|(?:modifications?\s+etc)'        # "Modifications etc."
    r'|(?:commencement)'                # commencement info
    r'|(?:[FC]\d+(?:\s|$))'             # footnote/editorial markers: "F1", "F123 Words..."
    r')',
    re.IGNORECASE,
)

def _is_heading(line: Line, body_size: float) -> bool:
    """Heuristic: is this line a structural heading (section boundary)?"""
    # Noise lines are never headings
    if _NOISE_LINE_RE.match(line.norm):
        return False
    # Larger than body font
    if line.size > body_size + 0.5:
        return True
    # Matches structural section pattern
    if _HEADING_RE.match(line.norm):
        return True
    return False


def _build_blocks(lines: list[Line]) -> list[Block]:
    """
    Group lines into semantic blocks: heading + following body lines.
    Each block represents one logical section of the document.
    """
    if not lines:
        return []

    # Determine body font size (most common)
    size_counts: Counter = Counter()
    for l in lines:
        size_counts[l.size] += len(l.text)
    body_size = size_counts.most_common(1)[0][0] if size_counts else 12.0

    blocks: list[Block] = []
    current_heading: Optional[Line] = None
    current_body: list[Line] = []
    current_page = lines[0].page if lines else 1

    for line in lines:
        if _is_heading(line, body_size):
            # Flush previous block
            if current_heading or current_body:
                blocks.append(Block(current_heading, current_body, current_page))
            current_heading = line
            current_body    = []
            current_page    = line.page
        else:
            if not current_heading and not current_body:
                current_page = line.page
            current_body.append(line)

    # Flush last block
    if current_heading or current_body:
        blocks.append(Block(current_heading, current_body, current_page))

    logger.info("_build_blocks: built %d blocks from %d lines", len(blocks), len(lines))
    return blocks


# ── Content-aware block alignment ─────────────────────────────────────────────

def _trigram_sim(a: str, b: str) -> float:
    """Trigram Jaccard similarity — fast content similarity."""
    if not a and not b: return 1.0
    if not a or not b:  return 0.0
    ta = {a[i:i+3] for i in range(len(a)-2)} if len(a) >= 3 else {a}
    tb = {b[i:i+3] for i in range(len(b)-2)} if len(b) >= 3 else {b}
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def _align_blocks(
    old_blocks: list[Block],
    new_blocks: list[Block],
) -> list[tuple[Optional[Block], Optional[Block]]]:
    """
    Align old blocks to new blocks by content similarity.

    Strategy:
    1. Try heading-to-heading exact match first (fast, reliable for named sections)
    2. For unmatched blocks, use trigram similarity + monotone DP alignment
       (same algorithm as sequence alignment — ensures order is preserved)
    3. Unmatched old blocks → deletions; unmatched new blocks → insertions

    Pages are IGNORED — we match by content, not position.
    """
    n_old = len(old_blocks)
    n_new = len(new_blocks)

    # Step 1: heading-key exact match
    new_by_heading: dict[str, int] = {}
    for j, nb in enumerate(new_blocks):
        if nb.heading_key and nb.heading_key not in new_by_heading:
            new_by_heading[nb.heading_key] = j

    paired: dict[int, int] = {}   # old_idx → new_idx
    new_used: set[int] = set()

    for i, ob in enumerate(old_blocks):
        if ob.heading_key and ob.heading_key in new_by_heading:
            j = new_by_heading[ob.heading_key]
            if j not in new_used:
                paired[i] = j
                new_used.add(j)

    # Step 2: DP similarity alignment for unmatched blocks
    unpaired_old = [i for i in range(n_old) if i not in paired]
    unpaired_new = [j for j in range(n_new) if j not in new_used]

    if unpaired_old and unpaired_new:
        # Build similarity matrix for unmatched only
        sim = [
            [_trigram_sim(old_blocks[i].norm[:500], new_blocks[j].norm[:500])
             for j in unpaired_new]
            for i in unpaired_old
        ]

        no = len(unpaired_old)
        nn = len(unpaired_new)
        dp = [[0.0] * (nn+1) for _ in range(no+1)]
        for ii in range(1, no+1):
            for jj in range(1, nn+1):
                dp[ii][jj] = max(
                    dp[ii-1][jj-1] + sim[ii-1][jj-1],
                    dp[ii-1][jj],
                    dp[ii][jj-1],
                )

        # Traceback
        ii, jj = no, nn
        while ii > 0 and jj > 0:
            if dp[ii][jj] == dp[ii-1][jj-1] + sim[ii-1][jj-1]:
                if sim[ii-1][jj-1] > 0.40:  # FIX: raised from 0.22 — prevents cross-block pairings on loosely similar sections
                    i_orig = unpaired_old[ii-1]
                    j_orig = unpaired_new[jj-1]
                    paired[i_orig] = j_orig
                ii -= 1; jj -= 1
            elif dp[ii-1][jj] >= dp[ii][jj-1]:
                ii -= 1
            else:
                jj -= 1

    # Step 3: build final alignment list in document order
    all_new_used = set(paired.values())
    result: list[tuple[Optional[Block], Optional[Block]]] = []

    # Interleave matched and unmatched in a sensible order
    # Use old_idx order as the primary sort; insert new-only blocks by position
    old_processed: set[int] = set()
    new_processed: set[int] = set()

    # Build ordered pairs
    for i in range(n_old):
        if i in paired:
            j = paired[i]
            result.append((old_blocks[i], new_blocks[j]))
            old_processed.add(i)
            new_processed.add(j)
        else:
            result.append((old_blocks[i], None))   # deletion
            old_processed.add(i)

    # Append new-only blocks (insertions) at the end
    for j in range(n_new):
        if j not in new_processed:
            result.append((None, new_blocks[j]))   # insertion

    matched = sum(1 for ob, nb in result if ob and nb)
    logger.info(
        "_align_blocks: %d old + %d new → %d matched, %d old-only, %d new-only",
        n_old, n_new, matched,
        sum(1 for ob, nb in result if ob and not nb),
        sum(1 for ob, nb in result if not ob and nb),
    )
    return result


# ── Character-level diff on matched block pairs ────────────────────────────────

def _diff_blocks(
    old_block: Block,
    new_block: Block,
    change_id_start: int = 0,
) -> tuple[list[dict], dict]:
    """
    Character-level diff between two matched blocks.

    Returns (changes, summary) where each change is:
    {
        id, type, text, old_text, new_text,
        old_formatting, new_formatting,
        page, suggested_xml,
    }
    """
    changes: list[dict] = []
    summary = {"addition": 0, "removal": 0, "modification": 0, "emphasis": 0}
    cid = change_id_start

    # Filter noise lines before diffing:
    # - Running headers (repeat on every page: "Part 10: Employment Income")
    # - Footnote/editorial markers (F123, C2)
    # - Very short lines (page numbers, punctuation-only)
    # - "Textual Amendments", "Modifications etc." sections
    def _is_diff_noise(line: Line) -> bool:
        t = line.norm
        if len(t) <= 3:
            return True
        if _NOISE_LINE_RE.match(t):
            return True
        # Footnote/cross-ref markers like "F1234 Words substituted..."
        if re.match(r'^[fc]\d+(\s|$)', t, re.IGNORECASE):
            return True
        return False

    old_lines = [l for l in old_block.all_lines if not _is_diff_noise(l)]
    new_lines = [l for l in new_block.all_lines if not _is_diff_noise(l)]

    old_norms = [l.norm for l in old_lines]
    new_norms = [l.norm for l in new_lines]

    # Strip trailing conjunctions/connectors that are pure line-wrap artifacts.
    # "...used in this Act, and" == "...used in this Act," when "and" starts next line.
    _TRAIL = re.compile(r'[,;]?\s*\b(?:and|or|but|nor|yet|so|for)\s*$|[,;]\s*$', re.IGNORECASE)
    _LEAD  = re.compile(r'^\s*\b(?:and|or|but|nor)\b\s*', re.IGNORECASE)
    old_norms = [_TRAIL.sub('', _LEAD.sub('', n)).strip() for n in old_norms]
    new_norms = [_TRAIL.sub('', _LEAD.sub('', n)).strip() for n in new_norms]

    # Drop lines that became empty after stripping
    old_pairs = [(n, l) for n, l in zip(old_norms, old_lines) if n]
    new_pairs = [(n, l) for n, l in zip(new_norms, new_lines) if n]
    old_norms  = [p[0] for p in old_pairs]
    old_lines  = [p[1] for p in old_pairs]
    new_norms  = [p[0] for p in new_pairs]
    new_lines  = [p[1] for p in new_pairs]

    def _isjunk(s: str) -> bool:
        return len(s) <= 2

    matcher = difflib.SequenceMatcher(_isjunk, old_norms, new_norms, autojunk=False)

    def _fmt(line: Line) -> dict:
        return {"bold": line.bold, "italic": line.italic, "size": line.size}

    def _make(ctype: str, text: str, old_line: Optional[Line],
              new_line: Optional[Line]) -> dict:
        nonlocal cid
        cid += 1
        source_line = new_line if new_line is not None else old_line
        page = source_line.page if source_line is not None else None
        old_text = old_line.text.strip() if old_line else None
        new_text = new_line.text.strip() if new_line else None

        if ctype == "modification" and old_text and new_text:
            sug = f"<del>{old_text}</del><ins>{new_text}</ins>"
        elif ctype == "removal" and old_text:
            sug = f"<del>{old_text}</del>"
        elif ctype == "addition" and new_text:
            sug = f"<ins>{new_text}</ins>"
        else:
            sug = None

        return {
            "id":             f"chg_{cid:04d}",
            "type":           ctype,
            "text":           text,
            "old_text":       old_text,
            "new_text":       new_text,
            "old_formatting": _fmt(old_line) if old_line else None,
            "new_formatting": _fmt(new_line) if new_line else None,
            "page":           page,
            "old_page":       old_line.page if old_line else None,
            "new_page":       new_line.page if new_line else None,
            "bbox":           source_line.bbox if source_line is not None else None,
            "old_bbox":       old_line.bbox if old_line else None,
            "new_bbox":       new_line.bbox if new_line else None,
            "suggested_xml":  sug,
        }

    _PUNCT = str.maketrans("", "", ".,;: \t")

    for op, i1, i2, j1, j2 in matcher.get_opcodes():

        if op == "equal":
            # Check for emphasis-only changes
            for k in range(i2 - i1):
                ol = old_lines[i1 + k]
                nl = new_lines[j1 + k]
                if ol.bold != nl.bold or ol.italic != nl.italic:
                    changes.append(_make("emphasis", nl.text.strip(), ol, nl))
                    summary["emphasis"] += 1

        elif op == "insert":
            for k in range(j1, j2):
                nl = new_lines[k]
                changes.append(_make("addition", nl.text.strip(), None, nl))
                summary["addition"] += 1

        elif op == "delete":
            for k in range(i1, i2):
                ol = old_lines[k]
                changes.append(_make("removal", ol.text.strip(), ol, None))
                summary["removal"] += 1

        elif op == "replace":
            old_block_lines = old_lines[i1:i2]
            new_block_lines = new_lines[j1:j2]
            paired = min(len(old_block_lines), len(new_block_lines))

            for k in range(paired):
                ol = old_block_lines[k]
                nl = new_block_lines[k]

                # Punctuation-stripped equality check
                ol_core = ol.norm.translate(_PUNCT)
                nl_core = nl.norm.translate(_PUNCT)

                if ol_core == nl_core:
                    # Text identical — check formatting
                    if ol.bold != nl.bold or ol.italic != nl.italic:
                        changes.append(_make("emphasis", nl.text.strip(), ol, nl))
                        summary["emphasis"] += 1
                    continue

                ratio = difflib.SequenceMatcher(None, ol.norm, nl.norm).ratio()

                # Stricter modification threshold: 0.65 (was 0.5).
                # Blocks below this are too dissimilar to be "the same sentence
                # with edits" — they're different content that happens to share
                # some common words, which produces noisy false-positive mods.
                ctype = "modification" if ratio >= 0.65 else "addition"

                if ctype == "modification":
                    changes.append(_make("modification", nl.text.strip(), ol, nl))
                    summary["modification"] += 1
                else:
                    changes.append(_make("removal", ol.text.strip(), ol, None))
                    summary["removal"] += 1
                    changes.append(_make("addition", nl.text.strip(), None, nl))
                    summary["addition"] += 1

            for ol in old_block_lines[paired:]:
                changes.append(_make("removal", ol.text.strip(), ol, None))
                summary["removal"] += 1

            for nl in new_block_lines[paired:]:
                changes.append(_make("addition", nl.text.strip(), None, nl))
                summary["addition"] += 1

    return changes, summary


# ── Public API ─────────────────────────────────────────────────────────────────

def compare_pdfs_layout(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes = b"",
    old_page_start: int | None = None,
    old_page_end:   int | None = None,
    new_page_start: int | None = None,
    new_page_end:   int | None = None,
) -> dict:
    """
    Compare two PDFs using pdfminer layout extraction + content-aware alignment.

    Pass old_page_start/end and new_page_start/end to scope extraction to a
    specific chunk's pages — avoids re-extracting the full 767-page document
    every time a chunk is opened.

    Returns the same shape as detect_pdf_changes so it's a drop-in replacement:
    {
        "changes":               list[dict],   # each has bbox: [x0,y0,x1,y1]
        "summary":               {"addition", "removal", "modification", "emphasis"},
        "blocks_matched":        int,
        "blocks_unmatched_old":  int,
        "blocks_unmatched_new":  int,
        "xml_content":           str,
    }
    """
    if not _PDFMINER_OK:
        raise RuntimeError("pdfminer.six not installed: pip install pdfminer.six")

    # 1. Extract lines — scoped to page range when provided
    logger.info("compare_pdfs_layout: extracting OLD PDF pp.%s-%s",
                old_page_start, old_page_end)
    old_lines = _extract_lines(old_pdf_bytes,
                               page_start=old_page_start, page_end=old_page_end)
    logger.info("compare_pdfs_layout: extracting NEW PDF pp.%s-%s",
                new_page_start, new_page_end)
    new_lines = _extract_lines(new_pdf_bytes,
                               page_start=new_page_start, page_end=new_page_end)

    # 2. Build semantic blocks
    old_blocks = _build_blocks(old_lines)
    new_blocks  = _build_blocks(new_lines)

    # 3. Align blocks by content (NOT by page)
    aligned = _align_blocks(old_blocks, new_blocks)

    # 4. Diff each matched pair
    all_changes: list[dict] = []
    total_summary = {"addition": 0, "removal": 0, "modification": 0, "emphasis": 0}
    cid = 0

    blocks_matched       = 0
    blocks_unmatched_old = 0
    blocks_unmatched_new = 0

    for old_block, new_block in aligned:
        if old_block and new_block:
            # Matched pair — diff them
            changes, summary = _diff_blocks(old_block, new_block, cid)
            all_changes.extend(changes)
            for k in total_summary:
                total_summary[k] += summary.get(k, 0)
            cid += len(changes)
            blocks_matched += 1

        elif old_block and not new_block:
            # Block only in old → entire block removed
            for line in old_block.all_lines:
                if line.text.strip():
                    cid += 1
                    all_changes.append({
                        "id":             f"chg_{cid:04d}",
                        "type":           "removal",
                        "text":           line.text.strip(),
                        "old_text":       line.text.strip(),
                        "new_text":       None,
                        "old_formatting": {"bold": line.bold, "italic": line.italic, "size": line.size},
                        "new_formatting": None,
                        "page":           line.page,
                        "suggested_xml":  f"<del>{line.text.strip()}</del>",
                    })
                    total_summary["removal"] += 1
            blocks_unmatched_old += 1

        elif not old_block and new_block:
            # Block only in new → entire block added
            for line in new_block.all_lines:
                if line.text.strip():
                    cid += 1
                    all_changes.append({
                        "id":             f"chg_{cid:04d}",
                        "type":           "addition",
                        "text":           line.text.strip(),
                        "old_text":       None,
                        "new_text":       line.text.strip(),
                        "old_formatting": None,
                        "new_formatting": {"bold": line.bold, "italic": line.italic, "size": line.size},
                        "page":           line.page,
                        "suggested_xml":  f"<ins>{line.text.strip()}</ins>",
                    })
                    total_summary["addition"] += 1
            blocks_unmatched_new += 1

    # 5. Post-process: remove duplicate changes and trivially short texts
    #    Duplicates arise when two aligned blocks produce the same text diff.
    #    Short texts (≤4 chars) are almost always page numbers / noise.
    seen_keys: set[str] = set()
    deduped: list[dict] = []
    for chg in all_changes:
        # Deduplicate by (type, normalised text)
        key = f"{chg['type']}|{_norm(chg.get('old_text') or chg.get('text') or '')[:80]}"
        # Skip trivially short changes — near-certainly noise
        text_len = len((chg.get('old_text') or chg.get('new_text') or chg.get('text') or "").strip())
        if text_len <= 4:
            continue
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(chg)
    all_changes = deduped

    # 6. Decode XML if provided
    xml_content = ""
    if xml_bytes:
        try:
            xml_content = xml_bytes.decode("utf-8")
        except Exception:
            pass

    logger.info(
        "compare_pdfs_layout: %d changes | matched=%d unmatched_old=%d unmatched_new=%d",
        len(all_changes), blocks_matched, blocks_unmatched_old, blocks_unmatched_new,
    )

    return {
        "changes":               all_changes,
        "summary":               total_summary,
        "blocks_matched":        blocks_matched,
        "blocks_unmatched_old":  blocks_unmatched_old,
        "blocks_unmatched_new":  blocks_unmatched_new,
        "xml_content":           xml_content,
    }