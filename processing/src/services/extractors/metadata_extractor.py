"""
src/services/extractors/metadata_extractor.py
Extracts BRD metadata fields from the metadata table in a .docx file.

Format is auto-detected:
  NEW  — metadata table contains "Content Category Name" (or similar new-format labels)
  OLD  — metadata table contains "Metadata Element" header column
         (uses "Source Name" for content_category_name, "Authoritative Source" for issuing_agency)
"""

import re
from .base import heading_level, para_text


# ─── US States (for language inference) ──────────────────────────────────────
_US_STATES = {
    "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
    "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
    "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
    "minnesota","mississippi","missouri","montana","nebraska","nevada",
    "new hampshire","new jersey","new mexico","new york","north carolina",
    "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
    "south carolina","south dakota","tennessee","texas","utah","vermont",
    "virginia","washington","west virginia","wisconsin","wyoming",
    # abbreviations
    "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in",
    "ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv",
    "nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn",
    "tx","ut","vt","va","wa","wv","wi","wy","dc","united states","u.s.","usa",
}


def _clean(value: str) -> str:
    """Strip excess whitespace, normalize internal spaces, and remove surrounding quotes."""
    value = " ".join(value.split())
    # Strip all varieties of surrounding quotes (straight and curly)
    value = value.strip("\"'\u201c\u201d\u2018\u2019\u00ab\u00bb")
    return value


def _infer_language(geography: str, existing_language: str) -> str:
    """If language is blank and geography is a US state, return English."""
    if existing_language.strip():
        return existing_language
    if geography.strip().lower() in _US_STATES:
        return "English"
    return existing_language


def _extract_comment_cell(cells) -> str:
    """Pull the SME comments cell text (typically column 3+) from a metadata row."""
    if len(cells) < 3:
        return ""
    for cell in cells[2:]:
        value = _clean(cell.text.replace("\xa0", " "))
        lowered = value.lower()
        if value and not ("sme comments" in lowered and "checkpoint" in lowered):
            return value
    return ""


def _append_named_comment(target: list[str], label: str, comment: str) -> None:
    label = _clean(label.strip("*: \xa0"))
    comment = _clean(comment)
    if not comment:
        return
    entry = f"{label}: {comment}" if label else comment
    if entry not in target:
        target.append(entry)


def _is_legacy_format(doc) -> bool:
    """
    Returns True when the document uses the legacy BRD metadata format.

    A document is NEW format if ANY table anywhere contains "content category"
    (e.g. "Content Category Name") — that label only exists in new-format docs.

    A document is LEGACY if no table contains "content category" AND at least
    one table contains "source name", "source type", or "authoritative source"
    (the legacy equivalents of Content Category Name / Issuing Agency).

    This is purely keyword-based — no column counting, no positional assumptions.
    """
    has_content_category = False
    has_legacy_labels = False

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                ct = cell.text.strip().lower()
                if "content category" in ct:
                    has_content_category = True
                if "source name" in ct or "source type" in ct or "authoritative source" in ct:
                    has_legacy_labels = True

    # If we found "content category" anywhere → new format, no matter what else is present
    if has_content_category:
        return False

    # No "content category" but has legacy-only labels → old format
    if has_legacy_labels:
        return True

    return False


def extract_metadata(doc) -> dict:
    """
    Auto-detect NEW vs OLD format, then delegate to the appropriate extractor.
    The returned dict always includes a '_format' key: 'new' or 'old'.
    """
    if _is_legacy_format(doc):
        result = extract_metadata_legacy(doc)
        result["_format"] = "old"
    else:
        result = _extract_metadata_new(doc)
        result["_format"] = "new"
    return result


# ─────────────────────────────────────────────────────────────────────────────
# NEW format extractor
# ─────────────────────────────────────────────────────────────────────────────

