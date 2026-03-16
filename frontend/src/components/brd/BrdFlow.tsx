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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toc?: Record<string, unknown> | any;
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

const STEPS      = ["Upload", "Scope", "Metadata", "TOC", "Citation Rules", "Content Profiling", "Generate"];
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

const EDIT_STEP_META = STEP_META.slice(1);

// ── Exit / Save confirmation modal ────────────────────────────────────────────
function SaveAndExitModal({
  isSaving,
  onConfirm,
  onCancel,
}: {
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#131722] rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl w-[min(420px,90vw)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Save & Exit</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Your progress will be saved</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Your edits will be <span className="font-semibold text-slate-900 dark:text-white">saved automatically</span> and this BRD will be marked as{" "}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-600/30">
              ⏸ Paused
            </span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            You can resume editing at any time from the BRD Registry.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-all"
          >
            Keep Editing
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60 transition-all"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.8" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Save & Exit
              </>
            )}
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
  const isEditMode = !!initialMeta?.brdId;
  const cameFromGenerate = isEditMode; // always show "Back to Generate" in edit mode

  const toEditStep   = (s: number) => Math.max(0, s - 1);
  const fromEditStep = (s: number) => s + 1;

  const steps    = isEditMode ? EDIT_STEPS     : STEPS;
  const stepMeta = isEditMode ? EDIT_STEP_META : STEP_META;

  const clampedInitial = isEditMode
    ? Math.max(0, Math.min(toEditStep(initialStep), EDIT_STEPS.length - 1))
    : Math.max(0, Math.min(initialStep, STEPS.length - 1));

  const [step,            setStep]            = useState(clampedInitial);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isSaving,        setIsSaving]        = useState(false);
  const [uploadMeta,      setUploadMeta]      = useState<UploadFlowData | null>(
    initialMeta
      ? { format: initialMeta.format, brdId: initialMeta.brdId, title: initialMeta.title }
      : null
  );
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError,   setViewError]   = useState<string | null>(null);

  const isLastStep     = step === steps.length - 1;
  const isGenerateStep = isLastStep;

  useEffect(() => {
    if (!initialMeta?.brdId) return;
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

  // On exit: blank upload screen (nothing to save) → close immediately.
  // On Generate step (work already saved) → close immediately.
  // Otherwise → show Save & Exit modal.
  const requestClose = useCallback(() => {
    const isBlankUpload = !isEditMode && step === 0 && !uploadMeta;
    if (isGenerateStep || isBlankUpload) {
      onClose?.();
    } else {
      setShowExitConfirm(true);
    }
  }, [isGenerateStep, isEditMode, step, uploadMeta, onClose]);

  // Save current state as "paused" then close
  const handleSaveAndExit = useCallback(async () => {
    if (!uploadMeta?.brdId) {
      onClose?.();
      return;
    }

    setIsSaving(true);
    try {
      await api.post("/brd/save", {
        brdId:          uploadMeta.brdId,
        title:          uploadMeta.title,
        format:         uploadMeta.format,
        status:         "PAUSED",
        scope:          uploadMeta.scope,
        metadata:       uploadMeta.metadata,
        toc:            uploadMeta.toc,
        citations:      uploadMeta.citations,
        contentProfile: uploadMeta.contentProfile,
        brdConfig:      uploadMeta.brdConfig ?? null,
      });
    } catch (err) {
      console.warn("[BrdFlow] Save-on-exit failed:", err);
      // Still exit — don't block the user
    } finally {
      setIsSaving(false);
      setShowExitConfirm(false);
      onClose?.();
    }
  }, [uploadMeta, onClose]);

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

  function handleEditFromGenerate(targetFullStep: number) {
    setStep(isEditMode ? toEditStep(targetFullStep) : targetFullStep);
  }

// In BrdFlow.tsx, update the renderStepContent function

function renderStepContent() {
  const fullStep = isEditMode ? fromEditStep(step) : step;

  switch (fullStep) {
    case 0:
      return (
        <Upload
          onComplete={(data) => {
            setUploadMeta(data as UploadFlowData);
            next();
          }}
        />
      );

    case 1:
      return <Scope 
        initialData={uploadMeta?.scope}
        brdId={uploadMeta?.brdId}
        onDataChange={(data) => setUploadMeta(prev => prev ? { ...prev, scope: data } : prev)}
      />;

    case 2:
      return (
        <Metadata
          format={uploadMeta?.format ?? "new"}
          title={getBestTitle()}
          initialData={uploadMeta?.metadata}
          brdId={uploadMeta?.brdId}
          onDataChange={(data) => setUploadMeta(prev => prev ? { ...prev, metadata: data } : prev)}
        />
      );

    case 3: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tocData = uploadMeta?.toc as any;
      return <Toc
        initialData={tocData}
        brdId={uploadMeta?.brdId}
        onDataChange={(data) => setUploadMeta(prev => prev ? { ...prev, toc: data } : prev)}
      />;
    }

    case 4:
      return <Citation 
        initialData={uploadMeta?.citations}
        brdId={uploadMeta?.brdId}
        onDataChange={(data) => setUploadMeta(prev => prev ? { ...prev, citations: data } : prev)}
      />;

    case 5:
      return <ContentProfile 
        initialData={uploadMeta?.contentProfile}
        brdId={uploadMeta?.brdId}
        onDataChange={(data) => setUploadMeta(prev => prev ? { ...prev, contentProfile: data } : prev)}
      />;

    case 6: {
      // ... rest of the code
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

      {/* Save & Exit modal */}
      {showExitConfirm && (
        <SaveAndExitModal
          isSaving={isSaving}
          onConfirm={handleSaveAndExit}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}
    </>
  );
}