"use client";
/**
 * PdfViewer — Image-based PDF viewer backed by the Python processing service.
 *
 * All PDF loading and rendering is handled server-side by PyMuPDF via the
 * GET /autocompare/pdf-page/{session_id}/{which}/{page_num} endpoint.
 * The frontend simply displays the returned PNG image — no pdfjs-dist required.
 *
 * Features
 * ────────
 * - Per-page PNG served by the Python backend (PyMuPDF)
 * - Page navigation controls (Prev / Next)
 * - targetPage prop scrolls to a specific 1-based page number
 * - highlightText / highlightKind forwarded to backend for server-side rendering
 * - Highlight banner shows what text is currently highlighted
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

interface PdfViewerProps {
  /** Session ID used to load the PDF from the backend. */
  sessionId: string | null;
  /** Which PDF to show: "old" or "new". */
  which: "old" | "new";
  /** Total page count for this PDF (supplied by the upload/session response). */
  totalPages: number;
  /** Label shown in the header, e.g. "Old PDF" or "New PDF" */
  label: string;
  /** Color accent: "blue" | "violet" */
  color?: "blue" | "violet";
  /** Page range for the selected chunk (1-indexed, for display only) */
  pageStart?: number;
  pageEnd?: number;
  /** 1-based target page to navigate when user selects a diff item */
  targetPage?: number;
  /** Text snippet to highlight within the rendered page (forwarded to backend) */
  highlightText?: string;
  /** Optional semantic type so highlight color matches diff panel categories */
  highlightKind?: "added" | "removed" | "modified";
  /** Optional multi-snippet highlights rendered by the backend on every page request. */
  highlightAddedTexts?: string[];
  highlightRemovedTexts?: string[];
  highlightModifiedTexts?: string[];
  /** Render mode: image (server-rendered PDF page) or text (pre-extracted chunk text). */
  mode?: "image" | "text";
  /** Pre-extracted text shown when mode="text". */
  textContent?: string;
  /** Optional synchronized scroll ratio shared across Old/New text panes (0..1). */
  syncScrollRatio?: number;
  /** Called whenever the local text pane scroll ratio changes. */
  onTextScrollRatioChange?: (ratio: number) => void;
  /** Show line numbers in text mode. */
  showLineNumbers?: boolean;
}

// ── Color maps ─────────────────────────────────────────────────────────────────

const COLOR_MAP = {
  blue: {
    border: "rgba(255,255,255,0.16)",
    bg: "rgba(255,255,255,0.03)",
    text: "text-slate-300",
    badge: "bg-white/10 text-slate-200 border-white/20",
  },
  violet: {
    border: "rgba(255,255,255,0.16)",
    bg: "rgba(255,255,255,0.03)",
    text: "text-slate-300",
    badge: "bg-white/10 text-slate-200 border-white/20",
  },
};

