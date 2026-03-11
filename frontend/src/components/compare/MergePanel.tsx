"use client";
/**
 * MergePanel — Merge XML Chunks into Final Document
 *
 * Purpose:
 *  Merge all final XML chunks into a single XML file.
 *
 * Process:
 *  1. Load XML chunk files (from CHUNKED folder, or upload manually)
 *  2. Check for missing chunks by sequence
 *  3. Validate all XML chunks
 *  4. Merge into final XML document
 *
 * Output:
 *  MERGE/SourceName_final.xml
 *
 * Also supports the legacy PDF-based diff/merge flow.
 */

import React, { useState, useRef, useCallback } from "react";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChunkFile {
  id: string;
  filename: string;
  xml_content: string;
  has_changes: boolean;
  validated: boolean;
  validation_errors: string[];
  file?: File;
}

interface MergeResult {
  success: boolean;
  merged_xml: string;
  filename: string;
  source_name: string;
}

// ── Legacy types (PDF diff/merge) ──────────────────────────────────────────────

interface DiffEntry {
  path: string;
  tag?: string;
  description: string;
  xml?: string;
  old_xml?: string;
  new_xml?: string;
}

interface DiffResult {
  additions: DiffEntry[];
  removals: DiffEntry[];
  modifications: DiffEntry[];
  mismatches: DiffEntry[];
  summary: {
    total_additions: number;
    total_removals: number;
    total_modifications: number;
    total_mismatches: number;
  };
}

interface CompareResponse {
  success: boolean;
  diff: DiffResult;
  line_diff: unknown[];
}

type ChangeKind = "addition" | "removal" | "modification" | "mismatch";
type Decision = "accept" | "reject" | "pending";

