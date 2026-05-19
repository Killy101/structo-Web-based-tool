// ─────────────────────────────────────────────────────────────────────────────
// api.ts — HTTP client for the FastAPI compare service
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ApplyResult,
  Chunk,
  ChunkLocateResult,
  DiffResult,
  LocateResult,
  PaneData,
  XmlSection,
} from "./types";
import type { LoadingStage } from "./DiffUpload";

const _rawProcessingBase = process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";
const _processingBase = _rawProcessingBase.replace(/\/+$/, "").replace(/\/compare$/i, "");
const BASE = `${_processingBase}/compare`;

export const LARGE_DOC_THRESHOLD = 100;

// ── Chunked upload ────────────────────────────────────────────────────────────
const CHUNK_SIZE   = 2 * 1024 * 1024;
const MAX_PARALLEL = 4;

let _chunkUploadAvailable: boolean | null = null;

async function _hasChunkUploadEndpoint(): Promise<boolean> {
  if (_chunkUploadAvailable !== null) return _chunkUploadAvailable;
  try {
    const probe = await fetch(`${_processingBase}/upload/chunk`, { method: "HEAD" });
    _chunkUploadAvailable = probe.ok;
  } catch {
    _chunkUploadAvailable = false;
  }
  return _chunkUploadAvailable;
}

interface UploadResult { fileId: string; sha256: string; path: string; }

interface PageCountResult {
  old_pages: number;
  new_pages: number;
  max_pages: number;
}

async function _uploadChunked(
  file:       File,
  onProgress: (pct: number) => void,
): Promise<UploadResult | null> {
  if (!(await _hasChunkUploadEndpoint())) return null;

  const BASE_UPLOAD = _processingBase;
  const fileId      = crypto.randomUUID();
  const totalParts  = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalParts; i += MAX_PARALLEL) {
    const batchSize = Math.min(MAX_PARALLEL, totalParts - i);
    const results = await Promise.all(
      Array.from({ length: batchSize }, (_, k) => {
        const idx   = i + k;
        const start = idx * CHUNK_SIZE;
        const form  = new FormData();
        form.append("file_id",     fileId);
        form.append("part_index",  String(idx));
        form.append("total_parts", String(totalParts));
        form.append("chunk",       file.slice(start, start + CHUNK_SIZE), file.name);
        return fetch(`${BASE_UPLOAD}/upload/chunk`, { method: "POST", body: form });
      }),
    );
    const failed = results.find(r => !r.ok);
    if (failed) {
      // If the deployment does not expose chunk-upload routes, disable this
      // path for the session and fall back to legacy direct upload flow.
      if (failed.status === 404 || failed.status === 405) {
        _chunkUploadAvailable = false;
        return null;
      }
      throw new Error(`Chunk upload failed: HTTP ${failed.status}`);
    }
    onProgress(Math.round(((i + batchSize) / totalParts) * 85));
  }

  const fin = new FormData();
  fin.append("file_id",  fileId);
  fin.append("filename", file.name);
  const res  = await fetch(`${BASE_UPLOAD}/upload/finalise`, { method: "POST", body: fin });
  if (!res.ok) {
    if (res.status === 404 || res.status === 405) {
      _chunkUploadAvailable = false;
      return null;
    }
    return null;
  }
  const data = await res.json() as { file_id: string; sha256: string; path: string };
  onProgress(100);
  return { fileId: data.file_id, sha256: data.sha256, path: data.path };
}

async function _probePageCount(oldFile: File, newFile: File): Promise<PageCountResult | null> {
  try {
    const form = new FormData();
    form.append("old_file", oldFile);
    form.append("new_file", newFile);
    const res = await fetch(`${BASE}/pdf/page-count`, { method: "POST", body: form });
    if (!res.ok) return null;
    return await res.json() as PageCountResult;
  } catch {
    return null;
  }
}

// ── SHA-256 deduplication cache ───────────────────────────────────────────────
function _getCachedJobId(sha_a: string, sha_b: string): string | null {
  try {
    const key = `diff_cache_${sha_a.slice(0, 16)}_${sha_b.slice(0, 16)}`;
    return sessionStorage.getItem(key);
  } catch { return null; }
}

