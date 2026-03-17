"""
portuguese.py
-------------
Pattern generator for Portuguese-language documents (Brazil PT-BR + Portugal PT-PT).

Handles:
  Structural:   Título, Capítulo, Seção/Secção, Subseção, Artigo, Parágrafo
  Ordinal:      1º / 1ª (ordinal indicators)
  Roman:        I II III ... (upper and lower)  — bare and parenthetical
  Parenthetical (a) / (i) / (I)
  Tian-shaped:  1. / 1.1 / 1.1.1 / 1.1.1.1  (dotted outline)
  Alpha:        (a)(b)(c) / (A)(B)(C)
  Arabic:       bare integers
  Annexes:      Anexo / Apêndice / Complementar
  Transitional: Transitório / Disposição Transitória
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition


# ── Roman numeral sets ────────────────────────────────────────────────────────

_ROMAN_UPPER = r"M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})"
_ROMAN_LOWER = _ROMAN_UPPER.lower()

# Non-empty guard (avoids matching empty string)
ROMAN_UPPER_PATTERN       = rf"^(?!$){_ROMAN_UPPER}$"
ROMAN_LOWER_PATTERN       = rf"^(?!$){_ROMAN_LOWER}$"

# Parenthetical  (I)  (i)
ROMAN_UPPER_PAREN_PATTERN = rf"^\((?!$){_ROMAN_UPPER}\)$"
ROMAN_LOWER_PAREN_PATTERN = rf"^\((?!$){_ROMAN_LOWER}\)$"

# Convenience aliases used in levelPatterns JSON
ROMAN_PATTERN             = r"^[IVXLCDM]+$"
ROMAN_LOWER_BARE_PATTERN  = r"^[ivxlcdm]+$"


# ── Structural heading patterns ───────────────────────────────────────────────

# Título  I / Título 1 / TÍTULO I
TITULO_PATTERN    = r"^(?:TÍTULO|Título|titulo)\s+(?:[IVXL]+|[0-9]+)$"

# Capítulo  I / Capítulo 1 / CAPÍTULO I
CAPITULO_PATTERN  = r"^(?:CAPÍTULO|Capítulo|CAPITULO|Capitulo)\s+(?:[IVXL]+|[0-9]+)$"

# Seção / Secção  I / 1
# FIX: was Se[çc][ão]o — wrong character class for the ã/a vowel.
SECAO_PATTERN     = r"^(?:SE[ÇC][ÃA]O|Se[çc][ãa]o)\s+(?:[IVXL]+|[0-9]+)$"

# Subseção
SUBSECAO_PATTERN  = r"^(?:Subse[çc][ãa]o|SUBSE[ÇC][ÃA]O)\s+(?:[IVXL]+|[0-9]+)$"

# Artigo  1º / Art. 1 / Artigo 1
ARTIGO_PATTERN    = (
    r"^(?:Artigo|ARTIGO|Art\.?)\s*[0-9]+\s*[ºª°]?"
    r"(?:\s*[-–]\s*.+)?$"
)

# Parágrafo  1º / § 1º / Parágrafo único
PARAGRAFO_PATTERN = r"^(?:Parágrafo|PARÁGRAFO|§)\s*(?:[0-9]+\s*[ºª°]?|[Úú]nico)$"

# Inciso  — uppercase Roman in body (I, II, III …)
INCISO_PATTERN    = ROMAN_PATTERN          # reuse bare upper Roman

# Alínea — lowercase alpha with dot  a.  b.  c.   (BRD standard)
ALINEA_DOT_PATTERN   = r"^[a-z]\.$"
# Alínea — lowercase alpha with paren  a)  b)      (alternate form)
ALINEA_PAREN_PATTERN = r"^[a-z]\)$"
# Alínea parenthetical  (a) (b)
ALINEA_FULL_PAREN_PATTERN = r"^\([a-z]\)$"

# Item — lowercase Roman with dot  i.  ii.  iii.   (BRD standard)
ITEM_ROMAN_DOT_PATTERN   = r"^[ivxlcdm]+\.$"
# Item — lowercase Roman bare  i  ii  iii
ITEM_ROMAN_BARE_PATTERN  = r"^[ivxlcdm]+$"

# Arabic digit bare
ITEM_ARABIC_PATTERN = r"^[0-9]+$"

# Ordinal  1º  2ª  3°
ORDINAL_PATTERN  = r"^[0-9]+\s*[ºª°]$"


# ── Annexes / appendices ──────────────────────────────────────────────────────

# ANEXO I / Anexo I / Anexo Único / ANEXO COMPLEMENTAR I
ANEXO_PATTERN    = r"^(?:ANEXO|Anexo)(?:\s+COMPLEMENTAR)?\s+(?:[IVXL]+|[0-9]+|[A-Z]|Único)$"

# APÊNDICE Nº 1 / Apêndice I / APÊNDICE Único
# FIX: added Nº\s+[0-9]+ variant to cover the "APÊNDICE Nº + number" BRD form.
APENDICE_PATTERN = (
    r"^(?:APÊ?NDICE|Apê?ndice)"
    r"(?:\s+Nº\s+[0-9]+|\s+(?:[IVXL]+|[0-9]+|[A-Z]|Único))$"
)


# ── Dotted outline  1. / 1.1 / 1.1.1 / 1.1.1.1 ───────────────────────────────

DOTTED_1_PATTERN = r"^[0-9]+\.$"
DOTTED_2_PATTERN = r"^[0-9]+\.[0-9]+$"
DOTTED_3_PATTERN = r"^[0-9]+\.[0-9]+\.[0-9]+$"
DOTTED_4_PATTERN = r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$"


# ── Latin alpha parenthetical ─────────────────────────────────────────────────

ALPHA_LOWER_PAREN_PATTERN = r"^\([a-z]\)$"
ALPHA_UPPER_PAREN_PATTERN = r"^\([A-Z]\)$"


# ── Arabic / full-width ───────────────────────────────────────────────────────

ARABIC_PATTERN = r"^[0-9]+$"


# ── Inference helper ──────────────────────────────────────────────────────────

def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    defn   = definition.lower()
    sample = [ex.strip() for ex in examples if ex and ex.strip()]
    probe  = "\n".join(sample)

    # ── Structural keywords (definition-driven) ───────────────────────────────

    if re.search(r"título|titulo|title", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"capítulo|capitulo|chapter", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"subse[çc][ãa]o|subsection", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"se[çc][ãa]o|section|sec[çc][ãa]o", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"artigo|article|art\b", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"parágrafo|paragrafo|§|paragraph", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"inciso", defn, re.IGNORECASE):
        return [ROMAN_PATTERN]

    if re.search(r"alínea|alinea", defn, re.IGNORECASE):
        # Prefer dot form (BRD standard) but include paren variants as fallback
        return [ALINEA_DOT_PATTERN, ALINEA_PAREN_PATTERN, ALINEA_FULL_PAREN_PATTERN]

    if re.search(r"item\b", defn, re.IGNORECASE):
        return [ARABIC_PATTERN, DOTTED_2_PATTERN]

    if re.search(r"anexo|annex", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"apêndice|apendice|appendix", defn, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"transitório|transitorios|transitional", defn, re.IGNORECASE):
        return [r"^.*$"]

    # ── Example / definition text-driven inference ────────────────────────────

    # Título / Capítulo heading in example text
    if re.search(r"TÍTULO|Título", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"CAPÍTULO|Capítulo|CAPITULO", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"SE[ÇC][ÃA]O|Se[çc][ãa]o", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"Art(?:igo)?\.?\s*[0-9]", probe, re.IGNORECASE):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"§\s*[0-9]", probe):
        return [ARABIC_PATTERN, ORDINAL_PATTERN]

    if re.search(r"ANEXO|Anexo", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    if re.search(r"APÊ?NDICE|Apê?ndice", probe, re.IGNORECASE):
        return [ROMAN_PATTERN, ARABIC_PATTERN]

    # ── Dot-form roman / alpha sub-levels (BRD levels 12-16 style) ───────────
    # Check for "lowercase roman" / "lowercase letter" in definition text
    if re.search(r"lowercase roman|roman.{0,20}lower|lower.{0,20}roman", defn, re.IGNORECASE):
        return [ITEM_ROMAN_DOT_PATTERN, ITEM_ROMAN_BARE_PATTERN]

    if re.search(r"lowercase letter|lower.{0,20}letter|letter.{0,20}lower", defn, re.IGNORECASE):
        return [ALINEA_DOT_PATTERN, ALINEA_PAREN_PATTERN, ALINEA_FULL_PAREN_PATTERN]

    if re.search(r"uppercase roman|roman.{0,20}upper|upper.{0,20}roman", defn, re.IGNORECASE):
        return [ROMAN_PATTERN]

    # "incrementing number with one decimal" → dotted-2
    if re.search(r"decimal|one decimal|\.[0-9]", defn, re.IGNORECASE):
        return [DOTTED_2_PATTERN, DOTTED_3_PATTERN]

    # "incrementing number" (bare) → dotted-1 then arabic
    if re.search(r"incrementing number|incrementing arabic|número incremental", defn, re.IGNORECASE):
        return [DOTTED_1_PATTERN, ARABIC_PATTERN]

    # ── Sample-driven fallback ────────────────────────────────────────────────

    out: list[str] = []
    if any(re.search(r"[0-9]+\s*[ºª°]", ex) for ex in sample):
        out.extend([ORDINAL_PATTERN, ARABIC_PATTERN])
    if any(re.search(r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+", ex) for ex in sample):
        out.append(DOTTED_4_PATTERN)
    if any(re.search(r"^[0-9]+\.[0-9]+\.[0-9]+", ex) for ex in sample):
        out.append(DOTTED_3_PATTERN)
    if any(re.search(r"^[0-9]+\.[0-9]+", ex) for ex in sample):
        out.append(DOTTED_2_PATTERN)
    if any(re.search(r"^[0-9]+\.$", ex) for ex in sample):
        out.append(DOTTED_1_PATTERN)
    if any(re.search(r"^[IVXLCDM]+$", ex) for ex in sample):
        out.append(ROMAN_PATTERN)
    if any(re.search(r"^[ivxlcdm]+\.$", ex) for ex in sample):
        out.append(ITEM_ROMAN_DOT_PATTERN)
    if any(re.search(r"^[ivxlcdm]+$", ex) for ex in sample):
        out.append(ITEM_ROMAN_BARE_PATTERN)
    if any(re.search(r"^\([IVXLCDM]+\)$", ex) for ex in sample):
        out.append(ROMAN_UPPER_PAREN_PATTERN)
    if any(re.search(r"^\([ivxlcdm]+\)$", ex) for ex in sample):
        out.append(ROMAN_LOWER_PAREN_PATTERN)
    if any(re.search(r"^\([a-z]\)$", ex) for ex in sample):
        out.append(ALPHA_LOWER_PAREN_PATTERN)
    if any(re.search(r"^\([A-Z]\)$", ex) for ex in sample):
        out.append(ALPHA_UPPER_PAREN_PATTERN)
    if any(re.search(r"^[a-z]\.$", ex) for ex in sample):
        out.append(ALINEA_DOT_PATTERN)
    if any(re.search(r"^[a-z]\)$", ex) for ex in sample):
        out.append(ALINEA_PAREN_PATTERN)
    if any(re.search(r"^[0-9]+$", ex) for ex in sample):
        out.append(ARABIC_PATTERN)

    if out:
        return list(dict.fromkeys(out))

    # Catch-all
    return [r"^.*$"]


# ── Public generator class ────────────────────────────────────────────────────

class PortuguesePatternGenerator(PatternGeneratorBase):
    supported_languages = [
        "portuguese",
        "portuguese (brazil)",
        "portuguese (portugal)",
        "pt",
        "pt-br",
        "pt-pt",
        "pt-ao",   # Angola
        "pt-mz",   # Mozambique
        "brasilian portuguese",
        "brazilian portuguese",
        "european portuguese",
    ]

    # Metajson defaults (edit Portuguese metajson behavior here)
    PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS: dict[str, list[str]] = {
        "2":  ["^.*$"],
        "3":  ["^(?:TÍTULO|Título|TITULO|Titulo)\\s+(?:[IVXL]+|[0-9]+)$", "[IVXL]+$"],
        "4":  ["^.*$"],
        "5":  ["^(?:ANEXO|Anexo)(?:\\s+COMPLEMENTAR)?\\s+(?:[IVXL]+|[0-9]+|[A-Z]|[Úú]nico)$", "[IVXL]+$"],
        "6":  ["^(?:APÊ?NDICE|Apê?ndice)(?:\\s+Nº\\s+[0-9]+|\\s+(?:[IVXL]+|[0-9]+|[A-Z]|[Úú]nico))$", "^.*$"],
        "7":  ["^(?:CAPÍTULO|Capítulo|CAPITULO|Capitulo)\\s+(?:[IVXL]+|[0-9]+)$", "[IVXL]+$"],
        "8":  ["^(?:SE[ÇC][ÃA]O|Se[çc][ãa]o)\\s+(?:[IVXL]+|[0-9]+)$", "[IVXL]+$"],
        "9":  ["^(?:Subse[çc][ãa]o|SUBSE[ÇC][ÃA]O)\\s+(?:[IVXL]+|[0-9]+)$", "[IVXL]+$"],
        "10": ["^(?:Artigo|ARTIGO|Art\\.?)\\s*[0-9]+\\s*[ºª°]?(?:\\s*[-–]\\s*.+)?$", "^[0-9]+$"],
        "11": ["^(?:Parágrafo|PARÁGRAFO|§)\\s*(?:[0-9]+\\s*[ºª°]?|[Úú]nico)$", "^[0-9]+$"],
        "12": ["^[IVXLCDM]+\\.$", "^[IVXLCDM]+$"],
        "13": ["^[a-z]\\.$", "^[a-z]\\)$", "^\\([a-z]\\)$"],
        "14": ["^[ivxlcdm]+\\.$", "^[ivxlcdm]+$"],
        "15": ["^[0-9]+\\.$", "^[0-9]+$"],
        "16": ["^[0-9]+\\.[0-9]+$"],
    }

    PORTUGUESE_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
        "3":  [["TÍTULO", "Título", 0, ""], [" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "4":  [[" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "5":  [["ANEXO", "Anexo", 0, ""], ["COMPLEMENTAR", "Complementar", 0, ""], [" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "6":  [["APÊNDICE", "Apêndice", 0, ""], [" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "7":  [["—[^>]+", "", 0, ""], ["CAPÍTULO", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "8":  [[" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "9":  [[" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        "10": [["—[^>]+", "", 0, ""], [" – [^>]+", "", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "11": [["—[^>]+", "", 0, ""], [" – [^>]+", "", 0, ""], ["-$", "", 0, ""], ["(?<![0-9]\\.[0-9])\\.$", "", 0, ""]],
        "15": [["—[^>]+", "", 0, ""], [" – [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
    }

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result = {}
        for lvl in levels:
            result[str(lvl.level)] = _infer_pattern(lvl.definition, lvl.examples)
        return result


# Module-level aliases used by metajson assembler imports.
PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS = PortuguesePatternGenerator.PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS
PORTUGUESE_PATH_TRANSFORM_CLEANUP = PortuguesePatternGenerator.PORTUGUESE_PATH_TRANSFORM_CLEANUP