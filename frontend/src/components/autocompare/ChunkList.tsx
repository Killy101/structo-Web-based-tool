"use client";
/**
 * ChunkList — Left panel showing all XML chunks with change indicators.
 *
 * Features
 * ────────
 * - Filterable by change type (all / changed / unchanged)
 * - Colour-coded badges: red=removed, green=added, yellow=modified, grey=unchanged
 * - Review-status badges: pending / reviewed / saved (feature #1)
 * - Validate-All result icons shown per chunk (feature #7)
 * - Similarity score bar
 * - Click to select a chunk for detail view
 * - Shows page range and XML size
 */

import React, { useMemo, useState } from "react";
import type { ChangeType, ChunkRow, ReviewStatus, ValidateAllChunkResult } from "./types";

// ── Change badge ──────────────────────────────────────────────────────────────

const CHANGE_STYLES: Record<ChangeType, { bg: string; text: string; label: string }> = {
  added:     { bg: "bg-emerald-500/20 border-emerald-500/30", text: "text-emerald-300", label: "Added" },
  removed:   { bg: "bg-red-500/20 border-red-500/30",         text: "text-red-300",     label: "Removed" },
  modified:  { bg: "bg-amber-500/20 border-amber-500/30",     text: "text-amber-300",   label: "Modified" },
  unchanged: { bg: "bg-slate-600/20 border-slate-600/30",     text: "text-slate-400",   label: "Unchanged" },
};

