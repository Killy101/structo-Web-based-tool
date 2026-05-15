"use client";

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

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_HEIGHT_PX = 24;
const CONTEXT_LINES = 10;

// ── Interfaces ────────────────────────────────────────────────────────────────

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
  onScrollLeft?:     (scrollLeft: number) => void;
  syncScrollLeft?:   number | null;
  headerStats?:      HeaderStat[];
  onJumpToFirst?:    () => void;
  alignedLines?:     AlignedLine[];
  contextLines?:     number;
  onUnfoldRow?:      (foldKey: number) => void;
  isScrollSource?:   boolean;
}

interface InnerProps {
  lines:          AlignedLine[];
  allChunkTokens: Map<number, WordToken[]>;
  pane:           PaneData;
  kindMap:        Map<number, ChunkKind>;
  activeChunkId:  number | null;
  activeChunkCSS: string;
  scrollRef:      React.RefObject<HTMLDivElement>;
  dark:           boolean;
  onChunkClick?:  (chunkId: number) => void;
  onScroll:       () => void;
  onVirtualizerReady: (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => void;
  onUnfold:       (key: number) => void;
}

// ── Active highlight colours per kind ─────────────────────────────────────────

const ACTIVE_HL: Record<ChunkKind, { border: string; bg: string }> = {
  add:    { border: "rgba(34,197,94,0.65)",   bg: "rgba(34,197,94,0.10)"  },
  del:    { border: "rgba(244,63,94,0.65)",   bg: "rgba(244,63,94,0.10)"  },
  mod:    { border: "rgba(249,115,22,0.65)",  bg: "rgba(249,115,22,0.10)" },
  emp:    { border: "rgba(96,165,250,0.70)",  bg: "rgba(96,165,250,0.10)" },
  strike: { border: "rgba(190,24,93,0.65)",   bg: "rgba(190,24,93,0.10)"  },
};

// ── Dark-mode colour maps ─────────────────────────────────────────────────────

const DARK_BG_MAP: Record<string, string> = {
  "#bbf7d0": "rgba(34,197,94,0.22)",
  "#fecdd3": "rgba(244,63,94,0.22)",
  "#fed7aa": "rgba(249,115,22,0.22)",
  "#bfdbfe": "rgba(96,165,250,0.22)",
  "#ccffd8": "rgba(34,197,94,0.22)",
  "#ffd7d5": "rgba(244,63,94,0.22)",
  "#fff3b0": "rgba(249,115,22,0.22)",
  "#ead8ff": "rgba(96,165,250,0.22)",
};

const DARK_FG_MAP: Record<string, string> = {
  "#14532d": "#86efac",
  "#881337": "#fda4af",
  "#7c2d12": "#fdba74",
  "#1e3a8a": "#93c5fd",
  "#1a4d2e": "#86efac",
  "#6e1c1a": "#fda4af",
  "#5a3e00": "#fdba74",
  "#3d007a": "#93c5fd",
};

// ── Server palette helpers ────────────────────────────────────────────────────

const SERVER_DEL_BG = new Set(["#fecdd3", "#ffd7d5"]);
const SERVER_ADD_BG = new Set(["#bbf7d0", "#ccffd8"]);
const SERVER_MOD_BG = new Set(["#fed7aa", "#fff3b0"]);
const SERVER_EMP_BG = new Set(["#bfdbfe", "#ead8ff"]);

function _serverPaletteKind(bg?: string): "del" | "add" | "mod" | "emp" | null {
  if (!bg) return null;
  const k = bg.toLowerCase();
  if (SERVER_DEL_BG.has(k)) return "del";
  if (SERVER_ADD_BG.has(k)) return "add";
  if (SERVER_MOD_BG.has(k)) return "mod";
  if (SERVER_EMP_BG.has(k)) return "emp";
  return null;
}

// ── Line types ────────────────────────────────────────────────────────────────

export type LineSeg = {
  text:    string;
  tagName: string;
  chunkId: number | null;
};

export type Line = LineSeg[];

/**
 * null              = gap placeholder (one side has no content for this row)
 * { type: "fold" }  = collapsed unchanged rows the user can expand
 */
export type AlignedLine =
  | Line
  | null
  | { type: "fold"; count: number; key: number; hasGap?: boolean };

/** Returned by foldUnchangedLines so DiffViewer can expand folds correctly */
export interface FoldMapEntry {
  rawStart: number;
  count:    number;
}

// ── Word-level token types ────────────────────────────────────────────────────

export type WordToken = { type: "equal" | "delete" | "insert"; value: string };

export function buildWordTokens(chunk: Chunk, side: "a" | "b"): WordToken[] | null {
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

export function renderWordTokens(tokens: WordToken[], dark: boolean): React.ReactNode[] {
  const nodes = tokens.map((tok, i) => {
    if (tok.type === "delete") {
      return (
        <span key={`d-${i}`} style={{
          backgroundColor: dark ? "rgba(244,63,94,0.30)"  : "#ffd7d5",
          color:           dark ? "#fda4af" : "#6e1c1a",
          borderRadius:    2, padding: "0 1px",
          textDecoration:  "line-through",
        }}>{tok.value}</span>
      );
    }
    if (tok.type === "insert") {
      return (
        <span key={`i-${i}`} style={{
          backgroundColor: dark ? "rgba(16,185,129,0.28)" : "#ccffd8",
          color:           dark ? "#6ee7b7" : "#1a4d2e",
          borderRadius:    2, padding: "0 1px",
        }}>{tok.value}</span>
      );
    }
    return <span key={`e-${i}`}>{tok.value}</span>;
  });
  return nodes.reduce<React.ReactNode[]>((acc, node, i) => {
    if (i > 0) acc.push(" ");
    acc.push(node);
    return acc;
  }, []);
}

// ── Colour helper ─────────────────────────────────────────────────────────────

export function tagToStyle(
  cfg: TagConfig,
  dark: boolean,
  kind?: ChunkKind,
  forceStrike?: boolean,
): React.CSSProperties {
  const s: React.CSSProperties = {};

  const serverKind       = _serverPaletteKind(cfg.background);
  const isInlineWordDiff = kind === "mod" && (serverKind === "del" || serverKind === "add");

  const effectiveKind: ChunkKind | undefined =
    isInlineWordDiff && serverKind ? (serverKind as ChunkKind) :
    kind === "mod" && !cfg.background ? undefined :
    kind;

  if (cfg.font) {
    if (cfg.font.style.includes("bold"))   s.fontWeight = "bold";
    if (cfg.font.style.includes("italic")) s.fontStyle  = "italic";
  }

  const isStrikeContent =
    effectiveKind === "strike" ||
    (effectiveKind === "emp" && (cfg.overstrike || forceStrike));

  const isModStrike = effectiveKind === "mod" && cfg.overstrike;

  if (isStrikeContent || isModStrike) {
    s.backgroundColor = dark ? "rgba(244,63,94,0.22)" : "#fecdd3";
    s.color           = dark ? "#fda4af"               : "#881337";
    s.textDecoration  = "line-through";
  } else if (effectiveKind === "add") {
    s.backgroundColor = dark ? "rgba(34,197,94,0.22)"  : "#ccffd8";
    s.color           = dark ? "#86efac"                : "#14532d";
  } else if (effectiveKind === "del") {
    s.backgroundColor = dark ? "rgba(244,63,94,0.22)"  : "#fecdd3";
    s.color           = dark ? "#fda4af"                : "#881337";
    if (isInlineWordDiff) s.textDecoration = "line-through";
  } else if (effectiveKind === "mod") {
    s.backgroundColor = dark ? "rgba(249,115,22,0.22)" : "#fed7aa";
    s.color           = dark ? "#fdba74"                : "#7c2d12";
  } else if (effectiveKind === "emp") {
    s.backgroundColor = dark ? "rgba(96,165,250,0.22)" : "#bfdbfe";
    s.color           = dark ? "#93c5fd"                : "#1e3a8a";
  } else {
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
  }

  const decorations: string[] = [];
  if (cfg.underline && effectiveKind !== undefined) decorations.push("underline");
  if (cfg.overstrike && !isStrikeContent && !isModStrike && !isInlineWordDiff) {
    decorations.push("line-through");
  }
  if (decorations.length > 0 && !isStrikeContent && !isModStrike && !isInlineWordDiff) {
    s.textDecoration = decorations.join(" ");
  }

  return s;
}

// ── buildLines ────────────────────────────────────────────────────────────────

export function buildLines(pane: PaneData): Line[] {
  const { segments, offsets, offset_ends } = pane;

  const ranges = Object.entries(offsets as Record<string, number>)
    .map(([cid, start]) => ({
      id:  Number(cid),
      start,
      end: offset_ends?.[cid] ?? start + 1,
    }))
    .sort((a, b) => a.start - b.start);

  const lines: Line[] = [[]];
  let pos = 0;
  let ri  = 0;

  for (const [text, tagName] of segments) {
    // Advance range pointer past any ranges that ended before current pos
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

function _lineCharStarts(lines: Line[]): number[] {
  const s: number[] = [0];
  for (const line of lines) {
    const len = line.reduce((acc, seg) => acc + seg.text.length, 0) + 1; // +1 for \n
    s.push(s[s.length - 1] + len);
  }
  return s;
}

/** Binary search: find the last index i where arr[i] <= val */
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
 * buildAlignedLines — pairs every line from both panes so that
 * linesA[i] and linesB[i] always occupy the same visual row.
 *
 * Invariant: outA.length === outB.length always.
 *
 * Algorithm:
 *  1. Build raw lines from each pane's segments.
 *  2. For each chunk, find its first/last line on each side using
 *     server-provided line_offsets when available, falling back to
 *     binary search on char starts.
 *  3. Sort chunk ranges by document position and merge overlapping ones.
 *  4. Walk the sorted ranges, emitting context lines (padded with null
 *     on the shorter side) then chunk lines.
 *  5. Emit trailing lines after the last chunk.
 *  6. Final null-padding ensures equal length on both sides.
 */
export function buildAlignedLines(
  paneA: PaneData,
  paneB: PaneData,
  chunks: Chunk[],
): { linesA: AlignedLine[]; linesB: AlignedLine[] } {
  const rawA = buildLines(paneA);
  const rawB = buildLines(paneB);

  if (chunks.length === 0) {
    const len = Math.max(rawA.length, rawB.length);
    return {
      linesA: Array.from({ length: len }, (_, i) => rawA[i] ?? null),
      linesB: Array.from({ length: len }, (_, i) => rawB[i] ?? null),
    };
  }

  const csA = _lineCharStarts(rawA);
  const csB = _lineCharStarts(rawB);

  const loA = paneA.line_offsets;
  const leA = paneA.line_offset_ends;
  const loB = paneB.line_offsets;
  const leB = paneB.line_offset_ends;

  interface CRange {
    firstA: number; lastA: number; // -1 = chunk absent on this side
    firstB: number; lastB: number;
  }

  // ── Build chunk line ranges ───────────────────────────────────────────────
  const rawRanges: CRange[] = [];
  for (const c of chunks) {
    const sid  = String(c.id);
    const offA = paneA.offsets[sid];
    const endA = paneA.offset_ends[sid];
    const offB = paneB.offsets[sid];
    const endB = paneB.offset_ends[sid];
    const hasA = offA != null && endA != null;
    const hasB = offB != null && endB != null;
    if (!hasA && !hasB) continue;

    const firstA = hasA ? (loA?.[sid] ?? _bsFloor(csA, offA)) : -1;
    const lastA  = hasA ? (leA?.[sid] ?? _bsFloor(csA, Math.max(offA, endA - 1))) : -1;
    const firstB = hasB ? (loB?.[sid] ?? _bsFloor(csB, offB)) : -1;
    const lastB  = hasB ? (leB?.[sid] ?? _bsFloor(csB, Math.max(offB, endB - 1))) : -1;

    rawRanges.push({ firstA, lastA, firstB, lastB });
  }

  rawRanges.sort((a, b) => {
    const pa = a.firstA >= 0 ? a.firstA : a.firstB;
    const pb = b.firstA >= 0 ? b.firstA : b.firstB;
    if (pa !== pb) return pa - pb;
    const qa = a.firstB >= 0 ? a.firstB : a.firstA;
    const qb = b.firstB >= 0 ? b.firstB : b.firstA;
    return qa - qb;
  });

  // ── Merge overlapping / adjacent ranges ───────────────────────────────────
  const ranges: CRange[] = [];
  for (const cr of rawRanges) {
    if (ranges.length === 0) { ranges.push({ ...cr }); continue; }
    const prev     = ranges[ranges.length - 1];
    const overlapA = cr.firstA >= 0 && prev.lastA >= 0 && cr.firstA <= prev.lastA + 1;
    const overlapB = cr.firstB >= 0 && prev.lastB >= 0 && cr.firstB <= prev.lastB + 1;
    if (overlapA || overlapB) {
      if (cr.firstA >= 0) {
        if (prev.firstA < 0) { prev.firstA = cr.firstA; prev.lastA = cr.lastA; }
        else prev.lastA = Math.max(prev.lastA, cr.lastA);
      }
      if (cr.firstB >= 0) {
        if (prev.firstB < 0) { prev.firstB = cr.firstB; prev.lastB = cr.lastB; }
        else prev.lastB = Math.max(prev.lastB, cr.lastB);
      }
    } else {
      ranges.push({ ...cr });
    }
  }

  // ── Build aligned output ──────────────────────────────────────────────────
  const outA: AlignedLine[] = [];
  const outB: AlignedLine[] = [];
  let curA = 0, curB = 0;

  for (const cr of ranges) {
    // Context lines before this chunk.
    // For one-sided chunks, allow the absent side to advance by at most
    // as many lines as the present side, capped by available raw lines.
    const ctxA_native = cr.firstA >= 0 ? Math.max(0, cr.firstA - curA) : 0;
    const ctxB_native = cr.firstB >= 0 ? Math.max(0, cr.firstB - curB) : 0;

    const ctxA = cr.firstA >= 0
      ? ctxA_native
      : Math.min(ctxB_native, Math.max(0, rawA.length - curA));
    const ctxB = cr.firstB >= 0
      ? ctxB_native
      : Math.min(ctxA_native, Math.max(0, rawB.length - curB));

    const ctxLen = Math.max(ctxA, ctxB);
    for (let i = 0; i < ctxLen; i++) {
      outA.push(i < ctxA ? rawA[curA + i] : null);
      outB.push(i < ctxB ? rawB[curB + i] : null);
    }
    curA += ctxA;
    curB += ctxB;

    // Chunk rows
    const countA   = cr.firstA >= 0 ? Math.max(1, cr.lastA - cr.firstA + 1) : 0;
    const countB   = cr.firstB >= 0 ? Math.max(1, cr.lastB - cr.firstB + 1) : 0;
    const chunkLen = Math.max(countA, countB, 1);

    for (let i = 0; i < chunkLen; i++) {
      outA.push(i < countA ? (rawA[curA + i] ?? null) : null);
      outB.push(i < countB ? (rawB[curB + i] ?? null) : null);
    }
    curA += countA;
    curB += countB;
  }

  // Trailing lines after the last chunk
  const tailA   = rawA.length - curA;
  const tailB   = rawB.length - curB;
  const tailLen = Math.max(tailA, tailB);
  for (let i = 0; i < tailLen; i++) {
    outA.push(i < tailA ? rawA[curA + i] : null);
    outB.push(i < tailB ? rawB[curB + i] : null);
  }

  // Guarantee invariant: equal length
  const maxLen = Math.max(outA.length, outB.length);
  while (outA.length < maxLen) outA.push(null);
  while (outB.length < maxLen) outB.push(null);

  return { linesA: outA, linesB: outB };
}

// ── Context folding ───────────────────────────────────────────────────────────

/**
 * foldUnchangedLines — collapses runs of unchanged rows more than contextLines
 * rows away from any chunk row into fold placeholders.
 *
 * Returns foldMap so DiffViewer can expand folds using the exact raw-array
 * slice without fragile rawIdx reconstruction.
 */
export function foldUnchangedLines(
  linesA: AlignedLine[],
  linesB: AlignedLine[],
  contextLines: number = CONTEXT_LINES,
): {
  linesA:  AlignedLine[];
  linesB:  AlignedLine[];
  foldMap: Map<number, FoldMapEntry>;
} {
  if (!isFinite(contextLines) || contextLines >= linesA.length) {
    return { linesA, linesB, foldMap: new Map() };
  }

  const n      = linesA.length;
  const anchor = new Uint8Array(n); // 0 = foldable, 1 = anchor

  for (let i = 0; i < n; i++) {
    const a = linesA[i];
    const b = linesB[i];
    const isChunkRow =
      (Array.isArray(a) && a.some((s) => s.chunkId != null)) ||
      (Array.isArray(b) && b.some((s) => s.chunkId != null));
    if (isChunkRow) {
      const lo = Math.max(0, i - contextLines);
      const hi = Math.min(n - 1, i + contextLines);
      for (let d = lo; d <= hi; d++) anchor[d] = 1;
    }
  }

  const outA:    AlignedLine[] = [];
  const outB:    AlignedLine[] = [];
  const foldMap  = new Map<number, FoldMapEntry>();

  let foldCount      = 0;
  let foldHasGap     = false;
  let foldKeyCounter = 0;
  let foldRawStart   = 0;

  const flushFold = () => {
    if (foldCount > 0) {
      const key = foldKeyCounter++;
      outA.push({ type: "fold", count: foldCount, key, hasGap: foldHasGap });
      outB.push({ type: "fold", count: foldCount, key, hasGap: foldHasGap });
      foldMap.set(key, { rawStart: foldRawStart, count: foldCount });
      foldCount  = 0;
      foldHasGap = false;
    }
  };

  for (let i = 0; i < n; i++) {
    if (anchor[i]) {
      flushFold();
      outA.push(linesA[i]);
      outB.push(linesB[i]);
    } else {
      if (foldCount === 0) foldRawStart = i;
      if (linesA[i] === null || linesB[i] === null) foldHasGap = true;
      foldCount++;
    }
  }

  flushFold();

  return { linesA: outA, linesB: outB, foldMap };
}

// ── Inner virtualised renderer ────────────────────────────────────────────────

interface InnerProps {
  lines:          AlignedLine[];
  allChunkTokens: Map<number, WordToken[]>;
  pane:           PaneData;
  kindMap:        Map<number, ChunkKind>;
  activeChunkId:  number | null;
  activeChunkCSS: string;
  scrollRef:      React.RefObject<HTMLDivElement>;
  dark:           boolean;
  onChunkClick?:  (chunkId: number) => void;
  onScroll:       () => void;
  onVirtualizerReady: (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => void;
  onUnfold:       (key: number) => void;
}

function DiffPaneInner({
  lines,
  allChunkTokens,
  pane,
  kindMap,
  activeChunkId,
  activeChunkCSS,
  scrollRef,
  dark,
  onChunkClick,
  onScroll,
  onVirtualizerReady,
  onUnfold,
}: InnerProps) {
  "use no memo";

  const virtualizer = useVirtualizer({
    count:            lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      if (i >= lines.length) return ROW_HEIGHT_PX;
      const l = lines[i];
      if (l && !Array.isArray(l) && "type" in l && l.type === "fold") return 20;
      return ROW_HEIGHT_PX;
    },
    measureElement: (el) => el?.getBoundingClientRect().height ?? ROW_HEIGHT_PX,
    getItemKey:     (index) => index,
    overscan:       8,
  });

  useEffect(() => { onVirtualizerReady(virtualizer); }, [virtualizer, onVirtualizerReady]);

  // Re-measure on line count or wrap mode change
  useEffect(() => {
    const id = requestAnimationFrame(() => { virtualizer.measure(); });
    return () => cancelAnimationFrame(id);
  }, [lines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const measureRef = useCallback(
    (el: Element | null) => { if (el) virtualizer.measureElement(el); },
    [virtualizer],
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onChunkClick && !onUnfold) return;
    const span = (e.target as HTMLElement).closest("[data-chunk-id]") as HTMLElement | null;
    if (span?.dataset.chunkId) {
      const id = Number(span.dataset.chunkId);
      if (!isNaN(id)) onChunkClick?.(id);
    }
    const fold = (e.target as HTMLElement).closest("[data-fold-key]") as HTMLElement | null;
    if (fold?.dataset.foldKey) onUnfold(Number(fold.dataset.foldKey));
  }, [onChunkClick, onUnfold]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-auto"
      onScroll={onScroll}
      onClick={handleClick}
    >
      {activeChunkCSS && <style>{activeChunkCSS}</style>}

      <div
        className="font-mono text-[11.5px] text-slate-700 dark:text-[#c8d8e8] px-3 py-1 relative"
        style={{
          height:       virtualizer.getTotalSize(),
          lineHeight:   "1.6",
          overflowWrap: "normal",
          wordBreak:    "normal",
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          // Bounds guard — virtualizer can hold stale indices during re-render
          if (vRow.index >= lines.length) {
            return (
              <div
                key={`oob-${vRow.index}`}
                data-index={vRow.index}
                ref={measureRef}
                style={{
                  position:  "absolute",
                  top: 0, left: 0, right: 0,
                  transform: `translateY(${vRow.start}px)`,
                  minHeight: ROW_HEIGHT_PX,
                }}
              />
            );
          }

          const item = lines[vRow.index];

          // ── Fold row ──────────────────────────────────────────────────────
          if (item && !Array.isArray(item) && "type" in item && item.type === "fold") {
            const isGapFold = !!item.hasGap;
            const label = isGapFold
              ? `··· ${item.count} line${item.count !== 1 ? "s" : ""} not in this version ···`
              : `··· ${item.count} unchanged line${item.count !== 1 ? "s" : ""} ···`;
            return (
              <div
                key={`fold-${vRow.index}`}
                data-index={vRow.index}
                ref={measureRef}
                data-fold-key={item.key}
                style={{
                  position:       "absolute",
                  top: 0, left: 0, right: 0,
                  transform:      `translateY(${vRow.start}px)`,
                  height:         ROW_HEIGHT_PX,
                  cursor:         "pointer",
                  userSelect:     "none",
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  fontSize:       10,
                  fontFamily:     "monospace",
                  color:          dark ? "rgba(148,163,184,0.7)" : "rgba(100,116,139,0.8)",
                  background:     isGapFold
                    ? (dark ? "rgba(30,15,60,0.85)"  : "rgba(220,210,255,0.55)")
                    : (dark ? "rgba(15,25,41,0.85)"   : "rgba(241,245,249,0.85)"),
                  borderTop:    `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`,
                  borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`,
                }}
              >
                {label}
              </div>
            );
          }

          // ── Gap placeholder row ───────────────────────────────────────────
          if (item === null) {
            return (
              <div
                key={`gap-${vRow.index}`}
                data-index={vRow.index}
                ref={measureRef}
                style={{
                  position:  "absolute",
                  top: 0, left: 0, right: 0,
                  transform: `translateY(${vRow.start}px)`,
                  minHeight: ROW_HEIGHT_PX,
                }}
              >
                <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                  <span className="sticky left-0 z-[1] select-none border-r border-slate-200 bg-white dark:border-white/10 dark:bg-[#0a1020]" />
                  <span
                    style={{
                      display:    "block",
                      minHeight:  ROW_HEIGHT_PX,
                      borderLeft: `2px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"}`,
                      opacity:    0.4,
                    }}
                  />
                </div>
              </div>
            );
          }

          // ── Normal line ───────────────────────────────────────────────────
          const segs       = item as Line;
          const lineNodes: React.ReactNode[] = [];

          const lineChunkId = segs.find((s) => s.chunkId != null)?.chunkId ?? null;
          const lineKind    = lineChunkId != null ? kindMap.get(lineChunkId) : undefined;
          const isModLine   = lineKind === "mod";

          const wordTokens = isModLine && lineChunkId != null
            ? allChunkTokens.get(lineChunkId) ?? null
            : null;

          // Only show word tokens on the FIRST line of a mod chunk
          const prevLineHasThisChunk =
            vRow.index > 0 &&
            vRow.index - 1 < lines.length &&
            Array.isArray(lines[vRow.index - 1]) &&
            (lines[vRow.index - 1] as Line).some((s) => s.chunkId === lineChunkId);

          const lineHasRichText = segs.some((s) => {
            const cfg = pane.tag_cfgs[s.tagName] ?? {};
            return cfg.underline || cfg.overstrike;
          });

          const lineHasInlineWordDiff = segs.some((s) => {
            const cfg = pane.tag_cfgs[s.tagName] ?? {};
            const sk  = _serverPaletteKind(cfg.background);
            return sk === "del" || sk === "add";
          });

          const showWordTokens =
            wordTokens !== null &&
            !prevLineHasThisChunk &&
            !lineHasRichText &&
            !lineHasInlineWordDiff;

          if (showWordTokens && wordTokens) {
            lineNodes.push(
              <span key="word-diff">
                {renderWordTokens(wordTokens, dark)}
              </span>,
            );
          } else {
            for (let si = 0; si < segs.length; si++) {
              const seg   = segs[si];
              const cfg   = pane.tag_cfgs[seg.tagName] ?? {};
              const kind  = seg.chunkId !== null ? kindMap.get(seg.chunkId) : undefined;
              const style = tagToStyle(cfg, dark, kind);

              lineNodes.push(
                seg.chunkId !== null
                  ? <span
                      key={si}
                      style={style}
                      data-chunk-id={String(seg.chunkId)}
                      data-changed={cfg.background ? "true" : undefined}
                    >{seg.text}</span>
                  : <span key={si} style={style}>{seg.text}</span>,
              );
            }
          }

          // Active highlight: only rows that actually have a painted segment
          const lineHasPaintedSegment = lineChunkId != null && segs.some((s) => {
            if (s.chunkId == null) return false;
            const cfg = pane.tag_cfgs[s.tagName] ?? {};
            return !!cfg.background;
          });

          const isActiveRow =
            activeChunkId !== null &&
            lineChunkId === activeChunkId &&
            lineHasPaintedSegment;
          const activeHl  = isActiveRow && lineKind ? ACTIVE_HL[lineKind] : null;
          const isEmpLine = lineKind === "emp" && lineChunkId != null;

          return (
            <div
              key={`row-${vRow.index}`}
              data-index={vRow.index}
              ref={measureRef}
              style={{
                position:  "absolute",
                top: 0, left: 0, right: 0,
                transform: `translateY(${vRow.start}px)`,
                minHeight: ROW_HEIGHT_PX,
                borderLeft: activeHl
                  ? `3px solid ${activeHl.border}`
                  : isEmpLine
                  ? "3px solid rgba(167,139,250,0.45)"
                  : "3px solid transparent",
                backgroundColor: activeHl ? activeHl.bg : undefined,
                transition: "border-left-color 0.12s, background-color 0.12s",
              }}
            >
              <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                <span className="sticky left-0 z-[1] select-none border-r border-slate-200 bg-white pr-2 text-right text-[10px] font-medium tabular-nums text-slate-400 dark:border-white/10 dark:bg-[#0a1020] dark:text-slate-500">
                  {vRow.index + 1}
                </span>
                <span className="whitespace-pre">
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

// ── Props ─────────────────────────────────────────────────────────────────────

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
  onScrollLeft?:     (scrollLeft: number) => void;
  syncScrollLeft?:   number | null;
  headerStats?:      HeaderStat[];
  onJumpToFirst?:    () => void;
  wrapLines?:        boolean;
  alignedLines?:     AlignedLine[];
  contextLines?:     number;
  onUnfoldRow?:      (foldKey: number) => void;
  isScrollSource?:   boolean;
}

// ── DiffPane (outer shell) ────────────────────────────────────────────────────

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
      onScrollLeft,
      syncScrollLeft,
      headerStats,
      onJumpToFirst,
      alignedLines,
      onUnfoldRow,
      isScrollSource = false,
    },
    ref,
  ) => {
    const scrollRef               = useRef<HTMLDivElement>(null);
    const syncingRef              = useRef(false);
    const syncClearTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hSyncRef                = useRef(false);
    const scrollFrameRef          = useRef<number | null>(null);
    const lastReceivedFractionRef = useRef(-1);
    const virtualizerRef          = useRef<ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null>(null);
    const { dark }                = useTheme();

    const lines = useMemo(
      () => alignedLines ?? buildLines(pane).map((l): AlignedLine => l),
      [alignedLines, pane],
    );

    // O(1) chunk-id → first line-index lookup built once per lines change
    const chunkLineMap = useMemo(() => {
      const m = new Map<number, number>();
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (Array.isArray(line)) {
          for (const s of line) {
            if (s.chunkId != null && !m.has(s.chunkId)) {
              m.set(s.chunkId, li);
            }
          }
        }
      }
      return m;
    }, [lines]);

    const kindMap = useMemo(() => {
      const m = new Map<number, ChunkKind>();
      for (const c of chunks) m.set(c.id, c.kind);
      return m;
    }, [chunks]);

    const allChunkTokens = useMemo<Map<number, WordToken[]>>(() => {
      const map = new Map<number, WordToken[]>();
      for (const ch of chunks) {
        if (ch.kind !== "mod") continue;
        const tokens = buildWordTokens(ch, side);
        if (tokens) map.set(ch.id, tokens);
      }
      return map;
    }, [chunks, side]);

    const activeChunkCSS = useMemo(() => {
      if (activeChunkId === null) return "";
      const kind = kindMap.get(activeChunkId);
      if (!kind) return "";
      const ahl = ACTIVE_HL[kind] ?? ACTIVE_HL.mod;
      const sel = `[data-chunk-id="${activeChunkId}"]`;
      if (kind === "mod") {
        return `${sel} { border-radius: 2px; outline: 2px solid ${ahl.border}; outline-offset: 0px; }`;
      }
      return (
        `${sel} { background-color: ${ahl.bg} !important; border-radius: 2px;` +
        ` outline: 2px solid ${ahl.border}; outline-offset: 1px; }`
      );
    }, [activeChunkId, kindMap]);

    const handleVirtualizerReady = useCallback(
      (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => {
        virtualizerRef.current = v;
      },
      [],
    );

    // Horizontal scroll sync from sibling pane
    useEffect(() => {
      const el = scrollRef.current;
      if (!el || syncScrollLeft == null) return;
      if (hSyncRef.current) return;
      hSyncRef.current = true;
      el.scrollLeft = syncScrollLeft;
      requestAnimationFrame(() => { hSyncRef.current = false; });
    }, [syncScrollLeft]);

    // ── Imperative handle ────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      scrollToChunk(chunkId: number, _orderedIds?: number[], scrollFraction?: number) {
        const container   = scrollRef.current;
        const virtualizer = virtualizerRef.current;
        if (!container) return;

        syncingRef.current = true;
        const clearSync = () => { syncingRef.current = false; };

        if (virtualizer) {
          const targetLine = chunkLineMap.get(chunkId) ?? -1;
          if (targetLine >= 0) {
            try {
              const r = virtualizer.scrollToIndex(targetLine, { align: "start", behavior: "auto" }) as unknown;
              if (r != null && typeof r === "object" && "catch" in r) {
                (r as Promise<void>).catch(() => {});
              }
            } catch { /* sync throw before first measure */ }
            if (syncClearTimerRef.current !== null) clearTimeout(syncClearTimerRef.current);
            syncClearTimerRef.current = setTimeout(clearSync, 120);
            return;
          }
        }

        if (scrollFraction !== undefined) {
          const maxScroll = container.scrollHeight - container.clientHeight;
          if (maxScroll > 0) {
            const nextTop = Math.max(0, Math.min(1, scrollFraction)) * maxScroll;
            if (Math.abs(container.scrollTop - nextTop) < 2) {
              syncingRef.current = false;
              return;
            }
            container.scrollTop = nextTop;
            if (syncClearTimerRef.current !== null) clearTimeout(syncClearTimerRef.current);
            syncClearTimerRef.current = setTimeout(clearSync, 120);
            return;
          }
        }
        syncingRef.current = false;
      },

      scrollToFraction(fraction: number) {
        const container = scrollRef.current;
        if (!container) return;

        if (syncClearTimerRef.current !== null) clearTimeout(syncClearTimerRef.current);
        syncingRef.current = true;
        lastReceivedFractionRef.current = fraction;

        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        const nextTop   = Math.max(0, Math.min(1, fraction)) * maxScroll;

        if (Math.abs(container.scrollTop - nextTop) < 2) {
          syncingRef.current = false;
          return;
        }

        container.scrollTop = nextTop;
        syncClearTimerRef.current = setTimeout(() => {
          syncingRef.current        = false;
          syncClearTimerRef.current = null;
        }, 160);
      },
    }), [lines]);

    // RAF-throttled scroll handler — emits fraction and prevents sync echo
    const handleScroll = useCallback(() => {
      const container = scrollRef.current;
      if (!container) return;

      if (!hSyncRef.current && onScrollLeft) {
        onScrollLeft(container.scrollLeft);
      }

      if (syncingRef.current) return;
      if (!onScrollFraction) return;
      if (scrollFrameRef.current !== null) return;

      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (!container) return;

        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;

        const emitFraction = container.scrollTop / maxScroll;
        const ROW_TOL =
          ROW_HEIGHT_PX /
          Math.max(1, container.scrollHeight);
        if (Math.abs(emitFraction - lastReceivedFractionRef.current) <= ROW_TOL) {
          lastReceivedFractionRef.current = -1;
          return;
        }
        lastReceivedFractionRef.current = -1;
        onScrollFraction(emitFraction);
      });
    }, [onScrollFraction, onScrollLeft]);

