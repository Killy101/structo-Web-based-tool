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
import html as html_lib
import mimetypes
import os
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import unquote, urlparse

from lxml import html as lxml_html


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
# MIME type helpers
# ─────────────────────────────────────────────────────────────────────────────

# Supplementary MIME map for formats Python's mimetypes may not know.
_EXTRA_MIME: dict[str, str] = {
    ".emf":  "image/x-emf",
    ".wmf":  "image/x-wmf",
    ".tif":  "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
}

# Only these MIME types can be rendered by modern browsers as <img> elements.
# EMF/WMF are vector formats that browsers cannot display; storing them
# wastes DB space and causes silent failures in the frontend.
_BROWSER_RENDERABLE: frozenset[str] = frozenset({
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/svg+xml",
    "image/tiff",
    "image/avif",
})


def _resolve_mime(filename: str) -> str | None:
    """
    Return the MIME type for *filename*, or None if the image cannot be
    rendered in a browser.  Falls back to the extra map when the standard
    mimetypes library returns nothing.
    """
    mime, _ = mimetypes.guess_type(filename)
    if not mime:
        ext = os.path.splitext(filename)[1].lower()
        mime = _EXTRA_MIME.get(ext)
    if not mime:
        return None
    return mime if mime in _BROWSER_RENDERABLE else None


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
    # Only include image relationships whose MIME type can be rendered by
    # a browser.  EMF/WMF and other vector-only formats are skipped so they
    # are never stored in the database or served to the frontend.
    part = doc.part
    rId_map: dict[str, tuple[str, str]] = {}
    for rId, rel in part.rels.items():
        if "image" not in rel.reltype:
            continue
        filename = Path(rel.target_ref).name
        mime = _resolve_mime(filename)
        if mime is None:
            print(f"[DEBUG] Skipping non-browser-renderable image: {filename}")
            continue
        rId_map[rId] = (filename, mime)

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


def _decode_mhtml_payload(payload: bytes | bytearray | str | None, charset: str | None = None) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload

    raw = bytes(payload)
    normalized = (charset or "").strip().lower()
    alias_map = {
        "unicode": "utf-16le",
        "utf16": "utf-16",
        "utf16le": "utf-16le",
        "utf16be": "utf-16be",
    }

    candidates: list[str] = []
    if normalized:
        candidates.append(alias_map.get(normalized, normalized))
    if b"\x00" in raw:
        candidates.extend(["utf-16", "utf-16le", "utf-16be"])
    candidates.extend(["utf-8", "latin-1"])

    seen: set[str] = set()
    for encoding in candidates:
        if not encoding or encoding in seen:
            continue
        seen.add(encoding)
        try:
            text = raw.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
        if text.strip("\x00\r\n\t "):
            return text

    return raw.decode("utf-8", errors="replace")


def _coerce_mhtml_payload(payload: object) -> bytes | str | None:
    if payload is None or isinstance(payload, (bytes, bytearray, str)):
        return payload

    as_bytes = getattr(payload, "as_bytes", None)
    if callable(as_bytes):
        try:
            candidate = as_bytes()
            if isinstance(candidate, (bytes, bytearray, str)):
                return candidate
            return str(candidate)
        except Exception:
            pass

    as_string = getattr(payload, "as_string", None)
    if callable(as_string):
        try:
            candidate = as_string()
            if isinstance(candidate, (bytes, bytearray, str)):
                return candidate
            return str(candidate)
        except Exception:   
            pass

    return str(payload)


def _coerce_mhtml_bytes(payload: object) -> bytes | None:
    coerced = _coerce_mhtml_payload(payload)
    if coerced is None:
        return None
    if isinstance(coerced, str):
        return coerced.encode("utf-8", errors="replace")
    return bytes(coerced)


def _render_html_fragment(fragment) -> str:
    rendered = lxml_html.tostring(fragment, encoding="unicode")
    if isinstance(rendered, (bytes, bytearray, memoryview)):
        return bytes(rendered).decode("utf-8", errors="replace")
    return str(rendered or "")


