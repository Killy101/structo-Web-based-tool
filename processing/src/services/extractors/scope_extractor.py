"""
src/services/extractors/scope_extractor.py
Extracts the scope table from a BRD .docx file.

Handles the following known layouts:
  - Standard 4–6 col scope table (CFR Title 12 pattern): scope IS the first table,
    no pre-header context block, 1 header row + N data rows.
  - Extended-col + pre-header context (KR_NARK pattern): a 2-col mini-table sitting
    above the scope table carries the global Issuing Authority and ASRB ID; the real
    scope table follows as the next table in the document.
  - Legacy paragraph-based BRDs: scope is listed as plain paragraphs under a
    "Scope" heading with no table at all.

Table-selection strategy
------------------------
Instead of using a single boolean "does this look like a header?", every table in the
document is now *scored*.  The highest-scoring table wins.  This prevents the
pre-header mini-table (which contains "Issuing Authority" / "ASRB ID" labels that
were previously matching the header-label set) from being selected over the real
scope table.

Score contributions
  +20  first row contains a URL-type column keyword (reference url, content url, …)
  +20  first row contains a title column keyword (document title, source name)
  +30  bonus when BOTH of the above are true
  +5   per data row that contains a URL (rewards large tables)
  −50  table has fewer than 3 columns (kills the 2-col pre-header mini-table)
  −10  table has only 1 data row after the header (small, likely a stub)
"""

import re
from .base import extract_url_from_cell


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

_URL_COL_KEYWORDS: list[str] = [
    "reference url", "content url", "reference link",
    "parent url", "regulator url", "regulator weblink",
    "url for the title", "url for the source",
]

_TITLE_COL_KEYWORDS: list[str] = [
    "document title", "source name",
]

# First-run labels that unambiguously mark a row as a header row (not data).
# Used by _row_is_header() to skip header rows when scanning for data start.
_HEADER_FIRST_RUN_LABELS: frozenset[str] = frozenset({
    "document title", "reference url", "content url", "reference link",
    "parent url", "regulator url", "regulator weblink",
    "issuing authority", "asrb id", "sme comments", "sme checkpoint",
    "date of ingestion", "initial evergreen", "initial/evergreen",
    "initial/ evergreen",           # variant with space after slash (KR_NARK)
    "source name", "url for the title", "url for the source",
    "innodata only",
})

_BOILERPLATE_MARKERS: list[str] = [
    "innodata only", "document title as appearing", "appearing on regulator",
    "sme check", "if anything needs", "click any cell", "sorting order",
    "toc -", "*toc", "template", "example", "rolling cycle",
    "ecfr is updated", "electronic code of federal", "officially maintained",
    "smes to check", "check if weblink", "up-to-date on a rolling",
    "url for the title", "url for the source", "parent url for the source",
]

_URL_RE = re.compile(r"https?://")
_ASRB_RE = re.compile(r"ASRB\d+")


# ─────────────────────────────────────────────────────────────────────────────
# Low-level cell helpers
# ─────────────────────────────────────────────────────────────────────────────

def _cell_is_strikethrough(cell) -> bool:
    """True if every non-blank run in the cell has strikethrough formatting."""
    strike_runs = total_runs = 0
    for para in cell.paragraphs:
        for run in para.runs:
            if not run.text.strip():
                continue
            total_runs += 1
            if run.font.strike:
                strike_runs += 1
    return total_runs > 0 and strike_runs == total_runs


def _get_first_run_text(cell) -> str:
    """Return the lowercased text of the very first non-empty run in a cell."""
    for para in cell.paragraphs:
        for run in para.runs:
            t = run.text.strip().lower()
            if t:
                return t
    return cell.text.strip().lower()


def _row_is_header(row) -> bool:
    """
    True when the first non-empty run of col-0 is a known header label.

    BRD scope tables always start the header row with a short label in the
    first run of the first cell (e.g. "Document title", "Reference URL").
    Data cells never start with these exact labels.
    """
    if not row.cells:
        return False
    first = _get_first_run_text(row.cells[0])
    return first in _HEADER_FIRST_RUN_LABELS


# ─────────────────────────────────────────────────────────────────────────────
# Table scoring & selection
# ─────────────────────────────────────────────────────────────────────────────

