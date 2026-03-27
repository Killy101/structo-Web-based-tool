"use client";
/**
 * XmlEditor — Syntax-aware XML editor built on a styled <textarea>.
 *
 * Features
 * ────────
 * - Line numbers gutter
 * - Syntax highlighting overlay (tags, attributes, values, comments)
 * - Tab key inserts 2 spaces
 * - Keyboard shortcut: Ctrl+S / Cmd+S triggers onSave
 * - Ctrl+Z / Cmd+Z  → undo  (feature #3)
 * - Ctrl+Y / Cmd+Shift+Z → redo  (feature #3)
 * - "Unsaved changes" dirty indicator in toolbar (feature #6)
 * - Auto-save after 3 s of inactivity (feature #6) — calls onAutoSave if provided
 * - XML validation status badge (green/red)
 * - Header shows editor status only; primary actions are in the page header
 * - Read-only mode support
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
      if (end === -1) {
        tokens.push({ type: "tag", value: line.slice(i) });
        i = line.length;
        continue;
      }
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
            tokens.push({ type: "text",        value: m[1] });
            tokens.push({ type: "attr-name",   value: m[2] });
            tokens.push({ type: "punctuation", value: m[3] });
            tokens.push({ type: "attr-value",  value: m[4] + m[5] + m[6] });
            j += m[0].length;
          } else {
            tokens.push({ type: "text", value: attrStr[j] });
            j++;
          }
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

const TOKEN_COLORS: Record<TokenType, string> = {
  "tag":         "#e5e7eb",
  "attr-name":   "#d1d5db",
  "attr-value":  "#f3f4f6",
  "comment":     "#9ca3af",
  "text":        "#f8fafc",
  "punctuation": "#e5e7eb",
};

function SyntaxLine({ line }: { line: string }) {
  const tokens = tokeniseXml(line);
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} style={{ color: TOKEN_COLORS[t.type] }}>
          {t.value}
        </span>
      ))}
    </>
  );
}

// ── Client-side XML validation ─────────────────────────────────────────────────

function validateXml(xml: string): { valid: boolean; error: string | null } {
  if (!xml.trim()) return { valid: false, error: "Empty XML" };
  try {
    const errs = new DOMParser()
      .parseFromString(xml, "application/xml")
      .getElementsByTagName("parsererror");
    if (errs.length > 0) return { valid: false, error: errs[0].textContent ?? "Parse error" };
    return { valid: true, error: null };
  } catch (e: unknown) {
    return { valid: false, error: String(e) };
  }
}

// ── Undo/redo history (Feature #3) ────────────────────────────────────────────

const MAX_HISTORY = 100;

interface HistoryEntry { value: string; selStart: number; selEnd: number }

function useUndoRedo(initial: string) {
  const historyRef = useRef<HistoryEntry[]>([{ value: initial, selStart: 0, selEnd: 0 }]);
  const posRef     = useRef(0);          // current position in historyRef
  const lastPushRef = useRef<number>(0); // timestamp of last push

  const push = useCallback((value: string, selStart: number, selEnd: number) => {
    const now = Date.now();
    // Debounce: collapse pushes within 500 ms into one entry
    if (now - lastPushRef.current < 500) {
      historyRef.current[posRef.current] = { value, selStart, selEnd };
      lastPushRef.current = now;
      return;
    }
    // Discard any redo entries after current position
    historyRef.current = historyRef.current.slice(0, posRef.current + 1);
    historyRef.current.push({ value, selStart, selEnd });
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
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

  const canUndo = () => posRef.current > 0;
  const canRedo = () => posRef.current < historyRef.current.length - 1;

  /** Reset history when the parent swaps in a completely new document */
  const reset = useCallback((value: string) => {
    historyRef.current = [{ value, selStart: 0, selEnd: 0 }];
    posRef.current     = 0;
    lastPushRef.current = 0;
  }, []);

  return { push, undo, redo, canUndo, canRedo, reset };
}

// ── Main component ─────────────────────────────────────────────────────────────

// ── XML Diff View (original vs current) ──────────────────────────────────────

interface XmlDiffLine {
  type: "equal" | "added" | "removed";
  text: string;
  lineNo: number;
}

