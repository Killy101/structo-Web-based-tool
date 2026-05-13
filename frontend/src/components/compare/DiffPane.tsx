"use client";

/**
 * DiffPane.tsx — Virtualised side-by-side diff pane
 *
 * CHANGES vs ORIGINAL
 * ───────────────────
 * Fix 1 · Context folding (Beyond Compare style)
 *   buildAlignedLines() output is post-processed by foldUnchangedLines() which
 *   collapses runs of unchanged rows into a single { type:"fold", count:N }
 *   placeholder.  Clicking a fold row expands it.  Default context = 3 lines
 *   either side of a chunk (matches Beyond Compare default).
 *
 * Fix 2 · Word-level inline diff for ALL visible MOD chunks (not just active)
 *   A modTokenMap is built once per render from all chunks.  Every MOD line is
 *   rendered with red/green word tokens, not just the active chunk.
 *
 * Fix 3 · Horizontal scroll sync between panes
 *   Exported scrollRef exposed via DiffPaneHandle.  DiffViewer wires left-scroll
 *   sync across both panes.
 *
 * Fix 4 · Strikethrough (strike) kind rendered with pink + line-through
 *   tagToStyle honours cfg.overstrike inside EMP and strike chunks by applying
 *   DEL-pink instead of the EMP-blue colour.
 *
 * Fix 5 · Gap rows styled as Beyond Compare "empty slot" (striped dark band)
 *
 * Fix 6 · Alignment: chunk line ranges sourced from server line_offsets when
 *   available, falling back to binary-search on char offsets.
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

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_HEIGHT_PX  = 24;
/** Lines of unchanged context to show either side of each chunk.
 *  10 gives enough legal-document context; the UI exposes a "Show all" toggle
 *  that passes Infinity to foldUnchangedLines to disable folding entirely. */
const CONTEXT_LINES  = 10;

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
  onScrollLeft?:     (scrollLeft: number) => void;   // Fix 3: horizontal sync
  syncScrollLeft?:   number | null;                  // Fix 3: receive horiz sync
  headerStats?:      HeaderStat[];
  onJumpToFirst?:    () => void;
  wrapLines?:        boolean;
  alignedLines?:     AlignedLine[];
  contextLines?:     number;   // override CONTEXT_LINES per-instance
  onUnfoldRow?:      (foldIndex: number) => void;   // Fix 1: forward unfold event
  /** When true, briefly highlights the pane header badge to indicate this pane
   *  was the scroll leader (triggered by user scrolling in this pane). */
  isScrollSource?:   boolean;
}

interface InnerProps {
  lines:          AlignedLine[];
  allChunkTokens: Map<number, WordToken[]>;   // Fix 2: all MOD chunks
  pane:           PaneData;
  kindMap:        Map<number, ChunkKind>;
  activeChunkId:  number | null;             // used for row-level active highlight
  activeChunkCSS: string;
  scrollRef:      React.RefObject<HTMLDivElement>;
  wrapLines:      boolean;
  dark:           boolean;
  onChunkClick?:  (chunkId: number) => void;
  onScroll:       () => void;
  onVirtualizerReady: (v: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>) => void;
  onUnfold:       (index: number) => void;   // Fix 1: expand fold rows
}

// ── Active highlight colours per kind ────────────────────────────────────────

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
  // legacy
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
  // legacy
  "#1a4d2e": "#86efac",
  "#6e1c1a": "#fda4af",
  "#5a3e00": "#fdba74",
  "#3d007a": "#93c5fd",
};

// ── Line types ────────────────────────────────────────────────────────────────

interface LineSeg {
  text:    string;
  tagName: string;
  chunkId: number | null;
}

type Line = LineSeg[];

/** null = gap placeholder; { type:"fold" } = collapsed unchanged/gap rows */
export type AlignedLine = Line | null | { type: "fold"; count: number; hasGap?: boolean };

// ── Colour helper ─────────────────────────────────────────────────────────────

/**
 * Recognised server-emitted backgrounds. The server's precompute() paints
 * individual words with these backgrounds when it has done word-level diff
 * inside a MOD chunk. We must preserve these inline so the user sees the
 * actual changed words, not just a uniform block highlight.
 */
