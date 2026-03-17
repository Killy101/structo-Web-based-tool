"""
autocompare.py — FastAPI router for the AutoCompare module.

Endpoints
─────────
    POST /autocompare/upload              Upload OLD PDF, NEW PDF, multiple pre-chunked XMLs
    POST /autocompare/start               Start async processing for a session
    GET  /autocompare/status/{session_id} Poll processing progress (0-100)
    GET  /autocompare/chunks              List all chunks for a session
    GET  /autocompare/compare/{chunk_id}  Full comparison data for a single chunk
    POST /autocompare/save                Save edited XML for a chunk
    POST /autocompare/autogenerate        AI-generate XML updates for a chunk
    POST /autocompare/validate            Validate XML for a chunk
    GET  /autocompare/download/{session_id}/{chunk_id}  Download single chunk XML
    POST /autocompare/reupload            Re-upload new XML chunks to existing session

Design notes
────────────
- XML files are already pre-chunked — no XML chunking is performed.
- No merge endpoint — each chunk is downloaded individually.
- /upload accepts multiple XML files (the pre-chunked set).
"""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional

from src.services.autocompare_service import (
    cleanup_old_sessions,
    get_chunk_detail,
    get_chunk_xml_content,
    get_chunks_list,
    get_session,
    process_upload,
    reupload_xml_files,
    save_chunk_xml,
    start_processing,
    validate_all_chunks,
    validate_chunk_xml,
    _generate_xml_suggestion,
    _generate_diff_lines,
)

router = APIRouter(prefix="/autocompare", tags=["autocompare"])


# ── 1. UPLOAD ─────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_endpoint(
    old_pdf:     UploadFile = File(..., description="Old version PDF"),
    new_pdf:     UploadFile = File(..., description="New version PDF"),
    xml_files:   List[UploadFile] = File(..., description="Pre-chunked XML files"),
    source_name: str        = Form(..., description="Project / source name"),
):
    """
    Upload OLD PDF, NEW PDF, and multiple pre-chunked XML files.
    Creates a session on disk and returns a session_id.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()

    if not old_bytes:
        raise HTTPException(status_code=422, detail="old_pdf is empty")
    if not new_bytes:
        raise HTTPException(status_code=422, detail="new_pdf is empty")
    if not xml_files:
        raise HTTPException(status_code=422, detail="No XML files provided")

    # Read all XML files
    xml_file_data: list[tuple[str, bytes]] = []
    for xf in xml_files:
        content = await xf.read()
        if not content:
            continue
        filename = xf.filename or f"chunk_{len(xml_file_data)+1}.xml"
        xml_file_data.append((filename, content))

    if not xml_file_data:
        raise HTTPException(status_code=422, detail="All XML files are empty")

    try:
        session = process_upload(
            old_pdf_bytes=old_bytes,
            new_pdf_bytes=new_bytes,
            xml_files=xml_file_data,
            source_name=source_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    return {
        "success":        True,
        "session_id":     session["session_id"],
        "source_name":    session["source_name"],
        "old_pages":      session["old_pages"],
        "new_pages":      session["new_pages"],
        "xml_file_count": session["xml_file_count"],
        "status":         "uploaded",
        "message":        "Files uploaded. POST /autocompare/start to begin processing.",
    }


# ── 2. START PROCESSING ───────────────────────────────────────────────────────

class StartRequest(BaseModel):
    session_id: str
    batch_size: int = 50


@router.post("/start")
async def start_endpoint(payload: StartRequest, background_tasks: BackgroundTasks):
    """
    Kick off background processing for an uploaded session.
    No tag_name parameter — XML is already chunked.
    """
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    if session["status"] == "processing":
        raise HTTPException(status_code=409, detail="Session is already processing")

    if session["status"] == "done":
        return {
            "success":    True,
            "session_id": payload.session_id,
            "status":     "done",
            "message":    "Session already processed",
        }

    background_tasks.add_task(
        _run_processing,
        payload.session_id,
        payload.batch_size,
    )

    session["status"] = "processing"
    session["progress"] = 0

    return {
        "success":    True,
        "session_id": payload.session_id,
        "status":     "processing",
        "message":    "Processing started. Poll /autocompare/status/{session_id}.",
    }


async def _run_processing(session_id: str, batch_size: int) -> None:
    """Wrapper for BackgroundTasks."""
    try:
        await start_processing(session_id=session_id, batch_size=batch_size)
    except Exception as exc:
        sess = get_session(session_id)
        if sess:
            sess["status"] = "error"
            sess["error"] = str(exc)


# ── 3. STATUS POLL ────────────────────────────────────────────────────────────

@router.get("/status/{session_id}")
async def status_endpoint(session_id: str):
    """Poll processing progress for a session."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {
        "success":    True,
        "session_id": session_id,
        "status":     session["status"],
        "progress":   session["progress"],
        "summary":    session.get("summary"),
        "error":      session.get("error"),
        "expires_at": session.get("expires_at"),
    }


