"use client";

/**
 * DiffPane.tsx — Virtualised side-by-side diff pane
 *
 * WHY THE FILE IS SPLIT INTO TWO COMPONENTS
 * ──────────────────────────────────────────
 * React Compiler (babel-plugin-react-compiler) cannot safely memoize any
 * component that calls useVirtualizer() because that hook returns callback
 * functions with internal mutable state.  When the compiler encounters this
 * it skips the WHOLE file and emits:
 *   "Compilation Skipped: Use of incompatible library"
 *
 * The correct fix — confirmed by the TanStack Virtual maintainers — is to
 * isolate useVirtualizer in a plain function component (NOT forwardRef, NOT
 * memo) so the compiler only skips that inner component and can still fully
 * optimise everything around it.
 *
 * Architecture:
 *   DiffPane (forwardRef)           ← outer shell, gets the imperative ref,
 *     └─ DiffPaneInner (plain fn)  ← owns useVirtualizer, skipped by compiler
 *
 * The outer DiffPane holds the scrollRef via its own useRef and passes it
 * down.  DiffPaneInner reads the scroll container through that same ref so
 * useVirtualizer always has the correct element.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTheme } from "../../context/ThemContext";
import type { Chunk, ChunkKind, DiffPaneHandle, PaneData, TagConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface HeaderStat {
  label:      string;
  count:      number;
  colorClass: string;
  title:      string;
}

interface Props {
  pane:              PaneData;
  chunks:            Chunk[];
  activeChunkId:     number | null;
  filename:          string;
  side:              "a" | "b";
  onChunkClick?:     (chunkId: number) => void;
  onScrollFraction?: (scrollFraction: number) => void;
  headerStats?:      HeaderStat[];
  onJumpToFirst?:    () => void;
  wrapLines?:        boolean;
}

// Shared between outer and inner component
interface InnerProps {
  lines:          Line[];
  pane:           PaneData;
  kindMap:        Map<number, ChunkKind>;
  activeChunkCSS: string;
  scrollRef:      React.RefObject<HTMLDivElement>;
  wrapLines:      boolean;
  dark:           boolean;
  onChunkClick?:  (chunkId: number) => void;
  onScroll:       () => void;
  // exposed so outer can call virtualizer.scrollToIndex
  onVirtualizerReady: (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ROW_HEIGHT_PX = 24;

const ACTIVE_HL: Record<ChunkKind, { border: string; bg: string }> = {
  add: { border: "rgba(16,185,129,0.6)",  bg: "rgba(16,185,129,0.10)" },
  del: { border: "rgba(244,63,94,0.6)",   bg: "rgba(244,63,94,0.10)"  },
  mod: { border: "rgba(245,158,11,0.6)",  bg: "rgba(245,158,11,0.10)" },
  emp: { border: "rgba(139,92,246,0.6)",  bg: "rgba(139,92,246,0.10)" },
};

const DARK_BG_MAP: Record<string, string> = {
  "#ccffd8": "rgba(16,185,129,0.22)",
  "#ffd7d5": "rgba(244,63,94,0.22)",
  "#fff3b0": "rgba(245,158,11,0.22)",
  "#ead8ff": "rgba(139,92,246,0.22)",
};

const DARK_FG_MAP: Record<string, string> = {
  "#1a4d2e": "#6ee7b7",
  "#6e1c1a": "#fda4af",
  "#5a3e00": "#fcd34d",
  "#3d007a": "#c4b5fd",
};

// ─────────────────────────────────────────────────────────────────────────────
//  PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

interface LineSeg {
  text:    string;
  tagName: string;
  chunkId: number | null;
}

type Line = LineSeg[];

function buildLines(pane: PaneData): Line[] {
  const { segments, offsets, offset_ends } = pane;

  const ranges: { id: number; start: number; end: number }[] = [];
  for (const [cid, start] of Object.entries(offsets)) {
    const id = Number(cid);
    ranges.push({ id, start, end: offset_ends[cid] ?? start + 999_999 });
  }
  ranges.sort((a, b) => a.start - b.start);

  const lines: Line[] = [[]];
  let pos = 0;
  let ri  = 0;

  for (let i = 0; i < segments.length; i++) {
    const [text, tagName] = segments[i];
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

function tagToStyle(
  cfg: TagConfig,
  dark: boolean,
  kind?: ChunkKind,
  allowUnderline = false,
): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (cfg.background) {
    s.backgroundColor = dark
      ? (DARK_BG_MAP[cfg.background.toLowerCase()] ?? cfg.background)
      : cfg.background;
  }
  if (cfg.foreground) {
    s.color = dark
      ? (DARK_FG_MAP[cfg.foreground.toLowerCase()] ?? cfg.foreground)
      : cfg.foreground;
  }
  if (cfg.font) {
    if (cfg.font.style.includes("bold"))   s.fontWeight = "bold";
    if (cfg.font.style.includes("italic")) s.fontStyle  = "italic";
  }

  // Enforce Git-style visual semantics by chunk kind when available.
  if (kind === "add") {
    s.backgroundColor = dark ? "rgba(16,185,129,0.22)" : "#ccffd8";
    s.color = dark ? "#6ee7b7" : "#1a4d2e";
  } else if (kind === "del") {
    s.backgroundColor = dark ? "rgba(244,63,94,0.22)" : "#ffd7d5";
    s.color = dark ? "#fda4af" : "#6e1c1a";
  }

  const decorations: string[] = [];
  if (allowUnderline && cfg.underline) decorations.push("underline");
  if (cfg.overstrike || kind === "del") decorations.push("line-through");
  if (decorations.length > 0) s.textDecoration = decorations.join(" ");
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
//  INNER COMPONENT — owns useVirtualizer
//  React Compiler will skip ONLY this component, not the whole file.
// ─────────────────────────────────────────────────────────────────────────────

function DiffPaneInner({
  lines,
  pane,
  kindMap,
  activeChunkCSS,
  scrollRef,
  wrapLines,
  dark,
  onChunkClick,
  onScroll,
  onVirtualizerReady,
}: InnerProps) {
  "use no memo";
  // useVirtualizer lives here — isolated from forwardRef so React Compiler
  // only skips this plain function component, not the outer DiffPane shell.
  const virtualizer = useVirtualizer({
    count:            lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_HEIGHT_PX,
    overscan:         25,
  });

  // Expose the virtualizer instance to the outer component so it can call
  // scrollToIndex from the imperative handle.
  useEffect(() => {
    onVirtualizerReady(virtualizer);
  });

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onChunkClick) return;
    const span = (e.target as HTMLElement).closest("[data-chunk-id]") as HTMLElement | null;
    if (span?.dataset.chunkId) {
      const id = Number(span.dataset.chunkId);
      if (!isNaN(id)) onChunkClick(id);
    }
  }, [onChunkClick]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-auto"
      onScroll={onScroll}
      onClick={handleClick}
    >
      {activeChunkCSS && <style>{activeChunkCSS}</style>}

      {/* Total-height placeholder — makes scrollbar accurate */}
      <div
        className="font-mono text-[11.5px] text-slate-700 dark:text-[#c8d8e8] px-3 py-1 relative"
        style={{
          height:       virtualizer.getTotalSize(),
          lineHeight:   "1.6",
          overflowWrap: wrapLines ? "break-word" : "normal",
          wordBreak:    wrapLines ? "break-word" : "normal",
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const segs      = lines[vRow.index];
          const lineNodes: React.ReactNode[] = [];

          for (let si = 0; si < segs.length; si++) {
            const seg     = segs[si];
            const cfg     = pane.tag_cfgs[seg.tagName] ?? {};
            const changed = seg.chunkId !== null && kindMap.has(seg.chunkId);
            const kind    = seg.chunkId !== null ? kindMap.get(seg.chunkId) : undefined;
            const style   = tagToStyle(cfg, dark, kind, changed);

            lineNodes.push(
              seg.chunkId !== null
                ? <span
                    key={si}
                    style={style}
                    data-chunk-id={String(seg.chunkId)}
                    data-changed={cfg.background ? "true" : undefined}
                  >{seg.text}</span>
                : <span key={si} style={style}>{seg.text}</span>
            );
          }

          return (
            <div
              key={vRow.index}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position:  "absolute",
                top:       0,
                left:      0,
                right:     0,
                transform: `translateY(${vRow.start}px)`,
                minHeight: ROW_HEIGHT_PX,
              }}
            >
              <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                <span className="sticky left-0 z-[1] select-none border-r border-slate-200 bg-white pr-2 text-right text-[10px] font-medium tabular-nums text-slate-400 dark:border-white/10 dark:bg-[#0a1020] dark:text-slate-500">
                  {vRow.index + 1}
                </span>
                <span className={wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"}>
                  {lineNodes.length > 0 ? lineNodes : " "}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  OUTER COMPONENT — forwardRef shell, fully optimised by React Compiler
// ─────────────────────────────────────────────────────────────────────────────

const DiffPane = forwardRef<DiffPaneHandle, Props>(
  (
    {
      pane,
      chunks,
      activeChunkId,
      filename,
      side,
      onChunkClick,
      onScrollFraction,
      headerStats,
      onJumpToFirst,
      wrapLines = false,
    },
    ref,
  ) => {
    const scrollRef       = useRef<HTMLDivElement>(null);
    const syncingRef      = useRef(false);
    const scrollFrameRef  = useRef<number | null>(null);
    // Store the virtualizer instance forwarded up from DiffPaneInner
    const virtualizerRef  = useRef<ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null>(null);
    const { dark }        = useTheme();

    // ── Derived data (memoised — React Compiler can optimise these) ──────
    const lines = useMemo(() => buildLines(pane), [pane]);

    const kindMap = useMemo(() => {
      const m = new Map<number, ChunkKind>();
      for (const c of chunks) m.set(c.id, c.kind);
      return m;
    }, [chunks]);

    const activeChunkCSS = useMemo(() => {
      if (activeChunkId === null) return "";
      const kind = kindMap.get(activeChunkId);
      if (!kind) return "";
      const ahl = ACTIVE_HL[kind];
      const sel = `[data-chunk-id="${activeChunkId}"]`;
      if (kind === "mod") {
        // For MOD chunks precompute() already coloured changed words via tag_cfgs.
        // Keep only outline for active selection so Git-style red/green token
        // backgrounds remain visible and are not overpainted.
        return (
          `${sel} {` +
          ` border-radius: 2px;` +
          ` outline: 1px solid ${ahl.border};` +
          ` outline-offset: 0px; }`
        );
      }
      // ADD / DEL / EMP: highlight entire span range
      return (
        `${sel} {` +
        ` background-color: ${ahl.bg} !important;` +
        ` border-radius: 2px;` +
        ` outline: 2px solid ${ahl.border};` +
        ` outline-offset: 0px; }`
      );
    }, [activeChunkId, kindMap]);

    // ── Callback: receive virtualizer from inner component ───────────────
    const handleVirtualizerReady = useCallback(
      (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => {
        virtualizerRef.current = v;
      },
      [],
    );

    // ── Imperative handle ────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      scrollToChunk(chunkId: number, _orderedIds?: number[], scrollFraction?: number) {
        const container  = scrollRef.current;
        const virtualizer = virtualizerRef.current;
        if (!container) return;

        syncingRef.current = true;
        const clearSync = () => { syncingRef.current = false; };

        // Find which line index this chunk starts on
        const chunkOffset = pane.offsets[String(chunkId)];
        if (chunkOffset != null && virtualizer) {
          let totalChars = 0;
          let targetLine = 0;
          for (let li = 0; li < lines.length; li++) {
            const len = lines[li].reduce((acc, seg) => acc + seg.text.length, 0) + 1;
            if (totalChars + len > chunkOffset) { targetLine = li; break; }
            totalChars += len;
          }
          virtualizer.scrollToIndex(targetLine, { align: "center", behavior: "auto" });
          requestAnimationFrame(clearSync);
          return;
        }

        // Fallback: proportional scroll from the other pane
        if (scrollFraction !== undefined) {
          const maxScroll = container.scrollHeight - container.clientHeight;
          if (maxScroll > 0) {
            container.scrollTop = scrollFraction * maxScroll;
            requestAnimationFrame(clearSync);
            return;
          }
        }

        syncingRef.current = false;
      },

      scrollToFraction(fraction: number) {
        const container = scrollRef.current;
        if (!container) return;
        syncingRef.current = true;
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.max(0, Math.min(1, fraction)) * maxScroll;
        requestAnimationFrame(() => { syncingRef.current = false; });
      },
    }), [lines, pane.offsets]);

    // ── Scroll sync (disabled when wrapLines to prevent desync) ─────────
    const handleScroll = useCallback(() => {
      if (syncingRef.current || wrapLines) return;
      const container = scrollRef.current;
      if (!container || !onScrollFraction) return;
      if (scrollFrameRef.current !== null) return;

      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll > 0) onScrollFraction(container.scrollTop / maxScroll);
      });
    }, [onScrollFraction, wrapLines]);

    useEffect(() => {
      return () => {
        if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      };
    }, []);

    // ── Header meta ──────────────────────────────────────────────────────
    const sideBadge = side === "a" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white";
    const hasStats  = headerStats && headerStats.length > 0;

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden min-w-0">

        {/* ── Panel header ──────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className={`flex-shrink-0 text-[9px] font-black tracking-widest px-2 py-0.5 rounded ${sideBadge}`}>
              {side.toUpperCase()}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0">
              {filename}
            </span>

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

            {onJumpToFirst && hasStats && (
              <button
                onClick={onJumpToFirst}
                title="Jump to first change"
                className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-white/10"
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
                Jump
              </button>
            )}

            <span className="flex-shrink-0 text-[9px] font-mono text-slate-400 dark:text-slate-600 select-none">
              {lines.length.toLocaleString()} lines
            </span>
          </div>
        </div>

        {/* ── Virtualised body (rendered by DiffPaneInner) ─────────────── */}
        <DiffPaneInner
          lines={lines}
          pane={pane}
          kindMap={kindMap}
          activeChunkCSS={activeChunkCSS}
          scrollRef={scrollRef}
          wrapLines={wrapLines}
          dark={dark}
          onChunkClick={onChunkClick}
          onScroll={handleScroll}
          onVirtualizerReady={handleVirtualizerReady}
        />
      </div>
    );
  },
);

DiffPane.displayName = "DiffPane";
export default DiffPane;