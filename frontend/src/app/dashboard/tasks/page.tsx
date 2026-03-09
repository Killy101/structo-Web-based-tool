"use client";
import React, { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Modal,
  Select,
  Spinner,
  EmptyState,
  ToastContainer,
} from "../../../components/ui";
import { useTasks, useUsers, useToast } from "../../../hooks";
import { useAuth } from "../../../context/AuthContext";
import {
  ASSIGNMENT_STATUS_COLORS,
  ROLE_LABELS,
  formatDate,
} from "../../../utils";
import { Role, TaskAssignment, User } from "../../../types";

// ─── Static BRD source data (mirrors the BRD registry) ──────────────────────
type BrdStatus = "Reviewed" | "Ready" | "Processing" | "Draft";

interface BrdSource {
  id: string;
  title: string;
  geography: string;
  status: BrdStatus;
  version: string;
  lastUpdated: string;
}

const BRD_SOURCES: BrdSource[] = [
  {
    id: "BRD-001",
    title: "Fair Work Regulations 2009",
    geography: "Australia",
    status: "Reviewed",
    version: "v1.2",
    lastUpdated: "2025-03-15",
  },
  {
    id: "BRD-002",
    title: "Corporations Regulations 2001",
    geography: "Australia",
    status: "Ready",
    version: "v1.1",
    lastUpdated: "2025-03-20",
  },
  {
    id: "BRD-003",
    title: "Taxation Administration Regulations 2017",
    geography: "Australia",
    status: "Processing",
    version: "v1.0",
    lastUpdated: "2025-03-22",
  },
  {
    id: "BRD-004",
    title: "Financial Services Modernisation Act 2024",
    geography: "United Kingdom",
    status: "Draft",
    version: "v0.3",
    lastUpdated: "2025-03-25",
  },
];

const BRD_STATUS_BADGE: Record<BrdStatus, string> = {
  Reviewed:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  Ready:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Processing:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  Draft:
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
};

// ─── Icons ───────────────────────────────────────────────────────────────────
const TagIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" />
  </svg>
);
const TrashIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const UserIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "response" in e) {
    const ax = e as { response?: { data?: { error?: string } } };
    return ax.response?.data?.error ?? "An error occurred";
  }
  return "An error occurred";
}

