"""Disk-backed LRU cache for PDF extraction results.

Keyed by (sha256, page_start, page_end). Stores pickled PdfLine lists.
Cache hit saves 5-30s per batch on repeat compares of the same file.
"""
from __future__ import annotations

import hashlib
import os
import pickle
import threading
import time
from pathlib import Path

CACHE_DIR    = Path(os.getenv("EXTRACT_CACHE_DIR", "/tmp/pdf_extract_cache"))
CACHE_MAX_MB = int(os.getenv("EXTRACT_CACHE_MAX_MB", "2048"))  # 2 GB
CACHE_TTL    = int(os.getenv("EXTRACT_CACHE_TTL",    "86400")) # 1 day

CACHE_DIR.mkdir(parents=True, exist_ok=True)
_lock = threading.Lock()


def _key(file_sha: str, page_start: int, page_end: int) -> str:
    return f"{file_sha}_{page_start}_{page_end}.pkl"


def file_sha256(path: str) -> str:
    """Hash a file's bytes. Streams to avoid loading the whole file in RAM."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def get(file_sha: str, page_start: int, page_end: int):
    """Return cached PdfLine list, or None on miss/expired."""
    path = CACHE_DIR / _key(file_sha, page_start, page_end)
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > CACHE_TTL:
        path.unlink(missing_ok=True)
        return None
    try:
        with path.open("rb") as f:
            data = pickle.load(f)
        # Touch mtime so LRU eviction keeps recently-read entries
        os.utime(path, None)
        return data
    except Exception:
        path.unlink(missing_ok=True)
        return None


def put(file_sha: str, page_start: int, page_end: int, lines) -> None:
    """Cache a PdfLine list. Best-effort; failures are silent."""
    path = CACHE_DIR / _key(file_sha, page_start, page_end)
    try:
        with _lock:
            tmp = path.with_suffix(".tmp")
            with tmp.open("wb") as f:
                pickle.dump(lines, f, protocol=pickle.HIGHEST_PROTOCOL)
            tmp.replace(path)
        _maybe_evict()
    except Exception:
        pass


def _maybe_evict() -> None:
    """Evict oldest entries when total cache exceeds CACHE_MAX_MB."""
    try:
        entries = sorted(CACHE_DIR.glob("*.pkl"), key=lambda p: p.stat().st_mtime)
        total   = sum(p.stat().st_size for p in entries)
        limit   = CACHE_MAX_MB * 1024 * 1024
        while total > limit and entries:
            p = entries.pop(0)
            try:
                total -= p.stat().st_size
                p.unlink()
            except FileNotFoundError:
                pass
    except Exception:
        pass
