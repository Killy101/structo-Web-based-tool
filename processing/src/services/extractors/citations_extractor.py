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

from .toc_extractor import _cell_value, _clean_rich_text, _extract_section_block, _is_heading_paragraph, _iter_block_items, _normalize_heading


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _clean(text: str) -> str:
    normalized = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"\s+", " ", normalized).strip()
    if cleaned.lower() in {"n/a", "na", "none", "null", "tbd", "-", "--", "—", "not applicable"}:
        return ""
    return cleaned


def _normalise_level(raw: str) -> str:
    """'Level 2' → '2',  '2' → '2',  'Level 13' → '13'"""
    raw = raw.strip()
    m = re.match(r"(?:level\s*)?(\d+)", raw, re.IGNORECASE)
    return m.group(1) if m else raw


def _normalise_citation_rule(raw: str) -> str:
    rich_tag_pattern = re.compile(r"</?(?:span|font|strong|b|em|i|u|s|strike|del|br|a|p|div)\b", re.IGNORECASE)
    text = _clean_rich_text(raw) if rich_tag_pattern.search(raw or "") else _clean(raw)
    text = re.sub(r"(?i)(\S)(example\s*:)", r"\1 \2", text)
    return text


def _extract_section_note(doc, *keywords: str) -> str:
    items = list(_iter_block_items(doc))
    toc_noise_terms = (
        "metadata",
        "details",
        "exceptions",
        "updates",
        "how to identify",
        "frequency of updates",
        "file delivery requirements",
        "file separation",
        "file naming conventions",
        "citation style guide",
    )

    for idx, (kind, block) in enumerate(items):
        if kind != "paragraph":
            continue
        if not _is_heading_paragraph(block):
            continue

        heading = _normalize_heading(getattr(block, "text", ""))
        if not heading or not all(keyword in heading for keyword in keywords):
            continue

        texts, _ = _extract_section_block(items, idx, rich=True)
        note = "\n".join(texts).strip()
        if not note:
            continue

        normalized_note = _normalize_heading(note)
        if "sme checkpoint" not in normalized_note and not any(term in normalized_note for term in keywords):
            if any(term in normalized_note for term in toc_noise_terms):
                continue

        return note

    return ""


def _is_citable_table(table) -> bool:
    """Citable-levels table, including combined 5-column legacy variants."""
    if not table.rows:
        return False
    header = " ".join(c.text for c in table.rows[0].cells).lower()
    return "citable" in header and "level" in header


def _is_citation_rules_table(table) -> bool:
    """Rules table, including combined layouts with explicit Rules / Source of Law columns."""
    if not table.rows:
        return False

    header_cells = [_clean(c.text).lower() for c in table.rows[0].cells]
    has_level = any(cell.startswith("level") or "citation level" in cell for cell in header_cells)
    has_source_of_law = any("source of law" in cell for cell in header_cells)
    has_explicit_rules_col = any(
        cell == "rules" or cell.startswith("citation rules") or cell.startswith("citation rule")
        for cell in header_cells
    )

    return has_level and (has_source_of_law or has_explicit_rules_col)


def _merge_missing_citable_levels(references: list[dict], citable_map: dict[str, str]) -> list[dict]:
    by_level: dict[str, dict] = {}
    for ref in references:
        lvl = str(ref.get("level", "")).strip()
        if lvl:
            merged = dict(ref)
            if not merged.get("isCitable") and lvl in citable_map:
                merged["isCitable"] = citable_map[lvl]
            by_level[lvl] = merged

    for lvl, citable in citable_map.items():
        if lvl in by_level:
            continue
        by_level[lvl] = {
            "id": lvl,
            "level": lvl,
            "citationRules": "",
            "sourceOfLaw": "",
            "isCitable": citable,
            "smeComments": "",
        }

    return sorted(by_level.values(), key=lambda ref: int(ref.get("level") or 0))


# ─────────────────────────────────────────────
# Public extractor
# ─────────────────────────────────────────────

