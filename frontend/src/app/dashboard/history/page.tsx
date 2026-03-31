"use client";
import { useState, useMemo, useCallback } from "react";
import { useUserLogs } from "../../../hooks";
import { useAuth } from "../../../context/AuthContext";
import { useTheme } from "../../../context/ThemContext";
import { formatTimeAgo } from "../../../utils";
import { UserLog } from "../../../types";

const PAGE_SIZE = 20;

const ACTION_META: Record<string, { color: string; bg: string; darkBg: string; label: string }> = {
  LOGIN:    { color: "#22c55e", bg: "#dcfce7", darkBg: "rgba(34,197,94,.15)",  label: "Login" },
  LOGOUT:   { color: "#64748b", bg: "#f1f5f9", darkBg: "rgba(100,116,139,.15)", label: "Logout" },
  CREATE:   { color: "#60a5fa", bg: "#dbeafe", darkBg: "rgba(96,165,250,.15)", label: "Create" },
  UPDATE:   { color: "#f59e0b", bg: "#fef3c7", darkBg: "rgba(245,158,11,.15)", label: "Update" },
  DELETE:   { color: "#f87171", bg: "#fee2e2", darkBg: "rgba(248,113,113,.15)", label: "Delete" },
  UPLOAD:   { color: "#a78bfa", bg: "#ede9fe", darkBg: "rgba(167,139,250,.15)", label: "Upload" },
  COMPARE:  { color: "#1a8fd1", bg: "#dbeafe", darkBg: "rgba(26,143,209,.15)", label: "Compare" },
  PROCESS:  { color: "#d4862e", bg: "#fef3c7", darkBg: "rgba(212,134,46,.15)", label: "Process" },
  EXPORT:   { color: "#10b981", bg: "#dcfce7", darkBg: "rgba(16,185,129,.15)", label: "Export" },
  ASSIGN:   { color: "#ec4899", bg: "#fce7f3", darkBg: "rgba(236,72,153,.15)", label: "Assign" },
};

function getActionMeta(action: string, dark: boolean) {
  const key = Object.keys(ACTION_META).find(k => action.toUpperCase().includes(k));
  const m = key ? ACTION_META[key] : ACTION_META.CREATE;
  return { ...m, bgUsed: dark ? m.darkBg : m.bg, label: key ? m.label : action };
}

function getUserLabel(log: UserLog) {
  if (log.user?.firstName && log.user?.lastName) return `${log.user.firstName} ${log.user.lastName}`;
  return log.user?.userId ?? `#${log.userId}`;
}

