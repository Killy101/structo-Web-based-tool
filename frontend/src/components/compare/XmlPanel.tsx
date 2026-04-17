"use client";
// ─────────────────────────────────────────────────────────────────────────────
// XmlPanel.tsx — Panel D
// Shown below the PDF panes in both Workflow 2 and Workflow 3.
//
// Workflow 2 (mode="wf2"):  Read-only.  Scrolls & highlights on chunk click.
//                           No Apply / Download buttons.
// Workflow 3 (mode="wf3"):  Editable.   Same nav behaviour PLUS Apply button
//                           patches the selected XML node in-place, and
//                           Download saves the updated file.
// ─────────────────────────────────────────────────────────────────────────────

import React, { forwardRef, useRef } from "react";
import type { Chunk, WorkflowMode } from "./types";

interface Props {
  mode:        WorkflowMode;
  xmlText:     string;
  xmlFilename: string | null;
  activeChunk: Chunk | null;
  appliedIds:  Set<number>;
  navSpan:     { start: number; end: number } | null;
  status:      string;
  onLoad:      (f: File) => void;
  onApply:     () => void;     // no-op in wf2
  onDownload:  () => void;     // no-op in wf2
  onScrollFraction?: (scrollFraction: number) => void;
}

/** Max chars to render at once — keeps DOM small for large XML files */
const RENDER_WINDOW = 50_000;

// ── XML body with windowed rendering + yellow highlight + line numbers ───────

const Mark = ({ children }: { children: string }) => (
  <mark className="bg-yellow-200/40 dark:bg-yellow-400/20 outline outline-2 outline-yellow-400 rounded-sm text-inherit">
    {children}
  </mark>
);

const Ellipsis = ({ chars }: { chars: number }) => (
  <span className="text-slate-500">{`… [${chars.toLocaleString()} chars] …\n\n`}</span>
);

