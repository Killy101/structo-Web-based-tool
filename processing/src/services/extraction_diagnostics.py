from __future__ import annotations

from pathlib import Path
from typing import Any


_PLACEHOLDERS = {
    "",
    "-",
    "--",
    "—",
    "n/a",
    "na",
    "none",
    "null",
    "tbd",
    "unknown",
    "not applicable",
}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_text(value: Any) -> str:
    return str(value or "").strip()


def _is_meaningful_value(value: Any) -> bool:
    text = _as_text(value)
    return bool(text) and text.lower() not in _PLACEHOLDERS


def _first_meaningful(mapping: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = mapping.get(key)
        if _is_meaningful_value(value):
            return _as_text(value)
    return ""


def build_format_fingerprint(
    filename: str,
    original_suffix: str,
    detected_format: str,
    is_mhtml_doc: bool = False,
) -> dict[str, str]:
    suffix = (original_suffix or Path(filename or "").suffix or "").lower()

    if suffix == ".pdf":
        container = "pdf"
        container_label = "PDF"
    elif suffix == ".docx":
        container = "docx"
        container_label = "True DOCX"
    elif suffix == ".doc" and is_mhtml_doc:
        container = "mhtml-doc"
        container_label = "Confluence MHTML DOC export"
    elif suffix == ".doc":
        container = "legacy-doc"
        container_label = "Legacy DOC"
    else:
        container = "unknown"
        container_label = "Unknown container"

    template = "old" if str(detected_format).lower() == "old" else "new"
    template_label = "Old BRD" if template == "old" else "New BRD"

    return {
        "extension": suffix or "unknown",
        "container": container,
        "template": template,
        "label": f"{template_label} · {container_label}",
    }


def build_extraction_diagnostics(extracted: dict[str, Any], image_count: int = 0) -> dict[str, Any]:
    scope = extracted.get("scope") or {}
    toc = extracted.get("toc") or {}
    citations = extracted.get("citations") or {}
    metadata = extracted.get("metadata") or {}

    in_scope = _as_list(scope.get("in_scope"))
    out_of_scope = _as_list(scope.get("out_of_scope"))
    all_scope_rows = in_scope + out_of_scope
    toc_sections = _as_list(toc.get("sections"))
    citation_guide_rows = _as_list((toc.get("citationStyleGuide") or {}).get("rows"))
    citation_refs = _as_list(citations.get("references"))

    meaningful_citation_refs = [
        ref for ref in citation_refs
        if any(_is_meaningful_value(ref.get(key)) for key in ("citationRules", "sourceOfLaw", "isCitable", "smeComments"))
    ]

    warnings: list[dict[str, str]] = []

    if not in_scope and not out_of_scope:
        warnings.append({
            "code": "scope_missing",
            "severity": "warning",
            "message": "No scope rows were detected from the uploaded BRD.",
            "recommendation": "Review the source scope table or enter the scope rows manually.",
        })
    elif not in_scope and out_of_scope:
        warnings.append({
            "code": "scope_all_rows_excluded",
            "severity": "warning",
            "message": "All detected scope rows were marked excluded or struck through.",
            "recommendation": "Check whether strike-through text means archived content or true out-of-scope rows for this source.",
        })

    blank_scope_titles = sum(1 for row in all_scope_rows if not _is_meaningful_value((row or {}).get("document_title")))
    blank_scope_links = sum(
        1
        for row in in_scope
        if not (
            _is_meaningful_value((row or {}).get("regulator_url"))
            or _is_meaningful_value((row or {}).get("content_url"))
        )
    )
    scope_review_reasons: list[str] = []
    if len(out_of_scope) > len(in_scope) and all_scope_rows:
        scope_review_reasons.append("most rows were classified as excluded")
    if blank_scope_titles:
        scope_review_reasons.append(f"{blank_scope_titles} scope row(s) have no title")
    if blank_scope_links:
        scope_review_reasons.append(f"{blank_scope_links} in-scope row(s) have no link")
    if scope_review_reasons and in_scope:
        warnings.append({
            "code": "scope_review_recommended",
            "severity": "warning",
            "message": f"Scope extraction may need manual review: {'; '.join(scope_review_reasons)}.",
            "recommendation": "Confirm the included and excluded scope rows before finalizing the BRD.",
        })

    if not toc_sections:
        warnings.append({
            "code": "toc_missing",
            "severity": "warning",
            "message": "No TOC levels were extracted from the document structure section.",
            "recommendation": "Check the TOC Requirements section or add the missing levels manually.",
        })

    if not citation_guide_rows:
        warnings.append({
            "code": "citation_guide_missing",
            "severity": "warning",
            "message": "Citation Style Guide rows were not found in this BRD.",
            "recommendation": "Provide the citation style guide manually if the source uses a non-standard layout.",
        })

    if citation_refs and not meaningful_citation_refs:
        warnings.append({
            "code": "citations_incomplete",
            "severity": "warning",
            "message": "Citation levels were detected, but the citation rules table is mostly empty or incomplete.",
            "recommendation": "Fill in the missing citation rules before publishing or exporting this BRD.",
        })
    elif citation_refs and 0 < len(meaningful_citation_refs) < len(citation_refs):
        warnings.append({
            "code": "citations_partial",
            "severity": "warning",
            "message": "Some citation levels were extracted, but one or more levels still look blank or incomplete.",
            "recommendation": "Review the citation rules table and complete the missing levels.",
        })

    missing_metadata_fields: list[str] = []
    if not _first_meaningful(metadata, "content_category_name", "Content Category Name", "Source Name", "name"):
        missing_metadata_fields.append("content category")
    if not _first_meaningful(metadata, "issuing_agency", "authoritative_source", "Issuing Agency", "Authoritative Source"):
        missing_metadata_fields.append("issuing agency")
    if not _first_meaningful(metadata, "content_uri", "Content URI", "content_url"):
        missing_metadata_fields.append("content URI")

    if missing_metadata_fields:
        warnings.append({
            "code": "metadata_key_fields_missing",
            "severity": "warning",
            "message": f"Some key metadata fields are still missing: {', '.join(missing_metadata_fields)}.",
            "recommendation": "Check the metadata table and confirm the missing values before saving.",
        })

    summary = {
        "scopeInCount": len(in_scope),
        "scopeOutCount": len(out_of_scope),
        "tocSectionCount": len(toc_sections),
        "citationGuideRowCount": len(citation_guide_rows),
        "citationReferenceCount": len(citation_refs),
        "meaningfulCitationCount": len(meaningful_citation_refs),
        "imageCount": int(image_count or 0),
        "blankScopeTitleCount": blank_scope_titles,
        "blankScopeLinkCount": blank_scope_links,
        "missingMetadataFieldCount": len(missing_metadata_fields),
        "warningCount": len(warnings),
        "needsManualReview": bool(warnings),
    }

    return {
        "summary": summary,
        "warnings": warnings,
    }
