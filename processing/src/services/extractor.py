"""
src/services/extractor.py
Orchestrates all individual BRD extractors into one combined result.
This is the entry point imported by src/routers/process.py.
"""

import re
from datetime import datetime
from pathlib import Path

from docx import Document

from .extractors.toc_extractor import extract_toc
from .extractors.metadata_extractor import extract_metadata
from .extractors.scope_extractor import extract_scope
from .extractors.citations_extractor import extract_citations
from .extractors.content_profile_extractor import extract_content_profile


# ─────────────────────────────────────────────
# .docx path → full structured extraction
# ─────────────────────────────────────────────

def extract_all(docx_path: str) -> dict:
    """Run all extractors on a .docx file and return the combined result."""
    doc = Document(docx_path)
    return {
        "extracted_at":    datetime.utcnow().isoformat() + "Z",
        "source_file":     Path(docx_path).name,
        "toc":             extract_toc(doc),
        "metadata":        extract_metadata(doc),
        "scope":           extract_scope(doc),
        "citations":       extract_citations(doc),
        "content_profile": extract_content_profile(doc),
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

    return {
        "extracted_at":    datetime.now().isoformat() + "Z",
        "source_file":     "",
        "toc":             {"sections": toc_sections},
        "metadata":        metadata,
        "scope":           {"in_scope": in_scope, "out_of_scope": [], "summary": f"Scope covers {len(in_scope)} active documents."},
        "citations":       citations,
        "content_profile": content_profile,
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