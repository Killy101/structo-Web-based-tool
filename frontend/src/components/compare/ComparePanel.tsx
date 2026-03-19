"use client";
/**
 * ComparePanel — Enhanced 4-Panel PDF Change Detection + XML Editor
 *
 * Improvements:
 *  - iLovePDF-style large dashed upload areas
 *  - Larger document viewer with zoom in/out/reset/fit-to-width controls
 *  - Compact "Detect Changes" button in clean toolbar
 *  - Left sidebar with formatting legend (Bold/Italic/Strikethrough/Underline)
 *  - Color-coded change highlighting: Green=Added, Red=Removed, Yellow=Modified
 *  - Click change → scroll + highlight in viewer
 *  - Lazy/virtualized page loading via PDF.js
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import type { PdfChunk } from "./ChunkPanel";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChangeType =
  | "addition"
  | "removal"
  | "modification"
  | "mismatch"
  | "emphasis";

interface Formatting {
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color: number;
  is_colored?: boolean;
}

interface Change {
  id: string;
  type: ChangeType;
  text: string;
  old_text: string | null;
  new_text: string | null;
  old_formatting: Formatting | null;
  new_formatting: (Formatting & { is_colored?: boolean }) | null;
  emphasis?: string[];
  xml_path: string | null;
  page: number;
  suggested_xml: string | null;
  applied?: boolean;
  dismissed?: boolean;
}

interface DetectSummary {
  addition: number;
  removal: number;
  modification: number;
  emphasis: number;
  mismatch: number;
}

interface DetectResponse {
  success: boolean;
  old_filename: string;
  new_filename: string;
  xml_filename: string;
  changes: Change[];
  xml_content: string;
  summary: DetectSummary;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ComparePanelProps {
  initialChunk?:       PdfChunk | null;
  initialSourceName?:  string;
  /** Active job passed down from page — enables /save-xml and /compare/{chunk_id} */
  activeJob?:          { job_id: string; source_name: string; status: string } | null;
}

// ── Change-type metadata ───────────────────────────────────────────────────────

const CM: Record<
  ChangeType,
  {
    label: string;
    icon: string;
    bg: string;
    border: string;
    text: string;
    pill: string;
    highlight: string;
    dot: string;
  }
> = {
  addition: {
    label: "Addition",
    icon: "+",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    pill: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    highlight: "bg-emerald-500/20",
    dot: "bg-emerald-400",
  },
  removal: {
    label: "Removal",
    icon: "−",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    pill: "bg-red-500/20 text-red-300 border-red-500/30",
    highlight: "bg-red-500/20",
    dot: "bg-red-400",
  },
  modification: {
    label: "Modified",
    icon: "~",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    pill: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    highlight: "bg-amber-500/20",
    dot: "bg-amber-400",
  },
  mismatch: {
    label: "Mismatch",
    icon: "≠",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-400",
    pill: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    highlight: "bg-violet-500/20",
    dot: "bg-violet-400",
  },
  emphasis: {
    label: "Emphasis",
    icon: "★",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    pill: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    highlight: "bg-blue-500/20",
    dot: "bg-blue-400",
  },
};

const CHANGE_ORDER: ChangeType[] = [
  "addition",
  "modification",
  "mismatch",
  "emphasis",
  "removal",
];

// ── Formatting Legend Data ─────────────────────────────────────────────────────

const FORMAT_LEGEND = [
  { format: "Bold", pattern: "<b></b>", sample: "B", cls: "font-bold" },
  { format: "Italic", pattern: "<i></i>", sample: "I", cls: "italic" },
  {
    format: "Strikethrough",
    pattern: "<s></s>",
    sample: "S",
    cls: "line-through",
  },
  { format: "Underline", pattern: "<u></u>", sample: "U", cls: "underline" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ── Fuzzy text search helpers ─────────────────────────────────────────────────

/**
 * Find `needle` inside `haystack` with whitespace-normalised comparison.
 * Returns [start, end] indices in the ORIGINAL haystack string.
 * Falls back to [-1, -1] when no acceptable match is found.
 *
 * Strategy:
 *  1. Exact substring match
 *  2. Trimmed match
 *  3. Normalised-whitespace match — walks both strings in parallel to map
 *     the normalised index back to an original character position.
 */
function fuzzyIndexOf(haystack: string, needle: string): [number, number] {
  if (!needle || !haystack) return [-1, -1];

  // 1. Exact match
  let idx = haystack.indexOf(needle);
  if (idx >= 0) return [idx, idx + needle.length];

  // 2. Trimmed match
  const trimmed = needle.trim();
  idx = haystack.indexOf(trimmed);
  if (idx >= 0) return [idx, idx + trimmed.length];

  // 3. Normalised-whitespace match
  const needleNorm = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (!needleNorm) return [-1, -1];

  // Build a parallel array: origIdx[normPos] = original index of that char.
  // Consecutive whitespace collapses to one space.
  const origIdx: number[] = [];
  let n = "";
  let prevWs = true; // leading whitespace collapsed
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) {
      if (!prevWs) {
        origIdx.push(i);
        n += " ";
        prevWs = true;
      }
    } else {
      origIdx.push(i);
      n += ch.toLowerCase();
      prevWs = false;
    }
  }

  const normIdx = n.indexOf(needleNorm);
  if (normIdx < 0) return [-1, -1];

  const start = normIdx < origIdx.length ? origIdx[normIdx] : -1;
  if (start < 0) return [-1, -1];

  // Map the last normalised character of the needle back to the original string.
  // Clamp both index lookups to the length of origIdx to avoid out-of-bounds access.
  const endNormIdx = Math.min(normIdx + needleNorm.length - 1, origIdx.length - 1);
  const end = origIdx[endNormIdx] + 1;

  return [start, Math.min(end, haystack.length)];
}

