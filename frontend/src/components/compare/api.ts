import type { ApplyResult, Chunk, DiffResult, LocateResult, XmlSection } from "./types";

// Base URL — points to the FastAPI processing service
const BASE = process.env.NEXT_PUBLIC_PROCESSING_URL
  ? `${process.env.NEXT_PUBLIC_PROCESSING_URL}/compare`
  : "http://localhost:8000/compare";

// ── Progress types for streaming diff ─────────────────────────────────────────

export interface DiffProgress {
  /** "old" | "new" | "diff" | "render" */
  stage: string;
  /** Current page (for old/new) */
  page?: number;
  /** Total pages (for old/new) */
  totalPages?: number;
  /** Number of chunks found (for render) */
  chunks?: number;
  /** 0-100 */
  pct: number;
  /** Human-readable message */
  message: string;
}

// ── Streaming diff with real-time progress ────────────────────────────────────

export async function apiDiff(
  fileA: File,
  fileB: File,
  onProgress?: (p: DiffProgress) => void,
  xmlFileA?: File | null,
  xmlFileB?: File | null,
): Promise<DiffResult> {
  const form = new FormData();
  form.append("old_file", fileA);
  form.append("new_file", fileB);
  if (xmlFileA) form.append("xml_file_a", xmlFileA);
  if (xmlFileB) form.append("xml_file_b", xmlFileB);

  const res = await fetch(`${BASE}/diff/stream`, { method: "POST", body: form });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = typeof err.detail === "object" ? err.detail.error : (err.detail ?? "Diff failed");
    throw new Error(msg);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DiffResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.t === "p" && onProgress) {
          if (msg.s === "old") {
            // Interpolate within 10–40% based on pages processed.
            // p=0 → 10%, p=n → 40%. Clamp to avoid going backwards.
            const n = msg.n || 1;
            const pct = Math.min(40, Math.round(10 + (msg.p / n) * 30));
            onProgress({
              stage: "old",
              page: msg.p,
              totalPages: n,
              pct,
              message: msg.p === 0
                ? `Extracting old PDF… (${n} pages)`
                : msg.p >= n
                  ? "Old PDF extracted"
                  : `Extracting old PDF… page ${msg.p}/${n}`,
            });
          } else if (msg.s === "new") {
            // Interpolate within 40–55% based on pages processed.
            const n = msg.n || 1;
            const pct = Math.min(55, Math.round(40 + (msg.p / n) * 15));
            onProgress({
              stage: "new",
              page: msg.p,
              totalPages: n,
              pct,
              message: msg.p >= n
                ? "Both PDFs extracted — starting diff…"
                : `Extracting new PDF… page ${msg.p}/${n}`,
            });
          } else if (msg.s === "diff") {
            const sub = msg.sub as string | undefined;
            const sp = typeof msg.sp === "number" ? msg.sp : 0;
            const subLabels: Record<string, string> = {
              segmenting: "Segmenting blocks…",
              aligning: "Aligning document structure…",
              matching: "Matching blocks across documents…",
              refining: "Refining change detection…",
              "xml-validate": "Cross-validating with XML…",
              context: "Building context for changes…",
            };
            const label = sub ? (subLabels[sub] || `Diff: ${sub}…`) : "Computing anchor-keyed diff…";
            // Map sub-pct (0-100 within diff) to overall 65-90 range
            const overallPct = sub ? Math.round(65 + sp * 0.25) : 65;
            onProgress({
              stage: "diff",
              pct: overallPct,
              message: label,
            });
          } else if (msg.s === "render") {
            onProgress({
              stage: "render",
              chunks: msg.chunks,
              pct: 92,
              message: `Rendering ${msg.chunks} changes…`,
            });
          }
        } else if (msg.t === "r") {
          result = msg.d;
        } else if (msg.t === "e") {
          throw new Error(msg.msg || "Diff failed");
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  // Handle any remaining buffer
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer);
      if (msg.t === "r") result = msg.d;
      if (msg.t === "e") throw new Error(msg.msg || "Diff failed");
    } catch { /* ignore parse error on trailing data */ }
  }

  if (!result) throw new Error("No result received from server");
  return result;
}

