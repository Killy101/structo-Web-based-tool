"use client";
/**
 * DiffPanel — Grouped "Modify" view for PDF ↔ XML diff.
 *
 * Structure
 * ─────────
 *   Modify
 *   ├── Additions      (green  / +)   lines added in NEW
 *   ├── Removals       (red    / −)   lines removed from OLD
 *   ├── Modifications  (amber  / ~)   lines changed OLD → NEW
 *   ├── Mismatch       (orange / ≠)   structural / block-count mismatch
 *   └── Emphasis       (fuchsia/ ✦)   lines containing formatting tags
 *
 * Each line carries a sub-type badge:
 *   edit         — short word / phrase change
 *   textual      — full sentence / paragraph replacement
 *   innodreplace — structured XML element swap
 *   emphasis     — formatting tag change
 *
 * Sections are collapsible. Clicking a line fires onSelectLine so the
 * PDF viewers and XML editor follow focus.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DiffCategory, DiffGroup, DiffLine, DiffSubType } from "./types";

// ── Colour tokens ─────────────────────────────────────────────────────────────

const CATEGORY_CFG: Record<
  DiffCategory,
  {
    label:       string;
    prefix:      string;
    accent:      string;   // CSS colour for text / border
    bgLine:      string;   // rgba background for each line
    borderLine:  string;   // left-border colour per line
    headerBg:    string;   // section header background
    badge:       string;   // Tailwind classes for the count badge
    icon:        string;   // emoji / symbol shown in header
  }
> = {
  addition: {
    label:      "Additions",
    prefix:     "+",
    accent:     "#86efac",
    bgLine:     "rgba(34,197,94,0.07)",
    borderLine: "rgba(34,197,94,0.40)",
    headerBg:   "rgba(34,197,94,0.08)",
    badge:      "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    icon:       "+",
  },
  removal: {
    label:      "Removals",
    prefix:     "−",
    accent:     "#fca5a5",
    bgLine:     "rgba(239,68,68,0.07)",
    borderLine: "rgba(239,68,68,0.40)",
    headerBg:   "rgba(239,68,68,0.08)",
    badge:      "bg-red-500/20 text-red-300 border-red-500/30",
    icon:       "−",
  },
  modification: {
    label:      "Modifications",
    prefix:     "~",
    accent:     "#fcd34d",
    bgLine:     "rgba(245,158,11,0.08)",
    borderLine: "rgba(245,158,11,0.45)",
    headerBg:   "rgba(245,158,11,0.08)",
    badge:      "bg-amber-500/20 text-amber-300 border-amber-500/30",
    icon:       "~",
  },
  mismatch: {
    label:      "Mismatch",
    prefix:     "≠",
    accent:     "#fdba74",
    bgLine:     "rgba(249,115,22,0.08)",
    borderLine: "rgba(249,115,22,0.45)",
    headerBg:   "rgba(249,115,22,0.08)",
    badge:      "bg-orange-500/20 text-orange-300 border-orange-500/30",
    icon:       "≠",
  },
  emphasis: {
    label:      "Emphasis",
    prefix:     "✦",
    accent:     "#e879f9",
    bgLine:     "rgba(217,70,239,0.07)",
    borderLine: "rgba(217,70,239,0.40)",
    headerBg:   "rgba(217,70,239,0.07)",
    badge:      "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
    icon:       "✦",
  },
};

// ── Sub-type badge ─────────────────────────────────────────────────────────────

const SUBTYPE_CFG: Record<DiffSubType, { label: string; cls: string }> = {
  edit:         { label: "edit",         cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  textual:      { label: "textual",      cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  innodreplace: { label: "innodreplace", cls: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  emphasis:     { label: "emphasis",     cls: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
};

function SubTypeBadge({ sub }: { sub: DiffSubType }) {
  const c = SUBTYPE_CFG[sub];
  return (
    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${c.cls}`}>
      {c.label}
    </span>
  );
}

// ── Inline word diff for modification lines ────────────────────────────────────
// Splits old / new text at word boundaries and highlights changed words.

function wordTokens(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const oldWords = wordTokens(oldText);
  const newWords = wordTokens(newText);

  // Simple LCS-based word diff
  const n = oldWords.length;
  const m = newWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldWords[i] === newWords[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const removed: React.ReactNode[] = [];
  const added:   React.ReactNode[] = [];
  let i = 0, j = 0;
  let ki = 0, kj = 0;

  while (i < n || j < m) {
    if (i < n && j < m && oldWords[i] === newWords[j]) {
      removed.push(<span key={`r${ki++}`} className="text-slate-400">{oldWords[i]}</span>);
      added.push(  <span key={`a${kj++}`} className="text-slate-300">{newWords[j]}</span>);
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      added.push(<span key={`a${kj++}`} className="bg-emerald-500/25 text-emerald-200 rounded px-0.5">{newWords[j]}</span>);
      j++;
    } else {
      removed.push(<span key={`r${ki++}`} className="bg-red-500/25 text-red-200 rounded px-0.5 line-through">{oldWords[i]}</span>);
      i++;
    }
  }

  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap gap-0 leading-5">{removed}</span>
      <span className="flex flex-wrap gap-0 leading-5">{added}</span>
    </span>
  );
}

// ── Single diff line row ───────────────────────────────────────────────────────

function DiffLineRow({
  line,
  globalIdx,
  isSelected,
  cfg,
  onClick,
  onContextMenu,
}: {
  line:       DiffLine;
  globalIdx:  number;
  isSelected: boolean;
  cfg:        typeof CATEGORY_CFG[DiffCategory];
  onClick:    () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxLen = 120;
  const rawText = line.text || "\u00A0";
  const isLong = rawText.length > maxLen;
  const textToShow = expanded || !isLong ? rawText : `${rawText.slice(0, maxLen)}…`;
  const showInlineDiff =
    !isLong &&
    line.category === "modification" &&
    line.sub_type !== "innodreplace" &&
    line.old_text &&
    line.new_text;

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-full flex items-start gap-0 font-mono text-[11px] leading-5 text-left transition-colors"
      style={{
        background:  isSelected ? "rgba(26,143,209,0.18)" : cfg.bgLine,
        borderLeft:  `2px solid ${isSelected ? "#1a8fd1" : cfg.borderLine}`,
      }}
    >
      {/* Prefix glyph */}
      <span
        className="flex-shrink-0 w-6 text-center py-1 font-bold select-none"
        style={{ color: cfg.accent }}
      >
        {cfg.prefix}
      </span>

      {/* Main text */}
      <span className="flex-1 py-1 pr-2 break-words min-w-0">
        {showInlineDiff ? (
          <InlineDiff oldText={line.old_text!} newText={line.new_text!} />
        ) : (
          <>
            <span style={{ color: "#e2e8f0" }}>{textToShow}</span>
            {isLong && !expanded && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setExpanded(true);
                  }
                }}
                className="ml-1.5 text-[9px] text-cyan-300 hover:text-cyan-100 underline underline-offset-2"
              >
                View More
              </span>
            )}
            {isLong && expanded && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setExpanded(false);
                  }
                }}
                className="ml-1.5 text-[9px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
              >
                View Less
              </span>
            )}
          </>
        )}
      </span>

      {/* Right badges */}
      <span className="flex-shrink-0 flex items-center gap-1 py-1 pr-2 flex-wrap justify-end">
        {/* Sub-type */}
        <SubTypeBadge sub={line.sub_type} />

        {/* Page refs */}
        {line.old_page != null && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-blue-200 border border-blue-500/30 bg-blue-500/10">
            Old p.{line.old_page}
          </span>
        )}
        {line.new_page != null && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-violet-200 border border-violet-500/30 bg-violet-500/10">
            New p.{line.new_page}
          </span>
        )}
      </span>
    </button>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────────

