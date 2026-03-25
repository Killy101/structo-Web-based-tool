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

import React, { useEffect, useMemo, useState } from "react";

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
}

// ── Color maps ─────────────────────────────────────────────────────────────────

const COLOR_MAP = {
  blue: {
    border: "rgba(59,130,246,0.3)",
    bg: "rgba(59,130,246,0.05)",
    text: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  },
  violet: {
    border: "rgba(139,92,246,0.3)",
    bg: "rgba(139,92,246,0.05)",
    text: "text-violet-400",
    badge: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  },
};

const HIGHLIGHT_KIND_MAP = {
  added: {
    border: "rgba(34,197,94,0.6)",
    shadow: "0 0 0 1px rgba(34,197,94,0.25), 0 0 16px rgba(34,197,94,0.10)",
    bannerBg: "rgba(34,197,94,0.05)",
    bannerBorder: "rgba(34,197,94,0.25)",
    bannerText: "text-emerald-300",
    badge: "Addition",
  },
  removed: {
    border: "rgba(239,68,68,0.6)",
    shadow: "0 0 0 1px rgba(239,68,68,0.25), 0 0 16px rgba(239,68,68,0.10)",
    bannerBg: "rgba(239,68,68,0.05)",
    bannerBorder: "rgba(239,68,68,0.25)",
    bannerText: "text-red-300",
    badge: "Removal",
  },
  modified: {
    border: "rgba(245,158,11,0.6)",
    shadow: "0 0 0 1px rgba(245,158,11,0.25), 0 0 16px rgba(245,158,11,0.10)",
    bannerBg: "rgba(245,158,11,0.05)",
    bannerBorder: "rgba(245,158,11,0.25)",
    bannerText: "text-amber-300",
    badge: "Modification",
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
}: PdfViewerProps) {
  const styles = COLOR_MAP[color];

  const [currentPage, setCurrentPage] = useState(1);
  const [imgLoading, setImgLoading]   = useState(false);
  const [imgError,   setImgError]     = useState(false);

  // ── Navigate to targetPage ─────────────────────────────────────────────────

  useEffect(() => {
    if (targetPage && targetPage >= 1 && totalPages > 0) {
      setCurrentPage(Math.min(targetPage, totalPages));
    }
  }, [targetPage, totalPages]);

  // Reset to page 1 when the session changes
  useEffect(() => {
    setCurrentPage(1);
    setImgError(false);
  }, [sessionId, which]);

  // ── Build image URL ────────────────────────────────────────────────────────

  const pageUrl = useMemo(() => {
    if (!sessionId || totalPages <= 0) return null;
    let url = `${BASE}/autocompare/pdf-page/${encodeURIComponent(sessionId)}/${which}/${currentPage}?scale=1.5`;
    if (highlightText && highlightText.trim().length >= 2) {
      url += `&hl_text=${encodeURIComponent(highlightText.slice(0, 300))}`;
      if (highlightKind) url += `&hl_kind=${encodeURIComponent(highlightKind)}`;
    }
    return url;
  }, [sessionId, which, currentPage, highlightText, highlightKind, totalPages]);

  const pageLabel = useMemo(() => {
    if (pageStart == null) return null;
    return `Pages ${pageStart + 1}–${pageEnd ?? pageStart + 1}`;
  }, [pageStart, pageEnd]);

  const palette = highlightText && highlightKind ? HIGHLIGHT_KIND_MAP[highlightKind] : null;

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{
        borderColor: highlightText ? (palette?.border ?? "rgba(250,204,21,0.6)") : styles.border,
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

      {/* Highlight banner */}
      {highlightText && (
        <div
          className="px-3 py-1.5 border-b text-[10px] flex items-center gap-1.5"
          style={{
            borderColor: palette?.bannerBorder ?? "rgba(250,204,21,0.25)",
            background:  palette?.bannerBg    ?? "rgba(250,204,21,0.05)",
          }}
        >
          <span className={`${palette?.bannerText ?? "text-yellow-400"} flex-shrink-0`}>
            ⚡ {palette?.badge ? `${palette.badge}:` : "Highlighted:"}
          </span>
          <span className="text-slate-200 truncate">{highlightText.slice(0, 150)}</span>
        </div>
      )}

      {/* Page image body */}
      <div className="flex-1 overflow-auto" style={{ background: "#18181b" }}>
        {!sessionId || totalPages <= 0 ? (
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
            {pageUrl && (
              <img
                key={pageUrl}
                src={pageUrl}
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
      {totalPages > 1 && (
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