def _score_table(table) -> int:
    """
    Return a numeric score representing how likely this table is the scope table.

    Higher is better; negative scores mean "definitely not the scope table".
    """
    if not table.rows:
        return -999

    row0_cells = table.rows[0].cells
    ncols = len(row0_cells)
    nrows = len(table.rows)

    # Combine all header-row cell text for keyword scanning
    all_header_text = " ".join(c.text.lower().strip() for c in row0_cells)

    score = 0

    # ── column-composition signals ────────────────────────────────────────
    has_url_col   = any(kw in all_header_text for kw in _URL_COL_KEYWORDS)
    has_title_col = any(kw in all_header_text for kw in _TITLE_COL_KEYWORDS)

    if has_url_col:
        score += 20
    if has_title_col:
        score += 20
    if has_url_col and has_title_col:
        score += 30  # strong bonus for co-presence

    # ── structural signals ────────────────────────────────────────────────
    if ncols < 3:
        # Pre-header mini-tables (Issuing Authority / ASRB ID) are always 2-col.
        # Any 2-col table is almost certainly not the scope table.
        score -= 50

    if nrows == 2:
        # Only 1 data row — could be a stub scope table (CFR Title 12 has exactly
        # this), so don't penalise heavily; just a mild nudge downward vs larger
        # tables.  We rely on the +70 col-keyword bonus to lift it above noise.
        score -= 5
    elif nrows < 3:
        score -= 10

    # ── data-quality signal ───────────────────────────────────────────────
    # Reward every data row that contains an actual URL.
    url_rows = sum(
        1 for row in table.rows
        if _URL_RE.search(" ".join(c.text for c in row.cells))
    )
    score += url_rows * 5

    return score


def _find_scope_table(doc):
    """
    Return the table that is most likely the scope table, using _score_table().

    Returns None if no table scores above 0.  A score > 0 requires at minimum
    that the first row contains at least one URL-type column keyword AND at
    least one title-type column keyword (with a combined bonus of +70).  Any
    table that cannot clear that bar — such as a metadata key/value table,
    a version-history table, or a citation-rules table — scores ≤ 0 and is
    ignored, which causes the caller to fall through to the legacy paragraph
    extractor instead.

    Do NOT add a URL-density fallback here.  A metadata table that happens to
    contain one URL in a "Content URI" row would be incorrectly selected,
    turning metadata rows into fake scope entries.
    """
    best_table = None
    best_score = 0  # require strictly positive score

    for table in doc.tables:
        s = _score_table(table)
        if s > best_score:
            best_score = s
            best_table = table

    return best_table  # None when no table scores > 0 (routes to legacy extractor)


# Keep the old name as an alias so any external callers don't break.
_detect_scope_table = _find_scope_table


# ─────────────────────────────────────────────────────────────────────────────
# Pre-header context detection
# ─────────────────────────────────────────────────────────────────────────────

def _detect_pre_header_context(doc, scope_table) -> dict:
    """
    Some BRDs put a mini-table *above* the scope table with a global
    Issuing Authority and ASRB ID that applies to every row in the scope table.

    Returns {"issuing_authority": str, "asrb_id": str}.  Both may be "".
    """
    context = {"issuing_authority": "", "asrb_id": ""}
    scope_el = scope_table._tbl

    for block in doc.element.body:
        tag = block.tag.split("}")[-1] if "}" in block.tag else block.tag
        if tag == "tbl":
            if block is scope_el:
                break  # stop once we reach the scope table itself
            from docx.table import Table as DocxTable
            t = DocxTable(block, doc)
            all_text = " ".join(c.text for row in t.rows for c in row.cells)

            # Only examine tables that look like the pre-header context block
            if "ASRB" not in all_text or "issuing" not in all_text.lower():
                continue

            for row in t.rows:
                cells = [c.text.strip() for c in row.cells]
                row_text = " ".join(cells).lower()

                # Skip the header row and instruction rows
                if "issuing authority" in row_text and "asrb id" in row_text:
                    continue
                if "innodata to capture" in row_text:
                    continue

                if len(cells) >= 2:
                    auth = cells[0]
                    if auth and not any(
                        kw in auth.lower()
                        for kw in ["issuing", "innodata", "note", "asrb", "sme"]
                    ):
                        context["issuing_authority"] = auth.strip()

                    asrb_match = _ASRB_RE.search(cells[1])
                    if asrb_match:
                        context["asrb_id"] = asrb_match.group(0)

    return context


# ─────────────────────────────────────────────────────────────────────────────
# Column-map detection
# ─────────────────────────────────────────────────────────────────────────────

