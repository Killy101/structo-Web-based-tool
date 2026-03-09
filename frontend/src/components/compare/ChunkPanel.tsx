"use client";
/**
 * ChunkPanel — Enhanced with:
 *  • Polished UI (dark-mode, glass cards, animated badges)
 *  • Post-chunk modal that shows per-chunk change detection
 *  • "Local-storage" folder simulation: NameSource / OLD | NEW | XML | edited
 *  • Auto-stores unchanged chunks; routes changed chunks to /edited
 */

import React, { useState, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChunkItem {
  index: number; // 1-based
  label: string; // "chunk01", "chunk02", …
  tag: string;
  attributes: Record<string, string>;
  content: string;
  size: number;
  hasChanges: boolean; // detected vs OLD xml
}

interface StorageFolder {
  name: string;
  files: { name: string; content: string; size: number }[];
}

interface NameSource {
  sourceName: string;
  OLD: StorageFolder;
  NEW: StorageFolder;
  XML: StorageFolder;
  edited: StorageFolder;
  createdAt: string;
}

type ModalStep = "detecting" | "results" | "storing" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// Simulate change detection by comparing chunk content with OLD xml chunks
function detectChanges(
  newChunks: {
    tag: string;
    attributes: Record<string, string>;
    content: string;
    size: number;
  }[],
  oldXml: string | null,
): ChunkItem[] {
  return newChunks.map((chunk, i) => {
    let hasChanges = false;
    if (oldXml) {
      // Simple heuristic: check if this chunk's content appears verbatim in old XML
      const normalized = chunk.content.replace(/\s+/g, " ").trim();
      const oldNormalized = oldXml.replace(/\s+/g, " ");
      hasChanges = !oldNormalized.includes(normalized);
    }
    return {
      index: i + 1,
      label: `chunk${pad(i + 1)}`,
      ...chunk,
      hasChanges,
    };
  });
}

// ── File Drop Zone ─────────────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  accept?: string;
  file: File | null;
  onFile: (f: File | null) => void;
  color: "blue" | "violet" | "emerald";
}

const COLOR_MAP = {
  blue: {
    border: "border-blue-500/40",
    bg: "bg-blue-500/5",
    badge: "bg-blue-500/20 text-blue-300",
    icon: "text-blue-400",
  },
  violet: {
    border: "border-violet-500/40",
    bg: "bg-violet-500/5",
    badge: "bg-violet-500/20 text-violet-300",
    icon: "text-violet-400",
  },
  emerald: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
    badge: "bg-emerald-500/20 text-emerald-300",
    icon: "text-emerald-400",
  },
};

function DropZone({ label, accept, file, onFile, color }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const c = COLOR_MAP[color];

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`
        relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 p-5
        ${dragging ? `${c.border} ${c.bg} scale-[1.01]` : `border-slate-700/60 hover:${c.border} hover:${c.bg}`}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <div className="flex items-center gap-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${c.bg} ${c.icon}`}
        >
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
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-0.5">
            {label}
          </p>
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
            <p className="text-sm text-slate-500">
              Drop file or click to browse
            </p>
          )}
        </div>
        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            className="ml-auto flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 hover:bg-red-500/30 flex items-center justify-center transition-colors"
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

// ── Chunk Detection Modal ─────────────────────────────────────────────────────

interface ChunkModalProps {
  sourceName: string;
  chunks: ChunkItem[];
  onClose: () => void;
  onConfirmStore: (chunks: ChunkItem[]) => void;
}

