"""
src/router/compare.py
=====================
FastAPI router for the PDF Diff Inspector feature.

Changes vs previous version
────────────────────────────
1.  POST /compare/xml/chunk-locate  (NEW)
    Server-side XML-offset → nearest diff chunk lookup.  Uses the same
    text-normalisation as compute_diff so it handles Innodata tag-dense XML
    far more reliably than the client n-gram heuristic.

2.  ProcessPoolExecutor for precompute()
    The render stage (precompute) is CPU-bound Python.  A long-lived
    ProcessPoolExecutor breaks the GIL, giving ~2× throughput on the
    render stage for batches with >20 chunks.

3.  Disk-backed extraction cache
    SHA-256 keyed.  Repeat compares of the same PDF (re-run, undo, etc.)
    skip extraction entirely — saving 5–30 s per batch for large files.

4.  pdf_extractor_core.py strikethrough detection fix
    NOTE: apply separately — change `width < 8` to `width < 4` in
    _build_strikeout_rects() in pdf_extractor_core.py.

Endpoints
─────────
POST /compare/diff/stream            Compare two PDFs → streaming NDJSON (≤100 pages)
POST /compare/diff/stream/large      Compare two PDFs → streaming NDJSON (1000 pages)
GET  /compare/diff/{job_id}/segments Lazy segment fetch for large docs
POST /compare/diff                   Compare two PDFs → single JSON (≤100 pages)
POST /compare/xml/session            Register XML doc, return session_id
POST /compare/xml/apply              Apply one diff chunk into XML
POST /compare/xml/locate             Locate a chunk in XML (read-only, for highlight)
POST /compare/xml/chunk-locate       XML offset → nearest diff chunk  ← NEW
POST /compare/xml/sections           Parse XML section hierarchy
POST /compare/pdf/page-count         Return page counts for routing hint
POST /compare/pdf/sections           Lightweight section scan for section picker
GET  /compare/health                 Health check
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import json as _json
import logging
import multiprocessing as _mp
import os
import queue as _queue_mod
import re as _re
import sys
import tempfile
import threading
import time
import traceback
import uuid
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse, StreamingResponse
from pydantic import BaseModel

# Optional orjson fast serialiser
try:
    import orjson as _orjson_mod  # type: ignore[import-not-found]
    def _dumps_fast(obj: object) -> bytes:
        return _orjson_mod.dumps(obj)          # type: ignore[no-any-return]
except ImportError:
    def _dumps_fast(obj: object) -> bytes:     # type: ignore[misc]
        return (_json.dumps(obj) + "\n").encode()


def _emit_ndjson(payload: object | bytes | str) -> bytes:
    """Normalise any payload to a single newline-terminated bytes line."""
    if isinstance(payload, (bytes, bytearray)):
        b = bytes(payload).rstrip(b"\n")
    elif isinstance(payload, str):
        b = payload.rstrip("\n").encode("utf-8")
    else:
        b = _dumps_fast(payload).rstrip(b"\n")
    return b + b"\n"


logger = logging.getLogger(__name__)

# ── Concurrency guard ─────────────────────────────────────────────────────────
_MAX_CONCURRENT_DIFFS: int = int(os.environ.get("MAX_CONCURRENT_DIFFS",    "5"))
_active_diffs: int = 0
_active_diffs_lock: threading.Lock = threading.Lock()
_RETRY_AFTER_SECONDS: int = 30
_COMPARE_TIMEOUT_SECONDS: int = int(os.environ.get("COMPARE_TIMEOUT_SECONDS", "1800"))

# ── Batch size ────────────────────────────────────────────────────────────────
PAGE_BATCH_SIZE: int = int(os.environ.get("COMPARE_BATCH_SIZE", "100"))

# ── File size limit ───────────────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES: int = int(os.environ.get("MAX_FILE_SIZE_MB", "200")) * 1024 * 1024

# ── Large-document threshold ──────────────────────────────────────────────────
LARGE_DOC_THRESHOLD: int = int(os.environ.get("LARGE_DOC_THRESHOLD", "100"))

# ── Result cache (in-memory LRU) ──────────────────────────────────────────────
_RESULT_CACHE_MAX  = int(os.environ.get("RESULT_CACHE_MAX", "20"))
_RESULT_CACHE_TTL  = int(os.environ.get("RESULT_CACHE_TTL", "600"))


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


_result_cache      = _LRUCache(_RESULT_CACHE_MAX, _RESULT_CACHE_TTL)

# ── XML session store ─────────────────────────────────────────────────────────
_XML_SESSION_TTL   = int(os.environ.get("XML_SESSION_TTL",   "3600"))
_XML_SESSION_MAX   = int(os.environ.get("XML_SESSION_MAX",   "50"))
_xml_session_store = _LRUCache(_XML_SESSION_MAX, _XML_SESSION_TTL)

# ── ProcessPool for precompute (breaks GIL, ~2× on render stage) ─────────────
# Workers use the "spawn" context to avoid fork-related deadlocks in a threaded
# uvicorn server. The pool is long-lived: process startup cost is amortised over
# all batches.
_RENDER_WORKERS = int(os.environ.get("COMPARE_RENDER_WORKERS", "4"))
_render_pool: ProcessPoolExecutor | None = None
_render_pool_lock = threading.Lock()


def _get_render_pool() -> ProcessPoolExecutor:
    """Return the long-lived process pool, creating it on first use."""
    global _render_pool
    with _render_pool_lock:
        if _render_pool is None:
            _render_pool = ProcessPoolExecutor(
                max_workers=_RENDER_WORKERS,
                mp_context=_mp.get_context("spawn"),
                max_tasks_per_child=50,
            )
        return _render_pool


# ── Extraction cache (disk-backed) ────────────────────────────────────────────
try:
    from src.services.extraction_cache import (
        file_sha256     as _file_sha256,
        get             as _extract_cache_get,
        put             as _extract_cache_put,
    )
    _EXTRACT_CACHE_AVAILABLE = True
    logger.info("compare: extraction cache enabled (extraction_cache.py loaded)")
except ImportError:
    try:
        from extraction_cache import (         # type: ignore[import-not-found]
            file_sha256 as _file_sha256,
            get         as _extract_cache_get,
            put         as _extract_cache_put,
        )
        _EXTRACT_CACHE_AVAILABLE = True
        logger.info("compare: extraction cache enabled (local extraction_cache.py)")
    except ImportError:
        _EXTRACT_CACHE_AVAILABLE = False
        logger.info("compare: extraction cache not available (extraction_cache.py not found)")

        def _file_sha256(path: str) -> str:                        # type: ignore[misc]
            import hashlib
            h = hashlib.sha256()
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            return h.hexdigest()

        def _extract_cache_get(*_a, **_kw):                        # type: ignore[misc]
            return None

        def _extract_cache_put(*_a, **_kw) -> None:                # type: ignore[misc]
            pass


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


# ── Extractor loader ──────────────────────────────────────────────────────────

def _get_extractor():
    for mod_name in ("src.services.pdf_extractor_core", "pdf_extractor_core"):
        try:
            m = importlib.import_module(mod_name)
            if hasattr(m, "load_pdf_batched"):
                return m
        except ImportError:
            pass
    if hasattr(ce, "load_pdf_batched"):
        return ce
    return None


_extractor = _get_extractor()


def _ext_page_count(path: str) -> int:
    if _extractor is None:
        raise RuntimeError("pdf_extractor_core not loaded")
    return _extractor.load_pdf_page_count(path)  # type: ignore[union-attr]


def _ext_load_pdf(path: str, progress_cb, page_start: int, page_end: int):
    if _extractor is None:
        raise RuntimeError("pdf_extractor_core not loaded")
    return _extractor.load_pdf(path, progress_cb, page_start, page_end)  # type: ignore[union-attr]


# ── Serialisation helpers ─────────────────────────────────────────────────────

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
        "segments":         serialised_segs,
        "tag_cfgs":         serial_cfgs,
        "offsets":          {str(k): v for k, v in data.get("offsets", {}).items()},
        "offset_ends":      {str(k): v for k, v in data.get("offset_ends", {}).items()},
        "line_offsets":     {str(k): v for k, v in data.get("line_offsets", {}).items()},
        "line_offset_ends": {str(k): v for k, v in data.get("line_offset_ends", {}).items()},
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
        emp_detail   = d.get("emp_detail",   ""),
    )


def _check_file_size(file: UploadFile):
    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        max_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File '{file.filename}' is too large. Maximum size is {max_mb} MB.",
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
    try:
        _check_file_size(old_file)
        _check_file_size(new_file)
        data_a = await old_file.read()
        data_b = await new_file.read()
        xml_a_text = (await xml_file_a.read()).decode("utf-8", errors="replace") if xml_file_a else None
        xml_b_text = (await xml_file_b.read()).decode("utf-8", errors="replace") if xml_file_b else None
        fname_a = old_file.filename
        fname_b = new_file.filename
    except Exception as exc:
        logger.exception("diff_pdfs: file read failed")
        raise HTTPException(status_code=400, detail=str(exc))

    def _run():
        tmp_a = tmp_b = None
        try:
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

            blocks_a, blocks_b, chunks = ce.compute_diff(
                lines_a, lines_b,
                xml_text_a=xml_a_text, xml_text_b=xml_b_text,
            )

            render_pool = _get_render_pool()
            fut_pa = render_pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
            fut_pb = render_pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
            pane_a = fut_pa.result()
            pane_b = fut_pb.result()

            xml_sections = []
            if xml_b_text and hasattr(ce, "extract_xml_sections"):
                xml_sections = ce.extract_xml_sections(xml_b_text)
                if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                    ce.assign_chunks_to_sections(chunks, xml_sections, xml_b_text)
            if not xml_sections and hasattr(ce, "assign_chunks_to_pdf_sections"):
                xml_sections = ce.assign_chunks_to_pdf_sections(chunks, blocks_b)

            t_total = time.perf_counter() - t0
            logger.info("diff: %.2fs total, %d chunks", t_total, len(chunks))

            return {
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
                    "strike":        sum(1 for c in chunks if getattr(c, "kind", ce.KIND_EMP) == "strike"),
                },
                "xml_sections": [{"id": s["id"], "label": s["label"], "level": s["level"],
                                   "parent_id": s["parent_id"]} for s in xml_sections],
                "file_a": fname_a,
                "file_b": fname_b,
            }
        finally:
            for p in (tmp_a, tmp_b):
                if p and os.path.exists(p):
                    try: os.unlink(p)
                    except OSError: pass

    try:
        loop   = asyncio.get_running_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _run),
            timeout=_COMPARE_TIMEOUT_SECONDS,
        )
        return ORJSONResponse(result)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"Compare timed out after {_COMPARE_TIMEOUT_SECONDS}s")
    except Exception as exc:
        logger.exception("diff_pdfs failed")
        raise HTTPException(status_code=500, detail=str(exc))


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
    with _active_diffs_lock:
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
        with _active_diffs_lock:
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
                    q.put(_emit_ndjson({"t": "p", "s": "old", "p": page, "n": total}))

            def _prog_new(page: int, total: int):
                if page == total or page % _thr_b == 0:
                    q.put(_emit_ndjson({"t": "p", "s": "new", "p": page, "n": total}))

            q.put(_emit_ndjson({"t": "p", "s": "old", "p": 0, "n": _n_a}))
            with ThreadPoolExecutor(max_workers=2) as load_pool:
                fut_a   = load_pool.submit(ce.load_pdf, tmp_a, _prog_old, page_start_a, page_end_a)
                fut_b   = load_pool.submit(ce.load_pdf, tmp_b, _prog_new, page_start_b, page_end_b)
                lines_a = fut_a.result()
                lines_b = fut_b.result()
            q.put(_emit_ndjson({"t": "p", "s": "new", "p": _n_b, "n": _n_b}))

            t1 = time.perf_counter()
            logger.info("[TIMING] load_pdf: %d+%d lines, %.2fs", len(lines_a), len(lines_b), t1 - t0)

            q.put(_emit_ndjson({"t": "p", "s": "diff"}))

            def _diff_progress(sub: str, pct: int):
                q.put(_emit_ndjson({"t": "p", "s": "diff", "sub": sub, "sp": pct}))

            blocks_a, blocks_b, chunks = ce.compute_diff(
                lines_a, lines_b,
                xml_text_a=xml_a_text, xml_text_b=xml_b_text,
                on_progress=_diff_progress,
            )

            t2 = time.perf_counter()
            logger.info("[TIMING] compute_diff: %d chunks, %.2fs", len(chunks), t2 - t1)

            q.put(_emit_ndjson({"t": "p", "s": "render", "chunks": len(chunks)}))

            # Use ProcessPool for precompute — breaks GIL on CPU-bound render
            render_pool = _get_render_pool()
            fut_pa = render_pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
            fut_pb = render_pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
            pane_a = fut_pa.result()
            pane_b = fut_pb.result()

            t3 = time.perf_counter()
            logger.info("[TIMING] precompute: %.2fs, total=%.2fs", t3 - t2, t3 - t0)

            xml_sections = []
            if xml_b_text and hasattr(ce, "extract_xml_sections"):
                xml_sections = ce.extract_xml_sections(xml_b_text)
                if xml_sections and hasattr(ce, "assign_chunks_to_sections"):
                    ce.assign_chunks_to_sections(chunks, xml_sections, xml_b_text)
            if not xml_sections and hasattr(ce, "assign_chunks_to_pdf_sections"):
                xml_sections = ce.assign_chunks_to_pdf_sections(chunks, blocks_b)

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
                    "strike":        sum(1 for c in chunks if getattr(c, "kind", ce.KIND_EMP) == "strike"),
                },
                "xml_sections": [{"id": s["id"], "label": s["label"], "level": s["level"],
                                   "parent_id": s["parent_id"]} for s in xml_sections],
                "file_a":       fname_a,
                "file_b":       fname_b,
            }
            result_bytes = b'{"t":"r","d":' + _dumps_fast(payload).rstrip(b"\n") + b"}\n"
            logger.info("[TIMING] serialize: %.1f MB, TOTAL=%.2fs",
                        len(result_bytes) / 1048576, time.perf_counter() - t0)
            q.put(_emit_ndjson(result_bytes))
            q.put(None)

        except Exception as exc:
            logging.exception("diff/stream _run failed")
            q.put(_emit_ndjson({"t": "e", "msg": str(exc)}))
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
                    yield (_json.dumps({"t": "e", "msg": f"Compare timed out after {_COMPARE_TIMEOUT_SECONDS}s."}) + "\n").encode()
                    break
                try:
                    item = q.get_nowait()
                    if item is None: break
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
            with _active_diffs_lock:
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
    global _active_diffs
    if _extractor is None:
        raise HTTPException(status_code=501, detail="load_pdf_batched not available.")

    with _active_diffs_lock:
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
        with _active_diffs_lock:
            _active_diffs -= 1
        raise

    q: _queue_mod.Queue = _queue_mod.Queue()

    def _run_large():
        tmp_a = tmp_b = None
        doc_a = doc_b = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
                fa.write(data_a); tmp_a = fa.name
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
                fb.write(data_b); tmp_b = fb.name

            t0 = time.perf_counter()

            # Compute SHA-256 for extraction cache (best-effort; failure is non-fatal)
            sha_a = sha_b = None
            if _EXTRACT_CACHE_AVAILABLE:
                try:
                    sha_a = _file_sha256(tmp_a)
                    sha_b = _file_sha256(tmp_b)
                except Exception:
                    pass

            extractor      = _get_extractor()
            has_fast_batch = (
                extractor is not None
                and hasattr(extractor, "open_pdf_for_batching")
                and hasattr(extractor, "extract_pdf_batch")
            )

            hf_a:    set   = set()
            flags_a: int   = 0
            gap_a:   float = 80.0
            hf_b:    set   = set()
            flags_b: int   = 0
            gap_b:   float = 80.0
            src_a: object  = tmp_a
            src_b: object  = tmp_b

            if has_fast_batch and extractor is not None:
                doc_a, hf_a, flags_a, gap_a = extractor.open_pdf_for_batching(tmp_a)
                doc_b, hf_b, flags_b, gap_b = extractor.open_pdf_for_batching(tmp_b)
                n_a, n_b = len(doc_a), len(doc_b)
                src_a = doc_a
                src_b = doc_b
            else:
                has_fast_batch = False
                n_a = _ext_page_count(tmp_a)
                n_b = _ext_page_count(tmp_b)

            def _do_load(
                src: object, hf: set, flags: int, gap: float,
                sha: Optional[str], start_p: int, end_p: int,
            ) -> list:
                if start_p > end_p:
                    return []
                # Try extraction cache first
                if sha is not None:
                    cached = _extract_cache_get(sha, start_p, end_p)
                    if cached is not None:
                        return cached
                if has_fast_batch and extractor is not None:
                    result_lines = extractor.extract_pdf_batch(
                        src, hf, flags, gap, start_p, end_p, enable_brd_markers=False
                    )
                else:
                    result_lines = _ext_load_pdf(str(src), None, start_p, end_p)
                # Only cache successful (non-None) extraction results
                if result_lines is None:
                    logger.warning("_do_load: extractor returned None for pages %d-%d", start_p, end_p)
                    return []
                if sha is not None:
                    _extract_cache_put(sha, start_p, end_p, result_lines)
                return result_lines

            n_pages   = max(n_a, n_b)
            batches   = list(range(0, n_pages, PAGE_BATCH_SIZE))
            n_batches = len(batches)

            q.put(_emit_ndjson({
                "t": "p", "s": "schedule",
                "batches": n_batches, "pages": n_pages,
                "old_pages": n_a, "new_pages": n_b,
            }))

            logger.info(
                "diff/stream/large: job=%s  old=%d pages  new=%d pages  "
                "%d batches x %d pages  fast_batch=%s  cache=%s",
                job_id, n_a, n_b, n_batches, PAGE_BATCH_SIZE,
                has_fast_batch, _EXTRACT_CACHE_AVAILABLE,
            )

            all_chunks:        list = []
            all_pane_a_segs:   list = []
            all_pane_b_segs:   list = []
            last_tag_cfgs_a:   dict = {}
            last_tag_cfgs_b:   dict = {}
            all_offsets_a:     dict = {}
            all_offsets_b:     dict = {}
            all_offset_ends_a: dict = {}
            all_offset_ends_b: dict = {}
            all_blocks_b_headings: list = []

            # Pipeline pool: pre-fetch extraction while diff+render runs
            pipeline_pool = ThreadPoolExecutor(max_workers=4)

            def _submit_extract(bs: int):
                be  = min(bs + PAGE_BATCH_SIZE - 1, n_pages - 1)
                oe  = min(be, n_a - 1)
                ne  = min(be, n_b - 1)
                fa_ = pipeline_pool.submit(_do_load, src_a, hf_a, flags_a, gap_a, sha_a, bs, oe)
                fb_ = pipeline_pool.submit(_do_load, src_b, hf_b, flags_b, gap_b, sha_b, bs, ne)
                return fa_, fb_

            if batches:
                next_futs: tuple = _submit_extract(batches[0])
            else:
                next_futs = (None, None)

            # Long-lived ProcessPool for CPU-bound precompute
            render_pool = _get_render_pool()

            for batch_k, batch_start in enumerate(batches):
                batch_end = min(batch_start + PAGE_BATCH_SIZE - 1, n_pages - 1)
                pct_start = int(batch_k / n_batches * 90)
                pct_end   = int((batch_k + 1) / n_batches * 90)

                q.put(_emit_ndjson({
                    "t": "p", "s": "batch",
                    "batch": batch_k + 1, "of": n_batches,
                    "pages": [batch_start, batch_end],
                    "pct":   pct_start,
                    "msg":   f"Extracting pages {batch_start}-{batch_end}...",
                }))

                fut_a, fut_b = next_futs
                lines_a = fut_a.result() if fut_a is not None else []
                lines_b = fut_b.result() if fut_b is not None else []

                next_batch_idx = batch_k + 1
                if next_batch_idx < len(batches):
                    next_futs = _submit_extract(batches[next_batch_idx])
                else:
                    next_futs = (None, None)

                q.put(_emit_ndjson({
                    "t": "p", "s": "batch",
                    "batch": batch_k + 1, "of": n_batches,
                    "pages": [batch_start, batch_end],
                    "pct":   pct_start + (pct_end - pct_start) // 3,
                    "msg":   f"Diffing pages {batch_start}-{batch_end}...",
                }))

                try:
                    blocks_a, blocks_b, chunks = ce.compute_diff(
                        lines_a, lines_b,
                        xml_text_a=xml_a_text, xml_text_b=xml_b_text,
                    )
                except Exception as diff_exc:
                    logger.warning("batch %d diff failed: %s", batch_k, diff_exc)
                    pane_empty = {"segments": [], "tag_cfgs": {}, "offsets": {}, "offset_ends": {}}
                    batch_payload = {
                        "t": "batch", "batch": batch_k + 1, "of": n_batches,
                        "page_range": [batch_start, batch_end],
                        "chunks": [], "pane_a": pane_empty, "pane_b": pane_empty,
                        "stats": {"total": 0, "additions": 0, "deletions": 0,
                                  "modifications": 0, "emphasis": 0},
                    }
                    q.put(_emit_ndjson(batch_payload))
                    del lines_a, lines_b
                    continue

                q.put(_emit_ndjson({
                    "t": "p", "s": "batch",
                    "batch": batch_k + 1, "of": n_batches,
                    "pages": [batch_start, batch_end],
                    "pct":   pct_start + 2 * (pct_end - pct_start) // 3,
                    "msg":   f"Rendering {len(chunks)} changes for pages {batch_start}-{batch_end}...",
                }))

                # ProcessPool precompute — breaks GIL for parallel render
                fut_pa = render_pool.submit(ce.precompute, blocks_a, chunks, "a", blocks_b)
                fut_pb = render_pool.submit(ce.precompute, blocks_b, chunks, "b", blocks_a)
                pane_a = fut_pa.result()
                pane_b = fut_pb.result()

                id_offset    = len(all_chunks)
                chunks_dicts = [_chunk_to_dict(ch, id_offset + i) for i, ch in enumerate(chunks)]
                all_chunks.extend(chunks_dicts)

                if not xml_b_text and hasattr(ce, "assign_chunks_to_pdf_sections"):
                    try:
                        _batch_secs = ce.assign_chunks_to_pdf_sections(list(chunks), blocks_b)
                        for ch_obj, ch_dict in zip(chunks, chunks_dicts):
                            if getattr(ch_obj, "section", ""):
                                ch_dict["section"] = ch_obj.section
                        all_blocks_b_headings.extend(_batch_secs)
                    except Exception:
                        pass

                pane_a_json = _pane_to_json(pane_a)
                pane_b_json = _pane_to_json(pane_b)

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
                last_tag_cfgs_a = {**last_tag_cfgs_a, **pane_a_json["tag_cfgs"]}
                last_tag_cfgs_b = {**last_tag_cfgs_b, **pane_b_json["tag_cfgs"]}

                batch_stats = {
                    "total":         len(chunks),
                    "additions":     sum(1 for c in chunks if c.kind == ce.KIND_ADD),
                    "deletions":     sum(1 for c in chunks if c.kind == ce.KIND_DEL),
                    "modifications": sum(1 for c in chunks if c.kind == ce.KIND_MOD),
                    "emphasis":      sum(1 for c in chunks if c.kind == ce.KIND_EMP),
                    "strike":        sum(1 for c in chunks if getattr(c, "kind", ce.KIND_EMP) == "strike"),
                }

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
                q.put(_emit_ndjson(batch_payload))

                del lines_a, lines_b, blocks_a, blocks_b, chunks, pane_a, pane_b
                logger.info(
                    "[batch %d/%d] pages=%d-%d  elapsed=%.1fs",
                    batch_k + 1, n_batches, batch_start, batch_end,
                    time.perf_counter() - t0,
                )

            pipeline_pool.shutdown(wait=False)

            xml_sections: list = []
            if xml_b_text and hasattr(ce, "extract_xml_sections"):
                xml_sections = ce.extract_xml_sections(xml_b_text)
            if not xml_sections and all_blocks_b_headings:
                seen_labels: set = set()
                for sec in all_blocks_b_headings:
                    label = sec.get("label", "")
                    if label and label not in seen_labels:
                        seen_labels.add(label)
                        xml_sections.append(sec)

            final_stats = {
                "total":         len(all_chunks),
                "additions":     sum(1 for c in all_chunks if c.get("kind") == ce.KIND_ADD),
                "deletions":     sum(1 for c in all_chunks if c.get("kind") == ce.KIND_DEL),
                "modifications": sum(1 for c in all_chunks if c.get("kind") == ce.KIND_MOD),
                "emphasis":      sum(1 for c in all_chunks if c.get("kind") == ce.KIND_EMP),
                "strike":        sum(1 for c in all_chunks if c.get("kind") == "strike"),
            }

            _result_cache.set(job_id, {
                "pane_a": {
                    "segments":    all_pane_a_segs,
                    "tag_cfgs":    last_tag_cfgs_a,
                    "offsets":     all_offsets_a,
                    "offset_ends": all_offset_ends_a,
                },
                "pane_b": {
                    "segments":    all_pane_b_segs,
                    "tag_cfgs":    last_tag_cfgs_b,
                    "offsets":     all_offsets_b,
                    "offset_ends": all_offset_ends_b,
                },
                "chunks":      all_chunks,
                "stats":       final_stats,
                "total_pages": n_pages,
            })

            done_payload = {
                "t":           "done",
                "job_id":      job_id,
                "stats":       final_stats,
                "file_a":      fname_a,
                "file_b":      fname_b,
                "total_pages": n_pages,
                "elapsed_s":   round(time.perf_counter() - t0, 2),
                "xml_sections": [
                    {"id": s["id"], "label": s["label"], "level": s["level"],
                     "parent_id": s["parent_id"]}
                    for s in xml_sections
                ],
                "pct": 100,
            }
            q.put(_emit_ndjson(done_payload))
            q.put(None)

            logger.info(
                "diff/stream/large: job=%s DONE  %d chunks  %.1fs total",
                job_id, len(all_chunks), time.perf_counter() - t0,
            )

        except Exception as exc:
            logging.exception("diff/stream/large _run_large failed")
            q.put(_emit_ndjson({"t": "e", "msg": str(exc)}))
            q.put(None)
        finally:
            for doc in (doc_a, doc_b):
                try:
                    if doc is not None: doc.close()
                except Exception:
                    pass
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
                    yield (_json.dumps({"t": "e", "msg": f"Compare timed out after {_COMPARE_TIMEOUT_SECONDS}s."}) + "\n").encode()
                    break
                try:
                    item = q.get_nowait()
                    if item is None: break
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
            with _active_diffs_lock:
                _active_diffs -= 1

    return StreamingResponse(
        _generate_large(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"},
    )


# ── GET /compare/diff/{job_id}/segments ───────────────────────────────────────

@router.get("/diff/{job_id}/segments")
async def get_segments(
    job_id:     str,
    page_start: int = 0,
    page_end:   int = 49,
):
    cached = _result_cache.get(job_id)
    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job '{job_id}' not found or expired (TTL={_RESULT_CACHE_TTL}s).",
        )

    pane_a: dict = cached["pane_a"]
    pane_b: dict = cached["pane_b"]
    all_chunks   = cached["chunks"]
    n_chunks     = len(all_chunks)
    n_pages      = cached.get("total_pages", max(page_end, 1) + 1)
    c_start      = int(page_start / n_pages * n_chunks)
    c_end        = int((page_end + 1) / n_pages * n_chunks)
    window_chunks = all_chunks[c_start:c_end]
    chunk_ids     = {c["id"] for c in window_chunks}

    def _filter_pane(pane: dict) -> dict:
        offsets     = pane.get("offsets",     {})
        offset_ends = pane.get("offset_ends", {})
        segments    = pane.get("segments",    [])

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


# ── POST /compare/xml/session ─────────────────────────────────────────────────

class XmlSessionRequest(BaseModel):
    xml_text: str


class XmlSessionResponse(BaseModel):
    session_id: str


@router.post("/xml/session", response_model=XmlSessionResponse)
async def create_xml_session(body: XmlSessionRequest):
    if not body.xml_text:
        raise HTTPException(status_code=400, detail="xml_text is required")
    session_id = str(uuid.uuid4())
    _xml_session_store.set(session_id, {"xml_text": body.xml_text})
    return XmlSessionResponse(session_id=session_id)


# ── POST /compare/xml/apply ───────────────────────────────────────────────────

class ApplyRequest(BaseModel):
    xml_text:   Optional[str] = None
    session_id: Optional[str] = None
    chunk:      dict


class ApplyResponse(BaseModel):
    success:    bool
    changed:    bool
    xml_text:   str
    message:    str
    span_start: Optional[int] = None
    span_end:   Optional[int] = None
    session_id: Optional[str] = None


@router.post("/xml/apply", response_model=ApplyResponse)
async def apply_chunk(body: ApplyRequest):
    xml_text   = body.xml_text
    session_id = body.session_id

    if not xml_text and session_id:
        session_data = _xml_session_store.get(session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail=f"XML session '{session_id}' not found or expired.")
        xml_text = session_data["xml_text"]

    if not xml_text:
        raise HTTPException(status_code=400, detail="Either xml_text or a valid session_id is required")

    try:
        ch      = _dict_to_chunk(body.chunk)
        updated, changed, msg, span = ce._apply_chunk_to_xml(xml_text, ch)
        if session_id and changed:
            _xml_session_store.set(session_id, {"xml_text": updated})
        return ApplyResponse(
            success=True, changed=changed, xml_text=updated, message=msg,
            span_start=span[0] if span else None,
            span_end=span[1]   if span else None,
            session_id=session_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── POST /compare/xml/locate ──────────────────────────────────────────────────

class LocateRequest(BaseModel):
    xml_text:   Optional[str] = None
    session_id: Optional[str] = None
    chunk:      dict


class LocateResponse(BaseModel):
    success:    bool
    span_start: Optional[int] = None
    span_end:   Optional[int] = None


@router.post("/xml/locate", response_model=LocateResponse)
async def locate_chunk(body: LocateRequest):
    xml_text = body.xml_text
    if not xml_text and body.session_id:
        session_data = _xml_session_store.get(body.session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail=f"XML session '{body.session_id}' not found or expired.")
        xml_text = session_data["xml_text"]

    if not xml_text:
        raise HTTPException(status_code=400, detail="Either xml_text or a valid session_id is required")

    try:
        ch    = _dict_to_chunk(body.chunk)
        probe = (ch.text_b if ch.kind in (ce.KIND_ADD, ce.KIND_MOD) else ch.text_a) or ch.text_a or ""
        span  = ce._locate_xml_span(xml_text, probe)
        return LocateResponse(
            success=True,
            span_start=span[0] if span else None,
            span_end=span[1]   if span else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── POST /compare/xml/chunk-locate  (NEW) ────────────────────────────────────
"""
Given a character offset inside an XML document, find the best-matching diff
chunk by comparing the surrounding element's plain text against the text of
every chunk in the current session.

