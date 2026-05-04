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
  activeChunk?:      Chunk | null;
  filename:          string;
  side:              "a" | "b";
  onChunkClick?:     (chunkId: number) => void;
  onScrollFraction?: (scrollFraction: number) => void;
  headerStats?:      HeaderStat[];
  onJumpToFirst?:    () => void;
  wrapLines?:        boolean;
  alignedLines?:     AlignedLine[];
}

interface InnerProps {
  lines:          AlignedLine[];
  pane:           PaneData;
  kindMap:        Map<number, ChunkKind>;
  activeChunkCSS: string;
  activeChunk:    Chunk | null;
  side:           "a" | "b";
  scrollRef:      React.RefObject<HTMLDivElement>;
  wrapLines:      boolean;
  dark:           boolean;
  onChunkClick?:  (chunkId: number) => void;
  onScroll:       () => void;
  onVirtualizerReady: (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => void;
}

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

interface LineSeg {
  text:    string;
  tagName: string;
  chunkId: number | null;
}

type Line = LineSeg[];
export type AlignedLine = Line | null;

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

// ── Alignment helpers ─────────────────────────────────────────────────────────

/** Cumulative character-start position for each line (s[i] = start of line i). */
function _lineCharStarts(lines: Line[]): number[] {
  const s: number[] = [0];
  for (const line of lines) {
    const len = line.reduce((acc, seg) => acc + seg.text.length, 0) + 1;
    s.push(s[s.length - 1] + len);
  }
  return s;
}

/** Last index i where arr[i] <= val (binary-search floor). */
function _bsFloor(arr: number[], val: number): number {
  let lo = 0, hi = arr.length - 2, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= val) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

/**
 * Align lines from two panes by inserting null "gap" placeholders on the
 * shorter side at each chunk boundary, so both arrays have equal length and
 * linesA[i] / linesB[i] correspond to the same vertical row.
 *
 * This produces Beyond Compare-style alignment where equal context lines are
 * always at the same row across both panes.
 */
export function buildAlignedLines(
  paneA: PaneData,
  paneB: PaneData,
  chunks: Chunk[],
): { linesA: AlignedLine[]; linesB: AlignedLine[] } {
  const rawA = buildLines(paneA);
  const rawB = buildLines(paneB);
  if (chunks.length === 0) return { linesA: rawA, linesB: rawB };

  const csA = _lineCharStarts(rawA);
  const csB = _lineCharStarts(rawB);

  // ── 1. Compute per-chunk line ranges ──────────────────────────────────────
  interface CRange {
    firstA: number; lastA: number; // -1 = chunk absent from this pane
    firstB: number; lastB: number;
  }

  const rawRanges: CRange[] = [];
  for (const c of chunks) {
    const offA = paneA.offsets[String(c.id)];
    const endA = paneA.offset_ends[String(c.id)];
    const offB = paneB.offsets[String(c.id)];
    const endB = paneB.offset_ends[String(c.id)];
    const hasA = offA != null && rawA.length > 0;
    const hasB = offB != null && rawB.length > 0;
    if (!hasA && !hasB) continue;
    const firstA = hasA ? _bsFloor(csA, offA) : -1;
    const lastA  = hasA ? _bsFloor(csA, Math.max(offA, (endA ?? offA + 1) - 1)) : -1;
    const firstB = hasB ? _bsFloor(csB, offB) : -1;
    const lastB  = hasB ? _bsFloor(csB, Math.max(offB, (endB ?? offB + 1) - 1)) : -1;
    rawRanges.push({ firstA, lastA, firstB, lastB });
  }

  // Sort by first occurrence in either pane
  rawRanges.sort((a, b) => {
    const pa = a.firstA >= 0 ? a.firstA : (a.firstB >= 0 ? a.firstB + rawA.length : 0);
    const pb = b.firstA >= 0 ? b.firstA : (b.firstB >= 0 ? b.firstB + rawA.length : 0);
    return pa - pb;
  });

  // ── 2. Merge overlapping / adjacent ranges ────────────────────────────────
  // Two ranges that overlap on either pane side must be treated as one block
  // to avoid emitting lines twice.
  const ranges: CRange[] = [];
  for (const cr of rawRanges) {
    if (ranges.length === 0) { ranges.push({ ...cr }); continue; }
    const prev = ranges[ranges.length - 1];
    const overlapA = cr.firstA >= 0 && prev.lastA >= 0 && cr.firstA <= prev.lastA + 1;
    const overlapB = cr.firstB >= 0 && prev.lastB >= 0 && cr.firstB <= prev.lastB + 1;
    if (overlapA || overlapB) {
      // Merge into previous range
      if (cr.firstA >= 0) {
        if (prev.firstA < 0) { prev.firstA = cr.firstA; prev.lastA = cr.lastA; }
        else { prev.lastA = Math.max(prev.lastA, cr.lastA); }
      }
      if (cr.firstB >= 0) {
        if (prev.firstB < 0) { prev.firstB = cr.firstB; prev.lastB = cr.lastB; }
        else { prev.lastB = Math.max(prev.lastB, cr.lastB); }
      }
    } else {
      ranges.push({ ...cr });
    }
  }

  // ── 3. Walk both panes in lockstep, emitting context then chunk lines ─────
  const outA: AlignedLine[] = [];
  const outB: AlignedLine[] = [];
  let curA = 0, curB = 0;

  for (const cr of ranges) {
    // Context lines before this chunk — should be equal content in both panes.
    // Use the count from whichever pane has this chunk (or both if MOD).
    const ctxA = cr.firstA >= 0 ? cr.firstA - curA : 0;
    const ctxB = cr.firstB >= 0 ? cr.firstB - curB : 0;
    const ctxCount = Math.max(0, ctxA, ctxB);

    for (let i = 0; i < ctxCount; i++) {
      // For context: advance whichever pane has lines, gap the other if short
      const lineA = curA + i < rawA.length ? rawA[curA + i] : null;
      const lineB = curB + i < rawB.length ? rawB[curB + i] : null;
      outA.push(lineA);
      outB.push(lineB);
    }
    // Advance cursors by what was actually consumed (clamp to chunk start)
    curA = cr.firstA >= 0 ? cr.firstA : curA + ctxCount;
    curB = cr.firstB >= 0 ? cr.firstB : curB + ctxCount;

    // Chunk lines — pad the shorter side with gap placeholders
    const countA   = cr.firstA >= 0 ? Math.max(0, cr.lastA - cr.firstA + 1) : 0;
    const countB   = cr.firstB >= 0 ? Math.max(0, cr.lastB - cr.firstB + 1) : 0;
    const maxCount = Math.max(countA, countB, 1);
    for (let i = 0; i < maxCount; i++) {
      outA.push(i < countA ? rawA[curA + i] : null);
      outB.push(i < countB ? rawB[curB + i] : null);
    }
    curA += countA;
    curB += countB;
  }

  // ── 4. Trailing context after last chunk ──────────────────────────────────
  const trailCount = Math.max(rawA.length - curA, rawB.length - curB, 0);
  for (let i = 0; i < trailCount; i++) {
    outA.push(curA + i < rawA.length ? rawA[curA + i] : null);
    outB.push(curB + i < rawB.length ? rawB[curB + i] : null);
  }

  return { linesA: outA, linesB: outB };
}

function tagToStyle(
  cfg: TagConfig,
  dark: boolean,
  kind?: ChunkKind,
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
  if (cfg.underline) decorations.push("underline");
  if (cfg.overstrike) decorations.push("line-through");
  if (decorations.length > 0) s.textDecoration = decorations.join(" ");
  return s;
}

type WordToken = { type: "equal" | "delete" | "insert"; value: string };

function buildWordTokens(chunk: Chunk, side: "a" | "b"): WordToken[] | null {
  const removed = chunk.words_removed?.split(/\s+/).filter(Boolean) ?? [];
  const added   = chunk.words_added?.split(/\s+/).filter(Boolean)   ?? [];
  if (removed.length === 0 && added.length === 0) return null;

  const before = chunk.words_before?.split(/\s+/).filter(Boolean) ?? [];
  const after  = chunk.words_after?.split(/\s+/).filter(Boolean)  ?? [];

  const tokens: WordToken[] = [];
  before.forEach((w) => tokens.push({ type: "equal",  value: w }));
  if (side === "a") {
    removed.forEach((w) => tokens.push({ type: "delete", value: w }));
  } else {
    added.forEach((w) => tokens.push({ type: "insert", value: w }));
  }
  after.forEach((w) => tokens.push({ type: "equal", value: w }));
  return tokens;
}

function renderWordTokens(tokens: WordToken[], dark: boolean): React.ReactNode[] {
  return tokens.map((tok, i) => {
    if (tok.type === "delete") {
      return (
        <span key={i} style={{
          backgroundColor: dark ? "rgba(244,63,94,0.30)" : "#ffd7d5",
          color:           dark ? "#fda4af" : "#6e1c1a",
          borderRadius:    2,
          padding:         "0 1px",
        }}>{tok.value}</span>
      );
    }
    if (tok.type === "insert") {
      return (
        <span key={i} style={{
          backgroundColor: dark ? "rgba(16,185,129,0.28)" : "#ccffd8",
          color:           dark ? "#6ee7b7" : "#1a4d2e",
          borderRadius:    2,
          padding:         "0 1px",
        }}>{tok.value}</span>
      );
    }
    return <span key={i}>{tok.value}</span>;
  }).reduce<React.ReactNode[]>((acc, node, i) => {
    if (i > 0) acc.push(" ");
    acc.push(node);
    return acc;
  }, []);
}

function DiffPaneInner({
  lines,
  pane,
  kindMap,
  activeChunkCSS,
  activeChunk,
  side,
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

  useEffect(() => {
    onVirtualizerReady(virtualizer);
  });

  // Pre-compute word tokens for the active MOD chunk so we can render
  // strikethrough/green highlights inline inside the pane text.
  const activeModTokens = useMemo<WordToken[] | null>(() => {
    if (!activeChunk || activeChunk.kind !== "mod") return null;
    return buildWordTokens(activeChunk, side);
  }, [activeChunk, side]);

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
          const segs = lines[vRow.index];

          // Gap placeholder row — inserted to keep both panes vertically aligned
          if (segs === null) {
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
                  <span className="sticky left-0 z-[1] select-none border-r border-slate-200 bg-white dark:border-white/10 dark:bg-[#0a1020]" />
                  <span
                    style={{
                      borderBottom: `1px dashed ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}`,
                      display:      "block",
                      height:       ROW_HEIGHT_PX,
                      opacity:      0.45,
                    }}
                  />
                </div>
              </div>
            );
          }

          const lineNodes: React.ReactNode[] = [];

          // Word-diff tokens are only shown on the FIRST line of the active MOD
          // chunk. Without this guard every line of a multi-line chunk would
          // replace its actual content with the same token summary, causing the
          // same few words to repeat for each line of the chunk.
          const prevLineHasChunk =
            vRow.index > 0 &&
            (lines[vRow.index - 1] ?? []).some((s) => s.chunkId === activeChunk?.id);
          const lineHasRichText = segs.some((s) => {
            const cfg = pane.tag_cfgs[s.tagName] ?? {};
            return cfg.underline || cfg.overstrike;
          });
          const lineIsActiveMod =
            activeModTokens !== null &&
            segs.length > 0 &&
            segs.every((s) => s.chunkId === activeChunk?.id) &&
            !lineHasRichText &&
            !prevLineHasChunk;

          if (lineIsActiveMod && activeModTokens) {
            // Replace only the FIRST line with the word-level diff token summary.
            lineNodes.push(
              <span key="word-diff">
                {renderWordTokens(activeModTokens, dark)}
              </span>
            );
          } else {
            for (let si = 0; si < segs.length; si++) {
              const seg     = segs[si];
              const cfg     = pane.tag_cfgs[seg.tagName] ?? {};
              const kind    = seg.chunkId !== null ? kindMap.get(seg.chunkId) : undefined;
              const style   = tagToStyle(cfg, dark, kind);

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

const DiffPane = forwardRef<DiffPaneHandle, Props>(
  (
    {
      pane,
      chunks,
      activeChunkId,
      activeChunk = null,
      filename,
      side,
      onChunkClick,
      onScrollFraction,
      headerStats,
      onJumpToFirst,
      wrapLines = false,
      alignedLines,
    },
    ref,
  ) => {
    const scrollRef       = useRef<HTMLDivElement>(null);
    const syncingRef      = useRef(false);
    const scrollFrameRef  = useRef<number | null>(null);
    const virtualizerRef  = useRef<ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null>(null);
    const { dark }        = useTheme();

    const lines = useMemo(
      () => alignedLines ?? buildLines(pane),
      [alignedLines, pane],
    );

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

    const handleVirtualizerReady = useCallback(
      (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => {
        virtualizerRef.current = v;
      },
      [],
    );

    useImperativeHandle(ref, () => ({
      scrollToChunk(chunkId: number, _orderedIds?: number[], scrollFraction?: number) {
        const container  = scrollRef.current;
        const virtualizer = virtualizerRef.current;
        if (!container) return;

        syncingRef.current = true;
        const clearSync = () => { syncingRef.current = false; };

        // Find first row that belongs to this chunk (null/gap rows are skipped)
        if (virtualizer) {
          let targetLine = -1;
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            if (line !== null && line.some((s) => s.chunkId === chunkId)) {
              targetLine = li;
              break;
            }
          }
          if (targetLine >= 0) {
            virtualizer.scrollToIndex(targetLine, { align: "center", behavior: "auto" });
            requestAnimationFrame(clearSync);
            return;
          }
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
    }), [lines]);

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

    const sideBadge = side === "a" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white";
    const hasStats  = headerStats && headerStats.length > 0;

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden min-w-0">

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
              {lines.filter((l) => l !== null).length.toLocaleString()} lines
            </span>
          </div>
        </div>

        <DiffPaneInner
          lines={lines}
          pane={pane}
          kindMap={kindMap}
          activeChunkCSS={activeChunkCSS}
          activeChunk={activeChunk}
          side={side}
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