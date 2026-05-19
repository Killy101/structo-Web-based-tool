"use client";

/**
 * XmlEditor — Monaco-based XML editor used in WF3 (editable) mode of XmlPanel.
 *
 * Features:
 *  - Full VS Code-style XML syntax highlighting (Monaco Editor)
 *  - Line numbers, minimap, bracket matching, code folding
 *  - Native Ctrl+Z / Ctrl+Y undo/redo via Monaco's built-in history
 *  - Real-time XML validation via DOMParser → Monaco model markers
 *    (line/column error markers shown inline, debounced 600ms)
 *  - navSpan reveal: char offsets are converted to line/column via
 *    model.getPositionAt() and the editor scrolls to center on the match
 *  - Scroll-fraction reporting via onDidScrollChange so DiffViewer can
 *    keep all panels in sync
 *  - Exposes XmlScrollTarget via useImperativeHandle so DiffViewer's
 *    syncXmlScroll can drive scrollTop the same way it does for the WF2 div
 *
 * Design decisions:
 *  - Uses @monaco-editor/react which auto-configures Monaco workers via CDN
 *    (no webpack customisation needed; compatible with Next.js App Router)
 *  - "use client" prevents SSR execution; Editor is loaded lazily on mount
 *  - tagName = "MONACO" lets DiffViewer.scrollXmlToMark skip <mark> search
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";
import { useTheme } from "@/context/ThemContext";
import type { XmlScrollTarget } from "./types";

// ── Validation debounce ───────────────────────────────────────────────────────
const VALIDATION_DEBOUNCE_MS = 600;

interface Props {
  value: string;
  onChange?: (value: string) => void;
  /** Character-offset span to highlight (chunk location in raw XML text). */
  navSpan?: { start: number; end: number } | null;
  /** Callback fired on scroll so the parent can sync sibling panels. */
  onScrollFraction?: (fraction: number) => void;
  /**
   * Called with the current XML validation error string (or null when valid).
   * Used by XmlPanel to show a validation status indicator in the toolbar.
   */
  onValidationChange?: (error: string | null) => void;
  /**
   * Called when the cursor moves inside the Monaco editor (WF3 only).
   * Receives the character offset of the cursor position in the full XML text.
   * XmlPanel converts this to a line character range and calls onXmlLineClick.
   */
  onCursorOffset?: (charOffset: number) => void;
}

/**
 * The forwarded ref exposes XmlScrollTarget so DiffViewer's syncXmlScroll can
 * drive Monaco's scroll position the same way it does for the WF2 read-only
 * div.  We use getters/setters to proxy Monaco's scroll API, and tagName is
 * set to "MONACO" so that scrollXmlToMark() skips the DOM <mark> search.
 */
