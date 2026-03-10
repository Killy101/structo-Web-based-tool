"use client";
/**
 * ChunkPanel — LangChain PDF + XML Chunker
 *
 * Upload flow:
 *   OLD PDF  →  PyMuPDF extracts text  →  LangChain RecursiveCharacterTextSplitter
 *   NEW PDF  →  same
 *   XML File →  xml_compare.chunk_xml  (tag-based)
 *
 * Backend aligns PDF chunks ↔ XML chunks by index and detects per-chunk
 * changes (NEW vs OLD).  The modal shows results and stores into:
 *
 *   NameSource/
 *     OLD/    – old PDF reference
 *     NEW/    – new PDF reference
 *     XML/    – unchanged XML chunks
 *     edited/ – changed XML chunks
 */

import React, { useState, useRef, useCallback } from "react";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfChunk {
  index: number;
  label: string;
  old_text: string;
  new_text: string;
  has_changes: boolean;
  xml_content: string;
  xml_tag: string;
  xml_attributes: Record<string, string>;
  xml_size: number;
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
}

interface StorageFile {
  name: string;
  size: number;
  content: string;
}
interface StorageFolder {
  name: string;
  files: StorageFile[];
}
interface NameSource {
  sourceName: string;
  createdAt: string;
  OLD: StorageFolder;
  NEW: StorageFolder;
  XML: StorageFolder;
  edited: StorageFolder;
}

type ModalStep = "detecting" | "results" | "storing" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ── DropZone ──────────────────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  sublabel?: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  color: "violet" | "blue" | "emerald";
  icon: "pdf" | "xml";
}

const DZ = {
  violet: {
    border: "border-violet-500/40",
    bg: "bg-violet-500/8",
    badge: "bg-violet-500/20 text-violet-300",
    icon: "text-violet-400",
    hover: "hover:border-violet-500/50 hover:bg-violet-500/5",
  },
  blue: {
    border: "border-blue-500/40",
    bg: "bg-blue-500/8",
    badge: "bg-blue-500/20 text-blue-300",
    icon: "text-blue-400",
    hover: "hover:border-blue-500/50 hover:bg-blue-500/5",
  },
  emerald: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/8",
    badge: "bg-emerald-500/20 text-emerald-300",
    icon: "text-emerald-400",
    hover: "hover:border-emerald-500/50 hover:bg-emerald-500/5",
  },
};

