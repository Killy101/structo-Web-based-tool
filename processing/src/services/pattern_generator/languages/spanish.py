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
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition


# ── Roman numeral helpers ─────────────────────────────────────────────────────

_ROMAN_UPPER = r"M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})"
_ROMAN_LOWER = _ROMAN_UPPER.lower()

ROMAN_UPPER_PATTERN       = rf"^(?!$){_ROMAN_UPPER}$"
ROMAN_LOWER_PATTERN       = rf"^(?!$){_ROMAN_LOWER}$"
ROMAN_UPPER_PAREN_PATTERN = rf"^\((?!$){_ROMAN_UPPER}\)$"
ROMAN_LOWER_PAREN_PATTERN = rf"^\((?!$){_ROMAN_LOWER}\)$"

# Convenience shorthand aliases
ROMAN_PATTERN       = r"^[IVXLCDM]+$"
ROMAN_LOWER_BARE    = r"^[ivxlcdm]+$"


# ── Latin suffix variants  (Bis|Ter|Quáter|Quinquies) ─────────────────────────

_SUFFIX = r"(?:\s+(?:Bis|Ter|Quáter|Quinquies))?"


# ── Structural heading patterns ───────────────────────────────────────────────

# Título  I / Título 1 / TÍTULO PRIMERO
TITULO_PATTERN    = (
    r"^(?:TÍTULO|Título|TITULO|Titulo)"
    r"\s+(?:[IVXL]+|[0-9]+|PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO"
    r"|SEXTO|SÉPTIMO|OCTAVO|NOVENO|DÉCIMO)"
    rf"{_SUFFIX}$"
)

# Capítulo  I / Capítulo 1 / CAPÍTULO ÚNICO
CAPITULO_PATTERN  = (
    r"^(?:CAPÍTULO|Capítulo|CAPITULO|Capitulo)"
    r"\s+(?:[IVXL]+|[0-9]+|ÚNICO|Único|UNICO)"
    rf"{_SUFFIX}$"
)

# Sección  1 / Sección I
SECCION_PATTERN   = (
    r"^(?:SECCIÓN|Sección|SECCION|Seccion|SEC\.?)"
    r"\s+(?:[IVXL]+|[0-9]+)"
    rf"{_SUFFIX}$"
)

# Subsección
SUBSECCION_PATTERN = (
    r"^(?:SUBSECCIÓN|Subsección|SUBSECCION|Subseccion)"
    r"\s+(?:[IVXL]+|[0-9]+)"
    rf"{_SUFFIX}$"
)

# Artículo  1 / Art. 1 / Artículo 1º / Artículo 1 Bis
ARTICULO_PATTERN  = (
    r"^(?:Art(?:ículo|iculo|\.)?)\s*[0-9]+"
    r"\s*[ºª°]?"
    rf"{_SUFFIX}"
    r"(?:\s*[-–—]\s*.+)?$"
)

# Fracción  — Roman numeral sub-article divisions (Mexico)
FRACCION_PATTERN  = ROMAN_PATTERN

# Párrafo  / Párrafo primero  / § 1
PARRAFO_PATTERN   = r"^(?:Párrafo|PÁRRAFO|Parrafo|§)\s*(?:[0-9]+\s*[ºª°]?|[Úú]nico|primero|segundo)$"

# Inciso  — lowercase alpha  a)  or  a.
INCISO_PATTERN    = r"^[a-z][).]$"

# Inciso parenthetical  (a)
INCISO_PAREN_PATTERN = r"^\([a-z]\)$"

# Ordinal  1º  2ª  3°
ORDINAL_PATTERN   = r"^[0-9]+\s*[ºª°]$"

# Arabic with optional lowercase suffix  1o  2a  (colloquial ordinal)
ARABIC_SUFFIX_PATTERN = r"^[0-9]+[oa]$"

# Bare Arabic
ARABIC_PATTERN    = r"^[0-9]+$"


# ── Dotted outline ────────────────────────────────────────────────────────────

DOTTED_1_PATTERN = r"^[0-9]+\.$"
DOTTED_2_PATTERN = r"^[0-9]+\.[0-9]+$"
DOTTED_3_PATTERN = r"^[0-9]+\.[0-9]+\.[0-9]+$"
DOTTED_4_PATTERN = r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$"

# Dotted with Bis/Ter suffix  3.2 Bis
DOTTED_2_SUFFIX_PATTERN = rf"^[0-9]+\.[0-9]+{_SUFFIX}$"
DOTTED_3_SUFFIX_PATTERN = rf"^[0-9]+\.[0-9]+\.[0-9]+{_SUFFIX}$"


# ── Annexes / appendices ──────────────────────────────────────────────────────

