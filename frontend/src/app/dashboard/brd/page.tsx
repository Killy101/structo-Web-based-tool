"use client";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  SearchInput,
} from "@/components/ui";
import BrdFlow from "@/components/brd/BrdFlow";

type BrdStatus = "Reviewed" | "Ready" | "Processing" | "Draft";

interface Brd {
  id: string;
  title: string;
  status: BrdStatus;
  version: string;
  lastUpdated: string;
  geography: string;
}

const INITIAL_BRDS: Brd[] = [
  { id: "BRD-001", title: "Fair Work Regulations 2009",                status: "Reviewed",   version: "v1.2", lastUpdated: "2025-03-15", geography: "Australia" },
  { id: "BRD-002", title: "Corporations Regulations 2001",             status: "Ready",      version: "v1.1", lastUpdated: "2025-03-20", geography: "Australia" },
  { id: "BRD-003", title: "Taxation Administration Regulations 2017",  status: "Processing", version: "v1.0", lastUpdated: "2025-03-22", geography: "Australia" },
  { id: "BRD-004", title: "Financial Services Modernisation Act 2024", status: "Draft",      version: "v0.3", lastUpdated: "2025-03-25", geography: "United Kingdom" },
];

const FILTER_CHIPS = ["All", "Processing", "Ready", "Reviewed", "Draft"] as const;
type FilterKey = typeof FILTER_CHIPS[number];

const STATUS_BADGE: Record<BrdStatus, string> = {
  Reviewed:   "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  Ready:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Processing: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  Draft:      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
};

