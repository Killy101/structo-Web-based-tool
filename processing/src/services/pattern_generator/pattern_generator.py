"""Unified pattern and metajson generation.

Edit language-specific regex behavior in `languages/*.py`.
This module orchestrates both level-pattern inference and metajson assembly.
"""

import re
from datetime import datetime, timezone
from .base import LevelDefinition, PatternGeneratorBase
from .languages.english import (
    EnglishPatternGenerator,
    ENGLISH_META_DEFAULT_LEVEL_PATTERNS,
    ENGLISH_PATH_TRANSFORM_CLEANUP,
)
from .languages.chinese import ChinesePatternGenerator, CHINESE_META_DEFAULT_LEVEL_PATTERNS, CHINESE_PATH_TRANSFORM_CLEANUP
from .languages.japanese import (
    JapanesePatternGenerator,
    JAPANESE_META_DEFAULT_LEVEL_PATTERNS,
    JAPANESE_PATH_TRANSFORM_CLEANUP,
)
from .languages.korean import (
    KoreanPatternGenerator,
    KOREAN_DEFAULT_PATTERNS,
    KOREAN_IDENTIFIER_PATTERNS,
    KOREAN_CUSTOM_TOC,
    KOREAN_PATH_TRANSFORM_CLEANUP,
)
from .languages.portuguese import (
    PortuguesePatternGenerator,
    PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS,
    PORTUGUESE_PATH_TRANSFORM_CLEANUP,
)
from .languages.spanish import (
    SpanishPatternGenerator,
    SPANISH_META_DEFAULT_LEVEL_PATTERNS,
    SPANISH_PATH_TRANSFORM_CLEANUP,
)


_LANGUAGE_REGISTRY: dict[str, type[PatternGeneratorBase]] = {}


def _register() -> None:
    for cls in [
        EnglishPatternGenerator,
        ChinesePatternGenerator,
        JapanesePatternGenerator,
        KoreanPatternGenerator,
        PortuguesePatternGenerator,
        SpanishPatternGenerator,
    ]:
        for lang in cls.supported_languages:
            _LANGUAGE_REGISTRY[lang.lower()] = cls


_register()


def get_generator(language: str) -> PatternGeneratorBase:
    key = (language or "").lower().strip()
    cls = _LANGUAGE_REGISTRY.get(key, EnglishPatternGenerator)
    return cls()


def _extract_patterns_from_text(text: str) -> list[str]:
    """Extract explicit regex lines from free-text citation/definition blocks."""
    if not text or not text.strip():
        return []

    def _looks_regex_pattern(raw: str) -> bool:
        lowered = raw.lower()
        if "<level" in lowered or "example:" in lowered:
            return False
        if re.search(r"\+\s*\"", raw):
            return False
        return bool(
            re.search(r"(\^|\$|\\[dDsSwWbBAZz]|\\\\.)", raw)
            or re.search(r"\[[^\]]+\](?:\{\d+(?:,\d*)?\}|[+*?])?", raw)
            or re.search(r"\([^)]*\|[^)]*\)", raw)
            or re.search(r"(?:\)|\]|\.|[A-Za-z0-9])[+*?]", raw)
        )

    lines = text.replace("\r", "\n").replace("\t", " ").split("\n")
    cleaned: list[str] = []
    plain_candidates: list[str] = []

    def _infer_heading_regex(raw_text: str) -> str | None:
        candidate = re.sub(r"\s+", " ", raw_text).strip(" \"'`")
        if not candidate:
            return None

        number_tail = r"[0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*"

        # Drop boilerplate labels that frequently wrap real examples.
        candidate = re.sub(r"^level\s*\d+\s*", "", candidate, flags=re.IGNORECASE).strip(" :-")
        candidate = re.sub(r"^(example|examples|pattern|regex|rule)\s*:\s*", "", candidate, flags=re.IGNORECASE).strip()
        if not candidate:
            return None

        # Support section-sign citation styles used by many BRDs, including
        # mixed forms like "Section § 12", "§§ 12-1", and "Pattern: § 12(a)".
        if "§" in candidate:
            if re.search(r"[0-9A-Za-z]", candidate):
                return rf"^(?:SECTION|Section|Sec\.?\s*)?\s*§{{1,2}}\s*{number_tail}(?:\([0-9A-Za-z]+\))*$"
            return rf"^§{{1,2}}\s*{number_tail}(?:\([0-9A-Za-z]+\))*$"

        m = re.match(
            r"^(chapter|part|division|subdivision|section|article|rule|title|subtitle|subpart|subchapter|appendix|schedule|exhibit|attachment|form)\s+([0-9]+(?:[A-Z])?(?:[-.][0-9A-Z]+)*)$",
            candidate,
            flags=re.IGNORECASE,
        )
        if not m:
            return None

        keyword = m.group(1)
        if keyword.lower() == "article":
            kw = r"(ARTICLE|Article|Art\\.?)"
        else:
            kw = f"({keyword.upper()}|{keyword.title()})"

        return f"^{kw} ?[0-9]+[A-Z]?(?:[-.][0-9A-Z]+)*$"

    for line in lines:
        cur = line.strip()
        if not cur:
            continue
        cur = re.sub(r"^<\s*level\s*\d+\s*>\s*", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"^level\s*\d+\s*[:\-]?\s*", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"^[-*\d.)\s]+", "", cur).strip()
        cur = re.sub(r"^(pattern|regex|rule|example|examples|notes?)\s*:\s*", "", cur, flags=re.IGNORECASE).strip()
        cur = cur.strip('"\'`').strip().rstrip(",")
        cur = re.sub(r"\bexample\s*:.*$", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"\*\s*note\s*:.*$", "", cur, flags=re.IGNORECASE).strip()
        if not cur:
            continue
        slash_wrapped = re.match(r"^/(.+)/[gimsuy]*$", cur)
        if slash_wrapped:
            cur = slash_wrapped.group(1)
        if _looks_regex_pattern(cur):
            cleaned.append(cur)
            continue

        for segment in re.split(r"[;\n]+", cur):
            segment = segment.strip()
            if segment:
                plain_candidates.append(segment)

    for candidate in plain_candidates:
        inferred = _infer_heading_regex(candidate)
        if inferred:
            cleaned.append(inferred)

    dedup: list[str] = []
    seen: set[str] = set()
    for item in cleaned:
        if item in seen:
            continue
        seen.add(item)
        dedup.append(item)
    return dedup