// ── Progress reporting ────────────────────────────────────────────────────────

export interface DiffProgress {
  stage:       "old" | "new" | "diff" | "render" | "batch" | "done";
  page?:       number;
  totalPages?: number;
  chunks?:     number;
  pct:         number;
  message:     string;
  batch?:      number;
  totalBatches?: number;
  pageRange?:  [number, number];
}

// ── Stage-based progress builder ──────────────────────────────────────────────
export function buildLoadingStages(progress: DiffProgress | null): LoadingStage[] {
  const STAGE_DEFS: { id: DiffProgress["stage"] | "upload"; label: string }[] = [
    { id: "upload",  label: "Uploading files" },
    { id: "old",     label: "Extracting original PDF" },
    { id: "new",     label: "Extracting revised PDF" },
    { id: "diff",    label: "Computing differences" },
    { id: "render",  label: "Preparing viewer" },
    { id: "batch",   label: "Processing batches" },
  ];

  if (!progress) {
    return STAGE_DEFS.map((s) => ({ id: s.id, label: s.label, status: "pending" as const }));
  }

  const ORDER = ["upload", "old", "new", "diff", "render", "batch", "done"] as const;
  const currentIdx = ORDER.indexOf(progress.stage as typeof ORDER[number]);

  return STAGE_DEFS.map((def) => {
    const stageOrder = ORDER.indexOf(def.id as typeof ORDER[number]);
    if (progress.stage === "done") {
      return { id: def.id, label: def.label, status: "done" as const };
    }
    if (stageOrder < currentIdx) {
      return { id: def.id, label: def.label, status: "done" as const };
    }
    if (stageOrder === currentIdx) {
      return {
        id: def.id,
        label: def.label,
        status: "active" as const,
        pct: progress.pct,
        detail: progress.message,
        batch: progress.batch,
        totalBatches: progress.totalBatches,
        pageRange: progress.pageRange,
      };
    }
    return { id: def.id, label: def.label, status: "pending" as const };
  });
}

// Batch result streamed from /diff/stream/large
export interface BatchResult {
  batch:      number;
  of:         number;
  pageRange:  [number, number];
  chunks:     Chunk[];
  pane_a:     PaneData;
  pane_b:     PaneData;
  stats:      DiffResult["stats"];
}

// ── Retry config ──────────────────────────────────────────────────────────────
const _DIFF_MAX_RETRIES   = 4;
const _DIFF_BASE_DELAY_MS = 8_000;
const _DIFF_MAX_DELAY_MS  = 60_000;

