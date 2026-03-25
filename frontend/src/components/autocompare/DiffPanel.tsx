"use client";
/**
 * DiffPanel — Single continuous timeline of diff lines.
 *
 * Renders diffLines in chronological order (NO grouping by type).
 * Highlights only the changed spans within each line:
 *   Added    → new_spans highlighted blue
 *   Removed  → old_spans highlighted red + strikethrough
 *   Modified → OLD row (red highlights) + NEW row (blue highlights)
 *
 * False positives are filtered before rendering:
 *   - text shorter than 3 characters
 *   - numeric-only lines (page numbers, list counters)
 *   - lines containing font/footnote/page noise keywords
 *   - lines where no span is actually marked changed
 */

import React, { useMemo, useState } from "react";
import type { DiffLine, DiffSpan } from "./types";

// ── False-positive filter ───────────────────────────────────────────────────────

const NOISE_KEYWORD_RE = /\b(font|footnote)\b/i;
const NUMERIC_ONLY_RE  = /^\d+\.?\d*$/;
const NUMBERING_RE     = /^(\d+\.|[a-z]\)|\([a-z0-9]+\)|[ivxlcdm]+\.)$/i;

function isFalsePositive(line: DiffLine): boolean {
  const text = (line.old_text ?? line.new_text ?? line.text ?? "").trim();
  if (text.length < 3)            return true;
  if (NUMERIC_ONLY_RE.test(text)) return true;
  if (NUMBERING_RE.test(text))    return true;
  if (NOISE_KEYWORD_RE.test(text)) return true;

  // If backend supplied spans and none are changed → no real diff
  if (line.old_spans && line.new_spans) {
    const anyChanged =
      line.old_spans.some((s) => s.changed) ||
      line.new_spans.some((s) => s.changed);
    if (!anyChanged) return true;
  }

  return false;
}

// ── Span rendering ──────────────────────────────────────────────────────────────

type SpanKind = "add" | "rem" | "mod-old" | "mod-new";

function SpanRow({ spans, kind }: { spans: DiffSpan[]; kind: SpanKind }) {
  return (
    <span className="flex flex-wrap leading-5 break-words min-w-0">
      {spans.map((sp, i) => {
        if (!sp.changed) {
          return (
            <span key={i} className="text-slate-400 whitespace-pre-wrap">
              {sp.text}
            </span>
          );
        }
        if (kind === "add" || kind === "mod-new") {
          return (
            <span
              key={i}
              className="bg-blue-500/30 text-blue-200 rounded px-0.5 whitespace-pre-wrap"
            >
              {sp.text}
            </span>
          );
        }
        // rem or mod-old
        return (
          <span
            key={i}
            className="bg-red-500/30 text-red-200 line-through rounded px-0.5 whitespace-pre-wrap"
          >
            {sp.text}
          </span>
        );
      })}
    </span>
  );
}

/** Build a single-span fallback when the backend didn't return spans */
function textToSpans(text: string, changed: boolean): DiffSpan[] {
  return text ? [{ text, changed }] : [];
}

// ── Page badge ──────────────────────────────────────────────────────────────────

