"use client";
import { useState, useRef } from "react";
import api from "@/app/lib/api";

function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Stage =
  | "idle"
  | "duplicate"
  | "title_duplicate"
  | "processing"
  | "done"
  | "error";

interface ImageMeta {
  tableIndex: number;
  rowIndex:   number;
  colIndex:   number;
  rid:        string;
  mediaName:  string;
  mimeType:   string;
  cellText:   string;
  blobUrl:    string | null;
}

interface ExtractedResult {
  brdId:          string;
  title:          string;
  format:         string;
  status:         string;
  scope:          Record<string, unknown>;
  metadata:       Record<string, unknown>;
  toc:            Record<string, unknown>;
  citations:      Record<string, unknown>;
  contentProfile: Record<string, unknown>;
  brdConfig?:     Record<string, unknown>;
  imageMetadata?: ImageMeta[];
}

// Shape returned by GET /brd/check-duplicate
interface DuplicateCheckResponse {
  exists:     boolean;
  brdId?:     string;
  title?:     string;
  status?:    string;
  matchType?: "exact" | "fuzzy";
}

interface Props {
  onComplete?: (result: ExtractedResult) => void;
}

const PIPELINE_STEPS = [
  { key: "upload",    label: "Uploading File",      icon: "⬡" },
  { key: "extract",   label: "Text Extraction",     icon: "◎" },
  { key: "scope",     label: "Scope Detection",     icon: "≡" },
  { key: "metadata",  label: "Metadata Extraction", icon: "↑" },
  { key: "toc",       label: "Table of Contents",   icon: "≣" },
  { key: "citations", label: "Citation Rules",      icon: "❝" },
  { key: "profile",   label: "Content Profiling",   icon: "✦" },
];

