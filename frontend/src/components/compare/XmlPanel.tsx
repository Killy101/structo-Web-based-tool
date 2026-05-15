"use client";
import React, { forwardRef, useMemo, useRef, useState } from "react";
import XmlEditor from "./XmlEditor";
import type { Chunk, WorkflowMode, XmlScrollTarget } from "./types";

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
  onXmlChange?: (text: string) => void;  // wf3 only: user edits XML directly
  onScrollFraction?: (scrollFraction: number) => void;
  /** Whether there is an apply to undo (history stack non-empty). */
  canUndo?:    boolean;
  /** Revert the last apply operation. */
  onUndo?:     () => void;
  /**
   * Called when the user clicks a line in the XML viewer/editor.
   * Receives the character offsets [lineStart, lineEnd] in the full xmlText.
   * DiffViewer uses this to locate the matching diff chunk and scroll both PDF panes.
   */
  onXmlLineClick?: (lineStart: number, lineEnd: number) => void;
}

/** Max chars to render at once — keeps DOM small for large XML files */
const RENDER_WINDOW = 50_000;

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

// ─────────────────────────────────────────────────────────────────────────────
// VS Code–style XML tokenizer
// Tokens: tag-bracket < >, tag-name, attr-name, = , attr-value " ", text,
//         comment <!-- -->, cdata <![CDATA[...]]>, pi <?...?>, doctype <!...>
// ─────────────────────────────────────────────────────────────────────────────

type XmlTokenKind =
  | "bracket"    // < > / = ?
  | "tag"        // element name
  | "attr"       // attribute name
  | "value"      // "…" attribute value
  | "comment"    // <!-- … -->
  | "cdata"      // <![CDATA[…]]>
  | "pi"         // <?…?>
  | "doctype"    // <!DOCTYPE…>
  | "text";      // bare text content

interface XmlToken {
  kind: XmlTokenKind;
  text: string;
}

// VS Code token colours — light values match VS Light theme, dark match VS Dark theme.
const TOKEN_CLASS: Record<XmlTokenKind, string> = {
  bracket:  "text-slate-500 dark:text-slate-400",
  tag:      "text-[#800000] dark:text-[#4ec9b0]",        // maroon / teal
  attr:     "text-[#ff0000] dark:text-[#9cdcfe]",        // red / light-blue
  value:    "text-[#0000ff] dark:text-[#ce9178]",        // blue / orange-brown
  comment:  "text-[#008000] dark:text-[#6a9955] italic", // green (both)
  cdata:    "text-slate-700 dark:text-[#d4d4d4]",        // dark-grey / near-white
  pi:       "text-[#800080] dark:text-[#c586c0]",        // purple (both)
  doctype:  "text-[#0000ff] dark:text-[#569cd6]",        // blue (both)
  text:     "text-slate-800 dark:text-[#d4d4d4]",        // near-black / near-white
};

type TokenizeState = "text" | "tag" | "comment" | "cdata" | "pi" | "doctype";

