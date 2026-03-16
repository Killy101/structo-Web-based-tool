"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader } from "@/components/ui";
import BrdFlow from "@/components/brd/BrdFlow";
import api from "@/app/lib/api";

type BrdStatus = "DRAFT" | "PAUSED" | "COMPLETED" | "APPROVED" | "ON_HOLD";

interface Brd {
  id:           string;
  title:        string;
  sourceName?:  string;
  contentName?: string;
  status:       BrdStatus;
  version:      string;
  lastUpdated:  string;
  geography:    string;
  format:       "new" | "old";
}

function displayTitle(brd: Brd): string {
  return brd.sourceName?.trim() || brd.contentName?.trim() || brd.title;
}

const STATUS_LABEL: Record<BrdStatus, string> = {
  DRAFT: "On Going", PAUSED: "Paused", COMPLETED: "Completed", APPROVED: "Approved", ON_HOLD: "On Hold",
};

const STATUS_BADGE: Record<BrdStatus, string> = {
  DRAFT:     "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  PAUSED:    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  COMPLETED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  APPROVED:  "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  ON_HOLD:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_DOT: Record<BrdStatus, string> = {
  DRAFT:     "bg-sky-500 animate-pulse",
  PAUSED:    "bg-amber-500",
  COMPLETED: "bg-emerald-500",
  APPROVED:  "bg-violet-500",
  ON_HOLD:   "bg-slate-400",
};

// ── Continent / Geography ─────────────────────────────────────────
type Continent = "Asia" | "Europe" | "Americas" | "Africa" | "Oceania" | "Global";

const CONTINENT_COLOR: Record<Continent, string> = {
  Asia: "#f59e0b", Europe: "#3b82f6", Americas: "#10b981",
  Africa: "#ef4444", Oceania: "#8b5cf6", Global: "#64748b",
};

const US_STATES_FULL = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
  "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
  "minnesota","mississippi","missouri","montana","nebraska","nevada",
  "new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming",
  "washington dc","district of columbia","puerto rico","guam",
  // US administrative / legal references
  "administrative code","code of federal regulations","cfr","federal register",
  // Common misspellings of US states
  "lousiana","louisianna","luisiana","louisana",
  "califonia","califronia","calfornia",
  "tennesse","tenessee","tennesee",
  "missisippi","mississipi","misssissippi",
  "pensilvania","pennslyvania","pennsilvania",
  "massechusetts","massachusets","massachussetts",
  "connecticutt","conneticut","conneticut",
];

const US_STATE_ABBR = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia",
  "ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj",
  "nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt",
  "va","wa","wv","wi","wy","dc",
]);
const US_FALSE_POSITIVES = new Set([
  "russia","thus","focus","bonus","status","census","nexus","campus",
  "caucus","versus","genus","virus","sinus","locus","torus","humus",
  "blouse","house","mouse","grouse","spouse","abuse","cause","clause",
  "excuse","fuse","muse","pause","ruse","use","misuse","accuse",
]);
const CONTINENT_KEYWORDS: Record<Continent, string[]> = {
  Americas: ["americas","united states","usa","canada","brazil","latam","latin","north america","south america","mexico","colombia","argentina","chile","peru","venezuela","ecuador","bolivia","paraguay","uruguay","costa rica","panama","guatemala","honduras","el salvador","nicaragua","cuba","dominican republic","haiti","jamaica","trinidad"],
  Asia:     ["asia","china","japan","korea","india","southeast asia","apac","singapore","philippines","indonesia","thailand","vietnam","malaysia","hong kong","taiwan","bangladesh","pakistan","sri lanka","myanmar","cambodia","laos","nepal","bhutan","mongolia","kazakhstan","uzbekistan"],
  Europe:   ["europe","uk","united kingdom","france","germany","spain","italy","netherlands","emea","european union","poland","sweden","norway","denmark","finland","switzerland","austria","belgium","portugal","greece","czech","romania","hungary","ukraine","russia"],
  Africa:   ["africa","nigeria","kenya","south africa","egypt","ghana","ethiopia","tanzania","uganda","senegal","cameroon","ivory coast","angola","mozambique","zimbabwe","zambia","botswana","mea"],
  Oceania:  ["oceania","australia","new zealand","pacific","anz","fiji","papua","samoa","tonga","vanuatu"],
  Global:   ["global","worldwide","international","all regions","ww","cross-region","multi-region","all markets"],
};

