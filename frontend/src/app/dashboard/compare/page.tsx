"use client";
// ─────────────────────────────────────────────────────────────────────────────
// page.tsx — Compare feature entry point
//
// Two workflows remain (Workflow 1 / Direct Compare removed):
//
//  WF2 "Chunk & Compare"  — Old PDF + New PDF + XML
//                           4-panel view, XML panel is read-only
//                           Browse changes by section
//
//  WF3 "Compare & Apply"  — Old PDF + New PDF + XML
//                           4-panel view, XML panel is editable
//                           Accept / Reject / Edit changes → save updated XML
//
// Both workflows share the same DiffViewer — only the `mode` prop differs.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "../../../context/AuthContext";
import { trackCompareUsage } from "../../../utils/compareAnalytics";
import type { DiffResult, WorkflowMode, XmlSection } from "../../../components/compare/types";
import { apiDiff, type DiffProgress } from "../../../components/compare/api";

// ── Dynamic imports (no SSR — these use browser APIs) ────────────────────────
const DiffViewer = dynamic(() => import("../../../components/compare/DiffViewer"), { ssr: false });
const DiffUpload = dynamic(() => import("../../../components/compare/DiffUpload"), { ssr: false });
const MergePanel = dynamic(() => import("../../../components/compare/MergePanel"),  { ssr: false });

// ─────────────────────────────────────────────────────────────────────────────
// Workflow selector
// ─────────────────────────────────────────────────────────────────────────────

type ActiveWorkflow = "selector" | "wf2" | "wf3" | "merge";

const PALETTES = {
  teal: {
    card:  "border-teal-500/30 hover:border-teal-400/50 bg-teal-500/5 dark:bg-gradient-to-br dark:from-teal-600/20 dark:to-teal-500/5",
    badge: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-500/30",
    icon:  "bg-teal-100 text-teal-600 border-teal-200 dark:bg-teal-500/15 dark:text-teal-400 dark:border-teal-500/20",
    dot:   "bg-teal-100 text-teal-700 dark:bg-teal-500/40 dark:text-teal-300",
    btn:   "bg-teal-600 hover:bg-teal-500 shadow-lg shadow-teal-500/25",
  },
  violet: {
    card:  "border-violet-500/30 hover:border-violet-400/50 bg-violet-500/5 dark:bg-gradient-to-br dark:from-violet-600/20 dark:to-violet-500/5",
    badge: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30",
    icon:  "bg-violet-100 text-violet-600 border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/20",
    dot:   "bg-violet-100 text-violet-700 dark:bg-violet-500/40 dark:text-violet-300",
    btn:   "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/25",
  },
} as const;

