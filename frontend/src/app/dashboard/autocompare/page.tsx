"use client";
/**
 * AutoCompare Page v2
 *
 * Flow
 * ────
 *   Upload  →  Processing  →  ChangedChunksModal  →  Review (4-panel editor)
 *
 * The ChangedChunksModal pops automatically when processing finishes.
 * It lists every chunk that has differences (changed only) with:
 *   • Chunk label and source file
 *   • Change-type badge (added / removed / modified)
 *   • Similarity bar
 *   • Page range
 * Clicking a row closes the modal and jumps straight to that chunk's diff.
 * Users can also "Review All" to dismiss the modal and work through the list.
 *
 * Performance fixes vs v1
 * ────────────────────────
 * • Blob URLs revoked on replacement (no memory leak).
 * • findXmlLine debounced 80 ms (no sync full-string scan on every click).
 * • Auto-select deferred via setTimeout(0); picks first CHANGED chunk.
 * • Batch auto-generate yields between requests (yieldToMain).
 * • Poll interval 2 000 ms (was 1 500).
 * • Stale intervals cleaned up via stopPolling().
 * • ValidateAll table windowed to 100 rows.
 * • selectedChunkIdx wrapped in useMemo.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";

import { useTheme } from "../../../context/ThemContext";
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
  autoGenerateXml,
  downloadAllChunks,
  downloadChunkXml,
  fetchChunkDetail,
  fetchChunks,
  getPdfUrl,
  pollStatus,
  reuploadXmlFiles,
  saveChunkXml,
  startProcessing,
  validateAllChunks,
  validateChunkXml,
} from "../../../components/autocompare/api";

const FileUploadPanel = dynamic(() => import("../../../components/autocompare/FileUploadPanel"), { ssr: false });
const PdfViewer       = dynamic(() => import("../../../components/autocompare/PdfViewer"),       { ssr: false });
const XmlEditor       = dynamic(() => import("../../../components/autocompare/XmlEditor"),       { ssr: false });
const DiffPanel       = dynamic(() => import("../../../components/autocompare/DiffPanel"),       { ssr: false });
const ChunkList       = dynamic(() => import("../../../components/autocompare/ChunkList"),       { ssr: false });

const SESSION_KEY    = "autocompare_session_id";
const POLL_MS        = 2000;

type Stage = "upload" | "processing" | "review";

// ── Helpers ───────────────────────────────────────────────────────────────────

function swapBlobUrl(prev: string | null, next: string | null): string | null {
  if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
  return next;
}

function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}


// ── Changed-chunks modal ───────────────────────────────────────────────────────
// Shown automatically once processing finishes. Lists only changed chunks.

function ChangedChunksModal({
  chunks,
  summary,
  onSelect,
  onClose,
}: {
  chunks: ChunkRow[];
  summary: SessionSummary | null;
  onSelect: (chunk: ChunkRow) => void;
  onClose: () => void;
}) {
  const changed = useMemo(
    () => chunks.filter(c => c.has_changes),
    [chunks],
  );

  const changeBadge: Record<string, string> = {
    added:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    removed:  "bg-red-500/20 text-red-300 border-red-500/30",
    modified: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl bg-white dark:bg-[rgba(8,18,36,0.98)] border-gray-200 dark:border-[rgba(26,143,209,0.25)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[rgba(26,143,209,0.15)]">
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Chunks with Differences</h2>
            <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
              {changed.length} of {chunks.length} chunks have changes.
              {summary && ` Old: ${summary.old_pages} pp · New: ${summary.new_pages} pp`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {summary && (
              <div className="flex items-center gap-1.5 text-[10px] mr-2">
                <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25 font-medium">
                  {summary.changed} changed
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-medium">
                  {summary.unchanged} unchanged
                </span>
              </div>
            )}
            <button onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background:"linear-gradient(135deg,#1a8fd1,#146da3)" }}>
              Review All
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor:"rgba(255,255,255,0.04)" }}>
          {changed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No differences found — all chunks are identical.</p>
            </div>
          ) : (
            changed.map(chunk => {
              const simPct   = Math.round(chunk.similarity * 100);
              const simColor = simPct >= 90 ? "#22c55e" : simPct >= 60 ? "#f59e0b" : "#ef4444";
              return (
                <button
                  key={chunk.index}
                  type="button"
                  onClick={() => { onSelect(chunk); onClose(); }}
                  className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  {/* Index */}
                  <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-slate-400"
                    style={{ background:"rgba(26,143,209,0.1)", border:"1px solid rgba(26,143,209,0.2)" }}>
                    {chunk.index}
                  </span>

                  {/* Label + file */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{chunk.label}</p>
                    <p className="text-[9px] text-gray-400 dark:text-slate-500 truncate">{chunk.original_filename}</p>
                  </div>

                  {/* Change type */}
                  <span className={`flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-semibold
                    ${changeBadge[chunk.change_type] ?? changeBadge.modified}`}>
                    {chunk.change_type}
                  </span>

                  {/* Similarity bar */}
                  <div className="flex-shrink-0 flex items-center gap-1.5 w-24">
                    <div className="flex-1 h-1 bg-slate-700/50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{ width:`${simPct}%`, background:simColor }} />
                    </div>
                    <span className="text-[9px] text-gray-400 dark:text-slate-500 w-7 text-right">{simPct}%</span>
                  </div>

                  {/* Page range */}
                  <span className="flex-shrink-0 text-[9px] text-gray-400 dark:text-slate-500">
                    pp.{chunk.page_start + 1}–{chunk.page_end}
                  </span>

                  {/* Arrow */}
                  <svg className="flex-shrink-0 w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-gray-100 dark:border-[rgba(255,255,255,0.05)] text-[10px] text-gray-400 dark:text-slate-600"
          style={{ borderColor:"rgba(255,255,255,0.05)" }}>
          Click a chunk to open its diff · Press "Review All" to browse the full list
        </div>
      </div>
    </div>
  );
}

// ── Processing overlay ────────────────────────────────────────────────────────

