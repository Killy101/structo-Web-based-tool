from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Any
from src.services.extractor import extract_all_sections, extract_text
from src.services.pattern_generator import generate_level_patterns
import tempfile, os, shutil
import re

router = APIRouter()


class CitationRef(BaseModel):
    level: int | str | None = None
    citationRules: str | None = None


class ContentProfileLevelRef(BaseModel):
    levelNumber: int | str | None = None
    redjayXmlTag: str | None = None


class LevelPatternRequest(BaseModel):
    language: str = "English"
    levelRange: list[int] | None = None
    citations: list[CitationRef] = []
    contentProfileLevels: list[ContentProfileLevelRef] = []


def _normalize_language(language: str) -> str:
    key = (language or "").strip().lower()
    if any(tag in key for tag in ["spanish", "español", "espanol", "castellano", "es-"]):
        return "spanish"
    if any(tag in key for tag in ["portuguese", "português", "portugues", "pt-"]):
        return "portuguese"
    if any(tag in key for tag in ["chinese", "中文", "汉语", "漢語", "mandarin", "cantonese", "zh", "zh-"]):
        return "chinese"
    if any(tag in key for tag in ["japanese", "日本語", "ja", "ja-"]):
        return "japanese"
    if any(tag in key for tag in ["korean", "한국어", "ko", "ko-"]):
        return "korean"
    return "english"


def _default_level_patterns(language: str) -> dict[str, list[str]]:
    generic = {
        "2": ["^.*$"],
        "3": ["[0-9]+$"],
        "4": ["[0-9]+$"],
        "5": ["[IVXL]+$"],
        "6": ["[IVXL]+$"],
        "7": ["^.*$"],
        "8": ["[0-9]+$"],
        "9": ["[0-9]+$", "[0-9]+[a-z]+$"],
        "10": ["[0-9]+\\.[0-9]+$"],
        "11": ["[a-z]+$", "[ivxl]+$", "[0-9]+\\.[0-9]+\\.[0-9]+$"],
        "12": ["[ivxl]+$", "[a-z]+$", "[IVXL]+$", "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"],
        "13": ["[a-z]+$"],
        "14": ["[IVXL]+$", "[ivxl]+$", "[A-Z]+$"],
        "15": ["[a-z]+$", "[IVXL]+$"],
        "16": ["[ivxl]+$", "[0-9]+$"],
        "17": ["[ivxl]+$", "[0-9]+$"],
        "18": ["[a-z]+$"],
        "19": ["^.*$"],
        "20": ["^.*$"],
    }

    normalized = _normalize_language(language)
    if normalized == "spanish":
        generic["10"] = [
            "[0-9]+\\.[0-9]$",
            "[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies$)$",
            "[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies$) [0-9]+$",
        ]
    if normalized == "chinese":
        generic.update({
            "2": ["^.*$"],
            "3": [r"^第[\\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\\s　]*章$"],
            "4": [r"^第[\\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\\s　]*[节節]$"],
            "5": [r"^第[\\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\\s　]*[条條](?:之(?:[一二三四五六七八九十百千零两〇]+|[0-9]+))?$"],
            "6": [r"^[（(][一二三四五六七八九十百千零两〇]+[）)]$"],
        })
    return generic


def _parse_level_number(level: int | str | None) -> int | None:
    if level is None:
        return None
    match = re.search(r"\d+", str(level))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _extract_pattern_lines(rule: str) -> list[str]:
    if not rule or not rule.strip():
        return []

    lines = (
        rule.replace("\r", "\n")
        .replace("\t", " ")
        .split("\n")
    )

    def _looks_regex_pattern(text: str) -> bool:
        lowered = text.lower()
        if "<level" in lowered or "example:" in lowered:
            return False
        if re.search(r"\+\s*\"", text):
            return False
        return bool(
            re.search(r"(\\^|\$|\\[dDsSwWbBAZz]|\\\\.)", text)
            or re.search(r"\[[^\]]+\](?:\{\d+(?:,\d*)?\}|[+*?])?", text)
            or re.search(r"\([^)]*\|[^)]*\)", text)
            or re.search(r"(?:\)|\]|\.|[A-Za-z0-9])[+*?]", text)
        )

    cleaned: list[str] = []
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
        if cur and _looks_regex_pattern(cur):
            cleaned.append(cur)

    dedup: list[str] = []
    seen: set[str] = set()
    for item in cleaned:
        if item in seen:
            continue
        seen.add(item)
        dedup.append(item)
    return dedup