async function _retryDelay(
  attempt: number,
  retryAfterHeader: string | null,
  onProgress?: (p: DiffProgress) => void,
): Promise<void> {
  const base  = retryAfterHeader
    ? parseInt(retryAfterHeader, 10) * 1000
    : Math.min(_DIFF_BASE_DELAY_MS * Math.pow(1.5, attempt), _DIFF_MAX_DELAY_MS);
  const jitter = (Math.random() - 0.5) * 0.5 * base;
  const delay  = Math.round(Math.max(1000, base + jitter));
  const secs   = Math.ceil(delay / 1000);

  onProgress?.({
    stage: "diff", pct: 0,
    message: `Server busy — retrying in ${secs}s… (attempt ${attempt + 1}/${_DIFF_MAX_RETRIES})`,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

// ── NDJSON stream reader ──────────────────────────────────────────────────────
async function* _readNDJSON(res: Response, signal?: AbortSignal): AsyncGenerator<unknown> {
  const reader  = res.body!.getReader();

  // Cancel the stream if the AbortSignal fires
  signal?.addEventListener("abort", () => {
    reader.cancel().catch(() => {});
  }, { once: true });

  const decoder = new TextDecoder();
  let   buffer  = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try { yield JSON.parse(line); } catch { /* ignore malformed */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (buffer.trim()) {
    try { yield JSON.parse(buffer); } catch { /* ignore */ }
  }
}

// ── Standard diff (≤ LARGE_DOC_THRESHOLD pages) ───────────────────────────────
export async function apiDiff(
  oldFile:     File,
  newFile:     File,
  onProgress?: (p: DiffProgress) => void,
  xmlFile?:    File | null,
  signal?:     AbortSignal,
): Promise<DiffResult> {
  const form = new FormData();
  form.append("old_file", oldFile);
  form.append("new_file", newFile);
  if (xmlFile) form.append("xml_file_b", xmlFile);

  for (let attempt = 0; attempt <= _DIFF_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const res = await fetch(`${BASE}/diff/stream`, { method: "POST", body: form, signal });

    if (res.status === 429) {
      if (attempt >= _DIFF_MAX_RETRIES) {
        throw new Error("Server is handling too many comparisons. Please try again later.");
      }
      await _retryDelay(attempt, res.headers.get("Retry-After"), onProgress);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractErrMsg(err, "Diff failed"));
    }

    let result: DiffResult | null = null;

    for await (const msg of _readNDJSON(res, signal)) {
      const m = msg as Record<string, unknown>;
      if      (m.t === "p" && onProgress) onProgress(_parseProgress(m));
      else if (m.t === "r")               result = m.d as DiffResult;
      else if (m.t === "e")               throw new Error(_msgToStr(m.msg) || "Diff failed");
    }

    if (!result) throw new Error("No result received from server");
    return result;
  }

  throw new Error("No result received from server");
}

// ── Large diff (> LARGE_DOC_THRESHOLD pages) — batched streaming ──────────────
export interface LargeDiffCallbacks {
  onProgress?:    (p: DiffProgress) => void;
  onBatch?:       (b: BatchResult) => void;
  signal?:        AbortSignal;
}

export interface LargeDiffResult {
  jobId:       string;
  stats:       DiffResult["stats"];
  xmlSections: XmlSection[];
  file_a:      string;
  file_b:      string;
  totalPages:  number;
  elapsedS?:   number;
}

export async function apiDiffLarge(
  oldFile:   File,
  newFile:   File,
  callbacks: LargeDiffCallbacks = {},
  xmlFile?:  File | null,
): Promise<LargeDiffResult> {
  const { onProgress, onBatch, signal } = callbacks;

  const form = new FormData();
  form.append("old_file", oldFile);
  form.append("new_file", newFile);
  if (xmlFile) form.append("xml_file_b", xmlFile);

  for (let attempt = 0; attempt <= _DIFF_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const res = await fetch(`${BASE}/diff/stream/large`, { method: "POST", body: form, signal });

    if (res.status === 429) {
      if (attempt >= _DIFF_MAX_RETRIES) {
        throw new Error("Server is handling too many comparisons. Please try again later.");
      }
      await _retryDelay(attempt, res.headers.get("Retry-After"), onProgress);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(_extractErrMsg(err, "Diff failed"));
    }

    let doneMsg: LargeDiffResult | null = null;

    for await (const msg of _readNDJSON(res, signal)) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const m = msg as Record<string, unknown>;

      if (m.t === "p") {
        onProgress?.(_parseLargeProgress(m));
      } else if (m.t === "batch") {
        onBatch?.({
          batch:     m.batch as number,
          of:        m.of    as number,
          pageRange: m.page_range as [number, number],
          chunks:    m.chunks    as Chunk[],
          pane_a:    m.pane_a    as PaneData,
          pane_b:    m.pane_b    as PaneData,
          stats:     m.stats     as DiffResult["stats"],
        });
      } else if (m.t === "done") {
        doneMsg = {
          jobId:       m.job_id     as string,
          stats:       m.stats      as DiffResult["stats"],
          xmlSections: (m.xml_sections ?? []) as XmlSection[],
          file_a:      m.file_a     as string,
          file_b:      m.file_b     as string,
          totalPages:  m.total_pages as number,
          elapsedS:    m.elapsed_s  as number,
        };
        onProgress?.({
          stage: "done", pct: 100,
          message: `Done — ${doneMsg.stats.total} changes across ${doneMsg.totalPages} pages`,
        });
      } else if (m.t === "e") {
        throw new Error(_msgToStr(m.msg) || "Large diff failed");
      }
    }

    if (!doneMsg) throw new Error("No final result received from server");
    return doneMsg;
  }

  throw new Error("No result received from server");
}

// ── Auto-routing: pick standard or large endpoint based on page count ─────────
export async function apiDiffAuto(
  oldFile:   File,
  newFile:   File,
  callbacks: {
    onProgress?:   (p: DiffProgress) => void;
    onBatch?:      (b: BatchResult) => void;
    signal?:       AbortSignal;
  } = {},
  xmlFile?: File | null,
): Promise<DiffResult | LargeDiffResult> {
  const { onProgress, onBatch, signal } = callbacks;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const pageCount = await _probePageCount(oldFile, newFile);
  const useLargeByPages = (pageCount?.max_pages ?? 0) > LARGE_DOC_THRESHOLD;

  try {
    let oldPct = 0, newPct = 0;
    const notifyUpload = () =>
      onProgress?.({ stage: "old", pct: Math.round((oldPct + newPct) / 2),
                     message: `Uploading files… ${Math.round((oldPct + newPct) / 2)}%` });

    const [oldUp, newUp] = await Promise.all([
      _uploadChunked(oldFile, (p) => { oldPct = p; notifyUpload(); }),
      _uploadChunked(newFile, (p) => { newPct = p; notifyUpload(); }),
    ]);

    if (oldUp && newUp) {
      const cachedJobId = _getCachedJobId(oldUp.sha256, newUp.sha256);
      if (cachedJobId) {
        onProgress?.({ stage: "batch", pct: 5, message: "Previous result found — reloading…" });
      }
    }
  } catch { /* chunked upload not available — fall through to legacy */ }

  const LARGE_SIZE_BYTES = 4 * 1024 * 1024;
  const useLargeBySize = oldFile.size > LARGE_SIZE_BYTES || newFile.size > LARGE_SIZE_BYTES;
  const useLarge = useLargeByPages || useLargeBySize;

  if (useLarge) {
    const reason = useLargeByPages && pageCount
      ? `Large document detected (${pageCount.max_pages} pages) — using batched mode…`
      : "Large document detected — using batched mode…";
    onProgress?.({ stage: "batch", pct: 0, message: reason });
    return apiDiffLarge(oldFile, newFile, { onProgress, onBatch, signal }, xmlFile);
  }

  return apiDiff(oldFile, newFile, onProgress, xmlFile, signal);
}

// ── Lazy segment fetch (large docs only) ──────────────────────────────────────
export interface SegmentWindow {
  jobId:      string;
  pageRange:  [number, number];
  chunks:     Chunk[];
  pane_a:     PaneData;
  pane_b:     PaneData;
  stats:      DiffResult["stats"];
}

export async function apiGetSegments(
  jobId:     string,
  pageStart: number,
  pageEnd:   number,
): Promise<SegmentWindow> {
  const url = `${BASE}/diff/${encodeURIComponent(jobId)}/segments`
    + `?page_start=${pageStart}&page_end=${pageEnd}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Segment fetch failed");
  }
  return res.json() as Promise<SegmentWindow>;
}

// ── XML operations ────────────────────────────────────────────────────────────

// ── XML session management ────────────────────────────────────────────────────
interface _XmlSession {
  sessionId: string;
  textHash:  number;
}

let _activeXmlSession: _XmlSession | null = null;
let _sessionCreationPromise: Promise<string | null> | null = null;

const _SESSION_STORE_KEY = "structo_xml_session";

function _persistSession(): void {
  if (typeof window === "undefined") return;
  if (!_activeXmlSession) {
    try { sessionStorage.removeItem(_SESSION_STORE_KEY); } catch { /* ok */ }
    return;
  }
  try {
    sessionStorage.setItem(_SESSION_STORE_KEY, JSON.stringify(_activeXmlSession));
  } catch { /* quota exceeded or private browsing — silently skip */ }
}

;(function _restoreSession() {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(_SESSION_STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { sessionId?: string; textHash?: number };
    if (parsed.sessionId && typeof parsed.textHash === "number") {
      _activeXmlSession = { sessionId: parsed.sessionId, textHash: parsed.textHash };
    }
  } catch { /* malformed entry — ignore */ }
})();

function _fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}

export function invalidateXmlSession(): void {
  _activeXmlSession = null;
  _sessionCreationPromise = null;
  _persistSession();
}

async function _createXmlSession(xmlText: string, hash: number): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/xml/session`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ xml_text: xmlText }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { session_id?: string };
    if (!data.session_id) return null;
    _activeXmlSession = { sessionId: data.session_id, textHash: hash };
    _persistSession();
    return data.session_id;
  } catch {
    return null;
  } finally {
    _sessionCreationPromise = null;
  }
}

