/**
 * api.ts — AutoCompare API client.
 *
 * Wraps all /autocompare/* calls with typed request/response shapes.
 * All functions throw on HTTP errors so callers can handle them uniformly.
 */

import type {
  AutoGenerateResponse,
  ChunksResponse,
  CompareChunkResponse,
  MergeResponse,
  SaveResponse,
  UploadResponse,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail?.message ?? body?.detail ?? detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload OLD PDF, NEW PDF, and XML source file.
 * Returns session_id on success.
 *
 * @param onProgress - optional XHR progress callback (0–100)
 */
export function uploadFiles(
  oldPdf: File,
  newPdf: File,
  xmlFile: File,
  sourceName: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("old_pdf", oldPdf);
    fd.append("new_pdf", newPdf);
    fd.append("xml_file", xmlFile);
    fd.append("source_name", sourceName);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/autocompare/upload`);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new Error("Invalid JSON response from upload"));
        }
      } else {
        let detail = `Upload failed: HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          detail = body?.detail?.message ?? body?.detail ?? detail;
        } catch {
          // ignore
        }
        reject(new Error(detail));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

// ── Start processing ──────────────────────────────────────────────────────────

export async function startProcessing(
  sessionId: string,
  tagName = "section",
  batchSize = 50,
): Promise<{ success: boolean; status: string; message: string }> {
  const res = await fetch(`${BASE}/autocompare/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, tag_name: tagName, batch_size: batchSize }),
  });
  return handleResponse(res);
}

// ── Status poll ───────────────────────────────────────────────────────────────

export async function pollStatus(sessionId: string): Promise<{
  success: boolean;
  session_id: string;
  status: string;
  progress: number;
  summary: unknown;
  error: string | null;
}> {
  const res = await fetch(`${BASE}/autocompare/status/${sessionId}`);
  return handleResponse(res);
}

// ── Chunks list ───────────────────────────────────────────────────────────────

export async function fetchChunks(sessionId: string): Promise<ChunksResponse> {
  const res = await fetch(`${BASE}/autocompare/chunks?session_id=${encodeURIComponent(sessionId)}`);
  return handleResponse(res);
}

// ── Chunk detail ──────────────────────────────────────────────────────────────

export async function fetchChunkDetail(
  sessionId: string,
  chunkId: string | number,
): Promise<CompareChunkResponse> {
  const res = await fetch(
    `${BASE}/autocompare/compare/${chunkId}?session_id=${encodeURIComponent(sessionId)}`,
  );
  return handleResponse(res);
}

// ── Save XML ──────────────────────────────────────────────────────────────────

export async function saveChunkXml(
  sessionId: string,
  chunkId: string | number,
  xmlContent: string,
): Promise<SaveResponse> {
  const res = await fetch(`${BASE}/autocompare/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, chunk_id: String(chunkId), xml_content: xmlContent }),
  });
  return handleResponse(res);
}

// ── Auto-generate XML ─────────────────────────────────────────────────────────

export async function autoGenerateXml(
  sessionId: string,
  chunkId: string | number,
): Promise<AutoGenerateResponse> {
  const res = await fetch(`${BASE}/autocompare/autogenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, chunk_id: String(chunkId) }),
  });
  return handleResponse(res);
}

// ── Merge all chunks ──────────────────────────────────────────────────────────

export async function mergeChunks(sessionId: string): Promise<MergeResponse> {
  const res = await fetch(`${BASE}/autocompare/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return handleResponse(res);
}

// ── Download final XML ────────────────────────────────────────────────────────

export function downloadFinalXml(sessionId: string): void {
  window.open(`${BASE}/autocompare/download/${sessionId}`, "_blank");
}
