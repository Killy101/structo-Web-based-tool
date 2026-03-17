"""
japanese.py
-----------
Pattern generator for Japanese-language documents (JP Diet Acts BRD).

Hierarchy for this content category (levels 2–17):
  2  – Document title                   catch-all
  3  – 第X編   (hen   / volume)
  4  – 第X章   (sho   / chapter)        optionally の+num
  5  – 第X節   (setsu / section)        optionally の+num
  6  – 第X款   (kan   / clause)         optionally の+num
  7  – 第X目   (moku  / item)           optionally の+num
  8  – 第X条   (jo    / article)        optionally の+num (multi-の supported)
  9  – Arabic numeral paragraph         e.g. ５  (full/half width)
  10 – Encircled number ⑦ OR parenthesised ⑷
  11 – Chinese numeral,  optionally の+num  e.g. 二, 四の二
  12 – Iroha katakana                   e.g. ロ
  13 – Number enclosed in （）          e.g. （１）
  14 – Lowercase roman in （）          e.g. （ｉｉ）  (full-width)
  15 – Encircled number                 e.g. ②
  16 – Iroha enclosed in （）           e.g. (ｲ)
  17 – 附 則  Supplementary Provisions
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition

# ── Shared kanji numerals block ───────────────────────────────────────────────
# Ordered longest-first so the alternation is greedy-safe
_JP_NUMERALS = (
    "二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|"
    "三十一|三十二|三十三|三十四|三十五|三十六|三十七|三十八|三十九|"
    "四十一|四十二|四十三|四十四|四十五|四十六|四十七|四十八|四十九|"
    "五十一|五十二|五十三|五十四|五十五|五十六|五十七|五十八|五十九|"
    "六十一|六十二|六十三|六十四|六十五|六十六|六十七|六十八|六十九|"
    "七十一|七十二|七十三|七十四|七十五|七十六|七十七|七十八|七十九|"
    "八十一|八十二|八十三|八十四|八十五|八十六|八十七|八十八|八十九|"
    "九十一|九十二|九十三|九十四|九十五|九十六|九十七|九十八|九十九|"
    "四十|五十|六十|七十|八十|九十|百|"
    "二十|三十|"
    "十一|十二|十三|十四|十五|十六|十七|十八|十九|"
    "一|二|三|四|五|六|七|八|九|十"
)

# Shorthand used inside pattern strings
_NUM = rf"(?:{_JP_NUMERALS}|[0-9０-９]+)"
# Optional の-extension appended AFTER a kanji suffix: 章の二, 条の十四の二
# Place this token after the suffix character in every pattern.
_NO_EXT = rf"(?:の{_NUM})*"

# ── Iroha ordering (full set used in BRD levels 12 & 16) ─────────────────────
_IROHA = "イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス"
# Full-width Iroha variants appear in level-16 examples e.g. ｲ
_IROHA_FW = "ｲﾛﾊﾆﾎﾍﾄﾁﾘﾇﾙｦﾜｶﾖﾀﾚｿﾂﾈﾅﾗﾑｳｲﾉｵｸﾔﾏｹﾌｺｴﾃｱｻｷﾕﾒﾐｼｴﾋﾓｾｽ"

# ── Level-by-level canonical patterns ────────────────────────────────────────
# IMPORTANT: の-extension goes AFTER the kanji suffix, not before it.
# e.g.  第四章の二  →  第NUM章(のNUM)*   NOT  第NUM(のNUM)*章

# L2 – document title, never filtered
_L2 = r"^.*$"

# L3 – 第X編
_L3_HEN = rf"^第\s*{_NUM}\s*編{_NO_EXT}(?:\s+.*)?$"

# L4 – 第X章 (optionally の+num after suffix: 第四章の二, 第六章の二の二)
_L4_SHO = rf"^第\s*{_NUM}\s*章{_NO_EXT}(?:\s+.*)?$"

# L5 – 第X節 (optionally の+num after suffix: 第四節の二)
_L5_SETSU = rf"^第\s*{_NUM}\s*節{_NO_EXT}(?:\s+.*)?$"

# L6 – 第X款 (optionally の+num after suffix: 第六款の二)
_L6_KAN = rf"^第\s*{_NUM}\s*款{_NO_EXT}(?:\s+.*)?$"

# L7 – 第X目 (optionally の+num after suffix: 第一目の二)
_L7_MOKU = rf"^第\s*{_NUM}\s*目{_NO_EXT}(?:\s+.*)?$"

# L8 – 第X条 (multi-の supported: 第三十七条の十四の二)
_L8_JO = rf"^第\s*{_NUM}\s*条{_NO_EXT}(?:\s+.*)?$"

# L9 – Arabic paragraph number (half- or full-width only)
_L9_ARABIC = r"^[0-9０-９]+$"

# L10 – Encircled ① … ⑳  OR parenthesised-digit ⑴ … ⑽ (U+2474–U+247D)
# These are two distinct Unicode character classes:
#   _L10_CIRCLE       – enclosed alphanumerics ①②…⑳㉑…㉟  (U+2460–U+247F range subset)
#   _L10_PAREN_CIRCLE – parenthesized digits  ⑴⑵⑶⑷…⑽   (U+2474–U+247D)
_L10_CIRCLE = r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟]$"
_L10_PAREN_CIRCLE = r"^[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]$"

# L11 – Chinese numeral, optionally の+num e.g. 二, 四の二
_L11_KANJI_NUM = rf"^{_NUM}{_NO_EXT}$"

# L12 – Iroha katakana (single character, no delimiter)
_L12_IROHA = rf"^[{_IROHA}]$"

# L13 – Number enclosed in fullwidth/ASCII parens e.g. （１）
_L13_PAREN_NUM = r"^[（(][0-9０-９]+[）)]$"

# L14 – Lowercase roman numeral in parens — supports full-width ｉｉ
_L14_PAREN_ROMAN = r"^[（(][ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻivxlcdmｉｖｘｌｃｄｍ]+[）)]$"

# L15 – Encircled number (same character set as L10, distinct structural position)
_L15_CIRCLE = _L10_CIRCLE  # same pattern; context distinguishes usage

# L16 – Iroha enclosed in parens e.g. (ｲ) — half-width or full-width
_L16_PAREN_IROHA = rf"^[（(][{_IROHA}{_IROHA_FW}][）)]$"

# L17 – 附 則 Supplementary Provisions
_L17_SUPP = r"^附\s*則(?:.*)?$"

# ── Default pattern table (used when auto-inferring from definition fails) ───
JAPANESE_DIET_ACTS_LEVEL_PATTERNS: dict[str, list[str]] = {
    "2":  [_L2],
    "3":  [_L3_HEN],
    "4":  [_L4_SHO],
    "5":  [_L5_SETSU],
    "6":  [_L6_KAN],
    "7":  [_L7_MOKU],
    "8":  [_L8_JO],
    "9":  [_L9_ARABIC],
    "10": [_L10_CIRCLE, _L10_PAREN_CIRCLE],
    "11": [_L11_KANJI_NUM],
    "12": [_L12_IROHA],
    "13": [_L13_PAREN_NUM],
    "14": [_L14_PAREN_ROMAN],
    "15": [_L15_CIRCLE],
    "16": [_L16_PAREN_IROHA],
    "17": [_L17_SUPP],
}

# ── pathTransform cleanup rules (unchanged from original BRD) ────────────────
JAPANESE_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    "3":  [["[^>]+", "", 0, ""]],
    "4":  [["[^>]+", "", 0, ""]],
    "5":  [["[^>]+", "", 0, ""]],
    "6":  [["[^>]+", "", 0, ""]],
    "7":  [["[^>]+", "", 0, ""]],
    "8":  [
        ["[^>]+",  "", 0, ""],
        ["か[^>]+", "", 0, ""],
        ["及[^>]+", "", 0, ""],
    ],
    "17": [
        ["則 [^>]+", "則", 0, ""],
        ["：$",       "",  0, ""],
    ],
}


# ── Inference helpers ─────────────────────────────────────────────────────────

def _kanji_suffix_pattern(suffix: str, with_no_ext: bool = True) -> str:
    """Build 第X{suffix} pattern, optionally with の-extension."""
    ext = _NO_EXT if with_no_ext else ""
    return rf"^第\s*{_NUM}{ext}\s*{suffix}(?:\s+.*)?$"


# Maps definition keywords → [patterns_to_emit]
_KEYWORD_TABLE: list[tuple[list[str], list[str]]] = [
    # (keywords_in_definition,  [patterns_to_emit])
    (["編"],        [_L3_HEN]),
    (["章"],        [_L4_SHO]),
    (["節"],        [_L5_SETSU]),
    (["款"],        [_L6_KAN]),
    (["目"],        [_L7_MOKU]),
    (["条"],        [_L8_JO]),
    (["附", "附 則", "supplementary"], [_L17_SUPP]),
]

# Example-driven matchers: (compiled_regex, pattern_string)
_EXAMPLE_MATCHERS: list[tuple[re.Pattern, str]] = [
    # Must be ordered most-specific → least-specific
    (re.compile(r"^第\s*[\S]+\s*編"),                        _L3_HEN),
    (re.compile(r"^第\s*[\S]+\s*章"),                        _L4_SHO),
    (re.compile(r"^第\s*[\S]+\s*節"),                        _L5_SETSU),
    (re.compile(r"^第\s*[\S]+\s*款"),                        _L6_KAN),
    (re.compile(r"^第\s*[\S]+\s*目"),                        _L7_MOKU),
    (re.compile(r"^第\s*[\S]+\s*条"),                        _L8_JO),
    (re.compile(r"^[0-9０-９]+$"),                           _L9_ARABIC),
    (re.compile(r"^[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]$"),                  _L10_PAREN_CIRCLE),
    (re.compile(r"^[①-⑳㉑-㉟]$"),                          _L10_CIRCLE),
    (re.compile(r"^(?:" + _JP_NUMERALS + r")(?:の(?:" + _JP_NUMERALS + r"))*$"),
                                                              _L11_KANJI_NUM),
    (re.compile(rf"^[{_IROHA}]$"),                           _L12_IROHA),
    (re.compile(r"^[（(][0-9０-９]+[）)]$"),                 _L13_PAREN_NUM),
    (re.compile(r"^[（(][ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻivxlcdmｉｖｘｌｃｄｍ]+[）)]$"),
                                                              _L14_PAREN_ROMAN),
    (re.compile(rf"^[（(][{_IROHA}{_IROHA_FW}][）)]$"),      _L16_PAREN_IROHA),
    (re.compile(r"^附\s*則"),                                _L17_SUPP),
]


def _infer_pattern(definition: str, examples: list[str], level: int) -> list[str]:
    """
    Infer regex pattern(s) for a single level.

    Strategy:
      1. Check examples against _EXAMPLE_MATCHERS (most reliable signal).
      2. Fall back to keyword scan of the definition text.
      3. Fall back to the default table.
      4. Ultimate catch-all: "^.*$".
    """
    samples = [ex.strip() for ex in examples if ex and ex.strip()]

    # 1. Example-driven inference
    matched: list[str] = []
    for ex in samples:
        for regex, pat in _EXAMPLE_MATCHERS:
            if regex.match(ex) and pat not in matched:
                matched.append(pat)
                break  # one match per example is enough

    if matched:
        return list(dict.fromkeys(matched))  # deduplicated, order preserved

    # 2. Definition keyword inference
    defn_lower = definition.lower()
    for keywords, patterns in _KEYWORD_TABLE:
        if any(kw in defn_lower or kw in definition for kw in keywords):
            return patterns

    # 3. Default table lookup
    default = JAPANESE_DIET_ACTS_LEVEL_PATTERNS.get(str(level))
    if default:
        return default

    # 4. Catch-all
    return [r"^.*$"]


# ── Public generator class ────────────────────────────────────────────────────

class JapanesePatternGenerator(PatternGeneratorBase):
    supported_languages = ["japanese", "ja", "jp"]

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for lvl in levels:
            result[str(lvl.level)] = _infer_pattern(
                lvl.definition, lvl.examples, lvl.level
            )
        return result
    
    # At the very bottom of japanese.py, after JAPANESE_PATH_TRANSFORM_CLEANUP

JAPANESE_META_DEFAULT_LEVEL_PATTERNS = JAPANESE_DIET_ACTS_LEVEL_PATTERNS