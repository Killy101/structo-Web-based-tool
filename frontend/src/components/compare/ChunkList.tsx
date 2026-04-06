"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chunk, ChunkKind, DiffStats } from "./types";
import { KIND_META } from "./types";

interface Props {
  chunks: Chunk[];
  stats: DiffStats;
  activeId: number | null;
  appliedIds: Set<number>;
  onSelect: (id: number) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  headerActions?: React.ReactNode;
}

type FilterKind = "all" | ChunkKind;

// ── Section group type ────────────────────────────────────────────────────────
interface SectionGroup {
  label: string;
  chunks: Chunk[];
}

function buildSectionGroups(chunks: Chunk[]): SectionGroup[] {
  const map = new Map<string, Chunk[]>();
  const order: string[] = [];

  for (const ch of chunks) {
    const key = ch.section || "";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(ch);
  }

  return order.map((key) => ({
    label: key || "Ungrouped",
    chunks: map.get(key)!,
  }));
}

// ── Chunk row component ───────────────────────────────────────────────────────
const ChunkRow = React.memo(function ChunkRow({
  ch,
  isActive,
  isApplied,
  onSelect,
}: {
  ch: Chunk;
  isActive: boolean;
  isApplied: boolean;
  onSelect: (id: number) => void;
}) {
  const m = KIND_META[ch.kind];
  const preview = (ch.text_b || ch.text_a).slice(0, 55);
  const context =
    ch.kind === "del" ? ch.context_b :
    ch.kind === "add" ? ch.context_a : "";
  const contextLabel =
    ch.kind === "del" ? "near (new):" :
    ch.kind === "add" ? "near (old):" : "";

  return (
    <button
      onClick={() => onSelect(ch.id)}
      className={`w-full flex items-start gap-2 px-2.5 py-1.5 mx-1 rounded-lg mb-0.5 text-left transition-all
        ${isActive
          ? `${m.bgClass} border ${m.ringClass} shadow-sm`
          : "border border-transparent hover:bg-slate-100 dark:hover:bg-white/4"
        }
        ${isApplied ? "opacity-40" : ""}`}
      style={{ width: "calc(100% - 8px)" }}
    >
      <span className={`flex-shrink-0 mt-0.5 text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded text-white ${m.pillClass}`}>
        {m.label}
      </span>
      <span className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed font-mono break-words min-w-0">
        {isApplied && (
          <span className="text-emerald-500 font-bold mr-1">✓</span>
        )}
        {preview}
        {preview.length === 55 ? "…" : ""}
        {ch.kind === "mod" && ch.words_removed && (
          <span className="block mt-1 text-[9px] leading-snug">
            <span className="text-rose-400 line-through">{ch.words_removed.slice(0, 40)}</span>
            {" → "}
            <span className="text-emerald-400">{(ch.words_added || "").slice(0, 40)}</span>
          </span>
        )}
        {ch.kind === "emp" && ch.emp_detail && (
          <span className="block mt-1 text-[9px] leading-snug">
            {ch.emp_detail.split("|").map((part, i) => {
              const t = part.trim();
              if (t.startsWith("xml_suggest:")) {
                return <span key={i} className="block text-amber-400 italic">{t}</span>;
              }
              const isRemoved = t.includes("removed");
              const isAdded = t.includes("added");
              return (
                <span key={i} className={`${isRemoved ? "text-rose-400" : isAdded ? "text-emerald-400" : "text-violet-400"}`}>
                  {t}{i < ch.emp_detail!.split("|").length - 1 ? " · " : ""}
                </span>
              );
            })}
          </span>
        )}
        {context && (
          <span className="block mt-1 text-[9px] text-slate-400 dark:text-slate-500 italic leading-snug">
            {contextLabel}{" "}
            {context.slice(0, 80)}{context.length > 80 ? "…" : ""}
          </span>
        )}
      </span>
    </button>
  );
});