def _extract_metadata_new(doc) -> dict:
    """
    Extract metadata from a NEW-format BRD.
    New format uses labels like 'Content Category Name', 'Issuing Agency', etc.
    """
    metadata = {
        "content_category_name":     "",
        "authoritative_source":      "",
        "source_type":               "",
        "content_type":              "",
        "publication_date":          "",
        "last_updated_date":         "",
        "effective_date":            "",
        "comment_due_date":          "",
        "compliance_date":           "",
        "processing_date":           "",
        "issuing_agency":            "",
        "related_government_agency": "",
        "content_uri":               "",
        "geography":                 "",
        "language":                  "",
        "document_title":            "",
        "name":                      "",
        "impacted_citation":         "",
        "payload_type":              "",
        "payload_subtype":           "",
        "summary":                   "",
        "status":                    "",
        "sme_comments":              "",
        "product_owner":             "",
        "sme":                       "",
        "contributors":              [],
        "region":                    "",
        "country":                   "",
        "version":                   "",
        "author":                    "",
    }

    for para in doc.paragraphs:
        if heading_level(para) == 1 and para_text(para):
            metadata["document_title"] = para_text(para)
            break

    key_map = {
        "content category name":     "content_category_name",
        "content category":          "content_category_name",
        "authoritative source":      "authoritative_source",
        "source type":               "source_type",
        "content type":              "content_type",
        "publication date":          "publication_date",
        "last updated date":         "last_updated_date",
        "effective date":            "effective_date",
        "comment due date":          "comment_due_date",
        "compliance date":           "compliance_date",
        "processing date":           "processing_date",
        "issuing agency":            "issuing_agency",
        "related government agency": "related_government_agency",
        "content uri":               "content_uri",
        "content url":               "content_uri",
        "impacted citation":         "impacted_citation",
        "payload subtype":           "payload_subtype",
        "payload type":              "payload_type",
        "sme comments":              "sme_comments",
        "geography":                 "geography",
        "language":                  "language",
        "product owner":             "product_owner",
        "status":                    "status",
        "summary":                   "summary",
        "region":                    "region",
        "country":                   "country",
        "contributors":              "contributors",
        "version":                   "version",
        "author":                    "author",
        "name":                      "name",
        "sme":                       "sme",
    }
    sorted_key_map = sorted(key_map.items(), key=lambda x: -len(x[0]))
    sme_comment_lines: list[str] = []

    for table in doc.tables:
        for row in table.rows:
            cells = row.cells
            if len(cells) < 2:
                continue

            raw_label = cells[0].text.strip().replace("\n", " ")
            label = raw_label.lower().strip("*: \xa0")

            value = cells[1].text.strip()
            if not value:
                for cell in reversed(cells[1:]):
                    v = cell.text.strip()
                    if v:
                        value = v
                        break

            if len(value) > 300:
                value = ""

            comment_value = _extract_comment_cell(cells)

            matched = False
            for pattern, field in sorted_key_map:
                if pattern in label:
                    matched = True
                    if field == "contributors":
                        parts = re.split(r"[\n,]+", value)
                        metadata["contributors"] = [p.strip() for p in parts if p.strip()]
                    elif field == "content_uri":
                        url_m = re.search(r"https?://[^\s\)\]」）,]+", value)
                        metadata["content_uri"] = url_m.group(0).rstrip(".,;") if url_m else value
                    else:
                        if not metadata[field]:
                            metadata[field] = value
                    if comment_value:
                        _append_named_comment(sme_comment_lines, raw_label, comment_value)
                    break
            if label and not matched:
                print(f"[DEBUG metadata_extractor] unmatched label: {repr(label[:60])}")

    for field in (
        "content_category_name", "authoritative_source", "source_type", "content_type",
        "publication_date", "last_updated_date", "effective_date", "comment_due_date",
        "compliance_date", "processing_date", "issuing_agency", "related_government_agency",
        "content_uri", "geography", "language", "name", "impacted_citation",
        "payload_type", "payload_subtype", "summary", "status", "sme_comments",
        "product_owner", "region", "country", "version", "author",
    ):
        if isinstance(metadata.get(field), str):
            metadata[field] = _clean(metadata[field])

    if sme_comment_lines:
        metadata["sme_comments"] = "\n".join(sme_comment_lines)

    if not metadata["authoritative_source"] and metadata["issuing_agency"]:
        metadata["authoritative_source"] = metadata["issuing_agency"]
    if not metadata["issuing_agency"] and metadata["authoritative_source"]:
        metadata["issuing_agency"] = metadata["authoritative_source"]
    if not metadata["name"]:
        metadata["name"] = metadata["document_title"]

    metadata["language"] = _infer_language(
        metadata.get("geography", ""),
        metadata.get("language", ""),
    )

    return metadata


# ─────────────────────────────────────────────────────────────────────────────
# Legacy extractor (paragraph-based / "Metadata Element" table format)
# ─────────────────────────────────────────────────────────────────────────────