# ── 4. CHUNKS LIST ────────────────────────────────────────────────────────────

@router.get("/chunks")
async def chunks_endpoint(session_id: str):
    """Return lightweight chunk list for a session."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    if session["status"] not in ("processing", "done"):
        raise HTTPException(
            status_code=409,
            detail=f"Session not ready (status={session['status']}). POST /start first.",
        )

    chunks = get_chunks_list(session_id)
    return {
        "success":     True,
        "session_id":  session_id,
        "source_name": session["source_name"],
        "status":      session["status"],
        "progress":    session["progress"],
        "summary":     session.get("summary"),
        "chunks":      chunks,
    }


# ── 5. COMPARE SINGLE CHUNK ───────────────────────────────────────────────────

@router.get("/compare/{chunk_id}")
async def compare_chunk_endpoint(chunk_id: str, session_id: str):
    """Return full comparison data for a single chunk."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    chunk = get_chunk_detail(session_id, chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk {chunk_id} not found")

    return {
        "success":     True,
        "session_id":  session_id,
        "chunk_id":    chunk_id,
        "source_name": session["source_name"],
        "chunk":       chunk,
    }


# ── 6. SAVE XML ───────────────────────────────────────────────────────────────

class SaveRequest(BaseModel):
    session_id:  str
    chunk_id:    str
    xml_content: str


@router.post("/save")
async def save_endpoint(payload: SaveRequest):
    """Persist user-edited XML for a chunk."""
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    try:
        result = save_chunk_xml(payload.session_id, payload.chunk_id, payload.xml_content)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not result["valid"]:
        raise HTTPException(
            status_code=422,
            detail={"message": "Invalid XML", "errors": result["errors"]},
        )

    return {
        "success":    True,
        "session_id": payload.session_id,
        "chunk_id":   payload.chunk_id,
        "message":    "XML saved successfully",
        **result,
    }


# ── 7. AUTO-GENERATE XML UPDATES ─────────────────────────────────────────────

class AutoGenerateRequest(BaseModel):
    session_id: str
    chunk_id:   str
    diff_index: Optional[int] = None
    diff_text: Optional[str] = None
    old_text: Optional[str] = None
    new_text: Optional[str] = None
    category: Optional[str] = None


