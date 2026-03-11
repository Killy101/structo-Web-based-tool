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
import logging
import re
from typing import Optional, Any

import fitz  # PyMuPDF

from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.services.xml_compare import chunk_xml

logger = logging.getLogger(__name__)


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


def _sanitize_source_name(name: str) -> str:
    """Sanitize source name for use in filenames."""
    # Remove or replace invalid filename chars
    sanitized = re.sub(r'[^\w\-]', '_', name)
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized.strip('_') or 'Document'


def _build_xml_chunk_filename(source_name: str, index: int) -> str:
    """
    Generate XML chunk filename in the format:
    SourceName_innod.NNNNN.xml
    """
    safe = _sanitize_source_name(source_name)
    return f"{safe}_innod.{str(index).zfill(5)}.xml"


def _build_xml_chunk_content(
    source_name: str,
    chunk_index: int,
    new_text: str,
    old_text: str,
    xml_content: str,
    has_changes: bool,
) -> str:
    """
    Generate a complete XML chunk file content wrapping the XML chunk
    with metadata about detected changes.
    """
    import html as _html
    safe_name = _sanitize_source_name(source_name)
    chunk_num = str(chunk_index).zfill(5)

    if xml_content.strip():
        # Use existing XML chunk content as the base
        body = xml_content.strip()
    else:
        # Generate XML from new PDF text
        paragraphs = [p.strip() for p in new_text.split('\n\n') if p.strip()]
        if not paragraphs:
            paragraphs = [new_text.strip()] if new_text.strip() else []
        paras_xml = '\n'.join(
            f'  <paragraph index="{i}">{_html.escape(p)}</paragraph>'
            for i, p in enumerate(paragraphs)
        )
        body = f'<content>\n{paras_xml}\n</content>'

    status = 'changed' if has_changes else 'unchanged'
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<!-- Chunk: {safe_name}_innod.{chunk_num}.xml -->\n'
        f'<!-- Source: {_html.escape(source_name)} -->\n'
        f'<!-- Status: {status} -->\n'
        f'{body}\n'
    )


# ── Public API ─────────────────────────────────────────────────────────────────

