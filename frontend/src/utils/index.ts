import { Role, Status, User } from "../types";

export const normalizeRole = (role: Role | string | null | undefined): Role => {
  const normalized = String(role ?? "").trim().toUpperCase();
  if (normalized === "SADMIN") return "SUPER_ADMIN";
  if (normalized === "SUPER_ADMIN" || normalized === "ADMIN" || normalized === "USER") {
    return normalized as Role;
  }
  return "USER";
};

// ─── ROLE CONFIG ───────────────────────────────────────────
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  SADMIN: "Super Admin",
  ADMIN: "Admin",
  USER: "User",
};

export const ROLE_BADGE_COLORS: Record<Role, string> = {
  SUPER_ADMIN:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  SADMIN:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  ADMIN:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  USER: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export const ROLE_CHART_COLORS: Record<Role, string> = {
  SUPER_ADMIN: "#6366f1",
  SADMIN: "#6366f1",
  ADMIN: "#8b5cf6",
  USER: "#3b82f6",
};

// ─── STATUS CONFIG ─────────────────────────────────────────
export const USER_STATUS_COLORS: Record<Status, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  INACTIVE:
    "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400",
};

// ─── TEAM PERMISSIONS ──────────────────────────────────────
// Team slug → allowed features
export const TEAM_PERMISSIONS: Record<string, string[]> = {
  "pre-production": ["brd-process", "generate-reports", "user-logs"],
  production: ["view-brd", "generate-reports", "user-logs"],
  updating: ["view-brd", "compare", "generate-reports", "user-logs"],
  "post-production": ["brd-process", "generate-reports", "user-logs"],
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
  "dashboard": "Dashboard",
  "brd-process": "BRD Process",
  "brd-view-generate": "BRD View and Generate Sources",
  "compare-basic": "Workflow 1 · Chunk & Compare",
  "compare-merge": "Merge XML Chunks",
  "compare-pdf-xml-only": "Workflow 2 · Compare & Apply",
  "user-logs": "History",
  "user-management": "User Management",
};

// ─── DYNAMIC ROLE DISPLAY ─────────────────────────────────
// Returns the display label for a user, preferring custom role name
export const getUserRoleLabel = (user: Partial<User>): string => {
  if (user.userRole?.name) return user.userRole.name;
  return ROLE_LABELS[normalizeRole(user.role)] ?? user.role ?? "User";
};

// Returns the badge color for a user, using custom role color or base role color
export const getUserRoleBadgeColor = (user: Partial<User>): string => {
  if (user.userRole) {
    return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400";
  }
  return ROLE_BADGE_COLORS[normalizeRole(user.role)] ?? ROLE_BADGE_COLORS.USER;
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
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

// Which roles can a user be changed TO by each actor
export const ALLOWED_TARGET_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

// Who can change/reset passwords for whom
export const CAN_CHANGE_PASSWORD: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

export const canCreate = (actor: Role, target: Role) =>
  CAN_CREATE_ROLES[normalizeRole(actor)]?.includes(normalizeRole(target)) ?? false;

export const canDeactivate = (actor: Role, target: Role) =>
  CAN_DEACTIVATE_ROLES[normalizeRole(actor)]?.includes(normalizeRole(target)) ?? false;

export const canChangeRoleTo = (actor: Role, targetRole: Role) =>
  ALLOWED_TARGET_ROLES[normalizeRole(actor)]?.includes(normalizeRole(targetRole)) ?? false;

export const canChangePassword = (actor: Role, target: Role) =>
  CAN_CHANGE_PASSWORD[normalizeRole(actor)]?.includes(normalizeRole(target)) ?? false;

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
