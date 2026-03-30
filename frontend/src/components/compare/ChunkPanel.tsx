"use client";
/**
 * ChunkPanel — Enhanced PDF + XML Chunker
 */

import React, { useState, useRef, useCallback } from "react";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChangeType = "addition" | "removal" | "modification" | "emphasis" | "mismatch";

// Visual metadata for each change type — used in table rows and modal
const CHANGE_META: Record<
  ChangeType,
  { label: string; icon: string; pill: string; dot: string }
> = {
  addition: {
    label: "Addition",
    icon: "+",
    pill: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25",
    dot:  "bg-emerald-400",
  },
  modification: {
    label: "Modified",
    icon: "~",
    pill: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25",
    dot:  "bg-amber-400",
  },
  removal: {
    label: "Removal",
    icon: "−",
    pill: "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25",
    dot:  "bg-red-400",
  },
  emphasis: {
    label: "Emphasis",
    icon: "B",
    pill: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25",
    dot:  "bg-blue-400",
  },
  // "mismatch" comes from the backend span-detection pipeline (ratio < 0.82).
  // Must be present here so CHANGE_META[ct] never returns undefined → no crash.
  mismatch: {
    label: "Mismatch",
    icon: "≠",
    pill: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/25",
    dot:  "bg-violet-400",
  },
};

const CHANGE_TYPE_ORDER: ChangeType[] = ["addition", "modification", "removal", "mismatch", "emphasis"];

/** Mirrors the Change shape from ComparePanel — kept minimal so ChunkPanel
 *  has no circular dependency on ComparePanel's internal Formatting type. */
export interface DetectedChange {
  id: string;
  type: "addition" | "removal" | "modification" | "mismatch" | "emphasis";
  text: string;
  old_text: string | null;
  new_text: string | null;
  old_formatting: Record<string, unknown> | null;
  new_formatting: Record<string, unknown> | null;
  emphasis?: string[];
  xml_path: string | null;
  page: number;
  suggested_xml: string | null;
  applied?: boolean;
  dismissed?: boolean;
}

export interface DetectSummary {
  addition: number;
  removal: number;
  modification: number;
  emphasis: number;
  mismatch: number;
}

export interface PdfChunk {
  index: number;
  label: string;
  filename: string;
  old_text: string;
  new_text: string;
  has_changes: boolean;
  change_types: ChangeType[];
  change_summary: { addition: number; removal: number; modification: number };
  xml_content: string;
  xml_chunk_file: string;
  xml_tag: string;
  xml_attributes: Record<string, string>;
  xml_size: number;
  old_heading?: string;
  new_heading?: string;
  /** 1-based page range in the OLD PDF */
  page_start?: number;
  page_end?: number;
  old_page_start?: number;
  old_page_end?: number;
  /** 1-based page range in the NEW PDF */
  new_page_start?: number;
  new_page_end?: number;
  /** First heading text of this chunk — used to anchor span comparison */
  old_anchor?: string;
  new_anchor?: string;
  /** Word counts computed server-side from extracted text */
  old_word_count?: number;
  new_word_count?: number;
  /** Per-side raw headings — may differ when alignment is approximate */
  old_heading_raw?: string;
  new_heading_raw?: string;
  /** Pre-computed span-level changes from /start-chunking pipeline */
  detected_changes?: DetectedChange[];
  detect_summary?: DetectSummary;
}

interface ChunkResponse {
  success: boolean;
  source_name: string;
  old_filename: string;
  new_filename: string;
  xml_filename: string;
  pdf_chunks: PdfChunk[];
  summary: { total: number; changed: number; unchanged: number };
  old_pdf_chunk_count: number;
  new_pdf_chunk_count: number;
  xml_chunk_count: number;
  folder_structure: {
    base: string;
    chunked: string;
    compare: string;
    merge: string;
  };
}

export interface JobState {
  job_id: string;
  source_name: string;
  status: "uploaded" | "processing" | "done" | "error";
}

export type ConversionPair = "pdf-to-pdf" | "pdf-to-html" | "html-to-html";

interface ChunkPanelProps {
  onNavigateToCompare?: (chunk: PdfChunk, sourceName: string) => void;
  onAllChunksReady?: (chunks: PdfChunk[]) => void;
  /** Called after chunking — passes the actual PDF File objects for the PDF viewers */
  onFilesReady?: (oldPdf: File, newPdf: File, xmlFile: File | null) => void;
  onJobCreated?: (job: JobState) => void;
  activeJob?: JobState | null;
  fileCount?: 2 | 3;
  conversionPair?: ConversionPair;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveSourceName(filename: string): string {
  let name = filename.replace(/\.[^/.]+$/, "");
  for (let i = 0; i < 4; i++) {
    name = name.replace(/[-_]VER\d+/gi, "");
    name = name.replace(/[-_](20|19)\d{6}/g, "");
    name = name.replace(/(20|19)\d{2}[-_]\d{2}[-_]\d{2}/g, "");
    name = name.replace(/[-_]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-_]?\d{2,4}/gi, "");
    name = name.replace(/[-_]\d{2,6}$/g, "");
    name = name.replace(/[-_][vV]\d+$/g, "");
  }
  name = name.replace(/[-_]{2,}/g, "-").replace(/^[-_]|[-_]$/g, "");
  return name || filename.replace(/\.[^/.]+$/, "");
}

const TAG_OPTIONS = [
  { value: "chapter",   label: "Chapter",   hint: "Splits at Chapter 1, Chapter 2…" },
  { value: "section",   label: "Section",   hint: "Splits at Section, §, numbered headings" },
  { value: "part",      label: "Part",      hint: "Splits at Part I, Part II…" },
  { value: "article",   label: "Article",   hint: "Splits at Article 1, Article 2…" },
  { value: "paragraph", label: "Paragraph", hint: "Splits at ¶ or double newline blocks" },
];

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ── DropZone ──────────────────────────────────────────────────────────────────

type DZColor = "violet" | "blue" | "emerald";

