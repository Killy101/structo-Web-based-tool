"""
FastAPI router for XML Chunk / Compare / Merge operations.

Aligned with Innodata Tool architecture:
  POST /compare/upload              — Upload OLD PDF, NEW PDF, XML (job init)
  POST /compare/start-chunking      — Trigger async chunking job
  GET  /compare/chunks              — List chunks for a job
  GET  /compare/compare/{chunk_id}  — Load comparison data for a single chunk
  POST /compare/save-xml            — Save edited XML for a chunk
  POST /compare/merge               — Merge XML (legacy: old/new + accept/reject)
  POST /compare/merge/chunks        — Merge all XML chunk files into final output
  POST /compare/chunk               — Chunk XML file (legacy, tag-based)
  POST /compare/chunk/pdf           — LangChain PDF + XML chunking pipeline
  POST /compare/chunk/download      — Download a single XML chunk
  POST /compare/validate            — Validate an XML chunk
  POST /compare/diff                — Compare two XML files
  POST /compare/diff/pdf            — Compare two PDFs alongside an XML reference
  POST /compare/merge/pdf           — Merge PDF-detected changes into XML
  POST /compare/detect              — Per-span change detection (OLD vs NEW PDF)
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import json
import uuid
import re

from src.services.xml_compare import (
    chunk_xml,
    compare_xml,
    line_diff,
    merge_xml,
)
from src.services.pdf_chunk import (
    chunk_pdfs_and_xml,
    compare_pdfs_with_xml,
    merge_pdfs_with_xml,
    detect_pdf_changes,
    validate_xml_chunk,
    merge_xml_chunks,
)
from src.services.pdf_layout_diff import compare_pdfs_layout

router = APIRouter(prefix="/compare", tags=["compare"])

# ── Persistent job store: SQLite + disk bytes, write-through in-memory cache ──
from src.services.job_store import _store as _job_store
_jobs = _job_store.mem   # existing _jobs.get / _jobs[id] calls work unchanged


# ─────────────────────────────────────────────────────────────────────────────
# 1. UPLOAD — initialise a job, receive files, return job_id
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_endpoint(
    old_pdf:     UploadFile = File(...),
    new_pdf:     UploadFile = File(...),
    xml_file:    Optional[UploadFile] = File(None),  # optional — omit in 2-file mode
    source_name: str               = Form(...),
):
    """
    Upload OLD PDF, NEW PDF, and (optionally) an XML reference file.
    2-file mode: xml_file may be omitted entirely.
    3-file mode: xml_file required for tag-based XML chunking.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()

    xml_bytes: Optional[bytes] = None
    xml_filename: Optional[str] = None
    if xml_file is not None:
        xml_bytes = await xml_file.read()
        xml_filename = xml_file.filename
        try:
            xml_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="XML file must be valid UTF-8")

    job_id = str(uuid.uuid4())

    _job_store.create(job_id, {
        "job_id":       job_id,
        "status":       "uploaded",
        "source_name":  source_name.strip(),
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_filename,
        "chunks":       [],
        "summary":      None,
        "progress":     0,
        "error":        None,
    }, old_bytes, new_bytes, xml_bytes)

    return {
        "success":      True,
        "job_id":       job_id,
        "source_name":  source_name.strip(),
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_filename,
        "status":       "uploaded",
        "message":      "Files uploaded. POST /start-chunking to begin processing.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. START CHUNKING — trigger processing for an uploaded job
# ─────────────────────────────────────────────────────────────────────────────

class StartChunkingRequest(BaseModel):
    job_id:        str
    tag_name:      str            = "section"
    chunk_size:    int            = 1500
    chunk_overlap: int            = 150
    attribute:     Optional[str]  = None
    value:         Optional[str]  = None
    max_file_size: Optional[int]  = None


@router.post("/start-chunking")
async def start_chunking_endpoint(payload: StartChunkingRequest):
    """
    Trigger chunking for a previously uploaded job.
    Returns IMMEDIATELY with job_id so the frontend can poll /progress.
    Processing runs in the background via asyncio.create_task.
    """
    import asyncio
    from fastapi.concurrency import run_in_threadpool

    _job_id = payload.job_id  # captured by closures for persistence calls
    job = _jobs.get(_job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {_job_id} not found")

    if job["status"] == "processing":
        raise HTTPException(status_code=409, detail="Job is already processing")

    job["status"]   = "processing"
    job["progress"] = 0
    job["stage"]    = "Extracting text from PDFs"
    _job_store.persist(_job_id)

    raw_xml = job.get("_xml_bytes")
    xml_str = raw_xml.decode("utf-8") if raw_xml else ""

    def _progress(pct: int, stage: str) -> None:
        job["progress"] = min(pct, 99)
        job["stage"]    = stage
        # Note: progress/stage are transient; we only persist on terminal states.

    def _run() -> dict:
        return chunk_pdfs_and_xml(
            old_pdf_bytes=job["_old_bytes"],
            new_pdf_bytes=job["_new_bytes"],
            xml_content=xml_str,
            tag_name=payload.tag_name,
            source_name=job["source_name"],
            attribute=payload.attribute,
            value=payload.value,
            max_file_size=payload.max_file_size,
            chunk_size=payload.chunk_size,
            chunk_overlap=payload.chunk_overlap,
            progress_callback=_progress,
        )

    async def _background():
        try:
            result = await run_in_threadpool(_run)
            job["status"]   = "done"
            job["progress"] = 100
            job["stage"]    = "Complete"
            job["chunks"]   = result.get("pdf_chunks", [])
            job["summary"]  = result.get("summary", {})
            _job_store.remove_bytes(_job_id, "xml")
            job.pop("_xml_bytes", None)
            _job_store.persist(_job_id)
        except Exception as exc:
            job["status"] = "error"
            job["stage"]  = "Failed"
            job["error"]  = str(exc)
            _job_store.persist(_job_id)

    # Fire and forget — returns immediately, processing continues in background
    asyncio.create_task(_background())

    return {
        "success":     True,
        "job_id":      payload.job_id,
        "status":      "processing",
        "source_name": job["source_name"],
        "message":     "Chunking started. Poll /progress for updates.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2b. CHUNK DIRECT — upload + chunk in a single request (faster, no round-trip)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/chunk-direct")
async def chunk_direct_endpoint(
    old_pdf:     UploadFile = File(...),
    new_pdf:     UploadFile = File(...),
    xml_file:    Optional[UploadFile] = File(None),
    source_name: str  = Form(...),
    tag_name:    str  = Form("part"),
    chunk_size:  int  = Form(1500),
    chunk_overlap: int = Form(150),
):
    """
    Upload files and run chunking in a single request.
    Eliminates the upload→chunk round-trip and the double memory buffering.
    Returns the same response as /start-chunking.
    """
    from fastapi.concurrency import run_in_threadpool

    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()

    xml_bytes: Optional[bytes] = None
    xml_str = ""
    if xml_file is not None:
        xml_bytes = await xml_file.read()
        try:
            xml_str = xml_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="XML file must be valid UTF-8")

    job_id = str(uuid.uuid4())
    _job_store.create(job_id, {
        "job_id":       job_id,
        "status":       "processing",
        "source_name":  source_name.strip(),
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "chunks":       [],
        "summary":      None,
        "progress":     0,
        "stage":        "Starting…",
        "error":        None,
    }, old_bytes, new_bytes)

    def _progress(pct: int, stage: str) -> None:
        _jobs[job_id]["progress"] = min(pct, 99)
        _jobs[job_id]["stage"]    = stage

    try:
        def _run() -> dict:
            return chunk_pdfs_and_xml(
                old_pdf_bytes=old_bytes,
                new_pdf_bytes=new_bytes,
                xml_content=xml_str,
                tag_name=tag_name,
                source_name=source_name.strip(),
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                progress_callback=_progress,
            )

        result = await run_in_threadpool(_run)

        full_chunks = result.get("pdf_chunks", [])

        # Span-level detection is intentionally deferred until a chunk is opened.
        # Running detect_pdf_changes for every changed chunk here makes the first
        # response much slower on large documents. The frontend already falls
        # back to /compare/detect-chunk on demand.
        final_changed   = sum(1 for c in full_chunks if c.get("has_changes"))
        final_unchanged = len(full_chunks) - final_changed
        final_summary = {
            "total":     len(full_chunks),
            "changed":   final_changed,
            "unchanged": final_unchanged,
        }

        _jobs[job_id].update({
            "status":   "done",
            "progress": 100,
            "stage":    "Complete",
            "chunks":   full_chunks,   # full data kept server-side for /detect-chunk
            "summary":  final_summary,
        })
        _job_store.persist(job_id)

        # ── Attach word counts before stripping text fields ───────────────────
        # Count words from old_text/new_text while they're still present.
        # These lightweight integers travel in the slim response so the frontend
        # can show a mismatch warning without needing the full text.
        for chunk in full_chunks:
            ot = chunk.get("old_text") or ""
            nt = chunk.get("new_text") or ""
            chunk["old_word_count"] = len(ot.split()) if ot else 0
            chunk["new_word_count"] = len(nt.split()) if nt else 0

        # Strip heavy fields from HTTP response — the browser only needs
        # metadata to render the chunk list. Full text / XML is fetched
        # on demand when the user opens a specific chunk.
        # detected_changes is NOT stripped — ComparePanel needs it on first open.
        _HEAVY = {"old_text", "new_text", "xml_content", "xml_chunk_file"}
        slim_chunks = [
            {k: v for k, v in chunk.items() if k not in _HEAVY}
            for chunk in full_chunks
        ]

        return {
            "success":     True,
            "job_id":      job_id,
            "status":      "done",
            "source_name": source_name.strip(),
            "pdf_chunks":  slim_chunks,
            "summary":     final_summary,
            "old_pdf_chunk_count": result.get("old_pdf_chunk_count", 0),
            "new_pdf_chunk_count": result.get("new_pdf_chunk_count", 0),
            "xml_chunk_count":     result.get("xml_chunk_count", 0),
            "folder_structure":    result.get("folder_structure", {}),
        }
    except Exception as exc:
        _jobs[job_id].update({"status": "error", "stage": "Failed", "error": str(exc)})
        _job_store.persist(job_id)
        raise HTTPException(status_code=422, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# 3. GET CHUNKS — list all chunks for a job
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/chunks")
async def get_chunks_endpoint(job_id: str):
    """
    Return the chunk list for a completed job.
    Powers the ChunkPanel list UI: Changed / No changes badges.

    GET /compare/chunks?job_id=<uuid>
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # Lightweight rows — exclude full xml_content for performance
    chunk_list = [
        {
            "index":          c.get("index"),
            "label":          c.get("label"),
            "filename":       c.get("filename"),
            "has_changes":    c.get("has_changes", False),
            "change_types":   c.get("change_types", []),
            "change_summary": c.get("change_summary", {"addition": 0, "removal": 0, "modification": 0}),
            "xml_tag":        c.get("xml_tag"),
            "xml_size":       c.get("xml_size", 0),
        }
        for c in job.get("chunks", [])
    ]

    return {
        "success":     True,
        "job_id":      job_id,
        "status":      job["status"],
        "source_name": job["source_name"],
        "summary":     job.get("summary"),
        "chunks":      chunk_list,
        "progress":    job.get("progress", 0),
    }


@router.get("/progress")
async def get_progress_endpoint(job_id: str):
    """
    Lightweight progress poll — called every ~500ms by the frontend.
    Returns current progress % (0-100), status, and a human-readable stage label.

    GET /compare/progress?job_id=<uuid>
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return {
        "success":  True,
        "job_id":   job_id,
        "status":   job["status"],           # uploaded | processing | done | error
        "progress": job.get("progress", 0),  # 0-100
        "stage":    job.get("stage", ""),    # human-readable current step
        "error":    job.get("error"),
    }




class DetectChunkRequest(BaseModel):
    job_id:      str
    chunk_index: int   # 1-based chunk index


@router.post("/detect-chunk")
async def detect_chunk_endpoint(payload: DetectChunkRequest):
    """
    Run per-span change detection for a single chunk using PDFs already stored
    in the job — no file re-upload needed.

    POST /compare/detect-chunk
    Body: { job_id, chunk_index }

    Returns the same shape as POST /compare/detect.
    """
    job = _jobs.get(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {payload.job_id} not found")

    old_bytes = job.get("_old_bytes")
    new_bytes = job.get("_new_bytes")
    if not old_bytes or not new_bytes:
        raise HTTPException(
            status_code=409,
            detail="PDF bytes no longer in memory. Re-upload files to use /detect instead.",
        )

    chunks: list[dict] = job.get("chunks", [])
    chunk = next((c for c in chunks if c.get("index") == payload.chunk_index), None)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk {payload.chunk_index} not found")

    # ── Fast path: return pre-computed results if available ───────────────────
    # /chunk-direct pre-runs detect_pdf_changes for every changed chunk and
    # stores the results on the chunk object. Return them immediately without
    # re-running the full diff pipeline.
    cached_changes = chunk.get("detected_changes")
    if cached_changes is not None and len(cached_changes) > 0:
        xml_content_cached = chunk.get("xml_content", "") or chunk.get("xml_chunk_file", "") or ""
        return {
            "success":       True,
            "job_id":        payload.job_id,
            "chunk_index":   payload.chunk_index,
            "changes":       cached_changes,
            "xml_content":   xml_content_cached,
            "summary":       chunk.get("detect_summary", {
                "addition": 0, "removal": 0, "modification": 0,
                "emphasis": 0, "mismatch": 0,
            }),
            "baseline":      chunk.get("detect_baseline", "old_pdf"),
            "old_full_text": chunk.get("old_text", ""),
            "new_full_text": chunk.get("new_text", ""),
        }

    xml_content = chunk.get("xml_content", "") or chunk.get("xml_chunk_file", "") or ""
    xml_bytes = xml_content.encode("utf-8") if xml_content else b""

    old_text = chunk.get("old_text", "")
    new_text = chunk.get("new_text", "")

    old_page_start = chunk.get("old_page_start")
    old_page_end   = chunk.get("old_page_end")
    new_page_start = chunk.get("new_page_start")
    new_page_end   = chunk.get("new_page_end")

    page_ranges_known = all(v is not None for v in [
        old_page_start, old_page_end, new_page_start, new_page_end
    ])

    try:
        from fastapi.concurrency import run_in_threadpool

        def _detect() -> dict:
            import re as _re
            import difflib

            # ── Noise-line filter ──────────────────────────────────────────────
            # These patterns match lines that are purely structural/editorial
            # markers — page headers, section titles that ARE the chunk boundary
            # (already handled by trimming), footnote amendment annotations, etc.
            # They must NOT match content lines that happen to contain these words
            # mid-sentence.  We therefore require the pattern to match the FULL line
            # (or nearly so) rather than just the start, and we keep the list tight.
            _NOISE_PAT = _re.compile(
                r'^(?:'
                r'\d{1,4}$'                                   # lone page/footnote number
                r'|page\s+\d+\s*(?:of\s+\d+)?$'              # "Page 3 of 10"
                r'|[fc]\d+\s'                                 # F1 C2 amendment markers (followed by space)
                r'|[fc]\d+$'                                  # F1 C2 at end of line
                r'|textual\s+amendments?\s*$'
                r'|modifications?\s+etc\.?\s*$'
                r'|commencement\s*$'
                r'|extent\s*$'
                # FIX Bug 6: running page headers, e.g. "PART 2  EMPLOYMENT INCOME: CHARGE TO TAX"
                # These appear at the top of every page in the old/new PDF and differ between
                # editions when section titles are renumbered — causing spurious modifications.
                r'|(?:part|chapter|section|schedule)\s+\d+[a-z]?\s*[:\-–]\s*\S'
                r'|(?:part|chapter|section|schedule)\s+\d+[a-z]?\s+[A-Z][A-Z ,;]{3,}'
                r'|word(?:s)?\s+in\s+s\.\s*\d'               # "Words in s. 1(2)..."
                r'|(?:s\.|pt\.|sch\.|art\.|reg\.|para\.)\s*\d+[a-z]?\s*[\(\[\{]'  # "S. 1(2)..." short refs
                r'|inserted\s+(?:by|with\s+effect)'
                r'|omitted\s+(?:by|with\s+effect)'
                r'|repealed\s+(?:by|with\s+effect)'
                r'|substituted\s+(?:by|with\s+effect)'
                r'|applied\s+\(with\s+effect'
                r'|with\s+effect\s+in\s+accordance\s+with'
                r'|in\s+accordance\s+with\s+s\.\s*\d'
                r'|by\s+(?:finance|income|corporation|equality|revenue|taxation|tax)\s+act\b'
                r'|\(with\s+(?:sch|art|reg)\.'
                r'|\([a-z]\.\s*\d+[,\s]'                     # "(c. 4, ..." act citation
                r'|\(s\.i\.\s*\d{4}'                         # "(S.I. 2017/..."
                r'|s\.i\.\s*\d{4}/\d+'                       # "S.I. 2017/353"
                r')',
                _re.IGNORECASE,
            )

            def _strip_leading_num(s: str) -> str:
                return _re.sub(r'^\d+[a-z]?\s+', '', s, count=1)

            # Additional pattern: amendment footnote fragments that appear
            # as multi-line continuations (e.g. 'Word in' / 's. 1(1)(a)' / 'substituted...')
            _AMEND_FRAG = _re.compile(
                r'^(?:'
                r'word(?:s)?\s+in$'                        # 'Word in' (cont. of F1 annotation)
                r'|s\.\s*\d+[a-z]?(?:\([^)]+\))*\s*$'   # 's. 1(1)(a)' standalone
                r'|sch\.\s*\d+\s+para(?:s?\.)?\s+\d'    # 'Sch. 2 paras. 52-59'
                r'|paras?\.\s*\d'                          # 'para. 3'
                r'|(?:of\s+)?the\s+amending\s+act'        # 'of the amending Act'
                r'|\)\s*by\s+(?:finance|income|tax)\s+act'  # ') by Finance Act'
                r'|\(c\.\s*\d'                            # '(c. 11)' act citation
                r')',
                _re.IGNORECASE,
            )

            def _is_noise_line(s: str) -> bool:
                # Only drop very short lines that are purely numeric/symbolic
                # (like lone page numbers or single letters).  Raise threshold
                # from 10 → 6 so we keep short-but-real content like "(a) text".
                if len(s) <= 6 and not _re.search(r'[a-z]{2,}', s, _re.I):
                    return True
                s2 = _strip_leading_num(s)
                if bool(_NOISE_PAT.match(s2.lower())):
                    return True
                # Also filter amendment footnote fragments
                return bool(_AMEND_FRAG.match(s2.strip()))

            _trail = _re.compile(r'[,;]?\s*\b(?:and|or|but|nor|yet)\s*$|[,;:–—\-]\s*$', _re.IGNORECASE)
            _lead  = _re.compile(r'^\s*\b(?:and|or|but|nor)\b\s*', _re.IGNORECASE)
            def _norm_line(s: str) -> str:
                """Normalize a line for comparison - strip leading numbers, trailing connectors/punctuation."""
                s = _strip_leading_num(s)
                # Do NOT strip sub-item markers (a)/(1) — they are legally significant.
                # Stripping them would cause (a) text X and (b) text X to match as equal.
                s = _trail.sub('', _lead.sub('', s.lower())).strip()
                return s

            # ── Anchor-trim chunk text ───────────────────────────────────────
            old_anchor   = chunk.get("old_anchor") or chunk.get("old_heading") or ""
            new_anchor   = chunk.get("new_anchor") or chunk.get("new_heading") or ""
            chunk_tag    = chunk.get("xml_tag", "") or ""   # e.g. "part", "chapter"

            # ── Use XML as the comparison baseline when available ────────────
            # The XML represents the accepted/approved state of the document —
            # it is the "what should be" ground truth derived from the OLD PDF.
            # Comparing OLD PDF text → NEW PDF text introduces hundreds of false
            # positives from PDF rendering differences (reflow, hyphenation,
            # ligatures, running headers) that are NOT real content changes.
            #
            # Strategy:
            #   • If xml_content is present → extract its plain text and use
            #     that as the "old" baseline.  Compare XML text → NEW PDF text.
            #   • If no xml_content → fall back to OLD PDF text → NEW PDF text.
            #
            # This means unchanged chunks (XML = NEW PDF) produce zero changes,
            # and truly changed lines stand out cleanly against the clean XML baseline.
            baseline_text = old_text   # default: OLD PDF text
            baseline_label = "old_pdf"

            if xml_content and xml_content.strip():
                try:
                    import xml.etree.ElementTree as _ET
                    import unicodedata as _ud
                    _LIG = str.maketrans({
                        "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
                        "\ufb03": "ffi", "\ufb04": "ffl",
                        "\u00ad": "", "\u00a0": " ",
                        "\u2019": "'", "\u2018": "'",
                        "\u201c": '"', "\u201d": '"',
                        "\u2013": "-", "\u2014": "-", "\u2026": "...",
                        "\u2022": " ", "\u00b7": " ",
                    })
                    def _xml_to_plain(xml_str: str) -> str:
                        """Extract plain text from XML, preserving paragraph structure."""
                        try:
                            root = _ET.fromstring(xml_str)
                        except _ET.ParseError:
                            # Strip tags with regex as fallback
                            import re as _re2
                            return _re2.sub(r"<[^>]+>", " ", xml_str)
                        lines_out: list[str] = []
                        for elem in root.iter():
                            # Treat block-level elements as paragraph breaks
                            tag = (elem.tag or "").lower().split("}")[-1]
                            text = (elem.text or "").strip()
                            tail = (elem.tail or "").strip()
                            if text:
                                norm = _ud.normalize("NFKC", text).translate(_LIG)
                                norm = " ".join(norm.split())
                                if norm:
                                    lines_out.append(norm)
                            if tail:
                                norm = _ud.normalize("NFKC", tail).translate(_LIG)
                                norm = " ".join(norm.split())
                                if norm:
                                    lines_out.append(norm)
                        return "\n".join(lines_out)

                    xml_plain = _xml_to_plain(xml_content)
                    if xml_plain.strip():
                        baseline_text = xml_plain
                        baseline_label = "xml"
                except Exception as _xe:
                    import logging
                    logging.getLogger(__name__).warning("XML→plain failed: %s", _xe)
                    # keep baseline_text = old_text

            def _trim_to_anchor_text(text: str, anchor: str, tag_name: str = "") -> str:
                """
                Drop ALL lines that appear before (and NOT including) the anchor heading.

                Strategy (in order of priority):
                  0. Strict structural match — e.g. "Part 2" must match EXACTLY
                     "Part 2" or "Part 2A", NOT "Part 2: Employment Income" running
                     headers that exist in both old and new with different sub-titles.
                     This prevents the fuzzy pass from landing on a running header
                     that appears earlier in the text than the real section start.
                  1. Exact line match (case-insensitive, stripped)
                  2. Anchor is a substring of the line OR line is a substring of anchor
                  3. Fuzzy word-overlap match (≥80% of anchor words — raised from 60%
                     to avoid matching lines that merely share common words like "part"
                     or "chapter" with the anchor label).

                The function returns text starting AT the anchor line (inclusive).
                If no anchor is found the original text is returned unchanged.
                """
                if not anchor or not text:
                    return text
                needle = anchor.strip().lower()
                lines = text.splitlines()

                # Build a regex that matches structural headings for this tag
                # e.g. tag_name="part" → matches lines like "Part 2", "PART II", "Part 2A"
                tag_lc = (tag_name or "").lower().strip()
                _struct_pat = None
                if tag_lc in ("part", "chapter", "schedule", "article", "section"):
                    _struct_pat = _re.compile(
                        rf'^\s*{tag_lc}\s+[\dIVXivx]+[a-zA-Z]?\b',
                        _re.IGNORECASE,
                    )

                # Pass 0 – strict structural match: "Part 2" must equal the line
                # exactly (ignoring case/whitespace) OR be the first token group on
                # the line with nothing else meaningful following.
                # This is critical: running headers like "PART 2  EMPLOYMENT INCOME"
                # must NOT match when the anchor is just "Part 2".
                candidate_idx = -1
                if _struct_pat and _re.fullmatch(
                    rf'\s*{_re.escape(tag_lc)}\s+[\dIVXivx]+[a-zA-Z]?\s*',
                    needle, _re.IGNORECASE
                ):
                    for i, ln in enumerate(lines):
                        ll = ln.strip().lower()
                        if not ll:
                            continue
                        # Accept only lines where the structural heading IS the
                        # whole line (no trailing title text like ": Employment…")
                        if _re.fullmatch(
                            rf'{_re.escape(tag_lc)}\s+[\dIVXivx]+[a-zA-Z]?',
                            ll, _re.IGNORECASE
                        ):
                            # Make sure this heading's ordinal matches the anchor's
                            needle_ord = _re.search(r'[\dIVXivx]+[a-zA-Z]?$', needle)
                            line_ord   = _re.search(r'[\dIVXivx]+[a-zA-Z]?$', ll)
                            if needle_ord and line_ord and needle_ord.group().lower() == line_ord.group().lower():
                                candidate_idx = i
                                break

                # Pass 1 – exact / substring match
                if candidate_idx < 0:
                    for i, ln in enumerate(lines):
                        ll = ln.strip().lower()
                        if not ll:
                            continue
                        if needle == ll or needle[:60] in ll or ll[:60] in needle:
                            candidate_idx = i
                            break

                # Pass 2 – fuzzy word-overlap (≥80% of anchor words match).
                # Threshold raised from 60% → 80% to prevent short anchors like
                # "Part 2" from matching running-header lines that contain "Part".
                if candidate_idx < 0:
                    anchor_words = [w for w in needle.split() if len(w) > 3]
                    if anchor_words:
                        threshold = max(1, round(len(anchor_words) * 0.80))  # FIX: was 0.60
                        for i, ln in enumerate(lines):
                            ll = ln.strip().lower()
                            if sum(1 for w in anchor_words if w in ll) >= threshold:
                                candidate_idx = i
                                break

                if candidate_idx < 0:
                    # No anchor found — return full text (safe fallback)
                    return text

                # Pass 3 – structural guard: if there is a structural heading of the
                # same tag type BEFORE our candidate that does NOT match the anchor,
                # it means that heading belongs to a previous chunk bleeding in via
                # page overlap.  Advance candidate_idx to skip past it.
                if _struct_pat and candidate_idx > 0:
                    for i in range(candidate_idx - 1, -1, -1):
                        ll = lines[i].strip().lower()
                        if not ll:
                            continue
                        if _struct_pat.match(ll) and ll != needle:
                            # Found a prior structural heading that isn't ours —
                            # our candidate_idx is already past it, which is correct.
                            break

                return "\n".join(lines[candidate_idx:])

            # Use distinct names so Python doesn't treat old_text/new_text as
            # locals for the whole _detect() function (would cause UnboundLocalError
            # because they are read from the outer scope before the trim call).
            # When baseline is XML, skip anchor-trimming (XML is already clean).
            if baseline_label == "xml":
                old_text_trimmed = baseline_text
            else:
                old_text_trimmed = _trim_to_anchor_text(baseline_text, old_anchor, chunk_tag)
            new_text_trimmed = _trim_to_anchor_text(new_text, new_anchor, chunk_tag)

            # ── Text diff (always authoritative) ────────────────────────────
            old_lines = [ln.strip() for ln in old_text_trimmed.splitlines()
                         if ln.strip() and not _is_noise_line(ln.strip())]
            new_lines = [ln.strip() for ln in new_text_trimmed.splitlines()
                         if ln.strip() and not _is_noise_line(ln.strip())]

            # ── Sentence reflow joining ──────────────────────────────────────
            # PyMuPDF splits long sentences at the PDF column width, so the same
            # sentence may be broken across different lines in old vs new PDFs
            # when text reflows after amendments.  Join consecutive lines that
            # form a single sentence before diffing so reflow alone never produces
            # a false-positive change.
            #
            # A line is a "continuation" (not a sentence boundary) when:
            #   • it does NOT end with sentence-terminal punctuation (. ! ? —)
            #   • AND the next line does NOT start with a sub-item marker (a) (b) (1)
            #     or a structural keyword (Part/Chapter/Section/Schedule)
            #   • AND both lines together are shorter than 400 chars (guards against
            #     accidentally joining two genuinely separate short provisions)
            _SENT_END   = _re.compile(r'[.!?—]\s*$')
            _ITEM_START = _re.compile(
                r'^\s*(?:\([a-z]{1,2}\)|\([0-9]+[a-z]?\)|\d+[a-z]?\.|[a-z]{1,2}\))',
                _re.IGNORECASE,
            )
            _STRUCT_START = _re.compile(
                r'^\s*(?:part|chapter|schedule|article|section)\s+[\dIVXivx]+',
                _re.IGNORECASE,
            )

            # Pattern to detect amendment annotation starts — don't join these
            _AMEND_START = _re.compile(
                r'^[FCfc]\d+\s|^[FCfc]\d+$|^word(?:s)?\s+in\s|^substituted|^inserted|^repealed|^omitted|^applied',
                _re.IGNORECASE,
            )

            def _join_continuation_lines(lines: list[str]) -> list[str]:
                """Merge lines that are continuations of the previous sentence."""
                if not lines:
                    return lines
                out: list[str] = []
                i = 0
                while i < len(lines):
                    cur = lines[i]
                    # Never join if either line looks like an amendment annotation
                    while (
                        i + 1 < len(lines)
                        and not _SENT_END.search(cur)
                        and not _ITEM_START.match(lines[i + 1])
                        and not _STRUCT_START.match(lines[i + 1])
                        and not _AMEND_START.match(cur)
                        and not _AMEND_START.match(lines[i + 1])
                        and len(cur) + len(lines[i + 1]) < 400
                    ):
                        i += 1
                        cur = cur.rstrip() + " " + lines[i].lstrip()
                    out.append(cur)
                    i += 1
                return out

            old_lines = _join_continuation_lines(old_lines)
            new_lines = _join_continuation_lines(new_lines)

            old_norms = [_norm_line(l) for l in old_lines]
            new_norms = [_norm_line(l) for l in new_lines]

            # autojunk=False: _isjunk only skips bare single-char / pure-punctuation
            # tokens (len<5).  Keeping the threshold tight is critical — the previous
            # value of 12 excluded sub-item markers like "(a) pension income" from
            # being used as alignment anchors, causing wholesale misalignment of
            # sub-paragraphs and was a major source of false-positive changes.
            def _isjunk(s: str) -> bool:
                return len(s) < 5   # FIX: was 12 — only skip bare chars/punctuation

            changes: list[dict] = []
            cid = 0
            matcher = difflib.SequenceMatcher(_isjunk, old_norms, new_norms, autojunk=False)

            for op, i1, i2, j1, j2 in matcher.get_opcodes():
                if op == "equal":
                    continue
                elif op == "insert":
                    for k in range(j1, j2):
                        cid += 1
                        changes.append({
                            "id": f"chg_{cid:04d}", "type": "addition",
                            "text": new_lines[k], "old_text": None, "new_text": new_lines[k],
                            "page": new_page_start or 1, "old_page": None,
                            "new_page": new_page_start or 1,
                            "bbox": None, "old_bbox": None, "new_bbox": None,
                            "old_formatting": None, "new_formatting": None,
                            "suggested_xml": f"<ins>{new_lines[k]}</ins>",
                        })
                elif op == "delete":
                    for k in range(i1, i2):
                        cid += 1
                        changes.append({
                            "id": f"chg_{cid:04d}", "type": "removal",
                            "text": old_lines[k], "old_text": old_lines[k], "new_text": None,
                            "page": old_page_start or 1, "old_page": old_page_start or 1,
                            "new_page": None,
                            "bbox": None, "old_bbox": None, "new_bbox": None,
                            "old_formatting": None, "new_formatting": None,
                            "suggested_xml": f"<del>{old_lines[k]}</del>",
                        })
                elif op == "replace":
                    paired = min(i2 - i1, j2 - j1)
                    for k in range(paired):
                        on = old_norms[i1+k]
                        nn = new_norms[j1+k]
                        if on == nn:
                            continue
                        ow = set(on.split())
                        nw = set(nn.split())
                        diff_words = (ow - nw) | (nw - ow)
                        overlap = len(ow & nw) / max(len(ow | nw), 1)

                        # Require at least 1 meaningful changed word (len ≥ 2) OR
                        # a char-level ratio < 0.85 — catches single-word substitutions
                        # like "offices" → "employers" that the old len>3 guard missed.
                        meaningful = [w for w in diff_words if len(w) >= 2]
                        char_ratio = difflib.SequenceMatcher(None, on, nn).ratio()
                        if not meaningful or (len(meaningful) == 1 and char_ratio > 0.92):
                            # Single cosmetic difference (punctuation/hyphen) — skip
                            continue
                        # High-overlap lines are likely reflow/formatting noise only
                        if overlap > 0.88 and char_ratio > 0.90:
                            continue
                        # FIX (Bug 4): when lines are too dissimilar to be a
                        # "modification" (overlap ≤ 0.25), emit BOTH removal and
                        # addition.  The old code emitted only "addition", silently
                        # hiding the removed content and producing ghost additions.
                        if overlap > 0.25:
                            # Similar enough — treat as a modification
                            cid += 1
                            changes.append({
                                "id": f"chg_{cid:04d}", "type": "modification",
                                "text": new_lines[j1+k],
                                "old_text": old_lines[i1+k], "new_text": new_lines[j1+k],
                                "page": new_page_start or 1,
                                "old_page": old_page_start or 1, "new_page": new_page_start or 1,
                                "bbox": None, "old_bbox": None, "new_bbox": None,
                                "old_formatting": None, "new_formatting": None,
                                "suggested_xml": f"<del>{old_lines[i1+k]}</del><ins>{new_lines[j1+k]}</ins>",
                            })
                        else:
                            # Too dissimilar — emit explicit removal then addition
                            cid += 1
                            changes.append({
                                "id": f"chg_{cid:04d}", "type": "removal",
                                "text": old_lines[i1+k], "old_text": old_lines[i1+k], "new_text": None,
                                "page": old_page_start or 1, "old_page": old_page_start or 1, "new_page": None,
                                "bbox": None, "old_bbox": None, "new_bbox": None,
                                "old_formatting": None, "new_formatting": None,
                                "suggested_xml": f"<del>{old_lines[i1+k]}</del>",
                            })
                            cid += 1
                            changes.append({
                                "id": f"chg_{cid:04d}", "type": "addition",
                                "text": new_lines[j1+k], "old_text": None, "new_text": new_lines[j1+k],
                                "page": new_page_start or 1, "old_page": None, "new_page": new_page_start or 1,
                                "bbox": None, "old_bbox": None, "new_bbox": None,
                                "old_formatting": None, "new_formatting": None,
                                "suggested_xml": f"<ins>{new_lines[j1+k]}</ins>",
                            })
                    for k in range(paired, i2 - i1):
                        cid += 1
                        changes.append({
                            "id": f"chg_{cid:04d}", "type": "removal",
                            "text": old_lines[i1+k], "old_text": old_lines[i1+k], "new_text": None,
                            "page": old_page_start or 1, "old_page": old_page_start or 1, "new_page": None,
                            "bbox": None, "old_bbox": None, "new_bbox": None,
                            "old_formatting": None, "new_formatting": None,
                            "suggested_xml": f"<del>{old_lines[i1+k]}</del>",
                        })
                    for k in range(paired, j2 - j1):
                        cid += 1
                        changes.append({
                            "id": f"chg_{cid:04d}", "type": "addition",
                            "text": new_lines[j1+k], "old_text": None, "new_text": new_lines[j1+k],
                            "page": new_page_start or 1, "old_page": None, "new_page": new_page_start or 1,
                            "bbox": None, "old_bbox": None, "new_bbox": None,
                            "old_formatting": None, "new_formatting": None,
                            "suggested_xml": f"<ins>{new_lines[j1+k]}</ins>",
                        })

            # ── Layout diff: enrich changes with bbox + harvest emphasis ────────
            # Only run when page ranges are known.
            # Two jobs:
            #   1. Enrich text-diff changes with bbox from layout (was the only job before).
            #   2. NEW: collect emphasis changes from layout (bold/italic/underline
            #      flips on lines whose text is identical).  Plain-text extraction
            #      has no formatting metadata so emphasis can only come from here.
            if page_ranges_known:
                try:
                    layout_result = compare_pdfs_layout(
                        old_bytes, new_bytes, xml_bytes,
                        old_page_start=old_page_start, old_page_end=old_page_end,
                        new_page_start=new_page_start, new_page_end=new_page_end,
                    )
                    # Build lookup: normalized text → layout change (for bbox enrichment)
                    layout_by_text: dict[str, dict] = {}
                    for lc in layout_result.get("changes", []):
                        for key in ("old_text", "new_text", "text"):
                            t = (lc.get(key) or "").strip().lower()[:80]
                            if t and len(t) > 5:
                                layout_by_text[t] = lc

                    # 1. Enrich text-diff changes with bbox from layout
                    for c in changes:
                        search_key = (c.get("new_text") or c.get("old_text") or c.get("text") or "").strip().lower()[:80]
                        if search_key and search_key in layout_by_text:
                            lc = layout_by_text[search_key]
                            c["bbox"]     = lc.get("bbox")
                            c["old_bbox"] = lc.get("old_bbox")
                            c["new_bbox"] = lc.get("new_bbox")
                            c["old_page"] = lc.get("old_page") or c["old_page"]
                            c["new_page"] = lc.get("new_page") or c["new_page"]
                            c["page"]     = lc.get("page")     or c["page"]

                    # 2. Harvest emphasis changes from layout diff.
                    # A layout emphasis change means: text is identical across old/new
                    # but bold/italic/underline differs on that line.  The text diff
                    # above operates on plain text so it misses these entirely.
                    # De-duplicate against text-diff changes by normalised text so we
                    # never produce a duplicate entry for the same line.
                    text_diff_keys: set[str] = set()
                    for c in changes:
                        for key in ("old_text", "new_text", "text"):
                            t = (c.get(key) or "").strip().lower()[:80]
                            if t:
                                text_diff_keys.add(t)

                    for lc in layout_result.get("changes", []):
                        if lc.get("type") != "emphasis":
                            continue
                        # Skip if the same text was already caught by the text diff
                        # (shouldn't happen — emphasis means text is equal — but guard anyway)
                        lc_key = (lc.get("new_text") or lc.get("old_text") or lc.get("text") or "").strip().lower()[:80]
                        if lc_key in text_diff_keys:
                            continue
                        if not lc_key or len(lc_key) <= 4:
                            continue

                        # Build the emphasis list from new_formatting
                        fmt_new = lc.get("new_formatting") or {}
                        emphasis_flags: list[str] = []
                        if fmt_new.get("bold"):
                            emphasis_flags.append("bold")
                        if fmt_new.get("italic"):
                            emphasis_flags.append("italic")
                        # pdfminer Line objects expose bold/italic only; underline is
                        # not reliably extracted by pdfminer so omit to avoid noise.

                        cid += 1
                        emphasis_entry: dict = {
                            "id":             f"chg_{cid:04d}",
                            "type":           "emphasis",
                            "text":           lc.get("text") or lc.get("new_text") or "",
                            "old_text":       lc.get("old_text"),
                            "new_text":       lc.get("new_text"),
                            "page":           lc.get("page") or new_page_start or 1,
                            "old_page":       lc.get("old_page") or old_page_start or 1,
                            "new_page":       lc.get("new_page") or new_page_start or 1,
                            "bbox":           lc.get("bbox"),
                            "old_bbox":       lc.get("old_bbox"),
                            "new_bbox":       lc.get("new_bbox"),
                            "old_formatting": lc.get("old_formatting"),
                            "new_formatting": lc.get("new_formatting"),
                            "emphasis":       emphasis_flags,
                            "suggested_xml":  lc.get("suggested_xml"),
                        }
                        changes.append(emphasis_entry)
                        text_diff_keys.add(lc_key)   # prevent double-adding

                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning("layout diff (bbox+emphasis) failed: %s", e)

            summary = {"addition": 0, "removal": 0, "modification": 0, "emphasis": 0}
            for c in changes:
                t = c["type"]
                if t in summary:
                    summary[t] += 1
                # Tag each change with the baseline source for UI display
                c["baseline"] = baseline_label


            # ── Post-diff noise filter ──────────────────────────────────
            # When >80 changes remain, strip two categories of artefact:
#  A — modifications where only the amendment/footnote marker changed (F1→F2)
#  B — near-identical lines (char ratio > 0.94) with no meaningful word diff
            if len(changes) > 80:
                _AMEND_MARKER = _re.compile(
                    r'(?:^[FCfc]\d+\s+|^[FCfc]\d+$|\s+[FCfc]\d+$)'
                )
                def _strip_markers(s):
                    return _AMEND_MARKER.sub('', s).strip()

                denoised = []
                for _c in changes:
                    if _c['type'] not in ('modification', 'mismatch'):
                        denoised.append(_c)
                        continue
                    _ot = (_c.get('old_text') or '').strip()
                    _nt = (_c.get('new_text') or '').strip()
                    if not _ot or not _nt:
                        denoised.append(_c)
                        continue
                    # Pass A: only amendment marker changed — drop
                    if _strip_markers(_ot) == _strip_markers(_nt):
                        continue
                    # Pass B: cosmetic diff only — drop
                    _cr = difflib.SequenceMatcher(None, _ot.lower(), _nt.lower()).ratio()
                    if _cr > 0.94:
                        _ow = set(w for w in _strip_markers(_ot).lower().split() if len(w) >= 3)
                        _nw = set(w for w in _strip_markers(_nt).lower().split() if len(w) >= 3)
                        if not ((_ow - _nw) | (_nw - _ow)):
                            continue
                    denoised.append(_c)

                if len(denoised) < len(changes):
                    import logging as _lg
                    _lg.getLogger(__name__).info(
                        'post-diff denoise: %d -> %d changes (chunk %s)',
                        len(changes), len(denoised), getattr(payload, 'chunk_index', '?'),
                    )
                    changes = denoised
                    summary = {'addition': 0, 'removal': 0, 'modification': 0, 'emphasis': 0}
                    for _c in changes:
                        if _c['type'] in summary:
                            summary[_c['type']] += 1

            # Cap at 200 changes — if more, something went wrong with noise filtering
            # and rendering 1000+ items freezes the browser
            MAX_CHANGES = 200
            if len(changes) > MAX_CHANGES:
                import logging
                logging.getLogger(__name__).warning(
                    "detect-chunk: %d changes truncated to %d (chunk %s)",
                    len(changes), MAX_CHANGES, payload.chunk_index,
                )
                changes = changes[:MAX_CHANGES]
                # Recount after truncation
                summary = {"addition": 0, "removal": 0, "modification": 0, "emphasis": 0}
                for c in changes:
                    t = c["type"]
                    if t in summary:
                        summary[t] += 1

            return {
                "changes":       changes,
                "summary":       summary,
                "xml_content":   xml_content,
                "baseline":      baseline_label,  # "xml" or "old_pdf"
                # Full plain text for the text-diff viewer (one line per entry)
                "old_full_text": "\n".join(old_text_trimmed.splitlines()),
                "new_full_text": "\n".join(new_text_trimmed.splitlines()),
            }

        result = await run_in_threadpool(_detect)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Detection failed: {exc}")

    return {
        "success":      True,
        "job_id":       payload.job_id,
        "chunk_index":  payload.chunk_index,
        "changes":      result.get("changes", []),
        "xml_content":  result.get("xml_content", xml_content),
        "summary":      result.get("summary", {}),
        "baseline":     result.get("baseline", "old_pdf"),
        "old_full_text": result.get("old_full_text", ""),
        "new_full_text": result.get("new_full_text", ""),
    }



@router.get("/compare/{chunk_id}")
async def get_compare_chunk_endpoint(chunk_id: str, job_id: str):
    """
    Return full comparison data for a single chunk.
    Called when user clicks a "Changed" row to open the Compare module.

    GET /compare/compare/{chunk_id}?job_id=<uuid>
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    chunks = job.get("chunks", [])
    try:
        idx   = int(chunk_id)
        chunk = next((c for c in chunks if c.get("index") == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c.get("filename") == chunk_id), None)

    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk {chunk_id} not found")

    return {
        "success":     True,
        "job_id":      job_id,
        "chunk_id":    chunk_id,
        "source_name": job["source_name"],
        "chunk":       chunk,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5. SAVE XML — persist edited XML for a chunk after user review
# ─────────────────────────────────────────────────────────────────────────────

class SaveXmlRequest(BaseModel):
    job_id:      str
    chunk_id:    str
    xml_content: str
    has_changes: Optional[bool] = None


@router.post("/save-xml")
async def save_xml_endpoint(payload: SaveXmlRequest):
    """
    Persist edited XML content for a chunk after review in the XML editor.
    Validates before saving. In production writes to CHUNKED/ or COMPARE/ on disk.
    """
    job = _jobs.get(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {payload.job_id} not found")

    validation = validate_xml_chunk(payload.xml_content)
    if not validation.get("valid", True):
        raise HTTPException(
            status_code=422,
            detail={"message": "Invalid XML", "errors": validation.get("errors", [])},
        )

    chunks = job.get("chunks", [])
    try:
        idx   = int(payload.chunk_id)
        chunk = next((c for c in chunks if c.get("index") == idx), None)
    except ValueError:
        chunk = next((c for c in chunks if c.get("filename") == payload.chunk_id), None)

    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk {payload.chunk_id} not found")

    chunk["xml_chunk_file"] = payload.xml_content
    chunk["xml_content"]    = payload.xml_content
    if payload.has_changes is not None:
        chunk["has_changes"] = payload.has_changes
    _job_store.persist(payload.job_id)

    return {
        "success":    True,
        "job_id":     payload.job_id,
        "chunk_id":   payload.chunk_id,
        "filename":   chunk.get("filename"),
        "validation": validation,
        "message":    "XML saved successfully",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 6. CHUNK (XML only — legacy)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/chunk")
async def chunk_endpoint(
    file:          UploadFile    = File(...),
    tag_name:      str           = Form(...),
    attribute:     Optional[str] = Form(None),
    value:         Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    identifier:    Optional[str] = Form(None),
):
    """Chunk an XML file by tag name (legacy, XML-only)."""
    content_bytes = await file.read()
    try:
        xml_str = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="File must be valid UTF-8 XML")

    try:
        chunks = chunk_xml(
            xml_content=xml_str,
            tag_name=tag_name,
            attribute=attribute or None,
            value=value or None,
            max_file_size=max_file_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success":       True,
        "identifier":    identifier or file.filename,
        "filename":      file.filename,
        "tag_name":      tag_name,
        "attribute":     attribute,
        "value":         value,
        "max_file_size": max_file_size,
        "total_chunks":  len(chunks),
        "chunks":        chunks,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 7. CHUNK PDF — LangChain PDF + XML chunking pipeline
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/chunk/pdf")
async def chunk_pdf_endpoint(
    old_pdf:       UploadFile    = File(...),
    new_pdf:       UploadFile    = File(...),
    xml_file:      UploadFile    = File(...),
    tag_name:      str           = Form(...),
    source_name:   str           = Form(...),
    attribute:     Optional[str] = Form(None),
    value:         Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    chunk_size:    int           = Form(1500),
    chunk_overlap: int           = Form(150),
):
    """
    LangChain-powered pipeline (single-request, no job queue):
      1. Extract text from OLD and NEW PDFs (PyMuPDF)
      2. Split both with RecursiveCharacterTextSplitter
      3. Chunk the XML file by tag_name
      4. Align PDF chunks ↔ XML chunks by index
      5. Detect changes per chunk (NEW vs OLD)
      6. Return XML chunks named: SourceName_innod.NNNNN.xml
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        xml_str = xml_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="XML file must be valid UTF-8")

    try:
        result = chunk_pdfs_and_xml(
            old_pdf_bytes=old_bytes,
            new_pdf_bytes=new_bytes,
            xml_content=xml_str,
            tag_name=tag_name,
            source_name=source_name,
            attribute=attribute or None,
            value=value or None,
            max_file_size=max_file_size,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success":      True,
        "source_name":  source_name,
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_file.filename,
        **result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 8. DOWNLOAD individual XML chunk
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/chunk/download")
async def download_chunk_endpoint(
    old_pdf:       UploadFile    = File(...),
    new_pdf:       UploadFile    = File(...),
    xml_file:      UploadFile    = File(...),
    tag_name:      str           = Form(...),
    source_name:   str           = Form(...),
    chunk_index:   int           = Form(...),
    attribute:     Optional[str] = Form(None),
    value:         Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    chunk_size:    int           = Form(1500),
    chunk_overlap: int           = Form(150),
):
    """Download a single XML chunk file as an attachment."""
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        xml_str = xml_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="XML file must be valid UTF-8")

    try:
        result = chunk_pdfs_and_xml(
            old_pdf_bytes=old_bytes,
            new_pdf_bytes=new_bytes,
            xml_content=xml_str,
            tag_name=tag_name,
            source_name=source_name,
            attribute=attribute or None,
            value=value or None,
            max_file_size=max_file_size,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    chunks = result.get("pdf_chunks", [])
    if chunk_index < 1 or chunk_index > len(chunks):
        raise HTTPException(status_code=404, detail=f"Chunk {chunk_index} not found")

    chunk    = chunks[chunk_index - 1]
    filename = chunk["filename"]
    content  = chunk["xml_chunk_file"]

    return Response(
        content=content.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 9. VALIDATE XML chunk
# ─────────────────────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    xml_content: str


@router.post("/validate")
async def validate_endpoint(payload: ValidateRequest):
    """Validate an XML chunk for structure, required tags, and syntax."""
    result = validate_xml_chunk(payload.xml_content)
    return {"success": True, **result}


# ─────────────────────────────────────────────────────────────────────────────
# 10. MERGE XML chunks → final document
# ─────────────────────────────────────────────────────────────────────────────

class ChunkItem(BaseModel):
    filename:    str
    xml_content: str
    has_changes: bool = False


class MergeChunksRequest(BaseModel):
    chunks:      list[ChunkItem]
    source_name: str = "Document"


@router.post("/merge/chunks")
async def merge_chunks_endpoint(payload: MergeChunksRequest):
    """
    Merge all XML chunk files into a single final XML document.

    Input:  SourceName_innod.00001.xml, 00002.xml, ...
    Output: SourceName_final.xml  (saved to MERGED/ folder in production)

    Validates each chunk, combines sequentially, generates final output.
    """
    try:
        merged = merge_xml_chunks(
            chunks=[c.model_dump() for c in payload.chunks],
            source_name=payload.source_name,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    safe     = re.sub(r'[^\w\-]', '_', payload.source_name).strip('_') or 'Document'
    filename = f"{safe}_final.xml"

    return {
        "success":     True,
        "merged_xml":  merged,
        "filename":    filename,
        "source_name": payload.source_name,
    }


@router.post("/merge/chunks/download")
async def merge_chunks_download_endpoint(payload: MergeChunksRequest):
    """Merge chunks and return the result as a file download."""
    try:
        merged = merge_xml_chunks(
            chunks=[c.model_dump() for c in payload.chunks],
            source_name=payload.source_name,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    safe     = re.sub(r'[^\w\-]', '_', payload.source_name).strip('_') or 'Document'
    filename = f"{safe}_final.xml"

    return Response(
        content=merged.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 11. DIFF — compare two XML files
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/diff")
async def diff_endpoint(
    old_file: UploadFile = File(...),
    new_file: UploadFile = File(...),
):
    """Compare two XML files — structural diff + line diff."""
    old_bytes = await old_file.read()
    new_bytes = await new_file.read()

    try:
        old_xml = old_bytes.decode("utf-8")
        new_xml = new_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="Files must be valid UTF-8 XML")

    try:
        diff  = compare_xml(old_xml, new_xml)
        lines = line_diff(old_xml, new_xml)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success":      True,
        "old_filename": old_file.filename,
        "new_filename": new_file.filename,
        "diff":         diff,
        "line_diff":    lines,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 12. MERGE (legacy: old/new XML + accept/reject lists)
# ─────────────────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    old_xml: str
    new_xml: str
    accept:  list[str] = []
    reject:  list[str] = []


@router.post("/merge")
async def merge_endpoint(payload: MergeRequest):
    """Merge old and new XML based on accepted/rejected change paths."""
    try:
        merged = merge_xml(
            old_xml=payload.old_xml,
            new_xml=payload.new_xml,
            accept=payload.accept,
            reject=payload.reject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {"success": True, "merged_xml": merged}


@router.post("/merge/download")
async def merge_download_endpoint(payload: MergeRequest):
    """Same as /merge but returns the result as a file download."""
    try:
        merged = merge_xml(
            old_xml=payload.old_xml,
            new_xml=payload.new_xml,
            accept=payload.accept,
            reject=payload.reject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return Response(
        content=merged.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="merged.xml"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 13. DIFF PDF — compare two PDFs alongside XML reference
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/diff/pdf")
async def diff_pdf_endpoint(
    old_pdf:  UploadFile = File(...),
    new_pdf:  UploadFile = File(...),
    xml_file: UploadFile = File(...),
):
    """
    Compare two PDFs alongside an XML reference file.
    Returns structural paragraph-level diff, line-level diff, and XML content.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        result = compare_pdfs_with_xml(old_bytes, new_bytes, xml_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success":      True,
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_file.filename,
        **result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 14. MERGE PDF — merge PDF-detected changes into XML
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/merge/pdf")
async def merge_pdf_endpoint(
    old_pdf:  UploadFile = File(...),
    new_pdf:  UploadFile = File(...),
    xml_file: UploadFile = File(...),
    accept:   str        = Form("[]"),
    reject:   str        = Form("[]"),
):
    """
    Merge changes detected between two PDFs into an XML structure.
    accept / reject are JSON-encoded lists of paragraph paths from /diff/pdf.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        accept_list = json.loads(accept)
        reject_list = json.loads(reject)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid accept/reject JSON: {exc}")

    try:
        merged = merge_pdfs_with_xml(
            old_bytes, new_bytes, xml_bytes, accept_list, reject_list
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {"success": True, "merged_xml": merged}



# ─────────────────────────────────────────────────────────────────────────────
# XML HEADINGS — detect structural levels from an XML file (client helper)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/xml-headings")
async def xml_headings_endpoint(xml_file: UploadFile = File(...)):
    """
    Detect structural heading levels in an XML file.
    Reads last-path attributes (Innodata) or structural element names.
    Returns available chunk levels so the frontend can let the user choose.
    """
    xml_bytes = await xml_file.read()
    try:
        xml_content = xml_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            xml_content = xml_bytes.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=422, detail="Could not decode XML file")

    import re as _re
    from collections import defaultdict as _dd

    HEADING_PATTERNS = [
        ("part",       "Parts",       _re.compile(r"^part\s+", _re.I)),
        ("chapter",    "Chapters",    _re.compile(r"^chapter\s+", _re.I)),
        ("section",    "Sections",    _re.compile(r"^section\s+", _re.I)),
        ("article",    "Articles",    _re.compile(r"^article\s+", _re.I)),
        ("schedule",   "Schedules",   _re.compile(r"^schedule\s+", _re.I)),
        ("appendix",   "Appendices",  _re.compile(r"^appendix\s+", _re.I)),
        ("annex",      "Annexes",     _re.compile(r"^annex\s+", _re.I)),
        ("regulation", "Regulations", _re.compile(r"^regulation\s+", _re.I)),
        ("division",   "Divisions",   _re.compile(r"^division\s+", _re.I)),
        ("title",      "Titles",      _re.compile(r"^title\s+", _re.I)),
        ("volume",     "Volumes",     _re.compile(r"^volume\s+", _re.I)),
    ]

    counts: dict[str, int] = {}
    samples: dict[str, list[str]] = _dd(list)

    # Strategy 1: last-path attributes (Innodata format)
    for m in _re.finditer(r'last-path="([^"]{1,120})"', xml_content, _re.I):
        val = m.group(1).strip()
        for key, label, pat in HEADING_PATTERNS:
            if pat.match(val):
                counts[key] = counts.get(key, 0) + 1
                if len(samples[key]) < 3:
                    samples[key].append(val)
                break

    # Strategy 2: actual element names (non-Innodata XML)
    if not counts:
        INLINE = {"b","i","u","em","strong","span","a","br","hr","p","li","ul",
                  "ol","td","tr","th","table","div","sup","sub","ins","del",
                  "innodreplace","innodidentifier","innodfootnote","innodheading",
                  "innodlevel","innodref","innodimgs","footnotes","root","document"}
        for m in _re.finditer(r'<([a-zA-Z][a-zA-Z0-9_-]*)[\ >/]', xml_content):
            tag = m.group(1).lower()
            if tag in INLINE:
                continue
            for key, label, pat in HEADING_PATTERNS:
                if key == tag:
                    counts[key] = counts.get(key, 0) + 1
                    break

    levels = [
        {"tag": key, "count": counts[key], "label": label, "samples": samples.get(key, [])}
        for key, label, _ in HEADING_PATTERNS
        if key in counts and counts[key] >= 2
    ]
    levels.sort(key=lambda x: x["count"])  # coarsest first

    return {"success": True, "levels": levels, "detected_tags": [l["tag"] for l in levels]}

# ─────────────────────────────────────────────────────────────────────────────
# 15. DETECT — per-span change detection (OLD vs NEW PDF → XML)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/detect")
async def detect_changes_endpoint(
    old_pdf:         UploadFile = File(...),
    new_pdf:         UploadFile = File(...),
    xml_file:        Optional[UploadFile] = File(None),
    old_page_start:  Optional[int] = Form(None),
    old_page_end:    Optional[int] = Form(None),
    new_page_start:  Optional[int] = Form(None),
    new_page_end:    Optional[int] = Form(None),
    old_anchor_text: Optional[str] = Form(None),  # heading text that starts this chunk in old PDF
    new_anchor_text: Optional[str] = Form(None),  # heading text that starts this chunk in new PDF
    # legacy single page_start/end (standalone mode)
    page_start:      Optional[int] = Form(None),
    page_end:        Optional[int] = Form(None),
):
    """
    Detect per-span changes between OLD and NEW PDFs.
    In chunk mode, pass old_page_start/end + new_page_start/end + anchor texts
    so detection is scoped to exactly that chunk's content.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read() if xml_file is not None else b""

    eff_old_start = old_page_start or page_start
    eff_old_end   = old_page_end   or page_end
    eff_new_start = new_page_start or page_start
    eff_new_end   = new_page_end   or page_end

    try:
        from fastapi.concurrency import run_in_threadpool
        result = await run_in_threadpool(
            detect_pdf_changes,
            old_bytes, new_bytes, xml_bytes,
            old_page_start=eff_old_start,
            old_page_end=eff_old_end,
            new_page_start=eff_new_start,
            new_page_end=eff_new_end,
            old_anchor_text=old_anchor_text,
            new_anchor_text=new_anchor_text,
        )
    except Exception as exc:
        import traceback, logging
        logging.getLogger(__name__).error(
            "detect_pdf_changes failed: %s\n%s", exc, traceback.format_exc()
        )
        raise HTTPException(status_code=500, detail=f"Change detection failed: {exc}")

    return {
        "success":      True,
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_file.filename if xml_file else "",
        **result,
    }