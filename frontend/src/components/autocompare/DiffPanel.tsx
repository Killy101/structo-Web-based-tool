"use client";
/**
 * DiffPanel — Grouped change view for Old PDF ↔ New PDF diff.
 *
 * Display format:
 * ─────────────────────────────────────────────────────────────
 *  ADDITION  → Full sentence shown; the added portion highlighted BLUE
 *  REMOVAL   → Full sentence shown; the removed portion highlighted RED
 *  MODIFICATION → Two rows:
 *                  OLD: full sentence, removed/changed words in RED
 *                  NEW: full sentence, added/changed words in BLUE
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DiffCategory, DiffGroup, DiffLine, DiffSubType } from "./types";

// ── Category config ────────────────────────────────────────────────────────────

type ActiveCategory = Extract<DiffCategory, "addition" | "removal" | "modification" | "mismatch">;

const CATEGORY_CFG: Record<
  ActiveCategory,
  {
    label:      string;
    accent:     string;
    rowBg:      string;
    rowBorder:  string;
    headerBg:   string;
    badge:      string;
    icon:       string;
    tooltip:    string;
    hlBg:       string;
    hlText:     string;
    labelBg:    string;
    labelText:  string;
  }
> = {
  addition: {
    label:      "Additions",
    accent:     "#60a5fa",
    rowBg:      "rgba(59,130,246,0.04)",
    rowBorder:  "rgba(59,130,246,0.30)",
    headerBg:   "rgba(59,130,246,0.08)",
    badge:      "bg-blue-500/20 text-blue-300 border-blue-500/30",
    icon:       "+",
    tooltip:    "Text added in the New PDF",
    hlBg:       "#1d4ed8",
    hlText:     "#ffffff",
    labelBg:    "rgba(59,130,246,0.18)",
    labelText:  "#93c5fd",
  },
  removal: {
    label:      "Removals",
    accent:     "#f87171",
    rowBg:      "rgba(239,68,68,0.04)",
    rowBorder:  "rgba(239,68,68,0.30)",
    headerBg:   "rgba(239,68,68,0.08)",
    badge:      "bg-red-500/20 text-red-300 border-red-500/30",
    icon:       "−",
    tooltip:    "Text removed from the Old PDF",
    hlBg:       "#b91c1c",
    hlText:     "#ffffff",
    labelBg:    "rgba(239,68,68,0.18)",
    labelText:  "#fca5a5",
  },
  modification: {
    label:      "Modifications",
    accent:     "#fb923c",
    rowBg:      "rgba(249,115,22,0.04)",
    rowBorder:  "rgba(249,115,22,0.30)",
    headerBg:   "rgba(249,115,22,0.08)",
    badge:      "bg-orange-500/20 text-orange-300 border-orange-500/30",
    icon:       "~",
    tooltip:    "Text changed between Old and New PDF",
    hlBg:       "#c2410c",
    hlText:     "#ffffff",
    labelBg:    "rgba(249,115,22,0.18)",
    labelText:  "#fdba74",
  },
  mismatch: {
    label:      "Mismatch",
    accent:     "#a78bfa",
    rowBg:      "rgba(139,92,246,0.04)",
    rowBorder:  "rgba(139,92,246,0.30)",
    headerBg:   "rgba(139,92,246,0.08)",
    badge:      "bg-violet-500/20 text-violet-300 border-violet-500/30",
    icon:       "≠",
    tooltip:    "Structural mismatch between Old and New PDF",
    hlBg:       "#6d28d9",
    hlText:     "#ffffff",
    labelBg:    "rgba(139,92,246,0.18)",
    labelText:  "#c4b5fd",
  },
};

// ── Tokeniser ─────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

// ── HighlightedSentence ───────────────────────────────────────────────────────
// Shows fullText with changedFragment highlighted in the given colour.

function HighlightedSentence({
  fullText,
  changedFragment,
  hlBg,
  hlText,
}: {
  fullText:        string;
  changedFragment: string;
  hlBg:            string;
  hlText:          string;
}) {
  if (!fullText) return null;

  const lower     = fullText.toLowerCase();
  const fragLower = (changedFragment || "").toLowerCase().trim();

  // Try substring match first
  if (fragLower.length >= 3) {
    const idx = lower.indexOf(fragLower);
    if (idx >= 0) {
      const before  = fullText.slice(0, idx);
      const matched = fullText.slice(idx, idx + changedFragment.length);
      const after   = fullText.slice(idx + changedFragment.length);
      return (
        <span className="leading-relaxed break-words">
          {before && <span style={{ color: "#e2e8f0" }}>{before}</span>}
          <span className="rounded px-0.5 font-semibold" style={{ background: hlBg, color: hlText }}>
            {matched}
          </span>
          {after && <span style={{ color: "#e2e8f0" }}>{after}</span>}
        </span>
      );
    }
  }

  // Fallback — highlight whole text
  return (
    <span className="rounded px-0.5 font-semibold leading-relaxed break-words"
      style={{ background: hlBg, color: hlText }}>
      {fullText}
    </span>
  );
}

// ── ModificationRows ──────────────────────────────────────────────────────────
// Renders OLD row (red changed words) and NEW row (blue changed words).

function ModificationRows({ oldText, newText }: { oldText: string; newText: string }) {
  const oldTokens = tokenise(oldText);
  const newTokens = tokenise(newText);
  const n = oldTokens.length;
  const m = newTokens.length;

  // LCS dp
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldTokens[i] === newTokens[j]
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const oldNodes: React.ReactNode[] = [];
  const newNodes: React.ReactNode[] = [];
  let i = 0, j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && oldTokens[i] === newTokens[j]) {
      oldNodes.push(<span key={`o${i}`} style={{ color: "#cbd5e1" }}>{oldTokens[i]}</span>);
      newNodes.push(<span key={`n${j}`} style={{ color: "#cbd5e1" }}>{newTokens[j]}</span>);
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      newNodes.push(
        <span key={`n${j}`} className="rounded px-0.5 font-semibold"
          style={{ background: "#1d4ed8", color: "#fff" }}>
          {newTokens[j]}
        </span>
      );
      j++;
    } else {
      oldNodes.push(
        <span key={`o${i}`} className="rounded px-0.5 font-semibold"
          style={{ background: "#b91c1c", color: "#fff" }}>
          {oldTokens[i]}
        </span>
      );
      i++;
    }
  }

  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap gap-0 leading-relaxed items-baseline">
        <span className="inline-block text-[9px] font-bold rounded px-1 py-0.5 mr-1.5 flex-shrink-0"
          style={{ background: "rgba(239,68,68,0.18)", color: "#fca5a5" }}>
          OLD
        </span>
        {oldNodes}
      </span>
      <span className="flex flex-wrap gap-0 leading-relaxed items-baseline">
        <span className="inline-block text-[9px] font-bold rounded px-1 py-0.5 mr-1.5 flex-shrink-0"
          style={{ background: "rgba(59,130,246,0.18)", color: "#93c5fd" }}>
          NEW
        </span>
        {newNodes}
      </span>
    </span>
  );
}

// ── DiffLineRow ───────────────────────────────────────────────────────────────

function DiffLineRow({
  line,
  isSelected,
  cfg,
  onClick,
  onContextMenu,
}: {
  line:          DiffLine;
  isSelected:    boolean;
  cfg:           typeof CATEGORY_CFG[ActiveCategory];
  onClick:       () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const cat = (line.category ?? line.type) as string;
  const isAddition     = cat === "addition"  || cat === "added";
  const isRemoval      = cat === "removal"   || cat === "removed";
  const isModification = cat === "modification" || cat === "mismatch" || cat === "modified";

  const oldText = (line.old_text ?? "").trim();
  const newText = (line.new_text ?? "").trim();

  const MAX_LEN = 400;

  const renderContent = () => {
    // ── MODIFICATION / MISMATCH: two-row old/new with word diff ──
    if (isModification && oldText && newText) {
      const combinedLen = oldText.length + newText.length;
      if (!expanded && combinedLen > MAX_LEN * 2) {
        return (
          <span className="text-[11px]">
            <span style={{ color: "#94a3b8" }}>
              {oldText.slice(0, 80)}… → {newText.slice(0, 80)}…
            </span>
            <button type="button" className="ml-2 text-[9px] text-cyan-300 underline"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>
              View full
            </button>
          </span>
        );
      }
      return <ModificationRows oldText={expanded ? oldText : oldText.slice(0, MAX_LEN)}
                               newText={expanded ? newText : newText.slice(0, MAX_LEN)} />;
    }

    // ── ADDITION: show full new sentence, highlight added part blue ──
    if (isAddition) {
      const full = newText || line.text || "";
      const frag = newText || line.text || "";
      if (!expanded && full.length > MAX_LEN) {
        return (
          <span>
            <HighlightedSentence fullText={full.slice(0, MAX_LEN) + "…"} changedFragment={frag}
              hlBg={cfg.hlBg} hlText={cfg.hlText} />
            <button type="button" className="ml-2 text-[9px] text-cyan-300 underline"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>View full</button>
          </span>
        );
      }
      return <HighlightedSentence fullText={full} changedFragment={frag}
               hlBg={cfg.hlBg} hlText={cfg.hlText} />;
    }

    // ── REMOVAL: show full old sentence, highlight removed part red ──
    if (isRemoval) {
      const full = oldText || line.text || "";
      const frag = oldText || line.text || "";
      if (!expanded && full.length > MAX_LEN) {
        return (
          <span>
            <HighlightedSentence fullText={full.slice(0, MAX_LEN) + "…"} changedFragment={frag}
              hlBg={cfg.hlBg} hlText={cfg.hlText} />
            <button type="button" className="ml-2 text-[9px] text-cyan-300 underline"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>View full</button>
          </span>
        );
      }
      return <HighlightedSentence fullText={full} changedFragment={frag}
               hlBg={cfg.hlBg} hlText={cfg.hlText} />;
    }

    // Fallback
    return <span style={{ color: "#e2e8f0" }}>{line.text || "\u00A0"}</span>;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-full text-left text-[11px] transition-colors px-3 py-2.5"
      style={{
        background:   isSelected ? "rgba(26,143,209,0.15)" : cfg.rowBg,
        borderLeft:   `3px solid ${isSelected ? "#1a8fd1" : cfg.rowBorder}`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex items-start gap-2 min-w-0">
        {/* Label pill */}
        <span
          className="flex-shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{ background: cfg.labelBg, color: cfg.labelText }}
        >
          {isAddition ? "Added" : isRemoval ? "Removed" : "Modified"}
        </span>

        {/* Content */}
        <span className="flex-1 min-w-0 font-sans leading-relaxed">
          {renderContent()}
        </span>

        {/* Page badges */}
        <span className="flex-shrink-0 flex flex-col items-end gap-1 ml-1">
          {line.old_page != null && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold text-blue-200 border-blue-500/30 bg-blue-500/10 whitespace-nowrap">
              Old p.{line.old_page}
            </span>
          )}
          {line.new_page != null && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold text-violet-200 border-violet-500/30 bg-violet-500/10 whitespace-nowrap">
              New p.{line.new_page}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

// ── DiffSection ───────────────────────────────────────────────────────────────

function DiffSection({
  group, selectedLineIndex, onSelectLine, onContextGenerate, defaultOpen,
}: {
  group:             DiffGroup;
  selectedLineIndex: number | null;
  onSelectLine:      (line: DiffLine, idx: number) => void;
  onContextGenerate: (line: DiffLine, idx: number, e: React.MouseEvent) => void;
  defaultOpen:       boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (group.category === "emphasis") return null;
  const cfg = CATEGORY_CFG[group.category as ActiveCategory];
  if (!cfg) return null;

  return (
    <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-all hover:brightness-110"
        style={{ background: cfg.headerBg }}
        title={cfg.tooltip}
      >
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ color: cfg.accent, background: cfg.rowBorder.replace("0.30", "0.15") }}>
            {cfg.icon}
          </span>
          <span className="text-xs font-bold" style={{ color: cfg.accent }}>
            {group.label ?? cfg.label}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${cfg.badge}`}>
            {group.lines.length}
          </span>
        </div>
        <svg className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
          style={{ color: cfg.accent, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div>
          {group.lines.map((line, i) => (
            <DiffLineRow
              key={`${group.category}-${line.line}-${i}`}
              line={line}
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

// ── DiffSummary ───────────────────────────────────────────────────────────────

function DiffSummary({ groups }: { groups: DiffGroup[] }) {
  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {groups.filter((g) => g.category !== "emphasis").map((g) => {
        const cfg = CATEGORY_CFG[g.category as ActiveCategory];
        if (!cfg) return null;
        return (
          <span key={g.category}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg.badge}`}
            title={cfg.tooltip}>
            {cfg.icon} {g.lines.length}
          </span>
        );
      })}
    </div>
  );
}

