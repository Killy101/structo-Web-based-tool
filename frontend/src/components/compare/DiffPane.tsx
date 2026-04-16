"use client";
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useTheme } from "../../context/ThemContext";
import type { Chunk, ChunkKind, DiffPaneHandle, PaneData, TagConfig } from "./types";
import { KIND_META } from "./types";

interface HeaderStat {
  label: string;
  count: number;
  colorClass: string;
  title: string;
}

interface Props {
  pane:          PaneData;
  chunks:        Chunk[];
  activeChunkId: number | null;
  filename: string;
  side: "a" | "b";
  /** Called when the user clicks a highlighted chunk span in this pane */
  onChunkClick?: (chunkId: number) => void;
  /** Called with scroll fraction (0–1) when the user manually scrolls this pane */
  onScrollFraction?: (scrollFraction: number) => void;
  /** Per-pane change-count badges rendered in the header */
  headerStats?: HeaderStat[];
  /** Called when the user clicks the "Jump to first change" button */
  onJumpToFirst?: () => void;
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
  ({ pane, chunks, activeChunkId, filename, side, onChunkClick, onScrollFraction, headerStats, onJumpToFirst }, ref) => {
    const scrollRef  = useRef<HTMLDivElement>(null);
    const syncingRef = useRef(false);   // true while a programmatic scroll is in flight
    const { dark } = useTheme();

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

        // Suppress the scroll-fraction callback while we drive the scroll
        syncingRef.current = true;
        const clearSync = () => { syncingRef.current = false; };

        // Try exact match first
        const el = container.querySelector(`[data-chunk-id="${chunkId}"]`) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(clearSync, 500);
          return;
        }

        // 2. Proportional scroll from the other pane
        if (scrollFraction !== undefined) {
          const maxScroll = container.scrollHeight - container.clientHeight;
          if (maxScroll > 0) {
            container.scrollTo({ top: scrollFraction * maxScroll, behavior: "smooth" });
            setTimeout(clearSync, 500);
            return;
          }
        }

        // Fallback 2: find the nearest neighbour chunk that exists in this pane
        syncingRef.current = false; // nothing scrolled yet
        if (!orderedIds) return;
        const idx = orderedIds.indexOf(chunkId);
        if (idx < 0) return;
        for (let dist = 1; dist < orderedIds.length; dist++) {
          for (const d of [-dist, dist]) {
            const ni = idx + d;
            if (ni < 0 || ni >= orderedIds.length) continue;
            const neighbor = container.querySelector(`[data-chunk-id="${orderedIds[ni]}"]`) as HTMLElement | null;
            if (neighbor) {
              syncingRef.current = true;
              neighbor.scrollIntoView({ behavior: "smooth", block: "center" });
              setTimeout(clearSync, 500);
              return;
            }
          }
        }
      },

      scrollToFraction(fraction: number) {
        const container = scrollRef.current;
        if (!container) return;
        syncingRef.current = true;
        const maxScroll = container.scrollHeight - container.clientHeight;
        container.scrollTo({ top: fraction * maxScroll, behavior: "smooth" });
        setTimeout(() => { syncingRef.current = false; }, 500);
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

    /* ── Click-to-select: clicking any highlighted span selects its chunk ── */
    const handleChunkClick = useCallback((e: React.MouseEvent) => {
      if (!onChunkClick) return;
      const target = e.target as HTMLElement;
      const chunkSpan = target.closest("[data-chunk-id]") as HTMLElement | null;
      if (chunkSpan?.dataset.chunkId) {
        const id = Number(chunkSpan.dataset.chunkId);
        if (!isNaN(id)) onChunkClick(id);
      }
    }, [onChunkClick]);

    /* ── Scroll sync: emit fraction to parent when user scrolls manually ── */
    const handleScroll = useCallback(() => {
      if (syncingRef.current) return;
      const container = scrollRef.current;
      if (!container || !onScrollFraction) return;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > 0) onScrollFraction(container.scrollTop / maxScroll);
    }, [onScrollFraction]);

    const hasStats = headerStats && headerStats.length > 0;

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden min-w-0">
        {/* ── Panel header ──────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className={`flex-shrink-0 text-[9px] font-black tracking-widest px-2 py-0.5 rounded ${sideBadge}`}>
              {side.toUpperCase()}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0">
              {filename}
            </span>

            {/* Change-count badges */}
            {hasStats && (
              <div className="flex-shrink-0 flex items-center gap-1.5">
                {headerStats!.map((stat) => (
                  <span
                    key={stat.label}
                    title={stat.title}
                    className={`text-[9px] font-mono font-bold ${stat.colorClass} select-none`}
                  >
                    {stat.label}{stat.count}
                  </span>
                ))}
              </div>
            )}

            {/* Jump-to-first-change button */}
            {onJumpToFirst && hasStats && (
              <button
                onClick={onJumpToFirst}
                title="Jump to first change in this panel"
                className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-white/10"
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
                Jump
              </button>
            )}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-auto"
          onScroll={handleScroll}
          onClick={handleChunkClick}
        >
          {activeChunkCSS && <style>{activeChunkCSS}</style>}
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