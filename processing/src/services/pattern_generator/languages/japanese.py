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
# Ordered longest-first so the alternation is greedy-safe.
# Includes both standard CJK and Kangxi radical variants for each digit,
# since some JP Diet Act documents use Kangxi radicals (U+2F00–U+2FFF).
#
# Kangxi variants included:
#   ⼀(U+2F00)=一  ⼆(U+2F06)=二  ⼋(U+2F0B)=八  ⼗(U+2F17)=十  百 standard only
#
# Hundreds/thousands: 二百三十九, 百二十三 etc. covered via _NUM_BASE pattern.

# Base single digits (standard + Kangxi variants where they exist in corpus)
_D1 = "一|⼀"   # 1 — standard + Kangxi U+2F00
_D2 = "二|⼆"   # 2 — standard + Kangxi U+2F06
_D3 = "三"     # 3
_D4 = "四"     # 4
_D5 = "五"     # 5
_D6 = "六"     # 6
_D7 = "七"     # 7
_D8 = "八|⼋"   # 8 — standard + Kangxi U+2F0B
_D9 = "九"     # 9
_D10 = "十|⼗"  # 10 — standard + Kangxi U+2F17

_JP_NUMERALS = (
    # Hundreds + tens + units (e.g. 二百三十九, 百二十三)
    f"(?:[{_D2}{_D3}{_D4}{_D5}{_D6}{_D7}{_D8}{_D9}]百)?"
    f"(?:[{_D2}{_D3}{_D4}{_D5}{_D6}{_D7}{_D8}{_D9}]?[{_D10}])?"
    f"[{_D1}{_D2}{_D3}{_D4}{_D5}{_D6}{_D7}{_D8}{_D9}]?"
    "|百|千"
)

# Simpler alternation form for use in character classes and explicit matching
_JP_NUM_ALT = (
    # Longest compound forms first to avoid partial matches
    "二百|三百|四百|五百|六百|七百|八百|九百|百|"
    "二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|"
    "⼆十一|⼆十二|⼆十三|⼆十四|⼆十五|⼆十六|⼆十七|⼆十八|⼆十九|"
    "三十一|三十二|三十三|三十四|三十五|三十六|三十七|三十八|三十九|"
    "四十一|四十二|四十三|四十四|四十五|四十六|四十七|四十八|四十九|"
    "五十一|五十二|五十三|五十四|五十五|五十六|五十七|五十八|五十九|"
    "六十一|六十二|六十三|六十四|六十五|六十六|六十七|六十八|六十九|"
    "七十一|七十二|七十三|七十四|七十五|七十六|七十七|七十八|七十九|"
    "八十一|八十二|八十三|八十四|八十五|八十六|八十七|八十八|八十九|"
    "九十一|九十二|九十三|九十四|九十五|九十六|九十七|九十八|九十九|"
    "⼋十一|⼋十二|⼋十三|⼋十四|⼋十五|⼋十六|⼋十七|⼋十八|⼋十九|"
    "四十|五十|六十|七十|八十|九十|"
    "二十|三十|⼆十|"
    "十一|十二|十三|十四|十五|十六|十七|十八|十九|"
    "⼗一|⼗二|⼗三|⼗四|⼗五|⼗六|⼗七|⼗八|⼗九|"
    "一|二|三|四|五|六|七|八|九|十|"
    "⼀|⼆|三|四|五|六|七|⼋|九|⼗"
)

_JP_NUMERALS = _JP_NUM_ALT  # alias for backward compatibility

# Shorthand used inside pattern strings.
# Grammar-based pattern handles all Japanese numerals from 1 to 9999,
# including Kangxi radical variants for digits 1 (⼀), 2 (⼆), 8 (⼋), 10 (⼗).
#
# Structure:  ([2-9]千)?  ([2-9]百)?  ([2-9]?十[1-9]?|[1-9])?
# Examples:   二百三十九, 百二十三, 三十七, 一, 十, 九十九
#
_D_1_9 = "[一二三四五六七八九⼀⼆⼋]"   # digits 1-9 (includes Kangxi ⼀⼆⼋)
_D_2_9 = "[二三四五六七八九⼆⼋]"        # digits 2-9 (for hundreds/thousands prefix)
_D_TEN = "(?:十|⼗)"                   # 十 with Kangxi variant

_JP_NUM_GRAMMAR = (
    rf"(?:{_D_2_9}?千)?"                           # optional thousands (bare 千 or 二千…)
    rf"(?:{_D_2_9}?百)?"                            # optional hundreds (bare 百 or 二百…)
    rf"(?:{_D_2_9}?{_D_TEN}{_D_1_9}?|{_D_1_9})?"   # tens+units OR just units
)
_NUM = rf"(?:{_JP_NUM_GRAMMAR}|[0-9０-９]+)"
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