def _detect_column_map(header_rows: list) -> dict:
    """Auto-detect column positions from the header rows using keyword rules."""
    col_texts: dict[int, str] = {}
    for row in header_rows:
        for ci, cell in enumerate(row.cells):
            col_texts[ci] = col_texts.get(ci, "") + " " + cell.text.lower().strip()

    col_map: dict[str, int | None] = {
        "title":            None,
        "ref_url":          None,
        "content_url":      None,
        "authority":        None,
        "asrb_id":          None,
        "sme":              None,
        "initial_evergreen": None,
        "date_of_ingestion": None,
    }

    # Order matters: more-specific rules must come before catch-all ones.
    keyword_rules: list[tuple[str, list[str]]] = [
        ("title",             ["document title", "innodata only", "title as appearing", "source name"]),
        ("ref_url",           ["reference url", "reference link", "parent url",
                               "regulator weblink", "regulator url"]),
        ("content_url",       ["content url", "url for the title", "content link",
                               "url for the source"]),
        ("authority",         ["issuing authority", "innodata to capture"]),
        ("initial_evergreen", ["initial/\nevergreen", "initial/ evergreen",
                               "initial evergreen", "evergreen"]),
        ("date_of_ingestion", ["date of ingestion", "ingestion date"]),
        ("asrb_id",           ["asrb id", "asrb\n", "asrb "]),
        ("sme",               ["sme comments", "sme checkpoint"]),
    ]

    assigned: set[int] = set()
    for field, keywords in keyword_rules:
        for ci, text in sorted(col_texts.items()):
            if ci in assigned:
                continue
            if any(kw in text for kw in keywords):
                col_map[field] = ci
                assigned.add(ci)
                break

    # Positional fallbacks for the six core fields when keyword matching fails
    assigned_positions = {v for v in col_map.values() if v is not None}
    for pos, field in enumerate(["title", "ref_url", "content_url", "authority", "asrb_id", "sme"]):
        if col_map[field] is None and pos not in assigned_positions:
            col_map[field] = pos
            assigned_positions.add(pos)

    return col_map


# ─────────────────────────────────────────────────────────────────────────────
# Data-start row detection
# ─────────────────────────────────────────────────────────────────────────────

def _find_data_start_row(table, col_map: dict) -> int:
    """
    Return the index of the first genuine data row.

    Skips header rows (detected via first-run label matching) and any
    boilerplate / instruction rows that follow the header.
    """
    title_col   = col_map.get("title", 0)
    content_col = col_map.get("content_url", 2)
    ref_col     = col_map.get("ref_url", 1)
    first_candidate: int | None = None

    for ri, row in enumerate(table.rows):
        cells = row.cells
        n = len(cells)

        # Skip header rows
        if _row_is_header(row):
            continue

        title_text   = cells[title_col].text.strip()   if title_col is not None and title_col < n else ""
        content_text = cells[content_col].text.strip() if content_col is not None and content_col < n else ""
        ref_text     = cells[ref_col].text.strip()     if ref_col is not None and ref_col < n else ""
        title_lower  = title_text.lower()

        # Skip boilerplate rows
        if any(m in title_lower for m in _BOILERPLATE_MARKERS):
            continue

        # Skip rows whose title cell starts with "*"
        if title_lower.strip().startswith("*"):
            continue

        # Skip long prose rows with no URL (instruction text, not document titles)
        has_url = bool(_URL_RE.search(content_text) or _URL_RE.search(ref_text))
        if not has_url and len(title_lower) > 80:
            continue

        if has_url:
            return ri  # definite data row

        if first_candidate is None and title_text:
            first_candidate = ri

    return first_candidate if first_candidate is not None else len(table.rows)


# ─────────────────────────────────────────────────────────────────────────────
# Non-data row filter
# ─────────────────────────────────────────────────────────────────────────────

def _normalise(text: str) -> str:
    """Normalise typography so markers match regardless of dash/quote variant."""
    s = re.sub(r"[‐‑‒–—−]+", "-", text.lower())
    s = re.sub(r"[\u2018\u2019\u201c\u201d]", "'", s)
    return re.sub(r"\s+", " ", s).strip()


_NON_DATA_MARKERS: list[str] = [
    *_BOILERPLATE_MARKERS,
    "sme check-point", "sme checkpoint",
    "if anything needs be changed",
    "click any cell", "hover row", "sorting order",
    "toc - sorting order", "*toc - sorting order",
    "document title as appearing on regulator weblink",
    "url for the title under the source",
    "checkpoint", "appearing on regulator weblink",
]


