"""
src/router/compare.py
=====================
FastAPI router for the PDF Diff Inspector feature.

Mount in your app with:
    from src.router.compare import router as compare_router
    app.include_router(compare_router)

Endpoints
---------
POST /compare/diff          Compare two PDFs → chunks + render segments
POST /compare/xml/apply     Apply one diff chunk into XML
POST /compare/xml/locate    Locate a chunk in XML (read-only, for highlight)
GET  /compare/health        Health check + rapidfuzz status
"""

from __future__ import annotations

import importlib
import importlib.util
import logging
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Optional
import asyncio
import json as _json
import queue as _queue_mod
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse, StreamingResponse
from pydantic import BaseModel

try:
    import orjson as _orjson  # type: ignore[import-not-found]
    _has_orjson = True
except ImportError:
    _has_orjson = False

logger = logging.getLogger(__name__)

# ── Concurrency guard ─────────────────────────────────────────────────────────
# Each Uvicorn worker process has its own copy of this counter, so the actual
# system-wide ceiling is MAX_CONCURRENT_DIFFS × number-of-workers.
# Default: 3 concurrent diffs per worker (= up to 12 on 4-worker production).
# Set MAX_CONCURRENT_DIFFS=1 in .env to restrict to a single job per worker.
_MAX_CONCURRENT_DIFFS: int = int(os.environ.get("MAX_CONCURRENT_DIFFS", "3"))
_active_diffs: int = 0

# Per-job wall-clock timeout. Large PDFs can take 60–120 s; 300 s is generous.
# Set COMPARE_TIMEOUT_SECONDS in .env to override.
_COMPARE_TIMEOUT_SECONDS: int = int(os.environ.get("COMPARE_TIMEOUT_SECONDS", "300"))

# ── Import the pure diff engine ───────────────────────────────────────────────
#
# The engine module may be named either:
#   • pdf_extractor_core   (server-safe wrapper already in src/services/)
#   • comp_extractor       (standalone build)
#
# We try every realistic location so this router works regardless of how the
# project is laid out or from which directory uvicorn is launched.
#
# Search order
# ────────────
#  1. src.services.pdf_extractor_core  — standard package import (preferred)
#  2. src.services.comp_extractor      — alternative package name
#  3. pdf_extractor_core               — flat import (cwd on sys.path)
#  4. comp_extractor                   — flat import
#  5. Direct file path probes          — always works once the file is deployed

_THIS_DIR = Path(__file__).parent          # src/router/  (or src/routers/)
_SVC_DIR  = _THIS_DIR.parent / "services" # src/services/

# Ensure services/ is on sys.path for flat imports (attempts 3 & 4)
if str(_SVC_DIR) not in sys.path:
    sys.path.insert(0, str(_SVC_DIR))


def _load_engine():
    """Try every known name / path for the diff engine. Returns the module or raises."""

    # ── Attempts 1–4: standard importlib ──────────────────────────────────────
    for mod_name in (
        "src.services.comp_extractor",
        "src.services.pdf_extractor_core",
        "comp_extractor",
        "pdf_extractor_core",
    ):
        try:
            m = importlib.import_module(mod_name)
            if not hasattr(m, "compute_diff") or not hasattr(m, "precompute"):
                logger.info("compare router: '%s' missing compute_diff/precompute, skipping", mod_name)
                continue
            logger.info("compare router: diff engine loaded via '%s' ✓", mod_name)
            return m
        except ImportError:
            pass
        except Exception as exc:
            logger.warning("compare router: import '%s' failed: %s", mod_name, exc)

    # ── Attempt 5: direct file path probes ────────────────────────────────────
    candidates = [
        _SVC_DIR / "comp_extractor.py",
        _SVC_DIR / "pdf_extractor_core.py",
        _THIS_DIR.parent / "comp_extractor.py",
        _THIS_DIR.parent / "pdf_extractor_core.py",
    ]
    for fpath in candidates:
        if not fpath.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location("_diff_engine", fpath)
            m = importlib.util.module_from_spec(spec)           # type: ignore[arg-type]
            spec.loader.exec_module(m)                          # type: ignore[union-attr]
            if not hasattr(m, "compute_diff") or not hasattr(m, "precompute"):
                logger.info("compare router: '%s' missing compute_diff/precompute, skipping", fpath)
                continue
            logger.info("compare router: diff engine loaded from '%s' ✓", fpath)
            return m
        except Exception as exc:
            logger.warning("compare router: load from '%s' failed: %s", fpath, exc)

    raise RuntimeError(
        "Could not import diff engine (pdf_extractor_core or comp_extractor).\n"
        f"Searched in: {_SVC_DIR}\n"
        "Make sure pymupdf is installed:  pip install pymupdf\n"
        "And that pdf_extractor_core.py (or comp_extractor.py) is in src/services/"
    )


