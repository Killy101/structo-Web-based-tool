"use client";
import React, { useEffect, useState, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Select,
  EmptyState,
  ToastContainer,
} from "../../../components/ui";
import { useUsers, useTeams, useRoles, useToast } from "../../../hooks/index";
import { useAuth } from "../../../context/AuthContext";
import {
  ROLE_LABELS,
  CAN_CREATE_ROLES,
  ALLOWED_TARGET_ROLES,
  FEATURE_LABELS,
  canDeactivate,
  canChangePassword,
  canChangeRoleTo,
  getUserRoleLabel,
  getUserRoleBadgeColor,
  formatDate,
  copyToClipboard,
} from "../../../utils/index";
import { Role, User, UserRole, CreateUserPayload } from "../../../types";

/* ──────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────── */

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "response" in e) {
    const axiosErr = e as { response?: { data?: { error?: string } } };
    return axiosErr.response?.data?.error ?? "An error occurred";
  }
  return "An error occurred";
}

function getDisplayName(u: Partial<User>): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.userId || "Unknown";
}

// Check if user was created within the last 7 days
function isNewUser(createdAt: string | Date | undefined): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return created > sevenDaysAgo;
}

// Export filtered users as CSV (client-side, no backend needed)
function exportToCSV(users: User[], filename = "users.csv") {
  const headers = [
    "Employee ID",
    "First Name",
    "Last Name",
    "Role",
    "Team",
    "Status",
    "Created",
  ];
  const rows = users.map((u) => [
    u.userId ?? "",
    u.firstName ?? "",
    u.lastName ?? "",
    getUserRoleLabel(u),
    u.team?.name ?? "",
    u.status,
    u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "",
  ]);
  const csv = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ──────────────────────────────────────────────────────────
   SORT TYPES
   ────────────────────────────────────────────────────────── */

type SortKey = "name" | "role" | "team" | "status" | "created";
type SortDir = "asc" | "desc";
type ToolbarSortKey = "name" | "created";
type UserPresetKey = "default" | "newest" | "active" | "inactive";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/* ──────────────────────────────────────────────────────────
   ICONS
   ────────────────────────────────────────────────────────── */

function PlusIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}

export function GridIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      className="w-4 h-4 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      className="w-4 h-4 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function UsersGroupIcon() {
  return (
    <svg
      className="w-4 h-4 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H5.228A2 2 0 013 17.208V17.13a4.002 4.002 0 013.01-3.878 6.018 6.018 0 013.99.515M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function ToggleIcon({ active }: { active: boolean }) {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      {active ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      )}
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      className="w-14 h-14 text-emerald-500 dark:text-emerald-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
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
  );
}

// Sort indicator icon for table headers
function SortIcon({ dir, active }: { dir: SortDir; active: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-all ${active ? "opacity-100" : "opacity-30"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      {active && dir === "desc" ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      )}
    </svg>
  );
}

// Stat card icons
function UsersIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H5.228A2 2 0 013 17.208V17.13a4.002 4.002 0 013.01-3.878 6.018 6.018 0 013.99.515M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function ActiveIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function InactiveIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

function CheckSquareIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l3 3 5-6" />
    </svg>
  );
}

function ActivateIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function DeactivateIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    </svg>
  );
}

function TeamAssignIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128H5.228A2 2 0 013 17.208V17.13a4.002 4.002 0 013.01-3.878 6.018 6.018 0 013.99.515M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0z"
      />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────
   USER ACTIONS MENU (dots dropdown for table rows)
   ────────────────────────────────────────────────────────── */

