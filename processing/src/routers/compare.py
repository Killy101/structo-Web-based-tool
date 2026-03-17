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
import csv
import io

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

router = APIRouter(prefix="/compare", tags=["compare"])

# ── In-memory job store (replace with Redis/PostgreSQL in production) ─────────
# Structure: { job_id: { status, files, chunks, source_name, ... } }
_jobs: dict[str, dict] = {}


# ─────────────────────────────────────────────────────────────────────────────
# 1. UPLOAD — initialise a job, receive files, return job_id
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_endpoint(
    old_pdf:     UploadFile = File(...),
    new_pdf:     UploadFile = File(...),
    xml_file:    UploadFile = File(...),
    source_name: str        = Form(...),
):
    """
    Upload OLD PDF, NEW PDF, and XML reference file.
    Creates a job entry and returns a job_id for /start-chunking.

    File storage layout (production: save to disk / S3):
        SOURCE_NAME/
            ORIGINAL/   old.pdf  new.pdf  source.xml
            CHUNKED/    ← populated by /start-chunking
            COMPARE/    ← diff JSON files per chunk
            MERGED/     ← SourceName_final.xml
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        xml_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="XML file must be valid UTF-8")

    job_id = str(uuid.uuid4())

    _jobs[job_id] = {
        "job_id":       job_id,
        "status":       "uploaded",   # uploaded | processing | done | error
        "source_name":  source_name.strip(),
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_file.filename,
        # Raw bytes held in memory; removed after processing
        "_old_bytes":   old_bytes,
        "_new_bytes":   new_bytes,
        "_xml_bytes":   xml_bytes,
        "chunks":       [],
        "summary":      None,
        "progress":     0,
        "error":        None,
    }

    return {
        "success":      True,
        "job_id":       job_id,
        "source_name":  source_name.strip(),
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_file.filename,
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

    Production: enqueue a Celery task and return immediately.
    Current:    runs synchronously (swap body with celery.send_task(...)).

    Job Queue flow:
        /upload → Create job → /start-chunking → Worker processes PDF
            → Progress updates via SSE/WebSocket → status = done
    """
    job = _jobs.get(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {payload.job_id} not found")

    if job["status"] == "processing":
        raise HTTPException(status_code=409, detail="Job is already processing")

    job["status"]   = "processing"
    job["progress"] = 0

    try:
        xml_str = job["_xml_bytes"].decode("utf-8")

        result = chunk_pdfs_and_xml(
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
        )

        job["status"]   = "done"
        job["progress"] = 100
        job["chunks"]   = result.get("pdf_chunks", [])
        job["summary"]  = result.get("summary", {})
        # Free memory after processing
        job.pop("_old_bytes", None)
        job.pop("_new_bytes", None)
        job.pop("_xml_bytes", None)

        return {
            "success":     True,
            "job_id":      payload.job_id,
            "status":      "done",
            "source_name": job["source_name"],
            **result,
        }

    except Exception as exc:
        job["status"] = "error"
        job["error"]  = str(exc)
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
            "index":       c.get("index"),
            "label":       c.get("label"),
            "filename":    c.get("filename"),
            "has_changes": c.get("has_changes", False),
            "xml_tag":     c.get("xml_tag"),
            "xml_size":    c.get("xml_size", 0),
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


# ─────────────────────────────────────────────────────────────────────────────
# 4. COMPARE CHUNK — load full comparison data for a single chunk
# ─────────────────────────────────────────────────────────────────────────────

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
# 15. DETECT — per-span change detection (OLD vs NEW PDF → XML)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/detect")
async def detect_changes_endpoint(
    old_pdf:  UploadFile = File(...),
    new_pdf:  UploadFile = File(...),
    xml_file: UploadFile = File(...),
):
    """
    Detect per-span changes between OLD and NEW PDFs and map them to XML.

    Change types: addition | removal | modification | emphasis | mismatch

    Powers the ComparePanel 4-split view:
        Changes List | Old PDF | New PDF | XML Editor

    Returns { changes, xml_content, summary }.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        result = detect_pdf_changes(old_bytes, new_bytes, xml_bytes)
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
        "xml_filename": xml_file.filename,
        **result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 16. EXPORT DIFF REPORT — download CSV report of all chunk changes for a job
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/export/diff")
async def export_diff_report(job_id: str):
    """
    Export a CSV diff report for a completed comparison job.

    GET /compare/export/diff?job_id=<uuid>

    Returns a CSV file with columns:
        Chunk Index | Chunk Label | Filename | Has Changes | XML Size (bytes)
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job.get("status") not in ("done",):
        raise HTTPException(
            status_code=409,
            detail=f"Job is not yet complete (status: {job.get('status')}). "
                   "Please wait until chunking finishes before exporting.",
        )

    chunks      = job.get("chunks", [])
    source_name = job.get("source_name", "Document")
    safe_name   = re.sub(r'[^\w\-]', '_', source_name).strip('_') or 'Document'
    filename    = f"{safe_name}_diff_report.csv"

    # Build CSV in memory
    buf = io.StringIO()
    writer = csv.writer(buf)

    # Header rows
    writer.writerow(["Diff Report"])
    writer.writerow(["Source Name", source_name])
    writer.writerow(["Job ID", job_id])
    writer.writerow(["Old File", job.get("old_filename", "")])
    writer.writerow(["New File", job.get("new_filename", "")])
    writer.writerow(["XML File", job.get("xml_filename", "")])
    writer.writerow([])

    # Summary
    changed_count = sum(1 for c in chunks if c.get("has_changes", False))
    writer.writerow(["Total Chunks", len(chunks), "Chunks with Changes", changed_count])
    writer.writerow([])

    # Column headers
    writer.writerow(["Chunk Index", "Label", "Filename", "Has Changes", "XML Size (bytes)", "XML Tag"])

    for chunk in chunks:
        writer.writerow([
            chunk.get("index",       ""),
            chunk.get("label",       ""),
            chunk.get("filename",    ""),
            "Yes" if chunk.get("has_changes", False) else "No",
            chunk.get("xml_size",    ""),
            chunk.get("xml_tag",     ""),
        ])

    csv_bytes = buf.getvalue().encode("utf-8-sig")  # UTF-8 BOM for Excel

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )