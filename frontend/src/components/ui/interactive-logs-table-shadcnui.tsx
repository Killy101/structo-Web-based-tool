"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Filter, Search, Shield, Activity } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "./index";
import { Button } from "./index";

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
  /** Only present in superadmin logs */
  triggeredBy?: string;
  /** Only present in superadmin logs */
  ip?: string;
}

type Filters = {
  level: string[];
  service: string[];
  status: string[];
};

// ─── SUPERADMIN SAMPLE DATA ───────────────────────────────────────────────────
// System-wide audit & security logs — every user action, security event, and
// config change across all services.

const SUPERADMIN_LOGS: LogEntry[] = [
  {
    id: "sa-1",
    timestamp: "2024-11-08T14:32:45Z",
    level: "security",
    service: "auth-service",
    message: "Failed login attempt — invalid credentials",
    duration: "82ms",
    status: "401",
    tags: ["security", "login", "failed"],
    triggeredBy: "unknown",
    ip: "192.168.4.23",
  },
  {
    id: "sa-2",
    timestamp: "2024-11-08T14:31:10Z",
    level: "audit",
    service: "admin-panel",
    message: "Role changed: user john.doe@idaf.org promoted to ADMIN",
    duration: "145ms",
    status: "200",
    tags: ["role-change", "audit", "user-management"],
    triggeredBy: "superadmin@idaf.org",
    ip: "10.0.0.5",
  },
  {
    id: "sa-3",
    timestamp: "2024-11-08T14:30:00Z",
    level: "audit",
    service: "admin-panel",
    message: "Security policy updated — min password length changed to 12",
    duration: "210ms",
    status: "200",
    tags: ["settings", "security-policy", "audit"],
    triggeredBy: "superadmin@idaf.org",
    ip: "10.0.0.5",
  },
  {
    id: "sa-4",
    timestamp: "2024-11-08T14:28:55Z",
    level: "error",
    service: "database",
    message: "Connection timeout to replica node — failover triggered",
    duration: "5.1s",
    status: "503",
    tags: ["db", "error", "failover"],
    triggeredBy: "system",
    ip: "internal",
  },
  {
    id: "sa-5",
    timestamp: "2024-11-08T14:27:30Z",
    level: "security",
    service: "auth-service",
    message: "MFA bypass attempted on admin account",
    duration: "55ms",
    status: "403",
    tags: ["mfa", "security", "blocked"],
    triggeredBy: "unknown",
    ip: "203.0.113.47",
  },
  {
    id: "sa-6",
    timestamp: "2024-11-08T14:26:10Z",
    level: "warning",
    service: "api-gateway",
    message: "Rate limit threshold reached for tenant: idaf-org",
    duration: "145ms",
    status: "429",
    tags: ["rate-limit", "warning", "api"],
    triggeredBy: "system",
    ip: "internal",
  },
  {
    id: "sa-7",
    timestamp: "2024-11-08T14:25:00Z",
    level: "audit",
    service: "admin-panel",
    message: "Maintenance mode enabled by superadmin",
    duration: "190ms",
    status: "200",
    tags: ["maintenance", "audit", "ops"],
    triggeredBy: "superadmin@idaf.org",
    ip: "10.0.0.5",
  },
  {
    id: "sa-8",
    timestamp: "2024-11-08T14:23:45Z",
    level: "info",
    service: "payment-service",
    message: "Payment gateway health check passed",
    duration: "320ms",
    status: "200",
    tags: ["payment", "health"],
    triggeredBy: "system",
    ip: "internal",
  },
  {
    id: "sa-9",
    timestamp: "2024-11-08T14:22:00Z",
    level: "audit",
    service: "admin-panel",
    message: "User account deactivated: contractor.temp@external.com",
    duration: "165ms",
    status: "200",
    tags: ["user-deactivation", "audit"],
    triggeredBy: "admin@idaf.org",
    ip: "10.0.0.12",
  },
  {
    id: "sa-10",
    timestamp: "2024-11-08T14:20:30Z",
    level: "error",
    service: "cache-service",
    message: "Redis cluster node unreachable — cache degraded",
    duration: "2.8s",
    status: "500",
    tags: ["cache", "redis", "error"],
    triggeredBy: "system",
    ip: "internal",
  },
];

// ─── ADMIN SAMPLE DATA ────────────────────────────────────────────────────────
// Operational logs — document processing, task management, and team activity
// scoped to the admin's own team and features.

