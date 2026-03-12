"use client";
/**
 * PdfViewer — Embedded PDF viewer using the browser's native rendering.
 *
 * For production consider adding @react-pdf-viewer/core or pdfjs-dist for
 * richer controls.  This native implementation works out-of-the-box without
 * additional npm packages and supports all modern browsers.
 *
 * Features
 * ────────
 * - Native browser PDF rendering via <object> / <embed>
 * - Blob URL created from File object (zero server round-trip)
 * - Shows extracted text snippet below the viewer for context
 * - Highlighted text panel showing relevant page range for the selected chunk
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

interface PdfViewerProps {
  /** PDF File object to display */
  file: File | null;
  /** Label shown in the header, e.g. "Old PDF" or "New PDF" */
  label: string;
  /** Color accent: "blue" | "violet" */
  color?: "blue" | "violet";
  /** Extracted text excerpt for the selected chunk (shown in text panel) */
  textExcerpt?: string;
  /** Page range for the selected chunk (1-indexed, for display only) */
  pageStart?: number;
  pageEnd?: number;
}

// ── Color maps ─────────────────────────────────────────────────────────────────

const COLOR_MAP = {
  blue:   { border: "rgba(59,130,246,0.3)", bg: "rgba(59,130,246,0.05)", text: "text-blue-400",   badge: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  violet: { border: "rgba(139,92,246,0.3)", bg: "rgba(139,92,246,0.05)", text: "text-violet-400", badge: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function PdfViewer({
  file,
  label,
  color = "blue",
  textExcerpt,
  pageStart,
  pageEnd,
}: PdfViewerProps) {
  const [blobUrl,  setBlobUrl]  = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const prevUrl = useRef<string | null>(null);

  const styles = COLOR_MAP[color];

  // Create a blob URL for the file so <object> can render it
  useEffect(() => {
    if (prevUrl.current) {
      URL.revokeObjectURL(prevUrl.current);
      prevUrl.current = null;
    }

    if (!file) {
      setBlobUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    prevUrl.current = url;
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
      prevUrl.current = null;
    };
  }, [file]);

  const pageLabel = useMemo(() => {
    if (pageStart == null) return null;
    return `Pages ${pageStart + 1}–${pageEnd ?? pageStart + 1}`;
  }, [pageStart, pageEnd]);

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{ borderColor: styles.border, background: "rgba(6,13,26,0.6)" }}
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
          {file && (
            <span className="text-[10px] text-slate-400 truncate max-w-[100px]">{file.name}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {pageLabel && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${styles.badge}`}>
              {pageLabel}
            </span>
          )}
          {textExcerpt && (
            <button
              onClick={() => setShowText((v) => !v)}
              title={showText ? "Show PDF" : "Show text"}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/40 transition-colors"
            >
              {showText ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {!file ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-xs">No PDF loaded</p>
          </div>
        ) : showText && textExcerpt ? (
          /* Text excerpt view */
          <div className="h-full overflow-y-auto p-3">
            <pre className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">
              {textExcerpt}
            </pre>
          </div>
        ) : (
          /* Native PDF render */
          blobUrl && (
            <object
              data={blobUrl}
              type="application/pdf"
              className="w-full h-full"
              title={label}
            >
              {/* Fallback for browsers that don't render PDFs inline */}
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 p-4">
                <p className="text-xs text-center">
                  Your browser cannot display this PDF inline.
                </p>
                <a
                  href={blobUrl}
                  download={file?.name}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                >
                  Download PDF
                </a>
              </div>
            </object>
          )
        )}
      </div>
    </div>
  );
}
