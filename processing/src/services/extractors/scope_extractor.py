"""
src/services/extractors/scope_extractor.py
Extracts the scope table from a BRD .docx file.
Handles standard 6-col, extended-col (KR), and pre-header mini-table layouts.
"""

import re
from .base import extract_url_from_cell


# ─────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────

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


def _detect_scope_table(doc):
    """
    Identify the main scope table by scoring each table.
    Heavily weights URL-containing rows; penalises tiny pre-header tables (≤4 rows).
    """
    url_re = re.compile(r"https?://")
    best_table, best_score = None, 0

    for table in doc.tables:
        all_text = " ".join(c.text for row in table.rows for c in row.cells)
        n_rows = len(table.rows)
        n_cols = len(table.columns) if table.columns else 1
        url_rows = sum(
            1 for row in table.rows
            if url_re.search(" ".join(c.text for c in row.cells))
        )

        score = url_rows * 5 + n_rows + n_cols
        if "ASRB" in all_text:
            score += 3
        if any(kw in all_text.lower() for kw in
               ["document title", "content url", "reference url", "reference link"]):
            score += 5
        if n_rows <= 4:
            score -= 20

        if score > best_score:
            best_score = score
            best_table = table

    return best_table if best_score > 0 else None


def _detect_pre_header_context(doc, scope_table) -> dict:
    """
    Some BRDs (e.g. Korean) put a mini-table above the scope table
    with a global Issuing Authority and ASRB ID for all rows.
    """
    context = {"issuing_authority": "", "asrb_id": ""}
    scope_el = scope_table._tbl
    asrb_re = re.compile(r"ASRB\d+")

    for block in doc.element.body:
        tag = block.tag.split("}")[-1] if "}" in block.tag else block.tag
        if tag == "tbl":
            if block is scope_el:
                break
            from docx.table import Table
            t = Table(block, doc)
            all_text = " ".join(c.text for row in t.rows for c in row.cells)
            if "ASRB" not in all_text or "issuing" not in all_text.lower():
                continue
            for row in t.rows:
                cells = [c.text.strip() for c in row.cells]
                row_text = " ".join(cells).lower()
                if "issuing authority" in row_text and "asrb id" in row_text:
                    continue
                if "innodata to capture" in row_text:
                    continue
                if len(cells) >= 2:
                    auth = cells[0]
                    if auth and not any(kw in auth.lower() for kw in
                                        ["issuing", "innodata", "note", "asrb", "sme"]):
                        context["issuing_authority"] = auth.strip()
                    asrb_match = asrb_re.search(cells[1])
                    if asrb_match:
                        context["asrb_id"] = asrb_match.group(0)

    return context


def _detect_column_map(header_rows: list) -> dict:
    """Auto-detect column positions from header rows using keyword rules."""
    col_texts: dict[int, str] = {}
    for row in header_rows:
        for ci, cell in enumerate(row.cells):
            col_texts[ci] = col_texts.get(ci, "") + " " + cell.text.lower().strip()

    col_map = {
        "title": None, "ref_url": None, "content_url": None,
        "authority": None, "asrb_id": None, "sme": None,
        "initial_evergreen": None, "date_of_ingestion": None,
    }

    keyword_rules = [
        ("title",             ["document title", "innodata only", "title as appearing", "source name"]),
        ("ref_url",           ["reference url", "reference link", "parent url", "regulator weblink", "regulator url"]),
        ("content_url",       ["content url", "url for the title", "content link", "url for the source"]),
        ("authority",         ["issuing authority", "innodata to capture"]),
        ("initial_evergreen", ["initial/\nevergreen", "initial evergreen", "evergreen"]),
        ("date_of_ingestion", ["date of ingestion", "ingestion date"]),
        ("asrb_id",           ["asrb id", "asrb\n", "asrb "]),
        ("sme",               ["sme comments", "sme checkpoint"]),
    ]

    assigned = set()
    for field, keywords in keyword_rules:
        for ci, text in sorted(col_texts.items()):
            if ci in assigned:
                continue
            if any(kw in text for kw in keywords):
                col_map[field] = ci
                assigned.add(ci)
                break

    # Positional fallbacks for core fields
    assigned_positions = set(v for v in col_map.values() if v is not None)
    for pos, field in enumerate(["title", "ref_url", "content_url", "authority", "asrb_id", "sme"]):
        if col_map[field] is None and pos not in assigned_positions:
            col_map[field] = pos
            assigned_positions.add(pos)

    return col_map


