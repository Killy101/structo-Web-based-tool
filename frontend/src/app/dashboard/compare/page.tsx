"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "../../../context/AuthContext";
import type { PdfChunk } from "../../../components/compare/ChunkPanel";
import type { User } from "../../../types";
import { trackCompareUsage } from "../../../utils/compareAnalytics";

const ChunkPanel = dynamic(
  () => import("../../../components/compare/ChunkPanel"),
  { ssr: false },
);
const ComparePanel = dynamic(
  () => import("../../../components/compare/ComparePanel"),
  { ssr: false },
);
const MergePanel = dynamic(
  () => import("../../../components/compare/MergePanel"),
  { ssr: false },
);

type Workflow = "selector" | "chunk" | "compare" | "merge";

/**
 * Cross-module job state.
 * After /upload succeeds, job_id is stored here so ChunkPanel can call
 * /start-chunking, and ComparePanel can call /compare/{chunk_id}?job_id=...
 */
export interface JobState {
  job_id: string;
  source_name: string;
  status: "uploaded" | "processing" | "done" | "error";
}

// ── Workflow Selector Card ────────────────────────────────────────────────────

function WorkflowCard({
  title,
  description,
  badge,
  icon,
  steps,
  color,
  onClick,
  locked,
}: {
  title: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  steps: string[];
  color: "blue" | "violet";
  onClick: () => void;
  locked?: boolean;
}) {
  const gradient =
    color === "blue"
      ? "border-blue-500/30 hover:border-blue-400/50 bg-blue-500/5 dark:bg-gradient-to-br dark:from-blue-600/20 dark:to-blue-500/5"
      : "border-violet-500/30 hover:border-violet-400/50 bg-violet-500/5 dark:bg-gradient-to-br dark:from-violet-600/20 dark:to-violet-500/5";
  const badgeColor =
    color === "blue"
      ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30"
      : "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30";
  const iconBg =
    color === "blue"
      ? "bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/20"
      : "bg-violet-100 text-violet-600 border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/20";
  const stepDot =
    color === "blue"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-500/40 dark:text-blue-300"
      : "bg-violet-100 text-violet-700 dark:bg-violet-500/40 dark:text-violet-300";
  const btnClass =
    color === "blue"
      ? "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25"
      : "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/25";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border ${gradient} p-6 transition-all duration-200 ${locked ? "opacity-60" : "cursor-pointer hover:shadow-xl"}`}
      onClick={locked ? undefined : onClick}
    >
      {locked && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-rose-500/15 border border-rose-500/25 text-rose-300 text-[10px] font-semibold">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          Locked
        </div>
      )}

      {/* Icon + Badge */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center border ${iconBg}`}
        >
          {icon}
        </div>
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${badgeColor}`}
        >
          {badge}
        </span>
      </div>

      {/* Title + Description */}
      <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5">
        {description}
      </p>

      {/* Steps */}
      <ol className="space-y-1.5 mb-6">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${stepDot}`}
            >
              {i + 1}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{step}</span>
          </li>
        ))}
      </ol>

      {/* CTA */}
      {!locked && (
        <button
          className={`mt-auto flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all ${btnClass}`}
          onClick={onClick}
        >
          Start Workflow
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
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Chunk Workflow Modal ──────────────────────────────────────────────────────

type FileCount = 2 | 3;

export type ConversionPair =
  | "pdf-to-pdf"
  | "pdf-to-html"
  | "html-to-html";

export interface ChunkOpts {
  fileCount: FileCount;
  conversionPair: ConversionPair;
}

const CONVERSION_OPTIONS: {
  value: ConversionPair;
  label: string;
  from: string;
  to: string;
  fromExt: string;
  toExt: string;
  description: string;
}[] = [
  {
    value: "pdf-to-pdf",
    label: "PDF → PDF",
    from: "PDF",
    to: "PDF",
    fromExt: ".pdf",
    toExt: ".pdf",
    description: "Compare two PDF revisions",
  },
  {
    value: "pdf-to-html",
    label: "PDF → HTML",
    from: "PDF",
    to: "HTML",
    fromExt: ".pdf",
    toExt: ".html",
    description: "Convert & diff PDF to HTML",
  },
  {
    value: "html-to-html",
    label: "HTML → HTML",
    from: "HTML",
    to: "HTML",
    fromExt: ".html",
    toExt: ".html",
    description: "Compare two HTML revisions",
  },
];

function FileTypeIcon({ ext, size = 20 }: { ext: string; size?: number }) {
  const isPdf = ext === ".pdf";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <rect x="2" y="1" width="12" height="16" rx="2"
        fill={isPdf ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)"}
        stroke={isPdf ? "rgba(239,68,68,0.5)" : "rgba(59,130,246,0.5)"}
        strokeWidth="1.2" />
      <rect x="10" y="1" width="4" height="4" rx="0"
        fill={isPdf ? "rgba(239,68,68,0.25)" : "rgba(59,130,246,0.25)"} />
      <path d="M10 1 L14 5 L10 5 Z"
        fill={isPdf ? "rgba(239,68,68,0.35)" : "rgba(59,130,246,0.35)"} />
      <text x="4" y="13.5" fontSize="4.5" fontWeight="700" letterSpacing="0.2"
        fill={isPdf ? "#f87171" : "#60a5fa"} fontFamily="monospace">
        {isPdf ? "PDF" : "HTM"}
      </text>
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChunkWorkflowModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: ChunkOpts) => void;
}) {
  const [fileCount, setFileCount] = React.useState<FileCount>(2);
  const [conversionPair, setConversionPair] = React.useState<ConversionPair>("pdf-to-pdf");

  if (!open) return null;

  const selectedOption = CONVERSION_OPTIONS.find((o) => o.value === conversionPair)!;

  function handleConfirm() {
    onConfirm({ fileCount, conversionPair });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}
    >
      {/* Sheet */}
      <div
        className="relative w-full max-w-[460px] rounded-2xl overflow-hidden shadow-2xl
          bg-white dark:bg-[#0a0d1c]
          border border-violet-200 dark:border-violet-500/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent bar */}
        <div className="h-0.5 w-full" style={{
          background: "linear-gradient(90deg, transparent, #7c3aed 40%, #a855f7 60%, transparent)"
        }} />

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-violet-100 dark:border-violet-500/15">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-violet-100 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30">
              <svg className="text-violet-500 dark:text-violet-400" style={{ width: 18, height: 18 }}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M4 6h16M4 10h16M4 14h8M4 18h8" />
              </svg>
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                Configure Chunking
              </h2>
              <p className="text-[11px] mt-0.5 text-slate-500 dark:text-slate-500">
                Workflow 2 · Chunk-based Comparison
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors
              text-slate-400 dark:text-slate-500
              bg-slate-100 dark:bg-white/5
              border border-slate-200 dark:border-white/10
              hover:bg-slate-200 dark:hover:bg-white/10"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Step 1: Conversion pair */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/20 border border-violet-200 dark:border-violet-500/30">
                1
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Document Conversion Type
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CONVERSION_OPTIONS.map((opt) => {
                const active = conversionPair === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setConversionPair(opt.value)}
                    className={`relative flex flex-col items-center gap-2 rounded-xl py-3.5 px-2 transition-all duration-150 border
                      ${active
                        ? "bg-violet-50 dark:bg-violet-500/16 border-violet-400 dark:border-violet-500/55"
                        : "bg-slate-50 dark:bg-white/4 border-slate-200 dark:border-white/9 hover:border-violet-300 dark:hover:border-violet-500/30"
                      }`}
                  >
                    {active && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />}
                    <div className="flex items-center gap-1">
                      <FileTypeIcon ext={opt.fromExt} size={18} />
                      <ArrowRight />
                      <FileTypeIcon ext={opt.toExt} size={18} />
                    </div>
                    <span className={`text-[11px] font-semibold leading-tight text-center
                      ${active ? "text-violet-700 dark:text-violet-300" : "text-slate-700 dark:text-slate-300"}`}>
                      {opt.label}
                    </span>
                    <span className="text-[10px] leading-tight text-center text-slate-500 dark:text-slate-500">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-slate-100 dark:bg-violet-500/15" />

          {/* Step 2: File count */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/20 border border-violet-200 dark:border-violet-500/30">
                2
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Number of Input Files
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([2, 3] as FileCount[]).map((n) => {
                const active = fileCount === n;
                return (
                  <button
                    key={n}
                    onClick={() => setFileCount(n)}
                    className={`relative flex items-center gap-3 rounded-xl px-4 py-3.5 transition-all duration-150 text-left border
                      ${active
                        ? "bg-violet-50 dark:bg-violet-500/16 border-violet-400 dark:border-violet-500/55"
                        : "bg-slate-50 dark:bg-white/4 border-slate-200 dark:border-white/9 hover:border-violet-300 dark:hover:border-violet-500/30"
                      }`}
                  >
                    {active && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold text-base border
                      ${active
                        ? "bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-500/35"
                        : "bg-white dark:bg-white/5 text-slate-500 dark:text-slate-500 border-slate-200 dark:border-white/10"
                      }`}>
                      {n}
                    </div>
                    <div>
                      <div className={`text-[12px] font-semibold
                        ${active ? "text-violet-700 dark:text-violet-300" : "text-slate-700 dark:text-slate-300"}`}>
                        {n === 2 ? "2 Files" : "3 Files"}
                      </div>
                      <div className="text-[10px] mt-0.5 text-slate-500 dark:text-slate-500">
                        {n === 2
                          ? `Old ${selectedOption.fromExt} + New ${selectedOption.toExt}`
                          : "Old + New + innod.xml"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview strip */}
          <div className="rounded-xl px-4 py-3 flex items-center gap-3 bg-violet-50 dark:bg-violet-500/7 border border-violet-100 dark:border-violet-500/15">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1">
                <FileTypeIcon ext={selectedOption.fromExt} size={16} />
                <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500">OLD</span>
              </div>
              <div className="h-px flex-1 bg-slate-200 dark:bg-violet-500/20" style={{ minWidth: 6 }} />
              <div className="flex flex-col items-center gap-1">
                <FileTypeIcon ext={selectedOption.toExt} size={16} />
                <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500">NEW</span>
              </div>
              {fileCount === 3 && (
                <>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-violet-500/20" style={{ minWidth: 6 }} />
                  <div className="flex flex-col items-center gap-1">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <rect x="2" y="1" width="12" height="16" rx="2"
                        fill="rgba(16,185,129,0.12)" stroke="rgba(16,185,129,0.5)" strokeWidth="1.2" />
                      <text x="3.5" y="13.5" fontSize="4" fontWeight="700"
                        fill="#34d399" fontFamily="monospace">XML</text>
                    </svg>
                    <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500">XML</span>
                  </div>
                </>
              )}
            </div>
            <div className="h-7 w-px mx-1 shrink-0 bg-slate-200 dark:bg-violet-500/20" />
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-500">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {fileCount} upload{fileCount > 1 ? "s" : ""}
              </span>{" "}
              · {selectedOption.label}
              {fileCount === 3 && " + XML"}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-6 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors
              text-slate-600 dark:text-slate-400
              bg-slate-100 dark:bg-white/4
              border border-slate-200 dark:border-white/9
              hover:bg-slate-200 dark:hover:bg-white/8"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-[2] py-2.5 rounded-xl text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
              boxShadow: "0 4px 24px rgba(124,58,237,0.35)",
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 10h16M4 14h8M4 18h8" />
            </svg>
            Chunk Now
          </button>
        </div>
      </div>
    </div>
  );
}
// ── Page Header ───────────────────────────────────────────────────────────────

function PageHeader({
  workflow,
  onBack,
  user,
  selectedChunk,
  onViewChunks,
  activeJob,
}: {
  workflow: Workflow;
  onBack: () => void;
  user: User | null;
  selectedChunk: PdfChunk | null;
  onViewChunks: () => void;
  activeJob: JobState | null;
}) {
  const titles: Record<Workflow, string> = {
    selector: "Document Comparison",
    chunk: "Chunk-based Comparison",
    compare: "Direct Comparison",
    merge: "Merge XML",
  };

  const subtitles: Record<Workflow, string> = {
    selector: "Choose a comparison workflow to get started",
    chunk:
      "Analyze documents by chunks — review changed sections before confirming updates",
    compare:
      "Upload Old PDF, New PDF, and XML to detect and highlight all changes",
    merge: "Merge accepted changes into the final XML output",
  };

  return (
    <div
      className="flex-shrink-0 flex items-center gap-4 px-6 py-4 border-b"
      style={{ borderColor: "rgba(26, 143, 209, 0.12)" }}
    >
      {workflow !== "selector" && (
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center border transition-all text-slate-400 hover:text-white"
          style={{
            background: "rgba(26, 143, 209, 0.06)",
            borderColor: "rgba(26, 143, 209, 0.15)",
          }}
          title="Back to workflow selector"
        >
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">
            {titles[workflow]}
          </h1>
          {workflow !== "selector" && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
              style={{
                background: "rgba(26, 143, 209, 0.12)",
                color: "#42b4f5",
                border: "1px solid rgba(26, 143, 209, 0.2)",
              }}
            >
              {workflow === "chunk"
                ? "Step 1 of 2"
                : workflow === "compare"
                  ? "Upload & Detect"
                  : "Merge"}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {subtitles[workflow]}
        </p>
      </div>

      {/* Active job badge */}
      {activeJob && workflow !== "selector" && (
        <div
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono"
          style={{
            background: "rgba(16, 185, 129, 0.07)",
            borderColor: "rgba(16, 185, 129, 0.2)",
            color: "#6ee7b7",
          }}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              activeJob.status === "done"
                ? "bg-emerald-400"
                : activeJob.status === "processing"
                  ? "bg-amber-400 animate-pulse"
                  : activeJob.status === "error"
                    ? "bg-red-400"
                    : "bg-slate-400"
            }`}
          />
          {activeJob.source_name}
        </div>
      )}

      {/* Chunk → Compare navigation hint */}
      {selectedChunk && workflow !== "compare" && (
        <button
          onClick={onViewChunks}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border"
          style={{
            background: "rgba(59, 130, 246, 0.12)",
            borderColor: "rgba(59, 130, 246, 0.25)",
            color: "#93c5fd",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          {selectedChunk.filename} ready in Compare →
        </button>
      )}

      {/* Role badge */}
      <div className="flex-shrink-0">
        <span
          className="text-[10px] px-2 py-1 rounded-full font-medium"
          style={{
            background: "rgba(26, 143, 209, 0.08)",
            color: "#64748b",
          }}
        >
          {user?.role === "SUPER_ADMIN"
            ? "Super Admin"
            : (user?.team?.name ?? "Team")}
        </span>
      </div>
    </div>
  );
}

// ── Workflow Selector ─────────────────────────────────────────────────────────

function WorkflowSelector({
  canChunk,
  canCompare,
  canMerge,
  onSelect,
  onChunkClick,
}: {
  canChunk: boolean;
  canCompare: boolean;
  canMerge: boolean;
  onSelect: (w: Workflow) => void;
  onChunkClick: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Hero */}
      <div className="text-center mb-8">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 border"
          style={{
            background: "rgba(26, 143, 209, 0.1)",
            borderColor: "rgba(26, 143, 209, 0.2)",
          }}
        >
          <svg
            className="w-8 h-8 text-[#42b4f5]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          Select a Comparison Workflow
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-500 max-w-lg mx-auto">
          Upload your Old PDF, New PDF, and XML file — then choose how you want
          to review the changes.
        </p>
      </div>

      {/* Workflow cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
        {/* Direct Comparison */}
        <WorkflowCard
          title="Direct Comparison"
          description="Upload three files and instantly detect all differences between the Old and New PDF, highlighted with emphasis formatting in the XML output."
          badge="Workflow 1"
          color="blue"
          locked={!canCompare}
          onClick={() => onSelect("compare")}
          icon={
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          }
          steps={[
            "Upload Old PDF, New PDF, and XML file",
            "Click Detect Changes to run comparison",
            "Review highlighted additions, removals, and modifications",
            "Apply or dismiss changes, then download the updated XML",
          ]}
        />

        {/* Chunk-based Comparison */}
        <WorkflowCard
          title="Chunk-based Comparison"
          description="Split the XML into sections and identify exactly which chunks have been modified. Review each changed section in a modal before confirming updates."
          badge="Workflow 2"
          color="violet"
          locked={!canChunk}
          onClick={() => canChunk && onChunkClick()}
          icon={
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M4 6h16M4 10h16M4 14h8M4 18h8"
              />
            </svg>
          }
          steps={[
            "Upload Old PDF, New PDF, and XML file",
            "Files uploaded via /upload → job_id returned",
            "POST /start-chunking to begin async processing",
            "Review chunk list → open changed chunks in Compare",
          ]}
        />
      </div>

      {/* Merge section */}
      {canMerge && (
        <div className="max-w-3xl mx-auto mt-5">
          <button
            onClick={() => onSelect("merge")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left"
            style={{
              background: "rgba(16, 185, 129, 0.04)",
              borderColor: "rgba(16, 185, 129, 0.2)",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
              style={{
                background: "rgba(16, 185, 129, 0.12)",
                borderColor: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
              }}
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-300">
                Merge XML Chunks
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Combine reviewed XML chunks (SourceName_innod.NNNNN.xml) into a
                final SourceName_final.xml document
              </p>
            </div>
            <svg
              className="w-4 h-4 text-slate-600 ml-auto flex-shrink-0"
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
        </div>
      )}

      {/* No access */}
      {!canCompare && !canChunk && (
        <div className="max-w-3xl mx-auto mt-5 flex items-center gap-3 p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
          <svg
            className="w-5 h-5 text-rose-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-sm text-rose-300">
            You don&apos;t have access to any comparison workflows. Contact your
            administrator to enable Compare features.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const { user } = useAuth();
  const features = user?.effectiveFeatures ?? [];
  const isSuperAdmin = user?.role === "SUPER_ADMIN" || features.includes("*");
  const canCompare = isSuperAdmin || features.includes("compare-basic");
  const canChunk = isSuperAdmin || features.includes("compare-chunk");
  const canMerge = isSuperAdmin || features.includes("compare-merge");

  const [workflow, setWorkflow] = useState<Workflow>("selector");
  const [chunkModalOpen, setChunkModalOpen] = useState(false);
  const [chunkOpts, setChunkOpts] = useState<ChunkOpts | null>(null);

  // Active job — set by ChunkPanel after /upload succeeds
  const [activeJob, setActiveJob] = useState<JobState | null>(null);

  // Cross-module state: chunk selected in ChunkPanel → passed to ComparePanel
  const [selectedChunk, setSelectedChunk] = useState<PdfChunk | null>(null);
  const [allChunks, setAllChunks] = useState<PdfChunk[]>([]);
  const [jobOldPdf, setJobOldPdf] = useState<File | null>(null);
  const [jobNewPdf, setJobNewPdf] = useState<File | null>(null);
  const [jobXmlFile, setJobXmlFile] = useState<File | null>(null);

  function handleJobCreated(job: JobState) {
    setActiveJob(job);
  }

  function handleChunkDone(updatedChunk: PdfChunk) {
    // Update the chunk in allChunks — e.g. when span-level detection corrects
    // a false-positive has_changes flag from the fast word-diff pass.
    setAllChunks(prev =>
      prev.map(c => c.index === updatedChunk.index ? { ...c, ...updatedChunk } : c)
    );
  }

  function handleBack() {
    setWorkflow("selector");
  }

  return (
    <div className="flex flex-col h-full min-h-0 -mx-6 -mb-6">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <PageHeader
        workflow={workflow}
        onBack={handleBack}
        user={user}
        activeJob={activeJob}
        selectedChunk={selectedChunk}
        onViewChunks={() => setWorkflow("compare")}
      />

      {/* ── Chunk Workflow Modal ─────────────────────────────────────────────── */}
      <ChunkWorkflowModal
        open={chunkModalOpen}
        onClose={() => setChunkModalOpen(false)}
        onConfirm={(opts) => {
          setChunkOpts(opts);
          setWorkflow("chunk");
          trackCompareUsage('chunk', user?.userId ?? 'anonymous');
        }}
      />

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {workflow === "selector" && (
        <WorkflowSelector
          canChunk={canChunk}
          canCompare={canCompare}
          canMerge={canMerge}
          onSelect={(w) => {
            setWorkflow(w);
            if (w === "compare") trackCompareUsage('direct', user?.userId ?? 'anonymous');
          }}
          onChunkClick={() => setChunkModalOpen(true)}
        />
      )}

      {workflow === "chunk" && (
        <div className="flex-1 overflow-hidden p-4 min-h-0">
          <ChunkPanel
            onNavigateToCompare={(chunk) => {
              setSelectedChunk(chunk);
              setWorkflow("compare");
            }}
            onAllChunksReady={(chunks) => setAllChunks(chunks)}
            onFilesReady={(oldPdf, newPdf, xmlFile) => {
              setJobOldPdf(oldPdf);
              setJobNewPdf(newPdf);
              setJobXmlFile(xmlFile ?? null);
            }}
            onJobCreated={handleJobCreated}
            activeJob={activeJob}
            fileCount={chunkOpts?.fileCount ?? 2}
            conversionPair={chunkOpts?.conversionPair ?? "pdf-to-pdf"}
          />
        </div>
      )}

      {workflow === "compare" && (
        <div className="flex-1 overflow-hidden p-4 min-h-0">
          <ComparePanel
            initialChunk={selectedChunk}
            initialOldPdf={jobOldPdf}
            initialNewPdf={jobNewPdf}
            initialXmlFile={jobXmlFile}
            allChunks={allChunks}
            onChunkDone={handleChunkDone}
            onNavigateToChunk={(chunk) => setSelectedChunk(chunk)}
            activeJob={activeJob}
          />
        </div>
      )}

      {workflow === "merge" && canMerge && (
        <div className="flex-1 overflow-hidden p-4 min-h-0">
          <MergePanel activeJob={activeJob} />
        </div>
      )}
    </div>
  );
}