// ── Filename duplicate blocked modal ─────────────────────────────────────────
function DuplicateBlockedModal({
  fileName,
  dupInfo,
  onClose,
}: {
  fileName: string;
  dupInfo: DuplicateCheckResponse;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#131722] rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden">
        <div className="bg-red-500 px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white">Duplicate File Detected</p>
            <p className="text-xs text-red-100 mt-0.5">This file has already been processed</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-white">{fileName}</span> already
            exists in the BRD registry. You cannot re-upload a file that has already been ingested.
          </p>
          {dupInfo.brdId && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
              {[
                { label: "BRD ID", value: dupInfo.brdId },
                { label: "Title",  value: dupInfo.title  ?? "—" },
                { label: "Status", value: dupInfo.status ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 w-14 flex-shrink-0 font-mono">{label}</span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 hover:bg-slate-700 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Title duplicate warning modal ─────────────────────────────────────────────
// Shown after extraction when the resolved title closely matches an existing BRD.
// The user can choose to discard (go back) or proceed anyway.
function TitleDuplicateModal({
  extractedTitle,
  dupInfo,
  onDiscard,
  onProceed,
}: {
  extractedTitle: string;
  dupInfo: DuplicateCheckResponse;
  onDiscard: () => void;
  onProceed: () => void;
}) {
  const isFuzzy = dupInfo.matchType === "fuzzy";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onDiscard} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#131722] rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden">
        {/* Amber header — warning, not hard block */}
        <div className="bg-amber-500 px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              {isFuzzy ? "Similar BRD Already Exists" : "Duplicate BRD Detected"}
            </p>
            <p className="text-xs text-amber-100 mt-0.5">
              {isFuzzy
                ? "A BRD with a very similar title was found"
                : "A BRD with the same title already exists"}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The extracted title{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {extractedTitle}
            </span>{" "}
            {isFuzzy ? "closely matches" : "is the same as"} an existing BRD in the registry.
          </p>

          {/* Existing BRD details */}
          {dupInfo.brdId && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 divide-y divide-amber-100 dark:divide-amber-800/30 overflow-hidden">
              <div className="px-3 py-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400 font-mono">
                  Existing BRD (already in registry)
                </p>
              </div>
              {[
                { label: "BRD ID", value: dupInfo.brdId   },   // ← existing BRD's ID
                { label: "Title",  value: dupInfo.title  ?? "—" },
                { label: "Status", value: dupInfo.status ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 w-14 flex-shrink-0 font-mono">{label}</span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{value}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            You can discard this upload and open the existing BRD, or proceed to save it as a new entry.
          </p>
        </div>

        <div className="px-5 pb-5 flex items-center gap-3">
          <button
            onClick={onDiscard}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
          >
            Discard upload
          </button>
          <button
            onClick={onProceed}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white transition-all"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Upload({ onComplete }: Props) {
  const [file,         setFile]         = useState<File | null>(null);
  const [stage,        setStage]        = useState<Stage>("idle");
  const [dragging,     setDragging]     = useState(false);
  const [result,       setResult]       = useState<ExtractedResult | null>(null);
  const [errorMsg,     setErrorMsg]     = useState<string>("");
  const [pipelineStep, setPipelineStep] = useState<number>(-1);
  const [dupInfo,      setDupInfo]      = useState<DuplicateCheckResponse | null>(null);
  // Holds the fully-extracted result while we wait for the user to decide
  // what to do about a title duplicate.
  const [pendingResult, setPendingResult] = useState<ExtractedResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    setStage("idle");
    setResult(null);
    setPipelineStep(-1);
    setDupInfo(null);
    setPendingResult(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  // ── Shared: save draft + finish ────────────────────────────────────────────
  async function saveDraftAndFinish(data: ExtractedResult) {
    try {
      await api.post("/brd/save", {
        brdId:          data.brdId,
        title:          data.title,
        format:         data.format,
        status:         "DRAFT",
        scope:          data.scope,
        metadata:       data.metadata,
        toc:            data.toc,
        citations:      data.citations,
        contentProfile: data.contentProfile,
        brdConfig:      data.brdConfig ?? null,
      });
    } catch (saveErr) {
      console.warn("[Upload] Draft save failed:", saveErr);
    }
    setTimeout(() => {
      setResult(data);
      setStage("done");
    }, 400);
  }

  // ── Step 2: Process — extract then title-check ─────────────────────────────
  async function handleProcess() {
    if (!file) return;
    setStage("processing");
    setPipelineStep(0);

    let step = 0;
    const stepInterval = setInterval(() => {
      step = Math.min(step + 1, PIPELINE_STEPS.length - 1);
      setPipelineStep(step);
    }, 900);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await api.post<ExtractedResult>("/brd/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      clearInterval(stepInterval);
      const data = res.data;
      setPipelineStep(PIPELINE_STEPS.length);

      // ── Title-level duplicate check (uses the real extracted title) ────────
      // Exclude the BRD we just created (data.brdId) so a new upload never
      // falsely matches itself.
      try {
        const titleCheck = await api.get<DuplicateCheckResponse>(
          `/brd/check-duplicate-title?title=${encodeURIComponent(data.title)}&excludeId=${encodeURIComponent(data.brdId)}`
        );
        if (titleCheck.data.exists) {
          // Stash the result and surface the warning modal — user decides
          setPendingResult(data);
          setDupInfo(titleCheck.data);
          setStage("title_duplicate");
          return;
        }
      } catch {
        // If the check itself errors, just proceed — don't block the user
      }

      // No duplicate found — save and finish normally
      await saveDraftAndFinish(data);
    } catch (err) {
      clearInterval(stepInterval);
      const apiError =
        typeof err === "object" &&
        err !== null &&
        "response" in err &&
        typeof (err as { response?: { data?: { error?: string } } }).response?.data?.error === "string"
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;

      setErrorMsg(apiError || (err instanceof Error ? err.message : "Unknown error"));
      setStage("error");
    }
  }

  // User chose to discard the upload after seeing the title duplicate warning
  // User chose to discard — the BRD was already saved to DB by upload.ts,
  // so we must delete it before resetting state, otherwise it stays in the list.
  async function handleTitleDupDiscard() {
    const brdIdToDelete = pendingResult?.brdId;
    setPendingResult(null);
    setDupInfo(null);
    setStage("idle");
    setFile(null);
    setPipelineStep(-1);
    if (brdIdToDelete) {
      try {
        await api.delete(`/brd/${brdIdToDelete}`);
      } catch (err) {
        console.warn("[Upload] Failed to delete orphaned BRD on discard:", err);
      }
    }
  }

  // User chose to save anyway despite the title duplicate warning
  async function handleTitleDupProceed() {
    if (!pendingResult) return;
    const data = pendingResult;
    setPendingResult(null);
    setDupInfo(null);
    setStage("processing"); // briefly show pipeline while saving
    await saveDraftAndFinish(data);
  }

  return (
    <>
      <div className="w-full max-w-2xl mx-auto px-6 py-8 space-y-8 rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/30">

        {/* Header */}
        <div className="space-y-2">
          <span className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            Document Upload
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            BRD Intake
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Attach your file to start processing
          </p>
        </div>

        {/* 1. Drop Zone */}
        <div className="space-y-3 rounded-xl border border-slate-300/90 dark:border-slate-600 bg-slate-50/60 dark:bg-slate-900/40 p-4">
          <label className="text-xs font-semibold uppercase tracking-widest text-black dark:text-slate-100 font-mono">
            Upload File
          </label>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "group relative w-full flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed py-10 px-6 cursor-pointer transition-all duration-300",
              dragging
                ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-200/70"
                : file
                ? "border-emerald-400 bg-emerald-50/40"
                : "border-slate-300 dark:border-slate-600 bg-slate-50/50 hover:border-blue-400 hover:bg-blue-50/20"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {file ? (
              <>
                <div className="w-12 h-12 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{file.name}</p>
                  <p className="text-xs text-slate-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Drop file here or click to browse</p>
                  <p className="text-xs text-slate-500 mt-1">PDF, DOC, DOCX</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 3. Process Button */}
        {file && stage === "idle" && (
          <div className="flex justify-end pt-2">
            <button onClick={handleProcess} className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:shadow-md active:scale-95">
              Process
            </button>
          </div>
        )}

        {/* 5. Pipeline */}
        {(stage === "processing" || stage === "done") && (
          <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-600">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 font-mono">Processing Pipeline</p>
            </div>
            <div className="px-4 py-4 space-y-3">
              {PIPELINE_STEPS.map((ps, i) => {
                const isDone    = pipelineStep > i;
                const isRunning = pipelineStep === i;
                return (
                  <div key={ps.key} className="flex items-center gap-3 py-1">
                    <div className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
                      isDone ? "bg-emerald-100 dark:bg-emerald-500/20" : isRunning ? "bg-blue-100 dark:bg-blue-500/20" : "bg-slate-100 dark:bg-slate-800"
                    )}>
                      {isDone ? (
                        <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isRunning ? (
                        <svg className="animate-spin w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.8" />
                        </svg>
                      ) : (
                        <span className="text-xs text-slate-400">{ps.icon}</span>
                      )}
                    </div>
                    <span className={cn(
                      "text-sm font-medium flex-1 transition-all duration-200",
                      isDone ? "text-slate-400 dark:text-slate-600 line-through" : isRunning ? "text-blue-700 dark:text-blue-400" : "text-slate-700 dark:text-slate-300"
                    )}>
                      {ps.label}
                    </span>
                    {isDone && <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 6. Error */}
        {stage === "error" && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-500/10 border-l-4 border-red-500">
            <svg className="w-4 h-4 flex-shrink-0 text-red-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-400">Processing failed</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">{errorMsg}</p>
            </div>
            <button onClick={() => setStage("idle")} className="ml-auto text-xs text-red-700 underline hover:no-underline">Retry</button>
          </div>
        )}

        {/* 7. Done */}
        {stage === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border-l-4 border-emerald-500">
              <svg className="w-4 h-4 flex-shrink-0 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-400">
                Processing complete — <span className="font-semibold">{result.brdId}</span> is ready
                {result.imageMetadata && result.imageMetadata.length > 0 && (
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-200 dark:bg-emerald-700/40 text-emerald-800 dark:text-emerald-300 font-mono">
                    {result.imageMetadata.length} image{result.imageMetadata.length !== 1 ? "s" : ""} extracted
                  </span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "BRD ID",     value: result.brdId },
                { label: "Title",      value: result.title },
                { label: "Format",     value: result.format === "old" ? "Legacy Format" : "New Format" },
                { label: "Complexity", value: (result.contentProfile as Record<string,unknown>)?.complexity as string ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 font-mono mb-1">{label}</p>
                  <p className="text-sm font-medium truncate text-slate-900 dark:text-slate-100">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => onComplete?.(result)}
                className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:shadow-md active:scale-95"
              >
                Continue →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Title duplicate warning modal — shown after extraction */}
      {stage === "title_duplicate" && dupInfo && pendingResult && (
        <TitleDuplicateModal
          extractedTitle={pendingResult.title}
          dupInfo={dupInfo}
          onDiscard={handleTitleDupDiscard}
          onProceed={handleTitleDupProceed}
        />
      )}
    </>
  );
}