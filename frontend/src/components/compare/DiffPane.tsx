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

interface HeaderStat {
  label: string;
  count: number;
  colorClass: string;
  title: string;
}

interface Props {
  pane: PaneData;
  chunks: Chunk[];
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

/* ── Active-chunk outline/border colours (word bg comes from backend tags) ── */
const ACTIVE_HL: Record<ChunkKind, { border: string; bg: string }> = {
  add: { border: "rgba(16,185,129,0.6)",  bg: "rgba(16,185,129,0.10)" },
  del: { border: "rgba(244,63,94,0.6)",   bg: "rgba(244,63,94,0.10)" },
  mod: { border: "rgba(245,158,11,0.6)",  bg: "rgba(245,158,11,0.10)" },
  emp: { border: "rgba(139,92,246,0.6)",  bg: "rgba(139,92,246,0.10)" },
};

/* ── Dark-mode equivalents for backend's light pastel highlight colors ─── */
const DARK_BG_MAP: Record<string, string> = {
  "#ccffd8": "rgba(16,185,129,0.22)",   // ADD: light green → dark teal
  "#ffd7d5": "rgba(244,63,94,0.22)",    // DEL: light pink → dark rose
  "#fff3b0": "rgba(245,158,11,0.22)",   // MOD: light yellow → dark amber
  "#ead8ff": "rgba(139,92,246,0.22)",   // EMP: light purple → dark violet
};
const DARK_FG_MAP: Record<string, string> = {
  "#1a4d2e": "#6ee7b7",  // ADD fg → emerald-300
  "#6e1c1a": "#fda4af",  // DEL fg → rose-300
  "#5a3e00": "#fcd34d",  // MOD fg → amber-300
  "#3d007a": "#c4b5fd",  // EMP fg → violet-300
};

function tagToStyle(cfg: TagConfig, dark: boolean): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (cfg.background) {
    s.backgroundColor = dark ? (DARK_BG_MAP[cfg.background.toLowerCase()] ?? cfg.background) : cfg.background;
  }
  if (cfg.foreground) {
    s.color = dark ? (DARK_FG_MAP[cfg.foreground.toLowerCase()] ?? cfg.foreground) : cfg.foreground;
  }
  if (cfg.font) {
    if (cfg.font.style.includes("bold"))   s.fontWeight = "bold";
    if (cfg.font.style.includes("italic")) s.fontStyle  = "italic";
  }
  if (cfg.underline)  s.textDecoration = "underline";
  if (cfg.overstrike) s.textDecoration = "line-through";
  return s;
}

/* ── Segment that belongs to a visual line ──────────────────────────────── */
interface LineSeg {
  text: string;
  tagName: string;
  chunkId: number | null;
}

/* Build an array of lines, each containing its segments. */
function buildLines(pane: PaneData) {
  const { segments, offsets, offset_ends } = pane;

  // sorted chunk ranges by start offset for fast lookup
  const ranges: { id: number; start: number; end: number }[] = [];
  for (const [cid, start] of Object.entries(offsets)) {
    const id = Number(cid);
    ranges.push({ id, start, end: offset_ends[cid] ?? start + 999_999 });
  }
  ranges.sort((a, b) => a.start - b.start);

  const lines: LineSeg[][] = [[]];
  let pos = 0;
  let ri = 0;

  for (let i = 0; i < segments.length; i++) {
    const [text, tagName] = segments[i];

    // advance range cursor
    while (ri < ranges.length && ranges[ri].end <= pos) ri++;
    let chunkId: number | null = null;
    if (ri < ranges.length && pos >= ranges[ri].start && pos < ranges[ri].end) {
      chunkId = ranges[ri].id;
    }

    if (text === "\n") {
      lines.push([]);
    } else {
      lines[lines.length - 1].push({ text, tagName, chunkId });
    }
    pos += text.length;
  }

  return lines;
}

const DiffPane = forwardRef<DiffPaneHandle, Props>(
  ({ pane, chunks, activeChunkId, filename, side, onChunkClick, onScrollFraction, headerStats, onJumpToFirst }, ref) => {
    const scrollRef  = useRef<HTMLDivElement>(null);
    const syncingRef = useRef(false);   // true while a programmatic scroll is in flight
    const { dark } = useTheme();

    useImperativeHandle(ref, () => ({
      scrollToChunk(chunkId: number, orderedIds?: number[], scrollFraction?: number) {
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

        // Fallback 1: use proportional scroll position from the other pane
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

    const lines = useMemo(() => buildLines(pane), [pane]);

    // chunk id → kind lookup
    const kindMap = useMemo(() => {
      const m = new Map<number, ChunkKind>();
      for (const c of chunks) m.set(c.id, c.kind);
      return m;
    }, [chunks]);

    const tagStyles = useMemo(() => {
      const m: Record<string, React.CSSProperties> = {};
      for (const [name, cfg] of Object.entries(pane.tag_cfgs)) {
        const s = tagToStyle(cfg, dark);
        m[name] = s;
      }
      return m;
    }, [pane.tag_cfgs, dark]);

    const sideBadge = side === "a" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white";

    /* ── Pre-build all line nodes.
     *
     * IMPORTANT: activeChunkId is intentionally NOT in the dependency array.
     * Rebuilding 5 000–50 000 React nodes on every chunk click was extremely
     * slow for large documents. Instead, the active-chunk highlight is applied
     * via a tiny injected <style> rule (see activeChunkCSS below) so only a
     * string update happens on selection changes, not a full node rebuild.
     *
     * Every span that belongs to a chunk carries data-chunk-id so the CSS
     * selector can target all of them at once. The first span of each chunk
     * also serves as the DOM anchor for scrollToChunk().
     * ── */
    const renderedNodes = useMemo(() => {
      const nodes: React.ReactNode[] = [];

      for (let li = 0; li < lines.length; li++) {
        const segs = lines[li];
        const lineNodes: React.ReactNode[] = [];
        for (let si = 0; si < segs.length; si++) {
          const seg = segs[si];
          const style = tagStyles[seg.tagName] ?? {};

          lineNodes.push(
            seg.chunkId !== null
              ? <span key={si} style={style} data-chunk-id={String(seg.chunkId)}>{seg.text}</span>
              : <span key={si} style={style}>{seg.text}</span>
          );
        }
        /* content-visibility:auto tells the browser to skip layout/paint for
         * lines outside the viewport, giving near-virtual-scroll performance
         * without a JS virtualization library. containIntrinsicHeight provides
         * a size hint so the scrollbar stays stable. */
        nodes.push(
          <div key={li} style={{ contentVisibility: "auto", containIntrinsicHeight: "auto 1.6em" }}>
            {lineNodes}
          </div>
        );
      }
      return nodes;
    }, [lines, tagStyles]); // ← activeChunkId removed; kindMap no longer needed here

    /* Active-chunk highlight as an injected CSS rule.
     * Only this tiny string regenerates on every chunk click — not the full
     * node tree. The selector targets all data-chunk-id spans of that chunk. */
    const activeChunkCSS = useMemo(() => {
      if (activeChunkId === null) return "";
      const kind = kindMap.get(activeChunkId);
      if (!kind) return "";
      const ahl = ACTIVE_HL[kind];
      return (
        `[data-chunk-id="${activeChunkId}"] {` +
        ` background-color: ${ahl.bg} !important;` +
        ` border-radius: 2px;` +
        ` outline: 2px solid ${ahl.border};` +
        ` outline-offset: 0px;` +
        ` }`
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
  }
);

DiffPane.displayName = "DiffPane";
export default DiffPane;