function ChangeBadge({ type }: { type: ChangeType }) {
  const s = CHANGE_STYLES[type];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ── Review-status badge (Feature #1) ─────────────────────────────────────────

const REVIEW_STYLES: Record<ReviewStatus, { icon: string; label: string; className: string }> = {
  pending:  { icon: "○", label: "Pending",  className: "text-slate-500" },
  reviewed: { icon: "◑", label: "Reviewed", className: "text-blue-400" },
  saved:    { icon: "●", label: "Saved",    className: "text-emerald-400" },
};

function ReviewDot({ status }: { status: ReviewStatus }) {
  const s = REVIEW_STYLES[status];
  return (
    <span
      className={`text-[11px] leading-none ${s.className}`}
      title={s.label}
      aria-label={s.label}
    >
      {s.icon}
    </span>
  );
}

// ── Validate-All result icon (Feature #7) ─────────────────────────────────────

function ValidateIcon({ result }: { result: ValidateAllChunkResult }) {
  if (!result.xml_valid) {
    return (
      <span title="Invalid XML" className="text-[10px] text-red-400">✗</span>
    );
  }
  if (result.needs_further_changes) {
    return (
      <span title="Needs review" className="text-[10px] text-amber-400">⚠</span>
    );
  }
  if (result.status === "updated") {
    return (
      <span title="Updated & valid" className="text-[10px] text-emerald-400">✓</span>
    );
  }
  if (result.status === "no_changes") {
    return (
      <span title="No changes needed" className="text-[10px] text-slate-500">=</span>
    );
  }
  return (
    <span title={result.status} className="text-[10px] text-slate-500">·</span>
  );
}

// ── Similarity bar ────────────────────────────────────────────────────────────

function SimilarityBar({ value }: { value: number }) {
  const pct   = Math.round(value * 100);
  const color = pct >= 90 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-slate-700/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[9px] text-slate-500 w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Filter tab ────────────────────────────────────────────────────────────────

type Filter = "all" | "changed" | "unchanged" | "pending" | "saved";

function FilterTab({ active, label, count, onClick }: {
  active: boolean; label: string; count: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-all ${
        active
          ? "bg-[#1a8fd1] text-white shadow"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
      }`}
    >
      {label} <span className={`ml-1 ${active ? "text-white/70" : "text-slate-500"}`}>({count})</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ChunkListProps {
  chunks: ChunkRow[];
  selectedIndex: number | null;
  onSelect: (chunk: ChunkRow) => void;
  /** Validate-All results keyed by chunk index, for per-chunk icons */
  validateResults?: Record<number, ValidateAllChunkResult>;
}

export default function ChunkList({
  chunks,
  selectedIndex,
  onSelect,
  validateResults,
}: ChunkListProps) {
  const [filter,  setFilter]  = useState<Filter>("all");
  const [search,  setSearch]  = useState("");

  const filtered = useMemo(() => {
    let list = chunks;
    if (filter === "changed")   list = list.filter((c) => c.has_changes);
    if (filter === "unchanged") list = list.filter((c) => !c.has_changes);
    if (filter === "pending")   list = list.filter((c) => (c.reviewStatus ?? "pending") === "pending" && c.has_changes);
    if (filter === "saved")     list = list.filter((c) => c.reviewStatus === "saved");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.label.toLowerCase().includes(q) || c.filename.toLowerCase().includes(q));
    }
    return list;
  }, [chunks, filter, search]);

  const changedCount   = chunks.filter((c) => c.has_changes).length;
  const unchangedCount = chunks.length - changedCount;
  const pendingCount   = chunks.filter((c) => (c.reviewStatus ?? "pending") === "pending" && c.has_changes).length;
  const savedCount     = chunks.filter((c) => c.reviewStatus === "saved").length;

  return (
    <div className="flex flex-col h-full" style={{ borderColor: "rgba(26,143,209,0.1)" }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-3 py-3 border-b"
        style={{ borderColor: "rgba(26,143,209,0.1)" }}
      >
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-semibold text-white">Chunks</h3>
          <span className="text-[10px] text-slate-500">{chunks.length} total</span>
        </div>

        {/* Filter tabs — row 1 */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-800/40 mb-1.5">
          <FilterTab active={filter === "all"}       label="All"       count={chunks.length}  onClick={() => setFilter("all")} />
          <FilterTab active={filter === "changed"}   label="Changed"   count={changedCount}   onClick={() => setFilter("changed")} />
          <FilterTab active={filter === "unchanged"} label="No Change" count={unchangedCount} onClick={() => setFilter("unchanged")} />
        </div>

        {/* Filter tabs — row 2: review status shortcuts */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-800/40 mb-2.5">
          <FilterTab active={filter === "pending"} label="○ Pending" count={pendingCount} onClick={() => setFilter("pending")} />
          <FilterTab active={filter === "saved"}   label="● Saved"   count={savedCount}   onClick={() => setFilter("saved")} />
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chunks…"
            className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[11px] text-white placeholder-slate-500 border outline-none"
            style={{
              background:  "rgba(26,143,209,0.05)",
              borderColor: "rgba(26,143,209,0.15)",
            }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8 text-slate-500">
            <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-xs">No chunks match</p>
          </div>
        ) : (
          filtered.map((chunk) => {
            const isActive     = selectedIndex === chunk.index;
            const reviewStatus = chunk.reviewStatus ?? "pending";
            const valResult    = validateResults?.[chunk.index];

            return (
              <button
                key={chunk.index}
                onClick={() => onSelect(chunk)}
                className={`w-full text-left px-3 py-2.5 border-b transition-all duration-100 ${
                  isActive
                    ? "bg-[rgba(26,143,209,0.12)] border-l-2 border-l-[#1a8fd1]"
                    : "hover:bg-slate-800/30"
                }`}
                style={{ borderBottomColor: "rgba(26,143,209,0.07)" }}
              >
                {/* Top row: review dot + label + icons */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ReviewDot status={reviewStatus} />
                    <span className={`text-[11px] font-medium truncate ${isActive ? "text-white" : "text-slate-300"}`}>
                      {chunk.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {valResult && <ValidateIcon result={valResult} />}
                    <ChangeBadge type={chunk.change_type} />
                  </div>
                </div>

                {/* Filename */}
                <p className="text-[9px] text-slate-600 truncate mb-1.5">{chunk.filename}</p>

                {/* Similarity bar */}
                <SimilarityBar value={chunk.similarity} />

                {/* Page range + size */}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-slate-600">
                    pp. {chunk.page_start + 1}–{chunk.page_end}
                  </span>
                  <span className="text-[9px] text-slate-600">
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