function ChunkModal({
  sourceName,
  chunks,
  onClose,
  onConfirmStore,
}: ChunkModalProps) {
  const [step, setStep] = useState<ModalStep>("detecting");
  const [progress, setProgress] = useState(0);
  const [storedResult, setStoredResult] = useState<{
    clean: number;
    edited: number;
  } | null>(null);

  const changedCount = chunks.filter((c) => c.hasChanges).length;
  const unchangedCount = chunks.length - changedCount;

  // Simulate detection animation
  React.useEffect(() => {
    if (step !== "detecting") return;
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setProgress(Math.round((i / chunks.length) * 100));
      if (i >= chunks.length) {
        clearInterval(interval);
        setTimeout(() => setStep("results"), 300);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [step, chunks.length]);

  function handleStore() {
    setStep("storing");
    setTimeout(() => {
      onConfirmStore(chunks);
      setStoredResult({ clean: unchangedCount, edited: changedCount });
      setStep("done");
    }, 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={step === "done" ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0f1623] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-blue-400"
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
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                Chunk Detection
              </h3>
              <p className="text-[11px] text-slate-500 font-mono">
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

        {/* Body */}
        <div className="px-6 py-5">
          {/* Detecting step */}
          {step === "detecting" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <svg
                  className="w-4 h-4 text-blue-400 animate-spin"
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
                Scanning {chunks.length} chunks for changes…
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 text-right">{progress}%</p>
            </div>
          )}

          {/* Results step */}
          {(step === "results" || step === "storing") && (
            <div className="space-y-4">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: "Total",
                    val: chunks.length,
                    cls: "bg-slate-800 text-slate-200",
                  },
                  {
                    label: "No Changes",
                    val: unchangedCount,
                    cls: "bg-emerald-500/15 text-emerald-300",
                  },
                  {
                    label: "Changes",
                    val: changedCount,
                    cls: "bg-amber-500/15 text-amber-300",
                  },
                ].map(({ label, val, cls }) => (
                  <div
                    key={label}
                    className={`rounded-xl p-3 text-center ${cls}`}
                  >
                    <p className="text-2xl font-bold">{val}</p>
                    <p className="text-[10px] uppercase tracking-widest opacity-70 mt-0.5">
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              {/* Chunk list */}
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scroll">
                {chunks.map((chunk) => (
                  <div
                    key={chunk.label}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-all
                      ${
                        chunk.hasChanges
                          ? "bg-amber-500/10 border border-amber-500/20"
                          : "bg-emerald-500/8 border border-emerald-500/15"
                      }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0
                        ${chunk.hasChanges ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}
                      />
                      <span className="font-mono text-xs font-semibold text-slate-300">
                        {chunk.label}
                      </span>
                      <span className="text-[10px] text-slate-600">·</span>
                      <span className="text-[11px] text-slate-500 truncate max-w-[120px]">
                        &lt;{chunk.tag}&gt;
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-slate-600">
                        {fmtBytes(chunk.size)}
                      </span>
                      {chunk.hasChanges ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                          CHANGED → /edited
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                          CLEAN → /XML
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Folder preview */}
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3.5 text-xs font-mono space-y-1">
                <p className="text-slate-400 mb-2 font-sans text-[11px] font-semibold uppercase tracking-wider">
                  Storage Preview
                </p>
                <p className="text-slate-500">📁 {sourceName}/</p>
                <p className="text-slate-500 pl-4">
                  📁 OLD/ <span className="text-slate-600">(original xml)</span>
                </p>
                <p className="text-slate-500 pl-4">
                  📁 NEW/{" "}
                  <span className="text-slate-600">(new pdf source)</span>
                </p>
                <p className="text-emerald-400/80 pl-4">
                  📁 XML/{" "}
                  <span className="text-slate-600">
                    ← {unchangedCount} unchanged chunks
                  </span>
                </p>
                {changedCount > 0 && (
                  <p className="text-amber-400/80 pl-4">
                    📁 edited/{" "}
                    <span className="text-slate-600">
                      ← {changedCount} changed chunks
                    </span>
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
                    Storing to local storage…
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

          {/* Done step */}
          {step === "done" && storedResult && (
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
                    {storedResult.clean} clean chunks →{" "}
                    <span className="text-emerald-400">/XML</span>
                    {storedResult.edited > 0 && (
                      <>
                        {" "}
                        · {storedResult.edited} changed →{" "}
                        <span className="text-amber-400">/edited</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3.5 text-xs font-mono space-y-1">
                <p className="text-emerald-400">
                  ✓ {sourceName}/OLD/ — original stored
                </p>
                <p className="text-emerald-400">
                  ✓ {sourceName}/NEW/ — new source stored
                </p>
                <p className="text-emerald-400">
                  ✓ {sourceName}/XML/ — {storedResult.clean} chunks
                </p>
                {storedResult.edited > 0 && (
                  <p className="text-amber-400">
                    ✓ {sourceName}/edited/ — {storedResult.edited} chunks
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

interface StorageBrowserProps {
  sources: NameSource[];
}

function StorageBrowser({ sources }: StorageBrowserProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);

  if (sources.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
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
            d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="text-sm font-semibold text-slate-300">Local Storage</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
          {sources.length} source{sources.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {sources.map((src) => {
          const isOpen = expanded === src.sourceName;
          const folderMap: Record<string, StorageFolder> = {
            OLD: src.OLD,
            NEW: src.NEW,
            XML: src.XML,
            edited: src.edited,
          };
          return (
            <div
              key={src.sourceName}
              className="rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : src.sourceName)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-4 h-4 text-amber-400/70"
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
                  className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
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
                <div className="px-4 pb-4 space-y-1.5 border-t border-slate-800">
                  <div className="grid grid-cols-4 gap-2 pt-3">
                    {(["OLD", "NEW", "XML", "edited"] as const).map(
                      (folder) => {
                        const f = folderMap[folder];
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
                                : folder === "edited"
                                  ? `border-amber-500/30 ${isSel ? "bg-amber-500/20" : "bg-amber-500/8 hover:bg-amber-500/15"} text-amber-300`
                                  : `border-slate-700/60 ${isSel ? "bg-slate-700" : "bg-slate-800/60 hover:bg-slate-800"} text-slate-300`
                            }`}
                          >
                            <div className="text-base mb-0.5">
                              {folder === "edited" ? "✏️" : "📁"}
                            </div>
                            <div>{folder}</div>
                            <div className="text-[10px] opacity-60 mt-0.5">
                              {f.files.length} files
                            </div>
                          </button>
                        );
                      },
                    )}
                  </div>
                  {/* File list */}
                  {openFolder &&
                    openFolder.startsWith(src.sourceName) &&
                    (() => {
                      const folderName = openFolder.split("/")[1] as
                        | "OLD"
                        | "NEW"
                        | "XML"
                        | "edited";
                      const fld = folderMap[folderName];
                      return fld.files.length > 0 ? (
                        <div className="mt-2 rounded-lg border border-slate-700/40 bg-slate-950/40 divide-y divide-slate-800">
                          {fld.files.map((file) => (
                            <div
                              key={file.name}
                              className="flex items-center justify-between px-3 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <svg
                                  className="w-3.5 h-3.5 text-slate-500"
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
                                <span className="text-xs font-mono text-slate-300">
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
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [tagName, setTagName] = useState("");
  const [attribute, setAttribute] = useState("");
  const [value, setValue] = useState("");
  const [maxSize, setMaxSize] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [pendingChunks, setPendingChunks] = useState<ChunkItem[]>([]);
  const [oldXmlContent, setOldXmlContent] = useState<string | null>(null);

  // Local storage simulation
  const [storedSources, setStoredSources] = useState<NameSource[]>([]);

  const readFile = (f: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error("Read failed"));
      r.readAsText(f, "utf-8");
    });

  async function handleChunk() {
    if (!xmlFile) {
      setError("Please select an XML file to chunk.");
      return;
    }
    if (!tagName.trim()) {
      setError("Please enter a tag name.");
      return;
    }
    if (!sourceName.trim()) {
      setError("Please enter a source name.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      // Read old XML for diff baseline
      const oldContent = oldFile ? await readFile(oldFile) : null;
      setOldXmlContent(oldContent);

      const formData = new FormData();
      formData.append("file", xmlFile);
      formData.append("tag_name", tagName.trim());
      if (attribute.trim()) formData.append("attribute", attribute.trim());
      if (value.trim()) formData.append("value", value.trim());
      if (maxSize.trim()) formData.append("max_file_size", maxSize.trim());

      const res = await fetch("/api/compare/chunk", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();

      // Detect changes vs OLD
      const items = detectChanges(data.chunks ?? [], oldContent);
      setPendingChunks(items);
      setShowModal(true);
    } catch (e: Error | unknown) {
      setError(e instanceof Error ? e.message : "Chunking failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleConfirmStore(chunks: ChunkItem[]) {
    const now = new Date().toLocaleString();
    const name = sourceName.trim() || "NameSource";
    const cleanChunks = chunks.filter((c) => !c.hasChanges);
    const changedChunks = chunks.filter((c) => c.hasChanges);

    const newSource: NameSource = {
      sourceName: name,
      createdAt: now,
      OLD: {
        name: "OLD",
        files: oldFile
          ? [{ name: oldFile.name, content: "", size: oldFile.size }]
          : [],
      },
      NEW: {
        name: "NEW",
        files: newFile
          ? [{ name: newFile.name, content: "", size: newFile.size }]
          : [],
      },
      XML: {
        name: "XML",
        files: cleanChunks.map((c) => ({
          name: `${c.label}.xml`,
          content: c.content,
          size: c.size,
        })),
      },
      edited: {
        name: "edited",
        files: changedChunks.map((c) => ({
          name: `${c.label}.xml`,
          content: c.content,
          size: c.size,
        })),
      },
    };

    setStoredSources((prev) => {
      // Replace if same name exists
      const idx = prev.findIndex((s) => s.sourceName === name);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = newSource;
        return next;
      }
      return [...prev, newSource];
    });
  }

  const isReady = !!xmlFile && !!tagName.trim() && !!sourceName.trim();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-5 py-2">
        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              XML Chunker
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Split XML files into chunks and detect changes against the
              original
            </p>
          </div>
          {storedSources.length > 0 && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
              {storedSources.reduce(
                (acc, s) => acc + s.XML.files.length + s.edited.files.length,
                0,
              )}{" "}
              chunks stored
            </span>
          )}
        </div>

        {/* ── Source Name ── */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400">
            Source Name
          </label>
          <input
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="e.g. BRD_Project_Alpha"
            className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3.5 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
          />
          <p className="text-[11px] text-slate-600">
            Chunks will be stored under this source name folder
          </p>
        </div>

        {/* ── File uploads ── */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
            Files
          </label>
          <DropZone
            label="OLD XML (baseline)"
            accept=".xml"
            file={oldFile}
            onFile={setOldFile}
            color="violet"
          />
          <DropZone
            label="NEW PDF / Source"
            accept=".pdf,.xml"
            file={newFile}
            onFile={setNewFile}
            color="blue"
          />
          <DropZone
            label="XML to Chunk"
            accept=".xml"
            file={xmlFile}
            onFile={setXmlFile}
            color="emerald"
          />
        </div>

        {/* ── Chunk settings ── */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400">
            Chunking Settings
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
                Max File Size (bytes)
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
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. chapter"
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* ── Error ── */}
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

        {/* ── Chunk button ── */}
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
              Chunking…
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
                  d="M4 6h16M4 10h16M4 14h8M4 18h8"
                />
              </svg>
              Chunk XML
            </>
          )}
        </button>

        {/* ── Storage Browser ── */}
        <StorageBrowser sources={storedSources} />
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <ChunkModal
          sourceName={sourceName.trim() || "NameSource"}
          chunks={pendingChunks}
          onClose={() => setShowModal(false)}
          onConfirmStore={(chunks) => {
            handleConfirmStore(chunks);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
