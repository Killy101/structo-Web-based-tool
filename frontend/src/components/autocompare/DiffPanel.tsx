"use client";

import React, { useMemo, useState } from "react";
import type { DiffCategory, DiffLine, DiffSpan } from "./types";

type ActiveCategory = Extract<DiffCategory, "added" | "removed" | "modified" | "mismatch">;

const CATEGORY_CFG: Record<
  ActiveCategory,
  {
    label: string;
    accent: string;
    rowBg: string;
    rowBorder: string;
    badge: string;
    icon: string;
    rowHighlight: string;
  }
> = {
  added: {
    label: "Addition",
    accent: "#86efac",
    rowBg: "rgba(34,197,94,0.04)",
    rowBorder: "rgba(34,197,94,0.35)",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    icon: "+",
    rowHighlight: "rgba(34,197,94,0.08)",
  },
  removed: {
    label: "Removal",
    accent: "#fca5a5",
    rowBg: "rgba(239,68,68,0.04)",
    rowBorder: "rgba(239,68,68,0.35)",
    badge: "bg-red-500/15 text-red-300 border-red-500/30",
    icon: "−",
    rowHighlight: "rgba(239,68,68,0.08)",
  },
  modified: {
    label: "Modified",
    accent: "#fde68a",
    rowBg: "rgba(251,191,36,0.04)",
    rowBorder: "rgba(251,191,36,0.35)",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: "~",
    rowHighlight: "rgba(251,191,36,0.08)",
  },
  mismatch: {
    label: "Path",
    accent: "#cbd5e1",
    rowBg: "rgba(100,116,139,0.04)",
    rowBorder: "rgba(100,116,139,0.30)",
    badge: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    icon: "≠",
    rowHighlight: "rgba(100,116,139,0.08)",
  },
};

