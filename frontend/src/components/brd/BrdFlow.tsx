"use client";

import { useState, useEffect, useCallback } from "react";
import Upload from "./Upload";
import Scope from "./Scope";
import Metadata from "./Metadata";
import ContentProfile from "./ContentProf";
import Toc from "./TOC";
import Citation from "./Citation";
import Generate from "./Generate";
import api from "@/app/lib/api";

interface Props {
  onClose?: () => void;
  initialStep?: number;
  initialMeta?: { format: "new" | "old"; brdId: string; title: string } | null;
  finalStepMode?: "generate" | "view";
}

interface UploadFlowData {
  format: "new" | "old";
  brdId: string;
  title: string;
  scope?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  toc?: Record<string, unknown>;
  citations?: Record<string, unknown>;
  contentProfile?: Record<string, unknown>;
  brdConfig?: Record<string, unknown>;
}

interface BrdDetailResponse {
  id:              string;
  title:           string;
  format:          "new" | "old";
  scope?:          Record<string, unknown>;
  metadata?:       Record<string, unknown>;
  toc?:            Record<string, unknown>;
  citations?:      Record<string, unknown>;
  contentProfile?: Record<string, unknown>;
  brdConfig?:      Record<string, unknown>;
}

// Full flow (new upload): Upload → Scope → Metadata → TOC → Citation → ContentProfile → Generate
const STEPS = ["Upload", "Scope", "Metadata", "TOC", "Citation Rules", "Content Profiling", "Generate"];

// Edit flow (from registry): skips Upload entirely
const EDIT_STEPS = ["Scope", "Metadata", "TOC", "Citation Rules", "Content Profiling", "Generate"];

const STEP_META = [
  { icon: "↑", desc: "Start by uploading your source documents" },
  { icon: "◎", desc: "Define boundaries, objectives, and scope" },
  { icon: "≡", desc: "Add project details and stakeholders" },
  { icon: "✦", desc: "Generate and customize the table of contents" },
  { icon: "§", desc: "Define citation formatting and standardization rules" },
  { icon: "⬡", desc: "Analyze and structure content" },
  { icon: "✦", desc: "Review and generate the final BRD document" },
];

// Edit mode step meta: same as STEP_META but without the Upload entry (index 0)
const EDIT_STEP_META = STEP_META.slice(1);

