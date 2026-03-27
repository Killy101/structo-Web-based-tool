"""
korean.py
---------
Pattern generator for Korean-language documents.
Handles: 제X조, 제X장, 제X항, Hangul ordinals, mixed Arabic/Hangul.
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition

_KR_NUMERALS = (
    "이십일|이십이|이십삼|이십사|이십오|이십육|이십칠|이십팔|이십구|"
    "삼십|삼십일|사십|오십|육십|칠십|팔십|구십|백|"
    "십일|십이|십삼|십사|십오|십육|십칠|십팔|십구|이십|"
    "일|이|삼|사|오|육|칠|팔|구|십"
)

# ── Structural headings ───────────────────────────────────────────────────────
_PART_PATTERN      = r"^제 ?[0-9]+ ?편(의[0-9]+)?$"
_CHAPTER_PATTERN   = r"^제 ?[0-9]+ ?장(의[0-9]+)?$"
_SECTION_PATTERN   = r"^제 ?[0-9]+ ?절$"
_SUBSECTION_PATTERN = r"^제 ?[0-9]+ ?관(의[0-9]+)?$"
_ARTICLE_PATTERN   = r"^제 ?[0-9]+ ?조(?:의[0-9]+)*$"

# ── Sub-article levels ────────────────────────────────────────────────────────
# Level 8: circled numbers — full set ①…㊿ (Unicode U+2460–U+24FF range used in KR law)
_CIRCLE_PATTERN = (
    r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
    r"㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿]$"
)

# Level 9: Arabic numeral with period — two patterns as in the BRD
_ARABIC_DOTTED_PATTERN_1 = r"^[0-9]+\.$"
_ARABIC_DOTTED_PATTERN_2 = r"^[0-9]+ ?(의[0-9]+)?\.$"

# Level 10: Korean syllable (explicit consonant-head list) with period
_HANGUL_DOTTED_PATTERN = (
    r"^[가나다라마바사아자차카타파하"
    r"거너더러머버서어저처커터퍼허"
    r"고노도로모]+\.$"
)

# Level 11: Arabic with right-parenthesis
_RIGHT_PAREN_ARABIC_PATTERN = r"^[0-9]+\)$"

# Level 12: Korean syllable (same explicit list) with right-parenthesis
_HANGUL_RIGHT_PAREN_PATTERN = (
    r"^[가나다라마바사아자차카타파하"
    r"거너더러머버서어저처커터퍼허"
    r"고노도로모]+\)$"
)

# Levels 13–15: catch-all (document-specific content handled via pathTransform)
_CATCH_ALL = r"^.*$"

# Legacy patterns kept for _infer_pattern fallback logic
_ANNEX_PATTERN          = r"^\[별표(?:\s*[0-9０-９]+(?:의[0-9０-９]+)?)?\]$"
_ADDENDA_HEADING_PATTERN = r"^부칙$"
_ADDENDA_LINE_PATTERN   = (
    r"^<\s*제[0-9０-９]{4}-[0-9０-９]+호\s*,"
    r"\s*[0-9０-９]{4}\.\s*[0-9０-９]{1,2}\.\s*[0-9０-９]{1,2}\s*>$"
)
_ARABIC_PATTERN = r"^[0-9]+$"


# ── Default level-pattern map for Korean ─────────────────────────────────────
# This is the canonical output that matches the BRD spec exactly.
KOREAN_DEFAULT_PATTERNS: dict[str, list[str]] = {
    "2":  [r"^.*$"],
    "3":  [_PART_PATTERN],
    "4":  [_CHAPTER_PATTERN],
    "5":  [_SECTION_PATTERN],
    "6":  [_SUBSECTION_PATTERN],
    "7":  [_ARTICLE_PATTERN],
    "8":  [_CIRCLE_PATTERN],
    "9":  [_ARABIC_DOTTED_PATTERN_1, _ARABIC_DOTTED_PATTERN_2],
    "10": [_HANGUL_DOTTED_PATTERN],
    "11": [_RIGHT_PAREN_ARABIC_PATTERN],
    "12": [_HANGUL_RIGHT_PAREN_PATTERN],
    "13": [_ANNEX_PATTERN],
    "14": [_ADDENDA_HEADING_PATTERN, r"^부 칙$"],
    "15": [_ADDENDA_LINE_PATTERN, r"^<.*>$", _CATCH_ALL],
}

# Metajson-specific pathTransform structures for Korean.
KOREAN_IDENTIFIER_PATTERNS: dict[str, dict] = {
    "3":  {"identifier_pattern": "제 ?[0-9]+ ?편(의[0-9]+)?"},
    "4":  {"identifier_pattern": "제 ?[0-9]+ ?장(의[0-9]+)?"},
    "5":  {"identifier_pattern": "제 ?[0-9]+ ?절"},
    "6":  {"identifier_pattern": "제 ?[0-9]+ ?관(의[0-9]+)?"},
    "7":  {"identifier_pattern": "제 ?[0-9]+ ?조(?:의[0-9]+)*"},
    "8":  {"identifier_pattern": "[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿]+"},
    "9":  {"identifier_pattern": "[0-9]+\\."},
    "10": {"identifier_pattern": "[가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모]+\\."},
    "11": {"identifier_pattern": "[0-9]+\\)"},
    "12": {"prefix": "(", "identifier_pattern": "[가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모]+"},
    "13": {"identifier_pattern": "^.*"},
    "14": {"patterns": [["부칙", "부칙", 0, ""]], "case": ""},
    "15": {"identifier_pattern": "^.*"},
}

KOREAN_CUSTOM_TOC: dict = {
    # L3-7: structural headings have a full title after the number identifier
    # e.g. raw "제1편 총칙" → path="제1편", TOC="제1편 총칙"
    # e.g. raw "제1조(목적)" → path="제1조", TOC="제1조(목적)"
    # The TOC must use the full <title> tag content (before pathTransform strips it).
    "3":  {"tags": "title", "patterns": []},
    "4":  {"tags": "title", "patterns": []},
    "5":  {"tags": "title", "patterns": []},
    "6":  {"tags": "title", "patterns": []},
    "7":  {"tags": "title", "patterns": []},
    # L13: annex headings include description after [별표 N]
    # e.g. "[별표 1] 금융투자업자 및 그 임직원에 대한 처분..." → TOC = full title
    "13": {"tags": "title", "patterns": []},
    # L15: addenda entries may have "부 칙 <법률...> (law name)" prefix/suffix
    # TOC = full raw title (including prefix and law name)
    "15": {"tags": "title", "patterns": []},
}

KOREAN_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    # ── L2: passthrough (document title is already correct) ──────────────────
    # No rules needed — scope_entries logic handles L2 in _build_path_transform.

    # ── L3-6: strip trailing space + title text ───────────────────────────────
    # "제1편 총칙" → "제1편", "제1장 금융투자업의..." → "제1장"
    # "제2관 투자권유 등 <개정 2009...>" → "제2관"
    "3":  [[r"\s+\S.*$", "", 0, ""]],
    "4":  [[r"\s+\S.*$", "", 0, ""]],
    "5":  [[r"\s+\S.*$", "", 0, ""]],
    "6":  [[r"\s+\S.*$", "", 0, ""]],

    # ── L7: extract 제N조[의N]* prefix only ──────────────────────────────────
    # "제1조(목적)"                    → "제1조"
    # "제8조의2(금융투자상품시장 등)"    → "제8조의2"
    # "제22조 삭제 <2015. 7. 31.>"   → "제22조"
    # "제7조삭제 <2017. 1. 17.>"     → "제7조"  (삭제 directly attached)
    "7":  [[r"^(제\s*\d+조(?:의\d+)*)(?:[^의\d\n].*)?$", r"\1", 0, ""]],

    # ── L13: keep [별표 N] and strip trailing description ─────────────────────
    # "[별표 1] 금융투자업자 및 ..." → "[별표 1]"
    "13": [
        [r"^(\[별표[^\]]*\])\s+.*$", r"\1", 0, ""],
        [r"^(\[별표[^\]]*\])$",       r"\1", 0, ""],
    ],

    # ── L8-12: passthrough — raw token IS the correct path segment ─────────────
    # ① ⑩ ㊿  1.  가.  1)  가)  are used verbatim in paths.
    "8":  [],
    "9":  [],
    "10": [],
    "11": [],
    "12": [],

    # ── L14: passthrough — 부칙/부 칙 used as-is ─────────────────────────────
    "14": [],

    # ── L15: strip leading 부칙 prefix + trailing (법률명) ────────────────────
    # "부 칙 <법률 제8852호, 2008. 2. 29.> (정부조직법)" → "<법률 제8852호, 2008. 2. 29.>"
    # "부 칙 <법률 제9407호, 2009. 2. 3.>"             → "<법률 제9407호, 2009. 2. 3.>"
    "15": [
        [r"^부\s*칙\s+", "", 0, ""],
        [r"\s+\([^)]+\)\s*$", "", 0, ""],
    ],
}


def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    """
    Infer the pattern for a single level from its definition text and examples.
    Falls back to the canonical default for well-known Korean structural levels.
    """
    defn = definition.lower()
    sample = [ex.strip() for ex in examples if ex and ex.strip()]
    probe = "\n".join(sample)

    if re.search(r'제\s*(?:[0-9０-９]|[일이삼사오육칠팔구십백천]).*편', probe) or "편" in defn:
        return [_PART_PATTERN]
    if re.search(r'제\s*(?:[0-9０-９]|[일이삼사오육칠팔구십백천]).*장', probe) or "장" in defn:
        return [_CHAPTER_PATTERN]
    if re.search(r'제\s*(?:[0-9０-９]|[일이삼사오육칠팔구십백천]).*절', probe) or "절" in defn:
        return [_SECTION_PATTERN]
    if re.search(r'제\s*(?:[0-9０-９]|[일이삼사오육칠팔구십백천]).*관', probe) or "관" in defn:
        return [_SUBSECTION_PATTERN]
    if re.search(r'제\s*(?:[0-9０-９]|[일이삼사오육칠팔구십백천]).*조', probe) or "조" in defn:
        return [_ARTICLE_PATTERN]

    out: list[str] = []

    if any(re.search(r'^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿]', ex) for ex in sample):
        out.append(_CIRCLE_PATTERN)
    if any(re.search(r'^[0-9０-９]+(?:의[0-9０-９]+)?\.$', ex) for ex in sample):
        out.extend([_ARABIC_DOTTED_PATTERN_1, _ARABIC_DOTTED_PATTERN_2])
    if any(re.search(r'^[가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모]+\.$', ex) for ex in sample):
        out.append(_HANGUL_DOTTED_PATTERN)
    if any(re.search(r'^[0-9０-９]+\)$', ex) for ex in sample):
        out.append(_RIGHT_PAREN_ARABIC_PATTERN)
    if any(re.search(r'^[가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모]+\)$', ex) for ex in sample):
        out.append(_HANGUL_RIGHT_PAREN_PATTERN)
    if any(re.search(r'^\[별표', ex) for ex in sample) or "별표" in defn:
        out.append(_CATCH_ALL)
    if any(ex == "부칙" for ex in sample) or "부칙" in defn:
        out.append(_CATCH_ALL)
    if any(re.search(r'^<\s*제[0-9０-９]{4}-[0-9０-９]+호', ex) for ex in sample):
        out.append(_CATCH_ALL)
    if any(re.search(r'^[0-9０-９]+$', ex) for ex in sample):
        out.append(_ARABIC_PATTERN)

    if out:
        # Remove duplicates while preserving order
        seen: set[str] = set()
        deduped = []
        for p in out:
            if p not in seen:
                seen.add(p)
                deduped.append(p)
        return deduped

    return [_CATCH_ALL]


class KoreanPatternGenerator(PatternGeneratorBase):
    supported_languages = ["korean", "ko", "kr"]
    KOREAN_PATH_TRANSFORM_CLEANUP = KOREAN_PATH_TRANSFORM_CLEANUP
    KOREAN_DEFAULT_PATTERNS = KOREAN_DEFAULT_PATTERNS

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for lvl in levels:
            key = str(lvl.level)
            # Use canonical defaults when available and the level has no
            # specific definition/example content to override with.
            if key in KOREAN_DEFAULT_PATTERNS and not lvl.definition and not lvl.examples:
                result[key] = list(KOREAN_DEFAULT_PATTERNS[key])
            else:
                inferred = _infer_pattern(lvl.definition, lvl.examples)
                # If inference returned the generic catch-all AND we have a
                # canonical default, prefer the canonical default.
                if inferred == [r"^.*$"] and key in KOREAN_DEFAULT_PATTERNS:
                    result[key] = list(KOREAN_DEFAULT_PATTERNS[key])
                else:
                    result[key] = inferred
        return result