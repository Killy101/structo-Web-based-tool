"use client";
import React from "react";
import {
  Card,
  CardHeader,
  Badge,
  Button,
  Spinner,
  EmptyState,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useBrds, useDashboard, useUserLogs } from "../../hooks";
import {
  TASK_STATUS_COLORS,
  ROLE_CHART_COLORS,
  ROLE_LABELS,
  formatTimeAgo,
} from "../../utils";
import { Role, TaskStatus } from "../../types";

const BRD_STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  IN_REVIEW: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  APPROVED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  ARCHIVED:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
};

type ActivityItem = {
  id: string;
  at: string;
  title: string;
  description: string;
  tag: string;
};

const ACTIVITY_PAGE_SIZE = 5;

export default function DashboardPage() {
  const { user } = useAuth();
  const { stats, isLoading, refetch } = useDashboard();
  const { brds, isLoading: brdLoading, refetch: refetchBrds } = useBrds();
  const {
    logs,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = useUserLogs(
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" ? "all" : "mine",
  );
  const [activityPage, setActivityPage] = React.useState(1);

  const statCards = [
    { label: "Users", value: stats?.totalUsers ?? 0 },
    { label: "Documents", value: stats?.totalFiles ?? 0 },
    { label: "BRD Sources", value: brds.length },
    { label: "Pending", value: stats?.pendingValidation ?? 0 },
  ];

  const totalUsers = stats?.usersByRole.reduce((a, b) => a + b.count, 0) ?? 0;
  const allBusy = isLoading || brdLoading || logsLoading;

  const recentActivity: ActivityItem[] = React.useMemo(() => {
    const fromLogs: ActivityItem[] = logs.map((log) => ({
      id: `log-${log.id}`,
      at: log.createdAt,
      title: log.action.replace(/_/g, " "),
      description:
        log.details ||
        `${log.user?.firstName ?? ""} ${log.user?.lastName ?? ""}`.trim(),
      tag: "System",
    }));

    const fromFiles: ActivityItem[] = (stats?.recentActivity ?? []).map(
      (f) => ({
        id: `file-${f.id}`,
        at: f.uploadedAt,
        title: "File Uploaded",
        description: `${f.uploadedBy?.firstName ?? ""} ${f.uploadedBy?.lastName ?? ""} uploaded ${f.originalName}`,
        tag: f.status,
      }),
    );

    return [...fromLogs, ...fromFiles]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 50);
  }, [logs, stats?.recentActivity]);

  const activityTotalPages = Math.max(
    1,
    Math.ceil(recentActivity.length / ACTIVITY_PAGE_SIZE),
  );

  React.useEffect(() => {
    if (activityPage > activityTotalPages) {
      setActivityPage(activityTotalPages);
    }
  }, [activityPage, activityTotalPages]);

  const pagedActivity = React.useMemo(() => {
    const start = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
    const end = start + ACTIVITY_PAGE_SIZE;
    return recentActivity.slice(start, end);
  }, [activityPage, recentActivity]);

  const activityRangeStart =
    recentActivity.length === 0
      ? 0
      : (activityPage - 1) * ACTIVITY_PAGE_SIZE + 1;
  const activityRangeEnd = Math.min(
    activityPage * ACTIVITY_PAGE_SIZE,
    recentActivity.length,
  );

  if (allBusy) {
    return (
      <div className="flex items-center justify-center h-72">
        <div className="text-center space-y-3">
          <Spinner className="w-8 h-8 mx-auto" />
          <p className="text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-screen-2xl space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <Card
            key={s.label}
            className="p-4 border border-slate-200 dark:border-slate-800"
          >
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              {s.label}
            </p>
            <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
              {s.value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader
            title="Recent Activity"
            subtitle="All movements across users and processes"
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  refetch();
                  refetchBrds();
                  refetchLogs();
                }}
              >
                Refresh Data
              </Button>
            }
          />
          {!recentActivity.length ? (
            <EmptyState
              icon="🗂️"
              title="No activity yet"
              description="System movement logs will appear here."
            />
          ) : (
            <>
              <div className="divide-y divide-[rgba(26,143,209,0.06)]">
                {pagedActivity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 px-6 py-3.5 hover:bg-[rgba(26,143,209,0.04)] transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {item.description}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {item.tag}
                      </Badge>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {formatTimeAgo(item.at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  {activityRangeStart}-{activityRangeEnd} of{" "}
                  {recentActivity.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activityPage === 1}
                    onClick={() =>
                      setActivityPage((prev) => Math.max(1, prev - 1))
                    }
                  >
                    Prev
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activityPage >= activityTotalPages}
                    onClick={() =>
                      setActivityPage((prev) =>
                        Math.min(activityTotalPages, prev + 1),
                      )
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Users by Role" subtitle="Distribution" />
          <div className="p-6 space-y-4">
            {!stats?.usersByRole?.length ? (
              <EmptyState icon="👤" title="No users yet" />
            ) : (
              stats.usersByRole.map((item) => (
                <div key={item.role}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-slate-500">
                      {ROLE_LABELS[item.role as Role]}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {item.count}
                    </span>
                  </div>
                  <div className="w-full rounded-full h-2 bg-slate-200 dark:bg-slate-800 overflow-hidden">
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
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title="Processing Overview"
            subtitle="File status across the pipeline"
          />
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(stats?.filesByStatus ?? []).map((item) => (
              <div
                key={item.status}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <span className="text-xs text-slate-500">{item.status}</span>
                <Badge
                  className={TASK_STATUS_COLORS[item.status as TaskStatus]}
                >
                  {item.count}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="BRD Sources"
            subtitle="Live list from BRD database"
          />
          {!brds.length ? (
            <EmptyState
              icon="📄"
              title="No BRD sources"
              description="Upload and save BRD sources to populate this list."
            />
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {brds.slice(0, 10).map((src) => (
                <div
                  key={src.id}
                  className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {src.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {src.id} · {src.geography || "—"} ·{" "}
                      {src.format.toUpperCase()} · Updated {src.lastUpdated}
                    </p>
                  </div>
                  <Badge
                    className={
                      BRD_STATUS_BADGE[src.status] ??
                      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }
                  >
                    {src.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
