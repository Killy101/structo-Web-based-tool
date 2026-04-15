"use client";
// ─────────────────────────────────────────────────────────────────────────────
// DiffPane.tsx
// Renders one side (old / new) of the side-by-side PDF text diff.
//
// Performance strategy
// ────────────────────
//  • Full node tree built once via useMemo (can be 5k–50k spans for large docs).
//  • Active-chunk highlight applied via a tiny injected <style> rule so only
//    a CSS string regenerates on each selection — NOT the full node tree.
//  • content-visibility:auto on each line div gives near-virtual-scroll
//    performance without a JS virtualization library.
// ─────────────────────────────────────────────────────────────────────────────

import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useTheme } from "../../context/ThemContext";
import type { Chunk, ChunkKind, DiffPaneHandle, PaneData, TagConfig } from "./types";
import { KIND_META } from "./types";

interface Props {
  pane:          PaneData;
  chunks:        Chunk[];
  activeChunkId: number | null;
  filename:      string;
  side:          "a" | "b";
  onChunkClick?: (chunkId: number) => void;
  onScrollFraction?: (scrollFraction: number) => void;
}

// ── Dark-mode colour maps for backend's light pastel highlights ───────────────

const DARK_BG_MAP: Record<string, string> = {
  "#ccffd8": "rgba(16,185,129,0.22)",   // ADD → teal
  "#ffd7d5": "rgba(244,63,94,0.22)",    // DEL → rose
  "#fff3b0": "rgba(245,158,11,0.22)",   // MOD → amber
  "#ead8ff": "rgba(139,92,246,0.22)",   // EMP → violet
};
const DARK_FG_MAP: Record<string, string> = {
  "#1a4d2e": "#6ee7b7",   // ADD fg
  "#6e1c1a": "#fda4af",   // DEL fg
  "#5a3e00": "#fcd34d",   // MOD fg
  "#3d007a": "#c4b5fd",   // EMP fg
};

function tagToStyle(cfg: TagConfig, dark: boolean): React.CSSProperties {
  const s: React.CSSProperties = {};

  if (cfg.background)
    s.backgroundColor = dark ? (DARK_BG_MAP[cfg.background.toLowerCase()] ?? cfg.background) : cfg.background;
  if (cfg.foreground)
    s.color = dark ? (DARK_FG_MAP[cfg.foreground.toLowerCase()] ?? cfg.foreground) : cfg.foreground;
  if (cfg.font) {
    if (cfg.font.style.includes("bold"))   s.fontWeight = "bold";
    if (cfg.font.style.includes("italic")) s.fontStyle  = "italic";
  }

  // Keep comparison readable: changes are indicated by background highlight only.
  // Ignore text decorations from source tags (underline / line-through).

  return s;
}

// ── Line segment type ─────────────────────────────────────────────────────────

interface LineSeg {
  text:    string;
  tagName: string;
  chunkId: number | null;
}

function buildLines(pane: PaneData): LineSeg[][] {
  const { segments, offsets, offset_ends } = pane;

  const ranges = Object.entries(offsets)
    .map(([cid, start]) => ({ id: Number(cid), start, end: offset_ends[cid] ?? start + 999_999 }))
    .sort((a, b) => a.start - b.start);

  const lines: LineSeg[][] = [[]];
  let pos = 0;
  let ri  = 0;

  for (const [text, tagName] of segments) {
    while (ri < ranges.length && ranges[ri].end <= pos) ri++;
    const chunkId = (ri < ranges.length && pos >= ranges[ri].start && pos < ranges[ri].end)
      ? ranges[ri].id : null;

    if (text === "\n") lines.push([]);
    else               lines[lines.length - 1].push({ text, tagName, chunkId });
    pos += text.length;
  }

  return lines;
}

// ── Component ─────────────────────────────────────────────────────────────────

