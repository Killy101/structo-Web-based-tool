"""
autocompare.py — FastAPI router for the AutoCompare module.

Endpoints
─────────
    POST /autocompare/upload              Upload OLD PDF, NEW PDF, XML → session_id
    POST /autocompare/start               Start async processing for a session
    GET  /autocompare/status/{session_id} Poll processing progress (0-100)
    GET  /autocompare/chunks              List all chunks for a session
    GET  /autocompare/compare/{chunk_id}  Full comparison data for a single chunk
    POST /autocompare/save                Save edited XML for a chunk
    POST /autocompare/autogenerate        AI-generate XML updates for a chunk
    POST /autocompare/merge               Merge all chunks → final XML
    GET  /autocompare/download            Download final merged XML

Design notes
────────────
- /upload and /start are split so the frontend can show a progress bar while
  the background task runs.
- /start launches an asyncio background task so it returns immediately.
  Clients poll /status/{session_id} for completion.
- All heavy lifting is in autocompare_service.py.
"""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional

from src.services.autocompare_service import (
    cleanup_old_sessions,
    get_chunk_detail,
    get_chunks_list,
    get_session,
    merge_all_chunks,
    process_upload,
    save_chunk_xml,
    start_processing,
    _generate_xml_suggestion,
    _generate_diff_lines,
)

router = APIRouter(prefix="/autocompare", tags=["autocompare"])


# ── 1. UPLOAD ─────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_endpoint(
    old_pdf:     UploadFile = File(..., description="Old version PDF"),
    new_pdf:     UploadFile = File(..., description="New version PDF"),
    xml_file:    UploadFile = File(..., description="Existing XML source file"),
    source_name: str        = Form(..., description="Project / source name"),
):
    """
    Upload OLD PDF, NEW PDF, and XML.
    Creates a session on disk and returns a session_id.

    Storage layout created:
        /tmp/autocompare/<session_id>/
            ORIGINAL/   old.pdf  new.pdf  source.xml
            CHUNKED/
            COMPARE/
            MERGED/

    POST to /autocompare/start with the session_id to begin processing.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    if not old_bytes:
        raise HTTPException(status_code=422, detail="old_pdf is empty")
    if not new_bytes:
        raise HTTPException(status_code=422, detail="new_pdf is empty")
    if not xml_bytes:
        raise HTTPException(status_code=422, detail="xml_file is empty")

    try:
        session = process_upload(
            old_pdf_bytes=old_bytes,
            new_pdf_bytes=new_bytes,
            xml_bytes=xml_bytes,
            source_name=source_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    return {
        "success":      True,
        "session_id":   session["session_id"],
        "source_name":  session["source_name"],
        "old_pages":    session["old_pages"],
        "new_pages":    session["new_pages"],
        "xml_size":     session["xml_size"],
        "status":       "uploaded",
        "storage":      session["storage"],
        "message":      "Files uploaded. POST /autocompare/start to begin processing.",
    }


# ── 2. START PROCESSING ───────────────────────────────────────────────────────

class StartRequest(BaseModel):
    session_id: str
    tag_name:   str = "section"    # XML tag to chunk by
    batch_size: int = 50           # PDF pages per batch
    max_chars:  int = 4000         # Max chars per XML chunk (fallback)


@router.post("/start")
async def start_endpoint(payload: StartRequest, background_tasks: BackgroundTasks):
    """
    Kick off background processing for an uploaded session.

    Returns immediately with status="processing".
    Poll GET /autocompare/status/{session_id} for completion.

    For very large PDFs the processing is batched:
        - Pages are streamed in groups of `batch_size`
        - Intermediate results are written to disk
        - Memory stays bounded regardless of PDF size
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

    # Launch as asyncio background task so this endpoint returns immediately
    background_tasks.add_task(
        _run_processing,
        payload.session_id,
        payload.tag_name,
        payload.batch_size,
        payload.max_chars,
    )

    session["status"]   = "processing"
    session["progress"] = 0

    return {
        "success":    True,
        "session_id": payload.session_id,
        "status":     "processing",
        "message":    "Processing started. Poll /autocompare/status/{session_id}.",
    }


