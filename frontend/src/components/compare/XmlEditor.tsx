"use client";

/**
 * XmlEditor — lightweight XML editor used in WF3 (editable) mode of XmlPanel.
 *
 * Features:
 *  - Automatic light/dark theme sync via ThemContext
 *  - navSpan selection + auto-scroll to the matched chunk
 *  - Scroll-fraction reporting for panel sync
 *  - Forwards its textarea ref so the parent (XmlPanel → DiffViewer) can
 *    programmatically set scrollTop for vertical scroll-sync with the diff
 *    panes (Fix: was previously broken because XmlPanel forwarded a div with
 *    overflow:hidden, making syncXmlScroll a no-op in WF3 mode).
 */

import React, { forwardRef, useCallback, useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemContext";

interface Props {
  value: string;
  onChange?: (value: string) => void;
  /** Character-offset span to highlight (chunk location in raw XML text). */
  navSpan?: { start: number; end: number } | null;
  /** Callback fired on scroll so the parent can sync sibling panels. */
  onScrollFraction?: (fraction: number) => void;
}

/**
 * The ref is forwarded to the underlying <textarea> element so that
 * DiffViewer's syncXmlScroll can set scrollTop directly.
 */
const XmlEditor = forwardRef<HTMLTextAreaElement, Props>(
  function XmlEditor({ value, onChange, navSpan, onScrollFraction }, forwardedRef) {
    const { dark } = useTheme();
    const internalRef = useRef<HTMLTextAreaElement>(null);

    // Merge the internal ref (used by effects below) with the forwarded ref
    // (used by DiffViewer's syncXmlScroll for programmatic scroll-sync).
    const setRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        (internalRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        if (typeof forwardedRef === "function") {
          forwardedRef(el);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }
      },
      [forwardedRef],
    );

    function handleScroll() {
      if (!onScrollFraction) return;
      const el = internalRef.current;
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0) {
        onScrollFraction(el.scrollTop / maxScroll);
      }
    }

    // Keep navSpan selection in sync so the relevant XML region stays visible.
    useEffect(() => {
      const el = internalRef.current;
      if (!el || !navSpan) return;

      const start = Math.max(0, Math.min(value.length, navSpan.start));
      const end = Math.max(start, Math.min(value.length, navSpan.end));

      el.focus({ preventScroll: true });
      el.setSelectionRange(start, end);

      const textBeforeSelection = value.slice(0, start);
      const selectedLineIndex = textBeforeSelection.split("\n").length - 1;
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19;
      const targetTop = Math.max(
        0,
        selectedLineIndex * lineHeight - (el.clientHeight - lineHeight) / 2,
      );

      el.scrollTop = targetTop;
      handleScroll();
    }, [navSpan, onScrollFraction, value]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div className={`h-full w-full ${dark ? "bg-[#1e1e1e]" : "bg-white"}`}>
        <textarea
          ref={setRef}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          className={`h-full w-full resize-none border-0 bg-transparent px-3 py-2 font-mono text-[11px] leading-[19px] outline-none ${
            dark ? "text-[#d4d4d4] selection:bg-yellow-400/20" : "text-slate-900 selection:bg-yellow-300/40"
          }`}
        />
      </div>
    );
  },
);

XmlEditor.displayName = "XmlEditor";
export default XmlEditor;