// ─── Assign Task Modal (Admin) ────────────────────────────────────────────────
function AssignTaskModal({
  brd,
  users,
  onClose,
  onAssign,
}: {
  brd: BrdSource | null;
  users: User[];
  onClose: () => void;
  onAssign: (data: {
    title: string;
    description?: string;
    assigneeIds: number[];
    dueDate?: string;
  }) => Promise<void>;
}) {
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleUser = (userId: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length < 3
          ? [...prev, userId]
          : prev,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brd) return;
    if (selectedUserIds.length === 0) {
      setError("Select at least one user to assign this task to.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onAssign({
        title: `${brd.id}: ${brd.title}`,
        description: description.trim() || `Assigned from BRD source ${brd.id} — ${brd.geography}`,
        assigneeIds: selectedUserIds,
        dueDate: dueDate || undefined,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const assignableUsers = users.filter(
    (u) => u.role !== "SUPER_ADMIN" && u.status === "ACTIVE",
  );

  return (
    <Modal
      isOpen={!!brd}
      onClose={onClose}
      title="Assign Task to User"
      size="md"
    >
      {brd && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* BRD info */}
          <div
            className="rounded-xl p-3 border text-sm"
            style={{
              background: "rgba(26,143,209,0.06)",
              borderColor: "rgba(26,143,209,0.15)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="font-mono text-xs px-2 py-0.5 rounded-md border font-medium"
                style={{
                  background: "rgba(26,143,209,0.1)",
                  borderColor: "rgba(26,143,209,0.2)",
                  color: "#42b4f5",
                }}
              >
                {brd.id}
              </span>
              <Badge className={BRD_STATUS_BADGE[brd.status]}>{brd.status}</Badge>
            </div>
            <p className="font-semibold text-slate-900 dark:text-white">{brd.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {brd.geography} · {brd.version} · Updated {brd.lastUpdated}
            </p>
          </div>

          {/* Assignees */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Assign To <span className="text-red-500">*</span>
              <span className="ml-1 text-xs font-normal text-slate-400">
                (max 3)
              </span>
            </label>
            {assignableUsers.length === 0 ? (
              <p className="text-sm text-slate-400 italic">
                No active users in your team to assign.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {assignableUsers.map((u) => (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      selectedUserIds.includes(u.id)
                        ? "border-[#1a56f0] bg-blue-50 dark:bg-blue-900/20"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      disabled={
                        !selectedUserIds.includes(u.id) &&
                        selectedUserIds.length >= 3
                      }
                      className="w-4 h-4 rounded border-slate-300 text-[#1a56f0]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {u.firstName} {u.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {u.userId} · {ROLE_LABELS[u.role as Role]}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add any additional notes for the assignee…"
              rows={2}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a56f0] resize-none"
            />
          </div>

          {/* Due date */}
          <Input
            label="Due Date (optional)"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Assign Task
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Update Progress Modal (User/Manager) ────────────────────────────────────
function UpdateProgressModal({
  task,
  onClose,
  onUpdate,
}: {
  task: TaskAssignment | null;
  onClose: () => void;
  onUpdate: (id: number, percentage: number, status?: string) => Promise<void>;
}) {
  const [percentage, setPercentage] = useState(task?.percentage ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task) return;
    if (percentage < 0 || percentage > 100) {
      setError("Percentage must be between 0 and 100");
      return;
    }
    setLoading(true);
    try {
      await onUpdate(task.id, percentage);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={!!task} onClose={onClose} title="Update Task Progress" size="sm">
      {task && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
              {task.title}
            </p>
            {task.description && (
              <p className="text-xs text-slate-500">{task.description}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Progress: {percentage}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percentage}
              onChange={(e) => setPercentage(Number(e.target.value))}
              className="w-full accent-[#1a56f0]"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          <div className="w-full rounded-full h-2.5 bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-2.5 rounded-full transition-all duration-300"
              style={{
                width: `${percentage}%`,
                background:
                  percentage === 100
                    ? "#10b981"
                    : percentage > 0
                      ? "#1a8fd1"
                      : "#94a3b8",
              }}
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Update Progress
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Delete Task Confirm Modal ────────────────────────────────────────────────
function DeleteTaskModal({
  task,
  onClose,
  onDelete,
}: {
  task: TaskAssignment | null;
  onClose: () => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!task) return;
    setLoading(true);
    try {
      await onDelete(task.id);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={!!task} onClose={onClose} title="Remove Task" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Are you sure you want to remove the task{" "}
          <span className="font-semibold text-slate-900 dark:text-white">
            &quot;{task?.title}&quot;
          </span>
          ? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={loading}>
            Remove Task
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Admin View — BRD Sources Table ──────────────────────────────────────────
function AdminBrdTable({
  onAssign,
}: {
  onAssign: (brd: BrdSource) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="BRD Sources"
        subtitle="Select a BRD source to assign as a task to team members"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
              {[
                "BRD ID",
                "Document Title",
                "Geography",
                "Status",
                "Version",
                "Last Updated",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {BRD_SOURCES.map((brd, idx) => (
              <tr
                key={brd.id}
                className={`group transition-colors hover:bg-blue-50/60 dark:hover:bg-slate-800/50 ${
                  idx % 2 === 0
                    ? "bg-white dark:bg-transparent"
                    : "bg-slate-50/60 dark:bg-slate-800/20"
                }`}
              >
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs font-normal text-slate-600 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                    <TagIcon />
                    {brd.id}
                  </span>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <span className="text-xs font-light text-slate-900 dark:text-slate-200">
                    {brd.title}
                  </span>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <span className="text-xs font-normal text-slate-700 dark:text-slate-400">
                    {brd.geography}
                  </span>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <Badge
                    className={`inline-flex items-center gap-1.5 font-medium ${BRD_STATUS_BADGE[brd.status]}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        brd.status === "Processing"
                          ? "bg-sky-500 animate-pulse"
                          : brd.status === "Reviewed"
                            ? "bg-violet-600"
                            : brd.status === "Ready"
                              ? "bg-emerald-600"
                              : "bg-slate-500"
                      }`}
                    />
                    {brd.status}
                  </Badge>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <span className="font-mono text-xs font-normal text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                    {brd.version}
                  </span>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <span className="font-mono text-xs font-normal text-slate-600 dark:text-slate-500">
                    {brd.lastUpdated}
                  </span>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-center">
                  <button
                    type="button"
                    onClick={() => onAssign(brd)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#1a8fd1] hover:bg-[#146da3] transition-all shadow-sm hover:shadow-md"
                  >
                    <UserIcon /> Assign
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Assigned Tasks Table (Admin sees all, user sees own) ─────────────────────
function AssignedTasksTable({
  tasks,
  isAdmin,
  onDelete,
  onUpdateProgress,
}: {
  tasks: TaskAssignment[];
  isAdmin: boolean;
  onDelete?: (task: TaskAssignment) => void;
  onUpdateProgress?: (task: TaskAssignment) => void;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="No tasks yet"
        description={
          isAdmin
            ? "Assign a BRD source above to create a task for your team."
            : "You have no tasks assigned to you yet."
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
            {[
              "Task",
              "Assigned To",
              ...(isAdmin ? ["Assigned By"] : []),
              "Status",
              "Progress",
              "Due Date",
              "Actions",
            ].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {tasks.map((task) => (
            <tr
              key={task.id}
              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
            >
              {/* Task title */}
              <td className="px-4 py-3.5 max-w-xs">
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {task.title}
                </p>
                {task.description && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {task.description}
                  </p>
                )}
              </td>

              {/* Assignees */}
              <td className="px-4 py-3.5 whitespace-nowrap">
                <div className="flex flex-wrap gap-1">
                  {task.assignees?.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50"
                    >
                      {a.user.firstName} {a.user.lastName}
                    </span>
                  ))}
                </div>
              </td>

              {/* Assigned by (admin only) */}
              {isAdmin && (
                <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500">
                  {task.createdBy?.firstName} {task.createdBy?.lastName}
                </td>
              )}

              {/* Status */}
              <td className="px-4 py-3.5 whitespace-nowrap">
                <Badge className={ASSIGNMENT_STATUS_COLORS[task.status]}>
                  {task.status.replace("_", " ")}
                </Badge>
              </td>

              {/* Progress bar */}
              <td className="px-4 py-3.5 whitespace-nowrap min-w-[120px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: `${task.percentage}%`,
                        background:
                          task.percentage === 100
                            ? "#10b981"
                            : task.percentage > 0
                              ? "#1a8fd1"
                              : "#94a3b8",
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-500 w-8 text-right">
                    {task.percentage}%
                  </span>
                </div>
              </td>

              {/* Due date */}
              <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500">
                {task.dueDate ? formatDate(task.dueDate) : "—"}
              </td>

              {/* Actions */}
              <td className="px-4 py-3.5 whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  {!isAdmin && onUpdateProgress && (
                    <button
                      type="button"
                      onClick={() => onUpdateProgress(task)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                    >
                      Update
                    </button>
                  )}
                  {isAdmin && onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(task)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                    >
                      <TrashIcon /> Remove
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const { user } = useAuth();
  const { tasks, isLoading, createTask, updateProgress, deleteTask } = useTasks();
  const { users, isLoading: usersLoading } = useUsers();
  const { toasts, show, dismiss } = useToast();

  const [assignBrd, setAssignBrd] = useState<BrdSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskAssignment | null>(null);
  const [progressTarget, setProgressTarget] = useState<TaskAssignment | null>(null);

  const isAdmin =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAssign = async (data: {
    title: string;
    description?: string;
    assigneeIds: number[];
    dueDate?: string;
  }) => {
    try {
      await createTask(data);
      show("Task assigned successfully", "success");
    } catch (err) {
      show(getErrorMessage(err), "error");
      throw err;
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTask(id);
      show("Task removed", "success");
    } catch (err) {
      show(getErrorMessage(err), "error");
      throw err;
    }
  };

  const handleUpdateProgress = async (
    id: number,
    percentage: number,
    status?: string,
  ) => {
    try {
      await updateProgress(id, percentage, status);
      show("Progress updated", "success");
    } catch (err) {
      show(getErrorMessage(err), "error");
      throw err;
    }
  };

  // ── Stat summary ──────────────────────────────────────────────────────────
  const pending = tasks.filter((t) => t.status === "PENDING").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;

  if (isLoading || (isAdmin && usersLoading)) {
    return (
      <div className="flex items-center justify-center h-72">
        <div className="text-center space-y-3">
          <Spinner className="w-8 h-8 mx-auto" />
          <p className="text-sm text-slate-500">Loading tasks…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-screen-2xl">
      {/* ── Stat row ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pending", count: pending, color: "bg-amber-500" },
          { label: "In Progress", count: inProgress, color: "bg-[#1a8fd1]" },
          { label: "Completed", count: completed, color: "bg-emerald-500" },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-3 p-4 rounded-2xl border bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 shadow-sm"
          >
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${s.color}`} />
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white leading-none">
                {s.count}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Admin: BRD sources table ── */}
      {isAdmin && (
        <AdminBrdTable onAssign={(brd) => setAssignBrd(brd)} />
      )}

      {/* ── Task assignments table ── */}
      <Card className="overflow-hidden">
        <CardHeader
          title={isAdmin ? "All Assigned Tasks" : "My Assigned Tasks"}
          subtitle={
            isAdmin
              ? "Tasks you have assigned to team members"
              : "Tasks assigned to you — update your progress here"
          }
        />
        <AssignedTasksTable
          tasks={tasks}
          isAdmin={isAdmin}
          onDelete={isAdmin ? (t) => setDeleteTarget(t) : undefined}
          onUpdateProgress={
            !isAdmin ? (t) => setProgressTarget(t) : undefined
          }
        />
      </Card>

      {/* ── Modals ── */}
      <AssignTaskModal
        brd={assignBrd}
        users={users}
        onClose={() => setAssignBrd(null)}
        onAssign={handleAssign}
      />
      <DeleteTaskModal
        task={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />
      <UpdateProgressModal
        task={progressTarget}
        onClose={() => setProgressTarget(null)}
        onUpdate={handleUpdateProgress}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
