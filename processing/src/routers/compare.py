"""
src/router/compare.py
=====================
FastAPI router for the PDF Diff Inspector feature.

LARGE-DOCUMENT CHANGES
───────────────────────
  POST /compare/diff/stream/large
    New endpoint for documents > 100 pages.  Processes the PDFs in
    PAGE_BATCH_SIZE-page batches (default 50).  Each batch is extracted,
    diffed, and streamed immediately before the next batch is loaded,
    so peak RAM stays at ~batch_size × 2 pages instead of the full document.

  GET /compare/diff/{job_id}/segments
    Lazy segment fetch — the frontend requests segments only for the
    page range currently visible.  The full result is stored server-side
    in an in-memory LRU cache keyed by job_id for 10 minutes.

Endpoints
─────────
POST /compare/diff/stream        Compare two PDFs → streaming NDJSON (≤100 pages)
POST /compare/diff/stream/large  Compare two PDFs → streaming NDJSON (1000 pages)
GET  /compare/diff/{job_id}/segments  Lazy segment fetch for large docs
POST /compare/diff              Compare two PDFs → single JSON (≤100 pages)
POST /compare/xml/apply         Apply one diff chunk into XML
POST /compare/xml/locate        Locate a chunk in XML (read-only, for highlight)
GET  /compare/health            Health check + rapidfuzz/engine status
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import json as _json
import logging
import os
import queue as _queue_mod
import sys
import tempfile
import threading
import time
import traceback
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse, StreamingResponse
from pydantic import BaseModel

# orjson is optional — use stdlib json as fallback.
# We import into a local variable so Pylance never sees _orjson as "possibly
# unbound": _dumps_fast is always defined regardless of whether orjson exists.
try:
    import orjson as _orjson_mod  # type: ignore[import-not-found]
    def _dumps_fast(obj: object) -> bytes:
        return _orjson_mod.dumps(obj)          # type: ignore[no-any-return]
except ImportError:
    def _dumps_fast(obj: object) -> bytes:     # type: ignore[misc]
        return (_json.dumps(obj) + "\n").encode()

logger = logging.getLogger(__name__)

# ── Concurrency guard ─────────────────────────────────────────────────────────
_MAX_CONCURRENT_DIFFS: int = int(os.environ.get("MAX_CONCURRENT_DIFFS", "5"))
_active_diffs: int = 0
_RETRY_AFTER_SECONDS: int = 30
_COMPARE_TIMEOUT_SECONDS: int = int(os.environ.get("COMPARE_TIMEOUT_SECONDS", "600"))

# ── Batch size for large-document streaming ───────────────────────────────────
# 50 pages ≈ 5–10 MB RAM per batch for typical legal PDFs.
# Reduce to 25 if you see OOM on image-heavy PDFs.
PAGE_BATCH_SIZE: int = int(os.environ.get("COMPARE_BATCH_SIZE", "50"))

# ── File size limit (200 MB) ──────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES: int = int(os.environ.get("MAX_FILE_SIZE_MB", "200")) * 1024 * 1024

# Large-document threshold — docs with more pages than this use the batched
# endpoint automatically when called via /diff/stream/large.
LARGE_DOC_THRESHOLD: int = int(os.environ.get("LARGE_DOC_THRESHOLD", "100"))

# ── In-memory LRU cache for large-doc results (lazy segment fetch) ───────────
# Stores serialised pane data keyed by job_id.
# Max 20 jobs × ~50 MB each = ~1 GB max cache footprint.
# TTL enforced by insertion timestamp.
_RESULT_CACHE_MAX  = int(os.environ.get("RESULT_CACHE_MAX", "20"))
_RESULT_CACHE_TTL  = int(os.environ.get("RESULT_CACHE_TTL", "600"))   # seconds

class _LRUCache:
    """Thread-safe LRU cache with per-entry TTL."""

    def __init__(self, maxsize: int, ttl: int):
        self._maxsize = maxsize
        self._ttl     = ttl
        self._store:  OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def set(self, key: str, value: dict) -> None:
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = {"v": value, "ts": time.monotonic()}
            while len(self._store) > self._maxsize:
                self._store.popitem(last=False)

    def get(self, key: str) -> dict | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.monotonic() - entry["ts"] > self._ttl:
                del self._store[key]
                return None
            self._store.move_to_end(key)
            return entry["v"]

_result_cache = _LRUCache(_RESULT_CACHE_MAX, _RESULT_CACHE_TTL)


# ── Diff engine loader ────────────────────────────────────────────────────────

_THIS_DIR = Path(__file__).parent
_SVC_DIR  = _THIS_DIR.parent / "services"

if str(_SVC_DIR) not in sys.path:
    sys.path.insert(0, str(_SVC_DIR))


def _load_engine():
    for mod_name in (
        "src.services.comp_extractor",
        "src.services.pdf_extractor_core",
        "comp_extractor",
        "pdf_extractor_core",
    ):
        try:
            m = importlib.import_module(mod_name)
            if not hasattr(m, "compute_diff") or not hasattr(m, "precompute"):
                continue
            logger.info("compare router: diff engine loaded via '%s' ✓", mod_name)
            return m
        except ImportError:
            pass
        except Exception as exc:
            logger.warning("compare router: import '%s' failed: %s", mod_name, exc)

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
            m    = importlib.util.module_from_spec(spec)       # type: ignore[arg-type]
            spec.loader.exec_module(m)                         # type: ignore[union-attr]
            if not hasattr(m, "compute_diff") or not hasattr(m, "precompute"):
                continue
            logger.info("compare router: diff engine loaded from '%s' ✓", fpath)
            return m
        except Exception as exc:
            logger.warning("compare router: load from '%s' failed: %s", fpath, exc)

    raise RuntimeError(
        "Could not import diff engine (pdf_extractor_core or comp_extractor).\n"
        f"Searched in: {_SVC_DIR}\n"
        "Make sure pymupdf is installed:  pip install pymupdf"
    )


ce = _load_engine()


# ── Extractor with load_pdf_batched support ───────────────────────────────────

def _get_extractor():
    """
    Return the pdf_extractor_core module that provides load_pdf_batched().
    We try the same search order as _load_engine() but look for the
    large-doc-aware version (has load_pdf_batched attribute).
    Falls back gracefully to ce (the diff engine) if it also has load_pdf.
    """
    for mod_name in (
        "src.services.pdf_extractor_core",
        "pdf_extractor_core",
    ):
        try:
            m = importlib.import_module(mod_name)
            if hasattr(m, "load_pdf_batched"):
                return m
        except ImportError:
            pass

    # Fallback: use the diff engine module if it has load_pdf
    if hasattr(ce, "load_pdf_batched"):
        return ce
    return None


_extractor = _get_extractor()


# Type-narrowed helpers so Pylance never complains about None member access.
# These raise early with a clear message if the extractor wasn't loaded.

def _ext_page_count(path: str) -> int:
    if _extractor is None:
        raise RuntimeError("pdf_extractor_core not loaded — update pdf_extractor_core.py")
    return _extractor.load_pdf_page_count(path)  # type: ignore[union-attr]


def _ext_load_pdf(path: str, progress_cb, page_start: int, page_end: int):
    if _extractor is None:
        raise RuntimeError("pdf_extractor_core not loaded — update pdf_extractor_core.py")
    return _extractor.load_pdf(path, progress_cb, page_start, page_end)  # type: ignore[union-attr]


# ─────────────────────────────────────────────────────────────────────────────
#  SERIALISATION HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _chunk_to_dict(ch, idx: int) -> dict:
    d = {
        "id":          idx,
        "kind":        ch.kind,
        "block_a":     ch.block_a,
        "block_b":     ch.block_b,
        "text_a":      ch.text_a or "",
        "text_b":      ch.text_b or "",
        "confidence":  round(ch.confidence, 3),
        "reason":      ch.reason or "",
        "context_a":   getattr(ch, "context_a", "") or "",
        "context_b":   getattr(ch, "context_b", "") or "",
        "xml_context": getattr(ch, "xml_context", "") or "",
        "section":     getattr(ch, "section", "") or "",
    }
    wr = getattr(ch, "words_removed", "") or ""
    wa = getattr(ch, "words_added",   "") or ""
    if wr or wa:
        d["words_removed"] = wr
        d["words_added"]   = wa
        d["words_before"]  = getattr(ch, "words_before", "") or ""
        d["words_after"]   = getattr(ch, "words_after",  "") or ""
    emp = getattr(ch, "emp_detail", "") or ""
    if emp:
        d["emp_detail"] = emp
    return d


def _pane_to_json(data: dict) -> dict:
    serialised_segs: list = [[t, tag] for t, tag in data.get("segments", [])]

    serial_cfgs: dict = {}
    for key, val in data.get("tag_cfgs", {}).items():
        if not isinstance(key, str) or not isinstance(val, dict):
            continue
        cleaned: dict = {}
        for k, v in val.items():
            if isinstance(v, tuple):
                cleaned[k] = {"family": v[0], "size": v[1], "style": v[2] if len(v) > 2 else ""}
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
        kind         = d["kind"],
        block_a      = d.get("block_a", -1),
        block_b      = d.get("block_b", -1),
        text_a       = d.get("text_a",  ""),
        text_b       = d.get("text_b",  ""),
        confidence   = d.get("confidence", 1.0),
        reason       = d.get("reason",  ""),
        context_a    = d.get("context_a",   ""),
        context_b    = d.get("context_b",   ""),
        xml_context  = d.get("xml_context", ""),
        words_removed= d.get("words_removed",""),
        words_added  = d.get("words_added",  ""),
        words_before = d.get("words_before", ""),
        words_after  = d.get("words_after",  ""),
        section      = d.get("section",      ""),
    )


def _check_file_size(file: UploadFile):
    """Raise HTTPException if file size exceeds MAX_FILE_SIZE_BYTES."""
    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        max_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File '{file.filename}' is too large. Maximum size is {max_mb} MB."
        )


# ─────────────────────────────────────────────────────────────────────────────
#  ROUTER
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/compare", tags=["compare"])


# ── POST /compare/diff  (non-streaming, small docs) ──────────────────────────

@router.post("/diff")
async def diff_pdfs(
    old_file:   UploadFile = File(...),
    new_file:   UploadFile = File(...),
    xml_file_a: Optional[UploadFile] = File(None),
    xml_file_b: Optional[UploadFile] = File(None),
):
    tmp_a = tmp_b = None
    try:
        _check_file_size(old_file)
        _check_file_size(new_file)
        data_a = await old_file.read()
        data_b = await new_file.read()
        xml_a  = (await xml_file_a.read()).decode("utf-8", errors="replace") if xml_file_a else None
        xml_b  = (await xml_file_b.read()).decode("utf-8", errors="replace") if xml_file_b else None

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
            fa.write(data_a); tmp_a = fa.name
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
            fb.write(data_b); tmp_b = fb.name

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_a = pool.submit(ce.load_pdf, tmp_a)
            fut_b = pool.submit(ce.load_pdf, tmp_b)
            lines_a = fut_a.result()
            lines_b = fut_b.result()

        blocks_a, blocks_b, chunks = ce.compute_diff(lines_a, lines_b, xml_text_a=xml_a, xml_text_b=xml_b)

        with ThreadPoolExecutor(max_workers=2) as pool:
            fut_pa = pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
            fut_pb = pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
            pane_a = fut_pa.result()
            pane_b = fut_pb.result()

        xml_sections = []
        if xml_b and hasattr(ce, "extract_xml_sections"):
            xml_sections = ce.extract_xml_sections(xml_b)
            if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                ce.assign_chunks_to_sections(chunks, xml_sections, xml_b)

        payload = {
            "success": True,
            "chunks":  [_chunk_to_dict(ch, i) for i, ch in enumerate(chunks)],
            "pane_a":  _pane_to_json(pane_a),
            "pane_b":  _pane_to_json(pane_b),
            "stats":   {
                "total":         len(chunks),
                "additions":     sum(1 for c in chunks if c.kind == ce.KIND_ADD),
                "deletions":     sum(1 for c in chunks if c.kind == ce.KIND_DEL),
                "modifications": sum(1 for c in chunks if c.kind == ce.KIND_MOD),
                "emphasis":      sum(1 for c in chunks if c.kind == ce.KIND_EMP),
            },
            "xml_sections": [{"id": s["id"], "label": s["label"], "level": s["level"],
                               "parent_id": s["parent_id"]} for s in xml_sections],
            "file_a": old_file.filename,
            "file_b": new_file.filename,
        }
        logger.info("diff: %.2fs total", time.perf_counter() - t0)
        return ORJSONResponse(payload)

    except Exception as exc:
        logger.exception("diff_pdfs failed")
        raise HTTPException(
            status_code=500,
            detail={"error": str(exc)},
        )
    finally:
        for p in (tmp_a, tmp_b):
            if p and os.path.exists(p):
                try: os.unlink(p)
                except OSError: pass


# ── POST /compare/diff/stream  (streaming, ≤100 pages) ───────────────────────

@router.post("/diff/stream")
async def diff_pdfs_stream(
    old_file:     UploadFile       = File(...),
    new_file:     UploadFile       = File(...),
    xml_file_a:   Optional[UploadFile] = File(None),
    xml_file_b:   Optional[UploadFile] = File(None),
    page_start_a: Optional[int]    = Form(None),
    page_end_a:   Optional[int]    = Form(None),
    page_start_b: Optional[int]    = Form(None),
    page_end_b:   Optional[int]    = Form(None),
):
    global _active_diffs
    if _active_diffs >= _MAX_CONCURRENT_DIFFS:
        raise HTTPException(
            status_code=429,
            detail=f"Server busy — {_active_diffs}/{_MAX_CONCURRENT_DIFFS} comparisons running.",
            headers={"Retry-After": str(_RETRY_AFTER_SECONDS)},
        )
    _active_diffs += 1
    try:
        _check_file_size(old_file)
        _check_file_size(new_file)
        data_a     = await old_file.read()
        data_b     = await new_file.read()
        xml_a_text = (await xml_file_a.read()).decode("utf-8", errors="replace") if xml_file_a else None
        xml_b_text = (await xml_file_b.read()).decode("utf-8", errors="replace") if xml_file_b else None
        fname_a    = old_file.filename
        fname_b    = new_file.filename
    except Exception:
        _active_diffs -= 1
        raise

    q: _queue_mod.Queue = _queue_mod.Queue()

    def _run():
        tmp_a = tmp_b = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
                fa.write(data_a); tmp_a = fa.name
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
                fb.write(data_b); tmp_b = fb.name

            t0 = time.perf_counter()

            try:
                import fitz as _fz
                _da = _fz.open(tmp_a); _n_a = len(_da); _da.close()
                _db = _fz.open(tmp_b); _n_b = len(_db); _db.close()
            except Exception:
                _n_a = _n_b = 1

            _thr_a = max(1, _n_a // 20)
            _thr_b = max(1, _n_b // 20)

            def _prog_old(page: int, total: int):
                if page == total or page % _thr_a == 0:
                    q.put(_json.dumps({"t": "p", "s": "old", "p": page, "n": total}) + "\n")

            def _prog_new(page: int, total: int):
                if page == total or page % _thr_b == 0:
                    q.put(_json.dumps({"t": "p", "s": "new", "p": page, "n": total}) + "\n")

            q.put(_json.dumps({"t": "p", "s": "old", "p": 0, "n": _n_a}) + "\n")
            with ThreadPoolExecutor(max_workers=2) as load_pool:
                fut_a   = load_pool.submit(ce.load_pdf, tmp_a, _prog_old, page_start_a, page_end_a)
                fut_b   = load_pool.submit(ce.load_pdf, tmp_b, _prog_new, page_start_b, page_end_b)
                lines_a = fut_a.result()
                lines_b = fut_b.result()
            q.put(_json.dumps({"t": "p", "s": "new", "p": _n_b, "n": _n_b}) + "\n")

            t1 = time.perf_counter()
            logger.info("[TIMING] load_pdf: %d+%d lines, %.2fs", len(lines_a), len(lines_b), t1 - t0)

            q.put(_json.dumps({"t": "p", "s": "diff"}) + "\n")

            def _diff_progress(sub: str, pct: int):
                q.put(_json.dumps({"t": "p", "s": "diff", "sub": sub, "sp": pct}) + "\n")

            blocks_a, blocks_b, chunks = ce.compute_diff(
                lines_a, lines_b,
                xml_text_a=xml_a_text, xml_text_b=xml_b_text,
                on_progress=_diff_progress,
            )

            t2 = time.perf_counter()
            logger.info("[TIMING] compute_diff: %d chunks, %.2fs", len(chunks), t2 - t1)

            q.put(_json.dumps({"t": "p", "s": "render", "chunks": len(chunks)}) + "\n")
            with ThreadPoolExecutor(max_workers=2) as pool:
                fut_pa = pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
                fut_pb = pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
                pane_a = fut_pa.result()
                pane_b = fut_pb.result()

            t3 = time.perf_counter()
            logger.info("[TIMING] precompute: %.2fs, total=%.2fs", t3 - t2, t3 - t0)

            xml_sections = []
            if xml_b_text and hasattr(ce, "extract_xml_sections"):
                xml_sections = ce.extract_xml_sections(xml_b_text)
                if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                    ce.assign_chunks_to_sections(chunks, xml_sections, xml_b_text)

            payload = {
                "success":      True,
                "chunks":       [_chunk_to_dict(ch, i) for i, ch in enumerate(chunks)],
                "pane_a":       _pane_to_json(pane_a),
                "pane_b":       _pane_to_json(pane_b),
                "stats":        {
                    "total":         len(chunks),
                    "additions":     sum(1 for c in chunks if c.kind == ce.KIND_ADD),
                    "deletions":     sum(1 for c in chunks if c.kind == ce.KIND_DEL),
                    "modifications": sum(1 for c in chunks if c.kind == ce.KIND_MOD),
                    "emphasis":      sum(1 for c in chunks if c.kind == ce.KIND_EMP),
                },
                "xml_sections": [{"id": s["id"], "label": s["label"], "level": s["level"],
                                   "parent_id": s["parent_id"]} for s in xml_sections],
                "file_a":       fname_a,
                "file_b":       fname_b,
            }

            result_bytes = b'{"t":"r","d":' + _dumps_fast(payload).rstrip(b"\n") + b"}\n"

            logger.info("[TIMING] serialize: %.1f MB, TOTAL=%.2fs",
                        len(result_bytes) / 1048576, time.perf_counter() - t0)

            q.put(result_bytes)
            q.put(None)

        except Exception as exc:
            logging.exception("diff/stream _run failed")
            q.put((_json.dumps({"t": "e", "msg": str(exc)}) + "\n").encode())
            q.put(None)
        finally:
            for p in (tmp_a, tmp_b):
                if p and os.path.exists(p):
                    try: os.unlink(p)
                    except OSError: pass

    async def _generate():
        global _active_diffs
        loop     = asyncio.get_running_loop()
        fut      = loop.run_in_executor(None, _run)
        deadline = loop.time() + _COMPARE_TIMEOUT_SECONDS

        try:
            while True:
                if loop.time() > deadline:
                    yield (_json.dumps({
                        "t": "e",
                        "msg": f"Compare timed out after {_COMPARE_TIMEOUT_SECONDS}s.",
                    }) + "\n").encode()
                    break
                try:
                    item = q.get_nowait()
                    if item is None:
                        break
                    yield item if isinstance(item, bytes) else item.encode()
                except _queue_mod.Empty:
                    if fut.done():
                        while not q.empty():
                            item = q.get_nowait()
                            if item is None: break
                            yield item if isinstance(item, bytes) else item.encode()
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


# ── POST /compare/diff/stream/large  (batched, 1000+ pages) ──────────────────

@router.post("/diff/stream/large")
async def diff_pdfs_stream_large(
    old_file:   UploadFile = File(...),
    new_file:   UploadFile = File(...),
    xml_file_a: Optional[UploadFile] = File(None),
    xml_file_b: Optional[UploadFile] = File(None),
):
    """
    Compare two large PDFs (100–1000+ pages) using batched page streaming.

    HOW IT WORKS
    ────────────
    1.  Both PDFs are written to temp files.
    2.  Page counts are read (zero-cost: just opens, reads len(), closes).
    3.  A batch schedule is built: [(0,49), (50,99), (100,149), …].
    4.  For each batch:
        a. extract() — load_pdf(tmp, page_start=N, page_end=N+49)
        b. diff()    — compute_diff on just these lines
        c. render()  — precompute pane segments for these lines
        d. stream()  — send {"t":"batch", …} NDJSON line to client
        e. free RAM  — lines go out of scope, GC collects before next batch
    5.  After all batches a {"t":"done", …} summary line is sent.
    6.  Full result is stored in _result_cache so the frontend can fetch
        segments lazily via GET /compare/diff/{job_id}/segments.

    NDJSON protocol
    ───────────────
    {"t":"p",   "s":"schedule", "batches":N, "pages":P}   — plan
    {"t":"p",   "s":"batch",    "batch":K, "of":N,         — per-batch progress
                "pages":[start,end], "pct":0-100}
    {"t":"batch","batch":K, "of":N,                        — per-batch result
                "chunks":[…], "pane_a":{…}, "pane_b":{…},
                "stats":{…}, "page_range":[start,end]}
    {"t":"done", "job_id":"…", "stats":{…}, "file_a":"…",  — final summary
                "file_b":"…", "xml_sections":[…]}
    {"t":"e",   "msg":"…"}                                  — error
    """
    if _extractor is None:
        raise HTTPException(
            status_code=501,
            detail="load_pdf_batched not available.  Update pdf_extractor_core.py.",
        )

    global _active_diffs
    if _active_diffs >= _MAX_CONCURRENT_DIFFS:
        raise HTTPException(
            status_code=429,
            detail=f"Server busy — {_active_diffs}/{_MAX_CONCURRENT_DIFFS} comparisons running.",
            headers={"Retry-After": str(_RETRY_AFTER_SECONDS)},
        )
    _active_diffs += 1
    try:
        _check_file_size(old_file)
        _check_file_size(new_file)
        data_a     = await old_file.read()
        data_b     = await new_file.read()
        xml_a_text = (await xml_file_a.read()).decode("utf-8", errors="replace") if xml_file_a else None
        xml_b_text = (await xml_file_b.read()).decode("utf-8", errors="replace") if xml_file_b else None
        fname_a    = old_file.filename
        fname_b    = new_file.filename
        job_id     = str(uuid.uuid4())
    except Exception:
        _active_diffs -= 1
        raise

    q: _queue_mod.Queue = _queue_mod.Queue()

    def _run_large():
        tmp_a = tmp_b = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
                fa.write(data_a); tmp_a = fa.name
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
                fb.write(data_b); tmp_b = fb.name

            t0 = time.perf_counter()

            # 1. Page count — zero extraction cost
            n_a = _ext_page_count(tmp_a)
            n_b = _ext_page_count(tmp_b)
            # Use whichever is larger to build the batch schedule
            n_pages  = max(n_a, n_b)
            batches  = list(range(0, n_pages, PAGE_BATCH_SIZE))
            n_batches = len(batches)

            q.put(_json.dumps({
                "t": "p", "s": "schedule",
                "batches": n_batches, "pages": n_pages,
                "old_pages": n_a, "new_pages": n_b,
            }) + "\n")

            logger.info("diff/stream/large: job=%s  old=%d pages  new=%d pages  "
                        "%d batches × %d pages", job_id, n_a, n_b, n_batches, PAGE_BATCH_SIZE)

            # Accumulate results across batches for the final cache entry
            all_chunks:  list = []
            all_pane_a_segs: list = []
            all_pane_b_segs: list = []
            # tag_cfgs / offsets are small and shared; keep last batch's version
            last_tag_cfgs_a: dict = {}
            last_tag_cfgs_b: dict = {}
            all_offsets_a:   dict = {}
            all_offsets_b:   dict = {}
            all_offset_ends_a: dict = {}
            all_offset_ends_b: dict = {}

            for batch_k, batch_start in enumerate(batches):
                batch_end = min(batch_start + PAGE_BATCH_SIZE - 1, n_pages - 1)
                # Clip to each PDF's actual page count
                old_start = batch_start
                old_end   = min(batch_end, n_a - 1)
                new_start = batch_start
                new_end   = min(batch_end, n_b - 1)

                pct_start = int(batch_k / n_batches * 90)
                pct_end   = int((batch_k + 1) / n_batches * 90)

                q.put(_json.dumps({
                    "t": "p", "s": "batch",
                    "batch": batch_k + 1, "of": n_batches,
                    "pages": [batch_start, batch_end],
                    "pct":   pct_start,
                    "msg":   f"Extracting pages {batch_start}–{batch_end}…",
                }) + "\n")

                # a. Extract this batch from both PDFs in parallel
                # Guard: if this PDF is shorter, skip its batch (return empty)
                def _safe_load(path, start, end):
                    if start > end:
                        return []
                    return _ext_load_pdf(path, None, start, end)

                with ThreadPoolExecutor(max_workers=2) as pool:
                    fut_a = pool.submit(_safe_load, tmp_a, old_start, old_end)
                    fut_b = pool.submit(_safe_load, tmp_b, new_start, new_end)
                    lines_a = fut_a.result()
                    lines_b = fut_b.result()

                q.put(_json.dumps({
                    "t": "p", "s": "batch",
                    "batch": batch_k + 1, "of": n_batches,
                    "pages": [batch_start, batch_end],
                    "pct":   pct_start + (pct_end - pct_start) // 3,
                    "msg":   f"Diffing pages {batch_start}–{batch_end}…",
                }) + "\n")

                # b. Diff
                try:
                    blocks_a, blocks_b, chunks = ce.compute_diff(
                        lines_a, lines_b,
                        xml_text_a=xml_a_text, xml_text_b=xml_b_text,
                    )
                except Exception as diff_exc:
                    logger.warning("batch %d diff failed: %s", batch_k, diff_exc)
                    chunks = []; blocks_a = lines_a; blocks_b = lines_b

                q.put(_json.dumps({
                    "t": "p", "s": "batch",
                    "batch": batch_k + 1, "of": n_batches,
                    "pages": [batch_start, batch_end],
                    "pct":   pct_start + 2 * (pct_end - pct_start) // 3,
                    "msg":   f"Rendering {len(chunks)} changes for pages {batch_start}–{batch_end}…",
                }) + "\n")

                # c. Render pane segments for this batch
                with ThreadPoolExecutor(max_workers=2) as pool:
                    fut_pa = pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
                    fut_pb = pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
                    pane_a = fut_pa.result()
                    pane_b = fut_pb.result()

                # Assign sequential IDs that don't collide across batches
                id_offset = len(all_chunks)
                chunks_dicts = [_chunk_to_dict(ch, id_offset + i) for i, ch in enumerate(chunks)]
                all_chunks.extend(chunks_dicts)

                pane_a_json = _pane_to_json(pane_a)
                pane_b_json = _pane_to_json(pane_b)

                # Accumulate pane data — remap chunk IDs in offsets
                all_pane_a_segs.extend(pane_a_json["segments"])
                all_pane_b_segs.extend(pane_b_json["segments"])
                for cid, off in pane_a_json["offsets"].items():
                    all_offsets_a[str(int(cid) + id_offset)] = off
                for cid, off in pane_a_json["offset_ends"].items():
                    all_offset_ends_a[str(int(cid) + id_offset)] = off
                for cid, off in pane_b_json["offsets"].items():
                    all_offsets_b[str(int(cid) + id_offset)] = off
                for cid, off in pane_b_json["offset_ends"].items():
                    all_offset_ends_b[str(int(cid) + id_offset)] = off
                last_tag_cfgs_a = pane_a_json["tag_cfgs"]
                last_tag_cfgs_b = pane_b_json["tag_cfgs"]

                batch_stats = {
                    "total":         len(chunks),
                    "additions":     sum(1 for c in chunks if c.kind == ce.KIND_ADD),
                    "deletions":     sum(1 for c in chunks if c.kind == ce.KIND_DEL),
                    "modifications": sum(1 for c in chunks if c.kind == ce.KIND_MOD),
                    "emphasis":      sum(1 for c in chunks if c.kind == ce.KIND_EMP),
                }

                # d. Stream this batch result
                batch_payload = {
                    "t":          "batch",
                    "batch":      batch_k + 1,
                    "of":         n_batches,
                    "page_range": [batch_start, batch_end],
                    "chunks":     chunks_dicts,
                    "pane_a":     pane_a_json,
                    "pane_b":     pane_b_json,
                    "stats":      batch_stats,
                }
                q.put(_dumps_fast(batch_payload).rstrip(b"\n") + b"\n")

                # e. Free this batch's RAM before the next iteration
                del lines_a, lines_b, blocks_a, blocks_b, chunks, pane_a, pane_b
                logger.info("[batch %d/%d] pages=%d-%d  elapsed=%.1fs",
                            batch_k + 1, n_batches, batch_start, batch_end,
                            time.perf_counter() - t0)

            # ── XML sections (run once on the assembled result) ────────────
            xml_sections: list = []
            if xml_b_text and hasattr(ce, "extract_xml_sections"):
                try:
                    xml_sections = ce.extract_xml_sections(xml_b_text)
                    if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                        ce.assign_chunks_to_sections(all_chunks, xml_sections, xml_b_text)
                except Exception as xs_exc:
                    logger.warning("xml_sections failed: %s", xs_exc)

            total_stats = {
                "total":         len(all_chunks),
                "additions":     sum(1 for c in all_chunks if c.get("kind") == ce.KIND_ADD),
                "deletions":     sum(1 for c in all_chunks if c.get("kind") == ce.KIND_DEL),
                "modifications": sum(1 for c in all_chunks if c.get("kind") == ce.KIND_MOD),
                "emphasis":      sum(1 for c in all_chunks if c.get("kind") == ce.KIND_EMP),
            }

            # ── Store full result in LRU cache for lazy segment fetch ──────
            full_pane_a = {
                "segments":    all_pane_a_segs,
                "tag_cfgs":    last_tag_cfgs_a,
                "offsets":     all_offsets_a,
                "offset_ends": all_offset_ends_a,
            }
            full_pane_b = {
                "segments":    all_pane_b_segs,
                "tag_cfgs":    last_tag_cfgs_b,
                "offsets":     all_offsets_b,
                "offset_ends": all_offset_ends_b,
            }
            _result_cache.set(job_id, {
                "chunks":       all_chunks,
                "pane_a":       full_pane_a,
                "pane_b":       full_pane_b,
                "stats":        total_stats,
                "xml_sections": xml_sections,
                "file_a":       fname_a,
                "file_b":       fname_b,
                "total_pages":  n_pages,
            })

            # ── Final "done" message ───────────────────────────────────────
            done_payload = {
                "t":            "done",
                "job_id":       job_id,
                "stats":        total_stats,
                "xml_sections": [{"id": s["id"], "label": s["label"],
                                   "level": s["level"], "parent_id": s["parent_id"]}
                                  for s in xml_sections],
                "file_a":       fname_a,
                "file_b":       fname_b,
                "total_pages":  n_pages,
                "elapsed_s":    round(time.perf_counter() - t0, 2),
            }
            q.put(_dumps_fast(done_payload).rstrip(b"\n") + b"\n")

            logger.info("diff/stream/large: job=%s done  chunks=%d  elapsed=%.1fs",
                        job_id, len(all_chunks), time.perf_counter() - t0)
            q.put(None)

        except Exception as exc:
            logging.exception("diff/stream/large _run_large failed")
            q.put((_json.dumps({"t": "e", "msg": str(exc)}) + "\n").encode())
            q.put(None)
        finally:
            for p in (tmp_a, tmp_b):
                if p and os.path.exists(p):
                    try: os.unlink(p)
                    except OSError: pass

    async def _generate_large():
        global _active_diffs
        loop     = asyncio.get_running_loop()
        fut      = loop.run_in_executor(None, _run_large)
        deadline = loop.time() + _COMPARE_TIMEOUT_SECONDS

        try:
            while True:
                if loop.time() > deadline:
                    yield (_json.dumps({
                        "t": "e",
                        "msg": f"Compare timed out after {_COMPARE_TIMEOUT_SECONDS}s.",
                    }) + "\n").encode()
                    break
                try:
                    item = q.get_nowait()
                    if item is None:
                        break
                    yield item if isinstance(item, bytes) else item.encode()
                except _queue_mod.Empty:
                    if fut.done():
                        while not q.empty():
                            item = q.get_nowait()
                            if item is None: break
                            yield item if isinstance(item, bytes) else item.encode()
                        exc = fut.exception()
                        if exc:
                            yield (_json.dumps({"t": "e", "msg": str(exc)}) + "\n").encode()
                        break
                    await asyncio.sleep(0.05)
        finally:
            _active_diffs -= 1

    return StreamingResponse(
        _generate_large(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"},
    )


# ── GET /compare/diff/{job_id}/segments  (lazy fetch for large docs) ──────────

@router.get("/diff/{job_id}/segments")
async def get_segments(
    job_id:     str,
    page_start: int = 0,
    page_end:   int = 49,
):
    """
    Fetch pane segments for a specific page range from a cached diff result.

    The frontend calls this as the user scrolls, requesting only the segments
    for the currently visible pages.  Full pane data is never sent all at once.

    Parameters
    ----------
    job_id     : returned in the {"t":"done"} message of /diff/stream/large.
    page_start : 0-based first page of the window (inclusive).
    page_end   : 0-based last  page of the window (inclusive).
    """
    cached = _result_cache.get(job_id)
    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job '{job_id}' not found or expired (TTL={_RESULT_CACHE_TTL}s).",
        )

    pane_a: dict = cached["pane_a"]
    pane_b: dict = cached["pane_b"]

    # Filter chunks to those that fall within the requested page range.
    # chunk.block_a / block_b are line indices; we approximate page membership
    # using the chunk's text offset relative to total segment length.
    # A simpler proxy: filter by chunk id range proportional to page range.
    all_chunks = cached["chunks"]
    n_chunks   = len(all_chunks)
    n_pages    = cached.get("total_pages", max(page_end, 1) + 1)
    c_start    = int(page_start / n_pages * n_chunks)
    c_end      = int((page_end + 1) / n_pages * n_chunks)
    window_chunks = all_chunks[c_start:c_end]
    chunk_ids     = {c["id"] for c in window_chunks}

    def _filter_pane(pane: dict) -> dict:
        offsets     = pane.get("offsets",     {})
        offset_ends = pane.get("offset_ends", {})
        segments    = pane.get("segments",    [])

        # Determine char-offset window from the chunk IDs in this page range
        if chunk_ids and offsets:
            valid_offsets = [v for k, v in offsets.items() if int(k) in chunk_ids]
            valid_ends    = [v for k, v in offset_ends.items() if int(k) in chunk_ids]
            if valid_offsets and valid_ends:
                char_start = min(valid_offsets)
                char_end   = max(valid_ends)
            else:
                char_start, char_end = 0, len(segments) * 10
        else:
            char_start, char_end = 0, sum(len(t) for t, _ in segments)

        # Walk segments, yielding only those within the char window
        pos = 0
        filtered_segs: list = []
        for text, tag in segments:
            seg_end = pos + len(text)
            if seg_end >= char_start and pos <= char_end:
                filtered_segs.append([text, tag])
            pos = seg_end
            if pos > char_end:
                break

        return {
            "segments":    filtered_segs,
            "tag_cfgs":    pane.get("tag_cfgs", {}),
            "offsets":     {k: v for k, v in offsets.items()     if int(k) in chunk_ids},
            "offset_ends": {k: v for k, v in offset_ends.items() if int(k) in chunk_ids},
        }

    return ORJSONResponse({
        "job_id":     job_id,
        "page_range": [page_start, page_end],
        "chunks":     window_chunks,
        "pane_a":     _filter_pane(pane_a),
        "pane_b":     _filter_pane(pane_b),
        "stats":      cached["stats"],
    })


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
    try:
        ch = _dict_to_chunk(body.chunk)
        updated, changed, msg, span = ce._apply_chunk_to_xml(body.xml_text, ch)
        return ApplyResponse(
            success=True, changed=changed, xml_text=updated, message=msg,
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
    try:
        ch    = _dict_to_chunk(body.chunk)
        probe = (ch.text_b if ch.kind in (ce.KIND_ADD, ce.KIND_MOD) else ch.text_a) or ch.text_a or ""
        span  = ce._locate_xml_span(body.xml_text, probe)
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
        "status":          "ok",
        "rapidfuzz":       getattr(ce, "_USE_RAPIDFUZZ", False),
        "engine":          getattr(ce, "__file__", "unknown"),
        "batched_support": _extractor is not None,
        "batch_size":      PAGE_BATCH_SIZE,
        "large_threshold": LARGE_DOC_THRESHOLD,
        "cache_ttl":       _RESULT_CACHE_TTL,
    }


# ── POST /compare/pdf/sections  (section picker — fast heading scan) ────────────

@router.post("/pdf/sections")
async def pdf_sections(
    old_file: UploadFile = File(...),
    new_file: UploadFile = File(...),
):
    """
    Lightweight section scan for both PDFs.
    Returns structural headings aligned between old and new, with page ranges
    for each side, so the frontend can offer a section picker before running
    the full diff.
    """
    if _extractor is None or not hasattr(_extractor, "extract_section_headings"):
        return ORJSONResponse({"sections": [], "total_a": 0, "total_b": 0})

    data_a = await old_file.read()
    data_b = await new_file.read()
    tmp_a = tmp_b = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
            fa.write(data_a)
            tmp_a = fa.name
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
            fb.write(data_b)
            tmp_b = fb.name

        import concurrent.futures as _cf
        with _cf.ThreadPoolExecutor(max_workers=2) as pool:
            fut_a = pool.submit(_extractor.extract_section_headings, tmp_a)
            fut_b = pool.submit(_extractor.extract_section_headings, tmp_b)
            n_a   = pool.submit(_extractor.load_pdf_page_count, tmp_a)
            n_b   = pool.submit(_extractor.load_pdf_page_count, tmp_b)
            heads_a = fut_a.result()
            heads_b = fut_b.result()
            total_a = n_a.result()
            total_b = n_b.result()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        for p in (tmp_a, tmp_b):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass

    def _make_ranges(heads: list, total_pages: int) -> list:
        result = []
        for i, h in enumerate(heads):
            end = heads[i + 1]["page"] - 1 if i + 1 < len(heads) else total_pages - 1
            result.append({**h, "page_end": end})
        return result

    import re as _re
    def _norm(s: str) -> str:
        return _re.sub(r"\W+", " ", s).strip().lower()

    ranges_a = _make_ranges(heads_a, total_a)
    ranges_b = _make_ranges(heads_b, total_b)
    label_map_b = {_norm(r["label"]): r for r in ranges_b}

    sections: list = []
    seen_b: set = set()
    sid = 0
    for ra in ranges_a:
        key = _norm(ra["label"])
        rb  = label_map_b.get(key)
        sections.append({
            "id":          sid,
            "label":       ra["label"],
            "level":       ra["level"],
            "page_start_a": ra["page"],
            "page_end_a":   ra["page_end"],
            "page_start_b": rb["page"]     if rb else None,
            "page_end_b":   rb["page_end"] if rb else None,
        })
        if rb:
            seen_b.add(key)
        sid += 1

    for rb in ranges_b:
        key = _norm(rb["label"])
        if key not in seen_b:
            sections.append({
                "id":          sid,
                "label":       rb["label"],
                "level":       rb["level"],
                "page_start_a": None,
                "page_end_a":   None,
                "page_start_b": rb["page"],
                "page_end_b":   rb["page_end"],
            })
            sid += 1

    return ORJSONResponse({"sections": sections, "total_a": total_a, "total_b": total_b})


# ── POST /compare/xml/sections ────────────────────────────────────────────────

class SectionsRequest(BaseModel):
    xml_text: str


@router.post("/xml/sections")
async def parse_xml_sections(body: SectionsRequest):
    try:
        if not hasattr(ce, "extract_xml_sections"):
            return {"success": True, "sections": []}
        sections = ce.extract_xml_sections(body.xml_text)
        return {
            "success": True,
            "sections": [{"id": s["id"], "label": s["label"],
                           "level": s["level"], "parent_id": s["parent_id"]}
                          for s in sections],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))