def extract_metadata_legacy(doc) -> dict:
    """
    Legacy BRDs use a 2-column table with headers
    'Metadata Element' | 'Document Location'
    and different label names:
      'Source Name'         → content_category_name
      'Authoritative Source'→ authoritative_source
    Output shape is identical to _extract_metadata_new().
    """
    metadata = {
        "content_category_name":     "",
        "authoritative_source":      "",
        "source_type":               "",
        "content_type":              "",
        "publication_date":          "",
        "last_updated_date":         "",
        "effective_date":            "",
        "comment_due_date":          "",
        "compliance_date":           "",
        "processing_date":           "",
        "issuing_agency":            "",
        "related_government_agency": "",
        "content_uri":               "",
        "geography":                 "",
        "language":                  "",
        "document_title":            "",
        "name":                      "",
        "impacted_citation":         "",
        "payload_type":              "",
        "payload_subtype":           "",
        "summary":                   "",
        "status":                    "",
        "sme_comments":              "",
        "product_owner":             "",
        "sme":                       "",
        "contributors":              [],
        "region":                    "",
        "country":                   "",
        "version":                   "",
        "author":                    "",
    }

    _skip = {
        "document history", "glossary", "file delivery", "system display",
        "citation visualization", "legal", "copyright",
    }
    for p in doc.paragraphs:
        if p.style and p.style.name == "Heading 1":
            t = p.text.replace("\xa0", " ").strip()
            if t and not any(s in t.lower() for s in _skip):
                metadata["document_title"] = t
                break

    key_map = {
        "authoritative source":      "authoritative_source",
        "source name":               "content_category_name",
        "source type":               "source_type",
        "content type":              "content_type",
        "publication date":          "publication_date",
        "last updated date":         "last_updated_date",
        "effective date":            "effective_date",
        "comment due date":          "comment_due_date",
        "compliance date":           "compliance_date",
        "processing date":           "processing_date",
        "issuing agency":            "issuing_agency",
        "related government agency": "related_government_agency",
        "content uri":               "content_uri",
        "content url":               "content_uri",
        "impacted citation":         "impacted_citation",
        "payload subtype":           "payload_subtype",
        "payload type":              "payload_type",
        "sme comments":              "sme_comments",
        "geography":                 "geography",
        "language":                  "language",
        "product owner":             "product_owner",
        "status":                    "status",
        "summary":                   "summary",
        "region":                    "region",
        "country":                   "country",
        "contributors":              "contributors",
        "version":                   "version",
        "author":                    "author",
        "name":                      "name",
        "sme":                       "sme",
    }
    sorted_key_map = sorted(key_map.items(), key=lambda x: -len(x[0]))
    url_re = re.compile(r"https?://[^\s\)\]」）,]+")
    sme_comment_lines: list[str] = []

    for table in doc.tables:
        for row in table.rows:
            cells = row.cells
            if len(cells) < 2:
                continue
            raw_label = cells[0].text.strip().replace("\n", " ")
            label = raw_label.lower().strip("*: \xa0")

            seen_ids: set = set()
            unique_cells = []
            for c in cells[1:]:
                cid = id(c._tc)
                if cid not in seen_ids:
                    seen_ids.add(cid)
                    unique_cells.append(c)

            value = ""
            for c in unique_cells:
                v = c.text.replace("\xa0", " ").strip()
                if v and len(v) <= 300:
                    value = v
                    break

            comment_value = _extract_comment_cell(cells)

            for pattern, field in sorted_key_map:
                if pattern in label:
                    if field == "contributors":
                        parts = re.split(r"[\n,]+", value)
                        metadata["contributors"] = [p.strip() for p in parts if p.strip()]
                    elif field == "content_uri":
                        m = url_re.search(value)
                        metadata["content_uri"] = m.group(0).rstrip(".,;") if m else value
                    else:
                        if not metadata[field]:
                            metadata[field] = value
                    if comment_value:
                        _append_named_comment(sme_comment_lines, raw_label, comment_value)
                    break

    for field in (
        "content_category_name", "authoritative_source", "source_type", "content_type",
        "publication_date", "last_updated_date", "effective_date", "comment_due_date",
        "compliance_date", "processing_date", "issuing_agency", "related_government_agency",
        "content_uri", "geography", "language", "name", "impacted_citation",
        "payload_type", "payload_subtype", "summary", "status", "sme_comments",
        "product_owner", "region", "country", "version", "author",
    ):
        if isinstance(metadata.get(field), str):
            metadata[field] = _clean(metadata[field])

    if sme_comment_lines:
        metadata["sme_comments"] = "\n".join(sme_comment_lines)

    if not metadata["issuing_agency"] and metadata["authoritative_source"]:
        metadata["issuing_agency"] = metadata["authoritative_source"]
    if not metadata["authoritative_source"] and metadata["issuing_agency"]:
        metadata["authoritative_source"] = metadata["issuing_agency"]
    if not metadata["name"]:
        metadata["name"] = metadata["document_title"]

    metadata["language"] = _infer_language(
        metadata.get("geography", ""),
        metadata.get("language", ""),
    )

    return metadata