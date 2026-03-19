"""
chinese.py
----------
Pattern generator for Chinese-language documents (Traditional TW + Simplified CN).

Handles:
  Structural:   第X編, 第X章, 第X節, 第X條, 第X款, 第X目
  Ordinal:      第X項
  Parenthetical （一）/ (一)
  Circled:      ①②③ ... ⑳  and  ⑴⑵⑶ ... ⑽
  Tian-shaped:  一、二、三、 (top-level CJK list bullets)
  Roman:        （一）、（二）… or bare Ⅰ Ⅱ Ⅲ
  Alpha:        (a)(b)(c) / （A）（B）
  Mixed Arabic/Chinese (第3條, 3.1, 3.1.1)
  Full-width Arabic
  Dotted Arabic outlines  1. / 1.1 / 1.1.1 / 1.1.1.1
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition

# Chinese numeral string (longer alternatives first to avoid partial matches)

_CN_NUMERALS = (
    # Tens + units (21-99)
    "二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|"
    "三十一|三十二|三十三|三十四|三十五|三十六|三十七|三十八|三十九|"
    "四十一|四十二|四十三|四十四|四十五|四十六|四十七|四十八|四十九|"
    "五十一|五十二|五十三|五十四|五十五|五十六|五十七|五十八|五十九|"
    "六十一|六十二|六十三|六十四|六十五|六十六|六十七|六十八|六十九|"
    "七十一|七十二|七十三|七十四|七十五|七十六|七十七|七十八|七十九|"
    "八十一|八十二|八十三|八十四|八十五|八十六|八十七|八十八|八十九|"
    "九十一|九十二|九十三|九十四|九十五|九十六|九十七|九十八|九十九|"
    # Teens / round tens
    "十一|十二|十三|十四|十五|十六|十七|十八|十九|"
    "二十|三十|四十|五十|六十|七十|八十|九十|"
    # Hundreds (common in legal article counts)
    "一百零一|一百零二|一百零三|一百零四|一百零五|"
    "一百一十|一百二十|一百三十|一百四十|一百五十|"
    "一百|"
    # Single digits + 十
    "一|二|三|四|五|六|七|八|九|十"
)

# Convenient alias used inside f-strings
_N = _CN_NUMERALS

# 1. Six-tier legal hierarchy  編 > 章 > 節 > 條 > 款 > 目

# 第X編  — parts/volumes (highest tier in some codes)
BIAN_PATTERN    = rf"^第 ?({_N}) ?編$"

# 第X章  — chapters
ZHANG_PATTERN   = rf"^第 ?({_N}) ?章$"

# 第X節  — sections
JIE_PATTERN     = rf"^第 ?({_N}) ?節$"

# 第X條/条  — articles (supports 之X sub-articles: 第十條之一)
TIAO_PATTERN    = (
    rf"^第 ?({_N}|[0-9０-９]+) ?[條条]"
    rf"(之({_N}|[0-9]+))?$"
)

# 第X款  — clauses (sub-article level)
KUAN_PATTERN    = rf"^第 ?({_N}|[0-9０-９]+) ?款$"

# 第X目  — items (lowest tier)
MU_PATTERN      = rf"^第 ?({_N}|[0-9０-９]+) ?目$"

# 第X項  — paragraphs / sub-clauses
XIANG_PATTERN   = rf"^第 ?({_N}|[0-9０-９]+) ?[項项]$"


# 2. Parenthetical Chinese numerals  （一）  (一)
PAREN_CN_PATTERN = rf"^[（(]({_N})[）)]$"

# 3. Tian-shaped bullets  一、  二、  三、  (comma = 、 U+3001)
TIAN_PATTERN = rf"^({_N})[、]$"

# 4. Circled numerals  ①–⑳  (Unicode Enclosed Alphanumerics)
CIRCLE_PATTERN = r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$"

# ⑴⑵⑶…⑽  parenthesised digits
CIRCLE_PAREN_PATTERN = r"^[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]$"

# 5. Roman numerals (full-width and half-width)  Ⅰ Ⅱ … Ⅻ
ROMAN_PATTERN = r"^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ]+$"

# Parenthetical Roman: （Ⅰ）  (i)
ROMAN_PAREN_PATTERN = r"^[（(][ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ]+[）)]$"

# 6. Latin alpha  (a)/(A)  （a）/（A）
ALPHA_LOWER_PAREN_PATTERN = r"^[（(][a-z][）)]$"
ALPHA_UPPER_PAREN_PATTERN = r"^[（(][A-Z][）)]$"

# 7. Arabic / full-width Arabic numerals
ARABIC_PATTERN          = r"^[0-9]+$"
FULLWIDTH_ARABIC_PATTERN = r"^[０１２３４５６７８９]+$"

# Dotted outline numbering  1.  /  1.1  /  1.1.1  /  1.1.1.1
DOTTED_1_PATTERN  = r"^[0-9]+\.$"
DOTTED_2_PATTERN  = r"^[0-9]+\.[0-9]+$"
DOTTED_3_PATTERN  = r"^[0-9]+\.[0-9]+\.[0-9]+$"
DOTTED_4_PATTERN  = r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$"

# 8. Mixed Arabic + Chinese unit  第3條  /  第3章 …
MIXED_TIAO_PATTERN  = r"^第 ?[0-9０-９]+ ?[條条](之[0-9０-９]+)?$"
MIXED_ZHANG_PATTERN = r"^第 ?[0-9０-９]+ ?章$"
MIXED_JIE_PATTERN   = r"^第 ?[0-9０-９]+ ?[節节]$"
MIXED_KUAN_PATTERN  = r"^第 ?[0-9０-９]+ ?款$"


CHINESE_META_DEFAULT_LEVEL_PATTERNS: dict[str, list[str]] = {
    "2": [r"^.*$"],
    "3": [r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*章$"],
    "4": [r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[节節]$"],
    "5": [r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[条條](?:之(?:[一二三四五六七八九十百千零两〇]+|[0-9]+))?$"],
    "6": [r"^[（(][一二三四五六七八九十百千零两〇]+[）)]$"],
}


# ── Compact canonical patterns (used by _infer_pattern) ──────────────────────
_COMPACT_ZHANG = r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*章$"
_COMPACT_JIE   = r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[节節]$"
_COMPACT_TIAO  = (
    r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[条條]"
    r"(?:之(?:[一二三四五六七八九十百千零两〇]+|[0-9]+))?$"
)
_COMPACT_KUAN  = r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*款$"
_COMPACT_MU    = r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*目$"
_COMPACT_XIANG = r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*[項项]$"
_COMPACT_BIAN  = r"^第[\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\s　]*編$"
# L6 levelPattern includes \s* so " (一) " (with spaces from redjayXmlTag)
# is matched even before whitespace normalisation fires.
_COMPACT_PAREN = r"^\s*[（(][一二三四五六七八九十百千零两〇]+[）)]\s*$"


# ── Path transform cleanup rules ─────────────────────────────────────────────
# Handles three artifacts in Chinese legal document XML title tags:
#   1. HTML bold markup:         <b>第一章 总则</b>   → strip <b>/</b>
#   2. Trailing title text:      "第一章 总则"         → strip " 总则"
#   3. Surrounding whitespace:   " (一) "             → strip leading/trailing spaces
#      The redjayXmlTag for L6 is <title> (—) </title> with spaces around the
#      placeholder; real values arrive as " (一) " and need trimming.
#   4. Full-width parentheses:   （一）               → normalize to (一)
# All rules are idempotent — no-op on clean input.
CHINESE_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    # 章/节/条 levels: strip bold markup then trailing title text
    "3":  [[r"</?b>", "", 0, ""], [r"\s+\S.*$", "", 0, ""]],
    "4":  [[r"</?b>", "", 0, ""], [r"\s+\S.*$", "", 0, ""]],
    "5":  [[r"</?b>", "", 0, ""], [r"\s+\S.*$", "", 0, ""]],
    # Parenthetical levels: bold strip, trim spaces, full-width → half-width
    # Order matters: trim spaces BEFORE paren normalisation so "（ 一 ）" edge
    # cases are handled correctly.
    "6":  [[r"</?b>", "", 0, ""], [r"^\s+|\s+$", "", 0, ""],
           [r"（", "(", 0, ""], [r"）", ")", 0, ""]],
    "7":  [[r"</?b>", "", 0, ""], [r"\s+\S.*$", "", 0, ""]],
    "8":  [[r"</?b>", "", 0, ""], [r"^\s+|\s+$", "", 0, ""],
           [r"（", "(", 0, ""], [r"）", ")", 0, ""]],
    "9":  [[r"</?b>", "", 0, ""], [r"^\s+|\s+$", "", 0, ""],
           [r"（", "(", 0, ""], [r"）", ")", 0, ""]],
}

# Inference helper
def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    defn = definition.lower()
    sample = [ex.strip() for ex in examples if ex and ex.strip()]
    probe = "\n".join(sample)
    first = sample[0] if sample else ""

    # --- 六級法律層級 / six-tier legal hierarchy ---

    # 編
    if re.search(r'第.{0,4}編', first) or "編" in defn:
        return [_COMPACT_BIAN]

    # 章
    if re.search(r'第.{0,4}章', probe) or "章" in defn:
        return [_COMPACT_ZHANG]

    # 節
    if re.search(r'第.{0,4}[節节]', probe) or "節" in defn or "节" in defn:
        return [_COMPACT_JIE]

    # 條 (articles) — most common legal unit
    if re.search(r'第.{0,4}[條条]', probe) or "條" in defn or "条" in defn:
        return [_COMPACT_TIAO]

    # 款
    if re.search(r'第.{0,4}款', first) or "款" in defn:
        return [_COMPACT_KUAN]

    # 目
    if re.search(r'第.{0,4}目', first) or "目" in defn:
        return [_COMPACT_MU]

    # 項
    if re.search(r'第.{0,4}[項项]', probe) or "項" in defn or "项" in defn:
        return [_COMPACT_XIANG]

    # --- 圓圈數字 / circled numerals ---
    if re.search(r'[①-⑳]', probe):
        return [CIRCLE_PATTERN]

    if re.search(r'[⑴-⑽]', probe):
        return [CIRCLE_PAREN_PATTERN]

    # --- 頓號列點 / tian-shaped bullets  一、 ---
    if re.search(rf'^({_N})[、]', probe) or "、" in probe:
        return [TIAN_PATTERN]

    # --- 括弧中文數字 / parenthetical CJK ---
    if re.search(r'[（(][一二三四五六七八九十百]+[）)]', probe):
        return [_COMPACT_PAREN]

    # --- 裸中文數字 / bare CJK numeral paragraph marker ---
    if re.search(rf'^({_N})$', first):
        return [rf"^({_N})$"]

    # --- 羅馬數字 / Roman numerals ---
    if re.search(r'[（(][ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]', probe):
        return [ROMAN_PAREN_PATTERN]

    if re.search(r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]', first):
        return [ROMAN_PATTERN]

    # --- 拉丁字母括弧 / Latin alpha paren ---
    if re.search(r'^[（(][a-z][）)]$', first):
        return [ALPHA_LOWER_PAREN_PATTERN]

    if re.search(r'^[（(][A-Z][）)]$', first):
        return [ALPHA_UPPER_PAREN_PATTERN]

    # --- 全型阿拉伯 / full-width Arabic ---
    if re.search(r'[０-９]', probe):
        return [FULLWIDTH_ARABIC_PATTERN, ARABIC_PATTERN]

    # --- 點式大綱 / dotted outline ---
    if re.search(r'^[0-9０-９]+[\.．][0-9０-９]+[\.．][0-9０-９]+[\.．][0-9０-９]+', first):
        return [DOTTED_4_PATTERN]
    if re.search(r'^[0-9０-９]+[\.．][0-9０-９]+[\.．][0-9０-９]+', first):
        return [DOTTED_3_PATTERN]
    if re.search(r'^[0-9０-９]+[\.．][0-9０-９]+', first):
        return [DOTTED_2_PATTERN]
    if re.search(r'^[0-9０-９]+[\.．]$', first):
        return [DOTTED_1_PATTERN]

    # --- 純阿拉伯 / bare Arabic ---
    if re.search(r'^[0-9０-９]+$', first):
        return [ARABIC_PATTERN]

    # Catch-all
    return [r"^.*$"]

# Public generator class

class ChinesePatternGenerator(PatternGeneratorBase):
    supported_languages = [
        "chinese", "chinese (traditional)", "chinese (simplified)",
        "zh", "zh-tw", "zh-cn", "zh-hk", "zh-mo",
        "mandarin", "cantonese",
        "traditional chinese", "simplified chinese",
    ]

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result = {}
        for lvl in levels:
            result[str(lvl.level)] = _infer_pattern(lvl.definition, lvl.examples)
        return result