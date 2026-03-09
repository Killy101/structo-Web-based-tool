"""
FastAPI router for XML Chunk / Compare / Merge operations.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import io

from src.services.xml_compare import (
    chunk_xml,
    compare_xml,
    line_diff,
    merge_xml,
)

router = APIRouter(prefix="/compare", tags=["compare"])


# ── Chunk ──────────────────────────────────────────────────────────────────────

@router.post("/chunk")
async def chunk_endpoint(
    file: UploadFile = File(...),
    tag_name: str = Form(...),
    attribute: Optional[str] = Form(None),
    value: Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    identifier: Optional[str] = Form(None),
):
    """
    Chunk an XML file by tag name, with optional attribute/value filter
    and max_file_size per chunk (bytes).
    """
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
        "success": True,
        "identifier": identifier or file.filename,
        "filename": file.filename,
        "tag_name": tag_name,
        "attribute": attribute,
        "value": value,
        "max_file_size": max_file_size,
        "total_chunks": len(chunks),
        "chunks": chunks,
    }


# ── Compare ────────────────────────────────────────────────────────────────────

@router.post("/diff")
async def diff_endpoint(
    old_file: UploadFile = File(...),
    new_file: UploadFile = File(...),
):
    """
    Compare two XML files.
    Returns structural diff: additions, removals, modifications, mismatches,
    plus line-level diff for side-by-side display.
    """
    old_bytes = await old_file.read()
    new_bytes = await new_file.read()

    try:
        old_xml = old_bytes.decode("utf-8")
        new_xml = new_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="Files must be valid UTF-8 XML")

    try:
        diff = compare_xml(old_xml, new_xml)
        lines = line_diff(old_xml, new_xml)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success": True,
        "old_filename": old_file.filename,
        "new_filename": new_file.filename,
        "diff": diff,
        "line_diff": lines,
    }


# ── Merge ──────────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    old_xml: str
    new_xml: str
    accept: list[str] = []
    reject: list[str] = []


@router.post("/merge")
async def merge_endpoint(payload: MergeRequest):
    """
    Merge old and new XML based on accepted/rejected change paths.
    Returns the merged XML string.
    """
    try:
        merged = merge_xml(
            old_xml=payload.old_xml,
            new_xml=payload.new_xml,
            accept=payload.accept,
            reject=payload.reject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success": True,
        "merged_xml": merged,
    }


@router.post("/merge/download")
async def merge_download_endpoint(payload: MergeRequest):
    """
    Same as /merge but returns the XML as a file download.
    """
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
