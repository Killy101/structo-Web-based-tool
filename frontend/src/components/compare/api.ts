// ─────────────────────────────────────────────────────────────────────────────
// api.ts — HTTP client for the FastAPI compare service
//
// LARGE-DOCUMENT CHANGES
// ────────────────────────
//  apiDiffLarge()   — calls /diff/stream/large, yields batch results as they
//                     arrive.  Each batch covers 50 pages.  The frontend
//                     renders chunks immediately as batches stream in.
//
//  apiDiffAuto()    — chooses /diff/stream or /diff/stream/large based on
//                     page count.  Use this as the single entry point.
//
//  apiGetSegments() — fetches pane segments for a page window from the
//                     server-side result cache.  Call this as the user
//                     scrolls instead of holding 500k segments in the browser.
//
//  LARGE_DOC_THRESHOLD — docs with more pages than this are sent to the large
//                         endpoint.  Must match the server value.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ApplyResult,
  Chunk,
  DiffResult,
  LocateResult,
  PaneData,
  XmlSection,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_PROCESSING_URL
  ? `${process.env.NEXT_PUBLIC_PROCESSING_URL}/compare`
  : "http://localhost:8000/compare";

// Keep in sync with LARGE_DOC_THRESHOLD in compare.py.
export const LARGE_DOC_THRESHOLD = 100;

// ── Chunked upload ────────────────────────────────────────────────────────────
// Splits large files into 2 MB parts uploaded 4 at a time so no single
// request can hit a proxy timeout.  Falls back to a single-request upload
// when the backend doesn't expose /upload/chunk (graceful degradation).

const CHUNK_SIZE   = 2 * 1024 * 1024; // 2 MB per part
const MAX_PARALLEL = 4;

interface UploadResult { fileId: string; sha256: string; path: string; }

async function _uploadChunked(
  file:       File,
  onProgress: (pct: number) => void,
): Promise<UploadResult | null> {
  // Quick probe — if the endpoint doesn't exist, return null and fall back.
  const probe = await fetch(`${BASE.replace("/compare", "")}/upload/chunk`, {
    method: "HEAD",
  }).catch(() => null);
  if (!probe || !probe.ok) return null;

  const BASE_UPLOAD = BASE.replace("/compare", "");
  const fileId      = crypto.randomUUID();
  const totalParts  = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalParts; i += MAX_PARALLEL) {
    const batchSize = Math.min(MAX_PARALLEL, totalParts - i);
    await Promise.all(
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
    onProgress(Math.round(((i + batchSize) / totalParts) * 85));
  }

  const fin = new FormData();
  fin.append("file_id",  fileId);
  fin.append("filename", file.name);
  const res  = await fetch(`${BASE_UPLOAD}/upload/finalise`, { method: "POST", body: fin });
  if (!res.ok) return null;
  const data = await res.json() as { file_id: string; sha256: string; path: string };
  onProgress(100);
  return { fileId: data.file_id, sha256: data.sha256, path: data.path };
}

// ── SHA-256 deduplication cache ───────────────────────────────────────────────
// When the same file pair is submitted again the backend returns the cached
// job_id immediately — no re-processing.  We store the mapping in
// sessionStorage so it survives page refreshes within the same session.

function _getCachedJobId(sha_a: string, sha_b: string): string | null {
  try {
    const key = `diff_cache_${sha_a.slice(0, 16)}_${sha_b.slice(0, 16)}`;
    return sessionStorage.getItem(key);
  } catch { return null; }
}

function _setCachedJobId(sha_a: string, sha_b: string, jobId: string): void {
  try {
    const key = `diff_cache_${sha_a.slice(0, 16)}_${sha_b.slice(0, 16)}`;
    sessionStorage.setItem(key, jobId);
  } catch { /* sessionStorage unavailable */ }
}

// ── Progress reporting ────────────────────────────────────────────────────────