const ADMIN_LOGS: LogEntry[] = [
  {
    id: "adm-1",
    timestamp: "2024-11-08T14:32:45Z",
    level: "info",
    service: "brd-processor",
    message: "BRD document uploaded and queued for processing",
    duration: "245ms",
    status: "201",
    tags: ["brd", "upload"],
  },
  {
    id: "adm-2",
    timestamp: "2024-11-08T14:31:20Z",
    level: "info",
    service: "compare-engine",
    message: "PDF vs XML comparison completed — 14 differences found",
    duration: "3.4s",
    status: "200",
    tags: ["compare", "pdf", "xml"],
  },
  {
    id: "adm-3",
    timestamp: "2024-11-08T14:29:55Z",
    level: "warning",
    service: "brd-processor",
    message: "BRD processing slow — large document detected (42 MB)",
    duration: "12.1s",
    status: "warning",
    tags: ["brd", "performance"],
  },
  {
    id: "adm-4",
    timestamp: "2024-11-08T14:28:10Z",
    level: "info",
    service: "task-manager",
    message: "Task assigned to user: jane.smith@idaf.org",
    duration: "98ms",
    status: "201",
    tags: ["task", "assignment"],
  },
  {
    id: "adm-5",
    timestamp: "2024-11-08T14:26:40Z",
    level: "error",
    service: "document-store",
    message: "File upload failed — unsupported format (.docm)",
    duration: "310ms",
    status: "422",
    tags: ["upload", "validation", "error"],
  },
  {
    id: "adm-6",
    timestamp: "2024-11-08T14:25:15Z",
    level: "info",
    service: "compare-engine",
    message: "AutoCompare job started for project: IDAF-BRD-2024-Q4",
    duration: "560ms",
    status: "202",
    tags: ["autocompare", "job"],
  },
  {
    id: "adm-7",
    timestamp: "2024-11-08T14:23:50Z",
    level: "info",
    service: "task-manager",
    message: "Task status updated to APPROVED by reviewer",
    duration: "114ms",
    status: "200",
    tags: ["task", "approved"],
  },
  {
    id: "adm-8",
    timestamp: "2024-11-08T14:22:05Z",
    level: "warning",
    service: "brd-processor",
    message: "Citation extraction incomplete — 3 references could not be resolved",
    duration: "870ms",
    status: "warning",
    tags: ["brd", "citation", "warning"],
  },
];

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

          {isSuperAdmin && log.triggeredBy && (
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

                {isSuperAdmin && log.triggeredBy && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Triggered By
                    </p>
                    <p className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {log.triggeredBy}
                    </p>
                  </div>
                )}

                {isSuperAdmin && log.ip && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      IP Address
                    </p>
                    <p className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {log.ip}
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
  const SOURCE_LOGS = isSuperAdmin ? SUPERADMIN_LOGS : ADMIN_LOGS;

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    level: [],
    service: [],
    status: [],
  });

  const filteredLogs = useMemo(() => {
    return SOURCE_LOGS.filter((log) => {
      const lowerQuery = searchQuery.toLowerCase();
      const matchSearch =
        log.message.toLowerCase().includes(lowerQuery) ||
        log.service.toLowerCase().includes(lowerQuery) ||
        (isSuperAdmin && log.triggeredBy?.toLowerCase().includes(lowerQuery));
      const matchLevel =
        filters.level.length === 0 || filters.level.includes(log.level);
      const matchService =
        filters.service.length === 0 || filters.service.includes(log.service);
      const matchStatus =
        filters.status.length === 0 || filters.status.includes(log.status);
      return matchSearch && matchLevel && matchService && matchStatus;
    });
  }, [SOURCE_LOGS, filters, searchQuery, isSuperAdmin]);

  const activeFilters =
    filters.level.length + filters.service.length + filters.status.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {isSuperAdmin ? (
              <Shield className="h-4 w-4 text-purple-500" />
            ) : (
              <Activity className="h-4 w-4 text-blue-500" />
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {filteredLogs.length} of {SOURCE_LOGS.length} entries
              {isSuperAdmin && (
                <span className="ml-2 inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  System-wide audit
                </span>
              )}
              {!isSuperAdmin && (
                <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                  Operational
                </span>
              )}
            </p>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={
                  isSuperAdmin
                    ? "Search by message, service, or user..."
                    : "Search by message or service..."
                }
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
                logs={SOURCE_LOGS}
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
            {isSuperAdmin && (
              <span className="hidden lg:block flex-shrink-0 min-w-[140px]">Triggered By</span>
            )}
            <span className="flex-1">Message</span>
            <span className="flex-shrink-0 w-12 text-right">Status</span>
            <span className="w-16 flex-shrink-0 text-right">Duration</span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <AnimatePresence mode="popLayout">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log, index) => (
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
          </div>
        </div>
      </div>
    </div>
  );
}
