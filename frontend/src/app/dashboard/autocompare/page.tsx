"use client";
/**
 * AutoCompare Page — /dashboard/autocompare
 *
 * Implemented enhancements
 * ─────────────────────────
 * #1  Chunk review-status tracking (pending → reviewed → saved)
 * #3  Undo/redo in XmlEditor (wired via onAutoSave to keep draft live)
 * #5  Keyboard navigation: Alt+↑ / Alt+↓ (or ← →) between chunks
 * #6  Unsaved-changes indicator + auto-save draft in XmlEditor
 * #7  Validate-All results reflected as per-chunk icons in ChunkList
 * #8  Download All button (ZIP or sequential fallback)
 * #9  Session persistence: session_id stored in localStorage, restored on load
 * #10 Batch auto-generate for all changed chunks (with progress modal)
 *
 * Layout (review stage)
 * ─────────────────────
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  Header bar (title, source name, session status, action buttons)    │
 *  ├──────────────┬──────────────┬──────────────┬─────────────┤
 *  │  Chunk List  │  Diff View   │  Old PDF     │  New PDF  / XML Editor │
 *  └──────────────┴──────────────┴──────────────┴─────────────┘
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type {
  ChunkDetail,
  ChunkRow,
  DiffLine,
  ReviewStatus,
  SessionSummary,
  UploadResponse,
  ValidateAllResponse,
  ValidateResponse,
} from "../../../components/autocompare/types";
import {
  autoGenerateAllChanged,
  autoGenerateXml,
  downloadAllChunks,
  downloadChunkXml,
  fetchChunkDetail,
  fetchChunks,
  pollStatus,
  reuploadXmlFiles,
  saveChunkXml,
  startProcessing,
  validateAllChunks,
  validateChunkXml,
} from "../../../components/autocompare/api";

// Dynamic imports (avoids SSR issues with canvas/PDF)
const FileUploadPanel = dynamic(() => import("../../../components/autocompare/FileUploadPanel"), { ssr: false });
const PdfViewer       = dynamic(() => import("../../../components/autocompare/PdfViewer"),       { ssr: false });
const XmlEditor       = dynamic(() => import("../../../components/autocompare/XmlEditor"),       { ssr: false });
const DiffPanel       = dynamic(() => import("../../../components/autocompare/DiffPanel"),       { ssr: false });

// ── Session persistence key ───────────────────────────────────────────────────
const SESSION_STORAGE_KEY = "autocompare_session_id";

// ── Page-level types ──────────────────────────────────────────────────────────
type Stage = "upload" | "processing" | "review";

// ── Processing overlay ────────────────────────────────────────────────────────

function ProcessingOverlay({
  progress,
  sourceName,
  summary,
}: {
  progress: number;
  sourceName: string;
  summary: SessionSummary | null;
}) {
  const pct = Math.min(100, Math.max(0, progress));
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
      <div
        className="w-full max-w-lg p-8 rounded-2xl border space-y-6"
        style={{ background: "rgba(11,26,46,0.9)", borderColor: "rgba(26,143,209,0.2)" }}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Processing Documents</p>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{sourceName}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">
              {pct < 30 ? "Extracting PDF text…"
                : pct < 50 ? "Parsing XML files…"
                : pct < 95 ? "Comparing chunks…"
                : "Finalising…"}
            </span>
            <span className="font-semibold text-[#1a8fd1]">{pct}%</span>
          </div>
          <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg, #1a8fd1, #42b4f5)",
                boxShadow: pct > 0 ? "0 0 10px rgba(26,143,209,0.5)" : "none",
              }}
            />
          </div>
        </div>

        {[
          { label: "Upload files",      done: pct >= 1  },
          { label: "Extract PDF text",  done: pct >= 30 },
          { label: "Parse XML chunks",  done: pct >= 50 },
          { label: "Compare & diff",    done: pct >= 90 },
          { label: "Build chunk index", done: pct >= 100 },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-2.5 text-xs">
            {step.done ? (
              <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <div className="w-4 h-4 rounded-full border border-slate-600 flex-shrink-0" />
            )}
            <span className={step.done ? "text-slate-300" : "text-slate-500"}>{step.label}</span>
          </div>
        ))}

        {summary && pct === 100 && (
          <div className="pt-2 border-t border-slate-700/50 grid grid-cols-3 gap-3">
            {[
              { label: "Total chunks", value: summary.total,     color: "text-white" },
              { label: "Changed",      value: summary.changed,   color: "text-amber-300" },
              { label: "Unchanged",    value: summary.unchanged, color: "text-emerald-300" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium"
      style={type === "success"
        ? { background: "rgba(16,185,129,0.15)", borderColor: "rgba(16,185,129,0.3)", color: "#6ee7b7" }
        : { background: "rgba(239,68,68,0.15)",  borderColor: "rgba(239,68,68,0.3)",  color: "#fca5a5" }
      }
    >
      {type === "success" ? (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {message}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Validate Modal ────────────────────────────────────────────────────────────

function ValidateModal({ data, onClose }: { data: ValidateResponse; onClose: () => void }) {
  const statusStyles: Record<string, { icon: string; color: string; label: string }> = {
    updated:         { icon: "✓", color: "text-emerald-300", label: "Updated — Changes Applied" },
    no_changes:      { icon: "=", color: "text-slate-400",   label: "No Changes Detected" },
    saved_unchanged: { icon: "✓", color: "text-blue-300",    label: "Saved — Matches Original" },
    needs_review:    { icon: "!", color: "text-amber-300",    label: "Needs Further Review" },
    pending:         { icon: "?", color: "text-slate-400",    label: "Pending" },
  };
  const st = statusStyles[data.status] ?? statusStyles.pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: "rgba(11,26,46,0.95)", borderColor: "rgba(26,143,209,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${st.color}`}
            style={{ background: "rgba(26,143,209,0.1)" }}>
            {st.icon}
          </div>
          <div>
            <h3 className={`text-sm font-bold ${st.color}`}>{st.label}</h3>
            <p className="text-xs text-slate-400">{data.message}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className={data.xml_valid ? "text-emerald-300" : "text-red-300"}>
            {data.xml_valid ? "✓ Valid XML" : "✗ Invalid XML"}
          </span>
        </div>

        {data.xml_errors.length > 0 && (
          <div className="text-xs text-red-300 space-y-1 bg-red-500/10 rounded-lg p-3 border border-red-500/20 max-h-32 overflow-y-auto">
            {data.xml_errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        {data.change_details.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Change Details</p>
            <div className="text-xs text-slate-300 space-y-1 bg-slate-800/40 rounded-lg p-3 max-h-40 overflow-y-auto">
              {data.change_details.map((d, i) => <p key={i}>• {d}</p>)}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-2 rounded-xl text-xs font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #1a8fd1, #146da3)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Validate-All Modal ────────────────────────────────────────────────────────

function ValidateAllModal({
  running,
  result,
  error,
  onClose,
  onJumpToChunk,
}: {
  running: boolean;
  result: ValidateAllResponse | null;
  error: string | null;
  onClose: () => void;
  onJumpToChunk?: (index: number) => void;
}) {
  const [filter, setFilter] = useState<"all" | "needs_review" | "invalid_xml" | "updated" | "no_changes">("all");

  const filteredResults = (result?.results ?? []).filter((r) => {
    if (filter === "all")         return true;
    if (filter === "needs_review") return r.needs_further_changes;
    if (filter === "invalid_xml") return !r.xml_valid;
    if (filter === "updated")     return r.status === "updated";
    if (filter === "no_changes")  return r.status === "no_changes";
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl border p-6 space-y-4"
        style={{ background: "rgba(11,26,46,0.95)", borderColor: "rgba(26,143,209,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Validate All XML Chunks</h3>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-white">Close</button>
        </div>

        {running && (
          <div className="flex items-center gap-3 text-sm text-slate-300 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
            Checking all chunks…
          </div>
        )}

        {error && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">{error}</div>
        )}

        {result && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
              {[
                { label: "Total",          value: result.total,                   cls: "bg-slate-800/40 text-white" },
                { label: "Updated",        value: result.summary.updated,         cls: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" },
                { label: "No Changes",     value: result.summary.no_changes,      cls: "bg-slate-500/10 border border-slate-500/20 text-slate-300" },
                { label: "Saved Unchanged",value: result.summary.saved_unchanged, cls: "bg-blue-500/10 border border-blue-500/20 text-blue-300" },
                { label: "Needs Review",   value: result.summary.needs_review,    cls: "bg-amber-500/10 border border-amber-500/20 text-amber-300" },
                { label: "Invalid XML",    value: result.summary.invalid_xml,     cls: "bg-red-500/10 border border-red-500/20 text-red-300" },
              ].map((s) => (
                <div key={s.label} className={`rounded-lg p-2 ${s.cls}`}>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-400">
              Requires action: <span className="text-amber-300 font-semibold">{result.needs_action_count}</span>
            </p>

            {/* Filter pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(["all", "needs_review", "invalid_xml", "updated", "no_changes"] as const).map((f) => {
                const labels: Record<string, string> = {
                  all: `All (${result.results.length})`,
                  needs_review: `Needs Review (${result.summary.needs_review})`,
                  invalid_xml:  `Invalid XML (${result.summary.invalid_xml})`,
                  updated:      `Updated (${result.summary.updated})`,
                  no_changes:   `No Changes (${result.summary.no_changes})`,
                };
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold border ${
                      filter === f
                        ? "text-white border-[#1a8fd1] bg-[#1a8fd1]/20"
                        : "text-slate-300 border-slate-600/80"
                    }`}
                  >
                    {labels[f]}
                  </button>
                );
              })}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700/60">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/70 text-slate-400 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Chunk</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">XML</th>
                    <th className="text-left px-3 py-2">Message</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => (
                    <tr key={r.chunk_id} className="border-t border-slate-800/80 hover:bg-slate-800/30">
                      <td className="px-3 py-2 text-slate-300">#{r.index} {r.label}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">{r.status}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={r.xml_valid ? "text-emerald-300" : "text-red-300"}>
                          {r.xml_valid ? "valid" : "invalid"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400">{r.message}</td>
                      <td className="px-3 py-2">
                        {onJumpToChunk && (
                          <button
                            onClick={() => { onJumpToChunk(r.index); onClose(); }}
                            className="text-[10px] text-[#1a8fd1] hover:text-white transition-colors"
                          >
                            Go →
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredResults.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No chunks match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Re-upload modal ───────────────────────────────────────────────────────────

function ReuploadModal({
  sessionId,
  onDone,
  onClose,
}: {
  sessionId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files,     setFiles]     = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pct,       setPct]       = useState(0);
  const [error,     setError]     = useState<string | null>(null);

  const handleReupload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await reuploadXmlFiles(sessionId, files, setPct);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Re-upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: "rgba(11,26,46,0.95)", borderColor: "rgba(26,143,209,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-white">Re-upload XML Chunks</h3>
        <p className="text-xs text-slate-400">Select updated XML chunk files to replace existing ones in this session.</p>

        <div
          className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-emerald-500/30 bg-emerald-500/5 cursor-pointer hover:border-emerald-400/50 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".xml" multiple className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          {files.length > 0 ? (
            <p className="text-xs text-emerald-300">{files.length} file{files.length > 1 ? "s" : ""} selected</p>
          ) : (
            <p className="text-xs text-slate-500">Click to select XML files</p>
          )}
        </div>

        {uploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Uploading…</span>
              <span className="text-[#1a8fd1] font-semibold">{pct}%</span>
            </div>
            <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#1a8fd1,#42b4f5)" }} />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-300 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 border border-slate-600 hover:text-white hover:border-slate-500 transition-colors">
            Cancel
          </button>
          <button onClick={handleReupload} disabled={files.length === 0 || uploading}
            className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#1a8fd1,#146da3)" }}>
            {uploading ? "Uploading…" : "Upload & Re-process"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Batch Auto-Generate Modal (Feature #10) ───────────────────────────────────

function BatchGenerateModal({
  total,
  completed,
  generated,
  failed,
  running,
  onClose,
}: {
  total: number;
  completed: number;
  generated: number;
  failed: number;
  running: boolean;
  onClose: () => void;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{ background: "rgba(11,26,46,0.95)", borderColor: "rgba(139,92,246,0.3)" }}
      >
        <div className="flex items-center gap-3">
          {running ? (
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent border-violet-400 animate-spin flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 text-violet-300">
              ✓
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-white">
              {running ? "Generating XML for all changed chunks…" : "Batch Generation Complete"}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {completed}/{total} processed · {generated} generated · {failed} failed
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Progress</span>
            <span className="text-violet-300 font-semibold">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg,#8b5cf6,#a78bfa)",
              }}
            />
          </div>
        </div>

        {!running && (
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6d28d9)" }}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AutoComparePage() {
  // ── Global state ──
  const [stage,      setStage]      = useState<Stage>("upload");
  const [sessionId,  setSessionId]  = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [oldPdfFile, setOldPdfFile] = useState<File | null>(null);
  const [newPdfFile, setNewPdfFile] = useState<File | null>(null);

  // Processing
  const [progress,   setProgress]   = useState(0);
  const [summary,    setSummary]    = useState<SessionSummary | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chunks — extended with local reviewStatus (Feature #1)
  const [chunks,       setChunks]       = useState<ChunkRow[]>([]);
  const [selected,     setSelected]     = useState<ChunkDetail | null>(null);
  const [loadingChunk, setLoadingChunk] = useState(false);

  // XML editor
  const [xmlDraft,        setXmlDraft]        = useState("");
  const [isSaving,        setIsSaving]        = useState(false);
  const [isGenerating,    setIsGenerating]    = useState(false);
  const [isValidating,    setIsValidating]    = useState(false);
  const [xmlFocusLine,    setXmlFocusLine]    = useState<number | null>(null);
  const [xmlFocusRequestId, setXmlFocusRequestId] = useState(0);

  // Diff → viewer navigation
  const [selectedDiffLineIndex, setSelectedDiffLineIndex] = useState<number | null>(null);
  const [oldPdfTargetPage,  setOldPdfTargetPage]  = useState<number | null>(null);
  const [newPdfTargetPage,  setNewPdfTargetPage]  = useState<number | null>(null);
  const [oldHighlightText,  setOldHighlightText]  = useState("");
  const [newHighlightText,  setNewHighlightText]  = useState("");
  const [xmlHighlightText,  setXmlHighlightText]  = useState("");

  // Validate
  const [validateResult,     setValidateResult]     = useState<ValidateResponse | null>(null);
  const [showValidateAll,    setShowValidateAll]    = useState(false);
  const [validateAllRunning, setValidateAllRunning] = useState(false);
  const [validateAllResult,  setValidateAllResult]  = useState<ValidateAllResponse | null>(null);
  const [validateAllError,   setValidateAllError]   = useState<string | null>(null);

  // Re-upload
  const [showReupload, setShowReupload] = useState(false);

  // Feature #10: batch auto-generate
  const [showBatchGenerate, setShowBatchGenerate] = useState(false);
  const [batchGenRunning,   setBatchGenRunning]   = useState(false);
  const [batchGenTotal,     setBatchGenTotal]     = useState(0);
  const [batchGenCompleted, setBatchGenCompleted] = useState(0);
  const [batchGenGenerated, setBatchGenGenerated] = useState(0);
  const [batchGenFailed,    setBatchGenFailed]    = useState(0);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const selectedChunkIdx   = selected ? chunks.findIndex((c) => c.index === selected.index) : -1;
  const selectedChunkRow   = selectedChunkIdx >= 0 ? chunks[selectedChunkIdx] : null;
  const selectedChunkTitle = selectedChunkRow ? `${selectedChunkRow.label} (#${selectedChunkRow.index})` : null;

  // ── Feature #9: Session persistence ──────────────────────────────────────
  // On mount, try to restore the last session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!saved) return;

    // Try to re-attach to the saved session
    (async () => {
      try {
        const statusResp = await pollStatus(saved);
        if (statusResp.status === "done") {
          const chunksResp = await fetchChunks(saved);
          setSessionId(saved);
          setSourceName(chunksResp.source_name);
          setChunks(chunksResp.chunks.map((c) => ({ ...c, reviewStatus: "pending" as ReviewStatus })));
          setSummary(chunksResp.summary);
          setStage("review");
          showToast(`Session restored: ${chunksResp.source_name}`);
        } else {
          // Session exists but isn't done (e.g. still processing) — clear it
          localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch {
        // Session expired or not found — clear
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session_id whenever it changes
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    }
  }, [sessionId]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const findXmlLineForDiffText = useCallback((xml: string, rawText: string): number | null => {
    const q = rawText.trim();
    if (!q) return null;
    const normalise = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const tokens = normalise(q).split(" ").filter((w) => w.length > 2).slice(0, 10);
    if (tokens.length === 0) return null;
    const key   = tokens.join(" ");
    const lines = xml.split("\n");
    const direct = lines.findIndex((l) => normalise(l).includes(key));
    if (direct >= 0) return direct + 1;
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const ln    = normalise(lines[i]);
      const score = tokens.reduce((acc, t) => (ln.includes(t) ? acc + 1 : acc), 0);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestScore >= 2 ? bestIdx + 1 : null;
  }, []);

  const getChunkPageBounds = useCallback((chunk: ChunkDetail) => {
    const startPage = (chunk.page_start ?? 0) + 1;
    const endPage   = Math.max(startPage, chunk.page_end ?? startPage);
    return { startPage, endPage };
  }, []);

  const getTargetPageForDiffLine = useCallback((chunk: ChunkDetail, idx: number): number => {
    const { startPage, endPage } = getChunkPageBounds(chunk);
    const span  = Math.max(1, endPage - startPage + 1);
    const total = Math.max(1, chunk.diff_lines.length);
    const ratio = total <= 1 ? 0 : idx / (total - 1);
    return Math.max(startPage, Math.min(endPage, startPage + Math.floor(ratio * span)));
  }, [getChunkPageBounds]);

  // ── Upload complete → kick off processing ──────────────────────────────────

  const handleUploaded = useCallback(async (response: UploadResponse, oldPdf: File, newPdf: File) => {
    setSessionId(response.session_id);
    setSourceName(response.source_name);
    setOldPdfFile(oldPdf);
    setNewPdfFile(newPdf);
    setStage("processing");

    try {
      await startProcessing(response.session_id);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to start processing", "error");
      setStage("upload");
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await pollStatus(response.session_id);
        setProgress(status.progress);
        if (status.status === "done") {
          clearInterval(pollRef.current!);
          setSummary(status.summary as SessionSummary);
          setTimeout(async () => {
            try {
              const cr = await fetchChunks(response.session_id);
              setChunks(cr.chunks.map((c) => ({ ...c, reviewStatus: "pending" as ReviewStatus })));
              setStage("review");
            } catch (err: unknown) {
              showToast(err instanceof Error ? err.message : "Failed to load chunks", "error");
              setStage("upload");
            }
          }, 800);
        } else if (status.status === "error") {
          clearInterval(pollRef.current!);
          showToast(status.error ?? "Processing failed", "error");
          setStage("upload");
        }
      } catch { /* transient */ }
    }, 1500);
  }, [showToast]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Select chunk → load full detail ───────────────────────────────────────

  const handleSelectChunk = useCallback(async (chunk: ChunkRow) => {
    if (!sessionId) return;
    setLoadingChunk(true);
    try {
      const resp = await fetchChunkDetail(sessionId, chunk.index);
      setSelected(resp.chunk);
      setXmlDraft(resp.chunk.xml_saved ?? resp.chunk.xml_content);
      setSelectedDiffLineIndex(null);
      setXmlFocusLine(null);
      setOldHighlightText("");
      setNewHighlightText("");
      setXmlHighlightText("");
      const { startPage } = getChunkPageBounds(resp.chunk);
      setOldPdfTargetPage(startPage);
      setNewPdfTargetPage(startPage);

      // Feature #1: mark as reviewed (if not already saved)
      setChunks((prev) =>
        prev.map((c) =>
          c.index === chunk.index && c.reviewStatus === "pending"
            ? { ...c, reviewStatus: "reviewed" }
            : c,
        ),
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to load chunk", "error");
    } finally {
      setLoadingChunk(false);
    }
  }, [sessionId, showToast, getChunkPageBounds]);

  // Auto-select first chunk when review data loads
  useEffect(() => {
    if (stage !== "review" || !sessionId || chunks.length === 0 || selected) return;
    void handleSelectChunk(chunks[0]);
  }, [stage, sessionId, chunks, selected, handleSelectChunk]);

  // ── Feature #5: Keyboard navigation (Alt+← / Alt+→) ──────────────────────

  const handlePrevChunk = useCallback(() => {
    if (selectedChunkIdx <= 0) return;
    void handleSelectChunk(chunks[selectedChunkIdx - 1]);
  }, [chunks, selectedChunkIdx, handleSelectChunk]);

  const handleNextChunk = useCallback(() => {
    if (selectedChunkIdx < 0 || selectedChunkIdx >= chunks.length - 1) return;
    void handleSelectChunk(chunks[selectedChunkIdx + 1]);
  }, [chunks, selectedChunkIdx, handleSelectChunk]);

  useEffect(() => {
    if (stage !== "review") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")    { e.preventDefault(); handlePrevChunk(); }
      if (e.key === "ArrowRight" || e.key === "ArrowDown")  { e.preventDefault(); handleNextChunk(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, handlePrevChunk, handleNextChunk]);

  // ── Feature #10: Jump to chunk by index (from ValidateAll "Go →") ─────────

  const handleJumpToChunk = useCallback((index: number) => {
    const chunk = chunks.find((c) => c.index === index);
    if (chunk) void handleSelectChunk(chunk);
  }, [chunks, handleSelectChunk]);

  // ── Auto-generate XML ──────────────────────────────────────────────────────

  const handleAutoGenerate = useCallback(async (lineContext?: {
    diff_index?: number;
    diff_text?: string;
    old_text?: string;
    new_text?: string;
    category?: string;
  }) => {
    if (!sessionId || !selected) return;
    setIsGenerating(true);
    try {
      const resp = await autoGenerateXml(sessionId, selected.index, lineContext);
      setXmlDraft(resp.suggested_xml);
      showToast(resp.generation_scope === "line"
        ? "Line-based XML generation applied. Review and save."
        : "AI-generated XML applied. Review and save.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Auto-generate failed", "error");
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId, selected, showToast]);

  // ── Feature #10: Batch auto-generate all changed chunks ───────────────────

  const handleBatchGenerate = useCallback(async () => {
    if (!sessionId) return;
    const changedIds = chunks.filter((c) => c.has_changes).map((c) => c.index);
    if (changedIds.length === 0) {
      showToast("No changed chunks to generate.", "error");
      return;
    }
    setShowBatchGenerate(true);
    setBatchGenRunning(true);
    setBatchGenTotal(changedIds.length);
    setBatchGenCompleted(0);
    setBatchGenGenerated(0);
    setBatchGenFailed(0);

    const result = await autoGenerateAllChanged(
      sessionId,
      changedIds,
      (completed, total) => {
        setBatchGenCompleted(completed);
        setBatchGenTotal(total);
      },
    );
    setBatchGenGenerated(result.generated);
    setBatchGenFailed(result.failed);
    setBatchGenRunning(false);

    showToast(
      `Batch complete: ${result.generated} generated, ${result.failed} failed.`,
      result.failed > 0 ? "error" : "success",
    );
  }, [sessionId, chunks, showToast]);

  // ── Diff line selection ────────────────────────────────────────────────────

  const handleDiffLineSelect = useCallback((line: DiffLine, index: number) => {
    const rawText = line.text.trim();
    setSelectedDiffLineIndex(index);
    let oldText = (line.old_text ?? "").trim();
    let newText = (line.new_text ?? "").trim();

    // Backward compatibility for payloads that only include "text" with old -> new format.
    if (!oldText && !newText) {
      oldText = rawText;
      newText = rawText;
      if (line.type === "modified") {
        const at = rawText.indexOf(" -> ");
        if (at > -1) {
          oldText = rawText.slice(0, at).trim();
          newText = rawText.slice(at + 4).trim();
        }
      } else if (line.type === "removed") {
        newText = "";
      } else if (line.type === "added") {
        oldText = "";
      }
    }

    setOldHighlightText(oldText);
    setNewHighlightText(newText);
    setXmlHighlightText(newText || oldText);
    if (selected) {
      const fallback = getTargetPageForDiffLine(selected, index);
      setOldPdfTargetPage(line.old_page ?? fallback);
      setNewPdfTargetPage(line.new_page ?? fallback);
    }
    const tLine = findXmlLineForDiffText(xmlDraft, newText || oldText);
    if (tLine != null) {
      setXmlFocusLine(tLine);
      setXmlFocusRequestId((v) => v + 1);
    }
  }, [findXmlLineForDiffText, xmlDraft, selected, getTargetPageForDiffLine]);

  const handleGenerateFromDiffLine = useCallback((line: DiffLine, index: number) => {
    handleDiffLineSelect(line, index);
    const fallbackText = line.text.trim();
    const oldText = (line.old_text ?? "").trim();
    const newText = (line.new_text ?? "").trim();
    void handleAutoGenerate({
      diff_index: index,
      diff_text: fallbackText,
      old_text: oldText || undefined,
      new_text: newText || undefined,
      category: line.category,
    });
  }, [handleDiffLineSelect, handleAutoGenerate]);

  // ── Save XML (Feature #1: marks chunk as saved) ───────────────────────────

  const handleSave = useCallback(async (xmlContent: string) => {
    if (!sessionId || !selected) return;
    setIsSaving(true);
    try {
      await saveChunkXml(sessionId, selected.index, xmlContent);
      // Feature #1: mark chunk as saved
      setChunks((prev) =>
        prev.map((c) =>
          c.index === selected.index ? { ...c, has_changes: false, reviewStatus: "saved" } : c,
        ),
      );
      showToast("XML saved successfully");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, selected, showToast]);

  // ── Feature #6: Auto-save draft (does NOT mark as "saved" — just persists draft) ──

  const handleAutoSave = useCallback((xmlContent: string) => {
    // Silently persist draft to state so navigating away and back doesn't lose it
    setXmlDraft(xmlContent);
  }, []);

  // ── Validate chunk XML ─────────────────────────────────────────────────────

  const handleValidate = useCallback(async () => {
    if (!sessionId || !selected) return;
    setIsValidating(true);
    try {
      const resp = await validateChunkXml(sessionId, selected.index);
      setValidateResult(resp);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Validation failed", "error");
    } finally {
      setIsValidating(false);
    }
  }, [sessionId, selected, showToast]);

  const handleValidateAll = useCallback(async () => {
    if (!sessionId) return;
    setShowValidateAll(true);
    setValidateAllRunning(true);
    setValidateAllResult(null);
    setValidateAllError(null);
    try {
      const resp = await validateAllChunks(sessionId);
      setValidateAllResult(resp);
      showToast(
        resp.needs_action_count > 0
          ? `Validation: ${resp.needs_action_count} chunk(s) need action.`
          : "Validation: all chunks look good.",
        resp.needs_action_count > 0 ? "error" : "success",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Validate-all failed";
      setValidateAllError(msg);
      showToast(msg, "error");
    } finally {
      setValidateAllRunning(false);
    }
  }, [sessionId, showToast]);

  // ── Feature #8: Download All ───────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    if (!sessionId || !selected) return;
    downloadChunkXml(sessionId, selected.index);
    showToast("Download started");
  }, [sessionId, selected, showToast]);

  const handleDownloadAll = useCallback(async () => {
    if (!sessionId) return;
    showToast("Preparing download…");
    try {
      await downloadAllChunks(sessionId, sourceName, chunks.map((c) => c.index));
      showToast("Download started");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Download failed", "error");
    }
  }, [sessionId, sourceName, chunks, showToast]);

  // ── Re-upload done → re-process ────────────────────────────────────────────

  const handleReuploadDone = useCallback(async () => {
    if (!sessionId) return;
    setShowReupload(false);
    setStage("processing");
    setProgress(0);
    setSummary(null);
    setSelected(null);
    setChunks([]);
    try {
      await startProcessing(sessionId);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to re-start", "error");
      setStage("review");
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const status = await pollStatus(sessionId);
        setProgress(status.progress);
        if (status.status === "done") {
          clearInterval(pollRef.current!);
          setSummary(status.summary as SessionSummary);
          setTimeout(async () => {
            try {
              const cr = await fetchChunks(sessionId);
              setChunks(cr.chunks.map((c) => ({ ...c, reviewStatus: "pending" as ReviewStatus })));
              setStage("review");
            } catch (err: unknown) {
              showToast(err instanceof Error ? err.message : "Failed to load chunks", "error");
              setStage("review");
            }
          }, 800);
        } else if (status.status === "error") {
          clearInterval(pollRef.current!);
          showToast(status.error ?? "Processing failed", "error");
          setStage("review");
        }
      } catch { /* transient */ }
    }, 1500);
  }, [sessionId, showToast]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setStage("upload");
    setSessionId(null);
    setProgress(0);
    setSummary(null);
    setChunks([]);
    setSelected(null);
    setXmlDraft("");
    setXmlFocusLine(null);
    setXmlFocusRequestId(0);
    setSelectedDiffLineIndex(null);
    setOldPdfTargetPage(null);
    setNewPdfTargetPage(null);
    setOldHighlightText("");
    setNewHighlightText("");
    setXmlHighlightText("");
    setOldPdfFile(null);
    setNewPdfFile(null);
    setValidateResult(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ background: "linear-gradient(180deg, #060d1a 0%, #0a1628 100%)" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: "rgba(26,143,209,0.12)", background: "rgba(6,13,26,0.9)" }}
      >
        {/* Left: title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#1a8fd1,#146da3)" }}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">
              {stage === "review" && selectedChunkTitle ? selectedChunkTitle : "AutoCompare"}
            </h1>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {stage === "upload"      ? "Upload files to begin"
               : stage === "processing" ? `Processing ${sourceName}…`
               : selectedChunkTitle ?? `${sourceName} — ${chunks.length} chunks`}
            </p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {stage === "review" && (
            <>
              {/* Summary badges */}
              {summary && (
                <div className="hidden sm:flex items-center gap-2 mr-2">
                  <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                    {summary.changed} changed
                  </span>
                  <span className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-medium">
                    {summary.unchanged} unchanged
                  </span>
                </div>
              )}

              {/* Chunk navigator — Feature #5 keyboard hint */}
              {chunks.length > 0 && (
                <div className="hidden md:flex items-center gap-1.5 mr-1">
                  <button
                    onClick={handlePrevChunk}
                    disabled={selectedChunkIdx <= 0 || loadingChunk}
                    title="Previous chunk (Alt+←)"
                    className="px-2 py-1 rounded-md text-[10px] font-semibold text-slate-300 border border-slate-700/70 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <span className="text-[10px] text-slate-500 min-w-[64px] text-center">
                    {selectedChunkIdx >= 0 ? `${selectedChunkIdx + 1}/${chunks.length}` : `0/${chunks.length}`}
                  </span>
                  <button
                    onClick={handleNextChunk}
                    disabled={selectedChunkIdx < 0 || selectedChunkIdx >= chunks.length - 1 || loadingChunk}
                    title="Next chunk (Alt+→)"
                    className="px-2 py-1 rounded-md text-[10px] font-semibold text-slate-300 border border-slate-700/70 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              )}

              {/* Validate All */}
              {chunks.length > 0 && (
                <button
                  onClick={handleValidateAll}
                  disabled={validateAllRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                  style={{ background: "linear-gradient(135deg,#8b5cf6,#6d28d9)", boxShadow: "0 2px 8px rgba(139,92,246,0.3)" }}
                >
                  {validateAllRunning ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent border-white animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  Validate All
                </button>
              )}

              {/* Validate selected chunk */}
              {selected && (
                <button
                  onClick={handleValidate}
                  disabled={isValidating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-200 border border-violet-500/30 hover:bg-violet-500/10 transition-all disabled:opacity-50"
                >
                  {isValidating ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent border-violet-200 animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  Validate Chunk
                </button>
              )}

              {/* Feature #10: Batch Auto-Generate */}
              {chunks.some((c) => c.has_changes) && (
                <button
                  onClick={handleBatchGenerate}
                  disabled={batchGenRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-200 border border-violet-500/30 hover:bg-violet-500/10 transition-all"
                  title="Auto-generate XML for all changed chunks"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate All
                </button>
              )}

              {/* Download current chunk */}
              {selected && (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                  style={{ background: "linear-gradient(135deg,#1a8fd1,#146da3)", boxShadow: "0 2px 8px rgba(26,143,209,0.3)" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
              )}

              {/* Save current chunk XML */}
              {selected && (
                <button
                  onClick={() => handleSave(xmlDraft)}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#059669,#047857)", boxShadow: "0 2px 8px rgba(5,150,105,0.3)" }}
                >
                  {isSaving ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent border-white animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  Save
                </button>
              )}

              {/* Feature #8: Download All */}
              {chunks.length > 0 && (
                <button
                  onClick={handleDownloadAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/10 transition-all"
                  title="Download all chunks as ZIP"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download All
                </button>
              )}

              {/* Re-upload */}
              <button
                onClick={() => setShowReupload(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Re-upload
              </button>
            </>
          )}

          {stage !== "upload" && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-700/50 hover:border-slate-600 transition-colors"
              title="Start a new session (clears saved session)"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              New Session
            </button>
          )}
        </div>
      </header>

      {/* ── Upload stage ──────────────────────────────────────────────────────── */}
      {stage === "upload" && (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="w-full max-w-2xl">
            <FileUploadPanel onUploaded={handleUploaded} />
          </div>
        </div>
      )}

      {/* ── Processing stage ──────────────────────────────────────────────────── */}
      {stage === "processing" && (
        <ProcessingOverlay progress={progress} sourceName={sourceName} summary={summary} />
      )}

      {/* ── Review stage ──────────────────────────────────────────────────────── */}
      {stage === "review" && (
        <div className="flex-1 flex overflow-hidden">
          {/* Main panels area */}
          {selected ? (
            loadingChunk ? (
              <div className="flex-1 flex items-center justify-center gap-3 text-slate-400">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
                <span className="text-sm">Loading chunk…</span>
              </div>
            ) : (
              <div className="flex-1 flex overflow-hidden gap-1 p-1">
                {/* Panel: Diff View */}
                <div className="flex-shrink-0 overflow-hidden" style={{ width: "280px" }}>
                  <DiffPanel
                    diffLines={selected.diff_lines}
                    chunkLabel={selected.label}
                    changeType={selected.change_type}
                    similarity={selected.similarity}
                    selectedLineIndex={selectedDiffLineIndex}
                    onSelectLine={handleDiffLineSelect}
                    onGenerateFromLine={handleGenerateFromDiffLine}
                  />
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1 overflow-hidden">
                  <div className="flex-[1.05] min-h-0 flex gap-1 overflow-hidden">
                    {/* Panel: Old PDF */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <PdfViewer
                        file={oldPdfFile}
                        label="Old PDF"
                        color="blue"
                        pageStart={selected.page_start}
                        pageEnd={selected.page_end}
                        targetPage={oldPdfTargetPage ?? undefined}
                        highlightText={oldHighlightText || undefined}
                      />
                    </div>

                    {/* Panel: New PDF */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <PdfViewer
                        file={newPdfFile}
                        label="New PDF"
                        color="violet"
                        pageStart={selected.page_start}
                        pageEnd={selected.page_end}
                        targetPage={newPdfTargetPage ?? undefined}
                        highlightText={newHighlightText || undefined}
                      />
                    </div>
                  </div>

                  {/* Panel: XML Editor */}
                  <div className="flex-[0.95] min-h-0 overflow-hidden">
                    <XmlEditor
                      value={xmlDraft}
                      onChange={setXmlDraft}
                      onSave={handleSave}
                      onAutoSave={handleAutoSave}
                      focusLine={xmlFocusLine}
                      focusRequestId={xmlFocusRequestId}
                      highlightText={xmlHighlightText || undefined}
                      height="100%"
                    />
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="flex-1 flex items-center justify-center gap-3 text-slate-500">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
              <span className="text-sm">Preparing first chunk…</span>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}

      {validateResult && (
        <ValidateModal data={validateResult} onClose={() => setValidateResult(null)} />
      )}

      {showValidateAll && (
        <ValidateAllModal
          running={validateAllRunning}
          result={validateAllResult}
          error={validateAllError}
          onClose={() => { if (!validateAllRunning) setShowValidateAll(false); }}
          onJumpToChunk={handleJumpToChunk}
        />
      )}

      {showReupload && sessionId && (
        <ReuploadModal
          sessionId={sessionId}
          onDone={handleReuploadDone}
          onClose={() => setShowReupload(false)}
        />
      )}

      {/* Feature #10: Batch generate modal */}
      {showBatchGenerate && (
        <BatchGenerateModal
          total={batchGenTotal}
          completed={batchGenCompleted}
          generated={batchGenGenerated}
          failed={batchGenFailed}
          running={batchGenRunning}
          onClose={() => setShowBatchGenerate(false)}
        />
      )}

      {toast && (
        <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}