function _tokenizeLine(line: string, inState: TokenizeState = "text"): { tokens: XmlToken[]; outState: TokenizeState } {
  const tokens: XmlToken[] = [];
  let i = 0;
  let state = inState;

  function push(kind: XmlTokenKind, text: string) {
    if (text) tokens.push({ kind, text });
  }

  // If we're resuming inside a multi-line construct, consume until its closer
  if (state === "comment") {
    const end = line.indexOf("-->", i);
    if (end === -1) { push("comment", line); return { tokens, outState: "comment" }; }
    push("comment", line.slice(i, end + 3)); i = end + 3; state = "text";
  } else if (state === "cdata") {
    const end = line.indexOf("]]>", i);
    if (end === -1) { push("cdata", line); return { tokens, outState: "cdata" }; }
    push("cdata", line.slice(i, end + 3)); i = end + 3; state = "text";
  } else if (state === "pi") {
    const end = line.indexOf("?>", i);
    if (end === -1) { push("pi", line); return { tokens, outState: "pi" }; }
    push("pi", line.slice(i, end + 2)); i = end + 2; state = "text";
  } else if (state === "doctype") {
    const end = line.indexOf(">", i);
    if (end === -1) { push("doctype", line); return { tokens, outState: "doctype" }; }
    push("doctype", line.slice(i, end + 1)); i = end + 1; state = "text";
  } else if (state === "tag") {
    // Inside a multi-line tag — consume attributes until >
    while (i < line.length && line[i] !== ">") {
      if (line[i] === "/" && line[i + 1] === ">") { push("bracket", "/>"); i += 2; state = "text"; break; }
      if (line[i] === "=") { push("bracket", "="); i += 1; continue; }
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i]; let j = i + 1;
        while (j < line.length && line[j] !== q) j += 1;
        push("value", line.slice(i, j + 1)); i = j + 1; continue;
      }
      if (/\s/.test(line[i])) {
        let ws = "";
        while (i < line.length && /\s/.test(line[i])) { ws += line[i]; i += 1; }
        push("text", ws); continue;
      }
      const attrStart = i;
      while (i < line.length && !/[\s>\/=]/.test(line[i])) i += 1;
      push("attr", line.slice(attrStart, i));
    }
    if (i < line.length && line[i] === ">") { push("bracket", ">"); i += 1; state = "text"; }
    else if (i >= line.length) { return { tokens, outState: "tag" }; }
  }

  while (i < line.length) {
    if (line.startsWith("<!--", i)) {
      const end = line.indexOf("-->", i + 4);
      if (end === -1) { push("comment", line.slice(i)); return { tokens, outState: "comment" }; }
      push("comment", line.slice(i, end + 3)); i = end + 3; continue;
    }
    if (line.startsWith("<![CDATA[", i)) {
      const end = line.indexOf("]]>", i + 9);
      if (end === -1) { push("cdata", line.slice(i)); return { tokens, outState: "cdata" }; }
      push("cdata", line.slice(i, end + 3)); i = end + 3; continue;
    }
    if (line.startsWith("<!", i) && !line.startsWith("<!--", i)) {
      const end = line.indexOf(">", i);
      if (end === -1) { push("doctype", line.slice(i)); return { tokens, outState: "doctype" }; }
      push("doctype", line.slice(i, end + 1)); i = end + 1; continue;
    }
    if (line.startsWith("<?", i)) {
      const end = line.indexOf("?>", i + 2);
      if (end === -1) { push("pi", line.slice(i)); return { tokens, outState: "pi" }; }
      push("pi", line.slice(i, end + 2)); i = end + 2; continue;
    }
    if (line[i] === "<") {
      push("bracket", "<"); i += 1;
      if (line[i] === "/") { push("bracket", "/"); i += 1; }
      const nameStart = i;
      while (i < line.length && !/[\s>\/=]/.test(line[i])) i += 1;
      push("tag", line.slice(nameStart, i));
      while (i < line.length && line[i] !== ">") {
        if (line[i] === "/" && line[i + 1] === ">") { push("bracket", "/>"); i += 2; break; }
        if (line[i] === "=") { push("bracket", "="); i += 1; continue; }
        if (line[i] === '"' || line[i] === "'") {
          const q = line[i]; let j = i + 1;
          while (j < line.length && line[j] !== q) j += 1;
          push("value", line.slice(i, j + 1)); i = j + 1; continue;
        }
        if (/\s/.test(line[i])) {
          let ws = "";
          while (i < line.length && /\s/.test(line[i])) { ws += line[i]; i += 1; }
          push("text", ws); continue;
        }
        const attrStart = i;
        while (i < line.length && !/[\s>\/=]/.test(line[i])) i += 1;
        push("attr", line.slice(attrStart, i));
      }
      if (i < line.length && line[i] === ">") { push("bracket", ">"); i += 1; }
      else if (i >= line.length) { return { tokens, outState: "tag" }; }
      continue;
    }
    const txtStart = i;
    while (i < line.length && line[i] !== "<") i += 1;
    push("text", line.slice(txtStart, i));
  }

  return { tokens, outState: "text" };
}

