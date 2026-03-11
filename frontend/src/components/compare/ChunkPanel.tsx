"use client";
/**
 * ChunkPanel — Enhanced PDF + XML Chunker
 *
 * Upload flow:
 *   OLD PDF  →  PyMuPDF extracts text
 *   NEW PDF  →  PyMuPDF extracts text + LangChain split
 *   OLD XML  →  xml_compare.chunk_xml (tag-based)
 *
 * Backend aligns NEW-PDF chunks ↔ XML chunks by index and detects per-chunk
 * changes. Each XML chunk is saved with naming:
 *   SourceName_innod.00001.xml
 *   SourceName_innod.00002.xml
 *   ...
 *
 * Chunks without changes are auto-saved to CHUNKED folder.
 * Chunks with changes require review in the Compare module.
 */

import React, { useState, useRef, useCallback } from "react";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PdfChunk {
  index: number;
  label: string;
  filename: string;
  old_text: string;
  new_text: string;
  has_changes: boolean;
  xml_content: string;
  xml_chunk_file: string;
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
  folder_structure: {
    base: string;
    chunked: string;
    compare: string;
    merge: string;
  };
}

interface ChunkPanelProps {
  onNavigateToCompare?: (chunk: PdfChunk, sourceName: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function downloadBlob(content: string, filename: string, mime = "application/xml") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ── DropZone ──────────────────────────────────────────────────────────────────

type DZColor = "violet" | "blue" | "emerald";

const DZC: Record<DZColor, Record<string, string>> = {
  violet:  { border: "border-violet-500/40",  bg: "bg-violet-500/8",  badge: "bg-violet-500/20 text-violet-300",  icon: "text-violet-400",  activeBg: "bg-violet-500/12" },
  blue:    { border: "border-blue-500/40",    bg: "bg-blue-500/8",    badge: "bg-blue-500/20 text-blue-300",      icon: "text-blue-400",    activeBg: "bg-blue-500/12"   },
  emerald: { border: "border-emerald-500/40", bg: "bg-emerald-500/8", badge: "bg-emerald-500/20 text-emerald-300", icon: "text-emerald-400", activeBg: "bg-emerald-500/12" },
};

function DropZone({
  label, sublabel, accept, file, onFile, color, icon,
}: {
  label: string; sublabel?: string; accept: string;
  file: File | null; onFile: (f: File | null) => void;
  color: DZColor; icon: "pdf" | "xml";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const c = DZC[color];

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files[0]; if (f) onFile(f);
      }}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all p-4 group
        ${drag
          ? `${c.border} ${c.activeBg} scale-[1.01]`
          : `border-slate-700/50 hover:${c.border} hover:${c.bg}`}`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />

      <div className="flex flex-col items-center gap-2 text-center">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
          ${file ? c.bg : "bg-slate-800/60 group-hover:" + c.bg} ${c.icon}`}>
          {icon === "pdf" ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
        </div>

        <div className="min-w-0 w-full">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
          {sublabel && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500">{sublabel}</span>
          )}
          <div className="mt-1.5">
            {file ? (
              <div className="flex items-center justify-center gap-1.5">
                <p className="text-xs font-medium text-white truncate max-w-[120px]">{file.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.badge} flex-shrink-0`}>
                  {fmtBytes(file.size)}
                </span>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Drop or click to browse</p>
            )}
          </div>
        </div>

        {file && (
          <button
            onClick={(e) => { e.stopPropagation(); onFile(null); }}
            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-slate-700/80 hover:bg-red-500/30 flex items-center justify-center transition-colors"
          >
            <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chunk Result Modal ─────────────────────────────────────────────────────────

function ChunkResultModal({
  response,
  onClose,
  onOpenChunkInCompare,
  onDownloadChunk,
  onDownloadAll,
}: {
  response: ChunkResponse;
  onClose: () => void;
  onOpenChunkInCompare: (chunk: PdfChunk) => void;
  onDownloadChunk: (chunk: PdfChunk) => void;
  onDownloadAll: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "changed" | "unchanged">("all");

  const filtered = response.pdf_chunks.filter((c) =>
    filter === "all" ? true : filter === "changed" ? c.has_changes : !c.has_changes
  );

  const { summary, folder_structure } = response;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-700/60 bg-slate-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-slate-800">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Chunk Results</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Source: <span className="text-slate-300">{response.source_name}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary pills */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 font-medium">
              Total: {summary.total}
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 font-medium border border-amber-500/25">
              {summary.changed} with changes
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 font-medium border border-emerald-500/25">
              {summary.unchanged} unchanged
            </span>
            <button
              onClick={onDownloadAll}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[11px] font-semibold transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download All
            </button>
          </div>

          {/* Folder structure hint */}
          {folder_structure && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
              <p className="text-[10px] text-slate-500 font-mono">
                <span className="text-slate-400">{folder_structure.chunked}/</span>
                {" "}← unchanged chunks saved here
              </p>
              <p className="text-[10px] text-slate-500 font-mono">
                <span className="text-slate-400">{folder_structure.compare}/</span>
                {" "}← chunks with changes for review
              </p>
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex-shrink-0 flex items-center gap-1 px-6 py-2 border-b border-slate-800/60 bg-slate-900/40">
          {(["all", "changed", "unchanged"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-3 py-1 rounded-full font-semibold capitalize transition-all
                ${filter === f
                  ? f === "changed"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : f === "unchanged"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-slate-700 text-white"
                  : "text-slate-500 hover:text-slate-300"}`}
            >
              {f === "all" ? `All (${summary.total})` : f === "changed" ? `Changed (${summary.changed})` : `Unchanged (${summary.unchanged})`}
            </button>
          ))}
        </div>

        {/* Chunk list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filtered.map((chunk) => (
            <div
              key={chunk.index}
              className={`group rounded-xl border transition-all
                ${chunk.has_changes
                  ? "border-amber-500/25 bg-amber-500/5 hover:border-amber-500/40"
                  : "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/35"}`}
            >
              <div className="px-4 py-3 flex items-center gap-3">
                {/* Index */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0
                  ${chunk.has_changes ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                  {String(chunk.index).padStart(2, "0")}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono font-semibold text-slate-200 truncate">
                      {chunk.filename}
                    </p>
                    {chunk.has_changes ? (
                      <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/25">
                        Changes detected
                      </span>
                    ) : (
                      <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/25">
                        No changes
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-600 mt-0.5 truncate font-mono">
                    {chunk.xml_tag ? `<${chunk.xml_tag}>` : "—"}
                    {chunk.xml_size > 0 && <span className="ml-1">{fmtBytes(chunk.xml_size)}</span>}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => onDownloadChunk(chunk)}
                    title="Download this chunk"
                    className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/40 flex items-center justify-center transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  {chunk.has_changes && (
                    <button
                      onClick={() => onOpenChunkInCompare(chunk)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[11px] font-semibold transition-colors"
                    >
                      Review in Compare
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                  {!chunk.has_changes && (
                    <span className="text-[10px] text-emerald-600 italic">Auto-saved</span>
                  )}
                </div>
              </div>

              {/* Text preview (collapsed) */}
              {chunk.new_text && (
                <div className="px-4 pb-3">
                  <p className="text-[10px] text-slate-600 font-mono leading-relaxed line-clamp-2">
                    {chunk.new_text.slice(0, 150)}{chunk.new_text.length > 150 ? "…" : ""}
                  </p>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-slate-600">No chunks in this category</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ChunkPanel ────────────────────────────────────────────────────────────

export default function ChunkPanel({ onNavigateToCompare }: ChunkPanelProps) {
  const [oldPdf, setOldPdf] = useState<File | null>(null);
  const [newPdf, setNewPdf] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [tagName, setTagName] = useState("section");
  const [chunkSize, setChunkSize] = useState(1500);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChunkResponse | null>(null);
  const [showModal, setShowModal] = useState(false);

  const isReady = !!oldPdf && !!newPdf && !!xmlFile && sourceName.trim().length > 0;

  const handleChunk = useCallback(async () => {
    if (!isReady) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("old_pdf", oldPdf!);
      form.append("new_pdf", newPdf!);
      form.append("xml_file", xmlFile!);
      form.append("tag_name", tagName);
      form.append("source_name", sourceName.trim());
      form.append("chunk_size", String(chunkSize));

      const res = await fetch(`${PROCESSING_URL}/compare/chunk/pdf`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? `HTTP ${res.status}`);
      }

      const data: ChunkResponse = await res.json();
      setResult(data);
      setShowModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chunking failed");
    } finally {
      setLoading(false);
    }
  }, [isReady, oldPdf, newPdf, xmlFile, sourceName, tagName, chunkSize]);

  function handleDownloadChunk(chunk: PdfChunk) {
    const content = chunk.xml_chunk_file || chunk.xml_content;
    if (content) {
      downloadBlob(content, chunk.filename);
    }
  }

  function handleDownloadAll() {
    if (!result) return;
    result.pdf_chunks.forEach((chunk) => {
      setTimeout(() => handleDownloadChunk(chunk), chunk.index * 100);
    });
  }

  function handleOpenChunkInCompare(chunk: PdfChunk) {
    setShowModal(false);
    if (onNavigateToCompare && result) {
      onNavigateToCompare(chunk, result.source_name);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2">
        <h2 className="text-sm font-bold text-slate-200">Chunk PDF + XML</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Upload OLD PDF, NEW PDF, and OLD XML to split into reviewable XML chunks
        </p>
      </div>

      {/* ── Source Name ── */}
      <div className="flex-shrink-0 px-6 pb-3">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-700/50 bg-slate-900/40">
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">
              Source Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g. ManualV2, ProductGuide"
              className="w-full bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none"
            />
          </div>
          <div className="text-slate-600 text-[10px] font-mono">
            {sourceName
              ? `→ ${sourceName.replace(/[^\w\-]/g, '_')}_innod.00001.xml`
              : "Filename preview"}
          </div>
        </div>
      </div>

      {/* ── File Upload Grid ── */}
      <div className="flex-shrink-0 px-6 pb-3">
        <div className="grid grid-cols-3 gap-3">
          <DropZone
            label="OLD PDF"
            sublabel="baseline"
            accept=".pdf,application/pdf"
            file={oldPdf}
            onFile={setOldPdf}
            color="violet"
            icon="pdf"
          />
          <DropZone
            label="NEW PDF"
            sublabel="updated"
            accept=".pdf,application/pdf"
            file={newPdf}
            onFile={setNewPdf}
            color="blue"
            icon="pdf"
          />
          <DropZone
            label="OLD XML"
            sublabel="reference"
            accept=".xml,text/xml,application/xml"
            file={xmlFile}
            onFile={setXmlFile}
            color="emerald"
            icon="xml"
          />
        </div>
      </div>

      {/* ── Settings Row ── */}
      <div className="flex-shrink-0 px-6 pb-3">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-700/40 bg-slate-900/20">
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">XML Tag</label>
            <input
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="e.g. section, chapter, paragraph"
              className="w-full bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none"
            />
          </div>
          <div className="w-px h-8 bg-slate-800" />
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Chunk Size</label>
            <input
              type="number"
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              min={500}
              max={5000}
              step={100}
              className="w-24 bg-transparent text-xs text-slate-300 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ── Action Bar ── */}
      <div className="flex-shrink-0 px-6 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleChunk}
            disabled={!isReady || loading}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all
              ${isReady && !loading
                ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/25"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
          >
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 6h16M4 10h16M4 14h8M4 18h8" />
                </svg>
                Chunk
              </>
            )}
          </button>

          {!sourceName.trim() && (
            <p className="text-xs text-slate-600 italic">Enter a source name to enable chunking</p>
          )}

          {result && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/40 text-slate-300 text-xs font-semibold transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              View Results ({result.summary.total} chunks)
            </button>
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
          <div className="w-20 h-20 rounded-2xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
            <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 6h16M4 10h16M4 14h8M4 18h8" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-400">Ready to Chunk</p>
            <p className="text-xs text-slate-600 mt-1 max-w-sm">
              Upload OLD PDF, NEW PDF, and OLD XML, enter a source name, then click{" "}
              <span className="text-blue-400 font-semibold">Chunk</span> to split into XML chunks.
            </p>
          </div>

          {/* Step guide */}
          <div className="grid grid-cols-3 gap-3 mt-2 max-w-lg w-full">
            {[
              { step: "1", label: "Upload Files", desc: "OLD PDF, NEW PDF, OLD XML" },
              { step: "2", label: "Set Source Name", desc: "Used for chunk file naming" },
              { step: "3", label: "Click Chunk", desc: "Review results in modal" },
            ].map(({ step, label, desc }) => (
              <div key={step} className="p-3 rounded-xl border border-slate-800 bg-slate-900/30 text-left">
                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400 mb-2">
                  {step}
                </div>
                <p className="text-[11px] font-semibold text-slate-300">{label}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 animate-spin text-blue-500/30" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            </svg>
            <svg className="absolute inset-0 w-16 h-16 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24" style={{ animationDuration: "1s" }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="16 48" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-300">Processing files…</p>
            <p className="text-xs text-slate-600 mt-1">Extracting text, splitting into chunks, detecting changes</p>
          </div>
        </div>
      )}

      {/* ── Result Modal ── */}
      {showModal && result && (
        <ChunkResultModal
          response={result}
          onClose={() => setShowModal(false)}
          onOpenChunkInCompare={handleOpenChunkInCompare}
          onDownloadChunk={handleDownloadChunk}
          onDownloadAll={handleDownloadAll}
        />
      )}
    </div>
  );
}
