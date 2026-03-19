"""
spanish.py
----------
Pattern generator for Spanish-language documents (MX, ES, AR, CO, CL, and wider LATAM).

Handles:
  Structural:   Título, Capítulo, Sección, Subsección, Artículo, Párrafo, Fracción
  Ordinal:      1º / 1ª (ordinal indicators, common in Spanish legal texts)
  Roman:        I II III … (upper and lower) — bare and parenthetical
  Parenthetical (a) / (i) / (I)
  Alpha:        (a)(b)(c) / (A)(B)(C) / bare  a)  b)
  Arabic:       bare integers and suffixed forms  1o  1a
  Latin suffixes: Bis, Ter, Quáter, Quinquies (common in Mexican/Spanish law)
  Dotted:       1. / 1.1 / 1.1.1 / 1.1.1.1
  Transitional: Transitorio / Transitoria / Disposición Transitoria
  Annexes:      Anexo / Apéndice

Notes on trailing-punctuation & case handling
---------------------------------------------
* All levelPatterns regexes use a trailing ``[.,;:\\-)\\s]*`` group so that
  identifiers like "3.", "IV.", "a)", "1-" are matched after the document
  processor strips them during path normalisation.
* Structural keyword patterns (TITULO, CAPITULO, …) use ``(?i)`` so that
  PRIMERA, Primera, and primera all match the same pattern.
* pathTransform cleanup rules now include a universal trailing-punctuation
  rule ``[.,;)\\-]+$`` applied to every level, ensuring  . , - )  are
  stripped from identifiers before they reach the path tree.
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition


# ── Roman numeral helpers ─────────────────────────────────────────────────────

_ROMAN_UPPER = r"M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})"
_ROMAN_LOWER = _ROMAN_UPPER.lower()

ROMAN_UPPER_PATTERN       = rf"^(?!$){_ROMAN_UPPER}[.,;\-\s]*$"
ROMAN_LOWER_PATTERN       = rf"^(?!$){_ROMAN_LOWER}[.,;\-\s]*$"
ROMAN_UPPER_PAREN_PATTERN = rf"^\((?!$){_ROMAN_UPPER}\)[.,;\-\s]*$"
ROMAN_LOWER_PAREN_PATTERN = rf"^\((?!$){_ROMAN_LOWER}\)[.,;\-\s]*$"

# Convenience shorthand aliases
ROMAN_PATTERN       = r"^\s*[IVXLCDM]+[.,;\-\s]*$"
ROMAN_LOWER_BARE    = r"^\s*[ivxlcdm]+[.,;)\-\s]*$"


# ── Latin suffix variants  (Bis|Ter|Quáter|Quinquies) ─────────────────────────

_SUFFIX = r"(?:\s+(?:Bis|Ter|Quáter|Quinquies))?"

# Trailing-punctuation group appended to every non-structural pattern
_TRAIL = r"[.,;:\-)\s]*"


# ── Structural heading patterns ───────────────────────────────────────────────

# Título  I / Título 1 / TÍTULO PRIMERO / título primero  (case-insensitive)
TITULO_PATTERN    = (
    r"(?i)^T[IÍ]TULO?"
    r"\s+(?:[IVXL]+|[0-9]+"
    r"|PRIMER[AO]?|SEGUND[AO]|TERCER[AO]"
    r"|CUART[AO]|QUINT[AO]|SEXT[AO]"
    r"|S[EÉ]PTIM[AO]|OCTAV[AO]|NOVEN[AO]|D[EÉ]CIM[AO])"
    rf"(?:\s+(?:Bis|bis|Ter|ter|Qu[aá]ter|qu[aá]ter|Quinquies|quinquies))?{_TRAIL}$"
)

# Capítulo  I / Capítulo 1 / CAPÍTULO ÚNICO  (case-insensitive)
CAPITULO_PATTERN  = (
    r"(?i)^CAP[IÍ]TULO?"
    r"\s+(?:[IVXL]+|[0-9]+|[ÚU]NIC[AO]?)"
    rf"(?:\s+(?:Bis|Ter|Qu[aá]ter|Quinquies))?{_TRAIL}$"
)

# Sección / Subsección  (case-insensitive; single pattern covers both)
SECCION_PATTERN   = (
    r"(?i)^(?:SUB)?SECCI[OÓ]N|SEC\."
    r"\s+(?:[IVXL]+|[0-9]+)"
    rf"(?:\s+(?:Bis|Ter|Qu[aá]ter|Quinquies))?{_TRAIL}$"
)

# Subsección alias
SUBSECCION_PATTERN = SECCION_PATTERN

# Artículo  1 / Art. 1 / Artículo 1º / Artículo 1 Bis  (case-insensitive)
ARTICULO_PATTERN  = (
    r"(?i)^Art(?:[IÍ]culo)?\.?\s*[0-9]+"
    r"\s*[ºª°]?"
    rf"(?:\s+(?:Bis|Ter|Qu[aá]ter|Quinquies))?"
    rf"(?:\s*[-–—]\s*.+)?{_TRAIL}$"
)

# Fracción  — Roman numeral sub-article divisions (Mexico)
FRACCION_PATTERN  = ROMAN_PATTERN

# Párrafo  / Párrafo primero  / § 1  (case-insensitive)
PARRAFO_PATTERN   = (
    r"(?i)^(?:P[AÁ]RRAFO|§)\s*"
    r"(?:[0-9]+\s*[ºª°]?|[ÚU]NIC[AO]?|PRIMER[AO]?|SEGUND[AO])"
    rf"{_TRAIL}$"
)

# Inciso  — lowercase alpha  a)  or  a.
INCISO_PATTERN    = r"^\s*[a-z][).]$"

# Inciso parenthetical  (a)
INCISO_PAREN_PATTERN = r"^\s*\([a-z]\)$"

# Ordinal  1º  2ª  3°  (trailing punctuation tolerated)
ORDINAL_PATTERN   = rf"^[0-9]+\s*[ºª°]{_TRAIL}$"

# Arabic with optional lowercase suffix  1o  2a  (colloquial ordinal)
ARABIC_SUFFIX_PATTERN = rf"^[0-9]+[oa]{_TRAIL}$"

# Bare Arabic  (trailing punctuation tolerated: "1." "2," etc.)
ARABIC_PATTERN    = rf"^\s*[0-9]+{_TRAIL}$"


# ── Dotted outline ────────────────────────────────────────────────────────────

DOTTED_1_PATTERN = rf"^[0-9]+\.{_TRAIL}$"
DOTTED_2_PATTERN = rf"^[0-9]+\.[0-9]+{_TRAIL}$"
DOTTED_3_PATTERN = rf"^[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$"
DOTTED_4_PATTERN = rf"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$"

# Dotted with Bis/Ter suffix  3.2 Bis
DOTTED_2_SUFFIX_PATTERN = rf"^[0-9]+\.[0-9]+{_SUFFIX}{_TRAIL}$"
DOTTED_3_SUFFIX_PATTERN = rf"^[0-9]+\.[0-9]+\.[0-9]+{_SUFFIX}{_TRAIL}$"


# ── Annexes / appendices  (case-insensitive) ──────────────────────────────────

ANEXO_PATTERN    = (
    r"(?i)^ANEXO\s+(?:[IVXL]+|[0-9]+|[A-Z]|[ÚU]NIC[AO]?)"
    rf"{_TRAIL}$"
)
APENDICE_PATTERN = (
    r"(?i)^AP[EÉ]NDICE\s+(?:[IVXL]+|[0-9]+|[A-Z])"
    rf"{_TRAIL}$"
)


# ── Latin alpha parenthetical ─────────────────────────────────────────────────

ALPHA_LOWER_PAREN_PATTERN = r"^\s*\([a-z]\)$"
ALPHA_UPPER_PAREN_PATTERN = r"^\s*\([A-Z]\)$"


# ── Transitional / closing provisions  (case-insensitive) ────────────────────

TRANSITORIO_PATTERN = (
    r"(?i)^(?:TRANSITORIOS?|TRANSITORIAS?|DISPOSICI[OÓ]N\s+TRANSITORIA)"
    rf"{_TRAIL}$"
)


# ── Ordinal word helpers (for level-pattern defaults) ────────────────────────

# Matches standalone Spanish ordinal words in any case:
# PRIMERA / Primera / primera, PRIMERO / Primero / primero, etc.
ORDINAL_WORD_PATTERN = (
    r"(?i)^\s*"                                    # optional leading space
    r"(?:\([0-9]+\)\s*)?"                        # optional (17) prefix
    r"(?:CUADRAGESIM[AO]|TRIGESIM[AO]|VIGESIM[AO]" # 40th, 30th, 20th
    r"|DECIMONOVEN[AO]|DECIMOCTAV[AO]"               # 19th, 18th
    r"|DECIMOSEPTIM[AO]|DECIMOSEXT[AO]"              # 17th, 16th
    r"|DECIMOQUINT[AO]|DECIMOCUART[AO]"              # 15th, 14th
    r"|DECIMOTERCER[AO]|DECIMOSEGUND[AO]"            # 13th, 12th
    r"|DECIMOPRIM[AEO][AO]?|DECIM[AO]"              # 11th, 10th
    r"|NOVEN[AO]|OCTAV[AO]|SEPTIM[AO]"              # 9th, 8th, 7th
    r"|SEXT[AO]|QUINT[AO]|CUART[AO]"                # 6th, 5th, 4th
    r"|TERCER[AO]|SEGUND[AO]|PRIMER[AO]?"           # 3rd, 2nd, 1st
    r"|[ÚU]NIC[AO])"                                # unique
    r"(?:\s+(?:BIS|bis)(?:\s+[0-9]+)?)?"          # optional Bis / Bis 1
    r"(?:\s+(?:PRIMER[AO]?|SEGUND[AO]|TERCER[AO]"  # compound: VIGESIMO PRIMERA
    r"|CUART[AO]|QUINT[AO]|SEXT[AO]|SEPTIM[AO]"    #   continued
    r"|OCTAV[AO]|NOVEN[AO]|DECIM[AO]))?"            #   continued
    r"(?:\s+(?:BIS|bis)(?:\s+[0-9]+)?)?"          # optional trailing Bis
    rf"{_TRAIL}$"
)


# ── Inference helper ──────────────────────────────────────────────────────────

def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    defn  = definition.lower()
    # Strip trailing punctuation from examples before probing so that
    # "OCTAVA."  "b)"  "ii."  "VI."  "1."  are normalised before matching.
    sample = [re.sub(r"[.,;:\-)\s]+$", "", ex.strip()) for ex in examples if ex and ex.strip()]
    sample = [re.sub(r"^\([0-9]+\)\s*", "", s) for s in sample]  # strip leading (17) etc.
    probe  = "\n".join(sample)

    # ── Structural keyword match ──────────────────────────────────────────────

    if re.search(r"título|titulo|title", defn, re.IGNORECASE):
        return [TITULO_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN, ORDINAL_WORD_PATTERN]

    if re.search(r"subsección|subseccion|subsection", defn, re.IGNORECASE):
        return [SECCION_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"sección|seccion|section", defn, re.IGNORECASE):
        return [SECCION_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"capítulo|capitulo|chapter", defn, re.IGNORECASE):
        return [CAPITULO_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN, ORDINAL_WORD_PATTERN]

    if re.search(r"artículo|articulo|article|art\b", defn, re.IGNORECASE):
        return [ARTICULO_PATTERN, ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"fracción|fraccion|fraction", defn, re.IGNORECASE):
        return [ROMAN_PATTERN]

    if re.search(r"párrafo|parrafo|paragraph|§", defn, re.IGNORECASE):
        return [PARRAFO_PATTERN, ARABIC_PATTERN, ORDINAL_PATTERN, ORDINAL_WORD_PATTERN]

    if re.search(r"inciso", defn, re.IGNORECASE):
        return [INCISO_PATTERN, INCISO_PAREN_PATTERN, ALPHA_LOWER_PAREN_PATTERN]

    # ── "Incrementing X" style definitions from BRD TOC tables ───────────────

    # "incrementing Spanish ordinal numbers" — e.g. PRIMERA, VIGESIMO SEGUNDA BIS 1
    if re.search(r"spanish\s+ordinal|ordinal\s+(number|word|heading)", defn, re.IGNORECASE):
        return [ORDINAL_WORD_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    # "Incrementing uppercase roman numerals"
    if re.search(r"uppercase\s+roman|roman.*upper|upper.*roman", defn, re.IGNORECASE):
        return [ROMAN_PATTERN]

    # "Incrementing lowercase roman numerals"
    if re.search(r"lowercase\s+roman|roman.*lower|lower.*roman", defn, re.IGNORECASE):
        return [ROMAN_LOWER_BARE]

    # "Incrementing lowercase letter" / "lowercase alphabetic"
    if re.search(r"lowercase\s+letter|lowercase\s+alpha|lower\s+letter", defn, re.IGNORECASE):
        return [ALPHA_LOWER_PAREN_PATTERN, INCISO_PATTERN, rf"^[a-z]+{_TRAIL}$"]

    # "Incrementing uppercase letter"
    if re.search(r"uppercase\s+letter|uppercase\s+alpha|upper\s+letter", defn, re.IGNORECASE):
        return [ALPHA_UPPER_PAREN_PATTERN, rf"^[A-Z]+{_TRAIL}$"]

    # "Incrementing number" / "arabic number" / plain digit
    if re.search(r"incrementing\s+number|arabic\s+num|whole\s+number|\binteger\b|\bdigit\b", defn, re.IGNORECASE):
        return [ARABIC_PATTERN]

    if re.search(r"item\b|numeral", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, DOTTED_2_PATTERN]

    if re.search(r"anexo|annex", defn, re.IGNORECASE):
        return [ANEXO_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"apéndice|apendice|appendix", defn, re.IGNORECASE):
        return [APENDICE_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"transitorio|transitoria|transitional|disposición transitoria", defn, re.IGNORECASE):
        return [TRANSITORIO_PATTERN, r"^.*$"]

    # ── Example-driven inference ──────────────────────────────────────────────

    if re.search(r"T[IÍ]TULO?", probe, re.IGNORECASE):
        return [TITULO_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN, ORDINAL_WORD_PATTERN]

    if re.search(r"CAP[IÍ]TULO?", probe, re.IGNORECASE):
        return [CAPITULO_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN, ORDINAL_WORD_PATTERN]

    if re.search(r"(?:SUB)?SECCI[OÓ]N", probe, re.IGNORECASE):
        return [SECCION_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"Art(?:[IÍ]culo)?\.?\s*[0-9]", probe, re.IGNORECASE):
        return [ARTICULO_PATTERN, ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"§\s*[0-9]", probe):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"ANEXO", probe, re.IGNORECASE):
        return [ANEXO_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"AP[EÉ]NDICE", probe, re.IGNORECASE):
        return [APENDICE_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"TRANSITORIO?A?S?", probe, re.IGNORECASE):
        return [TRANSITORIO_PATTERN, r"^.*$"]

    # Standalone ordinal words in examples (PRIMERA, VIGESIMO SEGUNDA, …)
    if re.search(
        r"PRIMER[AO]?|SEGUND[AO]|TERCER[AO]|CUART[AO]|QUINT[AO]"
        r"|SEXT[AO]|S[EÉ]PTIM[AO]|OCTAV[AO]|NOVEN[AO]|D[EÉ]CIM[AO]|[ÚU]NIC[AO]"
        r"|VIGESIM[AO]|TRIGESIM[AO]|CUADRAGESIM[AO]",
        probe,
        re.IGNORECASE,
    ):
        return [ORDINAL_WORD_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    # Compound ordinal with BIS suffix in examples: "DECIMOCTAVA BIS 1"
    if re.search(r"\bBIS\b", probe, re.IGNORECASE):
        return [ORDINAL_WORD_PATTERN, ROMAN_PATTERN, ARABIC_PATTERN]

    out: list[str] = []
    if any(re.search(r"[0-9]+\s*[ºª°]", ex) for ex in sample):
        out.extend([ORDINAL_PATTERN, ARABIC_PATTERN])
    if any(re.search(r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+", ex) for ex in sample):
        out.append(DOTTED_4_PATTERN)
    if any(re.search(r"^[0-9]+\.[0-9]+\.[0-9]+", ex) for ex in sample):
        out.extend([DOTTED_3_SUFFIX_PATTERN, DOTTED_3_PATTERN])
    if any(re.search(r"^[0-9]+\.[0-9]+", ex) for ex in sample):
        out.extend([DOTTED_2_SUFFIX_PATTERN, DOTTED_2_PATTERN])
    if any(re.search(r"^[0-9]+$", ex) for ex in sample):
        out.append(ARABIC_PATTERN)
    if any(re.search(r"^[IVXLCDM]+$", ex) for ex in sample):
        out.append(ROMAN_PATTERN)
    if any(re.search(r"^[ivxlcdm]+$", ex) for ex in sample):
        out.append(ROMAN_LOWER_BARE)
    if any(re.search(r"^\([IVXLCDM]+\)$", ex) for ex in sample):
        out.append(ROMAN_UPPER_PAREN_PATTERN)
    if any(re.search(r"^\([ivxlcdm]+\)$", ex) for ex in sample):
        out.append(ROMAN_LOWER_PAREN_PATTERN)
    if any(re.search(r"^\([a-z]\)$", ex) for ex in sample):
        out.append(ALPHA_LOWER_PAREN_PATTERN)
    if any(re.search(r"^\([A-Z]\)$", ex) for ex in sample):
        out.append(ALPHA_UPPER_PAREN_PATTERN)
    if any(re.search(r"^[a-z]$", ex) for ex in sample):
        out.append(rf"^[a-z]+{_TRAIL}$")
    if any(re.search(r"^[A-Z]$", ex) for ex in sample):
        out.append(rf"^[A-Z]+{_TRAIL}$")
    if any(re.search(r"^[0-9]+\.$", ex) for ex in sample):
        out.append(DOTTED_1_PATTERN)

    if out:
        return list(dict.fromkeys(out))

    # Catch-all
    return [r"^.*$"]


# ── Shared trailing-punctuation cleanup rule (applied to every level) ─────────
# Removes  .  ,  ;  )  -  and surrounding whitespace from the end of any token.
_TRAIL_CLEANUP = [r"[.,;)\-]+$", "", 0, ""]

# ── Public generator class ────────────────────────────────────────────────────

class SpanishPatternGenerator(PatternGeneratorBase):
    supported_languages = [
        "spanish",
        "español",
        "espanol",
        "es",
        "es-mx",   # Mexico
        "es-es",   # Spain
        "es-ar",   # Argentina
        "es-co",   # Colombia
        "es-cl",   # Chile
        "es-pe",   # Peru
        "es-ve",   # Venezuela
        "es-419",  # Latin America generic
        "castilian",
        "castellano",
    ]


    # Metajson defaults (edit Spanish metajson behavior here)
    SPANISH_META_DEFAULT_LEVEL_PATTERNS: dict[str, list[str]] = {
        "2":  ["^.*$"],
        "3":  [rf"^[0-9]+{_TRAIL}$"],
        "4":  [rf"^[0-9]+{_TRAIL}$"],
        "5":  [ROMAN_PATTERN],
        "6":  [ROMAN_PATTERN],
        "7":  ["^.*$"],
        "8":  [rf"^[0-9]+{_TRAIL}$"],
        "9":  [rf"^[0-9]+{_TRAIL}$", rf"^[0-9]+[a-z]+{_TRAIL}$"],
        "10": [
            rf"^[0-9]+\.[0-9]+{_TRAIL}$",
            rf"^[0-9]+\.[0-9]+\s+(?:Bis|Ter|Qu[aá]ter|Quinquies){_TRAIL}$",
            rf"^[0-9]+\.[0-9]+\s+(?:Bis|Ter|Qu[aá]ter|Quinquies)\s+[0-9]+{_TRAIL}$",
        ],
        "11": [
            rf"^[a-z]+{_TRAIL}$",
            rf"^[ivxl]+{_TRAIL}$",
            rf"^[0-9]+\.[0-9]+{_TRAIL}$",
            rf"^[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$",
            rf"^[0-9]+\.[0-9]+\.[0-9]+\s+(?:Bis|Ter|Qu[aá]ter|Quinquies){_TRAIL}$",
            rf"^[A-Z]+\s+[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$",
        ],
        "12": [
            rf"^[ivxl]+{_TRAIL}$",
            rf"^[a-z]+{_TRAIL}$",
            rf"^[IVXL]+{_TRAIL}$",
            rf"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$",
            rf"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\s+(?:Bis|Ter|Qu[aá]ter|Quinquies){_TRAIL}$",
            rf"^[A-Z]+\s+[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$",
        ],
        "13": [
            rf"^[a-z]+{_TRAIL}$",
            rf"^[A-Z]+\s+[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+{_TRAIL}$",
        ],
        "14": [
            rf"^[IVXL]+{_TRAIL}$",
            rf"^[ivxl]+{_TRAIL}$",
            rf"^[A-Z]+{_TRAIL}$",
            rf"^[IVXL]+\.\s+(?:Bis|Ter|Qu[aá]ter|Quinquies){_TRAIL}$",
            rf"^[IVXL]+\s+(?:Bis|Ter|Qu[aá]ter|Quinquies){_TRAIL}$",
        ],
        "15": [rf"^[a-z]+{_TRAIL}$", rf"^[IVXL]+{_TRAIL}$"],
        "16": [rf"^[ivxl]+{_TRAIL}$", rf"^[0-9]+{_TRAIL}$"],
        "17": [rf"^[ivxl]+{_TRAIL}$", rf"^[0-9]+{_TRAIL}$"],
        "18": [rf"^[a-z]+{_TRAIL}$"],
        "19": ["^.*$"],
        "20": ["^.*$"],
    }

    SPANISH_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
        # ── How rules work ────────────────────────────────────────────────────
        # Each entry is [find_regex, replacement, re_flags, extra].
        # Rules are applied sequentially via re.sub(find, replacement, token).
        # Three shared rules run first on every level:
        #   1. [r"^\s+", "", 0, ""]      strip leading whitespace
        #   2. [r"\s*\.-$", "", 0, ""]   strip compound  .-  suffix
        #   3. [r"[.,;)\-]+$", "", 0, ""] strip remaining trailing punct
        #
        # Level 3 (ordinal-word headings: PRIMERA, VIGESIMO PRIMERA Bis, …):
        # After punctuation stripping the token is ALL-CAPS.
        # We normalise case with explicit word rules covering all observed tokens.
        "3":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            [r"^\([0-9]+\)\s*", "", 0, ""],   # strip leading (17) / (19) etc.
            # ── Ordinal words: ALLCAPS → Title case ───────────────────────────
            ["(?i)\\bCUADRAGESIMO\\b",  "Cuadragesimo",  0, ""],
            ["(?i)\\bCUADRAGESIMA\\b",  "Cuadragesima",  0, ""],
            ["(?i)\\bTRIGESIMO\\b",     "Trigesimo",     0, ""],
            ["(?i)\\bTRIGESIMA\\b",     "Trigesima",     0, ""],
            ["(?i)\\bVIGESIMO\\b",      "Vigesimo",      0, ""],
            ["(?i)\\bVIGESIMA\\b",      "Vigesima",      0, ""],
            ["(?i)\\bDECIMONOVENA\\b",  "Decimonovena",  0, ""],
            ["(?i)\\bDECIMOCTAVA\\b",   "Decimoctava",   0, ""],
            ["(?i)\\bDECIMOSEPTIMA\\b", "Decimoseptima", 0, ""],
            ["(?i)\\bDECIMOSEXTA\\b",   "Decimosexta",   0, ""],
            ["(?i)\\bDECIMOQUINTA\\b",  "Decimoquinta",  0, ""],
            ["(?i)\\bDECIMOCUARTA\\b",  "Decimocuarta",  0, ""],
            ["(?i)\\bDECIMOTERCERA\\b", "Decimotercera", 0, ""],
            ["(?i)\\bDECIMOSEGUNDA\\b", "Decimosegunda", 0, ""],
            ["(?i)\\bDECIMOPRIMERA\\b", "Decimoprimera", 0, ""],
            ["(?i)\\bDECIMA\\b",        "Decima",        0, ""],
            ["(?i)\\bNOVENA\\b",        "Novena",        0, ""],
            ["(?i)\\bOCTAVA\\b",        "Octava",        0, ""],
            ["(?i)\\bSEPTIMA\\b",       "Septima",       0, ""],
            ["(?i)\\bSEXTA\\b",         "Sexta",         0, ""],
            ["(?i)\\bQUINTA\\b",        "Quinta",        0, ""],
            ["(?i)\\bCUARTA\\b",        "Cuarta",        0, ""],
            ["(?i)\\bTERCERA\\b",       "Tercera",       0, ""],
            ["(?i)\\bSEGUNDA\\b",       "Segunda",       0, ""],
            ["(?i)\\bPRIMERA\\b",       "Primera",       0, ""],
            # ── Masculine ordinals (used in VIGESIMO, etc.) ───────────────────
            ["(?i)\\bPRIMERO\\b",       "Primero",       0, ""],
            ["(?i)\\bSEGUNDO\\b",       "Segundo",       0, ""],
            ["(?i)\\bTERCERO\\b",       "Tercero",       0, ""],
            ["(?i)\\bCUARTO\\b",        "Cuarto",        0, ""],
            ["(?i)\\bQUINTO\\b",        "Quinto",        0, ""],
            ["(?i)^[ÚU]NIC[AO]$",       "Único",         0, ""],
            ["(?i)\\bANEXO\\b",         "Anexo",         0, ""],
            ["(?i)\\bBIS\\b",           "Bis",           0, ""],
        ],
        "4":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)T[IÍ]TULO",           "Tít.",          0, ""],
            ["(?i)^PRIMERO$",           "Primero",       0, ""],
            ["(?i)^SEGUNDO$",           "Segundo",       0, ""],
            ["(?i)^TERCERO$",           "Tercero",       0, ""],
            ["(?i)^CUARTO$",            "Cuarto",        0, ""],
            ["(?i)^QUINTO$",            "Quinto",        0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
        ],
        "5":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)CAP[IÍ]TULO",         "Cap.",          0, ""],
            ["(?i)^BIS$",               "Bis",           0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
        ],
        "6":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)SECCI[OÓ]N",          "Sec.",          0, ""],
            ["(?i)^BIS$",               "Bis",           0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
        ],
        "7":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)^BIS$",               "Bis",           0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
        ],
        "8":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
        ],
        "9":  [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)Art(?:[IÍ]culo)?\.?\\s*", "", 0, ""],   # strip Art./Artículo prefix entirely
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["(?i)^o$",                 "",              0, ""],
            ["[ºª°]",                   "",              0, ""],
        ],
        "10": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
        ],
        "11": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"^\(([a-zA-Z0-9]+)\)$", "\\1", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "12": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"^\(([a-zA-Z0-9]+)\)$", "\\1", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "13": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"^\(([a-zA-Z0-9]+)\)$", "\\1", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "14": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"^\(([a-zA-Z0-9]+)\)$", "\\1", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "15": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"^\(([a-zA-Z0-9]+)\)$", "\\1", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["\\([0-9]+\\)",            "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "17": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)^TRANSITORIOS$",      "Transitorios",  0, ""],
            ["(?i)^TRANSITORIO$",       "Transitorio",   0, ""],
            ["(?i)^TRANSITORIA$",       "Transitoria",   0, ""],
            ["(?i)^TRANSITORIAS$",      "Transitorias",  0, ""],
            ["(?i)^CONSIDERANDO$",      "Considerando",  0, ""],
            ["(?i)^REFERENCIAS$",       "Referencias",   0, ""],
            ["(?i)^ANEXO$",             "Anexo",         0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "18": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["(?i)^[ÚU]NIC[AO]$",       "Único",         0, ""],
            ["(?i)^PRIMERA?$",          "Primera",       0, ""],
            ["(?i)^SEGUNDA?$",          "Segunda",       0, ""],
            ["(?i)^TERCERA?$",          "Tercera",       0, ""],
            ["(?i)^CUARTA?$",           "Cuarta",        0, ""],
            ["(?i)^QUINTA?$",           "Quinta",        0, ""],
            ["(?i)^SEXTA?$",            "Sexta",         0, ""],
            ["(?i)^PRIMERO$",           "Primero",       0, ""],
            ["(?i)^SEGUNDO$",           "Segundo",       0, ""],
            ["(?i)^TERCERO$",           "Tercero",       0, ""],
            ["(?i)^CUARTO$",            "Cuarto",        0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "19": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
        "20": [
            [r"^\s+", "", 0, ""],
            [r"\s*\.-$", "", 0, ""],
            [r"[.,;)\-]+$", "", 0, ""],
            ["\\([0-9]+\\) ",           "",              0, ""],
            ["^([^(].*)\\)$",           "\\1",           0, ""],
        ],
    }
    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result = {}
        for lvl in levels:
            result[str(lvl.level)] = _infer_pattern(lvl.definition, lvl.examples)
        return result


# Module-level aliases used by metajson assembler imports.
SPANISH_META_DEFAULT_LEVEL_PATTERNS = SpanishPatternGenerator.SPANISH_META_DEFAULT_LEVEL_PATTERNS
SPANISH_PATH_TRANSFORM_CLEANUP = SpanishPatternGenerator.SPANISH_PATH_TRANSFORM_CLEANUP