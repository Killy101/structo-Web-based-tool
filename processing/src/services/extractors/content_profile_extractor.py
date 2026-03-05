"""
src/services/extractors/content_profile_extractor.py

Builds a content profile by aggregating results from the scope, metadata,
and toc extractors — no direct document analysis is performed here.

Output shape matches the Content Profile spreadsheet (DE sources):
  - RC Filename        ← metadata
  - Hardcoded Path     ← Level 0 description + Level 1 description (e.g. /DE + /DEBaFinOrdinance)
  - Level Numbers      ← extracted TOC sections only
  - Heading Annotation ← always "Level 2"
  - Whitespace Rules   ← extracted payload only

REDJAy XML Tag generation rules (from spreadsheet):
  - Level 0 and Level 1  → "Hardcoded"
  - All other levels     → <section level="N"><title>{example}</title></section>
                           Multiple examples (split on ";" or "/") produce one
                           tag per example value, joined by newline.
"""

from .scope_extractor    import extract_scope
from .metadata_extractor import extract_metadata
from .toc_extractor      import extract_toc


# ---------------------------------------------------------------------------
# REDJAy XML tag builder
# ---------------------------------------------------------------------------

_HARDCODED_LEVELS = {"0", "1"}


def _split_examples(example: str) -> list[str]:
    example = example.strip().strip('"\'\u201c\u201d')
    for suffix in ("; etc.", ", etc.", " etc."):
        if example.endswith(suffix):
            example = example[: -len(suffix)].strip()
    for sep in (";", "\n", " / "):
        if sep in example:
            tokens = [t.strip().strip('"\'\u201c\u201d') for t in example.split(sep)]
            return [t for t in tokens if t]
    return [example] if example else []


def _build_redjay_tag(level: str, example: str) -> str:
    level = str(level).strip()
    if level in _HARDCODED_LEVELS:
        return "Hardcoded"
    tokens = _split_examples(example)
    if not tokens:
        return f'<section level="{level}"><title></title></section>'
    return "\n".join(
        f'<section level="{level}"><title>{token}</title></section>'
        for token in tokens
    )


# ---------------------------------------------------------------------------
# Whitespace rules
# ---------------------------------------------------------------------------

def _build_whitespace_rules(identifier_levels: str = "") -> list[dict]:
    title_rule_2 = (
        f"1 space after title with identifier ({identifier_levels})."
        if identifier_levels
        else "1 space after title with identifier."
    )
    return [
        {
            "tags":         "</title>",
            "innodReplace": "2 hard returns after title with heading.",
        },
        {
            "tags":         "</title>",
            "innodReplace": title_rule_2,
        },
        {
            "tags":         "</paragraph>",
            "innodReplace": "2 hard returns after closing para and before opening para",
        },
        {
            "tags":         "</ul>",
            "innodReplace": "1 hard return after",
        },
        {
            "tags":         "</li>",
            "innodReplace": "1 hard return after",
        },
        {
            "tags":         "<p> within <li>",
            "innodReplace": (
                "</innodReplace><ul><innodReplace>\n"
                "  </innodReplace><li><innodReplace></innodReplace><p>(text)</p>"
                '<innodReplace text="&#10;&#10;">\n'
                "  </innodReplace><li><innodReplace>...\n"
                "</innodReplace></ul><innodReplace>"
            ),
        },
        {
            "tags":         "table\n<td>\n<th>",
            "innodReplace": (
                "</innodReplace><innodTd><td><innodReplace></innodReplace><p>...</p><innodReplace>\n"
                "                   </innodReplace><p>...</p><innodReplace>\n"
                "                   </innodReplace><p>...</p><innodReplace>\n"
                "</innodReplace></td></innodTd>\n"
                "</innodReplace></tr><innodTr><innodReplace>"
            ),
        },
    ]


# ---------------------------------------------------------------------------
# Public extractor
# ---------------------------------------------------------------------------

