"use client";
/**
 * WordDiffViewer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * GitHub Desktop / Beyond Compare–style word-level diff viewer.
 *
 * Consumes the NEW backend format from word_compare.py / compare_document():
 *
 *   Array<{
 *     old:         string;           // original sentence
 *     new:         string;           // revised sentence
 *     similarity:  number;           // 0–1
 *     word_diff:   WordDiff;         // aggregated word stats
 *     inline_diff: InlineDiffToken[]; // ← the thing we render
 *   }>
 *
 *   InlineDiffToken = { type: "equal" | "delete" | "insert"; value: string }
 *
 * What was broken in the OLD frontend
 * ─────────────────────────────────────
 * 1. Field name mismatch: old code expected `op: "eq"|"del"|"ins"` but
 *    backend now emits `type: "equal"|"delete"|"insert"`.
 * 2. Value field mismatch: old code used `token.text`, backend uses `token.value`.
 * 3. No spacing: tokens were concatenated raw → "CompilationNo173" style.
 *    Fix: inject a space between adjacent tokens (see renderInlineDiff).
 * 4. Sentence grouping ignored: old code rendered `line.new` / `line.old` as
 *    plain text. Fix: we now render `line.inline_diff` per sentence block.
 * 5. No inline highlighting at all.
 */

import React, { useMemo, useState } from "react";

// ── Types matching the new backend contract ───────────────────────────────────

export type DiffTokenType = "equal" | "delete" | "insert";

export interface InlineDiffToken {
  type:  DiffTokenType;
  value: string;
}

export interface WordDiff {
  has_changes:     boolean;
  old_word_count:  number;
  new_word_count:  number;
  common_words:    number;
  additions:       string[];
  removals:        string[];
  modifications:   Array<{ old: string; new: string; ratio: number; type: string }>;
  summary: {
    addition:     number;
    removal:      number;
    modification: number;
  };
  change_ratio: number;
}

export interface SentenceBlock {
  old:         string;
  new:         string;
  similarity:  number;
  word_diff:   WordDiff;
  inline_diff: InlineDiffToken[];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Array returned by compare_document() on the backend */
  blocks:    SentenceBlock[];
  /** Optional: file names shown in the header */
  fileOld?:  string;
  fileNew?:  string;
  /** Show / hide unchanged sentences (default: show) */
  hideEqual?: boolean;
}

// ── Colour tokens ─────────────────────────────────────────────────────────────

const TOKEN_STYLES: Record<DiffTokenType, string> = {
  equal:  "text-[#c9d1d9] dark:text-[#c9d1d9]",
  delete: [
    "bg-[#3d1f1f] dark:bg-[#3d1f1f]",
    "text-[#ff8080]",
    "line-through",
    "decoration-[#ff4444]",
    "decoration-2",
    "rounded-[2px]",
    "px-[1px]",
  ].join(" "),
  insert: [
    "bg-[#1a3a1a] dark:bg-[#1a3a1a]",
    "text-[#7ee787]",
    "rounded-[2px]",
    "px-[1px]",
  ].join(" "),
};

// ── Inline diff renderer ──────────────────────────────────────────────────────

/**
 * Render an array of InlineDiffTokens as React spans.
 *
 * KEY FIX FOR SPACING:
 * Tokens are individual *words* (the tokeniser already strips punctuation).
 * We need a space between adjacent words, EXCEPT when the previous or current
 * token is purely punctuation / empty.  The simplest correct rule:
 *   – prepend a space before every token that is not the first one.
 * This mirrors how prose is reconstructed from a word list.
 */