def _extract_mhtml_html_and_assets(path: str) -> tuple[str, dict[str, tuple[bytes, str, str]]]:
    with open(path, "rb") as f:
        raw = f.read()

    message = BytesParser(policy=policy.default).parsebytes(raw)
    html_parts: list[str] = []
    assets: dict[str, tuple[bytes, str, str]] = {}

    def _register_asset(key: str, payload: bytes, mime_type: str, media_name: str) -> None:
        normalized = (key or "").strip().strip("<>")
        if not normalized:
            return
        assets[normalized] = (payload, mime_type, media_name)
        basename = Path(unquote(urlparse(normalized).path or normalized)).name
        if basename:
            assets[basename] = (payload, mime_type, media_name)
            assets[unquote(basename)] = (payload, mime_type, media_name)

    for part in message.walk() if message.is_multipart() else [message]:
        content_type = part.get_content_type()
        if content_type == "text/html":
            payload = _coerce_mhtml_payload(part.get_payload(decode=True))
            html_text = _decode_mhtml_payload(payload, part.get_content_charset())
            if html_text.strip():
                html_parts.append(html_text)
            continue

        payload_bytes = _coerce_mhtml_bytes(part.get_payload(decode=True))
        if not payload_bytes:
            continue

        location = (part.get("Content-Location") or part.get("Content-ID") or part.get_filename() or "").strip()
        if not location:
            continue

        mime_type = content_type or mimetypes.guess_type(location)[0] or "application/octet-stream"
        parsed_name = Path(unquote(urlparse(location).path or location)).name or Path(location).name or "image"
        ext = Path(parsed_name).suffix
        if not ext:
            guessed_ext = mimetypes.guess_extension(mime_type) or ""
            parsed_name = f"{parsed_name}{guessed_ext}"

        _register_asset(location, payload_bytes, mime_type, parsed_name)
        stripped = location.strip("<>")
        if stripped.lower().startswith("cid:"):
            _register_asset(stripped[4:], payload_bytes, mime_type, parsed_name)

    return "\n".join(html_parts), assets


def _strip_html_text(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment or "")
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _classify_html_table(table_el, heading_hint: str) -> str:
    rows = table_el.xpath(".//tr")
    if not rows:
        return heading_hint or "unknown"

    header_cells = rows[0].xpath("./th|./td")
    header_text = " ".join(_strip_html_text(_render_html_fragment(cell)).lower() for cell in header_cells)
    for section, keywords in _SECTION_FINGERPRINTS.items():
        if any(kw in header_text for kw in keywords):
            return section
    return heading_hint or "unknown"


def _derive_html_field_label(cells, img_col_index: int) -> str:
    for ci, cell in enumerate(cells):
        if ci == img_col_index:
            continue
        text = _strip_html_text(_render_html_fragment(cell))
        if text:
            return text
    return _strip_html_text(_render_html_fragment(cells[img_col_index]))


def _resolve_mhtml_asset(
    assets: dict[str, tuple[bytes, str, str]],
    *candidates: str,
) -> tuple[bytes, str, str] | None:
    tried: set[str] = set()
    for raw in candidates:
        candidate = (raw or "").strip().strip("<>")
        if not candidate:
            continue
        expanded = [candidate, unquote(candidate)]
        if candidate.lower().startswith("cid:"):
            expanded.append(candidate[4:])
        parsed_name = Path(unquote(urlparse(candidate).path or candidate)).name
        if parsed_name:
            expanded.extend([parsed_name, unquote(parsed_name)])
        for key in expanded:
            if not key or key in tried:
                continue
            tried.add(key)
            if key in assets:
                return assets[key]
    return None


def _sniff_image_mime(image_bytes: bytes) -> str | None:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if image_bytes.startswith(b"BM"):
        return "image/bmp"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    prefix = image_bytes[:256].lstrip().lower()
    if prefix.startswith(b"<svg") or (prefix.startswith(b"<?xml") and b"<svg" in prefix):
        return "image/svg+xml"
    return None


