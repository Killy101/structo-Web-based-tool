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
import Editor, { useMonaco, type OnMount } from "@monaco-editor/react";
import { useTheme } from "@/context/ThemContext";
import type { XmlScrollTarget } from "./types";

// ── Validation debounce ───────────────────────────────────────────────────────
const VALIDATION_DEBOUNCE_MS = 600;

// ── INNOD authoring support ──────────────────────────────────────────────────
const INNOD_VALIDATION_OWNER = "xml-validator";

type Marker = {
  startOffset: number;
  endOffset: number;
  message: string;
  severity: "warning" | "info";
};

const INNOD_LEVEL_VALUES = ["0", ...Array.from({ length: 15 }, (_, i) => String(i + 1))] as const;

const EMPHASIS_SHORTCUTS: Record<string, { open: string; close: string }> = {
  "&title": { open: "<title>", close: "</title>" },
  "&para": { open: "<p>", close: "</p>" },
  "&bold": { open: "<b>", close: "</b>" },
  "&underline": { open: "<u>", close: "</u>" },
  "&italic": { open: "<i>", close: "</i>" },
  "&strike": { open: "<s>", close: "</s>" },
};

const TAG_SHORTCUTS = new Set([
  "p",
  "b",
  "i",
  "u",
  "s",
  "title",
  "section",
  "footnote",
  "innodlevel",
  "innodheading",
  "innodidentifier",
  "innodtable",
  "innodimg",
  "innodreplace",
  "innodfootnote",
  "innodfootnoteref",
  "table",
  "tr",
  "th",
  "td",
  "li",
  "ul",
  "ol",
]);

const INNOD_SNIPPETS = [
  {
    label: "p",
    detail: "Paragraph",
    insertText: "<p>${1:text}</p>",
  },
  {
    label: "b",
    detail: "Bold",
    insertText: "<b>${1:text}</b>",
  },
  {
    label: "i",
    detail: "Italic",
    insertText: "<i>${1:text}</i>",
  },
  {
    label: "u",
    detail: "Underline",
    insertText: "<u>${1:text}</u>",
  },
  {
    label: "s",
    detail: "Strike",
    insertText: "<s>${1:text}</s>",
  },
  {
    label: "bold",
    detail: "Alias for <b>",
    insertText: "<b>${1:text}</b>",
  },
  {
    label: "italic",
    detail: "Alias for <i>",
    insertText: "<i>${1:text}</i>",
  },
  {
    label: "underline",
    detail: "Alias for <u>",
    insertText: "<u>${1:text}</u>",
  },
  {
    label: "strike",
    detail: "Alias for <s>",
    insertText: "<s>${1:text}</s>",
  },
  {
    label: "innodLevel section",
    detail: "Collapsed level section scaffold",
    insertText: [
      "<innodLevel level=\"${1:0}\" collapsed=\"${2:true}\">",
      "  <section level=\"$1\" collapsed=\"$2\">",
      "    <innodHeading><title><innodIdentifier>${3:a}</innodIdentifier>. ${4:Section title}</title></innodHeading>",
      "    <innodReplace>${5:Replaceable content}</innodReplace>",
      "    <p>${6:Paragraph text}</p>",
      "  </section>",
      "</innodLevel>",
    ].join("\n"),
  },
  {
    label: "innodHeading title",
    detail: "Heading with identifier-aware title",
    insertText: "<innodHeading><title><innodIdentifier>${1:a}</innodIdentifier>. ${2:Heading text}</title></innodHeading>",
  },
  {
    label: "innodIdentifier",
    detail: "Identifier token in path/title mapping",
    insertText: "<innodIdentifier>${1:EDG}</innodIdentifier>",
  },
  {
    label: "innodTable",
    detail: "Structured editable table",
    insertText: [
      "<innodTable>",
      "  <table>",
      "    <tr>",
      "      <th><p>${1:Header}</p></th>",
      "      <td><p>${2:Cell value}</p></td>",
      "    </tr>",
      "  </table>",
      "</innodTable>",
    ].join("\n"),
  },
  {
    label: "innodImg",
    detail: "Image wrapper preserving source path",
    insertText: [
      "<innodImg src=\"${1:/assets/image.png}\">",
      "  <img src=\"$1\" />",
      "</innodImg>",
    ].join("\n"),
  },
  {
    label: "innodFootnoteRef",
    detail: "Footnote reference",
    insertText: "<innodFootnoteRef fid=\"${1:F1}\" id=\"${2:ref-1}\" text=\"${3:1}\" />",
  },
  {
    label: "innodFootnote",
    detail: "Footnote definition",
    insertText: [
      "<innodFootnote fid=\"${1:F1}\" id=\"${2:fn-1}\">",
      "  <footnote id=\"$2\">",
      "    <p>${3:Footnote text}</p>",
      "  </footnote>",
      "</innodFootnote>",
    ].join("\n"),
  },
  {
    label: "innodReplace",
    detail: "Replaceable content wrapper",
    insertText: "<innodReplace>${1:Editable content}</innodReplace>",
  },
  {
    label: "user edit marker",
    detail: "Audit tag for manual editor changes",
    insertText: "<innodReplace userEdit=\"true\" editedBy=\"${1:user}\" editedAt=\"${2:2026-05-19T00:00:00Z}\">${3:Edited content}</innodReplace>",
  },
] as const;

