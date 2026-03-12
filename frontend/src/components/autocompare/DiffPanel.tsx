"use client";
/**
 * DiffPanel — Colour-coded diff between OLD and NEW PDF text for a chunk.
 *
 * Colour coding (spec):
 *   🟢 green  — added lines (in new, not in old)
 *   🔴 red    — removed lines (in old, not in new)
 *   🟡 yellow — modified lines (replaced)
 *   ⬜ none   — unchanged
 *
 * Features
 * ────────
 * - Unified diff view (added / removed / unchanged lines)
 * - Inline word-level highlighting within changed lines
 * - Summary badge showing +N / -N / ~N counts
 * - Scrollable with sticky legend header
 * - Empty state for unchanged chunks
 */

import React, { useMemo } from "react";
import type { DiffLine } from "./types";

// ── Line styling ──────────────────────────────────────────────────────────────

const LINE_STYLES: Record<DiffLine["type"], { bg: string; border: string; prefix: string; color: string }> = {
  added:     { bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.3)",   prefix: "+", color: "#86efac" },
  removed:   { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.3)",   prefix: "−", color: "#fca5a5" },
  unchanged: { bg: "transparent",            border: "transparent",           prefix: " ", color: "#64748b" },
};

// ── Word-level diff (for modified lines shown as add+remove pairs) ────────────

function wordDiff(oldLine: string, newLine: string): { words: Array<{ word: string; type: "same" | "changed" }> }[] {
  const oldWords = oldLine.split(/(\s+)/);
  const newWords = newLine.split(/(\s+)/);

  // Simple greedy matching
  const oldResult: Array<{ word: string; type: "same" | "changed" }> = [];
  const newResult: Array<{ word: string; type: "same" | "changed" }> = [];
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);

  for (const w of oldWords) oldResult.push({ word: w, type: newSet.has(w) ? "same" : "changed" });
  for (const w of newWords) newResult.push({ word: w, type: oldSet.has(w) ? "same" : "changed" });

  return [{ words: oldResult }, { words: newResult }];
}

// ── Summary badge ─────────────────────────────────────────────────────────────

function DiffSummary({ lines }: { lines: DiffLine[] }) {
  const added   = lines.filter((l) => l.type === "added").length;
  const removed = lines.filter((l) => l.type === "removed").length;
  const total   = lines.length;

  return (
    <div className="flex items-center gap-2">
      {added > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
          +{added}
        </span>
      )}
      {removed > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/25">
          −{removed}
        </span>
      )}
      <span className="text-[10px] text-slate-500">{total} lines</span>
    </div>
  );
}

// ── Single diff line ──────────────────────────────────────────────────────────

function DiffLineRow({ line, lineNum }: { line: DiffLine; lineNum: number }) {
  const s = LINE_STYLES[line.type];

  return (
    <div
      className="flex items-start group font-mono text-[11px] leading-5"
      style={{ background: s.bg, borderLeft: `2px solid ${s.border}` }}
    >
      {/* Line number */}
      <span
        className="flex-shrink-0 w-10 text-right pr-2 py-0.5 select-none"
        style={{ color: "#3d4752" }}
      >
        {line.type !== "added" ? lineNum : ""}
      </span>

      {/* Prefix glyph */}
      <span
        className="flex-shrink-0 w-4 py-0.5 font-bold select-none"
        style={{ color: s.color }}
      >
        {s.prefix}
      </span>

      {/* Text content */}
      <span
        className="flex-1 py-0.5 pr-2 break-all"
        style={{ color: line.type === "unchanged" ? s.color : "#e2e8f0" }}
      >
        {line.text || "\u00A0"}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DiffPanelProps {
  diffLines: DiffLine[];
  chunkLabel?: string;
  changeType?: string;
  similarity?: number;
}

export default function DiffPanel({
  diffLines,
  chunkLabel,
  changeType,
  similarity,
}: DiffPanelProps) {
  const hasChanges = diffLines.some((l) => l.type !== "unchanged");

  const simPct = useMemo(() => similarity != null ? Math.round(similarity * 100) : null, [similarity]);
  const simColor = simPct == null ? "#64748b" : simPct >= 90 ? "#22c55e" : simPct >= 60 ? "#f59e0b" : "#ef4444";

  const changeBadgeMap: Record<string, string> = {
    added:     "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    removed:   "bg-red-500/20 text-red-300 border-red-500/30",
    modified:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
    unchanged: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{ borderColor: "rgba(26,143,209,0.2)", background: "#0d1117" }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.9)" }}
      >
        <div className="flex items-center gap-2">
          {/* Icon */}
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-xs font-semibold text-white">Diff View</span>

          {chunkLabel && (
            <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{chunkLabel}</span>
          )}

          {changeType && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${changeBadgeMap[changeType] ?? changeBadgeMap.unchanged}`}>
              {changeType}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Similarity */}
          {simPct != null && (
            <span className="text-[10px] font-medium" style={{ color: simColor }}>
              {simPct}% match
            </span>
          )}

          {/* Diff summary */}
          <DiffSummary lines={diffLines} />
        </div>
      </div>

      {/* Legend */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-3 py-1.5 border-b text-[10px]"
        style={{ borderColor: "rgba(255,255,255,0.04)", background: "#161b22" }}
      >
        <span className="flex items-center gap-1 text-emerald-300">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/40" /> Added
        </span>
        <span className="flex items-center gap-1 text-red-300">
          <span className="w-2 h-2 rounded-sm bg-red-500/40" /> Removed
        </span>
        <span className="flex items-center gap-1 text-amber-300">
          <span className="w-2 h-2 rounded-sm bg-amber-500/40" /> Modified
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <span className="w-2 h-2 rounded-sm bg-slate-600/40" /> Unchanged
        </span>
      </div>

      {/* Diff body */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        {!hasChanges ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs">No changes detected in this chunk</p>
          </div>
        ) : (
          <div>
            {diffLines.map((line, i) => (
              <DiffLineRow key={i} line={line} lineNum={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
