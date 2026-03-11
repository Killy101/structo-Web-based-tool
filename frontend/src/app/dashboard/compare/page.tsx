"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "../../../context/AuthContext";
import type { PdfChunk } from "../../../components/compare/ChunkPanel";
import type { User } from "../../../types";

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
      ? "from-blue-600/20 to-blue-500/5 border-blue-500/30 hover:border-blue-400/50"
      : "from-violet-600/20 to-violet-500/5 border-violet-500/30 hover:border-violet-400/50";
  const badgeColor =
    color === "blue"
      ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
      : "bg-violet-500/20 text-violet-300 border-violet-500/30";
  const iconBg =
    color === "blue"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
      : "bg-violet-500/15 text-violet-400 border-violet-500/20";
  const stepDot =
    color === "blue"
      ? "bg-blue-500/40 text-blue-300"
      : "bg-violet-500/40 text-violet-300";
  const btnClass =
    color === "blue"
      ? "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25"
      : "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/25";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-gradient-to-br ${gradient} p-6 transition-all duration-200 ${locked ? "opacity-60" : "cursor-pointer hover:shadow-xl"}`}
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
      <h3 className="text-base font-bold text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed mb-5">
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
            <span className="text-xs text-slate-400">{step}</span>
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

// ── Page Header ───────────────────────────────────────────────────────────────

function PageHeader({
  workflow,
  onBack,
  user,
  selectedChunk,
  onViewChunks,
}: {
  workflow: Workflow;
  onBack: () => void;
  user: User | null;
  selectedChunk: PdfChunk | null;
  onViewChunks: () => void;
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
          <h1 className="text-base font-bold text-white truncate">
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
}: {
  canChunk: boolean;
  canCompare: boolean;
  canMerge: boolean;
  onSelect: (w: Workflow) => void;
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
        <h2 className="text-xl font-bold text-white mb-2">
          Select a Comparison Workflow
        </h2>
        <p className="text-sm text-slate-500 max-w-lg mx-auto">
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
          onClick={() => onSelect("chunk")}
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
            "Set source name and XML tag for chunking",
            "Review chunk results in a modal — see which sections changed",
            "Open changed chunks in Compare for detailed review",
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
                Merge XML
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Manually merge accepted or rejected changes from two XML files
                into a final output
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

  // Roles that always have access regardless of feature flags
  const isManager =
    user?.role === "MANAGER_QA" ||
    user?.role === "MANAGER_QC" ||
    user?.role === "ADMIN";

  const hasBaseAccess = isSuperAdmin || isManager;

  const canCompare = hasBaseAccess || features.includes("compare-basic");
  const canChunk = hasBaseAccess || features.includes("compare-chunk");
  const canMerge = hasBaseAccess || features.includes("compare-merge");

  const [workflow, setWorkflow] = useState<Workflow>("selector");

  // Cross-module state: chunk selected in ChunkPanel → passed to ComparePanel
  const [selectedChunk, setSelectedChunk] = useState<PdfChunk | null>(null);
  const [selectedChunkSourceName, setSelectedChunkSourceName] =
    useState<string>("");

  function handleNavigateToCompare(chunk: PdfChunk, sourceName: string) {
    setSelectedChunk(chunk);
    setSelectedChunkSourceName(sourceName);
    setWorkflow("compare");
  }

  function handleBack() {
    setWorkflow("selector");
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 -m-6"
      style={{ background: "rgba(4, 9, 20, 0.6)" }}
    >
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <PageHeader
        workflow={workflow}
        onBack={handleBack}
        user={user}
        selectedChunk={selectedChunk}
        onViewChunks={() => setWorkflow("compare")}
      />

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {workflow === "selector" && (
        <WorkflowSelector
          canChunk={canChunk}
          canCompare={canCompare}
          canMerge={canMerge}
          onSelect={setWorkflow}
        />
      )}

      {workflow === "chunk" && (
        <div className="flex-1 overflow-hidden min-h-0">
          <ChunkPanel onNavigateToCompare={handleNavigateToCompare} />
        </div>
      )}

      {workflow === "compare" && (
        <div className="flex-1 overflow-hidden min-h-0">
          <ComparePanel
            initialChunk={selectedChunk}
            initialSourceName={selectedChunkSourceName}
          />
        </div>
      )}

      {workflow === "merge" && canMerge && (
        <div className="flex-1 overflow-hidden p-4 min-h-0">
          <MergePanel />
        </div>
      )}
    </div>
  );
}