ce = _load_engine()

# ── Process-safe PDF loader (for parallel multiprocessing) ────────────────────
def _load_pdf_in_process(path: str):
    """Top-level function for ProcessPoolExecutor — loads engine fresh in child."""
    eng = _load_engine()
    return eng.load_pdf(path)


# ─────────────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/compare", tags=["compare"])


# ── Serialisation helpers ─────────────────────────────────────────────────────

def _chunk_to_dict(ch, idx: int) -> dict:
    d = {
        "id":         idx,
        "kind":       ch.kind,          # "add" | "del" | "mod" | "emp"
        "block_a":    ch.block_a,
        "block_b":    ch.block_b,
        "text_a":     ch.text_a or "",
        "text_b":     ch.text_b or "",
        "confidence": round(ch.confidence, 3),
        "reason":     ch.reason or "",
        "context_a":  getattr(ch, "context_a", "") or "",
        "context_b":  getattr(ch, "context_b", "") or "",
        "xml_context": getattr(ch, "xml_context", "") or "",
        "section":    getattr(ch, "section", "") or "",
    }
    # Word-level diff fields (only for MOD chunks that have them)
    wr = getattr(ch, "words_removed", "") or ""
    wa = getattr(ch, "words_added", "") or ""
    if wr or wa:
        d["words_removed"] = wr
        d["words_added"] = wa
        d["words_before"] = getattr(ch, "words_before", "") or ""
        d["words_after"] = getattr(ch, "words_after", "") or ""
    # Emphasis detail (only for EMP chunks)
    emp = getattr(ch, "emp_detail", "") or ""
    if emp:
        d["emp_detail"] = emp
    return d


def _pane_to_json(data: dict) -> dict:
    """
    Serialise precompute() output for the frontend.

    segments     → [[text, tagName], ...]
    tag_cfgs     → { tagName: { background?, foreground?, font?, ... } }
                   font tuples are expanded to { family, size, style }
    offsets      → { "chunkId": charOffset }   (string keys for JSON)
    offset_ends  → { "chunkId": charOffset }
    """
    serialised_segs = [[t, tag] for t, tag in data.get("segments", [])]

    serial_cfgs: dict = {}
    for key, val in data.get("tag_cfgs", {}).items():
        if not isinstance(key, str) or not isinstance(val, dict):
            continue
        cleaned: dict = {}
        for k, v in val.items():
            if isinstance(v, tuple):
                cleaned[k] = {
                    "family": v[0],
                    "size":   v[1],
                    "style":  v[2] if len(v) > 2 else "",
                }
            else:
                cleaned[k] = v
        serial_cfgs[key] = cleaned

    return {
        "segments":    serialised_segs,
        "tag_cfgs":    serial_cfgs,
        "offsets":     {str(k): v for k, v in data.get("offsets", {}).items()},
        "offset_ends": {str(k): v for k, v in data.get("offset_ends", {}).items()},
    }


