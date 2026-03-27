"use client";
import React, { useRef, useEffect, useState, useCallback } from "react";
import { useNotifications } from "../../hooks";
import { notificationsApi } from "../../services/api";
import { formatTimeAgo } from "../../utils";
import { Notification } from "../../types";

// ─── Icons ─────────────────────────────────────────────────────────────────────

function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function InboxIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
  );
}

// ─── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; badge: string; dot: string; icon: string }> = {
  TASK_ASSIGNED: { label: "Task",   badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400", dot: "bg-emerald-500", icon: "📋" },
  TASK_UPDATED:  { label: "Update", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",         dot: "bg-amber-500",   icon: "💬" },
  BRD_STATUS:    { label: "BRD",    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",             dot: "bg-blue-500",    icon: "📄" },
  SYSTEM:        { label: "System", badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",     dot: "bg-purple-500",  icon: "🔔" },
};

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "all" | "unread" | "archived";

// ─── Notification row ─────────────────────────────────────────────────────────

function NotificationRow({
  n,
  onMarkRead,
  onArchive,
  onDelete,
  showArchiveAction = true,
}: {
  n: Notification;
  onMarkRead?: (n: Notification) => void;
  onArchive?: (id: number) => void;
  onDelete: (id: number) => void;
  showArchiveAction?: boolean;
}) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.SYSTEM;
  return (
    <div
      onClick={() => onMarkRead?.(n)}
      className={`group relative flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
        n.isRead
          ? "hover:bg-slate-50 dark:hover:bg-slate-800/50"
          : "bg-blue-50/60 dark:bg-blue-900/10 hover:bg-blue-100/70 dark:hover:bg-blue-900/20"
      }`}
    >
      {/* Unread dot */}
      {!n.isRead && (
        <span className={`absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      )}

      {/* Icon */}
      <span className="text-base flex-shrink-0 mt-0.5 ml-1">{cfg.icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
            {n.title}
          </p>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
          {n.message}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
          {formatTimeAgo(n.createdAt)}
        </p>
      </div>

      {/* Action buttons — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
        {showArchiveAction && onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(n.id); }}
            className="p-1.5 rounded-md text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
            title="Archive"
            aria-label="Archive notification"
          >
            <ArchiveIcon className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
          className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          title="Delete"
          aria-label="Delete notification"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [archivedNotifs, setArchivedNotifs] = useState<Notification[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { notifications, unreadCount, isLoading, markRead, markAllRead, archive, remove } =
    useNotifications();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Load archived when tab switches to "archived"
  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const data = await notificationsApi.getArchived();
      setArchivedNotifs(data.notifications);
    } catch {
      setArchivedNotifs([]);
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "archived" && open) void loadArchived();
  }, [tab, open, loadArchived]);

  const deleteArchived = async (id: number) => {
    try {
      await notificationsApi.delete(id);
    } catch { /* ignore */ }
    setArchivedNotifs((prev) => prev.filter((n) => n.id !== id));
  };

  // Filtered list for active tab
  const visibleNotifs =
    tab === "unread" ? notifications.filter((n) => !n.isRead) : notifications;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "all",      label: "All",      count: notifications.length },
    { id: "unread",   label: "Unread",   count: unreadCount },
    { id: "archived", label: "Archived" },
  ];

  return (
    <div ref={ref} className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
        aria-label="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <BellIcon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Notifications
              </span>
            </div>
            {unreadCount > 0 && tab !== "archived" && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500 bg-white dark:bg-slate-900"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800/60"
                }`}
              >
                {t.id === "archived" ? <ArchiveIcon className="w-3.5 h-3.5" /> : null}
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                    t.id === "unread"
                      ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                      : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="max-h-[22rem] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {/* ── Archived tab ── */}
            {tab === "archived" ? (
              archivedLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Loading archived…
                </div>
              ) : archivedNotifs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                  <InboxIcon className="w-8 h-8" />
                  <p className="text-sm">No archived notifications</p>
                </div>
              ) : (
                archivedNotifs.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    onDelete={deleteArchived}
                    showArchiveAction={false}
                  />
                ))
              )
            ) : /* ── All / Unread tabs ── */ isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Loading…
              </div>
            ) : visibleNotifs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                <InboxIcon className="w-8 h-8" />
                <p className="text-sm">
                  {tab === "unread" ? "All caught up!" : "No notifications yet"}
                </p>
              </div>
            ) : (
              visibleNotifs.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onMarkRead={(notif) => { if (!notif.isRead) void markRead(notif.id); }}
                  onArchive={archive}
                  onDelete={remove}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {tab !== "archived" && visibleNotifs.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                Hover a notification to archive or delete
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
