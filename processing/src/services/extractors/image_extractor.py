"""
src/services/extractors/image_extractor.py

Extracts inline images from table cells in a BRD .docx file and returns
base64 encoded images to be sent to Node.js for database storage.

Each image record now carries a `section` field ("metadata", "scope",
"toc", "citations", or "unknown") plus a `fieldLabel` string — the
normalised text of the cell that *describes* the image row (the label
column, or the nearest non-empty sibling cell).  This lets the frontend
map images directly to their parent BRD section and field without
relying on brittle table/row/col index comparisons.

Section detection strategy
--------------------------
1.  Walk the document top-to-bottom, tracking the current Heading text.
2.  When a table is encountered, classify it by inspecting its header row
    against known keyword sets for each BRD section.
3.  For every cell that contains a drawing, derive `fieldLabel` from:
      a) The leftmost non-image cell on the same row (label column), or
      b) The cell text itself if all other cells are blank/images.
4.  Normalise `fieldLabel` to lowercase-stripped form (`cellText`) which
    matches the keyword arrays already used by the React components.
"""

from __future__ import annotations

import base64
import mimetypes
import os
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# Section keyword fingerprints
# Each set contains substrings that, if found in the header row of a table,
# classify that table as belonging to the named BRD section.
# ─────────────────────────────────────────────────────────────────────────────

_SECTION_FINGERPRINTS: dict[str, list[str]] = {
    "metadata": [
        "content category", "publication date", "issuing agency",
        "content uri", "content url", "geography", "language",
        "processing date", "last updated", "metadata element",
        "document location", "authoritative source",
    ],
    "scope": [
        "document title", "reference url", "regulator url",
        "content url", "issuing authority", "asrb id",
        "in scope", "out of scope", "evergreen", "date of ingestion",
        "source name",
    ],
    "toc": [
        "required", "definition", "example", "toc requirement",
        "identifies level", "level value", "sample values",
        "specific instruction",
    ],
    "citations": [
        "citation rule", "source of law", "citable", "is level citable",
        "citation level", "citation standardization",
    ],
}

# Heading keywords that signal we have entered a given section.
# These are matched against paragraph Heading styles between tables.
_HEADING_SECTION_MAP: dict[str, str] = {
    "metadata":   "metadata",
    "scope":      "scope",
    "document structure": "toc",
    "levels":     "toc",
    "toc":        "toc",
    "citation":   "citations",
    "citable":    "citations",
}


# ─────────────────────────────────────────────────────────────────────────────
# Data class
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CellImage:
    table_index: int
    row_index:   int
    col_index:   int
    rId:         str
    media_name:  str
    mime_type:   str
    image_bytes: bytes
    cell_text:   str = ""
    # ── NEW semantic fields ──────────────────────────────────────────────────
    section:     str = "unknown"   # "metadata" | "scope" | "toc" | "citations" | "unknown"
    field_label: str = ""          # human-readable label for the row (e.g. "Issuing Agency")

    @property
    def suggested_filename(self) -> str:
        unique_id = str(uuid.uuid4())[:8]
        base_name = f"t{self.table_index}_r{self.row_index}_c{self.col_index}_{self.media_name}"
        name, ext = os.path.splitext(base_name)
        return f"{name}_{unique_id}{ext}"


# ─────────────────────────────────────────────────────────────────────────────
# Section classification helpers
# ─────────────────────────────────────────────────────────────────────────────

def _classify_table(table, heading_hint: str) -> str:
    """
    Return the BRD section name for *table*.

    Priority:
      1. Header-row keyword match  (most reliable)
      2. heading_hint from the nearest preceding Heading paragraph
      3. "unknown"
    """
    if not table.rows:
        return heading_hint or "unknown"

    header_text = " ".join(
        c.text.lower().strip() for c in table.rows[0].cells
    )

    for section, keywords in _SECTION_FINGERPRINTS.items():
        if any(kw in header_text for kw in keywords):
            return section

    return heading_hint or "unknown"


def _heading_section(para_text: str) -> str | None:
    """
    If *para_text* matches a known section heading, return the section name.
    Returns None if no match.
    """
    lower = para_text.lower()
    for kw, section in _HEADING_SECTION_MAP.items():
        if kw in lower:
            return section
    return None


def _derive_field_label(row, img_col_index: int) -> str:
    """
    Given a table row and the column index that contains the image, return
    the best human-readable label for that row.

    Strategy:
      1. Use the leftmost non-empty cell that is NOT the image cell.
      2. Fall back to the cell immediately left of the image cell.
      3. Fall back to the image cell's own text (stripped of whitespace).
    """
    cells = row.cells
    n = len(cells)

    # Try cells to the left first (label columns are usually at col 0)
    for ci in range(n):
        if ci == img_col_index:
            continue
        text = cells[ci].text.replace("\xa0", " ").strip()
        if text and "w:drawing" not in cells[ci]._tc.xml:
            return text

    # Last resort: image cell's own text
    return cells[img_col_index].text.replace("\xa0", " ").strip()


# ─────────────────────────────────────────────────────────────────────────────
# Core extractor
# ─────────────────────────────────────────────────────────────────────────────