const SERVER_DEL_BG = new Set(["#fecdd3", "#ffd7d5"]);     // pink (DEL palette)
const SERVER_ADD_BG = new Set(["#bbf7d0", "#ccffd8"]);     // green (ADD palette)
const SERVER_MOD_BG = new Set(["#fed7aa", "#fff3b0"]);     // orange (MOD palette)
const SERVER_EMP_BG = new Set(["#bfdbfe", "#ead8ff"]);     // blue (EMP palette)

function _serverPaletteKind(bg?: string): "del" | "add" | "mod" | "emp" | null {
  if (!bg) return null;
  const k = bg.toLowerCase();
  if (SERVER_DEL_BG.has(k)) return "del";
  if (SERVER_ADD_BG.has(k)) return "add";
  if (SERVER_MOD_BG.has(k)) return "mod";
  if (SERVER_EMP_BG.has(k)) return "emp";
  return null;
}

function tagToStyle(
  cfg: TagConfig,
  dark: boolean,
  kind?: ChunkKind,
  forceStrike?: boolean,
): React.CSSProperties {
  const s: React.CSSProperties = {};

  /**
   * ISSUE 1 FIX — Excessive highlighting root cause:
   *
   * The server (precompute) does word-level diff for MOD chunks:
   *   • Changed words  → cfg.background = DEL_BG (pink) or ADD_BG (green)
   *   • Unchanged words → cfg.background = null (no marking)
   *   • Whole-block MOD (word-diff skipped, >200 words) → ALL cfg.background = null
   *
   * Previously, tagToStyle applied the MOD orange (#fed7aa) to EVERY segment
   * that belonged to a MOD chunk (kind === "mod"), regardless of whether the
   * server had explicitly marked that word as changed. This painted the entire
   * paragraph orange even when only 2 words out of 50 changed.
   *
   * Fix: when kind === "mod" and cfg.background is null (server left this word
   * unmarked), treat the segment as plain text (effectiveKind = undefined).
   * Changed words keep their server-assigned DEL/ADD color via isInlineWordDiff.
   */
  const serverKind = _serverPaletteKind(cfg.background);
  const isInlineWordDiff =
    kind === "mod" && (serverKind === "del" || serverKind === "add");

  // For MOD chunks: only colour segments the server explicitly marked.
  // Unchanged words within a MOD block → effectiveKind = undefined → plain text.
  // ADD and DEL chunks → server marks all spans → effectiveKind preserves kind.
  const effectiveKind: ChunkKind | undefined =
    isInlineWordDiff && serverKind ? (serverKind as ChunkKind) :
    kind === "mod" && !cfg.background ? undefined :          // ← KEY FIX
    kind;

  if (cfg.font) {
    if (cfg.font.style.includes("bold"))   s.fontWeight = "bold";
    if (cfg.font.style.includes("italic")) s.fontStyle  = "italic";
  }

  // Strike/overstrike: line-through + pink, regardless of kind.
  const isStrikeContent =
    effectiveKind === "strike" ||
    (effectiveKind === "emp" && (cfg.overstrike || forceStrike));

  if (isStrikeContent) {
    s.backgroundColor = dark ? "rgba(244,63,94,0.22)"  : "#fecdd3";
    s.color           = dark ? "#fda4af"                : "#881337";
    s.textDecoration  = "line-through";
  } else if (effectiveKind === "add") {
    s.backgroundColor = dark ? "rgba(34,197,94,0.22)"  : "#ccffd8";
    s.color           = dark ? "#86efac"                : "#14532d";
  } else if (effectiveKind === "del") {
    s.backgroundColor = dark ? "rgba(244,63,94,0.22)"  : "#fecdd3";
    s.color           = dark ? "#fda4af"                : "#881337";
    // Inline DEL words inside a MOD chunk also get strikethrough — matches BC.
    if (isInlineWordDiff) s.textDecoration = "line-through";
  } else if (effectiveKind === "mod") {
    // Patch 5: If the source span was struck through in the PDF, render it
    // with the DEL palette + line-through instead of MOD orange.
    if (cfg.overstrike) {
      s.backgroundColor = dark ? "rgba(244,63,94,0.22)" : "#fecdd3";
      s.color           = dark ? "#fda4af"               : "#881337";
      s.textDecoration  = "line-through";
    } else {
      s.backgroundColor = dark ? "rgba(249,115,22,0.22)" : "#fed7aa";
      s.color           = dark ? "#fdba74"                : "#7c2d12";
    }
  } else if (effectiveKind === "emp") {
    s.backgroundColor = dark ? "rgba(96,165,250,0.22)" : "#bfdbfe";
    s.color           = dark ? "#93c5fd"                : "#1e3a8a";
  } else {
    // No kind: respect server-provided colors directly (rare path: unchanged
    // spans that happen to carry a background — emp_diff word markers etc.)
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
  if (cfg.underline  && effectiveKind !== undefined) decorations.push("underline");
  // Line-through from cfg.overstrike is only applied to unstyled (context)
  // segments — effectiveKind === undefined.
  //
  // Rationale:
  //   • "strike" / "emp"+overstrike → handled above by isStrikeContent, which
  //     already sets textDecoration="line-through" with the correct pink colour.
  //   • "mod" / "add" / "del" → must NEVER receive line-through from this path.
  //     A PDF span may carry strikeout formatting on text that is part of a MOD/
  //     ADD/DEL chunk. Showing orange/green/pink + strikethrough would visually
  //     conflate "content was struck in the PDF" with "this diff marks a
  //     legislative repeal", confusing reviewers.
  //   • undefined (no diff kind) → safe to mirror the source PDF's overstrike
  //     decoration so unchanged struck-through content renders correctly.
  if (cfg.overstrike && !isStrikeContent && !isInlineWordDiff && effectiveKind === undefined)
    decorations.push("line-through");
  if (decorations.length > 0 && !isStrikeContent && !isInlineWordDiff) {
    s.textDecoration = decorations.join(" ");
  }

  return s;
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
          borderRadius: 2, padding: "0 1px",
          textDecoration: "line-through",
        }}>{tok.value}</span>
      );
    }
    if (tok.type === "insert") {
      return (
        <span key={`i-${i}`} style={{
          backgroundColor: dark ? "rgba(16,185,129,0.28)" : "#ccffd8",
          color:           dark ? "#6ee7b7" : "#1a4d2e",
          borderRadius: 2, padding: "0 1px",
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

// ── buildLines ────────────────────────────────────────────────────────────────

function buildLines(pane: PaneData): Line[] {
  const { segments, offsets, offset_ends } = pane;

  const ranges: { id: number; start: number; end: number }[] = [];
  for (const [cid, start] of Object.entries(offsets)) {
    const id = Number(cid);
    ranges.push({ id, start, end: offset_ends[cid] ?? start + 999_999 });
  }
  ranges.sort((a, b) => a.start - b.start);

  const lines: Line[] = [[]];;
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

function _lineCharStarts(lines: Line[]): number[] {
  const s: number[] = [0];
  for (const line of lines) {
    const len = line.reduce((acc, seg) => acc + seg.text.length, 0) + 1;
    s.push(s[s.length - 1] + len);
  }
  return s;
}

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
 * buildAlignedLines — pairs lines from two panes at chunk boundaries,
 * inserting null gap placeholders on the shorter side so both arrays have
 * equal length and linesA[i] / linesB[i] occupy the same row.
 *
 * Fix 6: Uses pane.line_offsets (server-emitted line numbers) when available,
 * falling back to char-offset binary search.  This eliminates the accumulated
 * rounding error that caused 1–2 row drift on long documents.
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

  // Try to use server-emitted line numbers; fall back to char-offset search
  const loA = paneA.line_offsets;
  const leA = paneA.line_offset_ends;
  const loB = paneB.line_offsets;
  const leB = paneB.line_offset_ends;

  interface CRange {
    firstA: number; lastA: number;
    firstB: number; lastB: number;
  }

  const rawRanges: CRange[] = [];
  for (const c of chunks) {
    const sidStr = String(c.id);
    const offA = paneA.offsets[sidStr];
    const endA = paneA.offset_ends[sidStr];
    const offB = paneB.offsets[sidStr];
    const endB = paneB.offset_ends[sidStr];
    const hasA = offA != null && rawA.length > 0;
    const hasB = offB != null && rawB.length > 0;
    if (!hasA && !hasB) continue;

    // Use server line numbers if present, otherwise fall back to char search
    const firstA = hasA
      ? (loA?.[sidStr] ?? _bsFloor(csA, offA))
      : -1;
    const lastA = hasA
      ? (leA?.[sidStr] ?? _bsFloor(csA, Math.max(offA, (endA ?? offA + 1) - 1)))
      : -1;
    const firstB = hasB
      ? (loB?.[sidStr] ?? _bsFloor(csB, offB))
      : -1;
    const lastB = hasB
      ? (leB?.[sidStr] ?? _bsFloor(csB, Math.max(offB, (endB ?? offB + 1) - 1)))
      : -1;

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

  // Merge overlapping / adjacent ranges
  const ranges: CRange[] = [];
  for (const cr of rawRanges) {
    if (ranges.length === 0) { ranges.push({ ...cr }); continue; }
    const prev = ranges[ranges.length - 1];
    const overlapA = cr.firstA >= 0 && prev.lastA >= 0 && cr.firstA <= prev.lastA + 1;
    const overlapB = cr.firstB >= 0 && prev.lastB >= 0 && cr.firstB <= prev.lastB + 1;
    if (overlapA || overlapB) {
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

  const outA: AlignedLine[] = [];
  const outB: AlignedLine[] = [];
  let curA = 0, curB = 0;

  for (const cr of ranges) {
    const ctxA_native = cr.firstA >= 0 ? cr.firstA - curA : 0;
    const ctxB_native = cr.firstB >= 0 ? cr.firstB - curB : 0;
    const ctxA = cr.firstA >= 0
      ? ctxA_native
      : Math.min(ctxB_native, Math.max(0, rawA.length - curA));
    const ctxB = cr.firstB >= 0
      ? ctxB_native
      : Math.min(ctxA_native, Math.max(0, rawB.length - curB));
    const ctxCount = Math.max(ctxA, ctxB, 0);
    const extraA = Math.max(ctxA - ctxB, 0);
    const extraB = Math.max(ctxB - ctxA, 0);

    for (let i = 0; i < ctxCount; i++) {
      const aIdx = i - extraB;
      const bIdx = i - extraA;
      const lineA = (aIdx >= 0 && aIdx < ctxA && curA + aIdx < rawA.length) ? rawA[curA + aIdx] : null;
      const lineB = (bIdx >= 0 && bIdx < ctxB && curB + bIdx < rawB.length) ? rawB[curB + bIdx] : null;
      outA.push(lineA);
      outB.push(lineB);
    }
    curA = cr.firstA >= 0 ? cr.firstA : curA + ctxA;
    curB = cr.firstB >= 0 ? cr.firstB : curB + ctxB;

    const countA   = cr.firstA >= 0 ? Math.max(1, cr.lastA - cr.firstA + 1) : 0;
    const countB   = cr.firstB >= 0 ? Math.max(1, cr.lastB - cr.firstB + 1) : 0;
    const maxCount = Math.max(countA, countB, 1);
    for (let i = 0; i < maxCount; i++) {
      outA.push(i < countA ? rawA[curA + i] : null);
      outB.push(i < countB ? rawB[curB + i] : null);
    }
    // FIX Issue 3c: advance curA/curB by the lines actually consumed in BOTH
    // the context region AND the chunk rows.  Previously, ADD-only ranges
    // (countA=0) left curA at the same position, so the next range's ctxA_native
    // was computed relative to the un-advanced curA, inflating the context size
    // and inserting spurious null gaps before the next chunk.
    // The correct advance is: if this side had a chunk, move past it; otherwise
    // move past however many context lines were consumed from this side.
    curA = cr.firstA >= 0 ? cr.firstA + countA : curA + ctxA;
    curB = cr.firstB >= 0 ? cr.firstB + countB : curB + ctxB;
  }

  // Trailing context
  const tailA = rawA.length - curA;
  const tailB = rawB.length - curB;
  const trailCount = Math.max(tailA, tailB, 0);
  const extraTailA = Math.max(tailA - tailB, 0);
  const extraTailB = Math.max(tailB - tailA, 0);
  for (let i = 0; i < trailCount; i++) {
    const aIdx = i - extraTailB;
    const bIdx = i - extraTailA;
    outA.push((aIdx >= 0 && aIdx < tailA) ? rawA[curA + aIdx] : null);
    outB.push((bIdx >= 0 && bIdx < tailB) ? rawB[curB + bIdx] : null);
  }

  return { linesA: outA, linesB: outB };
}

// ── Fix 1: Context folding ────────────────────────────────────────────────────

/**
 * Collapse runs of unchanged/gap rows that are farther than contextLines rows
 * from any real chunk row into fold placeholders.
 *
 * FIX Issue 1c + Issue 2:
 *   Previously null-gap rows (`a === null || b === null`) were treated as
 *   "chunk-adjacent" (anchor[i] = true), so they were NEVER folded.  For a
 *   document with an 18 K-line size mismatch, this produced thousands of
 *   individual blank rows that rendered as blank pages.
 *
 *   Now:
 *   - Only rows that ACTUALLY CONTAIN a chunk segment (chunkId != null) are
 *     treated as anchors.  Gap rows are treated the same as unchanged rows and
 *     ARE folded when they are far from any real chunk.
 *   - Pass contextLines = Infinity (or a very large number) to disable folding
 *     entirely — used by the "Show all context" toolbar toggle.
 *   - The fold placeholder carries both count and a `hasGap` flag so the
 *     renderer can style gap-folds differently from unchanged-line folds.
 */
export function foldUnchangedLines(
  linesA: AlignedLine[],
  linesB: AlignedLine[],
  contextLines: number = CONTEXT_LINES,
): { linesA: AlignedLine[]; linesB: AlignedLine[] } {
  // Infinity (show-all mode) — return as-is without allocating new arrays
  if (!isFinite(contextLines) || contextLines >= linesA.length) {
    return { linesA, linesB };
  }

  const n = linesA.length;

  // A row is an "anchor" only when it carries at least one diff-tagged segment.
  // Null gaps and plain unchanged lines are NOT anchors — they can be folded.
  const anchor = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const a = linesA[i];
    const b = linesB[i];
    const isChunkRow =
      (Array.isArray(a) && a.some((s) => s.chunkId != null)) ||
      (Array.isArray(b) && b.some((s) => s.chunkId != null));
    if (isChunkRow) {
      for (let d = Math.max(0, i - contextLines); d <= Math.min(n - 1, i + contextLines); d++) {
        anchor[d] = true;
      }
    }
  }

  const outA: AlignedLine[] = [];
  const outB: AlignedLine[] = [];
  let foldCount = 0;
  let foldHasGap = false;   // true if this fold run contains null-gap rows

  const flushFold = () => {
    if (foldCount > 0) {
      outA.push({ type: "fold", count: foldCount, hasGap: foldHasGap });
      outB.push({ type: "fold", count: foldCount, hasGap: foldHasGap });
      foldCount = 0;
      foldHasGap = false;
    }
  };

  for (let i = 0; i < n; i++) {
    if (anchor[i]) {
      flushFold();
      outA.push(linesA[i]);
      outB.push(linesB[i]);
    } else {
      if (linesA[i] === null || linesB[i] === null) foldHasGap = true;
      foldCount++;
    }
  }
  flushFold();

  return { linesA: outA, linesB: outB };
}

// ── Inner virtualised renderer ────────────────────────────────────────────────

function DiffPaneInner({
  lines,
  allChunkTokens,
  pane,
  kindMap,
  activeChunkId,
  activeChunkCSS,
  scrollRef,
  wrapLines,
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
    estimateSize:     (i) => {
      const l = lines[i];
      if (l && !Array.isArray(l) && "type" in l && l.type === "fold") return 20;
      return wrapLines ? 48 : ROW_HEIGHT_PX;
    },
    getItemKey:  (index) => index,
    overscan:    wrapLines ? 10 : 25,
  });

  useEffect(() => { onVirtualizerReady(virtualizer); });
  useEffect(() => { virtualizer.measure(); }, [lines.length, wrapLines, virtualizer]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onChunkClick) return;
    const span = (e.target as HTMLElement).closest("[data-chunk-id]") as HTMLElement | null;
    if (span?.dataset.chunkId) {
      const id = Number(span.dataset.chunkId);
      if (!isNaN(id)) onChunkClick(id);
    }
    const fold = (e.target as HTMLElement).closest("[data-fold-index]") as HTMLElement | null;
    if (fold?.dataset.foldIndex) onUnfold(Number(fold.dataset.foldIndex));
  }, [onChunkClick, onUnfold]);

  // Striped pattern for Beyond Compare-style gap rows
  const gapPattern = dark
    ? "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,0.03) 3px,rgba(255,255,255,0.03) 6px)"
    : "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(0,0,0,0.04) 3px,rgba(0,0,0,0.04) 6px)";

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
          overflowWrap: wrapLines ? "break-word" : "normal",
          wordBreak:    wrapLines ? "break-word" : "normal",
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const item = lines[vRow.index];

          // ── Fix 1: Fold row ───────────────────────────────────────────────
          if (item && !Array.isArray(item) && "type" in item && item.type === "fold") {
            const isGapFold = !!item.hasGap;
            const label = isGapFold
              ? `··· ${item.count} line${item.count !== 1 ? "s" : ""} not in this version ···`
              : `··· ${item.count} unchanged line${item.count !== 1 ? "s" : ""} ···`;
            return (
              <div
                key={`fold-${vRow.index}`}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                data-fold-index={vRow.index}
                style={{
                  position:  "absolute",
                  top: 0, left: 0, right: 0,
                  transform: `translateY(${vRow.start}px)`,
                  height:    20,
                  cursor:    "pointer",
                  userSelect: "none",
                  display:   "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize:  10,
                  fontFamily: "monospace",
                  color:     dark ? "rgba(148,163,184,0.7)" : "rgba(100,116,139,0.8)",
                  // Gap-folds get a purple tint; unchanged-line folds get standard grey.
                  background: isGapFold
                    ? (dark ? "rgba(30,15,60,0.85)" : "rgba(220,210,255,0.55)")
                    : (dark ? "rgba(15,25,41,0.85)" : "rgba(241,245,249,0.85)"),
                  borderTop:    `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`,
                  borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`,
                }}
              >
                {label}
              </div>
            );
          }

          // ── Gap placeholder row (Beyond Compare striped empty slot) ───────
          if (item === null) {
            return (
              <div
                key={vRow.index}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position:  "absolute",
                  top: 0, left: 0, right: 0,
                  transform: `translateY(${vRow.start}px)`,
                  minHeight: wrapLines ? 48 : ROW_HEIGHT_PX,
                }}
              >
                <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                  <span className="sticky left-0 z-[1] select-none border-r border-slate-200 bg-white dark:border-white/10 dark:bg-[#0a1020]" />
                  {/* Fix 5: styled as BC empty slot — diagonal stripe */}
                  <span
                    style={{
                      display:   "block",
                      minHeight: wrapLines ? 48 : ROW_HEIGHT_PX,
                      background: gapPattern,
                      backgroundColor: dark ? "rgba(20,30,50,0.6)" : "rgba(226,232,240,0.5)",
                      borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"}`,
                    }}
                  />
                </div>
              </div>
            );
          }

          // ── Normal line ───────────────────────────────────────────────────
          const segs = item as Line;
          const lineNodes: React.ReactNode[] = [];

          // Fix 2: determine if this line belongs to ANY MOD chunk (not just active)
          const lineChunkId = segs.find((s) => s.chunkId != null)?.chunkId ?? null;
          const lineKind    = lineChunkId != null ? kindMap.get(lineChunkId) : undefined;
          const isModLine   = lineKind === "mod";

          // Word-diff tokens: use all-chunk map for all MOD lines (Fix 2)
          const wordTokens = isModLine && lineChunkId != null
            ? allChunkTokens.get(lineChunkId) ?? null
            : null;

          // Only show word-diff tokens on the FIRST line of the chunk to avoid
          // repeating the same token summary on every line of a multi-line block.
          const prevLineHasThisChunk =
            vRow.index > 0 &&
            (lines[vRow.index - 1] as Line | null | { type: string } | undefined) != null &&
            Array.isArray(lines[vRow.index - 1]) &&
            (lines[vRow.index - 1] as Line).some((s) => s.chunkId === lineChunkId);

          // Suppress word tokens when line has rich emphasis markup (underline/strike)
          // OR when the server has already painted inline word diff on this line
          // (so we don't overlay a summary on top of real inline highlighting).
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
              </span>
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
                  : <span key={si} style={style}>{seg.text}</span>
              );
            }
          }

          // Patch 4: Only count this row as "actually changed" if at least one
          // segment carries a server-painted background. Plain-emit MOD segments
          // (long blocks, all-trivial changes) have chunkId but no background and
          // must NOT trigger row-level highlight.
          const lineHasPaintedSegment = segs.some((s) => {
            if (s.chunkId == null) return false;
            const cfg = pane.tag_cfgs[s.tagName] ?? {};
            return !!cfg.background;
          });

          // Row-level highlight: 3px left border + subtle background tint for the
          // active chunk row. This is complementary to the span-level CSS injection
          // (activeChunkCSS) which adds outline to individual text spans.
          const isActiveRow = activeChunkId !== null
            && lineChunkId === activeChunkId
            && lineHasPaintedSegment; // ← Patch 4: only highlight rows with actual paint
          const activeHl = isActiveRow && lineKind ? ACTIVE_HL[lineKind] : null;

          return (
            <div
              key={`row-${vRow.index}`}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position:  "absolute",
                top: 0, left: 0, right: 0,
                transform: `translateY(${vRow.start}px)`,
                minHeight: ROW_HEIGHT_PX,
                // Active chunk row gets a colored left border + subtle bg tint
                borderLeft: activeHl
                  ? `3px solid ${activeHl.border}`
                  : "3px solid transparent",
                backgroundColor: activeHl ? activeHl.bg : undefined,
                transition: "border-left-color 0.12s, background-color 0.12s",
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
      wrapLines = false,
      alignedLines,
      onUnfoldRow,
      isScrollSource = false,
    },
    ref,
  ) => {
    const scrollRef       = useRef<HTMLDivElement>(null);
    const syncingRef      = useRef(false);
    const hSyncRef        = useRef(false);   // Fix 3: prevent horiz scroll loop
    const scrollFrameRef  = useRef<number | null>(null);
    /**
     * ISSUE 2 FIX — Scroll sync echo loop root cause:
     *
     * scrollToFraction() sets syncingRef = true, calls scrollToIndex(row),
     * then clears syncingRef after 32 ms via setTimeout. But scrollToIndex
     * is asynchronous — the browser fires the scroll event for it in a later
     * frame, often AFTER the 32 ms timeout has already cleared syncingRef.
     * When syncingRef is false, handleScroll treats the programmatic scroll
     * as a user scroll, emits onScrollFraction back to the sibling pane, which
     * calls scrollToFraction again → oscillation / jump.
     *
     * Fix: record the last fraction we received via scrollToFraction in
     * lastReceivedFractionRef. Before emitting onScrollFraction in handleScroll,
     * compare the new fraction against the recorded one. If they are within one
     * row (< 1/totalRows), the scroll was caused by our own programmatic scroll
     * → suppress the outgoing event. This breaks the echo loop without relying
     * on any timing window.
     */
    const lastReceivedFractionRef = useRef(-1);
    const virtualizerRef  = useRef<ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null>(null);
    const { dark }        = useTheme();

    const rawAligned = useMemo(
      () => alignedLines ?? buildLines(pane).map((l): AlignedLine => l),
      [alignedLines, pane],
    );

    // Split linesA/B from the combined aligned array (alignedLines already split)
    // When alignedLines is passed in it is already the correct side's array.
    const baseLines = rawAligned;

    // DiffPane renders the array it receives as-is. Folding is performed
    // ONCE in DiffViewer (the only place that has both panes and can fold the
    // pair coherently). This eliminates the double-fold bug where expanding a
    // fold row in the inner pane could not recover the original unchanged
    // lines because the input was already folded.
    const lines = baseLines;

    const kindMap = useMemo(() => {
      const m = new Map<number, ChunkKind>();
      for (const c of chunks) m.set(c.id, c.kind);
      return m;
    }, [chunks]);

    // Fix 2: build word-token map for ALL MOD chunks upfront
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
        // MOD: span-level outline only — word-level inline colours handle the fill.
        return `${sel} { border-radius: 2px; outline: 2px solid ${ahl.border}; outline-offset: 0px; }`;
      }
      // ADD/DEL/EMP/STRIKE: stronger outline + background for maximum visibility.
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

    // Fix 3: sync horizontal scroll from sibling pane
    useEffect(() => {
      const el = scrollRef.current;
      if (!el || syncScrollLeft == null) return;
      if (hSyncRef.current) return;
      hSyncRef.current = true;
      el.scrollLeft = syncScrollLeft;
      requestAnimationFrame(() => { hSyncRef.current = false; });
    }, [syncScrollLeft]);

    useImperativeHandle(ref, () => ({
      scrollToChunk(chunkId: number, _orderedIds?: number[], scrollFraction?: number) {
        const container   = scrollRef.current;
        const virtualizer = virtualizerRef.current;
        if (!container) return;

        syncingRef.current = true;
        const clearSync = () => { syncingRef.current = false; };

        if (virtualizer) {
          let targetLine = -1;
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            if (Array.isArray(line) && line.some((s) => s.chunkId === chunkId)) {
              targetLine = li;
              break;
            }
          }
          if (targetLine >= 0) {
            try {
              virtualizer.scrollToIndex(targetLine, { align: "center", behavior: "auto" });
            } catch { /* ignore — TanStack can throw plain objects before first measure */ }
            setTimeout(clearSync, 16);
            return;
          }
        }

        if (scrollFraction !== undefined) {
          const maxScroll = container.scrollHeight - container.clientHeight;
          if (maxScroll > 0) {
            container.scrollTop = scrollFraction * maxScroll;
            setTimeout(clearSync, 16);
            return;
          }
        }
        syncingRef.current = false;
      },

      scrollToFraction(fraction: number) {
        const virtualizer = virtualizerRef.current;
        if (virtualizer && lines.length > 0) {
          const targetRow = Math.round(fraction * Math.max(0, lines.length - 1));
          const clamped   = Math.max(0, Math.min(lines.length - 1, targetRow));
          syncingRef.current = true;
          // Record the fraction we're syncing to so handleScroll can detect
          // and suppress the resulting echo scroll event (Issue 2 fix).
          lastReceivedFractionRef.current = fraction;
          try {
            virtualizer.scrollToIndex(clamped, { align: "start", behavior: "auto" });
          } catch { /* ignore TanStack edge-case throws */ }
          setTimeout(() => { syncingRef.current = false; }, 32);
          return;
        }
        const container = scrollRef.current;
        if (!container) return;
        syncingRef.current = true;
        lastReceivedFractionRef.current = fraction;
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.max(0, Math.min(1, fraction)) * maxScroll;
        setTimeout(() => { syncingRef.current = false; }, 16);
      },
    }), [lines]);

    const handleScroll = useCallback(() => {
      const container = scrollRef.current;
      if (!container) return;

      if (!hSyncRef.current && onScrollLeft) {
        onScrollLeft(container.scrollLeft);
      }

      // Suppress scroll events triggered by our own scrollToFraction calls
      // even after syncingRef has timed out (Issue 2 fix).
      if (syncingRef.current || wrapLines) return;
      if (!onScrollFraction) return;
      if (scrollFrameRef.current !== null) return;
      // Patch 6: use raw scrollTop/maxScroll — the same metric syncXmlScroll uses,
      // so panes and XML stay in lockstep instead of drifting on long docs.
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (!onScrollFraction) return;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;
        const emitFraction = container.scrollTop / maxScroll;
        // Suppress echo from our own scrollToFraction (Issue 2 fix).
        const oneRow = ROW_HEIGHT_PX / Math.max(1, container.scrollHeight);
        if (Math.abs(emitFraction - lastReceivedFractionRef.current) <= oneRow) {
          lastReceivedFractionRef.current = -1;
          return;
        }
        lastReceivedFractionRef.current = -1;
        onScrollFraction(emitFraction);
      });
    }, [onScrollFraction, onScrollLeft, wrapLines]);

    useEffect(() => {
      return () => {
        if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      };
    }, []);

    const handleUnfold = useCallback((index: number) => {
      // Forward to parent (DiffViewer) which owns the shared fold state.
      // The fold index passed up identifies which fold row was clicked in the
      // already-folded array; the parent uses it to replace that fold with
      // its original lines.
      onUnfoldRow?.(index);
    }, [onUnfoldRow]);

    const sideBadge = side === "a" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white";
    const hasStats  = headerStats && headerStats.length > 0;
    const realLineCount = lines.filter((l) => l !== null && Array.isArray(l)).length;

    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden min-w-0">
        <div className="flex-shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0f1929]">
          <div className="flex items-center gap-2 px-3 py-2">
            {/* isScrollSource adds a brief ring to show which pane is the scroll leader */}
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
          wrapLines={wrapLines}
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