def chunk_pdfs_and_xml(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_content: str,
    tag_name: str,
    source_name: str = "Document",
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
                "filename": "SourceName_innod.00001.xml",
                "old_text": "…",
                "new_text": "…",
                "has_changes": bool,
                "xml_content": "…",   # matched XML chunk (or "" if none)
                "xml_chunk_file": "…", # full XML chunk file content
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
        "source_name":         str,
        "folder_structure": {
            "base": "Documents/Innodata/<source>",
            "chunked": "Documents/Innodata/<source>/CHUNKED",
            "compare": "Documents/Innodata/<source>/COMPARE",
            "merge":   "Documents/Innodata/<source>/MERGE",
        }
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
    total = max(len(new_chunks), len(xml_chunks), 1)
    result_chunks: list[dict[str, Any]] = []

    safe_source = _sanitize_source_name(source_name)

    for i in range(total):
        new_text_chunk = new_chunks[i] if i < len(new_chunks) else ""
        old_text_chunk = old_chunks[i] if i < len(old_chunks) else ""
        xml_chunk      = xml_chunks[i] if i < len(xml_chunks)  else None

        has_changes = _texts_differ(old_text_chunk, new_text_chunk)

        label = f"chunk{str(i + 1).zfill(2)}"
        chunk_index = i + 1
        filename = _build_xml_chunk_filename(source_name, chunk_index)
        xml_chunk_content = xml_chunk["content"] if xml_chunk else ""

        # Generate full XML chunk file content
        xml_chunk_file = _build_xml_chunk_content(
            source_name=source_name,
            chunk_index=chunk_index,
            new_text=new_text_chunk,
            old_text=old_text_chunk,
            xml_content=xml_chunk_content,
            has_changes=has_changes,
        )

        result_chunks.append({
            "index":          chunk_index,
            "label":          label,
            "filename":       filename,
            "old_text":       old_text_chunk,
            "new_text":       new_text_chunk,
            "has_changes":    has_changes,
            "xml_content":    xml_chunk_content,
            "xml_chunk_file": xml_chunk_file,
            "xml_tag":        xml_chunk["tag"]        if xml_chunk else "",
            "xml_attributes": xml_chunk["attributes"] if xml_chunk else {},
            "xml_size":       xml_chunk["size"]       if xml_chunk else 0,
        })

    changed   = sum(1 for c in result_chunks if c["has_changes"])
    unchanged = len(result_chunks) - changed

    folder_base = f"Documents/Innodata/{safe_source}"

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
        "source_name":         source_name,
        "folder_structure": {
            "base":    folder_base,
            "chunked": f"{folder_base}/CHUNKED",
            "compare": f"{folder_base}/COMPARE",
            "merge":   f"{folder_base}/MERGE",
        },
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


# ── Span-level PDF change detection ────────────────────────────────────────────

def _extract_pdf_spans(pdf_bytes: bytes) -> list[dict]:
    """
    Extract every text span from a PDF with its font / colour metadata.

    Returned span fields
    ────────────────────
    text          : str   – raw span text
    text_norm     : str   – normalised (lower-cased, collapsed whitespace)
    bold          : bool
    italic        : bool
    underline     : bool  – detected from PDF Underline annotations
    strikethrough : bool  – detected from PDF StrikeOut annotations
    color         : int   – RGB packed as int (0 = black)
    is_colored    : bool  – True when the colour is neither black nor white
    size          : float – font size rounded to 1 dp
    page          : int   – 1-based page number
    bbox          : list  – [x0, y0, x1, y1]
    """
    spans: list[dict] = []
    page_count = 0
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        for page_num, page in enumerate(doc):
            # Collect underline / strikethrough annotation rects for this page
            underline_rects: list = []
            strikeout_rects: list = []
            try:
                for annot in page.annots():
                    atype = annot.type[1] if annot.type else ""
                    if atype == "Underline":
                        underline_rects.append(annot.rect)
                    elif atype in ("StrikeOut", "StrikeThrough"):
                        strikeout_rects.append(annot.rect)
            except Exception:
                pass

            def _bbox_overlaps(bbox: list, rects: list) -> bool:
                for r in rects:
                    if bbox[0] < r.x1 and bbox[2] > r.x0 and bbox[1] < r.y1 and bbox[3] > r.y0:
                        return True
                return False

            try:
                raw = page.get_text("rawdict", flags=0)
                for block in raw.get("blocks", []):
                    if block.get("type") != 0:        # 0 = text block
                        continue
                    for line in block.get("lines", []):
                        raw_spans = line.get("spans", [])
                        if not raw_spans:
                            continue

                        # Detect character-level PDF encoding: if most spans are
                        # 1 character wide, merge them into a single line span so
                        # the SequenceMatcher gets meaningful units to compare.
                        nonempty = [s for s in raw_spans if s.get("text", "").strip()]
                        char_level = nonempty and (
                            sum(len(s.get("text", "").strip()) for s in nonempty) / len(nonempty) < 2
                        )

                        if char_level:
                            # Merge all spans in this line into one synthetic span,
                            # inheriting formatting from the first non-empty span.
                            merged_text = "".join(s.get("text", "") for s in raw_spans)
                            merged_stripped = merged_text.strip()
                            if not merged_stripped:
                                continue
                            first = nonempty[0]
                            f = first.get("flags", 0)
                            c = first.get("color", 0)
                            bbox = list(first.get("bbox", [0, 0, 0, 0]))
                            spans.append({
                                "text":          merged_text,
                                "text_norm":     " ".join(merged_stripped.split()).lower(),
                                "bold":          bool(f & 0x10),
                                "italic":        bool(f & 0x02),
                                "underline":     _bbox_overlaps(bbox, underline_rects),
                                "strikethrough": _bbox_overlaps(bbox, strikeout_rects),
                                "color":         c,
                                "is_colored":    c not in (0, 16777215),
                                "size":          round(first.get("size", 12), 1),
                                "page":          page_num + 1,
                                "bbox":          bbox,
                            })
                        else:
                            for span in raw_spans:
                                text = span.get("text", "")
                                stripped = text.strip()
                                if not stripped:
                                    continue
                                flags  = span.get("flags", 0)
                                color  = span.get("color", 0)
                                bbox   = list(span.get("bbox", [0, 0, 0, 0]))
                                spans.append({
                                    "text":          text,
                                    "text_norm":     " ".join(stripped.split()).lower(),
                                    "bold":          bool(flags & 0x10),
                                    "italic":        bool(flags & 0x02),
                                    "underline":     _bbox_overlaps(bbox, underline_rects),
                                    "strikethrough": _bbox_overlaps(bbox, strikeout_rects),
                                    "color":         color,
                                    "is_colored":    color not in (0, 16777215),  # not black/white
                                    "size":          round(span.get("size", 12), 1),
                                    "page":          page_num + 1,
                                    "bbox":          bbox,
                                })
            except Exception:
                # Fallback: plain text extraction when rawdict fails for this page
                try:
                    plain = page.get_text("text") or ""
                    for line in plain.splitlines():
                        stripped = line.strip()
                        if not stripped:
                            continue
                        spans.append({
                            "text":          stripped,
                            "text_norm":     " ".join(stripped.split()).lower(),
                            "bold":          False,
                            "italic":        False,
                            "underline":     False,
                            "strikethrough": False,
                            "color":         0,
                            "is_colored":    False,
                            "size":          12.0,
                            "page":          page_num + 1,
                            "bbox":          [0, 0, 0, 0],
                        })
                except Exception:
                    pass
        doc.close()
    except Exception as exc:
        logger.warning("PDF span extraction failed: %s", exc)
    logger.debug("Extracted %d spans from PDF (%d pages)", len(spans), page_count)
    return spans


def _parse_xml_tree(xml_content: str):
    """
    Parse xml_content into an ElementTree root, returning None on any error.
    Shared by _find_xml_path_for_text and callers that want to avoid re-parsing.
    """
    from xml.etree import ElementTree as ET
    if not xml_content or not xml_content.strip():
        return None
    try:
        return ET.fromstring(xml_content)
    except Exception:
        return None


def _find_xml_path_for_text(
    xml_content: str,
    search: str,
    *,
    _root=None,  # pre-parsed root; avoids re-parsing for every call
) -> str | None:
    """
    Return the XPath-like path of the deepest XML element whose concatenated
    text content best matches *search* (case-insensitive, fuzzy).
    Uses SequenceMatcher to handle whitespace/line-break differences.
    Returns None when no acceptable match is found or the XML is invalid.
    """
    import difflib

    if not search:
        return None
    needle = " ".join(search.split()).lower()
    # Skip very short tokens — too noisy for path mapping
    if not needle or len(needle) < 3:
        return None

    root = _root if _root is not None else _parse_xml_tree(xml_content)
    if root is None:
        return None

    best_path: str | None = None
    best_score: float = 0.0
    _MAX_DEPTH = 200  # guard against pathological deeply-nested XML

    def _visit(elem, path: str, depth: int) -> None:
        nonlocal best_path, best_score
        if depth > _MAX_DEPTH:
            return
        try:
            full = " ".join(("".join(elem.itertext())).split()).lower()
        except Exception:
            return
        if not full:
            return
        # Substring match gives a guaranteed score boost
        if needle in full:
            ratio = 1.0 - (len(full) - len(needle)) / max(len(full), 1) * 0.3
        else:
            ratio = difflib.SequenceMatcher(None, needle, full).ratio()
        # Prefer deeper (more specific) elements, break ties in favour of children
        if ratio > best_score and ratio > 0.35:
            best_score = ratio
            best_path = path
        for idx, child in enumerate(elem):
            try:
                tag = child.tag if isinstance(child.tag, str) else "node"
            except Exception:
                tag = "node"
            _visit(child, f"{path}/{tag}[{idx}]", depth + 1)

    _visit(root, f"/{root.tag}", 0)
    return best_path


def _emphasis_tag(span: dict) -> str | None:
    """
    Return a suggested XML emphasis fragment for the given span.

    Maps PDF formatting to standard XML emphasis tags:
      bold          → <b>
      italic        → <i>
      underline     → <u>
      strikethrough → <s>
      colored       → <em>  (only when no other tag applies)
    """
    tags: list[str] = []
    if span.get("bold"):
        tags.append("b")
    if span.get("italic"):
        tags.append("i")
    if span.get("underline"):
        tags.append("u")
    if span.get("strikethrough"):
        tags.append("s")
    if span.get("is_colored") and not tags:
        tags.append("em")
    if not tags:
        return None
    text   = span.get("text", "…").strip()
    open_  = "".join(f"<{t}>" for t in tags)
    close_ = "".join(f"</{t}>" for t in reversed(tags))
    return f"{open_}{text}{close_}"


def detect_pdf_changes(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_bytes: bytes,
) -> dict:
    """
    Compare OLD and NEW PDFs at the span level and map each difference to its
    nearest XML element path.

    Change types
    ────────────
    addition    – span present only in NEW
    removal     – span present only in OLD
    modification – span text changed (replace ratio > 0.3)
    emphasis    – same text but bold / italic / colour differs
    mismatch    – structural reordering / significant divergence

    Returns
    ───────
    {
        "changes":     list[dict],
        "xml_content": str,
        "summary":     { addition, removal, modification, emphasis, mismatch },
    }
    """
    import difflib

    old_spans   = _extract_pdf_spans(old_pdf_bytes)
    new_spans   = _extract_pdf_spans(new_pdf_bytes)
    xml_content = ""
    try:
        xml_content = xml_bytes.decode("utf-8")
    except Exception:
        pass

    logger.debug("detect_pdf_changes: old=%d spans, new=%d spans", len(old_spans), len(new_spans))

    # Parse the XML tree ONCE — reused by every _make call to avoid O(n) re-parsing
    xml_root = _parse_xml_tree(xml_content) if xml_content else None

    old_norms = [s["text_norm"] for s in old_spans]
    new_norms = [s["text_norm"] for s in new_spans]

    matcher = difflib.SequenceMatcher(None, old_norms, new_norms, autojunk=False)
    changes: list[dict] = []
    cid     = 0
    summary: dict[str, int] = {
        "addition": 0, "removal": 0,
        "modification": 0, "emphasis": 0, "mismatch": 0,
    }

    def _make(ctype: str, text: str, os_, ns_, page: int) -> dict:
        nonlocal cid
        cid += 1
        xml_path = (
            _find_xml_path_for_text(xml_content, text, _root=xml_root)
            if xml_content else None
        )
        fmt_old = (
            {
                "bold":          os_["bold"],
                "italic":        os_["italic"],
                "underline":     os_.get("underline", False),
                "strikethrough": os_.get("strikethrough", False),
                "color":         os_["color"],
            }
            if os_ else None
        )
        fmt_new = (
            {
                "bold":          ns_["bold"],
                "italic":        ns_["italic"],
                "underline":     ns_.get("underline", False),
                "strikethrough": ns_.get("strikethrough", False),
                "color":         ns_["color"],
                "is_colored":    ns_["is_colored"],
            }
            if ns_ else None
        )
        # Build emphasis list for the response
        emphasis: list[str] = []
        if ns_:
            if ns_["bold"]:                  emphasis.append("bold")
            if ns_["italic"]:                emphasis.append("italic")
            if ns_.get("underline"):         emphasis.append("underline")
            if ns_.get("strikethrough"):     emphasis.append("strikethrough")
            if ns_["is_colored"] and not emphasis:  emphasis.append("color")

        # Build suggested XML replacement with proper diff markup
        if ctype in ("modification", "mismatch"):
            os_text = os_["text"].strip() if os_ else None
            ns_text = ns_["text"].strip() if ns_ else None
            if os_text and ns_text:
                sug = f"<del>{os_text}</del><ins>{ns_text}</ins>"
            elif ns_text:
                sug = f"<ins>{ns_text}</ins>"
            else:
                sug = None
        elif ctype == "removal":
            sug = f"<del>{text}</del>"
        elif ctype == "emphasis":
            sug = _emphasis_tag(ns_) if ns_ else None
        elif ctype == "addition":
            ns_text = ns_["text"].strip() if ns_ else None
            if ns_ and (ns_["bold"] or ns_["italic"] or ns_.get("underline")
                        or ns_.get("strikethrough") or ns_["is_colored"]):
                base = _emphasis_tag(ns_)
                sug = f"<ins>{base}</ins>" if base else (f"<ins>{ns_text}</ins>" if ns_text else None)
            else:
                sug = f"<ins>{ns_text}</ins>" if ns_text else None
        else:
            sug = None
        return {
            "id":             f"chg_{cid:03d}",
            "type":           ctype,
            "text":           text,
            "old_text":       os_["text"].strip() if os_ else None,
            "new_text":       ns_["text"].strip() if ns_ else None,
            "old_formatting": fmt_old,
            "new_formatting": fmt_new,
            "emphasis":       emphasis,
            "xml_path":       xml_path,
            "page":           page,
            "suggested_xml":  sug,
        }

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            # Same text — check for formatting (emphasis) changes
            for k in range(i2 - i1):
                os_, ns_ = old_spans[i1 + k], new_spans[j1 + k]
                if (os_["bold"]               != ns_["bold"] or
                        os_["italic"]             != ns_["italic"] or
                        os_.get("underline")      != ns_.get("underline") or
                        os_.get("strikethrough")  != ns_.get("strikethrough") or
                        os_["color"]              != ns_["color"]):
                    changes.append(_make("emphasis", ns_["text"].strip(), os_, ns_, ns_["page"]))
                    summary["emphasis"] += 1

        elif op == "insert":
            for k in range(j1, j2):
                s = new_spans[k]
                changes.append(_make("addition", s["text"].strip(), None, s, s["page"]))
                summary["addition"] += 1

        elif op == "delete":
            for k in range(i1, i2):
                s = old_spans[k]
                changes.append(_make("removal", s["text"].strip(), s, None, s["page"]))
                summary["removal"] += 1

        elif op == "replace":
            old_c = old_spans[i1:i2]
            new_c = new_spans[j1:j2]
            ot    = " ".join(s["text_norm"] for s in old_c)
            nt    = " ".join(s["text_norm"] for s in new_c)
            ratio = difflib.SequenceMatcher(None, ot, nt).ratio()
            # Use 0.5 threshold: above = modification (similar text), below = mismatch (structural)
            ctype = "modification" if ratio > 0.5 else "mismatch"
            for k in range(max(len(old_c), len(new_c))):
                os_ = old_c[k] if k < len(old_c) else None
                ns_ = new_c[k] if k < len(new_c) else None
                pivot = ns_ or os_
                changes.append(_make(ctype, pivot["text"].strip(), os_, ns_, pivot["page"]))
                summary[ctype] += 1

    logger.debug("detect_pdf_changes: %d changes detected: %s", len(changes), summary)
    return {"changes": changes, "xml_content": xml_content, "summary": summary}


# ── XML Validation ─────────────────────────────────────────────────────────────

def validate_xml_chunk(xml_content: str) -> dict:
    """
    Validate an XML chunk for structure, required tags, and syntax.
    Returns { valid: bool, errors: list[str], warnings: list[str] }
    """
    from xml.etree import ElementTree as ET

    errors: list[str] = []
    warnings: list[str] = []

    if not xml_content.strip():
        errors.append("XML content is empty")
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Check syntax
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as exc:
        errors.append(f"XML syntax error: {exc}")
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Check for missing text content
    all_text = "".join(root.itertext()).strip()
    if not all_text:
        warnings.append("XML has no text content")

    # Check for elements missing closing tags (already caught by ParseError, but warn about unusual structures)
    def check_elem(elem: ET.Element, depth: int = 0):
        if depth > 50:
            warnings.append("XML structure is deeply nested (>50 levels)")
            return
        for child in elem:
            check_elem(child, depth + 1)

    check_elem(root)

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


# ── Merge XML chunks ───────────────────────────────────────────────────────────

def merge_xml_chunks(
    chunks: list[dict],
    source_name: str = "Document",
) -> str:
    """
    Merge multiple XML chunks into a single final XML file.

    Parameters
    ----------
    chunks : list of dicts with keys:
        filename  : str  – chunk filename
        xml_content : str  – XML content of the chunk
        has_changes : bool
    source_name : str

    Returns
    -------
    str – merged XML string
    """
    import html as _html
    from xml.etree import ElementTree as ET

    safe_name = _sanitize_source_name(source_name)
    merged_parts: list[str] = []
    missing: list[int] = []

    for i, chunk in enumerate(chunks):
        xml_c = chunk.get("xml_content", "").strip()
        if not xml_c:
            missing.append(i + 1)
            continue

        # Try to parse and extract the inner body
        try:
            root = ET.fromstring(xml_c)
            # Skip XML declaration wrapper if present
            inner = ET.tostring(root, encoding="unicode")
            merged_parts.append(f'  <!-- chunk {i + 1}: {chunk.get("filename", "")} -->\n  {inner}')
        except ET.ParseError:
            # Use raw content if parsing fails
            merged_parts.append(f'  <!-- chunk {i + 1}: {chunk.get("filename", "")} -->\n  {xml_c}')

    missing_comment = ""
    if missing:
        missing_comment = f'  <!-- WARNING: Missing chunks: {missing} -->\n'

    body = "\n".join(merged_parts)
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<!-- Merged: {_html.escape(source_name)}_final.xml -->\n'
        f'<!-- Total chunks: {len(chunks)} | Missing: {len(missing)} -->\n'
        f'<document source="{_html.escape(source_name)}">\n'
        f'{missing_comment}'
        f'{body}\n'
        f'</document>\n'
    )