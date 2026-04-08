"""
src/services/job_store.py
=========================
Persistent job store: write-through in-memory cache backed by SQLite.

Why this exists
---------------
The original `_jobs: dict[str, dict] = {}` in process.py is wiped every time
the processing service restarts (deploy, crash, OOM kill). Any job that was
uploaded or mid-flight simply vanishes, leaving the frontend polling a 404
forever.

How it works
------------
* In-memory dict  — all existing `_jobs[job_id]` reads/mutations work unchanged.
* SQLite WAL      — persists job metadata (status, progress, chunks, etc.) to disk.
* Disk uploads    — raw PDF/XML bytes are written to DATA_DIR/uploads/<job_id>/
                    so they survive a restart and can be re-loaded into memory.
* Startup recovery — any job whose status was `uploaded` or `processing` when the
                    process died is immediately set to `error` with an explanatory
                    message so the frontend can report it gracefully.

Usage (in process.py)
---------------------
    from src.services.job_store import _store as _job_store
    _jobs = _job_store.mem          # alias: existing code works unchanged

    # Create a new job (replaces `_jobs[job_id] = {...}`)
    _job_store.create(job_id, meta_dict, old_bytes, new_bytes, xml_bytes)

    # Persist in-memory state after a status transition
    _job_store.persist(job_id)

    # Remove a byte file from disk after it's no longer needed
    _job_store.remove_bytes(job_id, "xml")
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Storage roots — override via env var if needed
# ---------------------------------------------------------------------------
DATA_DIR    = Path(os.getenv("DATA_DIR", "/app/data"))
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH     = DATA_DIR / "jobs.db"


class _JobStore:
    """
    Thread-safe job store: in-memory dict + SQLite write-through + disk bytes.
    """

    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

        self._mem:  dict[str, dict] = {}
        self._lock: threading.Lock  = threading.Lock()

        self._init_db()
        self._load_from_db()

    # ------------------------------------------------------------------
    # SQLite helpers
    # ------------------------------------------------------------------

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._open() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id       TEXT    PRIMARY KEY,
                    status       TEXT    NOT NULL DEFAULT 'uploaded',
                    source_name  TEXT    NOT NULL DEFAULT '',
                    old_filename TEXT,
                    new_filename TEXT,
                    xml_filename TEXT,
                    chunks       TEXT    DEFAULT '[]',
                    summary      TEXT    DEFAULT 'null',
                    progress     INTEGER DEFAULT 0,
                    stage        TEXT    DEFAULT '',
                    error        TEXT,
                    created_at   REAL    DEFAULT (unixepoch())
                )
            """)
            # Jobs that were mid-flight when the process died cannot be
            # resumed (PDF bytes may be gone). Mark them as error so the
            # frontend gets a meaningful message instead of a 404.
            conn.execute(
                "UPDATE jobs "
                "SET status = 'error', "
                "    error  = 'Server restarted during processing — please re-upload' "
                "WHERE status IN ('uploaded', 'processing')"
            )

    def _load_from_db(self) -> None:
        """Rebuild in-memory state from SQLite + disk bytes on startup."""
        with self._open() as conn:
            rows = conn.execute("SELECT * FROM jobs").fetchall()

        for row in rows:
            job_id = row["job_id"]
            self._mem[job_id] = {
                "job_id":       job_id,
                "status":       row["status"],
                "source_name":  row["source_name"],
                "old_filename": row["old_filename"],
                "new_filename": row["new_filename"],
                "xml_filename": row["xml_filename"],
                "chunks":       json.loads(row["chunks"]  or "[]"),
                "summary":      json.loads(row["summary"] or "null"),
                "progress":     row["progress"],
                "stage":        row["stage"] or "",
                "error":        row["error"],
                # Reload byte files from disk (None if file was deleted)
                "_old_bytes":   self._read_bytes(job_id, "old"),
                "_new_bytes":   self._read_bytes(job_id, "new"),
                "_xml_bytes":   self._read_bytes(job_id, "xml"),
            }

    # ------------------------------------------------------------------
    # Disk byte helpers
    # ------------------------------------------------------------------

    def _byte_path(self, job_id: str, name: str) -> Path:
        return UPLOADS_DIR / job_id / name

    def _write_bytes(self, job_id: str, name: str, data: bytes) -> None:
        path = self._byte_path(job_id, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def _read_bytes(self, job_id: str, name: str) -> Optional[bytes]:
        path = self._byte_path(job_id, name)
        return path.read_bytes() if path.exists() else None

    def _delete_bytes(self, job_id: str, name: str) -> None:
        path = self._byte_path(job_id, name)
        if path.exists():
            path.unlink()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    @property
    def mem(self) -> dict:
        """
        Expose the raw in-memory dict.
        Existing code that does `_jobs[job_id]` / `_jobs.get(job_id)` works
        without modification once `_jobs = _store.mem`.
        """
        return self._mem

    def create(
        self,
        job_id:    str,
        meta:      dict,
        old_bytes: bytes,
        new_bytes: bytes,
        xml_bytes: Optional[bytes] = None,
    ) -> None:
        """
        Create a new job.
        Writes file bytes to disk, stores metadata in SQLite, and adds the
        full job dict (including bytes) to the in-memory cache.
        """
        self._write_bytes(job_id, "old", old_bytes)
        self._write_bytes(job_id, "new", new_bytes)
        if xml_bytes is not None:
            self._write_bytes(job_id, "xml", xml_bytes)

        entry: dict = {
            **meta,
            "_old_bytes": old_bytes,
            "_new_bytes": new_bytes,
            "_xml_bytes": xml_bytes,
        }
        with self._lock:
            self._mem[job_id] = entry

        self.persist(job_id)

    def persist(self, job_id: str) -> None:
        """
        Write the current in-memory state of a job to SQLite.
        Call this after any status transition (processing → done/error).
        Progress/stage updates during processing do NOT need to be persisted
        (they are transient) — only call persist on meaningful state changes.
        """
        job = self._mem.get(job_id)
        if job is None:
            return

        with self._open() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO jobs
                    (job_id, status, source_name, old_filename, new_filename,
                     xml_filename, chunks, summary, progress, stage, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    job.get("status"),
                    job.get("source_name", ""),
                    job.get("old_filename"),
                    job.get("new_filename"),
                    job.get("xml_filename"),
                    json.dumps(job.get("chunks", [])),
                    json.dumps(job.get("summary")),
                    job.get("progress", 0),
                    job.get("stage", ""),
                    job.get("error"),
                ),
            )

    def remove_bytes(self, job_id: str, name: str) -> None:
        """
        Delete a byte file from disk after it is no longer needed
        (e.g. XML bytes after chunking completes).
        Also clears the corresponding key in the in-memory dict.
        """
        self._delete_bytes(job_id, name)
        job = self._mem.get(job_id)
        if job is not None:
            job[f"_{name}_bytes"] = None


# Module-level singleton — imported by process.py
_store = _JobStore()
