"use client";
/**
 * AutoCompare Page — /dashboard/autocompare
 *
 * Standalone module for comparing OLD PDF, NEW PDF, and an XML file.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  Header bar (title, source name, session status, action buttons)    │
 *  ├──────────┬───────────────────────────────────────────────────────────┤
 *  │          │  ┌──────────┬──────────┬──────────────┬────────────────┐ │
 *  │  Chunk   │  │ Old PDF  │ New PDF  │  XML Editor  │  Diff/Changes  │ │
 *  │  List    │  │ Viewer   │ Viewer   │  (editable)  │  Highlight     │ │
 *  │  (left)  │  │          │          │              │                │ │
 *  │          │  └──────────┴──────────┴──────────────┴────────────────┘ │
 *  └──────────┴───────────────────────────────────────────────────────────┘
 *
 * Flow
 * ────
 * 1. Upload step   — FileUploadPanel collects files + source name
 * 2. Processing    — POST /autocompare/start → polling /autocompare/status
 * 3. Review        — 4-panel view with ChunkList on left
 * 4. Save/Merge    — Save individual chunks, then merge to final XML
 *
 * State machine:   idle → uploading → processing → review
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type {
  ChunkDetail,
  ChunkRow,
  SessionSummary,
  UploadResponse,
} from "../../../components/autocompare/types";
import {
  autoGenerateXml,
  downloadFinalXml,
  fetchChunkDetail,
  fetchChunks,
  mergeChunks,
  pollStatus,
  saveChunkXml,
  startProcessing,
} from "../../../components/autocompare/api";

// Dynamic imports for heavy components (avoids SSR issues)
const FileUploadPanel = dynamic(
  () => import("../../../components/autocompare/FileUploadPanel"),
  { ssr: false },
);
const ChunkList = dynamic(
  () => import("../../../components/autocompare/ChunkList"),
  { ssr: false },
);
const PdfViewer = dynamic(
  () => import("../../../components/autocompare/PdfViewer"),
  { ssr: false },
);
const XmlEditor = dynamic(
  () => import("../../../components/autocompare/XmlEditor"),
  { ssr: false },
);
const DiffPanel = dynamic(
  () => import("../../../components/autocompare/DiffPanel"),
  { ssr: false },
);

// ── Page-level types ──────────────────────────────────────────────────────────

type Stage = "upload" | "processing" | "review";

// ── Processing progress bar ───────────────────────────────────────────────────

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
        {/* Spinner + title */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Processing Documents</p>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{sourceName}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">
              {pct < 30 ? "Extracting PDF text…"
                : pct < 50 ? "Parsing XML structure…"
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

        {/* Steps */}
        {[
          { label: "Upload files",       done: pct >= 1  },
          { label: "Extract PDF text",   done: pct >= 30 },
          { label: "Parse XML chunks",   done: pct >= 50 },
          { label: "Compare & diff",     done: pct >= 90 },
          { label: "Build chunk index",  done: pct >= 100 },
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

        {/* Summary (when done) */}
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

// ── Toast notification ────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium animate-in slide-in-from-bottom-3 fade-in`}
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
  const [summary,    setSummary]     = useState<SessionSummary | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chunks
  const [chunks,     setChunks]     = useState<ChunkRow[]>([]);
  const [selected,   setSelected]   = useState<ChunkDetail | null>(null);
  const [loadingChunk, setLoadingChunk] = useState(false);

  // XML editor state
  const [xmlDraft,     setXmlDraft]     = useState("");
  const [isSaving,     setIsSaving]     = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
  }, []);

  // ── Upload complete → kick off processing ──────────────────────────────────

  const handleUploaded = useCallback(async (response: UploadResponse) => {
    setSessionId(response.session_id);
    setSourceName(response.source_name);
    setStage("processing");

    try {
      await startProcessing(response.session_id);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to start processing", "error");
      setStage("upload");
      return;
    }

    // Start polling for completion
    pollRef.current = setInterval(async () => {
      try {
        const status = await pollStatus(response.session_id);
        setProgress(status.progress);

        if (status.status === "done") {
          clearInterval(pollRef.current!);
          setSummary(status.summary as SessionSummary);
          // Slight delay so user sees 100%
          setTimeout(async () => {
            const chunksResp = await fetchChunks(response.session_id);
            setChunks(chunksResp.chunks);
            setStage("review");
          }, 800);
        } else if (status.status === "error") {
          clearInterval(pollRef.current!);
          showToast(status.error ?? "Processing failed", "error");
          setStage("upload");
        }
      } catch {
        // Polling errors are transient; keep trying
      }
    }, 1500);
  }, [showToast]);

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Select chunk → load full detail ───────────────────────────────────────

  const handleSelectChunk = useCallback(async (chunk: ChunkRow) => {
    if (!sessionId) return;
    setLoadingChunk(true);
    try {
      const resp = await fetchChunkDetail(sessionId, chunk.index);
      setSelected(resp.chunk);
      setXmlDraft(resp.chunk.xml_saved ?? resp.chunk.xml_content);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to load chunk", "error");
    } finally {
      setLoadingChunk(false);
    }
  }, [sessionId, showToast]);

  // ── Auto-generate XML for selected chunk ──────────────────────────────────

  const handleAutoGenerate = useCallback(async () => {
    if (!sessionId || !selected) return;
    setIsGenerating(true);
    try {
      const resp = await autoGenerateXml(sessionId, selected.index);
      setXmlDraft(resp.suggested_xml);
      showToast("AI-generated XML applied. Review and save.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Auto-generate failed", "error");
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId, selected, showToast]);

  // ── Save XML for selected chunk ────────────────────────────────────────────

  const handleSave = useCallback(async (xmlContent: string) => {
    if (!sessionId || !selected) return;
    setIsSaving(true);
    try {
      await saveChunkXml(sessionId, selected.index, xmlContent);
      // Update local chunk list to reflect saved state
      setChunks((prev) =>
        prev.map((c) => c.index === selected.index ? { ...c, has_changes: false } : c),
      );
      showToast("XML saved successfully");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, selected, showToast]);

  // ── Merge all and download ────────────────────────────────────────────────

  const handleMergeAndDownload = useCallback(async () => {
    if (!sessionId) return;
    try {
      await mergeChunks(sessionId);
      downloadFinalXml(sessionId);
      showToast("Final XML downloaded");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Merge failed", "error");
    }
  }, [sessionId, showToast]);

  // ── Reset to upload stage ─────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStage("upload");
    setSessionId(null);
    setProgress(0);
    setSummary(null);
    setChunks([]);
    setSelected(null);
    setXmlDraft("");
    setOldPdfFile(null);
    setNewPdfFile(null);
  }, []);

  // ── Store file references when upload panel captures them ─────────────────
  // We intercept by wrapping the onUploaded callback and reading files via
  // a hidden state set before calling upload. See FileUploadPanel internals
  // for how it sends FormData; we read the files back from the FormData event.
  // For now we track files via a separate state in the upload step below.

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "linear-gradient(180deg, #060d1a 0%, #0a1628 100%)" }}
    >
      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: "rgba(26,143,209,0.12)", background: "rgba(6,13,26,0.9)" }}
      >
        {/* Left: title */}
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #1a8fd1, #146da3)" }}
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">AutoCompare</h1>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {stage === "upload"     ? "Upload files to begin"
               : stage === "processing" ? `Processing ${sourceName}…`
               : `${sourceName} — ${chunks.length} chunks`}
            </p>
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2">
          {stage === "review" && (
            <>
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
              <button
                onClick={handleMergeAndDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg,#1a8fd1,#146da3)", boxShadow: "0 2px 8px rgba(26,143,209,0.3)" }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Merge & Download
              </button>
            </>
          )}

          {stage !== "upload" && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-700/50 hover:border-slate-600 transition-colors"
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

      {/* ── Stage: Upload ────────────────────────────────────────────────────── */}
      {stage === "upload" && (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="w-full max-w-2xl">
            <FileUploadPanel
              onUploaded={(resp) => {
                // Capture files for PDF viewers if FileUploadPanel exposes them.
                // We'll retrieve them from the browser's memory via a wrapper.
                handleUploaded(resp);
              }}
            />
          </div>
        </div>
      )}

      {/* ── Stage: Processing ────────────────────────────────────────────────── */}
      {stage === "processing" && (
        <ProcessingOverlay
          progress={progress}
          sourceName={sourceName}
          summary={summary}
        />
      )}

      {/* ── Stage: Review (4-panel layout) ──────────────────────────────────── */}
      {stage === "review" && (
        <div className="flex-1 flex overflow-hidden">
          {/* ── Left: Chunk list ───────────────────────────────────────────── */}
          <div
            className="flex-shrink-0 w-56 border-r overflow-hidden flex flex-col"
            style={{ borderColor: "rgba(26,143,209,0.1)" }}
          >
            <ChunkList
              chunks={chunks}
              selectedIndex={selected?.index ?? null}
              onSelect={handleSelectChunk}
            />
          </div>

          {/* ── Right: 4-panel area ──────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selected ? (
              loadingChunk ? (
                <div className="flex-1 flex items-center justify-center gap-3 text-slate-400">
                  <div className="w-5 h-5 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
                  <span className="text-sm">Loading chunk…</span>
                </div>
              ) : (
                /* 4-panel grid: 2 columns top row, 2 columns bottom row (or 4 columns on wide) */
                <div className="flex-1 grid grid-cols-2 grid-rows-2 xl:grid-cols-4 xl:grid-rows-1 gap-2 p-2 overflow-hidden">
                  {/* Panel 1: Old PDF */}
                  <div className="overflow-hidden">
                    <PdfViewer
                      file={oldPdfFile}
                      label="Old PDF"
                      color="blue"
                      textExcerpt={selected.old_text}
                      pageStart={selected.page_start}
                      pageEnd={selected.page_end}
                    />
                  </div>

                  {/* Panel 2: New PDF */}
                  <div className="overflow-hidden">
                    <PdfViewer
                      file={newPdfFile}
                      label="New PDF"
                      color="violet"
                      textExcerpt={selected.new_text}
                      pageStart={selected.page_start}
                      pageEnd={selected.page_end}
                    />
                  </div>

                  {/* Panel 3: XML Editor */}
                  <div className="overflow-hidden">
                    <XmlEditor
                      value={xmlDraft}
                      onChange={setXmlDraft}
                      onSave={handleSave}
                      onAutoGenerate={handleAutoGenerate}
                      isGenerating={isGenerating}
                      isSaving={isSaving}
                      height="100%"
                    />
                  </div>

                  {/* Panel 4: Diff Panel */}
                  <div className="overflow-hidden">
                    <DiffPanel
                      diffLines={selected.diff_lines}
                      chunkLabel={selected.label}
                      changeType={selected.change_type}
                      similarity={selected.similarity}
                    />
                  </div>
                </div>
              )
            ) : (
              /* No chunk selected */
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(26,143,209,0.08)", border: "1px solid rgba(26,143,209,0.15)" }}
                >
                  <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-400">Select a chunk to review</p>
                  <p className="text-xs mt-1 text-slate-600">
                    Click any chunk in the list on the left to open the 4-panel view.
                  </p>
                </div>
                {summary && (
                  <div className="flex gap-4 mt-2">
                    <div className="text-center">
                      <p className="text-xl font-bold text-amber-300">{summary.changed}</p>
                      <p className="text-[10px] text-slate-500">Require review</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-emerald-300">{summary.unchanged}</p>
                      <p className="text-[10px] text-slate-500">Auto-approved</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast notification ────────────────────────────────────────────── */}
      {toast && (
        <Toast
          message={toast.msg}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