# ── pathTransform cleanup rules ──────────────────────────────────────────────
# Rules are applied sequentially by the path engine. Order matters.
#
# Key transformations:
#   L3:       第X編 — passthrough (strip whitespace only)
#   L4-7:     第X章/節/款/目 sometimes has trailing title text → strip it
#             e.g. "第一章 総則" → "第一章"
#             Range refs "第X節及び第Y節" → keep first: "第X節"
#   L8:       第X条 — "から...まで" ranges keep first+か; "及び/又は" keep first
#             e.g. "第十六条から第十八条まで" → "第十六条か"
#             e.g. "第四十二条の七及び第四十二条の八" → "第四十二条の七"
#   L9:       digit → (digit); long text (implicit §1) → (1)
#             e.g. "２" → "(２)",  paragraph text → "(1)"
#   L11:      kanji num → (kanji num); ranges keep first+か; 及び keep first
#             e.g. "四の二" → "(四の二)", "十から十五まで" → "(十か)"
#   L12:      Iroha + optional trailing text → (Iroha)
#             e.g. "イ" → "(イ)", "イ 営業用" → "(イ)"
#   L13-14:   fullwidth （N） → halfwidth (N); trailing text stripped
#             e.g. "（１）" → "(１)", "（１） 営業用" → "(１)"
#   L17:      附則 → 附 則 (canonical form with space); strip trailing text
#
# NOTE on rootPath: must be /JP/JPDietActs (capital D, lowercase iet)

JAPANESE_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    # ── L3: 第X編 — strip whitespace only ────────────────────────────────────
    "3": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
    ],

    # ── L4-7: 第X{章/節/款/目} — strip trailing title text ───────────────────
    # Pattern: 第 + non-space chars (suffix + の+num) + space + title text
    # Range "及び": keep first structural token only
    "4": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^(第\S+?)(?:及び|又は)\S.*$", r"\1", 0, ""],
        [r"^(第\S+?)\s+\S.*$",           r"\1", 0, ""],
    ],
    "5": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^(第\S+?)(?:及び|又は)\S.*$", r"\1", 0, ""],
        [r"^(第\S+?)\s+\S.*$",           r"\1", 0, ""],
    ],
    "6": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^(第\S+?)(?:及び|又は)\S.*$", r"\1", 0, ""],
        [r"^(第\S+?)\s+\S.*$",           r"\1", 0, ""],
    ],
    "7": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^(第\S+?)(?:及び|又は)\S.*$", r"\1", 0, ""],
        [r"^(第\S+?)\s+\S.*$",           r"\1", 0, ""],
    ],

    # ── L8: 第X条 — handle ranges and passthrough ────────────────────────────
    # "から...まで" range → keep first article + "か" (e.g. "第十六条か")
    # "及び/又は" range  → keep first article only
    "8": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^(第\S+?)から.*$",            r"\1か", 0, ""],
        [r"^(第\S+?)(?:及び|又は).*$",   r"\1",   0, ""],
    ],

    # ── L9: digit → (digit), long text → (1) ─────────────────────────────────
    # Two-step: first wrap bare digits, then replace any remaining non-wrapped
    # content with (1) [implicit first paragraph marker].
    "9": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^([0-9０-９]+)$",  r"(\1)", 0, ""],   # bare digit → (digit)
        [r"^[^(（].*[^)）]$", "(1)",   0, ""],   # long text  → (1)
    ],

    # ── L10: encircled / parenthesised numbers — passthrough ─────────────────
    "10": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
    ],

    # ── L11: kanji num → (kanji num); ranges handled like L8 ─────────────────
    # Strip context first, THEN wrap — avoids double-paren on "三及び四" etc.
    "11": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^(\S+?)から.*$",          r"\1か", 0, ""],   # range: strip, append か
        [r"^(\S+?)(?:及び|又は).*$", r"\1",   0, ""],   # conjunction: keep first
        [r"^(\S+?)\s+.*$",          r"\1",   0, ""],   # trailing text: strip
        [r"^([^(（].*)$",             r"(\1)", 0, ""],   # wrap if not already wrapped
    ],
    # ── L12: Iroha → (Iroha); strip trailing title text ──────────────────────
    "12": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^([^\s（(]+)\s.*$", r"(\1)", 0, ""],   # "イ 営業用" → "(イ)"
        [r"^([^\s（(]+)$",     r"(\1)", 0, ""],   # bare "イ"  → "(イ)"
    ],

    # ── L13: （N） → (N); trailing text stripped ──────────────────────────────
    "13": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^[（(]([^）)]+)[）)]\s+.*$", r"(\1)", 0, ""],  # （１） 営業用 → (１)
        [r"^[（(]([^）)]+)[）)]$",       r"(\1)", 0, ""],  # （１）       → (１)
    ],

    # ── L14: （ｉｉ） → (ｉｉ) ────────────────────────────────────────────────
    "14": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
        [r"^[（(]([^）)]+)[）)]\s+.*$", r"(\1)", 0, ""],
        [r"^[（(]([^）)]+)[）)]$",       r"(\1)", 0, ""],
    ],

    # ── L15: encircled number — passthrough ───────────────────────────────────
    "15": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
    ],

    # ── L16: Iroha in parens — passthrough (already in correct form) ──────────
    "16": [
        [r"^\s+", "", 0, ""],
        [r"\s+$", "", 0, ""],
    ],

    # ── L17: 附則 → 附 則 (canonical with space); strip trailing text ──────────
    "17": [
        [r"^\s+",       "", 0, ""],
        [r"\s+$",       "", 0, ""],
        [r"附\s*則.*",  "附 則", 0, ""],   # 附則 抄 → 附 則
        [r"：$",        "",     0, ""],
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
    
    JAPANESE_PATH_TRANSFORM_CLEANUP = JAPANESE_PATH_TRANSFORM_CLEANUP
    JAPANESE_META_DEFAULT_LEVEL_PATTERNS = JAPANESE_DIET_ACTS_LEVEL_PATTERNS

JAPANESE_META_DEFAULT_LEVEL_PATTERNS = JAPANESE_DIET_ACTS_LEVEL_PATTERNS