function WorkflowCard({
  badge, title, description, steps, color, icon, onClick, locked,
}: {
  badge: string; title: string; description: string; steps: string[];
  color: keyof typeof PALETTES; icon: React.ReactNode;
  onClick: () => void; locked?: boolean;
}) {
  const p = PALETTES[color];
  return (
    <div
      className={`relative flex flex-col rounded-2xl border ${p.card} p-6 transition-all duration-200
        ${locked ? "opacity-60" : "cursor-pointer hover:shadow-xl"}`}
      onClick={locked ? undefined : onClick}
    >
      {locked && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-rose-500/15 border border-rose-500/25 text-rose-300 text-[10px] font-semibold">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          Locked
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${p.icon}`}>
          {icon}
        </div>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${p.badge}`}>
          {badge}
        </span>
      </div>

      <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5">{description}</p>

      <ol className="space-y-1.5 mb-6">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${p.dot}`}>
              {i + 1}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{step}</span>
          </li>
        ))}
      </ol>

      {!locked && (
        <button
          className={`mt-auto flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all ${p.btn}`}
          onClick={onClick}
        >
          Start Workflow
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

function WorkflowSelector({
  canWf2, canWf3, canMerge, onSelect,
}: {
  canWf2: boolean; canWf3: boolean; canMerge: boolean;
  onSelect: (w: ActiveWorkflow) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 border bg-blue-500/10 border-blue-500/20">
          <svg className="w-8 h-8 text-[#42b4f5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          Select a Comparison Workflow
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-500 max-w-lg mx-auto">
          Both workflows use your XML as the accurate baseline for change detection.
          Upload Old PDF, New PDF, and XML to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
        <WorkflowCard
          badge="Workflow 2"
          title="Chunk & Compare"
          description="Compare old and new PDFs using XML as the baseline. Browse changes by section with added / deleted / modified highlighting. XML panel is read-only."
          steps={[
            "Upload Old PDF, New PDF, and XML file",
            "Choose chunk level (Part, Chapter, Section)",
            "Browse changes — XML panel shows structure alongside diff",
          ]}
          color="teal"
          locked={!canWf2}
          onClick={() => onSelect("wf2")}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <WorkflowCard
          badge="Workflow 3"
          title="Compare & Apply"
          description="Detect changes between old and new PDFs, then apply them directly to the XML. Accept, reject, or manually edit each change before downloading the updated XML."
          steps={[
            "Upload Old PDF, New PDF, and XML file",
            "Run diff — changes detected against XML baseline",
            "Accept / reject / edit changes → download updated XML",
          ]}
          color="violet"
          locked={!canWf3}
          onClick={() => onSelect("wf3")}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
      </div>

      {canMerge && (
        <div className="max-w-3xl mx-auto mt-5">
          <button
            onClick={() => onSelect("merge")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/4 hover:bg-emerald-500/8 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border border-emerald-500/20 bg-emerald-500/12 text-emerald-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-300">Merge XML Chunks</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Combine reviewed XML chunks (SourceName_innod.NNNNN.xml) into a final document
              </p>
            </div>
            <svg className="w-4 h-4 text-slate-600 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {!canWf2 && !canWf3 && (
        <div className="max-w-3xl mx-auto mt-5 flex items-center gap-3 p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
          <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-rose-300">
            You don&apos;t have access to any comparison workflows. Contact your administrator.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Changes summary modal
// ─────────────────────────────────────────────────────────────────────────────

function ChangeSummaryModal({
  result, xmlSections, sectionMapper, onViewAll, onSelectSection,
}: {
  result:          DiffResult;
  xmlSections:     XmlSection[];
  sectionMapper:   (s: string) => string | null;
  onViewAll:       () => void;
  onSelectSection: (label: string) => void;
}) {
  const sectionCounts = React.useMemo(() => {
    const m = new Map<string, { total: number; adds: number; dels: number; mods: number }>();
    for (const c of result.chunks) {
      if (c.kind === "emp") continue;
      const label = sectionMapper(c.section ?? "");
      if (!label) continue;
      const prev = m.get(label) ?? { total: 0, adds: 0, dels: 0, mods: 0 };
      prev.total++;
      if (c.kind === "add") prev.adds++;
      else if (c.kind === "del") prev.dels++;
      else if (c.kind === "mod") prev.mods++;
      m.set(label, prev);
    }
    return m;
  }, [result.chunks, sectionMapper]);

  const seen = new Set<string>();
  const sectionsWithChanges = xmlSections.filter((s) => {
    if (seen.has(s.label) || !sectionCounts.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Changes Summary</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {result.stats.total} changes across {sectionsWithChanges.length} section{sectionsWithChanges.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onViewAll}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors"
          >
            View All
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {sectionsWithChanges.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No changes found in any section.</p>
          ) : (
            sectionsWithChanges.map((sec) => {
              const counts = sectionCounts.get(sec.label)!;
              return (
                <button
                  key={sec.id}
                  onClick={() => onSelectSection(sec.label)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                >
                  <span className="w-5 h-5 rounded bg-teal-500/15 text-teal-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {counts.total}
                  </span>
                  <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">{sec.label}</span>
                  <span className="flex items-center gap-1.5 text-[10px] font-mono">
                    {counts.adds > 0 && <span className="text-emerald-400">+{counts.adds}</span>}
                    {counts.dels > 0 && <span className="text-rose-400">-{counts.dels}</span>}
                    {counts.mods > 0 && <span className="text-amber-400">~{counts.mods}</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// useDiffState — all diff state in one place
// ─────────────────────────────────────────────────────────────────────────────

function useDiffState() {
  const [fileA,       setFileA]       = useState<File | null>(null);
  const [fileB,       setFileB]       = useState<File | null>(null);
  const [xmlFile,     setXmlFile]     = useState<File | null>(null);
  const [result,      setResult]      = useState<DiffResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [loadMsg,     setLoadMsg]     = useState("Uploading files…");
  const [loadPct,     setLoadPct]     = useState(0);
  const [error,       setError]       = useState<string | null>(null);
  const [xmlSections, setXmlSections] = useState<XmlSection[]>([]);
  const [allSections, setAllSections] = useState<XmlSection[]>([]);
  const [showModal,   setShowModal]   = useState(false);
  const [selectedSec, setSelectedSec] = useState<string | null>(null);

  function reset() {
    setFileA(null); setFileB(null); setXmlFile(null);
    setResult(null); setError(null);
    setXmlSections([]); setAllSections([]);
    setShowModal(false); setSelectedSec(null);
  }

  async function run() {
    if (!fileA || !fileB) return;
    setLoading(true); setError(null); setResult(null);
    setLoadMsg("Uploading files…"); setLoadPct(0);
    try {
      const data = await apiDiff(fileA, fileB, (p: DiffProgress) => {
        setLoadMsg(p.message);
        setLoadPct(p.pct);
      }, xmlFile);

      setResult(data);
      if (data.xml_sections?.length && allSections.length === 0)
        setAllSections(data.xml_sections);
      if (xmlSections.length > 0) setShowModal(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return {
    fileA, setFileA, fileB, setFileB, xmlFile, setXmlFile,
    result, loading, loadMsg, loadPct, error,
    xmlSections, setXmlSections, allSections, setAllSections,
    showModal, setShowModal, selectedSec, setSelectedSec,
    reset, run,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const { user } = useAuth();
  const features     = user?.effectiveFeatures ?? [];
  const isSuperAdmin = user?.role === "SUPER_ADMIN" || features.includes("*");
  const canWf2       = isSuperAdmin || features.includes("compare-pdf-xml-only");
  const canWf3       = isSuperAdmin || features.includes("compare-pdf-xml-only");
  const canMerge     = isSuperAdmin || features.includes("compare-merge");

  const [active, setActive] = useState<ActiveWorkflow>("selector");
  const d = useDiffState();

  // ── Section lookup: chunk.section → chosen-level ancestor label ───────────
  const sectionLookup = React.useMemo(() => {
    const exact = new Map<string, string>();
    const norm  = new Map<string, string>();
    if (d.xmlSections.length === 0) return { exact, norm };

    const merged = [...d.allSections];
    if (d.result?.xml_sections) {
      const existing = new Set(merged.map((s) => s.label));
      for (const s of d.result.xml_sections) if (!existing.has(s.label)) merged.push(s);
    }
    if (merged.length === 0) return { exact, norm };

    const chosen  = new Set(d.xmlSections.map((s) => s.label));
    const byId    = new Map(merged.map((s) => [s.id, s]));
    const normKey = (s: string) => s.replace(/\W+/g, " ").trim().toLowerCase();

    for (const sec of merged) {
      let cur: XmlSection | undefined = sec;
      let found: string | null = null;
      const visited = new Set<number>();
      while (cur) {
        if (visited.has(cur.id)) break;
        visited.add(cur.id);
        if (chosen.has(cur.label)) { found = cur.label; break; }
        if (cur.parent_id < 0) break;
        cur = byId.get(cur.parent_id);
      }
      if (found) { exact.set(sec.label, found); norm.set(normKey(sec.label), found); }
    }
    return { exact, norm };
  }, [d.xmlSections, d.allSections, d.result]);

  const sectionMapper = React.useCallback((chunkSection: string): string | null => {
    if (!chunkSection || d.xmlSections.length === 0) return null;
    const e = sectionLookup.exact.get(chunkSection);
    if (e) return e;
    const key = chunkSection.replace(/\W+/g, " ").trim().toLowerCase();
    const n   = sectionLookup.norm.get(key);
    if (n) return n;
    const chosen = new Set(d.xmlSections.map((s) => s.label));
    if (chosen.has(chunkSection)) return chunkSection;
    const cn = chunkSection.replace(/\W+/g, " ").trim().toLowerCase();
    for (const s of d.xmlSections) {
      const sn = s.label.replace(/\W+/g, " ").trim().toLowerCase();
      if (cn.includes(sn) || sn.includes(cn)) return s.label;
    }
    return null;
  }, [d.xmlSections, sectionLookup]);

  function selectWorkflow(w: ActiveWorkflow) {
    setActive(w);
    if (w === "wf2") trackCompareUsage("wf2", user?.userId ?? "anonymous");
    if (w === "wf3") trackCompareUsage("wf3", user?.userId ?? "anonymous");
  }

  const workflowMode: WorkflowMode = active === "wf3" ? "wf3" : "wf2";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-full min-h-0">

      {active === "selector" && (
        <WorkflowSelector canWf2={canWf2} canWf3={canWf3} canMerge={canMerge} onSelect={selectWorkflow} />
      )}

      {active === "merge" && canMerge && (
        <div className="flex-1 overflow-hidden px-5 pb-5 pt-4 min-h-0">
          <MergePanel />
        </div>
      )}

      {(active === "wf2" || active === "wf3") && (
        <div className="flex-1 overflow-hidden min-h-0">
          {d.result && !d.showModal ? (
            <DiffViewer
              mode={workflowMode}
              result={d.result}
              onReset={() => { d.reset(); setActive(active); }}
              initialXmlFile={d.xmlFile}
              xmlSections={d.xmlSections}
              initialSection={d.selectedSec}
              sectionMapper={sectionMapper}
            />
          ) : d.result && d.showModal ? (
            <ChangeSummaryModal
              result={d.result}
              xmlSections={d.xmlSections}
              sectionMapper={sectionMapper}
              onViewAll={() => { d.setSelectedSec(null); d.setShowModal(false); }}
              onSelectSection={(label) => { d.setSelectedSec(label); d.setShowModal(false); }}
            />
          ) : (
            <DiffUpload
              fileA={d.fileA}
              fileB={d.fileB}
              xmlFile={d.xmlFile}
              onFileA={d.setFileA}
              onFileB={d.setFileB}
              onXmlFile={d.setXmlFile}
              onRun={d.run}
              loading={d.loading}
              loadingMsg={d.loadMsg}
              loadingPct={d.loadPct}
              error={d.error}
              xmlSections={d.xmlSections}
              onSectionsLoaded={d.setXmlSections}
              onAllSectionsLoaded={d.setAllSections}
              onBack={() => { d.reset(); setActive("selector"); }}
              title={active === "wf3" ? "Compare & Apply" : "Chunk & Compare"}
              subtitle={
                active === "wf3"
                  ? "Upload Old PDF, New PDF, and XML — detect and apply changes"
                  : "Upload Old PDF, New PDF, and XML — browse changes by section"
              }
            />
          )}
        </div>
      )}
    </div>
  );
}