"use client";
import { useState, useEffect, useCallback } from "react";
import { userLogsApi } from "../../services/api";
import { UserLog } from "../../types";
import { formatTimeAgo } from "../../utils";

const ACTION_COLORS: Record<string, { dot: string; label: string }> = {
  LOGIN:           { dot: "#22c55e", label: "Login" },
  LOGOUT:          { dot: "#64748b", label: "Logout" },
  CREATE:          { dot: "#60a5fa", label: "Created" },
  UPDATE:          { dot: "#f59e0b", label: "Updated" },
  DELETE:          { dot: "#f87171", label: "Deleted" },
  UPLOAD:          { dot: "#a78bfa", label: "Upload" },
  COMPARE:         { dot: "#1a8fd1", label: "Compare" },
  PROCESS:         { dot: "#d4862e", label: "Process" },
  EXPORT:          { dot: "#10b981", label: "Export" },
};

function getActionMeta(action: string) {
  const key = Object.keys(ACTION_COLORS).find(k => action.toUpperCase().includes(k));
  return key ? ACTION_COLORS[key] : { dot: "#64748b", label: action };
}

function getUserLabel(log: UserLog) {
  if (log.user?.firstName && log.user?.lastName) {
    return `${log.user.firstName} ${log.user.lastName}`;
  }
  return log.user?.userId ?? `User #${log.userId}`;
}

interface ActivityFeedProps {
  open: boolean;
  onClose: () => void;
  dark: boolean;
}

export default function ActivityFeed({ open, onClose, dark }: ActivityFeedProps) {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { logs } = await userLogsApi.getAll();
      setLogs(logs.slice(0, 30));
      setLastUpdated(new Date());
    } catch {
      // fallback: try own logs
      try {
        const { logs } = await userLogsApi.getMine();
        setLogs(logs.slice(0, 30));
        setLastUpdated(new Date());
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetch();
    }, 30_000);
    return () => clearInterval(id);
  }, [open, fetch]);

  const bg    = dark ? "#0b1a2e" : "#ffffff";
  const bdr   = dark ? "rgba(26,143,209,0.15)" : "rgba(100,116,139,0.2)";
  const txt   = dark ? "#e2e8f0" : "#0f172a";
  const sub   = dark ? "#64748b" : "#94a3b8";
  const hover = dark ? "rgba(26,143,209,0.06)" : "#f8fafc";

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 340,
          background: bg,
          borderLeft: `1px solid ${bdr}`,
          boxShadow: "-20px 0 60px rgba(0,0,0,0.35)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${bdr}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 8px rgba(34,197,94,0.5)",
              animation: "pulse 2s infinite",
            }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: txt }}>Live Activity</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastUpdated && (
              <span style={{ fontSize: 11, color: sub }}>
                {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetch}
              disabled={loading}
              title="Refresh"
              style={{
                background: "none",
                border: "none",
                color: sub,
                cursor: "pointer",
                padding: 4,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                opacity: loading ? 0.5 : 1,
                transition: "opacity 0.2s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: sub,
                cursor: "pointer",
                padding: 4,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Feed */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading && logs.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: sub, fontSize: 13 }}>
              Loading activity…
            </div>
          ) : logs.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: sub, fontSize: 13 }}>
              No activity recorded yet.
            </div>
          ) : (
            logs.map((log, i) => {
              const meta = getActionMeta(log.action);
              return (
                <div
                  key={log.id}
                  style={{
                    padding: "10px 20px",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    borderBottom: i < logs.length - 1 ? `1px solid ${bdr}` : "none",
                    transition: "background 0.12s",
                    cursor: "default",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: meta.dot,
                    marginTop: 5,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${meta.dot}60`,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                        textTransform: "uppercase", color: meta.dot,
                        background: `${meta.dot}18`, borderRadius: 4,
                        padding: "1px 6px",
                      }}>
                        {meta.label}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: txt, marginTop: 3, fontWeight: 500, lineHeight: 1.4 }}>
                      {getUserLabel(log)}
                    </p>
                    {log.details && (
                      <p style={{ fontSize: 11.5, color: sub, marginTop: 2, lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {log.details}
                      </p>
                    )}
                    <p style={{ fontSize: 11, color: sub, marginTop: 4 }}>
                      {formatTimeAgo(log.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: `1px solid ${bdr}`,
          flexShrink: 0,
          textAlign: "center",
        }}>
          <a
            href="/dashboard/history"
            style={{ fontSize: 12, color: "#1a8fd1", fontWeight: 600, textDecoration: "none" }}
          >
            View full audit trail →
          </a>
        </div>
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </>
  );
}