const FILTER_CHIP_STYLES: Record<FilterKey, { base: string; active: string }> = {
  All:        { base: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800",                    active: "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-700 dark:border-slate-200" },
  Processing: { base: "border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20",                          active: "bg-sky-500 text-white border-sky-500" },
  Ready:      { base: "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",   active: "bg-emerald-500 text-white border-emerald-500" },
  Reviewed:   { base: "border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20",         active: "bg-violet-600 text-white border-violet-600" },
  Draft:      { base: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800",                  active: "bg-slate-500 text-white border-slate-500" },
};

// ── Icons ────────────────────────────────────────────────────────────────────
const EyeIcon     = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
const EditIcon    = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
const HistoryIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const TrashIcon   = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const PlusIcon    = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>;
const CloseIcon   = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const TagIcon     = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" /></svg>;

const HISTORY_MOCK = (brd: Brd) => [
  { ver: brd.version,                                                                                    date: brd.lastUpdated, note: "Current version",           latest: true  },
  { ver: "v" + Math.max(1, parseFloat(brd.version.replace("v", "")) - 0.1).toFixed(1),                 date: "2025-02-14",     note: "Minor edits & corrections", latest: false },
  { ver: "v1.0",                                                                                         date: "2025-01-08",     note: "Initial draft published",   latest: false },
];

// ── Component ────────────────────────────────────────────────────────────────
export default function BrdPage() {
  const [brds, setBrds]                 = useState<Brd[]>(INITIAL_BRDS);
  const [search, setSearch]             = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("All");
  const [historyBrd, setHistoryBrd]     = useState<Brd | null>(null);
  const [showBrdFlow, setShowBrdFlow]   = useState(false);
  const [flowInitialStep, setFlowInitialStep] = useState(0);
  const [flowFinalMode, setFlowFinalMode] = useState<"generate" | "view">("generate");
  const [flowInitialMeta, setFlowInitialMeta] = useState<{ format: "new" | "old"; brdId: string; title: string } | null>(null);

  const statusCounts = brds.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  const filtered = brds.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch =
      b.title.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      b.geography.toLowerCase().includes(q);
    return matchSearch && (activeFilter === "All" || b.status === activeFilter);
  });

  const handleRemove = (id: string) =>
    setBrds((prev) => prev.filter((b) => b.id !== id));

  const statCards = [
    {
      label: "Total Documents", value: brds.length,
      gradient: "from-indigo-50 to-blue-50 dark:from-indigo-950/60 dark:to-blue-950/60",
      border: "border-indigo-200 dark:border-indigo-900/50",
      numClass: "text-indigo-800 dark:text-indigo-300",
      lblClass: "text-indigo-600 dark:text-indigo-500",
      iconBg: "bg-indigo-100 dark:bg-indigo-900/50",
      icon: (
        <svg className="w-5 h-5 text-indigo-700 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      label: "Reviewed", value: statusCounts["Reviewed"] || 0,
      gradient: "from-violet-50 to-purple-50 dark:from-violet-950/60 dark:to-purple-950/60",
      border: "border-violet-200 dark:border-violet-900/50",
      numClass: "text-violet-800 dark:text-violet-300",
      lblClass: "text-violet-600 dark:text-violet-500",
      iconBg: "bg-violet-100 dark:bg-violet-900/50",
      icon: (
        <svg className="w-5 h-5 text-violet-700 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: "Ready", value: statusCounts["Ready"] || 0,
      gradient: "from-emerald-50 to-teal-50 dark:from-emerald-950/60 dark:to-teal-950/60",
      border: "border-emerald-200 dark:border-emerald-900/50",
      numClass: "text-emerald-800 dark:text-emerald-300",
      lblClass: "text-emerald-600 dark:text-emerald-500",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/50",
      icon: (
        <svg className="w-5 h-5 text-emerald-700 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    {
      label: "Processing", value: statusCounts["Processing"] || 0,
      gradient: "from-sky-50 to-cyan-50 dark:from-sky-950/60 dark:to-cyan-950/60",
      border: "border-sky-200 dark:border-sky-900/50",
      numClass: "text-sky-800 dark:text-sky-300",
      lblClass: "text-sky-600 dark:text-sky-500",
      iconBg: "bg-sky-100 dark:bg-sky-900/50",
      icon: (
        <svg className="w-5 h-5 text-sky-600 dark:text-sky-400 animate-spin" style={{ animationDuration: "3s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
    },
  ];

  if (showBrdFlow) {
    return (
      <div className="h-full w-full">
        <BrdFlow
          initialStep={flowInitialStep}
          finalStepMode={flowFinalMode}
          initialMeta={flowInitialMeta}
          onClose={() => setShowBrdFlow(false)}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-0 px-6 py-5 text-xs flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">BRD Registry</h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Business requirements document management</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 lg:w-full lg:max-w-xl">
          <SearchInput value={search} onChange={setSearch} placeholder="Search title, ID, geography…" className="w-full sm:min-w-72 lg:flex-1" />
          <Button
            size="md"
            onClick={() => {
              setFlowFinalMode("generate");
              setFlowInitialStep(0);
              setFlowInitialMeta(null);
              setShowBrdFlow(true);
            }}
          >
            <PlusIcon /> New BRD
          </Button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div
            key={s.label}
            className={`rounded-2xl p-4 flex items-center gap-3.5 bg-gradient-to-br ${s.gradient} border ${s.border} hover:shadow-md transition-shadow`}
          >
            <div className={`w-10 h-10 rounded-xl ${s.iconBg} flex items-center justify-center flex-shrink-0`}>
              {s.icon}
            </div>
            <div>
              <div className={`text-2xl font-bold leading-none ${s.numClass}`}>{s.value}</div>
              <div className={`text-xs mt-1 font-semibold ${s.lblClass}`}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter Chips ── */}
        <div className="flex flex-wrap items-center gap-2">
        {FILTER_CHIPS.map((chip) => {
          const count  = chip === "All" ? brds.length : (statusCounts[chip] || 0);
          const on     = activeFilter === chip;
          const styles = FILTER_CHIP_STYLES[chip];
          return (
            <button
              key={chip}
              onClick={() => setActiveFilter(chip)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 whitespace-nowrap ${on ? styles.active : styles.base}`}
            >
              <span className="font-mono font-bold">{count}</span>
              {chip}
            </button>
          );
        })}
      </div>

      {/* ── Table ── */}
      <Card className="overflow-hidden flex-1 min-h-0">
        <div className="h-full overflow-auto scrollbar-hide">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">BRD ID</th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">Document Title</th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">Geography</th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">Version</th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">Last Updated</th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                    <div className="text-2xl mb-2">📂</div>
                    <div className="font-medium">No BRDs found — try adjusting your search or filter.</div>
                  </td>
                </tr>
              ) : filtered.map((brd, idx) => (
                <tr
                  key={brd.id}
                  className={`group transition-colors hover:bg-blue-50/60 dark:hover:bg-slate-800/50 ${idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-slate-800/20"}`}
                >
                  {/* BRD ID */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-normal text-slate-600 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                      <TagIcon />
                      {brd.id}
                    </span>
                  </td>
                  {/* Title */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <span className="text-xs font-light text-slate-900 dark:text-slate-200">{brd.title}</span>
                  </td>
                  {/* Geography */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <span className="text-xs font-normal text-slate-700 dark:text-slate-400">{brd.geography}</span>
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <Badge className={`inline-flex items-center gap-1.5 font-medium ${STATUS_BADGE[brd.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        brd.status === "Processing" ? "bg-sky-500 animate-pulse"
                        : brd.status === "Reviewed" ? "bg-violet-600"
                        : brd.status === "Ready"    ? "bg-emerald-600"
                        : "bg-slate-500"
                      }`} />
                      {brd.status}
                    </Badge>
                  </td>
                  {/* Version */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <span className="font-mono text-xs font-normal text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                      {brd.version}
                    </span>
                  </td>
                  {/* Last Updated */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <span className="font-mono text-xs font-normal text-slate-600 dark:text-slate-500">{brd.lastUpdated}</span>
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3.5 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setFlowFinalMode("view");
                          setFlowInitialStep(6);
                          setFlowInitialMeta({ format: "new", brdId: brd.id, title: brd.title });
                          setShowBrdFlow(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                      >
                        <EyeIcon /> View
                      </button>
                      <button
                        onClick={() => {
                          setFlowFinalMode("generate");
                          setFlowInitialStep(6);
                          setFlowInitialMeta({ format: "new", brdId: brd.id, title: brd.title });
                          setShowBrdFlow(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                      >
                        <EditIcon /> Edit
                      </button>
                      <button
                        onClick={() => setHistoryBrd(brd)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-all"
                      >
                        <HistoryIcon /> History
                      </button>
                      <button
                        onClick={() => handleRemove(brd.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                      >
                        <TrashIcon /> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── History Modal ── */}
      {historyBrd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setHistoryBrd(null)} />
          <div className="relative w-full max-w-sm z-10">
            <Card className="shadow-2xl">
              <CardHeader
                title="Version History"
                subtitle={`${historyBrd.id} — ${historyBrd.title.length > 34 ? historyBrd.title.slice(0, 34) + "…" : historyBrd.title}`}
                action={
                  <button
                    onClick={() => setHistoryBrd(null)}
                    className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <CloseIcon />
                  </button>
                }
              />
              <div className="p-5 space-y-3">
                <div className="relative">
                  <div className="absolute left-[19px] top-5 bottom-5 w-px bg-slate-300 dark:bg-slate-700" />
                  <div className="space-y-3">
                    {HISTORY_MOCK(historyBrd).map((h, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 z-10 ${
                          h.latest
                            ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600"
                            : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                        }`}>
                          {h.latest ? (
                            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </div>
                        <div className={`flex-1 flex items-center justify-between p-3 rounded-xl border ${
                          h.latest
                            ? "bg-emerald-50/80 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40"
                            : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60"
                        }`}>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded-md">
                                {h.ver}
                              </span>
                              {h.latest && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                                  Latest
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mt-1">{h.note}</div>
                          </div>
                          <span className="font-mono text-[10px] font-medium text-slate-500 dark:text-slate-500 whitespace-nowrap ml-3">
                            {h.date}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Button variant="secondary" className="w-full justify-center" onClick={() => setHistoryBrd(null)}>
                  Close
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}