def _is_non_data_scope_row(
    doc_title: str,
    ref_url: str,
    content_url: str,
    sme_comments: str,
) -> bool:
    """Return True for template / instruction rows that are not real documents."""
    title_n = _normalise(doc_title or "")
    sme_n   = _normalise(sme_comments or "")
    has_url = bool((ref_url or "").strip() or (content_url or "").strip())

    if not title_n and not has_url:
        return True

    if any(m in title_n for m in _NON_DATA_MARKERS):
        return True
    if any(m in sme_n for m in _NON_DATA_MARKERS):
        return True
    if re.match(r"^\*", title_n.strip()):
        return True
    if re.search(r"\bsme\s*check[-\s]*point\b", title_n):
        return True
    if re.search(r"\btoc\s*[-\s]*sorting\s*order\b", title_n):
        return True
    if re.search(r"\bif\s+anything\s+needs\s+be\s+changed\b", title_n):
        return True
    if re.search(r"\bclick\s+any\s+cell\s+to\s+edit\b", title_n):
        return True
    if not has_url and len(title_n) > 80:
        return True

    return False


# ─────────────────────────────────────────────────────────────────────────────
# Legacy-format detection
# ─────────────────────────────────────────────────────────────────────────────

def _is_legacy_format(doc) -> bool:
    """
    True only when the document has a Scope heading but NO scope table.
    (Older BRDs listed scope documents as plain paragraphs.)
    """
    has_scope_heading = any(
        p.style and p.style.name.startswith("Heading") and "scope" in p.text.lower()
        for p in doc.paragraphs
    )
    has_scope_table = _find_scope_table(doc) is not None
    return has_scope_heading and not has_scope_table


# ─────────────────────────────────────────────────────────────────────────────
# Public extractor
# ─────────────────────────────────────────────────────────────────────────────

