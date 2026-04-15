// ─────────────────────────────────────────────────────────────────────────────
// api.ts — HTTP client for the FastAPI compare service
// ─────────────────────────────────────────────────────────────────────────────

import type { ApplyResult, Chunk, DiffResult, LocateResult, XmlSection } from "./types";

const BASE = process.env.NEXT_PUBLIC_PROCESSING_URL
  ? `${process.env.NEXT_PUBLIC_PROCESSING_URL}/compare`
  : "http://localhost:8000/compare";

// ── Progress reporting ────────────────────────────────────────────────────────

export interface DiffProgress {
  stage:       "old" | "new" | "diff" | "render";
  page?:       number;
  totalPages?: number;
  chunks?:     number;
  pct:         number;   // 0–100
  message:     string;
}

// ── Streaming diff ────────────────────────────────────────────────────────────

/**
 * Run a diff between two PDFs, optionally with an XML baseline.
 *
 * The XML file is used in BOTH workflows:
 *  wf2 — XML feeds the 8-gram anchor filter (hidden from user, loads into Panel D read-only)
 *  wf3 — Same, plus Panel D is editable and the user can apply changes back to it
 *
 * Reports real-time progress via onProgress callback.
 */
export async function apiDiff(
  oldFile:  File,
  newFile:  File,
  onProgress?: (p: DiffProgress) => void,
  xmlFile?: File | null,
): Promise<DiffResult> {
  const form = new FormData();
  form.append("old_file", oldFile);
  form.append("new_file", newFile);
  if (xmlFile) form.append("xml_file_a", xmlFile);

  const res = await fetch(`${BASE}/diff/stream`, { method: "POST", body: form });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = typeof err.detail === "object"
      ? err.detail.error
      : (err.detail ?? "Diff failed");
    throw new Error(msg);
  }

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DiffResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if      (msg.t === "p" && onProgress) onProgress(_parseProgress(msg));
        else if (msg.t === "r")               result = msg.d as DiffResult;
        else if (msg.t === "e")               throw new Error(msg.msg || "Diff failed");
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer);
      if (msg.t === "r") result = msg.d as DiffResult;
      if (msg.t === "e") throw new Error(msg.msg || "Diff failed");
    } catch { /* ignore parse error on trailing data */ }
  }

  if (!result) throw new Error("No result received from server");
  return result;
}

function _parseProgress(msg: Record<string, unknown>): DiffProgress {
  const s = msg.s as string;

  if (s === "old") {
    const n   = (msg.n as number) || 1;
    const p   = (msg.p as number) || 0;
    const pct = Math.min(40, Math.round(10 + (p / n) * 30));
    return {
      stage: "old", page: p, totalPages: n, pct,
      message: p === 0
        ? `Extracting old PDF… (${n} pages)`
        : p >= n ? "Old PDF extracted"
        : `Extracting old PDF… page ${p}/${n}`,
    };
  }

  if (s === "new") {
    const n   = (msg.n as number) || 1;
    const p   = (msg.p as number) || 0;
    const pct = Math.min(55, Math.round(40 + (p / n) * 15));
    return {
      stage: "new", page: p, totalPages: n, pct,
      message: p >= n
        ? "Both PDFs extracted — starting diff…"
        : `Extracting new PDF… page ${p}/${n}`,
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
      message: sub ? (SUB_LABELS[sub] ?? `Diff: ${sub}…`) : "Computing anchor-keyed diff…",
    };
  }

  if (s === "render") {
    return { stage: "render", chunks: msg.chunks as number, pct: 92, message: `Rendering ${msg.chunks} changes…` };
  }

  return { stage: "diff", pct: 50, message: "Processing…" };
}

// ── XML operations ────────────────────────────────────────────────────────────

/**
 * Apply one chunk change into the XML text.
 * Called in wf3 only — never in wf2.
 */
export async function apiApply(xmlText: string, chunk: Chunk): Promise<ApplyResult> {
  const res = await fetch(`${BASE}/xml/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml_text: xmlText, chunk }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Apply failed");
  }
  return res.json() as Promise<ApplyResult>;
}

/**
 * Locate where a chunk appears in the XML (read-only highlight).
 * Called in BOTH wf2 (XML navigation) and wf3 (before apply).
 */
export async function apiLocate(xmlText: string, chunk: Chunk): Promise<LocateResult | null> {
  try {
    const res = await fetch(`${BASE}/xml/locate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml_text: xmlText, chunk }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<LocateResult>;
  } catch {
    return null;
  }
}

// ── XML section parsing ───────────────────────────────────────────────────────

/**
 * Fast client-side XML section parser using DOMParser.
 * Extracts innodLevel tags with their headings — instant even on large files.
 * No network round-trip. Works for all tested documents (ES, FR, KO, EN).
 */
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
          const pH    = parentEl.querySelector("innodHeading > title") ?? parentEl.querySelector("innodHeading title");
          let pLabel  = (pH?.textContent ?? "").trim();
          if (!pLabel || pLabel.length < 2)
            pLabel = (parentEl.getAttribute("last-path") ?? "").trim();
          const pIdx  = labelToIdx.get(pLabel);
          if (pIdx !== undefined) { parentId = pIdx; break; }
        }
        parentEl = parentEl.parentElement;
      }

      const idx = sections.length;
      sections.push({ id: idx, label, level: lvl, parent_id: parentId });
      labelToIdx.set(label, idx);
    });

    // When all sections share the same numeric level, derive synthetic levels
    // from the label prefix so the chip picker shows meaningful groupings.
    const distinctLvls = new Set(sections.map((s) => s.level));
    if (distinctLvls.size === 1 && sections.length > 1) {
      const prefixOrder = new Map<string, number>();
      let nextSynth     = minLevel;
      for (const s of sections) {
        const pfx = s.label.match(/^([a-zà-ÿÀ-ÿ\u0100-\u024F]+\.?)/i)?.[1]?.toLowerCase() ?? "";
        if (pfx && pfx.length >= 2 && !prefixOrder.has(pfx))
          prefixOrder.set(pfx, nextSynth++);
        if (pfx && prefixOrder.has(pfx))
          s.level = prefixOrder.get(pfx)!;
      }
      if (prefixOrder.size > 0)
        minLevel = Math.min(...sections.map((s) => s.level));
    }

    // Prepend a Preamble entry for content before the first structural section
    if (sections.length > 0) {
      for (const s of sections) { s.id += 1; if (s.parent_id >= 0) s.parent_id += 1; }
      sections.unshift({ id: 0, label: "Preamble", level: minLevel, parent_id: -1 });
    }

    return sections;
  } catch {
    return [];
  }
}