def extract_cell_images(doc, docx_path: str) -> list[CellImage]:
    """
    Walk every table cell in *doc*, collect cells that contain an inline
    drawing, and annotate each image with semantic section + field_label info.
    """
    print(f"[DEBUG extract_cell_images] Starting extraction from {docx_path}")

    # ── Build rId → (filename, mime) map ─────────────────────────────────────
    part = doc.part
    rId_map: dict[str, tuple[str, str]] = {}
    for rId, rel in part.rels.items():
        if "image" not in rel.reltype:
            continue
        filename = Path(rel.target_ref).name
        mime, _ = mimetypes.guess_type(filename)
        rId_map[rId] = (filename, mime or "application/octet-stream")

    print(f"[DEBUG extract_cell_images] Image relationships: {len(rId_map)}")

    # ── Read all media bytes from ZIP once ───────────────────────────────────
    zip_images: dict[str, bytes] = {}
    with zipfile.ZipFile(docx_path) as zf:
        for name in zf.namelist():
            if name.startswith("word/media/"):
                zip_images[Path(name).name] = zf.read(name)

    print(f"[DEBUG extract_cell_images] Media files in ZIP: {len(zip_images)}")

    # ── Walk document body elements to track headings between tables ─────────
    # python-docx exposes doc.element.body which contains both <w:p> and <w:tbl>
    # in document order.  We iterate that to maintain heading context.
    body = doc.element.body
    table_objs = doc.tables          # indexed list of python-docx Table objects
    table_elements = [t._element for t in table_objs]  # corresponding lxml elements

    current_heading_section = ""     # section implied by most recent heading
    table_counter = 0                # maps lxml <w:tbl> back to table_objs index

    results: list[CellImage] = []

    for child in body:
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag

        # ── Paragraph: update heading hint ───────────────────────────────────
        if tag == "p":
            style_el = child.find(
                ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pStyle"
            )
            if style_el is not None:
                style_val = style_el.get(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", ""
                )
                if style_val.lower().startswith("heading"):
                    para_text = "".join(
                        t.text or ""
                        for t in child.iter(
                            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
                        )
                    ).strip()
                    hint = _heading_section(para_text)
                    if hint:
                        current_heading_section = hint
            continue

        # ── Table ─────────────────────────────────────────────────────────────
        if tag == "tbl":
            if table_counter >= len(table_objs):
                table_counter += 1
                continue

            table = table_objs[table_counter]
            ti    = table_counter
            table_counter += 1

            section = _classify_table(table, current_heading_section)
            print(f"[DEBUG] Table {ti}: classified as '{section}'")

            for ri, row in enumerate(table.rows):
                for ci, cell in enumerate(row.cells):
                    xml = cell._tc.xml
                    if "w:drawing" not in xml:
                        continue

                    embeds = re.findall(r'r:embed="([^"]+)"', xml)
                    if not embeds:
                        continue

                    cell_text   = cell.text.strip().replace("\xa0", " ")
                    field_label = _derive_field_label(row, ci)

                    print(
                        f"[DEBUG] Image found: table={ti}, row={ri}, col={ci}, "
                        f"section={section!r}, field_label={field_label!r}"
                    )

                    for rId in embeds:
                        if rId not in rId_map:
                            continue
                        media_name, mime_type = rId_map[rId]
                        img_bytes = zip_images.get(media_name, b"")
                        if not img_bytes:
                            continue

                        results.append(CellImage(
                            table_index=ti,
                            row_index=ri,
                            col_index=ci,
                            rId=rId,
                            media_name=media_name,
                            mime_type=mime_type,
                            image_bytes=img_bytes,
                            cell_text=cell_text,
                            section=section,
                            field_label=field_label,
                        ))

    print(f"[DEBUG extract_cell_images] Total images found: {len(results)}")
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Main function for process.py — returns base64 encoded image records
# ─────────────────────────────────────────────────────────────────────────────

def extract_and_store_images(
    doc,
    docx_path: str,
    brd_id: str,
) -> list[dict]:
    """
    Extract images and return records with base64 encoded image data.
    These records will be sent to Node.js for database storage.

    Each record shape:
    {
        "tableIndex":  int,
        "rowIndex":    int,
        "colIndex":    int,
        "rid":         str,
        "mediaName":   str,
        "mimeType":    str,
        "cellText":    str,   # raw text of the image cell
        "section":     str,   # "metadata" | "scope" | "toc" | "citations" | "unknown"
        "fieldLabel":  str,   # label of the row, e.g. "Issuing Agency"
        "imageData":   str,   # base64-encoded bytes
    }
    """
    print(f"[DEBUG extract_and_store_images] Starting for brd_id: {brd_id}")

    images = extract_cell_images(doc, docx_path)
    print(f"[DEBUG extract_and_store_images] Extracted {len(images)} images")

    if not images:
        return []

    image_records = []
    for img in images:
        img_base64 = base64.b64encode(img.image_bytes).decode("utf-8")

        image_records.append({
            "tableIndex": img.table_index,
            "rowIndex":   img.row_index,
            "colIndex":   img.col_index,
            "rid":        img.rId,
            "mediaName":  img.media_name,
            "mimeType":   img.mime_type,
            "cellText":   img.cell_text,
            # ── NEW ──────────────────────────────────────────────────────────
            "section":    img.section,     # which BRD section owns this image
            "fieldLabel": img.field_label, # human-readable row label
            # ─────────────────────────────────────────────────────────────────
            "imageData":  img_base64,
        })

        print(
            f"[DEBUG] {img.media_name}: {len(img.image_bytes)}B | "
            f"section={img.section!r} | field={img.field_label!r}"
        )

    print(f"[DEBUG extract_and_store_images] Created {len(image_records)} records")
    return image_records