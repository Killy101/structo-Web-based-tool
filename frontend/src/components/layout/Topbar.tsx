"use client";
import React, { useState } from "react";
import { useTheme } from "../../context/ThemContext";
import { useAuth } from "../../context/AuthContext";

interface TopbarProps {
  title: string;
  subtitle?: string;
}

export default function Topbar({ title, subtitle }: TopbarProps) {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const [showNotif, setShowNotif] = useState(false);

  const notifications = [
    {
      msg: "3 files pending validation",
      time: "5m ago",
      color: "bg-amber-500",
    },
    {
      msg: "New user has been registered",
      time: "1h ago",
      color: "bg-[#1a56f0]",
    },
    { msg: "Batch export approved", time: "2h ago", color: "bg-emerald-500" },
  ];

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
      {/* ── Left ── */}
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white leading-none">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* ── Right ── */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotif((v) => !v)}
            className="relative p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
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
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
          </button>

          {showNotif && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowNotif(false)}
              />
              <div className="absolute right-0 top-12 z-40 w-72 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <p className="font-semibold text-sm text-slate-900 dark:text-white">
                    Notifications
                  </p>
                  <span className="text-xs text-[#1a56f0] bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                    {notifications.length} new
                  </span>
                </div>
                <div className="divide-y divide-slate-50 dark:divide-slate-800">
                  {notifications.map((n, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.color}`}
                      />
                      <div>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {n.msg}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {n.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-center">
                  <button className="text-xs text-[#1a56f0] hover:underline">
                    View all notifications
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggle}
          className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={dark ? "Light mode" : "Dark mode"}
        >
          {dark ? (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"
              />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          )}
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* User chip */}
        <div className="flex items-center gap-2 pl-1">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#1a56f0] to-purple-600 flex items-center justify-center text-white text-xs font-bold">
            {user?.firstName?.[0]}
            {user?.lastName?.[0]}
          </div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300 hidden sm:block">
            {user?.firstName}
          </span>
        </div>
      </div>
    </header>
  );
}