function getAttr(rawAttrs: string, name: string): string | null {
  const m = rawAttrs.match(new RegExp(`${name}\\s*=\\s*[\"']([^\"']*)[\"']`, "i"));
  return m ? m[1] : null;
}

function formatXmlForEditor(xml: string): string {
  const src = xml.replace(/\r\n?/g, "\n").trim();
  if (!src) return "";

  // Safety guard: never run structural formatting on invalid XML.
  const parsed = new DOMParser().parseFromString(src, "text/xml");
  if (parsed.querySelector("parsererror")) {
    return src;
  }

  // Only collapse whitespace that exists strictly BETWEEN tags. This keeps
  // mixed text content unchanged while still producing consistent structure.
  const separated = src.replace(/>\s+</g, ">\n<");
  const rawLines = separated.split("\n").map((line) => line.trim()).filter(Boolean);

  let indent = 0;
  const out: string[] = [];

  for (const line of rawLines) {
    const isClose = /^<\//.test(line);
    const isSelf = /^<[^!?/][^>]*\/\s*>$/.test(line);
    const isDeclOrMeta = /^<\?/.test(line) || /^<!/.test(line);
    const isOpen = /^<[^!?/][^>]*>$/.test(line) && !isSelf;

    if (isClose) {
      indent = Math.max(0, indent - 1);
    }

    out.push(`${"  ".repeat(indent)}${line}`);

    if (isOpen && !isDeclOrMeta) {
      indent += 1;
    }
  }

  return out.join("\n");
}