const NOISE_WORD_RE = /\b(font|footnote|page)\b/i;
const NUMERIC_ONLY_RE = /^[\s\d().,;:[\]{}+\-/*%]+$/;

function toCategory(line: DiffLine): ActiveCategory {
  // Normalize both new-style (added/removed/modified) and legacy (addition/removal/modification)
  const c = line.category;
  if (c === "added"    || c === "addition")     return "added";
  if (c === "removed"  || c === "removal")      return "removed";
  if (c === "modified" || c === "modification") return "modified";
  if (c === "mismatch")                         return "mismatch";
  // Fall back to legacy `type` field
  if (line.type === "added")   return "added";
  if (line.type === "removed") return "removed";
  return "modified";
}

function hasChangedSpan(spans?: DiffSpan[]): boolean {
  if (!spans || spans.length === 0) return false;
  return spans.some((s) => s.changed && s.text.trim().length > 0);
}

function isFalsePositive(line: DiffLine): boolean {
  const cat = toCategory(line);
  const combined = `${line.text || ""} ${line.old_text || ""} ${line.new_text || ""}`.trim();
  const compact = combined.replace(/\s+/g, "");

  if (compact.length < 3) return true;
  if (NUMERIC_ONLY_RE.test(combined)) return true;
  if (NOISE_WORD_RE.test(combined)) return true;

  if (cat === "added") return !hasChangedSpan(line.new_spans);
  if (cat === "removed") return !hasChangedSpan(line.old_spans);
  return !(hasChangedSpan(line.old_spans) || hasChangedSpan(line.new_spans));
}

type SpanStyleKind = "added" | "removed" | "modified";

function renderSpans(spans: DiffSpan[] | undefined, styleKind: SpanStyleKind) {
  if (!spans || spans.length === 0) return <span className="text-slate-500 italic text-[10px]">(empty)</span>;

  // G: Limit span array size to keep rendering fast (was 180 / 1200).
  const MAX_SPAN_SEGMENTS = 20;
  const MAX_SPAN_CHARS = 400;
  const clipped: DiffSpan[] = [];
  let usedChars = 0;
  for (const sp of spans) {
    if (clipped.length >= MAX_SPAN_SEGMENTS) break;
    if (usedChars >= MAX_SPAN_CHARS) break;
    const remain = MAX_SPAN_CHARS - usedChars;
    const text = sp.text.length > remain ? sp.text.slice(0, remain) : sp.text;
    clipped.push({ ...sp, text });
    usedChars += text.length;
  }
  const truncated = clipped.length < spans.length;

  return clipped.map((sp, idx) => {
    if (!sp.changed) {
      return (
        <span key={idx} style={{ color: "#94a3b8" }}>
          {sp.text}
        </span>
      );
    }

    if (styleKind === "removed") {
      return (
        <mark
          key={idx}
          style={{
            background: "rgba(239,68,68,0.20)",
            color: "#fca5a5",
            textDecoration: "line-through",
            textDecorationColor: "#ef4444",
            textDecorationThickness: "2px",
            borderBottom: "2px solid rgba(239,68,68,0.5)",
            borderRadius: "2px",
            padding: "0 2px",
            fontStyle: "normal",
          }}
        >
          {sp.text}
        </mark>
      );
    }

    if (styleKind === "modified") {
      return (
        <mark
          key={idx}
          style={{
            background: "rgba(251,191,36,0.18)",
            color: "#fde68a",
            borderBottom: "2px solid #f59e0b",
            borderRadius: "2px",
            padding: "0 2px",
            fontStyle: "normal",
          }}
        >
          {sp.text}
        </mark>
      );
    }

    // added
    return (
      <mark
        key={idx}
        style={{
          background: "rgba(34,197,94,0.18)",
          color: "#86efac",
          borderBottom: "2px solid #22c55e",
          borderRadius: "2px",
          padding: "0 2px",
          fontStyle: "normal",
        }}
      >
        {sp.text}
      </mark>
    );
  }).concat(
    truncated
      ? [
          <span key="__more" className="text-slate-500 italic text-[10px]">
            {" "}…truncated
          </span>,
        ]
      : [],
  );
}

function DiffRow({
  line,
  selected,
  onClick,
}: {
  line: DiffLine;
  selected: boolean;
  onClick: () => void;
}) {
  const cat = toCategory(line);
  const cfg = CATEGORY_CFG[cat];

  // Guard: for "modified" lines where old and new text are identical (false positive
  // from the backend concatenating them), treat as plain text — don't show OLD/NEW.
  const oldTxt = (line.old_text ?? "").trim();
  const newTxt = (line.new_text ?? "").trim();
  const isMeaningfulModify = cat === "modified" || cat === "mismatch"
    ? oldTxt !== newTxt || (line.old_spans ?? []).some((s) => s.changed) || (line.new_spans ?? []).some((s) => s.changed)
    : false;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 text-[11px] transition-colors"
      style={{
        background: selected ? "rgba(26,143,209,0.16)" : (selected ? cfg.rowHighlight : cfg.rowBg),
        borderLeft: `3px solid ${selected ? "#1a8fd1" : cfg.rowBorder}`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex items-start gap-2 min-w-0">
        {/* Category badge — now color-coded per type */}
        <span
          className={`flex-shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg.badge}`}
          title={cfg.label}
        >
          {cfg.icon} {cfg.label}
        </span>

        <span className="flex-1 min-w-0 leading-relaxed">
          {cat === "added" && (
            <span className="flex flex-wrap items-baseline gap-0">
              {renderSpans(line.new_spans, "added")}
            </span>
          )}

          {cat === "removed" && (
            <span className="flex flex-wrap items-baseline gap-0">
              {renderSpans(line.old_spans, "removed")}
            </span>
          )}

          {(cat === "modified" || cat === "mismatch") && isMeaningfulModify ? (
            <span className="flex flex-col gap-1.5">
              {/* OLD side */}
              <span className="flex items-start gap-1 flex-wrap">
                <span
                  className="inline-block text-[8px] font-bold rounded px-1 py-0.5 flex-shrink-0 mt-0.5"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}
                >
                  OLD
                </span>
                <span className="flex flex-wrap items-baseline gap-0">
                  {renderSpans(line.old_spans, "removed")}
                </span>
              </span>
              {/* Arrow divider */}
              <span className="text-[9px] text-slate-600 pl-1">↓ replaced with</span>
              {/* NEW side */}
              <span className="flex items-start gap-1 flex-wrap">
                <span
                  className="inline-block text-[8px] font-bold rounded px-1 py-0.5 flex-shrink-0 mt-0.5"
                  style={{ background: "rgba(34,197,94,0.15)", color: "#86efac", border: "1px solid rgba(34,197,94,0.3)" }}
                >
                  NEW
                </span>
                <span className="flex flex-wrap items-baseline gap-0">
                  {renderSpans(line.new_spans, "added")}
                </span>
              </span>
            </span>
          ) : (cat === "modified" || cat === "mismatch") ? (
            // old === new — show as a single plain line (dedup guard)
            <span className="flex flex-wrap items-baseline gap-0 text-slate-400 italic text-[10px]">
              {renderSpans(line.new_spans ?? line.old_spans, "modified")}
            </span>
          ) : null}
        </span>

        {/* Page numbers */}
        <span className="flex-shrink-0 flex flex-col items-end gap-1 ml-1">
          {line.old_page != null && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold text-slate-300 border-red-500/25 bg-red-500/10 whitespace-nowrap">
              Old p.{line.old_page}
            </span>
          )}
          {line.new_page != null && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold text-slate-300 border-emerald-500/25 bg-emerald-500/10 whitespace-nowrap">
              New p.{line.new_page}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

interface DiffPanelProps {
  diffLines: DiffLine[];
  chunkLabel?: string;
  changeType?: string;
  similarity?: number;
  selectedLineIndex?: number | null;
  onSelectLine?: (line: DiffLine, index: number) => void;
}

export default function DiffPanel({
  diffLines,
  chunkLabel,
  changeType,
  similarity,
  selectedLineIndex = null,
  onSelectLine,
}: DiffPanelProps) {
  const [visibleCount, setVisibleCount] = useState(50);

  const timeline = useMemo(() => {
    const withIndex = (diffLines || []).map((line, idx) => ({ line, idx }));
    return withIndex
      .filter(({ line }) => !isFalsePositive(line))
      .sort((a, b) => (a.line.line - b.line.line) || (a.idx - b.idx));
  }, [diffLines]);

  const visibleTimeline = useMemo(
    () => timeline.slice(0, visibleCount),
    [timeline, visibleCount],
  );

  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;
    let modified = 0;
    let mismatch = 0;
    for (const row of timeline) {
      const cat = toCategory(row.line);
      if (cat === "added")    added    += 1;
      else if (cat === "removed")   removed  += 1;
      else if (cat === "mismatch")  mismatch += 1;
      else                          modified += 1;
    }
    return { added, removed, modified, mismatch };
  }, [timeline]);

  const simPct = similarity != null ? Math.round(similarity * 100) : null;
  const simColor = simPct == null ? "#64748b" : simPct >= 90 ? "#22c55e" : simPct >= 60 ? "#f59e0b" : "#ef4444";

  const changeBadge: Record<string, string> = {
    added:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    removed:   "bg-red-500/15 text-red-300 border-red-500/30",
    modified:  "bg-amber-500/15 text-amber-300 border-amber-500/30",
    unchanged: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{ borderColor: "rgba(26,143,209,0.2)", background: "#0d1117" }}
    >
      <div
        className="flex-shrink-0 px-3 py-2.5 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.97)" }}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span className="text-xs font-bold text-white">Changes</span>
            {changeType && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${changeBadge[changeType] ?? changeBadge.unchanged}`}>
                {changeType}
              </span>
            )}
          </div>
          {simPct != null && (
            <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: simColor }}>
              {simPct}% match
            </span>
          )}
        </div>

        {chunkLabel && (
          <div className="mb-1.5 px-1 py-1 rounded border border-white/15 bg-white/[0.03]">
            <p className="text-[10px] text-slate-200 truncate" title={chunkLabel}>
              Chunk: {chunkLabel}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[9px] flex-wrap">
          <span className="px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">+ {counts.added} added</span>
          <span className="px-1.5 py-0.5 rounded border bg-red-500/15 text-red-300 border-red-500/30">− {counts.removed} removed</span>
          <span className="px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/30">~ {counts.modified} modified</span>
          <span className="px-1.5 py-0.5 rounded border bg-slate-500/15 text-slate-300 border-slate-500/30">≠ {counts.mismatch} path</span>
          <span className="ml-auto text-slate-500">{timeline.length} total</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600 py-10">
            <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs">No meaningful changes after noise filtering</p>
          </div>
        ) : (
          <div>
            {visibleTimeline.map(({ line, idx }) => (
              <DiffRow
                key={`${line.line}-${idx}`}
                line={line}
                selected={selectedLineIndex === line.line}
                onClick={() => onSelectLine?.(line, line.line)}
              />
            ))}
            {visibleCount < timeline.length && (
              <div className="px-3 py-2 border-t border-slate-800 bg-slate-900/60">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + 120)}
                  className="w-full text-[10px] px-2 py-1.5 rounded border border-white/20 text-slate-200 hover:bg-white/10"
                >
                  Load more changes ({timeline.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}