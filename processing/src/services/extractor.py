"""
src/services/extractor.py
Orchestrates all individual BRD extractors into one combined result.
This is the entry point imported by src/routers/process.py.
"""

import re
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from zipfile import BadZipFile

import docx2txt
import fitz  # PyMuPDF
from docx import Document

from .extractors.toc_extractor import extract_toc
from .extractors.metadata_extractor import extract_metadata
from .extractors.scope_extractor import extract_scope
from .extractors.citations_extractor import extract_citations
from .extractors.content_profile_extractor import extract_content_profile


def extract_text(file_path: str, suffix: str) -> str:
    """Extract raw text from PDF, DOCX, or legacy DOC files."""
    normalized_suffix = suffix.lower()
    if normalized_suffix == ".pdf":
        return _extract_pdf(file_path)
    if normalized_suffix == ".docx":
        return _extract_docx(file_path)
    if normalized_suffix == ".doc":
        return _extract_doc(file_path)
    raise ValueError(f"Unsupported file type: {suffix}")


def _extract_pdf(path: str) -> str:
    doc = fitz.open(path)
    pages = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()
    return "\n\n".join(pages)


def _extract_docx(path: str) -> str:
    try:
        return docx2txt.process(path)
    except BadZipFile as exc:
        raise ValueError("Invalid .docx file content (not a valid DOCX/ZIP package).") from exc


def _extract_doc(path: str) -> str:
    """Extract text from legacy .doc by converting to temporary .docx."""
    temp_fd, temp_docx_path = tempfile.mkstemp(suffix=".docx")
    os.close(temp_fd)
    temp_docx = Path(temp_docx_path)

    try:
        if _convert_doc_to_docx_with_word(path, str(temp_docx)):
            return _extract_docx(str(temp_docx))

        if _convert_doc_to_docx_with_soffice(path, str(temp_docx)):
            return _extract_docx(str(temp_docx))

        raise ValueError(
            "Failed to read legacy .doc file. Install pywin32 in the active environment with Microsoft Word, "
            "or install LibreOffice and ensure 'soffice' is available in PATH."
        )
    finally:
        try:
            temp_docx.unlink(missing_ok=True)
        except Exception:
            pass


def _convert_doc_to_docx_with_word(src_path: str, dst_docx_path: str) -> bool:
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return False

    word = None
    document = None
    initialized = False
    try:
        pythoncom.CoInitialize()
        initialized = True
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0

        document = word.Documents.Open(os.path.abspath(src_path), ReadOnly=True)
        document.SaveAs(os.path.abspath(dst_docx_path), FileFormat=16)
        document.Close(False)
        document = None
        return Path(dst_docx_path).exists()
    except Exception:
        return False
    finally:
        if document is not None:
            try:
                document.Close(False)
            except Exception:
                pass
        if word is not None:
            try:
                word.Quit()
            except Exception:
                pass
        if initialized:
            pythoncom.CoUninitialize()