function buildXmlDiff(original: string, current: string): XmlDiffLine[] {
  const origLines = original.split("\n");
  const currLines = current.split("\n");

  // Simple LCS-based diff using equality check
  const result: XmlDiffLine[] = [];
  let i = 0, j = 0;

  // Build a basic diff by walking both arrays
  while (i < origLines.length || j < currLines.length) {
    if (i >= origLines.length) {
      result.push({ type: "added", text: currLines[j], lineNo: j + 1 });
      j++;
    } else if (j >= currLines.length) {
      result.push({ type: "removed", text: origLines[i], lineNo: i + 1 });
      i++;
    } else if (origLines[i] === currLines[j]) {
      result.push({ type: "equal", text: currLines[j], lineNo: j + 1 });
      i++; j++;
    } else {
      // Look ahead up to 4 lines to find a match (simple context diff)
      let matchedOrig = -1, matchedCurr = -1;
      for (let d = 1; d <= 4; d++) {
        if (j + d < currLines.length && origLines[i] === currLines[j + d]) {
          matchedCurr = d; break;
        }
        if (i + d < origLines.length && origLines[i + d] === currLines[j]) {
          matchedOrig = d; break;
        }
      }
      if (matchedCurr > 0) {
        for (let k = 0; k < matchedCurr; k++) {
          result.push({ type: "added", text: currLines[j + k], lineNo: j + k + 1 });
        }
        j += matchedCurr;
      } else if (matchedOrig > 0) {
        for (let k = 0; k < matchedOrig; k++) {
          result.push({ type: "removed", text: origLines[i + k], lineNo: i + k + 1 });
        }
        i += matchedOrig;
      } else {
        result.push({ type: "removed", text: origLines[i], lineNo: i + 1 });
        result.push({ type: "added",   text: currLines[j],  lineNo: j + 1 });
        i++; j++;
      }
    }
  }
  return result;
}