function ProcessingOverlay({
  progress, sourceName, summary,
}: {
  progress: number; sourceName: string; summary: SessionSummary | null;
}) {
  const pct = Math.min(100, Math.max(0, progress));
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
      <div className="w-full max-w-lg p-8 rounded-2xl border space-y-6"
        style={{ background:"rgba(11,26,46,0.9)", borderColor:"rgba(26,143,209,0.2)" }}>
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
              {pct < 20 ? "Uploading files…"
                : pct < 40 ? "Extracting PDF text + emphasis…"
                : pct < 60 ? "Detecting XML sections…"
                : pct < 90 ? "Aligning & comparing chunks…"
                : "Finalising…"}
            </span>
            <span className="font-semibold text-[#1a8fd1]">{pct}%</span>
          </div>
          <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width:`${pct}%`,
                background:"linear-gradient(90deg,#1a8fd1,#42b4f5)",
                boxShadow: pct > 0 ? "0 0 10px rgba(26,143,209,0.5)" : "none" }} />
          </div>
        </div>
        {[
          { label:"Upload files",          done: pct >= 1  },
          { label:"Extract PDF text",      done: pct >= 20 },
          { label:"Detect XML sections",   done: pct >= 40 },
          { label:"Align to PDF pages",    done: pct >= 60 },
          { label:"Compare & diff",        done: pct >= 90 },
          { label:"Build chunk index",     done: pct >= 100 },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-2.5 text-xs">
            {step.done
              ? <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              : <div className="w-4 h-4 rounded-full border border-slate-600 flex-shrink-0" />
            }
            <span className={step.done ? "text-slate-300" : "text-slate-500"}>{step.label}</span>
          </div>
        ))}
        {summary && pct >= 100 && (
          <div className="pt-2 border-t border-slate-700/50 grid grid-cols-3 gap-3">
            {[
              { label:"Total",     value:summary.total,     color:"text-white" },
              { label:"Changed",   value:summary.changed,   color:"text-amber-300" },
              { label:"Unchanged", value:summary.unchanged, color:"text-emerald-300" },
            ].map(s => (
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

function Toast({ message, type, onClose }: {
  message: string; type: "success"|"error"; onClose: () => void;
}) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium"
      style={type==="success"
        ? {background:"rgba(16,185,129,0.15)",borderColor:"rgba(16,185,129,0.3)",color:"#6ee7b7"}
        : {background:"rgba(239,68,68,0.15)",borderColor:"rgba(239,68,68,0.3)",color:"#fca5a5"}}>
      {type==="success"
        ? <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
        : <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
      }
      {message}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

// ── Validate modal (single chunk) ─────────────────────────────────────────────

function ValidateModal({ data, onClose }: { data: ValidateResponse; onClose: () => void }) {
  const S: Record<string,{icon:string;color:string;label:string}> = {
    updated:         {icon:"✓",color:"text-emerald-300",label:"Updated — Changes Applied"},
    no_changes:      {icon:"=",color:"text-slate-400",  label:"No Changes Detected"},
    saved_unchanged: {icon:"✓",color:"text-blue-300",   label:"Saved — Matches Original"},
    needs_review:    {icon:"!",color:"text-amber-300",  label:"Needs Further Review"},
    pending:         {icon:"?",color:"text-slate-400",  label:"Pending"},
  };
  const st = S[data.status] ?? S.pending;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4 bg-white dark:bg-[rgba(11,26,46,0.97)] border-gray-200 dark:border-[rgba(26,143,209,0.25)]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${st.color}`}
            style={{background:"rgba(26,143,209,0.1)"}}>
            {st.icon}
          </div>
          <div>
            <h3 className={`text-sm font-bold ${st.color}`}>{st.label}</h3>
            <p className="text-xs text-slate-400">{data.message}</p>
          </div>
        </div>
        <div className="text-xs">
          <span className={data.xml_valid ? "text-emerald-300" : "text-red-300"}>
            {data.xml_valid ? "✓ Valid XML" : "✗ Invalid XML"}
          </span>
        </div>
        {data.xml_errors.length > 0 && (
          <div className="text-xs text-red-300 space-y-1 bg-red-500/10 rounded-lg p-3 border border-red-500/20 max-h-32 overflow-y-auto">
            {data.xml_errors.map((e,i) => <p key={i}>{e}</p>)}
          </div>
        )}
        {data.change_details.length > 0 && (
          <div className="text-xs text-slate-300 space-y-1 bg-slate-800/40 rounded-lg p-3 max-h-40 overflow-y-auto">
            {data.change_details.map((d,i) => <p key={i}>• {d}</p>)}
          </div>
        )}
        <button onClick={onClose} className="w-full py-2 rounded-xl text-xs font-semibold text-white"
          style={{background:"linear-gradient(135deg,#1a8fd1,#146da3)"}}>
          Close
        </button>
      </div>
    </div>
  );
}

// ── Validate-all modal ────────────────────────────────────────────────────────

function ValidateAllModal({
  running, result, error, onClose, onJumpToChunk,
}: {
  running: boolean; result: ValidateAllResponse|null; error:string|null;
  onClose:()=>void; onJumpToChunk?:(index:number)=>void;
}) {
  const [filter, setFilter] = useState<"all"|"needs_review"|"invalid_xml"|"updated"|"no_changes">("all");
  const [limit,  setLimit]  = useState(100);

  const filtered = useMemo(() => {
    const all = result?.results ?? [];
    return all.filter(r => {
      if (filter==="needs_review") return r.needs_further_changes;
      if (filter==="invalid_xml") return !r.xml_valid;
      if (filter==="updated")     return r.status==="updated";
      if (filter==="no_changes")  return r.status==="no_changes";
      return true;
    });
  }, [result, filter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border p-6 space-y-4 bg-white dark:bg-[rgba(11,26,46,0.97)] border-gray-200 dark:border-[rgba(26,143,209,0.25)]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Validate All XML Chunks</h3>
          <button onClick={onClose} className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white">✕ Close</button>
        </div>
        {running && (
          <div className="flex items-center gap-3 text-sm text-slate-300 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
            Checking all chunks…
          </div>
        )}
        {error && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">{error}</div>}
        {result && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
              {[
                {label:"Total",          value:result.total,                   cls:"bg-slate-800/40 text-white"},
                {label:"Updated",        value:result.summary.updated,         cls:"bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"},
                {label:"No Changes",     value:result.summary.no_changes,      cls:"bg-slate-500/10 border border-slate-500/20 text-slate-300"},
                {label:"Saved Same",     value:result.summary.saved_unchanged, cls:"bg-blue-500/10 border border-blue-500/20 text-blue-300"},
                {label:"Needs Review",   value:result.summary.needs_review,    cls:"bg-amber-500/10 border border-amber-500/20 text-amber-300"},
                {label:"Invalid XML",    value:result.summary.invalid_xml,     cls:"bg-red-500/10 border border-red-500/20 text-red-300"},
              ].map(s => (
                <div key={s.label} className={`rounded-lg p-2 ${s.cls}`}>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[10px] text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all","needs_review","invalid_xml","updated","no_changes"] as const).map(f => {
                const labels: Record<string,string> = {
                  all:`All (${result.results.length})`,
                  needs_review:`Needs Review (${result.summary.needs_review})`,
                  invalid_xml:`Invalid XML (${result.summary.invalid_xml})`,
                  updated:`Updated (${result.summary.updated})`,
                  no_changes:`No Changes (${result.summary.no_changes})`,
                };
                return (
                  <button key={f} onClick={() => { setFilter(f); setLimit(100); }}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold border ${
                      filter===f ? "text-white border-[#1a8fd1] bg-[#1a8fd1]/20" : "text-slate-300 border-slate-600/80"
                    }`}>
                    {labels[f]}
                  </button>
                );
              })}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700/60">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-slate-900/70 text-gray-500 dark:text-slate-400 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Chunk</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">XML</th>
                    <th className="text-left px-3 py-2">Message</th>
                    <th className="px-3 py-2"/>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map(r => (
                    <tr key={r.chunk_id} className="border-t border-gray-100 dark:border-slate-800/80 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-300">#{r.index} {r.label}</td>
                      <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300">{r.status}</span></td>
                      <td className="px-3 py-2"><span className={r.xml_valid ? "text-emerald-300" : "text-red-300"}>{r.xml_valid ? "valid" : "invalid"}</span></td>
                      <td className="px-3 py-2 text-gray-500 dark:text-slate-400 truncate max-w-[160px]">{r.message}</td>
                      <td className="px-3 py-2">
                        {onJumpToChunk && (
                          <button onClick={() => { onJumpToChunk(r.index); onClose(); }}
                            className="text-[10px] text-[#1a8fd1] hover:text-white">Go →</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length > limit && (
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-center">
                        <button onClick={() => setLimit(n => n+100)}
                          className="text-[10px] text-[#1a8fd1] hover:text-white">
                          Show {Math.min(100, filtered.length-limit)} more…
                        </button>
                      </td>
                    </tr>
                  )}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 dark:text-slate-500">No chunks match.</td></tr>
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

function ReuploadModal({ sessionId, onDone, onClose }: {
  sessionId:string; onDone:()=>void; onClose:()=>void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles]     = useState<File[]>([]);
  const [uploading, setUpl]   = useState(false);
  const [pct, setPct]         = useState(0);
  const [error, setError]     = useState<string|null>(null);

  const go = async () => {
    if (!files.length) return;
    setUpl(true); setError(null);
    try { await reuploadXmlFiles(sessionId, files, setPct); onDone(); }
    catch(e:unknown) { setError(e instanceof Error ? e.message : "Re-upload failed"); }
    finally { setUpl(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4 bg-white dark:bg-[rgba(11,26,46,0.97)] border-gray-200 dark:border-[rgba(26,143,209,0.25)]"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Re-upload XML Chunks</h3>
        <div className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-emerald-400 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 cursor-pointer hover:border-emerald-500 dark:hover:border-emerald-400/50 transition-colors"
          onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept=".xml" multiple className="hidden"
            onChange={e => setFiles(Array.from(e.target.files ?? []))} />
          <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
          </svg>
          {files.length > 0
            ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{files.length} file{files.length>1?"s":""} selected</p>
            : <p className="text-xs text-gray-400 dark:text-slate-500">Click to select XML files</p>}
        </div>
        {uploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Uploading…</span>
              <span className="text-[#1a8fd1] font-semibold">{pct}%</span>
            </div>
            <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{width:`${pct}%`,background:"linear-gradient(90deg,#1a8fd1,#42b4f5)"}}/>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-300 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 border border-slate-600 hover:text-white hover:border-slate-500 transition-colors">Cancel</button>
          <button onClick={go} disabled={!files.length||uploading} className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
            style={{background:"linear-gradient(135deg,#1a8fd1,#146da3)"}}>
            {uploading ? "Uploading…" : "Upload & Re-process"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Batch generate modal ──────────────────────────────────────────────────────

function BatchGenerateModal({ total, completed, generated, failed, running, onClose }: {
  total:number; completed:number; generated:number; failed:number;
  running:boolean; onClose:()=>void;
}) {
  const pct = total > 0 ? Math.round((completed/total)*100) : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4 bg-white dark:bg-[rgba(11,26,46,0.95)] border-violet-200 dark:border-[rgba(139,92,246,0.3)]">
        <div className="flex items-center gap-3">
          {running
            ? <div className="w-8 h-8 rounded-full border-2 border-t-transparent border-violet-400 animate-spin flex-shrink-0"/>
            : <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 text-violet-300">✓</div>}
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">{running ? "Generating XML for all changed chunks…" : "Batch Generation Complete"}</p>
            <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{completed}/{total} · {generated} generated · {failed} failed</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Progress</span>
            <span className="text-violet-300 font-semibold">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300"
              style={{width:`${pct}%`,background:"linear-gradient(90deg,#8b5cf6,#a78bfa)"}}/>
          </div>
        </div>
        {!running && (
          <button onClick={onClose} className="w-full py-2 rounded-xl text-xs font-semibold text-white"
            style={{background:"linear-gradient(135deg,#8b5cf6,#6d28d9)"}}>Done</button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AutoComparePage() {
  const [stage,      setStage]      = useState<Stage>("upload");
  const [sessionId,  setSessionId]  = useState<string|null>(null);
  const [sourceName, setSourceName] = useState("");

  // PDF URLs — track blobs so we can revoke on replacement
  const [oldPdfUrl, setOldPdfUrl] = useState<string|null>(null);
  const [newPdfUrl, setNewPdfUrl] = useState<string|null>(null);
  // Track blob refs for revocation
  const oldBlobRef = useRef<string|null>(null);
  const newBlobRef = useRef<string|null>(null);
  // Track File objects for PdfViewer (needed for the file prop)
  const [oldPdfFile, setOldPdfFile] = useState<File|null>(null);
  const [newPdfFile, setNewPdfFile] = useState<File|null>(null);

  const setOldPdf = useCallback((file: File|null, url: string|null) => {
    oldBlobRef.current = swapBlobUrl(oldBlobRef.current, url);
    setOldPdfFile(file);
    setOldPdfUrl(oldBlobRef.current);
  }, []);
  const setNewPdf = useCallback((file: File|null, url: string|null) => {
    newBlobRef.current = swapBlobUrl(newBlobRef.current, url);
    setNewPdfFile(file);
    setNewPdfUrl(newBlobRef.current);
  }, []);

  useEffect(() => () => {
    if (oldBlobRef.current?.startsWith("blob:")) URL.revokeObjectURL(oldBlobRef.current);
    if (newBlobRef.current?.startsWith("blob:")) URL.revokeObjectURL(newBlobRef.current);
  }, []);

  // Processing
  const [progress, setProgress] = useState(0);
  const [summary,  setSummary]  = useState<SessionSummary|null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current=null; }
  }, []);

  // Chunks
  const [chunks,        setChunks]       = useState<ChunkRow[]>([]);
  const [selected,      setSelected]     = useState<ChunkDetail|null>(null);
  const [loadingChunk,  setLoadingChunk] = useState(false);

  // Changed-chunks modal — shown when processing completes
  const [showChangedModal, setShowChangedModal] = useState(false);

  // XML editor
  const [xmlDraft,          setXmlDraft]          = useState("");
  const [isSaving,          setIsSaving]          = useState(false);
  const [isGenerating,      setIsGenerating]      = useState(false);
  const [isValidating,      setIsValidating]      = useState(false);
  const [xmlFocusLine,      setXmlFocusLine]      = useState<number|null>(null);
  const [xmlFocusRequestId, setXmlFocusRequestId] = useState(0);

  // Diff ↔ viewer
  const [selectedDiffIdx,  setSelectedDiffIdx]  = useState<number|null>(null);
  const [oldPdfTargetPage, setOldPdfTargetPage] = useState<number|null>(null);
  const [newPdfTargetPage, setNewPdfTargetPage] = useState<number|null>(null);
  const [oldHighlight,     setOldHighlight]     = useState("");
  const [newHighlight,     setNewHighlight]     = useState("");
  const [xmlHighlight,     setXmlHighlight]     = useState("");

  // Validate
  const [validateResult,     setValidateResult]     = useState<ValidateResponse|null>(null);
  const [showValidateAll,    setShowValidateAll]    = useState(false);
  const [validateAllRunning, setValidateAllRunning] = useState(false);
  const [validateAllResult,  setValidateAllResult]  = useState<ValidateAllResponse|null>(null);
  const [validateAllError,   setValidateAllError]   = useState<string|null>(null);

  // Modals
  const [showReupload,      setShowReupload]      = useState(false);
  const [showBatchGen,      setShowBatchGen]      = useState(false);
  const [batchRunning,      setBatchRunning]      = useState(false);
  const [batchTotal,        setBatchTotal]        = useState(0);
  const [batchCompleted,    setBatchCompleted]    = useState(0);
  const [batchGenerated,    setBatchGenerated]    = useState(0);
  const [batchFailed,       setBatchFailed]       = useState(0);

  // Expiry
  const [expiresAt,      setExpiresAt]      = useState<number|null>(null);
  const [sessionWarning, setSessionWarning] = useState(false);

  // Toast
  const [toast, setToast] = useState<{msg:string;type:"success"|"error"}|null>(null);
  const showToast = useCallback((msg:string, type:"success"|"error"="success") => setToast({msg,type}), []);
  const { dark } = useTheme();

  // Theme shortcuts
  const T = {
    bg:       dark ? "bg-[#060d1a]"   : "bg-gray-50",
    surface:  dark ? "bg-[#0d1421]"   : "bg-white",
    border:   dark ? "border-[#1e2d42]" : "border-gray-200",
    text:     dark ? "text-white"      : "text-gray-900",
    textSub:  dark ? "text-slate-400"  : "text-gray-500",
    panel:    dark ? "bg-[#0a1628]"    : "bg-white",
    header:   dark ? "bg-[#060d1a]/95" : "bg-white/95",
    hdrBdr:   dark ? "border-[#1e2d42]" : "border-gray-200",
  };

  // Derived
  const selectedChunkIdx = useMemo(
    () => selected ? chunks.findIndex(c => c.index===selected.index) : -1,
    [chunks, selected],
  );

  const similarityColor = (sim:number) => {
    if (sim >= 0.95) return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    if (sim >= 0.80) return "bg-amber-500/15 text-amber-300 border-amber-500/25";
    if (sim >= 0.60) return "bg-orange-500/15 text-orange-300 border-orange-500/25";
    return "bg-red-500/15 text-red-300 border-red-500/25";
  };

  const selectedChunkRow   = selectedChunkIdx >= 0 ? chunks[selectedChunkIdx] : null;
  const selectedChunkTitle = selectedChunkRow ? `${selectedChunkRow.label} (#${selectedChunkRow.index})` : null;

  // ── Session persistence ─────────────────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved || saved === sessionId) return;
    (async () => {
      try {
        const st = await pollStatus(saved);
        if (st.status === "done") {
          const cr = await fetchChunks(saved);
          setSessionId(saved);
          setSourceName(cr.source_name);
          setChunks(cr.chunks.map(c => ({...c, reviewStatus:"pending" as ReviewStatus})));
          setSummary(cr.summary);
          setOldPdf(null, getPdfUrl(saved,"old"));
          setNewPdf(null, getPdfUrl(saved,"new"));
          setStage("review");
          showToast(`Session restored: ${cr.source_name}`);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch { localStorage.removeItem(SESSION_KEY); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (sessionId) localStorage.setItem(SESSION_KEY, sessionId); }, [sessionId]);

  useEffect(() => {
    if (!expiresAt) return;
    const check = () => {
      const rem = expiresAt - Date.now()/1000;
      setSessionWarning(rem > 0 && rem < 300);
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const getChunkPageBounds = useCallback((chunk: ChunkDetail) => {
    const s = Math.max(1, (chunk.page_start ?? 0) + 1);
    const e = Math.max(s, chunk.page_end ?? s);
    return {startPage:s, endPage:e};
  }, []);

  // Debounced XML line search
  const xmlSearchTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const findXmlLineDebounced = useCallback((xml:string, rawText:string) => {
    if (xmlSearchTimer.current) clearTimeout(xmlSearchTimer.current);
    xmlSearchTimer.current = setTimeout(() => {
      const q = rawText.trim();
      if (!q || !xml) return;
      const norm  = (s:string) => s.toLowerCase().replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      const tokens = norm(q).split(" ").filter(w=>w.length>2).slice(0,10);
      if (!tokens.length) return;
      const key   = tokens.join(" ");
      const lines = xml.split("\n");
      let best=-1, bestScore=0;
      for (let i=0;i<lines.length;i++) {
        const n = norm(lines[i]);
        const hits = tokens.filter(t=>n.includes(t)).length;
        if (hits > bestScore || (hits===bestScore && n.includes(key))) {
          bestScore=hits; best=i;
        }
      }
      if (best>=0 && bestScore>=Math.ceil(tokens.length*0.5)) {
        setXmlFocusLine(best);
        setXmlFocusRequestId(v=>v+1);
      }
    }, 80);
  }, []);

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleUploaded = useCallback(async (resp:UploadResponse, oldFile:File, newFile:File) => {
    stopPolling();
    setSessionId(resp.session_id);
    setSourceName(resp.source_name);
    setOldPdf(oldFile, URL.createObjectURL(oldFile));
    setNewPdf(newFile, URL.createObjectURL(newFile));
    setStage("processing");
    setProgress(0);
    setChunks([]); setSelected(null);
    autoSelectDoneRef.current = false;

    try { await startProcessing(resp.session_id); }
    catch(e:unknown) {
      showToast(e instanceof Error ? e.message : "Failed to start processing","error");
      setStage("upload"); return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const st = await pollStatus(resp.session_id);
        setProgress(st.progress);
        if ((st as {expires_at?:number}).expires_at) setExpiresAt((st as {expires_at?:number}).expires_at ?? null);
        if (st.status === "done") {
          stopPolling();
          setSummary(st.summary as SessionSummary);
          setTimeout(async () => {
            try {
              const cr = await fetchChunks(resp.session_id);
              const rows = cr.chunks.map(c=>({...c,reviewStatus:"pending" as ReviewStatus}));
              setChunks(rows);
              setStage("review");
              // Show changed-chunks modal if there are any differences
              if (rows.some(c=>c.has_changes)) setShowChangedModal(true);
            } catch(e:unknown) {
              showToast(e instanceof Error ? e.message : "Failed to load chunks","error");
              setStage("upload");
            }
          }, 600);
        } else if (st.status === "error") {
          stopPolling();
          showToast((st as {error?:string}).error ?? "Processing failed","error");
          setStage("upload");
        }
      } catch { /* transient */ }
    }, POLL_MS);
  }, [stopPolling, setOldPdf, setNewPdf, showToast]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Auto-select first changed chunk (deferred) ──────────────────────────────

  const autoSelectDoneRef = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage !== "review" || !chunks.length || selected || autoSelectDoneRef.current) return;
    if (showChangedModal) return; // wait until user picks from modal or dismisses
    autoSelectDoneRef.current = true;
    const first = chunks.find(c=>c.has_changes) ?? chunks[0];
    setTimeout(() => void handleSelectChunk(first), 0);
  }, [stage, chunks, selected, showChangedModal]);

  useEffect(() => { autoSelectDoneRef.current = false; }, [sessionId]);

  // ── Select chunk ────────────────────────────────────────────────────────────

  const handleSelectChunk = useCallback(async (chunk:ChunkRow) => {
    if (!sessionId) return;
    setLoadingChunk(true);
    try {
      const r = await fetchChunkDetail(sessionId, chunk.index);
      setSelected(r.chunk);
      setXmlDraft(r.chunk.xml_saved ?? r.chunk.xml_content);
      setSelectedDiffIdx(null);
      setXmlFocusLine(null);
      setOldHighlight(""); setNewHighlight(""); setXmlHighlight("");
      const {startPage} = getChunkPageBounds(r.chunk);
      setOldPdfTargetPage(startPage); setNewPdfTargetPage(startPage);
      setChunks(prev => prev.map(c =>
        c.index===chunk.index && c.reviewStatus==="pending"
          ? {...c, reviewStatus:"reviewed" as ReviewStatus} : c
      ));
    } catch(e:unknown) {
      showToast(e instanceof Error ? e.message : "Failed to load chunk","error");
    } finally { setLoadingChunk(false); }
  }, [sessionId, showToast, getChunkPageBounds]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  const handlePrevChunk = useCallback(() => {
    if (selectedChunkIdx <= 0) return;
    void handleSelectChunk(chunks[selectedChunkIdx-1]);
  }, [chunks, selectedChunkIdx, handleSelectChunk]);

  const handleNextChunk = useCallback(() => {
    if (selectedChunkIdx < 0 || selectedChunkIdx >= chunks.length-1) return;
    void handleSelectChunk(chunks[selectedChunkIdx+1]);
  }, [chunks, selectedChunkIdx, handleSelectChunk]);

  useEffect(() => {
    if (stage!=="review") return;
    const onKey = (e:KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key==="ArrowLeft"||e.key==="ArrowUp")   { e.preventDefault(); handlePrevChunk(); }
      if (e.key==="ArrowRight"||e.key==="ArrowDown") { e.preventDefault(); handleNextChunk(); }
    };
    window.addEventListener("keydown",onKey);
    return () => window.removeEventListener("keydown",onKey);
  }, [stage, handlePrevChunk, handleNextChunk]);

  const handleJumpToChunk = useCallback((index:number) => {
    const c = chunks.find(c=>c.index===index);
    if (c) void handleSelectChunk(c);
  }, [chunks, handleSelectChunk]);

  // ── Auto-generate ───────────────────────────────────────────────────────────

  const handleAutoGenerate = useCallback(async (lineContext?: {
    diff_index?:number; diff_text?:string; old_text?:string; new_text?:string; category?:string;
  }) => {
    if (!sessionId || !selected) return;
    setIsGenerating(true);
    try {
      const r = await autoGenerateXml(sessionId, selected.index, lineContext);
      setXmlDraft(r.suggested_xml);
      showToast(r.generation_scope==="line"
        ? "Line-based XML generation applied. Review and save."
        : "AI-generated XML applied. Review and save.");
    } catch(e:unknown) {
      showToast(e instanceof Error ? e.message : "Auto-generate failed","error");
    } finally { setIsGenerating(false); }
  }, [sessionId, selected, showToast]);

  const handleBatchGenerate = useCallback(async () => {
    if (!sessionId) return;
    const ids = chunks.filter(c=>c.has_changes).map(c=>c.index);
    if (!ids.length) { showToast("No changed chunks to generate.","error"); return; }
    setShowBatchGen(true); setBatchRunning(true);
    setBatchTotal(ids.length); setBatchCompleted(0); setBatchGenerated(0); setBatchFailed(0);
    let gen=0, fail=0;
    for (let i=0;i<ids.length;i++) {
      try { await autoGenerateXml(sessionId, ids[i]); gen++; }
      catch { fail++; }
      setBatchCompleted(i+1); setBatchGenerated(gen); setBatchFailed(fail);
      await yieldToMain();
    }
    setBatchRunning(false);
    showToast(`Batch complete: ${gen} generated, ${fail} failed.`, fail>0?"error":"success");
  }, [sessionId, chunks, showToast]);

  // ── Diff line selection ─────────────────────────────────────────────────────

  const handleDiffLineSelect = useCallback((line:DiffLine, index:number) => {
    setSelectedDiffIdx(index);
    const oldT = (line.old_text??"").trim();
    const newT = (line.new_text??"").trim();
    setOldHighlight(oldT); setNewHighlight(newT); setXmlHighlight(newT||oldT);
    if (selected) {
      const {startPage,endPage} = getChunkPageBounds(selected);
      const span  = Math.max(1, endPage-startPage+1);
      const total = Math.max(1, selected.diff_lines.length);
      const ratio = total<=1 ? 0 : index/(total-1);
      const fallback = Math.max(startPage, Math.min(endPage, startPage+Math.floor(ratio*span)));
      setOldPdfTargetPage(line.old_page ?? fallback);
      setNewPdfTargetPage(line.new_page ?? fallback);
    }
    findXmlLineDebounced(xmlDraft, newT||oldT);
  }, [selected, getChunkPageBounds, xmlDraft, findXmlLineDebounced]);

  const handleGenerateFromLine = useCallback((line:DiffLine, index:number) => {
    handleDiffLineSelect(line, index);
    void handleAutoGenerate({
      diff_index: index,
      diff_text:  line.text.trim(),
      old_text:   (line.old_text??"").trim()||undefined,
      new_text:   (line.new_text??"").trim()||undefined,
      category:   line.category,
    });
  }, [handleDiffLineSelect, handleAutoGenerate]);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async (xmlContent:string) => {
    if (!sessionId || !selected) return;
    setIsSaving(true);
    try {
      await saveChunkXml(sessionId, selected.index, xmlContent);
      setChunks(prev => prev.map(c =>
        c.index===selected.index
          ? {...c, has_changes:false, reviewStatus:"saved" as ReviewStatus} : c
      ));
      showToast("XML saved successfully");
    } catch(e:unknown) {
      showToast(e instanceof Error ? e.message : "Save failed","error");
    } finally { setIsSaving(false); }
  }, [sessionId, selected, showToast]);

  const handleAutoSave = useCallback((xml:string) => setXmlDraft(xml), []);

  // ── Validate ────────────────────────────────────────────────────────────────

  const handleValidate = useCallback(async () => {
    if (!sessionId || !selected) return;
    setIsValidating(true);
    try { setValidateResult(await validateChunkXml(sessionId, selected.index)); }
    catch(e:unknown) { showToast(e instanceof Error ? e.message : "Validation failed","error"); }
    finally { setIsValidating(false); }
  }, [sessionId, selected, showToast]);

  const handleValidateAll = useCallback(async () => {
    if (!sessionId) return;
    setShowValidateAll(true); setValidateAllRunning(true);
    setValidateAllResult(null); setValidateAllError(null);
    try {
      const r = await validateAllChunks(sessionId);
      setValidateAllResult(r);
      showToast(r.needs_action_count>0
        ? `Validation: ${r.needs_action_count} chunk(s) need action.`
        : "Validation: all chunks look good.",
        r.needs_action_count>0?"error":"success");
    } catch(e:unknown) {
      const msg = e instanceof Error ? e.message : "Validate-all failed";
      setValidateAllError(msg); showToast(msg,"error");
    } finally { setValidateAllRunning(false); }
  }, [sessionId, showToast]);

  // ── Download ────────────────────────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    if (!sessionId || !selected) return;
    downloadChunkXml(sessionId, selected.index);
    showToast("Download started");
  }, [sessionId, selected, showToast]);

  const handleDownloadAll = useCallback(async () => {
    if (!sessionId) return;
    showToast("Preparing ZIP…");
    try {
      const base = process.env.NEXT_PUBLIC_PROCESSING_URL ?? "";
      const a = document.createElement("a");
      a.href = `${base}/autocompare/download-all/${sessionId}`;
      a.download = `${sourceName||"chunks"}_chunks.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast("ZIP download started");
    } catch {
      try { await downloadAllChunks(sessionId, sourceName, chunks.map(c=>c.index)); showToast("Download started"); }
      catch(e2:unknown) { showToast(e2 instanceof Error ? e2.message : "Download failed","error"); }
    }
  }, [sessionId, sourceName, chunks, showToast]);

  // ── Re-upload done ──────────────────────────────────────────────────────────

  const handleReuploadDone = useCallback(async () => {
    if (!sessionId) return;
    setShowReupload(false); setStage("processing"); setProgress(0);
    setSummary(null); setSelected(null); setChunks([]);
    autoSelectDoneRef.current = false; stopPolling();
    try { await startProcessing(sessionId); }
    catch(e:unknown) { showToast(e instanceof Error ? e.message : "Failed to re-start","error"); setStage("review"); return; }
    pollRef.current = setInterval(async () => {
      try {
        const st = await pollStatus(sessionId);
        setProgress(st.progress);
        if (st.status==="done") {
          stopPolling(); setSummary(st.summary as SessionSummary);
          setTimeout(async () => {
            try {
              const cr = await fetchChunks(sessionId);
              const rows = cr.chunks.map(c=>({...c,reviewStatus:"pending" as ReviewStatus}));
              setChunks(rows); setStage("review");
              if (rows.some(c=>c.has_changes)) setShowChangedModal(true);
            } catch(e:unknown) { showToast(e instanceof Error ? e.message : "Failed","error"); setStage("review"); }
          }, 600);
        } else if (st.status==="error") {
          stopPolling(); showToast((st as {error?:string}).error ?? "Failed","error"); setStage("review");
        }
      } catch { /* transient */ }
    }, POLL_MS);
  }, [sessionId, stopPolling, showToast]);

  // ── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    stopPolling();
    localStorage.removeItem(SESSION_KEY);
    setStage("upload"); setSessionId(null); setProgress(0); setSummary(null);
    setChunks([]); setSelected(null); setXmlDraft(""); setXmlFocusLine(null);
    setXmlFocusRequestId(0); setSelectedDiffIdx(null);
    setOldPdfTargetPage(null); setNewPdfTargetPage(null);
    setOldHighlight(""); setNewHighlight(""); setXmlHighlight("");
    setOldPdf(null,null); setNewPdf(null,null);
    setExpiresAt(null); setSessionWarning(false); setValidateResult(null);
    setShowChangedModal(false); autoSelectDoneRef.current=false;
  }, [stopPolling, setOldPdf, setNewPdf]);

  // ── Validate results map ────────────────────────────────────────────────────

  const validateResultsMap = useMemo(() => {
    if (!validateAllResult) return undefined;
    const m: Record<number,(typeof validateAllResult.results)[number]> = {};
    for (const r of validateAllResult.results) m[r.index]=r;
    return m;
  }, [validateAllResult]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-screen overflow-hidden transition-colors duration-200 ${dark ? "bg-[#060d1a] text-white" : "bg-gray-50 text-gray-900"}`}>

      {/* ── Header ── */}
      <header className={`flex-shrink-0 flex items-center justify-between px-4 py-2 border-b ${dark ? "bg-[#060d1a]/95 border-[#1e2d42]" : "bg-white/95 border-gray-200"} backdrop-blur-sm z-10`}>
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo */}
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background:"linear-gradient(135deg,#1a8fd1,#146da3)" }}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
            </svg>
          </div>
          <span className={`text-sm font-bold ${dark ? "text-white" : "text-gray-900"}`}>AutoCompare</span>
          {stage==="review" && sourceName && (
            <span className={`text-xs truncate max-w-[180px] ${dark ? "text-slate-400" : "text-gray-500"}`}>{sourceName}</span>
          )}
          {stage==="review" && summary && (
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/25 font-medium">{summary.changed} changed</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 font-medium">{summary.unchanged} unchanged</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {stage==="review" && (
            <>
              {chunks.length > 0 && (
                <div className="hidden md:flex items-center gap-1">
                  <button onClick={handlePrevChunk} disabled={selectedChunkIdx<=0||loadingChunk}
                    className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors disabled:opacity-40 ${dark ? "text-slate-300 border-slate-700 hover:border-slate-500" : "text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                    ← Prev
                  </button>
                  <span className={`text-[10px] w-14 text-center ${dark ? "text-slate-500" : "text-gray-400"}`}>
                    {selectedChunkIdx>=0 ? `${selectedChunkIdx+1}/${chunks.length}` : `0/${chunks.length}`}
                  </span>
                  <button onClick={handleNextChunk} disabled={selectedChunkIdx<0||selectedChunkIdx>=chunks.length-1||loadingChunk}
                    className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors disabled:opacity-40 ${dark ? "text-slate-300 border-slate-700 hover:border-slate-500" : "text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                    Next →
                  </button>
                </div>
              )}
              {summary && summary.changed > 0 && (
                <button onClick={() => setShowChangedModal(true)}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white"
                  style={{ background:"linear-gradient(135deg,#1a8fd1,#146da3)" }}>
                  View Changes
                </button>
              )}
              {chunks.length>0 && (
                <button onClick={handleValidateAll} disabled={validateAllRunning}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-violet-300 border-violet-500/40 hover:bg-violet-500/10" : "text-violet-700 border-violet-400 hover:bg-violet-50"}`}>
                  {validateAllRunning ? "Checking…" : "Validate All"}
                </button>
              )}
              {selected && (
                <>
                  <button onClick={handleValidate} disabled={isValidating}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-slate-300 border-slate-700 hover:border-slate-500" : "text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                    {isValidating ? "…" : "Validate"}
                  </button>
                  <button onClick={() => void handleAutoGenerate()} disabled={isGenerating||!selected?.has_changes}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors disabled:opacity-40 ${dark ? "text-violet-300 border-violet-500/40 hover:bg-violet-500/10" : "text-violet-700 border-violet-400 hover:bg-violet-50"}`}>
                    {isGenerating ? "Generating…" : "✨ Generate"}
                  </button>
                  <button onClick={() => handleSave(xmlDraft)} disabled={isSaving}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white disabled:opacity-50"
                    style={{ background:"linear-gradient(135deg,#059669,#047857)" }}>
                    {isSaving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={handleDownload}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-slate-300 border-slate-700 hover:border-slate-500" : "text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                    ↓
                  </button>
                </>
              )}
              {chunks.some(c=>c.has_changes) && (
                <button onClick={handleBatchGenerate} disabled={batchRunning}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-violet-300 border-violet-500/40 hover:bg-violet-500/10" : "text-violet-700 border-violet-400 hover:bg-violet-50"}`}>
                  ✨ Batch
                </button>
              )}
              {chunks.length>0 && (
                <button onClick={handleDownloadAll}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/10" : "text-cyan-700 border-cyan-400 hover:bg-cyan-50"}`}>
                  ↓ All
                </button>
              )}
              <button onClick={() => setShowReupload(true)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10" : "text-emerald-700 border-emerald-400 hover:bg-emerald-50"}`}>
                Re-upload
              </button>
            </>
          )}
          {stage!=="upload" && (
            <button onClick={handleReset}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${dark ? "text-slate-400 border-slate-700 hover:text-red-300 hover:border-red-500/40" : "text-gray-500 border-gray-300 hover:text-red-600 hover:border-red-300"}`}>
              New
            </button>
          )}
        </div>
      </header>

      {/* Session expiry warning */}
      {sessionWarning && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 text-xs font-medium text-amber-600 border-b border-amber-500/20 bg-amber-50 dark:bg-amber-500/8 dark:text-amber-200">
          ⚠ Session expires soon.
          <button onClick={handleDownloadAll} className="ml-auto underline hover:opacity-70">Download All Now</button>
          <button onClick={() => setSessionWarning(false)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Upload ── */}
      {stage==="upload" && (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="w-full max-w-2xl">
            <FileUploadPanel onUploaded={handleUploaded} />
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {stage==="processing" && (
        <ProcessingOverlay progress={progress} sourceName={sourceName} summary={summary} />
      )}

      {/* ── Review — NEW LAYOUT ── */}
      {stage==="review" && (
        <div className="flex-1 flex overflow-hidden">

          {/* LEFT COLUMN: ChunkList (top) + DiffPanel (bottom) — fixed 300px */}
          <div className={`flex-shrink-0 flex flex-col border-r ${dark ? "border-[#1e2d42]" : "border-gray-200"}`}
            style={{ width:"300px" }}>

            {/* ChunkList — top half */}
            <div className="flex-shrink-0 overflow-hidden" style={{ height:"50%", borderBottom: dark ? "1px solid #1e2d42" : "1px solid #e5e7eb" }}>
              <ChunkList
                chunks={chunks}
                selectedIndex={selected?.index ?? null}
                onSelect={handleSelectChunk}
                validateResults={validateResultsMap}
              />
            </div>

            {/* DiffPanel — bottom half */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {selected && !loadingChunk ? (
                <DiffPanel
                  diffLines={selected.diff_lines}
                  diffGroups={selected.diff_groups}
                  chunkLabel={selected.label}
                  changeType={selected.change_type}
                  similarity={selected.similarity}
                  selectedLineIndex={selectedDiffIdx}
                  onSelectLine={handleDiffLineSelect}
                  onGenerateFromLine={handleGenerateFromLine}
                />
              ) : (
                <div className={`flex items-center justify-center h-full text-xs ${dark ? "text-slate-600" : "text-gray-400"}`}>
                  {loadingChunk ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin"/>
                      <span>Loading…</span>
                    </div>
                  ) : "Select a chunk"}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT AREA: PDFs (top) + XML Editor (bottom) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {selected && !loadingChunk ? (
              <>
                {/* PDFs — top 55% */}
                <div className={`flex-shrink-0 flex gap-1 p-1 border-b ${dark ? "border-[#1e2d42]" : "border-gray-200"}`}
                  style={{ height:"55%" }}>
                  {/* Old PDF */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    {oldPdfFile || oldPdfUrl ? (
                      <PdfViewer
                        file={oldPdfFile}
                        src={oldPdfUrl ?? undefined}
                        label="Old PDF"
                        color="blue"
                        pageStart={selected.page_start}
                        pageEnd={selected.page_end}
                        targetPage={oldPdfTargetPage ?? undefined}
                        highlightText={oldHighlight || undefined}
                      />
                    ) : (
                      <div className={`flex flex-col items-center justify-center h-full rounded-lg border text-xs gap-2 ${dark ? "border-[#1e2d42] text-slate-600" : "border-gray-200 text-gray-400"}`}>
                        <svg className="w-6 h-6 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        Old PDF
                      </div>
                    )}
                  </div>
                  {/* New PDF */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    {newPdfFile || newPdfUrl ? (
                      <PdfViewer
                        file={newPdfFile}
                        src={newPdfUrl ?? undefined}
                        label="New PDF"
                        color="violet"
                        pageStart={selected.page_start}
                        pageEnd={selected.page_end}
                        targetPage={newPdfTargetPage ?? undefined}
                        highlightText={newHighlight || undefined}
                      />
                    ) : (
                      <div className={`flex flex-col items-center justify-center h-full rounded-lg border text-xs gap-2 ${dark ? "border-[#1e2d42] text-slate-600" : "border-gray-200 text-gray-400"}`}>
                        <svg className="w-6 h-6 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        New PDF
                      </div>
                    )}
                  </div>
                </div>

                {/* XML Editor — bottom 45% */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-1 gap-1">
                  <div className="flex-shrink-0 flex items-center gap-2 px-1">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-gray-400"}`}>XML Editor</span>
                    {selected && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${similarityColor(selected.similarity??1)}`}>
                        {Math.round((selected.similarity??1)*100)}% similar
                      </span>
                    )}
                    <span className="flex-1"/>
                    <span className={`text-[9px] italic hidden lg:block ${dark ? "text-slate-600" : "text-gray-400"}`}>Right-click diff line → Generate from line</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <XmlEditor
                      value={xmlDraft}
                      onChange={setXmlDraft}
                      onSave={handleSave}
                      onAutoSave={handleAutoSave}
                      focusLine={xmlFocusLine}
                      focusRequestId={xmlFocusRequestId}
                      highlightText={xmlHighlight||undefined}
                      height="100%"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className={`flex-1 flex items-center justify-center text-sm ${dark ? "text-slate-600" : "text-gray-400"}`}>
                {loadingChunk
                  ? <div className="flex items-center gap-3"><div className="w-5 h-5 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin"/><span>Loading chunk…</span></div>
                  : "Select a chunk from the left panel"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ── */}

      {showChangedModal && chunks.length > 0 && (
        <ChangedChunksModal
          chunks={chunks}
          summary={summary}
          onSelect={chunk => {
            autoSelectDoneRef.current = true;
            void handleSelectChunk(chunk);
          }}
          onClose={() => {
            setShowChangedModal(false);
            if (!selected) {
              autoSelectDoneRef.current = true;
              const first = chunks.find(c=>c.has_changes) ?? chunks[0];
              if (first) setTimeout(() => void handleSelectChunk(first), 0);
            }
          }}
        />
      )}

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
        <ReuploadModal sessionId={sessionId} onDone={handleReuploadDone} onClose={() => setShowReupload(false)} />
      )}

      {showBatchGen && (
        <BatchGenerateModal
          total={batchTotal} completed={batchCompleted}
          generated={batchGenerated} failed={batchFailed}
          running={batchRunning} onClose={() => setShowBatchGen(false)}
        />
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}