async def _run_processing(
    session_id: str,
    tag_name:   str,
    batch_size: int,
    max_chars:  int,
) -> None:
    """Thin wrapper so BackgroundTasks can call start_processing as a coroutine."""
    try:
        await start_processing(
            session_id=session_id,
            tag_name=tag_name,
            batch_size=batch_size,
            max_chars=max_chars,
        )
    except Exception as exc:
        sess = get_session(session_id)
        if sess:
            sess["status"] = "error"
            sess["error"]  = str(exc)


# ── 3. STATUS POLL ────────────────────────────────────────────────────────────

@router.get("/status/{session_id}")
async def status_endpoint(session_id: str):
    """
    Poll processing progress for a session.

    Returns:
        { session_id, status, progress (0-100), summary?, error? }

    Frontend should poll this every 1–2 s while status == "processing".
    """
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
    }


# ── 4. CHUNKS LIST ────────────────────────────────────────────────────────────

@router.get("/chunks")
async def chunks_endpoint(session_id: str):
    """
    Return lightweight chunk list for a session (no large text fields).

    GET /autocompare/chunks?session_id=<uuid>

    Powers the ChunkList panel: shows label, change badge, similarity score.
    """
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
    """
    Return full comparison data for a single chunk.

    GET /autocompare/compare/{chunk_id}?session_id=<uuid>

    Response includes:
        old_text, new_text, diff_lines, xml_content, xml_suggested, similarity
    """
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
    """
    Persist user-edited XML for a chunk.

    Validates XML syntax before saving.
    Writes to CHUNKED/<filename> on disk.
    Returns { valid, errors, chunk_id }.
    """
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
        "success":  True,
        "session_id": payload.session_id,
        "chunk_id": payload.chunk_id,
        "message":  "XML saved successfully",
        **result,
    }


# ── 7. AUTO-GENERATE XML UPDATES ─────────────────────────────────────────────

class AutoGenerateRequest(BaseModel):
    session_id: str
    chunk_id:   str


@router.post("/autogenerate")
async def autogenerate_endpoint(payload: AutoGenerateRequest):
    """
    AI-assisted XML update generation for a single chunk.

    Uses heuristic sentence-level diff (difflib) to replace changed sentences
    in the XML chunk. In production, swap _generate_xml_suggestion() with
    an LLM API call for higher quality suggestions.

    Returns { suggested_xml, chunk_id }.
    """
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    chunk = get_chunk_detail(payload.session_id, payload.chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Chunk {payload.chunk_id} not found")

    suggested = _generate_xml_suggestion(
        xml_chunk=chunk.get("xml_content", ""),
        old_pdf_text=chunk.get("old_text", ""),
        new_pdf_text=chunk.get("new_text", ""),
    )

    return {
        "success":       True,
        "session_id":    payload.session_id,
        "chunk_id":      payload.chunk_id,
        "suggested_xml": suggested,
    }


# ── 8. MERGE ALL CHUNKS ───────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    session_id: str


@router.post("/merge")
async def merge_endpoint(payload: MergeRequest):
    """
    Merge all saved XML chunks into a final output document.

    Writes to MERGED/final_output.xml.
    Returns { merged_xml, filename }.
    """
    session = get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {payload.session_id} not found")

    if session["status"] != "done":
        raise HTTPException(
            status_code=409,
            detail="Processing must complete before merging",
        )

    try:
        merged_xml = merge_all_chunks(payload.session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    safe_name = re.sub(r"[^\w\-]", "_", session["source_name"]).strip("_") or "Document"
    filename  = f"{safe_name}_final.xml"

    return {
        "success":     True,
        "session_id":  payload.session_id,
        "source_name": session["source_name"],
        "merged_xml":  merged_xml,
        "filename":    filename,
    }


# ── 9. DOWNLOAD FINAL XML ─────────────────────────────────────────────────────

@router.get("/download/{session_id}")
async def download_endpoint(session_id: str):
    """
    Download the final merged XML as a file attachment.

    GET /autocompare/download/{session_id}
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    try:
        merged_xml = merge_all_chunks(session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    safe_name = re.sub(r"[^\w\-]", "_", session["source_name"]).strip("_") or "Document"
    filename  = f"{safe_name}_final.xml"

    return Response(
        content=merged_xml.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── 10. CLEANUP (optional maintenance endpoint) ───────────────────────────────

@router.delete("/cleanup")
async def cleanup_endpoint(ttl: int = 3600):
    """Remove sessions older than `ttl` seconds from memory and disk."""
    removed = cleanup_old_sessions(ttl=ttl)
    return {"success": True, "removed": removed}