function DropZone({
  label,
  sublabel,
  accept,
  file,
  onFile,
  color,
  icon,
}: DropZoneProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const c = DZ[color];

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 p-4
        ${drag ? `${c.border} ${c.bg} scale-[1.01]` : `border-slate-700/50 ${c.hover}`}`}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.bg} ${c.icon}`}
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 13h.01M12 13h.01M15 13h.01"
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
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {label}
            </p>
            {sublabel && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500">
                {sublabel}
              </span>
            )}
          </div>
          {file ? (
            <p className="text-sm font-medium text-white truncate">
              {file.name}
              <span
                className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${c.badge}`}
              >
                {fmtBytes(file.size)}
              </span>
            </p>
          ) : (
            <p className="text-xs text-slate-500">Drop or click to browse</p>
          )}
        </div>
        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700/80 hover:bg-red-500/30 flex items-center justify-center transition-colors"
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
        )}
      </div>
    </div>
  );
}

// ── Detection Modal ───────────────────────────────────────────────────────────

interface ChunkModalProps {
  sourceName: string;
  data: ChunkResponse;
  oldFile: File;
  newFile: File;
  onClose: () => void;
  onConfirmStore: (data: ChunkResponse, old: File, nw: File) => void;
}

function ChunkModal({
  sourceName,
  data,
  oldFile,
  newFile,
  onClose,
  onConfirmStore,
}: ChunkModalProps) {
  const [step, setStep] = useState<ModalStep>("detecting");
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { pdf_chunks, summary } = data;

  React.useEffect(() => {
    if (step !== "detecting") return;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setProgress(Math.round((i / pdf_chunks.length) * 100));
      if (i >= pdf_chunks.length) {
        clearInterval(iv);
        setTimeout(() => setStep("results"), 300);
      }
    }, 50);
    return () => clearInterval(iv);
  }, [step, pdf_chunks.length]);

  function handleStore() {
    setStep("storing");
    setTimeout(() => {
      onConfirmStore(data, oldFile, newFile);
      setStep("done");
    }, 1000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={step === "done" ? onClose : undefined}
      />
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/80 bg-[#0c1220] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-violet-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                LangChain Chunk Detection
              </h3>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                {sourceName}
              </p>
            </div>
          </div>
          {step === "done" && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full hover:bg-slate-700 flex items-center justify-center transition-colors"
            >
              <svg
                className="w-4 h-4 text-slate-400"
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
          )}
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Detecting */}
          {step === "detecting" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 text-sm text-slate-300">
                <svg
                  className="w-4 h-4 text-violet-400 animate-spin"
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
                Scanning {pdf_chunks.length} chunks for changes…
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all duration-75"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-600">
                <span className="font-mono">
                  PyMuPDF → RecursiveCharacterTextSplitter → xml_compare
                </span>
                <span>{progress}%</span>
              </div>
            </div>
          )}

          {/* Results */}
          {(step === "results" || step === "storing") && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  {
                    label: "Total",
                    val: summary.total,
                    cls: "bg-slate-800/80 text-slate-200",
                  },
                  {
                    label: "Unchanged",
                    val: summary.unchanged,
                    cls: "bg-emerald-500/12 text-emerald-300",
                  },
                  {
                    label: "Changed",
                    val: summary.changed,
                    cls: "bg-amber-500/12 text-amber-300",
                  },
                  {
                    label: "XML Chunks",
                    val: data.xml_chunk_count,
                    cls: "bg-blue-500/12 text-blue-300",
                  },
                ].map(({ label, val, cls }) => (
                  <div
                    key={label}
                    className={`rounded-xl p-3 text-center ${cls}`}
                  >
                    <p className="text-xl font-bold tabular-nums">{val}</p>
                    <p className="text-[10px] uppercase tracking-wider opacity-60 mt-0.5 leading-tight">
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              {/* Pipeline badge */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 text-[10px] text-slate-500 overflow-x-auto">
                {[
                  "PyMuPDF (fitz)",
                  "→",
                  "RecursiveCharacterTextSplitter",
                  "→",
                  "xml_compare.chunk_xml",
                  "→",
                  "change detection",
                ].map((t, i) => (
                  <span
                    key={i}
                    className={
                      t === "→"
                        ? "text-slate-700"
                        : t.startsWith("Py") ||
                            t.startsWith("Re") ||
                            t.startsWith("xml")
                          ? "text-violet-400 font-mono"
                          : "text-slate-400"
                    }
                  >
                    {t}
                  </span>
                ))}
              </div>

              {/* Chunk list */}
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {pdf_chunks.map((chunk) => {
                  const isExp = expanded === chunk.index;
                  return (
                    <div
                      key={chunk.label}
                      className={`rounded-lg border transition-all
                        ${chunk.has_changes ? "bg-amber-500/8 border-amber-500/20" : "bg-emerald-500/6 border-emerald-500/15"}`}
                    >
                      <button
                        onClick={() => setExpanded(isExp ? null : chunk.index)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${chunk.has_changes ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}
                          />
                          <span className="font-mono text-xs font-semibold text-slate-300">
                            {chunk.label}
                          </span>
                          {chunk.xml_tag && (
                            <span className="text-[10px] text-slate-600 font-mono">
                              &lt;{chunk.xml_tag}&gt;
                            </span>
                          )}
                          {chunk.xml_size > 0 && (
                            <span className="text-[10px] text-slate-700">
                              {fmtBytes(chunk.xml_size)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {chunk.has_changes ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                              CHANGED → /edited
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                              CLEAN → /XML
                            </span>
                          )}
                          <svg
                            className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isExp ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </button>
                      {isExp && (
                        <div className="grid grid-cols-2 divide-x divide-slate-700/60 border-t border-slate-700/40 text-[10px] font-mono">
                          <div className="p-3">
                            <p className="text-[9px] uppercase tracking-wider text-red-400 mb-1.5 font-sans font-semibold">
                              OLD PDF text
                            </p>
                            <p className="text-red-300/70 whitespace-pre-wrap leading-relaxed line-clamp-6">
                              {chunk.old_text || "—"}
                            </p>
                          </div>
                          <div className="p-3">
                            <p className="text-[9px] uppercase tracking-wider text-emerald-400 mb-1.5 font-sans font-semibold">
                              NEW PDF text
                            </p>
                            <p className="text-emerald-300/70 whitespace-pre-wrap leading-relaxed line-clamp-6">
                              {chunk.new_text || "—"}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Folder preview */}
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3.5 text-xs font-mono space-y-1">
                <p className="text-slate-400 mb-2 font-sans text-[11px] font-semibold uppercase tracking-wider">
                  Storage Preview
                </p>
                <p className="text-slate-500">📁 {sourceName}/</p>
                <p className="text-violet-400/80 pl-4">
                  📄 OLD/ ← {data.old_filename}
                </p>
                <p className="text-blue-400/80 pl-4">
                  📄 NEW/ ← {data.new_filename}
                </p>
                <p className="text-emerald-400/80 pl-4">
                  📁 XML/ ← {summary.unchanged} unchanged chunk
                  {summary.unchanged !== 1 ? "s" : ""}
                </p>
                {summary.changed > 0 && (
                  <p className="text-amber-400/80 pl-4">
                    📁 edited/ ← {summary.changed} changed chunk
                    {summary.changed !== 1 ? "s" : ""}
                  </p>
                )}
              </div>

              <button
                disabled={step === "storing"}
                onClick={handleStore}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white text-sm font-semibold transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {step === "storing" ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
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
                    Storing…
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                      />
                    </svg>
                    Store to Local Storage
                  </>
                )}
              </button>
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-4 gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-emerald-400"
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
                <div className="text-center">
                  <p className="text-base font-semibold text-white">
                    Stored Successfully!
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {summary.unchanged} clean →{" "}
                    <span className="text-emerald-400">/XML</span>
                    {summary.changed > 0 && (
                      <>
                        {" "}
                        · {summary.changed} changed →{" "}
                        <span className="text-amber-400">/edited</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3.5 text-xs font-mono space-y-1">
                <p className="text-violet-300">
                  ✓ {sourceName}/OLD/ — {data.old_filename}
                </p>
                <p className="text-blue-300">
                  ✓ {sourceName}/NEW/ — {data.new_filename}
                </p>
                <p className="text-emerald-300">
                  ✓ {sourceName}/XML/ — {summary.unchanged} chunks
                </p>
                {summary.changed > 0 && (
                  <p className="text-amber-300">
                    ✓ {sourceName}/edited/ — {summary.changed} chunks
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Storage Browser ───────────────────────────────────────────────────────────

function StorageBrowser({ sources }: { sources: NameSource[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  if (sources.length === 0) return null;

  const totalChunks = sources.reduce(
    (a, s) => a + s.XML.files.length + s.edited.files.length,
    0,
  );
  const folderMeta = {
    OLD: {
      emoji: "📄",
      color: "border-violet-700/40 bg-violet-500/5 text-violet-300",
    },
    NEW: {
      emoji: "📄",
      color: "border-blue-700/40 bg-blue-500/5 text-blue-300",
    },
    XML: {
      emoji: "📁",
      color: "border-emerald-700/40 bg-emerald-500/5 text-emerald-300",
    },
    edited: {
      emoji: "✏️",
      color: "border-amber-700/40 bg-amber-500/5 text-amber-300",
    },
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-4 h-4 text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="text-xs font-semibold text-slate-400">Local Storage</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">
          {sources.length} source{sources.length > 1 ? "s" : ""} · {totalChunks}{" "}
          chunks
        </span>
      </div>
      <div className="space-y-2">
        {sources.map((src) => {
          const isOpen = expanded === src.sourceName;
          const fm = {
            OLD: src.OLD,
            NEW: src.NEW,
            XML: src.XML,
            edited: src.edited,
          };
          return (
            <div
              key={src.sourceName}
              className="rounded-xl border border-slate-700/50 bg-slate-900/40 overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : src.sourceName)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-4 h-4 text-amber-400/60"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span className="text-sm font-medium text-slate-200">
                    {src.sourceName}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {src.createdAt}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-slate-600 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-800 space-y-2">
                  <div className="grid grid-cols-4 gap-2 pt-3">
                    {(["OLD", "NEW", "XML", "edited"] as const).map(
                      (folder) => {
                        const f = fm[folder];
                        const m = folderMeta[folder];
                        const isEmpty = f.files.length === 0;
                        const isSel =
                          openFolder === `${src.sourceName}/${folder}`;
                        return (
                          <button
                            key={folder}
                            disabled={isEmpty}
                            onClick={() =>
                              setOpenFolder(
                                isSel ? null : `${src.sourceName}/${folder}`,
                              )
                            }
                            className={`rounded-lg p-2.5 text-center text-xs font-medium transition-all border
                            ${
                              isEmpty
                                ? "border-slate-800 bg-slate-900/30 text-slate-700 cursor-not-allowed"
                                : `${m.color} ${isSel ? "ring-1 ring-current opacity-100" : "opacity-75 hover:opacity-100"}`
                            }`}
                          >
                            <div className="text-sm mb-0.5">{m.emoji}</div>
                            <div className="font-semibold">{folder}</div>
                            <div className="text-[10px] opacity-60 mt-0.5">
                              {f.files.length} file
                              {f.files.length !== 1 ? "s" : ""}
                            </div>
                          </button>
                        );
                      },
                    )}
                  </div>
                  {openFolder?.startsWith(src.sourceName) &&
                    (() => {
                      const fn = openFolder.split("/")[1] as
                        | "OLD"
                        | "NEW"
                        | "XML"
                        | "edited";
                      const fld = fm[fn];
                      return fld.files.length > 0 ? (
                        <div className="rounded-lg border border-slate-700/40 bg-slate-950/40 divide-y divide-slate-800">
                          {fld.files.map((file) => (
                            <div
                              key={file.name}
                              className="flex items-center justify-between px-3 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <svg
                                  className="w-3.5 h-3.5 text-slate-600"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                                <span className="text-xs font-mono text-slate-400">
                                  {file.name}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-600">
                                {fmtBytes(file.size)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ChunkPanel ───────────────────────────────────────────────────────────

export default function ChunkPanel() {
  const [oldPdf, setOldPdf] = useState<File | null>(null);
  const [newPdf, setNewPdf] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);

  const [sourceName, setSourceName] = useState("");
  const [tagName, setTagName] = useState("");
  const [attribute, setAttribute] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [maxSize, setMaxSize] = useState("");
  const [chunkSize, setChunkSize] = useState("1500");
  const [overlap, setOverlap] = useState("150");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [chunkData, setChunkData] = useState<ChunkResponse | null>(null);
  const [storedSources, setStoredSources] = useState<NameSource[]>([]);

  const isReady =
    !!oldPdf &&
    !!newPdf &&
    !!xmlFile &&
    !!tagName.trim() &&
    !!sourceName.trim();

  async function handleChunk() {
    if (!isReady) return;
    setError(null);
    setIsLoading(true);
    try {
      const form = new FormData();
      form.append("old_pdf", oldPdf!);
      form.append("new_pdf", newPdf!);
      form.append("xml_file", xmlFile!);
      form.append("tag_name", tagName.trim());
      form.append("source_name", sourceName.trim());
      if (attribute.trim()) form.append("attribute", attribute.trim());
      if (attrValue.trim()) form.append("value", attrValue.trim());
      if (maxSize.trim()) form.append("max_file_size", maxSize.trim());
      form.append("chunk_size", chunkSize || "1500");
      form.append("chunk_overlap", overlap || "150");

      const res = await fetch(`${PROCESSING_URL}/compare/chunk/pdf`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const d: ChunkResponse = await res.json();
      setChunkData(d);
      setShowModal(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chunking failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleConfirmStore(
    data: ChunkResponse,
    oldFile: File,
    newFile: File,
  ) {
    const name = sourceName.trim() || "NameSource";
    const clean = data.pdf_chunks.filter((c) => !c.has_changes);
    const changed = data.pdf_chunks.filter((c) => c.has_changes);

    const src: NameSource = {
      sourceName: name,
      createdAt: new Date().toLocaleString(),
      OLD: {
        name: "OLD",
        files: [{ name: oldFile.name, size: oldFile.size, content: "" }],
      },
      NEW: {
        name: "NEW",
        files: [{ name: newFile.name, size: newFile.size, content: "" }],
      },
      XML: {
        name: "XML",
        files: clean.map((c) => ({
          name: `${c.label}.xml`,
          size: c.xml_size || c.new_text.length,
          content: c.xml_content,
        })),
      },
      edited: {
        name: "edited",
        files: changed.map((c) => ({
          name: `${c.label}.xml`,
          size: c.xml_size || c.new_text.length,
          content: c.xml_content,
        })),
      },
    };

    setStoredSources((prev) => {
      const idx = prev.findIndex((s) => s.sourceName === name);
      if (idx >= 0) {
        const n = [...prev];
        n[idx] = src;
        return n;
      }
      return [...prev, src];
    });
  }

  const checks = [
    { ok: !!sourceName, label: "Source name" },
    { ok: !!oldPdf, label: "OLD PDF (baseline)" },
    { ok: !!newPdf, label: "NEW PDF (updated)" },
    { ok: !!xmlFile, label: "XML file to chunk" },
    { ok: !!tagName, label: "XML tag name" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-5 py-2">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              PDF + XML Chunker
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              LangChain · PyMuPDF · RecursiveCharacterTextSplitter
            </p>
          </div>
          {storedSources.length > 0 && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
              {storedSources.reduce(
                (a, s) => a + s.XML.files.length + s.edited.files.length,
                0,
              )}{" "}
              chunks stored
            </span>
          )}
        </div>

        {/* Source Name */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Source Name <span className="text-red-400">*</span>
          </label>
          <input
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="e.g. BRD_Project_Alpha"
            className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3.5 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
          />
          <p className="text-[11px] text-slate-600">
            All chunks stored under this name
          </p>
        </div>

        {/* Files */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
            Files
          </label>
          <DropZone
            label="OLD PDF"
            sublabel="baseline"
            accept=".pdf"
            file={oldPdf}
            onFile={setOldPdf}
            color="violet"
            icon="pdf"
          />
          <DropZone
            label="NEW PDF"
            sublabel="updated source"
            accept=".pdf"
            file={newPdf}
            onFile={setNewPdf}
            color="blue"
            icon="pdf"
          />
          <DropZone
            label="XML File"
            sublabel="to chunk"
            accept=".xml"
            file={xmlFile}
            onFile={setXmlFile}
            color="emerald"
            icon="xml"
          />
        </div>

        {/* Chunk settings */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">
            XML Chunking Settings
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">
                Tag Name <span className="text-red-400">*</span>
              </label>
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="e.g. section, chapter"
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">
                Max XML Chunk Size (bytes)
              </label>
              <input
                value={maxSize}
                onChange={(e) => setMaxSize(e.target.value)}
                placeholder="e.g. 51200"
                type="number"
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">
                Attribute Filter
              </label>
              <input
                value={attribute}
                onChange={(e) => setAttribute(e.target.value)}
                placeholder="e.g. type, id"
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">
                Attribute Value
              </label>
              <input
                value={attrValue}
                onChange={(e) => setAttrValue(e.target.value)}
                placeholder="e.g. chapter"
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
          </div>

          {/* LangChain settings */}
          <div className="border-t border-slate-800 pt-3">
            <div className="flex items-center gap-2 mb-2.5">
              <svg
                className="w-3.5 h-3.5 text-violet-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                LangChain PDF Split Settings
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">
                  Chunk Size (chars)
                </label>
                <input
                  value={chunkSize}
                  onChange={(e) => setChunkSize(e.target.value)}
                  placeholder="1500"
                  type="number"
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">
                  Chunk Overlap (chars)
                </label>
                <input
                  value={overlap}
                  onChange={(e) => setOverlap(e.target.value)}
                  placeholder="150"
                  type="number"
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <svg
              className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0"
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
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleChunk}
          disabled={!isReady || isLoading}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2
            ${
              isReady && !isLoading
                ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/20"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"
            }`}
        >
          {isLoading ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
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
              Processing with LangChain…
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Run LangChain Chunk
            </>
          )}
        </button>

        {/* Checklist when not ready */}
        {!isReady && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">
              Required to proceed
            </p>
            {checks.map(({ ok, label }) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-slate-700"}`}
                />
                <span
                  className={`text-xs ${ok ? "text-slate-400" : "text-slate-600"}`}
                >
                  {label}
                </span>
                {ok && (
                  <svg
                    className="w-3 h-3 text-emerald-500 ml-auto"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        )}

        <StorageBrowser sources={storedSources} />
      </div>

      {showModal && chunkData && (
        <ChunkModal
          sourceName={sourceName.trim() || "NameSource"}
          data={chunkData}
          oldFile={oldPdf!}
          newFile={newPdf!}
          onClose={() => setShowModal(false)}
          onConfirmStore={(data, old, nw) => {
            handleConfirmStore(data, old, nw);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
