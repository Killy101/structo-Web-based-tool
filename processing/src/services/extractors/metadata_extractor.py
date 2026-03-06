"""
src/services/extractors/metadata_extractor.py
Extracts BRD metadata fields from the metadata table in a .docx file.
"""

import re
from .base import heading_level, para_text


def extract_metadata(doc) -> dict:
    """
    Extract metadata from the BRD Metadata table.
    Matches row labels against known field names and populates a metadata dict.
    Falls back to extract_metadata_legacy() for legacy label names
    (e.g. 'Authoritative Source', 'Source Name').
    """
    # Detect legacy format: metadata table uses 'Metadata Element' header
    for table in doc.tables:
        if table.rows and "metadata element" in table.rows[0].cells[0].text.strip().lower():
            return extract_metadata_legacy(doc)
    metadata = {
        # ── Core BRD fields ──────────────────────────────────────────
        "content_category_name":     "",
        "publication_date":          "",
        "last_updated_date":         "",
        "processing_date":           "",
        "issuing_agency":            "",
        "related_government_agency": "",
        "content_uri":               "",
        "geography":                 "",
        "language":                  "",
        # ── Extra / footer fields ─────────────────────────────────────
        "document_title":            "",
        "status":                    "",
        "product_owner":             "",
        "sme":                       "",
        "contributors":              [],
        "region":                    "",
        "country":                   "",
        "version":                   "",
        "author":                    "",
    }

    # Document title = first H1
    for para in doc.paragraphs:
        if heading_level(para) == 1 and para_text(para):
            metadata["document_title"] = para_text(para)
            break

    key_map = {
        "content category name":     "content_category_name",
        "content category":          "content_category_name",
        "publication date":          "publication_date",
        "last updated date":         "last_updated_date",
        "processing date":           "processing_date",
        "issuing agency":            "issuing_agency",
        "related government agency": "related_government_agency",
        "content uri":               "content_uri",
        "content url":               "content_uri",
        "geography":                 "geography",
        "language":                  "language",
        "product owner":             "product_owner",
        "sme":                       "sme",
        "status":                    "status",
        "region":                    "region",
        "country":                   "country",
        "contributors":              "contributors",
        "version":                   "version",
        "author":                    "author",
    }
    # Longer/more-specific keys match first
    sorted_key_map = sorted(key_map.items(), key=lambda x: -len(x[0]))

    for table in doc.tables:
        for row in table.rows:
            cells = row.cells
            if len(cells) < 2:
                continue

            label = cells[0].text.strip().lower().strip("*: \xa0").replace("\n", " ")

            value = cells[1].text.strip()
            if not value:
                for cell in reversed(cells[1:]):
                    v = cell.text.strip()
                    if v:
                        value = v
                        break

            if len(value) > 300:
                value = ""

            for pattern, field in sorted_key_map:
                if pattern in label:
                    if field == "contributors":
                        parts = re.split(r"[\n,]+", value)
                        metadata["contributors"] = [p.strip() for p in parts if p.strip()]
                    elif field == "content_uri":
                        url_m = re.search(r"https?://[^\s\)\]」）,]+", value)
                        metadata["content_uri"] = url_m.group(0).rstrip(".,;") if url_m else value
                    elif field == "status":
                        metadata["status"] = value.strip("\"'\u201c\u201d\u2018\u2019")
                    else:
                        if not metadata[field]:
                            metadata[field] = value
                    break

    return metadata


# ─────────────────────────────────────────────
# Legacy extractor (paragraph-based format)
# ─────────────────────────────────────────────

def extract_metadata_legacy(doc) -> dict:
    """
    Legacy BRDs use a 2-column table with headers
    'Metadata Element' | 'Document Location'
    and different label names (e.g. 'Authoritative Source' instead of
    'Issuing Agency', 'Source Name' instead of content category name).
    Output shape is identical to extract_metadata().
    """
    metadata = {
        "content_category_name":     "",
        "publication_date":          "",
        "last_updated_date":         "",
        "processing_date":           "",
        "issuing_agency":            "",
        "related_government_agency": "",
        "content_uri":               "",
        "geography":                 "",
        "language":                  "",
        "document_title":            "",
        "status":                    "",
        "product_owner":             "",
        "sme":                       "",
        "contributors":              [],
        "region":                    "",
        "country":                   "",
        "source_type":               "",   # separate field — not shared with payload_subtype
        "payload_subtype":           "",   # separate field — not shared with source_type
        "version":                   "",
        "author":                    "",
    }

    # Document title: first Heading 1 that is not a boilerplate section
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
        "authoritative source":      "issuing_agency",
        "source name":               "content_category_name",
        "publication date":          "publication_date",
        "last updated date":         "last_updated_date",
        "processing date":           "processing_date",
        "issuing agency":            "issuing_agency",
        "related government agency": "related_government_agency",
        "content uri":               "content_uri",
        "content url":               "content_uri",
        "geography":                 "geography",
        "language":                  "language",
        "product owner":             "product_owner",
        "sme":                       "sme",
        "status":                    "status",
        "region":                    "region",
        "country":                   "country",
        "contributors":              "contributors",
        "payload subtype":           "payload_subtype",  # own field, matched before "source type"
        "source type":               "source_type",      # own field
        "version":                   "version",
        "author":                    "author",
    }
    sorted_key_map = sorted(key_map.items(), key=lambda x: -len(x[0]))
    url_re = re.compile(r"https?://[^\s\)\]」）,]+")

    # Fields whose raw values should have surrounding quotes stripped
    _strip_quotes = {"status", "source_type", "payload_subtype"}

    for table in doc.tables:
        for row in table.rows:
            cells = row.cells
            if len(cells) < 2:
                continue
            label = cells[0].text.strip().lower().strip("*: \xa0").replace("\n", " ")

            # Deduplicate cells — python-docx repeats the same cell object for
            # every column a merged cell spans, so we must de-dupe by XML node id.
            seen_ids: set = set()
            unique_cells = []
            for c in cells[1:]:
                cid = id(c._tc)
                if cid not in seen_ids:
                    seen_ids.add(cid)
                    unique_cells.append(c)

            # Take the first non-empty cell whose text is ≤ 300 chars (concise value).
            # Rows with long instructional text (e.g. Publication Date guidance) are
            # intentionally skipped so they don't pollute the extracted value.
            value = ""
            for c in unique_cells:
                v = c.text.replace("\xa0", " ").strip()
                if v and len(v) <= 300:
                    value = v
                    break

            for pattern, field in sorted_key_map:
                if pattern in label:
                    if field == "contributors":
                        parts = re.split(r"[\n,]+", value)
                        metadata["contributors"] = [p.strip() for p in parts if p.strip()]
                    elif field == "content_uri":
                        m = url_re.search(value)
                        metadata["content_uri"] = m.group(0).rstrip(".,;") if m else value
                    elif field in _strip_quotes:
                        if not metadata[field]:
                            metadata[field] = value.strip("\"'\u201c\u201d\u2018\u2019")
                    else:
                        if not metadata[field]:
                            metadata[field] = value
                    break

    return metadata