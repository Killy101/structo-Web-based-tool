"use client";

import { useMemo, useState } from "react";
import BrdFlow from "@/components/brd/BrdFlow";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { useBrds } from "@/hooks";
import { brdApi } from "@/services/api";
import type { BrdSourceItem } from "@/types";

type BrdProcessStatus = "COMPLETED" | "ON_HOLD";
type FilterKey = "All" | "COMPLETED" | "ON_HOLD";
type SortField = "name" | "date";
type SortDirection = "asc" | "desc";
interface ProcessBrd extends BrdSourceItem {
  status: BrdProcessStatus;
}

interface QueryModalProps {
  brd: ProcessBrd;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}

const STATUS_BADGE: Record<BrdProcessStatus, string> = {
  COMPLETED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  ON_HOLD:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

const EyeIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const QueryIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

function isProcessStatus(status: string): status is BrdProcessStatus {
  return status === "COMPLETED" || status === "ON_HOLD";
}

function QueryModal({ brd, onClose, onSubmitted }: QueryModalProps) {
  const [query, setQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Query is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await brdApi.submitQuery(brd.id, trimmed);
      onSubmitted(response.message);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send query.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg">
        <Card className="shadow-2xl">
          <CardHeader
            title="Send Query"
            subtitle={`${brd.id} • ${brd.title}`}
            action={
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <span className="text-base leading-none">×</span>
              </button>
            }
          />
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 text-xs text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/20 dark:text-indigo-300">
              This query will be sent to the Pre-Production team.
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Query
              </label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter the question or clarification needed for this BRD..."
                rows={5}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1 justify-center" onClick={onClose}>
                Cancel
              </Button>
              <Button className="flex-1 justify-center" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send Query"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function MyTaskPage() {
  const { brds, isLoading, error, refetch } = useBrds();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("All");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [queryBrd, setQueryBrd] = useState<ProcessBrd | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [showBrdFlow, setShowBrdFlow] = useState(false);
  const [flowInitialStep, setFlowInitialStep] = useState(6);
  const [flowFinalMode, setFlowFinalMode] = useState<"generate" | "view">("view");
  const [flowInitialMeta, setFlowInitialMeta] = useState<{
    format: "new" | "old";
    brdId: string;
    title: string;
  } | null>(null);

  const processBrds = useMemo(
    () => brds.filter((brd): brd is ProcessBrd => isProcessStatus(brd.status)),
    [brds],
  );

  const counts = useMemo(() => {
    return processBrds.reduce(
      (acc, brd) => {
        acc.total += 1;
        acc[brd.status] += 1;
        return acc;
      },
      { total: 0, COMPLETED: 0, ON_HOLD: 0 },
    );
  }, [processBrds]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return processBrds.filter((brd) => {
      const matchesFilter = activeFilter === "All" || brd.status === activeFilter;
      const matchesSearch =
        !query ||
        brd.title.toLowerCase().includes(query) ||
        brd.id.toLowerCase().includes(query) ||
        brd.geography.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, processBrds, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((left, right) => {
      if (sortField === "date") {
        const leftDate = new Date(left.lastUpdated).getTime();
        const rightDate = new Date(right.lastUpdated).getTime();
        return sortDirection === "asc" ? leftDate - rightDate : rightDate - leftDate;
      }

      const leftName = left.title.toLowerCase();
      const rightName = right.title.toLowerCase();
      return sortDirection === "asc"
        ? leftName.localeCompare(rightName)
        : rightName.localeCompare(leftName);
    });
  }, [filtered, sortDirection, sortField]);

  const openBrd = (brd: ProcessBrd) => {
    if (brd.status === "ON_HOLD") return;
    setFlowFinalMode("view");
    setFlowInitialStep(6);
    setFlowInitialMeta({ format: brd.format, brdId: brd.id, title: brd.title });
    setShowBrdFlow(true);
  };

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
    <div className="relative h-full w-full min-h-0 bg-slate-50 dark:bg-slate-950 flex flex-col">

      {/* ── Page Header ── */}
      <div className="px-6 pt-5 pb-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">BRD Process</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">View BRD documents with Completed and On Hold status. On Hold documents cannot be opened.</p>
        </div>
      </div>

      {/* ── Stat Pills ── */}
      <div className="flex flex-wrap gap-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {[
          { label: "Total Documents", value: counts.total, color: "text-blue-600 dark:text-blue-400", border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "Completed",       value: counts.COMPLETED, color: "text-emerald-600 dark:text-emerald-400", border: "border-r border-slate-200 dark:border-slate-800" },
          { label: "On Hold",         value: counts.ON_HOLD,   color: "text-amber-600 dark:text-amber-400",   border: "" },
        ].map((s) => (
          <div key={s.label} className={`flex items-center gap-3 px-6 py-4 flex-1 min-w-[120px] ${s.border}`}>
            <div>
              <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">{s.label}</div>
              <div className={`text-xl font-bold leading-tight tabular-nums ${s.color}`}>
                {isLoading ? <span className="inline-block w-8 h-5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" /> : s.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">

        {/* Refresh */}
        <button
          onClick={refetch}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <RefreshIcon /> <span className="hidden sm:inline">Refresh</span>
        </button>

        {/* Status dropdown */}
        <div className="relative">
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as FilterKey)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer"
          >
            <option value="All">All Status</option>
            <option value="COMPLETED">Completed</option>
            <option value="ON_HOLD">On Hold</option>
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
            <ChevronDownIcon />
          </span>
        </div>

        {/* Sort field dropdown */}
        <div className="relative">
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer"
          >
            <option value="name">Sort by Name</option>
            <option value="date">Sort by Date</option>
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
            <ChevronDownIcon />
          </span>
        </div>

        {/* Sort direction dropdown */}
        <div className="relative">
          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value as SortDirection)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
            <ChevronDownIcon />
          </span>
        </div>

        {/* Right: Search */}
        <div className="ml-auto relative flex items-center">
          <span className="absolute left-3 text-slate-400 pointer-events-none"><SearchIcon /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, BRD ID, geography…"
            className="pl-8 pr-8 py-1.5 w-44 sm:w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
          {banner}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700">
              {[
                "BRD ID",
                "Document Title",
                "Geography",
                "Status",
                "Version",
                "Last Updated",
                "Query",
                "Action",
              ].map((header) => (
                <th
                  key={header}
                  className="whitespace-nowrap px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-200"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
            <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                    Loading BRD documents...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-red-500 dark:text-red-400">
                    {error}
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                    No BRD documents match the current filter.
                  </td>
                </tr>
              ) : (
                sorted.map((brd) => (
                  <tr
                    key={brd.id}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <span className="inline-flex items-center rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                        {brd.id}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center text-xs font-medium text-slate-900 dark:text-slate-200">
                      {brd.title}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center text-xs text-slate-700 dark:text-slate-400">
                      {brd.geography}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <Badge className={`font-medium ${STATUS_BADGE[brd.status]}`}>
                        {brd.status === "ON_HOLD" ? "On Hold" : "Completed"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <span className="rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                        {brd.version}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center font-mono text-xs text-slate-600 dark:text-slate-500">
                      {brd.lastUpdated}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => setQueryBrd(brd)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition-all hover:bg-indigo-100 dark:border-indigo-800/50 dark:bg-indigo-900/20 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                        title="Send query to Pre-Production"
                      >
                        <QueryIcon /> Query
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => openBrd(brd)}
                        disabled={brd.status === "ON_HOLD"}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-all hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-600"
                        title={brd.status === "ON_HOLD" ? "On Hold documents cannot be viewed" : "View BRD"}
                      >
                        <EyeIcon /> View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </div>

      {queryBrd && (
        <QueryModal
          brd={queryBrd}
          onClose={() => setQueryBrd(null)}
          onSubmitted={(message) => setBanner(message)}
        />
      )}
    </div>
  );
}