async function _ensureXmlSession(xmlText: string): Promise<string | null> {
  const hash = _fnv32(xmlText);
  if (_activeXmlSession && _activeXmlSession.textHash === hash) {
    return _activeXmlSession.sessionId;
  }
  if (_sessionCreationPromise) {
    return _sessionCreationPromise;
  }
  _sessionCreationPromise = _createXmlSession(xmlText, hash);
  return _sessionCreationPromise;
}

export async function apiApply(xmlText: string, chunk: Chunk): Promise<ApplyResult> {
  const sessionId = await _ensureXmlSession(xmlText);

  const body = sessionId
    ? { session_id: sessionId, chunk }
    : { xml_text: xmlText, chunk };

  let res = await fetch(`${BASE}/xml/apply`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (res.status === 404 && sessionId) {
    _activeXmlSession = null;
    res = await fetch(`${BASE}/xml/apply`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ xml_text: xmlText, chunk }),
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? "Apply failed");
  }

  const result = await res.json() as ApplyResult;

  if (result.changed && _activeXmlSession) {
    _activeXmlSession = {
      sessionId: _activeXmlSession.sessionId,
      textHash:  _fnv32(result.xml_text),
    };
  }

  return result;
}

export async function apiLocate(xmlText: string, chunk: Chunk): Promise<LocateResult | null> {
  try {
    const sessionId = await _ensureXmlSession(xmlText);

    const body = sessionId
      ? { session_id: sessionId, chunk }
      : { xml_text: xmlText, chunk };

    let res = await fetch(`${BASE}/xml/locate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (res.status === 404 && sessionId) {
      _activeXmlSession = null;
      res = await fetch(`${BASE}/xml/locate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ xml_text: xmlText, chunk }),
      });
    }

    if (!res.ok) return null;
    return res.json() as Promise<LocateResult>;
  } catch { return null; }
}

