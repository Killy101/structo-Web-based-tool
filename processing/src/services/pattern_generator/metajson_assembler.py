"""
src/services/pattern_generator/metajson_assembler.py

Assembles the final meta.json structure from BRD-extracted data.
Called by the /generate/metajson endpoint in process.py.
"""

from __future__ import annotations

import re
from typing import Any

from src.services.pattern_generator import generate_level_patterns
from src.services.pattern_generator.languages.spanish import SPANISH_PATH_TRANSFORM_CLEANUP


def assemble_metajson(
    metadata: dict[str, Any],
    levels: list[dict],
    language: str,
    content_profile: dict[str, Any] | None = None,
    scope_entries: list[str] | None = None,
    whitespace_handling: dict | None = None,
    brd_config: dict | None = None,
) -> tuple[dict, str]:
    """
    Assemble the final meta.json structure from extracted BRD data.

    Parameters
    ----------
    metadata : dict
        Normalised metadata fields (Source Name / Content Category Name, dates, …).
    levels : list of dict
        TOC-derived level dicts with keys: level, name, definition, examples, required.
    language : str
        Document language.
    content_profile : dict | None
        Content profile payload (may contain "levels" list with redjayXmlTag etc.).
    scope_entries : list[str] | None
        In-scope document title strings.
    whitespace_handling : dict | None
        Whitespace handling config keyed by level number.
    brd_config : dict | None
        Raw BRD config block (may contain pathTransform, levelPatterns, rootPath, …).

    Returns
    -------
    tuple[dict, str]
        (metajson_dict, suggested_filename)
    """
    # ── 1. Infer level patterns ────────────────────────────────────────────
    level_pattern_input = [
        {
            "level":      lvl["level"],
            "definition": lvl.get("definition", ""),
            "examples":   lvl.get("examples", []),
            "required":   lvl.get("required", False),
            "name":       lvl.get("name"),
        }
        for lvl in levels
    ]

    # Prefer explicit patterns embedded in brd_config; otherwise infer.
    if brd_config and isinstance(brd_config.get("levelPatterns"), dict):
        level_patterns: dict[str, list[str]] = {
            str(k): v for k, v in brd_config["levelPatterns"].items()
        }
    else:
        level_patterns = (
            generate_level_patterns(language=language, levels=level_pattern_input)
            if level_pattern_input
            else {}
        )

    # Level 2 is always the document title — keep as catch-all.
    level_patterns["2"] = ["^.*$"]

    # ── 2. Build content-profile levels list ───────────────────────────────
    cp_levels: list[dict] = []

    if content_profile and isinstance(content_profile.get("levels"), list):
        cp_levels = [
            {
                "levelNumber":  row.get("levelNumber", ""),
                "redjayXmlTag": row.get("redjayXmlTag", ""),
                "path":         row.get("path", ""),
            }
            for row in content_profile["levels"]
        ]
    elif levels:
        cp_levels = [
            {
                "levelNumber":  f"Level {lvl['level']}",
                "redjayXmlTag": _build_redjay_tag(lvl["level"], lvl.get("examples", [])),
                "path":         f"/{lvl['name']}" if lvl.get("name") else "",
            }
            for lvl in levels
            if int(lvl.get("level", 0)) >= 2
        ]

    # ── 3. Assemble the top-level structure ───────────────────────────────
    metajson: dict[str, Any] = {
        "metadata":       metadata,
        "language":       language,
        "scope":          scope_entries or [],
        "levelPatterns":  level_patterns,
        "contentProfile": {
            "levels":             cp_levels,
            "headingAnnotation":  (
                content_profile.get("heading_annotation", "Level 2")
                if content_profile else "Level 2"
            ),
        },
    }

    # ── 4. Optional BRD-config sections ───────────────────────────────────
    if brd_config:
        if "pathTransform" in brd_config:
            metajson["pathTransform"] = brd_config["pathTransform"]
        if "rootPath" in brd_config:
            metajson["rootPath"] = brd_config["rootPath"]
        if "whitespaceHandling" in brd_config:
            metajson["whitespaceHandling"] = brd_config["whitespaceHandling"]
        elif whitespace_handling:
            metajson["whitespaceHandling"] = whitespace_handling
    elif whitespace_handling:
        metajson["whitespaceHandling"] = whitespace_handling

    # ── 4b. Inject/merge language-specific pathTransform cleanup ──────────
    # Always applied for Spanish regardless of whether brd_config had a
    # pathTransform — our cleanup rules take precedence because they fix
    # known issues (leading whitespace, .- suffix, ALL-CAPS ordinal words).
    if _is_spanish_language(language):
        metajson["pathTransform"] = _build_path_transform(
            SPANISH_PATH_TRANSFORM_CLEANUP, level_patterns
        )

    # ── 4c. For Spanish: title-case the document-title metadata field ──────
    # Level-2 paths are derived from the raw document title. When the source is
    # ALL-CAPS we normalise it here so scope matching and path display are correct.
    if "pathTransform" in metajson and _is_spanish_language(language):
        for key in ("Content Category Name", "Source Name", "document_title"):
            raw_title = metadata.get(key, "")
            if raw_title and raw_title == raw_title.upper():
                metadata[key] = _spanish_title_case(raw_title)

    # ── 5. Derive a suggested filename ────────────────────────────────────
    source_name = (
        metadata.get("Content Category Name")
        or metadata.get("Source Name")
        or metadata.get("document_title")
        or "metajson"
    )
    filename = _sanitize_filename(str(source_name)) + ".json"

    return metajson, filename



