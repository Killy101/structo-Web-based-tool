"""
english.py
----------
Pattern generator for English-language documents.
Handles Latin script: keyword prefixes, Arabic numerals,
Roman numerals, alphabetic suffixes, and common legal structures.

Abbreviation recognition sourced directly from BRD citation rules:
  Alabama    - ALA. ADMIN. CODE r. x-x-x.x
  Alaska     - Alaska Admin. Code tit. x, § x.x  /  Alaska Stat. § x-x-x
  California - Cal. Code Regs. tit. x, § x
  Colorado   - Colo. Rev. Stat. § x-x-x
  Delaware   - DEL. ADMIN. CODE § x
  Georgia    - Ga. Code § x-x-x
  Hawaii     - Haw. Code R. § x-x-x  /  Haw. Rev. Stat. § x-x
  Idaho      - Idaho Admin. Code r. x.x.x.x  /  Idaho Code § x-x
  Iowa       - Iowa Admin. Code r. x-x.x  /  Iowa Code § x
  Kentucky   - Ky. Rev. Stat. § x-x
  Louisiana  - LA. ADMIN. CODE tit. x, § x

Multi-word / compound prefix support added from BRDs:
  Maryland           - Article - Commercial Law (plain text article)
  Massachusetts      - Part III / Title XXVI / Chapter 92A / Chapter92A1/2
  Minnesota Admin    - Subpart 1. / Subp. 2.
  Missouri Code      - Title 15 / DIVISION 10 / Chapter 1 / 1 CSR 10-1.010
                       Schedule A / Appendix A
  Montana Admin      - 2.12 / 2.12.102 / Subchapter 1 General...
  Montana Code       - Title 17 / Chapter 4 / Part 1 / Article I
  New Hampshire      - TITLE I / TITLE XXXIV-A / CHAPTER 6 / CHAPTER 110-C
  New Mexico         - CHAPTER 46 / ARTICLE 2 / PART 1 / SUBPART 1
  New York CL        - Article 1 / Title 1 / Subtitle A / Part 1 / Sub_part 1
  NYCRR              - Title 1 / Subtitle A / Chapter I / Subchapter A
                       Article 1 / Subarticle M / Part 5
                       Appendix 7 / Appendix 12B / Appendix 17-D
                       Supervisory Policy 1 ...
  NC Admin Code      - Title 04 / Chapter 01 / SubChapter A / Section .0100
                       04 NCAC 10A .0101 / CHAPTER 8 APPENDIX
  NC Gen Statutes    - Chapter 47A / Subchapter (roman) / Article 1A / Part 1
                       Subpart A / Article (roman at leaf)
  Oklahoma           - Title 6 / 14A-1-102 / (aa) duplicate-letter
  Oregon Admin       - 441 (chapter number) / DIVISION 175 / 441-175-0130
  Oregon Revised     - Volume : 09 / TITLE 10 / Chapter 001 / 659A.001
  Rhode Island       - Title 34 / CHAPTER 34-25.2 / PART 31-10.3-1
                       Article I / Part I / SCHEDULE A
  South Dakota Admin - ARTICLE 20:07 / 20:07:03 / 20:07:03:01 / 20:07:03:01.01
  Tennessee Code     - Title 26 / Chapter 101 / Part 11 / 45-2-1106
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition


# ---------------------------------------------------------------------------
# Full-word keyword prefixes (as they appear verbatim in document headings)
# ---------------------------------------------------------------------------
_KEYWORD_PREFIXES = [
    # Three-word (must come before two-word which must come before one-word)
    "SUPERVISORY POLICY", "Supervisory Policy",
    # Two-word
    "SUB_PART", "Sub_part",
    "SUBCHAPTER", "Subchapter", "SubChapter",
    "SUBDIVISION", "Subdivision",
    "SUBARTICLE", "Subarticle",
    "SUBGROUP", "Subgroup",
    "SUBPART", "Subpart",
    "SUBTITLE", "Subtitle",
    # One-word
    "CHAPTER", "Chapter",
    "PART", "Part",
    "SECTION", "Section",
    "ARTICLE", "Article",
    "RULE", "Rule",
    "DIVISION", "Division",
    "TITLE", "Title",
    "VOLUME", "Volume",
    "APPENDIX", "Appendix",
    "SCHEDULE", "Schedule",
    "EXHIBIT", "Exhibit",
    "FORM", "Form",
    "ATTACHMENT", "Attachment",
    "GROUP", "Group",
]

# ---------------------------------------------------------------------------
# Abbreviated keyword prefixes extracted from BRD citation rules.
# Each entry: (canonical_abbrev, regex_pattern_matching_that_abbrev)
# Ordered longest-first so more-specific abbreviations match before shorter ones.
# ---------------------------------------------------------------------------
_ABBREV_PATTERNS: list[tuple[str, str]] = [
    # Multi-word / compound abbreviations first
    ("Subchap.",    r"Subchap\."),
    ("Subch.",      r"Subch\."),
    ("Subtit.",     r"Subtit\."),
    ("Subgr.",      r"Subgr\."),
    ("Subdiv.",     r"Subdiv\."),
    ("Subpt.",      r"Subpt\."),
    ("Subart.",     r"Subart\."),
    ("Subarticle.", r"Subarticle\."),
    ("Subp.",       r"Subp\."),    # Minnesota Admin: "Subp. 2."
    # Single-word abbreviations
    ("Chap.",       r"Chap\."),
    ("Ch.",         r"Ch\."),
    ("Tit.",        r"Tit\."),
    ("tit.",        r"tit\."),
    ("TIT.",        r"TIT\."),
    ("Pt.",         r"Pt\."),
    ("PT.",         r"PT\."),
    ("Art.",        r"Art\."),
    ("ART.",        r"ART\."),
    ("Sec.",        r"Sec\."),
    ("SEC.",        r"SEC\."),
    ("Div.",        r"Div\."),
    ("DIV.",        r"DIV\."),
    ("App.",        r"App\."),
    ("APP.",        r"APP\."),
    ("Sch.",        r"Sch\."),
    ("SCH.",        r"SCH\."),
    ("Ex.",         r"Ex\."),
    ("Att.",        r"Att\."),
    ("Vol.",        r"Vol\."),     # Volume abbreviation
    ("r.",          r"r\."),       # "rule" — used in Alabama, Alaska, Idaho, Iowa admin codes
    ("R.",          r"R\."),       # "Rule" — used in Hawaii admin code ("Haw. Code R.")
]

# Combined regex that matches any known abbreviation at the start of a string
_ABBREV_RE = re.compile(
    r"^(" + "|".join(re.escape(a) for a, _ in _ABBREV_PATTERNS) + r")\s*",
    re.IGNORECASE,
)

_ROMAN = r"[IVXLCDM]+"
_ROMAN_LOWER = r"[ivxlcdm]+"
_ARABIC = r"[0-9]+"
_ALPHA_SUFFIX = r"[A-Z]?"
_ALPHA_SUFFIX_REQUIRED = r"[A-Z]"


# ---------------------------------------------------------------------------
# Default level-pattern fallbacks (used when inference is inconclusive)
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# pathTransform cleanup rows.
# Each row: [find, replace, 0, ""]
# Covers both full-word forms AND their abbreviations from BRD citation rules.
# ---------------------------------------------------------------------------
ENGLISH_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    "3": [
        # Full-word forms
        ["CHAPTER|Chapter|SubChapter|SUBCHAPTER|Subchapter", "Ch.",    0, ""],
        ["PART|Part",               "Pt.",    0, ""],
        ["TITLE|Title",             "Tit.",   0, ""],
        ["VOLUME|Volume",           "Vol.",   0, ""],
        # Citation-rule abbreviations (BRDs: Alaska, California, Louisiana)
        ["tit\\.|Tit\\.|TIT\\.",    "Tit.",   0, ""],
        ["Ch\\.|Chap\\.",           "Ch.",    0, ""],
        ["Pt\\.|PT\\.",             "Pt.",    0, ""],
        ["Vol\\.",                  "Vol.",   0, ""],
        # Noise cleanup
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
        # Oregon Volume colon separator: "Volume : 09" -> "Vol. 09"
        [":\\s*",                   " ",      0, ""],
    ],
    "4": [
        ["PART|Part",               "Pt.",    0, ""],
        ["SUBPART|Subpart",         "Subpt.", 0, ""],
        ["TITLE|Title",             "Tit.",   0, ""],
        ["SUBTITLE|Subtitle",       "Subtit.",0, ""],
        # Citation abbreviations
        ["Pt\\.|PT\\.",             "Pt.",    0, ""],
        ["Subpt\\.",                "Subpt.", 0, ""],
        ["Subtit\\.",               "Subtit.",0, ""],
        ["tit\\.|Tit\\.|TIT\\.",    "Tit.",   0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "5": [
        ["CHAPTER|Chapter|SubChapter|SUBCHAPTER|Subchapter", "Ch.",    0, ""],
        ["SUBCHAPTER|Subchapter|SubChapter",                 "Subch.", 0, ""],
        # Citation abbreviations (BRDs: Hawaii, Idaho admin code)
        ["Ch\\.|Chap\\.",           "Ch.",    0, ""],
        ["Subch\\.|Subchap\\.",     "Subch.", 0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "6": [
        ["SECTION|Section",         "Sec.",   0, ""],
        ["SUBCHAPTER|Subchapter|SubChapter",  "Subch.", 0, ""],
        # Citation abbreviations
        ["Sec\\.|SEC\\.",           "Sec.",   0, ""],
        ["Subch\\.|Subchap\\.",     "Subch.", 0, ""],
        # "r." used in Alabama / Alaska / Idaho admin codes for rule-level sections
        ["^r\\.",                   "",       0, ""],
        ["^R\\.",                   "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "7": [
        ["DIVISION|Division",       "Div.",   0, ""],
        ["SUBDIVISION|Subdivision", "Subdiv.",0, ""],
        # Citation abbreviations
        ["Div\\.|DIV\\.",           "Div.",   0, ""],
        ["Subdiv\\.",               "Subdiv.",0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "8": [
        ["ARTICLE|Article",         "Art.",   0, ""],
        ["SUBARTICLE|Subarticle",   "Subart.",0, ""],
        # Citation abbreviations
        ["Art\\.|ART\\.",           "Art.",   0, ""],
        ["Subart\\.",               "Subart.",0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "9": [
        ["ARTICLE|Article",         "Art.",   0, ""],
        ["RULE|Rule",               "Rule",   0, ""],
        # Citation abbreviations
        ["Art\\.|ART\\.",           "Art.",   0, ""],
        # "r." rule abbreviation (Alabama, Alaska, Iowa, Idaho admin codes)
        ["^r\\.",                   "",       0, ""],
        ["^R\\.",                   "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "10": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    "11": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "12": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "13": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "14": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "15": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\([0-9]+\\)",            "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "17": [
        ["APPENDIX|Appendix",       "App.",   0, ""],
        ["SCHEDULE|Schedule",       "Sch.",   0, ""],
        ["EXHIBIT|Exhibit",         "Ex.",    0, ""],
        ["ATTACHMENT|Attachment",   "Att.",   0, ""],
        # Citation abbreviations
        ["App\\.|APP\\.",           "App.",   0, ""],
        ["Sch\\.|SCH\\.",           "Sch.",   0, ""],
        ["Ex\\.",                   "Ex.",    0, ""],
        ["Att\\.",                  "Att.",   0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "18": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["\\.-$",                   "",       0, ""],
        ["\\. -$",                  "",       0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "19": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
    "20": [
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["^([^(].*)\\)$",             "\\1",  0, ""],
        ["-$",                           "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$", "",       0, ""],
    ],
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _detect_prefix(examples: list[str]) -> str | None:
    """
    Return the full-word keyword prefix if all examples share one.
    Handles multi-word prefixes like 'Supervisory Policy', 'Sub_part', 'SubChapter'.
    Tries longer (multi-word) prefixes before shorter ones to avoid false matches.
    """
    sample = [ex.strip() for ex in examples if ex.strip()]
    if not sample:
        return None
    for kw in _KEYWORD_PREFIXES:
        if all(ex.upper().startswith(kw.upper()) for ex in sample):
            return kw
    return None


def _detect_abbrev_prefix(examples: list[str]) -> str | None:
    """
    Return the abbreviated keyword prefix if all examples share one.
    Handles forms like 'tit. 11', 'Ch. 5', 'Subch. 3', 'r. 000', 'Subp. 2.', etc.
    """
    sample = [ex.strip() for ex in examples if ex.strip()]
    if not sample:
        return None
    for abbrev, abbrev_re in _ABBREV_PATTERNS:
        pat = re.compile(r"^" + abbrev_re, re.IGNORECASE)
        if all(pat.match(ex) for ex in sample):
            return abbrev
    return None


def _has_roman(examples: list[str]) -> bool:
    return any(re.search(r'\b[IVXLCDM]{2,}\b', ex) for ex in examples)


def _has_decimal(examples: list[str]) -> bool:
    return any(re.search(r'\d+\.\d+', ex) for ex in examples)


def _has_hyphen(examples: list[str]) -> bool:
    return any("-" in ex for ex in examples)


def _has_alpha_suffix(examples: list[str]) -> bool:
    return any(re.search(r'\d+[A-Z]', ex) for ex in examples)


def _has_colon_separator(examples: list[str]) -> bool:
    """Detect South Dakota style colon-separated identifiers: 20:07, 20:07:03."""
    return any(re.search(r'\d+:\d+', ex) for ex in examples)


def _has_fractional_suffix(examples: list[str]) -> bool:
    """Detect Mass. style fractions: Chapter92A1/2."""
    return any("/" in ex for ex in examples)


def _has_duplicate_alpha(examples: list[str]) -> bool:
    """Detect Oklahoma-style doubled letters in parens: (aa), (bb)."""
    return any(re.search(r'\([a-z]{2,}\)', ex) for ex in examples)


def _abbrev_to_regex_group(abbrev: str) -> str:
    """
    Build a regex alternation group for a canonical abbreviation.
    E.g. 'Tit.' -> '(Tit\\.|tit\\.|TIT\\.)'
         'Subch.' -> '(Subch\\.|SUBCH\\.)'
         'r.' -> '(r\\.)'
         'Subp.' -> '(Subp\\.|subp\\.|SUBP\\.)'
    """
    esc = re.escape(abbrev)
    upper = re.escape(abbrev.upper())
    title = re.escape(abbrev[0].upper() + abbrev[1:].lower())
    lower = re.escape(abbrev.lower())

    variants: list[str] = []
    for v in (esc, upper, title, lower):
        if v not in variants:
            variants.append(v)
    return "(" + "|".join(variants) + ")"


def _build_abbrev_pattern(abbrev: str, stripped: list[str]) -> list[str]:
    """
    Given an abbreviated prefix (e.g. 'Subch.') and the stripped
    numbering tokens, build one or more regex patterns.
    """
    kw = _abbrev_to_regex_group(abbrev)
    number_tail = r"[0-9A-Za-z]+(?:[.\-][0-9A-Za-z]+)*"

    # Pure roman numeral numbering (e.g. 'Part IV' abbreviated as 'Pt. IV')
    if stripped and all(re.fullmatch(r"[IVXLCDM]+", s) for s in stripped if s):
        return [f"^{kw}\\s*[IVXLCDM]+$"]

    patterns: list[str] = []
    if _has_decimal(stripped) and _has_hyphen(stripped) and _has_alpha_suffix(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif _has_hyphen(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
    elif _has_decimal(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif _has_alpha_suffix(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
    else:
        # Default: plain number, possibly with alpha suffix
        patterns.append(f"^{kw}\\s*{number_tail}$")

    return patterns if patterns else [f"^{kw}\\s*.*$"]


def _build_keyword_pattern(prefix: str, stripped: list[str]) -> list[str]:
    """
    Build regex patterns for a detected full-word keyword prefix.
    Handles all numbering styles discovered across BRDs, including:
      - Roman numerals (NH TITLE I, Mass Part III)
      - Uppercase roman numerals with hyphen-alpha (NH TITLE XXXIV-A)
      - Arabic + optional uppercase alpha (Chapter 92A, Chapter 46A)
      - Arabic + alpha + fraction (Chapter92A1/2 — Mass)
      - Colon-separated identifiers (ARTICLE 20:07 — South Dakota)
      - Padded decimals (Montana Admin: 2.12.102)
      - NCAC-style composite (NC Admin: 04 NCAC 10A .0101)
      - CSR-style composite (Missouri: 1 CSR 10-1.010)
      - "Subpart X" where X is an uppercase letter (NC Gen, NM)
      - "SubChapter A" (NC Admin Code)
      - "Supervisory Policy 1 <subject>" (NYCRR)
      - Plain trailing subject text after number (most BRDs)
    """
    # Normalise prefix for pattern building
    kw_upper = prefix.upper()
    kw_title = prefix[0].upper() + prefix[1:].lower() if len(prefix) > 1 else prefix.upper()
    # Collect all case variants including BRD-specific mixed-case forms
    _kw_variants: set[str] = {prefix, kw_upper, kw_title}
    _mixed_map = {
        "SUBCHAPTER":        {"SubChapter", "Subchapter"},
        "SUB_PART":          {"Sub_part"},
        "SUBARTICLE":        {"Subarticle"},
        "SUBDIVISION":       {"Subdivision"},
        "SUBPART":           {"Subpart"},
        "SUBTITLE":          {"Subtitle"},
        "SUBGROUP":          {"Subgroup"},
        "SUPERVISORY POLICY":{"Supervisory Policy"},
    }
    _kw_variants |= _mixed_map.get(kw_upper, set())
    kw = "(" + "|".join(re.escape(v) for v in sorted(_kw_variants, key=len, reverse=True)) + ")"

    patterns: list[str] = []

    # ── Special composite formats ────────────────────────────────────────────

    # RI PART with complex hyphen-decimal: "PART 31-10.3-1"
    if kw_upper == "PART" and stripped and any(re.match(r'[0-9]+-[0-9]', s) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}-{_ARABIC}(?:\\.{_ARABIC}+)?(?:-{_ARABIC}+)?$")
        return patterns

    # NYCRR Appendix with numeric identifier + optional letter or hyphen-letter:
    # "Appendix 7", "Appendix 12B", "Appendix 17-D"
    if kw_upper == "APPENDIX" and stripped and any(re.match(r'[0-9]', s) for s in stripped if s):
        return [f"^{kw}\\s+{_ARABIC}[A-Z]?$", f"^{kw}\\s+{_ARABIC}-[A-Z]$"]

    # NC Admin: "CHAPTER 8 APPENDIX" — chapter number followed by the word APPENDIX
    if stripped and any(re.fullmatch(r'[0-9]+\s+APPENDIX', s, re.IGNORECASE) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}\\s+(APPENDIX|Appendix)$")
        return patterns

    # RI style: "34-25.2 Rhode Island Home Loan..." — number-hyphen-decimal + optional subject
    if stripped and any(re.match(r'[0-9]+-[0-9]+(?:\.[0-9]+)?(?:\s+\S+)?', s) for s in stripped if s):
        if any('-' in s and not re.fullmatch(r'[0-9]+-[A-Z]', s) for s in stripped if s):
            patterns.append(f"^{kw}\\s+{_ARABIC}-{_ARABIC}(?:\\.{_ARABIC}+)?(?:\\s+.*)?$")
            return patterns

    # South Dakota colon-separated: ARTICLE 20:07
    if _has_colon_separator(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}:{_ARABIC}(?::{_ARABIC})*(?:\\.{_ARABIC}+)?$")
        return patterns

    # Missouri CSR: "1 CSR 10-1.010"
    if any(re.search(r'\d+\s+CSR\s+', ex) for ex in stripped):
        patterns.append(r"^[0-9]+\s+CSR\s+[0-9]+-[0-9]+\.[0-9]+$")
        return patterns

    # NC Admin NCAC: "04 NCAC 10A .0101"
    if any(re.search(r'NCAC', ex, re.IGNORECASE) for ex in stripped):
        patterns.append(r"^[0-9]+\s+NCAC\s+[0-9]+[A-Z]?\s+\.[0-9]+$")
        return patterns

    # Montana Admin dot-separated rule: "2.12.102"
    if stripped and all(re.fullmatch(r'[0-9]+(?:\.[0-9]+)+', s) for s in stripped if s):
        segments = max(s.count('.') + 1 for s in stripped if s)
        dot_seg = r"[0-9]+" + r"\.[0-9]+" * (segments - 1)
        patterns.append(f"^{dot_seg}$")
        return patterns

    # Mass. fraction suffix: "Chapter92A1/2"
    if _has_fractional_suffix(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}[A-Z]?(?:[0-9]+/[0-9]+)?$")

    # ── Roman numeral numbering (NH TITLE I; Mass Part III) ─────────────────
    # Roman with optional hyphen+alpha suffix: TITLE XXXIV-A
    if stripped and all(re.fullmatch(r'[IVXLCDM]+(?:-[A-Z])?', s) for s in stripped if s):
        if any("-" in s for s in stripped if s):
            return [f"^{kw}\\s+[IVXLCDM]+-[A-Z]$", f"^{kw}\\s+[IVXLCDM]+$"]
        return [f"^{kw}\\s+[IVXLCDM]+$"]

    # Lowercase roman (leaf sublevels)
    if stripped and all(re.fullmatch(r'[ivxlcdm]+', s) for s in stripped if s):
        return [f"^{kw}\\s+[ivxlcdm]+$"]

    # ── Uppercase letter identifier (SubChapter A, Subpart A, Subtitle A) ───
    if stripped and all(re.fullmatch(r'[A-Z]', s) for s in stripped if s):
        return [f"^{kw}\\s*[A-Z]$"]

    # Uppercase letter + optional trailing subject (NC SubChapter A APPENDIX)
    if stripped and all(re.fullmatch(r'[A-Z](?:\s+\S+)*', s) for s in stripped if s):
        if all(re.fullmatch(r'[A-Z]', s) for s in stripped if s):
            return [f"^{kw}\\s*[A-Z]$"]
        # Could have trailing text like "APPENDIX"
        patterns.append(f"^{kw}\\s*[A-Z](?:\\s+.*)?$")
        return patterns

    # ── Arabic numbering with variations ────────────────────────────────────
    has_dec = _has_decimal(stripped)
    has_hyp = _has_hyphen(stripped)
    has_alpha = _has_alpha_suffix(stripped)
    has_frac = _has_fractional_suffix(stripped)
    has_colon = _has_colon_separator(stripped)

    # Chapter 110-C  (NH: CHAPTER 110-C) — number-hyphen-single-uppercase-letter
    if has_hyp and stripped and any(re.fullmatch(r'[0-9]+-[A-Z]', s) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}-[A-Z]$")
        patterns.append(f"^{kw}\\s+{_ARABIC}$")
        return patterns

    # Article 19-D style: number-hyphen-uppercase-letter (NY Consolidated Laws)
    if has_hyp and stripped and any(re.fullmatch(r'[0-9]+-[A-Z]', s) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}-[A-Z]$")
        patterns.append(f"^{kw}\\s+{_ARABIC}$")
        return patterns

    if has_dec and has_hyp and has_alpha:
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif has_hyp and has_alpha:
        # Chapter 92A / Chapter 110-C / Article 19-D and plain Chapter 92
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s+{_ARABIC}-[A-Z]$")
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
    elif has_dec and has_alpha:
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif has_alpha:
        # Chapter 92A, CHAPTER 46A, ARTICLE 2A — plain alpha-suffixed
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
    elif has_dec:
        patterns.append(f"^{kw}\\s*{_ARABIC}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}\\.{_ARABIC}$")
    elif has_hyp:
        patterns.append(f"^{kw}\\s*{_ARABIC}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}-{_ARABIC}$")
    else:
        # Plain number — detect if examples carry a trailing subject (e.g. "Subchapter 1 General Rules")
        _has_trailing = any(re.search(r'^[0-9]+\s+\S', s) for s in stripped if s)
        if _has_trailing:
            patterns.append(f"^{kw}\\s+{_ARABIC}(?:\\s+.*)?$")
        else:
            patterns.append(f"^{kw}\\s*{_ARABIC}$")

    # "Supervisory Policy N <subject>" — allow trailing text
    if kw_upper in ("SUPERVISORY POLICY",):
        patterns = [f"^{kw}\\s+{_ARABIC}(?:\\s+.*)?$"]

    return patterns if patterns else [f"^{re.escape(prefix)}\\s*.*$"]


def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    """
    Infer one or more regex patterns from the definition string and examples.

    Priority:
      1. Full-word keyword prefix (CHAPTER, TITLE, SUBCHAPTER, Supervisory Policy …)
      2. Abbreviated prefix from BRD citation rules (tit., Subch., Ch., r., Subp., …)
      3. Specialised structural formats (NCAC, CSR, colon-separated, dot-chain,
         Volume colon, Appendix+letter, Schedule+letter, DIVISION, duplicate-alpha)
      4. Pure numbering heuristics (parenthesised identifiers, bare numbers, etc.)
      5. Catch-all fallback
    """
    sample = [ex.strip() for ex in examples if ex.strip()]

    # ── 1. Full-word keyword prefix ──────────────────────────────────────────
    prefix = _detect_prefix(examples)
    if prefix:
        stripped = [ex.strip()[len(prefix):].strip() for ex in examples if ex.strip()]
        return _build_keyword_pattern(prefix, stripped)

    # ── 2. Abbreviated prefix (tit., Subch., Ch., r., Subp., …) ─────────────
    abbrev = _detect_abbrev_prefix(examples)
    if abbrev:
        abbrev_re = re.compile(r"^" + re.escape(abbrev) + r"\s*", re.IGNORECASE)
        stripped = [abbrev_re.sub("", ex.strip()) for ex in examples if ex.strip()]
        return _build_abbrev_pattern(abbrev, stripped)

    # ── 3. Specialised structural formats ────────────────────────────────────

    # Oregon Volume colon format: "Volume : 09"
    if sample and all(re.fullmatch(r'Volume\s*:\s*[0-9]+', ex, re.IGNORECASE) for ex in sample):
        return [r"^Volume\s*:\s*[0-9]+$"]

    # South Dakota colon-separated (no keyword): "20:07", "20:07:03", "20:07:03:01", "20:07:03:01.01"
    if sample and all(re.fullmatch(r'[0-9]+(?::[0-9]+)+(?:\.[0-9]+)?', ex) for ex in sample):
        return [r"^[0-9]+(?::[0-9]+)+(?:\.[0-9]+)?$"]

    # Missouri CSR composite: "1 CSR 10-1.010"
    if sample and all(re.search(r'CSR', ex) for ex in sample):
        return [r"^[0-9]+\s+CSR\s+[0-9]+-[0-9]+\.[0-9]+$"]

    # NC Admin NCAC composite: "04 NCAC 10A .0101"
    if sample and all(re.search(r'NCAC', ex, re.IGNORECASE) for ex in sample):
        return [r"^[0-9]+\s+NCAC\s+[0-9]+[A-Z]?\s+\.[0-9]+$"]

    # Montana Admin dot-chain (no keyword): "2", "2.12", "2.12.102"
    if sample and all(re.fullmatch(r'[0-9]+(?:\.[0-9]+)*', ex) for ex in sample):
        if any('.' in ex for ex in sample):
            return [r"^[0-9]+(?:\.[0-9]+)*$"]

    # Oregon Revised Statutes section: "659A.001", "646.608 Note"
    if sample and all(re.fullmatch(r'[0-9]+[A-Z]?\.[0-9]+(?:\s+Note)?', ex) for ex in sample):
        return [r"^[0-9]+[A-Z]?\.[0-9]+(?:\s+Note)?$"]

    # Oregon Admin section: "441-175-0130"
    if sample and all(re.fullmatch(r'[0-9]+-[0-9]+-[0-9]+', ex) for ex in sample):
        return [r"^[0-9]+-[0-9]+-[0-9]+$"]

    # Oklahoma / Missouri multi-hyphen section: "14A-1-102", "60-175.2", "6-102"
    if sample and all(re.fullmatch(r'[0-9]+[A-Z]?-[0-9A-Z].*', ex) for ex in sample):
        return [
            r"^[0-9]+[A-Z]?-[0-9]+-[0-9]+(?:\.[0-9]+)?$",
            r"^[0-9]+[A-Z]?-[0-9]+(?:\.[0-9]+)?$",
        ]

    # RI CHAPTER with hyphen-dotted number + optional trailing subject: "CHAPTER 34-25.2 RI Home Loan..."
    if sample and all(re.match(r'(?:CHAPTER|Chapter)\s+[0-9]+-[0-9]+', ex, re.IGNORECASE) for ex in sample):
        return [r"^(CHAPTER|Chapter)\s+[0-9]+-[0-9]+(?:\.[0-9]+)?(?:\s+.*)?$"]

    # RI PART with hyphen-dotted number: "PART 31-10.3-1"
    if sample and all(re.match(r'PART\s+[0-9]', ex, re.IGNORECASE) for ex in sample):
        return [r"^(PART|Part)\s+[0-9]+-[0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?$"]

    # Schedule/Appendix with uppercase letter: "Schedule A", "SCHEDULE A", "Appendix A"
    if sample and all(re.fullmatch(r'(?:SCHEDULE|Schedule|APPENDIX|Appendix)\s+[A-Z]', ex) for ex in sample):
        return [r"^(SCHEDULE|Schedule|APPENDIX|Appendix)\s+[A-Z]$"]

    # NYCRR Appendix with number+optional letter or hyphen-letter: "Appendix 7", "Appendix 12B", "Appendix 17-D"
    if sample and all(re.match(r'(?:APPENDIX|Appendix)\s+[0-9]', ex) for ex in sample):
        return [r"^(APPENDIX|Appendix)\s+[0-9]+[A-Z]?$",
                r"^(APPENDIX|Appendix)\s+[0-9]+-[A-Z]$",
                r"^(APPENDIX|Appendix)\s+[0-9]+[A-Z]$"]

    # NC Admin CHAPTER with APPENDIX suffix: "CHAPTER 8 APPENDIX"
    if sample and all(re.fullmatch(r'(?:CHAPTER|Chapter)\s+[0-9]+\s+APPENDIX', ex, re.IGNORECASE) for ex in sample):
        return [r"^(CHAPTER|Chapter)\s+[0-9]+\s+(APPENDIX|Appendix)$"]

    # Minnesota / NYCRR Subpart with trailing period: "Subpart 1." / "Subp. 2."
    if sample and all(re.fullmatch(r'(?:Subpart|Subp\.)\s*[0-9]+\.?', ex) for ex in sample):
        return [r"^(Subpart|Subp\.)\s*[0-9]+\.?$"]

    # ── 4. Pure numbering heuristics (no keyword / abbreviation prefix) ──────

    if sample and all(re.fullmatch(r'\([a-z]{2,}\)', ex) for ex in sample):
        # Oklahoma duplicate-letter: (aa), (bb)
        return [r"^\([a-z]{2,}\)$"]
    if sample and all(re.fullmatch(r'\([a-z]+\)', ex) for ex in sample):
        return [r"^\([a-z]+\)$"]
    if sample and all(re.fullmatch(r'\([A-Z]+\)', ex) for ex in sample):
        return [r"^\([A-Z]+\)$"]
    if sample and all(re.fullmatch(r'\([0-9]+\.[0-9]+\)', ex) for ex in sample):
        return [r"^\([0-9]+(?:\.[0-9]+)?\)$"]
    if sample and all(re.fullmatch(r'\([0-9]+\)', ex) for ex in sample):
        return [r"^\([0-9]+\)$"]
    if sample and all(re.fullmatch(r'\([ivxl]+\)', ex) for ex in sample):
        return [r"^\([ivxl]+\)$"]
    if sample and all(re.fullmatch(r'\([IVXL]+\)', ex) for ex in sample):
        return [r"^\([IVXL]+\)$"]
    if sample and all(re.fullmatch(r'[0-9]+', ex) for ex in sample):
        return [r"^[0-9]+$"]
    if sample and all(re.fullmatch(r'[A-Z]+', ex) for ex in sample):
        return [r"^[A-Z]+$"]
    if sample and all(re.fullmatch(r'[a-z]+', ex) for ex in sample):
        return [r"^[a-z]+$"]
    if sample and all(re.fullmatch(r'[A-Z]\.', ex) for ex in sample):
        return [r"^[A-Z]\.$"]
    if sample and all(re.fullmatch(r'[0-9]+\.', ex) for ex in sample):
        return [r"^[0-9]+\.$"]
    if sample and all(re.fullmatch(r'[IVXLCDM]+', ex) for ex in sample):
        return [r"^[IVXLCDM]+$"]
    if sample and all(re.fullmatch(r'[ivxlcdm]+', ex) for ex in sample):
        return [r"^[ivxlcdm]+$"]
    # Bare number with alpha suffix: "9A", "21B"
    if sample and all(re.fullmatch(r'[0-9]+[A-Z]?', ex) for ex in sample):
        if any(re.search(r'[A-Z]$', ex) for ex in sample):
            return [r"^[0-9]+[A-Z]?$"]
    # Dot-prefixed section numbers (NC Admin): ".0100", ".0101"
    if sample and all(re.fullmatch(r'\.[0-9]+', ex) for ex in sample):
        return [r"^\.[0-9]+$"]

    # ── 5. Catch-all ─────────────────────────────────────────────────────────
    return [r"^.*$"]


# ---------------------------------------------------------------------------
# Public generator class
# ---------------------------------------------------------------------------

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
        result: dict[str, list[str]] = {}
        for lvl in levels:
            patterns = _infer_pattern(lvl.definition, lvl.examples)
            result[str(lvl.level)] = patterns
        return result