// ── Section header (always expanded) ──────────────────────────────────────────
function SectionHeader({
  group,
  activeId,
  appliedIds,
  onSelect,
}: {
  group: SectionGroup;
  activeId: number | null;
  appliedIds: Set<number>;
  onSelect: (id: number) => void;
}) {
  const appliedCount = group.chunks.filter((c) => appliedIds.has(c.id)).length;
  const kinds = group.chunks.reduce(
    (acc, c) => {
      if (c.kind === "add") acc.add++;
      else if (c.kind === "del") acc.del++;
      else if (c.kind === "mod") acc.mod++;
      return acc;
    },
    { add: 0, del: 0, mod: 0 },
  );

  return (
    <div className="mb-0.5">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-100 dark:border-white/5">
        <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 truncate flex-1 leading-tight">
          {group.label}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {kinds.add > 0 && <span className="text-[8px] font-bold text-emerald-500">+{kinds.add}</span>}
          {kinds.del > 0 && <span className="text-[8px] font-bold text-rose-500">-{kinds.del}</span>}
          {kinds.mod > 0 && <span className="text-[8px] font-bold text-amber-500">~{kinds.mod}</span>}
          {appliedCount > 0 && (
            <span className="text-[8px] text-emerald-500/60">✓{appliedCount}</span>
          )}
        </span>
        <span className="text-[9px] font-mono text-slate-400 flex-shrink-0">
          {group.chunks.length}
        </span>
      </div>
      <div className="pl-1">
        {group.chunks.map((ch) => (
          <ChunkRow
            key={ch.id}
            ch={ch}
            isActive={ch.id === activeId}
            isApplied={appliedIds.has(ch.id)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChunkList({
  chunks, stats, activeId, appliedIds, onSelect, collapsed, onToggle, headerActions,
}: Props) {
  const [filter, setFilter] = useState<FilterKind>("all");

  const filtered = filter === "all" ? chunks : chunks.filter((c) => c.kind === filter);

  const hasSections = chunks.some((c) => c.section);
  const groups = useMemo(
    () => (hasSections ? buildSectionGroups(filtered) : null),
    [filtered, hasSections],
  );

  const filterBtn = (kind: FilterKind, label: string, count: number, color: string) => (
    <button
      key={kind}
      onClick={() => setFilter(kind)}
      className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all
        ${filter === kind
          ? `${color} text-white shadow-sm`
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
        }`}
    >
      {label} {count}
    </button>
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 bg-slate-50 dark:bg-[#0d1424]">
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/8 text-slate-400 transition-colors"
          title="Expand sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        <span className="text-[9px] font-bold text-slate-400 [writing-mode:vertical-lr] tracking-wider">
          {stats.total} CHANGES
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0d1424]">
      {/* Action buttons */}
      {headerActions && (
        <div className="flex-shrink-0 px-3 py-1.5 border-b border-slate-200 dark:border-white/8">
          {headerActions}
        </div>
      )}
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-slate-200 dark:border-white/8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {onToggle && (
              <button
                onClick={onToggle}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/8 text-slate-400 transition-colors"
                title="Collapse sidebar"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500">
              Changes
            </span>
          </div>
          <span className="text-[10px] font-semibold text-slate-400 font-mono">
            {stats.total} total
          </span>
        </div>

        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1">
          {filterBtn("all", "All", stats.total, "bg-slate-600")}
          {filterBtn("add", "+", stats.additions, "bg-emerald-600")}
          {filterBtn("del", "−", stats.deletions, "bg-rose-600")}
          {filterBtn("mod", "~", stats.modifications, "bg-amber-600")}
          {filterBtn("emp", "○", stats.emphasis, "bg-violet-600")}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 dark:scrollbar-thumb-white/10">
        {filtered.map((ch) => (
          <ChunkRow
            key={ch.id}
            ch={ch}
            isActive={ch.id === activeId}
            isApplied={appliedIds.has(ch.id)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
