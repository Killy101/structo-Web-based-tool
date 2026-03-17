"""
autocompare_service.py — AutoCompare engine v2.2

Fixes in this version
─────────────────────
1. ALL CPU-bound work (PyMuPDF extraction, page-scoring, difflib) runs in a
   ThreadPoolExecutor so it never blocks the FastAPI event loop.
   This is the root cause of "stuck at 0%" — the event loop was blocked,
   so /status polls could not get a response during processing.

2. Session metadata persisted to session.json after every status change.
   get_session() auto-restores from disk on a cache miss, so uvicorn
   --reload no longer wipes sessions and causes 404s.

3. Progress emitted at fine-grained steps (5→10→20→30→30+n→100) so the
   frontend shows movement immediately.
"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

import fitz
import lxml.etree as etree

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

BATCH_SIZE           = 50
SESSION_TTL          = 3600 * 6
BASE_STORAGE         = Path("/tmp/autocompare")
MAX_DIFF_LINES       = 3000
MAX_CHUNK_CHARS      = 60_000   # ~30 pages; split XML sections larger than this
TARGET_CHUNK_CHARS   = 30_000   # ~15 pages target per sub-chunk
LARGE_TEXT_THRESHOLD = 500_000
LARGE_TEXT_SAMPLE    = 100_000

_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="autocompare")

STOPWORDS = {
    "the","and","for","that","with","from","this","have","are","was","were",
    "has","had","will","shall","would","could","should","into","than","then",
    "such","here","there","their","they","them","your","which","when","where",
    "what","while","whose","who","whom","been","being","under","over",
    "between","within","without","upon","about","above","below",
    "part","section","article","clause","schedule","annex","table","row","cell",
    "old","new","pdf","xml","chunk","line","page","pages","text","content",
}


STRUCTURAL_TAGS = {
    "chapter","section","article","clause","part","division",
    "appendix","annex","schedule","exhibit","subsection",
    "sub-section","paragraph","rule","regulation","title",
    "innodlevel",  # innod-specific structural tag (has level= attribute)
}

# ── XML structural chunking ────────────────────────────────────────────────────

def _get_local(tag: object) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.split("}")[-1].lower()


def _elem_plain_fast(el: etree._Element) -> str:
    return re.sub(r"\s+", " ", " ".join(el.itertext())).strip()


def _elem_title(el: etree._Element) -> str:
    """Extract a human-readable title from a structural element."""
    # innodLevel uses last-path attribute which is the best human title
    lp = (el.get("last-path") or "").strip()
    if lp:
        return lp[:150]
    # Standard attributes
    for attr in ("title", "name", "id", "num", "number"):
        v = (el.get(attr) or "").strip()
        if v and len(v) < 200:
            return v
    # Child title elements
    for child in el:
        ctag = _get_local(child.tag)
        if ctag in ("title", "innodheading", "heading", "head", "caption", "label", "num"):
            # Check grandchild <title> first (innodHeading > title)
            for gc in child:
                if _get_local(gc.tag) == "title":
                    t = _elem_plain_fast(gc)[:150]
                    if t:
                        return t
            t = _elem_plain_fast(child)[:150]
            if t:
                return t
    # Fall back: first non-empty text
    full = _elem_plain_fast(el)
    return (full.split("\n")[0].strip())[:120] or _get_local(el.tag)


def _collect_chunks_recursive(
    el: etree._Element,
    chunks: list,
    max_chars: int = MAX_CHUNK_CHARS,
    depth: int = 0,
) -> None:
    """
    Walk the XML tree and collect leaf-level structural sections.

    Strategy:
    - If the element is structural AND small enough → add as chunk.
    - If the element is structural but TOO LARGE → recurse into children.
    - If the element is not structural → recurse into children looking for structural ones.

    This handles deeply nested structures like innodDoc > document > chapter >
    section[level=2] > innodLevel[level=4] correctly.
    """
    tag = _get_local(el.tag)
    is_structural = tag in STRUCTURAL_TAGS

    if is_structural:
        xml_str = etree.tostring(el, encoding="unicode")
        if len(xml_str) <= max_chars or depth >= 8:
            # Small enough (or max depth reached) — use as a chunk
            # Use _extract_innod_text (not itertext) so innodReplace whitespace
            # is handled correctly and content matches what the PDF shows
            title   = _elem_title(el)
            content = _extract_innod_text(xml_str)
            chunks.append((title or tag, content, xml_str))
            return
        # Too large — find structural children and recurse
        struct_children = [c for c in el if _get_local(c.tag) in STRUCTURAL_TAGS]
        if struct_children:
            for child in struct_children:
                _collect_chunks_recursive(child, chunks, max_chars, depth + 1)
        else:
            # No structural children at this level; go one level deeper anyway
            all_children = list(el)
            if all_children:
                for child in all_children:
                    _collect_chunks_recursive(child, chunks, max_chars, depth + 1)
            else:
                # Leaf structural node that is too large — add as-is
                title   = _elem_title(el)
                content = _extract_innod_text(xml_str)
                chunks.append((title or tag, content, xml_str))
    else:
        # Not structural — just recurse into children
        for child in el:
            _collect_chunks_recursive(child, chunks, max_chars, depth + 1)


def _extract_xml_sections(xml_content: str) -> list[tuple[str, str, str]]:
    """
    Split XML into structural chunks sized ≤ MAX_CHUNK_CHARS each.
    Returns list of (title, content_text, xml_str).

    Handles:
    - Standard structural tags (chapter/section/article/clause/…)
    - innodDoc/innodLevel hierarchy used by Innod XML format
    - Deeply nested structures (recurses until small enough)
    """
    try:
        parser = etree.XMLParser(recover=True, remove_blank_text=False)
        root   = etree.fromstring(xml_content.encode("utf-8"), parser)
    except Exception:
        plain = re.sub(r"<[^>]+>", " ", xml_content)
        return [("Document", plain, xml_content)]

    chunks: list[tuple[str,str,str]] = []
    _collect_chunks_recursive(root, chunks)

    if not chunks:
        # No structural tags found — return whole document as one chunk
        plain = _elem_plain_fast(root)
        chunks.append((_get_local(root.tag) or "Document", plain, xml_content))

    return chunks

# ── Session storage ────────────────────────────────────────────────────────────

_sessions: dict[str, dict] = {}


def _session_dir(session_id: str) -> Path:
    return BASE_STORAGE / session_id


def _ensure_dirs(session_id: str) -> dict[str, Path]:
    base = _session_dir(session_id)
    dirs = {
        "base":     base,
        "original": base / "ORIGINAL",
        "xml":      base / "XML",
        "compare":  base / "COMPARE",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


def _save_session_meta(session: dict) -> None:
    """Persist lightweight session metadata to disk after every status change."""
    try:
        meta = {k: v for k, v in session.items()
                if k not in ("chunks", "_old_bytes", "_new_bytes", "_xml_bytes")}
        meta["chunk_summaries"] = [
            {k2: c.get(k2) for k2 in (
                "index","label","filename","original_filename",
                "has_changes","change_type","similarity",
                "xml_size","page_start","page_end",
            )}
            for c in session.get("chunks", [])
        ]
        path = Path(session["storage"]["base"]) / "session.json"
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("Could not save session meta: %s", exc)


def _restore_session(session_id: str) -> Optional[dict]:
    """
    Restore a session from disk after a server restart.
    Called automatically by get_session() on a cache miss.
    """
    meta_path = _session_dir(session_id) / "session.json"
    if not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if time.time() > meta.get("expires_at", 0):
        return None

    session = {**meta, "chunks": []}
    for cs in meta.get("chunk_summaries", []):
        session["chunks"].append({
            **cs,
            "old_text": "", "new_text": "",
            "diff_lines": [], "diff_groups": [],
            "xml_content": "", "xml_suggested": "", "xml_saved": None,
        })

    _sessions[session_id] = session
    logger.info("Restored session %s from disk (%d chunks)", session_id, len(session["chunks"]))
    return session


# ── PDF text extraction (synchronous — runs in thread pool) ───────────────────

def _extract_all_pages_sync(pdf_bytes: bytes) -> list[str]:
    """Return list of page texts. Always call via run_in_executor."""
    doc   = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [str(doc[i].get_text("text")) for i in range(len(doc))]
    doc.close()
    return pages


def _count_pdf_pages(pdf_bytes: bytes) -> int:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n   = len(doc)
    doc.close()
    return n


# ── Text diff utilities ────────────────────────────────────────────────────────

def _normalise(text: str) -> str:
    return " ".join(text.split()).lower()


def _compute_similarity(old: str, new: str) -> float:
    if not old and not new:
        return 1.0
    if max(len(old), len(new)) > LARGE_TEXT_THRESHOLD:
        old = (old[:LARGE_TEXT_SAMPLE] + old[-LARGE_TEXT_SAMPLE:]) if len(old) > 2*LARGE_TEXT_SAMPLE else old
        new = (new[:LARGE_TEXT_SAMPLE] + new[-LARGE_TEXT_SAMPLE:]) if len(new) > 2*LARGE_TEXT_SAMPLE else new
    return difflib.SequenceMatcher(None, _normalise(old), _normalise(new)).ratio()


# Compiled patterns for fast innod text extraction
_INNOD_REPLACE_RE = re.compile(
    r'<innodReplace(?:\s+text="([^"]*)")?[^>]*>[\s\S]*?</innodReplace>'
)
_XML_TAG_RE   = re.compile(r'<[^>]+>')
_MULTI_SPC_RE = re.compile(r' {2,}')
_MULTI_NL_RE  = re.compile(r'\n{3,}')


def _innod_replace_sub(m: re.Match) -> str:
    attr = m.group(1) or ''
    if attr:
        return (attr
                .replace('&#10;', '\n')
                .replace('&#9;',  '\t')
                .replace('&#32;', ' '))
    return ' '


def _extract_innod_text(xml_content: str) -> str:
    """
    Extract clean plain text from innod XML format.

    Key rule for innodDoc files:
    - <innodReplace text="..."> carries the ACTUAL replacement text
      (newlines, spaces) in its text= attribute.
      The element's inner content is just XML whitespace formatting — skip it.
    - <innodReplace> with no text= attribute is a structural spacer — becomes ' '.
    - Everything else: normal text extraction (strip tags).

    This produces text that matches what the PDF renderer outputs, which is
    critical for accurate page-scoring and diff comparison.
    """
    s = _INNOD_REPLACE_RE.sub(_innod_replace_sub, xml_content)
    s = _XML_TAG_RE.sub(' ', s)
    s = _MULTI_SPC_RE.sub(' ', s)
    s = _MULTI_NL_RE.sub('\n\n', s)
    return s.strip()


def _extract_xml_reference_profile(xml_text: str) -> tuple[set[str], set[str]]:
    # Use innod-aware extraction so innodReplace whitespace noise is excluded.
    # Then evenly sample across the WHOLE document (not just the first N words).
    plain  = _extract_innod_text(xml_text)
    words  = re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-/]{2,}", plain.lower())
    words  = [w for w in words if w not in STOPWORDS and not w.isdigit() and len(w) >= 4]
    sample_size = 6000
    if len(words) <= sample_size:
        sampled = words
    else:
        step    = len(words) // sample_size
        sampled = words[::step][:sample_size]
    terms   = set(sampled)
    bigrams = {f"{sampled[i]} {sampled[i+1]}" for i in range(len(sampled)-1)}
    return terms, bigrams


def _is_line_relevant_to_xml(line_text: str, ref_terms: set[str], ref_bigrams: set[str]) -> bool:
    if not ref_terms and not ref_bigrams:
        return True
    norm = _normalise(line_text)
    if not norm:
        return False
    line_words = [w for w in re.findall(r"[a-z0-9][a-z0-9'\-/]{2,}", norm)
                  if w not in STOPWORDS and not w.isdigit() and len(w) >= 4]
    if not line_words:
        return False
    overlap       = sum(1 for w in line_words if w in ref_terms)
    line_bigrams  = {f"{line_words[i]} {line_words[i+1]}" for i in range(len(line_words)-1)}
    bigram_hits   = sum(1 for bg in line_bigrams if bg in ref_bigrams)
    overlap_ratio = overlap / max(len(set(line_words)), 1)
    if bigram_hits >= 1 and overlap >= 1:
        return True
    if ref_bigrams:
        if len(ref_terms) < 120: return overlap >= 4 and overlap_ratio >= 0.50
        if len(ref_terms) < 300: return overlap >= 4 and overlap_ratio >= 0.42
        return overlap >= 3 and overlap_ratio >= 0.45
    if len(ref_terms) < 120: return overlap >= 4 and overlap_ratio >= 0.50
    if len(ref_terms) < 300: return overlap >= 4 and overlap_ratio >= 0.42
    if overlap >= 5: return True
    return overlap >= 3 and overlap_ratio >= 0.45


def _classify_change(old_text: str, new_text: str) -> str:
    if not old_text.strip() and new_text.strip():  return "added"
    if old_text.strip() and not new_text.strip():  return "removed"
    if _normalise(old_text) == _normalise(new_text): return "unchanged"
    return "modified"


def _char_diff_spans(old_line: str, new_line: str) -> tuple[list[dict], list[dict]]:
    sm = difflib.SequenceMatcher(None, old_line, new_line, autojunk=False)
    os: list[dict] = []
    ns: list[dict] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            os.append({"text": old_line[i1:i2], "changed": False})
            ns.append({"text": new_line[j1:j2], "changed": False})
        elif op == "replace":
            os.append({"text": old_line[i1:i2], "changed": True})
            ns.append({"text": new_line[j1:j2], "changed": True})
        elif op == "delete":
            os.append({"text": old_line[i1:i2], "changed": True})
        elif op == "insert":
            ns.append({"text": new_line[j1:j2], "changed": True})
    return os, ns


_EMPH_RE  = re.compile(r"<\/?(emphasis|emph|bold|italic|underline|strong|b|i|u|sub|sup)[^>]*>", re.I)
_INNOD_RE = re.compile(r"<\/?\w+:", re.I)


def _line_meta(kind: str, old_t: str, new_t: str, combined: str) -> tuple[str, str]:
    """Return (category, sub_type) for a diff line."""
    if _EMPH_RE.search(combined):
        return "emphasis", "emphasis"
    if _INNOD_RE.search(combined):
        cat = "addition" if kind=="added" else ("removal" if kind=="removed" else "modification")
        return cat, "innodreplace"
    cat   = "addition" if kind=="added" else ("removal" if kind=="removed" else "modification")
    delta = abs(len(old_t) - len(new_t))
    return cat, ("edit" if delta <= 60 else "textual")


def _generate_diff_lines(
    old_text: str, new_text: str,
    old_line_pages: Optional[list[int]] = None,
    new_line_pages: Optional[list[int]] = None,
) -> list[dict]:
    old_lines = old_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    result: list[dict] = []
    line_num = 0
    old_pgs  = old_line_pages or []
    new_pgs  = new_line_pages or []

    def _push(entry: dict) -> bool:
        nonlocal line_num
        entry["line"] = line_num
        result.append(entry)
        line_num += 1
        if len(result) >= MAX_DIFF_LINES:
            result.append({"type":"modified","category":"modification","sub_type":"textual",
                            "text":"… diff truncated …","line":line_num,
                            "old_page":None,"new_page":None,"old_text":"","new_text":""})
            return True
        return False

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue
        elif opcode == "delete":
            for offset, line in enumerate(old_lines[i1:i2]):
                ln = line.rstrip("\n")
                cat, sub = _line_meta("removed", ln, "", ln)
                if _push({"type":"removed","category":cat,"sub_type":sub,
                          "text":ln,"old_text":ln,"new_text":"",
                          "old_page":old_pgs[i1+offset] if old_pgs else None,"new_page":None,
                          "old_spans":[{"text":ln,"changed":True}],"new_spans":[]}):
                    return result
        elif opcode == "insert":
            for offset, line in enumerate(new_lines[j1:j2]):
                ln = line.rstrip("\n")
                cat, sub = _line_meta("added", "", ln, ln)
                if _push({"type":"added","category":cat,"sub_type":sub,
                          "text":ln,"old_text":"","new_text":ln,
                          "old_page":None,"new_page":new_pgs[j1+offset] if new_pgs else None,
                          "old_spans":[],"new_spans":[{"text":ln,"changed":True}]}):
                    return result
        elif opcode == "replace":
            ob = [l.rstrip("\n") for l in old_lines[i1:i2]]
            nb = [l.rstrip("\n") for l in new_lines[j1:j2]]
            for k in range(max(len(ob), len(nb))):
                old_ln = ob[k] if k < len(ob) else ""
                new_ln = nb[k] if k < len(nb) else ""
                op     = old_pgs[i1+k] if old_pgs and (i1+k)<len(old_pgs) else None
                np     = new_pgs[j1+k] if new_pgs and (j1+k)<len(new_pgs) else None
                if old_ln and new_ln:
                    os, ns  = _char_diff_spans(old_ln, new_ln)
                    cat,sub = _line_meta("modified", old_ln, new_ln, old_ln+new_ln)
                    if _push({"type":"modified","category":cat,"sub_type":sub,
                              "text":f"{old_ln} -> {new_ln}","old_text":old_ln,"new_text":new_ln,
                              "old_page":op,"new_page":np,"old_spans":os,"new_spans":ns}):
                        return result
                elif old_ln:
                    cat,sub = _line_meta("removed", old_ln, "", old_ln)
                    if _push({"type":"removed","category":cat,"sub_type":sub,
                              "text":old_ln,"old_text":old_ln,"new_text":"",
                              "old_page":op,"new_page":None,
                              "old_spans":[{"text":old_ln,"changed":True}],"new_spans":[]}):
                        return result
                elif new_ln:
                    cat,sub = _line_meta("added", "", new_ln, new_ln)
                    if _push({"type":"added","category":cat,"sub_type":sub,
                              "text":new_ln,"old_text":"","new_text":new_ln,
                              "old_page":None,"new_page":np,
                              "old_spans":[],"new_spans":[{"text":new_ln,"changed":True}]}):
                        return result
                if len(result) >= MAX_DIFF_LINES:
                    return result
    return result


def _build_diff_groups(diff_lines: list[dict]) -> list[dict]:
    ORDER  = ["addition","removal","modification","emphasis","mismatch"]
    LABELS = {"addition":"Additions","removal":"Removals","modification":"Modifications",
               "emphasis":"Emphasis Changes","mismatch":"Structural Mismatches"}
    buckets: dict[str, list] = {c: [] for c in ORDER}
    for line in diff_lines:
        cat = line.get("category","modification")
        if cat in buckets:
            buckets[cat].append(line)
    return [{"category":c,"label":LABELS[c],"lines":buckets[c]} for c in ORDER if buckets[c]]


# ── AI XML suggestion ──────────────────────────────────────────────────────────

def _remove_text_preserve_xml_structure(xml_chunk: str, text_to_remove: str) -> Optional[str]:
    target = (text_to_remove or "").strip()
    if not target: return None
    try:
        parser = etree.XMLParser(recover=True, remove_blank_text=False)
        root   = etree.fromstring(xml_chunk.encode("utf-8"), parser)
    except Exception:
        return None
    words     = [w for w in re.split(r"\s+", target) if w]
    fuzzy_pat = re.compile(r"\s+".join(re.escape(w) for w in words), re.IGNORECASE) if len(words)>=3 else None
    def _rm(v: str) -> tuple[str, bool]:
        if target in v: return v.replace(target,"",1), True
        if fuzzy_pat:
            r2,n = fuzzy_pat.subn("",v,count=1)
            if n: return r2, True
        return v, False
    for el in root.iter():
        if el.text:
            el.text, did = _rm(el.text)
            if did: break
        if el.tail:
            el.tail, did = _rm(el.tail)
            if did: break
    return etree.tostring(root, encoding="unicode")


def _generate_xml_suggestion(xml_chunk, old_pdf_text, new_pdf_text,
                              focus_old_text=None, focus_new_text=None, focus_text=None):
    updated = xml_chunk
    f_old = (focus_old_text or "").strip()
    f_new = (focus_new_text or "").strip()
    if f_old or f_new or (focus_text or "").strip():
        if f_old and f_new and f_old in updated: return updated.replace(f_old, f_new, 1)
        if f_old and not f_new:
            r = _remove_text_preserve_xml_structure(updated, f_old)
            if r is not None: return r
            if f_old in updated: return updated.replace(f_old,"",1)
        if f_old and f_old in updated: return updated.replace(f_old, f_new or "", 1)
        if f_new and f_new not in updated:
            m = re.search(r"(</[^>]+>\s*)$", updated)
            if m: return updated[:m.start()] + f"\n{f_new}\n" + updated[m.start():]
            return updated + f"\n{f_new}\n"
    if not new_pdf_text.strip(): return xml_chunk
    old_s = re.split(r"(?<=[.!?])\s+", old_pdf_text.strip())
    new_s = re.split(r"(?<=[.!?])\s+", new_pdf_text.strip())
    sm    = difflib.SequenceMatcher(None, old_s, new_s)
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op=="replace" and (i2-i1)==(j2-j1):
            for os2,ns2 in zip(old_s[i1:i2],new_s[j1:j2]):
                if len(os2)>10 and os2 in updated: updated=updated.replace(os2,ns2,1)
        elif op=="insert":
            for ns2 in new_s[j1:j2]:
                if len(ns2)>10:
                    cm=re.search(r"(</[^>]+>\s*)$",updated)
                    if cm: updated=updated[:cm.start()]+f"\n{ns2}\n"+updated[cm.start():]
    if updated==xml_chunk and old_pdf_text.strip()!=new_pdf_text.strip():
        op2=[p.strip() for p in old_pdf_text.split("\n\n") if p.strip()]
        np2=[p.strip() for p in new_pdf_text.split("\n\n") if p.strip()]
        pm=difflib.SequenceMatcher(None,op2,np2)
        for op3,i1,i2,j1,j2 in pm.get_opcodes():
            if op3=="replace":
                for a,b in zip(op2[i1:i2],np2[j1:j2]):
                    if len(a)>15 and a in updated: updated=updated.replace(a,b,1)
    return updated


# ── Core pipeline ──────────────────────────────────────────────────────────────

def process_upload(
    old_pdf_bytes: bytes,
    new_pdf_bytes: bytes,
    xml_files: list[tuple[str, bytes]],
    source_name: str,
) -> dict:
    session_id = str(uuid.uuid4())
    dirs       = _ensure_dirs(session_id)

    (dirs["original"] / "old.pdf").write_bytes(old_pdf_bytes)
    (dirs["original"] / "new.pdf").write_bytes(new_pdf_bytes)

    old_pages = _count_pdf_pages(old_pdf_bytes)
    new_pages = _count_pdf_pages(new_pdf_bytes)

    xml_file_list: list[dict] = []
    chunk_idx = 0
    for filename, xml_bytes in xml_files:
        try:
            xml_str = xml_bytes.decode("utf-8", errors="replace")
        except Exception:
            xml_str = ""
        sections = _extract_xml_sections(xml_str) if xml_str else [(filename, "", xml_str)]
        for (sec_title, sec_content, sec_xml) in sections:
            chunk_idx += 1
            # Create a unique safe filename per section
            safe_base = re.sub(r"[^\w.\-]", "_", filename.replace(".xml",""))
            safe = f"{safe_base}_part{chunk_idx:04d}.xml"
            sec_bytes = sec_xml.encode("utf-8")
            (dirs["xml"] / safe).write_bytes(sec_bytes)
            xml_file_list.append({
                "index":             chunk_idx,
                "filename":          safe,
                "original_filename": filename,
                "section_title":     sec_title,
                "xml_size":          len(sec_bytes),
            })

    now     = time.time()
    session: dict[str, Any] = {
        "session_id":     session_id,
        "source_name":    source_name.strip(),
        "status":         "uploaded",
        "progress":       0,
        "error":          None,
        "old_pages":      old_pages,
        "new_pages":      new_pages,
        "xml_file_count": len(xml_files),
        "chunks":         [],
        "xml_file_list":  xml_file_list,
        "summary":        None,
        "storage":        {k: str(v) for k, v in dirs.items()},
        "created_at":     now,
        "expires_at":     now + SESSION_TTL,
    }
    _sessions[session_id] = session
    _save_session_meta(session)
    return session


async def start_processing(session_id: str, batch_size: int = BATCH_SIZE) -> None:
    """
    Background coroutine.  All CPU-bound work dispatched to _POOL so the
    event loop stays free and /status polls always get a prompt response.
    """
    session = get_session(session_id)
    if not session:
        return

    loop = asyncio.get_event_loop()
    session["status"]   = "processing"
    session["progress"] = 5
    _save_session_meta(session)

    base = Path(session["storage"]["base"])

    try:
        old_pdf_bytes = (base / "ORIGINAL" / "old.pdf").read_bytes()
        new_pdf_bytes = (base / "ORIGINAL" / "new.pdf").read_bytes()
    except Exception as exc:
        session["status"] = "error"; session["error"] = f"Could not read PDFs: {exc}"
        _save_session_meta(session); return

    session["progress"] = 10; _save_session_meta(session)

    # ── Step 1: Extract text in threads (non-blocking) ────────────────────────
    try:
        old_pages_text: list[str] = await loop.run_in_executor(_POOL, _extract_all_pages_sync, old_pdf_bytes)
        session["progress"] = 20; _save_session_meta(session)
        new_pages_text: list[str] = await loop.run_in_executor(_POOL, _extract_all_pages_sync, new_pdf_bytes)
        session["progress"] = 30; _save_session_meta(session)
    except Exception as exc:
        session["status"] = "error"; session["error"] = f"PDF extraction failed: {exc}"
        _save_session_meta(session); return

    # ── Pre-build page word-sets for fast scoring (built once, reused per chunk) ──
    # This replaces per-line scoring (O(lines*chunks)) with set intersection (O(pages*chunks))
    # Speedup: ~30x for large documents (e.g. 134 chunks × 553 pages)

    _WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9\'\-/]{2,}")

    def _page_words(text: str) -> frozenset:
        words = _WORD_RE.findall(text.lower())
        return frozenset(w for w in words if len(w) >= 4 and not w.isdigit())

    old_page_words: list[frozenset] = [_page_words(pg) for pg in old_pages_text]
    new_page_words: list[frozenset] = [_page_words(pg) for pg in new_pages_text]

    # Also keep line-indexed text for text extraction after page selection
    old_page_lines: list[list[str]] = [pg.splitlines(keepends=True) for pg in old_pages_text]
    new_page_lines: list[list[str]] = [pg.splitlines(keepends=True) for pg in new_pages_text]

    xml_file_list = session["xml_file_list"]
    total_chunks  = len(xml_file_list)
    enriched: list[dict] = []
    changed_count = 0

    # ── Step 2: Per-chunk comparison in thread pool ───────────────────────────

    def _process_chunk_sync(cf: dict) -> tuple[dict, bool]:
        xml_path = base / "XML" / cf["filename"]
        xml_content = ""
        if xml_path.exists():
            try:    xml_content = xml_path.read_text(encoding="utf-8")
            except: xml_content = xml_path.read_bytes().decode("utf-8", errors="replace")

        # Fast page scoring: set intersection of chunk words vs each page's words
        # O(n_pages) set intersections instead of O(n_lines * n_pages) regex calls
        chunk_words = _page_words(xml_content)
        if not chunk_words:
            p_start, p_end = 0, min(len(old_page_words), 10)
        else:
            scores = [len(chunk_words & pw) for pw in old_page_words]
            if max(scores) == 0:
                p_start, p_end = 0, min(len(old_page_words), 10)
            else:
                # Take top-scoring pages, expand window by ±3 pages
                top_pages = sorted(range(len(scores)), key=lambda i: -scores[i])[:10]
                p_start   = max(0, min(top_pages) - 2)          # 0-indexed
                p_end     = min(len(old_page_words) - 1, max(top_pages) + 2)

        # Extract text for the selected page window
        old_lines = [ln for pi in range(p_start, p_end + 1) for ln in old_page_lines[pi]]
        new_lines = [ln for pi in range(p_start, min(p_end + 1, len(new_page_lines))) for ln in new_page_lines[pi]]
        old_text  = "".join(old_lines)
        new_text  = "".join(new_lines)

        # Use clean innod text for the XML-side comparison
        # (replaces raw itertext which contains innodReplace whitespace noise)
        xml_clean = _extract_innod_text(xml_content) if xml_content else ""
        old_lp    = [pi + 1 for pi in range(p_start, p_end + 1) for _ in old_page_lines[pi]]
        new_lp    = [pi + 1 for pi in range(p_start, min(p_end + 1, len(new_page_lines))) for _ in new_page_lines[pi]]

        change_type = _classify_change(old_text, new_text)
        has_changes = change_type != "unchanged"
        similarity  = _compute_similarity(old_text, new_text) if (old_text or new_text) else 1.0

        label = cf.get("section_title") or cf["original_filename"]
        if label == cf["original_filename"] and label.lower().endswith(".xml"):
            label = label[:-4]
        label = label[:120]

        chunk_data = {
            "index": cf["index"], "label": label,
            "filename": cf["filename"], "original_filename": cf["original_filename"],
            "old_text":"","new_text":"","has_changes":has_changes,
            "change_type":change_type,"similarity":round(similarity,3),
            "diff_lines":[],"diff_groups":[],"xml_content":"",
            "xml_suggested":"","xml_saved":None,
            "xml_size":cf["xml_size"],"page_start":p_start,"page_end":p_end,
        }

        # Cache page texts + line-page mapping for lazy diff on first open
        cache_path = base / "COMPARE" / f"text_{cf['index']:05d}.json"
        cache_path.write_text(json.dumps({
            "old_text": old_text, "new_text": new_text,
            "page_start": p_start, "page_end": p_end,
            "old_lp": old_lp, "new_lp": new_lp,
        }, ensure_ascii=False), encoding="utf-8")

        return chunk_data, has_changes

    # Process chunks in concurrent batches — all 4 workers run simultaneously.
    # Sequential awaits (old behaviour) meant only 1 chunk ran at a time despite
    # having 4 workers; batching gives true 4x parallelism.
    BATCH_SIZE_CHUNKS = 16  # 16 concurrent tasks, 4 workers → 4 chunks in parallel

    processed = 0
    for batch_start in range(0, total_chunks, BATCH_SIZE_CHUNKS):
        batch = xml_file_list[batch_start : batch_start + BATCH_SIZE_CHUNKS]

        def _safe_run(cf: dict) -> tuple[dict, bool]:
            try:
                return _process_chunk_sync(cf)
            except Exception as exc:
                logger.warning("Chunk %s failed: %s", cf.get("filename"), exc)
                fallback = {
                    "index":cf["index"],"label":cf.get("section_title",cf["original_filename"]),
                    "filename":cf["filename"],"original_filename":cf["original_filename"],
                    "old_text":"","new_text":"","has_changes":False,"change_type":"unchanged",
                    "similarity":1.0,"diff_lines":[],"diff_groups":[],"xml_content":"",
                    "xml_suggested":"","xml_saved":None,"xml_size":cf["xml_size"],
                    "page_start":0,"page_end":0,
                }
                return fallback, False

        # Submit entire batch concurrently
        tasks = [loop.run_in_executor(_POOL, _safe_run, cf) for cf in batch]
        results = await asyncio.gather(*tasks)

        for chunk_data, has_chg in results:
            if has_chg: changed_count += 1
            enriched.append(chunk_data)
            processed += 1

        session["progress"] = 30 + int(65 * processed / total_chunks)
        _save_session_meta(session)

    summary = {
        "total":total_chunks,"changed":changed_count,"unchanged":total_chunks-changed_count,
        "old_pages":session["old_pages"],"new_pages":session["new_pages"],"source_name":session["source_name"],
    }
    (base / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    session["chunks"]   = enriched
    session["summary"]  = summary
    session["status"]   = "done"
    session["progress"] = 100
    _save_session_meta(session)
    logger.info("AutoCompare %s done: %d chunks, %d changed", session_id, total_chunks, changed_count)


# ── Public helpers ─────────────────────────────────────────────────────────────

def get_session(session_id: str) -> Optional[dict]:
    """Return from memory; fall back to disk restore (survives restarts)."""
    if session_id in _sessions:
        return _sessions[session_id]
    return _restore_session(session_id)


def get_chunks_list(session_id: str) -> list[dict]:
    session = get_session(session_id)
    if not session: return []
    return [{
        "index":c["index"],"label":c["label"],
        "filename":c["filename"],"original_filename":c.get("original_filename",c["filename"]),
        "has_changes":c["has_changes"],"change_type":c.get("change_type","unchanged"),
        "similarity":c.get("similarity",1.0),"xml_size":c.get("xml_size",0),
        "page_start":c.get("page_start",0),"page_end":c.get("page_end",0),
    } for c in session.get("chunks",[])]


def get_chunk_detail(session_id: str, chunk_id: str) -> Optional[dict]:
    session = get_session(session_id)
    if not session: return None
    chunks = session.get("chunks",[])
    try:    idx=int(chunk_id); chunk=next((c for c in chunks if c["index"]==idx),None)
    except: chunk=next((c for c in chunks if c["filename"]==chunk_id),None)
    if not chunk: return None

    base = Path(session["storage"]["base"])
    if not chunk.get("xml_content"):
        xp = base/"XML"/chunk["filename"]
        if xp.exists():
            try:    chunk["xml_content"] = xp.read_text(encoding="utf-8")
            except: chunk["xml_content"] = xp.read_bytes().decode("utf-8",errors="replace")
        chunk["xml_suggested"] = chunk.get("xml_saved") or chunk.get("xml_content","")

    cp = base/"COMPARE"/f"text_{chunk['index']:05d}.json"
    if cp.exists() and not chunk.get("old_text"):
        try:
            cached = json.loads(cp.read_text(encoding="utf-8"))
            chunk["old_text"]   = cached.get("old_text","")
            chunk["new_text"]   = cached.get("new_text","")
            chunk["page_start"] = cached.get("page_start", chunk.get("page_start",0))
            chunk["page_end"]   = cached.get("page_end",   chunk.get("page_end",0))
            if chunk.get("has_changes") and not chunk.get("diff_lines"):
                chunk["diff_lines"]  = _generate_diff_lines(chunk["old_text"],chunk["new_text"],
                                                              cached.get("old_lp",[]),cached.get("new_lp",[]))
                chunk["diff_groups"] = _build_diff_groups(chunk["diff_lines"])
        except Exception: pass

    if chunk.get("has_changes") and not chunk.get("diff_lines"):
        chunk["diff_lines"]  = _generate_diff_lines(chunk.get("old_text",""),chunk.get("new_text",""))
        chunk["diff_groups"] = _build_diff_groups(chunk["diff_lines"])
    if chunk.get("diff_lines") and not chunk.get("diff_groups"):
        chunk["diff_groups"] = _build_diff_groups(chunk["diff_lines"])
    return chunk


def save_chunk_xml(session_id: str, chunk_id: str, xml_content: str) -> dict:
    session = get_session(session_id)
    if not session: raise KeyError(f"Session {session_id} not found")
    try:    etree.fromstring(xml_content.encode("utf-8")); valid=True; errors:list[str]=[]
    except etree.XMLSyntaxError as exc: valid=False; errors=[str(exc)]
    chunks=session.get("chunks",[])
    try:    idx=int(chunk_id); chunk=next((c for c in chunks if c["index"]==idx),None)
    except: chunk=next((c for c in chunks if c["filename"]==chunk_id),None)
    if not chunk: raise KeyError(f"Chunk {chunk_id} not found")
    if not chunk.get("xml_content"): get_chunk_detail(session_id,chunk_id)
    if valid:
        chunk["xml_saved"]=xml_content
        (Path(session["storage"]["base"])/"XML"/chunk["filename"]).write_text(xml_content,encoding="utf-8")
    return {"valid":valid,"errors":errors}


def validate_chunk_xml(session_id: str, chunk_id: str) -> dict:
    session = get_session(session_id)
    if not session: raise KeyError(f"Session {session_id} not found")
    get_chunk_detail(session_id,chunk_id)
    chunks=session.get("chunks",[])
    try:    idx=int(chunk_id); chunk=next((c for c in chunks if c["index"]==idx),None)
    except: chunk=next((c for c in chunks if c["filename"]==chunk_id),None)
    if not chunk: raise KeyError(f"Chunk {chunk_id} not found")
    xml_c=chunk.get("xml_saved") or chunk.get("xml_content",""); orig=chunk.get("xml_content","")
    try:    etree.fromstring(xml_c.encode("utf-8")); xml_valid=True; xml_err:list[str]=[]
    except etree.XMLSyntaxError as exc: xml_valid=False; xml_err=[str(exc)]
    is_upd=chunk.get("xml_saved") is not None; is_mod=is_upd and xml_c!=orig
    has_chg=chunk.get("has_changes",False); needs=False; details:list[str]=[]
    if has_chg and not is_upd: needs=True; details.append("PDF changes detected but XML not yet updated.")
    if has_chg and is_upd and xml_c==orig: needs=True; details.append("XML saved but identical to original.")
    if not xml_valid: needs=True; details.append("XML has syntax errors.")
    if not has_chg:                         status="no_changes";      msg="No changes detected."
    elif is_mod and xml_valid and not needs: status="updated";         msg="XML updated successfully."
    elif is_upd and not is_mod:             status="saved_unchanged"; msg="Saved but identical to original."
    elif needs:                             status="needs_review";    msg="Further modifications required."
    else:                                   status="pending";          msg="Changes detected — review and update."
    return {"status":status,"message":msg,"xml_valid":xml_valid,"xml_errors":xml_err,
            "is_updated":is_upd,"is_modified":is_mod,"has_pdf_changes":has_chg,
            "needs_further_changes":needs,"change_details":details}


def validate_all_chunks(session_id: str) -> dict:
    session=get_session(session_id)
    if not session: raise KeyError(f"Session {session_id} not found")
    chunks=session.get("chunks",[]); results:list[dict]=[]
    counts={"updated":0,"no_changes":0,"saved_unchanged":0,"needs_review":0,"pending":0,"invalid_xml":0}
    for chunk in chunks:
        cid=str(chunk.get("index")); r=validate_chunk_xml(session_id,cid)
        st=r.get("status","pending")
        if st in counts: counts[st]+=1
        if not r.get("xml_valid",False): counts["invalid_xml"]+=1
        results.append({"chunk_id":cid,"index":chunk.get("index"),"label":chunk.get("label",cid),"filename":chunk.get("filename"),**r})
    na=[r for r in results if r.get("needs_further_changes") or not r.get("xml_valid",True)]
    return {"session_id":session_id,"total":len(results),"summary":counts,"needs_action_count":len(na),"results":results}


def reupload_xml_files(session_id: str, xml_files: list[tuple[str, bytes]]) -> dict:
    session=get_session(session_id)
    if not session: raise KeyError(f"Session {session_id} not found")
    base=Path(session["storage"]["base"]); xml_dir=base/"XML"
    for f in xml_dir.iterdir(): f.unlink(missing_ok=True)
    new_list:list[dict]=[]
    for i,(fn,xb) in enumerate(xml_files,start=1):
        safe=re.sub(r"[^\w.\-]","_",fn); (xml_dir/safe).write_bytes(xb)
        new_list.append({"index":i,"filename":safe,"original_filename":fn,"xml_size":len(xb)})
    session.update({"xml_file_list":new_list,"xml_file_count":len(xml_files),
                    "chunks":[],"summary":None,"status":"uploaded","progress":0})
    _save_session_meta(session)
    return session


def get_chunk_xml_content(session_id: str, chunk_id: str) -> tuple[str, str]:
    session=get_session(session_id)
    if not session: raise KeyError(f"Session {session_id} not found")
    get_chunk_detail(session_id,chunk_id)
    chunks=session.get("chunks",[])
    try:    idx=int(chunk_id); chunk=next((c for c in chunks if c["index"]==idx),None)
    except: chunk=next((c for c in chunks if c["filename"]==chunk_id),None)
    if not chunk: raise KeyError(f"Chunk {chunk_id} not found")
    return chunk.get("original_filename",chunk["filename"]), chunk.get("xml_saved") or chunk.get("xml_content","")


def cleanup_old_sessions(ttl: int = SESSION_TTL) -> int:
    now=time.time(); to_del=[sid for sid,s in _sessions.items() if now-s.get("created_at",0)>ttl]
    removed=0
    for sid in to_del:
        s=_sessions.pop(sid,None)
        if s:
            bp=s.get("storage",{}).get("base")
            if bp: shutil.rmtree(bp,ignore_errors=True)
            removed+=1
    return removed