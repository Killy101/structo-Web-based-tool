from fastapi import APIRouter, UploadFile, File, HTTPException
from src.services.extractor import extract_all_sections
from src.services.scraper import extract_text
import tempfile, os, shutil

router = APIRouter()


@router.post("/process")
async def process_document(file: UploadFile = File(...), format: str = "new"):
    """
    Receives a BRD file (.doc, .docx, or .pdf) and extracts:
    Scope, Metadata, TOC, Citation Rules, Content Profile.
    """
    suffix = os.path.splitext(file.filename)[1].lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        # ── .docx: full structured extraction via python-docx ───────────────
        if suffix == ".docx":
            result = await extract_all_sections(tmp_path, format)

        # ── .pdf / .doc / other: raw text extraction via scraper ────────────
        else:
            try:
                raw_text = extract_text(tmp_path, suffix)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

            if not raw_text or len(raw_text.strip()) < 50:
                raise HTTPException(
                    status_code=422,
                    detail="Could not extract text from document"
                )
            result = await extract_all_sections(raw_text, format)

        result["filename"] = file.filename
        return result

    finally:
        os.unlink(tmp_path)