def _find_data_start_row(table, col_map: dict) -> int:
    """Return the index of the first data row (skipping header rows)."""
    header_keywords = {
        "document title", "innodata", "content url", "issuing", "asrb",
        "sme", "reference", "parent url", "url for", "authority", "checkpoint",
        "configuration", "regulator", "category", "appearing", "capture",
        "scoping document", "note - to be used", "source name", "source",
    }
    url_re = re.compile(r"https?://")
    title_col   = col_map.get("title", 0)
    content_col = col_map.get("content_url", 2)
    ref_col     = col_map.get("ref_url", 1)

    for ri, row in enumerate(table.rows):
        cells = row.cells
        n = len(cells)
        title_text   = cells[title_col].text.strip().lower()  if title_col is not None and title_col < n else ""
        content_text = cells[content_col].text.strip()        if content_col is not None and content_col < n else ""
        ref_text     = cells[ref_col].text.strip()            if ref_col is not None and ref_col < n else ""

        if url_re.search(content_text) or url_re.search(ref_text):
            return ri
        if title_text and not any(kw in title_text for kw in header_keywords):
            return ri

    return len(table.rows)


# ─────────────────────────────────────────────
# Public extractor
# ─────────────────────────────────────────────

def extract_scope(doc) -> dict:
    """
    Extract the scope table from the document.
    Returns in_scope entries, out_of_scope (struck-through), and a summary string.
    """
    scope_table = _detect_scope_table(doc)
    if scope_table is None:
        return {"in_scope": [], "out_of_scope": [], "summary": "Scope table not found."}

    pre_ctx     = _detect_pre_header_context(doc, scope_table)
    global_auth = pre_ctx["issuing_authority"]
    global_asrb = pre_ctx["asrb_id"]

    total_rows  = len(scope_table.rows)
    header_rows = scope_table.rows[:min(4, total_rows)]
    col_map     = _detect_column_map(header_rows)
    data_start  = _find_data_start_row(scope_table, col_map)

    def safe_text(row_cells, col_idx) -> str:
        if col_idx is None or col_idx >= len(row_cells):
            return ""
        return row_cells[col_idx].text.strip().replace("\xa0", " ")

    def safe_url(row_cells, col_idx) -> str:
        if col_idx is None or col_idx >= len(row_cells):
            return ""
        return extract_url_from_cell(row_cells[col_idx])

    all_entries = []
    for row in scope_table.rows[data_start:]:
        cells = row.cells

        doc_title    = safe_text(cells, col_map["title"])
        ref_url      = safe_url(cells,  col_map["ref_url"])
        content_url  = safe_url(cells,  col_map["content_url"])
        issuing_auth = safe_text(cells, col_map["authority"]).replace("\n", " ") or global_auth
        asrb_raw     = safe_text(cells, col_map["asrb_id"])
        asrb_match   = re.search(r"ASRB\d+", asrb_raw)
        asrb_id      = asrb_match.group(0) if asrb_match else global_asrb
        sme_comments = safe_text(cells, col_map["sme"])
        initial_ev   = safe_text(cells, col_map.get("initial_evergreen"))
        date_ing     = safe_text(cells, col_map.get("date_of_ingestion"))

        if not doc_title and not content_url:
            continue

        auth_match = re.match(r"^(.*?)\s*\(([^)]+)\)\s*/\s*(.+)$", issuing_auth)
        if auth_match:
            auth_name = auth_match.group(1).strip()
            auth_code = auth_match.group(2).strip()
            geography = auth_match.group(3).strip()
        else:
            auth_name, auth_code, geography = issuing_auth, "", ""

        is_struck = col_map["title"] is not None and _cell_is_strikethrough(cells[col_map["title"]])

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
    struck = [e for e in all_entries if e["strikethrough"]]

    return {
        "in_scope":     active,
        "out_of_scope": struck,
        "summary":      f"Scope covers {len(active)} active and {len(struck)} struck-through documents.",
    }