"use client";
/**
 * XmlEditor — Syntax-aware XML editor built on a styled <textarea>.
 *
 * Why not Monaco?
 * ───────────────
 * Monaco requires a separate npm install + webpack config.  This component
 * delivers a production-quality editing experience using only built-in browser
 * APIs and CSS, with line numbers, syntax colouring via a minimal tokeniser,
 * tab key support, and an XML validation indicator.
 *
 * For production swap the <textarea> for Monaco by replacing the editor body.
 *
 * Features
 * ────────
 * - Line numbers gutter
 * - Syntax highlighting overlay (tags, attributes, values, comments)
 * - Tab key inserts 2 spaces
 * - Keyboard shortcut: Ctrl+S / Cmd+S triggers onSave
 * - XML validation status badge (green/red)
 * - "Auto-generate" and "Save" action buttons
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
    // XML comment
    if (line.startsWith("<!--", i)) {
      const end = line.indexOf("-->", i + 4);
      const s   = end === -1 ? line.slice(i) : line.slice(i, end + 3);
      tokens.push({ type: "comment", value: s });
      i += s.length;
      continue;
    }
    // Tag opening/closing
    if (line[i] === "<") {
      const end = line.indexOf(">", i);
      if (end === -1) {
        tokens.push({ type: "tag", value: line.slice(i) });
        i = line.length;
        continue;
      }
      const tagContent = line.slice(i, end + 1);
      // Split tag further: <tag attr="val">
      const tagMatch = tagContent.match(/^(<\/?)(\w[\w:-]*)(.*)(\s*\/?>)$/s);
      if (tagMatch) {
        tokens.push({ type: "punctuation", value: tagMatch[1] });
        tokens.push({ type: "tag",         value: tagMatch[2] });
        // Attribute tokenising
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
    // Plain text
    const next = line.indexOf("<", i);
    const text = next === -1 ? line.slice(i) : line.slice(i, next);
    tokens.push({ type: "text", value: text });
    i += text.length;
  }

  return tokens;
}

const TOKEN_COLORS: Record<TokenType, string> = {
  "tag":        "#79c0ff",   // blue – tag names
  "attr-name":  "#ffa657",   // orange – attribute names
  "attr-value": "#a5d6ff",   // light blue – attribute values
  "comment":    "#8b949e",   // grey – comments
  "text":       "#e6edf3",   // white – text content
  "punctuation":"#79c0ff",   // blue – < > / =
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

// ── Validation ─────────────────────────────────────────────────────────────────

function validateXml(xml: string): { valid: boolean; error: string | null } {
  if (!xml.trim()) return { valid: false, error: "Empty XML" };
  try {
    new DOMParser().parseFromString(xml, "application/xml");
    const errs = new DOMParser().parseFromString(xml, "application/xml")
      .getElementsByTagName("parsererror");
    if (errs.length > 0) return { valid: false, error: errs[0].textContent ?? "Parse error" };
    return { valid: true, error: null };
  } catch (e: unknown) {
    return { valid: false, error: String(e) };
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

interface XmlEditorProps {
  /** XML content to display/edit */
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  /** Called when user presses Ctrl+S or clicks Save */
  onSave?: (v: string) => void;
  /** Called when user clicks "Auto-generate" */
  onAutoGenerate?: () => void;
  isGenerating?: boolean;
  isSaving?: boolean;
  height?: string;   // CSS height, e.g. "100%"
}

export default function XmlEditor({
  value,
  onChange,
  readOnly = false,
  onSave,
  onAutoGenerate,
  isGenerating = false,
  isSaving     = false,
  height = "100%",
}: XmlEditorProps) {
  const textareaRef   = useRef<HTMLTextAreaElement>(null);
  const highlightRef  = useRef<HTMLDivElement>(null);
  const gutterRef     = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const validation = validateXml(localValue);

  // Sync from parent
  useEffect(() => { setLocalValue(value); }, [value]);

  // Sync scroll between textarea and highlight overlay
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    const gutter = gutterRef.current;
    if (!ta || !hl || !gutter) return;
    hl.scrollTop    = ta.scrollTop;
    hl.scrollLeft   = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }, []);

  // Handle Ctrl+S / Cmd+S
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.(localValue);
        return;
      }
      // Tab key inserts 2 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        const ta    = e.currentTarget;
        const start = ta.selectionStart;
        const end   = ta.selectionEnd;
        const next  = localValue.slice(0, start) + "  " + localValue.slice(end);
        setLocalValue(next);
        onChange?.(next);
        // Restore cursor position after setState
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [localValue, onChange, onSave],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
    onChange?.(e.target.value);
  };

  const lines = localValue.split("\n");
  const lineCount = lines.length;

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{
        borderColor: "rgba(26,143,209,0.2)",
        background:  "#0d1117",
        height,
      }}
    >
      {/* Toolbar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.9)" }}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className="text-xs font-semibold text-white">XML Editor</span>

          {/* Validation badge */}
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
              validation.valid
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
                : "bg-red-500/15 text-red-300 border-red-500/25"
            }`}
          >
            {validation.valid ? "Valid XML" : "Invalid XML"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Line count */}
          <span className="text-[10px] text-slate-500">{lineCount} lines</span>

          {/* Auto-generate button */}
          {onAutoGenerate && !readOnly && (
            <button
              onClick={onAutoGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50"
              style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.25)" }}
            >
              {isGenerating ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              Auto-generate
            </button>
          )}

          {/* Save button */}
          {onSave && !readOnly && (
            <button
              onClick={() => onSave(localValue)}
              disabled={isSaving || !validation.valid}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50"
              style={{ background: "rgba(26,143,209,0.15)", color: "#42b4f5", border: "1px solid rgba(26,143,209,0.25)" }}
            >
              {isSaving ? "Saving…" : "Save (Ctrl+S)"}
            </button>
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
            width:      "3rem",
            background: "#161b22",
            color:      "#484f58",
            borderRight:"1px solid rgba(255,255,255,0.05)",
            overflowY:  "hidden",
          }}
        >
          {lines.map((_, i) => (
            <div key={i} style={{ lineHeight: "1.6", whiteSpace: "nowrap" }}>{i + 1}</div>
          ))}
        </div>

        {/* Syntax highlight overlay + textarea (stacked) */}
        <div className="relative flex-1 overflow-hidden">
          {/* Highlight layer (pointer-events: none) */}
          <div
            ref={highlightRef}
            className="absolute inset-0 overflow-auto whitespace-pre p-2"
            style={{
              pointerEvents: "none",
              color:          "transparent",  // hide text; show only spans
              overflowY:      "scroll",
              overflowX:      "scroll",
              zIndex:         1,
            }}
          >
            {lines.map((line, i) => (
              <div key={i} style={{ lineHeight: "1.6" }}>
                <SyntaxLine line={line} />
              </div>
            ))}
          </div>

          {/* Editable textarea on top */}
          <textarea
            ref={textareaRef}
            value={localValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            readOnly={readOnly}
            spellCheck={false}
            className="absolute inset-0 w-full h-full resize-none outline-none p-2 bg-transparent"
            style={{
              color:      "#e6edf3",
              caretColor: "#e6edf3",
              zIndex:     2,
              overflowX:  "scroll",
              overflowY:  "scroll",
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
