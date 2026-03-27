"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Filter, Search, Shield, Activity, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "./index";
import { Button } from "./index";
import { userLogsApi } from "../../services/api";
import type { UserLog } from "../../types";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type LogLevel = "info" | "warning" | "error" | "security" | "audit";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  duration: string;
  status: string;
  tags: string[];
  triggeredBy?: string;
  userId?: number;
  userDisplayId?: string;
}

type Filters = {
  level: string[];
  service: string[];
  status: string[];
};

// ─── MAP DB LOG → DISPLAY ENTRY ──────────────────────────────────────────────

function inferLevel(action: string): LogLevel {
  const a = action.toUpperCase();
  if (a.includes("FAIL") || a.includes("ERROR") || a.includes("INVALID")) return "error";
  if (a.includes("LOGIN") || a.includes("MFA") || a.includes("PASSWORD") || a.includes("SECURITY") || a.includes("BLOCKED") || a.includes("LOCK")) return "security";
  if (a.includes("DELETE") || a.includes("ROLE") || a.includes("PROMOTE") || a.includes("DEACTIVAT") || a.includes("SETTING") || a.includes("POLICY") || a.includes("PERMISSION")) return "audit";
  if (a.includes("WARN") || a.includes("SLOW") || a.includes("RATE_LIMIT")) return "warning";
  return "info";
}

function inferService(action: string): string {
  const a = action.toUpperCase();
  if (a.includes("LOGIN") || a.includes("LOGOUT") || a.includes("AUTH") || a.includes("MFA") || a.includes("PASSWORD") || a.includes("REGISTER")) return "auth-service";
  if (a.includes("TASK")) return "task-manager";
  if (a.includes("BRD") || a.includes("DOCUMENT") || a.includes("FILE") || a.includes("UPLOAD")) return "brd-processor";
  if (a.includes("TEAM")) return "team-service";
  if (a.includes("ROLE") || a.includes("USER") || a.includes("SETTING") || a.includes("POLICY")) return "admin-panel";
  if (a.includes("NOTIF")) return "notification-service";
  return "system";
}

function inferTags(action: string): string[] {
  const tags: string[] = [];
  const a = action.toUpperCase();
  if (a.includes("LOGIN")) tags.push("login");
  if (a.includes("LOGOUT")) tags.push("logout");
  if (a.includes("PASSWORD")) tags.push("password");
  if (a.includes("TASK")) tags.push("task");
  if (a.includes("BRD")) tags.push("brd");
  if (a.includes("FILE") || a.includes("UPLOAD")) tags.push("upload");
  if (a.includes("TEAM")) tags.push("team");
  if (a.includes("ROLE")) tags.push("role-change");
  if (a.includes("FAIL") || a.includes("ERROR")) tags.push("failed");
  if (a.includes("DELETE")) tags.push("delete");
  if (a.includes("UPDATE") || a.includes("SETTING")) tags.push("update");
  if (tags.length === 0) tags.push("activity");
  return tags;
}

function mapUserLogToEntry(log: UserLog): LogEntry {
  const level = inferLevel(log.action);
  const service = inferService(log.action);
  const tags = inferTags(log.action);
  const userName = log.user
    ? `${log.user.firstName} ${log.user.lastName}`.trim()
    : `User #${log.userId}`;
  const message = log.details || log.action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: String(log.id),
    timestamp: log.createdAt,
    level,
    service,
    message,
    duration: "—",
    status: level === "error" ? "500" : level === "security" ? (log.action.toUpperCase().includes("FAIL") ? "401" : "200") : "200",
    tags,
    triggeredBy: userName,
    userId: log.userId,
    userDisplayId: log.user?.userId,
  };
}

// ─── SUPERADMIN SAMPLE DATA ───────────────────────────────────────────────────
// System-wide audit & security logs — every user action, security event, and
// config change across all services.

// ─── STYLE MAPS ───────────────────────────────────────────────────────────────