function ModifySection({
  group,
  selectedLineIndex,
  onSelectLine,
  onContextGenerate,
  defaultOpen,
}: {
  group:             DiffGroup;
  selectedLineIndex: number | null;
  onSelectLine:      (line: DiffLine, idx: number) => void;
  onContextGenerate: (line: DiffLine, idx: number, e: React.MouseEvent) => void;
  defaultOpen:       boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const cfg = CATEGORY_CFG[group.category];

  return (
    <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors hover:brightness-125"
        style={{ background: cfg.headerBg }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{ color: cfg.accent, background: `${cfg.borderLine.replace("0.40", "0.18")}` }}
          >
            {cfg.icon}
          </span>
          <span className="text-xs font-semibold" style={{ color: cfg.accent }}>
            {group.label}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${cfg.badge}`}>
            {group.lines.length}
          </span>
        </div>
        <svg
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
          style={{ color: cfg.accent, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Lines */}
      {open && (
        <div>
          {group.lines.map((line, i) => (
            <DiffLineRow
              key={`${group.category}-${line.line}-${i}`}
              line={line}
              globalIdx={line.line}
              isSelected={selectedLineIndex === line.line}
              cfg={cfg}
              onClick={() => onSelectLine(line, line.line)}
              onContextMenu={(e) => onContextGenerate(line, line.line, e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Top-level summary bar ──────────────────────────────────────────────────────

function ModifySummary({ groups }: { groups: DiffGroup[] }) {
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {groups.map((g) => {
        const cfg = CATEGORY_CFG[g.category];
        return (
          <span
            key={g.category}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg.badge}`}
          >
            {cfg.icon} {g.lines.length}
          </span>
        );
      })}
    </div>
  );
}

// ── Fallback: build groups client-side when backend hasn't sent them ───────────

const EMPHASIS_RE = /<\/?(emphasis|emph|bold|italic|underline|strong|b|i|u|sub|sup|strike|highlight)\b|\b(emphasis|emph|bold|italic|underline|strong|sub|sup|strike|highlight)\b/i;
const INNOD_RE    = /<\/?(innod:|Change|Revision|Para|Clause|Section|Article|Schedule|Annex|Table|Row|Cell)\b/i;

