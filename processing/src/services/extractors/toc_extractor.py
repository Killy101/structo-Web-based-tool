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

# ─────────────────────────────────────────────
# Shared: parse hardcoded path from definition
# ─────────────────────────────────────────────

# Matches a path segment in a definition, e.g.:
#   "Hardcoded – /us"          → "/us"
#   "Hardcoded –/aladmincode"  → "/aladmincode"
#   "Hardcoded - /de"          → "/de"
_HARDCODED_PATH_RE = re.compile(r"hardcoded\s*[–\-—]?\s*(/\S+)", re.IGNORECASE)


def _extract_path_from_definition(definition: str) -> str:
    """
    Pull the path segment out of a Level 0 / Level 1 definition, e.g.:
      "Hardcoded – /us"         → "/us"
      "Hardcoded –/aladmincode" → "/aladmincode"
    Returns "" if no path is found.
    """
    m = _HARDCODED_PATH_RE.search(definition)
    return m.group(1).rstrip(".,;") if m else ""

def _clean(text: str) -> str:
    """Normalise whitespace while preserving meaningful line breaks."""
    normalized = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in normalized.split("\n")]
    lines = [line for line in lines if line]
    return "\n".join(lines)


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
    Falls back to extract_toc_legacy() for paragraph-based legacy BRDs.
    """
    # Legacy BRDs store levels as paragraphs, not a table
    for table in doc.tables:
        if _is_toc_structure_table(table):
            break
    else:
        return extract_toc_legacy(doc)

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

            definition = cell_text("definition")
            sections.append({
                "id":              level_raw,
                "level":           level_raw,
                "name":            cell_text("name"),
                "required":        _required_value(cell_text("required")),
                "definition":      definition,
                "example":         cell_text("example"),
                "note":            cell_text("note"),
                "tocRequirements": cell_text("tocRequirements"),
                "smeComments":     cell_text("smeComments"),
                # Populated for Level 0/1 whose definition is "Hardcoded – /xxx"
                "path":            _extract_path_from_definition(definition),
            })

        # Found and processed the table — return immediately
        if sections:
            return {"sections": sections}

    return {"sections": []}


# ─────────────────────────────────────────────
# Legacy extractor (paragraph-based format)
# ─────────────────────────────────────────────

_LEGACY_LEVEL_RE = re.compile(r"^level\s+(\d+)", re.IGNORECASE)
_LEGACY_FIELD_RE = re.compile(
    r"^(name|required|definition|example location|example|note|ex\.|ex:)\s*[:\-–]?\s*(.*)",
    re.IGNORECASE,
)




def extract_toc_legacy(doc) -> dict:
    """
    Legacy BRDs store levels as paragraphs instead of a table:

      Normal paragraph  → "Level N"
      List Paragraph    → "Name: ..."
                          "Required: True / False"
                          "Definition: ..."
                          "Example: ..."
                          "Note: ..."

    Collects from Heading 3 "Levels" through the next major section heading.

    FIX: The previous version broke out of the loop on *any* Heading 3
    encountered while collecting, which caused Level 0 and Level 1 to be
    dropped whenever a sub-heading appeared before their bullet lines were
    fully read.  Now only stop-keyword headings (and Heading 2+) terminate
    collection; unrecognised Heading 3s inside the Levels section are ignored.

    Output shape is identical to extract_toc().
    Each Level 0 / Level 1 section also gets a "path" key derived from its
    definition (e.g. "Hardcoded – /us" → "/us") so that content_profile_extractor
    can assemble hardcoded_path without hardcoding "/us" itself.
    """
    sections = []
    current: dict | None = None

    _stop_lower = [
        "example annotated",
        "metadata",
        "references to other",
        "exceptions",
        "assumptions",
        "file delivery",
    ]

    def _flush():
        if current and current.get("level"):
            # Derive path for Level 0 / Level 1 from the definition field
            if current["level"] in ("0", "1") and not current.get("path"):
                current["path"] = _extract_path_from_definition(current["definition"])
            sections.append(current)

    collecting = False

    for p in doc.paragraphs:
        style      = p.style.name if p.style else ""
        text       = p.text.replace("\xa0", " ").strip()
        text_lower = text.lower()
        is_heading = style.startswith("Heading")

        # Start collecting at the "Levels" heading
        if is_heading and "levels" in text_lower and not collecting:
            collecting = True
            continue

        if not collecting:
            continue

        # Always stop at a known stop-keyword heading (any heading level)
        if is_heading and any(s in text_lower for s in _stop_lower):
            break

        # Stop at Heading 2 (a new top-level section) — but NOT at Heading 3,
        # because sub-headings like "Annotated Header Text" live inside the
        # Levels section and should not prematurely terminate collection.
        if style.startswith("Heading 2") and collecting:
            break

        # A Heading 3 that is *not* the opening "Levels" heading and *not* a
        # stop keyword: just skip the heading line itself, keep collecting.
        if is_heading:
            continue

        # Detect "Level N" marker line
        m_level = _LEGACY_LEVEL_RE.match(text)
        if m_level:
            _flush()
            lvl = m_level.group(1)
            current = {
                "id":              lvl,
                "level":           lvl,
                "name":            "",
                "required":        "",
                "definition":      "",
                "example":         "",
                "note":            "",
                "tocRequirements": "",
                "smeComments":     "",
                "path":            "",   # populated in _flush() for L0/L1
            }
            continue

        if current is None:
            continue

        # Parse named bullet fields
        m_field = _LEGACY_FIELD_RE.match(text)
        if m_field:
            key_raw = m_field.group(1).lower().rstrip(".")
            value   = m_field.group(2).replace("\xa0", " ").strip()
            if key_raw == "name":
                current["name"] = value
            elif key_raw == "required":
                current["required"] = _required_value(value)
            elif key_raw == "definition":
                current["definition"] = value
            elif key_raw in ("example", "example location", "ex.", "ex:"):
                current["example"] = (current["example"] + "; " + value).lstrip("; ") if current["example"] else value
            elif key_raw == "note":
                current["note"] = value
        else:
            # Plain continuation — append to definition
            if text:
                if current["definition"]:
                    current["definition"] += " " + text
                else:
                    current["definition"] = text

    _flush()

    return {"sections": sections}