export interface DiffProgress {
  stage:       "old" | "new" | "diff" | "render" | "batch" | "done";
  page?:       number;
  totalPages?: number;
  chunks?:     number;
  pct:         number;    // 0–100
  message:     string;
  // Large-doc extras
  batch?:      number;
  totalBatches?: number;
  pageRange?:  [number, number];
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

const _DIFF_MAX_RETRIES    = 4;
const _DIFF_BASE_DELAY_MS  = 8_000;
const _DIFF_MAX_DELAY_MS   = 60_000;

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

async function* _readNDJSON(res: Response): AsyncGenerator<unknown> {
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";

  while (true) {
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
): Promise<DiffResult> {
  const form = new FormData();
  form.append("old_file", oldFile);
  form.append("new_file", newFile);
  if (xmlFile) form.append("xml_file_b", xmlFile);

  for (let attempt = 0; attempt <= _DIFF_MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}/diff/stream`, { method: "POST", body: form });

    if (res.status === 429) {
      if (attempt >= _DIFF_MAX_RETRIES) {
        throw new Error("Server is handling too many comparisons. Please try again later.");
      }
      await _retryDelay(attempt, res.headers.get("Retry-After"), onProgress);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof err.detail === "object" ? err.detail.error : (err.detail ?? "Diff failed"));
    }

    let result: DiffResult | null = null;

    for await (const msg of _readNDJSON(res)) {
      const m = msg as Record<string, unknown>;
      if      (m.t === "p" && onProgress) onProgress(_parseProgress(m));
      else if (m.t === "r")               result = m.d as DiffResult;
      else if (m.t === "e")               throw new Error((m.msg as string) || "Diff failed");
    }

    if (!result) throw new Error("No result received from server");
    return result;
  }

  throw new Error("No result received from server");
}

// ── Large diff (> LARGE_DOC_THRESHOLD pages) — batched streaming ──────────────

export interface LargeDiffCallbacks {
  onProgress?:    (p: DiffProgress) => void;
  onBatch?:       (b: BatchResult) => void;   // called as each 50-page batch arrives
}

export interface LargeDiffResult {
  jobId:       string;
  stats:       DiffResult["stats"];
  xmlSections: XmlSection[];
  file_a:      string;
  file_b:      string;
  totalPages:  number;
  elapsedS:    number;
}

export async function apiDiffLarge(
  oldFile:   File,
  newFile:   File,
  callbacks: LargeDiffCallbacks = {},
  xmlFile?:  File | null,
): Promise<LargeDiffResult> {
  const { onProgress, onBatch } = callbacks;

  const form = new FormData();
  form.append("old_file", oldFile);
  form.append("new_file", newFile);
  if (xmlFile) form.append("xml_file_b", xmlFile);

  for (let attempt = 0; attempt <= _DIFF_MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}/diff/stream/large`, { method: "POST", body: form });

    if (res.status === 429) {
      if (attempt >= _DIFF_MAX_RETRIES) {
        throw new Error("Server is handling too many comparisons. Please try again later.");
      }
      await _retryDelay(attempt, res.headers.get("Retry-After"), onProgress);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(typeof err.detail === "object" ? err.detail.error : (err.detail ?? "Diff failed"));
    }

    let doneMsg: LargeDiffResult | null = null;

    for await (const msg of _readNDJSON(res)) {
      const m = msg as Record<string, unknown>;

      if (m.t === "p") {
        // Progress message
        onProgress?.(_parseLargeProgress(m));

      } else if (m.t === "batch") {
        // A 50-page batch result — notify the UI immediately
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
        throw new Error((m.msg as string) || "Large diff failed");
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
  } = {},
  xmlFile?: File | null,
): Promise<DiffResult | LargeDiffResult> {
  const { onProgress, onBatch } = callbacks;

  // ── Attempt chunked upload + SHA-256 dedup ────────────────────────────────
  // Upload both files in parallel via chunked multipart if the backend
  // supports it.  On success we get a SHA-256 hash for each file, which
  // lets the backend skip re-processing an identical file pair.
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
      // Check session cache — same pair as before?
      const cachedJobId = _getCachedJobId(oldUp.sha256, newUp.sha256);
      if (cachedJobId) {
        onProgress?.({ stage: "batch", pct: 5, message: "Previous result found — reloading…" });
      }

      // POST /diff/start — backend returns from cache if hash pair is known
      const startForm = new FormData();
      startForm.append("old_file_id", oldUp.fileId);
      startForm.append("old_sha",     oldUp.sha256);
      startForm.append("new_file_id", newUp.fileId);
      startForm.append("new_sha",     newUp.sha256);
      const startRes = await fetch(`${BASE}/diff/start`, { method: "POST", body: startForm });

      if (startRes.ok) {
        const startData = await startRes.json() as {
          job_id: string; cached: boolean; pages: number;
        };
        _setCachedJobId(oldUp.sha256, newUp.sha256, startData.job_id);
        // If the server says cached, stream results from disk — no CPU work
        if (startData.cached) {
          onProgress?.({ stage: "batch", pct: 10,
                         message: `Cached result — streaming ${startData.pages} pages…` });
        }
        // Fall through to regular large/standard streaming using the job_id.
        // The server streams immediately from cache if cached=true.
      }
      // If /diff/start doesn't exist yet, fall through to legacy path below.
    }
  } catch { /* chunked upload not available — fall through to legacy */ }

