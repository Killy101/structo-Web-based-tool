"use client";
import React, { forwardRef, useMemo, useRef } from "react";
import type { Chunk } from "./types";
import { KIND_META } from "./types";

interface Props {
  xmlText: string;
  xmlFilename: string | null;
  activeChunk: Chunk | null;
  appliedIds: Set<number>;
  navSpan: { start: number; end: number } | null;
  status: string;
  onLoad: (f: File) => void;
  onApply: () => void;
  onDownload: () => void;
}

/** Max chars to render at once — keeps the DOM small for large XML */
const RENDER_WINDOW = 50_000;

/** Render XML with a highlight around navSpan, windowed for large files */
function XmlBody({
  text,
  navSpan,
}: {
  text: string;
  navSpan: { start: number; end: number } | null;
}) {
  // For small files, render everything
  if (text.length <= RENDER_WINDOW * 2) {
    if (!navSpan) return <>{text}</>;
    const { start, end } = navSpan;
    return (
      <>
        {text.slice(0, start)}
        <mark className="bg-amber-200/30 dark:bg-amber-400/20 outline outline-2 outline-amber-400 rounded-sm text-inherit">
          {text.slice(start, end)}
        </mark>
        {text.slice(end)}
      </>
    );
  }

  // Large file: render a window around navSpan or start of file
  const center = navSpan ? navSpan.start : 0;
  const winStart = Math.max(0, center - RENDER_WINDOW);
  const winEnd = Math.min(text.length, center + RENDER_WINDOW);

  if (!navSpan || navSpan.start < winStart || navSpan.end > winEnd) {
    return (
      <>
        {winStart > 0 && <span className="text-slate-500">{"… [" + winStart.toLocaleString() + " chars above] …\n\n"}</span>}
        {text.slice(winStart, winEnd)}
        {winEnd < text.length && <span className="text-slate-500">{"\n\n… [" + (text.length - winEnd).toLocaleString() + " chars below] …"}</span>}
      </>
    );
  }

  const { start, end } = navSpan;
  return (
    <>
      {winStart > 0 && <span className="text-slate-500">{"… [" + winStart.toLocaleString() + " chars above] …\n\n"}</span>}
      {text.slice(winStart, start)}
      <mark className="bg-amber-200/30 dark:bg-amber-400/20 outline outline-2 outline-amber-400 rounded-sm text-inherit">
        {text.slice(start, end)}
      </mark>
      {text.slice(end, winEnd)}
      {winEnd < text.length && <span className="text-slate-500">{"\n\n… [" + (text.length - winEnd).toLocaleString() + " chars below] …"}</span>}
    </>
  );
}

const XmlPanel = forwardRef<HTMLDivElement, Props>(
  ({
    xmlText, xmlFilename, activeChunk, appliedIds,
    navSpan, status, onLoad, onApply, onDownload,
  }, ref) => {
    const fileRef    = useRef<HTMLInputElement>(null);

    const canApply =
      !!xmlText &&
      !!activeChunk &&
      activeChunk.kind !== "emp" &&
      !appliedIds.has(activeChunk.id);

    const meta = activeChunk ? KIND_META[activeChunk.kind] : null;

    return (
      <div className="flex flex-col h-full min-w-0 border-t border-slate-200 dark:border-white/8">
        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">XML Editor</span>

            {!xmlText ? (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors"
                >
                  Load XML
                </button>
                <input ref={fileRef} type="file" accept=".xml" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoad(f); }} />
              </>
            ) : (
              <>
                <button
                  onClick={onApply}
                  disabled={!canApply}
                  title={
                    activeChunk?.kind === "emp"
                      ? "Emphasis-only — not applicable"
                      : appliedIds.has(activeChunk?.id ?? -1)
                      ? "Already applied"
                      : "Apply selected change to XML"
                  }
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-35 disabled:cursor-not-allowed text-white text-[11px] font-semibold transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Apply
                </button>

                <button
                  onClick={onDownload}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-300 dark:border-white/12 bg-white dark:bg-white/4 hover:bg-slate-100 dark:hover:bg-white/8 text-slate-600 dark:text-slate-300 text-[11px] font-semibold transition-colors"
                >
                  Download
                </button>


              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {xmlFilename && (
              <span className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]">
                {xmlFilename}
              </span>
            )}
            {status && (
              <span className="text-[10px] text-emerald-500 dark:text-emerald-400 font-mono">{status}</span>
            )}
          </div>
        </div>

        {/* ── XML body ─────────────────────────────────────────────────────── */}
        {xmlText ? (
          <div
            ref={ref}
            className="flex-1 overflow-auto p-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 dark:scrollbar-thumb-white/10"
          >
            <pre className="text-[11px] leading-[1.75] whitespace-pre-wrap break-words font-mono text-blue-700 dark:text-[#7aadca]">
              <XmlBody text={xmlText} navSpan={navSpan} />
            </pre>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <svg className="w-10 h-10 text-slate-300 dark:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-1">No XML loaded</p>
              <p className="text-xs text-slate-400 dark:text-slate-600 max-w-xs leading-relaxed">
                Load an XML file to apply diff changes directly.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }
);

XmlPanel.displayName = "XmlPanel";
export default XmlPanel;