def extract_citations(doc) -> dict:
    """
    Extract citation data from the Citable Levels and Citation Standardization
    Rules tables.  Falls back to extract_citations_legacy() when the legacy
    2-column table format is detected.
    """
    citation_level_sme_checkpoint = _extract_section_note(doc, "citable", "level")
    citation_rules_sme_checkpoint = (
        _extract_section_note(doc, "citation", "standardization")
        or _extract_section_note(doc, "citation", "rule")
    )

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
    # If no standard 4-col rules table exists, fall back to legacy 2-col format
    if not any(_is_citation_rules_table(t) for t in doc.tables):
        result = extract_citations_legacy(doc)
        # Merge citable_map from standard table (if any) into legacy result
        result["references"] = _merge_missing_citable_levels(result.get("references", []), citable_map)
        if citation_level_sme_checkpoint:
            result["citationLevelSmeCheckpoint"] = citation_level_sme_checkpoint
        if citation_rules_sme_checkpoint:
            result["citationRulesSmeCheckpoint"] = citation_rules_sme_checkpoint
        return result

    references: list[dict] = []
    citation_style = "Hierarchical pipe-separated citation format (Level2 | Level3 | ...)"

    for table in doc.tables:
        if not _is_citation_rules_table(table):
            continue

        # Detect column positions from header row. Some legacy BRDs combine
        # `Is Level Citable?`, `Rules`, `Source of Law`, and `SME Comments`
        # into one 5-column table rather than splitting them across two tables.
        header_cells = [_clean(c.text).lower() for c in table.rows[0].cells]
        col_level = next((i for i, h in enumerate(header_cells) if h.startswith("level") or "citation level" in h), 0)
        col_citable = next((i for i, h in enumerate(header_cells) if "citable" in h), None)
        col_source = next((i for i, h in enumerate(header_cells) if "source" in h), None)
        col_sme = next((i for i, h in enumerate(header_cells) if "sme comment" in h), None)
        col_rules = next(
            (i for i, h in enumerate(header_cells) if "rule" in h and "citable" not in h),
            next(
                (i for i in range(len(header_cells)) if i not in {col_level, col_citable, col_source, col_sme}),
                1,
            ),
        )

        for ri, row in enumerate(table.rows[1:], start=1):
            cells = row.cells
            n = len(cells)

            def cell(idx: int | None, rich: bool = False) -> str:
                if idx is None or idx >= n:
                    return ""
                if rich:
                    return _clean_rich_text(_cell_value(cells[idx], rich=True))
                return _clean(cells[idx].text)

            lvl_raw       = cell(col_level)
            citation_rule = _normalise_citation_rule(cell(col_rules, rich=True))
            source_of_law = cell(col_source, rich=True)
            sme_comments  = cell(col_sme, rich=True)

            lvl = _normalise_level(lvl_raw)
            if not lvl:
                continue

            citable = citable_map.get(lvl, "")
            raw_citable = cell(col_citable).upper()
            if raw_citable:
                citable = "Y" if raw_citable.startswith("Y") else "N" if raw_citable.startswith("N") else raw_citable

            # Prefer level-2 citation rule as the overall style description,
            # but fall back to the first meaningful populated rule.
            if citation_rule and citation_rule.upper() != "N":
                if lvl == "2" or citation_style.startswith("Hierarchical pipe-separated"):
                    citation_style = citation_rule

            references.append({
                "id":            str(ri),
                "level":         lvl,
                "citationRules": citation_rule,
                "sourceOfLaw":   source_of_law,
                "isCitable":     citable,
                "smeComments":   sme_comments,
            })

        break   # only the first matching table

    payload = {
        "citation_style": citation_style,
        "references": _merge_missing_citable_levels(references, citable_map),
    }
    if citation_level_sme_checkpoint:
        payload["citationLevelSmeCheckpoint"] = citation_level_sme_checkpoint
    if citation_rules_sme_checkpoint:
        payload["citationRulesSmeCheckpoint"] = citation_rules_sme_checkpoint
    return payload


# ─────────────────────────────────────────────
# Legacy extractor (paragraph-based format)
# ─────────────────────────────────────────────

def _is_legacy_citable_table(table) -> bool:
    """Legacy 2-col table: Level | Is Level Citable?"""
    if not table.rows:
        return False
    header = " ".join(c.text for c in table.rows[0].cells).lower()
    return (
        "citable" in header
        and "level" in header
        and len(table.rows[0].cells) <= 3
        and "citation rule" not in header
        and "source" not in header
    )


def _is_legacy_citation_rules_table(table) -> bool:
    """Legacy 2-col table: Citation Level | Rules"""
    if not table.rows:
        return False
    header = " ".join(c.text for c in table.rows[0].cells).lower()
    return (
        "citation level" in header or ("citation" in header and "level" in header)
    ) and len(table.rows[0].cells) <= 3


def extract_citations_legacy(doc) -> dict:
    """
    Legacy BRDs use simpler 2-column tables:

      TABLE A — Level | Is Level Citable?
      TABLE B — Citation Level | Rules

    There is no 'Source of Law' or 'SME Comments' column; those fields are
    returned as empty strings so the output shape matches extract_citations().
    """
    # Step 1: citable map
    citable_map: dict[str, str] = {}
    for table in doc.tables:
        if _is_legacy_citable_table(table):
            for row in table.rows[1:]:
                cells = row.cells
                if len(cells) < 2:
                    continue
                lvl = _normalise_level(_clean(cells[0].text))
                val = _clean(cells[1].text).upper()
                citable = "Y" if val.startswith("Y") else "N" if val.startswith("N") else val
                if lvl:
                    citable_map[lvl] = citable
            break

    # Step 2: citation rules
    references: list[dict] = []
    citation_style = "Hierarchical pipe-separated citation format (Level2 | Level3 | ...)"

    for table in doc.tables:
        if not _is_legacy_citation_rules_table(table):
            continue

        header_cells = [_clean(c.text).lower() for c in table.rows[0].cells]
        col_level = next((i for i, h in enumerate(header_cells) if "level" in h), 0)
        col_rules = next(
            (i for i, h in enumerate(header_cells) if "rule" in h and i != col_level),
            1,
        )

        for ri, row in enumerate(table.rows[1:], start=1):
            cells = row.cells
            n = len(cells)

            def cell(idx: int, rich: bool = False) -> str:
                if idx >= n:
                    return ""
                if rich:
                    return _clean_rich_text(_cell_value(cells[idx], rich=True))
                return _clean(cells[idx].text)

            lvl_raw       = cell(col_level)
            citation_rule = _normalise_citation_rule(cell(col_rules, rich=True))
            lvl           = _normalise_level(lvl_raw)

            if not lvl:
                continue

            # Level 8 is the base citable level in this legacy format
            if lvl == "8" and citation_rule:
                citation_style = citation_rule

            references.append({
                "id":            str(ri),
                "level":         lvl,
                "citationRules": citation_rule,
                "sourceOfLaw":   "",   # not present in legacy format
                "isCitable":     citable_map.get(lvl, ""),
                "smeComments":   "",   # not present in legacy format
            })
        break

    return {
        "citation_style": citation_style,
        "references":     references,
    }