function exportCSV(logs: UserLog[]) {
  const headers = ["ID", "Timestamp", "User", "User ID", "Role", "Action", "Details"];
  const rows = logs.map(l => [
    l.id,
    new Date(l.createdAt).toISOString(),
    getUserLabel(l),
    l.user?.userId ?? l.userId,
    l.user?.role ?? "",
    l.action,
    (l.details ?? "").replace(/,/g, ";"),
  ]);
  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `structo-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const DATE_FILTERS = ["All time", "Today", "Last 7 days", "Last 30 days"] as const;
type DateFilter = (typeof DATE_FILTERS)[number];

function filterByDate(log: UserLog, range: DateFilter): boolean {
  if (range === "All time") return true;
  const now = Date.now();
  const ts = new Date(log.createdAt).getTime();
  if (range === "Today") return ts > now - 86_400_000;
  if (range === "Last 7 days") return ts > now - 7 * 86_400_000;
  return ts > now - 30 * 86_400_000;
}

export default function HistoryPage() {
  const { user } = useAuth();
  const { dark } = useTheme();
  const scope = user?.role === "USER" ? "mine" : "all";
  const { logs, isLoading, error, refetch } = useUserLogs(scope);

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("All");
  const [dateFilter, setDateFilter] = useState<DateFilter>("All time");
  const [page, setPage] = useState(1);

  const actionOptions = useMemo(() => {
    const acts = Array.from(new Set(logs.map(l => {
      const k = Object.keys(ACTION_META).find(k => l.action.toUpperCase().includes(k));
      return k ?? l.action;
    })));
    return ["All", ...acts.sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (!filterByDate(l, dateFilter)) return false;
      if (actionFilter !== "All") {
        const k = Object.keys(ACTION_META).find(k => l.action.toUpperCase().includes(k));
        if ((k ?? l.action) !== actionFilter) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          l.action.toLowerCase().includes(q) ||
          (l.details ?? "").toLowerCase().includes(q) ||
          getUserLabel(l).toLowerCase().includes(q) ||
          (l.user?.userId ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, dateFilter, actionFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = useCallback((v: string) => { setSearch(v); setPage(1); }, []);
  const handleAction = useCallback((v: string) => { setActionFilter(v); setPage(1); }, []);
  const handleDate   = useCallback((v: DateFilter) => { setDateFilter(v); setPage(1); }, []);

  // Theme tokens
  const bg      = dark ? "#07101f" : "#f8fafc";
  const card    = dark ? "#0f1a2f" : "#ffffff";
  const bdr     = dark ? "rgba(26,143,209,0.12)" : "rgba(100,116,139,0.2)";
  const txt     = dark ? "#e2e8f0" : "#0f172a";
  const sub     = dark ? "#64748b" : "#94a3b8";
  const inputBg = dark ? "rgba(6,13,26,0.6)" : "#f1f5f9";
  const row     = dark ? "rgba(26,143,209,0.04)" : "#f8fafc";

  return (
    <div style={{ padding: "24px 28px", minHeight: "100%", background: bg, fontFamily: "'DM Sans', sans-serif" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: txt, fontFamily: "'Syne', sans-serif", letterSpacing: "-0.3px" }}>
            Audit Trail
          </h2>
          <p style={{ fontSize: 13, color: sub, marginTop: 2 }}>
            {scope === "all" ? "All user activity" : "Your activity"} · {filtered.length} records
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => refetch()}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: "transparent", border: `1px solid ${bdr}`, color: sub,
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh
          </button>
          <button
            onClick={() => exportCSV(filtered)}
            disabled={filtered.length === 0}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: "linear-gradient(135deg, #1a8fd1, #146da3)",
              border: "none", color: "#fff", cursor: filtered.length === 0 ? "not-allowed" : "pointer",
              opacity: filtered.length === 0 ? 0.5 : 1,
              boxShadow: "0 4px 12px rgba(26,143,209,0.25)",
              transition: "all 0.2s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: card, border: `1px solid ${bdr}`,
          borderRadius: 14, padding: "16px 20px",
          display: "flex", gap: 12, flexWrap: "wrap",
          alignItems: "center", marginBottom: 16,
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sub}
            strokeWidth="2" strokeLinecap="round"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search by user, action, details…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            style={{
              width: "100%", padding: "8px 10px 8px 32px",
              background: inputBg, border: `1px solid ${bdr}`, borderRadius: 9,
              fontSize: 13, color: txt, outline: "none",
              fontFamily: "'DM Sans', sans-serif",
            }}
          />
        </div>

        {/* Date filter */}
        <select
          value={dateFilter}
          onChange={e => handleDate(e.target.value as DateFilter)}
          style={{
            padding: "8px 28px 8px 10px", background: inputBg,
            border: `1px solid ${bdr}`, borderRadius: 9, fontSize: 13,
            color: txt, outline: "none", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", minWidth: 120,
            appearance: "none",
          }}
        >
          {DATE_FILTERS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Action filter pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {actionOptions.slice(0, 8).map(opt => (
            <button
              key={opt}
              onClick={() => handleAction(opt)}
              style={{
                padding: "5px 12px", borderRadius: 100, fontSize: 11, fontWeight: 600,
                cursor: "pointer", border: "1px solid",
                transition: "all 0.15s",
                background: actionFilter === opt
                  ? (opt !== "All" ? `${ACTION_META[opt]?.color ?? "#1a8fd1"}18` : "rgba(26,143,209,0.12)")
                  : "transparent",
                borderColor: actionFilter === opt
                  ? (opt !== "All" ? `${ACTION_META[opt]?.color ?? "#1a8fd1"}40` : "rgba(26,143,209,0.3)")
                  : bdr,
                color: actionFilter === opt
                  ? (opt !== "All" ? (ACTION_META[opt]?.color ?? "#1a8fd1") : "#42b4f5")
                  : sub,
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: 14, overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: sub, fontSize: 13 }}>
            Loading audit trail…
          </div>
        ) : error ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "#f87171", fontSize: 13 }}>
            Error loading logs. {error}
          </div>
        ) : paginated.length === 0 ? (
          <div style={{ padding: "56px 24px", textAlign: "center" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={sub} strokeWidth="1.4" strokeLinecap="round" style={{ margin: "0 auto 12px", display: "block" }}>
              <path d="M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v10a2 2 0 01-2 2h-4"/>
              <circle cx="9" cy="21" r="2"/><circle cx="19" cy="21" r="2"/>
            </svg>
            <p style={{ color: sub, fontSize: 14 }}>No records match your filters.</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.4fr 1fr 2.5fr 80px",
              padding: "10px 20px",
              borderBottom: `1px solid ${bdr}`,
              gap: 12,
            }}>
              {["Timestamp", "User", "Action", "Details", ""].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, color: sub, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            {paginated.map((log, i) => {
              const meta = getActionMeta(log.action, dark);
              return (
                <div
                  key={log.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1.4fr 1fr 2.5fr 80px",
                    padding: "12px 20px",
                    gap: 12,
                    alignItems: "center",
                    borderBottom: i < paginated.length - 1 ? `1px solid ${bdr}` : "none",
                    transition: "background 0.12s",
                    cursor: "default",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = row)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div>
                    <div style={{ fontSize: 12, color: txt, fontWeight: 500 }}>
                      {new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <div style={{ fontSize: 11, color: sub, marginTop: 1 }}>
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: "linear-gradient(135deg, #1a8fd1, #d4862e)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: "#fff",
                    }}>
                      {getUserLabel(log).slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ fontSize: 12, color: txt, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getUserLabel(log)}
                      </div>
                      <div style={{ fontSize: 10, color: sub }}>
                        {log.user?.role ?? ""}
                      </div>
                    </div>
                  </div>

                  <div>
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "2px 8px", borderRadius: 6,
                      fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em",
                      background: meta.bgUsed, color: meta.color,
                    }}>
                      {meta.label}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.details ?? <span style={{ color: dark ? "#334155" : "#cbd5e1", fontStyle: "italic" }}>—</span>}
                  </div>

                  <div style={{ fontSize: 11, color: sub, textAlign: "right" }}>
                    {formatTimeAgo(log.createdAt)}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: sub }}>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { label: "←", action: () => setPage(p => Math.max(1, p - 1)), disabled: page === 1 },
              ...Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = totalPages <= 7 ? i + 1 : (page <= 4 ? i + 1 : page - 3 + i);
                return { label: String(p), action: () => setPage(p), disabled: false, current: p === page };
              }),
              { label: "→", action: () => setPage(p => Math.min(totalPages, p + 1)), disabled: page === totalPages },
            ].map((btn, i) => (
              <button
                key={i}
                onClick={btn.action}
                disabled={btn.disabled}
                style={{
                  width: 32, height: 32, borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${(btn as { current?: boolean }).current ? "rgba(26,143,209,0.4)" : bdr}`,
                  background: (btn as { current?: boolean }).current ? "rgba(26,143,209,0.12)" : "transparent",
                  color: (btn as { current?: boolean }).current ? "#42b4f5" : (btn.disabled ? "rgba(100,116,139,0.3)" : sub),
                  cursor: btn.disabled ? "not-allowed" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