const HIGHLIGHT_KIND_MAP = {
  added: {
    border: "rgba(34,197,94,0.6)",
    shadow: "0 0 0 1px rgba(34,197,94,0.25), 0 0 16px rgba(34,197,94,0.10)",
    bannerBg: "rgba(34,197,94,0.05)",
    bannerBorder: "rgba(34,197,94,0.25)",
    bannerText:   "text-emerald-300",
    badge:        "Addition",
  },
  removed: {
    border: "rgba(244,114,182,0.6)",
    shadow: "0 0 0 1px rgba(244,114,182,0.25), 0 0 16px rgba(244,114,182,0.10)",
    bannerBg: "rgba(244,114,182,0.08)",
    bannerBorder: "rgba(244,114,182,0.30)",
    bannerText:   "text-pink-200",
    badge:        "Removal",
  },
  modified: {
    border: "rgba(217,70,239,0.6)",
    shadow: "0 0 0 1px rgba(217,70,239,0.25), 0 0 16px rgba(217,70,239,0.10)",
    bannerBg: "rgba(217,70,239,0.08)",
    bannerBorder: "rgba(217,70,239,0.30)",
    bannerText:   "text-fuchsia-300",
    badge:        "Modification",
  },
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function PdfViewer({
  sessionId,
  which,
  totalPages,
  label,
  color = "blue",
  pageStart,
  pageEnd,
  targetPage,
  highlightText,
  highlightKind,
  highlightAddedTexts,
  highlightRemovedTexts,
  highlightModifiedTexts,
  mode = "image",
  textContent,
  syncScrollRatio,
  onTextScrollRatioChange,
  showLineNumbers = false,
}: PdfViewerProps) {
  const styles = COLOR_MAP[color];
  const [currentPage, setCurrentPage] = useState(1);
  const [imgLoading, setImgLoading]   = useState(false);
  const [imgError,   setImgError]     = useState(false);
  const [expandedTextKey, setExpandedTextKey] = useState<string | null>(null);
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  const isApplyingSyncedScrollRef = useRef(false);
  const isTextMode = mode === "text";

  // ── Navigate to targetPage ─────────────────────────────────────────────────

  useEffect(() => {
    if (targetPage && targetPage >= 1 && totalPages > 0) {
      const nextPage = Math.min(targetPage, totalPages);
      const raf = requestAnimationFrame(() => {
        setCurrentPage(nextPage);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [targetPage, totalPages]);

  // Reset to page 1 when the session changes
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setCurrentPage(1);
      setImgError(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [sessionId, which]);

  // ── Build image URL ────────────────────────────────────────────────────────

  const pageUrl = useMemo(() => {
    if (isTextMode) return null;
    if (!sessionId || totalPages <= 0) return null;
    let url = `${BASE}/autocompare/pdf-page/${encodeURIComponent(sessionId)}/${which}/${currentPage}?scale=1.5`;

    // E: Keep query string small — 3 terms per kind, 128 chars max each.
    const MAX_TERMS_PER_KIND = 3;
    const MAX_TERM_LEN = 128;
    const MAX_TOTAL_CHARS = 600;
    let totalChars = 0;

    const pushTerms = (key: string, values?: string[]) => {
      if (!values || values.length === 0) return;
      const seen = new Set<string>();
      for (const raw of values) {
        const cleaned = (raw ?? "").trim();
        if (cleaned.length < 2) continue;
        const signature = cleaned.toLowerCase();
        if (seen.has(signature)) continue;
        if (seen.size >= MAX_TERMS_PER_KIND) break;
        const clipped = cleaned.slice(0, MAX_TERM_LEN);
        if (totalChars + clipped.length > MAX_TOTAL_CHARS) break;
        seen.add(signature);
        totalChars += clipped.length;
        url += `&${key}=${encodeURIComponent(clipped)}`;
      }
    };

    pushTerms("hl_added", highlightAddedTexts);
    pushTerms("hl_removed", highlightRemovedTexts);
    pushTerms("hl_modified", highlightModifiedTexts);

    if (highlightText && highlightText.trim().length >= 2 && totalChars < MAX_TOTAL_CHARS) {
      const clipped = highlightText.slice(0, MAX_TERM_LEN);
      url += `&hl_text=${encodeURIComponent(clipped)}`;
      if (highlightKind) url += `&hl_kind=${encodeURIComponent(highlightKind)}`;
    }
    const t = [
      currentPage,
      highlightKind || "",
      (highlightText || "").slice(0, 48),
      highlightAddedTexts?.length || 0,
      highlightRemovedTexts?.length || 0,
      highlightModifiedTexts?.length || 0,
    ].join(":");
    url += `&t=${encodeURIComponent(t)}`;
    return url;
  }, [
    isTextMode,
    sessionId,
    which,
    currentPage,
    highlightText,
    highlightKind,
    highlightAddedTexts,
    highlightRemovedTexts,
    highlightModifiedTexts,
    totalPages,
  ]);

  // I: Debounce the pageUrl by 150ms so rapid page flips don’t fire at every keystroke.
  const [debouncedPageUrl, setDebouncedPageUrl] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedPageUrl(pageUrl), 150);
    return () => clearTimeout(id);
  }, [pageUrl]);

  const pageLabel = useMemo(() => {
    if (pageStart == null) return null;
    return `Pages ${pageStart + 1}–${pageEnd ?? pageStart + 1}`;
  }, [pageStart, pageEnd]);

  const palette = highlightText && highlightKind ? HIGHLIGHT_KIND_MAP[highlightKind] : null;
  const MAX_TEXT_MODE_CHARS = 40_000;
  const textValue = textContent?.trim() || "";
  const textKey = `${which}:${textValue.length}:${textValue.slice(0, 64)}`;
  const showFullText = expandedTextKey === textKey;
  const textIsTruncated = textValue.length > MAX_TEXT_MODE_CHARS;
  const TEXT_INITIAL_VISIBLE_LINES = 60;
  const TEXT_LOAD_MORE_LINES = 80;
  const textPreview = textIsTruncated && !showFullText
    ? `${textValue.slice(0, MAX_TEXT_MODE_CHARS)}\n\n... truncated for performance ...`
    : textValue;

  type HighlightKindType = "added" | "removed" | "modified";
  type HighlightSpec = { term: string; kind: HighlightKindType };

  const highlightSpecs = useMemo<HighlightSpec[]>(() => {
    const specs: HighlightSpec[] = [];
    const seen = new Set<string>();
    const MAX_PER_KIND = 3;
    const MAX_TERM_LEN = 128;

    const pushKind = (kind: HighlightKindType, values?: string[]) => {
      if (!values?.length) return;
      let count = 0;
      for (const raw of values) {
        if (count >= MAX_PER_KIND) break;
        const t = (raw || "").trim();
        if (t.length < 2) continue;
        const clipped = t.slice(0, MAX_TERM_LEN);
        const key = `${kind}|${clipped.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        specs.push({ term: clipped, kind });
        count += 1;
      }
    };

    pushKind("added", highlightAddedTexts);
    pushKind("removed", highlightRemovedTexts);
    pushKind("modified", highlightModifiedTexts);

    if (highlightText && highlightKind) {
      const clipped = highlightText.slice(0, MAX_TERM_LEN).trim();
      const hk = highlightKind as HighlightKindType;
      const key = `${hk}|${clipped.toLowerCase()}`;
      if (clipped.length >= 2 && !seen.has(key)) {
        specs.push({ term: clipped, kind: hk });
      }
    }

    return specs;
  }, [
    highlightAddedTexts,
    highlightRemovedTexts,
    highlightModifiedTexts,
    highlightText,
    highlightKind,
  ]);

  const renderHighlightedLine = (line: string, lineKey: string) => {
    if (!line) return <span>&nbsp;</span>;
    if (highlightSpecs.length === 0) return <span>{line}</span>;

    // Hard caps to avoid pathological highlight scans freezing the UI.
    const MAX_LINE_LEN = 800;
    const MAX_MATCHES_PER_LINE = 12;
    const clippedLine = line.length > MAX_LINE_LEN ? `${line.slice(0, MAX_LINE_LEN)}...` : line;

    const lower = clippedLine.toLowerCase();
    const rawMatches: Array<{ start: number; end: number; kind: HighlightKindType }> = [];

    for (const spec of highlightSpecs) {
      if (rawMatches.length >= MAX_MATCHES_PER_LINE) break;
      const needle = spec.term.toLowerCase();
      if (!needle) continue;
      let from = 0;
      while (from < lower.length) {
        if (rawMatches.length >= MAX_MATCHES_PER_LINE) break;
        const idx = lower.indexOf(needle, from);
        if (idx < 0) break;
        rawMatches.push({ start: idx, end: idx + needle.length, kind: spec.kind });
        from = idx + Math.max(needle.length, 1);
      }
    }

    if (rawMatches.length === 0) return <span>{clippedLine}</span>;

    rawMatches.sort((a, b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)));

    const chosen: Array<{ start: number; end: number; kind: HighlightKindType }> = [];
    let cursor = -1;
    for (const m of rawMatches) {
      if (m.start < cursor) continue;
      chosen.push(m);
      cursor = m.end;
    }

    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (let i = 0; i < chosen.length; i++) {
      const m = chosen[i];
      if (m.start > pos) {
        nodes.push(<span key={`${lineKey}-plain-${i}`}>{clippedLine.slice(pos, m.start)}</span>);
      }
      const seg = clippedLine.slice(m.start, m.end);
      const style = m.kind === "added"
        ? {
            background: "rgba(34,197,94,0.28)",
            color: "#86efac",
            borderBottom: "2px solid #22c55e",
            borderRadius: "2px",
            padding: "0 2px",
          }
        : m.kind === "removed"
          ? {
              background: "rgba(239,68,68,0.22)",
              color: "#fca5a5",
              textDecoration: "line-through" as const,
              textDecorationColor: "#ef4444",
              borderBottom: "2px solid #ef4444",
              borderRadius: "2px",
              padding: "0 2px",
            }
          : {
              background: "rgba(251,191,36,0.22)",
              color: "#fde68a",
              borderBottom: "2px solid #f59e0b",
              borderRadius: "2px",
              padding: "0 2px",
            };
      nodes.push(
        <mark key={`${lineKey}-hl-${i}`} style={{ ...style, fontStyle: "normal" }}>
          {seg}
        </mark>,
      );
      pos = m.end;
    }
    if (pos < clippedLine.length) {
      nodes.push(<span key={`${lineKey}-tail`}>{clippedLine.slice(pos)}</span>);
    }
    return <>{nodes}</>;
  };

  const textLines = useMemo(() => textPreview.split("\n"), [textPreview]);
  const [textRenderState, setTextRenderState] = useState({
    key: textKey,
    count: TEXT_INITIAL_VISIBLE_LINES,
  });
  const visibleTextLines = textRenderState.key === textKey
    ? textRenderState.count
    : TEXT_INITIAL_VISIBLE_LINES;
  const shownTextLines = useMemo(
    () => textLines.slice(0, visibleTextLines),
    [textLines, visibleTextLines],
  );

  useEffect(() => {
    if (!isTextMode) return;
    if (syncScrollRatio == null) return;
    const el = textContainerRef.current;
    if (!el) return;
    const max = Math.max(el.scrollHeight - el.clientHeight, 0);
    const nextTop = Math.max(0, Math.min(max, max * syncScrollRatio));
    if (Math.abs(el.scrollTop - nextTop) < 2) return;
    isApplyingSyncedScrollRef.current = true;
    el.scrollTop = nextTop;
    requestAnimationFrame(() => {
      isApplyingSyncedScrollRef.current = false;
    });
  }, [isTextMode, syncScrollRatio, textLines.length]);

  const handleTextScroll = () => {
    if (!isTextMode) return;
    if (isApplyingSyncedScrollRef.current) return;
    if (!onTextScrollRatioChange) return;
    const el = textContainerRef.current;
    if (!el) return;
    const max = Math.max(el.scrollHeight - el.clientHeight, 1);
    onTextScrollRatioChange(el.scrollTop / max);
  };

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{
        borderColor: highlightText
          ? (palette?.border ?? "rgba(250,204,21,0.6)")
          : styles.border,
        background: "rgba(6,13,26,0.6)",
        boxShadow: highlightText
          ? (palette?.shadow ?? "0 0 0 1px rgba(250,204,21,0.25), 0 0 16px rgba(250,204,21,0.08)")
          : "none",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: styles.border, background: styles.bg }}
      >
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${styles.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-semibold text-white">{label}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {pageLabel && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${styles.badge}`}>
              {pageLabel}
            </span>
          )}
          {totalPages > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium border-cyan-500/35 bg-cyan-500/10 text-cyan-200">
              p.{currentPage}/{totalPages}
            </span>
          )}
        </div>
      </div>

      {/* Highlight legend — shown in text mode when highlights are active */}
      {isTextMode && highlightSpecs.length > 0 && (
        <div
          className="flex-shrink-0 flex items-center gap-3 px-3 py-1.5 border-b text-[10px] flex-wrap"
          style={{ borderColor: styles.border, background: "rgba(0,0,0,0.25)" }}
        >
          <span className="text-slate-500 font-medium uppercase tracking-wide">Highlights:</span>
          {highlightSpecs.some((s) => s.kind === "added") && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: "rgba(34,197,94,0.28)", borderBottom: "2px solid #22c55e" }}
              />
              <span style={{ color: "#86efac" }}>Added</span>
            </span>
          )}
          {highlightSpecs.some((s) => s.kind === "removed") && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: "rgba(239,68,68,0.22)", borderBottom: "2px solid #ef4444" }}
              />
              <span style={{ color: "#fca5a5" }}>Removed</span>
            </span>
          )}
          {highlightSpecs.some((s) => s.kind === "modified") && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: "rgba(251,191,36,0.22)", borderBottom: "2px solid #f59e0b" }}
              />
              <span style={{ color: "#fde68a" }}>Modified</span>
            </span>
          )}
          <span className="ml-auto text-slate-600">{highlightSpecs.length} term{highlightSpecs.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      {/* Highlight banner (selected diff line) */}
      {highlightText && (
        <div
          className="px-3 py-1.5 border-b text-[10px] flex items-center gap-1.5"
          style={{
            borderColor: palette?.bannerBorder ?? "rgba(250,204,21,0.25)",
            background:  palette?.bannerBg    ?? "rgba(250,204,21,0.05)",
          }}
        >
          <span
            className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: palette?.bannerBorder ?? "rgba(250,204,21,0.15)",
              color: "#fde68a",
            }}
          >
            {palette?.badge ?? "FOCUS"}
          </span>
          <span className={`${palette?.bannerText ?? "text-yellow-300"} truncate font-mono`}>
            {highlightText.slice(0, 120)}
          </span>
        </div>
      )}

      {/* Page image body */}
      <div className="flex-1 overflow-auto" style={{ background: "#18181b" }}>
        {isTextMode ? (
          <div
            ref={textContainerRef}
            onScroll={handleTextScroll}
            className="h-full overflow-auto px-3 py-2.5 bg-[#0f1115] text-[#e5e7eb]"
          >
            {textPreview ? (
              <div className="font-mono text-[11px] leading-relaxed">
                {shownTextLines.map((line, idx) => (
                  <div key={`line-${idx}`} className="flex items-start">
                    {showLineNumbers && (
                      <span className="w-10 pr-2 text-right select-none text-slate-500 flex-shrink-0">
                        {idx + 1}
                      </span>
                    )}
                    <span className="flex-1 whitespace-pre-wrap break-words">
                      {renderHighlightedLine(line, `line-${idx}`)}
                    </span>
                  </div>
                ))}
                {shownTextLines.length < textLines.length && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-[10px] text-slate-300">
                      Showing {shownTextLines.length.toLocaleString()} / {textLines.length.toLocaleString()} lines.
                    </p>
                    <button
                      type="button"
                      onClick={() => setTextRenderState({ key: textKey, count: visibleTextLines + TEXT_LOAD_MORE_LINES })}
                      className="text-[10px] px-2 py-0.5 rounded border border-white/20 text-slate-200 hover:bg-white/10"
                    >
                      Load more lines
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="font-mono text-[11px]">No extracted text available</p>
            )}
            {textIsTruncated && !showFullText && (
              <div className="mt-2 flex items-center gap-2">
                <p className="text-[10px] text-slate-300">
                  Showing first {MAX_TEXT_MODE_CHARS.toLocaleString()} characters for responsiveness.
                </p>
                <button
                  type="button"
                  onClick={() => setExpandedTextKey(textKey)}
                  className="text-[10px] px-2 py-0.5 rounded border border-white/20 text-slate-200 hover:bg-white/10"
                >
                  Show full text
                </button>
              </div>
            )}
          </div>
        ) : !sessionId || totalPages <= 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-xs">No PDF loaded</p>
          </div>
        ) : imgError ? (
          <div className="flex items-center justify-center h-full text-xs text-red-300 p-4 text-center">
            Failed to load page {currentPage}. The session may have expired.
          </div>
        ) : (
          <div className="relative min-w-full">
            {imgLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#18181b]/80 z-10">
                <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
              </div>
            )}
            {debouncedPageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={debouncedPageUrl}
                src={debouncedPageUrl}
                alt={`${label} — page ${currentPage}`}
                className="block max-w-full"
                onLoadStart={() => { setImgLoading(true); setImgError(false); }}
                onLoad={() => setImgLoading(false)}
                onError={() => { setImgLoading(false); setImgError(true); }}
              />
            )}
          </div>
        )}
      </div>

      {/* Page navigation */}
      {!isTextMode && totalPages > 1 && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t"
          style={{ borderColor: styles.border, background: "rgba(0,0,0,0.2)" }}
        >
          <button
            onClick={() => { setCurrentPage((p) => Math.max(1, p - 1)); setImgError(false); }}
            disabled={currentPage <= 1}
            className="text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 disabled:opacity-30 hover:border-slate-400 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-[10px] text-slate-400">Page {currentPage} of {totalPages}</span>
          <button
            onClick={() => { setCurrentPage((p) => Math.min(totalPages, p + 1)); setImgError(false); }}
            disabled={currentPage >= totalPages}
            className="text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 disabled:opacity-30 hover:border-slate-400 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}