export async function apiApply(
  xmlText: string,
  chunk: Chunk
): Promise<ApplyResult> {
  const res = await fetch(`${BASE}/xml/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml_text: xmlText, chunk }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Apply failed");
  }
  return res.json();
}

export async function apiLocate(
  xmlText: string,
  chunk: Chunk
): Promise<LocateResult | null> {
  try {
    const res = await fetch(`${BASE}/xml/locate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml_text: xmlText, chunk }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function apiParseSections(
  xmlText: string,
): Promise<XmlSection[]> {
  try {
    const res = await fetch(`${BASE}/xml/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml_text: xmlText }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.sections ?? [];
  } catch {
    return [];
  }
}

/**
 * Fast client-side XML section parser using DOMParser.
 * Extracts innodLevel tags with their headings — instant on even large files.
 */
export function parseXmlSectionsLocal(xmlText: string): XmlSection[] {
  if (!xmlText) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const levels = doc.querySelectorAll("innodLevel");
    const sections: XmlSection[] = [];

    // Label lookup map for fast parent-finding
    const labelToIdx = new Map<string, number>();

    // Collect all innodLevel headings first
    let minLevel = 99;
    levels.forEach((el) => {
      const lvl = parseInt(el.getAttribute("level") ?? "99", 10);

      // Find heading → title within this innodLevel (direct children first)
      const heading = el.querySelector("innodHeading > title") ?? el.querySelector("innodHeading title");
      let label = (heading?.textContent ?? "").trim();

      // Fallback: use last-path attribute when no heading title exists
      if (!label || label.length < 2) {
        label = (el.getAttribute("last-path") ?? "").trim();
      }
      if (!label || label.length < 2) return;

      if (lvl < minLevel) minLevel = lvl;

      // Find parent: walk up DOM to find enclosing innodLevel
      let parentId = -1;
      let parentEl = el.parentElement;
      while (parentEl) {
        if (parentEl.tagName === "innodLevel") {
          const pH = parentEl.querySelector("innodHeading > title") ?? parentEl.querySelector("innodHeading title");
          let pLabel = (pH?.textContent ?? "").trim();
          if (!pLabel || pLabel.length < 2) pLabel = (parentEl.getAttribute("last-path") ?? "").trim();
          const pIdx = labelToIdx.get(pLabel);
          if (pIdx !== undefined) { parentId = pIdx; break; }
        }
        parentEl = parentEl.parentElement;
      }

      const idx = sections.length;
      sections.push({ id: idx, label, level: lvl, parent_id: parentId });
      labelToIdx.set(label, idx);
    });

    // When all sections share the same numeric level value, derive synthetic
    // levels from the structural prefix of each label (e.g. "art.", "titre")
    // so the chip picker shows meaningful groupings.
    const distinctLvls = new Set(sections.map(s => s.level));
    if (distinctLvls.size === 1 && sections.length > 1) {
      const prefixOrder = new Map<string, number>();
      let nextSynthLevel = minLevel;
      for (const s of sections) {
        const pfx = s.label.match(/^([a-zà-ÿÀ-ÿ\u0100-\u024F]+\.?)/i)?.[1]?.toLowerCase() ?? "";
        if (pfx && pfx.length >= 2 && !prefixOrder.has(pfx)) {
          prefixOrder.set(pfx, nextSynthLevel++);
        }
        if (pfx && prefixOrder.has(pfx)) {
          s.level = prefixOrder.get(pfx)!;
        }
      }
      if (prefixOrder.size > 0) {
        minLevel = Math.min(...sections.map(s => s.level));
      }
    }

    // Prepend a "Preamble" entry for pages before the first structural section
    // Use the same level as the shallowest sections so it appears in every level filter
    if (sections.length > 0) {
      // Shift all existing ids by 1
      for (const s of sections) {
        s.id += 1;
        if (s.parent_id >= 0) s.parent_id += 1;
      }
      sections.unshift({ id: 0, label: "Preamble", level: minLevel, parent_id: -1 });
    }

    return sections;
  } catch {
    return [];
  }
}