def _extract_titles_from_redjay_xml_tag(tag: str) -> list[str]:
    """Extract unique <title> values from Redjay XML tag snippets."""
    text = (tag or "").strip()
    if not text or "hardcoded" in text.lower():
        return []

    titles = [
        re.sub(r"\s+", " ", m.group(1)).strip()
        for m in re.finditer(r"<title>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
        if m.group(1).strip()
    ]

    dedup: list[str] = []
    seen: set[str] = set()
    for title in titles:
        if title in seen:
            continue
        seen.add(title)
        dedup.append(title)
    return dedup


def _keyword_patterns_from_title(title: str) -> list[str]:
    """Fallback heuristic for heading regex when language generators return generic output."""
    t = (title or "").strip()
    if not t:
        return []

    lower = t.lower()
    number_tail = r"[0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*"

    if "subdivision" in lower:
        return [rf"^(SUBDIVISION|Subdivision) ?{number_tail}$"]
    if "division" in lower:
        return [rf"^(DIVISION|Division) ?{number_tail}$"]
    if "chapter" in lower:
        return [rf"^(CHAPTER|Chapter) ?{number_tail}$"]
    if "part" in lower:
        return [rf"^(PART|Part) ?{number_tail}$"]
    if "section" in lower:
        return [rf"^(SECTION|Section) ?{number_tail}$", rf"^{number_tail}$"]
    if "article" in lower or re.search(r"\bart\.?\b", lower):
        return [rf"^(ARTICLE|Article|Art\.?) ?{number_tail}$", rf"^{number_tail}$"]
    if "schedule" in lower:
        return [rf"^(SCHEDULE|Schedule) ?{number_tail}$"]
    if "endnote" in lower:
        return [r"^(ENDNOTE|Endnote|ENDNOTES|Endnotes) ?[0-9A-Za-z]*$"]

    if re.search(r"\bs\.?\s*[0-9A-Za-z]", t):
        return [rf"^(?:s\.?\s*)?{number_tail}$"]

    token_m = re.match(r"^([A-Za-z]+)", t)
    if token_m:
        token = token_m.group(1)
        esc = re.escape(token)
        return [rf"^({esc.upper()}|{token[:1].upper()}{token[1:].lower()}) ?{number_tail}$"]

    if re.fullmatch(r"[0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*", t):
        return [rf"^{number_tail}$"]

    return []


def _patterns_from_redjay_xml_tag(tag: str, language: str, level_num: int = 3) -> list[str]:
    """
    Build regex patterns from Redjay <title> nodes.

    Priority:
      1) language-specific generator in languages/*.py (best for non-English)
      2) keyword fallback heuristic for sparse/unknown title formats
    """
    titles = _extract_titles_from_redjay_xml_tag(tag)
    if not titles:
        return []

    patterns: list[str] = []

    # First, use the configured language generator so each language module can
    # recognize its own structures from Redjay titles.
    try:
        generator = get_generator(language)
        inferred = generator.generate([
            LevelDefinition(
                level=level_num,
                definition="",
                examples=titles,
                required=False,
                name=None,
            )
        ])
        lang_patterns = [p for p in inferred.get(str(level_num), []) if p and p.strip()]
        if lang_patterns and not _is_generic_pattern_set(lang_patterns):
            patterns.extend(lang_patterns)
    except Exception:
        # Fall through to heuristic patterns below.
        pass

    # Add heuristic patterns only when the language generator returned nothing
    # useful. For Spanish/Portuguese/etc the generator already produces correct
    # ordinal/roman/alpha patterns — appending keyword heuristics on top would
    # add junk patterns like ^(OCTAVA|Octava) ?[0-9A-Za-z]+... from raw examples.
    if not patterns or _is_generic_pattern_set(patterns):
        for title in titles:
            patterns.extend(_keyword_patterns_from_title(title))

    dedup: list[str] = []
    seen: set[str] = set()
    for p in patterns:
        if not p or p in seen:
            continue
        seen.add(p)
        dedup.append(p)
    return dedup


def _build_path_transform_from_content_profile_redjay(
    content_profile: dict | None,
    language: str,
    level_range: tuple[int, int],
) -> dict[str, dict]:
    """
    Build pathTransform rows from contentProfile.levels[].redjayXmlTag.

    For each level >= 3, this calls the selected language generator from
    languages/*.py and emits regex rows as [pattern, "", 0, ""].
    """
    if not isinstance(content_profile, dict):
        return {}

    raw_levels = content_profile.get("levels")
    if not isinstance(raw_levels, list):
        return {}

    min_level, max_level = level_range
    out: dict[str, dict] = {}

    for row in raw_levels:
        if not isinstance(row, dict):
            continue

        level_raw = row.get("levelNumber") or row.get("level")
        level_m = re.search(r"\d+", str(level_raw or ""))
        if not level_m:
            continue

        level_num = int(level_m.group(0))
        if level_num < 3:
            continue
        if level_num < min_level or level_num > max_level:
            continue

        redjay = str(row.get("redjayXmlTag") or row.get("redjay_xml_tag") or "")
        patterns = _patterns_from_redjay_xml_tag(redjay, language, level_num)
        if not patterns:
            continue

        rows = [[p, "", 0, ""] for p in patterns if p and str(p).strip()]
        if not rows:
            continue

        out[str(level_num)] = {
            "patterns": rows,
            "case": "",
        }

    return out


_SPANISH_STOPWORDS = frozenset([
    "a", "al", "con", "de", "del", "e", "el", "en",
    "la", "las", "lo", "los", "o", "para", "por",
    "que", "se", "sin", "un", "una", "unos", "unas", "y",
])


def _spanish_title_case(text: str) -> str:
    """Convert ALL-CAPS Spanish string to Title Case, keeping stopwords lowercase."""
    text = text.strip()
    if not text:
        return text
    words = text.split()
    result = []
    for i, word in enumerate(words):
        if word.isdigit():
            result.append(word)
            continue
        lower = word.lower()
        if i > 0 and lower in _SPANISH_STOPWORDS:
            result.append(lower)
        else:
            result.append(word[0].upper() + word[1:].lower() if len(word) > 1 else word.upper())
    return " ".join(result)


def _normalize_language_key(language: str) -> str:
    key = (language or "").strip().lower()
    compact = key.replace("_", "-")
    if key in ("es", "spa") or compact.startswith("es-"):
        return "spanish"
    if key in ("pt", "por") or compact.startswith("pt-"):
        return "portuguese"
    if key in ("zh", "zho") or compact.startswith("zh-"):
        return "chinese"
    if key in ("ja", "jpn") or compact.startswith("ja-"):
        return "japanese"
    if key in ("ko", "kor") or compact.startswith("ko-"):
        return "korean"
    if any(tag in key for tag in ["spanish", "español", "espanol", "castellano", "es-"]):
        return "spanish"
    if any(tag in key for tag in ["portuguese", "português", "portugues", "pt-"]):
        return "portuguese"
    if any(tag in key for tag in ["chinese", "中文", "汉语", "漢語", "zh", "zh-"]):
        return "chinese"
    if any(tag in key for tag in ["japanese", "日本語", "ja", "ja-"]):
        return "japanese"
    if any(tag in key for tag in ["korean", "한국어", "ko", "ko-"]):
        return "korean"
    return "english"


def _is_generic_pattern_set(patterns: list[str]) -> bool:
    normalized = [p.strip() for p in patterns if p and p.strip()]
    return normalized == [r"^.*$"]


def _language_level_defaults(language: str) -> dict[str, list[str]]:
    lang = _normalize_language_key(language)
    if lang == "chinese":
        return dict(CHINESE_META_DEFAULT_LEVEL_PATTERNS)
    if lang == "japanese":
        return dict(JAPANESE_META_DEFAULT_LEVEL_PATTERNS)
    if lang == "korean":
        return dict(KOREAN_DEFAULT_PATTERNS)
    if lang == "spanish":
        return dict(SPANISH_META_DEFAULT_LEVEL_PATTERNS)
    if lang == "portuguese":
        return dict(PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS)
    return dict(ENGLISH_META_DEFAULT_LEVEL_PATTERNS)


def generate_level_patterns(language: str, levels: list[dict]) -> dict[str, list[str]]:
    level_defs = [
        LevelDefinition(
            level=item["level"],
            definition=item.get("definition", ""),
            examples=item.get("examples", []),
            required=item.get("required", False),
            name=item.get("name"),
        )
        for item in levels
    ]

    generator = get_generator(language)
    inferred = generator.generate(level_defs)

    # Explicit regex authored in citation/definition text has highest priority.
    for level_def in level_defs:
        extracted = _extract_patterns_from_text(level_def.definition)
        if extracted:
            inferred[str(level_def.level)] = extracted

    # Content profile Redjay XML is the most faithful source for structural
    # labels. When present for a level, use it unless an explicit regex was
    # already authored in citation/definition text for that same level.
    explicit_regex_levels = {
        str(level_def.level)
        for level_def in level_defs
        if _extract_patterns_from_text(level_def.definition)
    }
    for item in levels:
        level_key = str(item.get("level"))
        if not level_key.isdigit() or level_key in explicit_regex_levels:
            continue
        redjay_patterns = _patterns_from_redjay_xml_tag(
            str(item.get("redjayXmlTag") or ""),
            language,
        )
        if redjay_patterns:
            # Only use redjay patterns when the language generator has not
            # already produced specific (non-generic) patterns from the BRD
            # definition/example fields. Redjay titles are raw identifier
            # samples (e.g. "OCTAVA.", "VI.", "b)") — if the language
            # generator already matched those into correct patterns, the
            # redjay heuristic would only add noise.
            existing = inferred.get(level_key, [])
            if not existing or _is_generic_pattern_set(existing):
                inferred[level_key] = redjay_patterns

    defaults = _language_level_defaults(language)
    provided_levels = sorted({
        str(item.get("level")) for item in levels
        if str(item.get("level", "")).isdigit()
    })
    for key in provided_levels:
        default_patterns = defaults.get(key)
        if not default_patterns:
            continue
        # Only apply defaults when nothing specific was inferred.
        # Redjay-sourced and explicitly authored patterns must never be
        # overwritten by generic defaults (e.g. "[0-9]+$" clobbering Roman).
        if key not in inferred or _is_generic_pattern_set(inferred[key]):
            if key not in explicit_regex_levels:
                inferred[key] = list(default_patterns)

    # Level 2 is always document-title catch-all.
    if "2" in inferred:
        inferred["2"] = [r"^.*$"]

    return inferred


def _to_iso_date(val: str | None) -> str:
    if not val:
        return "{iso-date}"
    text = str(val).strip()
    if not text:
        return "{iso-date}"
    if text.startswith("{") and text.endswith("}"):
        return text
    date_candidates = [text, text.replace(".", "-"), text.replace("/", "-")]
    try:
        for candidate in date_candidates:
            return datetime.fromisoformat(candidate).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return "{iso-date}"


def _looks_instructional(text: str) -> bool:
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    markers = (
        "if ", "please ", "cannot be found", "has been captured",
        "is found under", "format", "e.g.", "for example",
    )
    return any(marker in lowered for marker in markers)


def _normalize_meta_string(value: str | None, placeholder: str) -> str:
    text = (value or "").strip()
    if not text or _looks_instructional(text):
        return placeholder
    return text


def _normalize_status(value: str | None) -> str:
    text = (value or "").strip()
    if not text or _looks_instructional(text):
        return "Effective"
    allowed = {
        "effective", "in force", "active", "repealed",
        "revoked", "superseded", "draft", "inactive",
    }
    return text if text.lower() in allowed else "Effective"


def _strip_ingestion_suffix(name: str) -> str:
    cleaned = re.sub(
        r"\s*\(\s*(?:Evergreen\s+)?Ingestion[^)]*\)\s*$",
        "", name, flags=re.IGNORECASE,
    ).strip()
    return cleaned or name


def _derive_source_name(raw_source_name: str, issuing_agency: str, payload_subtype: str) -> str:
    cleaned = _strip_ingestion_suffix((raw_source_name or "").strip())
    if cleaned and cleaned.lower() != "unknown source" and not _looks_instructional(cleaned):
        return cleaned
    if issuing_agency and payload_subtype:
        return f"{issuing_agency} {payload_subtype}".strip()
    if issuing_agency:
        return issuing_agency.strip()
    return "Unknown Source"


def _derive_filename(source_name: str, publication_date: str, file_index: int = 1) -> str:
    cleaned = re.sub(r"\([^)]*\)", "", source_name)
    _SKIP = {"de", "la", "el", "los", "las", "y", "of", "the", "and", "a", "e"}
    words = [w for w in re.split(r"[\s\-]+", cleaned) if w and w.lower() not in _SKIP]
    abbreviation = "".join(w[0].lower() for w in words)[:6] or "file"
    try:
        d = datetime.fromisoformat(publication_date)
        date_slug = d.strftime("%d%m%y")
    except (ValueError, TypeError):
        date_slug = datetime.now(timezone.utc).strftime("%d%m%y")
    index_str = str(file_index).zfill(2)
    return f"{abbreviation}{index_str}_VER{date_slug}"


def _derive_root_path(geography: str, source_name: str) -> str:
    geo = geography.lower().strip()
    if "united states" in geo or geo in ("us", "usa"):
        geo_code = "US"
    elif "united kingdom" in geo or geo in ("uk", "gb"):
        geo_code = "UK"
    elif "taiwan" in geo or geo == "tw":
        geo_code = "TW"
    elif "japan" in geo or geo == "jp":
        geo_code = "JP"
    elif "china" in geo or geo in ("cn", "prc"):
        geo_code = "CN"
    elif "korea" in geo or geo == "kr":
        geo_code = "KR"
    elif "brazil" in geo or geo in ("br", "brasil"):
        geo_code = "BR"
    elif "mexico" in geo or "méxico" in geo or geo == "mx":
        geo_code = "MX"
    elif "argentina" in geo or geo == "ar":
        geo_code = "AR"
    elif "colombia" in geo or geo == "co":
        geo_code = "CO"
    else:
        geo_code = geo[:2].upper().replace(" ", "")

    code_match = re.search(r"\(([A-Za-z]{2})\.([A-Za-z0-9]+)\)", source_name)
    suffix_match = re.search(
        r"\b(Acts|Act|Laws|Law|Code|Decree|Rules|Regulations|Regulation|Reglas|Regla|Regras|Regra)\b",
        source_name,
        flags=re.IGNORECASE,
    )
    if code_match:
        # Preserve original casing from the (XX.Name) pattern — do NOT uppercase.
        # e.g. "(JP.Diet)" → "Diet", not "DIET", so rootPath = /JP/JPDietActs
        code = code_match.group(2)
        suffix = suffix_match.group(1) if suffix_match else ""
        derived = f"{code}{suffix}" if suffix else code
        return f"/{geo_code}/{geo_code}{derived}"

    cleaned = re.sub(r"\([^)]*\)", "", source_name)
    _SKIP = {"de", "la", "el", "los", "las", "y", "of", "the", "and", "a", "e"}
    words = [w for w in re.split(r"[\s\-]+", cleaned) if w and w.lower() not in _SKIP]
    abbreviation = "".join(w[0].upper() for w in words) or "Source"
    return f"/{geo_code}/{geo_code}{abbreviation}"


def _derive_root_path_from_brd(content_profile: dict | None, brd_config: dict | None) -> str | None:
    if isinstance(brd_config, dict):
        for key in ("rootPath", "root_path"):
            value = brd_config.get(key)
            if isinstance(value, str) and value.strip():
                normalized = value.strip().replace("\\", "/")
                return normalized if normalized.startswith("/") else f"/{normalized}"

    if isinstance(content_profile, dict):
        for key in ("hardcoded_path", "hardcodedPath", "rootPath", "root_path"):
            value = content_profile.get(key)
            if isinstance(value, str) and value.strip():
                normalized = value.strip().replace("\\", "/")
                return normalized if normalized.startswith("/") else f"/{normalized}"
    return None


def _build_whitespace_handling(
    level_range: tuple[int, int],
    whitespace_override: dict | None = None,
) -> dict[str, list[str]]:
    if whitespace_override:
        result: dict[str, list[str]] = {"0": [], "1": [], "2": []}
        for mode_key in ("0", "1", "2"):
            val = whitespace_override.get(mode_key) or whitespace_override.get(int(mode_key))
            if val:
                result[mode_key] = [str(v) for v in val]
        return result

    min_level, max_level = level_range
    all_levels = [str(l) for l in range(min_level, max_level + 1)]
    return {"0": all_levels, "1": [], "2": []}


def _extract_korean_title(title: str) -> str:
    m = re.search(r"\((?=[^)]*[가-힣])", title)
    if m:
        return title[m.start() + 1:].rstrip(")").strip()
    if re.search(r"[가-힣]", title):
        return title.strip()
    return ""


# Shared cleanup rules applied to any Spanish level beyond the explicit
# SPANISH_PATH_TRANSFORM_CLEANUP range (levels 21+). Handles the same
# leading-space / trailing-punct patterns as the standard levels.
_SPANISH_GENERIC_LEVEL_CLEANUP: list[list] = [
    [r"^\s+", "", 0, ""],
    [r"\s*\.-$", "", 0, ""],
    [r"^\([0-9]+\)\s*", "", 0, ""],
    [r"^\(([a-zA-Z0-9]+)\)$", r"\1", 0, ""],
    [r"[.,;)\-]+$", "", 0, ""],
    [r"\([0-9]+\) ", "", 0, ""],
    [r"^([^(].*)\)$", r"\1", 0, ""],
    ["(?i)\\bCUADRAGESIMO\\b", "Cuadragesimo", 0, ""],
    ["(?i)\\bCUADRAGESIMA\\b", "Cuadragesima", 0, ""],
    ["(?i)\\bTRIGESIMO\\b",    "Trigesimo",    0, ""],
    ["(?i)\\bTRIGESIMA\\b",    "Trigesima",    0, ""],
    ["(?i)\\bVIGESIMO\\b",     "Vigesimo",     0, ""],
    ["(?i)\\bVIGESIMA\\b",     "Vigesima",     0, ""],
    ["(?i)\\bDECIMONOVENA\\b", "Decimonovena", 0, ""],
    ["(?i)\\bDECIMOCTAVA\\b",  "Decimoctava",  0, ""],
    ["(?i)\\bDECIMOSEPTIMA\\b","Decimoseptima",0, ""],
    ["(?i)\\bDECIMOSEXTA\\b",  "Decimosexta",  0, ""],
    ["(?i)\\bDECIMOQUINTA\\b", "Decimoquinta", 0, ""],
    ["(?i)\\bDECIMOCUARTA\\b", "Decimocuarta", 0, ""],
    ["(?i)\\bDECIMOTERCERA\\b","Decimotercera",0, ""],
    ["(?i)\\bDECIMOSEGUNDA\\b","Decimosegunda",0, ""],
    ["(?i)\\bDECIMOPRIMERA\\b","Decimoprimera",0, ""],
    ["(?i)\\bDECIMA\\b",       "Decima",       0, ""],
    ["(?i)\\bNOVENA\\b",       "Novena",       0, ""],
    ["(?i)\\bOCTAVA\\b",       "Octava",       0, ""],
    ["(?i)\\bSEPTIMA\\b",      "Septima",      0, ""],
    ["(?i)\\bSEXTA\\b",        "Sexta",        0, ""],
    ["(?i)\\bQUINTA\\b",       "Quinta",       0, ""],
    ["(?i)\\bCUARTA\\b",       "Cuarta",       0, ""],
    ["(?i)\\bTERCERA\\b",      "Tercera",      0, ""],
    ["(?i)\\bSEGUNDA\\b",      "Segunda",      0, ""],
    ["(?i)\\bPRIMERA\\b",      "Primera",      0, ""],
    ["(?i)\\bPRIMERO\\b",      "Primero",      0, ""],
    ["(?i)\\bSEGUNDO\\b",      "Segundo",      0, ""],
    ["(?i)\\bTERCERO\\b",      "Tercero",      0, ""],
    ["(?i)\\bCUARTO\\b",       "Cuarto",       0, ""],
    ["(?i)\\bQUINTO\\b",       "Quinto",       0, ""],
    ["(?i)^[ÚU]NIC[AO]$",      "Único",        0, ""],
    ["(?i)\\bBIS\\b",          "Bis",          0, ""],
]


def _language_cleanup_patterns(language: str, max_level: int = 20) -> dict[str, list[list]]:
    lang = _normalize_language_key(language)
    if lang == "spanish":
        base = {k: [list(row) for row in rows] for k, rows in SPANISH_PATH_TRANSFORM_CLEANUP.items()}
        # Extend with generic cleanup for any levels beyond the explicit range
        max_explicit = max((int(k) for k in base if str(k).isdigit()), default=20)
        for lvl in range(max_explicit + 1, max(max_level, max_explicit) + 1):
            base[str(lvl)] = [list(r) for r in _SPANISH_GENERIC_LEVEL_CLEANUP]
        return base
    if lang == "portuguese":
        return {k: [list(row) for row in rows] for k, rows in PORTUGUESE_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "japanese":
        return {k: [list(row) for row in rows] for k, rows in JAPANESE_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "english":
        return {k: [list(row) for row in rows] for k, rows in ENGLISH_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "korean":
        return {k: [list(row) for row in rows] for k, rows in KOREAN_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "chinese":
        return {k: [list(row) for row in rows] for k, rows in CHINESE_PATH_TRANSFORM_CLEANUP.items()}
    return {}


def _language_default_level_patterns(language: str) -> dict[str, list[str]]:
    lang = _normalize_language_key(language)
    if lang == "chinese":
        return dict(CHINESE_META_DEFAULT_LEVEL_PATTERNS)
    if lang == "japanese":
        return dict(JAPANESE_META_DEFAULT_LEVEL_PATTERNS)
    if lang == "korean":
        return dict(KOREAN_DEFAULT_PATTERNS)
    if lang == "spanish":
        return dict(SPANISH_META_DEFAULT_LEVEL_PATTERNS)
    if lang == "portuguese":
        return dict(PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS)
    return dict(ENGLISH_META_DEFAULT_LEVEL_PATTERNS)


def _trim_level_patterns_to_range(
    level_patterns: dict[str, list[str]],
    level_range: tuple[int, int],
) -> dict[str, list[str]]:
    """Keep only level patterns within [min_level, max_level]."""
    min_level, max_level = level_range
    out: dict[str, list[str]] = {}
    for key, patterns in level_patterns.items():
        if not str(key).isdigit():
            continue
        level_num = int(str(key))
        if min_level <= level_num <= max_level:
            out[str(level_num)] = list(patterns)
    return out


def _is_template_noise_pattern(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return True
    if normalized in {"level", "example", "definition", "note", "notes"}:
        return True
    if re.match(r"^level\s*\d+$", normalized):
        return True
    return False


def _sanitize_path_transform_config(raw: dict | None) -> dict:
    if not isinstance(raw, dict):
        return {}

    sanitized: dict = {}

    def _looks_regex_like(text: str) -> bool:
        return bool(re.search(r"[\\\[\](){}^$*+?.|]", text))

    for key, value in raw.items():
        k = str(key)
        level_num = int(k) if k.isdigit() else None
        if not isinstance(value, dict):
            continue
        patterns = value.get("patterns")
        if not isinstance(patterns, list):
            continue

        cleaned_rows: list[list] = []
        for row in patterns:
            if not isinstance(row, list) or len(row) < 4:
                continue
            find = str(row[0] if row[0] is not None else "").strip()
            if not find or _is_template_noise_pattern(find):
                continue
            replace = str(row[1] if row[1] is not None else "").strip()

            # For levels 3+, discard plain literal identity rows such as
            # ["Level", "Level", 0, ""] or ["Part 1", "Part 1", 0, ""].
            # Keep regex-like rows and explicit replacement rules.
            if level_num is not None and level_num >= 3:
                if replace.strip() == find and not _looks_regex_like(find):
                    continue

            try:
                flag = int(row[2])
            except (TypeError, ValueError):
                flag = 0
            extra = str(row[3] if row[3] is not None else "")
            cleaned_rows.append([find, replace, flag, extra])

        if cleaned_rows:
            sanitized[k] = {"patterns": cleaned_rows, "case": str(value.get("case") or "")}

    return sanitized


def _build_path_transform(
    scope_entries: list[str],
    level_range: tuple[int, int],
    language: str,
    content_profile: dict | None = None,
    citations: dict | None = None,
    level_patterns: dict[str, list[str]] | None = None,
    brd_config: dict | None = None,
) -> dict:
    """
    Build pathTransform. Each level entry is a list of [find, replace, 0, ""]
    substitution rows — the same concept as levelPatterns but operating on the
    heading label text rather than the citation number.

    Sources for levels 3+, in priority order (highest to lowest):
      1. brd_config["pathTransform"]     — explicit hand-crafted overrides
            2. content profile redjayXmlTag     — via languages/*.py generators
            3. citation-rule extracted patterns — from citationRules fields
            4. language cleanup defaults        — ENGLISH/SPANISH/etc _PATH_TRANSFORM_CLEANUP
            5. levelPatterns fallback           — emit regex find rows when missing

    BRD TOC fields (name, definition, examples) are intentionally never used
    here — they produce noise rather than clean regex substitution rows.

    Level 2 is ALWAYS emitted. When scope_entries are present they become the
    pattern list (each title maps to itself). When absent, a catch-all row is
    written so the key is never missing. brd_config["pathTransform"]["2"]
    still overrides at the end.
    """
    lang = _normalize_language_key(language)
    pt: dict = {}

    # ── Level 2: scope document titles ───────────────────────────────────────
    # Always emit "2". Use real scope titles when available; fall back to a
    # single identity catch-all so the key is never absent.
    # Level 2: for Spanish, use case-insensitive per-title regex patterns so
    # ALL-CAPS raw titles are normalised to Title Case regardless of incoming
    # casing or leading/trailing whitespace.
    # IMPORTANT: no catch-all (^.*$) is added — that would blank unmatched titles.
    # Whitespace stripping is done with two separate rules that only remove
    # leading/trailing spaces, never blank the content.
    if lang == "spanish":
        level2_patterns = [
            [r"^\s+", "", 0, ""],
            [r"\s+$", "", 0, ""],
        ]
        for name in (scope_entries or []):
            n = name.strip()
            if not n:
                continue
            title_cased = _spanish_title_case(n) if n == n.upper() else n
            escaped = re.escape(n)
            level2_patterns.append([f"(?i)^{escaped}$", title_cased, 0, ""])
    elif lang == "japanese" and scope_entries:
        # Japanese scope titles are stored as "English Title (Law No X)日本語"
        # but the raw document token is just the Japanese portion.
        # Build patterns that match: (a) the full title, (b) just the Japanese
        # suffix, (c) NFKC-normalized suffix (handles Kangxi radical variants
        # e.g. ⽅ U+2F4B matching standard 方 U+65B9).
        # The path engine must NFKC-normalize the incoming token before matching.
        import unicodedata as _ud
        level2_patterns = [
            [r"^\s+", "", 0, ""],
            [r"\s+$", "", 0, ""],
        ]
        for name in scope_entries:
            # Strip zero-width / invisible Unicode chars that appear in some BRD cells
            n = name.strip().rstrip("​‌‍﻿ ").strip()
            if not n:
                continue
            # Extract JP suffix (CJK + hiragana + katakana + Kangxi range), strip trailing punct
            jp_m = re.search(
                r"[　-鿿豈-﫿⺀-⿿＀-￯぀-ヿ]+[^\s]*$",
                n,
            )
            if jp_m:
                jp_suffix = jp_m.group(0).lstrip("　（）（）()").rstrip(")）(（[]​‌‍")
                norm_suffix = _ud.normalize("NFKC", jp_suffix)
                alts = [re.escape(n), re.escape(jp_suffix)]
                if norm_suffix != jp_suffix:
                    alts.append(re.escape(norm_suffix))
                # Also generate a version where each standard CJK char in the
                # suffix is replaced by its Kangxi radical equivalent, so the
                # pattern matches raw document tokens that use Kangxi chars.
                # e.g. "地方税法" → "地⽅税法" (⽅ is Kangxi U+2F45 → 方 U+65B9)
                _CJK_TO_KANGXI: dict[str, str] = {
                    "方": "⽅",  # 方 → ⽅
                    "一": "⼀",  # 一 → ⼀
                    "二": "⼆",  # 二 → ⼆
                    "人": "⼈",  # 人 → ⼈
                    "入": "⼊",  # 入 → ⼊
                    "八": "⼋",  # 八 → ⼋
                    "力": "⼒",  # 力 → ⼒
                    "十": "⼗",  # 十 → ⼗
                    "目": "⽬",  # 目 → ⽬
                }
                kangxi_suffix = "".join(_CJK_TO_KANGXI.get(c, c) for c in norm_suffix)
                if kangxi_suffix not in (jp_suffix, norm_suffix):
                    alts.append(re.escape(kangxi_suffix))
                level2_patterns.append([f"(?i)^(?:{'|'.join(alts)})$", n, 0, ""])
            else:
                level2_patterns.append([f"(?i)^{re.escape(n)}$", n, 0, ""])
    elif scope_entries:
        # Use re.escape() so scope titles containing regex metacharacters
        # (e.g. Korean law names with literal parentheses like "법률) (약칭:")
        # don't crash the path engine with "unbalanced parenthesis" errors.
        # This is the root cause of errors multiplying — a crashed L2 pattern
        # causes every child level's path to fail as well.
        level2_patterns = [
            [f"(?i)^{re.escape(name.strip())}$", name.strip(), 0, ""]
            for name in scope_entries if name and name.strip()
        ]
        # For Chinese documents: XML <title> at L2 may contain only the Chinese
        # portion, or have a spurious leading prefix (e.g. "银行 银行间市场...").
        # Use ^.*? so the pattern tolerates any leading noise before the known suffix.
        if lang == "chinese":
            def _extract_cn_suffix(s: str) -> str | None:
                depth = 0
                end = len(s.rstrip()) - 1
                if end < 0 or s[end] not in ')\uff09': return None
                start = end
                while start >= 0:
                    if s[start] in ')\uff09': depth += 1
                    elif s[start] in '(\uff08':
                        depth -= 1
                        if depth == 0:
                            content = s[start + 1:end]
                            if re.search(r'[\u4e00-\u9fff]', content):
                                return content.strip()
                            return None
                    start -= 1
                return None

            for name in scope_entries:
                n = name.strip()
                cn_part = _extract_cn_suffix(n)
                if cn_part and cn_part != n:
                    level2_patterns.append(
                        [f"(?i)^.*?{re.escape(cn_part)}$", n, 0, ""]
                    )
    else:
        level2_patterns = [["^.*$", "", 0, ""]]
    pt["2"] = {"patterns": level2_patterns, "case": ""}

    # ── Content profile Redjay XML via language generators ───────────────────
    redjay_pt = _build_path_transform_from_content_profile_redjay(
        content_profile=content_profile,
        language=language,
        level_range=level_range,
    )
    for key, value in redjay_pt.items():
        if key not in pt:
            pt[key] = value

    # ── Korean structural patterns fallback ───────────────────────────────────
    if lang == "korean":
        _min_level, max_level = level_range
        for level_num in range(3, max_level + 1):
            key = str(level_num)
            if key not in pt and key in KOREAN_IDENTIFIER_PATTERNS:
                pt[key] = dict(KOREAN_IDENTIFIER_PATTERNS[key])

    # ── Citation-rule embedded regex patterns ─────────────────────────────────
    if isinstance(citations, dict):
        for ref in (citations.get("references") or []):
            if not isinstance(ref, dict):
                continue
            raw_level = str(ref.get("level") or "").strip()
            level_m = re.search(r"\d+", raw_level)
            if not level_m:
                continue
            level_key = level_m.group(0)
            if int(level_key) < 3:
                continue
            rules_text = (
                ref.get("citationRules")
                or ref.get("citation_rules")
                or ref.get("rules")
                or ""
            )
            if not isinstance(rules_text, str) or not rules_text.strip():
                continue
            extracted = _extract_patterns_from_text(rules_text)
            if extracted:
                pt[level_key] = {"patterns": [[p.strip(), p.strip(), 0, ""] for p in extracted], "case": ""}

    # ── Language cleanup defaults — only for levels within the document range ──
    # Note: level "2" is intentionally excluded here — it is always set above
    # from scope_entries and must never be overwritten by generic cleanup rows.
    #
    # Language cleanup ALWAYS wins for levels it covers — it must overwrite any
    # redjay-derived patterns that were placed in pt above. Redjay patterns are
    # raw identifier samples (e.g. "OCTAVA.", "VI.") useful for levelPatterns
    # but not for pathTransform, which needs the real cleanup substitution rules
    # (strip leading space, strip .-  suffix, ordinal title-casing, etc.).
    min_level, max_level = level_range
    for key, cleanup_rows in _language_cleanup_patterns(language, max_level).items():
        if key == "2":
            continue  # level 2 is owned exclusively by scope_entries logic
        if not str(key).isdigit():
            continue
        if int(str(key)) > max_level:
            continue  # don't emit levels beyond the document's actual range
        # Always write the entry — even empty [] means "passthrough, no transform".
        # An empty patterns list prevents the levelPatterns fallback below from
        # incorrectly using the levelPattern regex as a find→"" blanking rule.
        pt[key] = {"patterns": cleanup_rows, "case": ""}

    # ── levelPatterns fallback for missing levels (important for Chinese) ────
    if isinstance(level_patterns, dict):
        for key, pats in level_patterns.items():
            if key == "2" or key in pt:
                continue
            if not str(key).isdigit() or int(str(key)) < 3:
                continue
            if not isinstance(pats, list):
                continue
            rows = [[str(p).strip(), "", 0, ""] for p in pats if str(p).strip()]
            if rows:
                pt[str(key)] = {"patterns": rows, "case": ""}

    # ── brd_config.pathTransform: level 2 always wins (scope titles).
    # Levels 3+: brd_config is ignored for any level already populated by
    # language cleanup — stale stored rules must never overwrite fresh cleanup.
    pt_config = None
    if isinstance(brd_config, dict):
        for k in ("pathTransform", "path_transform"):
            v = brd_config.get(k)
            if isinstance(v, dict) and v:
                pt_config = _sanitize_path_transform_config(v)
                break

    if pt_config:
        # Level 2: always take from brd_config (hand-crafted scope titles).
        if "2" in pt_config:
            pt["2"] = pt_config["2"]
        # Levels 3+: only apply when language cleanup has NOT populated that
        # level AND it is within the document range.
        lang_cleanup_keys = set(_language_cleanup_patterns(language, max_level).keys())
        for key, value in pt_config.items():
            if key == "2":
                continue
            if not str(key).isdigit() or int(str(key)) > max_level:
                continue
            if key not in lang_cleanup_keys:
                pt[str(key)] = value

    return pt


def _normalize_brd_example(example: str) -> str:
    """Collapse editorial spaces BRDs insert within Korean structural identifiers.
    e.g. "제 1 편" -> "제1편", "제 2 조" -> "제2조", "가 ." -> "가."
    """
    ex = example.strip()
    ex = re.sub(r"(제)\s+(\d)",            r"\1\2", ex)
    ex = re.sub(r"(\d)\s+(편|장|절|관|조)", r"\1\2", ex)
    ex = re.sub(r"(조)\s*(의)\s*(\d)",      r"\1\2\3", ex)
    ex = re.sub(r"([가-힣])\s+\.",          r"\1.", ex)
    return ex


def _infer_custom_toc_patterns(examples: list[str]) -> list[list]:
    """
    Infer custom_toc cleanup patterns from BRD examples for a single level.

    The ingestion extractor delivers heading values that still contain raw XML
    tags from the source document. Two artifact forms have been observed:

      Full-tag form  (current):  "<title>제1조(목적)</title>"
      Partial form   (older):    "1조(목적)</title>"
                                  ^ 제 missing, opening tag already stripped

    Three rules handle both forms and all clean inputs idempotently:

      Rule 1: strip the leading opening XML tag  r"^<[a-zA-Z][a-zA-Z0-9]*>"
              Matches only proper XML tag names (<title>, <heading>, etc.).
              Does NOT match Korean/addenda content like <제2020-5호, ...>
              because those contain non-ASCII chars immediately after <.
              No-op when already absent.

      Rule 2: strip the trailing closing XML tag  r"</.*$"
              Strips </title> and everything after it, including truncated
              forms like </t> or bare </.  No-op when already absent.

      Rule 3 (conditional): restore a missing structural prefix.
              Generated only when:
              (a) every BRD example for this level starts with the same
                  non-digit prefix (e.g. "제" for Korean articles), AND
              (b) that prefix consists only of Korean/alphabetic characters
                  and spaces — no XML metacharacters like < > [ ] / — to
                  prevent spurious rules from addenda-style examples such as
                  "<제2020-5호" (which would wrongly infer prefix "<제").
              Uses a negative lookahead so it is a no-op when the prefix is
              already present.

    BRD examples are normalised before prefix detection so editorial spaces
    ("제 1 편", "가 .") are collapsed and do not corrupt the inferred prefix.
    """
    patterns: list[list] = []

    # Rule 1: strip leading opening XML tag (proper tag names only)
    patterns.append([r"^<[a-zA-Z][a-zA-Z0-9]*>", "", 0, ""])

    # Rule 2: strip trailing closing XML tag and everything after
    patterns.append([r"</.*$", "", 0, ""])

    # Normalise BRD examples before prefix analysis
    cleaned = [_normalize_brd_example(ex) for ex in (examples or []) if ex.strip()]
    if not cleaned:
        return patterns

    # Detect the non-digit structural prefix shared by every example
    prefixes = []
    for ex in cleaned:
        m = re.match(r"^([^\d]*)", ex)
        if m:
            prefixes.append(m.group(1).strip())

    # Rule 3: restore prefix only when ALL examples agree AND prefix is clean
    # (no XML metacharacters — guards against addenda refs like "<제2020-5호"
    # producing a spurious "<제" prefix rule)
    if (prefixes and len(prefixes) == len(cleaned)
            and len(set(prefixes)) == 1 and prefixes[0]
            and not re.search(r'[<>\[\]{}/\\]', prefixes[0])):
        prefix = prefixes[0]
        escaped = re.escape(prefix)
        patterns.append([f"^(?!{escaped})(\\d)", f"{prefix}\\1", 0, ""])

    return patterns


def _build_custom_toc(language: str, levels: list[dict] | None = None) -> dict:
    """
    Build the custom_toc config for the given language.

    For Korean, starts from KOREAN_CUSTOM_TOC (defines which levels get custom
    TOC entries and what XML tag to read), then enriches each level's "patterns"
    by inferring cleanup rules from the BRD examples.
    """
    if _normalize_language_key(language) != "korean":
        return {}

    ct: dict = {}
    for lvl_key, cfg in KOREAN_CUSTOM_TOC.items():
        ct[lvl_key] = {
            "tags":     cfg.get("tags", "title"),
            "patterns": list(cfg.get("patterns", [])),
        }

    level_examples: dict[str, list[str]] = {}
    for lvl in (levels or []):
        num = lvl.get("level")
        if num is None:
            continue
        exs = [str(e).strip() for e in (lvl.get("examples") or []) if str(e).strip()]
        if exs:
            level_examples[str(num)] = exs

    for lvl_key, cfg in ct.items():
        exs = level_examples.get(lvl_key, [])
        if not cfg.get("patterns"):
            cfg["patterns"] = _infer_custom_toc_patterns(exs)

    return ct


def _normalize_level_patterns(raw: dict | None) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, val in raw.items():
        k = str(key)
        if isinstance(val, list):
            patterns = [str(item) for item in val if str(item).strip()]
            if patterns:
                out[k] = patterns
    return out


def _is_korean_language(language: str) -> bool:
    return _normalize_language_key(language) == "korean"


# Maps normalised language keys to the geography tokens they are compatible with.
# If the geography contains NONE of a language's expected tokens, the language
# value is considered a mis-assignment and will be corrected to English.
_LANGUAGE_GEOGRAPHY_TOKENS: dict[str, list[str]] = {
    "korean":     ["korea", "kr"],
    "japanese":   ["japan", "jp"],
    "chinese":    ["china", "taiwan", "hong kong", "zh", "tw", "hk"],
    "spanish":    [
        "spain", "mexico", "colombia", "argentina", "chile", "peru",
        "venezuela", "ecuador", "bolivia", "paraguay", "uruguay",
        "honduras", "guatemala", "el salvador", "nicaragua", "costa rica",
        "panama", "cuba", "dominican", "puerto rico", "es", "mx",
    ],
    "portuguese": ["brazil", "portugal", "brasil", "pt", "br"],
}


def _validate_language_against_geography(language: str, geography: str) -> str:
    """
    Return *language* unchanged when it is plausible for *geography*.
    If the language looks misassigned (e.g. 'Korean' for 'United States'),
    fall back to 'English' so the correct generator and patterns are used.

    Only non-English languages are checked because English is the global
    fallback and can appear in any geography.
    """
    lang_key = _normalize_language_key(language)
    if lang_key == "english":
        return language  # English is always valid

    geo_lower = (geography or "").lower().strip()
    if not geo_lower:
        return language  # No geography info — trust the supplied language

    expected_tokens = _LANGUAGE_GEOGRAPHY_TOKENS.get(lang_key, [])
    if not expected_tokens:
        return language  # Unknown / unchecked language — leave as-is

    if any(token in geo_lower for token in expected_tokens):
        return language  # Geography matches the language — all good

    # Mismatch detected: language is inconsistent with geography.
    import warnings
    warnings.warn(
        f"Language '{language}' is inconsistent with geography '{geography}'. "
        f"Falling back to 'English'.",
        stacklevel=4,
    )
    return "English"


def _is_new_schema(metadata: dict) -> bool:
    has_ccn = bool(metadata.get("Content Category Name") or metadata.get("content_category_name"))
    has_src_type = bool(metadata.get("Source Type") or metadata.get("source_type"))
    return has_ccn and not has_src_type


def _build_required_levels(levels: list[dict], fallback: list[int]) -> list[int]:
    required = [
        row["level"] for row in levels
        if row.get("required") is True and isinstance(row.get("level"), int)
    ]
    if not required:
        return sorted(set([2] + fallback))
    if 2 not in required:
        required = [2] + required
    return sorted(set(required))


def _build_required_levels_for_language(
    required_levels: list[int],
    language: str,
    levels: list[dict],
) -> list[int]:
    """
    Post-process required_levels for language-specific rules.

    For Korean content categories (KR.NARK Acts etc.), individual laws vary
    enormously in structure — many skip 편 (L3), 장 (L4), or 절 (L5) entirely.
    The BRD marks these as "True" because they CAN appear, not because they
    MUST appear in every document.  Marking them as required in the metajson
    causes the path validation tool to flag every document that skips a level
    as "Incorrect path", blocking Expected Path computation for all descendants.

    Rule: for Korean, only include a level in requiredLevels when it is truly
    universal — i.e. L2 (document title) and any level that appears in the
    BRD required=True list AND is a fixed structural suffix (부칙 L14 etc.).
    Structural hierarchy levels (L3 편, L4 장, L5 절, L6 관) are demoted to
    optional because Korean Acts may omit them.
    """
    lang = _normalize_language_key(language)
    if lang != "korean":
        return required_levels

    # For Korean: only L2 is universally required.
    # L13 (별표/annex), L14 (부칙), L15 (부칙 entries) are kept if the BRD
    # marks them required — they genuinely appear in almost every Act.
    # L3-L7 are demoted to optional regardless of BRD setting.
    # L3-L7: structural levels — many Korean Acts skip 편/장/절/관/조
    # L13 (별표/annex): only 7/41 docs have annexes — cannot be required
    _KOREAN_OPTIONAL = {3, 4, 5, 6, 7, 13}
    filtered = [lvl for lvl in required_levels if lvl not in _KOREAN_OPTIONAL]
    if 2 not in filtered:
        filtered = [2] + filtered
    return sorted(set(filtered))


def _extract_content_profile_level_inputs(content_profile: dict | None) -> list[dict]:
    """Convert contentProfile.levels rows into generator input entries."""
    if not isinstance(content_profile, dict):
        return []

    raw_levels = content_profile.get("levels")
    if not isinstance(raw_levels, list):
        return []

    out: list[dict] = []
    for row in raw_levels:
        if not isinstance(row, dict):
            continue
        level_raw = row.get("levelNumber") or row.get("level")
        level_m = re.search(r"\d+", str(level_raw or ""))
        if not level_m:
            continue
        level_num = int(level_m.group(0))
        if level_num < 2:
            continue

        out.append({
            "level": level_num,
            "definition": "",
            "examples": [],
            "required": False,
            "name": None,
            "redjayXmlTag": str(row.get("redjayXmlTag") or row.get("redjay_xml_tag") or ""),
        })

    return out



def _apply_path_transform_to_token(token: str, pt_entry: dict) -> str:
    """
    Simulate what the ingestion engine does to a raw heading token when it
    applies one level's pathTransform entry.

    Supports both pathTransform formats:
      patterns format:    {"patterns": [[find, replace, flag, extra], ...], "case": ""}
      identifier format:  {"prefix": "(", "suffix": ")", "identifier_pattern": "[a-z]+"}

    The identifier format explicitly strips wrapper characters (e.g. parentheses)
    before the path segment is stored.  The patterns format applies sequential
    regex substitutions.
    """
    result = token.strip()

    # identifier_pattern format — strip prefix and suffix
    if "identifier_pattern" in pt_entry:
        prefix = pt_entry.get("prefix", "")
        suffix = pt_entry.get("suffix", "")
        if prefix and result.startswith(prefix):
            result = result[len(prefix):]
        if suffix and result.endswith(suffix):
            result = result[: -len(suffix)]
        return result.strip()

    # patterns format — apply each substitution in order
    for row in pt_entry.get("patterns", []):
        if not isinstance(row, list) or len(row) < 2:
            continue
        find    = str(row[0]) if row[0] is not None else ""
        replace = str(row[1]) if row[1] is not None else ""
        flag    = int(row[2]) if len(row) > 2 and row[2] is not None else 0
        if not find:
            continue
        try:
            re_flags = re.IGNORECASE if (flag & 2) else 0
            result = re.sub(find, replace, result, flags=re_flags)
        except re.error:
            pass

    return result.strip()


def _derive_level_pattern_from_transformed(transformed_samples: list[str]) -> list[str]:
    """
    Given post-pathTransform path segments, derive the correct levelPattern.

    levelPatterns are validated against the POST-pathTransform token, not the
    raw heading.  For example:
      Raw: "Chapter I"  →  pathTransform abbreviates →  "Ch. I"
      levelPattern must match "Ch. I", not "Chapter I".

    This function uses unanchored suffix patterns (no leading ^) that match the
    IDENTIFIER PORTION at the end of the transformed token — the same strategy
    used by the Title 31 CFR real metajson which produces far fewer runtime errors.

    Pattern priority:
      1. Parenthetical (not stripped) → \([ivxlcdm]+\)$ etc.
      2. Bare identifier types        → [IVXLCDM]+$ etc.
      3. Heterogeneous / prose        → ^.*$ catch-all
    """
    samples = [s.strip() for s in transformed_samples if s and s.strip()]
    if not samples:
        return [r"^.*$"]

    def _classify(s: str) -> str:
        s = s.strip()
        # Parenthetical forms (parens preserved by pathTransform)
        if re.fullmatch(r"\([ivxlcdm]+\)", s): return "paren_roman_lower"
        if re.fullmatch(r"\([A-Z]+\)", s):     return "paren_upper_alpha"
        if re.fullmatch(r"\([0-9]+\)", s):      return "paren_number"
        if re.fullmatch(r"\([a-z]+\)", s):      return "paren_lower_alpha"
        # Bare identifier — check the last whitespace-separated token
        last = s.split()[-1] if " " in s else s
        if re.fullmatch(r"[IVXLCDM]+", last): return "roman_upper"
        if re.fullmatch(r"[ivxlcdm]+", last): return "roman_lower"
        if re.fullmatch(r"[0-9]+\.[0-9]+", s): return "decimal"
        if re.fullmatch(r"[0-9]+", last):     return "number"
        if re.fullmatch(r"[A-Z]+", last):     return "upper_alpha"
        if re.fullmatch(r"[a-z]+", last):     return "lower_alpha"
        return "prose"

    types = [_classify(s) for s in samples]
    type_set = set(types)

    # prose or heterogeneous → catch-all
    if "prose" in type_set or len(type_set) > 2:
        return [r"^.*$"]

    _MAP: dict[frozenset, list[str]] = {
        frozenset({"paren_roman_lower"}): [r"\([ivxlcdm]+\)$"],
        frozenset({"paren_upper_alpha"}): [r"\([A-Z]+\)$"],
        frozenset({"paren_number"}):      [r"\([0-9]+\)$"],
        frozenset({"paren_lower_alpha"}): [r"\([a-z]+\)$"],
        frozenset({"paren_roman_lower", "paren_number"}):     [r"\([ivxlcdm]+\)$", r"\([0-9]+\)$"],
        frozenset({"paren_roman_lower", "paren_upper_alpha"}): [r"\([ivxlcdm]+\)$", r"\([A-Z]+\)$"],
        frozenset({"paren_upper_alpha", "paren_number"}):     [r"\([A-Z]+\)$", r"\([0-9]+\)$"],
        frozenset({"roman_upper"}):  [r"[IVXLCDM]+$"],
        frozenset({"roman_lower"}):  [r"[ivxlcdm]+$"],
        frozenset({"number"}):       [r"[0-9]+$"],
        frozenset({"upper_alpha"}):  [r"[A-Z]+$"],
        frozenset({"lower_alpha"}):  [r"[a-z]+$"],
        frozenset({"decimal"}):      [r"[0-9]+\.[0-9]+$"],
        frozenset({"roman_lower", "lower_alpha"}): [r"[a-z]+$"],
        frozenset({"roman_upper", "upper_alpha"}): [r"[A-Z]+$"],
        frozenset({"number", "roman_upper"}):      [r"[0-9]+$", r"[IVXLCDM]+$"],
    }

    result = _MAP.get(frozenset(type_set))
    return result if result else [r"^.*$"]


def _recompute_level_patterns_from_path_transform(
    level_patterns: dict[str, list[str]],
    path_transform: dict,
    levels: list[dict],
) -> dict[str, list[str]]:
    """
    Re-derive levelPatterns so they match POST-pathTransform path segments.

    The ingestion engine applies pathTransform to the raw heading token FIRST,
    then validates the result against levelPatterns.  If levelPatterns were built
    from raw examples (e.g. "Chapter I") but pathTransform abbreviates those
    tokens (e.g. "Ch. I"), the patterns will never match → runtime errors cascade.

    This function:
      1. Takes every BRD example for each level.
      2. Simulates applying that level's pathTransform entry.
      3. Derives a new levelPattern that matches the transformed result.
      4. Replaces the inferred pattern ONLY when transformation actually changes
         the token AND the new pattern is tighter than ^.*$.
      5. Level 2 is always kept as ^.*$ (document title, no transform needed).

    For levels where pathTransform is empty or changes nothing, the original
    inferred pattern is preserved.
    """
    updated: dict[str, list[str]] = dict(level_patterns)
    updated["2"] = [r"^.*$"]

    for lvl_dict in levels:
        level_num = lvl_dict.get("level")
        if not isinstance(level_num, int) or level_num < 3:
            continue

        key = str(level_num)
        pt_entry = path_transform.get(key)
        if not isinstance(pt_entry, dict):
            continue

        # Skip levels with empty pathTransform (no transformation → keep original)
        if not pt_entry.get("patterns") and "identifier_pattern" not in pt_entry:
            continue

        raw_examples: list[str] = [
            str(ex).strip()
            for ex in (lvl_dict.get("examples") or [])
            if str(ex).strip()
        ]
        if not raw_examples:
            continue

        transformed = [
            _apply_path_transform_to_token(ex, pt_entry)
            for ex in raw_examples
        ]

        # Only update if transformation actually changed at least one token
        if all(t == r for t, r in zip(transformed, raw_examples)):
            continue

        new_pats = _derive_level_pattern_from_transformed(transformed)

        # Only replace when the new pattern is more specific than catch-all
        if new_pats and new_pats != [r"^.*$"]:
            updated[key] = new_pats
        elif new_pats == [r"^.*$"] and updated.get(key) == [r"^.*$"]:
            # Both are catch-all — keep existing
            pass

    return updated


def assemble_metajson(
    metadata: dict,
    levels: list[dict],
    language: str,
    scope: dict | None = None,
    citations: dict | None = None,
    content_profile: dict | None = None,
    whitespace_handling: dict | None = None,
    brd_config: dict | None = None,
    scope_entries: list[str] | None = None,
) -> tuple[dict, str]:
    new_schema = _is_new_schema(metadata)

    raw_source_name = (
        metadata.get("Content Category Name")
        or metadata.get("content_category_name")
        or metadata.get("Source Name")
        or metadata.get("source_name")
        or metadata.get("document_title")
        or "Unknown Source"
    )
    payload_subtype = metadata.get("Payload Subtype") or metadata.get("payload_subtype") or "Law"
    issuing_agency = metadata.get("Issuing Agency") or metadata.get("issuing_agency") or ""
    source_name = _derive_source_name(raw_source_name, issuing_agency, payload_subtype)

    geography = metadata.get("Geography") or metadata.get("geography") or ""
    lang_raw = metadata.get("Language") or metadata.get("language") or language or "English"
    lang = _validate_language_against_geography(lang_raw, geography)
    delivery_type = _normalize_meta_string(metadata.get("Delivery Type") or metadata.get("delivery_type"), "{string}")
    content_uri_raw = _normalize_meta_string(metadata.get("Content URI") or metadata.get("content_uri"), "{string}")
    content_uri = content_uri_raw if content_uri_raw.startswith("{") else "{string}"
    brd_version = _normalize_meta_string(metadata.get("BRD_Version") or metadata.get("brd_version"), "")
    unique_file_id = "{string}"

    pub_raw = _normalize_meta_string(metadata.get("Publication Date") or metadata.get("publication_date"), "{iso-date}")
    last_raw = _normalize_meta_string(metadata.get("Last Updated Date") or metadata.get("last_updated_date"), "{iso-date}")
    publication_date = _to_iso_date(pub_raw)
    last_updated_date = _to_iso_date(last_raw)

    effective_raw = _normalize_meta_string(metadata.get("Effective Date") or metadata.get("effective_date"), "{iso-date}")
    effective_date = _to_iso_date(effective_raw)

    processing_raw = _normalize_meta_string(metadata.get("Processing Date") or metadata.get("processing_date"), "{iso-date}")
    processing_date = _to_iso_date(processing_raw)

    source_type = metadata.get("Source Type") or metadata.get("source_type") or "Free"
    status = _normalize_status(metadata.get("Status") or metadata.get("status"))

    filename_date = processing_date if (not publication_date or publication_date.startswith("{")) else publication_date
    filename = _derive_filename(source_name, filename_date)
    root_path = _derive_root_path_from_brd(content_profile, brd_config) or _derive_root_path(geography, source_name)

    level_numbers = sorted([
        item["level"] for item in levels
        if isinstance(item.get("level"), int)
    ])
    min_level = 2
    max_level = max(level_numbers) if level_numbers else min_level
    level_range = (min_level, max_level)

    brd_level_patterns = _normalize_level_patterns(
        (brd_config or {}).get("levelPatterns") or (brd_config or {}).get("level_patterns")
    )

    if brd_level_patterns:
        level_patterns = brd_level_patterns
    else:
        level_patterns = _language_default_level_patterns(lang)
        inference_levels: list[dict] = list(levels or [])
        inference_levels.extend(_extract_content_profile_level_inputs(content_profile))
        if inference_levels:
            toc_inferred = generate_level_patterns(language=lang, levels=inference_levels)
            for key, pats in toc_inferred.items():
                if not pats:
                    continue
                # Inferred patterns from BRD definitions/examples override
                # language defaults when specific (non-generic). Defaults are
                # only a fallback for levels with no BRD definition provided.
                if _is_generic_pattern_set(pats):
                    if key not in level_patterns:
                        level_patterns[key] = pats
                else:
                    level_patterns[key] = pats

    if _is_korean_language(lang):
        for level_num in range(2, max(level_range[1], 15) + 1):
            key = str(level_num)
            if key not in KOREAN_DEFAULT_PATTERNS:
                continue
            if key not in level_patterns:
                # Fill missing levels with canonical defaults
                level_patterns[key] = list(KOREAN_DEFAULT_PATTERNS[key])
            elif brd_level_patterns:
                # Stored brd_level_patterns may have stale/wrong patterns for
                # L13-15 (e.g. ^제편$ copied from a structural level).
                # Detect this: if the stored pattern for L13+ looks like a
                # structural 편/장/절/관/조 pattern, override with the default.
                # Detect stale structural patterns (편/장/절/관/조) wrongly
                # assigned to L13+ — these come from old saved metajson.
                stored = level_patterns.get(key, [])
                _STRUCTURAL_MARKERS = ("편", "장", "절", "관", "조")
                if stored and int(key) >= 13 and all(
                    any(m in str(p) for m in _STRUCTURAL_MARKERS)
                    for p in stored
                ):
                    level_patterns[key] = list(KOREAN_DEFAULT_PATTERNS[key])

    # Do not leak generic defaults beyond the resolved document range.
    level_patterns = _trim_level_patterns_to_range(level_patterns, level_range)

    level_patterns["2"] = [r"^.*$"]

    all_levels_in_range = list(range(min_level, max_level + 1))
    required_levels = _build_required_levels(levels, fallback=all_levels_in_range)
    required_levels = _build_required_levels_for_language(required_levels, lang, levels)

    meta: dict = {}
    if new_schema:
        meta["Content Category Name"] = source_name
        meta["Publication Date"] = publication_date
        meta["Last Updated Date"] = last_updated_date if (last_updated_date and not last_updated_date.startswith("{")) else ""
        meta["Processing Date"] = processing_date
        meta["Issuing Agency"] = issuing_agency
        meta["Content URI"] = content_uri
        meta["Geography"] = geography
        meta["Language"] = lang
        meta["Delivery Type"] = delivery_type
        meta["Unique File Id"] = unique_file_id
        meta["Tag Set"] = {"requiredLevels": [], "allowedLevels": []}
    else:
        meta["Source Name"] = source_name
        meta["Source Type"] = source_type
        meta["Publication Date"] = publication_date
        meta["Last Updated Date"] = last_updated_date if (last_updated_date and not last_updated_date.startswith("{")) else ""
        meta["Effective Date"] = effective_date
        meta["Processing Date"] = processing_date
        meta["Issuing Agency"] = issuing_agency
        meta["Content URI"] = content_uri
        meta["Geography"] = geography
        meta["Language"] = lang
        meta["Payload Subtype"] = payload_subtype
        meta["Status"] = status
        if brd_version:
            meta["BRD_Version"] = brd_version
        meta["Delivery Type"] = delivery_type
        meta["Unique File Id"] = unique_file_id
        meta["Tag Set"] = {"requiredLevels": [], "allowedLevels": []}

    ws_source = (brd_config or {}).get("whitespaceHandling") or whitespace_handling
    ws_handling = _build_whitespace_handling(level_range, ws_source)

    # Collect scope titles from explicit scope_entries first, then fall back to
    # extracting them from the scope dict's in_scope list. These titles are what
    # populate pathTransform["2"] as document-title normalisation rows.
    # Normalise any pre-supplied scope_entries for Spanish ALL-CAPS titles
    _lang_key = _normalize_language_key(lang)
    if scope_entries and _lang_key == "spanish":
        effective_scope_entries = [
            _spanish_title_case(e) if (isinstance(e, str) and e.strip() == e.strip().upper() and e.strip())
            else e
            for e in scope_entries
        ]
    else:
        effective_scope_entries = list(scope_entries or [])

    if not effective_scope_entries and isinstance(scope, dict):
        in_scope = scope.get("in_scope") or scope.get("inScope") or []
        for entry in in_scope:
            if not isinstance(entry, dict):
                continue
            if entry.get("strikethrough") or entry.get("strikeThrough"):
                continue

            raw_title = ""
            for k in ("document_title", "documentTitle", "title", "name"):
                val = entry.get(k)
                if isinstance(val, str) and val.strip():
                    raw_title = val.strip()
                    break
            if not raw_title:
                continue
            if _normalize_language_key(lang) == "korean":
                ko = _extract_korean_title(raw_title)
                effective_scope_entries.append(ko if ko else raw_title)
            elif _normalize_language_key(lang) == "spanish" and raw_title == raw_title.upper():
                # Scope titles stored as ALL-CAPS — convert to Title Case so
                # pathTransform level-2 patterns match the expected path format.
                effective_scope_entries.append(_spanish_title_case(raw_title))
            else:
                effective_scope_entries.append(raw_title)

    pt = _build_path_transform(
        scope_entries=effective_scope_entries,
        level_range=level_range,
        language=lang,
        content_profile=content_profile,
        citations=citations,
        level_patterns=level_patterns,
        brd_config=brd_config,
    )

    # ── Re-derive levelPatterns from post-pathTransform tokens ────────────────
    # levelPatterns are validated against the TOKEN AFTER pathTransform is
    # applied, not the raw heading.  Re-computing here ensures patterns match
    # what the ingestion engine actually sees at runtime.
    # Example: "Chapter I" → pathTransform → "Ch. I"
    #   Old pattern: ^(Chapter|CHAPTER)\s+[IVXLCDM]+$  → fails on "Ch. I"
    #   New pattern: [IVXLCDM]+$                         → matches "Ch. I" ✓
    # Only overrides inferred patterns — brd_config explicit patterns are kept.
    if not brd_level_patterns:
        level_patterns = _recompute_level_patterns_from_path_transform(
            level_patterns=level_patterns,
            path_transform=pt,
            levels=levels,
        )

    ct_config = None
    if isinstance(brd_config, dict):
        for k in ("custom_toc", "customToc"):
            v = brd_config.get(k)
            if isinstance(v, dict) and v:
                ct_config = v
                break
    ct = ct_config if ct_config else _build_custom_toc(lang, levels=levels)

    metajson: dict = {
        "name": source_name,
        "files": {"file0001": {"name": ""}},
        "rootPath": root_path,
        "meta": meta,
        "levelRange": [level_range[0], level_range[1]],
        "headingRequired": [2],
        "childLevelSameAsParent": False,
        "childLevelLessThanParent": False,
        "levelPatterns": level_patterns,
        "whitespaceHandling": ws_handling,
        "headingAnnotation": ["2"],
        "tagSet": {
            "headingFromLevels": [],
            "appliedToLevels": [],
        },
        "parentalGuidance": [0, 0],
        "requiredLevels": required_levels,
        "pathTransform": pt,
    }

    if ct:
        metajson["custom_toc"] = ct

    return metajson, f"{filename}.json"