@router.post("/process")
async def process_document(file: UploadFile = File(...), format: str = "new"):
    """
    Receives a BRD file (.doc, .docx, or .pdf) and extracts:
    Scope, Metadata, TOC, Citation Rules, Content Profile.
    """
    suffix = os.path.splitext(file.filename)[1].lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        if suffix == ".docx":
            result = await extract_all_sections(tmp_path, format)
        else:
            try:
                raw_text = extract_text(tmp_path, suffix)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

            if not raw_text or len(raw_text.strip()) < 50:
                raise HTTPException(
                    status_code=422,
                    detail="Could not extract text from document"
                )
            result = await extract_all_sections(raw_text, format)

        result["filename"] = file.filename
        return result

    finally:
        os.unlink(tmp_path)


@router.post("/patterns/level-patterns")
async def build_level_patterns(payload: LevelPatternRequest):
    citations = payload.citations or []
    cp_levels = payload.contentProfileLevels or []
    language = payload.language or "English"

    level_numbers = [n for n in (_parse_level_number(c.level) for c in citations) if n is not None]

    if payload.levelRange and len(payload.levelRange) == 2:
        min_level = max(2, int(payload.levelRange[0]))
        max_level = max(min_level, int(payload.levelRange[1]))
    elif level_numbers:
        min_level = 2
        max_level = max(level_numbers)
    else:
        min_level = 2
        max_level = 7

    patterns = {}
    defaults = _default_level_patterns(language)

    for level in range(min_level, max_level + 1):
        key = str(level)
        patterns[key] = list(defaults.get(key, ["^.*$"]))

    inferred_input: list[dict[str, Any]] = []
    for citation in citations:
        level = _parse_level_number(citation.level)
        if level is None:
            continue
        inferred_input.append({
            "level": level,
            "definition": citation.citationRules or "",
            "examples": [],
            "required": False,
            "name": None,
        })

    for row in cp_levels:
        level = _parse_level_number(row.levelNumber)
        if level is None:
            continue
        inferred_input.append({
            "level": level,
            "definition": "",
            "examples": [],
            "required": False,
            "name": None,
            "redjayXmlTag": row.redjayXmlTag or "",
        })

    inferred = generate_level_patterns(language=language, levels=inferred_input) if inferred_input else {}

    for level in range(min_level, max_level + 1):
        key = str(level)
        if key in inferred and inferred[key]:
            patterns[key] = inferred[key]

    for citation in citations:
        level = _parse_level_number(citation.level)
        if level is None:
            continue
        key = str(level)
        from_citation = _extract_pattern_lines(citation.citationRules or "")
        if from_citation:
            patterns[key] = from_citation

    if "2" in patterns:
        patterns["2"] = [r"^.*$"]

    return {
        "success": True,
        "language": language,
        "levelRange": [min_level, max_level],
        "levelPatterns": patterns,
    }


class GenerateMetajsonRequest(BaseModel):
    brdId:          str | None = None
    title:          str | None = None
    format:         str | None = "old"
    scope:          dict[str, Any] | None = None
    metadata:       dict[str, Any] | None = None
    toc:            dict[str, Any] | None = None
    citations:      dict[str, Any] | None = None
    contentProfile: dict[str, Any] | None = None
    brdConfig:      dict[str, Any] | None = None


def _extract_korean_match_string(doc_title: str) -> str:
    title = (doc_title or "").strip()
    if not title:
        return ""
    m = re.search(r'\((?=[^)]*[가-힣])', title)
    if m:
        return title[m.start() + 1:].rstrip(')').strip()
    if re.search(r'[가-힣]', title):
        return title
    return ""


def _normalize_scope_match_string(doc_title: str) -> str:
    title = (doc_title or "").strip().strip('"\'')
    if not title:
        return ""
    korean = _extract_korean_match_string(title)
    if korean:
        return korean
    return title


