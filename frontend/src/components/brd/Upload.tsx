"use client";
import { useState, useRef } from "react";
import api from "@/app/lib/api";

function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Format = "new" | "old" | null;
type Stage  = "idle" | "checking" | "duplicate" | "validating" | "validated" | "processing" | "done" | "error";

interface ExtractedResult {
  brdId: string;
  title: string;
  format: string;
  status: string;
  scope: Record<string, unknown>;
  metadata: Record<string, unknown>;
  toc: Record<string, unknown>;
  citations: Record<string, unknown>;
  contentProfile: Record<string, unknown>;
  brdConfig?: Record<string, unknown>;
}

// Shape returned by GET /brd/check-duplicate
interface DuplicateCheckResponse {
  exists:  boolean;
  brdId?:  string;
  title?:  string;
  status?: string;
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

// ── Duplicate blocked modal ───────────────────────────────────────────────────
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
        {/* Red header stripe */}
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

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-white">"{fileName}"</span> already
            exists in the BRD registry. You cannot re-upload a file that has already been ingested.
          </p>

          {/* Existing record details */}
          {(dupInfo.brdId || dupInfo.title || dupInfo.status) && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Existing Record
              </p>
              <div className="space-y-1.5">
                {dupInfo.brdId && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-14">BRD ID</span>
                    <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded-md">{dupInfo.brdId}</span>
                  </div>
                )}
                {dupInfo.title && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-14">Title</span>
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{dupInfo.title}</span>
                  </div>
                )}
                {dupInfo.status && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-14">Status</span>
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-medium capitalize">{dupInfo.status}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            To update this BRD, please use the <span className="font-semibold text-slate-700 dark:text-slate-300">Edit</span> action from the registry instead.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-100 transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Upload({ onComplete }: Props) {
  const [format,       setFormat]       = useState<Format>(null);
  const [file,         setFile]         = useState<File | null>(null);
  const [dragging,     setDragging]     = useState(false);
  const [stage,        setStage]        = useState<Stage>("idle");
  const [result,       setResult]       = useState<ExtractedResult | null>(null);
  const [pipelineStep, setPipelineStep] = useState(-1);
  const [errorMsg,     setErrorMsg]     = useState<string>("");
  const [dupInfo,      setDupInfo]      = useState<DuplicateCheckResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    setStage("idle");
    setResult(null);
    setPipelineStep(-1);
    setErrorMsg("");
    setDupInfo(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  /** Validate: check for duplicate in DB first — BLOCK if found */
  async function handleValidate() {
    if (!file || !format) return;

    setStage("checking");
    setDupInfo(null);

    try {
      const res = await api.get<DuplicateCheckResponse>("/brd/check-duplicate", {
        params: { filename: file.name },
      });

      if (res.data.exists) {
        setDupInfo(res.data);
        setStage("duplicate"); // shows the blocking modal
        return;
      }
    } catch {
      // If endpoint doesn't exist yet, fall through gracefully
    }

    setStage("validated");
  }

  /** Process = POST to backend, animate pipeline steps while waiting */
  async function handleProcess() {
    if (!file || !format) return;
    setStage("processing");
    setErrorMsg("");

    let step = 0;
    const stepInterval = setInterval(() => {
      step++;
      setPipelineStep(step);
      if (step >= PIPELINE_STEPS.length - 1) clearInterval(stepInterval);
    }, 900);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", format);

      const res = await api.post<ExtractedResult>("/brd/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      clearInterval(stepInterval);

      const data = res.data;
      setPipelineStep(PIPELINE_STEPS.length);

      // ── Write a "DRAFT" (on going) record to the registry immediately ─────
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
            Choose a format and attach your file to start processing
          </p>
        </div>

        {/* 1. Format Selection */}
        <div className="space-y-3 rounded-xl border border-slate-300/90 dark:border-slate-600 bg-slate-50/60 dark:bg-slate-900/40 p-4">
          <label className="text-xs font-semibold uppercase tracking-widest text-black dark:text-slate-100 font-mono">
            Document Format
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(["new", "old"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFormat(f); setStage("idle"); setResult(null); setPipelineStep(-1); setDupInfo(null); }}
                className={cn(
                  "group relative px-4 py-4 rounded-lg border transition-all duration-200 text-left overflow-hidden",
                  format === f
                    ? "border-blue-500 dark:border-blue-500 bg-blue-50/40 dark:bg-blue-500/10"
                    : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-500 hover:-translate-y-0.5"
                )}
              >
                <div className="relative space-y-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200",
                      format === f ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-slate-600 bg-transparent"
                    )}>
                      {format === f && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <p className={cn("text-sm font-semibold", format === f ? "text-blue-600 dark:text-blue-400" : "text-slate-900 dark:text-slate-100")}>
                      {f === "new" ? "New Format" : "Legacy Format"}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 ml-8">
                    {f === "new" ? "Current standard template" : "Old template"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Drop Zone */}
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

        {/* 3. Validate Button */}
        {file && format && stage === "idle" && (
          <div className="flex justify-end pt-2">
            <button onClick={handleValidate} className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:shadow-md active:scale-95">
              Validate
            </button>
          </div>
        )}

        {/* Checking spinner */}
        {stage === "checking" && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <svg className="animate-spin w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.8" />
            </svg>
            <p className="text-sm text-slate-600 dark:text-slate-400">Checking for existing records…</p>
          </div>
        )}

        {/* 4. Validated: show meta + Process */}
        {stage === "validated" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "File",   value: file?.name ?? "" },
                { label: "Format", value: format === "new" ? "New Format" : "Legacy Format" },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 font-mono mb-1">{label}</p>
                  <p className="text-sm font-medium truncate text-slate-900 dark:text-slate-100">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={handleProcess} className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:shadow-md active:scale-95">
                Process
              </button>
            </div>
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
            <button onClick={() => setStage("validated")} className="ml-auto text-xs text-red-700 underline hover:no-underline">Retry</button>
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
                Processing complete — <span className="font-semibold">{result.brdId}</span> is On Going
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "BRD ID",     value: result.brdId },
                { label: "Title",      value: result.title },
                { label: "Complexity", value: (result.contentProfile as any)?.complexity ?? "—" },
                { label: "Domain",     value: (result.contentProfile as any)?.primary_domain ?? "—" },
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

      {/* Duplicate blocked modal — rendered outside the card so it overlays everything */}
      {stage === "duplicate" && dupInfo && file && (
        <DuplicateBlockedModal
          fileName={file.name}
          dupInfo={dupInfo}
          onClose={() => { setStage("idle"); setDupInfo(null); }}
        />
      )}
    </>
  );
}