@router.post("/autogenerate")
async def autogenerate_endpoint(payload: AutoGenerateRequest):
    """AI-assisted XML update generation for a single chunk, based on New PDF content."""
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    chunk = get_chunk_detail(payload.session_id, payload.chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk {payload.chunk_id} not found")

    # Use the saved (user-edited) XML as the base, falling back to original
    base_xml = chunk.get("xml_saved") or chunk.get("xml_content", "")
    suggested = _generate_xml_suggestion(
        xml_chunk=base_xml,
        old_pdf_text=chunk.get("old_text", ""),
        new_pdf_text=chunk.get("new_text", ""),
        focus_old_text=payload.old_text,
        focus_new_text=payload.new_text,
        focus_text=payload.diff_text,
    )

    has_line_focus = any([
        payload.diff_index is not None,
        bool(payload.diff_text),
        bool(payload.old_text),
        bool(payload.new_text),
    ])

    return {
        "success":       True,
        "session_id":    payload.session_id,
        "chunk_id":      payload.chunk_id,
        "suggested_xml": suggested,
        "generation_scope": "line" if has_line_focus else "chunk",
    }


# ── 8. VALIDATE XML ──────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    session_id: str
    chunk_id:   str


class ValidateAllRequest(BaseModel):
    session_id: str


@router.post("/validate")
async def validate_endpoint(payload: ValidateRequest):
    """
    Validate a chunk's XML and check:
    - Whether the XML has been updated
    - Whether changes were detected and applied
    - Whether further modifications are still required
    """
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    try:
        result = validate_chunk_xml(payload.session_id, payload.chunk_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "success":    True,
        "session_id": payload.session_id,
        "chunk_id":   payload.chunk_id,
        **result,
    }


@router.post("/validate-all")
async def validate_all_endpoint(payload: ValidateAllRequest):
    """Validate all XML chunks for a session and return aggregated results."""
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    try:
        result = validate_all_chunks(payload.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "success": True,
        **result,
    }




# ── 10b. SERVE ORIGINAL PDF (for session-restore PDF viewer) ─────────────────

@router.get("/pdf/{session_id}/{which}")
async def serve_pdf_endpoint(session_id: str, which: str):
    """
    Serve the original old or new PDF for a session.
    `which` must be "old" or "new".
    Used by the frontend PdfViewer when the local File object is unavailable
    (e.g. after page refresh / session restore).
    """
    if which not in ("old", "new"):
        raise HTTPException(status_code=400, detail="which must be 'old' or 'new'")

    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    from pathlib import Path as _Path
    pdf_path = _Path(session["storage"]["original"]) / f"{which}.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"{which}.pdf not found for this session")

    pdf_bytes = pdf_path.read_bytes()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{which}.pdf"',
            "Cache-Control": "private, max-age=3600",
        },
    )

# ── 9. DOWNLOAD SINGLE CHUNK XML ─────────────────────────────────────────────

@router.get("/download/{session_id}/{chunk_id}")
async def download_chunk_endpoint(session_id: str, chunk_id: str):
    """Download a single chunk's XML as a file attachment."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    try:
        filename, xml_content = get_chunk_xml_content(session_id, chunk_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return Response(
        content=xml_content.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── 10. RE-UPLOAD XML CHUNKS ─────────────────────────────────────────────────

@router.post("/reupload")
async def reupload_endpoint(
    session_id: str = Form(...),
    xml_files:  List[UploadFile] = File(..., description="New pre-chunked XML files"),
):
    """
    Replace XML chunks in an existing session with new files.
    The same Old and New PDFs will be used for comparison.
    After re-upload, POST /autocompare/start to re-process.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    xml_file_data: list[tuple[str, bytes]] = []
    for xf in xml_files:
        content = await xf.read()
        if not content:
            continue
        filename = xf.filename or f"chunk_{len(xml_file_data)+1}.xml"
        xml_file_data.append((filename, content))

    if not xml_file_data:
        raise HTTPException(status_code=422, detail="All XML files are empty")

    try:
        updated_session = reupload_xml_files(session_id, xml_file_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "success":        True,
        "session_id":     session_id,
        "xml_file_count": updated_session["xml_file_count"],
        "status":         "uploaded",
        "message":        "XML files replaced. POST /autocompare/start to re-process.",
    }




# ── 11b. DOWNLOAD ALL CHUNKS AS ZIP ──────────────────────────────────────────

@router.get("/download-all/{session_id}")
async def download_all_endpoint(session_id: str):
    """Stream all chunk XMLs as a ZIP archive."""
    import io
    import zipfile as _zip

    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    chunks = session.get("chunks", [])
    if not chunks:
        raise HTTPException(status_code=404, detail="No chunks available")

    buf = io.BytesIO()
    with _zip.ZipFile(buf, "w", _zip.ZIP_DEFLATED) as zf:
        for chunk in chunks:
            chunk_id = str(chunk.get("index"))
            try:
                filename, xml_content = get_chunk_xml_content(session_id, chunk_id)
                zf.writestr(filename, xml_content.encode("utf-8"))
            except Exception:
                pass
    buf.seek(0)

    safe_name = re.sub(r"[^\w.\-]", "_", session.get("source_name", "chunks"))
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_chunks.zip"'},
    )

# ── 12. CLEANUP ───────────────────────────────────────────────────────────────

@router.delete("/cleanup")
async def cleanup_endpoint(ttl: int = 3600):
    """Remove sessions older than `ttl` seconds from memory and disk."""
    removed = cleanup_old_sessions(ttl=ttl)
    return {"success": True, "removed": removed}    