function XmlDiffPanel({ original, current }: { original: string; current: string }) {
  const diffLines = buildXmlDiff(original, current);
  const hasChanges = diffLines.some((l) => l.type !== "equal");

  if (!hasChanges) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-slate-500 gap-2">
        <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        No changes from original XML
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-auto"
      style={{ fontFamily: "monospace", fontSize: "11px", lineHeight: "1.6", background: "#0d1117" }}
    >
      {diffLines.map((line, idx) => {
        const bg =
          line.type === "added"   ? "rgba(255,255,255,0.06)"  :
          line.type === "removed" ? "rgba(255,255,255,0.10)"  : "transparent";
        const color =
          line.type === "added"   ? "#f8fafc" :
          line.type === "removed" ? "#e5e7eb" : "#9ca3af";
        const prefix =
          line.type === "added"   ? "+" :
          line.type === "removed" ? "−" : " ";

        return (
          <div
            key={idx}
            className="flex"
            style={{ background: bg }}
          >
            <span
              className="flex-shrink-0 select-none text-right pr-2 pl-1"
              style={{ width: "2rem", color: "#484f58", borderRight: "1px solid rgba(255,255,255,0.05)" }}
            >
              {line.lineNo}
            </span>
            <span
              className="flex-shrink-0 w-5 text-center"
              style={{ color: line.type === "equal" ? "#484f58" : color }}
            >
              {prefix}
            </span>
            <span className="flex-1 whitespace-pre px-1" style={{ color: line.type === "equal" ? "#6e7681" : color }}>
              {line.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface XmlEditorProps {
  value: string;
  /** Original XML content (before any edits) — used for the diff view */
  originalValue?: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  onSave?: (v: string) => void;
  /** Optional callback for auto-save — receives latest value */
  onAutoSave?: (v: string) => void;
  height?: string;
  focusLine?: number | null;
  focusRequestId?: number;
  highlightText?: string;
}

export default function XmlEditor({
  value,
  originalValue,
  onChange,
  readOnly = false,
  onSave,
  onAutoSave,
  height        = "100%",
  focusLine     = null,
  focusRequestId = 0,
  highlightText,
}: XmlEditorProps) {
  const [showDiff, setShowDiff] = React.useState(false);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef    = useRef<HTMLDivElement>(null);

  const [localValue, setLocalValue] = useState(value);
  // isDirty: local value differs from the last value that came from the parent
  const [isDirty,    setIsDirty]    = useState(false);
  const savedValueRef = useRef(value); // tracks the last parent-synced value

  const validation = validateXml(localValue);

  const { push: pushHistory, undo, redo, reset: resetHistory } = useUndoRedo(value);

  // ── Sync from parent (e.g. chunk switch or auto-generate overwrote value) ──

  useEffect(() => {
    // Only sync if the parent injected a genuinely different value
    if (value === savedValueRef.current) return;
    savedValueRef.current = value;
    setLocalValue(value);
    setIsDirty(false);
    resetHistory(value);
  }, [value, resetHistory]);

  // ── Auto-save (Feature #6) ────────────────────────────────────────────────

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDirty || readOnly || !onAutoSave) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      onAutoSave(localValue);
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [localValue, isDirty, readOnly, onAutoSave]);

  // ── Scroll sync ──────────────────────────────────────────────────────────

  const syncScroll = useCallback(() => {
    const ta     = textareaRef.current;
    const hl     = highlightRef.current;
    const gutter = gutterRef.current;
    if (!ta || !hl || !gutter) return;
    hl.scrollTop     = ta.scrollTop;
    hl.scrollLeft    = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }, []);

  // ── Focus / jump to line ──────────────────────────────────────────────────

  useEffect(() => {
    if (!focusLine || focusLine < 1) return;
    const ta = textareaRef.current;
    if (!ta) return;

    const safeLine    = Math.min(focusLine, localValue.split("\n").length);
    const linesBefore = localValue.split("\n").slice(0, safeLine - 1);
    const start       = linesBefore.length > 0 ? linesBefore.join("\n").length + 1 : 0;
    const currentLine = localValue.split("\n")[safeLine - 1] ?? "";
    const end         = start + currentLine.length;

    ta.focus();
    ta.selectionStart = start;
    ta.selectionEnd   = end;

    const lineHeightPx = 19.2;
    const top = Math.max(0, ((safeLine - 1) * lineHeightPx) - ta.clientHeight / 2);
    ta.scrollTo({ top, behavior: "smooth" });
    syncScroll();
  }, [focusLine, focusRequestId, localValue, syncScroll]);

  // ── Key handler ──────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta  = textareaRef.current;
      const mod = e.metaKey || e.ctrlKey;

      // Ctrl+S / Cmd+S — save
      if (mod && e.key === "s") {
        e.preventDefault();
        if (onSave && validation.valid) {
          onSave(localValue);
          savedValueRef.current = localValue;
          setIsDirty(false);
        }
        return;
      }

      // Ctrl+Z / Cmd+Z — undo (Feature #3)
      if (mod && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        const entry = undo();
        if (entry && ta) {
          setLocalValue(entry.value);
          onChange?.(entry.value);
          setIsDirty(entry.value !== savedValueRef.current);
          requestAnimationFrame(() => {
            ta.selectionStart = entry.selStart;
            ta.selectionEnd   = entry.selEnd;
            syncScroll();
          });
        }
        return;
      }

      // Ctrl+Y / Cmd+Shift+Z — redo (Feature #3)
      if (mod && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        const entry = redo();
        if (entry && ta) {
          setLocalValue(entry.value);
          onChange?.(entry.value);
          setIsDirty(entry.value !== savedValueRef.current);
          requestAnimationFrame(() => {
            ta.selectionStart = entry.selStart;
            ta.selectionEnd   = entry.selEnd;
            syncScroll();
          });
        }
        return;
      }

      // Tab → 2 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        if (!ta) return;
        const s   = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = localValue.slice(0, s) + "  " + localValue.slice(end);
        setLocalValue(next);
        onChange?.(next);
        setIsDirty(next !== savedValueRef.current);
        pushHistory(next, s + 2, s + 2);
        requestAnimationFrame(() => {
          ta.selectionStart = s + 2;
          ta.selectionEnd   = s + 2;
          syncScroll();
        });
      }
    },
    [localValue, onChange, onSave, validation.valid, undo, redo, pushHistory, syncScroll],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta  = e.target;
    const val = ta.value;
    setLocalValue(val);
    onChange?.(val);
    setIsDirty(val !== savedValueRef.current);
    pushHistory(val, ta.selectionStart, ta.selectionEnd);
  };

  const lines      = localValue.split("\n");
  const lineCount  = lines.length;
  const normHl     = (highlightText ?? "").trim().toLowerCase();

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{
        borderColor: isDirty ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.16)",
        background:  "#0d1117",
        height,
        transition: "border-color 0.2s",
      }}
    >
      {/* Toolbar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(13,17,23,0.9)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className="text-xs font-semibold text-white">XML Editor</span>

          {/* Validation badge */}
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${
              validation.valid
                ? "bg-white/10 text-slate-200 border-white/20"
                : "bg-white/10 text-slate-200 border-white/20"
            }`}
          >
            {validation.valid ? "Valid XML" : "Invalid XML"}
          </span>

          {/* Unsaved changes indicator (Feature #6) */}
          {isDirty && !readOnly && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-white/10 text-slate-200 border-white/20 flex-shrink-0 animate-pulse">
              Unsaved
            </span>
          )}

          {normHl && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-white/10 text-slate-200 border-white/20 flex-shrink-0">
              Highlight Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-slate-500">{lineCount}L</span>

          {/* XML Diff toggle — only show when originalValue is provided */}
          {originalValue !== undefined && (
            <button
              onClick={() => setShowDiff((v) => !v)}
              title={showDiff ? "Back to editor" : "Show diff from original XML"}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold border transition-colors ${
                showDiff
                  ? "bg-white/10 border-white/25 text-slate-100"
                  : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-500"
              }`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              {showDiff ? "Editor" : "Diff"}
            </button>
          )}

          {/* Undo / Redo buttons (Feature #3) */}
          {!readOnly && !showDiff && (
            <>
              <button
                onClick={() => {
                  const entry = undo();
                  const ta    = textareaRef.current;
                  if (entry && ta) {
                    setLocalValue(entry.value);
                    onChange?.(entry.value);
                    setIsDirty(entry.value !== savedValueRef.current);
                    requestAnimationFrame(() => {
                      ta.selectionStart = entry.selStart;
                      ta.selectionEnd   = entry.selEnd;
                      syncScroll();
                    });
                  }
                }}
                title="Undo (Ctrl+Z)"
                className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors text-[10px] font-mono"
              >
                ↩
              </button>
              <button
                onClick={() => {
                  const entry = redo();
                  const ta    = textareaRef.current;
                  if (entry && ta) {
                    setLocalValue(entry.value);
                    onChange?.(entry.value);
                    setIsDirty(entry.value !== savedValueRef.current);
                    requestAnimationFrame(() => {
                      ta.selectionStart = entry.selStart;
                      ta.selectionEnd   = entry.selEnd;
                      syncScroll();
                    });
                  }
                }}
                title="Redo (Ctrl+Y)"
                className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors text-[10px] font-mono"
              >
                ↪
              </button>
            </>
          )}

        </div>
      </div>

      {/* XML Diff panel (shown when diff toggle is active) */}
      {showDiff && originalValue !== undefined && (
        <XmlDiffPanel original={originalValue} current={localValue} />
      )}

      {/* Editor body: gutter + overlay + textarea (hidden in diff mode) */}
      <div className="flex flex-1 overflow-hidden" style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.6", display: showDiff ? "none" : "flex" }}>
        {/* Line number gutter */}
        <div
          ref={gutterRef}
          className="flex-shrink-0 overflow-hidden select-none text-right pr-3 pt-2 pl-2"
          style={{
            width:       "3rem",
            background:  "#161b22",
            color:       "#484f58",
            borderRight: "1px solid rgba(255,255,255,0.05)",
            overflowY:   "hidden",
          }}
        >
          {lines.map((_, i) => (
            <div
              key={i}
              style={{
                lineHeight: "1.6",
                whiteSpace: "nowrap",
                color:      focusLine === i + 1 ? "#42b4f5" : undefined,
                fontWeight: focusLine === i + 1 ? 700 : undefined,
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Syntax highlight overlay + textarea (stacked) */}
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={highlightRef}
            className="absolute inset-0 overflow-auto whitespace-pre p-2"
            style={{
              pointerEvents: "none",
              color:         "transparent",
              overflowY:     "scroll",
              overflowX:     "scroll",
              zIndex:        1,
            }}
          >
            {lines.map((line, i) => (
              <div
                key={i}
                style={{
                  lineHeight: "1.6",
                  background:
                    focusLine === i + 1
                      ? "rgba(255,255,255,0.12)"
                      : (normHl && line.toLowerCase().includes(normHl))
                        ? "rgba(255,255,255,0.08)"
                        : undefined,
                  outline:
                    focusLine === i + 1
                      ? "1px solid rgba(255,255,255,0.28)"
                      : (normHl && line.toLowerCase().includes(normHl))
                        ? "1px solid rgba(255,255,255,0.20)"
                        : undefined,
                }}
              >
                <SyntaxLine line={line} />
              </div>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            value={localValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            wrap="off"
            readOnly={readOnly}
            spellCheck={false}
            className="absolute inset-0 w-full h-full resize-none outline-none p-2 bg-transparent"
            style={{
              color:               "transparent",
              WebkitTextFillColor: "transparent",
              caretColor:          "#e6edf3",
              zIndex:              2,
              overflowX:           "scroll",
              overflowY:           "scroll",
              whiteSpace:          "pre",
              overflowWrap:        "normal",
            }}
          />
        </div>
      </div>

      {/* Validation error bar */}
      {!validation.valid && validation.error && (
        <div
          className="flex-shrink-0 px-3 py-1.5 text-[10px] text-slate-200 border-t"
          style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}
        >
          {validation.error.slice(0, 200)}
        </div>
      )}
    </div>
  );
}