function UserActionsMenu({
  user,
  actorRole,
  currentUserId,
  onChangePassword,
  onChangeRole,
  onAssignTeam,
  onToggleStatus,
}: {
  user: User;
  actorRole: Role;
  currentUserId: number | undefined;
  onChangePassword: (u: User) => void;
  onChangeRole: (u: User) => void;
  onAssignTeam: (u: User) => void;
  onToggleStatus: (u: User) => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = user.status === "ACTIVE";
  const isSelf = user.id === currentUserId;

  const canManagePassword = canChangePassword(actorRole, user.role);
  const canManageRole =
    actorRole === "SUPER_ADMIN"
      ? user.role !== "SUPER_ADMIN"
      : actorRole === "ADMIN" && canChangeRoleTo(actorRole, user.role);
  const canManageTeam = actorRole === "SUPER_ADMIN" || actorRole === "ADMIN";
  const canToggle = canDeactivate(actorRole, user.role) && !isSelf;

  if (!canManagePassword && !canManageRole && !canManageTeam && !canToggle)
    return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Actions"
        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
      >
        <DotsIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 p-1.5">
            {canManagePassword && (
              <button
                onClick={() => { setOpen(false); onChangePassword(user); }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg flex items-center gap-2"
              >
                <KeyIcon /> Change Password
              </button>
            )}
            {canManageRole && (
              <button
                onClick={() => { setOpen(false); onChangeRole(user); }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg flex items-center gap-2"
              >
                <ShieldIcon /> Change Role
              </button>
            )}
            {canManageTeam && (
              <button
                onClick={() => { setOpen(false); onAssignTeam(user); }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg flex items-center gap-2"
              >
                <UsersGroupIcon /> Assign Team
              </button>
            )}
            {canToggle && (
              <>
                <div className="mx-2 my-1 h-px bg-slate-100 dark:bg-slate-700" />
                <button
                  onClick={() => { setOpen(false); onToggleStatus(user); }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2 ${isActive ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"}`}
                >
                  <ToggleIcon active={isActive} />
                  {isActive ? "Deactivate" : "Activate"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   AVATAR PALETTES
   ────────────────────────────────────────────────────────── */

const AVATAR_PALETTES = [
  "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300",
  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
  "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
  "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300",
  "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300",
];

function getAvatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

function EnhancedAvatar({
  user,
  size = "md",
}: {
  user: Partial<User>;
  size?: "sm" | "md" | "lg";
}) {
  const name = getDisplayName(user);
  const initials =
    [user.firstName, user.lastName]
      .filter(Boolean)
      .map((n) => n![0])
      .join("")
      .toUpperCase() || (user.userId || "?").slice(0, 2).toUpperCase();
  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-base",
  };
  return (
    <div
      className={`rounded-xl flex items-center justify-center font-bold tracking-wide shrink-0 ${sizeClasses[size]} ${getAvatarPalette(name)}`}
    >
      {initials}
    </div>
  );
}

const STATUS_FILTER_CHIPS = ["ALL", "ACTIVE", "INACTIVE"] as const;
type StatusFilterChip = (typeof STATUS_FILTER_CHIPS)[number];

const STATUS_FILTER_STYLES: Record<
  StatusFilterChip,
  { base: string; active: string }
> = {
  ALL: {
    base: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800",
    active:
      "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-700 dark:border-slate-200",
  },
  ACTIVE: {
    base: "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
    active: "bg-emerald-500 text-white border-emerald-500",
  },
  INACTIVE: {
    base: "border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20",
    active: "bg-rose-500 text-white border-rose-500",
  },
};

function StatusDot({
  active,
  size = "normal",
}: {
  active: boolean;
  size?: "small" | "normal";
}) {
  return (
    <span
      className={`rounded-full shrink-0 ${size === "small" ? "w-1.5 h-1.5" : "w-2 h-2"} ${active ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-slate-400 dark:bg-slate-500"}`}
    />
  );
}

/* ──────────────────────────────────────────────────────────
   SORTABLE TABLE
   Own <table> so headers can be React elements — avoids the
   Col<User> { header: string } constraint on the shared Table.
   ────────────────────────────────────────────────────────── */

const SORT_COLS: { label: string; key: SortKey }[] = [
  { label: "User", key: "name" },
  { label: "Team", key: "team" },
  { label: "Role", key: "role" },
  { label: "Status", key: "status" },
  { label: "Created", key: "created" },
];

function SortableTable({
  data,
  isLoading,
  sortKey,
  sortDir,
  onSort,
  currentUserId,
  onViewDetails,
  onChangePassword,
  onChangeRole,
  onAssignTeam,
  onToggleStatus,
  actorRole,
  selectedUserIds,
  allPageSelected,
  somePageSelected,
  onToggleSelect,
  onToggleSelectAllPage,
}: {
  data: User[];
  isLoading: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  currentUserId: number | undefined;
  onViewDetails: (u: User) => void;
  onChangePassword: (u: User) => void;
  onChangeRole: (u: User) => void;
  onAssignTeam: (u: User) => void;
  onToggleStatus: (u: User) => void;
  actorRole: Role;
  selectedUserIds: Set<number>;
  allPageSelected: boolean;
  somePageSelected: boolean;
  onToggleSelect: (userId: number) => void;
  onToggleSelectAllPage: () => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
            <th className="px-4 py-3 text-left w-10">
              <input
                type="checkbox"
                checked={allPageSelected}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = somePageSelected && !allPageSelected;
                  }
                }}
                onChange={onToggleSelectAllPage}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                aria-label="Select all users on this page"
              />
            </th>

            {SORT_COLS.map(({ label, key }) => {
              const active = sortKey === key;
              return (
                <th
                  key={key}
                  className="px-4 py-3 text-left font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px]"
                >
                  <button
                    onClick={() => onSort(key)}
                    className={`inline-flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wider transition-colors ${
                      active
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    }`}
                  >
                    {label}
                    <SortIcon dir={sortDir} active={active} />
                  </button>
                </th>
              );
            })}

            <th
              className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slat
            e-400 uppercase tracking-widest text-[10px]"
            >
              Actions
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {isLoading ? (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-12 text-center text-slate-400 dark:text-slate-500"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin w-4 h-4 text-blue-500"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      opacity="0.2"
                    />
                    <path
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      opacity="0.8"
                    />
                  </svg>
                  <span className="text-xs font-medium">Loading users...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-12 text-center text-slate-400 dark:text-slate-500"
              >
                <div className="text-2xl mb-2">Users</div>
                <div className="font-medium">No users match your search</div>
              </td>
            </tr>
          ) : (
            data.map((u, idx) => {
              const isSelf = u.id === currentUserId;
              const isActive = u.status === "ACTIVE";
              const hasName = u.firstName || u.lastName;

              return (
                <tr
                  key={u.id}
                  className={`group transition-colors hover:bg-blue-50/60 dark:hover:bg-slate-800/50 ${idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-slate-800/20"}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedUserIds.has(u.id)}
                      onChange={() => onToggleSelect(u.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                      aria-label={`Select ${getDisplayName(u)}`}
                    />
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <EnhancedAvatar user={u} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate leading-tight">
                            {hasName ? getDisplayName(u) : u.userId}
                          </p>
                          {isSelf && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                              You
                            </span>
                          )}
                          {isNewUser(u.createdAt) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                              New
                            </span>
                          )}
                        </div>
                        {hasName && u.userId && (
                          <p className="text-[11px] font-medium text-slate-400 mt-0.5 tracking-wide">
                            {u.userId}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {u.team?.name ?? (
                        <span className="text-slate-400 italic">No team</span>
                      )}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <Badge className={getUserRoleBadgeColor(u)}>
                      {getUserRoleLabel(u)}
                    </Badge>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot active={isActive} />
                      <span
                        className={`text-xs font-medium ${isActive ? "text-slate-700 dark:text-slate-300" : "text-slate-400"}`}
                      >
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-slate-400">
                      {formatDate(u.createdAt)}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onViewDetails(u)}
                        title="View profile"
                        className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                      >
                        <EyeIcon />
                      </button>
                      <UserActionsMenu
                        user={u}
                        actorRole={actorRole}
                        currentUserId={currentUserId}
                        onChangePassword={onChangePassword}
                        onChangeRole={onChangeRole}
                        onAssignTeam={onAssignTeam}
                        onToggleStatus={onToggleStatus}
                      />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   USER DETAIL MODAL
   ────────────────────────────────────────────────────────── */

function UserDetailModal({
  isOpen,
  onClose,
  user,
  actorRole,
  currentUserId,
  onChangePassword,
  onChangeRole,
  onAssignTeam,
  onToggleStatus,
}: {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  actorRole: Role;
  currentUserId: number | undefined;
  onChangePassword: (u: User) => void;
  onChangeRole: (u: User) => void;
  onAssignTeam: (u: User) => void;
  onToggleStatus: (u: User) => void;
}) {
  if (!user) return null;

  const isActive = user.status === "ACTIVE";
  const isSelf = user.id === currentUserId;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="User Details">
      <div className="space-y-5">
        {/* Profile header */}
        <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <EnhancedAvatar user={user} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                {getDisplayName(user)}
              </h3>
              <Badge className={getUserRoleBadgeColor(user)}>
                {getUserRoleLabel(user)}
              </Badge>
              {/* FIX: "You" badge for current user */}
              {isSelf && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  You
                </span>
              )}
              {/* NEW: "New" badge for recently joined users */}
              {isNewUser(user.createdAt) && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                  New
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-slate-400 mt-0.5">
              {user.userId}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <StatusDot active={isActive} />
              <span
                className={`text-xs font-medium ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
              >
                {isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
              Team
            </p>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {user.team?.name ?? (
                <span className="italic text-slate-400">No team</span>
              )}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
              Joined
            </p>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {formatDate(user.createdAt)}
            </p>
          </div>
          {user.userRole && (
            <div className="col-span-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-blue-500 dark:text-blue-400 mb-1">
                Custom Role
              </p>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                {user.userRole.name}
              </p>
              {user.userRole.features?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {user.userRole.features.map((f) => (
                    <span
                      key={f}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300"
                    >
                      {FEATURE_LABELS[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <Button
          variant="secondary"
          className="w-full justify-center"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   USER CARD (grid view)
   ────────────────────────────────────────────────────────── */

export function UserCard({
  user,
  actorRole,
  currentUserId,
  onViewDetails,
  onChangePassword,
  onChangeRole,
  onAssignTeam,
  onToggleStatus,
}: {
  user: User;
  actorRole: Role;
  currentUserId: number | undefined;
  onViewDetails: (u: User) => void;
  onChangePassword: (u: User) => void;
  onChangeRole: (u: User) => void;
  onAssignTeam: (u: User) => void;
  onToggleStatus: (u: User) => void;
}) {
  const isActive = user.status === "ACTIVE";
  const isSelf = user.id === currentUserId;
  const [menuOpen, setMenuOpen] = useState(false);

  const canManagePassword = canChangePassword(actorRole, user.role);
  const canManageRole =
    actorRole === "SUPER_ADMIN" ||
    (actorRole === "ADMIN" && canChangeRoleTo(actorRole, user.role));
  // FIX: consistent with UserDetailModal — both SUPER_ADMIN and ADMIN can manage teams
  const canManageTeam = actorRole === "SUPER_ADMIN" || actorRole === "ADMIN";
  const canToggle = canDeactivate(actorRole, user.role) && !isSelf;
  const showRoleChange =
    actorRole === "SUPER_ADMIN" ? user.role !== "SUPER_ADMIN" : canManageRole;

  return (
    <div
      className={`relative bg-white dark:bg-slate-900 border rounded-2xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 ${isActive ? "border-slate-200 dark:border-slate-800" : "border-slate-200/60 dark:border-slate-800/60 opacity-75"}`}
    >
      <div
        className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl ${isActive ? "bg-gradient-to-r from-emerald-400 to-teal-400" : "bg-slate-200 dark:bg-slate-700"}`}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <EnhancedAvatar user={user} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate leading-tight">
                {getDisplayName(user)}
              </p>
              {/* NEW: "You" badge */}
              {isSelf && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  You
                </span>
              )}
              {/* NEW: "New" badge */}
              {isNewUser(user.createdAt) && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                  New
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
              {user.userId}
            </p>
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          >
            <DotsIcon />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 p-1.5">
                {canManagePassword && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onChangePassword(user);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg flex items-center gap-2"
                  >
                    <KeyIcon /> Change Password
                  </button>
                )}
                {showRoleChange && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onChangeRole(user);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg flex items-center gap-2"
                  >
                    <ShieldIcon /> Change Role
                  </button>
                )}
                {canManageTeam && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onAssignTeam(user);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg flex items-center gap-2"
                  >
                    <UsersGroupIcon /> Assign Team
                  </button>
                )}
                {canToggle && (
                  <>
                    <div className="mx-2 my-1 h-px bg-slate-100 dark:bg-slate-700" />
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onToggleStatus(user);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2 ${isActive ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"}`}
                    >
                      <ToggleIcon active={isActive} />
                      {isActive ? "Deactivate" : "Activate"}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={getUserRoleBadgeColor(user)}>
          {getUserRoleLabel(user)}
        </Badge>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}
        >
          <StatusDot active={isActive} size="small" />
          {isActive ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
        {user.team && (
          <div className="flex items-center gap-2">
            <UsersGroupIcon />
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {user.team.name}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <CalendarIcon />
          <span>Joined {formatDate(user.createdAt)}</span>
        </div>
      </div>

      <button
        onClick={() => onViewDetails(user)}
        className="mt-auto w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
      >
        <EyeIcon />
        View Details
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   CREATE USER MODAL
   ────────────────────────────────────────────────────────── */

function CreateUserModal({
  isOpen,
  onClose,
  onSuccess,
  actorRole,
  teams,
  actorTeamId,
  customRoles,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (password: string, user: Partial<User>) => void;
  actorRole: Role;
  teams: { id: number; name: string }[];
  actorTeamId: number | null;
  customRoles: UserRole[];
}) {
  const { createUser } = useUsers();
  const [form, setForm] = useState({
    userId: "",
    firstName: "",
    lastName: "",
    role: "USER" as Role,
    teamId: actorTeamId ?? 0,
    userRoleId: 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const baseRoles: { value: Role; label: string }[] =
    actorRole === "SUPER_ADMIN"
      ? [
          { value: "ADMIN", label: "Admin" },
          { value: "USER", label: "User" },
        ]
      : [{ value: "USER", label: "User" }];

  const selectedCustomRole = customRoles.find((r) => r.id === form.userRoleId);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.userId.trim()) {
      e.userId = "Required";
    } else if (!/^[a-zA-Z0-9]{3,6}$/.test(form.userId.trim())) {
      e.userId = "Must be 3–6 alphanumeric characters";
    }
    if (!form.firstName.trim()) e.firstName = "Required";
    if (!form.lastName.trim()) e.lastName = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const payload: CreateUserPayload = {
        userId: form.userId.trim().toUpperCase(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        role: form.role,
        teamId: form.teamId || undefined,
        userRoleId: form.userRoleId || undefined,
      };
      const result = await createUser(payload);
      onSuccess(result.generatedPassword, {
        userId: payload.userId,
        firstName: payload.firstName,
        lastName: payload.lastName,
        role: payload.role,
        userRole: selectedCustomRole
          ? {
              id: selectedCustomRole.id,
              name: selectedCustomRole.name,
              slug: selectedCustomRole.slug,
              features: selectedCustomRole.features,
            }
          : undefined,
      });
      setForm({
        userId: "",
        firstName: "",
        lastName: "",
        role: "USER",
        teamId: actorTeamId ?? 0,
        userRoleId: 0,
      });
      setErrors({});
      onClose();
    } catch (e: unknown) {
      setErrors({ submit: getErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New User">
      <div className="space-y-4">
        <div>
          <Input
            label="Employee ID"
            type="text"
            value={form.userId}
            onChange={(e) =>
              setForm({ ...form, userId: e.target.value.toUpperCase() })
            }
            placeholder="e.g. GDT97H"
            error={errors.userId}
            required
          />
          <p className="text-[11px] text-slate-400 mt-1">
            3–6 alphanumeric characters
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First Name"
            type="text"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            placeholder="e.g. Juan"
            error={errors.firstName}
            required
          />
          <Input
            label="Last Name"
            type="text"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            placeholder="e.g. Dela Cruz"
            error={errors.lastName}
            required
          />
        </div>
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          required
        >
          {baseRoles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        {customRoles.length > 0 && (
          <Select
            label="Custom Role (Optional)"
            value={String(form.userRoleId)}
            onChange={(e) =>
              setForm({ ...form, userRoleId: parseInt(e.target.value) || 0 })
            }
          >
            <option value="0">— No Custom Role —</option>
            {customRoles.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
        {selectedCustomRole && selectedCustomRole.features.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">
              Feature Access — {selectedCustomRole.name}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedCustomRole.features.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-100/80 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300"
                >
                  {FEATURE_LABELS[f] ?? f}
                </span>
              ))}
            </div>
          </div>
        )}
        {actorRole === "SUPER_ADMIN" && (
          <Select
            label="Assign to Team"
            value={String(form.teamId)}
            onChange={(e) =>
              setForm({ ...form, teamId: parseInt(e.target.value) || 0 })
            }
          >
            <option value="0">— No Team —</option>
            {teams.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
        {actorRole === "ADMIN" && actorTeamId && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              <span className="font-semibold">Team:</span> User will be
              automatically assigned to your team.
            </p>
          </div>
        )}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3 flex items-start gap-2.5">
          <span className="text-base leading-none mt-px">🔑</span>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            A secure password will be auto-generated.
          </p>
        </div>
        {errors.submit && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3">
            <p className="text-sm text-red-600 dark:text-red-400">
              {errors.submit}
            </p>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            variant="secondary"
            className="flex-1 justify-center"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            onClick={handleSubmit}
            loading={loading}
          >
            Create User
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   PASSWORD MODAL
   ────────────────────────────────────────────────────────── */

function PasswordModal({
  isOpen,
  onClose,
  password,
  userData,
}: {
  isOpen: boolean;
  onClose: () => void;
  password: string;
  userData: Partial<User> | null;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyToClipboard(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="User Created Successfully">
      <div className="space-y-5">
        <div className="flex justify-center py-1">
          <CheckCircleIcon />
        </div>
        <div className="text-center">
          <p className="font-bold text-base text-slate-900 dark:text-white">
            {userData?.userId}
          </p>
          {(userData?.firstName || userData?.lastName) && (
            <p className="text-sm text-slate-500 mt-0.5">
              {userData?.firstName} {userData?.lastName}
            </p>
          )}
          {userData?.role && (
            <div className="mt-2">
              <Badge className={getUserRoleBadgeColor(userData)}>
                {getUserRoleLabel(userData)}
              </Badge>
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-center mb-2 text-slate-400">
            Generated Password
          </p>
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
            <code className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tracking-[0.15em]">
              {password}
            </code>
            <button
              onClick={handleCopy}
              className="text-xs font-semibold text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-500 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3 text-center">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚠️ This password is shown only once.
          </p>
        </div>
        <Button className="w-full justify-center" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   CHANGE PASSWORD MODAL
   ────────────────────────────────────────────────────────── */

function ChangePasswordModal({
  isOpen,
  onClose,
  targetUser,
  onChangePassword,
  onResetPassword,
}: {
  isOpen: boolean;
  onClose: () => void;
  targetUser: User | null;
  onChangePassword: (userId: number, newPassword: string) => Promise<void>;
  onResetPassword: (
    userId: number,
  ) => Promise<{ message: string; newPassword: string; targetUserId: string }>;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleManualChange = async () => {
    setError("");
    if (!newPassword || newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await onChangePassword(targetUser!.id, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAutoReset = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await onResetPassword(targetUser!.id);
      setResetResult(result.newPassword);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyReset = async () => {
    if (resetResult) {
      await copyToClipboard(resetResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const handleClose = () => {
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setResetResult(null);
    setCopied(false);
    onClose();
  };

  if (!targetUser) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Manage Password">
      <div className="space-y-4">
        <div className="text-center pb-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Changing password for{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {getDisplayName(targetUser)}
            </span>{" "}
            <span className="text-slate-400">({targetUser.userId})</span>
          </p>
        </div>
        {resetResult && (
          <div className="space-y-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-4 flex flex-col items-center gap-3">
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                Password reset successfully!
              </p>
              <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 flex items-center justify-between">
                <code className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tracking-[0.15em]">
                  {resetResult}
                </code>
                <button
                  onClick={handleCopyReset}
                  className="text-xs font-semibold text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 px-2.5 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>
            <Button className="w-full justify-center" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
        {!resetResult && (
          <>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl p-4 space-y-2.5">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                Auto-generate new password
              </p>
              <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
                Generates a secure random password.
              </p>
              <Button
                size="sm"
                onClick={handleAutoReset}
                loading={loading}
                className="w-full justify-center"
              >
                Reset &amp; Generate Password
              </Button>
            </div>
            <div className="flex items-center gap-3.5">
              <hr className="flex-1 border-slate-200 dark:border-slate-700" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                or
              </span>
              <hr className="flex-1 border-slate-200 dark:border-slate-700" />
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Set password manually
              </p>
              <Input
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
              />
              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
              />
            </div>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <Button
                variant="secondary"
                className="flex-1 justify-center"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 justify-center"
                onClick={handleManualChange}
                loading={loading}
              >
                Change Password
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   CHANGE ROLE MODAL
   FIX: useEffect to sync selectedRole when targetUser changes
   ────────────────────────────────────────────────────────── */

function ChangeRoleModal({
  isOpen,
  onClose,
  targetUser,
  actorRole,
  onChangeRole,
}: {
  isOpen: boolean;
  onClose: () => void;
  targetUser: User | null;
  actorRole: Role;
  onChangeRole: (userId: number, newRole: string) => Promise<void>;
}) {
  const allowedTargets = ALLOWED_TARGET_ROLES[actorRole] ?? [];
  const [selectedRole, setSelectedRole] = useState<string>(
    targetUser?.role ?? "USER",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // FIX: sync selectedRole whenever targetUser changes so stale data doesn't appear
  useEffect(() => {
    if (targetUser) setSelectedRole(targetUser.role);
  }, [targetUser]);

  const handleSubmit = async () => {
    if (!targetUser || selectedRole === targetUser.role) {
      onClose();
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onChangeRole(targetUser.id, selectedRole);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (!targetUser) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change Role">
      <div className="space-y-4">
        <div className="text-center pb-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Changing role for{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {getDisplayName(targetUser)}
            </span>
          </p>
          <div className="mt-2">
            <Badge className={getUserRoleBadgeColor(targetUser)}>
              Current: {getUserRoleLabel(targetUser)}
            </Badge>
          </div>
        </div>
        <Select
          label="New Role"
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
        >
          {allowedTargets.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            variant="secondary"
            className="flex-1 justify-center"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            onClick={handleSubmit}
            loading={loading}
          >
            Update Role
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   ASSIGN CUSTOM ROLE MODAL
   ────────────────────────────────────────────────────────── */

function AssignCustomRoleModal({
  isOpen,
  onClose,
  targetUser,
  roles,
  onAssign,
}: {
  isOpen: boolean;
  onClose: () => void;
  targetUser: User | null;
  roles: UserRole[];
  onAssign: (userId: number, userRoleId: number | null) => Promise<void>;
}) {
  const TEAM_POLICY_PREFIX = "__TEAM_ROLE_POLICY__";
  const selectableRoles = roles.filter(
    (r) => !r.slug.startsWith(TEAM_POLICY_PREFIX),
  );
  const [selectedId, setSelectedId] = useState<number | null>(
    targetUser?.userRoleId ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (targetUser) setSelectedId(targetUser.userRoleId ?? null);
  }, [targetUser]);

  const handleSubmit = async () => {
    if (!targetUser) return;
    setLoading(true);
    setError("");
    try {
      await onAssign(targetUser.id, selectedId);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (!targetUser) return null;
  const currentRoleName = targetUser.userRole?.name ?? "None";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Custom Role" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Assign a custom feature role to{" "}
          <span className="font-semibold text-slate-900 dark:text-white">
            {getDisplayName(targetUser)}
          </span>
          .{" "}
          <span className="text-xs">
            Currently:{" "}
            <span className="font-medium">{currentRoleName}</span>
          </span>
        </p>

        <Select
          label="Custom Role"
          value={String(selectedId ?? "")}
          onChange={(e) =>
            setSelectedId(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">— No custom role —</option>
          {selectableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>

        {error && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1 justify-center" onClick={handleSubmit} loading={loading}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   ASSIGN TEAM MODAL
   FIX: derive availableTeams inside useEffect using raw teams list
   ────────────────────────────────────────────────────────── */

function AssignTeamModal({
  isOpen,
  onClose,
  targetUser,
  teams,
  onAssignTeam,
}: {
  isOpen: boolean;
  onClose: () => void;
  targetUser: User | null;
  teams: { id: number; name: string }[];
  onAssignTeam: (userId: number, teamId: number | null) => Promise<void>;
}) {
  const [selectedTeamId, setSelectedTeamId] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // FIX: derive availableTeams cleanly from raw teams (not from render-time derived value)
  const availableTeams = teams.filter((t) => t.id !== targetUser?.teamId);

  // FIX: reset selection when targetUser or open state changes using raw teams data
  useEffect(() => {
    const available = teams.filter((t) => t.id !== targetUser?.teamId);
    setSelectedTeamId(available[0]?.id ?? 0);
    setError("");
  }, [targetUser, isOpen, teams]);

  const handleSubmit = async () => {
    if (!targetUser) return;
    if (!selectedTeamId) {
      setError("Please select a team");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onAssignTeam(targetUser.id, selectedTeamId);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (!targetUser) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Team">
      <div className="space-y-4">
        <div className="text-center pb-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Assigning team for{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {getDisplayName(targetUser)}
            </span>
          </p>
          {targetUser.team && (
            <p className="text-xs text-slate-400 mt-1">
              Current team:{" "}
              <span className="font-medium">{targetUser.team.name}</span>
            </p>
          )}
        </div>
        <Select
          label="Team"
          value={String(selectedTeamId)}
          onChange={(e) => setSelectedTeamId(parseInt(e.target.value) || 0)}
        >
          <option value="0">Select a new team</option>
          {availableTeams.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </Select>
        {availableTeams.length === 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No other teams available for reassignment.
            </p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            variant="secondary"
            className="flex-1 justify-center"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            onClick={handleSubmit}
            loading={loading}
            disabled={availableTeams.length === 0}
          >
            Assign Team
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BulkAssignTeamModal({
  isOpen,
  onClose,
  selectedCount,
  teams,
  actorRole,
  actorTeamId,
  onAssign,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  teams: { id: number; name: string }[];
  actorRole: Role;
  actorTeamId: number | null;
  onAssign: (teamId: number | null) => Promise<void>;
}) {
  const [teamId, setTeamId] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const availableTeams =
    actorRole === "ADMIN" ? teams.filter((t) => t.id === actorTeamId) : teams;

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setTeamId(availableTeams[0]?.id ?? 0);
  }, [availableTeams, isOpen]);

  const handleSubmit = async () => {
    if (!teamId) {
      setError("Please select a team");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onAssign(teamId);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Bulk Assign Team">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Assign selected users to a team. Selected users: {selectedCount}
        </p>
        <Select
          label="Team"
          value={String(teamId)}
          onChange={(e) => setTeamId(parseInt(e.target.value, 10) || 0)}
        >
          <option value="0">Select team</option>
          {availableTeams.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </Select>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            variant="secondary"
            className="flex-1 justify-center"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            onClick={handleSubmit}
            loading={loading}
            disabled={availableTeams.length === 0}
          >
            Assign Team
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   MAIN PAGE
   ────────────────────────────────────────────────────────── */

export default function UsersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialQ = searchParams.get("q") ?? "";
  const initialRole = searchParams.get("role") ?? "ALL";
  const initialStatus = searchParams.get("status") ?? "ALL";
  const initialTeam = searchParams.get("team") ?? "ALL";
  const initialSort = (searchParams.get("sort") as SortKey) ?? "name";
  const initialDir = (searchParams.get("dir") as SortDir) ?? "asc";
  const initialPage = parsePositiveInt(searchParams.get("page"), 1);

  const { user: currentUser } = useAuth();
  const {
    users,
    isLoading,
    error,
    deactivateUser,
    activateUser,
    assignTeam,
    changeRole,
    changePassword,
    resetPassword,
    assignUserRole,
    refetch,
  } = useUsers();
  const { teams } = useTeams();
  const { roles: customRoles } = useRoles();
  const { toasts, show, dismiss } = useToast();

  const [search, setSearch] = useState(initialQ);
  const [roleFilter, setRole] = useState(initialRole);
  const [statusFilter, setStatus] = useState(initialStatus);
  const [teamFilter, setTeamFilter] = useState(initialTeam);

  // NEW: pagination state
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [itemsPerPage] = useState(10);

  // NEW: sort state
  const [sortKey, setSortKey] = useState<SortKey>(initialSort);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);
  const [activePreset, setActivePreset] = useState<UserPresetKey>("default");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(
    new Set(),
  );
  const [showBulkAssignTeam, setShowBulkAssignTeam] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);

  const [showCreate, setShowCreate] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [genPassword, setGenPwd] = useState("");
  const [newUser, setNewUser] = useState<Partial<User> | null>(null);

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [showAssignTeam, setShowAssignTeam] = useState(false);
  const [showAssignCustomRole, setShowAssignCustomRole] = useState(false);
  const [targetUser, setTargetUser] = useState<User | null>(null);

  const actorRole = (currentUser?.role ?? "USER") as Role;
  const actorTeamId = currentUser?.teamId ?? null;

  // NEW: sort handler — toggles direction if same key, resets to asc for new key
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Filter change handlers that reset pagination
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setActivePreset("default");
    setCurrentPage(1);
    setSelectedUserIds(new Set());
  };

  const handleRoleChange = (value: string) => {
    setRole(value);
    setActivePreset("default");
    setCurrentPage(1);
    setSelectedUserIds(new Set());
  };

  const handleStatusChange = (value: StatusFilterChip) => {
    setStatus(value);
    setActivePreset("default");
    setCurrentPage(1);
    setSelectedUserIds(new Set());
  };

  const handleTeamChange = (value: string) => {
    setTeamFilter(value);
    setActivePreset("default");
    setCurrentPage(1);
    setSelectedUserIds(new Set());
  };

  const handleToolbarSortChange = (value: ToolbarSortKey) => {
    setSortKey(value);
    setActivePreset("default");
    setCurrentPage(1);
  };

  const handleSortDirectionChange = (value: SortDir) => {
    setSortDir(value);
    setActivePreset("default");
    setCurrentPage(1);
  };

  const applyPreset = (preset: UserPresetKey) => {
    setActivePreset(preset);
    if (preset === "newest") {
      setStatus("ALL");
      setSortKey("created");
      setSortDir("desc");
      setCurrentPage(1);
      return;
    }
    if (preset === "active") {
      setStatus("ACTIVE");
      setSortKey("name");
      setSortDir("asc");
      setCurrentPage(1);
      return;
    }
    if (preset === "inactive") {
      setStatus("INACTIVE");
      setSortKey("created");
      setSortDir("desc");
      setCurrentPage(1);
      return;
    }
    setStatus("ALL");
    setSortKey("name");
    setSortDir("asc");
    setCurrentPage(1);
  };

  // NEW: isFiltering now also checks if any filter is active (used for clear button)
  const isFiltering =
    !!debouncedSearch ||
    roleFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    teamFilter !== "ALL";

  // NEW: clear all filters at once
  const handleClearFilters = () => {
    setSearch("");
    setRole("ALL");
    setStatus("ALL");
    setTeamFilter("ALL");
    setActivePreset("default");
    setCurrentPage(1);
    setSelectedUserIds(new Set());
  };

  // Filter + sort pipeline using useMemo for performance
  const filtered = useMemo(() => {
    const base = users.filter((u) => {
      const q =
        `${u.userId ?? ""} ${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      const matchesSearch = q.includes(debouncedSearch.toLowerCase());
      const matchesRole =
        roleFilter === "ALL" ||
        (roleFilter.startsWith("CUSTOM_")
          ? u.userRoleId === parseInt(roleFilter.replace("CUSTOM_", ""))
          : u.role === roleFilter);
      const matchesStatus = statusFilter === "ALL" || u.status === statusFilter;
      const matchesTeam =
        teamFilter === "ALL" ||
        (teamFilter === "NONE" ? !u.teamId : u.teamId === parseInt(teamFilter));
      return matchesSearch && matchesRole && matchesStatus && matchesTeam;
    });

    // NEW: sorting
    return [...base].sort((a, b) => {
      let aVal = "";
      let bVal = "";
      switch (sortKey) {
        case "name":
          aVal = getDisplayName(a).toLowerCase();
          bVal = getDisplayName(b).toLowerCase();
          break;
        case "role":
          aVal = getUserRoleLabel(a).toLowerCase();
          bVal = getUserRoleLabel(b).toLowerCase();
          break;
        case "team":
          aVal = (a.team?.name ?? "").toLowerCase();
          bVal = (b.team?.name ?? "").toLowerCase();
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "created":
          aVal = a.createdAt ?? "";
          bVal = b.createdAt ?? "";
          break;
      }
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [
    users,
    debouncedSearch,
    roleFilter,
    statusFilter,
    teamFilter,
    sortKey,
    sortDir,
  ]);

  // NEW: Pagination logic
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const effectiveCurrentPage =
    totalPages === 0 ? 1 : Math.min(currentPage, totalPages);
  const startIdx = (effectiveCurrentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedData = filtered.slice(startIdx, endIdx);
  const paginatedIds = useMemo(
    () => paginatedData.map((u) => u.id),
    [paginatedData],
  );

  const allPageSelected =
    paginatedIds.length > 0 &&
    paginatedIds.every((id) => selectedUserIds.has(id));
  const somePageSelected = paginatedIds.some((id) => selectedUserIds.has(id));

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedUserIds.has(u.id)),
    [users, selectedUserIds],
  );

  const canBulkAssignTeam =
    actorRole === "SUPER_ADMIN" || actorRole === "ADMIN";

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set("q", debouncedSearch);
    if (roleFilter !== "ALL") next.set("role", roleFilter);
    if (statusFilter !== "ALL") next.set("status", statusFilter);
    if (teamFilter !== "ALL") next.set("team", teamFilter);
    if (sortKey !== "name") next.set("sort", sortKey);
    if (sortDir !== "asc") next.set("dir", sortDir);
    if (effectiveCurrentPage > 1)
      next.set("page", String(effectiveCurrentPage));

    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [
    effectiveCurrentPage,
    debouncedSearch,
    pathname,
    roleFilter,
    router,
    sortDir,
    sortKey,
    statusFilter,
    teamFilter,
  ]);

  const toggleSelect = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        paginatedIds.forEach((id) => next.delete(id));
      } else {
        paginatedIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedUserIds(new Set());

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 7; // Show max 7 page buttons

    if (totalPages <= maxVisible) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (effectiveCurrentPage > 3) {
        pages.push("...");
      }

      // Show pages around current page
      const start = Math.max(2, effectiveCurrentPage - 1);
      const end = Math.min(totalPages - 1, effectiveCurrentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (effectiveCurrentPage < totalPages - 2) {
        pages.push("...");
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const activeCount = users.filter((u) => u.status === "ACTIVE").length;
  const inactiveCount = users.filter((u) => u.status === "INACTIVE").length;
  const adminCount = users.filter((u) => u.role === "ADMIN").length;
  const userCount = users.filter((u) => u.role === "USER").length;

  const actorTeamName =
    actorRole === "ADMIN" && currentUser?.teamId
      ? (teams.find((team) => team.id === currentUser.teamId)?.name ??
        "Your Team")
      : null;
  const headerTitle =
    actorRole === "SUPER_ADMIN"
      ? "All Users"
      : actorRole === "ADMIN"
        ? "Team Members"
        : "Users";

  const statCards = [
    {
      label: "Total Users",
      value: users.length,
      icon: <UsersIcon />,
      gradient:
        "from-indigo-50 to-blue-50 dark:from-indigo-950/60 dark:to-blue-950/60",
      border: "border-indigo-200 dark:border-indigo-900/50",
      numClass: "text-indigo-800 dark:text-indigo-300",
      lblClass: "text-indigo-600 dark:text-indigo-500",
      iconClass: "text-indigo-400 dark:text-indigo-600",
      iconBg: "bg-indigo-100 dark:bg-indigo-900/50",
    },
    {
      label: "Active",
      value: activeCount,
      icon: <ActiveIcon />,
      gradient:
        "from-emerald-50 to-teal-50 dark:from-emerald-950/60 dark:to-teal-950/60",
      border: "border-emerald-200 dark:border-emerald-900/50",
      numClass: "text-emerald-800 dark:text-emerald-300",
      lblClass: "text-emerald-600 dark:text-emerald-500",
      iconClass: "text-emerald-400 dark:text-emerald-600",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/50",
    },
    {
      label: "Inactive",
      value: inactiveCount,
      icon: <InactiveIcon />,
      gradient:
        inactiveCount > 0
          ? "from-rose-50 to-orange-50 dark:from-rose-950/60 dark:to-orange-950/60"
          : "from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-900",
      border:
        inactiveCount > 0
          ? "border-rose-200 dark:border-rose-900/50"
          : "border-slate-200 dark:border-slate-800",
      // NEW: grey out inactive card when count is 0
      numClass:
        inactiveCount > 0
          ? "text-rose-800 dark:text-rose-300"
          : "text-slate-400 dark:text-slate-600",
      lblClass:
        inactiveCount > 0
          ? "text-rose-600 dark:text-rose-500"
          : "text-slate-400 dark:text-slate-600",
      iconClass:
        inactiveCount > 0
          ? "text-rose-400 dark:text-rose-600"
          : "text-slate-300 dark:text-slate-700",
      iconBg:
        inactiveCount > 0
          ? "bg-rose-100 dark:bg-rose-900/50"
          : "bg-slate-100 dark:bg-slate-800",
    },
    {
      label: actorRole === "SUPER_ADMIN" ? "Admins" : "Users",
      value: actorRole === "SUPER_ADMIN" ? adminCount : userCount,
      icon: <AdminIcon />,
      gradient:
        "from-sky-50 to-cyan-50 dark:from-sky-950/60 dark:to-cyan-950/60",
      border: "border-sky-200 dark:border-sky-900/50",
      numClass: "text-sky-800 dark:text-sky-300",
      lblClass: "text-sky-600 dark:text-sky-500",
      iconClass: "text-sky-400 dark:text-sky-600",
      iconBg: "bg-sky-100 dark:bg-sky-900/50",
    },
  ];

  const handleToggle = async (u: User) => {
    const name = getDisplayName(u);
    try {
      if (u.status === "ACTIVE") {
        await deactivateUser(u.id);
        show(`${name} deactivated`, "success");
      } else {
        await activateUser(u.id);
        show(`${name} activated`, "success");
      }
    } catch (e: unknown) {
      show(getErrorMessage(e), "error");
    }
  };

  const handleCreateSuccess = (pwd: string, data: Partial<User>) => {
    setGenPwd(pwd);
    setNewUser(data);
    setShowPwd(true);
    show("User created successfully!", "success");
    refetch();
  };

  const handleOpenViewDetails = (u: User) => {
    setTargetUser(u);
    setShowDetailModal(true);
  };
  const handleOpenChangePassword = (u: User) => {
    setTargetUser(u);
    setShowChangePassword(true);
  };
  const handleOpenChangeRole = (u: User) => {
    setTargetUser(u);
    setShowChangeRole(true);
  };
  const handleOpenAssignTeam = (u: User) => {
    setTargetUser(u);
    setShowAssignTeam(true);
  };
  const handleOpenAssignCustomRole = (u: User) => {
    setTargetUser(u);
    setShowAssignCustomRole(true);
  };

  const handleChangePassword = async (userId: number, newPassword: string) => {
    await changePassword(userId, newPassword);
    show("Password changed successfully", "success");
  };
  const handleResetPassword = async (userId: number) => {
    const result = await resetPassword(userId);
    show("Password reset successfully", "success");
    return result;
  };
  const handleChangeRole = async (userId: number, newRole: string) => {
    await changeRole(userId, newRole);
    show("Role updated successfully", "success");
    refetch();
  };
  const handleAssignTeam = async (userId: number, teamId: number | null) => {
    await assignTeam(userId, teamId);
    show("Team assignment updated", "success");
    refetch();
  };
  const handleAssignCustomRole = async (
    userId: number,
    userRoleId: number | null,
  ) => {
    await assignUserRole(userId, userRoleId);
    show(
      userRoleId ? "Custom role assigned" : "Custom role cleared",
      "success",
    );
  };

  const handleBulkActivate = async () => {
    const eligible = selectedUsers.filter(
      (u) => u.status !== "ACTIVE" && canDeactivate(actorRole, u.role),
    );
    if (eligible.length === 0) {
      show("No selected users can be activated", "warning");
      return;
    }

    await Promise.all(eligible.map((u) => activateUser(u.id)));
    show(
      `Activated ${eligible.length} user${eligible.length === 1 ? "" : "s"}`,
      "success",
    );
    clearSelection();
    refetch();
  };

  const handleBulkDeactivate = async () => {
    const eligible = selectedUsers.filter(
      (u) =>
        u.status === "ACTIVE" &&
        canDeactivate(actorRole, u.role) &&
        u.id !== currentUser?.id,
    );
    if (eligible.length === 0) {
      show("No selected users can be deactivated", "warning");
      return;
    }

    await Promise.all(eligible.map((u) => deactivateUser(u.id)));
    show(
      `Deactivated ${eligible.length} user${eligible.length === 1 ? "" : "s"}`,
      "success",
    );
    clearSelection();
    refetch();
  };

  const handleBulkAssignTeam = async (teamId: number | null) => {
    const eligible = selectedUsers.filter((u) => {
      if (actorRole === "ADMIN") {
        return u.role !== "ADMIN" && u.role !== "SUPER_ADMIN";
      }
      return u.role !== "SUPER_ADMIN";
    });

    if (eligible.length === 0) {
      show("No selected users can be reassigned", "warning");
      return;
    }

    await Promise.all(eligible.map((u) => assignTeam(u.id, teamId)));
    show(
      `Assigned team for ${eligible.length} user${eligible.length === 1 ? "" : "s"}`,
      "success",
    );
    clearSelection();
    refetch();
  };

  // NEW: Export CSV — exports currently filtered list
  const handleExportCSV = () => {
    exportToCSV(filtered, `users-${new Date().toISOString().slice(0, 10)}.csv`);
    show(
      `Exported ${filtered.length} user${filtered.length !== 1 ? "s" : ""} to CSV`,
      "success",
    );
  };

  const chevronDown = (
    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  );

  const dropdownCls =
    "appearance-none pl-3 pr-7 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-400 cursor-pointer";

  return (
    <div className="h-full w-full min-h-0 flex flex-col text-xs">
      {/* ── BRD-style flat toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
        {/* Left: Refresh + Export */}
        <button
          onClick={refetch}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <RefreshIcon /> <span className="hidden sm:inline">Refresh</span>
        </button>
        <button
          onClick={handleExportCSV}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <DownloadIcon /> <span className="hidden sm:inline">Export CSV</span>
        </button>

        {/* Filters */}
        {actorRole !== "ADMIN" && (
          <div className="relative">
            <select
              value={roleFilter}
              onChange={(e) => handleRoleChange(e.target.value)}
              className={dropdownCls}
            >
              <option value="ALL">All Roles</option>
              <option value="ADMIN">Admin</option>
              <option value="USER">User</option>
              {customRoles.map((r) => (
                <option key={`custom-${r.id}`} value={`CUSTOM_${r.id}`}>
                  {r.name}
                </option>
              ))}
            </select>
            {chevronDown}
          </div>
        )}
        {actorRole === "SUPER_ADMIN" && (
          <div className="relative">
            <select
              value={teamFilter}
              onChange={(e) => handleTeamChange(e.target.value)}
              className={dropdownCls}
            >
              <option value="ALL">All Teams</option>
              <option value="NONE">No Team</option>
              {teams.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
            {chevronDown}
          </div>
        )}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value as StatusFilterChip)}
            className={dropdownCls}
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          {chevronDown}
        </div>
        <div className="relative">
          <select
            value={sortKey === "created" ? "created" : "name"}
            onChange={(e) => handleToolbarSortChange(e.target.value as ToolbarSortKey)}
            className={dropdownCls}
          >
            <option value="name">Sort by Name</option>
            <option value="created">Sort by Date</option>
          </select>
          {chevronDown}
        </div>
        <div className="relative">
          <select
            value={sortDir}
            onChange={(e) => handleSortDirectionChange(e.target.value as SortDir)}
            className={dropdownCls}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          {chevronDown}
        </div>
        {isFiltering && (
          <button
            onClick={handleClearFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <XIcon /> Clear
          </button>
        )}

        {/* Right: search + add */}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-slate-400 pointer-events-none">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
            </span>
            <input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by ID, name…"
              className="pl-8 pr-7 py-1.5 w-44 sm:w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-colors"
            />
            {search && (
              <button
                onClick={() => handleSearchChange("")}
                className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <XIcon />
              </button>
            )}
          </div>
          {(CAN_CREATE_ROLES[actorRole]?.length ?? 0) > 0 && (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon /> Add User
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 py-5 flex flex-col gap-5 overflow-auto">

      {selectedUsers.length > 0 && (
        <Card className="p-3 border-blue-200/70 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-900/10">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800/40 text-xs font-semibold text-blue-700 dark:text-blue-300">
              <CheckSquareIcon />
              {selectedUsers.length} selected
            </span>
            <button
              onClick={handleBulkActivate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"
            >
              <ActivateIcon /> Activate
            </button>
            <button
              onClick={handleBulkDeactivate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all"
            >
              <DeactivateIcon /> Deactivate
            </button>
            {canBulkAssignTeam && (
              <button
                onClick={() => setShowBulkAssignTeam(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-700 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all"
              >
                <TeamAssignIcon /> Assign Team
              </button>
            )}
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
            >
              <XIcon /> Clear
            </button>
          </div>
        </Card>
      )}

      {/* ── Stat Cards (with icons) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div
            key={s.label}
            className={`rounded-2xl p-4 flex items-center gap-3.5 bg-gradient-to-br ${s.gradient} border ${s.border} hover:shadow-md transition-shadow`}
          >
            <div
              className={`w-10 h-10 rounded-xl ${s.iconBg} flex items-center justify-center flex-shrink-0`}
            >
              <div className={`${s.iconClass} opacity-80`}>{s.icon}</div>
            </div>
            <div>
              <div className={`text-2xl font-bold leading-none ${s.numClass}`}>
                {s.value}
              </div>
              <div className={`text-xs mt-1 font-semibold ${s.lblClass}`}>
                {s.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Content: List or Grid ── */}
      {error ? (
        <Card className="overflow-hidden">
          <EmptyState
            icon="❌"
            title="Failed to load users"
            description={error}
          />
        </Card>
      ) : (
        // LIST VIEW with sortable columns
        <Card className="overflow-hidden flex-1 min-h-0">
          <SortableTable
            data={paginatedData}
            isLoading={isLoading}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            currentUserId={currentUser?.id}
            onViewDetails={handleOpenViewDetails}
            onChangePassword={handleOpenChangePassword}
            onChangeRole={handleOpenChangeRole}
            onAssignTeam={handleOpenAssignTeam}
            onToggleStatus={handleToggle}
            actorRole={actorRole}
            selectedUserIds={selectedUserIds}
            allPageSelected={allPageSelected}
            somePageSelected={somePageSelected}
            onToggleSelect={toggleSelect}
            onToggleSelectAllPage={toggleSelectAllPage}
          />
        </Card>
      )}

      {/* ── Pagination ── */}
      {!error && !isLoading && filtered.length > 0 && totalPages > 1 && (
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-600 dark:text-slate-400">
              Showing {startIdx + 1} to {Math.min(endIdx, filtered.length)} of{" "}
              {filtered.length} results
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={effectiveCurrentPage === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Previous
              </button>
              {getPageNumbers().map((page, idx) => (
                <button
                  key={idx}
                  onClick={() =>
                    typeof page === "number" && setCurrentPage(page)
                  }
                  disabled={page === "..."}
                  className={`min-w-[2rem] px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    page === effectiveCurrentPage
                      ? "bg-blue-600 dark:bg-blue-500 text-white shadow-sm"
                      : page === "..."
                        ? "text-slate-400 dark:text-slate-600 cursor-default"
                        : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() =>
                  setCurrentPage((p) =>
                    Math.min(Math.max(totalPages, 1), p + 1),
                  )
                }
                disabled={effectiveCurrentPage === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next
              </button>
            </div>
          </div>
        </Card>
      )}

      </div>{/* end inner content div */}

      {/* ── Modals ── */}
      <CreateUserModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={handleCreateSuccess}
        actorRole={actorRole}
        teams={teams}
        actorTeamId={actorTeamId}
        customRoles={customRoles}
      />
      <PasswordModal
        isOpen={showPwd}
        onClose={() => setShowPwd(false)}
        password={genPassword}
        userData={newUser}
      />

      {/* FIX: setTargetUser(null) restored on detail modal close */}
      <UserDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setTargetUser(null);
        }}
        user={targetUser}
        actorRole={actorRole}
        currentUserId={currentUser?.id}
        onChangePassword={handleOpenChangePassword}
        onChangeRole={handleOpenChangeRole}
        onAssignTeam={handleOpenAssignTeam}
        onToggleStatus={handleToggle}
      />
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => {
          setShowChangePassword(false);
          setTargetUser(null);
        }}
        targetUser={targetUser}
        onChangePassword={handleChangePassword}
        onResetPassword={handleResetPassword}
      />
      <ChangeRoleModal
        isOpen={showChangeRole}
        onClose={() => {
          setShowChangeRole(false);
          setTargetUser(null);
        }}
        targetUser={targetUser}
        actorRole={actorRole}
        onChangeRole={handleChangeRole}
      />
      <AssignTeamModal
        isOpen={showAssignTeam}
        onClose={() => {
          setShowAssignTeam(false);
          setTargetUser(null);
        }}
        targetUser={targetUser}
        teams={teams}
        onAssignTeam={handleAssignTeam}
      />

      <AssignCustomRoleModal
        isOpen={showAssignCustomRole}
        onClose={() => {
          setShowAssignCustomRole(false);
          setTargetUser(null);
        }}
        targetUser={targetUser}
        roles={customRoles}
        onAssign={handleAssignCustomRole}
      />

      <BulkAssignTeamModal
        isOpen={showBulkAssignTeam}
        onClose={() => setShowBulkAssignTeam(false)}
        selectedCount={selectedUsers.length}
        teams={teams}
        actorRole={actorRole}
        actorTeamId={actorTeamId}
        onAssign={handleBulkAssignTeam}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
