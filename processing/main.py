import tempfile
from pathlib import Path

from starlette.types import ASGIApp, Receive, Scope, Send

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from src.routers.process import router as process_router
from src.routers.compare import router as compare_router
from src.services.extractor import convert_doc_to_docx, extract_all_sections, extract_text


app = FastAPI(title="BRD Processing Service", version="1.0.0")


# GZip everything EXCEPT the streaming diff endpoint (buffering kills SSE/NDJSON)
class _GzipSkipStreaming:
    """Wraps GZipMiddleware but bypasses it for /compare/diff/stream."""
    def __init__(self, app: ASGIApp) -> None:
        self._gzip = GZipMiddleware(app, minimum_size=1000)
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path", "").endswith("/diff/stream"):
            await self._app(scope, receive, send)
        else:
            await self._gzip(scope, receive, send)

app.add_middleware(_GzipSkipStreaming)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:4000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process_router)
app.include_router(compare_router)


@app.post("/process")
async def process_upload(
    file: UploadFile = File(...),
    brd_id: str | None = Query(default=None),
):
    """Process a single BRD source file for the backend upload flow."""
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".doc", ".docx"}:
        raise HTTPException(status_code=400, detail="Only PDF, DOC, and DOCX files are supported")

    temp_path: str | None = None
    converted_docx_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await file.read())
            temp_path = temp_file.name

        working_path = temp_path
        working_suffix = suffix

        if suffix == ".doc":
            converted_docx_path = convert_doc_to_docx(temp_path)
            if converted_docx_path:
                working_path = converted_docx_path
                working_suffix = ".docx"

        raw_text = extract_text(working_path, working_suffix)
        extraction_input = working_path if working_suffix == ".docx" else raw_text
        extracted = await extract_all_sections(extraction_input, brd_id=brd_id)

        result = dict(extracted)
        cell_images = result.pop("cell_images", [])

        if "contentProfile" in result and "content_profile" not in result:
            result["content_profile"] = result["contentProfile"]
        if "brdConfig" in result and "brd_config" not in result:
            result["brd_config"] = result["brdConfig"]

        result["filename"] = filename
        result["char_count"] = len(raw_text)
        result["detected_format"] = result.get("format", "new")
        result["image_metadata"] = cell_images
        return result
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
    finally:
        for path_str in {temp_path, converted_docx_path}:
            if not path_str:
                continue
            try:
                Path(path_str).unlink(missing_ok=True)
            except Exception:
                pass


@app.get("/health")
def health():
    return {"status": "ok"}