function buildInnodGuidance(text: string): Marker[] {
  const markers: Marker[] = [];

  const levelOpenRe = /<innodLevel\b([^>]*)>/gi;
  let levelMatch: RegExpExecArray | null;
  while ((levelMatch = levelOpenRe.exec(text)) !== null) {
    const attrs = levelMatch[1] ?? "";
    const levelValue = getAttr(attrs, "level");
    const hasLevelAttr = /\blevel\s*=/.test(attrs);
    const collapsedValue = getAttr(attrs, "collapsed");
    const levelStart = levelMatch.index;

    if (!hasLevelAttr) {
      markers.push({
        startOffset: levelStart,
        endOffset: levelStart + levelMatch[0].length,
        message: "INNOD: add level=\"0\" (default) or a numeric level 1-15.",
        severity: "warning",
      });
    } else if (levelValue !== null && !/^(?:0|[1-9]|1[0-5])$/.test(levelValue)) {
      markers.push({
        startOffset: levelStart,
        endOffset: levelStart + levelMatch[0].length,
        message: "INNOD: level must be a number from 0 to 15.",
        severity: "warning",
      });
    }

    const closeIdx = text.indexOf("</innodLevel>", levelMatch.index + levelMatch[0].length);
    if (closeIdx === -1) {
      continue;
    }
    const block = text.slice(levelMatch.index, closeIdx + "</innodLevel>".length);

    const sectionOpen = /<section\b([^>]*)>/i.exec(block);
    if (!sectionOpen) {
      markers.push({
        startOffset: levelStart,
        endOffset: levelStart + levelMatch[0].length,
        message: "INNOD: <innodLevel> should contain a nested <section> block.",
        severity: "warning",
      });
    } else {
      const sectionAttrs = sectionOpen[1] ?? "";
      const sectionLevel = getAttr(sectionAttrs, "level");
      const sectionCollapsed = getAttr(sectionAttrs, "collapsed");

      if (levelValue !== null && levelValue !== "" && sectionLevel && levelValue !== sectionLevel) {
        markers.push({
          startOffset: levelStart,
          endOffset: levelStart + levelMatch[0].length,
          message: `INNOD: level mismatch (innodLevel=${levelValue}, section=${sectionLevel}).`,
          severity: "warning",
        });
      }

      if (collapsedValue && sectionCollapsed && collapsedValue !== sectionCollapsed) {
        markers.push({
          startOffset: levelStart,
          endOffset: levelStart + levelMatch[0].length,
          message: `INNOD: collapsed mismatch (innodLevel=${collapsedValue}, section=${sectionCollapsed}).`,
          severity: "warning",
        });
      }
    }

    if (!/<innodHeading\b[^>]*>\s*<title\b[^>]*>[\s\S]*?<\/title>\s*<\/innodHeading>/i.test(block)) {
      markers.push({
        startOffset: levelStart,
        endOffset: levelStart + levelMatch[0].length,
        message: "INNOD: section block should include <innodHeading><title>...</title></innodHeading>.",
        severity: "warning",
      });
    }
  }

  const titleRe = /<title\b[^>]*>([\s\S]*?)<\/title>/gi;
  let titleMatch: RegExpExecArray | null;
  while ((titleMatch = titleRe.exec(text)) !== null) {
    const titleInner = titleMatch[1] ?? "";
    const identRe = /<innodIdentifier\b[^>]*>([\s\S]*?)<\/innodIdentifier>/i;
    const ident = identRe.exec(titleInner);
    if (ident && !ident[1].trim()) {
      markers.push({
        startOffset: titleMatch.index,
        endOffset: titleMatch.index + titleMatch[0].length,
        message: "INNOD: empty <innodIdentifier>; fallback path key will default to EDG.",
        severity: "info",
      });
    }
  }

  const refFids = new Set<string>();
  const defFids = new Set<string>();
  const refRe = /<innodFootnoteRef\b([^>]*)\/?>(?:[\s\S]*?<\/innodFootnoteRef>)?/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refRe.exec(text)) !== null) {
    const fid = getAttr(refMatch[1] ?? "", "fid");
    if (fid) {
      refFids.add(fid);
    } else {
      markers.push({
        startOffset: refMatch.index,
        endOffset: refMatch.index + refMatch[0].length,
        message: "INNOD: <innodFootnoteRef> should include fid for reference mapping.",
        severity: "warning",
      });
    }
  }

  const defRe = /<innodFootnote\b([^>]*)>/gi;
  let defMatch: RegExpExecArray | null;
  while ((defMatch = defRe.exec(text)) !== null) {
    const fid = getAttr(defMatch[1] ?? "", "fid");
    if (fid) {
      defFids.add(fid);
    } else {
      markers.push({
        startOffset: defMatch.index,
        endOffset: defMatch.index + defMatch[0].length,
        message: "INNOD: <innodFootnote> should include fid to map references.",
        severity: "warning",
      });
    }
  }

  for (const fid of refFids) {
    if (!defFids.has(fid)) {
      const re = new RegExp(`<innodFootnoteRef\\b[^>]*\\bfid=[\"']${fid.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\"'][^>]*>`, "i");
      const m = re.exec(text);
      if (m && m.index >= 0) {
        markers.push({
          startOffset: m.index,
          endOffset: m.index + m[0].length,
          message: `INNOD: fid ${fid} has no matching <innodFootnote> definition.`,
          severity: "warning",
        });
      }
    }
  }

  const doublePFootnoteRe = /<footnote\b[^>]*>([\s\S]*?)<\/footnote>/gi;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = doublePFootnoteRe.exec(text)) !== null) {
    const pCount = (fnMatch[1].match(/<p\b[^>]*>/gi) ?? []).length;
    if (pCount >= 2) {
      markers.push({
        startOffset: fnMatch.index,
        endOffset: fnMatch.index + fnMatch[0].length,
        message: "INNOD: multi-paragraph footnote detected; compare normalization treats this as one logical footnote entity.",
        severity: "info",
      });
    }
  }

  // User-edit audit guidance: optional but recommended for traceability.
  const userEditRe = /<([a-z][\w:-]*)([^>]*\b(?:userEdit|data-user-edit)\s*=\s*["']([^"']*)["'][^>]*)>/gi;
  let userEditMatch: RegExpExecArray | null;
  while ((userEditMatch = userEditRe.exec(text)) !== null) {
    const tag = userEditMatch[1] ?? "tag";
    const attrs = userEditMatch[2] ?? "";
    const rawVal = (userEditMatch[3] ?? "").trim().toLowerCase();
    const editedBy = getAttr(attrs, "editedBy") ?? getAttr(attrs, "data-edited-by");
    const editedAt = getAttr(attrs, "editedAt") ?? getAttr(attrs, "data-edited-at");

    if (!["true", "false", "1", "0", "yes", "no"].includes(rawVal)) {
      markers.push({
        startOffset: userEditMatch.index,
        endOffset: userEditMatch.index + userEditMatch[0].length,
        message: `INNOD: user-edit flag on <${tag}> should be boolean-like (true/false/1/0).`,
        severity: "warning",
      });
    }

    if ((rawVal === "true" || rawVal === "1" || rawVal === "yes") && !editedBy) {
      markers.push({
        startOffset: userEditMatch.index,
        endOffset: userEditMatch.index + userEditMatch[0].length,
        message: `INNOD: add editedBy for user-edit traceability on <${tag}>.`,
        severity: "info",
      });
    }

    if (editedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(editedAt)) {
      markers.push({
        startOffset: userEditMatch.index,
        endOffset: userEditMatch.index + userEditMatch[0].length,
        message: `INNOD: editedAt on <${tag}> should use ISO datetime format (e.g. 2026-05-19T12:34:56Z).`,
        severity: "info",
      });
    }
  }

  return markers;
}

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
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

    /**
     * Validation timer ref — cleared/reset on each keystroke so we only
     * run the expensive DOMParser check after the user stops typing.
     */
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Track the last navSpan we revealed so we don't repeat on every render. */
    const lastRevealedSpanRef = useRef<{ start: number; end: number } | null>(null);
    const scheduleValidationRef = useRef<(text: string) => void>(() => undefined);

    /** Disposable registration for custom INNOD completion provider. */
    const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);
    const formatCommandDisposableRef = useRef<{ dispose: () => void } | null>(null);
    const userEditCommandDisposableRef = useRef<{ dispose: () => void } | null>(null);
    const shortcutDisposableRef = useRef<{ dispose: () => void } | null>(null);
    const applyingShortcutRef = useRef(false);

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
    const handleMount: OnMount = useCallback(
      (editor) => {
        editorRef.current = editor;

        // Report scroll fraction when user scrolls the editor.
        editor.onDidScrollChange((e: { scrollHeight: number; scrollTop: number }) => {
          if (!onScrollFraction) return;
          const visibleHeight = editor.getLayoutInfo().height;
          const max = e.scrollHeight - visibleHeight;
          if (max > 0) onScrollFraction(e.scrollTop / max);
        });

        // Report cursor character offset for XML → PDF navigation (WF3).
        // Reads from the stable ref so no Monaco listener is recreated on re-renders.
        editor.onDidChangeCursorPosition((e: { position: { lineNumber: number; column: number } }) => {
          const cb = onCursorOffsetRef.current;
          if (!cb) return;
          const model = editor.getModel();
          if (!model) return;
          cb(model.getOffsetAt(e.position));
        });

        // Kick off initial validation.
        scheduleValidationRef.current(editor.getValue());

        if (monaco) {
          const formatCommandId = editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            () => {
              const model = editor.getModel();
              if (!model) return;
              const oldText = model.getValue();
              const formatted = formatXmlForEditor(oldText);
              if (!formatted || formatted === oldText) return;

              const selection = editor.getSelection();
              const oldOffset = selection ? model.getOffsetAt(selection.getPosition()) : oldText.length;
              const ratio = oldText.length > 0 ? oldOffset / oldText.length : 0;

              model.pushEditOperations(
                [],
                [{
                  range: model.getFullModelRange(),
                  text: formatted,
                }],
                () => null,
              );

              const newOffset = Math.max(0, Math.min(formatted.length, Math.round(formatted.length * ratio)));
              const pos = model.getPositionAt(newOffset);
              editor.setPosition(pos);
              editor.revealPositionInCenterIfOutsideViewport(pos);
              onChange?.(formatted);
              scheduleValidation(formatted);
            },
          );
          formatCommandDisposableRef.current = {
            dispose: () => {
              // Monaco command IDs are not disposable by API; keep noop to simplify cleanup flow.
              void formatCommandId;
            },
          };

          const userEditCommandId = editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
            () => {
              const model = editor.getModel();
              const selection = editor.getSelection();
              if (!model || !selection) return;

              const selected = model.getValueInRange(selection);
              const inner = selected.length > 0 ? selected : "Edited content";
              const editedAt = new Date().toISOString();
              const openTag = `<innodReplace userEdit="true" editedBy="user" editedAt="${editedAt}">`;
              const closeTag = "</innodReplace>";
              const wrapped = `${openTag}${inner}${closeTag}`;

              const startOffset = model.getOffsetAt(selection.getStartPosition());
              editor.pushUndoStop();
              editor.executeEdits("innod-user-edit-wrap", [{
                range: selection,
                text: wrapped,
                forceMoveMarkers: true,
              }]);
              editor.pushUndoStop();

              const innerStart = model.getPositionAt(startOffset + openTag.length);
              const innerEnd = model.getPositionAt(startOffset + openTag.length + inner.length);
              editor.setSelection({
                startLineNumber: innerStart.lineNumber,
                startColumn: innerStart.column,
                endLineNumber: innerEnd.lineNumber,
                endColumn: innerEnd.column,
              });
              editor.revealPositionInCenterIfOutsideViewport(innerStart);
            },
          );
          userEditCommandDisposableRef.current = {
            dispose: () => {
              // Monaco command IDs are not disposable by API; keep noop to simplify cleanup flow.
              void userEditCommandId;
            },
          };

          shortcutDisposableRef.current = editor.onDidChangeModelContent((e) => {
            if (applyingShortcutRef.current || e.isUndoing || e.isRedoing) return;
            const change = e.changes[0];
            if (!change) {
              return;
            }
            const model = editor.getModel();
            if (!model) return;
            const pos = editor.getPosition();
            if (!pos) return;

            if (change.text === "<") {
              editor.trigger("innod-tag-suggest", "editor.action.triggerSuggest", {});
              return;
            }

            const linePrefix = model.getValueInRange({
              startLineNumber: pos.lineNumber,
              startColumn: 1,
              endLineNumber: pos.lineNumber,
              endColumn: pos.column,
            });
            const lineSuffix = model.getValueInRange({
              startLineNumber: pos.lineNumber,
              startColumn: pos.column,
              endLineNumber: pos.lineNumber,
              endColumn: model.getLineMaxColumn(pos.lineNumber),
            });

            if (change.text.length === 1 && /[a-z]/i.test(change.text)) {
              const tagMatch = linePrefix.match(/<([a-z][a-z0-9]*)$/i);
              if (tagMatch) {
                const tagName = (tagMatch[1] ?? "").toLowerCase();
                if (TAG_SHORTCUTS.has(tagName)) {
                  const closeTag = `</${tagName}>`;
                  applyingShortcutRef.current = true;
                  try {
                    // If matching close already exists at cursor, do not duplicate it.
                    if (lineSuffix.startsWith(`>${closeTag}`)) {
                      editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
                      return;
                    }
                    if (lineSuffix.startsWith(closeTag)) {
                      editor.executeEdits("innod-tag-shortcut-close-existing", [{
                        range: {
                          startLineNumber: pos.lineNumber,
                          startColumn: pos.column,
                          endLineNumber: pos.lineNumber,
                          endColumn: pos.column,
                        },
                        text: ">",
                      }]);
                      editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
                      return;
                    }

                    const startColumn = pos.column - tagName.length - 1;
                    const shouldConsumeAutoCloseBracket = lineSuffix.startsWith(">") && !lineSuffix.startsWith(`>${closeTag}`);
                    const range = {
                      startLineNumber: pos.lineNumber,
                      startColumn,
                      endLineNumber: pos.lineNumber,
                      endColumn: shouldConsumeAutoCloseBracket ? pos.column + 1 : pos.column,
                    };
                    const snippet = `<${tagName}>$0</${tagName}>`;
                    editor.executeEdits("innod-tag-shortcut-expand", [{ range, text: "" }]);
                    editor.setPosition({ lineNumber: pos.lineNumber, column: startColumn });
                    editor.trigger("innod-tag-shortcut", "editor.action.insertSnippet", { snippet });
                    return;
                  } finally {
                    applyingShortcutRef.current = false;
                  }
                }
              }
            }

            if (change.text.length === 1 && /[a-z]/i.test(change.text)) {
              const m = linePrefix.match(/(&[a-z]+)$/i);
              if (m) {
                const key = m[1].toLowerCase();
                const map = EMPHASIS_SHORTCUTS[key];
                if (map) {
                  applyingShortcutRef.current = true;
                  try {
                    const startColumn = pos.column - key.length;
                    const range = {
                      startLineNumber: pos.lineNumber,
                      startColumn,
                      endLineNumber: pos.lineNumber,
                      endColumn: pos.column,
                    };
                    const snippet = `${map.open}$0${map.close}`;
                    editor.executeEdits("innod-shortcut-expand", [{ range, text: "" }]);
                    editor.setPosition({ lineNumber: pos.lineNumber, column: startColumn });
                    editor.trigger("innod-shortcut", "editor.action.insertSnippet", { snippet });
                    return;
                  } finally {
                    applyingShortcutRef.current = false;
                  }
                }
              }
            }

            // Numeric-only guard for: <innodLevel level="...">
            const line = model.getLineContent(pos.lineNumber);
            const levelAttr = /(.*<innodLevel\b[^>]*\blevel\s*=\s*")([^"]*)(".*)/i.exec(line);
            if (!levelAttr) return;

            const prefix = levelAttr[1] ?? "";
            const rawVal = levelAttr[2] ?? "";
            const sanitizedVal = rawVal.replace(/[^0-9]/g, "");
            if (rawVal === sanitizedVal) return;

            applyingShortcutRef.current = true;
            try {
              const valueStartColumn = prefix.length + 1;
              const valueEndColumn = valueStartColumn + rawVal.length;
              editor.executeEdits("innod-level-sanitize", [{
                range: {
                  startLineNumber: pos.lineNumber,
                  startColumn: valueStartColumn,
                  endLineNumber: pos.lineNumber,
                  endColumn: valueEndColumn,
                },
                text: sanitizedVal,
              }]);
            } finally {
              applyingShortcutRef.current = false;
            }
          });
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [monaco, onChange, onScrollFraction],
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

          const markers: Array<{
            severity: number;
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
            message: string;
          }> = [];

          const doc = new DOMParser().parseFromString(text, "text/xml");
          const err = doc.querySelector("parsererror");

          let primaryError: string | null = null;

          if (err) {
            // Extract line/column from DOMParser's human-readable error string.
            const msg = err.textContent ?? "Invalid XML";
            const lineMatch = msg.match(/line\s+(\d+)/i);
            const colMatch = msg.match(/column\s+(\d+)/i);
            const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : 1;
            const colNum = colMatch ? parseInt(colMatch[1], 10) : 1;

            const firstLine = msg.split("\n").find((l) => l.trim().length > 0) ?? msg;
            const shortMsg = firstLine.replace(/^error\s*:/i, "").trim().slice(0, 200);
            primaryError = shortMsg;

            markers.push({
              severity: monaco.MarkerSeverity.Error,
              startLineNumber: lineNum,
              startColumn: colNum,
              endLineNumber: lineNum,
              endColumn: Math.max(
                colNum + 1,
                model.getLineLength(Math.min(lineNum, model.getLineCount())),
              ),
              message: shortMsg,
            });
          } else {
            const guidance = buildInnodGuidance(text);
            for (const g of guidance) {
              const start = model.getPositionAt(g.startOffset);
              const end = model.getPositionAt(g.endOffset);
              markers.push({
                severity: g.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: Math.max(start.column + 1, end.column),
                message: g.message,
              });
            }
          }

          monaco.editor.setModelMarkers(model, INNOD_VALIDATION_OWNER, markers);
          onValidationChange?.(primaryError);
        }, VALIDATION_DEBOUNCE_MS);
      },
      [monaco, onValidationChange],
    );

    useEffect(() => {
      scheduleValidationRef.current = scheduleValidation;
    }, [scheduleValidation]);

    // ── Register INNOD completion provider ───────────────────────────────────
    useEffect(() => {
      if (!monaco || completionDisposableRef.current) {
        return;
      }

      completionDisposableRef.current = monaco.languages.registerCompletionItemProvider("xml", {
        triggerCharacters: ["<", "/", "\"", "&"],
        provideCompletionItems(model, position) {
          const linePrefix = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          // level="" autocomplete for <innodLevel level="...">
          const levelAttrMatch = linePrefix.match(/<innodLevel\b[^>]*\blevel\s*=\s*"([^"]*)$/i);
          if (levelAttrMatch) {
            const typed = levelAttrMatch[1] ?? "";
            const replaceRange = {
              startLineNumber: position.lineNumber,
              startColumn: position.column - typed.length,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            };
            return {
              suggestions: INNOD_LEVEL_VALUES.map((v, idx) => ({
                label: v === "0" ? '(default) "0"' : v,
                kind: monaco.languages.CompletionItemKind.Value,
                detail: v === "0" ? "Default level" : "INNOD level",
                insertText: v,
                range: replaceRange,
                sortText: `00${idx}`,
                filterText: v,
              })),
            };
          }

          // Explicit suggestions for emphasis shortcuts.
          const shortcutMatch = linePrefix.match(/&[a-z]*$/i);
          if (shortcutMatch) {
            const startColumn = position.column - shortcutMatch[0].length;
            const range = {
              startLineNumber: position.lineNumber,
              startColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            };
            const shortcutSuggestions = Object.entries(EMPHASIS_SHORTCUTS).map(([k, tags], idx) => ({
              label: k,
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: `${tags.open}|${tags.close}`,
              documentation: "INNOD emphasis shortcut",
              insertText: `${tags.open}$0${tags.close}`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `01${idx}`,
            }));
            return { suggestions: shortcutSuggestions };
          }

          const lastLt = linePrefix.lastIndexOf("<");
          if (lastLt === -1) {
            return { suggestions: [] };
          }

          const afterLt = linePrefix.slice(lastLt + 1);
          if (/^\s*[!?]/.test(afterLt)) {
            return { suggestions: [] };
          }

          const range = {
            startLineNumber: position.lineNumber,
            startColumn: lastLt + 2,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          };

          const suggestions = INNOD_SNIPPETS.map((item, idx) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: item.detail,
            documentation: "INNOD XML template",
            insertText: item.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: `0${idx}`,
          }));

          return { suggestions };
        },
      });

      return () => {
        completionDisposableRef.current?.dispose();
        completionDisposableRef.current = null;
      };
    }, [monaco]);

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
        completionDisposableRef.current?.dispose();
        completionDisposableRef.current = null;
        shortcutDisposableRef.current?.dispose();
        shortcutDisposableRef.current = null;
        userEditCommandDisposableRef.current?.dispose();
        userEditCommandDisposableRef.current = null;
        formatCommandDisposableRef.current?.dispose();
        formatCommandDisposableRef.current = null;
      },
      [],
    );

    // ── Monaco editor options ─────────────────────────────────────────────────
    // Memoised so Monaco does not re-apply options on every parent render.
    // `theme` is set via the <Editor theme={}> prop instead so Monaco's own
    // theme manager handles switching; `language` is set via `defaultLanguage`.
    const editorOptions = useMemo(
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
        autoClosingBrackets: "never" as const,
        autoClosingQuotes: "never" as const,
        renderLineHighlight: "line" as const,
        // Suppress noisy IntelliSense that is unhelpful for raw XML editing
        quickSuggestions:  { other: false, comments: false, strings: false },
        parameterHints:    { enabled: false },
        suggestOnTriggerCharacters: true,
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
