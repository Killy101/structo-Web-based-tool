"use client";
/**
 * ChunkList v3
 * • Dark/light mode via the same ThemContext the Sidebar uses
 * • All dynamic colours via inline style — zero template-literal-in-className bugs
 * • Vivid, distinct color coding for each change type
 */

import React, { useMemo, useState } from "react";
import { useTheme } from "../../context/ThemContext";
import type { ChangeType, ChunkRow, ReviewStatus, ValidateAllChunkResult } from "./types";

// ── Change badge colours ──────────────────────────────────────────────────────

const CHANGE_COLORS: Record<ChangeType, { dark: string; light: string; bgDark: string; bgLight: string }> = {
  added:     { dark: "#34d399", light: "#059669", bgDark: "rgba(52,211,153,0.12)",  bgLight: "rgba(5,150,105,0.08)"   },
  removed:   { dark: "#f87171", light: "#dc2626", bgDark: "rgba(248,113,113,0.12)", bgLight: "rgba(220,38,38,0.08)"   },
  modified:  { dark: "#fbbf24", light: "#d97706", bgDark: "rgba(251,191,36,0.12)",  bgLight: "rgba(217,119,6,0.08)"   },
  unchanged: { dark: "#64748b", light: "#9ca3af", bgDark: "rgba(100,116,139,0.10)", bgLight: "rgba(156,163,175,0.12)" },
};

const CHANGE_LABELS: Record<ChangeType, string> = {
  added: "Added", removed: "Removed", modified: "Modified", unchanged: "Unchanged",
};

function ChangeBadge({ type, dark }: { type: ChangeType; dark: boolean }) {
  const c = CHANGE_COLORS[type];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border"
      style={{
        color:       dark ? c.dark  : c.light,
        background:  dark ? c.bgDark : c.bgLight,
        borderColor: (dark ? c.dark : c.light) + "50",
      }}
    >
      {CHANGE_LABELS[type]}
    </span>
  );
}

// ── Review-status dot ─────────────────────────────────────────────────────────

const REVIEW_META: Record<ReviewStatus, { icon: string; label: string; color: string }> = {
  pending:  { icon: "○", label: "Pending",  color: "#64748b" },
  reviewed: { icon: "◑", label: "Reviewed", color: "#3b82f6" },
  saved:    { icon: "●", label: "Saved",    color: "#10b981" },
};

function ReviewDot({ status }: { status: ReviewStatus }) {
  const m = REVIEW_META[status];
  return (
    <span
      className="text-[11px] leading-none flex-shrink-0"
      style={{ color: m.color }}
      title={m.label}
      aria-label={m.label}
    >
      {m.icon}
    </span>
  );
}

// ── Validate icon ─────────────────────────────────────────────────────────────

function ValidateIcon({ result }: { result: ValidateAllChunkResult }) {
  if (!result.xml_valid)
    return <span title="Invalid XML" className="text-[10px] text-red-400">✗</span>;
  if (result.needs_further_changes)
    return <span title="Needs review" className="text-[10px] text-amber-400">⚠</span>;
  if (result.status === "updated")
    return <span title="Updated & valid" className="text-[10px] text-emerald-400">✓</span>;
  if (result.status === "no_changes")
    return <span title="No changes needed" className="text-[10px] text-slate-500">=</span>;
  return <span title={result.status} className="text-[10px] text-slate-500">·</span>;
}

// ── Similarity bar ────────────────────────────────────────────────────────────

function SimilarityBar({ value, dark }: { value: number; dark: boolean }) {
  const pct   = Math.round(value * 100);
  const color = pct >= 90 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        style={{ background: dark ? "rgba(255,255,255,0.08)" : "#e5e7eb" }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[9px] w-7 text-right" style={{ color: dark ? "#475569" : "#9ca3af" }}>
        {pct}%
      </span>
    </div>
  );
}

// ── Filter tab ────────────────────────────────────────────────────────────────

