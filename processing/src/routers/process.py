from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Any
from src.services.extractor import extract_all_sections
from src.services.scraper import extract_text
from src.services.pattern_generator import generate_level_patterns
import tempfile, os, shutil

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
    import re
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

    import re

    lines = (
        rule.replace("\r", "\n")
        .replace("\t", " ")
        .split("\n")
    )

    def _looks_regex_pattern(text: str) -> bool:
        lowered = text.lower()
        # Reject BRD template syntax lines (not actual regex patterns)
        if "<level" in lowered or "example:" in lowered:
            return False
        if re.search(r"\+\s*\"", text):
            return False

        # Accept only strong regex signals; plain prose or concat formulas are ignored.
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
        # Remove wrappers like <Level 2> or Level 2 labels that are not patterns.
        cur = re.sub(r"^<\s*level\s*\d+\s*>\s*", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"^level\s*\d+\s*[:\-]?\s*", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"^[-*\d.)\s]+", "", cur).strip()
        cur = re.sub(r"^(pattern|regex|rule|example|examples|notes?)\s*:\s*", "", cur, flags=re.IGNORECASE).strip()
        cur = cur.strip('"\'`').strip().rstrip(",")
        # Ignore trailing inline examples/notes after a pattern declaration.
        cur = re.sub(r"\bexample\s*:.*$", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"\*\s*note\s*:.*$", "", cur, flags=re.IGNORECASE).strip()
        if cur and _looks_regex_pattern(cur):
            cleaned.append(cur)

    # Keep order, remove exact duplicates
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
        # ── .docx: full structured extraction via python-docx ───────────────
        if suffix == ".docx":
            result = await extract_all_sections(tmp_path, format)

        # ── .pdf / .doc / other: raw text extraction via scraper ────────────
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

    # Python inference based on language + citation text
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

    # Apply inferred patterns first for all levels in range.
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

    # Level 2 is always the document title.
    if "2" in patterns:
        patterns["2"] = [r"^.*$"]

    return {
        "success": True,
        "language": language,
        "levelRange": [min_level, max_level],
        "levelPatterns": patterns,
    }