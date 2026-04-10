"""
src/services/extractors/base.py
Shared helper functions used by all individual extractors.
"""

import re
import zipfile
import mimetypes
from pathlib import Path


def iter_paragraphs(doc):
    """Yield all paragraphs including those inside table cells."""
    for para in doc.paragraphs:
        yield para
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    yield para


def para_text(para) -> str:
    return para.text.strip()


def heading_level(para) -> int | None:
    """Return 1-9 if paragraph is a Heading style, else None."""
    style = para.style.name if para.style else ""
    m = re.match(r"Heading (\d)", style)
    return int(m.group(1)) if m else None


def section_content(doc, heading_text: str) -> list[str]:
    """Return paragraph texts under a named heading until the next same-level heading."""
    collecting = False
    target_level: int | None = None
    texts = []
    for para in iter_paragraphs(doc):
        lvl = heading_level(para)
        text = para_text(para)
        if lvl is not None:
            if heading_text.lower() in text.lower():
                collecting = True
                target_level = lvl
                continue
            if collecting and target_level is not None and lvl <= target_level:
                break
        if collecting and text:
            texts.append(text)
    return texts


_URL_RE = re.compile(r"https?://[^\s\]\[\{\}<>'\"」）]+")


def _clean_extracted_url(url: str) -> str:
    candidate = (url or "").strip()
    if not candidate:
        return ""

    while candidate and candidate[-1] in ".,;:":
        candidate = candidate[:-1]

    unmatched_pairs = {")": "(", "]": "[", "}": "{", "）": "（", "」": "「"}
    while candidate and candidate[-1] in unmatched_pairs:
        closing = candidate[-1]
        opening = unmatched_pairs[closing]
        if candidate.count(closing) > candidate.count(opening):
            candidate = candidate[:-1]
            while candidate and candidate[-1] in ".,;:":
                candidate = candidate[:-1]
            continue
        break

    return candidate


def _rank_url(url: str) -> tuple[int, int, int]:
    path_depth = url.count("/")
    has_query_or_fragment = int("?" in url or "#" in url)
    return (path_depth, has_query_or_fragment, len(url))


def extract_url_and_note_from_text(text: str, extra_candidates: list[str] | None = None) -> tuple[str, str]:
    """Return the primary URL plus any remaining descriptive text from a cell-like string."""
    raw_text = (text or "").replace("\xa0", " ").strip()
    candidates: list[str] = []
    if extra_candidates:
        candidates.extend(
            _clean_extracted_url(url) for url in extra_candidates if isinstance(url, str) and url.strip()
        )
    for match in _URL_RE.finditer(raw_text):
        cleaned_url = _clean_extracted_url(match.group(0))
        if cleaned_url:
            candidates.append(cleaned_url)

    if not candidates:
        return raw_text, ""

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate not in seen:
            seen.add(candidate)
            deduped.append(candidate)

    primary_url = max(deduped, key=_rank_url)

    note_lines: list[str] = []
    seen_lines: set[str] = set()
    for raw_line in raw_text.splitlines():
        cleaned = _URL_RE.sub("", raw_line).replace("\xa0", " ")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned and cleaned not in seen_lines:
            seen_lines.add(cleaned)
            note_lines.append(cleaned)

    return primary_url, "\n".join(note_lines)


def extract_url_and_note_from_cell(cell) -> tuple[str, str]:
    """Extract the most complete URL plus any plain descriptive text from a table cell."""
    candidates: list[str] = []

    rel_id_attr = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    for hyperlink in cell._tc.xpath('.//*[local-name()="hyperlink"]'):
        rel_id = hyperlink.get(rel_id_attr)
        if not rel_id:
            continue
        rel = cell.part.rels.get(rel_id)
        if not rel:
            continue
        url = getattr(rel, "target_ref", None) or getattr(rel, "_target", None)
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            candidates.append(url.strip())

    return extract_url_and_note_from_text(cell.text, candidates)


def extract_url_from_cell(cell) -> str:
    """Extract the primary URL from a cell using hyperlink targets + text URLs."""
    url, _ = extract_url_and_note_from_cell(cell)
    return url


# ─────────────────────────────────────────────────────────────────────────────
# Image-in-cell helpers
# ─────────────────────────────────────────────────────────────────────────────

def cell_has_image(cell) -> bool:
    """Return True if the cell contains at least one inline drawing."""
    return "w:drawing" in cell._tc.xml


def get_cell_image_rids(cell) -> list[str]:
    """
    Return all r:embed relationship IDs found in a cell's drawing elements.
    These IDs can be resolved against doc.part.rels to get the image file.
    """
    return re.findall(r'r:embed="([^"]+)"', cell._tc.xml)


def extract_image_bytes_from_docx(docx_path: str, media_name: str) -> bytes:
    """
    Read raw bytes for a single media file directly from the .docx ZIP.

    Parameters
    ----------
    docx_path  : path to the .docx file on disk
    media_name : filename inside word/media/, e.g. "image3.png"

    Returns
    -------
    Raw bytes of the image, or b"" if not found.
    """
    zip_key = f"word/media/{media_name}"
    with zipfile.ZipFile(docx_path) as zf:
        if zip_key in zf.namelist():
            return zf.read(zip_key)
    return b""


def resolve_cell_images(cell, doc_part, docx_path: str) -> list[dict]:
    """
    For a cell that contains drawings, return a list of image metadata dicts:
        { "rId", "media_name", "mime_type", "image_bytes" }

    Parameters
    ----------
    cell      : python-docx Cell
    doc_part  : doc.part  (carries .rels)
    docx_path : filesystem path to the .docx (for ZIP byte extraction)
    """
    rids = get_cell_image_rids(cell)
    if not rids:
        return []

    results = []
    for rId in rids:
        rel = doc_part.rels.get(rId)
        if not rel or "image" not in rel.reltype:
            continue
        target_ref: str = rel.target_ref          # e.g. "media/image3.png"
        media_name = Path(target_ref).name         # e.g. "image3.png"
        mime, _ = mimetypes.guess_type(media_name)
        img_bytes = extract_image_bytes_from_docx(docx_path, media_name)
        if img_bytes:
            results.append({
                "rId":         rId,
                "media_name":  media_name,
                "mime_type":   mime or "application/octet-stream",
                "image_bytes": img_bytes,
            })

    return results