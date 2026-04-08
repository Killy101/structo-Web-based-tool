"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "../../../context/AuthContext";
import { trackCompareUsage } from "../../../utils/compareAnalytics";
import type { DiffResult } from "../../../components/compare/types";
import type { XmlSection } from "../../../components/compare/types";
import { apiDiff, type DiffProgress } from "../../../components/compare/api";

// ── Dynamic imports (no SSR) ──────────────────────────────────────────────────
const MergePanel = dynamic(
  () => import("../../../components/compare/MergePanel"),
  { ssr: false }
);
const DiffViewer = dynamic(
  () => import("../../../components/compare/DiffViewer"),
  { ssr: false }
);
const DiffUpload = dynamic(
  () => import("../../../components/compare/DiffUpload"),
  { ssr: false }
);

// ── Types ─────────────────────────────────────────────────────────────────────
type Workflow = "selector" | "compare" | "merge" | "diff" | "direct-diff";

// ── WorkflowCard ──────────────────────────────────────────────────────────────
function WorkflowCard({
  title,
  description,
  badge,
  icon,
  steps,
  color,
  onClick,
  locked,
}: {
  title: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  steps: string[];
  color: "blue" | "violet" | "teal";
  onClick: () => void;
  locked?: boolean;
}) {
  const palette = {
    blue: {
      card: "border-blue-500/30 hover:border-blue-400/50 bg-blue-500/5 dark:bg-gradient-to-br dark:from-blue-600/20 dark:to-blue-500/5",
      badge: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30",
      icon: "bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/20",
      dot: "bg-blue-100 text-blue-700 dark:bg-blue-500/40 dark:text-blue-300",
      btn: "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25",
    },
    violet: {
      card: "border-violet-500/30 hover:border-violet-400/50 bg-violet-500/5 dark:bg-gradient-to-br dark:from-violet-600/20 dark:to-violet-500/5",
      badge: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30",
      icon: "bg-violet-100 text-violet-600 border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/20",
      dot: "bg-violet-100 text-violet-700 dark:bg-violet-500/40 dark:text-violet-300",
      btn: "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/25",
    },
    teal: {
      card: "border-teal-500/30 hover:border-teal-400/50 bg-teal-500/5 dark:bg-gradient-to-br dark:from-teal-600/20 dark:to-teal-500/5",
      badge: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-500/30",
      icon: "bg-teal-100 text-teal-600 border-teal-200 dark:bg-teal-500/15 dark:text-teal-400 dark:border-teal-500/20",
      dot: "bg-teal-100 text-teal-700 dark:bg-teal-500/40 dark:text-teal-300",
      btn: "bg-teal-600 hover:bg-teal-500 shadow-lg shadow-teal-500/25",
    },
  }[color];

  return (
    <div
      className={`relative flex flex-col rounded-2xl border ${palette.card} p-6 transition-all duration-200 ${locked ? "opacity-60" : "cursor-pointer hover:shadow-xl"}`}
      onClick={locked ? undefined : onClick}
    >
      {locked && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-rose-500/15 border border-rose-500/25 text-rose-300 text-[10px] font-semibold">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd" />
          </svg>
          Locked
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${palette.icon}`}>
          {icon}
        </div>
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${palette.badge}`}>
          {badge}
        </span>
      </div>

      <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5">{description}</p>

      <ol className="space-y-1.5 mb-6">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${palette.dot}`}>
              {i + 1}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{step}</span>
          </li>
        ))}
      </ol>

      {!locked && (
        <button
          className={`mt-auto flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all ${palette.btn}`}
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

// ── WorkflowSelector ──────────────────────────────────────────────────────────
function WorkflowSelector({
  canCompare, canMerge, canDiff, onSelect,
}: {
  canCompare: boolean;
  canMerge: boolean;
  canDiff: boolean;
  onSelect: (w: Workflow) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="text-center mb-8">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 border"
          style={{ background: "rgba(26,143,209,0.1)", borderColor: "rgba(26,143,209,0.2)" }}
        >
          <svg className="w-8 h-8 text-[#42b4f5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          Select a Comparison Workflow
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-500 max-w-lg mx-auto">
          Upload your documents and choose how you want to review the changes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {/* Direct Compare */}
        <WorkflowCard
          title="Direct Compare"
          description="Side-by-side PDF comparison with word-level highlighting. Upload two PDFs and instantly view all structural differences."
          badge="Workflow 1"
          color="blue"
          locked={!canDiff}
          onClick={() => onSelect("direct-diff")}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
          steps={[
            "Upload Old PDF and New PDF",
            "Anchor-keyed diff with false-positive suppression",
            "Browse changes side-by-side with word-level highlights",
          ]}
        />

        {/* Chunk & Compare */}
        <WorkflowCard
          title="Chunk & Compare"
          description="PDF comparison with XML chunking. Upload PDFs and XML, choose a structural level (Part, Chapter, Section), then browse and apply changes."
          badge="Workflow 2"
          color="teal"
          locked={!canDiff}
          onClick={() => onSelect("diff")}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
          steps={[
            "Upload Old PDF, New PDF, and XML file",
            "Choose chunk level (Part, Chapter, Section)",
            "Browse changes per section → apply to XML",
          ]}
        />

        {/* Compare & Apply (PDFs + XML, no chunking) */}
        <WorkflowCard
          title="Compare & Apply"
          description="Upload two PDFs and an XML file. Detect differences and apply changes directly to the XML — no section chunking needed."
          badge="Workflow 3"
          color="violet"
          locked={!canCompare}
          onClick={() => onSelect("compare")}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          steps={[
            "Upload Old PDF, New PDF, and XML file",
            "Run diff to detect all changes",
            "Browse changes and apply directly to XML",
          ]}
        />
      </div>

      {/* Merge row */}
      {canMerge && (
        <div className="max-w-5xl mx-auto mt-5">
          <button
            onClick={() => onSelect("merge")}
            className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left"
            style={{ background: "rgba(16,185,129,0.04)", borderColor: "rgba(16,185,129,0.2)" }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
              style={{ background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.2)", color: "#34d399" }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-300">Merge XML Chunks</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Combine reviewed XML chunks (SourceName_innod.NNNNN.xml) into a final SourceName_final.xml document
              </p>
            </div>
            <svg className="w-4 h-4 text-slate-600 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {!canCompare && !canDiff && (
        <div className="max-w-5xl mx-auto mt-5 flex items-center gap-3 p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
          <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-rose-300">
            You don&apos;t have access to any comparison workflows. Contact your administrator to enable Compare features.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ComparePage() {
  const { user } = useAuth();
  const features    = user?.effectiveFeatures ?? [];
  const isSuperAdmin = user?.role === "SUPER_ADMIN" || features.includes("*");
  const canCompare  = isSuperAdmin || features.includes("compare-basic");
  const canMerge    = isSuperAdmin || features.includes("compare-merge");
  const canDiff     = isSuperAdmin || features.includes("compare-diff") || canCompare;

  const [workflow, setWorkflow] = useState<Workflow>("selector");

  // ── PDF Diff Inspector state ──────────────────────────────────────────────
  const [diffFileA, setDiffFileA]       = useState<File | null>(null);
  const [diffFileB, setDiffFileB]       = useState<File | null>(null);
  const [diffXmlFile, setDiffXmlFile]   = useState<File | null>(null);
  const [diffResult, setDiffResult]     = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading]   = useState(false);
  const [diffLoadMsg, setDiffLoadMsg]   = useState("Uploading files…");
  const [diffLoadPct, setDiffLoadPct]   = useState(0);
  const [diffError, setDiffError]       = useState<string | null>(null);
  const [xmlSections, setXmlSections]   = useState<XmlSection[]>([]);
  const [allXmlSections, setAllXmlSections] = useState<XmlSection[]>([]);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [selectedSection, setSelectedSection]   = useState<string | null>(null);

  // Pre-build a Map: section label → chosen-level ancestor label
  // Uses allXmlSections to walk parent chains, cached for O(1) per chunk
  // Also builds a normalised-key fallback so PDF-based headings can match
  // Includes backend xml_sections from diff result for full coverage
  const sectionLookup = React.useMemo(() => {
    const exactMap = new Map<string, string>();
    const normalizedMap = new Map<string, string>();
    if (xmlSections.length === 0) return { exactMap, normalizedMap };

    // Merge client-side and backend sections for maximum label coverage
    const mergedSections = [...allXmlSections];
    if (diffResult?.xml_sections) {
      const existingLabels = new Set(mergedSections.map((s) => s.label));
      for (const bs of diffResult.xml_sections) {
        if (!existingLabels.has(bs.label)) {
          mergedSections.push(bs);
        }
      }
    }
    if (mergedSections.length === 0) return { exactMap, normalizedMap };

    const chosenLabels = new Set(xmlSections.map((s) => s.label));
    const byId = new Map(mergedSections.map((s) => [s.id, s]));

    const normKey = (s: string) => s.replace(/\W+/g, " ").trim().toLowerCase();

    for (const sec of mergedSections) {
      // Walk up parent chain until we find a chosen-level ancestor
      let cur: XmlSection | undefined = sec;
      let found: string | null = null;
      const visited = new Set<number>();
      while (cur) {
        if (visited.has(cur.id)) break;
        visited.add(cur.id);
        if (chosenLabels.has(cur.label)) { found = cur.label; break; }
        if (cur.parent_id < 0) break;
        cur = byId.get(cur.parent_id);
      }
      if (found) {
        exactMap.set(sec.label, found);
        normalizedMap.set(normKey(sec.label), found);
      }
    }

    return { exactMap, normalizedMap };
  }, [xmlSections, allXmlSections, diffResult]);

  function chunkSectionToChosen(chunkSection: string): string | null {
    if (!chunkSection || xmlSections.length === 0) return null;
    const exact = sectionLookup.exactMap.get(chunkSection);
    if (exact) return exact;
    // Fallback: normalised match (PDF heading vs XML label)
    const key = chunkSection.replace(/\W+/g, " ").trim().toLowerCase();
    const normalized = sectionLookup.normalizedMap.get(key);
    if (normalized) {
      return normalized;
    }
    // Last fallback: if chunk.section directly matches a chosen section label
    const chosenLabels = new Set(xmlSections.map((s) => s.label));
    if (chosenLabels.has(chunkSection)) return chunkSection;
    // Fuzzy: check if chunk section contains or is contained by any chosen label
    const chunkNorm = chunkSection.replace(/\W+/g, " ").trim().toLowerCase();
    for (const s of xmlSections) {
      const sNorm = s.label.replace(/\W+/g, " ").trim().toLowerCase();
      if (chunkNorm.includes(sNorm) || sNorm.includes(chunkNorm)) return s.label;
    }
    return null;
  }

  async function runDiff() {
    if (!diffFileA || !diffFileB) return;
    setDiffLoading(true);
    setDiffError(null);
    setDiffResult(null);
    setDiffLoadMsg("Uploading files…");
    setDiffLoadPct(0);

    try {
      const data = await apiDiff(diffFileA, diffFileB, (p: DiffProgress) => {
        setDiffLoadMsg(p.message);
        setDiffLoadPct(p.pct);
      }, null, diffXmlFile);
      setDiffResult(data);
      // Merge backend xml_sections into allXmlSections for label coverage
      if (data.xml_sections && data.xml_sections.length > 0 && allXmlSections.length === 0) {
        setAllXmlSections(data.xml_sections);
      }
      // If we have sections, show the changes summary modal
      if (xmlSections.length > 0) {
        setShowChangesModal(true);
      }
    } catch (e) {
      setDiffError((e as Error).message);
    } finally {
      setDiffLoading(false);
    }
  }

  function resetDiff() {
    setDiffResult(null);
    setDiffFileA(null);
    setDiffFileB(null);
    setDiffXmlFile(null);
    setDiffError(null);
    setXmlSections([]);
    setAllXmlSections([]);
    setShowChangesModal(false);
    setSelectedSection(null);
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">

      {/* ── Selector ───────────────────────────────────────────────────────── */}
      {workflow === "selector" && (
        <WorkflowSelector
          canCompare={canCompare}
          canMerge={canMerge}
          canDiff={canDiff}
          onSelect={(w) => {
            setWorkflow(w);
            if (w === "compare")    trackCompareUsage("direct",     user?.userId ?? "anonymous");
            if (w === "diff")       trackCompareUsage("diff",       user?.userId ?? "anonymous");
            if (w === "direct-diff") trackCompareUsage("direct-diff", user?.userId ?? "anonymous");
          }}
        />
      )}

      {/* ── Compare & Apply (PDFs + XML, no chunking) ──────────────────── */}
      {workflow === "compare" && (
        <div className="flex-1 overflow-hidden min-h-0">
          {diffResult ? (
            <DiffViewer
              result={diffResult}
              onReset={() => { resetDiff(); setWorkflow("compare"); }}
              initialXmlFile={diffXmlFile}
            />
          ) : (
            <DiffUpload
              fileA={diffFileA}
              fileB={diffFileB}
              xmlFile={diffXmlFile}
              onFileA={setDiffFileA}
              onFileB={setDiffFileB}
              onXmlFile={setDiffXmlFile}
              onRun={runDiff}
              loading={diffLoading}
              loadingMsg={diffLoadMsg}
              loadingPct={diffLoadPct}
              error={diffError}
              skipChunking
              onBack={() => { resetDiff(); setWorkflow("selector"); }}
            />
          )}
        </div>
      )}

      {/* ── Merge workflow ──────────────────────────────────────────────────── */}
      {workflow === "merge" && canMerge && (
        <div className="flex-1 overflow-hidden px-5 pb-5 pt-4 min-h-0">
          <MergePanel />
        </div>
      )}

      {/* ── Direct Compare (no XML) ────────────────────────────────────────── */}
      {workflow === "direct-diff" && (
        <div className="flex-1 overflow-hidden min-h-0">
          {diffResult ? (
            <DiffViewer
              result={diffResult}
              onReset={() => { resetDiff(); setWorkflow("direct-diff"); }}
            />
          ) : (
            <DiffUpload
              fileA={diffFileA}
              fileB={diffFileB}
              onFileA={setDiffFileA}
              onFileB={setDiffFileB}
              onRun={runDiff}
              loading={diffLoading}
              loadingMsg={diffLoadMsg}
              loadingPct={diffLoadPct}
              error={diffError}
              onBack={() => { resetDiff(); setWorkflow("selector"); }}
            />
          )}
        </div>
      )}

      {/* ── Chunk & Compare ─────────────────────────────────────────────────── */}
      {workflow === "diff" && (
        <div className="flex-1 overflow-hidden min-h-0">
          {diffResult && !showChangesModal ? (
            <DiffViewer
              result={diffResult}
              onReset={resetDiff}
              initialXmlFile={diffXmlFile}
              xmlSections={xmlSections}
              initialSection={selectedSection}
              sectionMapper={chunkSectionToChosen}
            />
          ) : diffResult && showChangesModal ? (
            /* ── Changes Summary Modal ──────────────────────────────── */
            <div className="flex items-center justify-center h-full p-8">
              <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] shadow-2xl">
                {(() => {
                  // Pre-compute section → chunk counts (O(n) single pass)
                  const sectionCounts = new Map<string, { total: number; adds: number; dels: number; mods: number }>();
                  for (const c of diffResult.chunks) {
                    if (c.kind === "emp") continue;
                    const mapped = chunkSectionToChosen(c.section ?? "");
                    if (!mapped) continue;
                    const prev = sectionCounts.get(mapped) ?? { total: 0, adds: 0, dels: 0, mods: 0 };
                    prev.total++;
                    if (c.kind === "add") prev.adds++;
                    else if (c.kind === "del") prev.dels++;
                    else if (c.kind === "mod") prev.mods++;
                    sectionCounts.set(mapped, prev);
                  }
                  // Deduplicate sections: keep first occurrence by label, preserve order
                  const seen = new Set<string>();
                  const uniqueSections = xmlSections.filter((s) => {
                    if (seen.has(s.label)) return false;
                    seen.add(s.label);
                    return true;
                  });
                  const sectionsWithChanges = uniqueSections.filter((s) => sectionCounts.has(s.label));
                  const unmapped = diffResult.chunks.filter((c) => c.kind !== "emp" && !chunkSectionToChosen(c.section ?? "")).length;

                  return (
                    <>
                      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Changes Summary</h3>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {diffResult.stats.total} changes across {sectionsWithChanges.length} section{sectionsWithChanges.length !== 1 ? "s" : ""}
                            {unmapped > 0 && <span className="text-amber-400/70"> · {unmapped} unassigned</span>}
                          </p>
                        </div>
                        <button
                          onClick={() => { setSelectedSection(null); setShowChangesModal(false); }}
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
                                onClick={() => { setSelectedSection(sec.label); setShowChangesModal(false); }}
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
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <DiffUpload
              fileA={diffFileA}
              fileB={diffFileB}
              xmlFile={diffXmlFile}
              onFileA={setDiffFileA}
              onFileB={setDiffFileB}
              onXmlFile={setDiffXmlFile}
              onRun={runDiff}
              loading={diffLoading}
              loadingMsg={diffLoadMsg}
              loadingPct={diffLoadPct}
              error={diffError}
              xmlSections={xmlSections}
              onSectionsLoaded={setXmlSections}
              onAllSectionsLoaded={setAllXmlSections}
              onBack={() => { resetDiff(); setWorkflow("selector"); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
