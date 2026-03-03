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
    """
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
                    else:
                        if not metadata[field]:
                            metadata[field] = value
                    break

    return metadata