// ── XML chunk-locate (XML offset → nearest diff chunk) ───────────────────────
/**
 * Given a character offset inside the XML text, ask the server to find the
 * best-matching diff chunk. This is the server-side replacement for the
 * n-gram heuristic in handleXmlLineClick — the server has the full chunk
 * list and uses the same text-normalisation as compute_diff, so matches
 * are far more reliable for Innodata tag-dense XML.
 *
 * Falls back to null on network error so the caller can degrade gracefully.
 */
export async function apiChunkLocate(
  xmlText:   string,
  xmlOffset: number,
): Promise<ChunkLocateResult | null> {
  try {
    const sessionId = await _ensureXmlSession(xmlText);

    const body = sessionId
      ? { session_id: sessionId, xml_offset: xmlOffset }
      : { xml_text: xmlText,    xml_offset: xmlOffset };

    let res = await fetch(`${BASE}/xml/chunk-locate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (res.status === 404 && sessionId) {
      // Session expired — retry with full text
      _activeXmlSession = null;
      res = await fetch(`${BASE}/xml/chunk-locate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ xml_text: xmlText, xml_offset: xmlOffset }),
      });
    }

    if (!res.ok) return null;
    return res.json() as Promise<ChunkLocateResult>;
  } catch {
    return null;
  }
}