def _build_scope_entries(scope: dict[str, Any] | None) -> list[str]:
    """Extract document title match strings from scope payload."""
    if not scope:
        return []

    def _pick_list(src: dict[str, Any], *keys: str) -> list[Any]:
        for key in keys:
            val = src.get(key)
            if isinstance(val, list):
                return val
        return []

    def _pick_title(entry: dict[str, Any]) -> str:
        for key in ("document_title", "documentTitle", "title", "name"):
            val = entry.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        return ""

    def _is_struck(entry: dict[str, Any]) -> bool:
        raw = entry.get("strikethrough", entry.get("strikeThrough"))
        return bool(raw)

    in_scope_entries = _pick_list(scope, "in_scope", "inScope")

    entries: list[str] = []
    for entry in in_scope_entries:
        if not isinstance(entry, dict) or _is_struck(entry):
            continue
        normalized = _normalize_scope_match_string(_pick_title(entry))
        if normalized:
            entries.append(normalized)

    deduped: list[str] = []
    seen: set[str] = set()
    for item in entries:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def _split_examples(example: str) -> list[str]:
    s = example.strip().strip('"').strip("\u201c\u201d'")
    for suffix in ("; etc.", ", etc.", " etc."):
        if s.endswith(suffix):
            s = s[: -len(suffix)].strip()
    for sep in (";", "\n", " / "):
        if sep in s:
            return [t.strip().strip("\"'\u201c\u201d") for t in s.split(sep) if t.strip()]
    return [s] if s else []


def _build_levels_from_toc(
    toc: dict[str, Any] | None,
    citations: dict[str, Any] | None,
) -> list[dict]:
    """Convert TOC sections + citation references into level dicts for assemble_metajson."""
    if not toc:
        return []
    sections = toc.get("sections") or []
    if not isinstance(sections, list):
        return []

    citation_index: dict[str, str] = {}
    if citations:
        for ref in (citations.get("references") or []):
            if isinstance(ref, dict):
                lvl = str(ref.get("level") or "").strip()
                rules = str(ref.get("citationRules") or "").strip()
                if lvl and rules:
                    citation_index[lvl] = rules

    levels: list[dict] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        raw_level = str(section.get("level") or section.get("id") or "")
        m = re.search(r"\d+", raw_level)
        if not m:
            continue
        level_num = int(m.group(0))
        if level_num < 2:
            continue

        required_raw = str(section.get("required") or "").lower().strip()
        levels.append({
            "level":      level_num,
            "name":       str(section.get("name") or "").strip(),
            "definition": citation_index.get(str(level_num), "") or str(section.get("definition") or "").strip(),
            "examples":   _split_examples(str(section.get("example") or "")),
            "required":   required_raw in ("true", "yes", "y", "1"),
        })

    return sorted(levels, key=lambda x: x["level"])


def _normalise_metadata(metadata: dict[str, Any] | None, format_: str) -> dict[str, Any]:
    if not metadata:
        return {}

    def t(key: str) -> str:
        v = metadata.get(key)
        return str(v).strip() if v is not None else ""

    has_new_name = bool(
        t("contentCategoryName")
        or t("content_category_name")
        or t("document_title")
    )
    has_old_name = bool(t("sourceName") or t("source_name"))
    has_old_type = bool(t("sourceType") or t("source_type"))
    auto_new_schema = has_new_name and not has_old_name and not has_old_type

    if format_ == "new" or auto_new_schema:
        return {
            "Content Category Name": t("contentCategoryName") or t("content_category_name") or t("document_title"),
            "Publication Date":      t("publicationDate")      or t("publication_date")      or "{iso-date}",
            "Last Updated Date":     t("lastUpdatedDate")      or t("last_updated_date")     or "{iso-date}",
            "Effective Date":        t("effectiveDate")        or t("effective_date")        or "{iso-date}",
            "Processing Date":       t("processingDate")       or t("processing_date")       or "{iso-date}",
            "Issuing Agency":        t("issuingAgency")        or t("issuing_agency"),
            "Content URI":           t("contentUri")           or t("content_uri")           or "{string}",
            "Geography":             t("geography"),
            "Language":              t("language"),
            "Delivery Type":         t("deliveryType")         or t("delivery_type")         or "{string}",
            "Unique File Id":        "{string}",
        }
    else:
        return {
            "Source Name":       t("sourceName")      or t("source_name")      or t("contentCategoryName") or t("content_category_name") or t("document_title"),
            "Source Type":       t("sourceType")      or t("source_type"),
            "Publication Date":  t("publicationDate") or t("publication_date") or "{iso-date}",
            "Last Updated Date": t("lastUpdatedDate") or t("last_updated_date") or "{iso-date}",
            "Effective Date":    t("effectiveDate")   or t("effective_date")   or "{iso-date}",
            "Processing Date":   t("processingDate")  or t("processing_date")  or "{iso-date}",
            "Issuing Agency":    t("issuingAgency")   or t("issuing_agency"),
            "Content URI":       t("contentUrl")      or t("content_uri")      or "{string}",
            "Geography":         t("geography"),
            "Language":          t("language"),
            "Payload Subtype":   t("payloadSubtype")  or t("payload_subtype")  or "Acts",
            "Status":            t("status")          or "Effective",
            "BRD_Version":       t("brdVersion")      or t("brd_version"),
            "Delivery Type":     t("deliveryType")    or t("delivery_type")    or "{string}",
            "Unique File Id":    "{string}",
        }


