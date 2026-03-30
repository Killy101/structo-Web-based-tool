"use client";
import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import BrdFlow from "@/components/brd/BrdFlow";
import Generate from "@/components/brd/Generate";
import api from "@/app/lib/api";
import { useAuth } from "../../../context/AuthContext";

type BrdStatus = "DRAFT" | "PAUSED" | "COMPLETED" | "APPROVED" | "ON_HOLD";
type SortField = "name" | "date" | "id";
type SortDirection = "asc" | "desc";

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

interface BrdVersionSummary {
  id:         number;
  brdId:      string;
  versionNum: number;
  label:      string;
  savedAt:    string;
}

interface BrdVersionDetail extends BrdVersionSummary {
  scope?:          Record<string, unknown>;
  metadata?:       Record<string, unknown>;
  toc?:            Record<string, unknown>;
  citations?:      Record<string, unknown>;
  contentProfile?: Record<string, unknown>;
  brdConfig?:      Record<string, unknown>;
  imageIds?:       number[] | null;
}

function displayTitle(brd: Brd): string {
  return brd.sourceName?.trim() || brd.contentName?.trim() || brd.title;
}

const STATUS_LABEL: Record<BrdStatus, string> = {
  DRAFT: "Draft", PAUSED: "Paused", COMPLETED: "Complete", APPROVED: "Approved", ON_HOLD: "On Hold",
};

const STATUS_TRANSITIONS: Record<BrdStatus, BrdStatus[]> = {
  DRAFT: ["DRAFT", "COMPLETED", "ON_HOLD"],
  PAUSED: ["PAUSED", "DRAFT", "COMPLETED", "ON_HOLD"],
  COMPLETED: ["COMPLETED", "APPROVED", "ON_HOLD"],
  APPROVED: ["APPROVED", "ON_HOLD"],
  ON_HOLD: ["ON_HOLD", "DRAFT", "COMPLETED", "APPROVED"],
};
const STATUS_BADGE: Record<BrdStatus, string> = {
  DRAFT:     "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  PAUSED:    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  COMPLETED: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  APPROVED:  "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  ON_HOLD:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};
const STATUS_DOT: Record<BrdStatus, string> = {
  DRAFT:     "bg-sky-500 animate-pulse",
  PAUSED:    "bg-amber-500",
  COMPLETED: "bg-teal-500",
  APPROVED:  "bg-violet-500",
  ON_HOLD:   "bg-slate-400",
};

const STATUS_HELPER: Record<BrdStatus, string> = {
  DRAFT: "Initial draft uploaded. Re-upload final BRD while in Draft.",
  PAUSED: "Work in progress and temporarily paused.",
  COMPLETED: "Ready for review and approval.",
  APPROVED: "Client approved. View BRD and generate all outputs.",
  ON_HOLD: "Production questions or client comments pending.",
};