def _dict_to_chunk(d: dict):
    return ce.Chunk(
        kind=d["kind"],
        block_a=d.get("block_a", -1),
        block_b=d.get("block_b", -1),
        text_a=d.get("text_a", ""),
        text_b=d.get("text_b", ""),
        confidence=d.get("confidence", 1.0),
        reason=d.get("reason", ""),
        context_a=d.get("context_a", ""),
        context_b=d.get("context_b", ""),
        xml_context=d.get("xml_context", ""),
        words_removed=d.get("words_removed", ""),
        words_added=d.get("words_added", ""),
        words_before=d.get("words_before", ""),
        words_after=d.get("words_after", ""),
        section=d.get("section", ""),
    )


# ── POST /compare/diff/inspect ────────────────────────────────────────────────

@router.post("/diff/inspect")
async def diff_pdfs(
    old_file: UploadFile = File(..., description="Old / reference PDF"),
    new_file: UploadFile = File(..., description="New / updated PDF"),
    xml_file_a: Optional[UploadFile] = File(None, description="Old XML ground truth (optional)"),
    xml_file_b: Optional[UploadFile] = File(None, description="New XML ground truth (optional)"),
):
    """
    Run the 3-stage diff pipeline on two uploaded PDFs.

    Returns
    -------
    {
      success  : true
      chunks   : list of change objects  (add / del / mod / emp)
      pane_a   : render data for the left pane  (old doc)
      pane_b   : render data for the right pane (new doc)
      stats    : { total, additions, deletions, modifications, emphasis }
      file_a   : original filename
      file_b   : original filename
    }
    """
    tmp_a = tmp_b = None
    try:
        data_a = await old_file.read()
        data_b = await new_file.read()
        xml_a_text = (await xml_file_a.read()).decode("utf-8", errors="replace") if xml_file_a else None
        xml_b_text = (await xml_file_b.read()).decode("utf-8", errors="replace") if xml_file_b else None

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
            fa.write(data_a)
            tmp_a = fa.name
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
            fb.write(data_b)
            tmp_b = fb.name

        # Stage 1 — extract text from both PDFs (parallel)
        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_a = pool.submit(ce.load_pdf, tmp_a)
            fut_b = pool.submit(ce.load_pdf, tmp_b)
            lines_a = fut_a.result()
            lines_b = fut_b.result()
        t2 = time.perf_counter()
        logging.info(
            "load_pdf (parallel): old=%dlines  new=%dlines  %.2fs",
            len(lines_a), len(lines_b), t2 - t0,
        )

        # Stage 2 — anchor-keyed diff (with optional XML cross-validation)
        blocks_a, blocks_b, chunks = ce.compute_diff(
            lines_a, lines_b,
            xml_text_a=xml_a_text,
            xml_text_b=xml_b_text,
        )
        t3 = time.perf_counter()
        logging.info(
            "compute_diff: blocks_a=%d blocks_b=%d chunks=%d  %.2fs",
            len(blocks_a), len(blocks_b), len(chunks), t3 - t2,
        )

        # Stage 3 — build render segments for each pane (parallel)
        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_pa = pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
            fut_pb = pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
            pane_a = fut_pa.result()
            pane_b = fut_pb.result()
        t5 = time.perf_counter()
        logging.info(
            "precompute (parallel): pane_a+pane_b=%.2fs  total=%.2fs",
            t5 - t3, t5 - t0,
        )

        # Stage 4 — extract XML sections and assign chunks (when XML available)
        xml_sections = []
        if xml_b_text and hasattr(ce, "extract_xml_sections"):
            xml_sections = ce.extract_xml_sections(xml_b_text)
            if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                ce.assign_chunks_to_sections(chunks, xml_sections, xml_b_text)

        payload = {
            "success": True,
            "chunks":  [_chunk_to_dict(ch, i) for i, ch in enumerate(chunks)],
            "pane_a":  _pane_to_json(pane_a),
            "pane_b":  _pane_to_json(pane_b),
            "stats": {
                "total":          len(chunks),
                "additions":      sum(1 for c in chunks if c.kind == ce.KIND_ADD),
                "deletions":      sum(1 for c in chunks if c.kind == ce.KIND_DEL),
                "modifications":  sum(1 for c in chunks if c.kind == ce.KIND_MOD),
                "emphasis":       sum(1 for c in chunks if c.kind == ce.KIND_EMP),
            },
            "xml_sections": [{"id": s["id"], "label": s["label"], "level": s["level"], "parent_id": s["parent_id"]} for s in xml_sections],
            "file_a": old_file.filename,
            "file_b": new_file.filename,
        }

        t6 = time.perf_counter()
        logging.info("payload built in %.2fs", t6 - t5)

        return ORJSONResponse(payload)

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": str(exc), "traceback": traceback.format_exc()},
        )
    finally:
        for p in (tmp_a, tmp_b):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass


