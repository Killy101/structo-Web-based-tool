import { Role, Status, TaskStatus, AssignmentStatus, User } from "../types";

// ─── ROLE CONFIG ───────────────────────────────────────────
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER_QA: "Manager QA",
  MANAGER_QC: "Manager QC",
  USER: "User",
};

export const ROLE_BADGE_COLORS: Record<Role, string> = {
  SUPER_ADMIN:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  ADMIN:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  MANAGER_QA:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MANAGER_QC:
    "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  USER: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export const ROLE_CHART_COLORS: Record<Role, string> = {
  SUPER_ADMIN: "#6366f1",
  ADMIN: "#8b5cf6",
  MANAGER_QA: "#f59e0b",
  MANAGER_QC: "#14b8a6",
  USER: "#3b82f6",
};

// ─── STATUS CONFIG ─────────────────────────────────────────
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  PROCESSING:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  PROCESSED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUBMITTED:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  APPROVED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export const ASSIGNMENT_STATUS_COLORS: Record<AssignmentStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  IN_PROGRESS:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  COMPLETED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

export const USER_STATUS_COLORS: Record<Status, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  INACTIVE:
    "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400",
};

export const FILE_STATUS_HEX: Record<TaskStatus, string> = {
  PENDING: "#f59e0b",
  PROCESSING: "#6366f1",
  PROCESSED: "#3b82f6",
  SUBMITTED: "#8b5cf6",
  APPROVED: "#10b981",
  REJECTED: "#ef4444",
};

// ─── TEAM PERMISSIONS ──────────────────────────────────────
// Team slug → allowed features
export const TEAM_PERMISSIONS: Record<string, string[]> = {
  "pre-production": ["brd-process", "generate-reports", "history", "user-logs"],
  production: ["view-brd", "generate-reports", "history", "user-logs"],
  updating: ["view-brd", "compare", "generate-reports", "history", "user-logs"],
  "post-production": [
    "brd-process",
    "generate-reports",
    "history",
    "user-logs",
  ],
};

export const teamHasAccess = (
  teamSlug: string | undefined,
  feature: string,
): boolean => {
  if (!teamSlug) return false;
  return TEAM_PERMISSIONS[teamSlug]?.includes(feature) ?? false;
};

// ─── TEAM FEATURE LABELS ──────────────────────────────────
export const FEATURE_LABELS: Record<string, string> = {
  "brd-process": "BRD Process",
  "view-brd": "View BRD Sources",
  compare: "Compare",
  "generate-reports": "Generate Reports",
  history: "History",
  "user-logs": "User Logs",
};

// ─── DYNAMIC ROLE DISPLAY ─────────────────────────────────
// Returns the display label for a user, preferring custom role name
export const getUserRoleLabel = (user: Partial<User>): string => {
  if (user.userRole?.name) return user.userRole.name;
  return ROLE_LABELS[user.role as Role] ?? user.role ?? "User";
};

// Returns the badge color for a user, using custom role color or base role color
export const getUserRoleBadgeColor = (user: Partial<User>): string => {
  if (user.userRole) {
    return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400";
  }
  return ROLE_BADGE_COLORS[user.role as Role] ?? ROLE_BADGE_COLORS.USER;
};

// ─── BASE ROLES FOR CREATE USER (simplified) ──────────────
export const BASE_CREATE_ROLES: Role[] = ["ADMIN", "USER"];

// ─── ROLE PERMISSIONS ──────────────────────────────────────
// Who can create which roles
export const CAN_CREATE_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

// Who can deactivate which roles
export const CAN_DEACTIVATE_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "MANAGER_QA", "MANAGER_QC", "USER"],
  ADMIN: ["MANAGER_QA", "MANAGER_QC", "USER"],
};

// Which roles can a user be changed TO by each actor
export const ALLOWED_TARGET_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

// Who can change/reset passwords for whom
export const CAN_CHANGE_PASSWORD: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "MANAGER_QA", "MANAGER_QC", "USER"],
  ADMIN: ["MANAGER_QA", "MANAGER_QC", "USER"],
};

export const canCreate = (actor: Role, target: Role) =>
  CAN_CREATE_ROLES[actor]?.includes(target) ?? false;

export const canDeactivate = (actor: Role, target: Role) =>
  CAN_DEACTIVATE_ROLES[actor]?.includes(target) ?? false;

export const canChangeRoleTo = (actor: Role, targetRole: Role) =>
  ALLOWED_TARGET_ROLES[actor]?.includes(targetRole) ?? false;

export const canChangePassword = (actor: Role, target: Role) =>
  CAN_CHANGE_PASSWORD[actor]?.includes(target) ?? false;

// ─── FORMATTERS ────────────────────────────────────────────
export const formatDate = (date: string | null): string => {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(date));
};

export const formatDateTime = (date: string | null): string => {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatTimeAgo = (date: string): string => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const getInitials = (
  firstName?: string | null,
  lastName?: string | null,
) => `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
