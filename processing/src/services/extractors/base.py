"""
src/services/extractors/base.py
Shared helper functions used by all individual extractors.
"""

import re


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
    target_level = None
    texts = []
    for para in iter_paragraphs(doc):
        lvl = heading_level(para)
        text = para_text(para)
        if lvl is not None:
            if heading_text.lower() in text.lower():
                collecting = True
                target_level = lvl
                continue
            if collecting and lvl <= target_level:
                break
        if collecting and text:
            texts.append(text)
    return texts


def extract_url_from_cell(cell) -> str:
    """Extract the most complete URL from a cell using hyperlink targets + text URLs."""
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

    url_re = re.compile(r"https?://[^\s\)\]」）]+")
    text = cell.text.strip()
    for match in url_re.finditer(text):
        candidates.append(match.group(0).rstrip(".,;"))

    if candidates:
        def rank(url: str) -> tuple[int, int, int]:
            path_depth = url.count("/")
            has_query_or_fragment = int("?" in url or "#" in url)
            return (path_depth, has_query_or_fragment, len(url))

        return max(candidates, key=rank)

    return text.strip()