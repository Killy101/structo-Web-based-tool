"""
pdf_chunk.py — LangChain-powered PDF chunking & XML change-detection service.

Pipeline per request
────────────────────
1. Extract text from OLD PDF  (PyMuPDF / fitz)
2. Extract text from NEW PDF  (PyMuPDF / fitz)
3. Chunk BOTH with LangChain RecursiveCharacterTextSplitter
4. Chunk the XML file with the existing xml_compare.chunk_xml helper
5. Align NEW-PDF chunks ↔ XML chunks by position index
6. Detect changes: compare each NEW-PDF chunk against its OLD-PDF counterpart
7. Return structured result consumed by ChunkPanel.tsx

Dependencies
────────────
    pip install pymupdf langchain langchain-text-splitters

The XML chunking still relies on src.services.xml_compare so the existing
tag/attribute filtering is preserved.
"""

from __future__ import annotations

import io
from typing import Optional, Any

import fitz  # PyMuPDF

from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.services.xml_compare import chunk_xml


# ── PDF helpers ────────────────────────────────────────────────────────────────

def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Return full plain-text from a PDF file (bytes)."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages: list[str] = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()
    return "\n".join(pages)


def _langchain_chunks(
    text: str,
    chunk_size: int = 1500,
    chunk_overlap: int = 150,
) -> list[str]:
    """
    Split plain text into chunks using LangChain's
    RecursiveCharacterTextSplitter (avoids mid-sentence splits).
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return splitter.split_text(text)


# ── Change detection ───────────────────────────────────────────────────────────

def _texts_differ(old: str, new: str) -> bool:
    """
    Normalise whitespace then compare.  Returns True if content changed.
    """
    norm = lambda s: " ".join(s.split()).lower()
    return norm(old) != norm(new)


# ── Public API ─────────────────────────────────────────────────────────────────

def chunk_pdfs_and_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_content: str,
    tag_name: str,
    attribute: Optional[str] = None,
    value: Optional[str] = None,
    max_file_size: Optional[int] = None,
    chunk_size: int = 1500,
    chunk_overlap: int = 150,
) -> dict[str, Any]:
    """
    Full chunking pipeline.

    Returns
    -------
    {
        "pdf_chunks": [
            {
                "index": 1,
                "label": "chunk01",
                "old_text": "…",
                "new_text": "…",
                "has_changes": bool,
                "xml_content": "…",   # matched XML chunk (or "" if none)
                "xml_tag": "…",
                "xml_attributes": {…},
                "xml_size": int,
            },
            …
        ],
        "summary": {
            "total":    int,
            "changed":  int,
            "unchanged":int,
        },
        "old_pdf_chunk_count": int,
        "new_pdf_chunk_count": int,
        "xml_chunk_count":     int,
    }
    """
    # 1 & 2 — extract text
    old_text = _extract_pdf_text(old_pdf_bytes)
    new_text = _extract_pdf_text(new_pdf_bytes)

    # 3 — LangChain split
    old_chunks = _langchain_chunks(old_text, chunk_size, chunk_overlap)
    new_chunks = _langchain_chunks(new_text, chunk_size, chunk_overlap)

    # 4 — XML chunks
    xml_chunks = chunk_xml(
        xml_content=xml_content,
        tag_name=tag_name,
        attribute=attribute,
        value=value,
        max_file_size=max_file_size,
    )

    # 5 & 6 — align by index, detect changes
    total = max(len(new_chunks), len(xml_chunks))
    result_chunks: list[dict[str, Any]] = []

    for i in range(total):
        new_text_chunk = new_chunks[i] if i < len(new_chunks) else ""
        old_text_chunk = old_chunks[i] if i < len(old_chunks) else ""
        xml_chunk      = xml_chunks[i] if i < len(xml_chunks)  else None

        has_changes = _texts_differ(old_text_chunk, new_text_chunk)

        label = f"chunk{str(i + 1).zfill(2)}"

        result_chunks.append({
            "index":          i + 1,
            "label":          label,
            "old_text":       old_text_chunk,
            "new_text":       new_text_chunk,
            "has_changes":    has_changes,
            "xml_content":    xml_chunk["content"]    if xml_chunk else "",
            "xml_tag":        xml_chunk["tag"]        if xml_chunk else "",
            "xml_attributes": xml_chunk["attributes"] if xml_chunk else {},
            "xml_size":       xml_chunk["size"]       if xml_chunk else 0,
        })

    changed   = sum(1 for c in result_chunks if c["has_changes"])
    unchanged = len(result_chunks) - changed

    return {
        "pdf_chunks": result_chunks,
        "summary": {
            "total":     len(result_chunks),
            "changed":   changed,
            "unchanged": unchanged,
        },
        "old_pdf_chunk_count": len(old_chunks),
        "new_pdf_chunk_count": len(new_chunks),
        "xml_chunk_count":     len(xml_chunks),
    }


# ── PDF Compare / Merge helpers ────────────────────────────────────────────────

def _text_to_xml(text: str) -> str:
    """
    Wrap plain extracted PDF text into a simple XML document so it can be
    processed by compare_xml / merge_xml.  Each non-empty paragraph becomes a
    <paragraph> element.
    """
    import html as _html

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text.strip()] if text.strip() else ["(empty)"]

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<document>"]
    for i, para in enumerate(paragraphs):
        escaped = _html.escape(para)
        lines.append(f'  <paragraph index="{i}">{escaped}</paragraph>')
    lines.append("</document>")
    return "\n".join(lines)


def compare_pdfs_with_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes,
) -> dict:
    """
    Extract text from two PDF files, run a structural + line-level diff, and
    include the raw XML file for sidebar reference.

    Returns a dict matching the /compare/diff JSON contract:
      {
        "diff":         { additions, removals, modifications, mismatches, summary },
        "line_diff":    [ … ],
        "xml_content":  str,   # raw XML for reference display
      }
    """
    from src.services.xml_compare import compare_xml, line_diff as xml_line_diff

    old_text = _extract_pdf_text(old_pdf_bytes)
    new_text = _extract_pdf_text(new_pdf_bytes)

    # Line-level diff on raw extracted text
    lines = xml_line_diff(old_text, new_text)

    # Structural diff by wrapping paragraphs in XML
    old_xml = _text_to_xml(old_text)
    new_xml = _text_to_xml(new_text)
    diff = compare_xml(old_xml, new_xml)

    xml_content = ""
    try:
        xml_content = xml_bytes.decode("utf-8")
    except Exception:
        pass

    return {
        "diff": diff,
        "line_diff": lines,
        "xml_content": xml_content,
    }


def merge_pdfs_with_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes,
    accept: list,
    reject: list,
) -> str:
    """
    Merge the PDF-derived XML representations based on accept/reject decisions.
    The supplied XML file is used as an initial reference; the merge result is
    the paragraph-level XML derived from the two PDFs with changes applied.

    Returns a merged XML string.
    """
    from src.services.xml_compare import merge_xml

    old_text = _extract_pdf_text(old_pdf_bytes)
    new_text = _extract_pdf_text(new_pdf_bytes)

    old_xml = _text_to_xml(old_text)
    new_xml = _text_to_xml(new_text)

    return merge_xml(old_xml, new_xml, accept, reject)