def _is_spanish_language(language: str) -> bool:
    lang = (language or "").strip().lower()
    return any(t in lang for t in [
        "spanish", "español", "espanol", "castellano", "castilian", "es-",
    ])


# Spanish stop words that stay lowercase in title-case conversion
# (prepositions, articles, conjunctions — except at the start of the string)
_SPANISH_STOPWORDS = frozenset([
    "a", "al", "con", "de", "del", "e", "el", "en",
    "la", "las", "lo", "los", "o", "para", "por",
    "que", "se", "sin", "un", "una", "unos", "unas", "y",
])


def _spanish_title_case(text: str) -> str:
    """
    Convert an ALL-CAPS Spanish string to Title Case, keeping known
    prepositions / articles / conjunctions lowercase (except the first word).

    Examples
    --------
    "REGLAS PARA EL ORDENAMIENTO"
        → "Reglas para el Ordenamiento"
    " REGLAS A LAS QUE HABRAN DE SUJETARSE"
        → "Reglas a las que Habrán de Sujetarse"   (accent already in source)
    """
    text = text.strip()
    if not text:
        return text
    words = text.split()
    result = []
    for i, word in enumerate(words):
        # Preserve digits and already-mixed-case tokens (e.g. "Bis", "1")
        if word.isdigit():
            result.append(word)
            continue
        lower = word.lower()
        if i > 0 and lower in _SPANISH_STOPWORDS:
            result.append(lower)
        else:
            # Capitalise first letter, lowercase the rest
            result.append(word[0].upper() + word[1:].lower() if len(word) > 1 else word.upper())
    return " ".join(result)


def _build_path_transform(
    cleanup: dict[str, list[list]],
    level_patterns: dict[str, list[str]],
) -> dict[str, dict]:
    """
    Convert a SPANISH_PATH_TRANSFORM_CLEANUP-style dict into the pathTransform
    structure consumed by _sanitize_path_transform_output in process.py:

        { "3": { "patterns": [["find", "replace", flag, extra], ...], "case": "" } }

    Levels present in level_patterns but absent from cleanup get a minimal
    entry with only the three shared cleanup rules so trailing punctuation
    and leading whitespace are always stripped.
    """
    _SHARED = [
        [r"^\s+", "", 0, ""],
        [r"\s*\.-$", "", 0, ""],
        [r"[.,;)\-]+$", "", 0, ""],
    ]

    pt: dict[str, dict] = {}

    # Merge: levels with explicit rules come first
    all_levels = set(cleanup.keys()) | set(level_patterns.keys())
    for lvl_key in all_levels:
        try:
            lvl_num = int(lvl_key)
        except ValueError:
            continue
        if lvl_num < 3:
            continue

        rules = cleanup.get(lvl_key)
        if rules is not None:
            patterns = [list(r) for r in rules]
        else:
            # No explicit rules — inject shared cleanup so punct is still stripped
            patterns = [list(r) for r in _SHARED]

        pt[lvl_key] = {"patterns": patterns, "case": ""}

    # Level 2 always needs the catch-all identity pattern
    pt["2"] = {"patterns": [["^.*$", "", 0, ""]], "case": ""}
    return pt

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_redjay_tag(level: int, examples: list[str]) -> str:
    lvl_str = str(level)
    if lvl_str in ("0", "1"):
        return "Hardcoded"
    tokens = [ex.strip() for ex in examples if ex.strip()]
    if not tokens:
        return f'<section level="{lvl_str}"><title></title></section>'
    return "\n".join(
        f'<section level="{lvl_str}"><title>{token}</title></section>'
        for token in tokens
    )


def _sanitize_filename(name: str) -> str:
    """Convert a document title into a safe filename (no extension)."""
    s = name.strip()
    # Strip characters that are unsafe on Windows / POSIX filesystems
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s)
    s = re.sub(r"[\s_]+", "_", s)
    s = s.strip("_")
    return s or "metajson"