"use client";
import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useBrds, useDashboard, useUserLogs } from "../../hooks";
import { formatTimeAgo } from "../../utils";
import { Role, TaskStatus } from "../../types";
import TetrisLoading from "../../components/ui/tetris-loader";

const THEME_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

.dash-root {
  font-family: 'IBM Plex Sans', sans-serif;
  --dash-accent:  #00b896;
  --dash-bg:      #f4f6f8;
  --dash-surface: #ffffff;
  --dash-border:  #e1e5ea;
  --dash-text:    #111827;
  --dash-muted:   #6b7280;
  --dash-dim:     #9ca3af;
  --dash-hover:   #f9fafb;
}
.dark .dash-root {
  --dash-bg:      #0d1117;
  --dash-surface: #161b22;
  --dash-border:  #21262d;
  --dash-text:    #e6edf3;
  --dash-muted:   #7d8590;
  --dash-dim:     #484f58;
  --dash-hover:   #1c2128;
}
.dash-root .font-mono { font-family: 'IBM Plex Mono', monospace; }

@keyframes dash-fade-up {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
}
.dash-fade   { animation: dash-fade-up 0.3s ease both; }
.dash-fade-1 { animation-delay: 0.04s; }
.dash-fade-2 { animation-delay: 0.09s; }
.dash-fade-3 { animation-delay: 0.14s; }
`;

const STATUS_HEX: Record<string, string> = {
  DRAFT:       "#6b7280",
  IN_REVIEW:   "#3b82f6",
  APPROVED:    "#22c55e",
  ARCHIVED:    "#a855f7",
  PAUSED:      "#f59e0b",
  COMPLETED:   "#22c55e",
  ON_HOLD:     "#ef4444",
  PENDING:     "#f59e0b",
  IN_PROGRESS: "#3b82f6",
  SYSTEM:      "#6b7280",
};

const ROLE_HEX: Record<string, string> = {
  SUPER_ADMIN: "#ef4444",
  ADMIN:       "#f59e0b",
  USER:        "#22c55e",
};

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide whitespace-nowrap"
      style={{ background: color + "26", color, border: `1px solid ${color}33` }}
    >
      {label}
    </span>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg overflow-hidden ${className}`}
      style={{ background: "var(--dash-surface)", border: "1px solid var(--dash-border)" }}
    >
      {children}
    </div>
  );
}

function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div
      className="flex items-start justify-between px-5 py-4"
      style={{ borderBottom: "1px solid var(--dash-border)" }}
    >
      <div>
        <p className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--dash-text)" }}>{title}</p>
        {sub && <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--dash-muted)" }}>{sub}</p>}
      </div>
      {action && <div className="ml-4 flex-shrink-0 flex items-center gap-1">{action}</div>}
    </div>
  );
}

function NavBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-6 h-6 flex items-center justify-center font-mono text-xs rounded transition-colors"
      style={{ color: disabled ? "var(--dash-dim)" : "var(--dash-muted)", cursor: disabled ? "not-allowed" : "pointer" }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.color = "var(--dash-text)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = disabled ? "var(--dash-dim)" : "var(--dash-muted)"; }}
    >{children}</button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] font-mono px-3 py-1.5 rounded transition-all"
      style={{ color: "var(--dash-muted)", border: "1px solid var(--dash-border)", background: "transparent" }}
      onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = "var(--dash-accent)"; b.style.borderColor = "var(--dash-accent)"; }}
      onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = "var(--dash-muted)"; b.style.borderColor = "var(--dash-border)"; }}
    >{children}</button>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className="flex flex-col justify-between p-5 rounded-lg transition-colors duration-200"
      style={{ background: "var(--dash-surface)", border: "1px solid var(--dash-border)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = accent ? "var(--dash-accent)" : "var(--dash-muted)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--dash-border)"; }}
    >
      <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-muted)" }}>{label}</p>
      <p className="mt-3 text-3xl font-mono font-semibold tabular-nums" style={{ color: accent ? "var(--dash-accent)" : "var(--dash-text)" }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function BarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <p className="w-28 text-[11px] font-mono truncate flex-shrink-0 capitalize" style={{ color: "var(--dash-muted)" }}>
        {label.replace(/_/g, " ")}
      </p>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--dash-border)" }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-8 text-right text-[11px] font-mono tabular-nums" style={{ color: "var(--dash-text)" }}>{count}</span>
    </div>
  );
}

type ActivityItem = { id: string; at: string; title: string; description: string; tag: string };
const PAGE_SIZE = 8;