  // ── Legacy single-request path (always works) ─────────────────────────────
  // Use file SIZE as a proxy for page count — 4 MB per file is ~40-50 pages
  // of typical legal-PDF text, matching the server's LARGE_DOC_THRESHOLD=100.
  // (8 MB was previously used but mismatched: a 200-page text PDF can be <8 MB
  //  and would time-out on /diff/stream; a 30-page image PDF can be >8 MB and
  //  would wastefully hit /diff/stream/large.)
  const LARGE_SIZE_BYTES = 4 * 1024 * 1024;
  const useLarge = oldFile.size > LARGE_SIZE_BYTES || newFile.size > LARGE_SIZE_BYTES;

  if (useLarge) {
    onProgress?.({ stage: "batch", pct: 0, message: "Large document detected — using batched mode…" });
    return apiDiffLarge(oldFile, newFile, { onProgress, onBatch }, xmlFile);
  }

  return apiDiff(oldFile, newFile, onProgress, xmlFile);
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

// ── XML session cache ─────────────────────────────────────────────────────────
// Uploads XML text once, reuses session_id for subsequent locate calls.
// Avoids posting the full XML (up to 40 MB) on every chunk click.

function _fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}

const _xmlSessionCache = new Map<number, string>(); // hash → session_id

async function _getXmlSessionId(xmlText: string): Promise<string | null> {
  const hash = _fnv32(xmlText);
  if (_xmlSessionCache.has(hash)) return _xmlSessionCache.get(hash)!;
  try {
    const res = await fetch(`${BASE}/xml/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml_text: xmlText }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { session_id?: string };
    if (!data.session_id) return null;
    if (_xmlSessionCache.size >= 5) {
      const first = _xmlSessionCache.keys().next().value;
      if (first !== undefined) _xmlSessionCache.delete(first);
    }
    _xmlSessionCache.set(hash, data.session_id);
    return data.session_id;
  } catch { return null; }
}

export async function apiApply(xmlText: string, chunk: Chunk): Promise<ApplyResult> {
  const res = await fetch(`${BASE}/xml/apply`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ xml_text: xmlText, chunk }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Apply failed");
  }
  return res.json() as Promise<ApplyResult>;
}

export async function apiLocate(xmlText: string, chunk: Chunk): Promise<LocateResult | null> {
  try {
    // Try lightweight session-id first — avoids POSTing full XML on every click
    const sessionId = await _getXmlSessionId(xmlText);
    if (sessionId) {
      const res = await fetch(`${BASE}/xml/locate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, chunk }),
      });
      if (res.ok) return res.json() as Promise<LocateResult>;
    }
    // Fallback: send full XML (works even without session endpoint)
    const res = await fetch(`${BASE}/xml/locate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml_text: xmlText, chunk }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<LocateResult>;
  } catch { return null; }
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
             :           `Extracting old PDF… page ${p}/${n}`,
    };
  }

  if (s === "new") {
    const n = (msg.n as number) || 1;
    const p = (msg.p as number) || 0;
    return {
      stage: "new", page: p, totalPages: n,
      pct:     Math.min(55, Math.round(40 + (p / n) * 15)),
      message: p >= n ? "Both PDFs extracted — starting diff…"
             :          `Extracting new PDF… page ${p}/${n}`,
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
      message: sub ? (SUB_LABELS[sub] ?? `Diff: ${sub}…`) : "Computing diff…",
    };
  }

  if (s === "render") {
    return { stage: "render", chunks: msg.chunks as number, pct: 92,
             message: `Rendering ${msg.chunks} changes…` };
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
      message: `${pages} pages — processing in ${batches} batches of 50…`,
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
      message: msg.msg as string ?? `Processing batch ${batch}/${of}…`,
    };
  }

  if (s === "done") {
    return { stage: "done", pct: 100, message: "Complete." };
  }

  return { stage: "batch", pct: 0, message: "Processing large document…" };
}