function _renderTokensWithHighlight(
  tokens: XmlToken[],
  lineText: string,
  lineStart: number,
  navSpan: { start: number; end: number } | null,
): React.ReactNode {
  // If no navSpan highlight needed, fast path
  if (!navSpan) {
    return tokens.map((t, k) => (
      <span key={k} className={TOKEN_CLASS[t.kind]}>{t.text}</span>
    ));
  }

  // Build char offset per token, then slice mark overlay
  const lineEnd = lineStart + lineText.length;
  const hlStart = Math.max(lineStart, navSpan.start);
  const hlEnd   = Math.min(lineEnd,   navSpan.end);
  const hasHL   = hlStart < hlEnd;

  if (!hasHL) {
    return tokens.map((t, k) => (
      <span key={k} className={TOKEN_CLASS[t.kind]}>{t.text}</span>
    ));
  }

  let cursor = lineStart;
  return tokens.map((t, k) => {
    const tStart = cursor;
    const tEnd   = cursor + t.text.length;
    cursor = tEnd;

    const oStart = Math.max(tStart, hlStart) - tStart;
    const oEnd   = Math.min(tEnd,   hlEnd)   - tStart;

    if (oStart >= oEnd) {
      return <span key={k} className={TOKEN_CLASS[t.kind]}>{t.text}</span>;
    }
    return (
      <span key={k} className={TOKEN_CLASS[t.kind]}>
        {t.text.slice(0, oStart)}
        <Mark>{t.text.slice(oStart, oEnd)}</Mark>
        {t.text.slice(oEnd)}
      </span>
    );
  });
}