// ── Client-side group builder ─────────────────────────────────────────────────

const INNOD_RE = /<\/?(innod:|Change|Revision|Para|Clause|Section|Article|Schedule|Annex|Table|Row|Cell)\b/i;

function deriveCategoryClient(line: DiffLine): ActiveCategory {
  if (line.category && line.category !== "modification" && line.category !== "emphasis")
    return line.category as ActiveCategory;
  if (line.type === "added")   return "addition";
  if (line.type === "removed") return "removal";
  return "modification";
}

function deriveSubTypeClient(line: DiffLine): DiffSubType {
  if (line.sub_type && line.sub_type !== "emphasis") return line.sub_type;
  const combined = (line.old_text ?? "") + (line.new_text ?? "") + line.text;
  if (INNOD_RE.test(combined)) return "innodreplace";
  const delta = Math.abs((line.old_text ?? "").length - (line.new_text ?? "").length);
  return delta <= 60 ? "edit" : "textual";
}

function buildGroupsClient(lines: DiffLine[]): DiffGroup[] {
  const order: ActiveCategory[] = ["addition", "removal", "modification", "mismatch"];
  const labels: Record<ActiveCategory, string> = {
    addition: "Additions", removal: "Removals", modification: "Modifications", mismatch: "Mismatch",
  };
  const buckets: Record<ActiveCategory, DiffLine[]> = {
    addition: [], removal: [], modification: [], mismatch: [],
  };
  for (const line of lines) {
    const cat = deriveCategoryClient(line);
    const sub = deriveSubTypeClient(line);
    buckets[cat].push({ ...line, category: cat, sub_type: sub });
  }
  return order
    .filter((c) => buckets[c].length > 0)
    .map((c) => ({ category: c, label: labels[c], lines: buckets[c] }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

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
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; line: DiffLine; idx: number;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [ctxMenu]);

  const groups = useMemo<DiffGroup[]>(() => {
    const raw = (diffGroups && diffGroups.length > 0) ? diffGroups : buildGroupsClient(diffLines);
    return raw.filter((g) => g.category !== "emphasis");
  }, [diffLines, diffGroups]);

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
    <div className="flex flex-col h-full rounded-xl overflow-hidden border"
      style={{ borderColor: "rgba(26,143,209,0.2)", background: "#0d1117" }}>

      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b"
        style={{ borderColor: "rgba(26,143,209,0.15)", background: "rgba(13,17,23,0.97)" }}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span className="text-xs font-bold text-white">Changes</span>
            {chunkLabel && <span className="text-[10px] text-slate-500 truncate max-w-[100px]">{chunkLabel}</span>}
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

        {/* Axis */}
        <div className="flex items-center gap-2 mb-2 text-[9px]">
          <span className="px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 font-semibold">Old PDF</span>
          <span className="text-slate-600">←→</span>
          <span className="px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 font-semibold">New PDF</span>
        </div>

        {/* Colour key + summary pills */}
        <div className="flex items-center gap-3 text-[9px] flex-wrap">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#1d4ed8" }} />
            <span className="text-slate-400">Added</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#b91c1c" }} />
            <span className="text-slate-400">Removed</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#c2410c" }} />
            <span className="text-slate-400">Modified</span>
          </span>
          {hasChanges && (
            <span className="ml-auto">
              <DiffSummary groups={groups} />
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {!hasChanges ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600 py-10">
            <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs">No content changes between Old and New PDF</p>
          </div>
        ) : (
          <div>
            {groups.map((group, gi) => (
              <DiffSection
                key={group.category}
                group={group}
                selectedLineIndex={selectedLineIndex}
                onSelectLine={(line, idx) => onSelectLine?.(line, idx)}
                onContextGenerate={(line, idx, e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, line, idx });
                }}
                defaultOpen={gi === 0 || group.lines.length <= 15}
              />
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div ref={ctxMenuRef}
          className="fixed z-50 min-w-[140px] rounded-lg border shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y, background: "#161b22", borderColor: "rgba(255,255,255,0.12)" }}>
          <button type="button"
            className="w-full px-3 py-2 text-left text-[11px] font-semibold text-slate-300 hover:bg-slate-700/50 transition-colors"
            onClick={() => { onSelectLine?.(ctxMenu.line, ctxMenu.idx); setCtxMenu(null); }}>
            Jump to line
          </button>
        </div>
      )}
    </div>
  );
}