"""
src/services/extractor.py
Orchestrates all individual BRD extractors into one combined result.
This is the entry point imported by src/routers/process.py.
"""

import re
import json
from datetime import datetime
from pathlib import Path

from docx import Document

from .extractors.toc_extractor import extract_toc
from .extractors.metadata_extractor import extract_metadata
from .extractors.scope_extractor import extract_scope
from .extractors.citations_extractor import extract_citations
from .extractors.content_profile_extractor import extract_content_profile


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
        raw.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
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
        m = re.search(rf"(?:\"{re.escape(key)}\"|'{re.escape(key)}'|\b{re.escape(key)}\b)\s*:\s*{{", text)
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
        m = re.search(rf"(?:\"{re.escape(key)}\"|'{re.escape(key)}'|\b{re.escape(key)}\b)\s*:\s*\"([^\"]+)\"", text)
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
    """Extract direct nested list item blocks from an outer list block."""
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
        if i != 0:  # skip the outer list itself
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
    marker = re.search(r"(?is)(?:\"pathTransform\"|'pathTransform'|pathTransform|path_transform|\"path_transform\"|'path_transform')\s*:\s*{", cleaned)
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

        pat_match = re.search(r"(?is)(?:\"patterns\"|'patterns'|patterns)\s*:\s*\[", level_block)
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

        case_match = re.search(r"(?is)(?:\"case\"|'case'|case)\s*:\s*(['\"])(.*?)\1", level_block)
        case_val = case_match.group(2) if case_match else ""

        if patterns:
            out[level] = {"patterns": patterns, "case": case_val}

    return out or None


def _extract_brd_config(text: str) -> dict:
    """Best-effort extraction of BRD config blocks embedded in BRD content."""
    config: dict = {}

    path_transform = _extract_path_transform_relaxed(text) or _extract_config_object(text, "pathTransform", "path_transform")
    if path_transform:
        config["pathTransform"] = path_transform

    custom_toc = _extract_config_object(text, "custom_toc", "customToc")
    if custom_toc:
        config["custom_toc"] = custom_toc

    whitespace = _extract_config_object(text, "whitespaceHandling", "whitespace_handling")
    if whitespace:
        config["whitespaceHandling"] = whitespace

    level_patterns = _extract_config_object(text, "levelPatterns", "level_patterns")
    if level_patterns:
        config["levelPatterns"] = level_patterns

    root_path = _extract_config_scalar(text, "rootPath", "root_path")
    if root_path:
        config["rootPath"] = root_path

    return config


# ─────────────────────────────────────────────
# .docx path → full structured extraction
# ─────────────────────────────────────────────

def extract_all(docx_path: str) -> dict:
    """Run all extractors on a .docx file and return the combined result."""
    doc = Document(docx_path)
    doc_text = _collect_document_text(doc)
    brd_config = _extract_brd_config(doc_text)
    return {
        "extracted_at":    datetime.utcnow().isoformat() + "Z",
        "source_file":     Path(docx_path).name,
        "toc":             extract_toc(doc),
        "metadata":        extract_metadata(doc),
        "scope":           extract_scope(doc),
        "citations":       extract_citations(doc),
        "content_profile": extract_content_profile(doc),
        "brd_config":      brd_config,
    }


# ─────────────────────────────────────────────
# Raw text fallback (PDF / .doc scraper output)
# ─────────────────────────────────────────────

def _fallback_from_text(text: str, format: str) -> dict:
    """
    Heuristic extraction from raw text (used when we only have scraper output).
    Called when the input is not a .docx file path.
    """
    lines  = [line.strip() for line in text.splitlines() if line.strip()]
    joined = "\n".join(lines)
    lowered = joined.lower()
    url_pattern = re.compile(r"https?://[^\s\)\]]+")

    # ── TOC ──────────────────────────────────────────────────────────────────
    toc_sections = []
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
    in_scope: list = []
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

    metadata = {
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
                        metadata["contributors"] = [v.strip() for v in re.split(r"[\n,]+", val) if v.strip()]
                    else:
                        metadata[field] = val
                    break

    # ── CITATIONS ─────────────────────────────────────────────────────────────
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
    citations = {
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

    content_profile = {
        "document_type":      "BRD",
        "complexity":         complexity,
        "primary_domain":     "Regulatory / Legal (Australian Legislative Instruments)" if "legislation" in lowered else "Business",
        "key_themes":         key_themes,
        "functional_areas":   [l for l in lines if len(l) < 120 and not url_pattern.search(l)][:10],
        "requirements_count": req_count,
        "has_diagrams":       False,
        "has_tables":         "|" in joined or "\t" in joined,
        "completeness_score": completeness,
        "quality_notes":      [],
        "word_count":         len(joined.split()),
    }

    brd_config = _extract_brd_config(joined)

    return {
        "extracted_at":    datetime.now().isoformat() + "Z",
        "source_file":     "",
        "toc":             {"sections": toc_sections},
        "metadata":        metadata,
        "scope":           {"in_scope": in_scope, "out_of_scope": [], "summary": f"Scope covers {len(in_scope)} active documents."},
        "citations":       citations,
        "content_profile": content_profile,
        "brd_config":      brd_config,
    }


# ─────────────────────────────────────────────
# Async entry point for process.py router
# ─────────────────────────────────────────────

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