// ── XML section parsing (client-side, no network) ─────────────────────────────
export function parseXmlSectionsLocal(xmlText: string): XmlSection[] {
  if (!xmlText) return [];
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, "text/xml");
    const levels = doc.querySelectorAll("innodLevel");
    const sections: XmlSection[] = [];
    const labelToIdx = new Map<string, number>();
    let minLevel = 99;

    levels.forEach((el) => {
      const lvl     = parseInt(el.getAttribute("level") ?? "99", 10);
      const heading = el.querySelector("innodHeading > title") ?? el.querySelector("innodHeading title");
      let label     = (heading?.textContent ?? "").trim();
      if (!label || label.length < 2)
        label = (el.getAttribute("last-path") ?? "").trim();
      if (!label || label.length < 2) return;

      if (lvl < minLevel) minLevel = lvl;

      let parentId  = -1;
      let parentEl  = el.parentElement;
      while (parentEl) {
        if (parentEl.tagName === "innodLevel") {
          const pH   = parentEl.querySelector("innodHeading > title") ?? parentEl.querySelector("innodHeading title");
          let pLabel = (pH?.textContent ?? "").trim();
          if (!pLabel || pLabel.length < 2)
            pLabel = (parentEl.getAttribute("last-path") ?? "").trim();
          const pIdx = labelToIdx.get(pLabel);
          if (pIdx !== undefined) { parentId = pIdx; break; }
        }
        parentEl = parentEl.parentElement;
      }

      const idx = sections.length;
      sections.push({ id: idx, label, level: lvl, parent_id: parentId });
      labelToIdx.set(label, idx);
    });

    const distinctLvls = new Set(sections.map((s) => s.level));
    if (distinctLvls.size === 1 && sections.length > 1) {
      const prefixOrder = new Map<string, number>();
      let nextSynth = minLevel;
      for (const s of sections) {
        const pfx = s.label.match(/^([a-zà-ÿÀ-ÿ\u0100-\u024F]+\.?)/i)?.[1]?.toLowerCase() ?? "";
        if (pfx && pfx.length >= 2 && !prefixOrder.has(pfx)) prefixOrder.set(pfx, nextSynth++);
        if (pfx && prefixOrder.has(pfx)) s.level = prefixOrder.get(pfx)!;
      }
      if (prefixOrder.size > 0) minLevel = Math.min(...sections.map((s) => s.level));
    }

    if (sections.length > 0) {
      for (const s of sections) { s.id += 1; if (s.parent_id >= 0) s.parent_id += 1; }
      sections.unshift({ id: 0, label: "Preamble", level: minLevel, parent_id: -1 });
    }

    return sections;
  } catch {
    return [];
  }
}

// ── Error message helpers ─────────────────────────────────────────────────────

function _msgToStr(msg: unknown): string {
  if (typeof msg === "string") return msg;
  if (msg == null) return "";
  if (typeof msg === "object") return JSON.stringify(msg);
  return String(msg);
}

function _extractErrMsg(err: { detail?: unknown }, fallback: string): string {
  const d = err?.detail;
  if (d == null) return fallback;
  if (typeof d === "string") return d || fallback;
  if (Array.isArray(d)) {
    const first = (d[0] as { msg?: string })?.msg;
    return typeof first === "string" ? first : JSON.stringify(d);
  }
  if (typeof d === "object") {
    const e = (d as { error?: string }).error;
    return typeof e === "string" ? e : JSON.stringify(d);
  }
  return String(d) || fallback;
}

// ── Progress parsers ──────────────────────────────────────────────────────────

