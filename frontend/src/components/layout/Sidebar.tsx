"use client";
import React, { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { IdafLogo } from "../icons/IdafLogo";
import { usePathname } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemContext";
import { useNotifications } from "../../hooks";
import { formatTimeAgo } from "../../utils";
import { Role } from "../../types";

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  feature?: string | string[];
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    roles: ["SUPER_ADMIN", "ADMIN", "USER"],
    feature: "dashboard",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/brd",
    label: "BRD Sources",
    roles: ["SUPER_ADMIN", "ADMIN", "USER"],
    feature: ["brd-process", "brd-view-generate"],
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/compare",
    label: "Compare",
    roles: ["SUPER_ADMIN", "ADMIN", "USER"],
    feature: [
      "compare-basic",
      "compare-merge",
      "compare-pdf-xml-only",
    ],
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M4 6h7v12H4zM13 6h7v12h-7z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M9 10l2 2-2 2m6-4l-2 2 2 2"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/history",
    label: "History",
    roles: ["SUPER_ADMIN", "ADMIN", "USER"],
    feature: "user-logs",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/logs",
    label: "Logs",
    roles: ["SUPER_ADMIN", "ADMIN"],
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/users",
    label: "User Management",
    roles: ["SUPER_ADMIN", "ADMIN"],
    feature: "user-management",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    roles: ["SUPER_ADMIN"],
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

const TYPE_DOT: Record<string, string> = {
  TASK_ASSIGNED: "bg-[#1a8fd1]",
  TASK_UPDATED:  "bg-amber-500",
  BRD_STATUS:    "bg-emerald-500",
  SYSTEM:        "bg-slate-400",
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onMobileClose?: () => void;
  hoverMode?: boolean;
}

function LogoutModal({
  onConfirm,
  onCancel,
  dark,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  dark: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 backdrop-blur-sm bg-black/70"
        onClick={onCancel}
      />
      <div
        className="relative z-10 w-80 rounded-2xl overflow-hidden border"
        style={{
          background: dark ? "#0b1a2e" : "#ffffff",
          borderColor: dark
            ? "rgba(26, 143, 209, 0.15)"
            : "rgba(100, 116, 139, 0.25)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        <div className="px-6 py-5">
          <div
            className="w-12 h-12 border rounded-xl flex items-center justify-center mb-4 mx-auto"
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              borderColor: "rgba(239, 68, 68, 0.2)",
            }}
          >
            <svg
              className="w-6 h-6 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </div>
          <h2
            className={`font-semibold text-base text-center leading-snug ${dark ? "text-white" : "text-slate-900"}`}
          >
            Signing out of Structo?
          </h2>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all duration-150"
            style={{
              background: dark
                ? "rgba(26, 143, 209, 0.08)"
                : "rgba(100, 116, 139, 0.08)",
              color: dark ? "#94a3b8" : "#334155",
              borderColor: dark
                ? "rgba(26, 143, 209, 0.15)"
                : "rgba(100, 116, 139, 0.2)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/90 text-white border border-red-500 hover:bg-red-500 hover:shadow-lg hover:shadow-red-900/40 transition-all duration-150"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function Sidebar({ collapsed, onToggle, onMobileClose, hoverMode }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [showNotif, setShowNotif] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead, remove } =
    useNotifications();
  const hasFeature = (feature?: string | string[]) => {
    if (!feature) return true;
    if (user?.role === "SUPER_ADMIN") return true;
    const enabled = user?.effectiveFeatures ?? [];
    if (enabled.includes("*")) return true;
    if (Array.isArray(feature)) return feature.some((f) => enabled.includes(f));
    return enabled.includes(feature);
  };

  const canAccess = (item: NavItem) => {
    const roleOk = item.roles.includes((user?.role as Role) ?? "USER");
    const featureOk = hasFeature(item.feature);
    return roleOk && featureOk;
  };

  const filtered = NAV_ITEMS.filter(
    (item) => item.href !== "/dashboard/settings",
  );

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  const inactiveItemClass = dark
    ? "text-slate-400 hover:bg-[rgba(26,143,209,0.08)] hover:text-slate-100"
    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900";

  return (
    <>
      {showLogoutModal && (
        <LogoutModal
          onConfirm={() => {
            setShowLogoutModal(false);
            logout();
          }}
          onCancel={() => setShowLogoutModal(false)}
          dark={dark}
        />
      )}

      {/* Hover trigger strip when in hover mode */}
      {hoverMode && !hovered && (
        <div
          className="flex-shrink-0 w-1.5 h-screen relative z-30 cursor-pointer"
          onMouseEnter={() => setHovered(true)}
          style={{ background: dark ? "rgba(26, 143, 209, 0.08)" : "rgba(100, 116, 139, 0.06)" }}
        />
      )}

      <aside
        className={`
          ${collapsed ? "w-[68px]" : "w-60"} flex-shrink-0 h-screen
          flex flex-col border-r
          transition-all duration-300 ease-in-out
          ${hoverMode ? `absolute left-0 top-0 z-40 shadow-2xl ${hovered ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 pointer-events-none"}` : "relative z-20"}
        `}
        style={{
          background: dark ? "rgba(6, 13, 26, 0.98)" : "rgba(248, 250, 252, 0.99)",
          backdropFilter: "blur(16px)",
          borderColor: dark ? "rgba(26, 143, 209, 0.1)" : "rgba(100, 116, 139, 0.15)",
        }}
        onMouseLeave={() => { if (hoverMode) setHovered(false); }}
      >
        {/* logo */}
        <div
          className={`flex items-center h-16 border-b px-4 gap-3 overflow-hidden`}
          style={{ borderColor: dark ? "rgba(26, 143, 209, 0.1)" : "rgba(100, 116, 139, 0.15)" }}
        >
          <div
            className={`flex-shrink-0 transition-transform duration-300 ease-in-out ${collapsed ? "translate-x-[2px]" : "translate-x-0"}`}
          >
            <IdafLogo size={32} />
          </div>
          <div
            className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${collapsed ? "max-w-0 opacity-0 -translate-x-1" : "max-w-[220px] opacity-100 translate-x-0"}`}
          >
            <div>
              <p className={`font-bold text-sm leading-none tracking-wide ${dark ? "text-white" : "text-slate-900"}`}>
                Structo
              </p>
              <p className="text-[11px] mt-0.5 text-slate-500">
                Document Intelligence Platform
              </p>
            </div>
          </div>
        </div>

        {/* nav items */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto scrollbar-none">
          {filtered.map((item) => {
            const active = isActive(item.href);
            const allowed = canAccess(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onMobileClose}
                title={
                  collapsed
                    ? `${item.label}${allowed ? "" : " (No access)"}`
                    : undefined
                }
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl
                  transition-all duration-150 group
                  ${active ? "text-white shadow-lg" : inactiveItemClass}
                  ${!allowed && !active ? "opacity-70" : ""}
                  ${collapsed ? "justify-center" : ""}
                `}
                style={
                  active
                    ? {
                        background: "linear-gradient(135deg, #1a8fd1, #146da3)",
                        boxShadow: "0 4px 16px rgba(26, 143, 209, 0.3)",
                      }
                    : undefined
                }
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {!collapsed && (
                  <span className="text-sm font-medium truncate">
                    {item.label}
                  </span>
                )}
                {!collapsed && !active && !allowed && (
                  <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/25">
                    <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">
                      <rect x="0.5" y="4.5" width="7" height="5" rx="1" fill="currentColor"/>
                      <path d="M2 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                    </svg>
                    Locked
                  </span>
                )}
                {!collapsed && active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* bottom utilities */}
        <div
          className="px-2 pb-2 space-y-0.5 border-t pt-2"
          style={{ borderColor: dark ? "rgba(26, 143, 209, 0.1)" : "rgba(100, 116, 139, 0.15)" }}
        >
          {/* notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotif((v) => !v)}
              title={collapsed ? "Notifications" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${inactiveItemClass} ${collapsed ? "justify-center" : ""}`}
            >
              <span className="relative flex-shrink-0">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"
                    style={{ boxShadow: dark ? "0 0 0 2px #060d1a" : "0 0 0 2px #f8fafc" }}
                  />
                )}
              </span>
              {!collapsed && (
                <span className="text-sm font-medium">Notifications</span>
              )}
              {!collapsed && unreadCount > 0 && (
                <span className="ml-auto text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {showNotif && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowNotif(false)}
                />
                <div
                  className="absolute left-full bottom-0 ml-2 z-40 w-72 rounded-xl shadow-xl border"
                  style={{
                    background: dark ? "#0b1a2e" : "#f8fafc",
                    borderColor: dark ? "rgba(26, 143, 209, 0.15)" : "rgba(100, 116, 139, 0.2)",
                    boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                  }}
                >
                  {/* header */}
                  <div
                    className="px-4 py-3 border-b flex items-center justify-between"
                    style={{ borderColor: dark ? "rgba(26, 143, 209, 0.1)" : "rgba(100, 116, 139, 0.15)" }}
                  >
                    <p className={`font-semibold text-sm ${dark ? "text-white" : "text-slate-900"}`}>
                      Notifications
                    </p>
                    {unreadCount > 0 ? (
                      <button
                        onClick={markAllRead}
                        className="text-xs hover:underline"
                        style={{ color: "#d4862e" }}
                      >
                        Mark all read
                      </button>
                    ) : (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          color: "#d4862e",
                          background: "rgba(212, 134, 46, 0.12)",
                        }}
                      >
                        0 unread
                      </span>
                    )}
                  </div>

                  {/* list */}
                  <div
                    className="max-h-72 overflow-y-auto divide-y"
                    style={{ borderColor: "rgba(26, 143, 209, 0.08)" }}
                  >
                    {notifications.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-center text-slate-500">
                        No notifications yet
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => !n.isRead && markRead(n.id)}
                          className={`flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer ${
                            n.isRead
                              ? dark
                                ? "hover:bg-slate-900/40"
                                : "hover:bg-slate-100"
                              : dark
                                ? "bg-[#102742] hover:bg-[#16345a]"
                                : "bg-sky-50 hover:bg-sky-100"
                          }`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${TYPE_DOT[n.type] ?? TYPE_DOT.SYSTEM}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-medium truncate ${dark ? "text-slate-100" : "text-slate-800"}`}
                            >
                              {n.title}
                            </p>
                            <p
                              className={`text-xs mt-0.5 line-clamp-2 ${dark ? "text-slate-300" : "text-slate-700"}`}
                            >
                              {n.message}
                            </p>
                            <p className="text-[11px] mt-1 text-slate-500">
                              {formatTimeAgo(n.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(n.id);
                            }}
                            className="text-slate-400 hover:text-red-400 transition-colors ml-1"
                            aria-label="Delete notification"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div
                    className="px-4 py-3 border-t text-center"
                    style={{ borderColor: dark ? "rgba(26, 143, 209, 0.1)" : "rgba(100, 116, 139, 0.15)" }}
                  >
                    <button
                      className="text-xs hover:underline"
                      style={{ color: "#d4862e" }}
                    >
                      {unreadCount} unread notifications
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* dark mode toggle */}
          <button
            onClick={toggle}
            title={collapsed ? (dark ? "Light mode" : "Dark mode") : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${inactiveItemClass} ${collapsed ? "justify-center" : ""}`}
          >
            <span className="flex-shrink-0">
              {dark ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </span>
            {!collapsed && (
              <>
                <span className="text-sm font-medium">
                  Theme: {dark ? "Dark" : "Light"}
                </span>
               
              </>
            )}
          </button>

          {/* keyboard shortcuts */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("structo:open-shortcuts"))}
            title={collapsed ? "Keyboard Shortcuts" : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${inactiveItemClass} ${collapsed ? "justify-center" : ""}`}
          >
            <span className="flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="2" y="4" width="20" height="16" rx="2" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8"/>
              </svg>
            </span>
            {!collapsed && (
              <span className="text-sm font-medium">Shortcuts</span>
            )}
            {!collapsed && (
              <span className="ml-auto text-[10px] font-mono font-bold opacity-40">?</span>
            )}
          </button>

          {/* settings */}
          {user?.role === "SUPER_ADMIN" && (
            <Link
              href="/dashboard/settings"
              onClick={onMobileClose}
              title={collapsed ? "Settings" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${isActive("/dashboard/settings") ? "text-white shadow-lg" : inactiveItemClass} ${collapsed ? "justify-center" : ""}`}
              style={
                isActive("/dashboard/settings")
                  ? {
                      background: "linear-gradient(135deg, #1a8fd1, #146da3)",
                      boxShadow: "0 4px 16px rgba(26, 143, 209, 0.3)",
                    }
                  : undefined
              }
            >
              <span className="flex-shrink-0">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </span>
              {!collapsed && (
                <span className="text-sm font-medium">Settings</span>
              )}
            </Link>
          )}
        </div>

        {/* collapse toggle */}
        <button
          onClick={onToggle}
          className="absolute -right-3 top-[4.5rem] border rounded-full p-2 transition-all shadow-md"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            background: dark ? "#0b1a2e" : "#f1f5f9",
            borderColor: dark ? "rgba(26, 143, 209, 0.2)" : "rgba(100, 116, 139, 0.3)",
            color: "#64748b",
          }}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"}
            />
          </svg>
        </button>

        {/* user info */}
        <div
          className={`p-3 border-t ${collapsed ? "flex justify-center" : ""}`}
          style={{ borderColor: dark ? "rgba(26, 143, 209, 0.1)" : "rgba(100, 116, 139, 0.15)" }}
        >
          {collapsed ? (
            <button
              onClick={() => setShowLogoutModal(true)}
              title="Logout"
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all hover:ring-2 hover:ring-red-400/50 hover:opacity-80"
              style={{
                background: "rgba(26, 143, 209, 0.12)",
                color: "#42b4f5",
              }}
            >
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </button>
          ) : (
            <div
              className="flex items-center gap-2.5 px-2 py-2 rounded-xl transition-colors group"
              style={{ cursor: "default" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #1a8fd1, #d4862e)",
                }}
              >
                {user?.firstName?.[0]}
                {user?.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate leading-none ${dark ? "text-white" : "text-slate-900"}`}>
                  {user?.userId ?? "Unknown"}
                </p>
                <p className={`text-[11px] truncate mt-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {user?.team?.name ?? "No team"}
                </p>
              </div>
              <button
                onClick={() => setShowLogoutModal(true)}
                title="Logout"
                className="p-1 rounded transition-all text-slate-500 hover:text-red-400 hover:bg-red-400/10"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}