def extract_content_profile(doc) -> dict:
    """
    Aggregate scope, metadata, and toc results into a content profile
    matching the DE source spreadsheets.
    """

    # ── 1. Delegate to the three source extractors ──────────────────────────
    scope    = extract_scope(doc)
    metadata = extract_metadata(doc)
    toc      = extract_toc(doc)

    # ── 2. Top-level scalar fields ───────────────────────────────────────────
    toc_sections_pre: list[dict] = toc.get("sections") or []
    _level_paths: dict[str, str] = {}
    for _sec in toc_sections_pre:
        _lv = str(_sec.get("level", "")).strip()
        if _lv in ("0", "1"):
            _level_paths[_lv] = str(_sec.get("path") or "").strip()

    _derived_path = _level_paths.get("0", "") + _level_paths.get("1", "")

    hardcoded_path = (
        _derived_path
        or metadata.get("hardcoded_path")
        or scope.get("hardcoded_path")
        or toc.get("hardcoded_path")
        or ""
    )

    rc_filename = (
        metadata.get("rc_filename")
        or metadata.get("document_type")
        or scope.get("document_type")
        or ""
    )

    # ── 3. Build Level rows from extracted TOC ───────────────────────────────
    toc_sections: list[dict] = toc.get("sections") or []
    levels = []

    for sec in toc_sections:
        level_raw = str(sec.get("level", "")).strip()
        if not level_raw:
            continue

        required     = str(sec.get("required",    "")).strip()
        name         = str(sec.get("name",        "")).strip()
        definition   = str(sec.get("definition",  "")).strip()
        example      = str(sec.get("example",     "")).strip()
        note         = str(sec.get("note",        "")).strip()
        sme_comments = str(sec.get("smeComments", "")).strip()

        description_parts: list[str] = []
        if required:   description_parts.append(f"Required: {required}")
        if name:       description_parts.append(f"Name: {name}")
        if definition: description_parts.append(f"Definition: {definition}")
        if example:    description_parts.append(f"Example: {example}")

        levels.append({
            "levelNumber":  f"Level {level_raw}",
            "description":  "\n".join(description_parts),
            "redjayXmlTag": _build_redjay_tag(level_raw, example),
            "path":         f"/{name}" if name else "",
            "remarksNotes": note or sme_comments,
        })

    # ── 4. Whitespace rules ──────────────────────────────────────────────────
    extracted_whitespace: list[dict] = (
        toc.get("whitespace")
        or metadata.get("whitespace")
        or scope.get("whitespace")
        or []
    )
    identifier_levels: str = toc.get("identifier_levels") or ""
    whitespace = extracted_whitespace or _build_whitespace_rules(identifier_levels)

    # ── 5. Analytics passed through from scope ───────────────────────────────
    complexity         = scope.get("complexity", "medium")
    key_themes         = scope.get("key_themes", [])
    functional_areas   = scope.get("functional_areas") or toc.get("functional_areas", [])
    requirements_count = scope.get("requirements_count", 0)
    completeness_score = scope.get("completeness_score", 0)
    quality_notes      = scope.get("quality_notes", [])
    word_count         = scope.get("word_count", 0)
    has_diagrams: bool = scope.get("has_diagrams", False) or metadata.get("has_diagrams", False)
    has_tables:   bool = scope.get("has_tables",   False) or metadata.get("has_tables",   False)
    table_count        = scope.get(
        "table_count",
        len(doc.tables) if hasattr(doc, "tables") else 0
    )

    # ── 6. Return unified profile ────────────────────────────────────────────
    return {
        "rc_filename":        rc_filename,
        "hardcoded_path":     hardcoded_path,
        "heading_annotation": "Level 2",
        "levels":             levels,
        "whitespace":         whitespace,

        "document_type":      rc_filename,
        "complexity":         complexity,
        "primary_domain":     hardcoded_path,
        "key_themes":         key_themes,
        "functional_areas":   functional_areas,
        "requirements_count": requirements_count,
        "has_diagrams":       has_diagrams,
        "has_tables":         has_tables,
        "completeness_score": completeness_score,
        "quality_notes":      quality_notes,
        "word_count":         word_count,
        "table_count":        table_count,
        "source_config_key":  "",
    }