def _convert_doc_to_docx_with_soffice(src_path: str, dst_docx_path: str) -> bool:
    source = Path(src_path)
    target = Path(dst_docx_path)

    with tempfile.TemporaryDirectory() as out_dir:
        cmd = [
            "soffice",
            "--headless",
            "--convert-to",
            "docx",
            "--outdir",
            out_dir,
            str(source),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

        if result.returncode != 0:
            return False

        converted = Path(out_dir) / f"{source.stem}.docx"
        if not converted.exists():
            return False

        target.write_bytes(converted.read_bytes())
        return True


# ─────────────────────────────────────────────────────────────────────────────
# Document text collection
# ─────────────────────────────────────────────────────────────────────────────

def _collect_document_text(doc: Document) -> str:
    """Collect paragraph and table text for relaxed config parsing."""
    lines: list[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            lines.append(t)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                t = (cell.text or "").strip()
                if t:
                    lines.append(t)
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# JSON-like block extraction helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_braced_block(text: str, open_brace_idx: int) -> str | None:
    if open_brace_idx < 0 or open_brace_idx >= len(text) or text[open_brace_idx] != "{":
        return None
    depth = 0
    in_string = False
    quote_char = ""
    escaped = False
    for i in range(open_brace_idx, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote_char:
                in_string = False
            continue
        if ch in ('"', "'"):
            in_string = True
            quote_char = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace_idx:i + 1]
    return None


def _cleanup_json_like(raw: str) -> str:
    raw = (
        raw.replace("\u201c", '"').replace("\u201d", '"')
           .replace("\u2018", "'").replace("\u2019", "'")
           .replace("\uff1a", ":")
    )
    cleaned = re.sub(r"//.*?$", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned.strip()


def _parse_json_like_object(raw_obj: str) -> dict | None:
    cleaned = _cleanup_json_like(raw_obj)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _extract_config_object(text: str, *keys: str) -> dict | None:
    for key in keys:
        m = re.search(
            rf"(?:\"{re.escape(key)}\"|'{re.escape(key)}'|\b{re.escape(key)}\b)\s*:\s*{{",
            text,
        )
        if not m:
            continue
        brace_idx = text.find("{", m.end() - 1)
        if brace_idx < 0:
            continue
        block = _extract_braced_block(text, brace_idx)
        if not block:
            continue
        parsed = _parse_json_like_object(block)
        if isinstance(parsed, dict) and parsed:
            return parsed
    return None


def _extract_config_scalar(text: str, *keys: str) -> str | None:
    for key in keys:
        m = re.search(
            rf"(?:\"{re.escape(key)}\"|'{re.escape(key)}'|\b{re.escape(key)}\b)\s*:\s*\"([^\"]+)\"",
            text,
        )
        if m and m.group(1).strip():
            return m.group(1).strip()
    return None


def _extract_bracket_block(text: str, open_bracket_idx: int) -> str | None:
    if open_bracket_idx < 0 or open_bracket_idx >= len(text) or text[open_bracket_idx] != "[":
        return None
    depth = 0
    in_string = False
    quote_char = ""
    escaped = False
    for i in range(open_bracket_idx, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote_char:
                in_string = False
            continue
        if ch in ('"', "'"):
            in_string = True
            quote_char = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[open_bracket_idx:i + 1]
    return None


def _extract_list_items(list_block: str) -> list[str]:
    items: list[str] = []
    if not list_block or not list_block.startswith("["):
        return items
    i = 0
    while i < len(list_block):
        if list_block[i] != "[":
            i += 1
            continue
        block = _extract_bracket_block(list_block, i)
        if not block:
            break
        if i != 0:
            items.append(block)
        i += len(block)
    return items


def _parse_pattern_row(row_block: str) -> list | None:
    row = row_block.strip()
    m = re.match(
        r"^\[\s*(['\"])(.*?)\1\s*,\s*(['\"])(.*?)\3\s*,\s*(-?\d+)\s*,\s*(['\"])(.*?)\6\s*\]$",
        row,
        flags=re.DOTALL,
    )
    if not m:
        return None

    def _u(val: str) -> str:
        return val.replace(r"\"", '"').replace(r"\\'", "'").strip()

    return [_u(m.group(2)), _u(m.group(4)), int(m.group(5)), _u(m.group(7))]


def _extract_path_transform_relaxed(text: str) -> dict | None:
    """Parse pathTransform even when BRD text is not strict JSON."""
    cleaned = _cleanup_json_like(text)
    marker = re.search(
        r"(?is)(?:\"pathTransform\"|'pathTransform'|pathTransform"
        r"|path_transform|\"path_transform\"|'path_transform')\s*:\s*{",
        cleaned,
    )
    if not marker:
        return None

    root_open = cleaned.find("{", marker.end() - 1)
    if root_open < 0:
        return None
    root_block = _extract_braced_block(cleaned, root_open)
    if not root_block:
        return None

    strict = _parse_json_like_object(root_block)
    if isinstance(strict, dict) and strict:
        return strict

    out: dict[str, dict] = {}
    for level_match in re.finditer(r"(?is)['\"]?(\d{1,2})['\"]?\s*:\s*{", root_block):
        level = level_match.group(1)
        level_open = root_block.find("{", level_match.end() - 1)
        if level_open < 0:
            continue
        level_block = _extract_braced_block(root_block, level_open)
        if not level_block:
            continue

        pat_match = re.search(
            r"(?is)(?:\"patterns\"|'patterns'|patterns)\s*:\s*\[", level_block
        )
        if not pat_match:
            continue
        pat_open = level_block.find("[", pat_match.end() - 1)
        if pat_open < 0:
            continue
        pat_block = _extract_bracket_block(level_block, pat_open)
        if not pat_block:
            continue

        patterns: list[list] = []
        for item in _extract_list_items(pat_block):
            parsed = _parse_pattern_row(item)
            if parsed:
                patterns.append(parsed)

        case_match = re.search(
            r"(?is)(?:\"case\"|'case'|case)\s*:\s*(['\"])(.*?)\1", level_block
        )
        case_val = case_match.group(2) if case_match else ""

        if patterns:
            out[level] = {"patterns": patterns, "case": case_val}

    return out or None


# ─────────────────────────────────────────────────────────────────────────────
# pathTransform derivation from extracted BRD sections
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_language_key(language: str) -> str:
    key = (language or "").strip().lower()
    if any(t in key for t in ["spanish", "español", "espanol", "castellano", "es-"]):
        return "spanish"
    if any(t in key for t in ["portuguese", "português", "portugues", "pt-"]):
        return "portuguese"
    if any(t in key for t in ["chinese", "中文", "汉语", "漢語", "zh", "zh-"]):
        return "chinese"
    if any(t in key for t in ["japanese", "日本語", "ja", "ja-"]):
        return "japanese"
    if any(t in key for t in ["korean", "한국어", "ko", "ko-"]):
        return "korean"
    return "english"


def _extract_korean_title(title: str) -> str:
    """
    Pull the Korean portion from a mixed-language title.
    'Act (금융회사의 지배구조에 관한 법률)' → '금융회사의 지배구조에 관한 법률'
    """
    m = re.search(r'\((?=[^)]*[가-힣])', title)
    if m:
        return title[m.start() + 1:].rstrip(')').strip()
    if re.search(r'[가-힣]', title):
        return title.strip()
    return ""


def _language_cleanup_patterns(language: str) -> dict[str, list[list]]:
    """
    Conventional per-level cleanup/normalisation pattern rows for each language.
    Used when the BRD does not contain an explicit pathTransform JSON block.
    Each row: [match_regex, replacement, flag, ""]
    """
    lang = _normalize_language_key(language)

    if lang == "portuguese":
        gc = [[" \u2013 [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]]
        return {
            "3":  [["T\u00cdTULO", "T\u00edtulo", 0, ""]] + gc,
            "4":  gc,
            "5":  [["ANEXO", "Anexo", 0, ""], ["COMPLEMENTAR", "Complementar", 0, ""]] + gc,
            "6":  [["AP\u00caNDICE", "Ap\u00eandice", 0, ""]] + gc,
            "7":  [["—[^>]+", "", 0, ""], ["CAP\u00cdTULO", "", 0, ""], [":$|\\.$", "", 0, ""]],
            "8":  gc,
            "9":  gc,
            "10": [["—[^>]+", "", 0, ""], [" \u2013 [^>]+", "", 0, ""], ["\\.$", "", 0, ""]],
            "11": [["—[^>]+", "", 0, ""], [" \u2013 [^>]+", "", 0, ""], ["\\.$", "", 0, ""]],
            "15": [["—[^>]+", "", 0, ""], [" \u2013 [^>]+", "", 0, ""], [":$|\\.$", "", 0, ""]],
        }

    if lang == "spanish":
        gc = [["\\([0-9]+\\) ", "", 0, ""], ["\\.—$", "", 0, ""]]
        return {
            "3":  [["ANEXO", "Anexo", 0, ""], ["BIS", "Bis", 0, ""],
                   ["ÚNICO", "Único", 0, ""], ["\\.—$", "", 0, ""]] + gc,
            "4":  [["T\u00cdTULO|T\u00edtulo", "T\u00edt.", 0, ""],
                   ["PRIMERO", "Primero", 0, ""], ["SEGUNDO", "Segundo", 0, ""],
                   ["TERCERO", "Tercero", 0, ""], ["CUARTO", "Cuarto", 0, ""],
                   ["QUINTO", "Quinto", 0, ""]] + gc,
            "5":  [["CAP\u00cdTULO|CAPITULO|Cap\u00edtulo", "Cap.", 0, ""],
                   ["BIS", "Bis", 0, ""]] + gc,
            "6":  [["Secci\u00f3n", "Sec.", 0, ""], ["BIS", "Bis", 0, ""]] + gc,
            "7":  [["BIS", "Bis", 0, ""]] + gc,
            "9":  [["Art\u00edculo", "Art.", 0, ""], ["\\.-$", "", 0, ""],
                   ["o", "", 0, ""], ["\u00ba", "", 0, ""], ["\u00b0", "", 0, ""],
                   ["\u00ba.-$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "10": [["\\.-$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "11": [["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "12": [["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "13": [["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "14": [["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "15": [["\\([0-9]+\\)", "", 0, ""], ["\\)$", "", 0, ""],
                   ["\\.$", "", 0, ""]] + gc,
            "17": [["TRANSITORIOS", "Transitorios", 0, ""],
                   ["TRANSITORIO", "Transitorio", 0, ""],
                   ["TRANSITORIA", "Transitoria", 0, ""],
                   ["TRANSITORIAS", "Transitorias", 0, ""],
                   ["CONSIDERANDO", "Considerando", 0, ""],
                   ["REFERENCIAS", "Referencias", 0, ""],
                   ["ANEXO", "Anexo", 0, ""],
                   ["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "18": [["ÚNICO", "Único", 0, ""], ["PRIMERA", "Primera", 0, ""],
                   ["SEGUNDA", "Segunda", 0, ""], ["TERCERA", "Tercera", 0, ""],
                   ["CUARTA", "Cuarta", 0, ""], ["QUINTA", "Quinta", 0, ""],
                   ["SEXTA", "Sexta", 0, ""], ["UNICA", "Unica", 0, ""],
                   ["PRIMERO", "Primero", 0, ""], ["SEGUNDO", "Segundo", 0, ""],
                   ["TERCERO", "Tercero", 0, ""], ["CUARTO", "Cuarto", 0, ""],
                   ["ÚNICA", "Única", 0, ""], ["UNICO", "Unico", 0, ""],
                   ["\\)$", "", 0, ""], ["\\.-$", "", 0, ""],
                   ["\\. -$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "19": [["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
            "20": [["\\)$", "", 0, ""], ["\\.$", "", 0, ""]] + gc,
        }

    if lang == "japanese":
        tc = [[" [^>]+", "", 0, ""]]
        return {
            "3":  tc,
            "4":  tc,
            "5":  tc,
            "6":  tc,
            "7":  tc,
            "8":  tc + [["か[^>]+", "", 0, ""], ["及[^>]+", "", 0, ""]],
            "17": [["則 [^>]+", "則", 0, ""], ["：$", "", 0, ""]],
        }

    if lang == "korean":
        # Level 2 is built from scope entries; other levels rarely need cleanup
        return {}

    # English / generic — no conventional cleanup needed
    return {}


def _pick_scope_title(entry: dict) -> str:
    """
    Extract document title from a scope entry regardless of key naming.
    Handles both snake_case and camelCase, plus common aliases.
    """
    for key in (
        "document_title", "documentTitle",
        "title", "name",
        "source_name", "sourceName",
        "document_name", "documentName",
    ):
        val = entry.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _pick_citations_refs(citations: dict | None) -> list[dict]:
    """
    Return citation reference objects that carry level + citationRules fields.

    Handles two known shapes:
      Shape A (citations_extractor):
        { "references": [{ "level": "3", "citationRules": "..." }] }
      Shape B (_fallback_from_text URL refs):
        { "references": [{ "id": "ref_1", "source": "https://..." }] }
        → these have no "level" field and are ignored here; lang cleanup covers them.

    Also checks top-level "citations" key some extractors may wrap results in.
    """
    if not citations:
        return []

    # Support { "citations": { "references": [...] } } wrapping
    inner = citations.get("citations")
    source = inner if isinstance(inner, dict) else citations

    refs = source.get("references") or []
    if not isinstance(refs, list):
        return []

    # Only keep entries that carry a level field (Shape A)
    return [
        r for r in refs
        if isinstance(r, dict) and r.get("level") is not None
    ]


def _extract_patterns_from_citation_text(text: str) -> list[str]:
    """
    Extract regex pattern strings embedded in free-form citation rule text.
    Mirrors the logic in pattern_generator._extract_patterns_from_text.
    """
    if not text or not text.strip():
        return []

    def _looks_regex(raw: str) -> bool:
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

        candidate = re.sub(r"^level\s*\d+\s*", "", candidate, flags=re.IGNORECASE).strip(" :-")
        candidate = re.sub(r"^(example|examples|pattern|regex|rule)\s*:\s*", "", candidate, flags=re.IGNORECASE).strip()
        if not candidate:
            return None

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
        cur = re.sub(
            r"^(pattern|regex|rule|example|examples|notes?)\s*:\s*", "", cur,
            flags=re.IGNORECASE,
        ).strip()
        cur = cur.strip('"\'`').strip().rstrip(",")
        cur = re.sub(r"\bexample\s*:.*$", "", cur, flags=re.IGNORECASE).strip()
        cur = re.sub(r"\*\s*note\s*:.*$", "", cur, flags=re.IGNORECASE).strip()
        if not cur:
            continue
        slash_wrapped = re.match(r"^/(.+)/[gimsuy]*$", cur)
        if slash_wrapped:
            cur = slash_wrapped.group(1)
        if _looks_regex(cur):
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


def _build_path_transform_from_extracted(
    scope: dict | None,
    citations: dict | None,
    language: str,
) -> dict:
    """
    Derive a pathTransform dict from already-extracted BRD sections.

    Priority per level:
      Level 2  — one pattern row per active in-scope document title
      Levels 3+ — (1) regex from citationRules text  (2) language cleanup defaults
    """
    pt: dict = {}
    lang = _normalize_language_key(language)

    # ── Level 2: one entry per active in-scope document ───────────────────────
    in_scope: list = []
    if isinstance(scope, dict):
        raw = scope.get("in_scope") or scope.get("inScope") or []
        if isinstance(raw, list):
            in_scope = raw

    level2_patterns: list[list] = []
    seen_titles: set[str] = set()

    for entry in in_scope:
        if not isinstance(entry, dict):
            continue
        if entry.get("strikethrough") or entry.get("strikeThrough"):
            continue

        raw_title = _pick_scope_title(entry)
        if not raw_title or raw_title in seen_titles:
            continue
        seen_titles.add(raw_title)

        if lang == "korean":
            ko_title = _extract_korean_title(raw_title)
            match_key = ko_title if ko_title else raw_title
        else:
            match_key = raw_title

        level2_patterns.append([match_key, raw_title, 0, ""])

    if level2_patterns:
        pt["2"] = {"patterns": level2_patterns, "case": ""}

    # ── Levels 3+: citationRules-derived regex patterns ───────────────────────
    citation_pattern_map: dict[str, list[list]] = {}
    for ref in _pick_citations_refs(citations):
        raw_level = str(ref.get("level") or "").strip()
        level_m = re.search(r"\d+", raw_level)
        if not level_m:
            continue
        level_key = level_m.group(0)
        if int(level_key) < 3:
            continue

        # Support multiple key names that different extractors may use
        rules_text = (
            ref.get("citationRules")
            or ref.get("citation_rules")
            or ref.get("rules")
            or ref.get("rule")
            or ""
        )
        if not isinstance(rules_text, str) or not rules_text.strip():
            continue

        extracted = _extract_patterns_from_citation_text(rules_text)
        if extracted:
            citation_pattern_map[level_key] = [[p, p, 0, ""] for p in extracted]

    # ── Language-conventional cleanup patterns ────────────────────────────────
    lang_cleanup = _language_cleanup_patterns(language)

    # Merge: citation-derived > language defaults; level 2 already handled
    all_keys = set(citation_pattern_map.keys()) | set(lang_cleanup.keys())
    for key in all_keys:
        if key == "2":
            continue
        if key in citation_pattern_map:
            pt[key] = {"patterns": citation_pattern_map[key], "case": ""}
        elif key in lang_cleanup and lang_cleanup[key]:
            pt[key] = {"patterns": lang_cleanup[key], "case": ""}

    return pt


# ─────────────────────────────────────────────────────────────────────────────
# Main brd_config extractor
# ─────────────────────────────────────────────────────────────────────────────

def _extract_brd_config(
    text: str,
    scope: dict | None = None,
    citations: dict | None = None,
    language: str = "English",
) -> dict:
    """
    Best-effort extraction of BRD config blocks embedded in BRD content.

    pathTransform priority:
      1. Explicit JSON/JSON-like block found in document text  (most authoritative)
      2. Derived from already-extracted scope + citations       (reliable fallback)
    """
    config: dict = {}

    # ── pathTransform ─────────────────────────────────────────────────────────
    path_transform = (
        _extract_path_transform_relaxed(text)
        or _extract_config_object(text, "pathTransform", "path_transform")
    )
    if path_transform:
        config["pathTransform"] = path_transform
    else:
        derived = _build_path_transform_from_extracted(scope, citations, language)
        if derived:
            config["pathTransform"] = derived

    # ── custom_toc ────────────────────────────────────────────────────────────
    custom_toc = _extract_config_object(text, "custom_toc", "customToc")
    if custom_toc:
        config["custom_toc"] = custom_toc

    # ── whitespaceHandling ────────────────────────────────────────────────────
    whitespace = _extract_config_object(text, "whitespaceHandling", "whitespace_handling")
    if whitespace:
        config["whitespaceHandling"] = whitespace

    # ── levelPatterns ─────────────────────────────────────────────────────────
    level_patterns = _extract_config_object(text, "levelPatterns", "level_patterns")
    if level_patterns:
        config["levelPatterns"] = level_patterns

    # ── rootPath ──────────────────────────────────────────────────────────────
    root_path = _extract_config_scalar(text, "rootPath", "root_path")
    if root_path:
        config["rootPath"] = root_path

    return config


# ─────────────────────────────────────────────────────────────────────────────
# .docx path → full structured extraction
# ─────────────────────────────────────────────────────────────────────────────

def extract_all(docx_path: str) -> dict:
    """Run all extractors on a .docx file and return the combined result."""
    doc      = Document(docx_path)
    doc_text = _collect_document_text(doc)

    # Run structured extractors first so brd_config can use their output
    toc             = extract_toc(doc)
    metadata        = extract_metadata(doc)
    scope           = extract_scope(doc)
    citations       = extract_citations(doc)
    content_profile = extract_content_profile(doc)

    # Resolve language — try multiple keys that different extractors may use
    language = (
        (metadata or {}).get("language")
        or (metadata or {}).get("Language")
        or "English"
    )

    brd_config = _extract_brd_config(
        doc_text,
        scope=scope,
        citations=citations,
        language=language,
    )

    return {
        "extracted_at":    datetime.utcnow().isoformat() + "Z",
        "source_file":     Path(docx_path).name,
        "toc":             toc,
        "metadata":        metadata,
        "scope":           scope,
        "citations":       citations,
        "content_profile": content_profile,
        "brd_config":      brd_config,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Raw text fallback (PDF / .doc scraper output)
# ─────────────────────────────────────────────────────────────────────────────

def _fallback_from_text(text: str, format: str) -> dict:
    """
    Heuristic extraction from raw text (used when we only have scraper output).
    Called when the input is not a .docx file path.
    """
    lines   = [line.strip() for line in text.splitlines() if line.strip()]
    joined  = "\n".join(lines)
    lowered = joined.lower()
    url_pattern = re.compile(r"https?://[^\s\)\]]+")

    # ── TOC ──────────────────────────────────────────────────────────────────
    toc_sections: list[dict] = []
    in_toc = False
    for line in lines:
        if re.search(r"table of contents", line, re.IGNORECASE):
            in_toc = True
            continue
        if in_toc:
            if len(line) > 160:
                in_toc = False
                continue
            num_match = re.match(r"^(\d+(?:\.\d+)*)\s+(.*)", line)
            if num_match:
                number = num_match.group(1)
                title  = num_match.group(2).strip()
                level  = number.count(".") + 1
            else:
                number = str(len(toc_sections) + 1)
                title  = line
                level  = 1
            toc_sections.append({"number": number, "title": title, "page": None, "level": level})

    # ── SCOPE ─────────────────────────────────────────────────────────────────
    in_scope: list[dict] = []
    pipe_rows = [l for l in lines if l.count("|") >= 3]
    if pipe_rows:
        for row in pipe_rows:
            parts = [p.strip() for p in row.split("|")]
            if len(parts) < 4 or "document title" in parts[0].lower():
                continue
            issuing_auth = parts[3] if len(parts) > 3 else ""
            auth_match = re.match(r"^(.*?)\s*\(([^)]+)\)\s*/\s*(.+)$", issuing_auth)
            if auth_match:
                auth_name = auth_match.group(1).strip()
                auth_code = auth_match.group(2).strip()
                geography = auth_match.group(3).strip()
            else:
                auth_name, auth_code, geography = issuing_auth, "", ""
            in_scope.append({
                "document_title":         parts[0],
                "regulator_url":          parts[1] if "http" in parts[1] else "",
                "content_url":            parts[2] if "http" in parts[2] else "",
                "issuing_authority":      auth_name,
                "issuing_authority_code": auth_code,
                "geography":              geography,
                "asrb_id":                parts[4] if len(parts) > 4 else "",
                "sme_comments":           parts[5] if len(parts) > 5 else "",
                "strikethrough":          False,
            })
    else:
        for url in url_pattern.findall(joined):
            if "legislation.gov.au" in url and "/latest/text" in url:
                in_scope.append({
                    "document_title":         url,
                    "regulator_url":          "https://www.legislation.gov.au",
                    "content_url":            url,
                    "issuing_authority":      "",
                    "issuing_authority_code": "",
                    "geography":              "",
                    "asrb_id":                "",
                    "sme_comments":           "",
                    "strikethrough":          False,
                })

    # ── METADATA ──────────────────────────────────────────────────────────────
    date_match    = re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", joined)
    version_match = re.search(r"\bv(?:ersion)?\s*[:\-]?\s*([\d.]+)\b", lowered)

    metadata: dict = {
        "document_title":         lines[0] if lines else "",
        "version":                version_match.group(1) if version_match else "",
        "author":                 "",
        "date":                   date_match.group(0) if date_match else "",
        "department":             "",
        "project_code":           "",
        "status":                 "",
        "region":                 "",
        "country":                "",
        "geography":              "",
        "language":               "",
        "product_owner":          "",
        "sme":                    "",
        "contributors":           [],
        "elevate_last_edit_date": "",
        "elevate_fields_changed": "",
        "reviewers":              [],
        "format":                 format,
    }

    kv_pattern = re.compile(r"^\*?\*?([A-Za-z ]{3,30})\*?\*?\s*[:\|]\s*(.+)$")
    kv_map = {
        "product owner": "product_owner", "sme": "sme", "status": "status",
        "region": "region", "country": "country", "geography": "geography",
        "language": "language", "version": "version", "author": "author",
        "contributors": "contributors", "content category": "department",
        "elevate last edit date": "elevate_last_edit_date",
        "elevate fields changed": "elevate_fields_changed",
    }
    for line in lines:
        m = kv_pattern.match(line)
        if m:
            key = m.group(1).lower().strip()
            val = m.group(2).strip()
            for pattern, field in kv_map.items():
                if pattern in key:
                    if field == "contributors":
                        metadata["contributors"] = [
                            v.strip() for v in re.split(r"[\n,]+", val) if v.strip()
                        ]
                    else:
                        metadata[field] = val
                    break

    # ── CITATIONS ─────────────────────────────────────────────────────────────
    # Fallback URL refs don't have level/citationRules so they don't contribute
    # to pathTransform levels 3+ — language cleanup defaults cover those instead.
    all_urls = list(dict.fromkeys(url_pattern.findall(joined)))
    references = [
        {
            "id":     f"ref_{i}",
            "type":   "regulation" if "legislation.gov" in url else "document",
            "title":  url,
            "source": url,
        }
        for i, url in enumerate(all_urls[:40], 1)
    ]
    citations: dict = {
        "citation_style":      "Hierarchical pipe-separated citation format (Level2 | Level3 | ...)",
        "references":          references,
        "internal_references": [u for u in all_urls if "confluence" in u.lower() or "file:///" in u.lower()],
        "external_standards":  [u for u in all_urls if "legislation.gov.au" in u],
    }

    # ── CONTENT PROFILE ───────────────────────────────────────────────────────
    req_count = len(re.findall(r"\b(must|shall|required|mandatory|should)\b", lowered))
    theme_patterns = {
        "legislation":   r"legislat|regulation|act\b",
        "metadata":      r"metadata|author|publication date|version",
        "citations":     r"citation|reference",
        "compliance":    r"compliance|regulatory|audit",
        "structuring":   r"table of contents|toc|heading",
        "file_delivery": r"file naming|zip|delivery",
        "australia":     r"australia|au\.|apac",
    }
    key_themes   = [t for t, p in theme_patterns.items() if re.search(p, lowered)]
    complexity   = "high" if len(lines) > 800 else "medium" if len(lines) > 300 else "low"
    expected     = {"scope", "metadata", "citation", "file", "structur", "exception", "update"}
    completeness = round(sum(1 for s in expected if s in lowered) / len(expected) * 100)

    content_profile: dict = {
        "document_type":      "BRD",
        "complexity":         complexity,
        "primary_domain":     (
            "Regulatory / Legal (Australian Legislative Instruments)"
            if "legislation" in lowered else "Business"
        ),
        "key_themes":         key_themes,
        "functional_areas":   [
            l for l in lines if len(l) < 120 and not url_pattern.search(l)
        ][:10],
        "requirements_count": req_count,
        "has_diagrams":       False,
        "has_tables":         "|" in joined or "\t" in joined,
        "completeness_score": completeness,
        "quality_notes":      [],
        "word_count":         len(joined.split()),
    }

    language = metadata.get("language") or "English"

    scope_dict: dict = {
        "in_scope":     in_scope,
        "out_of_scope": [],
        "summary":      f"Scope covers {len(in_scope)} active documents.",
    }

    brd_config = _extract_brd_config(
        joined,
        scope=scope_dict,
        citations=citations,
        language=language,
    )

    return {
        "extracted_at":    datetime.now().isoformat() + "Z",
        "source_file":     "",
        "toc":             {"sections": toc_sections},
        "metadata":        metadata,
        "scope":           scope_dict,
        "citations":       citations,
        "content_profile": content_profile,
        "brd_config":      brd_config,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Async entry point for process.py router
# ─────────────────────────────────────────────────────────────────────────────

async def extract_all_sections(docx_path_or_text: str, format: str = "new") -> dict:
    """
    Async entry point called by the FastAPI router.

    - If given a .docx file path → full structured extraction via python-docx
    - If given raw text (from scraper) → heuristic fallback extraction
    """
    arg = docx_path_or_text.strip()
    is_docx_path = (
        len(arg) < 512
        and arg.endswith(".docx")
        and "\n" not in arg
        and Path(arg).exists()
    )

    if is_docx_path:
        return extract_all(arg)

    return _fallback_from_text(docx_path_or_text, format)