"""
japanese.py
-----------
Pattern generator for Japanese-language documents.
Handles: 第X条, 第X項, 第X章, katakana lists (イロハ), mixed Arabic/kanji numerals.
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition

_JP_NUMERALS = (
    "二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|"
    "三十一|三十二|三十三|三十四|三十五|三十六|三十七|三十八|三十九|"
    "四十|四十一|四十二|四十三|四十四|四十五|四十六|四十七|四十八|四十九|"
    "五十|五十一|五十二|五十三|五十四|五十五|五十六|五十七|五十八|五十九|"
    "六十|七十|八十|九十|百|"
    "十一|十二|十三|十四|十五|十六|十七|十八|十九|"
    "二十|三十|"
    "一|二|三|四|五|六|七|八|九|十"
)

# 第X条 — articles
_ARTICLE_PATTERN = (
    rf"^第 ?({_JP_NUMERALS}|[0-9０-９]+) ?条"
    rf"(の([0-9０-９]+|{_JP_NUMERALS}))?"
    rf"(?:\s+.*)?$"
)

# 第X章 — chapters
_CHAPTER_PATTERN = rf"^第 ?({_JP_NUMERALS}|[0-9０-９]+) ?章(?:\s+.*)?$"

# 第X節 — sections
_SECTION_PATTERN = rf"^第 ?({_JP_NUMERALS}|[0-9０-９]+) ?節(?:\s+.*)?$"

# 第X項 — paragraphs
_PARAGRAPH_PATTERN = rf"^第 ?({_JP_NUMERALS}|[0-9０-９]+) ?項(?:\s+.*)?$"

# Katakana enumeration: ア, イ, ウ ... (full-width)
_KATAKANA_PATTERN = r"^[ァ-ヶー][ァ-ヶー\.．、]?$"

# Arabic-only
_ARABIC_PATTERN = r"^[0-9０-９]+$"

# Parenthetical Arabic: （1）
_PAREN_ARABIC_PATTERN = r"^[（(][0-9０-９]+[）)]$"
_DOTTED_ARABIC_PATTERN = r"^[0-9０-９]+[\.．]$"
_CIRCLE_PATTERN = r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$"
_PAREN_ROMAN_PATTERN = r"^[（(][ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻivxlcdmIVXLCDM]+[）)]$"
_SUPP_PATTERN = r"^附\s*則(?:.*)$"
_BRACKET_ANNEX_PATTERN = r"^\[[^\]]+\]$"


JAPANESE_META_DEFAULT_LEVEL_PATTERNS: dict[str, list[str]] = {
    "2":  [r"^.*$"],
    "3":  [r"^第[\s　]*(?:[一二三四五六七八九十百千〇零]+|[0-9０-９]+)[\s　]*章$"],
    "4":  [r"^第[\s　]*(?:[一二三四五六七八九十百千〇零]+|[0-9０-９]+)[\s　]*節$"],
    "5":  [r"^[0-9０-９]+[\.．]$", r"^第[\s　]*(?:[一二三四五六七八九十百千〇零]+|[0-9０-９]+)[\s　]*条$"],
    "6":  [r"^[0-9０-９]+$"],
    "7":  [r"^[（(][0-9０-９]+[）)]$"],
    "8":  [r"^[イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][\.．、]?$"],
    "9":  [r"^[（(][イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][）)]$"],
    "10": [r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$"],
    "11": [r"^[（(][ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻivxlcdmIVXLCDM]+[）)]$"],
    "12": [r"^[イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][\.．、]?$"],
    "13": [r"^附\s*則(?:.*)$"],
}


JAPANESE_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    "3":  [[" [^>]+", "", 0, ""]],
    "4":  [[" [^>]+", "", 0, ""]],
    "5":  [[" [^>]+", "", 0, ""]],
    "6":  [[" [^>]+", "", 0, ""]],
    "7":  [[" [^>]+", "", 0, ""]],
    "8":  [[" [^>]+", "", 0, ""], ["か[^>]+", "", 0, ""], ["及[^>]+", "", 0, ""]],
    "17": [["則 [^>]+", "則", 0, ""], ["：$", "", 0, ""]],
}


def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    defn = definition.lower()
    sample = [ex.strip() for ex in examples if ex and ex.strip()]
    probe = "\n".join(sample)

    if re.search(r'第\s*(?:[0-9０-９]|[一二三四五六七八九十百千〇零]).*条', probe) or "条" in defn:
        return [_ARTICLE_PATTERN]
    if re.search(r'第\s*(?:[0-9０-９]|[一二三四五六七八九十百千〇零]).*章', probe) or "章" in defn:
        return [_CHAPTER_PATTERN]
    if re.search(r'第\s*(?:[0-9０-９]|[一二三四五六七八九十百千〇零]).*節', probe) or "節" in defn:
        return [_SECTION_PATTERN]
    if re.search(r'第\s*(?:[0-9０-９]|[一二三四五六七八九十百千〇零]).*項', probe) or "項" in defn:
        return [_PARAGRAPH_PATTERN]

    out: list[str] = []
    if any(re.search(r'^[ァ-ヶー][ァ-ヶー\.．、]?$', ex) for ex in sample) or "イロハ" in defn:
        out.append(_KATAKANA_PATTERN)
    if any(re.search(r'^[（(][0-9０-９]+[）)]$', ex) for ex in sample):
        out.append(_PAREN_ARABIC_PATTERN)
    if any(re.search(r'^[0-9０-９]+[\.．]$', ex) for ex in sample):
        out.append(_DOTTED_ARABIC_PATTERN)
    if any(re.search(r'^[0-9０-９]+$', ex) for ex in sample):
        out.append(_ARABIC_PATTERN)
    if any(re.search(r'^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$', ex) for ex in sample):
        out.append(_CIRCLE_PATTERN)
    if any(re.search(r'^[（(][ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻivxlcdmIVXLCDM]+[）)]$', ex) for ex in sample):
        out.append(_PAREN_ROMAN_PATTERN)
    if any(re.search(r'^附\s*則', ex) for ex in sample) or "supplementary" in defn:
        out.append(_SUPP_PATTERN)
    if any(re.search(r'^\[[^\]]+\]$', ex) for ex in sample):
        out.append(_BRACKET_ANNEX_PATTERN)

    if out:
        return list(dict.fromkeys(out))
    return [r"^.*$"]


class JapanesePatternGenerator(PatternGeneratorBase):
    supported_languages = ["japanese", "ja", "jp"]

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result = {}
        for lvl in levels:
            result[str(lvl.level)] = _infer_pattern(lvl.definition, lvl.examples)
        return result