function XmlBody({
  text,
  navSpan,
  onLineClick,
}: {
  text:          string;
  navSpan:       { start: number; end: number } | null;
  onLineClick?:  (lineStart: number, lineEnd: number) => void;
}) {
  const center = navSpan
    ? Math.floor((navSpan.start + navSpan.end) / 2)
    : 0;
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

  // Tokenize all visible lines with carry-over state for multi-line constructs.
  // useMemo ensures the stateful accumulation of tokenizerState is scoped to the
  // memoization callback rather than the render body (React Compiler requirement).
  const tokenizedLines = useMemo(() => {
    let state: TokenizeState = "text";
    return lines.map((lineText) => {
      const { tokens, outState } = _tokenizeLine(lineText, state);
      state = outState;
      return tokens;
    });
  }, [visibleText]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-0">
      {prefixHidden > 0 && <Ellipsis chars={prefixHidden} />}
      {lines.map((lineText, idx) => {
        const lineStart = lineStarts[idx];
        const tokens    = tokenizedLines[idx];
        const lineNum   = startLineNumber + idx;
        const isHL = navSpan && lineStart < navSpan.end && lineStart + lineText.length > navSpan.start;

        // FIX Issue 2: detect tag-only lines — after stripping all XML tags and
        // whitespace, if fewer than 4 meaningful characters remain the line carries
        // no navigable content and should not register as a clickable target.
        // This prevents the silent early-return in handleXmlLineClick that was
        // triggered by Innodata's tag-dense structure (innodReplace, innodIdentifier…).
        const plainLineText = lineText
          .replace(/<[^>]*>/g, "")
          .replace(/&[a-z]+;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const isNavigable = onLineClick && plainLineText.length >= 4;

        return (
          <div
            key={`${lineNum}-${lineStart}`}
            role={isNavigable ? "button" : undefined}
            tabIndex={isNavigable ? 0 : undefined}
            onClick={isNavigable ? () => onLineClick(lineStart, lineStart + lineText.length) : undefined}
            onKeyDown={isNavigable ? (e) => {
              if (e.key === "Enter" || e.key === " ") onLineClick(lineStart, lineStart + lineText.length);
            } : undefined}
            className={`grid grid-cols-[48px_minmax(0,1fr)] gap-0 leading-[1.75]
              ${isHL ? "bg-yellow-300/10 dark:bg-yellow-400/8" : ""}
              ${isNavigable ? "cursor-pointer hover:bg-teal-400/8 dark:hover:bg-teal-400/10 focus:outline-none focus:bg-teal-400/8" : "hover:bg-white/3"}`}
          >
            <span className="select-none border-r border-slate-200 dark:border-white/8 pr-2 text-right
              text-[10px] font-medium tabular-nums text-slate-400 dark:text-slate-600 self-start pt-px">
              {lineNum}
            </span>
            <span className="pl-3 whitespace-pre-wrap break-words text-[11px]">
              {_renderTokensWithHighlight(tokens, lineText, lineStart, navSpan)}
            </span>
          </div>
        );
      })}
      {suffixHidden > 0 && <Ellipsis chars={suffixHidden} />}
    </div>
  );
}


const XmlPanel = forwardRef<XmlScrollTarget, Props>(
  ({ mode, xmlText, xmlFilename, activeChunk, appliedIds, navSpan, status, onLoad, onApply, onDownload, onXmlChange, onScrollFraction, canUndo, onUndo, onXmlLineClick }, ref) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // XML validation error surfaced up from XmlEditor's DOMParser check
    const [xmlError, setXmlError] = useState<string | null>(null);

    const isWf3    = mode === "edit";
    // EMP chunks are now supported for apply (see backend _apply_emp_chunk_to_xml)
    const canApply = isWf3 && !!xmlText && !!activeChunk &&
                     !appliedIds.has(activeChunk.id) &&
                     // Block apply on invalid XML to prevent sending malformed content
                     !xmlError;

    const applyTitle = !isWf3
      ? "Read-only in Workflow 1"
      : !!xmlError
        ? `Cannot apply — XML is invalid: ${xmlError.slice(0, 80)}`
      : appliedIds.has(activeChunk?.id ?? -1)
        ? "Already applied"
        : activeChunk?.kind === "emp"
          ? "Apply emphasis change to XML"
          : "Apply selected change to XML";

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (!onScrollFraction) return;
      const el = e.currentTarget;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      onScrollFraction(el.scrollTop / max);
    };

    return (
      <div className="flex flex-col h-full min-w-0 border-t border-slate-200 dark:border-white/8">

        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>

            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              XML {isWf3 ? "Editor" : "Viewer"}
            </span>

            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
              isWf3
                ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
                : "bg-slate-500/10 text-slate-400 border-slate-500/20"
            }`}>
              {isWf3 ? "WF2 · editable" : "WF1 · read-only"}
            </span>

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
                  {activeChunk?.kind === "emp" ? "Apply Formatting" : "Apply"}
                </button>

                {/* Undo last apply — only shown when history is non-empty */}
                {canUndo && (
                  <button
                    onClick={onUndo}
                    title="Undo last apply"
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[11px] font-semibold transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    Undo
                  </button>
                )}

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

        {xmlText ? (
          isWf3 ? (
            /*
             * WF2 editable mode: forward the panel ref to XmlEditor which
             * exposes XmlScrollTarget via useImperativeHandle on the Monaco
             * editor instance.  The outer div clips the layout; Monaco's own
             * virtualised renderer is the scroll container.
             */
            <div
              data-testid="xml-panel-scroll"
              className="flex-1 overflow-hidden flex flex-col"
            >
              <XmlEditor
                ref={ref as React.Ref<XmlScrollTarget>}
                value={xmlText}
                onChange={onXmlChange}
                navSpan={navSpan}
                onScrollFraction={onScrollFraction}
                onValidationChange={setXmlError}
                onCursorOffset={onXmlLineClick ? (offset) => {
                  // Convert Monaco cursor character offset → line char range → chunk lookup
                  const lineStart  = xmlText.lastIndexOf("\n", offset - 1) + 1;
                  const lineEndIdx = xmlText.indexOf("\n", offset);
                  onXmlLineClick(lineStart, lineEndIdx === -1 ? xmlText.length : lineEndIdx);
                } : undefined}
              />
              {/* Inline validation error bar — shown below editor when XML is malformed */}
              {xmlError && (
                <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1
                  bg-rose-500/10 border-t border-rose-500/30 text-rose-400 text-[10px] font-mono">
                  <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate">XML error: {xmlError}</span>
                </div>
              )}
            </div>
          ) : (
            <div
              ref={ref as React.Ref<HTMLDivElement>}
              data-testid="xml-panel-scroll"
              className="flex-1 overflow-auto p-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 dark:scrollbar-thumb-white/10
                bg-white dark:bg-[#1e1e1e]"
              onScroll={handleScroll}
            >
              <pre className="text-[11px] leading-[1.75] font-mono">
                <XmlBody text={xmlText} navSpan={navSpan} onLineClick={onXmlLineClick} />
              </pre>
            </div>
          )
        ) : (
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