const levelStyles: Record<LogLevel, string> = {
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  error: "bg-red-500/10 text-red-600 dark:text-red-400",
  security: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  audit: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

const statusStyles: Record<string, string> = {
  "200": "text-green-600 dark:text-green-400",
  "201": "text-green-600 dark:text-green-400",
  "202": "text-green-600 dark:text-green-400",
  "401": "text-red-600 dark:text-red-400",
  "403": "text-red-600 dark:text-red-400",
  "422": "text-orange-600 dark:text-orange-400",
  "429": "text-yellow-600 dark:text-yellow-400",
  "500": "text-red-600 dark:text-red-400",
  "502": "text-red-600 dark:text-red-400",
  "503": "text-red-600 dark:text-red-400",
  warning: "text-yellow-600 dark:text-yellow-400",
};

// ─── LOG ROW ─────────────────────────────────────────────────────────────────

function LogRow({
  log,
  expanded,
  onToggle,
  isSuperAdmin,
}: {
  log: LogEntry;
  expanded: boolean;
  onToggle: () => void;
  isSuperAdmin: boolean;
}) {
  const formattedTime = new Date(log.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <>
      <motion.button
        onClick={onToggle}
        className="w-full p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800"
      >
        <div className="flex items-center gap-4 min-w-0">
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0"
          >
            <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          </motion.div>

          <Badge className={`flex-shrink-0 capitalize text-xs font-medium ${levelStyles[log.level]}`}>
            {log.level}
          </Badge>

          <time className="w-20 flex-shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
            {formattedTime}
          </time>

          <span className="flex-shrink-0 min-w-max text-sm font-medium text-slate-900 dark:text-slate-100">
            {log.service}
          </span>

          {log.triggeredBy && (
            <span className="hidden lg:block flex-shrink-0 text-xs text-slate-500 dark:text-slate-400 font-mono min-w-[140px]">
              {log.triggeredBy}
            </span>
          )}

          <p className="flex-1 truncate text-sm text-slate-500 dark:text-slate-400 min-w-0">
            {log.message}
          </p>

          <span
            className={`flex-shrink-0 font-mono text-sm font-semibold ${
              statusStyles[log.status] ?? "text-slate-500 dark:text-slate-400"
            }`}
          >
            {log.status}
          </span>

          <span className="w-16 flex-shrink-0 text-right font-mono text-xs text-slate-400 dark:text-slate-500">
            {log.duration}
          </span>
        </div>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40"
          >
            <div className="space-y-4 p-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Message
                </p>
                <p className="rounded-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-3 font-mono text-sm text-slate-900 dark:text-slate-100">
                  {log.message}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Duration
                  </p>
                  <p className="font-mono text-slate-900 dark:text-slate-100">{log.duration}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Timestamp
                  </p>
                  <p className="font-mono text-xs text-slate-900 dark:text-slate-100">
                    {log.timestamp}
                  </p>
                </div>

                {log.triggeredBy && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      User
                    </p>
                    <p className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {log.triggeredBy}
                    </p>
                  </div>
                )}

                {log.userDisplayId && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      User ID
                    </p>
                    <p className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {log.userDisplayId}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {log.tags.map((tag) => (
                    <Badge
                      key={tag}
                      className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── FILTER PANEL ─────────────────────────────────────────────────────────────

function FilterPanel({
  filters,
  onChange,
  logs,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  logs: LogEntry[];
}) {
  const levels = Array.from(new Set(logs.map((log) => log.level)));
  const services = Array.from(new Set(logs.map((log) => log.service)));
  const statuses = Array.from(new Set(logs.map((log) => log.status)));

  const toggleFilter = (category: keyof Filters, value: string) => {
    const current = filters[category];
    const updated = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    onChange({ ...filters, [category]: updated });
  };

  const clearAll = () => onChange({ level: [], service: [], status: [] });

  const hasActiveFilters = Object.values(filters).some((g) => g.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.05 }}
      className="flex h-full flex-col space-y-6 overflow-y-auto bg-white dark:bg-slate-900 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Filters</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>

      {(["level", "service", "status"] as const).map((category) => {
        const options = category === "level" ? levels : category === "service" ? services : statuses;
        return (
          <div key={category} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {category}
            </p>
            <div className="space-y-2">
              {options.map((value) => {
                const selected = filters[category].includes(value);
                return (
                  <motion.button
                    key={value}
                    type="button"
                    whileHover={{ x: 2 }}
                    onClick={() => toggleFilter(category, value)}
                    aria-pressed={selected}
                    className={`flex w-full items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "border-[#1a56f0] bg-[#1a56f0]/10 text-[#1a56f0] dark:text-blue-400"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-[#1a56f0]/40 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="capitalize">{value}</span>
                    {selected && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                  </motion.button>
                );
              })}
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface InteractiveLogsTableProps {
  /** Pass "SUPER_ADMIN" to show system-wide audit/security logs;
   *  "ADMIN" to show operational/team logs. */
  role: "SUPER_ADMIN" | "ADMIN";
}

export function InteractiveLogsTable({ role }: InteractiveLogsTableProps) {
  const isSuperAdmin = role === "SUPER_ADMIN";

  const PAGE_SIZE = 20;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    level: [],
    service: [],
    status: [],
  });

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await userLogsApi.getAll();
      setLogs(data.logs.map(mapUserLogToEntry));
    } catch (err) {
      setError("Failed to load logs. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const lowerQuery = searchQuery.toLowerCase();
      const matchSearch =
        log.message.toLowerCase().includes(lowerQuery) ||
        log.service.toLowerCase().includes(lowerQuery) ||
        (log.triggeredBy?.toLowerCase().includes(lowerQuery) ?? false);
      const matchLevel =
        filters.level.length === 0 || filters.level.includes(log.level);
      const matchService =
        filters.service.length === 0 || filters.service.includes(log.service);
      const matchStatus =
        filters.status.length === 0 || filters.status.includes(log.status);
      return matchSearch && matchLevel && matchService && matchStatus;
    });
  }, [logs, filters, searchQuery]);

  const activeFilters =
    filters.level.length + filters.service.length + filters.status.length;

  // Reset to page 1 whenever filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isSuperAdmin ? (
                <Shield className="h-4 w-4 text-purple-500" />
              ) : (
                <Activity className="h-4 w-4 text-blue-500" />
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {loading ? (
                  "Loading…"
                ) : (
                  <>
                    {filteredLogs.length} of {logs.length} entries
                    {isSuperAdmin && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                        System-wide audit
                      </span>
                    )}
                    {!isSuperAdmin && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                        Team logs
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={fetchLogs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by message, service, or user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a56f0] focus:border-transparent transition-all"
              />
            </div>
            <div className="relative">
              <Button
                variant={showFilters ? "primary" : "secondary"}
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter className="h-4 w-4" />
                {!showFilters && <span className="hidden sm:inline">Filters</span>}
                {showFilters && <span className="hidden sm:inline">Hide</span>}
              </Button>
              {activeFilters > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {activeFilters}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              key="filters"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-r border-slate-200 dark:border-slate-800 flex-shrink-0"
            >
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                logs={logs}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto">
          {/* Column headers */}
          <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 backdrop-blur">
            <span className="w-4 flex-shrink-0" />
            <span className="w-16 flex-shrink-0">Level</span>
            <span className="w-20 flex-shrink-0">Time</span>
            <span className="flex-shrink-0 min-w-[110px]">Service</span>
            <span className="hidden lg:block flex-shrink-0 min-w-[140px]">User</span>
            <span className="flex-1">Message</span>
            <span className="flex-shrink-0 w-12 text-right">Status</span>
            <span className="w-16 flex-shrink-0 text-right">Duration</span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <div className="flex items-center justify-center p-12">
                <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : error ? (
              <div className="p-12 text-center">
                <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
                <button
                  onClick={fetchLogs}
                  className="mt-3 text-xs text-[#1a56f0] hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {paginatedLogs.length > 0 ? (
                  paginatedLogs.map((log, index) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                    >
                      <LogRow
                        log={log}
                        expanded={expandedId === log.id}
                        onToggle={() =>
                          setExpandedId((cur) => (cur === log.id ? null : log.id))
                        }
                        isSuperAdmin={isSuperAdmin}
                      />
                    </motion.div>
                  ))
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-12 text-center"
                  >
                    <p className="text-sm text-slate-400 dark:text-slate-500">
                      No logs match your filters.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>

          {/* Pagination */}
          {!loading && !error && filteredLogs.length > 0 && (
            <div className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Showing{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {filteredLogs.length}
                </span>{" "}
                logs
              </p>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    if (totalPages <= 7) return true;
                    if (p === 1 || p === totalPages) return true;
                    return Math.abs(p - currentPage) <= 2;
                  })
                  .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && typeof arr[idx - 1] === "number" && (p as number) - (arr[idx - 1] as number) > 1) {
                      acc.push("...");
                    }
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "..." ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-400">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`h-7 min-w-[28px] px-2 rounded-md border text-xs font-medium transition-colors ${
                          currentPage === p
                            ? "border-[#1a56f0] bg-[#1a56f0] text-white"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        {p}
                      </button>
                    ),
                  )}

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