function renderInlineDiff(tokens: InlineDiffToken[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  tokens.forEach((tok, idx) => {
    const isFirst = idx === 0;
    const style   = TOKEN_STYLES[tok.type] ?? TOKEN_STYLES.equal;

    // Insert inter-word space (see docstring above)
    if (!isFirst) {
      // If the previous token was a delete and this is an insert (paired
      // substitution), we don't want an extra space between them — the
      // visual separation is already provided by colour.
      const prev = tokens[idx - 1];
      if (!(prev.type === "delete" && tok.type === "insert")) {
        nodes.push(<span key={`sp-${idx}`}> </span>);
      } else {
        // still add a thin space so they don't visually merge
        nodes.push(<span key={`sp-${idx}`}>&thinsp;</span>);
      }
    }

    nodes.push(
      <span key={idx} className={style}>
        {tok.value}
      </span>,
    );
  });

  return nodes;
}

// ── Similarity badge ──────────────────────────────────────────────────────────

function SimilarityBadge({ score }: { score: number }) {
  const pct  = Math.round(score * 100);
  const color =
    score === 1   ? "text-slate-500"
    : score > 0.8 ? "text-emerald-500"
    : score > 0.5 ? "text-amber-500"
    :               "text-rose-500";
  return (
    <span className={`text-[9px] font-mono tabular-nums ${color}`}>
      {pct}% match
    </span>
  );
}

// ── Change-kind pills ─────────────────────────────────────────────────────────

function ChangePills({ wd }: { wd: WordDiff }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {wd.summary.addition > 0 && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400">
          +{wd.summary.addition}
        </span>
      )}
      {wd.summary.removal > 0 && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-rose-900/50 text-rose-400">
          −{wd.summary.removal}
        </span>
      )}
      {wd.summary.modification > 0 && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400">
          ~{wd.summary.modification}
        </span>
      )}
    </div>
  );
}

// ── A single sentence diff block ──────────────────────────────────────────────