const XmlEditor = forwardRef<XmlScrollTarget, Props>(
  function XmlEditor({ value, onChange, navSpan, onScrollFraction, onValidationChange, onCursorOffset }, ref) {
    const { dark } = useTheme();
    const monaco = useMonaco();

    /** Stable ref to the Monaco editor instance (set in onMount). */
    const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);

    /**
     * Validation timer ref — cleared/reset on each keystroke so we only
     * run the expensive DOMParser check after the user stops typing.
     */
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Track the last navSpan we revealed so we don't repeat on every render. */
    const lastRevealedSpanRef = useRef<{ start: number; end: number } | null>(null);

    /** Stable ref for onCursorOffset — lets the Monaco listener read the latest
     * callback without needing to be recreated on every render cycle. */
    const onCursorOffsetRef = useRef(onCursorOffset);
    useEffect(() => { onCursorOffsetRef.current = onCursorOffset; }, [onCursorOffset]);

    // ── Expose XmlScrollTarget via useImperativeHandle ────────────────────────
    // DiffViewer.syncXmlScroll reads scrollHeight/clientHeight and sets scrollTop.
    // We proxy these through Monaco's scroll API so the same code drives both
    // the WF2 div and the WF3 Monaco editor.
    useImperativeHandle(
      ref,
      () => ({
        get scrollHeight() {
          return editorRef.current?.getScrollHeight() ?? 0;
        },
        get clientHeight() {
          return editorRef.current?.getLayoutInfo().height ?? 0;
        },
        get scrollTop() {
          return editorRef.current?.getScrollTop() ?? 0;
        },
        set scrollTop(v: number) {
          editorRef.current?.setScrollTop(v, 0 /* ScrollType.Smooth */);
        },
        /** Distinguishes this target from "DIV" / "TEXTAREA" in DiffViewer. */
        tagName: "MONACO" as const,
      }),
      [],
    );

    // ── Monaco editor mount handler ───────────────────────────────────────────
    const handleMount = useCallback(
      (editor: MonacoNS.editor.IStandaloneCodeEditor) => {
        editorRef.current = editor;

        // Report scroll fraction when user scrolls the editor.
        editor.onDidScrollChange((e) => {
          if (!onScrollFraction) return;
          const visibleHeight = editor.getLayoutInfo().height;
          const max = e.scrollHeight - visibleHeight;
          if (max > 0) onScrollFraction(e.scrollTop / max);
        });

        // Report cursor character offset for XML → PDF navigation (WF3).
        // Use onMouseDown so navigation fires on the clicked position (not on
        // every cursor-position change from typing / arrow keys).
        editor.onMouseDown((e) => {
          const cb = onCursorOffsetRef.current;
          if (!cb) return;
          const model = editor.getModel();
          if (!model || !e.target.position) return;
          cb(model.getOffsetAt(e.target.position));
        });

        // Kick off initial validation.
        scheduleValidation(editor.getValue());
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onScrollFraction],
    );

    // ── XML validation ────────────────────────────────────────────────────────
    /**
     * Validate xmlText with DOMParser, then set Monaco model markers so errors
     * appear inline (red squiggle with line/column reference in the Problems
     * panel and on hover).  DOMParser gives us a <parsererror> node on failure
     * with a human-readable message; we parse the line/column out of it.
     */
    const scheduleValidation = useCallback(
      (text: string) => {
        if (validationTimerRef.current !== null) {
          clearTimeout(validationTimerRef.current);
        }
        validationTimerRef.current = setTimeout(() => {
          if (!monaco || !editorRef.current) return;
          const model = editorRef.current.getModel();
          if (!model) return;

          const doc = new DOMParser().parseFromString(text, "text/xml");
          const err = doc.querySelector("parsererror");

          if (!err) {
            // Valid — clear all markers and notify parent
            monaco.editor.setModelMarkers(model, "xml-validator", []);
            onValidationChange?.(null);
            return;
          }

          // Extract line/column from the error message text.
          // DOMParser format: "…error on line N at column M…"
          const msg = err.textContent ?? "Invalid XML";
          const lineMatch = msg.match(/line\s+(\d+)/i);
          const colMatch  = msg.match(/column\s+(\d+)/i);
          const lineNum   = lineMatch ? parseInt(lineMatch[1], 10) : 1;
          const colNum    = colMatch  ? parseInt(colMatch[1],  10) : 1;

          // Build a concise single-line message for the toolbar
          const firstLine = msg.split("\n").find((l) => l.trim().length > 0) ?? msg;
          const shortMsg  = firstLine.replace(/^error\s*:/i, "").trim().slice(0, 200);

          monaco.editor.setModelMarkers(model, "xml-validator", [
            {
              severity:        monaco.MarkerSeverity.Error,
              startLineNumber: lineNum,
              startColumn:     colNum,
              endLineNumber:   lineNum,
              endColumn:       Math.max(colNum + 1, (model.getLineLength(
                Math.min(lineNum, model.getLineCount())
              ))),
              message: shortMsg,
            },
          ]);
          onValidationChange?.(shortMsg);
        }, VALIDATION_DEBOUNCE_MS);
      },
      [monaco, onValidationChange],
    );

    // Re-validate when the value changes from outside (e.g. after apiApply).
    // We also re-validate inside handleChange for user keystrokes.
    useEffect(() => {
      if (editorRef.current) {
        scheduleValidation(value);
      }
    }, [value, scheduleValidation]);

    // ── navSpan reveal ────────────────────────────────────────────────────────
    /**
     * Convert character offset span → Monaco Position and reveal + select the
     * matching region.  Skips if the same span was already revealed to avoid
     * fighting with the user's own cursor movements.
     */
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !navSpan) return;
      const last = lastRevealedSpanRef.current;
      if (last && last.start === navSpan.start && last.end === navSpan.end) return;

      const model = editor.getModel();
      if (!model) return;

      const clampedStart = Math.max(0, Math.min(model.getValueLength(), navSpan.start));
      const clampedEnd   = Math.max(clampedStart, Math.min(model.getValueLength(), navSpan.end));

      const startPos = model.getPositionAt(clampedStart);
      const endPos   = model.getPositionAt(clampedEnd);

      editor.setSelection({
        startLineNumber: startPos.lineNumber,
        startColumn:     startPos.column,
        endLineNumber:   endPos.lineNumber,
        endColumn:       endPos.column,
      });
      editor.revealLineInCenterIfOutsideViewport(startPos.lineNumber, 0 /* Smooth */);

      lastRevealedSpanRef.current = navSpan;
    }, [navSpan]);

    // ── onChange handler ──────────────────────────────────────────────────────
    const handleChange = useCallback(
      (newValue: string | undefined) => {
        const v = newValue ?? "";
        onChange?.(v);
        scheduleValidation(v);
        // Clear cached navSpan so next selection is not suppressed
        lastRevealedSpanRef.current = null;
      },
      [onChange, scheduleValidation],
    );

    // ── Cleanup ───────────────────────────────────────────────────────────────
    useEffect(
      () => () => {
        if (validationTimerRef.current !== null) {
          clearTimeout(validationTimerRef.current);
        }
      },
      [],
    );

    // ── Monaco editor options ─────────────────────────────────────────────────
    // Memoised so Monaco does not re-apply options on every parent render.
    // `theme` is set via the <Editor theme={}> prop instead so Monaco's own
    // theme manager handles switching; `language` is set via `defaultLanguage`.
    const editorOptions = useMemo<MonacoNS.editor.IStandaloneEditorConstructionOptions>(
      () => ({
        automaticLayout:   true,   // re-measure on container resize
        fontSize:          11,
        lineHeight:        19,
        fontFamily:        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
        minimap:           { enabled: true, renderCharacters: false },
        lineNumbers:       "on" as const,
        scrollBeyondLastLine: false,
        wordWrap:          "off" as const,
        folding:           true,
        bracketPairColorization: { enabled: true },
        matchBrackets:     "always" as const,
        renderLineHighlight: "line" as const,
        // Suppress noisy IntelliSense that is unhelpful for raw XML editing
        quickSuggestions:  false,
        parameterHints:    { enabled: false },
        suggestOnTriggerCharacters: false,
        // Performance: Monaco virtualises lines by default, so large files are fast
        scrollbar: {
          vertical:   "visible" as const,
          horizontal: "visible" as const,
          useShadows: false,
        },
      }),
      [], // static — none of these options reference component props
    );

    return (
      <div className="h-full w-full overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="xml"
          value={value}
          theme={dark ? "vs-dark" : "vs"}
          options={editorOptions}
          onChange={handleChange}
          onMount={handleMount}
          loading={
            <div className={`h-full w-full flex items-center justify-center text-xs font-mono ${
              dark ? "bg-[#1e1e1e] text-slate-500" : "bg-white text-slate-400"
            }`}>
              Loading editor…
            </div>
          }
        />
      </div>
    );
  },
);

XmlEditor.displayName = "XmlEditor";
export default XmlEditor;
