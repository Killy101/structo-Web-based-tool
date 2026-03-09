"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";

// Lazy-load heavy panels to keep initial bundle small
const ChunkPanel = dynamic(
  () => import("../../../components/compare/ChunkPanel"),
  { ssr: false }
);
const ComparePanel = dynamic(
  () => import("../../../components/compare/ComparePanel"),
  { ssr: false }
);
const MergePanel = dynamic(
  () => import("../../../components/compare/MergePanel"),
  { ssr: false }
);

type Tab = "chunk" | "compare" | "merge";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "chunk",
    label: "Chunk",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 6h16M4 10h16M4 14h8M4 18h8" />
      </svg>
    ),
  },
  {
    id: "compare",
    label: "Compare",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    id: "merge",
    label: "Merge",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    ),
  },
];

export default function ComparePage() {
  const [activeTab, setActiveTab] = useState<Tab>("chunk");

  return (
    <div className="flex flex-col h-full min-h-0 -m-6">
      {/* ── GitHub-style tab bar ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6">
        {TABS.map((tab, idx) => {
          const isActive = activeTab === tab.id;
          return (
            <React.Fragment key={tab.id}>
              {idx > 0 && (
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
              )}
              <button
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative
                  ${isActive
                    ? "text-slate-900 dark:text-white"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  }
                `}
              >
                {tab.icon}
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1a56f0] rounded-t-full" />
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Panel content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden p-4 min-h-0">
        {activeTab === "chunk"   && <ChunkPanel />}
        {activeTab === "compare" && <ComparePanel />}
        {activeTab === "merge"   && <MergePanel />}
      </div>
    </div>
  );
}