function _countNewlinesBefore(text: string, pos: number): number {
  let count = 0;
  for (let i = 0; i < pos; i++) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function _renderHighlightedLine(
  lineText: string,
  lineStart: number,
  navSpan: { start: number; end: number } | null,
) {
  if (!navSpan) return lineText || " ";

  const lineEnd = lineStart + lineText.length;
  const hlStart = Math.max(lineStart, navSpan.start);
  const hlEnd = Math.min(lineEnd, navSpan.end);
  if (hlStart >= hlEnd) return lineText || " ";

  const startOffset = hlStart - lineStart;
  const endOffset = hlEnd - lineStart;
  return (
    <>
      {lineText.slice(0, startOffset)}
      <Mark>{lineText.slice(startOffset, endOffset)}</Mark>
      {lineText.slice(endOffset) || ""}
    </>
  );
}

function XmlBody({
  text,
  navSpan,
}: {
  text:    string;
  navSpan: { start: number; end: number } | null;
}) {
  const center = navSpan?.start ?? 0;
  let winStart = 0;
  let winEnd = text.length;

  if (text.length > RENDER_WINDOW * 2) {
    winStart = Math.max(0, center - RENDER_WINDOW);
    winEnd = Math.min(text.length, center + RENDER_WINDOW);

    while (winStart > 0 && text[winStart - 1] !== "\n") winStart -= 1;
    while (winEnd < text.length && text[winEnd - 1] !== "\n") winEnd += 1;
  }

  const prefixHidden = winStart;
  const suffixHidden = text.length - winEnd;
  const startLineNumber = _countNewlinesBefore(text, winStart) + 1;
  const visibleText = text.slice(winStart, winEnd);
  const lines = visibleText.split("\n");
  const lineStarts = lines.map((lineText, idx) => {
    if (idx === 0) return winStart;
    let offset = winStart;
    for (let i = 0; i < idx; i++) {
      offset += lines[i].length + 1;
    }
    return offset;
  });

  return (
    <div className="space-y-0.5">
      {prefixHidden > 0 && <Ellipsis chars={prefixHidden} />}
      {lines.map((lineText, idx) => {
        const lineStart = lineStarts[idx];
        return (
          <div key={`${startLineNumber + idx}-${lineStart}`} className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
            <span className="select-none text-right pr-2 text-slate-400 dark:text-slate-600">{startLineNumber + idx}</span>
            <span className="whitespace-pre-wrap break-words">{_renderHighlightedLine(lineText, lineStart, navSpan)}</span>
          </div>
        );
      })}
      {suffixHidden > 0 && <Ellipsis chars={suffixHidden} />}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const XmlPanel = forwardRef<HTMLDivElement, Props>(
  ({ mode, xmlText, xmlFilename, activeChunk, appliedIds, navSpan, status, onLoad, onApply, onDownload, onScrollFraction }, ref) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isWf3    = mode === "wf3";
    const canApply = isWf3 && !!xmlText && !!activeChunk &&
                     activeChunk.kind !== "emp" && !appliedIds.has(activeChunk.id);

    const applyTitle = !isWf3                              ? "Read-only in Workflow 2"
      : activeChunk?.kind === "emp"                         ? "Emphasis — not applicable"
      : appliedIds.has(activeChunk?.id ?? -1)               ? "Already applied"
      :                                                       "Apply selected change to XML";

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (!onScrollFraction) return;
      const el = e.currentTarget;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      onScrollFraction(el.scrollTop / max);
    };

    return (
      <div className="flex flex-col h-full min-w-0 border-t border-slate-200 dark:border-white/8">

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2">
            {/* Icon */}
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>

            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              XML {isWf3 ? "Editor" : "Viewer"}
            </span>

            {/* Mode badge */}
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
              isWf3
                ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
                : "bg-slate-500/10 text-slate-400 border-slate-500/20"
            }`}>
              {isWf3 ? "WF3 · editable" : "WF2 · read-only"}
            </span>

            {/* Load XML (always available, shows only when no XML loaded) */}
            {!xmlText && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors"
                >
                  Load XML
                </button>
                <input
                  ref={fileInputRef} type="file" accept=".xml" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoad(f); e.target.value = ""; }}
                />
              </>
            )}

            {/* Apply + Download — wf3 only */}
            {xmlText && isWf3 && (
              <>
                <button
                  onClick={onApply}
                  disabled={!canApply}
                  title={applyTitle}
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
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
              </>
            )}
          </div>

          {/* Right: filename + status */}
          <div className="flex items-center gap-3 min-w-0">
            {xmlFilename && (
              <span className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]">
                {xmlFilename}
              </span>
            )}
            {status && (
              <span className="text-[10px] font-mono text-emerald-500 dark:text-emerald-400 truncate">
                {status}
              </span>
            )}
          </div>
        </div>

        {/* ── XML body ─────────────────────────────────────────────────────── */}
        {xmlText ? (
          <div
            ref={ref}
            className="flex-1 overflow-auto p-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 dark:scrollbar-thumb-white/10"
            onScroll={handleScroll}
          >
            <pre className="text-[11px] leading-[1.75] font-mono text-blue-700 dark:text-[#7aadca]">
              <XmlBody text={xmlText} navSpan={navSpan} />
            </pre>
          </div>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <svg className="w-10 h-10 text-slate-300 dark:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-1">No XML loaded</p>
              <p className="text-xs text-slate-400 dark:text-slate-600 max-w-xs leading-relaxed">
                {isWf3
                  ? "Load an XML file to apply diff changes directly."
                  : "Load an XML file to navigate its structure alongside the diff."}
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors"
            >
              Load XML
            </button>
            <input
              ref={fileInputRef} type="file" accept=".xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoad(f); e.target.value = ""; }}
            />
          </div>
        )}
      </div>
    );
  },
);

XmlPanel.displayName = "XmlPanel";
export default XmlPanel;