function PageBadge({ page, kind }: { page: number; kind: "old" | "new" }) {
  return (
    <span
      className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
        kind === "old"
          ? "text-red-200 border-red-500/30 bg-red-500/10"
          : "text-blue-200 border-blue-500/30 bg-blue-500/10"
      }`}
    >
      {kind === "old" ? "Old" : "New"} p.{page}
    </span>
  );
}

// ── Timeline row ────────────────────────────────────────────────────────────────

interface TimelineRowProps {
  line:       DiffLine;
  isSelected: boolean;
  onClick:    () => void;
}

function TimelineRow({ line, isSelected, onClick }: TimelineRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Build spans — prefer backend-supplied, fall back to full-text span
  const oldSpans: DiffSpan[] =
    line.old_spans ??
    textToSpans((line.old_text ?? line.text ?? "").trim(), true);
  const newSpans: DiffSpan[] =
    line.new_spans ??
    textToSpans((line.new_text ?? line.text ?? "").trim(), true);

  const accentColor =
    line.type === "added"
      ? "#93c5fd"   // blue-300
      : line.type === "removed"
      ? "#fca5a5"   // red-300
      : "#fcd34d";  // amber-300

  const borderLeft = isSelected
    ? "2px solid #1a8fd1"
    : line.type === "added"
    ? "2px solid rgba(59,130,246,0.4)"
    : line.type === "removed"
    ? "2px solid rgba(239,68,68,0.4)"
    : "2px solid rgba(245,158,11,0.4)";

  const rowBg = isSelected
    ? "rgba(26,143,209,0.18)"
    : line.type === "added"
    ? "rgba(59,130,246,0.04)"
    : line.type === "removed"
    ? "rgba(239,68,68,0.04)"
    : "rgba(245,158,11,0.04)";

  // For long single-side lines, offer expand/collapse
  const mainText =
    line.type === "removed"
      ? (line.old_text ?? line.text ?? "")
      : (line.new_text ?? line.text ?? "");
  const MAX_LEN = 200;
  const isLong = mainText.length > MAX_LEN && line.type !== "modified";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left font-mono text-[11px] leading-5 transition-colors hover:brightness-110 px-2 py-1.5"
      style={{ background: rowBg, borderLeft }}
    >
      <div className="flex items-start gap-1.5 min-w-0">
        {/* Prefix glyph */}
        <span
          className="flex-shrink-0 w-3.5 font-bold select-none pt-0.5"
          style={{ color: accentColor }}
        >
          {line.type === "added" ? "+" : line.type === "removed" ? "−" : "~"}
        </span>

        {/* Text area */}
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          {line.type === "modified" ? (
            <>
              {oldSpans.length > 0 && <SpanRow spans={oldSpans} kind="mod-old" />}
              {newSpans.length > 0 && <SpanRow spans={newSpans} kind="mod-new" />}
            </>
          ) : line.type === "added" ? (
            <>
              {(!isLong || expanded) ? (
                <SpanRow spans={newSpans} kind="add" />
              ) : (
                <span className="text-slate-300 whitespace-pre-wrap break-words">
                  {mainText.slice(0, MAX_LEN)}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 text-[9px] text-cyan-300 underline underline-offset-2 hover:text-cyan-100"
                    onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault(); e.stopPropagation(); setExpanded(true);
                      }
                    }}
                  >
                    View More
                  </span>
                </span>
              )}
            </>
          ) : (
            // removed
            <>
              {(!isLong || expanded) ? (
                <SpanRow spans={oldSpans} kind="rem" />
              ) : (
                <span className="text-slate-300 whitespace-pre-wrap break-words">
                  {mainText.slice(0, MAX_LEN)}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 text-[9px] text-cyan-300 underline underline-offset-2 hover:text-cyan-100"
                    onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault(); e.stopPropagation(); setExpanded(true);
                      }
                    }}
                  >
                    View More
                  </span>
                </span>
              )}
              {isLong && expanded && (
                <span
                  role="button"
                  tabIndex={0}
                  className="text-[9px] text-slate-400 underline underline-offset-2 hover:text-slate-200 mt-0.5"
                  onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault(); e.stopPropagation(); setExpanded(false);
                    }
                  }}
                >
                  View Less
                </span>
              )}
            </>
          )}
        </span>

        {/* Page badges */}
        <span className="flex-shrink-0 flex items-center gap-1 flex-wrap justify-end pt-0.5">
          {line.old_page != null && <PageBadge page={line.old_page} kind="old" />}
          {line.new_page != null && <PageBadge page={line.new_page} kind="new" />}
        </span>
      </div>
    </button>
  );
}

// ── Summary pill bar ────────────────────────────────────────────────────────────

function SummaryBar({ lines }: { lines: DiffLine[] }) {
  const added    = lines.filter((l) => l.type === "added").length;
  const removed  = lines.filter((l) => l.type === "removed").length;
  const modified = lines.filter((l) => l.type === "modified").length;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {added > 0 && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-blue-500/20 text-blue-300 border-blue-500/30">
          + {added}
        </span>
      )}
      {removed > 0 && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-red-500/20 text-red-300 border-red-500/30">
          − {removed}
        </span>
      )}
      {modified > 0 && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-amber-500/20 text-amber-300 border-amber-500/30">
          ~ {modified}
        </span>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

interface DiffPanelProps {
  diffLines:          DiffLine[];
  /** Ignored — kept for backwards compatibility with callers that pass diffGroups */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diffGroups?:        any;
  chunkLabel?:        string;
  changeType?:        string;
  similarity?:        number;
  selectedLineIndex?: number | null;
  onSelectLine?:      (line: DiffLine, index: number) => void;
}

export default function DiffPanel({
  diffLines,
  chunkLabel,
  changeType,
  similarity,
  selectedLineIndex = null,
  onSelectLine,
}: DiffPanelProps) {
  const filtered = useMemo(
    () => diffLines.filter((l) => !isFalsePositive(l)),
    [diffLines],
  );

  const simPct   = similarity != null ? Math.round(similarity * 100) : null;
  const simColor = simPct == null
    ? "#64748b"
    : simPct >= 90 ? "#22c55e"
    : simPct >= 60 ? "#f59e0b"
    : "#ef4444";

  const changeBadge: Record<string, string> = {
    added:     "bg-blue-500/20 text-blue-300 border-blue-500/30",
    removed:   "bg-red-500/20 text-red-300 border-red-500/30",
    modified:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
    unchanged: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{ borderColor: "rgba(26,143,209,0.2)", background: "#0d1117" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-3 py-2 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.95)" }}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="w-4 h-4 text-amber-400 flex-shrink-0"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            <span className="text-xs font-bold text-white tracking-wide">Changes</span>
            {chunkLabel && (
              <span className="text-[10px] text-slate-500 truncate max-w-[110px]">
                {chunkLabel}
              </span>
            )}
            {changeType && (
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${
                  changeBadge[changeType] ?? changeBadge.unchanged
                }`}
              >
                {changeType}
              </span>
            )}
          </div>
          {simPct != null && (
            <span
              className="text-[10px] font-semibold flex-shrink-0"
              style={{ color: simColor }}
            >
              {simPct}% match
            </span>
          )}
        </div>

        {filtered.length > 0 && <SummaryBar lines={filtered} />}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-3 py-1 border-b text-[9px] text-slate-500"
        style={{ borderColor: "rgba(255,255,255,0.04)", background: "#161b22" }}
      >
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-blue-500/40 inline-block" /> Added
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-500/40 inline-block" /> Removed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-500/40 inline-block" /> Modified
        </span>
      </div>

      {/* ── Timeline ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden divide-y divide-white/[0.03]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <svg
              className="w-8 h-8 opacity-30"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-xs">No changes detected in this chunk</p>
          </div>
        ) : (
          filtered.map((line, i) => (
            <TimelineRow
              key={`${line.type}-${line.line}-${i}`}
              line={line}
              isSelected={selectedLineIndex === line.line}
              onClick={() => onSelectLine?.(line, line.line)}
            />
          ))
        )}
      </div>
    </div>
  );
}