/**
 * Replace the first occurrence of `search` inside `text` using fuzzy matching.
 * Returns the modified string, or the original when `search` is not found.
 */
function fuzzyReplace(text: string, search: string, replacement: string): string {
  const [start, end] = fuzzyIndexOf(text, search);
  if (start < 0) return text;
  return text.slice(0, start) + replacement + text.slice(end);
}

/** Escape special HTML characters for safe innerHTML rendering. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build an HTML string of the raw XML content with detected change positions
 * wrapped in coloured <mark> elements — used for the "Preview" XML panel.
 */
function buildHighlightedXml(
  xmlContent: string,
  changes: Change[],
  selectedId: string | null,
): string {
  if (!xmlContent) return "";
  if (changes.length === 0) return escapeHtml(xmlContent);

  type Range = { start: number; end: number; type: ChangeType; selected: boolean };
  const ranges: Range[] = [];

  const colorStyle: Record<ChangeType, string> = {
    addition:     "background:rgba(16,185,129,0.25);border-radius:2px;",
    removal:      "background:rgba(239,68,68,0.25);border-radius:2px;text-decoration:line-through;",
    modification: "background:rgba(245,158,11,0.25);border-radius:2px;",
    mismatch:     "background:rgba(139,92,246,0.25);border-radius:2px;",
    emphasis:     "background:rgba(59,130,246,0.25);border-radius:2px;",
  };

  for (const change of changes) {
    if (change.dismissed) continue;
    const searchText = change.old_text || change.new_text || change.text;
    if (!searchText) continue;
    const [start, end] = fuzzyIndexOf(xmlContent, searchText);
    if (start < 0) continue;
    ranges.push({ start, end, type: change.type, selected: change.id === selectedId });
  }

  // Sort by start position; skip overlapping ranges
  ranges.sort((a, b) => a.start - b.start);

  let html = "";
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // skip overlap
    html += escapeHtml(xmlContent.slice(pos, r.start));
    const outline = r.selected ? "outline:2px solid rgba(255,255,255,0.5);" : "";
    html += `<mark style="${colorStyle[r.type]}${outline}">`;
    html += escapeHtml(xmlContent.slice(r.start, r.end));
    html += "</mark>";
    pos = r.end;
  }
  html += escapeHtml(xmlContent.slice(pos));
  return html;
}

// ── iLovePDF-style Large DropZone ──────────────────────────────────────────────