// ── Exit confirmation modal ────────────────────────────────────────────────
function ExitConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#131722] rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl w-[min(400px,90vw)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Exit without saving?</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Any unsaved changes will be lost.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-all"
          >
            Exit anyway
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BrdFlow({
  onClose,
  initialStep = 0,
  initialMeta = null,
  finalStepMode = "generate",
}: Props) {
  // ── Edit mode: opened from registry (has a brdId, no upload needed) ────────
  // Requirement 5: in edit mode never show the Upload step.
  const isEditMode = !!initialMeta?.brdId;

  // When Generate's per-section "Edit" button was clicked, cameFromGenerate=true
  // so we can show the "Back to Generate" shortcut (requirement 4).
  const cameFromGenerate = isEditMode && initialStep >= 1 && initialStep <= 5;

  // Convert full-flow step index → edit-mode step index (subtract 1 because no Upload)
  const toEditStep   = (s: number) => Math.max(0, s - 1);
  // Convert edit-mode step index → full-flow step index
  const fromEditStep = (s: number) => s + 1;

  const steps    = isEditMode ? EDIT_STEPS     : STEPS;
  const stepMeta = isEditMode ? EDIT_STEP_META : STEP_META;

  const clampedInitial = isEditMode
    ? Math.max(0, Math.min(toEditStep(initialStep), EDIT_STEPS.length - 1))
    : Math.max(0, Math.min(initialStep, STEPS.length - 1));

  const [step,            setStep]            = useState(clampedInitial);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [uploadMeta,      setUploadMeta]      = useState<UploadFlowData | null>(
    initialMeta
      ? { format: initialMeta.format, brdId: initialMeta.brdId, title: initialMeta.title }
      : null
  );
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError,   setViewError]   = useState<string | null>(null);

  const isLastStep     = step === steps.length - 1;
  const isGenerateStep = isLastStep; // Generate is always the last step

  // ── Fetch full BRD data when opening in edit or view mode ─────────────────
  useEffect(() => {
    if (!initialMeta?.brdId) return;
    // In full flow only fetch when jumping straight to Generate
    if (!isEditMode && initialStep < 6) return;

    setViewLoading(true);
    setViewError(null);

    api
      .get<BrdDetailResponse>(`/brd/${initialMeta.brdId}`)
      .then((res) => {
        const d = res.data;
        setUploadMeta({
          format:         d.format         ?? initialMeta.format,
          brdId:          d.id             ?? initialMeta.brdId,
          title:          d.title          ?? initialMeta.title,
          scope:          d.scope,
          metadata:       d.metadata,
          toc:            d.toc,
          citations:      d.citations,
          contentProfile: d.contentProfile,
          brdConfig:      d.brdConfig,
        });
      })
      .catch((err) => {
        console.error("Failed to load BRD:", err);
        setViewError("Failed to load BRD data. Please try again.");
      })
      .finally(() => setViewLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  // Requirement 1: show exit confirmation unless already on Generate (work saved)
  // or on the very first Upload screen before anything was uploaded.
  const requestClose = useCallback(() => {
    const isBlankUpload = !isEditMode && step === 0 && !uploadMeta;
    if (isGenerateStep || isBlankUpload) {
      onClose?.();
    } else {
      setShowExitConfirm(true);
    }
  }, [isGenerateStep, isEditMode, step, uploadMeta, onClose]);

  function getBestTitle(): string {
    const md = uploadMeta?.metadata as Record<string, unknown> | undefined;
    if (md) {
      const t = (k: string) => (typeof md[k] === "string" ? (md[k] as string).trim() : "");
      return (
        t("content_category_name") ||
        t("source_name") ||
        t("document_title") ||
        uploadMeta?.title ||
        initialMeta?.title ||
        "Untitled BRD"
      );
    }
    return uploadMeta?.title ?? initialMeta?.title ?? "Untitled BRD";
  }

  // When Generate calls onEdit(fullStep), map to the right local step index
  function handleEditFromGenerate(targetFullStep: number) {
    setStep(isEditMode ? toEditStep(targetFullStep) : targetFullStep);
  }

  // ── Step renderer ──────────────────────────────────────────────────────────
  function renderStepContent() {
    // Normalise to the full-flow step number so switch cases are always the same
    const fullStep = isEditMode ? fromEditStep(step) : step;

    switch (fullStep) {
      // ── 0: Upload (full flow only — never reached in edit mode) ────────────
      case 0:
        return (
          <Upload
            onComplete={(data) => {
              setUploadMeta(data as UploadFlowData);
              next();
            }}
          />
        );

      // ── 1: Scope ────────────────────────────────────────────────────────────
      case 1:
        return <Scope initialData={uploadMeta?.scope} />;

      // ── 2: Metadata ─────────────────────────────────────────────────────────
      case 2:
        return (
          <Metadata
            format={uploadMeta?.format ?? "new"}
            brdId={uploadMeta?.brdId}
            title={getBestTitle()}
            initialData={uploadMeta?.metadata}
          />
        );

      // ── 3: TOC ──────────────────────────────────────────────────────────────
      case 3:
        return <Toc initialData={uploadMeta?.toc as { sections?: { id?: string; level?: string; name?: string; required?: string; definition?: string; example?: string; note?: string; tocRequirements?: string; smeComments?: string }[] } | undefined} />;

      // ── 4: Citation ─────────────────────────────────────────────────────────
      case 4:
        return <Citation initialData={uploadMeta?.citations} />;

      // ── 5: Content Profiling ────────────────────────────────────────────────
      case 5:
        return <ContentProfile initialData={uploadMeta?.contentProfile} />;

      // ── 6: Generate ─────────────────────────────────────────────────────────
      case 6: {
        if (viewLoading) {
          return (
            <div className="flex items-center justify-center py-24 gap-3">
              <svg className="animate-spin w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.8" />
              </svg>
              <span className="text-sm font-medium text-slate-500">Loading BRD data…</span>
            </div>
          );
        }
        if (viewError) {
          return (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <p className="text-sm text-red-600 font-medium">{viewError}</p>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 transition-all"
              >
                Close
              </button>
            </div>
          );
        }
        return (
          <Generate
            brdId={uploadMeta?.brdId}
            title={getBestTitle()}
            format={uploadMeta?.format ?? initialMeta?.format ?? "new"}
            initialData={{
              scope:          uploadMeta?.scope,
              metadata:       uploadMeta?.metadata,
              toc:            uploadMeta?.toc,
              citations:      uploadMeta?.citations,
              contentProfile: uploadMeta?.contentProfile,
              brdConfig:      uploadMeta?.brdConfig,
            }}
            canEdit={finalStepMode !== "view"}
            onEdit={handleEditFromGenerate}
            onComplete={onClose}
          />
        );
      }

      default:
        return null;
    }
  }

  // ── Step indicator ─────────────────────────────────────────────────────────
  function StepIndicator() {
    return (
      <div className="flex items-center justify-center gap-0 px-4 py-3 overflow-x-auto">
        {steps.map((label, i) => {
          const done    = i < step;
          const current = i === step;
          return (
            <div key={label} className="flex items-center">
              <button
                onClick={() => { if (i <= step) setStep(i); }}
                disabled={i > step}
                title={label}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                  ${done    ? "bg-blue-600 border-blue-600 text-white cursor-pointer hover:bg-blue-700"
                  : current ? "bg-white border-blue-500 text-blue-600 shadow-md"
                  :           "bg-white border-slate-300 text-slate-400 cursor-not-allowed"}`}
              >
                {done ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepMeta[i].icon
                )}
              </button>
              {i < steps.length - 1 && (
                <div className={`h-0.5 w-10 lg:w-16 mx-1 transition-all ${i < step ? "bg-blue-500" : "bg-slate-200"}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="h-full w-full flex flex-col bg-white dark:bg-slate-900 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {isEditMode ? "Edit BRD" : "Document Workflow"}
            </p>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Business Requirements Document
            </h2>
          </div>
          {/* Requirement 1: ✕ now triggers confirmation */}
          <button
            onClick={requestClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <StepIndicator />
          <div className="flex items-center justify-center pb-2">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-bold text-blue-600 dark:text-blue-400">
                {stepMeta[step].icon} {steps[step]}
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-slate-500">{stepMeta[step].desc}</span>
              <span className="text-slate-400 dark:text-slate-600 font-mono text-[10px] ml-1">
                {step + 1} / {steps.length}
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          {renderStepContent()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0 bg-slate-50 dark:bg-slate-800/50">
          {!isLastStep ? (
            <>
              {/* Back — disabled on first step of any flow */}
              <button
                onClick={prev}
                disabled={step === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div className="flex items-center gap-3">
                <p className="text-[11px] text-slate-400 dark:text-slate-600">All changes are saved automatically</p>

                {/* Requirement 4: "Back to Generate" shortcut when editing a specific section */}
                {cameFromGenerate && (
                  <button
                    onClick={() => setStep(steps.length - 1)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-700/40 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Back to Generate
                  </button>
                )}
              </div>

              <button
                onClick={next}
                disabled={!isEditMode && step === 0 && !uploadMeta}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          ) : (
            <p className="text-[11px] text-slate-400 dark:text-slate-600 mx-auto">
              All changes are saved automatically
            </p>
          )}
        </div>

      </div>

      {/* Requirement 1: Exit confirmation overlay */}
      {showExitConfirm && (
        <ExitConfirmModal
          onConfirm={() => { setShowExitConfirm(false); onClose?.(); }}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}
    </>
  );
}