interface MergeItem {
  kind: ChangeKind;
  entry: DiffEntry;
  decision: Decision;
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const KIND: Record<ChangeKind, { label: string; dot: string; pill: string; rowBg: string; icon: string }> = {
  addition:     { label: "Addition",     dot: "bg-emerald-400", pill: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30", rowBg: "border-l-2 border-l-emerald-500/40", icon: "text-emerald-400" },
  removal:      { label: "Removal",      dot: "bg-red-400",     pill: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",             rowBg: "border-l-2 border-l-red-500/40",     icon: "text-red-400"     },
  modification: { label: "Modification", dot: "bg-amber-400",   pill: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",       rowBg: "border-l-2 border-l-amber-500/40",   icon: "text-amber-400"   },
  mismatch:     { label: "Mismatch",     dot: "bg-violet-400",  pill: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30",    rowBg: "border-l-2 border-l-violet-500/40",  icon: "text-violet-400"  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function parseChunkIndex(filename: string): number {
  // Try to extract index from patterns like: _innod.00001.xml or chunk01.xml
  const innodMatch = filename.match(/_innod\.(\d+)\.xml$/i);
  if (innodMatch) return parseInt(innodMatch[1], 10);
  const chunkMatch = filename.match(/[_-]?(\d+)\.xml$/i);
  if (chunkMatch) return parseInt(chunkMatch[1], 10);
  return 0;
}

function downloadBlob(content: string, filename: string, mime = "application/xml") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Progress ring ──────────────────────────────────────────────────────────────

function ProgressRing({ value, total, label }: { value: number; total: number; label: string }) {
  if (total === 0) return null;
  const pct = Math.round((value / total) * 100);
  const r = 18, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="flex items-center gap-2">
      <svg width="44" height="44" className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none"
          stroke={pct === 100 ? "#34d399" : "#3b82f6"}
          strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div>
        <p className="text-sm font-bold text-white tabular-nums leading-none">{pct}%</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Chunk File Row ─────────────────────────────────────────────────────────────

function ChunkFileRow({
  chunk,
  onRemove,
}: {
  chunk: ChunkFile;
  onRemove: () => void;
}) {
  const hasErrors = chunk.validation_errors.length > 0;
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all
      ${hasErrors
        ? "border-red-500/30 bg-red-500/5"
        : chunk.validated
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-slate-700/40 bg-slate-900/30"}`}
    >
      {/* Status icon */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold
        ${hasErrors ? "bg-red-500/20 text-red-400" : chunk.validated ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"}`}>
        {hasErrors ? "✕" : chunk.validated ? "✓" : "·"}
      </div>

      {/* Filename */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono font-semibold text-slate-200 truncate">{chunk.filename}</p>
        {hasErrors && (
          <p className="text-[10px] text-red-400 mt-0.5 truncate">{chunk.validation_errors[0]}</p>
        )}
        {chunk.has_changes && !hasErrors && (
          <p className="text-[10px] text-amber-400 mt-0.5">Contains changes</p>
        )}
      </div>

      {/* Size */}
      <span className="text-[10px] text-slate-600 flex-shrink-0">
        {fmtBytes(chunk.xml_content.length)}
      </span>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="w-6 h-6 rounded-full bg-slate-800 hover:bg-red-500/20 flex items-center justify-center transition-colors flex-shrink-0"
      >
        <svg className="w-3 h-3 text-slate-500 hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Decision Button ────────────────────────────────────────────────────────────

function DecisionBtn({ active, type, onClick }: { active: boolean; type: "accept" | "reject"; onClick: () => void }) {
  const styles = {
    accept: { active: "bg-emerald-500/20 border-emerald-500/50 text-emerald-300", idle: "border-slate-700 text-slate-600 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5" },
    reject: { active: "bg-red-500/20 border-red-500/50 text-red-300",             idle: "border-slate-700 text-slate-600 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5"         },
  };
  const s = styles[type];
  return (
    <button onClick={onClick} title={type === "accept" ? "Accept" : "Reject"}
      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all text-sm font-bold
        ${active ? s.active : s.idle}`}>
      {type === "accept" ? "✓" : "✗"}
    </button>
  );
}

// ── Main MergePanel ────────────────────────────────────────────────────────────

export default function MergePanel() {
  // ── Chunk-merge mode state
  const [mode, setMode] = useState<"chunks" | "pdf">("chunks");
  const [sourceName, setSourceName] = useState("");
  const [chunks, setChunks] = useState<ChunkFile[]>([]);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const chunkFileInputRef = useRef<HTMLInputElement>(null);

  // ── PDF-diff mode state (legacy)
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [items, setItems] = useState<MergeItem[]>([]);
  const [mergedXml, setMerged] = useState<string | null>(null);
  const [loadingDiff, setLDiff] = useState(false);
  const [loadingMerge, setLMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDiff, setHasDiff] = useState(false);
  const [preview, setPreview] = useState<MergeItem | null>(null);

  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  // ── Chunk upload handling
  function handleChunkFilesAdded(files: FileList | null) {
    if (!files) return;
    const newChunks: ChunkFile[] = [];
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string ?? "";
        const isValid = content.includes("<") && content.includes(">");
        newChunks.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          filename: file.name,
          xml_content: content,
          has_changes: content.includes("<!-- Status: changed"),
          validated: isValid,
          validation_errors: isValid ? [] : ["File does not appear to be valid XML"],
          file,
        });
        if (newChunks.length === files.length) {
          setChunks((prev) => {
            const allChunks = [...prev, ...newChunks];
            // Sort by chunk index
            return allChunks.sort((a, b) => parseChunkIndex(a.filename) - parseChunkIndex(b.filename));
          });
        }
      };
      reader.readAsText(file);
    });
  }

  // Check for missing chunks in sequence
  function getMissingChunks(): number[] {
    if (chunks.length === 0) return [];
    const indices = chunks
      .map((c) => parseChunkIndex(c.filename))
      .filter((i) => i > 0)
      .sort((a, b) => a - b);
    if (indices.length === 0) return [];
    const missing: number[] = [];
    for (let i = indices[0]; i <= indices[indices.length - 1]; i++) {
      if (!indices.includes(i)) missing.push(i);
    }
    return missing;
  }

  const missingChunks = getMissingChunks();
  const invalidChunks = chunks.filter((c) => c.validation_errors.length > 0);
  const canMergeChunks = chunks.length > 0 && invalidChunks.length === 0 && sourceName.trim().length > 0;

  const handleMergeChunks = useCallback(async () => {
    if (!canMergeChunks) return;
    setMerging(true);
    setMergeError(null);
    setMergeResult(null);

    try {
      const res = await fetch(`${PROCESSING_URL}/compare/merge/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunks: chunks.map((c) => ({
            filename: c.filename,
            xml_content: c.xml_content,
            has_changes: c.has_changes,
          })),
          source_name: sourceName.trim(),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? `HTTP ${res.status}`);
      }
      const data: MergeResult = await res.json();
      setMergeResult(data);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  }, [canMergeChunks, chunks, sourceName]);

  // ── PDF diff/merge handlers
  const isReady = !!oldFile && !!newFile && !!xmlFile;

  const handleLoadDiff = useCallback(async () => {
    if (!oldFile || !newFile || !xmlFile) { setError("Please select all three files"); return; }
    setError(null); setLDiff(true); setHasDiff(false); setItems([]); setMerged(null); setPreview(null);
    try {
      const form = new FormData();
      form.append("old_pdf", oldFile);
      form.append("new_pdf", newFile);
      form.append("xml_file", xmlFile);
      const res = await fetch(`${PROCESSING_URL}/compare/diff/pdf`, { method: "POST", body: form });
      if (!res.ok) { const e = await res.json().catch(() => ({ detail: "Unknown error" })); throw new Error(e.detail || "Comparison failed"); }
      const data: CompareResponse = await res.json();
      const d = data.diff;
      setItems([
        ...d.additions.map((e) => ({ kind: "addition" as ChangeKind, entry: e, decision: "accept" as Decision })),
        ...d.modifications.map((e) => ({ kind: "modification" as ChangeKind, entry: e, decision: "accept" as Decision })),
        ...d.mismatches.map((e) => ({ kind: "mismatch" as ChangeKind, entry: e, decision: "pending" as Decision })),
        ...d.removals.map((e) => ({ kind: "removal" as ChangeKind, entry: e, decision: "pending" as Decision })),
      ]);
      setHasDiff(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally { setLDiff(false); }
  }, [oldFile, newFile, xmlFile]);

  function decide(idx: number, d: Decision) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, decision: d } : it)));
  }

  const handleMergePdf = useCallback(async () => {
    if (!oldFile || !newFile || !xmlFile) return;
    setError(null); setLMerge(true);
    const acceptPaths = items.filter((i) => i.decision === "accept").map((i) => i.entry.path);
    const rejectPaths = items.filter((i) => i.decision === "reject").map((i) => i.entry.path);
    try {
      const form = new FormData();
      form.append("old_pdf", oldFile); form.append("new_pdf", newFile); form.append("xml_file", xmlFile);
      form.append("accept", JSON.stringify(acceptPaths)); form.append("reject", JSON.stringify(rejectPaths));
      const res = await fetch(`${PROCESSING_URL}/compare/merge/pdf`, { method: "POST", body: form });
      if (!res.ok) { const e = await res.json().catch(() => ({ detail: "Unknown error" })); throw new Error(e.detail || "Merge failed"); }
      const data = await res.json();
      setMerged(data.merged_xml);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally { setLMerge(false); }
  }, [items, oldFile, newFile, xmlFile]);

  function downloadMerged() {
    if (!mergedXml) return;
    const name = sourceName.trim()
      ? `${sourceName.trim().replace(/[^\w\-]/g, '_')}_final.xml`
      : "merged.xml";
    downloadBlob(mergedXml, name);
  }

  const accepted = items.filter((i) => i.decision === "accept").length;
  const rejected = items.filter((i) => i.decision === "reject").length;
  const pending  = items.filter((i) => i.decision === "pending").length;
  const total    = items.length;

  // ── Render
  return (
    <div className="flex flex-col h-full gap-3 min-h-0">

      {/* ── Mode Switcher ── */}
      <div className="flex-shrink-0 flex items-center gap-1 p-1 bg-slate-800/60 rounded-xl border border-slate-700/40 w-fit">
        <button
          onClick={() => setMode("chunks")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all
            ${mode === "chunks"
              ? "bg-slate-700 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-300"}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h8M4 18h8" />
          </svg>
          Merge XML Chunks
        </button>
        <button
          onClick={() => setMode("pdf")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all
            ${mode === "pdf"
              ? "bg-slate-700 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-300"}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          PDF Diff Merge
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════ */}
      {/* ── CHUNK MERGE MODE ── */}
      {/* ════════════════════════════════════════════════════════ */}
      {mode === "chunks" && (
        <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">

          {/* Left: controls */}
          <div className="w-[320px] flex-shrink-0 flex flex-col gap-3">

            {/* Source name */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
                Source Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. ManualV2 (used for output filename)"
                className="w-full bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none"
              />
              {sourceName.trim() && (
                <p className="text-[10px] text-slate-600 font-mono mt-1">
                  Output: {sourceName.trim().replace(/[^\w\-]/g, '_')}_final.xml
                </p>
              )}
            </div>

            {/* Upload chunks */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  XML Chunks ({chunks.length})
                </label>
                <button
                  onClick={() => chunkFileInputRef.current?.click()}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[10px] font-semibold transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Files
                </button>
                <input
                  ref={chunkFileInputRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  multiple
                  className="hidden"
                  onChange={(e) => { handleChunkFilesAdded(e.target.files); e.target.value = ""; }}
                />
              </div>

              {/* Drag and drop zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleChunkFilesAdded(e.dataTransfer.files); }}
                className="border-2 border-dashed border-slate-700/40 rounded-lg p-3 text-center hover:border-slate-600/60 transition-colors cursor-pointer"
                onClick={() => chunkFileInputRef.current?.click()}
              >
                <p className="text-xs text-slate-600">Drop XML chunks here or click Add Files</p>
                <p className="text-[10px] text-slate-700 mt-0.5">Accepts: SourceName_innod.NNNNN.xml</p>
              </div>

              {chunks.length > 0 && (
                <button
                  onClick={() => { setChunks([]); setMergeResult(null); }}
                  className="mt-2 text-[10px] text-slate-600 hover:text-red-400 transition-colors"
                >
                  Clear all chunks
                </button>
              )}
            </div>

            {/* Missing chunks warning */}
            {missingChunks.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs font-semibold text-amber-300">Missing Chunks</p>
                </div>
                <p className="text-[11px] text-amber-400/80">
                  Indices {missingChunks.join(", ")} appear to be missing from the sequence.
                </p>
              </div>
            )}

            {/* Validation summary */}
            {chunks.length > 0 && (
              <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Validation</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-emerald-400">{chunks.length - invalidChunks.length} valid</span>
                    {invalidChunks.length > 0 && (
                      <span className="text-[10px] text-red-400">{invalidChunks.length} invalid</span>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${chunks.length ? ((chunks.length - invalidChunks.length) / chunks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Merge button */}
            <button
              onClick={handleMergeChunks}
              disabled={!canMergeChunks || merging}
              className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all
                ${canMergeChunks && !merging
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
            >
              {merging ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Merging…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Merge XML
                </>
              )}
            </button>

            {!sourceName.trim() && chunks.length > 0 && (
              <p className="text-[10px] text-slate-600 text-center">Enter a source name to enable merge</p>
            )}

            {mergeError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                <p className="text-xs text-red-300">{mergeError}</p>
              </div>
            )}
          </div>

          {/* Center-right: chunk list + result */}
          <div className="flex-1 flex flex-col min-h-0 gap-3 overflow-hidden">

            {/* Chunk list */}
            {chunks.length > 0 && (
              <div className="flex-shrink-0 max-h-[45%] flex flex-col rounded-xl border border-slate-700/50 bg-slate-900/30 overflow-hidden">
                <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Loaded Chunks ({chunks.length})
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Folder: Documents/Innodata/{sourceName || "..."}/CHUNKED/
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                  {chunks.map((chunk) => (
                    <ChunkFileRow
                      key={chunk.id}
                      chunk={chunk}
                      onRemove={() => setChunks((prev) => prev.filter((c) => c.id !== chunk.id))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Merge result */}
            <div className="flex-1 rounded-xl border border-slate-700/50 bg-slate-900/30 overflow-hidden flex flex-col">
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs font-semibold text-slate-300">Merged Result</span>
                  {mergeResult && (
                    <>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">Ready</span>
                      <span className="text-[10px] font-mono text-slate-600">{mergeResult.filename}</span>
                    </>
                  )}
                </div>
                {mergeResult && (
                  <button
                    onClick={() => downloadBlob(mergeResult.merged_xml, mergeResult.filename)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download {mergeResult.filename}
                  </button>
                )}
              </div>

              {mergeResult ? (
                <pre className="flex-1 p-4 text-[11px] font-mono text-slate-300 overflow-auto bg-[#080d16] whitespace-pre-wrap leading-relaxed">
                  {mergeResult.merged_xml}
                </pre>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 p-6">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-400">Merge XML Chunks</p>
                    <p className="text-xs text-slate-600 mt-1 max-w-sm">
                      Upload XML chunk files (from CHUNKED folder), enter a source name, then click{" "}
                      <span className="text-blue-400 font-semibold">Merge XML</span>.
                    </p>
                    {chunks.length === 0 && (
                      <div className="mt-4 grid grid-cols-3 gap-2 max-w-sm mx-auto text-left">
                        {[
                          { step: "1", desc: "Upload .xml chunks" },
                          { step: "2", desc: "Set source name" },
                          { step: "3", desc: "Click Merge XML" },
                        ].map(({ step, desc }) => (
                          <div key={step} className="p-2 rounded-lg border border-slate-800 bg-slate-900/40">
                            <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400 mb-1">{step}</div>
                            <p className="text-[10px] text-slate-500">{desc}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* ── PDF DIFF MERGE MODE (legacy) ── */}
      {/* ════════════════════════════════════════════════════════ */}
      {mode === "pdf" && (
        <div className="flex-1 flex flex-col gap-3 min-h-0">

          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-900/50 flex-wrap">
            {/* Source name for output filename */}
            <div className="flex items-center gap-2 border-r border-slate-700/40 pr-3">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Source</span>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. ManualV2"
                className="bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none w-28"
              />
            </div>

            {/* File pickers */}
            {(["OLD PDF", "NEW PDF", "XML"] as const).map((label, i) => {
              const refs = [oldRef, newRef, xmlRef];
              const files = [oldFile, newFile, xmlFile];
              const setFiles = [setOldFile, setNewFile, setXmlFile];
              const accepts = [".pdf,application/pdf", ".pdf,application/pdf", ".xml,text/xml,application/xml"];
              const colors = ["amber", "emerald", "blue"] as const;
              const file = files[i];
              const color = colors[i];
              const colorMap = {
                amber:   "border-amber-500/40 bg-amber-500/8 text-amber-300 hover:bg-amber-500/15",
                emerald: "border-emerald-500/40 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/15",
                blue:    "border-blue-500/40 bg-blue-500/8 text-blue-300 hover:bg-blue-500/15",
              };
              const dotMap = { amber: "bg-amber-400", emerald: "bg-emerald-400", blue: "bg-blue-400" };

              return (
                <div key={label} className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => refs[i].current?.click()}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all shrink-0 ${colorMap[color]}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    {label}
                  </button>
                  {file ? (
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotMap[color]}`} />
                      <span className="text-xs text-slate-300 truncate max-w-[100px] font-mono">{file.name}</span>
                      <button onClick={() => setFiles[i](null)} className="w-4 h-4 rounded-full bg-slate-700 hover:bg-red-500/30 flex items-center justify-center transition-colors shrink-0">
                        <svg className="w-2.5 h-2.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600 italic">None</span>
                  )}
                  <input ref={refs[i]} type="file" accept={accepts[i]} className="hidden"
                    onChange={(e) => { setFiles[i](e.target.files?.[0] ?? null); e.target.value = ""; }} />
                </div>
              );
            })}

            <div className="flex-1" />

            <button onClick={handleLoadDiff} disabled={!isReady || loadingDiff}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all
                ${isReady && !loadingDiff
                  ? "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
            >
              {loadingDiff ? (
                <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>Loading…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>Load Changes</>
              )}
            </button>

            {error && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}
          </div>

          {/* Workspace */}
          {hasDiff ? (
            <div className="flex-1 grid grid-cols-[1fr_360px] gap-3 min-h-0 overflow-hidden">
              {/* Left: merged result */}
              <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-xs font-semibold text-slate-300">Merged Result</span>
                    {mergedXml && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">Ready</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {mergedXml && (
                      <button onClick={downloadMerged}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </button>
                    )}
                    <button onClick={handleMergePdf} disabled={pending > 0 || loadingMerge}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                        ${pending === 0 && !loadingMerge
                          ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-md shadow-blue-500/20"
                          : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}>
                      {loadingMerge ? (
                        <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>Merging…</>
                      ) : (
                        <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>Generate Merge</>
                      )}
                    </button>
                  </div>
                </div>

                {pending > 0 && (
                  <div className="flex items-center gap-2.5 px-4 py-2 bg-amber-950/40 border-b border-amber-900/30 shrink-0">
                    <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-amber-300">
                      {pending} change{pending > 1 ? "s" : ""} still pending — resolve all to unlock merge
                    </p>
                  </div>
                )}

                {mergedXml ? (
                  <pre className="flex-1 p-4 text-[11px] font-mono text-slate-300 overflow-auto bg-[#080d16] whitespace-pre-wrap leading-relaxed">
                    {mergedXml}
                  </pre>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
                    <div className="w-14 h-14 rounded-xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                      <svg className="w-7 h-7 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-slate-400">Merged XML will appear here</p>
                    <p className="text-xs text-slate-600 mt-1">Resolve all {total} changes, then click Generate Merge</p>
                  </div>
                )}
              </div>

              {/* Right: change decisions */}
              <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <ProgressRing accepted={accepted} total={total} label="resolved" />
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{accepted} accepted
                        </span>
                        <span className="flex items-center gap-1 text-red-400 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />{rejected} rejected
                        </span>
                      </div>
                      {pending > 0 && (
                        <span className="flex items-center gap-1 text-amber-400 text-[11px] font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />{pending} pending
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setItems((p) => p.map((i) => ({ ...i, decision: "accept" })))}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[11px] font-semibold hover:bg-emerald-500/20 transition-colors">
                      Accept All
                    </button>
                    <button onClick={() => setItems((p) => p.map((i) => ({ ...i, decision: "reject" })))}
                      className="flex-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-[11px] font-semibold hover:bg-red-500/20 transition-colors">
                      Reject All
                    </button>
                    <button onClick={() => setItems((p) => p.map((i) => ({ ...i, decision: "pending" })))}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-semibold hover:bg-slate-700 transition-colors">
                      Reset
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
                  {items.map((item, idx) => {
                    const k = KIND[item.kind];
                    const decisionBg = item.decision === "accept" ? "bg-emerald-500/5" : item.decision === "reject" ? "bg-red-500/5" : "";
                    const isPreviewing = preview?.entry.path === item.entry.path && preview?.kind === item.kind;
                    return (
                      <div key={idx}
                        className={`px-3 py-2.5 flex items-start gap-3 transition-all cursor-pointer ${k.rowBg} ${decisionBg}
                          ${isPreviewing ? "ring-1 ring-inset ring-blue-500/30 bg-blue-500/5" : "hover:bg-slate-800/30"}`}
                        onClick={() => setPreview(isPreviewing ? null : item)}>
                        <span className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${k.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${k.icon}`}>{k.label}</span>
                            {item.decision === "accept" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">ACCEPTED</span>}
                            {item.decision === "reject" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 font-semibold">REJECTED</span>}
                            {item.decision === "pending" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold animate-pulse">PENDING</span>}
                          </div>
                          <p className="text-[11px] text-slate-400 truncate font-mono">{item.entry.path?.split("/").pop() || item.entry.tag}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-1">{item.entry.description}</p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <DecisionBtn active={item.decision === "accept"} type="accept" onClick={() => decide(idx, "accept")} />
                          <DecisionBtn active={item.decision === "reject"} type="reject" onClick={() => decide(idx, "reject")} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {preview && (
                  <div className="border-t border-slate-700 bg-slate-950/60 shrink-0 max-h-48 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Preview</span>
                      <button onClick={() => setPreview(null)} className="w-5 h-5 rounded hover:bg-slate-700 flex items-center justify-center transition-colors">
                        <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex divide-x divide-slate-800 overflow-hidden flex-1">
                      <pre className="flex-1 p-2 text-[10px] font-mono text-red-300/80 overflow-auto bg-red-950/20 whitespace-pre-wrap">
                        {preview.entry.old_xml ?? preview.entry.xml ?? "—"}
                      </pre>
                      <pre className="flex-1 p-2 text-[10px] font-mono text-emerald-300/80 overflow-auto bg-emerald-950/20 whitespace-pre-wrap">
                        {preview.entry.new_xml ?? preview.entry.xml ?? "—"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            !loadingDiff && (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center">
                  <svg className="w-9 h-9 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-300">PDF Diff Merge</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-xs">
                    Select OLD PDF, NEW PDF, and XML file, load their differences, then accept or reject each change.
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
