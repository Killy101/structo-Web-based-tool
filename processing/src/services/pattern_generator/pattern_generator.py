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
from .languages.chinese import ChinesePatternGenerator, CHINESE_META_DEFAULT_LEVEL_PATTERNS
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

    # Add heuristic patterns too; dedup below keeps final output clean.
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
        code = code_match.group(2).upper()
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


def _language_cleanup_patterns(language: str) -> dict[str, list[list]]:
    lang = _normalize_language_key(language)
    if lang == "spanish":
        return {k: [list(row) for row in rows] for k, rows in SPANISH_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "portuguese":
        return {k: [list(row) for row in rows] for k, rows in PORTUGUESE_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "japanese":
        return {k: [list(row) for row in rows] for k, rows in JAPANESE_PATH_TRANSFORM_CLEANUP.items()}
    if lang == "english":
        return {k: [list(row) for row in rows] for k, rows in ENGLISH_PATH_TRANSFORM_CLEANUP.items()}
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
    if scope_entries:
        level2_patterns = [[name.strip(), name.strip(), 0, ""] for name in scope_entries if name and name.strip()]
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

    # ── Language cleanup defaults — fill any level not yet populated ──────────
    # Note: level "2" is intentionally excluded here — it is always set above
    # from scope_entries and must never be overwritten by generic cleanup rows.
    for key, cleanup_rows in _language_cleanup_patterns(language).items():
        if key == "2":
            continue  # level 2 is owned exclusively by scope_entries logic
        if key not in pt and cleanup_rows:
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

    # ── brd_config.pathTransform overrides everything ─────────────────────────
    # This includes level "2": if the BRD provides explicit level-2 patterns
    # (e.g. hand-crafted document title normalisations), they win.
    pt_config = None
    if isinstance(brd_config, dict):
        for k in ("pathTransform", "path_transform"):
            v = brd_config.get(k)
            if isinstance(v, dict) and v:
                pt_config = _sanitize_path_transform_config(v)
                break

    if pt_config:
        for key, value in pt_config.items():
            pt[str(key)] = value

    return pt


def _build_custom_toc(language: str) -> dict:
    return dict(KOREAN_CUSTOM_TOC) if _normalize_language_key(language) == "korean" else {}


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
                if key not in level_patterns and pats:
                    level_patterns[key] = pats

    if not brd_level_patterns and _is_korean_language(lang):
        for level_num in range(2, max(level_range[1], 15) + 1):
            key = str(level_num)
            if key in KOREAN_DEFAULT_PATTERNS and key not in level_patterns:
                level_patterns[key] = list(KOREAN_DEFAULT_PATTERNS[key])

    # Do not leak generic defaults beyond the resolved document range.
    level_patterns = _trim_level_patterns_to_range(level_patterns, level_range)

    level_patterns["2"] = [r"^.*$"]

    all_levels_in_range = list(range(min_level, max_level + 1))
    required_levels = _build_required_levels(levels, fallback=all_levels_in_range)

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

    ct_config = None
    if isinstance(brd_config, dict):
        for k in ("custom_toc", "customToc"):
            v = brd_config.get(k)
            if isinstance(v, dict) and v:
                ct_config = v
                break
    ct = ct_config if ct_config else _build_custom_toc(lang)

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