    useEffect(() => {
      return () => {
        if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
        if (syncClearTimerRef.current !== null) clearTimeout(syncClearTimerRef.current);
      };
    }, []);

    const handleUnfold = useCallback((key: number) => {
      onUnfoldRow?.(key);
    }, [onUnfoldRow]);

    const sideBadge     = side === "a" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white";
    const hasStats      = headerStats && headerStats.length > 0;
    const realLineCount = lines.filter((l) => l !== null && Array.isArray(l)).length;

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className={`flex-shrink-0 text-[9px] font-black tracking-widest px-2 py-0.5 rounded ${sideBadge}${
              isScrollSource ? " ring-2 ring-white/60 ring-offset-1" : ""
            }`}>
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
              {realLineCount.toLocaleString()} lines
            </span>
          </div>
        </div>

        <DiffPaneInner
          lines={lines}
          allChunkTokens={allChunkTokens}
          pane={pane}
          kindMap={kindMap}
          activeChunkId={activeChunkId}
          activeChunkCSS={activeChunkCSS}
          scrollRef={scrollRef}
          dark={dark}
          onChunkClick={onChunkClick}
          onScroll={handleScroll}
          onVirtualizerReady={handleVirtualizerReady}
          onUnfold={handleUnfold}
        />
      </div>
    );
  },
);

DiffPane.displayName = "DiffPane";
export default DiffPane;