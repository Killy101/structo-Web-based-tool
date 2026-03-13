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
  "tag":         "#79c0ff",
  "attr-name":   "#ffa657",
  "attr-value":  "#a5d6ff",
  "comment":     "#8b949e",
  "text":        "#e6edf3",
  "punctuation": "#79c0ff",
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

interface XmlEditorProps {
  value: string;
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
  onChange,
  readOnly = false,
  onSave,
  onAutoSave,
  height        = "100%",
  focusLine     = null,
  focusRequestId = 0,
  highlightText,
}: XmlEditorProps) {
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
        borderColor: isDirty ? "rgba(245,158,11,0.4)" : "rgba(26,143,209,0.2)",
        background:  "#0d1117",
        height,
        transition: "border-color 0.2s",
      }}
    >
      {/* Toolbar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.9)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className="text-xs font-semibold text-white">XML Editor</span>

          {/* Validation badge */}
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${
              validation.valid
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
                : "bg-red-500/15 text-red-300 border-red-500/25"
            }`}
          >
            {validation.valid ? "Valid XML" : "Invalid XML"}
          </span>

          {/* Unsaved changes indicator (Feature #6) */}
          {isDirty && !readOnly && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-amber-500/15 text-amber-300 border-amber-500/25 flex-shrink-0 animate-pulse">
              Unsaved
            </span>
          )}

          {normHl && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-cyan-500/15 text-cyan-200 border-cyan-500/30 flex-shrink-0">
              Highlight Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-slate-500">{lineCount}L</span>

          {/* Undo / Redo buttons (Feature #3) */}
          {!readOnly && (
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

      {/* Editor body: gutter + overlay + textarea */}
      <div className="flex flex-1 overflow-hidden" style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.6" }}>
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
                      ? "rgba(26,143,209,0.2)"
                      : (normHl && line.toLowerCase().includes(normHl))
                        ? "rgba(34,211,238,0.14)"
                        : undefined,
                  outline:
                    focusLine === i + 1
                      ? "1px solid rgba(26,143,209,0.4)"
                      : (normHl && line.toLowerCase().includes(normHl))
                        ? "1px solid rgba(34,211,238,0.35)"
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
          className="flex-shrink-0 px-3 py-1.5 text-[10px] text-red-300 border-t"
          style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)" }}
        >
          {validation.error.slice(0, 200)}
        </div>
      )}
    </div>
  );
}