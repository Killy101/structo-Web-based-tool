"""
src/services/pattern_generator/__init__.py

Infers regex level-identifier patterns from citation rule definitions.
Called by the /patterns/level-patterns endpoint in process.py.
"""

from __future__ import annotations

import re
from typing import Any


def generate_level_patterns(
    language: str,
    levels: list[dict[str, Any]],
) -> dict[str, list[str]]:
    """
    Infer regex patterns for each citation level based on the definition text,
    examples, and optional redjayXmlTag.

    Parameters
    ----------
    language : str
        Document language (e.g. "English", "Korean", "Chinese").
    levels : list of dict
        Each dict contains at minimum:
          - "level"      : int   — level number
          - "definition" : str   — citation rule description text
          - "examples"   : list  — sample identifier strings
          - "required"   : bool
          - "name"       : str | None
        Optional key:
          - "redjayXmlTag" : str

    Returns
    -------
    dict[str, list[str]]
        Mapping of str(level) → list of regex pattern strings.
    """
    result: dict[str, list[str]] = {}

    for level_info in levels:
        level_num = level_info.get("level")
        if level_num is None:
            continue

        key = str(level_num)
        definition = str(level_info.get("definition") or "")
        examples: list[str] = list(level_info.get("examples") or [])

        patterns = _infer_patterns(definition, examples, language, int(level_num))
        if patterns:
            result[key] = patterns

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _infer_patterns(
    definition: str,
    examples: list[str],
    language: str,
    level: int,
) -> list[str]:
    """Return a list of regex strings inferred from the definition + examples."""
    text = definition.lower()
    patterns: list[str] = []

    # ── Arabic / decimal integers ──────────────────────────────────────────
    if _has_any(text, ["arabic numeral", "arabic number", "whole number",
                        "integer", r"\bdigit"]) or (
        re.search(r"\bnumber(s)?\b", text) and not re.search(r"roman|letter", text)
    ):
        patterns.append("^[0-9]+$")

    # ── Dotted-decimal (1.2, 1.2.3, …) ────────────────────────────────────
    dot_depth = _detect_dot_depth(text, examples, level)
    if dot_depth:
        patterns.append(_dot_pattern(dot_depth))

    # ── Number + letter suffix (1a, 2b) ───────────────────────────────────
    if re.search(r"\d+\s*[a-z]", text) or any(
        re.fullmatch(r"\d+[a-z]+", ex.strip()) for ex in examples
    ):
        patterns.append("^[0-9]+[a-z]+$")

    # ── Roman numerals ────────────────────────────────────────────────────
    if re.search(r"roman\s*(numeral|number)", text, re.IGNORECASE):
        upper = re.search(r"upper|capital|majuscul", text, re.IGNORECASE)
        lower = re.search(r"lower|small|minuscul", text, re.IGNORECASE)
        if upper and not lower:
            patterns.append("^[IVXLCDM]+$")
        elif lower and not upper:
            patterns.append("^[ivxlcdm]+$")
        else:
            patterns.extend(["^[IVXLCDM]+$", "^[ivxlcdm]+$"])

    # ── Alphabetic letters ────────────────────────────────────────────────
    if re.search(r"\b(letter|alphabetic|alpha)\b", text):
        upper = re.search(r"upper|capital", text, re.IGNORECASE)
        lower = re.search(r"lower|small", text, re.IGNORECASE)
        if upper and not lower:
            patterns.append("^[A-Z]+$")
        elif lower and not upper:
            patterns.append("^[a-z]+$")
        else:
            patterns.extend(["^[a-z]+$", "^[A-Z]+$"])

    # ── Parenthesised identifiers: (a), (A), (1) ─────────────────────────
    # Only trigger on explicit keywords or when examples show paren format.
    paren_in_examples = any(
        re.fullmatch(r"\([a-zA-Z0-9]+\)", ex.strip()) for ex in examples
    )
    if re.search(r"\bparen|bracket", text) or paren_in_examples:
        if re.search(r"\d", text) or any(
            re.fullmatch(r"\(\d+\)", ex.strip()) for ex in examples
        ):
            patterns.append("^\\(\\d+\\)$")
        else:
            patterns.extend(["^\\([a-z]+\\)$", "^\\([A-Z]+\\)$"])

    # ── Language-specific Chinese patterns ────────────────────────────────
    lang_norm = language.strip().lower()
    if any(t in lang_norm for t in ["chinese", "中文", "zh"]):
        if level == 3:
            patterns.append(
                r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*章$"
            )
        elif level == 4:
            patterns.append(
                r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[节節]$"
            )
        elif level == 5:
            patterns.append(
                r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[条條]"
                r"(?:之(?:[一二三四五六七八九十百千零两〇]+|[0-9]+))?$"
            )

    # ── Fall back: try to infer from example values ───────────────────────
    if not patterns:
        for ex in examples[:5]:
            p = _pattern_from_example(ex.strip())
            if p and p not in patterns:
                patterns.append(p)

    # Deduplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for p in patterns:
        if p not in seen:
            seen.add(p)
            deduped.append(p)
    return deduped


def _has_any(text: str, keywords: list[str]) -> bool:
    return any(re.search(kw, text) for kw in keywords)


def _detect_dot_depth(text: str, examples: list[str], level: int) -> int:
    """Return dot-depth if dotted-decimal identifiers are detected, else 0."""
    # Look for explicit dotted number in definition text
    m = re.search(r"(\d+)\.(\d+)(\.(\d+))?(\.(\d+))?", text)
    if m:
        if m.group(6):
            return 4
        if m.group(4):
            return 3
        return 2

    # Explicit keywords
    if re.search(r"dotted|dot[\s-]separated|decimal[\s-]separated", text):
        return _depth_from_level(level)

    # Check examples
    for ex in examples:
        ex = ex.strip()
        if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ex):
            return 4
        if re.fullmatch(r"\d+\.\d+\.\d+", ex):
            return 3
        if re.fullmatch(r"\d+\.\d+", ex):
            return 2

    return 0


def _depth_from_level(level: int) -> int:
    if level <= 10:
        return 2
    if level <= 12:
        return 3
    return 4


def _dot_pattern(depth: int) -> str:
    segment = "[0-9]+"
    return "^" + (segment + ("\\." + segment) * (depth - 1)) + "$"


def _pattern_from_example(example: str) -> str | None:
    """Guess a regex pattern from a single concrete identifier example."""
    if not example:
        return None

    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", example):
        return "^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"
    if re.fullmatch(r"\d+\.\d+\.\d+", example):
        return "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    if re.fullmatch(r"\d+\.\d+", example):
        return "^[0-9]+\\.[0-9]+$"
    if re.fullmatch(r"\d+[a-z]+", example):
        return "^[0-9]+[a-z]+$"
    if re.fullmatch(r"\d+", example):
        return "^[0-9]+$"
    if re.fullmatch(r"[IVXLCDM]+", example):
        return "^[IVXLCDM]+$"
    if re.fullmatch(r"[ivxlcdm]+", example):
        return "^[ivxlcdm]+$"
    if re.fullmatch(r"[A-Z]+", example):
        return "^[A-Z]+$"
    if re.fullmatch(r"[a-z]+", example):
        return "^[a-z]+$"
    if re.fullmatch(r"\([a-z]+\)", example):
        return "^\\([a-z]+\\)$"
    if re.fullmatch(r"\([A-Z]+\)", example):
        return "^\\([A-Z]+\\)$"
    if re.fullmatch(r"\(\d+\)", example):
        return "^\\(\\d+\\)$"

    return None