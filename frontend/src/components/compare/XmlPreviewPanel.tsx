"use client";
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";

export interface XmlPreviewHandle {
  /** Scroll to a proportional position (0–1) without feedback loops. */
  scrollToFraction: (fraction: number) => void;
}

interface Props {
  xmlText: string;
}

// ── Tag classification ────────────────────────────────────────────────────────

/** Tags whose entire subtree is ignored (metadata, diff markers, etc.) */
const SKIP_TAGS = new Set([
  "innodmeta",
  "innodidentifier",
  "innodattr",
  "metadata",
  "processinginstruction",
]);

/** Tags that are transparent — drop the tag, keep children */
const UNWRAP_TAGS = new Set([
  "innodreplace",
  "innodlevel",
  "innoddoc",
  "document",
  "innodstr",
  "i-str",
  "innodref",
  "innodnote",
  "innodnote",
  "innoda",      // hyperlink wrapper
  "innodsup",    // superscript wrapper
  "innodsub",    // subscript wrapper
  "chapter",
  "section",
  "tbody",
  "thead",
  "tfoot",
  "innodtbody",
  "innodthead",
  "innodtfoot",
  "innodcolgroup",
  "colgroup",
  "col",
  "innodcol",
]);

// ── Recursive renderer ────────────────────────────────────────────────────────

