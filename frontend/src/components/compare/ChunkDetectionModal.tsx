"use client";
// components/compare/ChunkDetectionModal.tsx
// Patch 10 — Chunk Detection Report modal.
// Shows per-section coverage stats: how many chunks were detected, how many
// XML sections had no matching chunks (xmlOnly), and how many MOD chunks have
// low confidence (<0.80).

import React, { useMemo } from "react";
import type { DiffResult, XmlSection } from "./types";

interface Props {
  result:        DiffResult;
  xmlSections:   XmlSection[];
  sectionMapper: (s: string) => string | null;
  onClose:       () => void;
}

export default function ChunkDetectionModal({
  result,
  xmlSections,
  sectionMapper,
  onClose,
}: Props) {
  const stats = useMemo(() => {
    const detected     = result.chunks.filter((c) => c.kind === "mod" || c.kind === "emp");
    const oneSided     = result.chunks.filter((c) => c.kind === "add" || c.kind === "del");
    const sectionsCovered = new Set<string>();
    for (const c of result.chunks) {
      const label = sectionMapper(c.section ?? "");
      if (label) sectionsCovered.add(label);
    }
    const xmlOnly = xmlSections.filter((s) => !sectionsCovered.has(s.label));
    const lowConfidence = result.chunks.filter(
      (c) => c.kind === "mod" && (c.confidence ?? 1) < 0.80,
    );
    return { detected, oneSided, xmlOnly, lowConfidence };
  }, [result.chunks, xmlSections, sectionMapper]);

  const perSection = useMemo(() => {
    const m = new Map<string, { matched: number; missing: number; lowConf: number }>();
    for (const s of xmlSections) m.set(s.label, { matched: 0, missing: 0, lowConf: 0 });
    for (const c of result.chunks) {
      const label = sectionMapper(c.section ?? "");
      if (!label) continue;
      const entry = m.get(label);
      if (!entry) continue;
      entry.matched++;
      if (c.kind === "mod" && (c.confidence ?? 1) < 0.80) entry.lowConf++;
    }
    for (const [, entry] of m) {
      if (entry.matched === 0) entry.missing = 1;
    }
    return m;
  }, [result.chunks, xmlSections, sectionMapper]);

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Chunk Detection Report
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {stats.detected.length + stats.oneSided.length} chunks across{" "}
              {xmlSections.length} XML sections
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors"
          >
            Continue
          </button>
        </div>

        {/* Summary stat tiles */}
        <div className="grid grid-cols-4 gap-2 p-4 border-b border-slate-200 dark:border-white/8">
          <Stat label="Detected"       count={stats.detected.length}       color="emerald" />
          <Stat label="One-sided"      count={stats.oneSided.length}       color="amber"   />
          <Stat label="XML-only"       count={stats.xmlOnly.length}        color="rose"    />
          <Stat label="Low confidence" count={stats.lowConfidence.length}  color="violet"  />
        </div>

        {/* Per-section list */}
        <div className="max-h-[50vh] overflow-y-auto p-3">
          {Array.from(perSection.entries()).map(([label, entry]) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/3"
            >
              <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">
                {label}
              </span>
              {entry.missing > 0 ? (
                <span className="text-[10px] font-mono text-rose-400">
                  no chunks detected
                </span>
              ) : (
                <span className="text-[10px] font-mono">
                  <span className="text-emerald-400">{entry.matched} matched</span>
                  {entry.lowConf > 0 && (
                    <span className="text-violet-400 ml-2">{entry.lowConf} low-conf</span>
                  )}
                </span>
              )}
            </div>
          ))}
          {perSection.size === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">
              No XML sections to display.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  const bg =
    ({
      emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
      amber:   "bg-amber-500/10   text-amber-400   border-amber-500/25",
      rose:    "bg-rose-500/10    text-rose-400    border-rose-500/25",
      violet:  "bg-violet-500/10  text-violet-400  border-violet-500/25",
    } as Record<string, string>)[color] ??
    "bg-slate-500/10 text-slate-400 border-slate-500/25";

  return (
    <div className={`rounded-xl border ${bg} px-3 py-2`}>
      <div className="text-[18px] font-bold tabular-nums">{count}</div>
      <div className="text-[9px] uppercase tracking-wider font-semibold opacity-70">
        {label}
      </div>
    </div>
  );
}