function detectContinent(geography: string): Continent {
  const raw = geography.trim();
  const geo = raw.toLowerCase();
  // Check US states and US-specific terms first
  for (const state of US_STATES_FULL) { if (geo.includes(state)) return "Americas"; }
  const tokens = geo.split(/[\s,./|&()\-]+/).filter(Boolean);
  for (const token of tokens) {
    if ((token === "us" || token === "u.s" || token === "u.s.") && !US_FALSE_POSITIVES.has(geo)) return "Americas";
    if (raw.length <= 12 && US_STATE_ABBR.has(token)) return "Americas";
  }
  for (const [continent, keywords] of Object.entries(CONTINENT_KEYWORDS) as [Continent, string[]][]) {
    if (keywords.some((kw) => geo.includes(kw))) return continent;
  }
  return "Global";
}

// ── Icons ─────────────────────────────────────────────────────────
const EyeIcon     = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>;
const EditIcon    = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>;
const HistoryIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const TrashIcon   = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>;
const CloseIcon   = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>;
const TagIcon     = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z"/></svg>;
const RefreshIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>;
const SearchIcon  = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>;
const PlusIcon    = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>;

// Stat pill icons
const ReceivedIcon  = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>;
const ProcessingIcon= () => <svg className="w-5 h-5 animate-spin" style={{animationDuration:"3s"}} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>;
const PausedIcon    = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const CompletedIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;

const HISTORY_MOCK = (brd: Brd) => [
  { ver: brd.version, date: brd.lastUpdated, note: "Current version",        latest: true  },
  { ver: "v1.0",      date: "2025-02-14",    note: "Initial draft published", latest: false },
];

const ROWS_PER_PAGE_OPTIONS = [10, 20, 50];

