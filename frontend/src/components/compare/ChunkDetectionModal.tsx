"use client";
// ─────────────────────────────────────────────────────────────────────────────
// ChunkDetectionModal.tsx — Chunk detection report modal
//
// Shows a summary of how many diff chunks were detected per XML section,
// which sections had no chunks at all ("XML-only"), one-sided changes, and
// low-confidence modifications. Helps users identify missed detections and
// understand why some sections may appear empty in the diff viewer.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from "react";
import type { DiffResult, XmlSection } from "./types";

interface Props {
  result:        DiffResult;
  xmlSections:   XmlSection[];
  sectionMapper: (s: string) => string | null;
  onClose:       () => void;
}

const LOW_CONF_THRESHOLD = 0.80;

function StatCard({ label, count, sub, color }: {
  label: string; count: number; sub?: string; color: "emerald" | "amber" | "rose" | "violet" | "slate";
}) {
  const cls = {
    emerald: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400",
    amber:   "bg-amber-500/10 border-amber-500/25 text-amber-400",
    rose:    "bg-rose-500/10 border-rose-500/25 text-rose-400",
    violet:  "bg-violet-500/10 border-violet-500/25 text-violet-400",
    slate:   "bg-slate-500/10 border-slate-500/25 text-slate-400",
  }[color];
  return (
    <div className={`rounded-xl border ${cls} px-3 py-2.5 flex flex-col`}>
      <div className="text-2xl font-bold tabular-nums leading-tight">{count}</div>
      <div className="text-[9px] uppercase tracking-wider font-semibold opacity-70 mt-0.5">{label}</div>
      {sub && <div className="text-[9px] opacity-50 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ChunkDetectionModal({ result, xmlSections, sectionMapper, onClose }: Props) {
  // ── Global stats ──────────────────────────────────────────────────────────
  const globalStats = useMemo(() => {
    const bilateral   = result.chunks.filter((c) => c.kind === "mod" || c.kind === "emp" || c.kind === "strike");
    const oneSided    = result.chunks.filter((c) => c.kind === "add" || c.kind === "del");
    const lowConf     = result.chunks.filter((c) => c.kind === "mod" && c.confidence < LOW_CONF_THRESHOLD);
    const highConf    = result.chunks.filter((c) => c.kind === "mod" && c.confidence >= LOW_CONF_THRESHOLD);

    const covered = new Set<string>();
    for (const c of result.chunks) {
      const label = sectionMapper(c.section ?? "");
      if (label) covered.add(label);
    }
    const xmlOnly = xmlSections.filter((s) => !covered.has(s.label));

    return { bilateral, oneSided, lowConf, highConf, xmlOnly, covered };
  }, [result.chunks, xmlSections, sectionMapper]);

  // ── Per-section breakdown ──────────────────────────────────────────────────
  const perSection = useMemo(() => {
    const m = new Map<string, {
      matched:  number;
      adds:     number;
      dels:     number;
      mods:     number;
      emps:     number;
      lowConf:  number;
      missing:  boolean;
    }>();

    for (const s of xmlSections) {
      m.set(s.label, { matched: 0, adds: 0, dels: 0, mods: 0, emps: 0, lowConf: 0, missing: false });
    }

    for (const c of result.chunks) {
      const label = sectionMapper(c.section ?? "");
      if (!label) continue;
      const entry = m.get(label);
      if (!entry) continue;
      entry.matched++;
      if (c.kind === "add") entry.adds++;
      else if (c.kind === "del") entry.dels++;
      else if (c.kind === "mod") { entry.mods++; if (c.confidence < LOW_CONF_THRESHOLD) entry.lowConf++; }
      else if (c.kind === "emp" || c.kind === "strike") entry.emps++;
    }

    for (const [, entry] of m) {
      entry.missing = entry.matched === 0;
    }

    return m;
  }, [result.chunks, xmlSections, sectionMapper]);

  const sectionList = useMemo(() => {
    // Show sections with changes first, then XML-only sections, alphabetically within each group
    const withChanges = xmlSections.filter((s) => !perSection.get(s.label)?.missing);
    const withoutChanges = xmlSections.filter((s) => perSection.get(s.label)?.missing);
    return [...withChanges, ...withoutChanges];
  }, [xmlSections, perSection]);

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Chunk Detection Report</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {result.chunks.length} total chunks · {xmlSections.length} XML section{xmlSections.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors"
          >
            Continue to Viewer
          </button>
        </div>

        {/* Global stat cards */}
        <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 border-b border-slate-200 dark:border-white/8">
          <StatCard
            label="Both sides"
            count={globalStats.bilateral.length}
            sub="MOD / EMP / STK"
            color="emerald"
          />
          <StatCard
            label="One-sided"
            count={globalStats.oneSided.length}
            sub="ADD or DEL only"
            color="amber"
          />
          <StatCard
            label="XML-only"
            count={globalStats.xmlOnly.length}
            sub="No chunks detected"
            color={globalStats.xmlOnly.length > 0 ? "rose" : "slate"}
          />
          <StatCard
            label="Low confidence"
            count={globalStats.lowConf.length}
            sub={`< ${Math.round(LOW_CONF_THRESHOLD * 100)}% MOD`}
            color={globalStats.lowConf.length > 0 ? "violet" : "slate"}
          />
        </div>

        {/* Legend */}
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 border-b border-slate-200 dark:border-white/8 text-[9px] font-semibold text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> MOD matched</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> ADD / DEL only</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400" /> Not detected</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" /> Low-conf MOD</span>
        </div>

        {/* Per-section list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {sectionList.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">
              No XML sections loaded. Upload an XML file and select a chunk level to see section breakdown.
            </p>
          ) : (
            sectionList.map((sec) => {
              const entry = perSection.get(sec.label);
              if (!entry) return null;
              return (
                <div
                  key={sec.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    entry.missing
                      ? "bg-rose-500/5 border border-rose-500/15 dark:border-rose-500/10"
                      : "hover:bg-slate-50 dark:hover:bg-white/3"
                  }`}
                >
                  {/* Level indent dot */}
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${
                      entry.missing
                        ? "bg-rose-400"
                        : entry.lowConf > 0
                          ? "bg-violet-400"
                          : "bg-emerald-400"
                    }`}
                  />

                  {/* Section label */}
                  <span
                    className={`text-xs truncate flex-1 ${
                      entry.missing
                        ? "text-rose-400 dark:text-rose-300"
                        : "text-slate-700 dark:text-slate-200"
                    }`}
                    style={{ paddingLeft: `${(sec.level - 1) * 8}px` }}
                  >
                    {sec.label}
                  </span>

                  {/* Stats */}
                  {entry.missing ? (
                    <span className="text-[9px] font-semibold text-rose-400 flex-shrink-0">
                      no chunks
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[9px] font-mono flex-shrink-0">
                      {entry.adds > 0 && <span className="text-emerald-400">+{entry.adds}</span>}
                      {entry.dels > 0 && <span className="text-rose-400">−{entry.dels}</span>}
                      {entry.mods > 0 && <span className="text-amber-400">~{entry.mods}</span>}
                      {entry.emps > 0 && <span className="text-blue-400">○{entry.emps}</span>}
                      {entry.lowConf > 0 && (
                        <span className="text-violet-400" title={`${entry.lowConf} low-confidence`}>
                          ⚠{entry.lowConf}
                        </span>
                      )}
                      <span className="text-slate-400 ml-1">{entry.matched} total</span>
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        {globalStats.xmlOnly.length > 0 && (
          <div className="flex-shrink-0 px-4 py-3 border-t border-slate-200 dark:border-white/8 bg-rose-500/5 rounded-b-2xl">
            <p className="text-[10px] text-rose-400 leading-relaxed">
              <span className="font-semibold">{globalStats.xmlOnly.length} section{globalStats.xmlOnly.length !== 1 ? "s" : ""} had no chunks detected.</span>
              {" "}This typically means the PDF text for that section was identical in both versions,
              or the section boundary was not found in the extracted text. Use Show All Context
              in the viewer to inspect those sections manually.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}