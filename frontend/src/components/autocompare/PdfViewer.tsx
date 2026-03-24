"use client";
/**
 * PdfViewer — Canvas-based PDF viewer using pdfjs-dist.
 *
 * Features
 * ────────
 * - PDF rendered per-page on a <canvas> element via pdfjs-dist
 * - Overlay canvas draws yellow highlight boxes over matching text when
 *   highlightText prop is set
 * - Page navigation controls
 * - targetPage prop navigates to a specific 1-based page number
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PdfViewerProps {
  /** PDF File object to display */
  file: File | null;
  /**
   * Fallback URL to load the PDF from when `file` is null.
   * Used when a session is restored from localStorage (File objects are
   * not serialisable) — the browser fetches the PDF from the backend.
   */
  src?: string;
  /** Label shown in the header, e.g. "Old PDF" or "New PDF" */
  label: string;
  /** Color accent: "blue" | "violet" */
  color?: "blue" | "violet";
  /** Page range for the selected chunk (1-indexed, for display only) */
  pageStart?: number;
  pageEnd?: number;
  /** 1-based target page to navigate when user selects a diff item */
  targetPage?: number;
  /** Text snippet to highlight within the rendered page */
  highlightText?: string;
  /** Optional semantic type so highlight color matches diff panel categories */
  highlightKind?: "added" | "removed" | "modified";
  /** Optional list of diff-derived highlights for this chunk (ILovePDF-style view). */
  highlightEntries?: Array<{
    text: string;
    kind: "added" | "removed" | "modified";
    page?: number | null;
  }>;
}

type StoredTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

// ── Color maps ─────────────────────────────────────────────────────────────────

const COLOR_MAP = {
  blue: {
    border: "rgba(59,130,246,0.3)",
    bg: "rgba(59,130,246,0.05)",
    text: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    highlightFill: "rgba(59,130,246,0.35)",
    highlightStroke: "rgba(147,197,253,0.95)",
  },
  violet: {
    border: "rgba(139,92,246,0.3)",
    bg: "rgba(139,92,246,0.05)",
    text: "text-violet-400",
    badge: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    highlightFill: "rgba(139,92,246,0.35)",
    highlightStroke: "rgba(196,181,253,0.95)",
  },
};

const HIGHLIGHT_KIND_MAP = {
  added: {
    fill: "rgba(34,197,94,0.35)",
    stroke: "rgba(134,239,172,0.95)",
    border: "rgba(34,197,94,0.6)",
    shadow: "0 0 0 1px rgba(34,197,94,0.25), 0 0 16px rgba(34,197,94,0.10)",
    bannerBg: "rgba(34,197,94,0.05)",
    bannerBorder: "rgba(34,197,94,0.25)",
    bannerText: "text-emerald-300",
    badge: "Addition",
  },
  removed: {
    fill: "rgba(239,68,68,0.35)",
    stroke: "rgba(252,165,165,0.95)",
    border: "rgba(239,68,68,0.6)",
    shadow: "0 0 0 1px rgba(239,68,68,0.25), 0 0 16px rgba(239,68,68,0.10)",
    bannerBg: "rgba(239,68,68,0.05)",
    bannerBorder: "rgba(239,68,68,0.25)",
    bannerText: "text-red-300",
    badge: "Removal",
  },
  modified: {
    fill: "rgba(245,158,11,0.35)",
    stroke: "rgba(252,211,77,0.95)",
    border: "rgba(245,158,11,0.6)",
    shadow: "0 0 0 1px rgba(245,158,11,0.25), 0 0 16px rgba(245,158,11,0.10)",
    bannerBg: "rgba(245,158,11,0.05)",
    bannerBorder: "rgba(245,158,11,0.25)",
    bannerText: "text-amber-300",
    badge: "Modification",
  },
} as const;

// Singleton flag — worker URL is set once for the entire app lifetime
let pdfjsWorkerConfigured = false;

// ── Component ─────────────────────────────────────────────────────────────────