function LargeDropZone({
  label,
  sublabel,
  accept,
  file,
  onFile,
  color,
  icon,
}: {
  label: string;
  sublabel?: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  color: "violet" | "blue" | "emerald";
  icon: "pdf" | "xml";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const colorMap = {
    violet: {
      border: "border-violet-500/40",
      activeBorder: "border-violet-400",
      bg: "bg-violet-500/5",
      hoverBg: "hover:bg-violet-500/8",
      icon: "text-violet-400",
      badge: "bg-violet-500/15 text-violet-300",
      ring: "ring-violet-500/30",
    },
    blue: {
      border: "border-blue-500/40",
      activeBorder: "border-blue-400",
      bg: "bg-blue-500/5",
      hoverBg: "hover:bg-blue-500/8",
      icon: "text-blue-400",
      badge: "bg-blue-500/15 text-blue-300",
      ring: "ring-blue-500/30",
    },
    emerald: {
      border: "border-emerald-500/40",
      activeBorder: "border-emerald-400",
      bg: "bg-emerald-500/5",
      hoverBg: "hover:bg-emerald-500/8",
      icon: "text-emerald-400",
      badge: "bg-emerald-500/15 text-emerald-300",
      ring: "ring-emerald-500/30",
    },
  };
  const c = colorMap[color];

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center min-h-[140px] p-4 select-none group
        ${
          drag
            ? `${c.activeBorder} ${c.bg} ring-2 ${c.ring} scale-[1.01]`
            : `${c.border} ${c.hoverBg} hover:border-opacity-70`
        }`}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />

      {file ? (
        /* File uploaded state */
        <div className="flex flex-col items-center gap-2 w-full">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.bg} ${c.icon} transition-transform group-hover:scale-105`}
          >
            {icon === "pdf" ? (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
            )}
          </div>
          <div className="text-center min-w-0 w-full px-2">
            <p className="text-xs font-semibold text-white truncate">
              {file.name}
            </p>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full mt-1 inline-block ${c.badge}`}
            >
              {fmtBytes(file.size)}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-700/80 hover:bg-red-500/40 flex items-center justify-center transition-colors"
          >
            <svg
              className="w-3 h-3 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${c.bg} ${c.icon} transition-transform group-hover:scale-110 group-hover:rotate-3`}
          >
            {icon === "pdf" ? (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 3v6h6"
                />
              </svg>
            ) : (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 justify-center mb-0.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
                {label}
              </p>
              {sublabel && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700/50">
                  {sublabel}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Drag & drop or click to browse
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Zoom Controls ─────────────────────────────────────────────────────────────

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFitWidth,
  label,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitWidth: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-500 mr-1">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={onZoomOut}
        title="Zoom Out"
        className="w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors text-xs"
      >
        −
      </button>
      <button
        onClick={onZoomIn}
        title="Zoom In"
        className="w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors text-xs"
      >
        +
      </button>
      <button
        onClick={onReset}
        title="Reset Zoom"
        className="h-6 px-1.5 rounded-md bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors text-[9px] font-medium"
      >
        1:1
      </button>
      <button
        onClick={onFitWidth}
        title="Fit to Width"
        className="h-6 px-1.5 rounded-md bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors text-[9px] font-medium"
      >
        ↔
      </button>
    </div>
  );
}

// ── Enhanced PDF Viewer with Zoom ─────────────────────────────────────────────

function PdfViewer({
  file,
  label,
  highlightPage,
  color,
}: {
  file: File | null;
  label: string;
  highlightPage?: number;
  color: "violet" | "blue";
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) {
      // Use a microtask to avoid synchronous setState inside effect body
      const id = setTimeout(() => setUrl(null), 0);
      return () => clearTimeout(id);
    }
    const objectUrl = URL.createObjectURL(file);
    const id = setTimeout(() => setUrl(objectUrl), 0);
    return () => {
      clearTimeout(id);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    if (!url || !highlightPage || !iframeRef.current) return;
    const pageUrl = `${url}#page=${highlightPage}`;
    iframeRef.current.src = pageUrl;
  }, [highlightPage, url]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 3.0));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.4));
  const handleReset = () => setZoom(1.0);
  const handleFitWidth = () => setZoom(1.0);

  const borderColor =
    color === "violet" ? "border-violet-500/30" : "border-blue-500/30";
  const headerColor = color === "violet" ? "text-violet-400" : "text-blue-400";
  const bgColor = color === "violet" ? "bg-violet-500/5" : "bg-blue-500/5";
  const accentColor =
    color === "violet" ? "bg-violet-500/15" : "bg-blue-500/15";

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-xl border border-slate-700/40">
      {/* Panel header */}
      <div
        className={`flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b ${borderColor} ${bgColor} gap-2`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 ${headerColor}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <span
            className={`text-[11px] font-bold uppercase tracking-wider ${headerColor}`}
          >
            {label}
          </span>
          {file && (
            <span className="text-[10px] text-slate-600 font-mono truncate">
              {file.name}
            </span>
          )}
          {highlightPage && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${accentColor} ${headerColor} border ${borderColor}`}
            >
              Pg {highlightPage}
            </span>
          )}
        </div>
        {url && (
          <ZoomControls
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onReset={handleReset}
            onFitWidth={handleFitWidth}
            label={label}
          />
        )}
      </div>

      {/* PDF frame container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-slate-950/50 relative"
      >
        {url ? (
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              width: zoom > 1 ? `${100 / zoom}%` : "100%",
              height: zoom > 1 ? `${100 / zoom}%` : "100%",
              minHeight: zoom > 1 ? `${100 * zoom}%` : "100%",
            }}
          >
            <iframe
              ref={iframeRef}
              src={`${url}#page=${highlightPage ?? 1}&toolbar=1&navpanes=0`}
              className="w-full h-full border-0 min-h-[600px]"
              style={{ minHeight: "600px" }}
              title={label}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-4 p-8">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center ${bgColor} ${headerColor} transition-all`}
            >
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.2}
                  d="M12 3v6h6"
                />
              </svg>
            </div>
            <div>
              <p className={`text-sm font-bold ${headerColor}`}>{label}</p>
              <p className="text-xs text-slate-600 mt-1">
                Upload a PDF to preview
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Formatting Legend ─────────────────────────────────────────────────────────

function FormattingLegend() {
  return (
    <div className="border-t border-slate-800/60 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">
        Formatting Patterns
      </p>
      <div className="space-y-1.5">
        {FORMAT_LEGEND.map(({ format, pattern, sample, cls }) => (
          <div key={format} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-5 h-5 flex items-center justify-center text-[11px] text-slate-300 bg-slate-800 rounded border border-slate-700/50 ${cls}`}
              >
                {sample}
              </span>
              <span className="text-[10px] text-slate-500">{format}</span>
            </div>
            <code className="text-[9px] text-emerald-400/70 bg-slate-800/60 px-1.5 py-0.5 rounded font-mono">
              {pattern}
            </code>
          </div>
        ))}
      </div>

      {/* Change color legend */}
      <div className="mt-2.5 pt-2 border-t border-slate-800/40">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">
          Change Colors
        </p>
        <div className="space-y-1">
          {[
            { color: "bg-emerald-400", label: "Added", desc: "New content" },
            { color: "bg-red-400", label: "Removed", desc: "Deleted content" },
            {
              color: "bg-amber-400",
              label: "Modified",
              desc: "Changed content",
            },
          ].map(({ color, label, desc }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${color}`}
              />
              <span className="text-[10px] text-slate-400 font-medium">
                {label}
              </span>
              <span className="text-[9px] text-slate-600">— {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Change Item ───────────────────────────────────────────────────────────────

function ChangeItem({
  change,
  isSelected,
  canEdit,
  onSelect,
  onApply,
  onDismiss,
}: {
  change: Change;
  isSelected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onApply: (mode: "textual" | "replace" | "emphasis") => void;
  onDismiss: () => void;
}) {
  const m = CM[change.type];
  const isDone = change.applied || change.dismissed;

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border transition-all cursor-pointer group
        ${
          isSelected
            ? `${m.bg} ${m.border} shadow-sm`
            : "border-slate-700/40 hover:border-slate-600/50 bg-slate-900/20 hover:bg-slate-800/20"
        }
        ${isDone ? "opacity-40" : ""}`}
    >
      <div className="px-2.5 py-2">
        <div className="flex items-start gap-2">
          <span
            className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${m.dot} text-white`}
          >
            {m.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${m.text}`}
              >
                {m.label}
              </span>
              <span className="text-[10px] text-slate-600">
                Pg {change.page}
              </span>
            </div>

            <div className="text-[11px] font-mono leading-relaxed">
              {change.type === "modification" &&
              change.old_text &&
              change.new_text ? (
                <>
                  <span className="text-red-400 line-through block truncate opacity-80">
                    {change.old_text.slice(0, 50)}
                    {change.old_text.length > 50 ? "…" : ""}
                  </span>
                  <span className="text-emerald-400 block truncate">
                    {change.new_text.slice(0, 50)}
                    {change.new_text.length > 50 ? "…" : ""}
                  </span>
                </>
              ) : change.type === "removal" ? (
                <span className="text-red-300/70 truncate block">
                  {change.text.slice(0, 70)}
                  {change.text.length > 70 ? "…" : ""}
                </span>
              ) : (
                <span className="text-slate-300 truncate block">
                  {change.text.slice(0, 70)}
                  {change.text.length > 70 ? "…" : ""}
                </span>
              )}
            </div>

            {change.type === "emphasis" && change.new_formatting && (
              <div className="flex items-center gap-1 mt-1">
                {change.new_formatting.bold && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 font-bold border border-slate-700/50">
                    B
                  </span>
                )}
                {change.new_formatting.italic && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 italic border border-slate-700/50">
                    I
                  </span>
                )}
                {change.new_formatting.underline && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 underline border border-slate-700/50">
                    U
                  </span>
                )}
                {change.new_formatting.strikethrough && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 line-through border border-slate-700/50">
                    S
                  </span>
                )}
                {change.new_formatting.is_colored && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    Color
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {isSelected && canEdit && !isDone && (
          <div className="mt-2 pt-2 border-t border-slate-700/40 flex gap-1">
            {change.suggested_xml && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApply(change.type === "emphasis" ? "emphasis" : "textual");
                }}
                className="flex-1 py-1 rounded-md bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[10px] font-semibold transition-all"
              >
                ⚡ Apply
              </button>
            )}
            {!change.suggested_xml &&
              (change.type === "modification" ||
                change.type === "addition" ||
                change.type === "mismatch") && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onApply("textual");
                  }}
                  className="flex-1 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold transition-all"
                >
                  Apply
                </button>
              )}
            {change.type === "emphasis" && !change.suggested_xml && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApply("emphasis");
                }}
                className="flex-1 py-1 rounded-md bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[10px] font-semibold transition-all"
              >
                Apply
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              className="py-1 px-2 rounded-md bg-red-600/15 hover:bg-red-600/25 border border-red-500/25 text-red-400 text-[10px] transition-all"
            >
              ✕
            </button>
          </div>
        )}

        {isDone && (
          <p
            className={`text-[10px] mt-1 ${change.applied ? "text-emerald-600" : "text-red-600"}`}
          >
            {change.applied ? "✓ Applied" : "✗ Rejected"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Validation Modal ──────────────────────────────────────────────────────────

function ValidationModal({
  result,
  onClose,
  onConfirmSave,
}: {
  result: ValidationResult;
  onClose: () => void;
  onConfirmSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            {result.valid ? (
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            )}
            <h2 className="text-sm font-bold text-white">
              {result.valid
                ? "XML Valid — Ready to Save"
                : "XML Validation Failed"}
            </h2>
          </div>
        </div>
        <div className="px-6 py-4 space-y-3">
          {result.errors.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">
                Errors
              </p>
              {result.errors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-1"
                >
                  <span className="text-red-400 mt-0.5">✕</span>
                  {err}
                </div>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-1.5">
                Warnings
              </p>
              {result.warnings.map((warn, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-1"
                >
                  <span className="text-amber-400 mt-0.5">⚠</span>
                  {warn}
                </div>
              ))}
            </div>
          )}
          {result.valid && result.warnings.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-2">
              XML structure is valid and ready to save.
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-800 flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            {result.valid ? "Cancel" : "Fix Errors"}
          </button>
          {result.valid && (
            <button
              onClick={onConfirmSave}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
            >
              Save XML
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── XML Editor ────────────────────────────────────────────────────────────────

function XmlEditor({
  content,
  onChange,
  canEdit,
  highlightText,
  editorRef,
}: {
  content: string;
  onChange?: (v: string) => void;
  canEdit: boolean;
  highlightText?: string | null;
  editorRef: React.RefObject<HTMLTextAreaElement>;
}) {
  useEffect(() => {
    if (!highlightText || !editorRef.current || !content) return;
    const el = editorRef.current;
    const [idx, idxEnd] = fuzzyIndexOf(content, highlightText);
    if (idx < 0) return;
    el.focus();
    el.setSelectionRange(idx, idxEnd);
    const linesBefore = content.substring(0, idx).split("\n").length;
    el.scrollTop = Math.max(0, (linesBefore - 4) * 19);
  }, [highlightText]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!content) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
        <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-400">XML Editor</p>
          <p className="text-xs text-slate-600 mt-1 max-w-xs">
            Upload files and click{" "}
            <span className="text-blue-400">Detect Changes</span> to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <textarea
      ref={editorRef}
      value={content}
      onChange={canEdit ? (e) => onChange?.(e.target.value) : undefined}
      readOnly={!canEdit}
      spellCheck={false}
      className={`flex-1 w-full px-4 py-3 font-mono text-[12px] leading-[1.7] resize-none
        bg-slate-950 border-0 focus:outline-none focus:ring-0
        ${canEdit ? "text-slate-200 cursor-text" : "text-slate-400 cursor-default"}
        selection:bg-amber-400/30 selection:text-white`}
    />
  );
}

// ── Upload Panel (shown before detect) ────────────────────────────────────────

function UploadBanner({
  oldPdf,
  newPdf,
  xmlFile,
  setOldPdf,
  setNewPdf,
  setXmlFile,
}: {
  oldPdf: File | null;
  newPdf: File | null;
  xmlFile: File | null;
  setOldPdf: (f: File | null) => void;
  setNewPdf: (f: File | null) => void;
  setXmlFile: (f: File | null) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 px-4 py-3">
      <LargeDropZone
        label="OLD PDF"
        sublabel="baseline"
        accept=".pdf,application/pdf"
        file={oldPdf}
        onFile={setOldPdf}
        color="violet"
        icon="pdf"
      />
      <LargeDropZone
        label="NEW PDF"
        sublabel="updated"
        accept=".pdf,application/pdf"
        file={newPdf}
        onFile={setNewPdf}
        color="blue"
        icon="pdf"
      />
      <LargeDropZone
        label="XML FILE"
        sublabel="reference"
        accept=".xml,text/xml,application/xml"
        file={xmlFile}
        onFile={setXmlFile}
        color="emerald"
        icon="xml"
      />
    </div>
  );
}

// ── Main ComparePanel ─────────────────────────────────────────────────────────

export default function ComparePanel({
  initialChunk,
  initialSourceName,
  activeJob,
}: ComparePanelProps) {
  const { user } = useAuth();
  const canEdit = user?.role === "SUPER_ADMIN";

  const [oldPdf, setOldPdf] = useState<File | null>(null);
  const [newPdf, setNewPdf] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);

  const [changes, setChanges] = useState<Change[]>([]);
  const [xmlContent, setXmlContent] = useState("");
  const [summary, setSummary] = useState<DetectSummary | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ChangeType | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightPage, setHighlightPage] = useState<number | undefined>(
    undefined,
  );
  const [showLegend, setShowLegend] = useState(false);

  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showValModal, setShowValModal] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const isReady = !!oldPdf && !!newPdf && !!xmlFile;
  const hasResult = changes.length > 0 || xmlContent.length > 0;
  const [uploadCollapsed, setUploadCollapsed] = useState(false);
  const [xmlPreviewMode, setXmlPreviewMode] = useState<"edit" | "preview">("edit");

  // Auto-collapse upload area once all 3 files are ready
  useEffect(() => {
    if (isReady) setUploadCollapsed(true);
  }, [isReady]);

  useEffect(() => {
    if (initialChunk) {
      const xmlC = initialChunk.xml_chunk_file || initialChunk.xml_content;
      if (xmlC) setXmlContent(xmlC);
    }
  }, [initialChunk]);

  const handleDetect = useCallback(async () => {
    if (!isReady) return;
    setLoading(true);
    setError(null);
    setChanges([]);
    setSummary(null);
    setSelectedId(null);
    setValidation(null);
    try {
      const form = new FormData();
      form.append("old_pdf", oldPdf!);
      form.append("new_pdf", newPdf!);
      form.append("xml_file", xmlFile!);
      const res = await fetch(`${PROCESSING_URL}/compare/detect`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        const detail = Array.isArray(e.detail)
          ? e.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ")
          : e.detail;
        throw new Error(detail ?? `HTTP ${res.status}`);
      }
      const data: DetectResponse = await res.json();
      console.log("[ComparePanel] detect response:", {
        changes: data.changes?.length,
        summary: data.summary,
        xml_content_length: data.xml_content?.length,
      });
      setChanges(data.changes);
      setXmlContent(data.xml_content);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setLoading(false);
    }
  }, [isReady, oldPdf, newPdf, xmlFile]);

  const handleSelect = useCallback(
    (change: Change) => {
      setSelectedId(change.id);
      setHighlightPage(change.page);
      const searchText = change.old_text || change.new_text || change.text;
      if (!searchText || !editorRef.current || !xmlContent) return;
      const el = editorRef.current;
      const [idx, idxEnd] = fuzzyIndexOf(xmlContent, searchText);
      if (idx < 0) return;
      el.focus();
      el.setSelectionRange(idx, idxEnd);
      el.scrollTop = Math.max(
        0,
        (xmlContent.substring(0, idx).split("\n").length - 4) * 19,
      );
    },
    [xmlContent],
  );

  const handleApply = useCallback(
    (change: Change, mode: "textual" | "replace" | "emphasis") => {
      if (!canEdit) return;
      let xml = xmlContent;

      if (mode === "emphasis") {
        const t = change.new_text || change.text;
        if (t && change.new_formatting) {
          const { bold, italic, underline, strikethrough, is_colored } = change.new_formatting;
          let repl = t;
          // Apply innermost → outermost (reverse order so outermost wraps everything)
          if (strikethrough) repl = `<s>${repl}</s>`;
          if (underline)     repl = `<u>${repl}</u>`;
          if (italic)        repl = `<i>${repl}</i>`;
          if (bold)          repl = `<b>${repl}</b>`;
          if (is_colored && !bold && !italic && !underline && !strikethrough)
            repl = `<em>${repl}</em>`;
          xml = fuzzyReplace(xml, t, repl);
        }
      } else if (change.suggested_xml) {
        // Use suggested_xml (already contains proper del/ins markup from backend)
        const searchText = change.old_text || change.text;
        if (searchText) xml = fuzzyReplace(xml, searchText, change.suggested_xml);
      } else {
        switch (change.type) {
          case "modification":
          case "mismatch":
            if (change.old_text && change.new_text)
              xml = fuzzyReplace(
                xml,
                change.old_text,
                `<del>${change.old_text}</del><ins>${change.new_text}</ins>`,
              );
            break;
          case "removal":
            if (change.old_text)
              xml = fuzzyReplace(xml, change.old_text, `<del>${change.old_text}</del>`);
            break;
          case "addition":
            if (change.new_text) {
              const insTag = `<ins>${change.new_text}</ins>`;
              if (xml.includes("</")) {
                const pos = xml.lastIndexOf("</");
                xml = `${xml.slice(0, pos)}${insTag}\n${xml.slice(pos)}`;
              } else {
                xml += `\n${insTag}`;
              }
            }
            break;
        }
      }

      setXmlContent(xml);
      setChanges((prev) =>
        prev.map((c) => (c.id === change.id ? { ...c, applied: true } : c)),
      );
    },
    [canEdit, xmlContent],
  );

  /** Apply every pending change at once with proper diff markup */
  const handleApplyAll = useCallback(() => {
    if (!canEdit || !xmlContent) return;
    let xml = xmlContent;
    const appliedIds: string[] = [];

    for (const change of changes) {
      if (change.applied || change.dismissed) continue;

      if (change.type === "emphasis") {
        const t = change.new_text || change.text;
        if (t && change.new_formatting) {
          const { bold, italic, underline, strikethrough, is_colored } = change.new_formatting;
          let repl = t;
          if (strikethrough) repl = `<s>${repl}</s>`;
          if (underline)     repl = `<u>${repl}</u>`;
          if (italic)        repl = `<i>${repl}</i>`;
          if (bold)          repl = `<b>${repl}</b>`;
          if (is_colored && !bold && !italic && !underline && !strikethrough)
            repl = `<em>${repl}</em>`;
          xml = fuzzyReplace(xml, t, repl);
        }
      } else if (change.suggested_xml) {
        const searchText = change.old_text || change.text;
        if (searchText) xml = fuzzyReplace(xml, searchText, change.suggested_xml);
      } else {
        switch (change.type) {
          case "modification":
          case "mismatch":
            if (change.old_text && change.new_text)
              xml = fuzzyReplace(
                xml,
                change.old_text,
                `<del>${change.old_text}</del><ins>${change.new_text}</ins>`,
              );
            break;
          case "removal":
            if (change.old_text)
              xml = fuzzyReplace(xml, change.old_text, `<del>${change.old_text}</del>`);
            break;
          case "addition":
            if (change.new_text) {
              const insTag = `<ins>${change.new_text}</ins>`;
              if (xml.includes("</")) {
                const pos = xml.lastIndexOf("</");
                xml = `${xml.slice(0, pos)}${insTag}\n${xml.slice(pos)}`;
              } else {
                xml += `\n${insTag}`;
              }
            }
            break;
        }
      }
      appliedIds.push(change.id);
    }

    setXmlContent(xml);
    setChanges((prev) =>
      prev.map((c) => (appliedIds.includes(c.id) ? { ...c, applied: true } : c)),
    );
  }, [canEdit, xmlContent, changes]);

  const handleDismiss = useCallback((change: Change) => {
    setChanges((prev) =>
      prev.map((c) => (c.id === change.id ? { ...c, dismissed: true } : c)),
    );
  }, []);

  const handleValidateAndSave = useCallback(async () => {
    if (!xmlContent || !canEdit) return;
    setValidating(true);
    try {
      const res = await fetch(`${PROCESSING_URL}/compare/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml_content: xmlContent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setValidation(data);
      setShowValModal(true);
    } catch {
      const hasXml = xmlContent.includes("<") && xmlContent.includes(">");
      setValidation({
        valid: hasXml,
        errors: hasXml ? [] : ["Content does not appear to be valid XML"],
        warnings: [],
      });
      setShowValModal(true);
    } finally {
      setValidating(false);
    }
  }, [xmlContent, canEdit]);

  function handleConfirmSave() {
    setShowValModal(false);
    const filename = xmlFile?.name ?? initialChunk?.filename ?? "output.xml";
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownload() {
    const filename = xmlFile?.name ?? initialChunk?.filename ?? "output.xml";
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Persist edited XML back to the server via POST /compare/save-xml.
   * Requires an activeJob with job_id and a chunk to identify the record.
   */
  async function handleSaveXml() {
    if (!activeJob?.job_id || !initialChunk) {
      // Fall back to local download if no job context
      handleDownload();
      return;
    }
    try {
      const res = await fetch(`${PROCESSING_URL}/compare/save-xml`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id:      activeJob.job_id,
          chunk_id:    String(initialChunk.index),
          xml_content: xmlContent,
          has_changes: changes.some((c) => !c.dismissed),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        console.error("save-xml failed:", e.detail);
      }
    } catch (err) {
      console.error("save-xml error:", err);
    }
    // Always also download locally so user has a copy
    handleDownload();
  }

  const selectedChange = changes.find((c) => c.id === selectedId) ?? null;
  const filtered =
    filterType === "all"
      ? changes
      : changes.filter((c) => c.type === filterType);
  const highlightText = selectedChange
    ? selectedChange.old_text || selectedChange.new_text || selectedChange.text
    : null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950">
      {/* ── Top toolbar ────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900/40">
        {/* Upload row — collapsible */}
        {!uploadCollapsed ? (
          <UploadBanner
            oldPdf={oldPdf}
            newPdf={newPdf}
            xmlFile={xmlFile}
            setOldPdf={(f) => {
              setOldPdf(f);
              setUploadCollapsed(false);
            }}
            setNewPdf={(f) => {
              setNewPdf(f);
              setUploadCollapsed(false);
            }}
            setXmlFile={(f) => {
              setXmlFile(f);
              setUploadCollapsed(false);
            }}
          />
        ) : (
          /* Collapsed: compact file summary strip */
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
            {(
              [
                {
                  file: oldPdf,
                  label: "OLD",
                  color:
                    "text-violet-400 bg-violet-500/10 border-violet-500/30",
                },
                {
                  file: newPdf,
                  label: "NEW",
                  color: "text-blue-400 bg-blue-500/10 border-blue-500/30",
                },
                {
                  file: xmlFile,
                  label: "XML",
                  color:
                    "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
                },
              ] as { file: File | null; label: string; color: string }[]
            ).map(({ file, label, color }) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${color}`}
              >
                <span className="opacity-60 text-[10px] uppercase tracking-wider">
                  {label}
                </span>
                <span className="text-white/80 truncate max-w-[130px]">
                  {file?.name ?? "—"}
                </span>
                {file && (
                  <span className="opacity-50 text-[10px]">
                    {fmtBytes(file.size)}
                  </span>
                )}
              </div>
            ))}
            <button
              onClick={() => {
                setUploadCollapsed(false);
                setOldPdf(null);
                setNewPdf(null);
                setXmlFile(null);
              }}
              className="ml-auto text-[10px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors border border-slate-700/50"
            >
              ✎ Change files
            </button>
          </div>
        )}

        {/* Action toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-800/60 flex-wrap">
          {/* Chunk info badge */}
          {initialChunk && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300 font-mono">
              ⚡ {initialChunk.filename}
            </span>
          )}

          {/* Detect Changes — compact */}
          <button
            onClick={handleDetect}
            disabled={!isReady || loading}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${
                isReady && !loading
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"
              }`}
          >
            {loading ? (
              <>
                <svg
                  className="w-3.5 h-3.5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Detecting…
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                Detect Changes
              </>
            )}
          </button>

          {/* Summary pills */}
          {summary && (
            <div className="flex items-center gap-1 flex-wrap">
              {CHANGE_ORDER.map((key) =>
                summary[key] > 0 ? (
                  <button
                    key={key}
                    onClick={() =>
                      setFilterType(filterType === key ? "all" : key)
                    }
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-all
                    ${filterType === key ? `${CM[key].bg} ${CM[key].text} ${CM[key].border}` : `${CM[key].pill} opacity-70 hover:opacity-100`}`}
                  >
                    {CM[key].icon} {summary[key]}
                  </button>
                ) : null,
              )}
            </div>
          )}

          {/* Highlight All — shown once changes exist and not all applied */}
          {canEdit && changes.length > 0 && changes.some((c) => !c.applied && !c.dismissed) && (
            <button
              onClick={handleApplyAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-colors"
              title="Apply all pending changes with bold/italic/del/ins markup"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 13l4 4L19 7" />
              </svg>
              Highlight All ({changes.filter((c) => !c.applied && !c.dismissed).length})
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Legend toggle */}
            <button
              onClick={() => setShowLegend((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${showLegend ? "bg-slate-700 text-white" : "bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"}`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
              Legend
            </button>

            {canEdit && xmlContent && (
              <button
                onClick={handleValidateAndSave}
                disabled={validating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {validating ? "Validating…" : "Save XML"}
              </button>
            )}

            {/* Download — also saves to server via /save-xml when activeJob is set */}
            {xmlContent && (
              <button
                onClick={handleSaveXml}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
          <svg
            className="w-4 h-4 text-red-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-xs text-red-300">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-300 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 4-panel Main Layout ────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Panel 1: Change List + Formatting Legend */}
        <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-slate-800 bg-slate-900/20 overflow-hidden">
          {/* Filter row */}
          <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-slate-800/60">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Changes{" "}
                {changes.length > 0 && (
                  <span className="text-slate-700 font-normal normal-case tracking-normal">
                    ({changes.filter((c) => !c.dismissed).length})
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setFilterType("all")}
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all
                  ${filterType === "all" ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-300"}`}
              >
                All
              </button>
              {CHANGE_ORDER.map((key) =>
                summary?.[key] ? (
                  <button
                    key={key}
                    onClick={() =>
                      setFilterType(filterType === key ? "all" : key)
                    }
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-all
                    ${
                      filterType === key
                        ? `${CM[key].bg} ${CM[key].text} ${CM[key].border}`
                        : "bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-slate-300"
                    }`}
                  >
                    {CM[key].icon} {summary[key]}
                  </button>
                ) : null,
              )}
            </div>
          </div>

          {/* Change items — scrollable */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
            {filtered.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                {changes.length === 0 ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-slate-800/60 flex items-center justify-center mb-2">
                      <svg
                        className="w-5 h-5 text-slate-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </div>
                    <p className="text-xs text-slate-600">No changes yet</p>
                    <p className="text-[10px] text-slate-700 mt-1">
                      Upload files and click Detect
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-600">
                    No {filterType} changes
                  </p>
                )}
              </div>
            )}
            {filtered.map((change) => (
              <ChangeItem
                key={change.id}
                change={change}
                isSelected={selectedId === change.id}
                canEdit={canEdit}
                onSelect={() => handleSelect(change)}
                onApply={(mode) => handleApply(change, mode)}
                onDismiss={() => handleDismiss(change)}
              />
            ))}
          </div>

          {/* Formatting legend (collapsible) */}
          {showLegend && <FormattingLegend />}
        </div>

        {/* Panel 2: Old PDF — larger viewer */}
        <div className="flex-1 min-w-0 border-r border-slate-800 p-1.5">
          <PdfViewer
            file={oldPdf}
            label="OLD PDF"
            highlightPage={highlightPage}
            color="violet"
          />
        </div>

        {/* Panel 3: New PDF — larger viewer */}
        <div className="flex-1 min-w-0 border-r border-slate-800 p-1.5">
          <PdfViewer
            file={newPdf}
            label="NEW PDF"
            highlightPage={highlightPage}
            color="blue"
          />
        </div>

        {/* Panel 4: XML Editor */}
        <div className="w-[360px] flex-shrink-0 flex flex-col min-w-0 bg-slate-950">
          {/* Editor header */}
          <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/30">
            <div className="flex items-center gap-2 min-w-0">
              <svg
                className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              <span className="text-xs font-semibold text-slate-300 truncate">
                XML Editor
                {(xmlFile?.name || initialChunk?.filename) && (
                  <span className="text-slate-500 font-normal ml-1 hidden xl:inline">
                    — {xmlFile?.name ?? initialChunk?.filename}
                  </span>
                )}
              </span>
              {canEdit ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0">
                  Editable
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 flex-shrink-0">
                  Read-only
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Edit / Preview mode toggle */}
              {xmlContent && (
                <div className="flex rounded-md overflow-hidden border border-slate-700/50 text-[10px]">
                  <button
                    onClick={() => setXmlPreviewMode("edit")}
                    className={`px-2 py-0.5 font-semibold transition-colors ${
                      xmlPreviewMode === "edit"
                        ? "bg-slate-700 text-white"
                        : "bg-slate-900 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setXmlPreviewMode("preview")}
                    className={`px-2 py-0.5 font-semibold transition-colors ${
                      xmlPreviewMode === "preview"
                        ? "bg-slate-700 text-white"
                        : "bg-slate-900 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    Preview
                  </button>
                </div>
              )}
              {selectedChange && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${CM[selectedChange.type].pill}`}
                >
                  {CM[selectedChange.type].label}
                </span>
              )}
            </div>
          </div>

          {/* Line count hint */}
          {xmlContent && (
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-b border-slate-800/40 bg-slate-900/20">
              <span className="text-[10px] text-slate-600">
                {xmlContent.split("\n").length} lines ·{" "}
                {xmlContent.length.toLocaleString()} chars
              </span>
              {changes.filter((c) => c.applied).length > 0 && (
                <span className="text-[10px] text-emerald-600">
                  {changes.filter((c) => c.applied).length} applied
                </span>
              )}
            </div>
          )}

          {xmlPreviewMode === "preview" && xmlContent ? (
            /* ── Highlighted preview: colour-coded change positions ── */
            <div className="flex-1 overflow-auto p-0">
              <pre
                className="font-mono text-[12px] leading-[1.7] text-slate-300 px-4 py-3 whitespace-pre-wrap break-words min-h-full"
                dangerouslySetInnerHTML={{
                  __html: buildHighlightedXml(xmlContent, changes, selectedId),
                }}
              />
            </div>
          ) : (
            <XmlEditor
              content={xmlContent}
              onChange={setXmlContent}
              canEdit={canEdit}
              highlightText={highlightText}
              editorRef={editorRef}
            />
          )}
        </div>
      </div>

      {/* Validation Modal */}
      {showValModal && validation && (
        <ValidationModal
          result={validation}
          onClose={() => setShowValModal(false)}
          onConfirmSave={handleConfirmSave}
        />
      )}
    </div>
  );
}