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
    """Extract the first URL from a cell — checks XML hyperlinks first, then regex."""
    for rel in cell.part.rels.values():
        if "hyperlink" in rel.reltype:
            url = rel._target
            if url and url.startswith("http"):
                return url.strip()
    url_re = re.compile(r"https?://[^\s\)\]」）]+")
    text = cell.text.strip()
    m = url_re.search(text)
    if m:
        return m.group(0).rstrip(".,;")
    return text.split("\n")[0].strip()