function SentenceRow({
  block,
  index,
}: {
  block: SentenceBlock;
  index: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChanges = block.word_diff.has_changes ||
    block.old !== block.new;

  const borderColor = !hasChanges
    ? "border-l-slate-700"
    : block.similarity > 0.8
    ? "border-l-amber-500"
    : block.similarity > 0.4
    ? "border-l-orange-500"
    : "border-l-rose-500";

  const inlineNodes = useMemo(
    () => renderInlineDiff(block.inline_diff),
    [block.inline_diff],
  );

  return (
    <div
      className={`border-l-2 ${borderColor} bg-[#0d1117] hover:bg-[#161b22] transition-colors`}
    >
      {/* Row header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-[#21262d] cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Line number */}
        <span className="text-[10px] font-mono tabular-nums text-[#484f58] w-6 flex-shrink-0 text-right">
          {index + 1}
        </span>

        {/* Expand chevron */}
        <svg
          className={`w-3 h-3 text-[#484f58] flex-shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>

        {/* Preview (collapsed or header) */}
        <span className="text-[11px] text-[#8b949e] font-mono truncate flex-1 leading-snug">
          {block.old.slice(0, 80)}{block.old.length > 80 ? "…" : ""}
        </span>

        {/* Metadata */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasChanges && <ChangePills wd={block.word_diff} />}
          <SimilarityBadge score={block.similarity} />
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 py-2.5 space-y-2">

          {/* ── INLINE DIFF (the new rendering) ──────────────────────── */}
          <div className="font-mono text-[12px] leading-[1.85] whitespace-pre-wrap break-words rounded bg-[#161b22] border border-[#21262d] px-3 py-2">
            {block.inline_diff.length > 0
              ? inlineNodes
              : <span className="text-[#8b949e] italic">No changes</span>
            }
          </div>

          {/* ── Old / New raw sentences (collapsed by default) ────────── */}
          {hasChanges && (
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="bg-[#1c1015] border border-[#3d1f1f] rounded px-2 py-1.5">
                <div className="text-rose-500/60 text-[8px] font-bold mb-1 uppercase tracking-wider">Old</div>
                <p className="text-[#ff8080] leading-relaxed whitespace-pre-wrap break-words">{block.old || "—"}</p>
              </div>
              <div className="bg-[#0d1c10] border border-[#1a3a1a] rounded px-2 py-1.5">
                <div className="text-emerald-500/60 text-[8px] font-bold mb-1 uppercase tracking-wider">New</div>
                <p className="text-[#7ee787] leading-relaxed whitespace-pre-wrap break-words">{block.new || "—"}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ blocks }: { blocks: SentenceBlock[] }) {
  const totals = useMemo(() => {
    let add = 0, del = 0, mod = 0, unchanged = 0;
    for (const b of blocks) {
      add       += b.word_diff.summary.addition;
      del       += b.word_diff.summary.removal;
      mod       += b.word_diff.summary.modification;
      if (!b.word_diff.has_changes) unchanged++;
    }
    return { add, del, mod, unchanged, total: blocks.length };
  }, [blocks]);

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-[#21262d] text-[10px] font-mono bg-[#0d1117]">
      <span className="text-[#8b949e]">{totals.total} sentences</span>
      {totals.add > 0 && <span className="text-emerald-400">+{totals.add} words added</span>}
      {totals.del > 0 && <span className="text-rose-400">−{totals.del} words removed</span>}
      {totals.mod > 0 && <span className="text-amber-400">~{totals.mod} words modified</span>}
      {totals.unchanged > 0 && (
        <span className="text-[#484f58]">{totals.unchanged} unchanged</span>
      )}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-b border-[#21262d] text-[10px] font-mono bg-[#0d1117]">
      <span className="text-[#484f58] uppercase tracking-wider text-[8px] font-bold mr-1">Legend</span>
      <span>
        <span className={`${TOKEN_STYLES.delete} px-1`}>removed</span>
      </span>
      <span>
        <span className={`${TOKEN_STYLES.insert} px-1`}>added</span>
      </span>
      <span className={TOKEN_STYLES.equal}>unchanged</span>
    </div>
  );
}

// ── File header bar ───────────────────────────────────────────────────────────

function FileHeader({ fileOld, fileNew }: { fileOld?: string; fileNew?: string }) {
  return (
    <div className="flex items-stretch border-b border-[#21262d] text-[11px] font-mono bg-[#161b22]">
      <div className="flex-1 flex items-center gap-2 px-4 py-2 border-r border-[#21262d]">
        <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
        <span className="text-rose-400 truncate">{fileOld ?? "Old version"}</span>
      </div>
      <div className="flex-1 flex items-center gap-2 px-4 py-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
        <span className="text-emerald-400 truncate">{fileNew ?? "New version"}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WordDiffViewer({
  blocks,
  fileOld,
  fileNew,
  hideEqual = false,
}: Props) {
  const [_hideEqual, setHideEqual] = useState(hideEqual);

  const visible = useMemo(
    () => (_hideEqual ? blocks.filter((b) => b.word_diff.has_changes) : blocks),
    [blocks, _hideEqual],
  );

  if (!blocks.length) {
    return (
      <div className="flex items-center justify-center h-32 text-[#8b949e] font-mono text-sm bg-[#0d1117]">
        No diff data
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] font-mono text-[#c9d1d9] overflow-hidden rounded-lg border border-[#30363d]">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2
        border-b border-[#21262d] bg-[#161b22]">
        <div className="flex items-center gap-2">
          {/* Git diff icon */}
          <svg className="w-4 h-4 text-[#f0883e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span className="text-[12px] font-semibold text-[#e6edf3]">Word Diff</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f0883e]/15 text-[#f0883e] border border-[#f0883e]/30 font-bold">
            inline
          </span>
        </div>

        {/* Hide-equal toggle */}
        <button
          onClick={() => setHideEqual((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold transition-all
            ${_hideEqual
              ? "bg-[#f0883e]/15 text-[#f0883e] border border-[#f0883e]/30"
              : "text-[#8b949e] border border-[#30363d] hover:border-[#8b949e] hover:text-[#c9d1d9]"
            }`}
        >
          {_hideEqual ? "Showing changed only" : "Show changed only"}
        </button>
      </div>

      {/* ── File names ── */}
      {(fileOld || fileNew) && <FileHeader fileOld={fileOld} fileNew={fileNew} />}

      {/* ── Stats + legend ── */}
      <StatsBar blocks={blocks} />
      <Legend />

      {/* ── Sentence rows ── */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#21262d] scrollbar-thin
        scrollbar-track-transparent scrollbar-thumb-[#30363d]">
        {visible.map((block, i) => (
          <SentenceRow key={i} block={block} index={i} />
        ))}
        {visible.length === 0 && (
          <div className="flex items-center justify-center h-24 text-[#484f58] text-[11px]">
            All sentences unchanged
          </div>
        )}
      </div>
    </div>
  );
}

// ── Usage example (how to wire it into a page) ───────────────────────────────
//
// import WordDiffViewer, { SentenceBlock } from "./WordDiffViewer";
//
// // The response from your compare_document() API endpoint:
// const data: SentenceBlock[] = await fetch("/api/compare", { ... }).then(r => r.json());
//
// <WordDiffViewer
//   blocks={data}
//   fileOld="v1.pdf"
//   fileNew="v2.pdf"
// />