"use client";
import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemContext";
import { Role } from "../../types";
import ProfileModal from "@/components/user/profile";

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER_QA", "MANAGER_QC", "USER"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/brd",
    label: "BRD Sources",
    roles: ["SUPER_ADMIN", "ADMIN"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
  },
  {
    href: "/dashboard/compare",
    label: "Compare",
    roles: ["SUPER_ADMIN", "ADMIN"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h7v12H4zM13 6h7v12h-7z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 10l2 2-2 2m6-4l-2 2 2 2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/users",
    label: "User Management",
    roles: ["SUPER_ADMIN", "ADMIN"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/validate",
    label: "Validation",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER_QA", "MANAGER_QC"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/history",
    label: "History",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER_QA", "MANAGER_QC", "USER"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    roles: ["SUPER_ADMIN"],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const notifications = [
  { msg: "3 files pending validation", time: "5m ago", color: "bg-amber-500" },
  { msg: "New user has been registered", time: "1h ago", color: "bg-[#1a56f0]" },
  { msg: "Batch export approved", time: "2h ago", color: "bg-emerald-500" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function LogoutModal({ onConfirm, onCancel, dark }: { onConfirm: () => void; onCancel: () => void; dark: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className={`absolute inset-0 backdrop-blur-sm ${dark ? "bg-black/60" : "bg-slate-900/30"}`} onClick={onCancel} />
      <div className={`relative z-10 w-80 rounded-2xl overflow-hidden border ${dark ? "bg-[#1e293b] border-slate-700/80 shadow-2xl shadow-black/50" : "bg-white border-slate-200 shadow-2xl shadow-slate-900/10"}`}>
        <div className="px-6 py-5">
          <div className={`w-12 h-12 border rounded-xl flex items-center justify-center mb-4 mx-auto ${dark ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200"}`}>
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </div>
          <h2 className={`font-semibold text-base text-center leading-snug ${dark ? "text-white" : "text-slate-900"}`}>Signing out of Structo?</h2>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onCancel} className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all duration-150 ${dark ? "bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700 hover:text-white" : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:text-slate-900"}`}>
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/90 text-white border border-red-500 hover:bg-red-500 hover:shadow-lg hover:shadow-red-900/40 transition-all duration-150">
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [showNotif, setShowNotif] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const role = user?.role ?? "USER";

  const filtered = NAV_ITEMS.filter((item) => item.roles.includes(role) && item.href !== "/dashboard/settings");

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  const inactiveItemClass = dark
    ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900";

  return (
    <>
      {showLogoutModal && (
        <LogoutModal
          onConfirm={() => { setShowLogoutModal(false); logout(); }}
          onCancel={() => setShowLogoutModal(false)}
          dark={dark}
        />
      )}

      {showProfile && (
        <ProfileModal user={user} onClose={() => setShowProfile(false)} dark={dark} />
      )}

      <aside
        className={`
          ${collapsed ? "w-[68px]" : "w-60"} flex-shrink-0 h-screen
          ${dark ? "bg-[#0f172a] border-slate-800/80" : "bg-white border-slate-200"} flex flex-col border-r
          transition-all duration-300 ease-in-out relative z-20
        `}
      >
        {/* logo */}
        <div className={`flex items-center h-16 border-b px-4 gap-3 overflow-hidden ${dark ? "border-slate-800/80" : "border-slate-200"}`}>
          <div className={`w-8 h-8 flex-shrink-0 relative transition-transform duration-300 ease-in-out ${collapsed ? "translate-x-[2px]" : "translate-x-0"}`}>
            <Image src="/assets/innodata.png" alt="Innodata Logo" fill className="object-contain" />
          </div>
          <div
            className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${collapsed ? "max-w-0 opacity-0 -translate-x-1" : "max-w-[220px] opacity-100 translate-x-0"}`}
          >
            <div>
              <p className={`font-bold text-sm leading-none tracking-wide ${dark ? "text-white" : "text-slate-900"}`}>Structo</p>
              <p className={`text-[11px] mt-0.5 ${dark ? "text-slate-500" : "text-slate-500"}`}>Legal Regulatory Delivery Unit</p>
            </div>
          </div>
        </div>

        {/* nav items */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto scrollbar-none">
          {filtered.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl
                  transition-all duration-150 group
                  ${active ? "bg-[#1a56f0] text-white shadow-lg shadow-blue-900/30" : inactiveItemClass}
                  ${collapsed ? "justify-center" : ""}
                `}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {!collapsed && <span className="text-sm font-medium truncate">{item.label}</span>}
                {!collapsed && active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />}
              </Link>
            );
          })}
        </nav>

        {/* bottom utilities */}
        <div className={`px-2 pb-2 space-y-0.5 border-t pt-2 ${dark ? "border-slate-800/80" : "border-slate-200"}`}>

          {/* notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotif((v) => !v)}
              title={collapsed ? "Notifications" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${inactiveItemClass} ${collapsed ? "justify-center" : ""}`}
            >
              <span className="relative flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full ring-2 ${dark ? "ring-[#0f172a]" : "ring-white"}`} />
              </span>
              {!collapsed && <span className="text-sm font-medium">Notifications</span>}
              {!collapsed && (
                <span className="ml-auto text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                  {notifications.length}
                </span>
              )}
            </button>

            {showNotif && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowNotif(false)} />
                <div className={`absolute left-full bottom-0 ml-2 z-40 w-72 rounded-xl shadow-xl border ${dark ? "bg-[#1e293b] border-slate-700" : "bg-white border-slate-200"}`}>
                  <div className={`px-4 py-3 border-b flex items-center justify-between ${dark ? "border-slate-700" : "border-slate-200"}`}>
                    <p className={`font-semibold text-sm ${dark ? "text-white" : "text-slate-900"}`}>Notifications</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? "text-[#42b4f5] bg-blue-950/60" : "text-[#1a56f0] bg-blue-50"}`}>{notifications.length} new</span>
                  </div>
                  <div className={`divide-y ${dark ? "divide-slate-700/60" : "divide-slate-200"}`}>
                    {notifications.map((n, i) => (
                      <div key={i} className={`flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer ${dark ? "hover:bg-slate-700/40" : "hover:bg-slate-50"}`}>
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.color}`} />
                        <div>
                          <p className={`text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>{n.msg}</p>
                          <p className={`text-xs mt-0.5 ${dark ? "text-slate-500" : "text-slate-500"}`}>{n.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={`px-4 py-3 border-t text-center ${dark ? "border-slate-700" : "border-slate-200"}`}>
                    <button className={`text-xs hover:underline ${dark ? "text-[#42b4f5]" : "text-[#1a56f0]"}`}>View all notifications</button>
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
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </span>
            {!collapsed && <span className="text-sm font-medium">{dark ? "Light Mode" : "Dark Mode"}</span>}
          </button>

          {/* settings */}
          {role === "SUPER_ADMIN" && (
            <Link
              href="/dashboard/settings"
              title={collapsed ? "Settings" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${isActive("/dashboard/settings") ? "bg-[#1a56f0] text-white shadow-lg shadow-blue-900/30" : inactiveItemClass} ${collapsed ? "justify-center" : ""}`}
            >
              <span className="flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              {!collapsed && <span className="text-sm font-medium">Settings</span>}
            </Link>
          )}
        </div>

        {/* collapse toggle */}
        <button
          onClick={onToggle}
          className={`absolute -right-3 top-[4.5rem] border rounded-full p-1 transition-all shadow-md hover:bg-[#1a56f0] hover:border-[#1a56f0] hover:text-white ${dark ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-300 text-slate-600"}`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
          </svg>
        </button>

        {/* user info */}
        <div className={`p-3 border-t ${dark ? "border-slate-800/80" : "border-slate-200"} ${collapsed ? "flex justify-center" : ""}`}>
          {collapsed ? (
            <button
              onClick={() => setShowProfile(true)}
              title="Profile"
              className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${dark ? "bg-blue-950/50 text-[#42b4f5] hover:bg-slate-800 hover:text-white" : "bg-blue-100 text-[#1a56f0] hover:bg-blue-200"}`}
            >
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </button>
          ) : (
            <div className={`flex items-center gap-2.5 px-2 py-2 rounded-xl transition-colors group ${dark ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
              <div className="w-8 h-8 bg-gradient-to-br from-[#1a56f0] to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <button
                onClick={() => setShowProfile(true)}
                title="Profile"
                className="flex-1 min-w-0 text-left"
              >
                <p className={`text-sm font-medium truncate leading-none ${dark ? "text-white" : "text-slate-900"}`}>{user?.firstName} {user?.lastName}</p>
                <p className="text-slate-500 text-[11px] truncate mt-0.5">{user?.email}</p>
              </button>
              <button
                onClick={() => setShowLogoutModal(true)}
                title="Logout"
                className={`p-1 rounded transition-all ${dark ? "text-slate-500 hover:text-red-400 hover:bg-red-400/10" : "text-slate-500 hover:text-red-500 hover:bg-red-50"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}