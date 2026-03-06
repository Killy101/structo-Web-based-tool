"use client";
import React from "react";
import {
  Card,
  CardHeader,
  StatCard,
  Badge,
  Button,
  Spinner,
  EmptyState,
} from "../../components/ui";
import { useDashboard } from "../../hooks";
import {
  TASK_STATUS_COLORS,
  USER_STATUS_COLORS,
  ROLE_CHART_COLORS,
  FILE_STATUS_HEX,
  ROLE_LABELS,
  formatTimeAgo,
  formatFileSize,
} from "../../utils";
import { Role, TaskStatus } from "../../types";
import { useAutoLogout } from "../../hooks/useAutoLogout";

// ─── BRD SOURCES (static until backend route exists) ──────────────────────────
const BRD_SOURCES = [
  {
    id: 1,
    name: "Innodata PH – Batch A",
    files: 124,
    status: "ACTIVE",
    lastSync: "Today, 9:00 AM",
  },
  {
    id: 2,
    name: "Innodata PH – Batch B",
    files: 89,
    status: "ACTIVE",
    lastSync: "Today, 8:30 AM",
  },
  {
    id: 3,
    name: "Client Export – Q1",
    files: 45,
    status: "INACTIVE",
    lastSync: "Yesterday",
  },
  {
    id: 4,
    name: "Legacy Data – 2023",
    files: 210,
    status: "ACTIVE",
    lastSync: "Today, 7:00 AM",
  },
];

export default function DashboardPage() {
  const { stats, isLoading, refetch } = useDashboard();
  useAutoLogout(30);
  const statCards = stats
    ? [
        {
          label: "Total Users",
          value: stats.totalUsers,
          icon: "👥",
          color: "blue" as const,
        },
        {
          label: "Files Uploaded",
          value: stats.totalFiles,
          icon: "📁",
          color: "violet" as const,
        },
        {
          label: "Pending Validation",
          value: stats.pendingValidation,
          icon: "⏳",
          color: "amber" as const,
        },
        {
          label: "Approved Tasks",
          value: stats.approvedTasks,
          icon: "✅",
          color: "emerald" as const,
        },
      ]
    : [];

  const totalUsers = stats?.usersByRole.reduce((a, b) => a + b.count, 0) ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-72">
        <div className="text-center space-y-3">
          <Spinner className="w-8 h-8 mx-auto" />
          <p className="text-sm text-slate-500">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-screen-2xl">
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <StatCard
            key={i}
            label={s.label}
            value={s.value}
            icon={s.icon}
            color={s.color}
          />
        ))}
      </div>

      {/* ── Row 2: Activity + Users by Role ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader
            title="Recent Activity"
            subtitle="Latest file operations across all users"
            action={
              <Button variant="ghost" size="sm" onClick={refetch}>
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
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </Button>
            }
          />
          {!stats?.recentActivity?.length ? (
            <EmptyState
              icon="📋"
              title="No activity yet"
              description="File uploads and validations will appear here."
            />
          ) : (
            <div className="divide-y divide-[rgba(26,143,209,0.06)]">
              {stats.recentActivity.slice(0, 7).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-[rgba(26,143,209,0.04)] transition-colors"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{
                      background: "rgba(26, 143, 209, 0.1)",
                      color: "#42b4f5",
                    }}
                  >
                    {item.uploadedBy?.firstName?.[0]}
                    {item.uploadedBy?.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 truncate">
                      <span
                        className="font-semibold"
                        style={{ color: "#42b4f5" }}
                      >
                        {item.uploadedBy?.firstName} {item.uploadedBy?.lastName}
                      </span>
                      {" uploaded "}
                      <span className="text-slate-500">
                        {item.originalName}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">
                        {formatTimeAgo(item.uploadedAt)}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-xs text-slate-500">
                        {formatFileSize(item.fileSize)}
                      </span>
                    </div>
                  </div>
                  <Badge className={TASK_STATUS_COLORS[item.status]}>
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Users by Role */}
        <Card>
          <CardHeader title="Users by Role" />
          <div className="p-6 space-y-4">
            {!stats?.usersByRole?.length ? (
              <EmptyState icon="👥" title="No users yet" />
            ) : (
              stats.usersByRole.map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-slate-400">
                      {ROLE_LABELS[item.role as Role]}
                    </span>
                    <span className="text-sm font-semibold text-white">
                      {item.count}
                    </span>
                  </div>
                  <div
                    className="w-full rounded-full h-2 overflow-hidden"
                    style={{ background: "rgba(26, 143, 209, 0.08)" }}
                  >
                    <div
                      className="h-2 rounded-full transition-all duration-700"
                      style={{
                        width: `${totalUsers > 0 ? (item.count / totalUsers) * 100 : 0}%`,
                        backgroundColor: ROLE_CHART_COLORS[item.role as Role],
                      }}
                    />
                  </div>
                </div>
              ))
            )}
            <div
              className="pt-3 border-t"
              style={{ borderColor: "rgba(26, 143, 209, 0.08)" }}
            >
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Total Users</span>
                <span className="text-sm font-bold text-white">
                  {totalUsers}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row 3: File Status + BRD Sources ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* File Upload Status */}
        <Card>
          <CardHeader
            title="File Status Overview"
            subtitle="Current status of all uploaded files"
          />
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {stats?.filesByStatus.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3.5 rounded-xl border transition-colors"
                style={{
                  background: "rgba(6, 13, 26, 0.5)",
                  borderColor: "rgba(26, 143, 209, 0.08)",
                }}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: FILE_STATUS_HEX[item.status as TaskStatus],
                  }}
                />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 truncate">
                    {item.status}
                  </p>
                  <p className="text-xl font-bold text-white">{item.count}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* BRD Sources */}
        <Card className="overflow-hidden">
          <CardHeader
            title="BRD Sources"
            subtitle="Connected document sources"
            action={
              <Button variant="ghost" size="sm">
                View all
              </Button>
            }
          />
          <div className="divide-y divide-[rgba(26,143,209,0.06)]">
            {BRD_SOURCES.map((src) => (
              <div
                key={src.id}
                className="flex items-center justify-between px-6 py-3.5 hover:bg-[rgba(26,143,209,0.04)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{
                      background: "rgba(26, 143, 209, 0.1)",
                      color: "#42b4f5",
                    }}
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
                        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{src.name}</p>
                    <p className="text-xs text-slate-500">
                      {src.files} files · {src.lastSync}
                    </p>
                  </div>
                </div>
                <Badge
                  className={
                    USER_STATUS_COLORS[src.status as "ACTIVE" | "INACTIVE"]
                  }
                >
                  {src.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
