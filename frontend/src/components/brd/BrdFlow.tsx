"use client";

import { useState } from "react";
import { EmptyState, Button } from "../../components/ui";
import Upload from "./Upload";
import Scope from "./Scope";
import Metadata from "./Metadata";
import ContentProf from "./ContentProf";
import Toc from "./TOC";
import Citation from "./Citation";
import Generate from "./Generate";
import View from "./View";

interface Props {
  onClose?: () => void;
  initialStep?: number;
  initialMeta?: { format: "new" | "old"; brdId: string; title: string } | null;
  finalStepMode?: "generate" | "view";
}

const STEPS = ["Upload", "Scope", "Metadata", "TOC", "Citation Rules", "Content Profiling", "Generate"];

const STEP_META = [
  { icon: "↑", desc: "Start by uploading your source documents" },
  { icon: "◎", desc: "Define boundaries, objectives, and scope" },
  { icon: "≡", desc: "Add project details and stakeholders" },
  { icon: "✦", desc: "Generate and customize the table of contents" },
  { icon: "§", desc: "Define citation formatting and standardization rules" },
  { icon: "⬡", desc: "Analyze and structure content" },
  { icon: "✦", desc: "Review and generate the final BRD document" },
];

export default function BrdFlow({ onClose, initialStep = 0, initialMeta = null, finalStepMode = "generate" }: Props) {
  const [step, setStep] = useState(Math.max(0, Math.min(initialStep, STEPS.length - 1)));
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadMeta, setUploadMeta] = useState<{ format: "new" | "old"; brdId: string; title: string } | null>(initialMeta);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const isLastStep = step === STEPS.length - 1;

  const renderStepContent = () => {
    switch (step) {
      case 0: return <Upload onComplete={(meta) => { setUploadMeta(meta); next(); }} />;
      case 1: return <Scope />;
      case 2: return <Metadata format={uploadMeta?.format ?? "new"} brdId={uploadMeta?.brdId} title={uploadMeta?.title} />;
      case 3: return <Toc />;
      case 4: return <Citation />;
      case 5: return <ContentProf />;
      case 6:
        return finalStepMode === "view"
          ? <View brdId={uploadMeta?.brdId} title={uploadMeta?.title} format={uploadMeta?.format} onComplete={onClose} />
          : <Generate brdId={uploadMeta?.brdId} title={uploadMeta?.title} format={uploadMeta?.format} onEdit={(s) => setStep(s)} onComplete={onClose} />;
      default: return (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <EmptyState title="Step not found" description="Please go back and try again" />
          <Button onClick={prev}>Go Back</Button>
        </div>
      );
    }
  };

  return (
    <div
      className="h-full min-h-full w-full flex flex-col bg-slate-100 dark:bg-[#0d1117] px-4 py-5 sm:px-6"
      style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif" }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <style>{`
        .brd-step-scroll {
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 #f1f5f9;
        }
        .brd-step-scroll::-webkit-scrollbar {
          width: 10px;
        }
        .brd-step-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
          border-radius: 9999px;
        }
        .brd-step-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 9999px;
          border: 2px solid #f1f5f9;
        }
        .brd-step-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
        .dark .brd-step-scroll {
          scrollbar-color: #334155 #0f172a;
        }
        .dark .brd-step-scroll::-webkit-scrollbar-track {
          background: #0f172a;
        }
        .dark .brd-step-scroll::-webkit-scrollbar-thumb {
          background: #334155;
          border-color: #0f172a;
        }
        .dark .brd-step-scroll::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>

      <div className="w-full h-full min-h-0 flex flex-col">

        {/* ── Header ── */}
        <div className="flex justify-between items-start mb-4 px-1">
          <div>
            <p className="text-[11px] font-medium tracking-[0.1em] uppercase text-slate-600 dark:text-slate-500 mb-1"
               style={{ fontFamily: "'DM Mono', monospace" }}>
              Document Workflow
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Business Requirements Document
            </h1>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 dark:border-[#2a3147] text-slate-600 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-500 dark:hover:border-slate-500 transition-all text-sm mt-1 flex-shrink-0 bg-slate-50 dark:bg-[#161b2e]"
            >
              ✕
            </button>
          )}
        </div>

        {/* ── Main Card ── */}
        <div className="bg-slate-50 dark:bg-[#161b2e] border border-slate-300 dark:border-[#2a3147] rounded-2xl shadow-sm dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)] flex-1 min-h-0 flex flex-col">

          {/* Step Progress */}
          <div className="px-7 pt-6">
            <div className="flex items-start">
              {STEPS.map((s, i) => {
                const isDone = i < step;
                const isActive = i === step;
                return (
                  <div key={s} className={`flex items-start ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
                    <div className="flex flex-col items-center">
                      {/* Dot */}
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium flex-shrink-0 transition-all duration-200
                          ${isDone
                            ? "bg-blue-600 dark:bg-blue-500 text-white"
                            : isActive
                            ? "bg-blue-50 dark:bg-blue-500/10 border-[1.5px] border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-200 shadow-[0_0_0_3px_rgba(59,130,246,0.12)] dark:shadow-[0_0_0_3px_rgba(59,130,246,0.2)]"
                            : "bg-blue-50/60 dark:bg-blue-500/5 border-[1.5px] border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-700"
                          }`}
                        style={{ fontFamily: "'DM Mono', monospace" }}
                      >
                        {isDone ? (
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : isActive && isLastStep ? (
                          <span>✦</span>
                        ) : (
                          <span>{i + 1}</span>
                        )}
                      </div>
                      {/* Label */}
                      <span
                        className={`mt-1.5 text-[10.5px] font-medium text-center w-[80px] transition-colors duration-200
                          ${isDone || isActive ? "text-blue-800 dark:text-blue-300" : "text-blue-600 dark:text-blue-700"}`}
                      >
                        {s}
                      </span>
                    </div>

                    {/* Connector */}
                    {i < STEPS.length - 1 && (
                      <div className="flex-1 h-px bg-blue-100 dark:bg-blue-900/40 mx-2 mt-[13px] relative overflow-hidden">
                        <div
                          className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-out"
                          style={{ width: isDone ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step Header */}
          <div className="px-7 pt-5">
            <div className="h-px bg-gradient-to-r from-transparent via-slate-300 dark:via-[#2a3147] to-transparent mb-5" />
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-lg leading-none text-slate-900 dark:text-slate-300">
                {STEP_META[step].icon}
              </span>
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {STEPS[step]}
              </h2>
              <span
                className="ml-auto text-[10px] font-medium text-slate-700 dark:text-slate-500 bg-slate-200 dark:bg-[#1e2235] border border-slate-300 dark:border-[#2a3147] px-2 py-0.5 rounded-full"
                style={{ fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em" }}
              >
                {step + 1} / {STEPS.length}
              </span>
            </div>
            <p className="text-[12.5px] text-slate-700 dark:text-slate-500 pl-7">
              {STEP_META[step].desc}
            </p>
          </div>

          {/* Step Content */}
          <div className="px-7 py-5 flex-1 min-h-0 overflow-auto brd-step-scroll">
            {renderStepContent()}
          </div>

          {/* Navigation Footer */}
          <div className="px-7 py-4 border-t border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#131829] rounded-b-2xl flex justify-between items-center">

            {/* Back / Exit button */}
            {finalStepMode === "view" ? (
              <div />
            ) : step === 0 ? (
              <div />
            ) : (
              <button
                onClick={prev}
                className="px-4 py-2 rounded-lg text-[13px] font-medium border border-slate-300 dark:border-[#2a3147] text-slate-700 dark:text-slate-400 bg-transparent dark:bg-[#1e2235] hover:bg-slate-100 dark:hover:bg-[#252d45] hover:border-slate-400 dark:hover:border-[#3a4460] hover:text-slate-900 dark:hover:text-slate-200 transition-all"
              >
                ← Back
              </button>
            )}

            <div className="flex items-center gap-3">
              {/* Pill progress indicators */}
              {finalStepMode !== "view" && (
                <div className="flex items-center gap-1 mr-2">
                  {STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-[5px] rounded-full transition-all duration-300 ${
                        i === step
                          ? "bg-blue-600 dark:bg-blue-400"
                          : i < step
                          ? "bg-blue-300 dark:bg-blue-700"
                          : "bg-blue-100 dark:bg-blue-900/40"
                      }`}
                      style={{ width: i === step ? 16 : 5 }}
                    />
                  ))}
                </div>
              )}

              {/* Step 0 manages its own Continue via Upload's onComplete */}
              {finalStepMode === "view" ? (
                <div />
              ) : step === 0 ? (
                <div /> // spacer — Upload handles navigation
              ) : !isLastStep ? (
                <button
                  onClick={next}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium bg-slate-800 dark:bg-blue-600 text-white hover:bg-slate-700 dark:hover:bg-blue-500 border border-transparent transition-all"
                >
                  Continue →
                </button>
              ) : null /* Generate step manages its own completion button */}
            </div>
          </div>
        </div>

        {/* ── Footer hint ── */}
        <p className="text-center text-[11.5px] text-slate-600 dark:text-[#5d6a90] mt-3.5 tracking-wide">
          All changes are saved automatically
        </p>
      </div>
    </div>
  );
}