const DiffPane = forwardRef<DiffPaneHandle, Props>(
  ({ pane, chunks, activeChunkId, filename, side, onChunkClick, onScrollFraction }, ref) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const syncingRef = useRef(false);
    const { dark }  = useTheme();

    // ── Imperative scroll handle ──────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      scrollToChunk(chunkId, orderedIds, scrollFraction) {
        const container = scrollRef.current;
        if (!container) return;

        // 1. Exact element match
        const el = container.querySelector(`[data-chunk-id="${chunkId}"]`) as HTMLElement | null;
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }

        // 2. Proportional scroll from the other pane
        if (scrollFraction !== undefined) {
          const max = container.scrollHeight - container.clientHeight;
          if (max > 0) { container.scrollTo({ top: scrollFraction * max, behavior: "smooth" }); return; }
        }

        // 3. Nearest-neighbour fallback
        if (!orderedIds) return;
        const idx = orderedIds.indexOf(chunkId);
        if (idx < 0) return;
        for (let dist = 1; dist < orderedIds.length; dist++) {
          for (const d of [-dist, dist]) {
            const ni = idx + d;
            if (ni < 0 || ni >= orderedIds.length) continue;
            const nb = container.querySelector(`[data-chunk-id="${orderedIds[ni]}"]`) as HTMLElement | null;
            if (nb) { nb.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
          }
        }
      },
      scrollToFraction(scrollFraction) {
        const container = scrollRef.current;
        if (!container) return;
        const max = container.scrollHeight - container.clientHeight;
        if (max <= 0) return;
        syncingRef.current = true;
        container.scrollTo({ top: Math.max(0, Math.min(1, scrollFraction)) * max, behavior: "auto" });
        requestAnimationFrame(() => { syncingRef.current = false; });
      },
    }), []);

    // ── Derived data ──────────────────────────────────────────────────────────

    const lines    = useMemo(() => buildLines(pane), [pane]);
    const kindMap  = useMemo(() => {
      const m = new Map<number, ChunkKind>();
      for (const c of chunks) m.set(c.id, c.kind);
      return m;
    }, [chunks]);
    const tagStyles = useMemo(() => {
      const m: Record<string, React.CSSProperties> = {};
      for (const [name, cfg] of Object.entries(pane.tag_cfgs))
        m[name] = tagToStyle(cfg, dark);
      return m;
    }, [pane.tag_cfgs, dark]);

    // ── Pre-built node tree (heavy — activeChunkId intentionally excluded) ────
    // The active highlight is applied via CSS injection (see below) so we never
    // rebuild this tree on chunk selection changes.
    const renderedNodes = useMemo(() => lines.map((segs, li) => (
      <div key={li} className="flex" style={{ contentVisibility: "auto", containIntrinsicHeight: "auto 1.6em" }}>
        <span
          className="w-10 pr-2 text-right select-none text-slate-400 dark:text-slate-600"
          aria-hidden="true"
        >
          {li + 1}
        </span>
        <span className="flex-1 min-w-0">
          {segs.map((seg, si) => {
          const baseStyle = tagStyles[seg.tagName] ?? {};
          const kind = seg.chunkId !== null ? kindMap.get(seg.chunkId) : null;
          const isUnchanged = seg.chunkId === null || kind === "emp";
          const style = isUnchanged
            ? { ...baseStyle, color: undefined, textDecoration: undefined }
            : baseStyle;

          const clickableStyle = seg.chunkId !== null && onChunkClick
            ? { ...style, cursor: "pointer" as const }
            : style;

            return seg.chunkId !== null
              ? <span key={si} style={clickableStyle} data-chunk-id={String(seg.chunkId)}>{seg.text}</span>
              : <span key={si} style={style}>{seg.text}</span>;
          })}
        </span>
      </div>
    )), [lines, tagStyles, kindMap, onChunkClick]);

    // ── Active-chunk CSS injection (only a tiny string regenerates per click) ─
    const activeCSS = useMemo(() => {
      if (activeChunkId === null) return "";
      const kind = kindMap.get(activeChunkId);
      if (!kind) return "";
      const m = KIND_META[kind];
      return (
        `[data-chunk-id="${activeChunkId}"] {` +
        ` background-color: ${m.highlightBg} !important;` +
        ` border-radius: 2px;` +
        ` outline: 2px solid ${m.highlightBorder};` +
        ` outline-offset: 0px; }`
      );
    }, [activeChunkId, kindMap]);

    // ── Render ────────────────────────────────────────────────────────────────

    const sideBadgeCls = side === "a"
      ? "bg-rose-600 text-white"
      : "bg-emerald-600 text-white";

    const handleChunkClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onChunkClick) return;
      const target = e.target as HTMLElement;
      const el = target.closest("[data-chunk-id]") as HTMLElement | null;
      if (!el) return;
      const raw = el.getAttribute("data-chunk-id");
      if (!raw) return;
      const id = Number(raw);
      if (!Number.isFinite(id)) return;
      onChunkClick(id);
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (!onScrollFraction || syncingRef.current) return;
      const el = e.currentTarget;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      onScrollFraction(el.scrollTop / max);
    };

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded ${sideBadgeCls}`}>
            {side === "a" ? "OLD" : "NEW"}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
            {filename}
          </span>
        </div>

        {/* Scrollable text body */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onClick={handleChunkClick} onScroll={handleScroll}>
          {activeCSS && <style>{activeCSS}</style>}
          <pre
            className="text-[11.5px] whitespace-pre-wrap break-words font-mono text-slate-700 dark:text-[#c8d8e8] px-3 py-1"
            style={{ lineHeight: "1.6", overflowWrap: "break-word", wordBreak: "break-word" }}
          >
            {renderedNodes}
          </pre>
        </div>
      </div>
    );
  },
);

DiffPane.displayName = "DiffPane";
export default DiffPane;