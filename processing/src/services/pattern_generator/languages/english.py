"""
english.py
----------
Pattern generator for English-language documents.
Handles Latin script: keyword prefixes, Arabic numerals,
Roman numerals, alphabetic suffixes, and common legal structures.
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition


# Common legal keyword prefixes seen in English documents
_KEYWORD_PREFIXES = [
    "CHAPTER", "Chapter",
    "PART", "Part",
    "SECTION", "Section",
    "ARTICLE", "Article",
    "RULE", "Rule",
    "DIVISION", "Division",
    "TITLE", "Title",
    "SUBTITLE", "Subtitle",
    "SUBPART", "Subpart",
    "SUBCHAPTER", "Subchapter",
    "APPENDIX", "Appendix",
    "SCHEDULE", "Schedule",
    "EXHIBIT", "Exhibit",
    "FORM", "Form",
    "ATTACHMENT", "Attachment",
]

_ROMAN = r"[IVXLCDM]+"
_ARABIC = r"[0-9]+"
_ALPHA_SUFFIX = r"[A-Z]?"
_ALPHA_SUFFIX_REQUIRED = r"[A-Z]"


# Metajson defaults used as generic fallback for non-specialized languages.
ENGLISH_META_DEFAULT_LEVEL_PATTERNS: dict[str, list[str]] = {
    "2":  ["^.*$"],
    "3":  ["[0-9]+$"],
    "4":  ["[0-9]+$"],
    "5":  ["[IVXL]+$"],
    "6":  ["[IVXL]+$"],
    "7":  ["^.*$"],
    "8":  ["[0-9]+$"],
    "9":  ["[0-9]+$", "[0-9]+[a-z]+$"],
    "10": ["[0-9]+\\.[0-9]+$"],
    "11": ["[a-z]+$", "[ivxl]+$", "[0-9]+\\.[0-9]+\\.[0-9]+$"],
    "12": ["[ivxl]+$", "[a-z]+$", "[IVXL]+$", "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"],
    "13": ["[a-z]+$"],
    "14": ["[IVXL]+$", "[ivxl]+$", "[A-Z]+$"],
    "15": ["[a-z]+$", "[IVXL]+$"],
    "16": ["[ivxl]+$", "[0-9]+$"],
    "17": ["[ivxl]+$", "[0-9]+$"],
    "18": ["[a-z]+$"],
    "19": ["^.*$"],
    "20": ["^.*$"],
}

# pathTransform cleanup rows for English structural heading words.
# Each row: [find, replace, 0, ""]
# These mirror the same concept as SPANISH_PATH_TRANSFORM_CLEANUP —
# normalising how the heading label appears in the path string.
ENGLISH_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    "3": [
        ["CHAPTER|Chapter", "Ch.", 0, ""],
        ["PART|Part",       "Pt.", 0, ""],
        ["TITLE|Title",     "Tit.", 0, ""],
        ["\\([0-9]+\\) ",   "",    0, ""],
        ["\\.—$",           "",    0, ""],
    ],
    "4": [
        ["PART|Part",           "Pt.",   0, ""],
        ["SUBPART|Subpart",     "Subpt.", 0, ""],
        ["TITLE|Title",         "Tit.",  0, ""],
        ["SUBTITLE|Subtitle",   "Subtit.", 0, ""],
        ["\\([0-9]+\\) ",       "",      0, ""],
        ["\\.—$",               "",      0, ""],
    ],
    "5": [
        ["CHAPTER|Chapter",         "Ch.",    0, ""],
        ["SUBCHAPTER|Subchapter",   "Subch.", 0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "6": [
        ["SECTION|Section", "Sec.", 0, ""],
        ["\\([0-9]+\\) ",   "",     0, ""],
        ["\\.—$",           "",     0, ""],
    ],
    "7": [
        ["DIVISION|Division", "Div.", 0, ""],
        ["\\([0-9]+\\) ",     "",     0, ""],
        ["\\.—$",             "",     0, ""],
    ],
    "9": [
        ["ARTICLE|Article", "Art.", 0, ""],
        ["RULE|Rule",       "Rule", 0, ""],
        ["\\([0-9]+\\) ",   "",     0, ""],
        ["\\.$",            "",     0, ""],
        ["\\.—$",           "",     0, ""],
    ],
    "10": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\.$",          "", 0, ""],
        ["\\.—$",         "", 0, ""],
    ],
    "11": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "12": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "13": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "14": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "15": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\([0-9]+\\)",  "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "17": [
        ["APPENDIX|Appendix",   "App.",  0, ""],
        ["SCHEDULE|Schedule",   "Sch.",  0, ""],
        ["EXHIBIT|Exhibit",     "Ex.",   0, ""],
        ["ATTACHMENT|Attachment", "Att.", 0, ""],
        ["\\([0-9]+\\) ",       "",      0, ""],
        ["\\)$",                "",      0, ""],
        ["\\.$",                "",      0, ""],
    ],
    "18": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.-$",         "", 0, ""],
        ["\\. -$",        "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "19": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
    "20": [
        ["\\([0-9]+\\) ", "", 0, ""],
        ["\\)$",          "", 0, ""],
        ["\\.$",          "", 0, ""],
    ],
}


def _detect_prefix(examples: list[str]) -> str | None:
    """Return the keyword prefix if all examples share one."""
    sample = [ex.strip() for ex in examples if ex.strip()]
    if not sample:
        return None
    for kw in _KEYWORD_PREFIXES:
        if all(ex.startswith(kw) for ex in sample):
            return kw
    return None


def _has_roman(examples: list[str]) -> bool:
    return any(re.search(r'\b[IVXLCDM]{2,}\b', ex) for ex in examples)


def _has_decimal(examples: list[str]) -> bool:
    return any(re.search(r'\d+\.\d+', ex) for ex in examples)


def _has_hyphen(examples: list[str]) -> bool:
    return any("-" in ex for ex in examples)


def _has_alpha_suffix(examples: list[str]) -> bool:
    return any(re.search(r'\d+[A-Z]', ex) for ex in examples)


def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    """
    Infer one or more regex patterns from the definition string and examples.
    """
    patterns = []
    prefix = _detect_prefix(examples)

    if prefix:
        # Strip prefix from examples to analyse the numbering part.
        stripped = [ex.strip()[len(prefix):].strip() for ex in examples if ex.strip()]

        # FIX (Bug 3): Early-exit for pure Roman numeral numbering.
        # When every stripped token is a valid Roman numeral (e.g. "Part IV"
        # → stripped = ["IV"]), emit a tight Roman-only pattern immediately
        # rather than falling through to the Arabic/hyphen/decimal branches
        # which can produce the wrong result.
        if stripped and all(re.fullmatch(r"[IVXLCDM]+", s) for s in stripped if s):
            kw = f"({'|'.join([prefix.upper(), prefix.title()])})"
            return [f"^{kw} ?[IVXLCDM]+$"]

        if _has_roman(stripped):
            patterns.append(f"^({'|'.join([prefix.upper(), prefix.title()])}) ?{_ROMAN}$")

        if _has_decimal(stripped) and _has_hyphen(stripped) and _has_alpha_suffix(stripped):
            # Complex: Part 2A, Part 5-1, Part 1.2, Part 2C.1
            kw = f"({'|'.join([prefix.upper(), prefix.title()])})"
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}$")
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
        elif _has_hyphen(stripped):
            kw = f"({'|'.join([prefix.upper(), prefix.title()])})"
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}$")
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
        elif _has_decimal(stripped):
            kw = f"({'|'.join([prefix.upper(), prefix.title()])})"
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}$")
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
        elif _has_alpha_suffix(stripped):
            kw = f"({'|'.join([prefix.upper(), prefix.title()])})"
            patterns.append(f"^{kw} ?{_ARABIC}{_ALPHA_SUFFIX}$")
        else:
            kw = f"({'|'.join([prefix.upper(), prefix.title()])})"
            patterns.append(f"^{kw} ?{_ARABIC}$")

        return patterns if patterns else [f"^{re.escape(prefix)} ?.*$"]

    # No keyword prefix — check numbering style from examples
    sample = [ex.strip() for ex in examples if ex.strip()]
    if sample and all(re.fullmatch(r'\([a-z]+\)', ex) for ex in sample):
        return [r"^\([a-z]+\)$"]
    if sample and all(re.fullmatch(r'\([A-Z]+\)', ex) for ex in sample):
        return [r"^\([A-Z]+\)$"]
    if sample and all(re.fullmatch(r'\([0-9]+\)', ex) for ex in sample):
        return [r"^\([0-9]+\)$"]
    if sample and all(re.fullmatch(r'\([ivxl]+\)', ex) for ex in sample):
        return [r"^\([ivxl]+\)$"]
    if sample and all(re.fullmatch(r'[0-9]+', ex) for ex in sample):
        return [r"^[0-9]+$"]
    if sample and all(re.fullmatch(r'[A-Z]+', ex) for ex in sample):
        return [r"^[A-Z]+$"]
    if sample and all(re.fullmatch(r'[a-z]+', ex) for ex in sample):
        return [r"^[a-z]+$"]

    # Fallback
    return [r"^.*$"]


class EnglishPatternGenerator(PatternGeneratorBase):
    supported_languages = [
        "english",
        "en",
        "en-us",
        "en-gb",
        "en-au",
        "en-ca",
        "en-nz",
        "en-ie",
        "en-za",
        "french", "fr",
        "german", "de",
        "italian", "it",
        "dutch", "nl",
        "polish", "pl",
        "other eu languages",
    ]

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result = {}
        for lvl in levels:
            patterns = _infer_pattern(lvl.definition, lvl.examples)
            result[str(lvl.level)] = patterns
        return result