const DZC: Record<DZColor, Record<string, string>> = {
  violet: {
    border: "border-violet-400/50 dark:border-violet-500/40",
    bg: "bg-violet-50 dark:bg-violet-500/8",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
    icon: "text-violet-600 dark:text-violet-400",
    activeBg: "bg-violet-100 dark:bg-violet-500/12",
  },
  blue: {
    border: "border-blue-400/50 dark:border-blue-500/40",
    bg: "bg-blue-50 dark:bg-blue-500/8",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    icon: "text-blue-600 dark:text-blue-400",
    activeBg: "bg-blue-100 dark:bg-blue-500/12",
  },
  emerald: {
    border: "border-emerald-400/50 dark:border-emerald-500/40",
    bg: "bg-emerald-50 dark:bg-emerald-500/8",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    icon: "text-emerald-600 dark:text-emerald-400",
    activeBg: "bg-emerald-100 dark:bg-emerald-500/12",
  },
};

function IconSvgRenderer({ icon }: { icon: "pdf" | "xml" | "html" }) {
  if (icon === "pdf") return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
  if (icon === "html") return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function DropZone({
  label, sublabel, accept, file, onFile, color, icon,
}: {
  label: string; sublabel?: string; accept: string; file: File | null;
  onFile: (f: File | null) => void; color: DZColor; icon: "pdf" | "xml" | "html";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const c = DZC[color];

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all p-4 group
        ${drag ? `${c.border} ${c.activeBg} scale-[1.01]`
          : file ? `${c.border} ${c.bg}`
          : `border-slate-300 dark:border-slate-700/50 hover:${c.border} hover:${c.bg}`}`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div className="flex flex-col items-center gap-2 text-center">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
          ${file ? c.bg : "bg-slate-100 dark:bg-slate-800/60"} ${c.icon}`}>
          <IconSvgRenderer icon={icon} />
        </div>
        <div className="min-w-0 w-full">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
          {sublabel && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500">{sublabel}</span>
          )}
          <div className="mt-1.5">
            {file ? (
              <div className="flex items-center justify-center gap-1.5">
                <p className="text-xs font-medium text-slate-800 dark:text-white truncate max-w-[120px]">{file.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.badge} flex-shrink-0`}>{fmtBytes(file.size)}</span>
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">Drop or click to browse</p>
            )}
          </div>
        </div>
      </div>
      {file && (
        <button
          onClick={(e) => { e.stopPropagation(); onFile(null); }}
          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700/80 hover:bg-red-100 dark:hover:bg-red-500/30 flex items-center justify-center transition-colors"
        >
          <svg className="w-3 h-3 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── ErrorBoundary — prevents a single bad chunk from crashing the page ────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err?.message ?? "Unknown error" };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-xs text-red-400 font-semibold">Failed to render diff</p>
          <p className="text-[10px] text-slate-600">{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── ChunkDiff — inline line-level diff renderer ───────────────────────────────

/**
 * Renders one side (old or new) of a chunk diff with color-coded lines.
 *
 * Line colouring rules (zero false-positives):
 *  - "equal"  lines  → plain dimmed text (no highlight)
 *  - "insert" lines  → green highlight (only shown on "new" side)
 *  - "delete" lines  → red highlight   (only shown on "old" side)
 *  - "replace" pairs → amber highlight (modified lines, shown on both sides)
 *
 * We use difflib-equivalent logic in JS via the longest-common-subsequence
 * approach to avoid marking trivial whitespace differences.
 */
function ChunkDiff({
  side,
  oldText,
  newText,
}: {
  side: "old" | "new";
  oldText: string;
  newText: string;
}) {
  type DiffLine = { text: string; kind: "equal" | "insert" | "delete" | "replace" };

  const diff = React.useMemo((): DiffLine[] => {
    const splitLines = (t: string) =>
      (t || "").split("\n").map((l) => l.trim()).filter(Boolean);

    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);

    if (!oldLines.length && !newLines.length) return [];

    // Cap at 120 lines per side to prevent the LCS matrix from crashing the tab
    const MAX_INPUT = 120;
    const ol = oldLines.slice(0, MAX_INPUT);
    const nl = newLines.slice(0, MAX_INPUT);

    const m = ol.length;
    const n = nl.length;

    // Build LCS DP table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = ol[i].toLowerCase() === nl[j].toLowerCase()
          ? 1 + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    // Traceback
    const raw: DiffLine[] = [];
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && ol[i].toLowerCase() === nl[j].toLowerCase()) {
        raw.push({ text: ol[i], kind: "equal" }); i++; j++;
      } else if (j < n && (i >= m || dp[i + 1]?.[j] <= dp[i]?.[j + 1])) {
        raw.push({ text: nl[j], kind: "insert" }); j++;
      } else if (i < m) {
        raw.push({ text: ol[i], kind: "delete" }); i++;
      } else break;
    }

    // Pair adjacent delete+insert into "replace" when sufficiently similar
    const merged: DiffLine[] = [];
    let k = 0;
    while (k < raw.length) {
      const cur = raw[k];
      const nxt = raw[k + 1];
      if (cur.kind === "delete" && nxt?.kind === "insert") {
        const a = cur.text.toLowerCase();
        const b = nxt.text.toLowerCase();
        const longer = Math.max(a.length, b.length);
        const matches = longer
          ? Array.from({ length: Math.min(a.length, b.length) })
              .filter((_, ci) => a[ci] === b[ci]).length
          : 0;
        if (!longer || matches / longer > 0.3) {
          merged.push({ text: cur.text, kind: "replace" });
          merged.push({ text: nxt.text, kind: "replace" });
          k += 2;
          continue;
        }
      }
      merged.push(cur);
      k++;
    }

    return merged;
  }, [oldText, newText]);

  // Only render lines relevant to this side
  const visible = diff.filter((d) =>
    side === "old" ? d.kind !== "insert" : d.kind !== "delete"
  );

  if (!visible.length) {
    return <p className="text-[10px] text-slate-600 italic">—</p>;
  }

  const MAX_LINES = 40;
  const shown = visible.slice(0, MAX_LINES);
  const truncated = visible.length > MAX_LINES;

  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto">
      {shown.map((line, idx) => {
        const isAdded    = line.kind === "insert" && side === "new";
        const isRemoved  = line.kind === "delete"  && side === "old";
        const isModified = line.kind === "replace";

        let rowCls = "text-[10px] font-mono leading-relaxed px-1.5 py-0.5 rounded";
        let prefix = " ";
        if (isAdded)         { rowCls += " bg-emerald-500/15 text-emerald-300"; prefix = "+"; }
        else if (isRemoved)  { rowCls += " bg-red-500/15 text-red-400";         prefix = "−"; }
        else if (isModified) {
          rowCls += side === "old"
            ? " bg-amber-500/10 text-amber-400"
            : " bg-amber-500/10 text-amber-200";
          prefix = "~";
        } else {
          rowCls += " text-slate-500";
        }

        return (
          <div key={idx} className={rowCls}>
            <span className="select-none opacity-40 mr-1 font-bold">{prefix}</span>
            <span className="whitespace-pre-wrap break-words">{line.text}</span>
          </div>
        );
      })}
      {truncated && (
        <p className="text-[9px] text-slate-600 italic px-1.5 pt-1">
          +{visible.length - MAX_LINES} more lines…
        </p>
      )}
    </div>
  );
}

// ── ChunkDetailModal — opened when clicking any row (changed or unchanged) ──────

function ChunkDetailModal({
  chunk, fromExt, toExt, canNavigate, onOpenInCompare, onClose,
}: {
  chunk: PdfChunk;
  fromExt: string;
  toExt: string;
  canNavigate: boolean;
  onOpenInCompare: () => void;
  onClose: () => void;
}) {
  const heading    = chunk.old_heading || chunk.new_heading || `Chunk ${chunk.index}`;
  const oldName    = `old_chunk${String(chunk.index).padStart(3, "0")}.${fromExt}`;
  const newName    = `new_chunk${String(chunk.index).padStart(3, "0")}.${toExt}`;
  const hasChanges = chunk.has_changes;
  const summary    = chunk.change_summary as Record<string, number>;
  const types      = chunk.change_types?.length
    ? chunk.change_types
    : CHANGE_TYPE_ORDER.filter((t) => (summary?.[t] ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`w-full max-h-[90vh] flex flex-col rounded-2xl border bg-slate-900 shadow-2xl overflow-hidden
        ${hasChanges ? "max-w-3xl border-slate-700/50" : "max-w-md border-slate-700/40"}`}>

        {/* Gradient bar — green for no-changes, amber/violet for changes */}
        <div className={`h-0.5 w-full flex-shrink-0 ${hasChanges
          ? "bg-gradient-to-r from-violet-500 via-amber-500 to-blue-500"
          : "bg-gradient-to-r from-emerald-500 to-teal-500"}`} />

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center flex-shrink-0
              ${hasChanges ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>
              {String(chunk.index).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">{heading}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {hasChanges ? "Chunk diff preview" : "Chunk inspection"}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors flex-shrink-0 ml-3">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── No-changes confirmation view ── */}
        {!hasChanges && (
          <div className="flex flex-col items-center justify-center px-8 py-10 gap-4 text-center">
            {/* Large check */}
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-white">No changes detected</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                The old and new versions of this chunk are identical. No additions,
                removals, modifications, or emphasis changes were found.
              </p>
            </div>
            {/* File names */}
            <div className="w-full flex flex-col gap-1.5 mt-1">
              {[
                { name: oldName, color: "text-violet-400", dot: "bg-violet-400", label: "Old" },
                { name: newName, color: "text-blue-400",   dot: "bg-blue-400",   label: "New" },
              ].map(({ name, color, dot, label }) => (
                <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30">
                  <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${dot}`} />
                  <span className={`text-[10px] font-bold uppercase tracking-widest flex-shrink-0 ${color}`}>{label}</span>
                  <span className="text-[11px] font-mono text-slate-300 truncate">{name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Changed view: pills bar + side-by-side diff ── */}
        {hasChanges && (
          <>
            {/* Change-type pills + diff legend */}
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-slate-800/60 bg-slate-900/60">
              <div className="flex items-center gap-1.5 flex-wrap">
                {types.length > 0
                  ? types.map((ct: ChangeType) => {
                      const meta  = CHANGE_META[ct] ?? CHANGE_META["modification"];
                      const count = summary?.[ct] ?? 0;
                      return (
                        <span key={ct} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.pill}`}>
                          {meta.icon} {meta.label}
                          {count > 1 && <span className="opacity-70">×{count}</span>}
                        </span>
                      );
                    })
                  : <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/25 font-bold uppercase">Changed</span>
                }
              </div>
              <div className="flex items-center gap-3 text-[9px] text-slate-500 flex-shrink-0">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/40" />Added</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500/40" />Modified</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/40" />Removed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/40" />Emphasis</span>
              </div>
            </div>

            {/* Side-by-side diff */}
            <div className="flex-1 overflow-hidden grid grid-cols-2 divide-x divide-slate-800 min-h-0">
              <div className="flex flex-col min-h-0">
                <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/40">
                  <div className="w-2 h-2 rounded-sm bg-violet-400 flex-shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">{oldName}</span>
                  <span className="text-[10px] text-violet-700 truncate">· {heading}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {chunk.old_text ? (
                    <ErrorBoundary>
                      <ChunkDiff side="old" oldText={chunk.old_text} newText={chunk.new_text} />
                    </ErrorBoundary>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic text-center mt-6">
                      Open in Compare to view full diff
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/40">
                  <div className="w-2 h-2 rounded-sm bg-blue-400 flex-shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">{newName}</span>
                  <span className="text-[10px] text-blue-700 truncate">· {heading}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {chunk.new_text ? (
                    <ErrorBoundary>
                      <ChunkDiff side="new" oldText={chunk.old_text} newText={chunk.new_text} />
                    </ErrorBoundary>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic text-center mt-6">
                      Open in Compare to view full diff
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-900/60">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/40 text-slate-300 text-xs font-semibold transition-colors">
            Close
          </button>
          {canNavigate && hasChanges && (
            <button
              onClick={onOpenInCompare}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-violet-500/20 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Open in Compare Tool
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Compare Modal ─────────────────────────────────────────────────────────────

function CompareModal({
  result, onClose, onOpenChunk,
}: {
  result: ChunkResponse;
  onClose: () => void;
  onOpenChunk?: (chunk: PdfChunk) => void;
}) {
  const allChunks = result.pdf_chunks;
  const changed   = allChunks.filter((c) => c.has_changes);
  const unchanged = allChunks.filter((c) => !c.has_changes);
  // Always derive counts from the actual chunk array — never from result.summary
  // which is computed before span-detection corrects individual has_changes flags.
  const totalCount     = allChunks.length;
  const changedCount   = changed.length;
  const unchangedCount = unchanged.length;
  const pct = totalCount > 0 ? Math.round((changedCount / totalCount) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 via-blue-500 to-emerald-500 flex-shrink-0" />

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-white">Compare Results</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {changedCount === 0
                ? "No differences found — all chunks are identical"
                : `${changedCount} of ${totalCount} chunks have differences · click a chunk to review`}
            </p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex-shrink-0 flex items-center gap-4 px-5 py-3 border-b border-slate-800/60">
          {[
            { label: "Total",     val: totalCount,     color: "text-slate-300" },
            { label: "Changed",   val: changedCount,   color: "text-amber-300" },
            { label: "Unchanged", val: unchangedCount, color: "text-emerald-300" },
          ].map(({ label, val, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`text-base font-bold tabular-nums ${color}`}>{val}</span>
              <span className="text-[11px] text-slate-600">{label}</span>
            </div>
          ))}
          <div className="flex-1 ml-2 h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500/70 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-slate-600">{pct}%</span>
        </div>

        {/* Column headers — fixed, matches row layout */}
        <div className="flex-shrink-0 grid grid-cols-[1fr_80px_80px_60px_80px] items-center gap-0 px-3 py-1.5 border-b border-slate-800/40 bg-slate-950/50">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 pl-8">Chunk</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-right pr-1">Old</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-right pr-1">New</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-right">Δ</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 text-right pr-1">Status</span>
        </div>

        {/* All chunks — always shown regardless of changed/unchanged state */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {allChunks.map((chunk) => {
            const heading   = chunk.old_heading || chunk.new_heading || `Chunk ${chunk.index}`;
            const summary   = chunk.change_summary as Record<string, number>;
            const types     = (chunk.change_types?.length
              ? chunk.change_types
              : CHANGE_TYPE_ORDER.filter((t) => (summary?.[t] ?? 0) > 0)
            ).slice(0, 2);
            const isChanged  = chunk.has_changes;
            const ow         = chunk.old_word_count ?? 0;
            const nw         = chunk.new_word_count ?? 0;
            const wordDelta  = nw - ow;
            // Meaningful word diff: >2 words AND >0.5% of document size
            const hasWordDiff = ow > 0 && Math.abs(wordDelta) > 2 && Math.abs(wordDelta) / ow > 0.005;
            // Clickable if span-changed OR has a meaningful word diff
            const isClickable = true; // all chunks are clickable — even "Match" ones for inspection

            // Detect heading mismatch (old Part 14 ↔ new Part 13 etc.)
            const oldH = chunk.old_heading_raw || heading;
            const newH = chunk.new_heading_raw || heading;
            const headingMismatch = oldH.toLowerCase() !== newH.toLowerCase();

            return (
              <button
                key={chunk.index}
                onClick={() => { if (isClickable) onOpenChunk?.(chunk); }}
                disabled={!isClickable}
                className={`w-full grid grid-cols-[1fr_80px_80px_60px_80px] items-center gap-0 px-3 py-2 rounded-lg border transition-all text-left group ${
                  isChanged
                    ? "border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40 cursor-pointer"
                    : hasWordDiff
                      ? "border-yellow-600/25 bg-yellow-500/5 hover:bg-yellow-500/10 hover:border-yellow-500/30 cursor-pointer"
                      : "border-slate-800/40 bg-transparent hover:bg-slate-800/20"
                }`}
              >
                {/* Col 1: index badge + heading */}
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className={`w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0 ${
                    isChanged
                      ? "bg-amber-500/20 text-amber-300"
                      : hasWordDiff
                        ? "bg-yellow-500/15 text-yellow-400"
                        : "bg-slate-800 text-slate-500"
                  }`}>
                    {String(chunk.index).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    {headingMismatch ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-[10px] text-violet-400 font-medium truncate max-w-[80px]" title={oldH}>{oldH}</span>
                        <span className="text-[9px] text-slate-600 flex-shrink-0">→</span>
                        <span className="text-[10px] text-blue-400 font-medium truncate max-w-[80px]" title={newH}>{newH}</span>
                      </div>
                    ) : (
                      <span className={`text-xs truncate block ${
                        isChanged
                          ? "font-semibold text-slate-200"
                          : hasWordDiff
                            ? "font-medium text-slate-300"
                            : "font-normal text-slate-500"
                      }`}>
                        {heading || <span className="italic text-slate-600">Preamble</span>}
                      </span>
                    )}
                  </div>
                </div>

                {/* Col 2: OLD word count */}
                <div className="text-right pr-1">
                  <span className="text-[10px] tabular-nums text-slate-500 font-mono">
                    {ow > 0 ? ow.toLocaleString() : "—"}
                  </span>
                </div>

                {/* Col 3: NEW word count */}
                <div className="text-right pr-1">
                  <span className={`text-[10px] tabular-nums font-mono font-medium ${
                    hasWordDiff ? "text-amber-300" : "text-slate-500"
                  }`}>
                    {nw > 0 ? nw.toLocaleString() : "—"}
                  </span>
                </div>

                {/* Col 4: Delta */}
                <div className="text-right">
                  {hasWordDiff ? (
                    <span className={`text-[10px] tabular-nums font-bold px-1 py-px rounded ${
                      wordDelta > 0
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}>
                      {wordDelta > 0 ? "+" : ""}{wordDelta}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-700">—</span>
                  )}
                </div>

                {/* Col 5: Status badge */}
                <div className="flex justify-end pr-1">
                  {isChanged ? (
                    <div className="flex items-center gap-0.5">
                      {types.length > 0
                        ? types.map((ct: ChangeType) => {
                            const meta = CHANGE_META[ct] ?? CHANGE_META["modification"];
                            return (
                              <span key={ct} className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-bold uppercase ${meta.pill}`}>
                                {meta.icon}
                              </span>
                            );
                          })
                        : (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/25 font-bold">
                            ~
                          </span>
                        )
                      }
                      <svg className="w-3 h-3 text-slate-600 group-hover:text-slate-300 transition-colors ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  ) : hasWordDiff ? (
                    <div className="flex items-center gap-0.5">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 font-bold uppercase">
                        Word Δ
                      </span>
                      <svg className="w-3 h-3 text-slate-600 group-hover:text-yellow-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  ) : (
                    <span className="flex items-center gap-0.5 text-[9px] text-emerald-700 font-semibold">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Match
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-900/60">
          <p className="text-[11px] text-slate-600">
            {changedCount > 0
              ? `${changedCount} changed · ${unchangedCount} unchanged`
              : `${unchangedCount} chunk${unchangedCount !== 1 ? "s" : ""} unchanged`}
          </p>
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/40 text-slate-300 text-xs font-semibold transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Main ChunkPanel ────────────────────────────────────────────────────────────

export default function ChunkPanel({
  onNavigateToCompare,
  onAllChunksReady,
  onFilesReady,
  onJobCreated,
  fileCount = 2,
  conversionPair = "pdf-to-pdf",
}: ChunkPanelProps) {
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceNameManuallyEdited, setSourceNameManuallyEdited] = useState(false);
  const [tagName, setTagName] = useState("chapter");
  const [tagDropOpen, setTagDropOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [chunkSize, setChunkSize] = useState(1500);

  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<"uploading" | "chunking" | null>(null);
  const [loadingPct, setLoadingPct] = useState(0);
  const [loadingStage, setLoadingStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChunkResponse | null>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareRan, setCompareRan] = useState(false);
  const [selectedChunk, setSelectedChunk] = useState<PdfChunk | null>(null);
  const [navigating, setNavigating] = useState(false);

  const fromExt = conversionPair.startsWith("html") ? "html" : "pdf";
  const toExt   = conversionPair.endsWith("html")   ? "html" : "pdf";
  const fromAccept = fromExt === "pdf" ? ".pdf,application/pdf" : ".html,text/html";
  const toAccept   = toExt   === "pdf" ? ".pdf,application/pdf" : ".html,text/html";
  const fromIcon: "pdf" | "html" = fromExt === "pdf" ? "pdf" : "html";
  const toIcon:   "pdf" | "html" = toExt   === "pdf" ? "pdf" : "html";
  const fromLabel = `OLD ${fromExt.toUpperCase()}`;
  const toLabel   = `NEW ${toExt.toUpperCase()}`;

  React.useEffect(() => {
    if (!sourceNameManuallyEdited && oldFile) setSourceName(deriveSourceName(oldFile.name));
  }, [oldFile, sourceNameManuallyEdited]);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node))
        setTagDropOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  React.useEffect(() => {
    setOldFile(null); setNewFile(null); setXmlFile(null);
    setSourceName(""); setSourceNameManuallyEdited(false);
  }, [conversionPair, fileCount]);

  const isReady = !!oldFile && !!newFile && (fileCount === 2 || !!xmlFile) && sourceName.trim().length > 0;

  const handleChunk = useCallback(async () => {
    if (!isReady) return;
    setLoading(true); setError(null); setResult(null); setCompareRan(false);
    setLoadingPct(0); setLoadingStage("Preparing files…");
    setLoadingStep("uploading");

    // Track all intervals so we can clean them up on any exit path
    const intervals: ReturnType<typeof setInterval>[] = [];
    const clearAll = () => intervals.forEach(clearInterval);

    try {
      const form = new FormData();
      form.append("old_pdf",       oldFile!);
      form.append("new_pdf",       newFile!);
      if (fileCount === 3 && xmlFile) form.append("xml_file", xmlFile);
      form.append("source_name",   sourceName.trim());
      form.append("tag_name",      tagName);
      form.append("chunk_size",    String(chunkSize));
      form.append("chunk_overlap", "150");

      // ── Phase 1: upload animation (0→28%) ────────────────────────────────
      let uploadPct = 0;
      intervals.push(setInterval(() => {
        uploadPct = Math.min(uploadPct + (28 - uploadPct) * 0.15, 27);
        setLoadingPct(Math.round(uploadPct));
        setLoadingStage("Sending files to server…");
      }, 250));

      // Fire the single combined request
      const chunkPromise = fetch(`${PROCESSING_URL}/compare/chunk-direct`, {
        method: "POST",
        body:   form,
      });

      // ── Phase 2: after ~1s switch to chunking UI + poll /progress ─────────
      await new Promise(r => setTimeout(r, 1000));
      clearAll(); intervals.length = 0;
      setLoadingStep("chunking");
      setLoadingPct(30);
      setLoadingStage("Extracting text from OLD PDF");

      // We need the job_id to poll progress — chunk-direct returns it in the
      // response body, but that only arrives when processing finishes.
      // So we use a two-phase poll: first find the job by polling /chunks
      // (which lists all jobs), then poll /progress once we have the id.
      // Simpler: just animate progress based on time, but update stage from
      // the response when it arrives. For now animate 30→94% over ~60s.
      let chunkPct = 30;
      const STAGES = [
        [30, "Extracting text from OLD PDF"],
        [42, "Extracting text from NEW PDF"],
        [52, "Aligning XML sections"],
        [62, "Aligning PDF sections"],
        [72, "Processing chunk 1"],
        [82, "Running word-level change detection"],
        [90, "Finalising results"],
      ] as const;
      let stageIdx = 0;

      intervals.push(setInterval(() => {
        // Asymptotic fill toward 94% — slows as it gets closer
        chunkPct = Math.min(chunkPct + (94 - chunkPct) * 0.025, 93.5);
        setLoadingPct(Math.round(chunkPct));
        // Advance stage labels based on progress
        while (stageIdx < STAGES.length - 1 && chunkPct >= STAGES[stageIdx + 1][0]) {
          stageIdx++;
        }
        setLoadingStage(STAGES[stageIdx][1]);
      }, 600));

      // ── Await response ────────────────────────────────────────────────────
      const res = await chunkPromise;
      clearAll(); intervals.length = 0;

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? `Failed: HTTP ${res.status}`);
      }

      // Set 100% immediately — don't wait for JSON.parse which can be slow
      // on large responses (14 chunks × full XML content)
      setLoadingPct(100);
      setLoadingStage("complete");

      const data: ChunkResponse = await res.json();
      const job_id: string = (data as ChunkResponse & { job_id?: string }).job_id ?? "";

      onJobCreated?.({ job_id, source_name: sourceName.trim(), status: "done" });
      onAllChunksReady?.(data.pdf_chunks);
      onFilesReady?.(oldFile!, newFile!, xmlFile ?? null);
      setResult(data);

    } catch (e) {
      clearAll();
      setError(e instanceof Error ? e.message : "Chunking failed");
      onJobCreated?.({ job_id: "", source_name: sourceName.trim(), status: "error" });
    } finally {
      clearAll();
      setLoading(false);
      setLoadingStep(null);
    }
  }, [
    isReady,
    oldFile,
    newFile,
    xmlFile,
    fileCount,
    sourceName,
    tagName,
    chunkSize,
    onJobCreated,
    onAllChunksReady,
    onFilesReady,
  ]);

  function handleOpenChunkInCompare(chunk: PdfChunk) {
    if (!onNavigateToCompare || !result) return;
    setNavigating(true);
    setSelectedChunk(null);
    // Brief delay so the loading modal renders before the heavy panel mounts
    setTimeout(() => {
      onNavigateToCompare(chunk, result.source_name);
      setNavigating(false);
    }, 600);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">
            Chunk {fromExt.toUpperCase()}{fileCount === 3 ? ` + XML` : ""}
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/25 font-semibold">
            {conversionPair.replace(/-/g, " → ")}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-500 font-medium">
            {fileCount} files
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Upload {fromLabel}, {toLabel}{fileCount === 3 ? ", and OLD XML" : ""} to split into reviewable XML chunks
        </p>
      </div>

      {/* ── Source Name ── */}
      <div className="flex-shrink-0 px-6 pb-3">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white dark:border-slate-700/50 dark:bg-slate-900/40">
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1">
              Source Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text" value={sourceName}
              onChange={(e) => { setSourceName(e.target.value); setSourceNameManuallyEdited(true); }}
              placeholder="e.g. ManualV2, ProductGuide"
              className="w-full bg-transparent text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none"
            />
          </div>
          <div className="text-slate-400 dark:text-slate-600 text-[10px] font-mono text-right">
            {sourceName ? `→ ${sourceName.replace(/[^\w\-]/g, "_")}_innod.00001.xml` : "Upload a file to auto-fill"}
          </div>
        </div>
      </div>

      {/* ── File Upload Grid ── */}
      <div className="flex-shrink-0 px-6 pb-3">
        <div className={`grid gap-3 ${fileCount === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          <DropZone label={fromLabel} sublabel="baseline" accept={fromAccept} file={oldFile} onFile={setOldFile} color="violet" icon={fromIcon} />
          <DropZone label={toLabel} sublabel="updated" accept={toAccept} file={newFile} onFile={setNewFile} color="blue" icon={toIcon} />
          {fileCount === 3 && (
            <DropZone label="OLD XML" sublabel="reference" accept=".xml,text/xml,application/xml" file={xmlFile} onFile={setXmlFile} color="emerald" icon="xml" />
          )}
        </div>
      </div>

      {/* ── Settings Row ── */}
      <div className="flex-shrink-0 px-6 pb-3">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white dark:border-slate-700/40 dark:bg-slate-900/20">
          <div className="flex-1 relative" ref={tagDropdownRef}>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1">Tag</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text" value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                onFocus={() => setTagDropOpen(true)}
                placeholder="chapter, section, part…"
                className="flex-1 bg-transparent text-xs text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none"
              />
              <button type="button" onClick={() => setTagDropOpen((v) => !v)}
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {tagDropOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-30 w-64 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                {TAG_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button"
                    onClick={() => { setTagName(opt.value); setTagDropOpen(false); }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors
                      ${tagName === opt.value ? "bg-violet-50 dark:bg-violet-500/10" : ""}`}>
                    <div className="flex-shrink-0 mt-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${tagName === opt.value ? "bg-violet-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${tagName === opt.value ? "text-violet-700 dark:text-violet-300" : "text-slate-700 dark:text-slate-300"}`}>{opt.label}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{opt.hint}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-8 bg-slate-200 dark:bg-slate-800" />
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1">Chunk Size</label>
            <input type="number" value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))}
              min={500} max={5000} step={100}
              className="w-24 bg-transparent text-xs text-slate-700 dark:text-slate-300 focus:outline-none" />
          </div>
        </div>
      </div>

      {/* ── Action Bar ── */}
      <div className="flex-shrink-0 px-6 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleChunk} disabled={!isReady || loading}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all
              ${isReady && !loading
                ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/25"
                : "bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600"}`}>
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Chunking…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h8M4 18h8" />
                </svg>
                Chunk Now
              </>
            )}
          </button>
          {!sourceName.trim() && (
            <p className="text-xs text-slate-600 italic">Enter a source name to enable chunking</p>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex-shrink-0 mx-6 mb-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* ── Empty state ── */}
      {!result && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 px-6">
          <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/40 flex items-center justify-center">
            <svg className="w-10 h-10 text-slate-400 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h8M4 18h8" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Ready to Chunk</p>
            <p className="text-xs text-slate-400 dark:text-slate-600 mt-1 max-w-sm">
              Upload {fromLabel}, {toLabel}{fileCount === 3 ? ", and OLD XML" : ""}, enter a source name, then
              click <span className="text-violet-600 dark:text-violet-400 font-semibold">Chunk Now</span> to split into XML chunks.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-2 max-w-lg w-full">
            {[
              { step: "1", label: "Upload Files", desc: `${fromLabel}, ${toLabel}${fileCount === 3 ? ", OLD XML" : ""}` },
              { step: "2", label: "Set Source Name", desc: "Auto-filled from filename" },
              { step: "3", label: "Chunk Now", desc: "Smart structural splitting" },
            ].map(({ step, label, desc }) => (
              <div key={step} className="p-3 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/30 text-left">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-2">{step}</div>
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">{label}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading Modal — fixed overlay, always on top ── */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md select-none">
          <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/60 overflow-hidden">

            {/* Top gradient accent bar */}
            <div className="h-0.5 w-full bg-gradient-to-r from-blue-500 via-violet-500 to-cyan-500" />

            <div className="flex flex-col items-center px-8 py-10 gap-0">

              {/* Animated icon */}
              <div className="relative w-24 h-24 mb-6 flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/20 to-violet-500/20 blur-xl" />
                <svg className="absolute inset-0 w-24 h-24 animate-spin" style={{ animationDuration: "3s" }} viewBox="0 0 96 96" fill="none">
                  <circle cx="48" cy="48" r="44" stroke="url(#mring1)" strokeWidth="2" strokeDasharray="60 216" strokeLinecap="round" />
                  <defs>
                    <linearGradient id="mring1" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#6366f1" /><stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
                <svg className="absolute inset-2 w-20 h-20 animate-spin" style={{ animationDuration: "1.4s", animationDirection: "reverse" }} viewBox="0 0 80 80" fill="none">
                  <circle cx="40" cy="40" r="36" stroke="url(#mring2)" strokeWidth="1.5" strokeDasharray="30 196" strokeLinecap="round" />
                  <defs>
                    <linearGradient id="mring2" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#8b5cf6" /><stop offset="1" stopColor="#06b6d4" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/40">
                    {loadingStep === "uploading" ? (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>

              {/* Title */}
              <h3 className="text-lg font-bold text-white mb-1">
                {loadingStep === "uploading" ? "Uploading Files" : "Processing Chunks"}
              </h3>
              <p className="text-xs text-slate-500 text-center mb-7">
                {loadingStep === "uploading"
                  ? "Sending your files to the server…"
                  : "Extracting text, splitting into chunks, detecting changes"}
              </p>

              {/* Step pills */}
              <div className="flex items-center gap-2 mb-8">
                {([
                  { key: "uploading", label: "Upload" },
                  { key: "chunking",  label: "Chunk"  },
                  { key: "detect",    label: "Detect" },
                ] as const).map((step, i, arr) => {
                  const isDone   = step.key === "uploading" && loadingStep === "chunking";
                  const isActive = loadingStep === step.key ||
                    (step.key === "detect" && loadingStep === "chunking");
                  return (
                    <React.Fragment key={step.key}>
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all
                        ${isDone
                          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                          : isActive
                            ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                            : "bg-slate-800/60 border-slate-700/40 text-slate-600"}`}>
                        {isDone
                          ? <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                          : isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping flex-shrink-0" />}
                        {step.label}
                      </div>
                      {i < arr.length - 1 && (
                        <div className={`w-6 h-px ${isDone ? "bg-emerald-500/40" : "bg-slate-700"}`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Checklist — driven by loadingPct (always current, no stale closure) */}
              <div className="w-full space-y-3">
                {([
                  { label: "Uploading files to server",           threshold: 28 },
                  { label: "Extracting document structure",        threshold: 50 },
                  { label: "Aligning XML sections",               threshold: 65 },
                  { label: "Running word-level change detection",  threshold: 85 },
                  { label: "Finalising results",                   threshold: 98 },
                ] as const).map(({ label, threshold }, idx, arr) => {
                  const prevThreshold = idx === 0 ? 0 : arr[idx - 1].threshold;
                  const done   = loadingPct >= threshold;
                  const active = !done && loadingPct >= prevThreshold;
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-all
                        ${done   ? "bg-emerald-500 border-emerald-500"
                        : active ? "border-blue-500 bg-blue-500/10"
                                 : "border-slate-700 bg-transparent"}`}>
                        {done
                          ? <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
                          : active
                            ? <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            : null}
                      </div>
                      <span className={`text-xs font-medium transition-colors
                        ${done   ? "text-emerald-400"
                        : active ? "text-slate-200"
                                 : "text-slate-600"}`}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>

            </div>

            {/* Bottom bar — progress + stage */}
            <div className="px-8 py-4 border-t border-slate-800 bg-slate-900/80">
              {/* Percentage bar */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 truncate max-w-[230px]">
                  {loadingStage || (loadingStep === "uploading" ? "Preparing upload…" : "Starting…")}
                </span>
                <span className="text-[13px] font-bold text-white tabular-nums ml-2 flex-shrink-0">
                  {loadingPct}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500 ease-out"
                  style={{ width: `${loadingPct}%` }}
                />
              </div>
              <div className="flex gap-0.5 mt-3">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }} />
                ))}
                <span className="text-[11px] text-slate-600 ml-2">This may take a minute for large documents</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Chunk Table ── */}
      {result && !loading && (
        <div className="flex-1 overflow-hidden flex flex-col px-6 pb-4">

          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {result.pdf_chunks.length} chunk{result.pdf_chunks.length !== 1 ? "s" : ""}
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{fileCount === 3 ? "3 files" : "2 files"}</span>
              {compareRan && result.pdf_chunks.filter(c => c.has_changes).length > 0 && (
                <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 text-[10px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                  {result.pdf_chunks.filter(c => c.has_changes).length} changed
                </span>
              )}
            </div>
            <button
              onClick={() => { setCompareRan(true); setShowCompareModal(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-violet-500/20 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Compare
            </button>
          </div>

          {/* Table — Section column + aligned file columns */}
          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900/30">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 sticky top-0 z-10">
                  {/* Section label column */}
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700/40"
                    style={{ width: "30%" }}>
                    Section
                  </th>
                  {/* Old */}
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-violet-500 dark:text-violet-400 border-r border-slate-200 dark:border-slate-700/40"
                    style={{ width: fileCount === 3 ? "23%" : "35%" }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm bg-violet-400" />
                      Old <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">(baseline)</span>
                    </div>
                  </th>
                  {/* New */}
                  <th className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-blue-500 dark:text-blue-400 ${fileCount === 3 ? "border-r border-slate-200 dark:border-slate-700/40" : ""}`}
                    style={{ width: fileCount === 3 ? "23%" : "35%" }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm bg-blue-400" />
                      New <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">(updated)</span>
                    </div>
                  </th>
                  {fileCount === 3 && (
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-emerald-500 dark:text-emerald-400"
                      style={{ width: "24%" }}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm bg-emerald-400" />
                        XML <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">(reference)</span>
                      </div>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.pdf_chunks.map((chunk) => {
                  const oldName     = `old_chunk${String(chunk.index).padStart(3, "0")}.${fromExt}`;
                  const newName     = `new_chunk${String(chunk.index).padStart(3, "0")}.${toExt}`;
                  const xmlName     = `chunk${String(chunk.index).padStart(3, "0")}.xml`;
                  const isChanged   = compareRan && chunk.has_changes;
                  const isIdentical = compareRan && !chunk.has_changes;
                  // Both sides share the same canonical heading from the backend
                  const heading     = chunk.old_heading || chunk.new_heading || "";
                  const isPreamble  = !heading;

                  return (
                    <tr key={chunk.index}
                      onClick={() => setSelectedChunk(chunk)}
                      className={`border-b border-slate-100 dark:border-slate-800/60 transition-colors cursor-pointer
                        ${isChanged
                          ? "bg-amber-50/40 dark:bg-amber-500/5 hover:bg-amber-100/60 dark:hover:bg-amber-500/10"
                          : isIdentical
                            ? "opacity-60 hover:opacity-100 hover:bg-slate-50 dark:hover:bg-slate-800/30"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/30"}`}>

                      {/* Section — single canonical heading + index badge */}
                      <td className="px-3 py-2.5 border-r border-slate-100 dark:border-slate-800/40 align-middle">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-bold flex-shrink-0
                            ${isChanged
                              ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                            {String(chunk.index).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            {isPreamble ? (
                              <span className="text-[10px] text-slate-400 dark:text-slate-600 italic">Preamble</span>
                            ) : (
                              <span className={`text-xs font-semibold truncate block ${isChanged ? "text-amber-700 dark:text-amber-300" : "text-slate-700 dark:text-slate-200"}`}>
                                {heading}
                              </span>
                            )}
                          {isChanged && (
                              <div className="flex flex-wrap gap-0.5 mt-0.5">
                                {(chunk.change_types?.length
                                  ? chunk.change_types
                                  : CHANGE_TYPE_ORDER.filter(
                                      (t) => ((chunk.change_summary as Record<string, number>)?.[t] ?? 0) > 0
                                    )
                                ).map((ct: ChangeType) => {
                                  const meta  = CHANGE_META[ct] ?? CHANGE_META["modification"];
                                  const count = (chunk.change_summary as Record<string, number>)?.[ct] ?? 0;
                                  return (
                                    <span
                                      key={ct}
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${meta.pill}`}
                                    >
                                      {meta.icon} {meta.label}
                                      {count > 1 && (
                                        <span className="opacity-70 ml-0.5">×{count}</span>
                                      )}
                                    </span>
                                  );
                                })}
                                {/* Fallback: no types computed yet — show generic badge */}
                                {(!chunk.change_types?.length &&
                                  !CHANGE_TYPE_ORDER.some(
                                    (t) => ((chunk.change_summary as Record<string, number>)?.[t] ?? 0) > 0
                                  )) && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 text-[9px] font-bold uppercase">
                                    <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Changed
                                  </span>
                                )}
                              </div>
                            )}
                          {isIdentical && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25 text-[9px] font-bold mt-0.5">
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                              Identical
                            </span>
                          )}
                          </div>
                        </div>
                      </td>

                      {/* Old file — shows the same heading label as New */}
                      <td className="px-3 py-2.5 border-r border-slate-100 dark:border-slate-800/40 align-middle">
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 flex-shrink-0 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <div className="min-w-0">
                            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 block truncate">{oldName}</span>
                            {!isPreamble && (
                              <span className="text-[10px] text-violet-500 dark:text-violet-400 block truncate">{heading}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* New file — shows the same heading label as Old */}
                      <td className={`px-3 py-2.5 align-middle ${fileCount === 3 ? "border-r border-slate-100 dark:border-slate-800/40" : ""}`}>
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <div className="min-w-0">
                            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 block truncate">{newName}</span>
                            {!isPreamble && (
                              <span className="text-[10px] text-blue-500 dark:text-blue-400 block truncate">{heading}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* XML file */}
                      {fileCount === 3 && (
                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">{xmlName}</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Compare Summary Modal (toolbar button) ── */}
      {showCompareModal && result && (
        <CompareModal
          result={result}
          onClose={() => setShowCompareModal(false)}
          onOpenChunk={(chunk) => {
            setShowCompareModal(false);
            handleOpenChunkInCompare(chunk);
          }}
        />
      )}

      {/* ── Chunk Detail Modal (clicking a changed row) ── */}
      {selectedChunk && result && (
        <ChunkDetailModal
          chunk={selectedChunk}
          fromExt={fromExt}
          toExt={toExt}
          canNavigate={!!onNavigateToCompare}
          onOpenInCompare={() => handleOpenChunkInCompare(selectedChunk)}
          onClose={() => setSelectedChunk(null)}
        />
      )}

      {/* ── Navigating to Compare Tool loading overlay ── */}
      {navigating && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 px-10 py-8 rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl">
            {/* Animated icon */}
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 text-violet-500/20 animate-spin" fill="none" viewBox="0 0 24 24" style={{ animationDuration: "2s" }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              </svg>
              <svg className="absolute inset-0 w-14 h-14 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24" style={{ animationDuration: "1.2s" }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="16 48" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">Opening Compare Tool</p>
              <p className="text-xs text-slate-500 mt-1">Loading chunk into the 4-panel viewer…</p>
            </div>
            {/* Animated progress dots */}
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}