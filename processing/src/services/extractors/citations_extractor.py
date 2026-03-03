"""
src/services/extractors/citations_extractor.py

Extracts citation data from two BRD tables that always appear together:

  TABLE A — "Citable Levels"  (3 cols):
      Level | Is Level Citable? | SME Comments

  TABLE B — "Citation Standardization Rules"  (4 cols):
      Level | Citation Rules | Source of Law | SME Comments

Both tables are merged by level number into CitationRow objects that
match the frontend CitationRow interface:
  { id, level, citationRules, sourceOfLaw, isCitable, smeComments }
"""

import re


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _clean(text: str) -> str:
    return text.replace("\xa0", " ").replace("\n", " ").strip()


def _normalise_level(raw: str) -> str:
    """'Level 2' → '2',  '2' → '2',  'Level 13' → '13'"""
    raw = raw.strip()
    m = re.match(r"(?:level\s*)?(\d+)", raw, re.IGNORECASE)
    return m.group(1) if m else raw


def _normalise_citation_rule(raw: str) -> str:
    text = _clean(raw)
    text = re.sub(r"(?i)(\S)(example\s*:)", r"\1 \2", text)
    return text


def _is_citable_table(table) -> bool:
    """3-column table: Level | Is Level Citable? | SME Comments"""
    if not table.rows:
        return False
    header = " ".join(c.text for c in table.rows[0].cells).lower()
    return "citable" in header and "level" in header and len(table.rows[0].cells) <= 4


def _is_citation_rules_table(table) -> bool:
    """4-column table: Level | Citation Rules | Source of Law | SME Comments"""
    if not table.rows:
        return False
    header = " ".join(c.text for c in table.rows[0].cells).lower()
    return "citation rules" in header and "source" in header


# ─────────────────────────────────────────────
# Public extractor
# ─────────────────────────────────────────────

def extract_citations(doc) -> dict:
    """
    Returns:
        {
            "citation_style": "...",
            "references": [
                {
                    "id":            "1",
                    "level":         "2",
                    "citationRules": "<Level 2> Example: ...",
                    "sourceOfLaw":   "Source of Law",
                    "isCitable":     "Y",
                    "smeComments":   "...",
                },
                ...
            ]
        }
    """

    # ── Step 1: build citable map  { level_str → "Y" | "N" } ────────────────
    citable_map: dict[str, str] = {}
    for table in doc.tables:
        if _is_citable_table(table):
            for row in table.rows[1:]:      # skip header
                cells = row.cells
                if len(cells) < 2:
                    continue
                lvl = _normalise_level(_clean(cells[0].text))
                val = _clean(cells[1].text).upper()
                citable = "Y" if val.startswith("Y") else "N" if val.startswith("N") else val
                if lvl:
                    citable_map[lvl] = citable
            break

    # ── Step 2: extract citation rules rows ──────────────────────────────────
    references: list[dict] = []
    citation_style = "Hierarchical pipe-separated citation format (Level2 | Level3 | ...)"

    for table in doc.tables:
        if not _is_citation_rules_table(table):
            continue

        # Detect column positions from header row
        header_cells = [_clean(c.text).lower() for c in table.rows[0].cells]
        col_level  = next((i for i, h in enumerate(header_cells) if h.startswith("level")), 0)
        col_rules  = next((i for i, h in enumerate(header_cells) if "citation rule" in h), 1)
        col_source = next((i for i, h in enumerate(header_cells) if "source" in h), 2)
        col_sme    = next((i for i, h in enumerate(header_cells) if "sme comment" in h), 3)

        for ri, row in enumerate(table.rows[1:], start=1):
            cells = row.cells
            n = len(cells)

            def cell(idx: int) -> str:
                return _clean(cells[idx].text) if idx < n else ""

            lvl_raw       = cell(col_level)
            citation_rule = _normalise_citation_rule(cell(col_rules))
            source_of_law = cell(col_source)
            sme_comments  = cell(col_sme)

            lvl = _normalise_level(lvl_raw)
            if not lvl:
                continue

            # Use level-2 citation rule as the overall style description
            if lvl == "2" and citation_rule and citation_rule.upper() != "N":
                citation_style = citation_rule

            references.append({
                "id":            str(ri),
                "level":         lvl,
                "citationRules": citation_rule,
                "sourceOfLaw":   source_of_law,
                "isCitable":     citable_map.get(lvl, ""),
                "smeComments":   sme_comments,
            })

        break   # only the first matching table

    return {
        "citation_style": citation_style,
        "references":     references,
    }