function _parseProgress(msg: Record<string, unknown>): DiffProgress {
  const s = msg.s as string;

  if (s === "old") {
    const n = (msg.n as number) || 1;
    const p = (msg.p as number) || 0;
    return {
      stage: "old", page: p, totalPages: n,
      pct:     Math.min(40, Math.round(10 + (p / n) * 30)),
      message: p === 0 ? `Extracting old PDF… (${n} pages)`
             : p >= n  ? "Old PDF extracted"
             :           `page ${p}/${n}`,
    };
  }

  if (s === "new") {
    const n = (msg.n as number) || 1;
    const p = (msg.p as number) || 0;
    return {
      stage: "new", page: p, totalPages: n,
      pct:     Math.min(55, Math.round(40 + (p / n) * 15)),
      message: p >= n ? "Both PDFs extracted — starting diff…"
             :          `page ${p}/${n}`,
    };
  }

  if (s === "diff") {
    const sub = msg.sub as string | undefined;
    const sp  = typeof msg.sp === "number" ? msg.sp : 0;
    const SUB_LABELS: Record<string, string> = {
      segmenting:     "Segmenting blocks…",
      aligning:       "Aligning document structure…",
      matching:       "Matching blocks across documents…",
      refining:       "Refining change detection…",
      "xml-validate": "Cross-validating with XML…",
      context:        "Building context for changes…",
    };
    return {
      stage:   "diff",
      pct:     sub ? Math.round(65 + sp * 0.25) : 65,
      message: sub ? (SUB_LABELS[sub] ?? `${sub}…`) : "Computing diff…",
    };
  }

  if (s === "render") {
    return { stage: "render", chunks: msg.chunks as number, pct: 92,
             message: `${msg.chunks} changes` };
  }

  return { stage: "diff", pct: 50, message: "Processing…" };
}

function _parseLargeProgress(msg: Record<string, unknown>): DiffProgress {
  const s = msg.s as string;

  if (s === "schedule") {
    const pages   = msg.pages   as number;
    const batches = msg.batches as number;
    return {
      stage: "batch", pct: 0, batch: 0, totalBatches: batches,
      message: `${pages} pages — ${batches} batches`,
    };
  }

  if (s === "batch") {
    const batch = (msg.batch as number) || 1;
    const of    = (msg.of   as number) || 1;
    const pages = msg.pages as [number, number] | undefined;
    return {
      stage: "batch", pct: msg.pct as number ?? Math.round((batch / of) * 90),
      batch, totalBatches: of,
      pageRange: pages,
      message: msg.msg != null ? String(msg.msg) : `Batch ${batch}/${of}`,
    };
  }

  if (s === "done") {
    return { stage: "done", pct: 100, message: "Complete." };
  }

  return { stage: "batch", pct: 0, message: "Processing large document…" };
}

// ── Chunked XML merge APIs ──────────────────────────────────────────────────

export interface MergeChunkedXmlInput {
  filename: string;
  content: string;
  relative_path?: string;
}

export interface MergeChunkRow {
  index: number;
  filename: string;
  relative_path: string;
  selection_key: string;
  sequence: number | null;
  part_order: number;
  section_level: number;
  has_changes: boolean;
  source_group: "corrected" | "haschanges" | "nochanges" | "unknown";
  duplicate: boolean;
  selected: boolean;
  heading: string;
  source_path: string | null;
}

export interface MergeChunkInspectResult {
  success: boolean;
  chunk_rows: MergeChunkRow[];
  invalid_files: Array<{ filename: string; reason: string }>;
  warnings: string[];
  missing_sequences: number[];
  duplicate_sequences?: number[];
  summary: {
    total_detected: number;
    selected: number;
    changed_selected: number;
    duplicates_selected: number;
  };
}

export interface MergeChunkBuildResult extends MergeChunkInspectResult {
  merged_xml: string;
  export_mode: string;
  export_filename: string;
  strict_mode?: boolean;
}

export async function apiInspectChunkedXmlMerge(
  files: MergeChunkedXmlInput[],
  selectedFilenames: string[] = [],
): Promise<MergeChunkInspectResult> {
  const res = await fetch(`${BASE}/merge/chunked/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, selected_filenames: selectedFilenames }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(_extractErrMsg(err, "Chunk merge inspect failed"));
  }

  return res.json() as Promise<MergeChunkInspectResult>;
}

export async function apiBuildChunkedXmlMerge(
  files: MergeChunkedXmlInput[],
  selectedFilenames: string[] = [],
  exportMode: "single" | "versioned" | "backup" = "single",
  baseFilename = "merged",
  strictMode = false,
): Promise<MergeChunkBuildResult> {
  const res = await fetch(`${BASE}/merge/chunked/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      selected_filenames: selectedFilenames,
      export_mode: exportMode,
      base_filename: baseFilename,
      strict_mode: strictMode,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(_extractErrMsg(err, "Chunk merge failed"));
  }

  return res.json() as Promise<MergeChunkBuildResult>;
}