def extract_scope(doc) -> dict:
    """
    Extract the scope table from *doc* (a python-docx Document).

    Returns:
        {
            "in_scope":     [entry, …],   # active (non-struck) documents
            "out_of_scope": [entry, …],   # struck-through documents
            "summary":      str,
        }

    Each entry is a dict with keys:
        document_title, regulator_url, content_url,
        issuing_authority, issuing_authority_code, geography,
        asrb_id, sme_comments, initial_evergreen, date_of_ingestion,
        strikethrough.

    Falls back to extract_scope_legacy() for paragraph-based legacy BRDs.
    """
    if _is_legacy_format(doc):
        return extract_scope_legacy(doc)

    scope_table = _find_scope_table(doc)
    if scope_table is None:
        return {"in_scope": [], "out_of_scope": [], "summary": "Scope table not found."}

    # Pull global authority / ASRB from a pre-header context block if present
    pre_ctx     = _detect_pre_header_context(doc, scope_table)
    global_auth = pre_ctx["issuing_authority"]
    global_asrb = pre_ctx["asrb_id"]

    total_rows  = len(scope_table.rows)
    header_rows = scope_table.rows[: min(4, total_rows)]
    col_map     = _detect_column_map(header_rows)
    data_start  = _find_data_start_row(scope_table, col_map)

    # ── cell-reading helpers ──────────────────────────────────────────────

    def safe_text(row_cells, col_idx: int | None) -> str:
        if col_idx is None or col_idx >= len(row_cells):
            return ""
        return row_cells[col_idx].text.strip().replace("\xa0", " ")

    def safe_url(row_cells, col_idx: int | None) -> str:
        if col_idx is None or col_idx >= len(row_cells):
            return ""
        return extract_url_from_cell(row_cells[col_idx])

    # ── authority parsing ─────────────────────────────────────────────────
    _auth_re = re.compile(r"^(.*?)\s*\(([^)]+)\)\s*/\s*(.+)$")

    def parse_authority(raw: str) -> tuple[str, str, str]:
        """Split "Name (CODE) / Geography" into its three components."""
        m = _auth_re.match(raw)
        if m:
            return m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
        return raw, "", ""

    # ── iterate data rows ─────────────────────────────────────────────────
    all_entries: list[dict] = []

    for row in scope_table.rows[data_start:]:
        cells = row.cells

        doc_title    = safe_text(cells, col_map["title"])
        ref_url      = safe_url(cells,  col_map["ref_url"])
        content_url  = safe_url(cells,  col_map["content_url"])
        issuing_raw  = safe_text(cells, col_map["authority"]).replace("\n", " ") or global_auth
        asrb_raw     = safe_text(cells, col_map["asrb_id"])
        asrb_match   = _ASRB_RE.search(asrb_raw)
        asrb_id      = asrb_match.group(0) if asrb_match else global_asrb
        sme_comments = safe_text(cells, col_map["sme"])
        initial_ev   = safe_text(cells, col_map.get("initial_evergreen"))
        date_ing     = safe_text(cells, col_map.get("date_of_ingestion"))

        if _is_non_data_scope_row(doc_title, ref_url, content_url, sme_comments):
            continue

        auth_name, auth_code, geography = parse_authority(issuing_raw)

        is_struck = (
            col_map["title"] is not None
            and col_map["title"] < len(cells)
            and _cell_is_strikethrough(cells[col_map["title"]])
        )

        all_entries.append({
            "document_title":         doc_title,
            "regulator_url":          ref_url,
            "content_url":            content_url,
            "issuing_authority":      auth_name,
            "issuing_authority_code": auth_code,
            "geography":              geography,
            "asrb_id":                asrb_id,
            "sme_comments":           sme_comments,
            "initial_evergreen":      initial_ev,
            "date_of_ingestion":      date_ing,
            "strikethrough":          is_struck,
        })

    active = [e for e in all_entries if not e["strikethrough"]]
    struck = [e for e in all_entries if     e["strikethrough"]]

    return {
        "in_scope":     active,
        "out_of_scope": struck,
        "summary": (
            f"Scope covers {len(active)} active and "
            f"{len(struck)} struck-through documents."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Legacy extractor (paragraph-based format)
# ─────────────────────────────────────────────────────────────────────────────

def _legacy_paragraphs_in_section(doc, start_heading: str, stop_headings: list[str]):
    """Yield paragraphs under *start_heading* until the next heading in *stop_headings*."""
    collecting = False
    stop_lower = [s.lower() for s in stop_headings]
    for p in doc.paragraphs:
        style     = p.style.name if p.style else ""
        is_heading = style.startswith("Heading")
        text_lower = p.text.strip().lower()
        if is_heading and start_heading.lower() in text_lower:
            collecting = True
            continue
        if collecting:
            if is_heading and any(s in text_lower for s in stop_lower):
                break
            yield p


def extract_scope_legacy(doc) -> dict:
    """
    Legacy BRDs list scope as plain paragraphs under a Heading 2 "Scope" section.

    Two supported layouts:
      A) Simple list — each entry is just a title string, no per-entry URL.
         The Source section URL becomes the shared ref_url for every row.
         content_url is left blank.

      B) Title + URL pairs (Delaware / similar) — the Scope section alternates:
             <title text>
             <specific content URL for that title>
             <title text>
             <specific content URL for that title>
             ...
         In this layout the Source URL becomes the shared ref_url (the root
         reference link), and each per-title URL becomes content_url.

    The parser detects layout B automatically: if the paragraph immediately
    following a title is a bare URL it is treated as the content_url for that
    title rather than as a title itself.

    Output shape is identical to extract_scope().
    """
    url_re = re.compile(r"https?://\S+")

    # ── Grab the shared reference URL from the Source section ─────────────────
    ref_url = ""
    for p in _legacy_paragraphs_in_section(
        doc, "Source", ["Scope", "How to Identify", "Document Structure"]
    ):
        m = url_re.search(p.text)
        if m:
            ref_url = m.group(0).rstrip(".,;")
            break

    # ── Collect raw paragraphs from the Scope section ─────────────────────────
    intro_prefixes = ("the following",)
    raw_paras: list[str] = []
    for p in _legacy_paragraphs_in_section(
        doc, "Scope", ["How to Identify", "Document Structure", "Metadata", "References"]
    ):
        text = p.text.replace("\xa0", " ").strip()
        if not text:
            continue
        if any(text.lower().startswith(pfx) for pfx in intro_prefixes):
            continue
        raw_paras.append(text)

    # ── Build entries ──────────────────────────────────────────────────────────
    def _is_url(text: str) -> bool:
        return bool(url_re.match(text))

    in_scope: list[dict] = []
    seen: set[str] = set()

    i = 0
    while i < len(raw_paras):
        text = raw_paras[i]

        # A bare URL without a preceding title — skip it
        if _is_url(text):
            i += 1
            continue

        title = text
        content_url = ""

        # Layout B: next paragraph is the per-title content URL
        if i + 1 < len(raw_paras) and _is_url(raw_paras[i + 1]):
            content_url = raw_paras[i + 1].rstrip(".,;")
            i += 2
        else:
            i += 1

        if title in seen:
            continue
        seen.add(title)

        in_scope.append({
            "document_title":         title,
            "regulator_url":          ref_url,     # shared Source URL → Reference Link
            "content_url":            content_url, # per-title URL → Content URL
            "issuing_authority":      "",
            "issuing_authority_code": "",
            "geography":              "",
            "asrb_id":                "",
            "sme_comments":           "",
            "initial_evergreen":      "",
            "date_of_ingestion":      "",
            "strikethrough":          False,
        })

    return {
        "in_scope":     in_scope,
        "out_of_scope": [],
        "summary": (
            f"Scope covers {len(in_scope)} active documents "
            f"(legacy paragraph format)."
        ),
    }