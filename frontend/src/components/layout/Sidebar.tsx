"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { ROLE_LABELS } from "../../utils";
import { Role } from "../../types";

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
    label: "BRD Sources / Content Profiling",
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
          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/compare",
    label: "Compare",
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
          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/users",
    label: "User Management",
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
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    ),
  },
  //   {
  //     href: "/dashboard/files",
  //     label: "File Upload",
  //     roles: ["SUPER_ADMIN", "ADMIN", "USER"],
  //     icon: (
  //       <svg
  //         className="w-5 h-5"
  //         fill="none"
  //         stroke="currentColor"
  //         viewBox="0 0 24 24"
  //       >
  //         <path
  //           strokeLinecap="round"
  //           strokeLinejoin="round"
  //           strokeWidth={1.8}
  //           d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
  //         />
  //       </svg>
  //     ),
  //   },

  {
    href: "/dashboard/validate",
    label: "Validation",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER_QA", "MANAGER_QC"],
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
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/history",
    label: "History",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER_QA", "MANAGER_QC", "USER"],
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
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
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

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const role = user?.role ?? "USER";

  const filtered = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  return (
    <aside
      className={`
      ${collapsed ? "w-[68px]" : "w-60"} flex-shrink-0 h-screen
      bg-[#0f172a] flex flex-col border-r border-slate-800/80
      transition-all duration-300 ease-in-out relative z-20
    `}
    >
      {/* ── Logo ── */}
      <div
        className={`flex items-center h-16 border-b border-slate-800/80 ${collapsed ? "justify-center px-0" : "px-4 gap-3"}`}
      >
        {/* Logo icon — matches your existing brand */}
        <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-[#1a56f0] flex items-center justify-center shadow-md shadow-blue-900/40">
          <svg width="20" height="20" viewBox="0 0 36 36" fill="none">
            <rect x="8" y="8" width="5" height="5" fill="#93c5fd" />
            <rect x="15" y="8" width="5" height="5" fill="#93c5fd" />
            <rect x="22" y="8" width="5" height="5" fill="#93c5fd" />
            <rect x="8" y="15" width="5" height="5" fill="#93c5fd" />
            <rect x="15" y="15" width="5" height="5" fill="white" />
            <rect x="22" y="15" width="5" height="5" fill="#93c5fd" />
            <rect x="8" y="22" width="5" height="5" fill="#93c5fd" />
            <rect x="15" y="22" width="5" height="5" fill="#93c5fd" />
            <rect x="22" y="22" width="5" height="5" fill="#93c5fd" />
          </svg>
        </div>
        {!collapsed && (
          <div>
            <p className="text-white font-bold text-sm leading-none tracking-wide">
              Structo
            </p>
            <p className="text-slate-500 text-[11px] mt-0.5">Doc Processing</p>
          </div>
        )}
      </div>

      {/* ── Role Badge ──
      {!collapsed && (
        <div className="px-4 py-2.5 border-b border-slate-800/40">
          <span className="text-[11px] font-semibold text-[#42b4f5] bg-blue-950/60 border border-blue-900/40 px-2.5 py-1 rounded-full">
            {ROLE_LABELS[role]}
          </span>
        </div>
      )} */}

      {/* ── Nav ── */}
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
                ${
                  active
                    ? "bg-[#1a56f0] text-white shadow-lg shadow-blue-900/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                }
                ${collapsed ? "justify-center" : ""}
              `}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && (
                <span className="text-sm font-medium truncate">
                  {item.label}
                </span>
              )}
              {!collapsed && active && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Collapse Toggle ── */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-[4.5rem] bg-slate-800 border border-slate-700 text-slate-400 hover:text-white rounded-full p-1 transition-all hover:bg-[#1a56f0] hover:border-[#1a56f0] shadow-md"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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

      {/* ── User Profile ── */}
      <div
        className={`p-3 border-t border-slate-800/80 ${collapsed ? "flex justify-center" : ""}`}
      >
        {collapsed ? (
          <button
            onClick={logout}
            title="Logout"
            className="w-9 h-9 bg-blue-950/50 rounded-full flex items-center justify-center text-[#42b4f5] text-xs font-bold hover:bg-red-500/20 hover:text-red-400 transition-colors"
          >
            {user?.firstName?.[0]}
            {user?.lastName?.[0]}
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-slate-800 transition-colors group">
            <div className="w-8 h-8 bg-gradient-to-br from-[#1a56f0] to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate leading-none">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-slate-500 text-[11px] truncate mt-0.5">
                {user?.email}
              </p>
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
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
  );
}