This is a server-side replacement for the n-gram heuristic in
handleXmlLineClick.  Advantages over the client approach:
  - Has access to the full Chunk list without serialisation overhead
  - Uses the same _norm_cmp normalisation as compute_diff
  - Can strip XML tags accurately with lxml instead of a regex approximation
  - N-gram threshold can be set lower (0.30) without false positives because
    the server also validates segment positions from pane offsets

Request body
────────────
{
  "session_id":  "...",         // preferred — avoids resending large XML
  "xml_text":    "...",         // fallback if session expired
  "xml_offset":  1234,          // character offset of the clicked position
}

Response
────────
{
  "success":  true,
  "chunk_id": 17,    // null if no match found
  "score":    0.72,  // n-gram similarity score (0–1)
  "message":  "..."  // optional diagnostic
}
"""

class ChunkLocateRequest(BaseModel):
    xml_text:   Optional[str] = None
    session_id: Optional[str] = None
    xml_offset: int


class ChunkLocateResponse(BaseModel):
    success:  bool
    chunk_id: Optional[int] = None
    score:    float = 0.0
    message:  Optional[str] = None


def _strip_xml_tags(xml_text: str, start: int, end: int, radius: int = 1500) -> str:
    """
    Extract plain text from an XML fragment centred on xml_offset.

    Strategy:
      1. Slice a window of ±radius characters around the click position.
      2. Strip XML tags with a regex (fast, no parser overhead).
      3. Decode common XML entities.
      4. Normalise whitespace.

    This is intentionally simple. The surrounding element context is usually
    2–10× the paragraph text, so even a naïve strip produces enough signal.
    """
    ctx_start = max(0, start - radius)
    ctx_end   = min(len(xml_text), end + radius)
    fragment  = xml_text[ctx_start:ctx_end]

    plain = _re.sub(r"<[^>]*>",          " ", fragment)
    plain = plain.replace("&amp;",  "&").replace("&lt;",  "<") \
                 .replace("&gt;",  ">").replace("&nbsp;", " ") \
                 .replace("&#160;", " ")
    plain = _re.sub(r"&#\d+;",  " ", plain)
    plain = _re.sub(r"&\w+;",   " ", plain)
    plain = _re.sub(r"\s+",     " ", plain).strip()
    return plain


def _norm_text(s: str) -> str:
    """Normalise text for comparison: lower-case, collapse whitespace, strip punctuation."""
    s = s.lower()
    s = _re.sub(r"[^\w\s]", " ", s)
    s = _re.sub(r"\s+",     " ", s).strip()
    return s


def _ngram_score(needle: str, haystack: str, n: int = 6) -> float:
    """
    Character n-gram Jaccard similarity between two normalised strings.
    Returns 0.0 if either string is shorter than n.
    """
    if len(needle) < n or len(haystack) < n:
        return 0.0
    ng_n = set(needle[i: i + n]  for i in range(len(needle)  - n + 1))
    ng_h = set(haystack[i: i + n] for i in range(len(haystack) - n + 1))
    inter = len(ng_n & ng_h)
    union = len(ng_n | ng_h)
    return inter / union if union else 0.0


def _score_chunk_text(plain_ctx: str, chunk_text: str) -> float:
    """
    Score how well chunk_text matches the XML context at a click position.
    Samples the chunk in 3-character steps to keep cost O(|chunk|).
    """
    if not chunk_text or not plain_ctx:
        return 0.0
    needle   = _norm_text(chunk_text[:600])
    haystack = _norm_text(plain_ctx)
    if not needle or not haystack:
        return 0.0
    return _ngram_score(needle, haystack)


# Minimum n-gram score for a server-side match to be returned.
# The server is more reliable than the client (same normalisation as compute_diff)
# so we can afford a lower threshold than the old client 0.45.
_MIN_SCORE = 0.25


@router.post("/xml/chunk-locate", response_model=ChunkLocateResponse)
async def xml_chunk_locate(body: ChunkLocateRequest):
    """
    Given an XML character offset, find the nearest diff chunk.

    The caller is expected to have already loaded the diff result (chunks are
    stored in the job cache keyed by job_id, NOT passed in the request body).

    NOTE: This endpoint does NOT require the caller to pass chunks — it derives
    them from the active XML session's associated diff result.  However, since
    multiple diff results might reference the same XML session, the endpoint
    uses a simple heuristic: it searches ALL jobs in _result_cache for chunks
    that contain text found near xml_offset.

    If a more direct approach is needed, the caller can POST chunks in the
    request body (future extension).
    """
    # Resolve XML text
    xml_text = body.xml_text
    if not xml_text and body.session_id:
        session_data = _xml_session_store.get(body.session_id)
        if session_data is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"XML session '{body.session_id}' not found or expired. "
                    "Client should retry with full xml_text."
                ),
            )
        xml_text = session_data["xml_text"]

    if not xml_text:
        raise HTTPException(status_code=400, detail="Either xml_text or a valid session_id is required")

    if body.xml_offset < 0 or body.xml_offset > len(xml_text):
        raise HTTPException(status_code=422, detail=f"xml_offset {body.xml_offset} out of range [0, {len(xml_text)}]")

    # Extract plain-text context around the click point
    plain_ctx = _strip_xml_tags(xml_text, body.xml_offset, body.xml_offset)
    if len(plain_ctx) < 6:
        return ChunkLocateResponse(
            success=False, chunk_id=None, score=0.0,
            message="Context too short (likely clicked on a tag, not content)",
        )

    # Search all cached diff jobs for matching chunks
    # This loop runs in the request thread (fast — cache is in-memory OrderedDict)
    best_id: Optional[int] = None
    best_score = 0.0

    # Access the internal store snapshot under the lock
    with _result_cache._lock:
        job_snapshots = [
            (k, entry["v"])
            for k, entry in _result_cache._store.items()
            if time.monotonic() - entry["ts"] < _RESULT_CACHE_TTL
        ]

    for _job_id, cached_result in job_snapshots:
        for chunk_dict in cached_result.get("chunks", []):
            for text_field in (chunk_dict.get("text_b") or "", chunk_dict.get("text_a") or ""):
                if not text_field or len(text_field) < 6:
                    continue
                score = _score_chunk_text(plain_ctx, text_field)
                if score > best_score:
                    best_score = score
                    best_id    = chunk_dict.get("id")

    if best_id is None or best_score < _MIN_SCORE:
        return ChunkLocateResponse(
            success=False, chunk_id=None, score=round(best_score, 3),
            message=f"No confident match found (best score {best_score:.2f} < threshold {_MIN_SCORE})",
        )

    return ChunkLocateResponse(
        success=True,
        chunk_id=best_id,
        score=round(best_score, 3),
        message=f"Matched chunk {best_id} with score {best_score:.2f}",
    )


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
        "render_workers":  _RENDER_WORKERS,
        "extract_cache":   _EXTRACT_CACHE_AVAILABLE,
    }


# ── POST /compare/pdf/page-count ─────────────────────────────────────────────

@router.post("/pdf/page-count")
async def pdf_page_count(
    old_file: UploadFile = File(...),
    new_file: UploadFile = File(...),
):
    tmp_a = tmp_b = None
    try:
        _check_file_size(old_file)
        _check_file_size(new_file)
        data_a = await old_file.read()
        data_b = await new_file.read()

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
            fa.write(data_a); tmp_a = fa.name
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
            fb.write(data_b); tmp_b = fb.name

        n_a = _ext_page_count(tmp_a)
        n_b = _ext_page_count(tmp_b)
        return ORJSONResponse({
            "old_pages": n_a, "new_pages": n_b,
            "max_pages": max(n_a, n_b),
            "large_threshold": LARGE_DOC_THRESHOLD,
        })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        for p in (tmp_a, tmp_b):
            if p and os.path.exists(p):
                try: os.unlink(p)
                except OSError: pass


# ── POST /compare/pdf/sections ────────────────────────────────────────────────

@router.post("/pdf/sections")
async def pdf_sections(
    old_file: UploadFile = File(...),
    new_file: UploadFile = File(...),
):
    if _extractor is None or not hasattr(_extractor, "extract_section_headings"):
        return ORJSONResponse({"sections": [], "total_a": 0, "total_b": 0})

    data_a = await old_file.read()
    data_b = await new_file.read()
    tmp_a = tmp_b = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fa:
            fa.write(data_a); tmp_a = fa.name
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fb:
            fb.write(data_b); tmp_b = fb.name

        import concurrent.futures as _cf
        with _cf.ThreadPoolExecutor(max_workers=2) as pool:
            fut_a   = pool.submit(_extractor.extract_section_headings, tmp_a)
            fut_b   = pool.submit(_extractor.extract_section_headings, tmp_b)
            n_a_    = pool.submit(_extractor.load_pdf_page_count, tmp_a)
            n_b_    = pool.submit(_extractor.load_pdf_page_count, tmp_b)
            heads_a = fut_a.result()
            heads_b = fut_b.result()
            total_a = n_a_.result()
            total_b = n_b_.result()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        for p in (tmp_a, tmp_b):
            if p and os.path.exists(p):
                try: os.unlink(p)
                except OSError: pass

    def _make_ranges(heads: list, total_pages: int) -> list:
        result = []
        for i, h in enumerate(heads):
            end = heads[i + 1]["page"] - 1 if i + 1 < len(heads) else total_pages - 1
            result.append({**h, "page_end": end})
        return result

    def _norm(s: str) -> str:
        return _re.sub(r"\W+", " ", s).strip().lower()

    ranges_a  = _make_ranges(heads_a, total_a)
    ranges_b  = _make_ranges(heads_b, total_b)
    label_map_b = {_norm(r["label"]): r for r in ranges_b}

    sections: list = []
    seen_b:   set  = set()
    sid = 0
    for ra in ranges_a:
        key = _norm(ra["label"])
        rb  = label_map_b.get(key)
        sections.append({
            "id": sid, "label": ra["label"], "level": ra["level"],
            "page_start_a": ra["page"],     "page_end_a": ra["page_end"],
            "page_start_b": rb["page"]     if rb else None,
            "page_end_b":   rb["page_end"] if rb else None,
        })
        if rb: seen_b.add(key)
        sid += 1

    for rb in ranges_b:
        key = _norm(rb["label"])
        if key not in seen_b:
            sections.append({
                "id": sid, "label": rb["label"], "level": rb["level"],
                "page_start_a": None, "page_end_a": None,
                "page_start_b": rb["page"], "page_end_b": rb["page_end"],
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