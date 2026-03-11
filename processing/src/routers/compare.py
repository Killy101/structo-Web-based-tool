"""
FastAPI router for XML Chunk / Compare / Merge operations.
Now includes /compare/chunk/pdf  — LangChain-powered PDF + XML chunking.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import io
import json

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


# ── Chunk (XML only — legacy) ──────────────────────────────────────────────────

@router.post("/chunk")
async def chunk_endpoint(
    file: UploadFile = File(...),
    tag_name: str = Form(...),
    attribute: Optional[str] = Form(None),
    value: Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    identifier: Optional[str] = Form(None),
):
    """Chunk an XML file by tag name (legacy endpoint)."""
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


# ── Chunk (PDF + XML — LangChain) ──────────────────────────────────────────────

@router.post("/chunk/pdf")
async def chunk_pdf_endpoint(
    old_pdf:      UploadFile = File(...),
    new_pdf:      UploadFile = File(...),
    xml_file:     UploadFile = File(...),
    tag_name:     str        = Form(...),
    source_name:  str        = Form(...),
    attribute:    Optional[str] = Form(None),
    value:        Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    chunk_size:   int        = Form(1500),
    chunk_overlap: int       = Form(150),
):
    """
    LangChain-powered pipeline:
      1. Extract text from OLD and NEW PDFs (PyMuPDF)
      2. Split both with RecursiveCharacterTextSplitter
      3. Chunk the XML file by tag_name
      4. Align PDF chunks ↔ XML chunks by index
      5. Detect changes per chunk (NEW vs OLD)
      6. Generate XML chunk files with naming: SourceName_innod.NNNNN.xml
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


# ── Download individual XML chunk ──────────────────────────────────────────────

@router.post("/chunk/download")
async def download_chunk_endpoint(
    old_pdf:      UploadFile = File(...),
    new_pdf:      UploadFile = File(...),
    xml_file:     UploadFile = File(...),
    tag_name:     str        = Form(...),
    source_name:  str        = Form(...),
    chunk_index:  int        = Form(...),
    attribute:    Optional[str] = Form(None),
    value:        Optional[str] = Form(None),
    max_file_size: Optional[int] = Form(None),
    chunk_size:   int        = Form(1500),
    chunk_overlap: int       = Form(150),
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

    chunk = chunks[chunk_index - 1]
    filename = chunk["filename"]
    content  = chunk["xml_chunk_file"]

    return Response(
        content=content.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Validate XML chunk ─────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    xml_content: str


@router.post("/validate")
async def validate_endpoint(payload: ValidateRequest):
    """Validate an XML chunk for structure, required tags, and syntax."""
    result = validate_xml_chunk(payload.xml_content)
    return {"success": True, **result}


# ── Merge XML chunks ───────────────────────────────────────────────────────────

class ChunkItem(BaseModel):
    filename: str
    xml_content: str
    has_changes: bool = False


class MergeChunksRequest(BaseModel):
    chunks: list[ChunkItem]
    source_name: str = "Document"


@router.post("/merge/chunks")
async def merge_chunks_endpoint(payload: MergeChunksRequest):
    """Merge multiple XML chunk files into a single final XML document."""
    try:
        merged = merge_xml_chunks(
            chunks=[c.model_dump() for c in payload.chunks],
            source_name=payload.source_name,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    import re
    safe = re.sub(r'[^\w\-]', '_', payload.source_name).strip('_') or 'Document'
    filename = f"{safe}_final.xml"
    return {
        "success": True,
        "merged_xml": merged,
        "filename": filename,
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

    import re
    safe = re.sub(r'[^\w\-]', '_', payload.source_name).strip('_') or 'Document'
    filename = f"{safe}_final.xml"
    return Response(
        content=merged.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Compare ────────────────────────────────────────────────────────────────────

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


# ── Merge ──────────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    old_xml: str
    new_xml: str
    accept: list[str] = []
    reject: list[str] = []


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
    """Same as /merge but returns the XML as a file download."""
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


# ── Compare (PDF + XML) ────────────────────────────────────────────────────────

@router.post("/diff/pdf")
async def diff_pdf_endpoint(
    old_pdf:  UploadFile = File(...),
    new_pdf:  UploadFile = File(...),
    xml_file: UploadFile = File(...),
):
    """
    Compare two PDFs alongside an XML reference file.

    Extracts plain text from both PDFs, runs a structural paragraph-level diff
    and a line-level diff, and returns the XML file content for reference.
    Response shape mirrors /compare/diff.
    """
    old_bytes  = await old_pdf.read()
    new_bytes  = await new_pdf.read()
    xml_bytes  = await xml_file.read()

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


# ── Merge (PDF + XML) ──────────────────────────────────────────────────────────

@router.post("/merge/pdf")
async def merge_pdf_endpoint(
    old_pdf:  UploadFile = File(...),
    new_pdf:  UploadFile = File(...),
    xml_file: UploadFile = File(...),
    accept:   str = Form("[]"),
    reject:   str = Form("[]"),
):
    """
    Merge changes detected between two PDFs into an XML structure.

    accept / reject are JSON-encoded lists of paragraph paths returned by
    /compare/diff/pdf.
    """
    old_bytes  = await old_pdf.read()
    new_bytes  = await new_pdf.read()
    xml_bytes  = await xml_file.read()

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

# ── Detect (PDF + XML) — span-level change detection ──────────────────────────

@router.post("/detect")
async def detect_changes_endpoint(
    old_pdf:  UploadFile = File(...),
    new_pdf:  UploadFile = File(...),
    xml_file: UploadFile = File(...),
):
    """
    Detect per-span changes between OLD and NEW PDFs and map them to the
    provided XML reference file.

    Each change is classified as one of:
      addition | removal | modification | emphasis | mismatch

    Emphasis covers bold / italic / colour changes in the NEW PDF.
    Returns { changes, xml_content, summary } alongside the filenames.
    """
    old_bytes = await old_pdf.read()
    new_bytes = await new_pdf.read()
    xml_bytes = await xml_file.read()

    try:
        result = detect_pdf_changes(old_bytes, new_bytes, xml_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "success":      True,
        "old_filename": old_pdf.filename,
        "new_filename": new_pdf.filename,
        "xml_filename": xml_file.filename,
        **result,
    }
