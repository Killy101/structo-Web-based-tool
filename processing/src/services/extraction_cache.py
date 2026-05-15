"""
src/services/extraction_cache.py
=================================
Disk-backed LRU cache for PDF extraction results.

Keyed by (sha256(file_bytes), page_start, page_end).
Stores pickled PdfLine lists.  Uses atomic write-rename to avoid partial
reads, and a lightweight mtime-based LRU eviction to cap disk usage.

Environment variables
─────────────────────
EXTRACT_CACHE_DIR     Path to cache directory   (default: /tmp/pdf_extract_cache)
EXTRACT_CACHE_MAX_MB  Max disk usage in MB      (default: 2048)
EXTRACT_CACHE_TTL     Entry TTL in seconds      (default: 86400 = 1 day)

Usage
─────
from src.services.extraction_cache import file_sha256, get as cache_get, put as cache_put

sha  = file_sha256("/path/to/file.pdf")          # ~200 ms for a 100 MB file
data = cache_get(sha, page_start=0, page_end=49) # None on miss or expired
if data is None:
    data = load_pdf(...)
    cache_put(sha, 0, 49, data)
"""

from __future__ import annotations

import hashlib
import os
import pickle
import threading
import time
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────────

CACHE_DIR    = Path(os.environ.get("EXTRACT_CACHE_DIR",    "/tmp/pdf_extract_cache"))
CACHE_MAX_MB = int(os.environ.get("EXTRACT_CACHE_MAX_MB",  "2048"))   # 2 GB
CACHE_TTL    = int(os.environ.get("EXTRACT_CACHE_TTL",     "86400"))  # 1 day

# Create the cache dir at import time; fail loudly if the path is wrong.
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_evict_lock = threading.Lock()


# ── Key helpers ────────────────────────────────────────────────────────────────

def _cache_path(file_sha: str, page_start: int, page_end: int) -> Path:
    """Return the full path for a cache entry."""
    filename = f"{file_sha}_{page_start}_{page_end}.pkl"
    return CACHE_DIR / filename


# ── Public API ─────────────────────────────────────────────────────────────────

def file_sha256(path: str) -> str:
    """
    Compute SHA-256 of a file by streaming it in 1 MB chunks.

    Streaming avoids loading a 200 MB PDF entirely into memory just to hash it.
    On a 100 MB file this takes roughly 200 ms.
    """
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def get(file_sha: str, page_start: int, page_end: int):
    """
    Return cached PdfLine list for the given PDF + page range.

    Returns None on cache miss, entry expiry, or deserialization error.
    On hit, the entry's mtime is updated so LRU eviction keeps recently-used
    entries alive.
    """
    path = _cache_path(file_sha, page_start, page_end)
    try:
        st = path.stat()
    except FileNotFoundError:
        return None

    # Check TTL
    if time.time() - st.st_mtime > CACHE_TTL:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None

    try:
        with path.open("rb") as fh:
            data = pickle.load(fh)
        # Touch mtime to signal recent use (LRU semantics)
        try:
            os.utime(path, None)
        except OSError:
            pass
        return data
    except Exception:
        # Corrupt entry — delete and return miss
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None


def put(file_sha: str, page_start: int, page_end: int, lines: object) -> None:
    """
    Persist a PdfLine list to the disk cache.

    Uses atomic write-rename (write to .tmp, rename to final) so a partial
    write never leaves a corrupt entry that would fail future reads.
    Silently skips on any error (I/O failure, out of disk space) so callers
    never need to handle cache failures.

    After writing, _maybe_evict() checks total cache size and removes the
    oldest entries when the limit is exceeded.
    """
    path = _cache_path(file_sha, page_start, page_end)
    tmp  = path.with_suffix(".tmp")
    try:
        with tmp.open("wb") as fh:
            pickle.dump(lines, fh, protocol=pickle.HIGHEST_PROTOCOL)
        tmp.replace(path)
        _maybe_evict()
    except Exception:
        # Best-effort — never raise from cache logic
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def delete(file_sha: str, page_start: int, page_end: int) -> bool:
    """
    Explicitly delete a cache entry.  Returns True if the entry existed.
    """
    path = _cache_path(file_sha, page_start, page_end)
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def clear_all() -> int:
    """
    Delete every .pkl file in the cache directory.  Returns the number deleted.
    Used for test teardown and admin endpoints.
    """
    count = 0
    for p in CACHE_DIR.glob("*.pkl"):
        try:
            p.unlink()
            count += 1
        except OSError:
            pass
    return count


def cache_info() -> dict:
    """Return a summary of current cache state (entry count, total size)."""
    entries = list(CACHE_DIR.glob("*.pkl"))
    total_bytes = sum(p.stat().st_size for p in entries if p.exists())
    return {
        "entries":    len(entries),
        "total_mb":   round(total_bytes / (1024 * 1024), 2),
        "max_mb":     CACHE_MAX_MB,
        "ttl_s":      CACHE_TTL,
        "cache_dir":  str(CACHE_DIR),
    }


# ── Eviction ───────────────────────────────────────────────────────────────────

def _maybe_evict() -> None:
    """
    Evict the oldest entries when total .pkl size exceeds CACHE_MAX_MB.

    Uses a lock to prevent concurrent evictions from racing; one thread evicts
    and the rest skip.
    """
    if not _evict_lock.acquire(blocking=False):
        return  # Another thread is already evicting

    try:
        entries = []
        for p in CACHE_DIR.glob("*.pkl"):
            try:
                st = p.stat()
                entries.append((st.st_mtime, st.st_size, p))
            except FileNotFoundError:
                pass

        total_bytes = sum(e[1] for e in entries)
        limit_bytes = CACHE_MAX_MB * 1024 * 1024

        if total_bytes <= limit_bytes:
            return

        # Sort by mtime ascending — oldest first
        entries.sort(key=lambda x: x[0])

        for mtime, size, path in entries:
            if total_bytes <= limit_bytes:
                break
            try:
                path.unlink()
                total_bytes -= size
            except FileNotFoundError:
                pass
            except OSError:
                pass
    finally:
        _evict_lock.release()