function FilterTab({
  active, label, count, onClick, dark,
}: { active: boolean; label: string; count: number; onClick: () => void; dark: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-all"
      style={active ? {
        background: "linear-gradient(135deg,#1a8fd1,#146da3)",
        color: "#ffffff",
      } : {
        background: "transparent",
        color: dark ? "#94a3b8" : "#6b7280",
      }}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Filter = "all" | "changed" | "unchanged" | "pending" | "saved";

interface ChunkListProps {
  chunks: ChunkRow[];
  selectedIndex: number | null;
  onSelect: (chunk: ChunkRow) => void;
  validateResults?: Record<number, ValidateAllChunkResult>;
}

export default function ChunkList({
  chunks,
  selectedIndex,
  onSelect,
  validateResults,
}: ChunkListProps) {
  const { dark } = useTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = chunks;
    if (filter === "changed")   list = list.filter(c => c.has_changes);
    if (filter === "unchanged") list = list.filter(c => !c.has_changes);
    if (filter === "pending")   list = list.filter(c => (c.reviewStatus ?? "pending") === "pending" && c.has_changes);
    if (filter === "saved")     list = list.filter(c => c.reviewStatus === "saved");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.label.toLowerCase().includes(q) || c.filename.toLowerCase().includes(q)
      );
    }
    return list;
  }, [chunks, filter, search]);

  const changedCount   = chunks.filter(c => c.has_changes).length;
  const unchangedCount = chunks.length - changedCount;
  const pendingCount   = chunks.filter(c => (c.reviewStatus ?? "pending") === "pending" && c.has_changes).length;
  const savedCount     = chunks.filter(c => c.reviewStatus === "saved").length;

  // Theme tokens
  const panelBg  = dark ? "#0a1628"                    : "#ffffff";
  const hdrBdr   = dark ? "rgba(30,45,66,0.9)"         : "#e5e7eb";
  const titleClr = dark ? "#ffffff"                    : "#111827";
  const countClr = dark ? "#475569"                    : "#9ca3af";
  const tabBg    = dark ? "rgba(255,255,255,0.04)"     : "#f3f4f6";
  const inputBg  = dark ? "rgba(26,143,209,0.05)"      : "#f9fafb";
  const inputBdr = dark ? "rgba(26,143,209,0.18)"      : "#d1d5db";
  const inputClr = dark ? "#ffffff"                    : "#111827";
  const emptyClr = dark ? "#475569"                    : "#9ca3af";
  const divClr   = dark ? "rgba(30,45,66,0.8)"         : "#f3f4f6";

  return (
    <div className="flex flex-col h-full" style={{ background: panelBg }}>

      {/* Header */}
      <div className="flex-shrink-0 px-3 py-3 border-b" style={{ borderColor: hdrBdr }}>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-semibold" style={{ color: titleClr }}>Chunks</h3>
          <span className="text-[10px]" style={{ color: countClr }}>{chunks.length} total</span>
        </div>

        {/* Filter row 1 */}
        <div className="flex gap-0.5 p-1 rounded-lg mb-1.5" style={{ background: tabBg }}>
          <FilterTab dark={dark} active={filter==="all"}       label="All"       count={chunks.length}  onClick={() => setFilter("all")} />
          <FilterTab dark={dark} active={filter==="changed"}   label="Changed"   count={changedCount}   onClick={() => setFilter("changed")} />
          <FilterTab dark={dark} active={filter==="unchanged"} label="No Change" count={unchangedCount} onClick={() => setFilter("unchanged")} />
        </div>

        {/* Filter row 2 */}
        <div className="flex gap-0.5 p-1 rounded-lg mb-2.5" style={{ background: tabBg }}>
          <FilterTab dark={dark} active={filter==="pending"} label="○ Pending" count={pendingCount} onClick={() => setFilter("pending")} />
          <FilterTab dark={dark} active={filter==="saved"}   label="● Saved"   count={savedCount}   onClick={() => setFilter("saved")} />
        </div>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3"
            style={{ color: dark ? "#475569" : "#9ca3af" }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chunks…"
            className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[11px] border outline-none"
            style={{ background: inputBg, borderColor: inputBdr, color: inputClr }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8"
            style={{ color: emptyClr }}>
            <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p className="text-xs">No chunks match</p>
          </div>
        ) : (
          filtered.map((chunk) => {
            const isActive     = selectedIndex === chunk.index;
            const reviewStatus = chunk.reviewStatus ?? "pending";
            const valResult    = validateResults?.[chunk.index];

            const rowBg  = isActive
              ? dark ? "rgba(26,143,209,0.14)" : "rgba(59,130,246,0.06)"
              : "transparent";
            const rowBdrLeft  = isActive ? "#1a8fd1" : "transparent";
            const labelColor  = isActive
              ? (dark ? "#ffffff" : "#1d4ed8")
              : (dark ? "#cbd5e1" : "#374151");

            return (
              <button
                key={chunk.index}
                onClick={() => onSelect(chunk)}
                className="w-full text-left px-3 py-2.5 transition-all duration-100"
                style={{
                  background:   rowBg,
                  borderLeft:   `2px solid ${rowBdrLeft}`,
                  borderBottom: `1px solid ${divClr}`,
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background =
                      dark ? "rgba(255,255,255,0.03)" : "#f9fafb";
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {/* Top row: dot + label + badges */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ReviewDot status={reviewStatus} />
                    <span
                      className="text-[11px] font-medium truncate"
                      style={{ color: labelColor }}
                    >
                      {chunk.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {valResult && <ValidateIcon result={valResult} />}
                    <ChangeBadge type={chunk.change_type} dark={dark} />
                  </div>
                </div>

                {/* Filename */}
                <p
                  className="text-[9px] truncate mb-1.5"
                  style={{ color: dark ? "#475569" : "#9ca3af" }}
                >
                  {chunk.filename}
                </p>

                {/* Similarity bar */}
                <SimilarityBar value={chunk.similarity} dark={dark} />

                {/* Page range + size */}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px]" style={{ color: dark ? "#475569" : "#9ca3af" }}>
                    pp.{chunk.page_start + 1}–{chunk.page_end}
                  </span>
                  <span className="text-[9px]" style={{ color: dark ? "#475569" : "#9ca3af" }}>
                    {(chunk.xml_size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}