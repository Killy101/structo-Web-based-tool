/**
 * api.ts — AutoCompare API client.
 *
 * Wraps all /autocompare/* calls with typed request/response shapes.
 * Upload now accepts multiple XML files (pre-chunked).
 * No merge endpoint — chunks are downloaded individually or as a ZIP.
 */

import type {
  ChunksResponse,
  CompareChunkResponse,
  ReuploadResponse,
  SaveResponse,
  ValidateAllResponse,
  UploadResponse,
  ValidateResponse,
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
      // ignore
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// ── Upload (multiple XMLs) ────────────────────────────────────────────────────

/**
 * Upload OLD PDF, NEW PDF, and multiple pre-chunked XML files.
 */
export function uploadFiles(
  oldPdf: File,
  newPdf: File,
  xmlFiles: File[],
  sourceName: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("old_pdf", oldPdf);
    fd.append("new_pdf", newPdf);
    for (const xf of xmlFiles) {
      fd.append("xml_files", xf);
    }
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
  batchSize = 50,
): Promise<{ success: boolean; status: string; message: string }> {
  const res = await fetch(`${BASE}/autocompare/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, batch_size: batchSize }),
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
  const res = await fetch(`${BASE}/autocompare/status/${encodeURIComponent(sessionId)}`);
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

// ── Validate XML ──────────────────────────────────────────────────────────────

export async function validateChunkXml(
  sessionId: string,
  chunkId: string | number,
): Promise<ValidateResponse> {
  const res = await fetch(`${BASE}/autocompare/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, chunk_id: String(chunkId) }),
  });
  return handleResponse(res);
}

export async function validateAllChunks(sessionId: string): Promise<ValidateAllResponse> {
  const res = await fetch(`${BASE}/autocompare/validate-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return handleResponse(res);
}

// ── Download single chunk XML ─────────────────────────────────────────────────

export function downloadChunkXml(sessionId: string, chunkId: string | number): void {
  window.open(`${BASE}/autocompare/download/${encodeURIComponent(sessionId)}/${chunkId}`, "_blank");
}

// ── PDF page image URL helper ────────────────────────────────────────────────

/**
 * Returns the URL to fetch a single rendered PDF page as a PNG image.
 * The Python backend uses PyMuPDF to render the page server-side.
 *
 * @param sessionId   Active session identifier.
 * @param which       "old" or "new" — which PDF to read.
 * @param pageNum     1-based page number.
 * @param hlText      Optional text to highlight on the page.
 * @param hlKind      Highlight colour hint: "added" | "removed" | "modified".
 */
export function getPdfPageUrl(
  sessionId: string,
  which: "old" | "new",
  pageNum: number,
  hlText?: string,
  hlKind?: "added" | "removed" | "modified",
): string {
  let url = `${BASE}/autocompare/pdf-page/${encodeURIComponent(sessionId)}/${which}/${pageNum}?scale=1.5`;
  if (hlText && hlText.trim().length >= 2) {
    url += `&hl_text=${encodeURIComponent(hlText.slice(0, 300))}`;
    if (hlKind) url += `&hl_kind=${encodeURIComponent(hlKind)}`;
  }
  return url;
}

// ── Download ALL chunks as a ZIP ──────────────────────────────────────────────

/**
 * Downloads all chunks as a single ZIP file from the server.
 * Falls back to sequential individual downloads if the /download-all endpoint
 * is not available (404), so the feature degrades gracefully.
 */
export async function downloadAllChunks(
  sessionId: string,
  sourceName: string,
  chunkIds: (string | number)[],
): Promise<void> {
  const zipUrl = `${BASE}/autocompare/download-all/${encodeURIComponent(sessionId)}`;

  try {
    const res = await fetch(zipUrl);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sourceName || "autocompare"}_chunks.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
  } catch {
    // fall through to sequential fallback
  }

  // Fallback: open each chunk download in a new tab with a small delay
  for (let i = 0; i < chunkIds.length; i++) {
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        window.open(
          `${BASE}/autocompare/download/${encodeURIComponent(sessionId)}/${chunkIds[i]}`,
          "_blank",
        );
        resolve();
      }, i * 300);
    });
  }
}

// ── Export status report ──────────────────────────────────────────────────────

/**
 * Downloads a status report for all chunks in the session.
 * `fmt` is "json" (default) or "csv".
 */
export function exportStatusReport(
  sessionId: string,
  sourceName: string,
  fmt: "json" | "csv" = "json",
): void {
  const url = `${BASE}/autocompare/export-report/${encodeURIComponent(sessionId)}?fmt=${fmt}`;
  const ext  = fmt === "csv" ? "csv" : "json";
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${sourceName || "autocompare"}_report.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Re-upload XML chunks ──────────────────────────────────────────────────────

export function reuploadXmlFiles(
  sessionId: string,
  xmlFiles: File[],
  onProgress?: (pct: number) => void,
): Promise<ReuploadResponse> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("session_id", sessionId);
    for (const xf of xmlFiles) {
      fd.append("xml_files", xf);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/autocompare/reupload`);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ReuploadResponse);
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      } else {
        let detail = `Re-upload failed: HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          detail = body?.detail?.message ?? body?.detail ?? detail;
        } catch {
          // ignore
        }
        reject(new Error(detail));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during re-upload"));
    xhr.send(fd);
  });
}