function renderNode(node: Node, keyPrefix: string): React.ReactNode {
  // Text node
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text || null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el  = node as Element;
  const tag = el.tagName.toLowerCase();

  if (SKIP_TAGS.has(tag)) return null;

  // Helper: render all child nodes
  const renderChildren = (): React.ReactNode[] =>
    Array.from(el.childNodes)
      .map((c, i) => renderNode(c, `${keyPrefix}.${i}`))
      .filter((n): n is React.ReactNode => n !== null && n !== undefined && n !== "");

  // Transparent pass-through for unwrap set and unknown innod* wrappers
  const isUnwrap =
    UNWRAP_TAGS.has(tag) ||
    (tag.startsWith("innod") && tag !== "innodheading" && tag !== "innodtable" &&
     !tag.startsWith("innodtr") && !tag.startsWith("innodth") && !tag.startsWith("innodtd"));

  if (isUnwrap) {
    const kids = renderChildren();
    if (kids.length === 0) return null;
    return <React.Fragment key={keyPrefix}>{kids}</React.Fragment>;
  }

  // ── Known elements ────────────────────────────────────────────────────────

  switch (tag) {

    // ── Headings ─────────────────────────────────────────────────────────────
    case "innodheading": {
      const titleEl  = el.querySelector("title");
      const titleTxt = titleEl?.textContent?.trim() ?? el.textContent?.trim() ?? "";
      if (!titleTxt) return null;

      // Determine heading level from closest ancestor with level="" attribute
      let level = 2;
      let anc: Element | null = el.parentElement;
      while (anc) {
        const l = anc.getAttribute("level");
        if (l) {
          const n = parseInt(l, 10);
          if (!isNaN(n)) { level = Math.max(1, Math.min(n + 1, 5)); break; }
        }
        anc = anc.parentElement;
      }

      const cls =
        level <= 2
          ? "text-[15px] font-bold mt-7 mb-2 text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-white/10 pb-1.5"
          : level === 3
          ? "text-[13px] font-bold mt-5 mb-1.5 text-slate-800 dark:text-slate-200"
          : "text-[12px] font-semibold mt-4 mb-1 text-slate-700 dark:text-slate-300";

      return (
        <div key={keyPrefix} className={cls}>
          {titleTxt}
        </div>
      );
    }

    // Stand-alone <title> outside innodHeading
    case "title": {
      if (el.parentElement?.tagName.toLowerCase() === "innodheading") return null;
      const txt = el.textContent?.trim() ?? "";
      if (!txt) return null;
      return (
        <div key={keyPrefix} className="text-[13px] font-semibold mt-4 mb-1 text-slate-700 dark:text-slate-300">
          {txt}
        </div>
      );
    }

    // ── Paragraph ────────────────────────────────────────────────────────────
    case "p": {
      const kids = renderChildren();
      const txt  = el.textContent?.trim() ?? "";
      if (!txt && kids.length === 0) return null;
      return (
        <p key={keyPrefix} className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 mb-2">
          {kids.length > 0 ? kids : txt}
        </p>
      );
    }

    // ── Inline formatting ─────────────────────────────────────────────────────
    case "b":
    case "strong":
      return <strong key={keyPrefix}>{renderChildren()}</strong>;

    case "i":
    case "em":
      return <em key={keyPrefix}>{renderChildren()}</em>;

    case "u":
      return <u key={keyPrefix}>{renderChildren()}</u>;

    case "s":
    case "strike":
    case "del":
      return (
        <s key={keyPrefix} className="opacity-55">
          {renderChildren()}
        </s>
      );

    case "sup":
      return <sup key={keyPrefix}>{renderChildren()}</sup>;

    case "sub":
      return <sub key={keyPrefix}>{renderChildren()}</sub>;

    case "br":
      return <br key={keyPrefix} />;

    // ── Lists ─────────────────────────────────────────────────────────────────
    case "ul":
    case "innodlist":
      return (
        <ul key={keyPrefix} className="list-disc list-inside text-[13px] text-slate-700 dark:text-slate-300 mb-2 ml-4 space-y-0.5">
          {renderChildren()}
        </ul>
      );

    case "ol":
      return (
        <ol key={keyPrefix} className="list-decimal list-inside text-[13px] text-slate-700 dark:text-slate-300 mb-2 ml-4 space-y-0.5">
          {renderChildren()}
        </ol>
      );

    case "li":
    case "innodli":
      return <li key={keyPrefix}>{renderChildren()}</li>;

    // ── Tables ────────────────────────────────────────────────────────────────
    case "table":
    case "innodtable":
      return (
        <div key={keyPrefix} className="my-3 overflow-x-auto rounded border border-slate-200 dark:border-white/10">
          <table className="border-collapse text-[12px] w-full">
            {renderChildren()}
          </table>
        </div>
      );

    case "tr":
    case "innodtr":
      return <tr key={keyPrefix}>{renderChildren()}</tr>;

    case "th":
    case "innodth":
      return (
        <th key={keyPrefix} className="border border-slate-200 dark:border-white/10 px-2 py-1 font-semibold bg-slate-50 dark:bg-white/5 text-left">
          {renderChildren()}
        </th>
      );

    case "td":
    case "innodtd":
      return (
        <td key={keyPrefix} className="border border-slate-200 dark:border-white/10 px-2 py-1">
          {renderChildren()}
        </td>
      );

    // ── Fallback ──────────────────────────────────────────────────────────────
    default: {
      const kids = renderChildren();
      return kids.length > 0
        ? <React.Fragment key={keyPrefix}>{kids}</React.Fragment>
        : null;
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const XmlPreviewPanel = forwardRef<XmlPreviewHandle, Props>(function XmlPreviewPanel(
  { xmlText },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    scrollToFraction(fraction: number) {
      const el = scrollRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      el.scrollTop = Math.max(0, Math.min(1, fraction)) * max;
    },
  }), []);

  const content = useMemo<React.ReactNode>(() => {
    if (typeof window === "undefined" || !xmlText.trim()) return null;

    try {
      const doc   = new DOMParser().parseFromString(xmlText, "text/xml");
      const error = doc.querySelector("parseerror");

      if (error) {
        const msg = error.textContent?.split("\n")[0]?.trim() ?? "XML parse error";
        return (
          <p className="text-rose-400 text-[11px] font-mono bg-rose-500/8 rounded px-3 py-2 border border-rose-500/20">
            {msg}
          </p>
        );
      }

      return renderNode(doc.documentElement, "root");
    } catch (e) {
      return (
        <p className="text-rose-400 text-[11px] font-mono">
          Preview error: {String(e)}
        </p>
      );
    }
  }, [xmlText]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-white/8">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 h-8
        border-b border-slate-200 dark:border-white/8
        bg-slate-50 dark:bg-[#0d1525]">
        <svg className="w-3 h-3 text-violet-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          Live Preview
        </span>
        <span className="ml-auto text-[9px] text-slate-400 dark:text-slate-600 font-mono">
          updates as you type
        </span>
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-5 py-4
          scrollbar-thin scrollbar-track-transparent
          scrollbar-thumb-slate-200 dark:scrollbar-thumb-white/10">
        {content ?? (
          <p className="text-[12px] text-slate-400 dark:text-slate-600 italic mt-4">
            No content to preview
          </p>
        )}
      </div>
    </div>
  );
});

XmlPreviewPanel.displayName = "XmlPreviewPanel";
export default XmlPreviewPanel;