def _is_template_noise(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return True
    if normalized in {"level", "example", "definition", "note", "notes"}:
        return True
    if re.match(r"^level\s*\d+$", normalized):
        return True
    return False


def _looks_regex_like(text: str) -> bool:
    return bool(re.search(r"[\\\[\](){}^$*+?.|]", text or ""))


def _sanitize_path_transform_output(metajson: dict[str, Any]) -> None:
    raw_pt = metajson.get("pathTransform")
    raw_lp = metajson.get("levelPatterns")

    pt: dict[str, dict[str, Any]] = {}

    if isinstance(raw_pt, dict):
        for key, value in raw_pt.items():
            level_key = str(key)
            level_num = int(level_key) if level_key.isdigit() else None
            if not isinstance(value, dict):
                continue
            rows = value.get("patterns")
            if not isinstance(rows, list):
                continue

            cleaned_rows: list[list[Any]] = []
            for row in rows:
                if not isinstance(row, list) or len(row) < 4:
                    continue
                find = str(row[0] if row[0] is not None else "").strip()
                replace = str(row[1] if row[1] is not None else "")
                if not find or _is_template_noise(find):
                    continue
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
                pt[level_key] = {"patterns": cleaned_rows, "case": str(value.get("case") or "")}

    # Ensure level 2 always exists.
    if "2" not in pt:
        pt["2"] = {"patterns": [["^.*$", "", 0, ""]], "case": ""}

    # Backfill missing levels from levelPatterns with regex find rows.
    if isinstance(raw_lp, dict):
        for key, pats in raw_lp.items():
            level_key = str(key)
            if level_key in pt:
                continue
            if not level_key.isdigit() or int(level_key) < 3:
                continue
            if not isinstance(pats, list):
                continue
            rows: list[list[Any]] = []
            for p in pats:
                pattern = str(p).strip()
                if pattern:
                    rows.append([pattern, "", 0, ""])
            if rows:
                pt[level_key] = {"patterns": rows, "case": ""}

    metajson["pathTransform"] = pt


@router.post("/generate/metajson")
async def generate_metajson(payload: GenerateMetajsonRequest):
    from src.services.pattern_generator.pattern_generator import assemble_metajson

    format_  = payload.format or "old"
    metadata = _normalise_metadata(payload.metadata, format_)
    language = (metadata.get("Language") or "Korean").strip()
    levels   = _build_levels_from_toc(payload.toc, payload.citations)

    # Build scope_entries for back-compat (used as level-2 pattern match strings)
    scope_entries = _build_scope_entries(payload.scope)

    whitespace_handling: dict | None = None
    if payload.brdConfig and isinstance(payload.brdConfig.get("whitespaceHandling"), dict):
        ws = payload.brdConfig["whitespaceHandling"]
        whitespace_handling = {
            str(k): [str(v) for v in vals]
            for k, vals in ws.items()
            if isinstance(vals, list)
        }

    # ── KEY FIX: pass full scope + citations dicts so assemble_metajson
    #    can build pathTransform levels 3+ from citation rules and apply
    #    language-conventional cleanup patterns. ──────────────────────────────
    metajson, filename = assemble_metajson(
        metadata=metadata,
        levels=levels,
        language=language,
        scope=payload.scope,            # ← full scope dict (new)
        citations=payload.citations,    # ← full citations dict (new)
        content_profile=payload.contentProfile,
        scope_entries=scope_entries,
        whitespace_handling=whitespace_handling,
        brd_config=payload.brdConfig,
    )

    # Final safety net: remove template/noise rows and ensure level-backed
    # pathTransform rows are emitted even when upstream config is noisy.
    _sanitize_path_transform_output(metajson)

    return {
        "success":  True,
        "metajson": metajson,
        "filename": filename,
    }