function deriveCategoryClient(line: DiffLine): DiffCategory {
  const combined = (line.old_text ?? "") + (line.new_text ?? "") + line.text;
  if (EMPHASIS_RE.test(combined))                        return "emphasis";
  if (line.category && line.category !== "modification") return line.category as DiffCategory;
  if (line.type === "added")                             return "addition";
  if (line.type === "removed")                           return "removal";
  return "modification";
}

function deriveSubTypeClient(line: DiffLine): DiffSubType {
  if (line.sub_type) return line.sub_type as DiffSubType;
  const combined = (line.old_text ?? "") + (line.new_text ?? "") + line.text;
  if (EMPHASIS_RE.test(combined)) return "emphasis";
  if (INNOD_RE.test(combined))    return "innodreplace";
  const delta = Math.abs((line.old_text ?? "").length - (line.new_text ?? "").length);
  return delta <= 60 ? "edit" : "textual";
}

function buildGroupsClient(lines: DiffLine[]): DiffGroup[] {
  const order: DiffCategory[] = ["addition", "removal", "modification", "mismatch", "emphasis"];
  const labels: Record<DiffCategory, string> = {
    addition: "Additions", removal: "Removals", modification: "Modifications",
    mismatch: "Mismatch",  emphasis: "Emphasis",
  };
  const buckets: Record<DiffCategory, DiffLine[]> = {
    addition: [], removal: [], modification: [], mismatch: [], emphasis: [],
  };

  for (const line of lines) {
    const cat = deriveCategoryClient(line);
    const sub = deriveSubTypeClient(line);
    const enriched: DiffLine = { ...line, category: cat, sub_type: sub };
    buckets[cat].push(enriched);
    if (cat === "emphasis") {
      const primary: DiffCategory = line.type === "added" ? "addition" : line.type === "removed" ? "removal" : "modification";
      buckets[primary].push(enriched);
    }
  }

  return order.filter((c) => buckets[c].length > 0).map((c) => ({
    category: c, label: labels[c], lines: buckets[c],
  }));
}

// ── Main component ────────────────────────────────────────────────────────────

interface DiffPanelProps {
  diffLines:          DiffLine[];
  diffGroups?:        DiffGroup[];
  chunkLabel?:        string;
  changeType?:        string;
  similarity?:        number;
  selectedLineIndex?: number | null;
  onSelectLine?:      (line: DiffLine, index: number) => void;
}

export default function DiffPanel({
  diffLines,
  diffGroups,
  chunkLabel,
  changeType,
  similarity,
  selectedLineIndex = null,
  onSelectLine,
}: DiffPanelProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; line: DiffLine; idx: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [ctxMenu]);
  // Use server-provided groups when available, else build client-side
  const groups = useMemo<DiffGroup[]>(
    () => (diffGroups && diffGroups.length > 0) ? diffGroups : buildGroupsClient(diffLines),
    [diffLines, diffGroups],
  );

  const hasChanges = groups.length > 0;
  const simPct     = similarity != null ? Math.round(similarity * 100) : null;
  const simColor   = simPct == null ? "#64748b" : simPct >= 90 ? "#22c55e" : simPct >= 60 ? "#f59e0b" : "#ef4444";

  const changeBadge: Record<string, string> = {
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
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-3 py-2 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.95)" }}
      >
        {/* Row 1: title + chunk info */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span className="text-xs font-bold text-white tracking-wide">Modify</span>
            {chunkLabel && (
              <span className="text-[10px] text-slate-500 truncate max-w-[110px]">{chunkLabel}</span>
            )}
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

        {/* Row 2: section summary pills */}
        {hasChanges && <ModifySummary groups={groups} />}
      </div>

      {/* ── Sub-type legend ─────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-2 flex-wrap px-3 py-1.5 border-b text-[9px]"
        style={{ borderColor: "rgba(255,255,255,0.04)", background: "#161b22" }}
      >
        <span className="text-slate-600 font-semibold mr-0.5">op:</span>
        {(Object.entries(SUBTYPE_CFG) as [DiffSubType, { label: string; cls: string }][]).map(([k, v]) => (
          <span key={k} className={`px-1.5 py-0.5 rounded border font-semibold ${v.cls}`}>{v.label}</span>
        ))}
      </div>

      {/* ── Body: grouped sections ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
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
            {groups.map((group, gi) => (
              <ModifySection
                key={group.category}
                group={group}
                selectedLineIndex={selectedLineIndex}
                onSelectLine={(line, idx) => onSelectLine?.(line, idx)}
                onContextGenerate={(line, idx, e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, line, idx });
                }}
                defaultOpen={gi === 0 || group.lines.length <= 10}
              />
            ))}
          </div>
        )}
      </div>

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 min-w-[140px] rounded-lg border shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y, background: "#161b22", borderColor: "rgba(255,255,255,0.12)" }}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-[11px] font-semibold text-slate-300 hover:bg-slate-700/50 transition-colors"
            onClick={() => {
              onSelectLine?.(ctxMenu.line, ctxMenu.idx);
              setCtxMenu(null);
            }}
          >
            Jump to line
          </button>
        </div>
      )}
    </div>
  );
}