export default function DashboardPage() {
  const { user } = useAuth();
  const { stats, isLoading, refetch } = useDashboard();
  const { brds, isLoading: brdLoading, refetch: refetchBrds } = useBrds();
  const { logs, isLoading: logsLoading, refetch: refetchLogs } = useUserLogs(
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" ? "all" : "mine",
  );
  const [page, setPage] = React.useState(1);
  const allBusy = isLoading || brdLoading || logsLoading;

  const activity: ActivityItem[] = React.useMemo(() => {
    const fromLogs: ActivityItem[] = logs.map((l) => ({
      id: `log-${l.id}`, at: l.createdAt,
      title: l.action.replace(/_/g, " "),
      description: `${l.user?.firstName ?? ""} ${l.user?.lastName ?? ""}`.trim() || l.details || "—",
      tag: "SYSTEM",
    }));
    const fromFiles: ActivityItem[] = (stats?.recentActivity ?? []).map((f) => ({
      id: `file-${f.id}`, at: f.uploadedAt,
      title: "FILE UPLOADED",
      description: `${f.uploadedBy?.firstName ?? ""} ${f.uploadedBy?.lastName ?? ""} · ${f.originalName}`,
      tag: f.status,
    }));
    return [...fromLogs, ...fromFiles]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 100);
  }, [logs, stats?.recentActivity]);

  const totalPages = Math.max(1, Math.ceil(activity.length / PAGE_SIZE));
  React.useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const paged = activity.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalUsers = stats?.usersByRole?.reduce((a, b) => a + b.count, 0) ?? 0;
  const totalTasks = (stats?.tasksByStatus ?? []).reduce((a, b) => a + b.count, 0);

  if (allBusy) {
    return (
      <div className="dash-root flex items-center justify-center h-full min-h-[400px]" style={{ background: "var(--dash-bg)" }}>
        <style>{THEME_STYLE}</style>
        <div className="text-center space-y-3">
          <TetrisLoading size="sm" speed="fast" loadingText="" />
          <p className="text-[11px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-muted)" }}>Initialising</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-root min-h-full" style={{ background: "var(--dash-bg)" }}>
      <style>{THEME_STYLE}</style>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {/* Header */}
        <div className="dash-fade flex items-end justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: "var(--dash-muted)" }}>Overview</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight" style={{ color: "var(--dash-text)" }}>
              {user?.firstName ? `${user.firstName}'s workspace` : "Workspace"}
            </h1>
          </div>
          <GhostBtn onClick={() => { refetch(); refetchBrds(); refetchLogs(); }}>↻ Refresh</GhostBtn>
        </div>

        {/* Stats */}
        <div className="dash-fade dash-fade-1 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label="Users"       value={stats?.totalUsers ?? 0} />
          <StatCard label="Documents"   value={stats?.totalFiles ?? 0} />
          <StatCard label="BRD Sources" value={stats?.totalBrds ?? brds.length} accent />
          <StatCard label="Pending"     value={stats?.pendingValidation ?? 0} />
          <StatCard label="Tasks"       value={stats?.totalTasks ?? 0} />
          <StatCard label="Uploads 7d"  value={stats?.recentUploads7d ?? 0} />
        </div>

        {/* Row 2 */}
        <div className="dash-fade dash-fade-2 grid grid-cols-1 xl:grid-cols-12 gap-4">

          {/* Activity — 7 cols */}
          <Panel className="xl:col-span-7">
            <SectionHead
              title="Activity Feed"
              sub={`${activity.length} events`}
              action={
                <>
                  <span className="text-[10px] font-mono mr-1" style={{ color: "var(--dash-dim)" }}>
                    {activity.length === 0 ? "0" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, activity.length)}`} / {activity.length}
                  </span>
                  <NavBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</NavBtn>
                  <NavBtn disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>→</NavBtn>
                </>
              }
            />
            {/* Col headers */}
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 px-5 py-2" style={{ borderBottom: "1px solid var(--dash-border)" }}>
              <span className="w-3" />
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-dim)" }}>Event</p>
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-dim)" }}>Tag</p>
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-dim)" }}>When</p>
            </div>
            {paged.length === 0 ? (
              <p className="px-5 py-10 text-center text-[11px] font-mono" style={{ color: "var(--dash-dim)" }}>No activity yet</p>
            ) : (
              paged.map((item, i) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-5 py-3 transition-colors duration-100"
                  style={{ borderTop: i !== 0 ? "1px solid var(--dash-border)" : undefined }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--dash-hover)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                >
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--dash-accent)", opacity: 0.7 }} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-mono font-medium uppercase tracking-wide truncate" style={{ color: "var(--dash-text)" }}>{item.title}</p>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--dash-muted)" }}>{item.description}</p>
                  </div>
                  <Pill label={item.tag} color={STATUS_HEX[item.tag] ?? "#6b7280"} />
                  <span className="text-[10px] font-mono tabular-nums flex-shrink-0" style={{ color: "var(--dash-dim)" }}>{formatTimeAgo(item.at)}</span>
                </div>
              ))
            )}
          </Panel>

          {/* Right stack — 5 cols */}
          <div className="xl:col-span-5 flex flex-col gap-4">
            <Panel>
              <SectionHead title="Users by Role" sub={`${totalUsers} total`} />
              <div className="px-5 py-3">
                {!stats?.usersByRole?.length
                  ? <p className="py-4 text-center text-[11px] font-mono" style={{ color: "var(--dash-dim)" }}>No users</p>
                  : stats.usersByRole.map((item) => (
                      <BarRow key={item.role} label={item.role} count={item.count} total={totalUsers} color={ROLE_HEX[item.role as Role] ?? "#6b7280"} />
                    ))
                }
              </div>
            </Panel>
            <Panel>
              <SectionHead title="Tasks" sub={`${totalTasks} total`} />
              <div className="px-5 py-3">
                {(stats?.tasksByStatus ?? []).length === 0
                  ? <p className="py-4 text-center text-[11px] font-mono" style={{ color: "var(--dash-dim)" }}>No tasks</p>
                  : (stats?.tasksByStatus ?? []).map((item) => (
                      <BarRow key={item.status} label={item.status} count={item.count} total={totalTasks} color={STATUS_HEX[item.status] ?? "#6b7280"} />
                    ))
                }
              </div>
            </Panel>
          </div>
        </div>

        {/* Row 3 */}
        <div className="dash-fade dash-fade-3 grid grid-cols-1 xl:grid-cols-12 gap-4">

          {/* Pipeline — 3 cols */}
          <Panel className="xl:col-span-3">
            <SectionHead title="Pipeline" sub="File status" />
            <div className="px-5 py-2">
              {(stats?.filesByStatus ?? []).length === 0
                ? <p className="py-4 text-center text-[11px] font-mono" style={{ color: "var(--dash-dim)" }}>No files</p>
                : (stats?.filesByStatus ?? []).map((item, i, arr) => (
                    <div key={item.status} className="flex items-center justify-between py-2.5"
                      style={{ borderBottom: i !== arr.length - 1 ? "1px solid var(--dash-border)" : undefined }}>
                      <span className="text-[11px] font-mono" style={{ color: "var(--dash-muted)" }}>{item.status}</span>
                      <Pill label={String(item.count)} color={STATUS_HEX[item.status as TaskStatus] ?? "#6b7280"} />
                    </div>
                  ))
              }
            </div>
          </Panel>

          {/* BRD status — 3 cols */}
          <Panel className="xl:col-span-3">
            <SectionHead title="BRD Status" sub="Document states" />
            <div className="px-5 py-2">
              {(stats?.brdsByStatus ?? []).length === 0
                ? <p className="py-4 text-center text-[11px] font-mono" style={{ color: "var(--dash-dim)" }}>No BRDs</p>
                : (stats?.brdsByStatus ?? []).map((item, i, arr) => (
                    <div key={item.status} className="flex items-center justify-between py-2.5"
                      style={{ borderBottom: i !== arr.length - 1 ? "1px solid var(--dash-border)" : undefined }}>
                      <span className="text-[11px] font-mono" style={{ color: "var(--dash-muted)" }}>{item.status}</span>
                      <Pill label={String(item.count)} color={STATUS_HEX[item.status] ?? "#6b7280"} />
                    </div>
                  ))
              }
            </div>
          </Panel>

          {/* BRD sources table — 6 cols */}
          <Panel className="xl:col-span-6">
            <SectionHead title="BRD Sources" sub={`${brds.length} sources`} />
            {brds.length === 0
              ? <p className="px-5 py-10 text-center text-[11px] font-mono" style={{ color: "var(--dash-dim)" }}>No BRD sources yet</p>
              : (
                <>
                  <div className="grid grid-cols-[1fr_48px_80px] px-5 py-2" style={{ borderBottom: "1px solid var(--dash-border)" }}>
                    <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-dim)" }}>Source</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--dash-dim)" }}>Fmt</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-right" style={{ color: "var(--dash-dim)" }}>Status</p>
                  </div>
                  {brds.slice(0, 8).map((src, i) => (
                    <div
                      key={src.id}
                      className="grid grid-cols-[1fr_48px_80px] items-center gap-2 px-5 py-3 transition-colors duration-100"
                      style={{ borderTop: i !== 0 ? "1px solid var(--dash-border)" : undefined }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--dash-hover)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                    >
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium truncate" style={{ color: "var(--dash-text)" }}>{src.title}</p>
                        <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: "var(--dash-dim)" }}>
                          {src.geography || "—"} · {src.lastUpdated}
                        </p>
                      </div>
                      <span className="text-[10px] font-mono uppercase" style={{ color: "var(--dash-muted)" }}>{src.format}</span>
                      <div className="flex justify-end">
                        <Pill label={src.status} color={STATUS_HEX[src.status] ?? "#6b7280"} />
                      </div>
                    </div>
                  ))}
                  {brds.length > 8 && (
                    <div className="px-5 py-3" style={{ borderTop: "1px solid var(--dash-border)" }}>
                      <p className="text-[10px] font-mono" style={{ color: "var(--dash-dim)" }}>+{brds.length - 8} more sources</p>
                    </div>
                  )}
                </>
              )
            }
          </Panel>
        </div>

      </div>
    </div>
  );
}