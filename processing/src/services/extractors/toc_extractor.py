"""
src/services/extractors/toc_extractor.py

Extracts the Document Structure / TOC levels table from a BRD .docx file.

The TOC table has 8 columns:
  Level | Name | Required | Definition | Example | Note | TOC Requirements | SME Comments

This maps directly to the frontend TocRow interface:
  { id, level, name, required, definition, example, note, tocRequirements, smeComments }
"""

import re

# Helpers

def _clean(text: str) -> str:
    """Strip whitespace and normalise non-breaking spaces."""
    return text.replace("\xa0", " ").replace("\n", " ").strip()


def _required_value(raw: str) -> str:
    """
    Normalise the Required cell to one of: 'Yes' | 'No' | 'Conditional' | ''
    The cell contains 'True' / 'False' in most BRDs.
    """
    val = raw.strip().lower()
    if val in ("true", "yes", "y"):
        return "Yes"
    if val in ("false", "no", "n"):
        return "No"
    if "conditional" in val or "cond" in val:
        return "Conditional"
    return ""


def _is_toc_structure_table(table) -> bool:
    """
    Return True if this table is the Document Structure / Levels table.
    Identified by a header row that mentions level, required, and definition.
    """
    if not table.rows:
        return False
    header = " ".join(c.text for c in table.rows[0].cells).lower()
    return (
        "level" in header
        and "required" in header
        and "definition" in header
    )


def _detect_col_positions(header_row) -> dict[str, int]:
    """
    Map column names to their index by scanning the header row.
    Returns a dict: { 'level': i, 'name': i, 'required': i, ... }
    Falls back to positional defaults (0-7) if a column isn't found.
    """
    keyword_map = {
        "level":           ["level"],
        "name":            ["name", "identifies level"],
        "required":        ["required", "true levels"],
        "definition":      ["definition", "level value"],
        "example":         ["example", "sample values"],
        "note":            ["note", "specific instruction"],
        "tocRequirements": ["toc requirements", "toc req", "sme checkpoint for sme"],
        "smeComments":     ["sme comments", "sme checkpoint if"],
    }
    defaults = ["level", "name", "required", "definition", "example", "note", "tocRequirements", "smeComments"]

    positions: dict[str, int] = {}
    for ci, cell in enumerate(header_row.cells):
        text = cell.text.lower().strip()
        for field, keywords in keyword_map.items():
            if field not in positions and any(kw in text for kw in keywords):
                positions[field] = ci
                break

    # Fill in positional fallbacks for anything not detected
    for pos, field in enumerate(defaults):
        if field not in positions:
            positions[field] = pos

    return positions

# Public extractor
def extract_toc(doc) -> dict:
    """
    Find the Document Structure table and extract each level row.

    Returns:
        {
            "sections": [
                {
                    "id":              "0",          # level number as string
                    "level":           "0",
                    "name":            "Part",
                    "required":        "Yes",        # "Yes" | "No" | "Conditional" | ""
                    "definition":      "Hardcoded – /AU",
                    "example":         "Fair Work Regulations 2009",
                    "note":            "...",
                    "tocRequirements": "...",
                    "smeComments":     "...",
                },
                ...
            ]
        }
    """
    for table in doc.tables:
        if not _is_toc_structure_table(table):
            continue

        col = _detect_col_positions(table.rows[0])
        sections = []

        for ri, row in enumerate(table.rows):
            if ri == 0:
                continue  # skip header

            cells = row.cells
            n = len(cells)

            def cell_text(field: str) -> str:
                idx = col.get(field)
                if idx is None or idx >= n:
                    return ""
                return _clean(cells[idx].text)

            level_raw = cell_text("level")

            # Skip completely empty rows or rows that look like sub-headers
            if not level_raw:
                continue
            # Skip rows where the level cell contains a long description (not a number)
            if len(level_raw) > 5:
                continue

            sections.append({
                "id":              level_raw,
                "level":           level_raw,
                "name":            cell_text("name"),
                "required":        _required_value(cell_text("required")),
                "definition":      cell_text("definition"),
                "example":         cell_text("example"),
                "note":            cell_text("note"),
                "tocRequirements": cell_text("tocRequirements"),
                "smeComments":     cell_text("smeComments"),
            })

        # Found and processed the table — return immediately
        if sections:
            return {"sections": sections}

    return {"sections": []}