// ── Continent / Geography ─────────────────────────────────────────
type Continent = "Asia" | "Europe" | "Americas" | "Africa" | "Oceania" | "Global";
const CONTINENT_COLOR: Record<Continent, string> = {
  Asia: "#0ea5e9",
  Europe: "#6366f1",
  Americas: "#10b981",
  Africa: "#f59e0b",
  Oceania: "#f97316",
  Global: "#64748b",
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
  "administrative code","code of federal regulations","cfr","federal register",
  "lousiana","louisianna","luisiana","louisana","califonia","califronia","calfornia",
  "tennesse","tenessee","tennesee","missisippi","mississipi","misssissippi",
  "pensilvania","pennslyvania","pennsilvania","massechusetts","massachusets","massachussetts",
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
  const raw = geography.trim(); const geo = raw.toLowerCase();
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
const DownloadIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>;
const TrashBinIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>;
const RestoreIcon  = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>;
const EyeIcon     = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>;
const EditIcon    = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>;
const HistoryIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const TrashIcon   = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>;
const CloseIcon   = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>;
const TagIcon     = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z"/></svg>;
const RefreshIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>;
const SearchIcon  = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>;
const PlusIcon    = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>;
const ReuploadIcon = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12"/></svg>;
const StatusIcon  = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 0h6"/></svg>;

const ReceivedIcon  = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>;
const BackIcon      = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>;
const ProcessingIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6v6l4 2"/><circle cx="12" cy="12" r="8" strokeWidth={1.75}/></svg>;
const PausedIcon    = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 7v10M14 7v10"/><circle cx="12" cy="12" r="8" strokeWidth={1.75}/></svg>;
const CompletedIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M5 13l4 4L19 7"/><circle cx="12" cy="12" r="8" strokeWidth={1.5}/></svg>;

const ROWS_PER_PAGE_OPTIONS = [10, 20, 50];

// ── Version History Modal ─────────────────────────────────────────
function VersionHistoryModal({
  brd,
  onClose,
  canEditVersions,
}: {
  brd: Brd;
  onClose: () => void;
  canEditVersions: boolean;
}) {
  const [versions,        setVersions]        = useState<BrdVersionSummary[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [viewingVersion,  setViewingVersion]  = useState<BrdVersionDetail | null>(null);
  const [editingVersion,  setEditingVersion]  = useState<BrdVersionDetail | null>(null);
  const [versionLoading,  setVersionLoading]  = useState(false);
  const [loadingId,       setLoadingId]       = useState<number | null>(null);
  const [deletingId,      setDeletingId]      = useState<number | null>(null);
  const [confirmDelete,   setConfirmDelete]   = useState<BrdVersionSummary | null>(null);
  const snapshotFired = useRef(false);

  // Fetch versions; if none exist, silently create v1.0 from current sections.
  // useRef guard prevents duplicate snapshot if the component re-renders.
  useEffect(() => {
    setLoading(true);
    api.get<{ versions: BrdVersionSummary[] }>(`/brd/${brd.id}/versions`)
      .then(async r => {
        const list = r.data.versions ?? [];
        if (list.length > 0) {
          setVersions(list);
          setLoading(false);
          return;
        }
        // No versions yet — show spinner, snapshot in background (once only)
        setLoading(false);
        if (snapshotFired.current) return;
        snapshotFired.current = true;
        try {
          const sectionsRes = await api.get<{
            scope?: unknown; metadata?: unknown; toc?: unknown;
            citations?: unknown; contentProfile?: unknown; brdConfig?: unknown;
          }>(`/brd/${brd.id}/sections`);
          const snap = await api.post<BrdVersionSummary>(`/brd/${brd.id}/versions`, {
            ...sectionsRes.data,
            label: "v1.0",
          });
          setVersions([snap.data]);
        } catch {
          // Snapshot failed silently — empty state is fine
          snapshotFired.current = false; // allow retry next open
        }
      })
      .catch(() => {
        setError("Failed to load version history.");
        setLoading(false);
      });
  }, [brd.id]);

  async function handleViewVersion(v: BrdVersionSummary) {
    setVersionLoading(true);
    setLoadingId(v.id);
    try {
      const r = await api.get<BrdVersionDetail>(`/brd/${brd.id}/versions/${v.versionNum}`);
      setViewingVersion(r.data);
    } catch {
      setError("Failed to load that version.");
    } finally {
      setVersionLoading(false);
      setLoadingId(null);
    }
  }

  async function handleEditVersion(v: BrdVersionSummary) {
    if (!canEditVersions) return;

    setVersionLoading(true);
    setLoadingId(v.id);
    try {
      const r = await api.get<BrdVersionDetail>(`/brd/${brd.id}/versions/${v.versionNum}`);
      setEditingVersion(r.data);
    } catch {
      setError("Failed to load that version.");
    } finally {
      setVersionLoading(false);
      setLoadingId(null);
    }
  }

  async function confirmDeleteVersion() {
    if (!confirmDelete) return;
    if (!canEditVersions) return;

    const v = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(v.id);
    try {
      await api.delete(`/brd/${brd.id}/versions/${v.versionNum}`);
      setVersions(prev => prev.filter(x => x.id !== v.id));
    } catch {
      setError("Failed to delete that version.");
    } finally {
      setDeletingId(null);
    }
  }

  const name = displayTitle(brd);

  // ── Full-screen version viewer ────────────────────────────────
  if (viewingVersion) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button onClick={() => setViewingVersion(null)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <BackIcon /> Back to History
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono text-xs text-blue-600 dark:text-blue-400 font-semibold">{brd.id}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{name}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700/40">
              {viewingVersion.label}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              · Saved {new Date(viewingVersion.savedAt).toLocaleString()}
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          <Generate
            brdId={brd.id}
            title={name}
            format={brd.format}
            initialData={{
              scope:          viewingVersion.scope,
              metadata:       viewingVersion.metadata,
              toc:            viewingVersion.toc,
              citations:      viewingVersion.citations,
              contentProfile: viewingVersion.contentProfile,
              brdConfig:      viewingVersion.brdConfig,
            }}
            canEdit={false}
            imageIds={viewingVersion.imageIds ?? null}
          />
        </div>
      </div>
    );
  }

  // ── Full-screen version editor ────────────────────────────────
  if (editingVersion) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button onClick={() => setEditingVersion(null)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <BackIcon /> Back to History
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono text-xs text-blue-600 dark:text-blue-400 font-semibold">{brd.id}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{name}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/40">
              Editing {editingVersion.label}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              · Saved {new Date(editingVersion.savedAt).toLocaleString()}
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          <Generate
            brdId={brd.id}
            title={name}
            format={brd.format}
            initialData={{
              scope:          editingVersion.scope,
              metadata:       editingVersion.metadata,
              toc:            editingVersion.toc,
              citations:      editingVersion.citations,
              contentProfile: editingVersion.contentProfile,
              brdConfig:      editingVersion.brdConfig,
            }}
            canEdit={true}
            imageIds={editingVersion.imageIds ?? null}
          />
        </div>
      </div>
    );
  }

  // ── Delete confirmation modal ─────────────────────────────────
  if (confirmDelete) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
        <div className="relative w-full max-w-sm z-10">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-500" />
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                  <TrashIcon />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete version?</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    This will permanently delete <span className="font-semibold text-slate-700 dark:text-slate-200">{confirmDelete.label}</span> saved on {new Date(confirmDelete.savedAt).toLocaleString()}. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 mt-5">
                <button onClick={() => setConfirmDelete(null)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Cancel
                </button>
                <button onClick={confirmDeleteVersion}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] transition-all">
                  Delete version
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Version list modal ────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md z-10">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-teal-500" />
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">Version History</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                {brd.id} · {name.length > 34 ? name.slice(0, 34) + "…" : name}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <CloseIcon />
            </button>
          </div>

          <div className="p-5">
            {loading ? (
              <div className="flex flex-col gap-2">
                {[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
              </div>
            ) : error ? (
              <p className="text-xs text-red-500 text-center py-4">{error}</p>
            ) : versions.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/>
                    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.8"/>
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Creating v1.0…</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Capturing the current version as a snapshot.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[19px] top-5 bottom-5 w-px bg-slate-200 dark:bg-slate-700" />
                <div className="space-y-3">
                  {versions.map((v, i) => {
                    const isLatest = i === 0;
                    const isDeleting = deletingId === v.id;
                    return (
                      <div key={v.id} className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 z-10 ${isLatest ? "bg-teal-50 dark:bg-teal-900/30 border-teal-400 dark:border-teal-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"}`}>
                          {isLatest
                            ? <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                            : <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                          }
                        </div>
                        <div className={`flex-1 flex items-center justify-between p-3 rounded-xl border transition-colors ${isLatest ? "bg-teal-50/80 dark:bg-teal-900/10 border-teal-200 dark:border-teal-900/40" : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60"}`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md">{v.label}</span>
                              {isLatest && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800">Current</span>}
                            </div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{new Date(v.savedAt).toLocaleString()}</div>
                          </div>
                          {/* Actions */}
                          <div className="ml-3 flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => handleViewVersion(v)} disabled={versionLoading || isDeleting}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50 transition-colors whitespace-nowrap">
                              {versionLoading && loadingId === v.id && !isDeleting
                                ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>
                                : <EyeIcon />
                              }
                              View
                            </button>
                            <button onClick={() => handleEditVersion(v)} disabled={!canEditVersions || versionLoading || isDeleting}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 transition-colors whitespace-nowrap">
                              <EditIcon />
                              Edit
                            </button>
                            <button onClick={() => canEditVersions && setConfirmDelete(v)} disabled={!canEditVersions || versionLoading || isDeleting}
                              title="Delete this version"
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-40 transition-colors">
                              {isDeleting
                                ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>
                                : <TrashIcon />
                              }
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <button onClick={onClose} className="w-full mt-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function BrdPage() {
  const { user } = useAuth();
  const [brds,            setBrds]            = useState<Brd[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [search,          setSearch]          = useState("");
  const [activeFilter,    setActiveFilter]    = useState<BrdStatus | "All">("All");
  const [activeContinent, setActiveContinent] = useState<Continent | null>(null);
  const [historyBrd,      setHistoryBrd]      = useState<Brd | null>(null);
  const [showBrdFlow,     setShowBrdFlow]     = useState(false);
  const [flowInitialStep, setFlowInitialStep] = useState(0);
  const [flowFinalMode,   setFlowFinalMode]   = useState<"generate" | "view">("generate");
  const [flowInitialMeta, setFlowInitialMeta] = useState<{ format: "new" | "old"; brdId: string; title: string; status?: BrdStatus } | null>(null);
  const [fetchError,      setFetchError]      = useState<string | null>(null);
  const [page,            setPage]            = useState(1);
  const [rowsPerPage,     setRowsPerPage]     = useState(10);
  const [selected,        setSelected]        = useState<Set<string>>(new Set());
  const [deleteTarget,    setDeleteTarget]    = useState<Brd | null>(null);
  const [deleteLoading,   setDeleteLoading]   = useState(false);
  const [bulkDeleteOpen,  setBulkDeleteOpen]  = useState(false);
  const [sortField,       setSortField]       = useState<SortField>("id");
  const [sortDirection,   setSortDirection]   = useState<SortDirection>("asc");
  const [trashOpen,       setTrashOpen]       = useState(false);
  const [deletedBrds,     setDeletedBrds]     = useState<(Brd & { deletedAt: string })[]>([]);
  const [trashLoading,    setTrashLoading]    = useState(false);
  const [restoring,       setRestoring]       = useState<string | null>(null);
  const [permanentDeleting, setPermanentDeleting] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<(Brd & { deletedAt: string }) | null>(null);
  const [trashSelected,     setTrashSelected]     = useState<Set<string>>(new Set());
  const [bulkTrashDeleting, setBulkTrashDeleting] = useState(false);
  const [bulkTrashDeleteOpen, setBulkTrashDeleteOpen] = useState(false);
  const [reuploadingId,   setReuploadingId]   = useState<string | null>(null);
  const [reuploadTargetId, setReuploadTargetId] = useState<string | null>(null);
  const [statusTarget,    setStatusTarget]    = useState<Brd | null>(null);
  const [statusUpdating,  setStatusUpdating]  = useState(false);
  const [nextStatus,      setNextStatus]      = useState<BrdStatus>("DRAFT");
  const reuploadInputRef = useRef<HTMLInputElement | null>(null);

  const teamSlug = String(user?.team?.slug ?? "").toLowerCase();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isAdmin = user?.role === "ADMIN";
  const isPreProductionTeam = teamSlug === "pre-production";

  const canCreateBrd = isSuperAdmin || isPreProductionTeam;
  const canEditBrd = isSuperAdmin || isPreProductionTeam;
  const canChangeBrdStatus = isSuperAdmin || isPreProductionTeam;
  const canDeleteBrd = isSuperAdmin || (isPreProductionTeam && isAdmin);
  const canUseTrash = canDeleteBrd;

  const allowedStatusFilters: Array<BrdStatus | "All"> =
    isSuperAdmin || isPreProductionTeam
      ? ["All", "DRAFT", "PAUSED", "COMPLETED", "APPROVED", "ON_HOLD"]
      : ["All", "APPROVED", "ON_HOLD"];

  const fetchBrds = useCallback(async () => {
    try {
      setLoading(true); setFetchError(null);
      const res = await api.get<Brd[]>("/brd");
      setBrds(res.data);
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setFetchError(error?.response?.data?.error ?? error?.message ?? "Unknown error");
      console.error("Failed to fetch BRDs:", err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBrds(); }, [fetchBrds]);
  const handleFlowClose = useCallback(() => { setShowBrdFlow(false); fetchBrds(); }, [fetchBrds]);

  const exportToCsv = () => {
    const headers = ["BRD ID", "Title", "Geography", "Status", "Version", "Format", "Last Updated"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = brds.map((b) => [
      escape(b.id),
      escape(displayTitle(b)),
      escape(b.geography),
      escape(STATUS_LABEL[b.status] ?? b.status),
      escape(b.version),
      escape(b.format === "old" ? "OLD" : "New"),
      escape(b.lastUpdated),
    ].join(","));
    const csv = [headers.map(escape).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BRD_Registry_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openTrash = async () => {
    if (!canUseTrash) return;

    setTrashOpen(true);
    setTrashLoading(true);
    try {
      const res = await api.get<(Brd & { deletedAt: string })[]>("/brd/deleted");
      setDeletedBrds(res.data);
    } catch (err) { console.error("Failed to fetch deleted BRDs:", err); }
    finally { setTrashLoading(false); }
  };

  const restoreBrd = async (id: string) => {
    setRestoring(id);
    try {
      await api.post(`/brd/${id}/restore`);
      setDeletedBrds(prev => prev.filter(b => b.id !== id));
      fetchBrds();
    } catch (err) { console.error("Failed to restore BRD:", err); }
    finally { setRestoring(null); }
  };

  const permanentlyDeleteBrd = async (brd: Brd & { deletedAt: string }) => {
    setPermanentDeleting(brd.id);
    try {
      await api.delete(`/brd/${brd.id}/permanent`);
      setDeletedBrds(prev => prev.filter(item => item.id !== brd.id));
      fetchBrds();
    } catch (err) {
      console.error("Failed to permanently delete BRD:", err);
    } finally {
      setPermanentDeleting(null);
      setPermanentDeleteTarget(null);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!permanentDeleteTarget) return;
    await permanentlyDeleteBrd(permanentDeleteTarget);
  };

  const confirmBulkTrashDelete = async () => {
    if (trashSelected.size === 0) return;
    setBulkTrashDeleting(true);
    const ids = Array.from(trashSelected);
    try {
      await Promise.all(ids.map(id => api.delete(`/brd/${id}/permanent`)));
      setDeletedBrds(prev => prev.filter(b => !trashSelected.has(b.id)));
      setTrashSelected(new Set());
      fetchBrds();
    } catch (err) {
      console.error("Failed to bulk permanently delete BRDs:", err);
    } finally {
      setBulkTrashDeleting(false);
      setBulkTrashDeleteOpen(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/brd/${deleteTarget.id}`);
      setBrds(prev => prev.filter(b => b.id !== deleteTarget.id));
      setSelected(s => { const n = new Set(s); n.delete(deleteTarget.id); return n; });
      setDeleteTarget(null);
    } catch (err) { console.error("Failed to delete BRD:", err); }
    finally { setDeleteLoading(false); }
  };

  const handleRemove = (brd: Brd) => {
    if (!canDeleteBrd) return;
    setDeleteTarget(brd);
  };

  const confirmBulkDelete = async () => {
    if (!canDeleteBrd) return;

    setDeleteLoading(true);
    setFetchError(null);
    try {
      const ids = [...selected];
      const deletedIds = new Set<string>();
      const failedIds: string[] = [];

      // Delete one-by-one to avoid request bursts timing out on slower environments.
      for (const id of ids) {
        try {
          await api.delete(`/brd/${id}`, { timeout: 30000 });
          deletedIds.add(id);
        } catch (err) {
          console.error(`Failed to delete BRD ${id}:`, err);
          failedIds.push(id);
        }
      }

      if (deletedIds.size > 0) {
        setBrds(prev => prev.filter(b => !deletedIds.has(b.id)));
      }

      if (failedIds.length > 0) {
        setSelected(new Set(failedIds));
        setFetchError(`Deleted ${deletedIds.size} of ${ids.length}. Timed out/failed: ${failedIds.join(", ")}. Please retry.`);
      } else {
        setSelected(new Set());
        setBulkDeleteOpen(false);
      }
    } catch (err) {
      console.error("Failed to bulk delete:", err);
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setFetchError(error?.response?.data?.error ?? error?.message ?? "Failed to bulk delete");
    }
    finally { setDeleteLoading(false); }
  };

  const promptReupload = (brdId: string) => {
    if (!canEditBrd) return;

    setReuploadTargetId(brdId);
    reuploadInputRef.current?.click();
  };

  const handleReuploadSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = reuploadTargetId;
    e.target.value = "";

    if (!file || !targetId) return;

    const targetBrd = brds.find((b) => b.id === targetId) ?? null;

    setReuploadingId(targetId);
    setFetchError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post(`/brd/re-upload/${targetId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await fetchBrds();

      if (targetBrd) {
        setFlowFinalMode("generate");
        setFlowInitialStep(1);
        setFlowInitialMeta({
          format: targetBrd.format,
          brdId: targetBrd.id,
          title: displayTitle(targetBrd),
          status: targetBrd.status,
        });
        setShowBrdFlow(true);
      }
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setFetchError(error?.response?.data?.error ?? error?.message ?? "Re-upload failed");
      console.error("Failed to re-upload BRD:", err);
    } finally {
      setReuploadingId(null);
      setReuploadTargetId(null);
    }
  };

  const openStatusModal = (brd: Brd) => {
    if (!canChangeBrdStatus) return;

    setStatusTarget(brd);
    setNextStatus(brd.status);
  };

  const submitStatusChange = async () => {
    if (!statusTarget) return;
    if (!canChangeBrdStatus) return;

    setStatusUpdating(true);
    setFetchError(null);
    try {
      await api.patch(`/brd/${statusTarget.id}`, { status: nextStatus });
      setBrds((prev) =>
        prev.map((b) =>
          b.id === statusTarget.id ? { ...b, status: nextStatus } : b,
        ),
      );
      setStatusTarget(null);
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setFetchError(error?.response?.data?.error ?? error?.message ?? "Failed to change BRD status");
    } finally {
      setStatusUpdating(false);
    }
  };

  const statusCounts = brds.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1; return acc;
  }, {});

  const filtered = brds.filter(b => {
    const q = search.toLowerCase(); const name = displayTitle(b).toLowerCase();
    const matchSearch = !q || name.includes(q) || b.title.toLowerCase().includes(q) || b.id.toLowerCase().includes(q) || b.geography.toLowerCase().includes(q);
    const matchStatus = activeFilter === "All" || b.status === activeFilter;
    const matchContinent = activeContinent === null || detectContinent(b.geography) === activeContinent;
    return matchSearch && matchStatus && matchContinent;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortField === "date") {
      const dA = new Date(a.lastUpdated).getTime(); const dB = new Date(b.lastUpdated).getTime();
      return sortDirection === "asc" ? dA - dB : dB - dA;
    }
    if (sortField === "id") {
      const nA = parseInt(a.id.replace(/\D/g, ""), 10) || 0; const nB = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
      return sortDirection === "asc" ? nA - nB : nB - nA;
    }
    const nA = displayTitle(a).toLowerCase(); const nB = displayTitle(b).toLowerCase();
    return sortDirection === "asc" ? nA.localeCompare(nB) : nB.localeCompare(nA);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const safePage   = Math.min(page, totalPages);
  const paginated  = sorted.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const allPageSelected = paginated.length > 0 && paginated.every(b => selected.has(b.id));
  const toggleAll = () => {
    if (allPageSelected) setSelected(s => { const n = new Set(s); paginated.forEach(b => n.delete(b.id)); return n; });
    else setSelected(s => { const n = new Set(s); paginated.forEach(b => n.add(b.id)); return n; });
  };
  const toggleOne = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  const pageNums = (() => {
    if (totalPages <= 7) return Array.from({length: totalPages}, (_, i) => i + 1);
    if (safePage <= 4) return [1,2,3,4,5,"...",totalPages];
    if (safePage >= totalPages - 3) return [1,"...",totalPages-4,totalPages-3,totalPages-2,totalPages-1,totalPages];
    return [1,"...",safePage-1,safePage,safePage+1,"...",totalPages];
  })();

  const startNewBrd = () => {
    if (!canCreateBrd) return;
    setFlowFinalMode("generate");
    setFlowInitialStep(0);
    setFlowInitialMeta(null);
    setShowBrdFlow(true);
  };

  if (showBrdFlow) return (
    <div className="h-full w-full">
      <BrdFlow initialStep={flowInitialStep} finalStepMode={flowFinalMode} initialMeta={flowInitialMeta} onClose={handleFlowClose} />
    </div>
  );

  return (
    <div className="h-full w-full min-h-0 bg-slate-50 dark:bg-[#0f172a] flex flex-col">

      {/* ── Page Header ── */}
      <div className="px-6 pt-5 pb-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">BRD Registry</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Business requirements document management</p>
      </div>

      {/* ── Stat Pills ── */}
      <div className="flex flex-wrap gap-0 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
        {[
          { label: "Received",  value: brds.length,                   icon: <ReceivedIcon />,   color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-100 dark:bg-blue-900/30",    border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "Draft",     value: statusCounts["DRAFT"] || 0,    icon: <ProcessingIcon />, color: "text-sky-600 dark:text-sky-400",      bg: "bg-sky-100 dark:bg-sky-900/30",      border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "Paused",    value: statusCounts["PAUSED"] || 0,   icon: <PausedIcon />,     color: "text-slate-500 dark:text-slate-400",  bg: "bg-slate-100 dark:bg-slate-800",     border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "Completed", value: statusCounts["COMPLETED"] || 0,icon: <CompletedIcon />,  color: "text-teal-600 dark:text-teal-400",    bg: "bg-teal-100 dark:bg-teal-900/30",    border: "" },
        ].map((s) => (
          <div key={s.label} className={`flex items-center gap-3 px-6 py-4 flex-1 min-w-[140px] bg-white dark:bg-slate-900 ${s.border}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${s.bg}`}><span className={s.color}>{s.icon}</span></div>
            <div>
              <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{s.label}</div>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-tight tabular-nums">
                {loading ? <span className="inline-block w-8 h-5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" /> : s.value.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <button onClick={fetchBrds} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <RefreshIcon /><span className="hidden sm:inline">Refresh</span>
        </button>

        {/* Export CSV */}
        <button onClick={exportToCsv} disabled={brds.length === 0} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <DownloadIcon /> <span className="hidden sm:inline">Export CSV</span>
        </button>

        {/* Trash bin */}
        {canUseTrash && (
          <button onClick={openTrash} title="View deleted BRDs" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <TrashBinIcon /> <span className="hidden sm:inline">Trash</span>
          </button>
        )}

        {/* Bulk delete */}
        {canDeleteBrd && selected.size > 0 && (
          <button onClick={() => setBulkDeleteOpen(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <TrashIcon /> Delete ({selected.size})
          </button>
        )}
        {/* Region */}
        <div className="relative">
          <select value={activeContinent ?? "All"} onChange={e => { const v = e.target.value; setActiveContinent(v === "All" ? null : v as Continent); setPage(1); }}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer"
            style={activeContinent ? { borderColor: CONTINENT_COLOR[activeContinent], color: CONTINENT_COLOR[activeContinent] } : {}}>
            <option value="All">All Regions</option>
            {(["Asia","Europe","Americas","Africa","Oceania","Global"] as Continent[]).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg></span>
        </div>
        {/* Status */}
        <div className="relative">
          <select value={activeFilter} onChange={e => { setActiveFilter(e.target.value as BrdStatus | "All"); setPage(1); }}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer">
            {allowedStatusFilters.map((status) => (
              <option key={status} value={status}>
                {status === "All" ? "All Status" : STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg></span>
        </div>
        {/* Sort field */}
        <div className="relative">
          <select value={sortField} onChange={e => { setSortField(e.target.value as SortField); setPage(1); }}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer">
            <option value="id">Sort by BRD ID</option>
            <option value="name">Sort by Name</option>
            <option value="date">Sort by Date</option>
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg></span>
        </div>
        {/* Sort dir */}
        <div className="relative">
          <select value={sortDirection} onChange={e => { setSortDirection(e.target.value as SortDirection); setPage(1); }}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer">
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg></span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-slate-400 pointer-events-none"><SearchIcon /></span>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search title, ID, geography…"
              className="pl-8 pr-8 py-1.5 w-44 sm:w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-colors" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>}
          </div>
          <button onClick={startNewBrd} disabled={!canCreateBrd} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm">
            <PlusIcon /> New BRD
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-medium">
          ⚠ Backend error: <span className="font-mono">{fetchError}</span>
        </div>
      )}

      <div className="mx-4 mt-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-bold text-slate-600 dark:text-slate-300">Workflow:</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-500" />Draft</span>
          <span className="text-slate-300 dark:text-slate-600">→</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-teal-500" />Complete</span>
          <span className="text-slate-300 dark:text-slate-600">→</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500" />Approved</span>
          <span className="inline-flex items-center gap-1.5 ml-2"><span className="w-2 h-2 rounded-full bg-slate-400" />On Hold (questions/comments)</span>
        </div>
      </div>

      <input
        ref={reuploadInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleReuploadSelected}
      />

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 dark:bg-slate-900 border-b-2 border-slate-200 dark:border-blue-900/60">
              <th className="w-10 px-3 py-3 text-center"><input type="checkbox" checked={allPageSelected} disabled={!canDeleteBrd} onChange={toggleAll} className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" /></th>
              <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">BRD ID</th>
              <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">Source / Content Name</th>
              <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">Geography</th>
              <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">Status</th>
              <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">Version</th>
              <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">Last Updated</th>
              <th className="px-3 py-3 text-center font-bold text-slate-500 dark:text-slate-300 text-[10px] uppercase tracking-wider whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-[#1e3a5f]">
            {loading ? (
              Array.from({length:8}).map((_,i) => <tr key={i}>{Array.from({length:8}).map((_,j) => <td key={j} className="px-3 py-3.5"><div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" style={{width:`${60+Math.random()*30}%`}}/></td>)}</tr>)
            ) : paginated.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-20 text-center text-slate-400 dark:text-slate-500">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3"><svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400">{brds.length === 0 ? "No BRDs yet" : "No results found"}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">{brds.length === 0 ? 'Click "New BRD" to get started.' : "Try adjusting your search or filters."}</div>
              </td></tr>
            ) : paginated.map(brd => {
              const name = displayTitle(brd);
              const hasSourceLabel = !!(brd.sourceName?.trim() || brd.contentName?.trim());
              const canView = true;
              const canEdit = canEditBrd && (brd.status === "DRAFT" || brd.status === "PAUSED" || brd.status === "COMPLETED" || brd.status === "APPROVED" || brd.status === "ON_HOLD");
              const canReupload = canEditBrd && brd.status === "DRAFT";
              const isSelected = selected.has(brd.id);
              const continent = detectContinent(brd.geography);
              return (
                <tr key={brd.id} className={`transition-colors group ${isSelected ? "bg-blue-50 dark:bg-blue-900/15" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}>
                  <td className="w-10 px-3 py-3 text-center"><input type="checkbox" checked={isSelected} disabled={!canDeleteBrd} onChange={() => toggleOne(brd.id)} className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" /></td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-md border border-blue-100 dark:border-blue-800/40"><TagIcon />{brd.id}</span>
                  </td>
                  <td className="px-3 py-3 max-w-[220px]">
                    <div className="font-medium text-slate-800 dark:text-slate-100 truncate text-[12px]" title={name}>{name}</div>
                    {hasSourceLabel && brd.title && brd.title !== name && <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5" title={brd.title}>{brd.title}</div>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 text-[12px]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: CONTINENT_COLOR[continent]}} />
                      {brd.geography}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span
                      title={STATUS_HELPER[brd.status]}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_BADGE[brd.status]}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[brd.status]}`} />
                      {STATUS_LABEL[brd.status]}
                    </span>
                    {(brd.status === "COMPLETED" || brd.status === "ON_HOLD") && (
                      <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500" title={STATUS_HELPER[brd.status]}>
                        {brd.status === "COMPLETED" ? "Awaiting approval" : "Action required"}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">{brd.version}</span>
                      {brd.format === "old"
                        ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/30">Old</span>
                        : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/30">New</span>
                      }
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap"><span className="text-[11px] text-slate-500 dark:text-slate-400">{brd.lastUpdated}</span></td>
                  <td className="px-3 py-3 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <button disabled={!canView}
                        onClick={() => setHistoryBrd(brd)}
                        title="View BRD Version"
                        className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <EyeIcon />
                      </button>
                      <button disabled={!canEdit}
                        onClick={() => { setFlowFinalMode("generate"); setFlowInitialStep(6); setFlowInitialMeta({ format: brd.format, brdId: brd.id, title: name }); setShowBrdFlow(true); }}
                        title="Edit BRD (Draft, Paused, Complete, Approved, On Hold)"
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <EditIcon />
                      </button>
                      <button onClick={() => setHistoryBrd(brd)} title="Version History"
                        className="p-1.5 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 dark:hover:text-violet-400 transition-colors">
                        <HistoryIcon />
                      </button>
                      <button
                        onClick={() => openStatusModal(brd)}
                        title="Change Status"
                        disabled={!canChangeBrdStatus}
                        className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <StatusIcon />
                      </button>
                      <button
                        onClick={() => promptReupload(brd.id)}
                        title="Re-upload final BRD (Draft only)"
                        disabled={!canReupload || reuploadingId === brd.id}
                        className="p-1.5 rounded-md text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 dark:hover:text-teal-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {reuploadingId === brd.id ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                        ) : (
                          <ReuploadIcon />
                        )}
                      </button>
                      <button onClick={() => handleRemove(brd)} title="Remove" disabled={!canDeleteBrd}
                        className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
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
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 shadow-sm">
        <div className="flex items-center gap-2">
          <span>Showing</span>
          <select value={rowsPerPage} onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(1); }} className="px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs focus:outline-none focus:border-blue-400">
            {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>out of <strong className="text-slate-700 dark:text-slate-200">{sorted.length}</strong></span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={safePage===1} className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-slate-600 dark:text-slate-300">← Prev</button>
          {pageNums.map((n,i) => n==="..." ? <span key={`dots-${i}`} className="px-2 py-1 text-slate-400">…</span> : (
            <button key={n} onClick={() => setPage(n as number)} className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${safePage===n?"bg-blue-600 text-white shadow-sm":"border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>{n}</button>
          ))}
          <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={safePage===totalPages} className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-slate-600 dark:text-slate-300">Next →</button>
        </div>
      </div>

      {/* ── Delete Modal (single) ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleteLoading && setDeleteTarget(null)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-500" />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete BRD?</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{deleteTarget.id}</span> will be soft-deleted and can be restored later if needed.
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
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[deleteTarget.status]}`} />{STATUS_LABEL[deleteTarget.status]}
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
                      : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Delete Modal ── */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleteLoading && setBulkDeleteOpen(false)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-red-500 to-rose-500" />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete {selected.size} BRD{selected.size > 1 ? "s" : ""}?</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">All selected documents will be soft-deleted and can be restored later if needed.</p>
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
                      : `Delete ${selected.size}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Trash Bin Modal ── */}
      {trashOpen && (
        <div style={{position:"fixed", top:0, left:0, width:"100vw", height:"100vh", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px", boxSizing:"border-box"}}>
          <div style={{position:"absolute", inset:0, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)"}} onClick={() => { setTrashOpen(false); setTrashSelected(new Set()); }} />
          <div style={{position:"relative", width:"calc(100vw - 48px)", maxWidth:"1200px", zIndex:1}}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col" style={{maxHeight:"85vh"}}>
              <div className="h-1 w-full bg-gradient-to-r from-slate-500 to-blue-600" />
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <span className="text-slate-500 dark:text-slate-400"><TrashBinIcon /></span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Deleted BRDs</h3>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Soft-deleted records — restore to bring them back</p>
                  </div>
                </div>
                <button onClick={() => { setTrashOpen(false); setTrashSelected(new Set()); }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <CloseIcon />
                </button>
              </div>
              {/* Content */}
              <div className="overflow-y-auto overflow-x-auto flex-1">
                {trashLoading ? (
                  <div className="flex items-center justify-center py-16 text-slate-400 text-xs gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                    Loading…
                  </div>
                ) : deletedBrds.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <TrashBinIcon />
                    </div>
                    <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Trash is empty</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">No deleted BRDs found.</div>
                  </div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                        <th className="px-4 py-2.5 w-8">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500 cursor-pointer"
                            checked={trashSelected.size === deletedBrds.length && deletedBrds.length > 0}
                            ref={el => {
                              if (el) {
                                el.indeterminate = trashSelected.size > 0 && trashSelected.size < deletedBrds.length;
                              }
                            }}
                            onChange={e => setTrashSelected(e.target.checked ? new Set(deletedBrds.map(b => b.id)) : new Set())}
                          />
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">BRD ID</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-full">Title</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Status</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Deleted On</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                      {deletedBrds.map((b) => {
                        const isChecked = trashSelected.has(b.id);
                        return (
                          <tr
                            key={b.id}
                            className={`transition-colors cursor-pointer ${isChecked ? "bg-red-50 dark:bg-red-900/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
                            onClick={() => setTrashSelected(prev => {
                              const n = new Set(prev);
                              if (isChecked) {
                                n.delete(b.id);
                              } else {
                                n.add(b.id);
                              }
                              return n;
                            })}
                          >
                            <td className="px-4 py-3 w-8" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500 cursor-pointer"
                                checked={isChecked}
                                onChange={e => {
                                  e.stopPropagation();
                                  setTrashSelected(prev => {
                                    const n = new Set(prev);
                                    if (e.target.checked) {
                                      n.add(b.id);
                                    } else {
                                      n.delete(b.id);
                                    }
                                    return n;
                                  });
                                }}
                              />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-blue-600 dark:text-blue-400 font-medium">{b.id}</td>
                            <td className="px-4 py-3">
                              <div className="truncate text-slate-800 dark:text-slate-100 font-medium max-w-xs" title={b.title}>{b.title}</div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[b.status as BrdStatus]}`}>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[b.status as BrdStatus]}`} />
                                {STATUS_LABEL[b.status as BrdStatus]}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400 text-[11px]">{b.deletedAt}</td>
                            <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => restoreBrd(b.id)}
                                  disabled={restoring === b.id || permanentDeleting === b.id}
                                  title="Restore BRD"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 border border-teal-200 dark:border-teal-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                  {restoring === b.id
                                    ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                    : <RestoreIcon />}
                                  Restore
                                </button>
                                <button
                                  onClick={() => setPermanentDeleteTarget(b)}
                                  disabled={restoring === b.id || permanentDeleting === b.id}
                                  title="Delete permanently"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                                  {permanentDeleting === b.id
                                    ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                    : <TrashIcon />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {/* Footer */}
              <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                <span>
                  {trashSelected.size > 0
                    ? <span className="text-red-600 dark:text-red-400 font-semibold">{trashSelected.size} selected</span>
                    : <span>{deletedBrds.length} deleted record{deletedBrds.length !== 1 ? "s" : ""}</span>
                  }
                </span>
                <div className="flex items-center gap-2">
                  {trashSelected.size > 0 && (
                    <>
                      <button
                        onClick={() => setTrashSelected(new Set())}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                      >
                        Clear selection
                      </button>
                      <button
                        onClick={() => setBulkTrashDeleteOpen(true)}
                        className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors inline-flex items-center gap-1.5"
                      >
                        <TrashIcon />
                        Delete {trashSelected.size} permanently
                      </button>
                    </>
                  )}
                  <button onClick={() => { setTrashOpen(false); setTrashSelected(new Set()); }} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Permanent Delete Confirmation Modal ── */}
      {permanentDeleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 10001 }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !permanentDeleting && setPermanentDeleteTarget(null)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-red-600 to-rose-600" />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete Permanently?</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{permanentDeleteTarget.id}</span> will be permanently removed from the system and cannot be restored.
                    </p>
                  </div>
                </div>
                <div className="mt-4 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Document</div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{displayTitle(permanentDeleteTarget)}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Deleted on {permanentDeleteTarget.deletedAt}</div>
                </div>
                <div className="flex items-center gap-2.5 mt-5">
                  <button
                    onClick={() => setPermanentDeleteTarget(null)}
                    disabled={!!permanentDeleting}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmPermanentDelete}
                    disabled={!!permanentDeleting}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] disabled:opacity-60 transition-all"
                  >
                    {permanentDeleting
                      ? <span className="flex items-center justify-center gap-1.5"><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Deleting…</span>
                      : "Delete Permanently"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Permanent Delete Confirmation Modal ── */}
      {bulkTrashDeleteOpen && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 10000 }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !bulkTrashDeleting && setBulkTrashDeleteOpen(false)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-red-600 to-rose-600" />
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0 border border-red-100 dark:border-red-800/40">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete {trashSelected.size} Records Permanently?</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      These <span className="font-semibold text-slate-700 dark:text-slate-200">{trashSelected.size} BRDs</span> will be permanently removed from the system and cannot be restored.
                    </p>
                  </div>
                </div>
                <div className="mt-4 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto space-y-1.5">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Selected BRDs</div>
                  {deletedBrds.filter(b => trashSelected.has(b.id)).map(b => (
                    <div key={b.id} className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 font-semibold shrink-0">{b.id}</span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{displayTitle(b)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2.5 mt-5">
                  <button
                    onClick={() => setBulkTrashDeleteOpen(false)}
                    disabled={bulkTrashDeleting}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmBulkTrashDelete}
                    disabled={bulkTrashDeleting}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] disabled:opacity-60 transition-all"
                  >
                    {bulkTrashDeleting
                      ? <span className="flex items-center justify-center gap-1.5"><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Deleting…</span>
                      : `Delete ${trashSelected.size} Permanently`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── History Modal ── */}
      {historyBrd && (
        <VersionHistoryModal brd={historyBrd} onClose={() => setHistoryBrd(null)} canEditVersions={canEditBrd} />
      )}

      {/* ── Status Modal ── */}
      {statusTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !statusUpdating && setStatusTarget(null)} />
          <div className="relative w-full max-w-md z-10">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-teal-500" />
              <div className="p-6 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Change BRD Status</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Move <span className="font-semibold">{statusTarget.id}</span> to the next workflow state.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    New Status
                  </label>
                  <select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as BrdStatus)}
                    disabled={statusUpdating}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-400"
                  >
                    {(statusTarget ? STATUS_TRANSITIONS[statusTarget.status] : (["DRAFT"] as BrdStatus[])).map((status: BrdStatus) => (
                      <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                    ))}
                  </select>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Workflow: Draft -&gt; Complete -&gt; Approved. Use On Hold for client comments or production-team questions.
                </p>

                <div className="px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">BRD</div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{statusTarget.id}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">{displayTitle(statusTarget)}</div>
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={() => setStatusTarget(null)}
                    disabled={statusUpdating}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitStatusChange}
                    disabled={statusUpdating}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 active:scale-[0.98] disabled:opacity-60 transition-all"
                  >
                    {statusUpdating ? "Updating..." : `Change to ${STATUS_LABEL[nextStatus].toUpperCase()}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}