"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "../../../context/AuthContext";

const ChunkPanel = dynamic(
  () => import("../../../components/compare/ChunkPanel"),
  { ssr: false },
);
const ComparePanel = dynamic(
  () => import("../../../components/compare/ComparePanel"),
  { ssr: false },
);
const MergePanel = dynamic(
  () => import("../../../components/compare/MergePanel"),
  { ssr: false },
);

type Tab = "chunk" | "compare" | "merge";

export default function ComparePage() {
  const { user } = useAuth();
  const features = user?.effectiveFeatures ?? [];
  const isSuperAdmin = user?.role === "SUPER_ADMIN" || features.includes("*");
  const canCompare = isSuperAdmin || features.includes("compare-basic");
  const canChunk = isSuperAdmin || features.includes("compare-chunk");
  const canMerge = isSuperAdmin || features.includes("compare-merge");
  const comparePdfXmlOnly =
    isSuperAdmin || features.includes("compare-pdf-xml-only");
  const hasExtendedAccess = canChunk || canMerge;

  const [activeTab, setActiveTab] = useState<Tab>(
    hasExtendedAccess ? (canChunk ? "chunk" : "compare") : "compare",
  );

  if (!canCompare && !canChunk && !canMerge) {
    return (
      <div className="h-full flex items-center justify-center text-center text-slate-500 dark:text-slate-400">
        You do not have compare access for your team policy.
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    ...(canChunk
      ? [
          {
            id: "chunk" as Tab,
            label: "Chunk",
            icon: (
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
                  d="M4 6h16M4 10h16M4 14h8M4 18h8"
                />
              </svg>
            ),
          },
        ]
      : []),
    {
      id: "compare",
      label: "Compare",
      icon: (
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
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      ),
    },
    ...(canMerge
      ? [
          {
            id: "merge" as Tab,
            label: "Merge",
            icon: (
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col h-full min-h-0 -m-6">
      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
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
                  ${
                    isActive
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

        {/* Role badge */}
        <div className="ml-auto">
          {hasExtendedAccess ? (
            <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
              {user?.role === "SUPER_ADMIN"
                ? "Super Admin"
                : (user?.team?.name ?? "Team")}{" "}
              · Full Access
            </span>
          ) : (
            <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 font-medium">
              {user?.team?.name ?? "Team"} ·{" "}
              {comparePdfXmlOnly ? "Compare PDF+XML Only" : "Compare"}
            </span>
          )}
        </div>
      </div>

      {/* ── Panel content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden p-4 min-h-0">
        {canChunk && activeTab === "chunk" && <ChunkPanel />}
        {activeTab === "compare" && <ComparePanel />}
        {canMerge && activeTab === "merge" && <MergePanel />}
      </div>
    </div>
  );
}
