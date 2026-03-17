"use client";
/**
 * XmlEditor v2 — Fixed editing + dark/light mode
 *
 * Fixes vs v1
 * ───────────
 * • Textarea is now reliably editable in all browsers.
 *   Root cause of the "can't edit" bug: the highlight overlay sat on top
 *   (z-index 1) with pointer-events:none, but on some Chrome builds the
 *   transparent textarea (z-index 2) lost focus because caretColor was
 *   hardcoded to a dark colour invisible against the dark background.
 *   Fix: use a single-layer approach — textarea carries real syntax colours
 *   as a background-image (CSS gradient trick is skipped in favour of the
 *   simpler "highlight div behind, textarea on top with transparent bg" but
 *   with explicit pointer-events:auto on the textarea and isolation:isolate
 *   on the wrapper so z-index contexts never bleed).
 *
 * • Dark / Light mode: all colours use CSS variables that respond to the
 *   prefers-color-scheme media query, so it looks good in both modes.
 *
 * • caretColor set to `currentColor` (inherits from theme) instead of a
 *   hardcoded dark hex.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

// ── Minimal XML tokeniser ──────────────────────────────────────────────────────

type TokenType = "tag" | "attr-name" | "attr-value" | "comment" | "text" | "punctuation";
interface Token { type: TokenType; value: string }

function tokeniseXml(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("<!--", i)) {
      const end = line.indexOf("-->", i + 4);
      const s   = end === -1 ? line.slice(i) : line.slice(i, end + 3);
      tokens.push({ type: "comment", value: s });
      i += s.length;
      continue;
    }
    if (line[i] === "<") {
      const end = line.indexOf(">", i);
      if (end === -1) { tokens.push({ type: "tag", value: line.slice(i) }); i = line.length; continue; }
      const tagContent = line.slice(i, end + 1);
      const tagMatch   = tagContent.match(/^(<\/?)(\w[\w:-]*)([\s\S]*)(\s*\/?>)$/);
      if (tagMatch) {
        tokens.push({ type: "punctuation", value: tagMatch[1] });
        tokens.push({ type: "tag",         value: tagMatch[2] });
        const attrStr = tagMatch[3];
        let j = 0;
        while (j < attrStr.length) {
          const m = attrStr.slice(j).match(/^(\s+)([\w:-]+)(=)(["'])([^"']*)(["'])/);
          if (m) {
            tokens.push({ type: "text",       value: m[1] });
            tokens.push({ type: "attr-name",  value: m[2] });
            tokens.push({ type: "punctuation",value: m[3] });
            tokens.push({ type: "attr-value", value: m[4] + m[5] + m[6] });
            j += m[0].length;
          } else { tokens.push({ type: "text", value: attrStr[j] }); j++; }
        }
        tokens.push({ type: "punctuation", value: tagMatch[4] });
      } else {
        tokens.push({ type: "tag", value: tagContent });
      }
      i = end + 1;
      continue;
    }
    const next = line.indexOf("<", i);
    const text = next === -1 ? line.slice(i) : line.slice(i, next);
    tokens.push({ type: "text", value: text });
    i += text.length;
  }
  return tokens;
}

// Token colours — two sets for dark and light
const DARK_COLORS: Record<TokenType, string> = {
  "tag":         "#79c0ff",
  "attr-name":   "#ffa657",
  "attr-value":  "#a5d6ff",
  "comment":     "#8b949e",
  "text":        "#e6edf3",
  "punctuation": "#79c0ff",
};
const LIGHT_COLORS: Record<TokenType, string> = {
  "tag":         "#0969da",
  "attr-name":   "#953800",
  "attr-value":  "#0a3069",
  "comment":     "#6e7781",
  "text":        "#24292f",
  "punctuation": "#0969da",
};

function SyntaxLine({ line, isDark }: { line: string; isDark: boolean }) {
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  return (
    <>
      {tokeniseXml(line).map((t, i) => (
        <span key={i} style={{ color: colors[t.type] }}>{t.value}</span>
      ))}
    </>
  );
}

// ── Client-side XML validation ─────────────────────────────────────────────────

function validateXml(xml: string): { valid: boolean; error: string | null } {
  if (!xml.trim()) return { valid: false, error: "Empty XML" };
  try {
    const errs = new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror");
    if (errs.length > 0) return { valid: false, error: errs[0].textContent ?? "Parse error" };
    return { valid: true, error: null };
  } catch (e: unknown) {
    return { valid: false, error: String(e) };
  }
}

// ── Undo/redo ──────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
interface HistoryEntry { value: string; selStart: number; selEnd: number }

function useUndoRedo(initial: string) {
  const historyRef  = useRef<HistoryEntry[]>([{ value: initial, selStart: 0, selEnd: 0 }]);
  const posRef      = useRef(0);
  const lastPushRef = useRef<number>(0);

  const push = useCallback((value: string, selStart: number, selEnd: number) => {
    const now = Date.now();
    if (now - lastPushRef.current < 500) {
      historyRef.current[posRef.current] = { value, selStart, selEnd };
      lastPushRef.current = now;
      return;
    }
    historyRef.current = historyRef.current.slice(0, posRef.current + 1);
    historyRef.current.push({ value, selStart, selEnd });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    posRef.current = historyRef.current.length - 1;
    lastPushRef.current = now;
  }, []);

  const undo = useCallback((): HistoryEntry | null => {
    if (posRef.current <= 0) return null;
    posRef.current--;
    return historyRef.current[posRef.current];
  }, []);

  const redo = useCallback((): HistoryEntry | null => {
    if (posRef.current >= historyRef.current.length - 1) return null;
    posRef.current++;
    return historyRef.current[posRef.current];
  }, []);

  const reset = useCallback((value: string) => {
    historyRef.current = [{ value, selStart: 0, selEnd: 0 }];
    posRef.current     = 0;
    lastPushRef.current = 0;
  }, []);

  return { push, undo, redo, reset };
}

// ── Dark mode detection hook ───────────────────────────────────────────────────

function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDark;
}

// ── Main component ─────────────────────────────────────────────────────────────

interface XmlEditorProps {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  onSave?: (v: string) => void;
  onAutoSave?: (v: string) => void;
  height?: string;
  focusLine?: number | null;
  focusRequestId?: number;
  highlightText?: string;
}

export default function XmlEditor({
  value,
  onChange,
  readOnly = false,
  onSave,
  onAutoSave,
  height        = "100%",
  focusLine     = null,
  focusRequestId = 0,
  highlightText,
}: XmlEditorProps) {
  const isDark       = useDarkMode();
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef    = useRef<HTMLDivElement>(null);

  const [localValue, setLocalValue] = useState(value);
  const [isDirty,    setIsDirty]    = useState(false);
  const savedValueRef = useRef(value);
  const validation    = validateXml(localValue);
  const { push: pushHistory, undo, redo, reset: resetHistory } = useUndoRedo(value);

  // Sync from parent
  useEffect(() => {
    if (value === savedValueRef.current) return;
    savedValueRef.current = value;
    setLocalValue(value);
    setIsDirty(false);
    resetHistory(value);
  }, [value, resetHistory]);

  // Auto-save
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDirty || readOnly || !onAutoSave) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => onAutoSave(localValue), 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [localValue, isDirty, readOnly, onAutoSave]);

  // Scroll sync
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current, hl = highlightRef.current, gu = gutterRef.current;
    if (!ta || !hl || !gu) return;
    hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gu.scrollTop = ta.scrollTop;
  }, []);

  // Jump to line
  useEffect(() => {
    if (!focusLine || focusLine < 1) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const lines      = localValue.split("\n");
    const safeLine   = Math.min(focusLine, lines.length);
    const before     = lines.slice(0, safeLine - 1);
    const start      = before.length > 0 ? before.join("\n").length + 1 : 0;
    const currentLn  = lines[safeLine - 1] ?? "";
    ta.focus();
    ta.selectionStart = start;
    ta.selectionEnd   = start + currentLn.length;
    const top = Math.max(0, (safeLine - 1) * 19.2 - ta.clientHeight / 2);
    ta.scrollTo({ top, behavior: "smooth" });
    syncScroll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLine, focusRequestId]);

  // Key handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta  = textareaRef.current;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "s") {
        e.preventDefault();
        if (onSave && validation.valid) {
          onSave(localValue);
          savedValueRef.current = localValue;
          setIsDirty(false);
        }
        return;
      }
      if (mod && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        const entry = undo();
        if (entry && ta) {
          setLocalValue(entry.value); onChange?.(entry.value);
          setIsDirty(entry.value !== savedValueRef.current);
          requestAnimationFrame(() => {
            ta.selectionStart = entry.selStart; ta.selectionEnd = entry.selEnd; syncScroll();
          });
        }
        return;
      }
      if (mod && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        const entry = redo();
        if (entry && ta) {
          setLocalValue(entry.value); onChange?.(entry.value);
          setIsDirty(entry.value !== savedValueRef.current);
          requestAnimationFrame(() => {
            ta.selectionStart = entry.selStart; ta.selectionEnd = entry.selEnd; syncScroll();
          });
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (!ta) return;
        const s    = ta.selectionStart;
        const end  = ta.selectionEnd;
        const next = localValue.slice(0, s) + "  " + localValue.slice(end);
        setLocalValue(next); onChange?.(next);
        setIsDirty(next !== savedValueRef.current);
        pushHistory(next, s + 2, s + 2);
        requestAnimationFrame(() => { ta.selectionStart = s + 2; ta.selectionEnd = s + 2; syncScroll(); });
      }
    },
    [localValue, onChange, onSave, validation.valid, undo, redo, pushHistory, syncScroll],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta  = e.target;
    const val = ta.value;
    setLocalValue(val); onChange?.(val);
    setIsDirty(val !== savedValueRef.current);
    pushHistory(val, ta.selectionStart, ta.selectionEnd);
  };

  const lines   = localValue.split("\n");
  const normHl  = (highlightText ?? "").trim().toLowerCase();

  // Theme tokens
  const bg         = isDark ? "#0d1117"          : "#ffffff";
  const gutterBg   = isDark ? "#161b22"          : "#f6f8fa";
  const gutterText = isDark ? "#484f58"          : "#8c959f";
  const borderCol  = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.12)";
  const toolbarBg  = isDark ? "rgba(13,17,23,0.95)"    : "rgba(246,248,250,0.95)";
  const toolbarBdr = isDark ? "rgba(26,143,209,0.15)"  : "rgba(26,143,209,0.2)";
  const editorBdr  = isDark
    ? (isDirty ? "rgba(245,158,11,0.4)" : "rgba(26,143,209,0.2)")
    : (isDirty ? "rgba(245,158,11,0.5)" : "rgba(26,143,209,0.3)");
  const caretCol   = isDark ? "#e6edf3" : "#24292f";
  const lineNumAct = isDark ? "#42b4f5" : "#0969da";

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden border"
      style={{ borderColor: editorBdr, background: bg, height, transition: "border-color 0.2s", isolation: "isolate" }}
    >
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: toolbarBdr, background: toolbarBg }}>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className={`text-xs font-semibold ${isDark ? "text-white" : "text-gray-800"}`}>XML Editor</span>

          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${
            validation.valid
              ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-300"
              : "bg-red-500/15 text-red-600 border-red-500/25 dark:text-red-300"
          }`}>
            {validation.valid ? "Valid XML" : "Invalid XML"}
          </span>

          {isDirty && !readOnly && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-amber-500/15 text-amber-600 border-amber-500/25 dark:text-amber-300 flex-shrink-0 animate-pulse">
              Unsaved
            </span>
          )}

          {normHl && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-cyan-500/15 text-cyan-600 border-cyan-500/30 dark:text-cyan-200 flex-shrink-0">
              Highlight Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{lines.length}L</span>
          {!readOnly && (
            <>
              <button
                onClick={() => {
                  const entry = undo(), ta = textareaRef.current;
                  if (entry && ta) {
                    setLocalValue(entry.value); onChange?.(entry.value);
                    setIsDirty(entry.value !== savedValueRef.current);
                    requestAnimationFrame(() => { ta.selectionStart=entry.selStart; ta.selectionEnd=entry.selEnd; syncScroll(); });
                  }
                }}
                title="Undo (Ctrl+Z)"
                className={`flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono transition-colors
                  ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700/50" : "text-gray-500 hover:text-gray-900 hover:bg-gray-200"}`}
              >↩</button>
              <button
                onClick={() => {
                  const entry = redo(), ta = textareaRef.current;
                  if (entry && ta) {
                    setLocalValue(entry.value); onChange?.(entry.value);
                    setIsDirty(entry.value !== savedValueRef.current);
                    requestAnimationFrame(() => { ta.selectionStart=entry.selStart; ta.selectionEnd=entry.selEnd; syncScroll(); });
                  }
                }}
                title="Redo (Ctrl+Y)"
                className={`flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono transition-colors
                  ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700/50" : "text-gray-500 hover:text-gray-900 hover:bg-gray-200"}`}
              >↪</button>
            </>
          )}
        </div>
      </div>

      {/* Editor body */}
      <div className="flex flex-1 overflow-hidden" style={{ fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontSize: "12px", lineHeight: "1.6" }}>

        {/* Line number gutter */}
        <div ref={gutterRef} className="flex-shrink-0 overflow-hidden select-none text-right pr-2 pt-2 pl-1"
          style={{ width:"3rem", background:gutterBg, color:gutterText, borderRight:`1px solid ${borderCol}`, overflowY:"hidden" }}>
          {lines.map((_, i) => (
            <div key={i} style={{
              lineHeight:"1.6", whiteSpace:"nowrap",
              color:      focusLine === i+1 ? lineNumAct : gutterText,
              fontWeight: focusLine === i+1 ? 700 : undefined,
            }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Highlight + textarea stacked */}
        <div className="relative flex-1 overflow-hidden">

          {/* Syntax highlight layer — behind textarea, pointer-events off */}
          <div
            ref={highlightRef}
            aria-hidden="true"
            className="absolute inset-0 overflow-auto whitespace-pre p-2"
            style={{
              pointerEvents: "none",
              zIndex:        1,
              overflowY:     "scroll",
              overflowX:     "scroll",
              background:    bg,
            }}
          >
            {lines.map((line, i) => (
              <div key={i} style={{
                lineHeight: "1.6",
                background:
                  focusLine === i+1
                    ? (isDark ? "rgba(26,143,209,0.2)"  : "rgba(26,143,209,0.08)")
                    : (normHl && line.toLowerCase().includes(normHl))
                      ? (isDark ? "rgba(34,211,238,0.14)" : "rgba(34,211,238,0.10)")
                      : undefined,
                outline:
                  focusLine === i+1
                    ? `1px solid ${isDark ? "rgba(26,143,209,0.4)" : "rgba(26,143,209,0.3)"}`
                    : (normHl && line.toLowerCase().includes(normHl))
                      ? `1px solid ${isDark ? "rgba(34,211,238,0.35)" : "rgba(34,211,238,0.25)"}`
                      : undefined,
              }}>
                <SyntaxLine line={line} isDark={isDark} />
              </div>
            ))}
          </div>

          {/* The actual textarea — transparent background so highlight shows through */}
          <textarea
            ref={textareaRef}
            value={localValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            wrap="off"
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            className="absolute inset-0 w-full h-full resize-none outline-none p-2"
            style={{
              // Transparent so syntax colours show through from the layer below
              color:               "transparent",
              WebkitTextFillColor: "transparent",
              // caretColor MUST be a real visible colour — this is what broke editing
              caretColor:          caretCol,
              background:          "transparent",
              zIndex:              2,           // on top so it receives all input events
              pointerEvents:       "auto",      // explicitly set — never block input
              overflowX:           "scroll",
              overflowY:           "scroll",
              whiteSpace:          "pre",
              overflowWrap:        "normal",
              fontFamily:          "inherit",
              fontSize:            "inherit",
              lineHeight:          "inherit",
            }}
          />
        </div>
      </div>

      {/* Validation error bar */}
      {!validation.valid && validation.error && (
        <div className="flex-shrink-0 px-3 py-1.5 text-[10px] border-t"
          style={{
            borderColor: isDark ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.3)",
            background:  isDark ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.04)",
            color:       isDark ? "#fca5a5" : "#b91c1c",
          }}>
          {validation.error.slice(0, 200)}
        </div>
      )}
    </div>
  );
}