def _normalise_mhtml_image_asset(
    image_bytes: bytes,
    mime_type: str,
    media_name: str,
    *hints: str,
) -> tuple[str, str]:
    normalized_mime = (mime_type or "").strip().lower()
    hint_values = [hint for hint in hints if hint]

    def _guess_from_hint(hint: str) -> str | None:
        content_type_hint = hint.strip().lower()
        if content_type_hint.startswith("image/"):
            return content_type_hint
        guessed, _ = mimetypes.guess_type(hint.split("?", 1)[0])
        if guessed and guessed.startswith("image/"):
            return guessed.lower()
        return None

    if not normalized_mime.startswith("image/"):
        for hint in hint_values:
            guessed = _guess_from_hint(hint)
            if guessed:
                normalized_mime = guessed
                break

    if not normalized_mime.startswith("image/"):
        sniffed = _sniff_image_mime(image_bytes)
        if sniffed:
            normalized_mime = sniffed

    normalized_name = media_name or "image"
    current_ext = Path(normalized_name).suffix.lower()
    if (not current_ext or current_ext == ".bin") and normalized_mime.startswith("image/"):
        preferred_name = next(
            (
                Path(unquote(urlparse(hint).path or hint.split("?", 1)[0])).name
                for hint in hint_values
                if Path(unquote(urlparse(hint).path or hint.split("?", 1)[0])).name
            ),
            normalized_name,
        )
        preferred_stem = Path(preferred_name).stem or Path(normalized_name).stem or "image"
        guessed_ext = mimetypes.guess_extension(normalized_mime) or ".img"
        normalized_name = f"{preferred_stem}{guessed_ext}"

    return normalized_mime or "application/octet-stream", normalized_name


def extract_and_store_images_from_mhtml(path: str, brd_id: str) -> list[dict]:
    """Extract cell images directly from Confluence-exported MHTML `.doc` files."""
    print(f"[DEBUG extract_and_store_images_from_mhtml] Starting for brd_id: {brd_id}")

    html_text, assets = _extract_mhtml_html_and_assets(path)
    if not html_text.strip() or not assets:
        print("[DEBUG extract_and_store_images_from_mhtml] No HTML/assets found")
        return []

    try:
        root = lxml_html.fromstring(html_text)
    except Exception as exc:
        print(f"[WARN extract_and_store_images_from_mhtml] HTML parse failed: {exc}")
        return []

    body = root.find("body")
    if body is None:
        body = root
    current_heading_section = ""
    table_index = -1
    seen: set[tuple[int, int, int, str, str]] = set()
    image_records: list[dict] = []

    for el in body.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()

        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            hint = _heading_section(" ".join(el.itertext()).strip())
            if hint:
                current_heading_section = hint
            continue

        if tag != "table":
            continue

        table_index += 1
        section = _classify_html_table(el, current_heading_section)
        rows = el.xpath(".//tr")
        for ri, row in enumerate(rows):
            cells = row.xpath("./th|./td")
            for ci, cell in enumerate(cells):
                imgs = cell.xpath(".//img")
                if not imgs:
                    continue

                field_label = _derive_html_field_label(cells, ci)
                cell_text = _strip_html_text(_render_html_fragment(cell))

                for img_idx, img in enumerate(imgs):
                    src = (img.get("src") or "").strip()
                    data_src = (img.get("data-image-src") or "").strip()
                    asset = _resolve_mhtml_asset(assets, src, data_src)
                    if not asset:
                        continue

                    image_bytes, mime_type, media_name = asset
                    mime_type, media_name = _normalise_mhtml_image_asset(
                        image_bytes,
                        mime_type,
                        media_name,
                        src,
                        data_src,
                        img.get("data-linked-resource-default-alias") or "",
                        img.get("data-linked-resource-content-type") or "",
                    )
                    dedupe_key = (table_index, ri, ci, field_label, media_name)
                    if dedupe_key in seen:
                        continue
                    seen.add(dedupe_key)

                    image_records.append({
                        "tableIndex": table_index,
                        "rowIndex": ri,
                        "colIndex": ci,
                        "rid": src or data_src or f"mhtml-{table_index}-{ri}-{ci}-{img_idx}",
                        "mediaName": media_name,
                        "mimeType": mime_type,
                        "cellText": cell_text,
                        "section": section,
                        "fieldLabel": field_label,
                        "imageData": base64.b64encode(image_bytes).decode("utf-8"),
                    })

                    print(
                        f"[DEBUG extract_and_store_images_from_mhtml] image={media_name!r} "
                        f"section={section!r} field={field_label!r} row={ri} col={ci}"
                    )

    print(f"[DEBUG extract_and_store_images_from_mhtml] Created {len(image_records)} records")
    return image_records