export default function PdfViewer({
  file,
  src,
  label,
  color = "blue",
  pageStart,
  pageEnd,
  targetPage,
  highlightText,
  highlightKind,
  highlightEntries,
}: PdfViewerProps) {
  const styles = COLOR_MAP[color];
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewportRef  = useRef<any>(null);
  const textItemsRef = useRef<StoredTextItem[]>([]);

  // Keep latest highlightText in a ref so async effects don't go stale
  const highlightTextRef = useRef(highlightText ?? "");
  highlightTextRef.current = highlightText ?? "";

  const [pdfLoaded,   setPdfLoaded]   = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages,  setTotalPages]  = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState<string | null>(null);

  // ── Load PDF from File ─────────────────────────────────────────────────────

useEffect(() => {
  // Destroy previous document
  if (pdfDocRef.current) {
    pdfDocRef.current.destroy();
    pdfDocRef.current = null;
  }

  setPdfLoaded(false);
  textItemsRef.current = [];
  viewportRef.current = null;

  // Nothing to load when neither a File nor a URL is provided
  if (!file && !src) {
    setTotalPages(0);
    setCurrentPage(1);
    setLoadError(null);
    return;
  }

  let cancelled = false;
  setLoading(true);
  setLoadError(null);

  (async () => {
    try {
      const pdfjs = await import("pdfjs-dist");
      const { getDocument, GlobalWorkerOptions } = pdfjs;

      if (!pdfjsWorkerConfigured) {
        GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        pdfjsWorkerConfigured = true;
      }

      // Load from File object when available (fresh upload), otherwise
      // load from URL (session restored from localStorage).
      const pdf = file
        ? await getDocument({ data: await file.arrayBuffer() }).promise
        : await getDocument({ url: src! }).promise;

      if (cancelled) {
        pdf.destroy();
        return;
      }

      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setPdfLoaded(true);
    } catch (e) {
      if (!cancelled)
        setLoadError(e instanceof Error ? e.message : "Failed to load PDF");
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [file, src]);
  // ── Navigate to targetPage ─────────────────────────────────────────────────

  useEffect(() => {
    if (targetPage && targetPage >= 1 && totalPages > 0) {
      setCurrentPage(Math.min(targetPage, totalPages));
    }
  }, [targetPage, totalPages]);

  // ── Draw highlight overlay ─────────────────────────────────────────────────

  const drawHighlights = useCallback((searchText: string) => {
    const overlay  = overlayRef.current;
    const canvas   = canvasRef.current;
    const viewport = viewportRef.current;
    if (!overlay || !canvas || !viewport) return;

    // Resizing the overlay canvas also clears it
    overlay.width  = canvas.width;
    overlay.height = canvas.height;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    const norm  = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const drawByText = (
      text: string,
      kind: "added" | "removed" | "modified" | null,
      strong = false,
    ) => {
      if (!text || text.length < 2) return;
      const query = norm(text);
      const words = (query.match(/[a-z0-9][a-z0-9'\-/]{2,}/g) ?? []).slice(0, 12);
      if (words.length === 0 && query.length < 3) return;

      const palette = kind ? HIGHLIGHT_KIND_MAP[kind] : null;

      for (const item of textItemsRef.current) {
        if (!item.str.trim() || item.width <= 0) continue;
        const itemNorm = norm(item.str);
        const isMatch =
          words.some((w) => itemNorm.includes(w)) ||
          (query.length > 8 && itemNorm.includes(query.slice(0, 20)));

        if (!isMatch) continue;

        const [vx, vy] = viewport.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        ) as [number, number];

        const w = item.width;
        const h = Math.max(item.height, 8);

        ctx.fillStyle   = palette?.fill ?? styles.highlightFill;
        ctx.strokeStyle = palette?.stroke ?? styles.highlightStroke;
        ctx.lineWidth   = strong ? 1.6 : 1;
        ctx.fillRect  (vx, vy - h, w, h + 2);
        ctx.strokeRect(vx, vy - h, w, h + 2);
      }
    };

    // First pass: draw all chunk-level diff highlights (subtle but complete)
    for (const entry of highlightEntries ?? []) {
      if (!entry?.text?.trim()) continue;
      if (entry.page && entry.page !== currentPage) continue;
      drawByText(entry.text, entry.kind, false);
    }

    // Second pass: draw selected line highlight stronger on top
    if (searchText && searchText.length >= 2) {
      drawByText(searchText, highlightKind ?? null, true);
    }
  }, [
    styles.highlightFill,
    styles.highlightStroke,
    highlightKind,
    highlightEntries,
    currentPage,
  ]);

  // ── Render current page ────────────────────────────────────────────────────

  useEffect(() => {
    if (!pdfLoaded || !pdfDocRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const pdf  = pdfDocRef.current;
        const page = await pdf.getPage(currentPage);
        if (cancelled) { page.cleanup(); return; }

        const containerW = containerRef.current?.clientWidth || 800;
        const base       = page.getViewport({ scale: 1 });
        const scale      = Math.min((containerW - 8) / base.width, 2.5);
        const viewport   = page.getViewport({ scale });

        const canvas = canvasRef.current!;
        canvas.width  = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) { page.cleanup(); return; }

        viewportRef.current = viewport;

        // Extract text items for highlighting
        const tc = await page.getTextContent();
        if (!cancelled) {
          textItemsRef.current = tc.items
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((it: any) => "str" in it && it.str.trim() && it.width > 0)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((it: any) => ({
              str:       it.str       as string,
              transform: it.transform as number[],
              width:     it.width     as number,
              height:    it.height    as number,
            }));
        }

        page.cleanup();

        // Draw highlights using the latest highlight text
        if (!cancelled) drawHighlights(highlightTextRef.current);
      } catch (e) {
        if (!cancelled) console.error("[PdfViewer] render error:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [pdfLoaded, currentPage, drawHighlights]);

  // ── Re-draw highlights when highlightText changes ─────────────────────────

  useEffect(() => {
    if (pdfLoaded && textItemsRef.current.length > 0) {
      drawHighlights(highlightText ?? "");
    }
  }, [highlightText, highlightEntries, drawHighlights, pdfLoaded]);

  const pageLabel = useMemo(() => {
    if (pageStart == null) return null;
    return `Pages ${pageStart + 1}–${pageEnd ?? pageStart + 1}`;
  }, [pageStart, pageEnd]);

  const palette = highlightKind ? HIGHLIGHT_KIND_MAP[highlightKind] : null;

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
            background: palette?.bannerBg ?? "rgba(250,204,21,0.05)",
          }}
        >
          <span className={`${palette?.bannerText ?? "text-yellow-400"} flex-shrink-0`}>
            ⚡ {palette?.badge ? `${palette.badge}:` : "Highlighted:"}
          </span>
          <span className="text-slate-200 truncate">{highlightText.slice(0, 150)}</span>
        </div>
      )}

      {/* Canvas body */}
      <div ref={containerRef} className="flex-1 overflow-auto" style={{ background: "#18181b" }}>
        {!file && !src ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-xs">No PDF loaded</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-slate-400">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-[#1a8fd1] animate-spin" />
            <span className="text-xs">Loading PDF…</span>
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center h-full text-xs text-red-300 p-4 text-center">
            {loadError}
          </div>
        ) : (
          /* Canvas + overlay */
          <div className="relative inline-block min-w-full">
            <canvas ref={canvasRef} className="block max-w-full" />
            <canvas
              ref={overlayRef}
              className="absolute top-0 left-0 pointer-events-none"
              style={{ mixBlendMode: "multiply" }}
            />
          </div>
        )}
      </div>

      {/* Page navigation */}
      {totalPages > 1 && !loading && !loadError && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t"
          style={{ borderColor: styles.border, background: "rgba(0,0,0,0.2)" }}
        >
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 disabled:opacity-30 hover:border-slate-400 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-[10px] text-slate-400">Page {currentPage} of {totalPages}</span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