# ── POST /compare/diff/stream — with real-time progress ───────────────────────

@router.post("/diff/stream")
async def diff_pdfs_stream(
    old_file: UploadFile = File(..., description="Old / reference PDF"),
    new_file: UploadFile = File(..., description="New / updated PDF"),
    xml_file_a: Optional[UploadFile] = File(None, description="Old XML ground truth (optional)"),
    xml_file_b: Optional[UploadFile] = File(None, description="New XML ground truth (optional)"),
):
    """
    Same as /diff/inspect but streams NDJSON progress lines, then the result.

    Each line is a JSON object:
      {"t":"p","s":"old","p":page,"n":total}   — loading old PDF
      {"t":"p","s":"new","p":page,"n":total}   — loading new PDF
      {"t":"p","s":"diff"}                     — running diff
      {"t":"p","s":"render","chunks":N}        — building render
      {"t":"r","d":{...result...}}             — final result
      {"t":"e","msg":"..."}                    — error
    """
    # ── Concurrency gate ──────────────────────────────────────────────────────
    global _active_diffs
    if _active_diffs >= _MAX_CONCURRENT_DIFFS:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Server is busy — {_active_diffs}/{_MAX_CONCURRENT_DIFFS} comparisons are "
                "already running. Please wait a moment and try again."
            ),
        )
    _active_diffs += 1

    data_a = await old_file.read()
    data_b = await new_file.read()
    xml_a_text = (await xml_file_a.read()).decode("utf-8", errors="replace") if xml_file_a else None
    xml_b_text = (await xml_file_b.read()).decode("utf-8", errors="replace") if xml_file_b else None
    fname_a = old_file.filename
    fname_b = new_file.filename

    q: _queue_mod.Queue = _queue_mod.Queue()

    def _run():
        tmp_a = tmp_b = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
                fa.write(data_a); tmp_a = fa.name
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
                fb.write(data_b); tmp_b = fb.name

            t0 = time.perf_counter()

            # Stage 1 — load PDFs in parallel with per-page progress.
            # Quick open to get page counts for accurate progress reporting.
            try:
                import fitz as _fitz_quick
                _da = _fitz_quick.open(tmp_a); _n_a = len(_da); _da.close()
                _db = _fitz_quick.open(tmp_b); _n_b = len(_db); _db.close()
            except Exception:
                _n_a = _n_b = 1

            # Thread-safe per-page callbacks (Queue.put is always thread-safe).
            # Throttle to at most 1 event per 5% of pages to avoid flooding the
            # NDJSON stream with hundreds of tiny messages on large documents.
            _throttle_a = max(1, _n_a // 20)
            _throttle_b = max(1, _n_b // 20)

            def _prog_old(page: int, total: int):
                if page == total or page % _throttle_a == 0:
                    q.put(_json.dumps({"t": "p", "s": "old", "p": page, "n": total}) + "\n")

            def _prog_new(page: int, total: int):
                if page == total or page % _throttle_b == 0:
                    q.put(_json.dumps({"t": "p", "s": "new", "p": page, "n": total}) + "\n")

            q.put(_json.dumps({"t": "p", "s": "old", "p": 0, "n": _n_a}) + "\n")
            with ThreadPoolExecutor(max_workers=2) as load_pool:
                fut_a = load_pool.submit(ce.load_pdf, tmp_a, _prog_old)
                fut_b = load_pool.submit(ce.load_pdf, tmp_b, _prog_new)
                lines_a = fut_a.result()
                lines_b = fut_b.result()
            q.put(_json.dumps({"t": "p", "s": "new", "p": _n_b, "n": _n_b}) + "\n")

            t1 = time.perf_counter()
            print(f"[TIMING] load_pdf parallel: {len(lines_a)}+{len(lines_b)} lines, {t1-t0:.2f}s", flush=True)

            # Stage 2 — diff (with optional XML cross-validation)
            q.put(_json.dumps({"t": "p", "s": "diff"}) + "\n")

            def _diff_progress(sub_stage: str, pct: int):
                q.put(_json.dumps({"t": "p", "s": "diff", "sub": sub_stage, "sp": pct}) + "\n")

            blocks_a, blocks_b, chunks = ce.compute_diff(
                lines_a, lines_b,
                xml_text_a=xml_a_text,
                xml_text_b=xml_b_text,
                on_progress=_diff_progress,
            )

            t2 = time.perf_counter()
            print(f"[TIMING] compute_diff: {len(chunks)} chunks, {t2-t1:.2f}s", flush=True)

            # Stage 3 — render (precompute IS thread-safe — separate data)
            q.put(_json.dumps({"t": "p", "s": "render", "chunks": len(chunks)}) + "\n")
            with ThreadPoolExecutor(max_workers=2) as pool:
                fut_pa = pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
                fut_pb = pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
                pane_a = fut_pa.result()
                pane_b = fut_pb.result()

            t3 = time.perf_counter()
            print(f"[TIMING] precompute: {t3-t2:.2f}s, total={t3-t0:.2f}s", flush=True)

            # Stage 4 — extract XML sections and assign chunks (when XML available)
            xml_sections = []
            if xml_b_text and hasattr(ce, "extract_xml_sections"):
                xml_sections = ce.extract_xml_sections(xml_b_text)
                if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                    ce.assign_chunks_to_sections(chunks, xml_sections, xml_b_text)

            t5 = time.perf_counter()

            payload = {
                "success": True,
                "chunks": [_chunk_to_dict(ch, i) for i, ch in enumerate(chunks)],
                "pane_a": _pane_to_json(pane_a),
                "pane_b": _pane_to_json(pane_b),
                "stats": {
                    "total":         len(chunks),
                    "additions":     sum(1 for c in chunks if c.kind == ce.KIND_ADD),
                    "deletions":     sum(1 for c in chunks if c.kind == ce.KIND_DEL),
                    "modifications": sum(1 for c in chunks if c.kind == ce.KIND_MOD),
                    "emphasis":      sum(1 for c in chunks if c.kind == ce.KIND_EMP),
                },
                "xml_sections": [{"id": s["id"], "label": s["label"], "level": s["level"], "parent_id": s["parent_id"]} for s in xml_sections],
                "file_a": fname_a,
                "file_b": fname_b,
            }

            t6 = time.perf_counter()
            print(f"[TIMING] payload build: {t6-t5:.2f}s", flush=True)

            # Serialize the big result with orjson when available
            if _has_orjson:
                result_bytes = b'{"t":"r","d":' + _orjson.dumps(payload) + b'}\n'  # type: ignore[name-defined]
            else:
                result_bytes = (_json.dumps({"t": "r", "d": payload}) + "\n").encode()

            t7 = time.perf_counter()
            print(f"[TIMING] serialize: {t7-t6:.2f}s ({len(result_bytes)/1024/1024:.1f}MB), TOTAL={t7-t0:.2f}s", flush=True)

            q.put(result_bytes)
            q.put(None)  # sentinel

        except Exception as exc:
            logging.exception("diff/stream _run failed")
            err_line = _json.dumps({"t": "e", "msg": str(exc)}) + "\n"
            q.put(err_line.encode())
            q.put(None)
        finally:
            for p in (tmp_a, tmp_b):
                if p and os.path.exists(p):
                    try:
                        os.unlink(p)
                    except OSError:
                        pass

    async def _generate():
        global _active_diffs
        loop = asyncio.get_event_loop()
        fut = loop.run_in_executor(None, _run)
        deadline = loop.time() + _COMPARE_TIMEOUT_SECONDS

        try:
            while True:
                # ── Timeout guard ─────────────────────────────────────────────
                if loop.time() > deadline:
                    logger.warning("diff/stream timed out after %ss", _COMPARE_TIMEOUT_SECONDS)
                    yield (
                        _json.dumps({
                            "t": "e",
                            "msg": (
                                f"Compare job timed out after {_COMPARE_TIMEOUT_SECONDS}s. "
                                "Try splitting the document into smaller sections."
                            ),
                        }) + "\n"
                    ).encode()
                    break

                try:
                    item = q.get_nowait()
                    if item is None:
                        break
                    yield item if isinstance(item, bytes) else item.encode()
                except _queue_mod.Empty:
                    if fut.done():
                        # Drain remaining items
                        while not q.empty():
                            item = q.get_nowait()
                            if item is None:
                                break
                            yield item if isinstance(item, bytes) else item.encode()
                        # Check for executor exceptions
                        exc = fut.exception()
                        if exc:
                            yield (_json.dumps({"t": "e", "msg": str(exc)}) + "\n").encode()
                        break
                    await asyncio.sleep(0.05)
        finally:
            _active_diffs -= 1

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"},
    )


# ── POST /compare/xml/apply ───────────────────────────────────────────────────

class ApplyRequest(BaseModel):
    xml_text: str
    chunk: dict


class ApplyResponse(BaseModel):
    success:    bool
    changed:    bool
    xml_text:   str
    message:    str
    span_start: Optional[int] = None
    span_end:   Optional[int] = None


@router.post("/xml/apply", response_model=ApplyResponse)
async def apply_chunk(body: ApplyRequest):
    """Apply one diff chunk into XML. Returns updated XML + a nav highlight span."""
    try:
        ch = _dict_to_chunk(body.chunk)
        updated, changed, msg, span = ce._apply_chunk_to_xml(body.xml_text, ch)
        return ApplyResponse(
            success=True,
            changed=changed,
            xml_text=updated,
            message=msg,
            span_start=span[0] if span else None,
            span_end=span[1]   if span else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── POST /compare/xml/locate ──────────────────────────────────────────────────

class LocateRequest(BaseModel):
    xml_text: str
    chunk: dict


class LocateResponse(BaseModel):
    success:    bool
    span_start: Optional[int] = None
    span_end:   Optional[int] = None


@router.post("/xml/locate", response_model=LocateResponse)
async def locate_chunk(body: LocateRequest):
    """Find where a chunk appears in XML without modifying it (for nav highlight)."""
    try:
        ch = _dict_to_chunk(body.chunk)
        probe = (
            ch.text_b if ch.kind in (ce.KIND_ADD, ce.KIND_MOD) else ch.text_a
        ) or ch.text_a or ch.text_b or ""
        span = ce._locate_xml_span(body.xml_text, probe)
        return LocateResponse(
            success=True,
            span_start=span[0] if span else None,
            span_end=span[1]   if span else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── GET /compare/health ───────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {
        "status":    "ok",
        "rapidfuzz": getattr(ce, "_USE_RAPIDFUZZ", False),
        "engine":    getattr(ce, "__file__", "unknown"),
    }


# ── POST /compare/xml/sections — parse XML structure ──────────────────────────

class SectionsRequest(BaseModel):
    xml_text: str


@router.post("/xml/sections")
async def parse_xml_sections(body: SectionsRequest):
    """Parse the innodLevel structure of an XML document and return sections."""
    try:
        if not hasattr(ce, "extract_xml_sections"):
            return {"success": True, "sections": []}
        sections = ce.extract_xml_sections(body.xml_text)
        return {
            "success": True,
            "sections": [
                {"id": s["id"], "label": s["label"], "level": s["level"], "parent_id": s["parent_id"]}
                for s in sections
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))