export default function BrdPage() {
  const [brds,            setBrds]            = useState<Brd[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [search,          setSearch]          = useState("");
  const [activeFilter,    setActiveFilter]    = useState<BrdStatus | "All">("All");
  const [activeContinent, setActiveContinent] = useState<Continent | null>(null);
  const [historyBrd,      setHistoryBrd]      = useState<Brd | null>(null);
  const [showBrdFlow,     setShowBrdFlow]     = useState(false);
  const [flowInitialStep, setFlowInitialStep] = useState(0);
  const [flowFinalMode,   setFlowFinalMode]   = useState<"generate" | "view">("generate");
  const [flowInitialMeta, setFlowInitialMeta] = useState<{ format: "new" | "old"; brdId: string; title: string } | null>(null);
  const [fetchError,      setFetchError]      = useState<string | null>(null);
  const [page,            setPage]            = useState(1);
  const [rowsPerPage,     setRowsPerPage]     = useState(10);
  const [selected,        setSelected]        = useState<Set<string>>(new Set());
  const [deleteTarget,    setDeleteTarget]    = useState<Brd | null>(null);
  const [deleteLoading,   setDeleteLoading]   = useState(false);
  const [bulkDeleteOpen,  setBulkDeleteOpen]  = useState(false);

  const fetchBrds = useCallback(async () => {
    try {
      setLoading(true); setFetchError(null);
      const res = await api.get<Brd[]>("/brd");
      setBrds(res.data);
    } catch (err: any) {
      setFetchError(err?.response?.data?.error ?? err?.message ?? "Unknown error");
      console.error("Failed to fetch BRDs:", err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBrds(); }, [fetchBrds]);
  const handleFlowClose = useCallback(() => { setShowBrdFlow(false); fetchBrds(); }, [fetchBrds]);
  const handleRemove = (brd: Brd) => setDeleteTarget(brd);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/brd/${deleteTarget.id}`);
      setBrds((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      setSelected((s) => { const n = new Set(s); n.delete(deleteTarget.id); return n; });
      setDeleteTarget(null);
    } catch (err) { console.error("Failed to delete BRD:", err); }
    finally { setDeleteLoading(false); }
  };

  const confirmBulkDelete = async () => {
    setDeleteLoading(true);
    try {
      await Promise.all([...selected].map(id => api.delete(`/brd/${id}`)));
      setBrds((prev) => prev.filter((b) => !selected.has(b.id)));
      setSelected(new Set());
      setBulkDeleteOpen(false);
    } catch (err) { console.error("Failed to bulk delete:", err); }
    finally { setDeleteLoading(false); }
  };

  const statusCounts = brds.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1; return acc;
  }, {});

  const filtered = brds.filter((b) => {
    const q = search.toLowerCase();
    const name = displayTitle(b).toLowerCase();
    const matchSearch = !q || name.includes(q) || b.title.toLowerCase().includes(q) || b.id.toLowerCase().includes(q) || b.geography.toLowerCase().includes(q);
    const matchStatus = activeFilter === "All" || b.status === activeFilter;
    const matchContinent = activeContinent === null || detectContinent(b.geography) === activeContinent;
    return matchSearch && matchStatus && matchContinent;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  // Selection
  const allPageSelected = paginated.length > 0 && paginated.every(b => selected.has(b.id));
  const toggleAll = () => {
    if (allPageSelected) setSelected(s => { const n = new Set(s); paginated.forEach(b => n.delete(b.id)); return n; });
    else setSelected(s => { const n = new Set(s); paginated.forEach(b => n.add(b.id)); return n; });
  };
  const toggleOne = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Page numbers to show
  const pageNums = (() => {
    if (totalPages <= 7) return Array.from({length: totalPages}, (_, i) => i + 1);
    if (safePage <= 4) return [1,2,3,4,5,"...",totalPages];
    if (safePage >= totalPages - 3) return [1,"...",totalPages-4,totalPages-3,totalPages-2,totalPages-1,totalPages];
    return [1,"...",safePage-1,safePage,safePage+1,"...",totalPages];
  })();

  const startNewBrd = () => { setFlowFinalMode("generate"); setFlowInitialStep(0); setFlowInitialMeta(null); setShowBrdFlow(true); };

  if (showBrdFlow) return (
    <div className="h-full w-full">
      <BrdFlow initialStep={flowInitialStep} finalStepMode={flowFinalMode} initialMeta={flowInitialMeta} onClose={handleFlowClose} />
    </div>
  );

  return (
    <div className="relative h-full w-full min-h-0 bg-slate-50 dark:bg-slate-950 flex flex-col">

      {/* ── Page Header ── */}
      <div className="px-6 pt-5 pb-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">BRD Registry</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Business requirements document management</p>
          </div>
        </div>
      </div>

      {/* ── Stat Pills ── */}
      <div className="flex flex-wrap gap-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {[
          { label: "Received",  value: brds.length,                   icon: <ReceivedIcon />,   color: "text-blue-500 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20",    border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "On Going",  value: statusCounts["DRAFT"] || 0,    icon: <ProcessingIcon />, color: "text-amber-500 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",  border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "Paused",    value: statusCounts["PAUSED"] || 0,   icon: <PausedIcon />,     color: "text-slate-500 dark:text-slate-400",  bg: "bg-slate-50 dark:bg-slate-800/60",  border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "Completed", value: statusCounts["COMPLETED"] || 0,icon: <CompletedIcon />,  color: "text-emerald-500 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "" },
        ].map((s) => (
          <div key={s.label} className={`flex items-center gap-3 px-6 py-4 flex-1 min-w-[140px] ${s.border}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
              <span className={s.color}>{s.icon}</span>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">{s.label}</div>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-tight tabular-nums">
                {loading ? <span className="inline-block w-8 h-5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" /> : s.value.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">

        {/* Refresh */}
        <button onClick={fetchBrds} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <RefreshIcon /> <span className="hidden sm:inline">Refresh</span>
        </button>

        {/* Bulk delete */}
        {selected.size > 0 && (
          <button onClick={() => setBulkDeleteOpen(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <TrashIcon /> Delete ({selected.size})
          </button>
        )}

        {/* Region dropdown */}
        <div className="relative">
          <select
            value={activeContinent ?? "All"}
            onChange={e => { const v = e.target.value; setActiveContinent(v === "All" ? null : v as Continent); setPage(1); }}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer"
            style={activeContinent ? { borderColor: CONTINENT_COLOR[activeContinent], color: CONTINENT_COLOR[activeContinent] } : {}}>
            <option value="All">All Regions</option>
            {(["Asia","Europe","Americas","Africa","Oceania","Global"] as Continent[]).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
          </span>
        </div>

        {/* Status dropdown */}
        <div className="relative">
          <select
            value={activeFilter}
            onChange={e => { setActiveFilter(e.target.value as BrdStatus | "All"); setPage(1); }}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer">
            <option value="All">All Status</option>
            <option value="DRAFT">On Going</option>
            <option value="PAUSED">Paused</option>
            <option value="COMPLETED">Completed</option>
            <option value="APPROVED">Approved</option>
            <option value="ON_HOLD">On Hold</option>
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
          </span>
        </div>

        {/* Right-side: Search + New BRD */}
        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative flex items-center">
            <span className="absolute left-3 text-slate-400 pointer-events-none"><SearchIcon /></span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search title, ID, geography…"
              className="pl-8 pr-8 py-1.5 w-44 sm:w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            )}
          </div>

          {/* New BRD */}
          <button onClick={startNewBrd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all shadow-sm">
            <PlusIcon />
            New BRD
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {fetchError && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-medium">
          ⚠ Backend error: <span className="font-mono">{fetchError}</span>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-300 dark:border-[#1e3a5f]">
              <th className="w-10 px-3 py-3 text-center">
                <input type="checkbox" checked={allPageSelected} onChange={toggleAll}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer" />
              </th>
              <th className="px-3 py-3 text-left font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">BRD ID</th>
              <th className="px-3 py-3 text-left font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">Source / Content Name</th>
              <th className="px-3 py-3 text-left font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">Geography</th>
              <th className="px-3 py-3 text-left font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">Status</th>
              <th className="px-3 py-3 text-left font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">Version</th>
              <th className="px-3 py-3 text-left font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">Last Updated</th>
              <th className="px-3 py-3 text-center font-semibold text-slate-600 dark:text-slate-200 text-[10px] uppercase tracking-wider whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-[#1e3a5f]">
            {loading ? (
              Array.from({length: 8}).map((_, i) => (
                <tr key={i}>
                  {Array.from({length: 8}).map((_, j) => (
                    <td key={j} className="px-3 py-3.5">
                      <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" style={{width: `${60 + Math.random()*30}%`}} />
                    </td>
                  ))}
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-20 text-center text-slate-400 dark:text-slate-500">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                  </div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-400">{brds.length === 0 ? "No BRDs yet" : "No results found"}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">{brds.length === 0 ? "Click \"New BRD\" to get started." : "Try adjusting your search or filters."}</div>
                </td>
              </tr>
            ) : paginated.map((brd) => {
              const name = displayTitle(brd);
              const hasSourceLabel = !!(brd.sourceName?.trim() || brd.contentName?.trim());
              const isLocked = brd.status !== "DRAFT" && brd.status !== "COMPLETED" && brd.status !== "APPROVED" && brd.status !== "PAUSED";
              const isSelected = selected.has(brd.id);
              const continent = detectContinent(brd.geography);
              return (
                <tr key={brd.id}
                  className={`transition-colors group ${isSelected ? "bg-blue-50/60 dark:bg-blue-900/10" : "hover:bg-slate-50/80 dark:hover:bg-slate-800/30"}`}>
                  {/* Checkbox */}
                  <td className="w-10 px-3 py-3 text-center">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(brd.id)}
                      className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                  </td>
                  {/* BRD ID */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 font-medium hover:underline cursor-pointer">
                      <TagIcon />{brd.id}
                    </span>
                  </td>
                  {/* Name */}
                  <td className="px-3 py-3 max-w-[220px]">
                    <div className="font-medium text-slate-800 dark:text-slate-100 truncate text-[12px]" title={name}>{name}</div>
                    {hasSourceLabel && brd.title && brd.title !== name && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5" title={brd.title}>{brd.title}</div>
                    )}
                  </td>
                  {/* Geography */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 text-[12px]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: CONTINENT_COLOR[continent]}} />
                      {brd.geography}
                    </span>
                  </td>
                  {/* Status */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_BADGE[brd.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[brd.status]}`} />
                      {STATUS_LABEL[brd.status]}
                    </span>
                  </td>
                  {/* Version */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">{brd.version}</span>
                      {brd.format === "old"
                        ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/30">Legacy</span>
                        : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/30">New</span>
                      }
                    </div>
                  </td>
                  {/* Date */}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{brd.lastUpdated}</span>
                  </td>
                  {/* Actions */}
                  <td className="px-3 py-3 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <button disabled={isLocked}
                        onClick={() => { setFlowFinalMode("view"); setFlowInitialStep(6); setFlowInitialMeta({ format: brd.format, brdId: brd.id, title: name }); setShowBrdFlow(true); }}
                        title="View BRD"
                        className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <EyeIcon />
                      </button>
                      <button disabled={isLocked}
                        onClick={() => { setFlowFinalMode("generate"); setFlowInitialStep(6); setFlowInitialMeta({ format: brd.format, brdId: brd.id, title: name }); setShowBrdFlow(true); }}
                        title="Edit BRD"
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <EditIcon />
                      </button>
                      <button onClick={() => setHistoryBrd(brd)} title="Version History"
                        className="p-1.5 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 dark:hover:text-violet-400 transition-colors">
                        <HistoryIcon />
                      </button>
                      <button onClick={() => handleRemove(brd)} title="Remove"
                        className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors">
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer / Pagination ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        {/* Rows per page */}
        <div className="flex items-center gap-2">
          <span>Showing</span>
          <select value={rowsPerPage} onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
            className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs focus:outline-none focus:border-blue-400">
            {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>out of <strong className="text-slate-700 dark:text-slate-200">{filtered.length}</strong></span>
        </div>

        {/* Page numbers */}
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={safePage === 1}
            className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-slate-600 dark:text-slate-300">
            ← Prev
          </button>
          {pageNums.map((n, i) =>
            n === "..." ? (
              <span key={`dots-${i}`} className="px-2 py-1 text-slate-400">…</span>
            ) : (
              <button key={n} onClick={() => setPage(n as number)}
                className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${safePage === n ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
                {n}
              </button>
            )
          )}
          <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={safePage === totalPages}
            className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-slate-600 dark:text-slate-300">
            Next →
          </button>
        </div>
      </div>


      {/* ── Delete Confirmation Modal (single) ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleteLoading && setDeleteTarget(null)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-500" />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete BRD permanently?</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      This will permanently remove <span className="font-semibold text-slate-700 dark:text-slate-200">{deleteTarget.id}</span> and all associated data from the database. This action cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="mt-4 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Document</div>
                      <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{displayTitle(deleteTarget)}</div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Status</div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[deleteTarget.status]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[deleteTarget.status]}`} />
                        {STATUS_LABEL[deleteTarget.status]}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 mt-5">
                  <button onClick={() => setDeleteTarget(null)} disabled={deleteLoading}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={confirmDelete} disabled={deleteLoading}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all">
                    {deleteLoading
                      ? <span className="flex items-center justify-center gap-1.5"><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Deleting…</span>
                      : "Delete permanently"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Delete Confirmation Modal ── */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleteLoading && setBulkDeleteOpen(false)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-500" />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete {selected.size} BRD{selected.size > 1 ? "s" : ""} permanently?</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">All selected documents and their data will be permanently removed. This action cannot be undone.</p>
                  </div>
                </div>
                <div className="mt-4 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-h-32 overflow-y-auto">
                  {[...selected].map(id => {
                    const b = brds.find(x => x.id === id);
                    return (
                      <div key={id} className="flex items-center gap-2 py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
                        <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{id}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{b ? displayTitle(b) : ""}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2.5 mt-5">
                  <button onClick={() => setBulkDeleteOpen(false)} disabled={deleteLoading}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={confirmBulkDelete} disabled={deleteLoading}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] disabled:opacity-60 transition-all">
                    {deleteLoading
                      ? <span className="flex items-center justify-center gap-1.5"><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Deleting…</span>
                      : `Delete ${selected.size} permanently`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── History Modal ── */}
      {historyBrd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHistoryBrd(null)} />
          <div className="relative w-full max-w-sm z-10">
            <Card className="shadow-2xl">
              <CardHeader
                title="Version History"
                subtitle={`${historyBrd.id} — ${displayTitle(historyBrd).length > 34 ? displayTitle(historyBrd).slice(0,34)+"…" : displayTitle(historyBrd)}`}
                action={
                  <button onClick={() => setHistoryBrd(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <CloseIcon />
                  </button>
                }
              />
              <div className="p-5 space-y-3">
                <div className="relative">
                  <div className="absolute left-[19px] top-5 bottom-5 w-px bg-slate-200 dark:bg-slate-700" />
                  <div className="space-y-3">
                    {HISTORY_MOCK(historyBrd).map((h, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 z-10 ${h.latest ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"}`}>
                          {h.latest
                            ? <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                            : <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                          }
                        </div>
                        <div className={`flex-1 flex items-center justify-between p-3 rounded-xl border ${h.latest ? "bg-emerald-50/80 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40" : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60"}`}>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md">{h.ver}</span>
                              {h.latest && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">Latest</span>}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{h.note}</div>
                          </div>
                          <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap ml-3">{h.date}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={() => setHistoryBrd(null)} className="w-full py-2 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Close
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}