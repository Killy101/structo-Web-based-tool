"""
smart_resolver.py
-----------------
Language-agnostic, template-free pattern resolution.

Replaces the hardcoded level->pattern tables in each language file.
Works by:
  1. ExampleClassifier  -- classifies examples into a PatternType enum
  2. DefinitionScorer   -- validates / upgrades the classification using
                           definition keywords as a cross-check signal
  3. PatternResolver    -- drives the classify->score->fallback chain and
                           returns final regex list per level
  4. PatternAuditor     -- post-pass; warns when two levels share patterns
                           that could match the same strings

Language generators import PatternResolver and call:
    resolver = PatternResolver(language="chinese")
    patterns = resolver.resolve(definition, examples)

The assembler calls audit() on the full result dict before returning.

No level-number assumptions. No template dependency.
"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import NamedTuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. PatternType taxonomy
# ---------------------------------------------------------------------------

class PatternType(Enum):
    """All discrete identifier families we know how to generate patterns for."""
    # CJK legal structural
    CJK_BIAN        = auto()   # Di-X Bian   (Part/Volume)
    CJK_ZHANG       = auto()   # Di-X Zhang  (Chapter)
    CJK_JIE         = auto()   # Di-X Jie    (Section)
    CJK_TIAO        = auto()   # Di-X Tiao   (Article)
    CJK_KUAN        = auto()   # Di-X Kuan   (Clause)
    CJK_MU          = auto()   # Di-X Mu     (Item)
    CJK_XIANG       = auto()   # Di-X Xiang  (Paragraph)
    # Korean structural
    KR_PYEON        = auto()   # Je-X-pyeon  (Part)
    KR_JANG         = auto()   # Je-X-jang   (Chapter)
    KR_JEL          = auto()   # Je-X-jeol   (Section)
    KR_GWAN         = auto()   # Je-X-gwan   (Sub-section)
    KR_JO           = auto()   # Je-X-jo     (Article)
    # Portuguese / Spanish structural
    PT_TITULO       = auto()   # Titulo / TITULO
    PT_CAPITULO     = auto()   # Capitulo (Portuguese)
    PT_SECAO        = auto()   # Secao / Seccao
    PT_ARTIGO       = auto()   # Artigo / Art.
    PT_PARAGRAFO    = auto()   # Paragrafo / section-sign
    PT_INCISO       = auto()   # Inciso (upper Roman)
    ES_ARTICULO     = auto()   # Articulo (Spanish)
    ES_CAPITULO     = auto()   # Capitulo (Spanish)
    # Sub-list formats
    PAREN_CJK       = auto()   # (yi) full/half-width paren + CJK numeral
    TIAN            = auto()   # yi-dun (CJK numeral + ideographic comma)
    CIRCLE_NUM      = auto()   # circled digits 1-20
    CIRCLE_PAREN    = auto()   # parenthesised digits (1)-(10)
    HANGUL_DOT      = auto()   # ga. na. da.
    HANGUL_PAREN    = auto()   # ga) na) da)
    ROMAN_UPPER     = auto()   # I II III
    ROMAN_LOWER     = auto()   # i ii iii
    ROMAN_UPPER_P   = auto()   # (I) (II)
    ROMAN_LOWER_P   = auto()   # (i) (ii)
    ALPHA_LOWER     = auto()   # a b c
    ALPHA_UPPER     = auto()   # A B C
    ALPHA_LOWER_P   = auto()   # (a) (b)
    ALPHA_UPPER_P   = auto()   # (A) (B)
    ALPHA_DOT       = auto()   # a. b.
    ALPHA_PAREN_R   = auto()   # a) b)
    # Arabic variants
    ARABIC_BARE     = auto()   # 1 2 3
    ARABIC_DOT      = auto()   # 1. 2.
    ARABIC_PAREN_R  = auto()   # 1) 2)
    ARABIC_ORDINAL  = auto()   # 1 degrees  2 feminine-ordinal
    DOTTED_2        = auto()   # 1.1
    DOTTED_3        = auto()   # 1.1.1
    DOTTED_4        = auto()   # 1.1.1.1
    FULLWIDTH       = auto()   # fullwidth digits
    # Korean sub-list
    KR_CIRCLE       = auto()   # circled digits extended set 1-50
    KR_ARABIC_DOT   = auto()   # 1. / 2.-ui-3.
    # Catch-all
    CATCH_ALL       = auto()


# ---------------------------------------------------------------------------
# 2. Canonical pattern strings per PatternType
# ---------------------------------------------------------------------------

_CJK_NUM = r"(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)"
_CJK_SP  = r"[\s\u3000]*"

PATTERNS_FOR: dict[PatternType, list[str]] = {
    PatternType.CJK_BIAN:       [rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}編$"],
    PatternType.CJK_ZHANG:      [rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}章$"],
    PatternType.CJK_JIE:        [rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}[节節]$"],
    PatternType.CJK_TIAO:       [
        rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}[条條]"
        rf"(?:之(?:{_CJK_NUM}))?$"
    ],
    PatternType.CJK_KUAN:       [rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}款$"],
    PatternType.CJK_MU:         [rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}目$"],
    PatternType.CJK_XIANG:      [rf"^第{_CJK_SP}{_CJK_NUM}{_CJK_SP}[項项]$"],

    PatternType.KR_PYEON:       [r"^제 ?[0-9]+ ?편(의[0-9]+)?$"],
    PatternType.KR_JANG:        [r"^제 ?[0-9]+ ?장(의[0-9]+)?$"],
    PatternType.KR_JEL:         [r"^제 ?[0-9]+ ?절$"],
    PatternType.KR_GWAN:        [r"^제 ?[0-9]+ ?관(의[0-9]+)?$"],
    PatternType.KR_JO:          [r"^제 ?[0-9]+ ?조(?:의[0-9]+)*$"],

    PatternType.PT_TITULO:      [r"^(?:TÍTULO|Título|titulo)\s+(?:[IVXL]+|[0-9]+)$"],
    PatternType.PT_CAPITULO:    [r"^(?:CAPÍTULO|Capítulo|CAPITULO|Capitulo)\s+(?:[IVXL]+|[0-9]+)$"],
    PatternType.PT_SECAO:       [r"^(?:SE[ÇC][ÃA]O|Se[çc][ãa]o)\s+(?:[IVXL]+|[0-9]+)$"],
    PatternType.PT_ARTIGO:      [
        r"^(?:Artigo|ARTIGO|Art\.?)\s*[0-9]+\s*[ºª°]?(?:\s*[-–]\s*.+)?$",
        r"^[0-9]+$",
    ],
    PatternType.PT_PARAGRAFO:   [
        r"^(?:Parágrafo|PARÁGRAFO|§)\s*(?:[0-9]+\s*[ºª°]?|[Úú]nico)$",
        r"^[0-9]+$",
    ],
    PatternType.PT_INCISO:      [r"^[IVXLCDM]+$"],
    PatternType.ES_ARTICULO:    [
        r"^Art[íi]culo\s+[0-9]+[°º]?(?:\s+[Bb]is)?$",
        r"^[0-9]+$",
    ],
    PatternType.ES_CAPITULO:    [
        r"^CAP[ÍI]TULO\s+(?:[IVXL]+|[0-9]+)$",
        r"^[IVXLCDM]+$",
        r"^[0-9]+$",
    ],

    PatternType.PAREN_CJK:      [rf"^\s*[（(]{_CJK_NUM}[）)]\s*$"],
    PatternType.TIAN:           [rf"^{_CJK_NUM}[、]$"],
    PatternType.CIRCLE_NUM:     [r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$"],
    PatternType.CIRCLE_PAREN:   [r"^[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]$"],
    PatternType.KR_CIRCLE:      [
        r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
        r"㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿]$"
    ],
    PatternType.HANGUL_DOT:     [
        r"^[가나다라마바사아자차카타파하"
        r"거너더러머버서어저처커터퍼허"
        r"고노도로모]+\.$"
    ],
    PatternType.HANGUL_PAREN:   [
        r"^[가나다라마바사아자차카타파하"
        r"거너더러머버서어저처커터퍼허"
        r"고노도로모]+\)$"
    ],
    PatternType.KR_ARABIC_DOT:  [r"^[0-9]+\.$", r"^[0-9]+ ?(의[0-9]+)?\.$"],

    PatternType.ROMAN_UPPER:    [r"^[IVXLCDM]+$"],
    PatternType.ROMAN_LOWER:    [r"^[ivxlcdm]+$"],
    PatternType.ROMAN_UPPER_P:  [r"^\([IVXLCDM]+\)$"],
    PatternType.ROMAN_LOWER_P:  [r"^\([ivxlcdm]+\)$"],

    PatternType.ALPHA_LOWER:    [r"^[a-z]+$"],
    PatternType.ALPHA_UPPER:    [r"^[A-Z]+$"],
    PatternType.ALPHA_LOWER_P:  [r"^\([a-z]+\)$"],
    PatternType.ALPHA_UPPER_P:  [r"^\([A-Z]+\)$"],
    PatternType.ALPHA_DOT:      [r"^[a-z]+\.$"],
    PatternType.ALPHA_PAREN_R:  [r"^[a-z]+\)$"],

    PatternType.ARABIC_BARE:    [r"^[0-9]+$"],
    PatternType.ARABIC_DOT:     [r"^[0-9]+\.$"],
    PatternType.ARABIC_PAREN_R: [r"^[0-9]+\)$"],
    PatternType.ARABIC_ORDINAL: [r"^[0-9]+\s*[ºª°]$"],
    PatternType.DOTTED_2:       [r"^[0-9]+\.[0-9]+$"],
    PatternType.DOTTED_3:       [r"^[0-9]+\.[0-9]+\.[0-9]+$"],
    PatternType.DOTTED_4:       [r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$"],
    PatternType.FULLWIDTH:      [r"^[０１２３４５６７８９]+$"],

    PatternType.CATCH_ALL:      [r"^.*$"],
}


# ---------------------------------------------------------------------------
# 3. ExampleClassifier
# ---------------------------------------------------------------------------

@dataclass
class ClassificationResult:
    pattern_type:  PatternType
    confidence:    float   # 0.0 to 1.0
    matched_count: int     # number of examples that hit the winning probe
    total_count:   int     # total non-empty examples examined


class ExampleClassifier:
    """
    Classify a list of example strings into a PatternType.

    Strategy: run each probe regex against all non-empty examples.
    First probe where >= 50% of examples match wins.
    Confidence = match_ratio * probe_priority_weight.

    Probes are ordered most-specific to least-specific so that, e.g.,
    DOTTED_4 is tested before DOTTED_2 and is never mis-classified downward.
    """

    # (probe_regex, PatternType, priority_weight)
    # priority_weight: 1.0 = unambiguous identifier, lower = weaker signal
    _PROBES: list[tuple[str, PatternType, float]] = [
        # Dotted outlines -- most specific first
        (r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$", PatternType.DOTTED_4,       1.0),
        (r"^[0-9]+\.[0-9]+\.[0-9]+$",          PatternType.DOTTED_3,       1.0),
        (r"^[0-9]+\.[0-9]+$",                   PatternType.DOTTED_2,       1.0),
        # CJK legal structural
        (r"第.{0,4}編",                          PatternType.CJK_BIAN,       1.0),
        (r"第.{0,4}章",                          PatternType.CJK_ZHANG,      1.0),
        (r"第.{0,4}[節节]",                      PatternType.CJK_JIE,        1.0),
        (r"第.{0,4}[條条]",                      PatternType.CJK_TIAO,       1.0),
        (r"第.{0,4}款",                          PatternType.CJK_KUAN,       1.0),
        (r"第.{0,4}目",                          PatternType.CJK_MU,         1.0),
        (r"第.{0,4}[項项]",                      PatternType.CJK_XIANG,      1.0),
        # Korean structural
        (r"제\s*[0-9]+\s*편",                    PatternType.KR_PYEON,       1.0),
        (r"제\s*[0-9]+\s*장",                    PatternType.KR_JANG,        1.0),
        (r"제\s*[0-9]+\s*절",                    PatternType.KR_JEL,         1.0),
        (r"제\s*[0-9]+\s*관",                    PatternType.KR_GWAN,        1.0),
        (r"제\s*[0-9]+\s*조",                    PatternType.KR_JO,          1.0),
        # Portuguese structural
        (r"(?:TÍTULO|Título|titulo)\s+(?:[IVXL]+|[0-9]+)",
                                                  PatternType.PT_TITULO,      1.0),
        (r"(?:CAPÍTULO|Capítulo|CAPITULO)\s+",   PatternType.PT_CAPITULO,    1.0),
        (r"(?:SE[ÇC][ÃA]O|Se[çc][ãa]o)\s+",     PatternType.PT_SECAO,       1.0),
        (r"(?:Artigo|ARTIGO|Art\.?)\s*[0-9]+",   PatternType.PT_ARTIGO,      1.0),
        (r"(?:Parágrafo|PARÁGRAFO|§)\s*",        PatternType.PT_PARAGRAFO,   1.0),
        # Spanish structural
        (r"Art[íi]culo\s+[0-9]+",                PatternType.ES_ARTICULO,    1.0),
        (r"CAP[ÍI]TULO\s+",                      PatternType.ES_CAPITULO,    1.0),
        # Korean sub-list
        (r"^[①-㊿]$",                            PatternType.KR_CIRCLE,      0.95),
        (r"^[가-힣]+\.$",                         PatternType.HANGUL_DOT,     0.95),
        (r"^[가-힣]+\)$",                         PatternType.HANGUL_PAREN,   0.95),
        (r"^[0-9]+(의[0-9]+)?\.$",               PatternType.KR_ARABIC_DOT,  0.90),
        # CJK sub-list
        (r"^[①-⑳]$",                             PatternType.CIRCLE_NUM,     0.95),
        (r"^[⑴-⑽]$",                             PatternType.CIRCLE_PAREN,   0.95),
        (r"[一二三四五六七八九十][、]",            PatternType.TIAN,           0.95),
        (r"^[\s]*[（(][一二三四五六七八九十百][）)]\s*$",
                                                  PatternType.PAREN_CJK,      0.95),
        # Roman numerals -- parenthetical before bare to avoid ambiguity
        (r"^\([IVXLCDM]+\)$",                    PatternType.ROMAN_UPPER_P,  0.95),
        (r"^\([ivxlcdm]+\)$",                    PatternType.ROMAN_LOWER_P,  0.95),
        (r"^[IVXLCDM]+$",                        PatternType.ROMAN_UPPER,    0.85),
        (r"^[ivxlcdm]+$",                        PatternType.ROMAN_LOWER,    0.85),
        # Alpha -- parenthetical / dot / right-paren before bare
        (r"^\([a-z]\)$",                         PatternType.ALPHA_LOWER_P,  0.95),
        (r"^\([A-Z]\)$",                         PatternType.ALPHA_UPPER_P,  0.95),
        (r"^[a-z]\.$",                           PatternType.ALPHA_DOT,      0.95),
        (r"^[a-z]\)$",                           PatternType.ALPHA_PAREN_R,  0.95),
        (r"^[a-z]+$",                            PatternType.ALPHA_LOWER,    0.75),
        (r"^[A-Z]+$",                            PatternType.ALPHA_UPPER,    0.75),
        # Ordinal
        (r"^[0-9]+\s*[ºª°]$",                   PatternType.ARABIC_ORDINAL, 0.95),
        # Arabic -- decorated forms before bare integer
        (r"^[0-9]+\.$",                          PatternType.ARABIC_DOT,     0.90),
        (r"^[0-9]+\)$",                          PatternType.ARABIC_PAREN_R, 0.90),
        (r"^[0-9]+$",                            PatternType.ARABIC_BARE,    0.80),
        # Full-width digits
        (r"^[０-９]+$",                           PatternType.FULLWIDTH,      0.90),
    ]

    def classify(self, examples: list[str]) -> ClassificationResult:
        clean = [ex.strip() for ex in examples if ex and ex.strip()]
        if not clean:
            return ClassificationResult(PatternType.CATCH_ALL, 0.0, 0, 0)

        total = len(clean)
        for probe, ptype, weight in self._PROBES:
            hits  = sum(1 for ex in clean if re.search(probe, ex))
            ratio = hits / total
            if ratio >= 0.5:
                return ClassificationResult(ptype, ratio * weight, hits, total)

        return ClassificationResult(PatternType.CATCH_ALL, 0.1, 0, total)


# ---------------------------------------------------------------------------
# 4. DefinitionScorer
# ---------------------------------------------------------------------------

class _Keyword(NamedTuple):
    pattern:     str
    target_type: PatternType
    boost:       float   # added to confidence when this keyword is found


_KW_RULES: list[_Keyword] = [
    # CJK
    _Keyword(r"章|chapter",                PatternType.CJK_ZHANG,      0.3),
    _Keyword(r"節|节|section",             PatternType.CJK_JIE,        0.3),
    _Keyword(r"條|条|article",             PatternType.CJK_TIAO,       0.3),
    _Keyword(r"款|clause",                 PatternType.CJK_KUAN,       0.3),
    _Keyword(r"目|item",                   PatternType.CJK_MU,         0.2),
    _Keyword(r"項|项|paragraph",           PatternType.CJK_XIANG,      0.3),
    _Keyword(r"編|volume|part",            PatternType.CJK_BIAN,       0.3),
    # Korean
    _Keyword(r"편|part",                   PatternType.KR_PYEON,       0.3),
    _Keyword(r"장",                        PatternType.KR_JANG,        0.3),
    _Keyword(r"절",                        PatternType.KR_JEL,         0.3),
    _Keyword(r"관",                        PatternType.KR_GWAN,        0.3),
    _Keyword(r"조",                        PatternType.KR_JO,          0.3),
    # Portuguese
    _Keyword(r"título|title",              PatternType.PT_TITULO,      0.3),
    _Keyword(r"capítulo|chapter",          PatternType.PT_CAPITULO,    0.3),
    _Keyword(r"seção|secção|sec",          PatternType.PT_SECAO,       0.3),
    _Keyword(r"artigo|art\b",              PatternType.PT_ARTIGO,      0.3),
    _Keyword(r"parágrafo|§",              PatternType.PT_PARAGRAFO,   0.3),
    _Keyword(r"inciso",                    PatternType.PT_INCISO,      0.4),
    _Keyword(r"alínea",                    PatternType.ALPHA_DOT,      0.4),
    # Spanish
    _Keyword(r"artículo",                  PatternType.ES_ARTICULO,    0.4),
    _Keyword(r"capítulo",                  PatternType.ES_CAPITULO,    0.3),
    # Generic
    _Keyword(r"roman.*upper|upper.*roman", PatternType.ROMAN_UPPER,    0.4),
    _Keyword(r"roman.*lower|lower.*roman", PatternType.ROMAN_LOWER,    0.4),
    _Keyword(r"roman",                     PatternType.ROMAN_UPPER,    0.2),
    _Keyword(r"paren|bracket",             PatternType.ALPHA_LOWER_P,  0.15),
    _Keyword(r"dotted|decimal",            PatternType.DOTTED_2,       0.2),
    _Keyword(r"ordinal",                   PatternType.ARABIC_ORDINAL, 0.3),
]


class DefinitionScorer:
    """
    Use definition text to validate or upgrade a ClassificationResult.

    Rules:
    - Definition agrees with classifier  -> boost confidence.
    - Classifier returned CATCH_ALL or confidence < 0.55
      AND definition points to something specific -> override.
    - Otherwise                          -> trust the classifier.
    """

    def score(
        self,
        definition: str,
        result: ClassificationResult,
    ) -> ClassificationResult:
        if not definition:
            return result

        defn       = definition.lower()
        best_boost = 0.0
        best_type: PatternType | None = None

        for kw in _KW_RULES:
            if re.search(kw.pattern, defn, re.IGNORECASE):
                if kw.boost > best_boost:
                    best_boost = kw.boost
                    best_type  = kw.target_type

        if best_type is None:
            return result

        # Agree: boost confidence
        if result.pattern_type == best_type:
            return ClassificationResult(
                best_type,
                min(1.0, result.confidence + best_boost),
                result.matched_count,
                result.total_count,
            )

        # Disagree but classifier was weak: let definition override
        if result.pattern_type == PatternType.CATCH_ALL or result.confidence < 0.55:
            return ClassificationResult(
                best_type,
                best_boost,
                result.matched_count,
                result.total_count,
            )

        # Disagree and classifier was confident: trust the classifier
        return result


# ---------------------------------------------------------------------------
# 5. PatternResolver
# ---------------------------------------------------------------------------

@dataclass
class PatternResolver:
    """
    Main entry point for language generators.

    Usage:
        resolver = PatternResolver(language="chinese")
        patterns = resolver.resolve(definition="chapter", examples=["第一章", "第二章"])
        # returns list of compiled-ready regex strings
    """
    language:    str            = ""
    _classifier: ExampleClassifier = field(default_factory=ExampleClassifier, init=False)
    _scorer:     DefinitionScorer  = field(default_factory=DefinitionScorer,  init=False)

    def resolve(self, definition: str, examples: list[str]) -> list[str]:
        """
        Classify examples, cross-validate with definition, return regex list.
        Falls back to catch-all only when nothing specific can be determined.
        """
        raw   = self._classifier.classify(examples)
        final = self._scorer.score(definition, raw)

        patterns = PATTERNS_FOR.get(final.pattern_type)
        if patterns:
            logger.debug(
                "level resolved: type=%s confidence=%.2f examples=%d/%d",
                final.pattern_type.name,
                final.confidence,
                final.matched_count,
                final.total_count,
            )
            return list(patterns)

        return [r"^.*$"]


# ---------------------------------------------------------------------------
# 6. PatternAuditor
# ---------------------------------------------------------------------------

@dataclass
class AuditWarning:
    level_a:        str
    level_b:        str
    shared_pattern: str
    message:        str


class PatternAuditor:
    """
    Post-pass: detect patterns that could cause ambiguous node classification.
    Returns warnings only -- never mutates the patterns dict.

    SUPPRESSED (expected by design):
      - Level 2 catch-all: the document title node is always '^.*$' and is
        structurally unique, so it never shadows other levels.
      - A single catch-all on any non-title level: intentional for annex /
        addenda / transitional levels where content varies too much to match
        a specific pattern.

    WARNED:
      - Two non-title levels BOTH carry '^.*$': one will silently absorb nodes
        meant for the other.
      - Two levels share an identical non-catch-all pattern string: the
        classifier cannot distinguish which level a node belongs to.
    """

    # Levels expected to carry catch-alls -- never warned about.
    _STRUCTURAL_CATCHALL_LEVELS: frozenset[str] = frozenset({"2"})

    def audit(self, level_patterns: dict[str, list[str]]) -> list[AuditWarning]:
        warnings: list[AuditWarning] = []
        levels = sorted(
            level_patterns.keys(),
            key=lambda k: int(k) if k.isdigit() else 0,
        )

        # Check 1: multiple non-structural levels both carry catch-all
        catchall_levels = [
            lv for lv in levels
            if lv not in self._STRUCTURAL_CATCHALL_LEVELS
            and r"^.*$" in level_patterns[lv]
        ]
        if len(catchall_levels) > 1:
            for i, la in enumerate(catchall_levels):
                for lb in catchall_levels[i + 1:]:
                    warnings.append(AuditWarning(
                        la, lb, r"^.*$",
                        f"Levels {la} and {lb} both carry catch-all '^.*$'. "
                        f"Level {la} will absorb nodes intended for level {lb}. "
                        f"Consider a more specific pattern for one of them.",
                    ))

        # Check 2: shared non-catch-all patterns between any two levels
        for i, la in enumerate(levels):
            for lb in levels[i + 1:]:
                pa_specific = set(level_patterns[la]) - {r"^.*$"}
                pb_specific = set(level_patterns[lb]) - {r"^.*$"}
                shared = pa_specific & pb_specific
                for p in shared:
                    warnings.append(AuditWarning(
                        la, lb, p,
                        f"Levels {la} and {lb} share pattern '{p}'. "
                        f"This may cause ambiguous node classification.",
                    ))

        return warnings