ANEXO_PATTERN    = r"^(?:ANEXO|Anexo)\s+(?:[IVXL]+|[0-9]+|[A-Z]|Único|ÚNICO)$"
APENDICE_PATTERN = r"^(?:APÉNDICE|Apéndice|APENDICE|Apendice)\s+(?:[IVXL]+|[0-9]+|[A-Z])$"


# ── Latin alpha parenthetical ─────────────────────────────────────────────────

ALPHA_LOWER_PAREN_PATTERN = r"^\([a-z]\)$"
ALPHA_UPPER_PAREN_PATTERN = r"^\([A-Z]\)$"


# ── Transitional / closing provisions ────────────────────────────────────────

TRANSITORIO_PATTERN = r"^(?:TRANSITORIO|Transitorio|TRANSITORIA|Transitoria|TRANSITORIOS|Transitorios|TRANSITORIAS|Transitorias|Disposici[oó]n Transitoria)$"


# ── Inference helper ──────────────────────────────────────────────────────────

def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    defn  = definition.lower()
    sample = [ex.strip() for ex in examples if ex and ex.strip()]
    probe = "\n".join(sample)
    first = sample[0] if sample else ""

    # ── Structural keyword match ──────────────────────────────────────────────

    if re.search(r"título|titulo|title", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"subsección|subseccion|subsection", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"sección|seccion|section", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"capítulo|capitulo|chapter", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"artículo|articulo|article|art\b", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"fracción|fraccion|fraction", defn, re.IGNORECASE):
        return [ROMAN_PATTERN]

    if re.search(r"párrafo|parrafo|paragraph|§", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"inciso", defn, re.IGNORECASE):
        return [INCISO_PATTERN, INCISO_PAREN_PATTERN, ALPHA_LOWER_PAREN_PATTERN]

    if re.search(r"item\b|numeral", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, DOTTED_2_PATTERN]

    if re.search(r"anexo|annex", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"apéndice|apendice|appendix", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"transitorio|transitoria|transitional|disposición transitoria", defn, re.IGNORECASE):
        return [TRANSITORIO_PATTERN, r"^.*$"]

    # ── Example-driven inference ──────────────────────────────────────────────

    if re.search(r"TÍTULO|Título", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"CAPÍTULO|Capítulo|CAPITULO", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"SECCIÓN|Sección|SECCION", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"Art(?:ículo|iculo|\.)?\.?\s*[0-9]", probe, re.IGNORECASE):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"§\s*[0-9]", probe):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"ANEXO|Anexo", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"APÉ?NDICE|Apé?ndice", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    # Transitional keywords inside example text
    if re.search(r"Transitorio|Transitoria", probe, re.IGNORECASE):
        return [TRANSITORIO_PATTERN, r"^.*$"]

    out: list[str] = []
    if any(re.search(r"[0-9]+\s*[ºª°]", ex) for ex in sample):
        out.extend([ORDINAL_PATTERN, ARABIC_PATTERN])
    if any(re.search(r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+", ex) for ex in sample):
        out.append(DOTTED_4_PATTERN)
    if any(re.search(r"^[0-9]+\.[0-9]+\.[0-9]+", ex) for ex in sample):
        out.extend([DOTTED_3_SUFFIX_PATTERN, DOTTED_3_PATTERN])
    if any(re.search(r"^[0-9]+\.[0-9]+", ex) for ex in sample):
        out.extend([DOTTED_2_SUFFIX_PATTERN, DOTTED_2_PATTERN])
    if any(re.search(r"^[0-9]+\.$", ex) for ex in sample):
        out.append(DOTTED_1_PATTERN)
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
    if any(re.search(r"^[a-z]\)$", ex) for ex in sample):
        out.append(INCISO_PATTERN)
    if any(re.search(r"^[0-9]+[oa]$", ex) for ex in sample):
        out.extend([ARABIC_SUFFIX_PATTERN, ARABIC_PATTERN])
    if any(re.search(r"^[0-9]+$", ex) for ex in sample):
        out.append(ARABIC_PATTERN)

    if out:
        return list(dict.fromkeys(out))

    # Catch-all
    return [r"^.*$"]


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
        "3":  ["[0-9]+$"],
        "4":  ["[0-9]+$"],
        "5":  ["[IVXL]+$"],
        "6":  ["[IVXL]+$"],
        "7":  ["^.*$"],
        "8":  ["[0-9]+$"],
        "9":  ["[0-9]+$", "[0-9]+[a-z]+$"],
        "10": ["[0-9]+\\.[0-9]$",
            "[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies$)$",
            "[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies$) [0-9]+$"],
        "11": ["[a-z]+$", "[ivxl]+$",
            "[0-9]+\\.[0-9]+$", "[0-9]+\\.[0-9]+\\.[0-9]+$",
            "[0-9]+\\.[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies$)$",
            "[A-Z]+ [0-9]+\\.[0-9]+\\.[0-9]+$"],
        "12": ["[ivxl]+$", "[a-z]+$", "[IVXL]+$",
            "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$",
            "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies$)$",
            "[A-Z]+ [0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"],
        "13": ["[a-z]+$",
            "[A-Z]+ [0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"],
        "14": ["[IVXL]+$", "[ivxl]+$", "[A-Z]+$",
            "[IVXL]+\\. (Bis|Ter|Quáter|Quinquies$)",
            "[IVXL]+ (Bis|Ter|Quáter|Quinquies)$"],
        "15": ["[a-z]+$", "[IVXL]+$"],
        "16": ["[ivxl]+$", "[0-9]+$"],
        "17": ["[ivxl]+$", "[0-9]+$"],
        "18": ["[a-z]+$"],
        "19": ["^.*$"],
        "20": ["^.*$"],
    }

    SPANISH_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
        "3":  [["ANEXO", "Anexo", 0, ""], ["BIS", "Bis", 0, ""], ["ÚNICO", "Único", 0, ""], ["\\.—$", "", 0, ""]],
        "4":  [["TÍTULO|Título", "Tít.", 0, ""], ["PRIMERO", "Primero", 0, ""], ["SEGUNDO", "Segundo", 0, ""], ["TERCERO", "Tercero", 0, ""], ["CUARTO", "Cuarto", 0, ""], ["QUINTO", "Quinto", 0, ""], ["\\([0-9]+\\) ", "", 0, ""], ["\\.—$", "", 0, ""]],
        "5":  [["CAPÍTULO|CAPITULO|Capítulo", "Cap.", 0, ""], ["BIS", "Bis", 0, ""], ["\\([0-9]+\\) ", "", 0, ""], ["\\.—$", "", 0, ""]],
        "6":  [["Sección", "Sec.", 0, ""], ["\\([0-9]+\\) ", "", 0, ""], ["BIS", "Bis", 0, ""], ["\\.—$", "", 0, ""]],
        "7":  [["\\([0-9]+\\) ", "", 0, ""], ["BIS", "Bis", 0, ""], ["\\.—$", "", 0, ""]],
        "9":  [["Artículo", "Art.", 0, ""], ["\\([0-9]+\\) ", "", 0, ""], ["\\.-$", "", 0, ""], ["o", "", 0, ""], ["º", "", 0, ""], ["°", "", 0, ""], ["º.-$", "", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "10": [["\\([0-9]+\\) ", "", 0, ""], ["\\.-$", "", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "11": [["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "12": [["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "13": [["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "14": [["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "15": [["\\([0-9]+\\) ", "", 0, ""], ["\\([0-9]+\\)", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "17": [["TRANSITORIOS", "Transitorios", 0, ""], ["TRANSITORIO", "Transitorio", 0, ""], ["TRANSITORIA", "Transitoria", 0, ""], ["TRANSITORIAS", "Transitorias", 0, ""], ["CONSIDERANDO", "Considerando", 0, ""], ["REFERENCIAS", "Referencias", 0, ""], ["\\([0-9]+\\) ", "", 0, ""], ["ANEXO", "Anexo", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "18": [["ÚNICO", "Único", 0, ""], ["PRIMERA", "Primera", 0, ""], ["SEGUNDA", "Segunda", 0, ""], ["TERCERA", "Tercera", 0, ""], ["CUARTA", "Cuarta", 0, ""], ["QUINTA", "Quinta", 0, ""], ["SEXTA", "Sexta", 0, ""], ["UNICA", "Unica", 0, ""], ["PRIMERO", "Primero", 0, ""], ["SEGUNDO", "Segundo", 0, ""], ["TERCERO", "Tercero", 0, ""], ["CUARTO", "Cuarto", 0, ""], ["ÚNICA", "Única", 0, ""], ["UNICO", "Unico", 0, ""], ["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["\\.-$", "", 0, ""], ["\\. -$", "", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "19": [["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "20": [["\\([0-9]+\\) ", "", 0, ""], ["^([^(].*)\\)$", "\\1", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
    }

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result = {}
        for lvl in levels:
            result[str(lvl.level)] = _infer_pattern(lvl.definition, lvl.examples)
        return result


# Module-level aliases used by metajson assembler imports.
SPANISH_META_DEFAULT_LEVEL_PATTERNS = SpanishPatternGenerator.SPANISH_META_DEFAULT_LEVEL_PATTERNS
SPANISH_PATH_TRANSFORM_CLEANUP = SpanishPatternGenerator.SPANISH_PATH_TRANSFORM_CLEANUP