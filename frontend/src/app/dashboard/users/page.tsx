"use client";
import React, { useState } from "react";
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Select,
  Avatar,
  Table,
  SearchInput,
  EmptyState,
  ToastContainer,
} from "../../../components/ui";
import { useUsers, useTeams, useRoles, useToast } from "../../../hooks/index";
import { useAuth } from "../../../context/AuthContext";
import {
  ROLE_LABELS,
  ROLE_BADGE_COLORS,
  USER_STATUS_COLORS,
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

/* ──────────────────────────────────────────────────────────
   ICON COMPONENTS
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

/* ──────────────────────────────────────────────────────────
   ENHANCED AVATAR — Tailwind-only color palettes
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

function EnhancedAvatar({ user }: { user: Partial<User> }) {
  const name = getDisplayName(user);
  const initials =
    [user.firstName, user.lastName]
      .filter(Boolean)
      .map((n) => n![0])
      .join("")
      .toUpperCase() || (user.userId || "?").slice(0, 2).toUpperCase();

  return (
    <div
      className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold tracking-wide shrink-0 transition-transform group-hover:scale-105 ${getAvatarPalette(name)}`}
    >
      {initials}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   STATUS DOT
   ────────────────────────────────────────────────────────── */

function StatusDot({
  active,
  size = "normal",
}: {
  active: boolean;
  size?: "small" | "normal";
}) {
  return (
    <span
      className={`rounded-full shrink-0 ${
        size === "small" ? "w-1.5 h-1.5" : "w-2 h-2"
      } ${
        active
          ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
          : "bg-slate-400 dark:bg-slate-500"
      }`}
    />
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
        {/* Employee ID */}
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
            3–6 alphanumeric characters (letters &amp; numbers only)
          </p>
        </div>

        {/* Names side by side */}
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

        {/* Role */}
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

        {/* Custom Role */}
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

        {/* Feature chips preview */}
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

        {/* Team */}
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

        {/* Password info banner */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3 flex items-start gap-2.5">
          <span className="text-base leading-none mt-px">🔑</span>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            A secure password will be auto-generated. Copy it and share with the
            user directly.
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
   PASSWORD REVEAL MODAL
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
        {/* Success icon */}
        <div className="flex justify-center py-1">
          <CheckCircleIcon />
        </div>

        {/* User info */}
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

        {/* Password display */}
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

        {/* Warning */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3 text-center">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚠️ This password is shown only once. Please copy and share it with
            the user directly.
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
  onResetPassword: (userId: number) => Promise<{
    message: string;
    newPassword: string;
    targetUserId: string;
  }>;
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
        {/* Target user */}
        <div className="text-center pb-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Changing password for{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {getDisplayName(targetUser)}
            </span>{" "}
            <span className="text-slate-400">({targetUser.userId})</span>
          </p>
        </div>

        {/* Reset result */}
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
            {/* Auto-generate */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl p-4 space-y-2.5">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                Auto-generate new password
              </p>
              <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
                Generates a secure random password. You&apos;ll be shown the new
                password to share with the user.
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

            {/* Divider */}
            <div className="flex items-center gap-3.5">
              <hr className="flex-1 border-slate-200 dark:border-slate-700" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                or
              </span>
              <hr className="flex-1 border-slate-200 dark:border-slate-700" />
            </div>

            {/* Manual */}
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
   ASSIGN TEAM MODAL
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
  const [selectedTeamId, setSelectedTeamId] = useState<number>(
    targetUser?.teamId ?? 0,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!targetUser) return;
    setLoading(true);
    setError("");
    try {
      await onAssignTeam(
        targetUser.id,
        selectedTeamId === 0 ? null : selectedTeamId,
      );
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
              Current team: {targetUser.team.name}
            </p>
          )}
        </div>

        <Select
          label="Team"
          value={String(selectedTeamId)}
          onChange={(e) => setSelectedTeamId(parseInt(e.target.value) || 0)}
        >
          <option value="0">— No Team —</option>
          {teams.map((t) => (
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
          >
            Assign Team
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────
   USER ACTIONS DROPDOWN
   ────────────────────────────────────────────────────────── */

function UserActionsDropdown({
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

  const canManagePassword = canChangePassword(actorRole, user.role);
  const canManageRole =
    actorRole === "SUPER_ADMIN" ||
    (actorRole === "ADMIN" && canChangeRoleTo(actorRole, user.role));
  const canManageTeam = actorRole === "SUPER_ADMIN";
  const canToggle =
    canDeactivate(actorRole, user.role) && user.id !== currentUserId;

  const showRoleChange =
    canManageRole && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN"
      ? actorRole === "ADMIN"
        ? true
        : true
      : actorRole === "SUPER_ADMIN" && user.role !== "SUPER_ADMIN";

  const hasAnyAction =
    canManagePassword || showRoleChange || canManageTeam || canToggle;

  if (!hasAnyAction) return null;

  return (
    <div className="relative">
      <button
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:border-slate-200 dark:hover:border-slate-600 transition-all"
        onClick={() => setOpen(!open)}
      >
        <DotsIcon />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-xl shadow-xl shadow-slate-900/5 dark:shadow-black/30 z-50 p-1.5">
            {canManagePassword && (
              <button
                onClick={() => {
                  setOpen(false);
                  onChangePassword(user);
                }}
                className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors flex items-center gap-2.5"
              >
                <KeyIcon />
                Change Password
              </button>
            )}

            {showRoleChange && (
              <button
                onClick={() => {
                  setOpen(false);
                  onChangeRole(user);
                }}
                className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors flex items-center gap-2.5"
              >
                <ShieldIcon />
                Change Role
              </button>
            )}

            {canManageTeam && (
              <button
                onClick={() => {
                  setOpen(false);
                  onAssignTeam(user);
                }}
                className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors flex items-center gap-2.5"
              >
                <UsersGroupIcon />
                Assign Team
              </button>
            )}

            {canToggle && (
              <>
                <div className="mx-2 my-1 h-px bg-slate-100 dark:bg-slate-700" />
                <button
                  onClick={() => {
                    setOpen(false);
                    onToggleStatus(user);
                  }}
                  className={`w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-2.5 ${
                    user.status === "ACTIVE"
                      ? "text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                  }`}
                >
                  <ToggleIcon active={user.status === "ACTIVE"} />
                  {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
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
   MAIN PAGE
   ────────────────────────────────────────────────────────── */

export default function UsersPage() {
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
    refetch,
  } = useUsers();
  const { teams } = useTeams();
  const { roles: customRoles } = useRoles();
  const { toasts, show, dismiss } = useToast();

  const [search, setSearch] = useState("");
  const [roleFilter, setRole] = useState("ALL");
  const [statusFilter, setStatus] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");

  // Modal states
  const [showCreate, setShowCreate] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [genPassword, setGenPwd] = useState("");
  const [newUser, setNewUser] = useState<Partial<User> | null>(null);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [showAssignTeam, setShowAssignTeam] = useState(false);
  const [targetUser, setTargetUser] = useState<User | null>(null);

  const actorRole = (currentUser?.role ?? "USER") as Role;
  const actorTeamId = currentUser?.teamId ?? null;

  // Filter
  const filtered = users.filter((u) => {
    const q =
      `${u.userId ?? ""} ${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
    const matchesSearch = q.includes(search.toLowerCase());
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

  const activeCount = users.filter((u) => u.status === "ACTIVE").length;
  const inactiveCount = users.filter((u) => u.status === "INACTIVE").length;

  const actorTeamName =
    actorRole === "ADMIN" && currentUser?.teamId
      ? (teams.find((team) => team.id === currentUser.teamId)?.name ??
        "Your Team")
      : null;

  const headerTitle =
    actorRole === "SUPER_ADMIN"
      ? "User Management"
      : actorRole === "ADMIN"
        ? "Team Members"
        : "Users";

  const isFiltering =
    search ||
    roleFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    teamFilter !== "ALL";

  // Handlers
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

  // Filter select shared classes
  const filterSelectClasses =
    "px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 hover:border-slate-300 dark:hover:border-slate-600 transition-all cursor-pointer";

  // Table columns
  const columns = [
    {
      key: "user",
      header: "User",
      render: (u: User) => {
        const displayName = getDisplayName(u);
        const hasName = u.firstName || u.lastName;
        return (
          <div className="flex items-center gap-3 group">
            <EnhancedAvatar user={u} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate leading-tight">
                {hasName ? displayName : u.userId}
              </p>
              {hasName && u.userId && (
                <p className="text-[11px] font-medium text-slate-400 mt-0.5 tracking-wide">
                  {u.userId}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "team",
      header: "Team",
      render: (u: User) => (
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {u.team?.name ?? (
            <span className="text-slate-400 italic">No team</span>
          )}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (u: User) => (
        <Badge className={getUserRoleBadgeColor(u)}>
          {getUserRoleLabel(u)}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u: User) => (
        <div className="flex items-center gap-2">
          <StatusDot active={u.status === "ACTIVE"} />
          <span
            className={`text-sm font-medium ${
              u.status === "ACTIVE"
                ? "text-slate-700 dark:text-slate-300"
                : "text-slate-400"
            }`}
          >
            {u.status === "ACTIVE" ? "Active" : "Inactive"}
          </span>
        </div>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (u: User) => (
        <span className="text-xs font-medium text-slate-400">
          {formatDate(u.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (u: User) => (
        <UserActionsDropdown
          user={u}
          actorRole={actorRole}
          currentUserId={currentUser?.id}
          onChangePassword={handleOpenChangePassword}
          onChangeRole={handleOpenChangeRole}
          onAssignTeam={handleOpenAssignTeam}
          onToggleStatus={handleToggle}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5 max-w-screen-xl">
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {headerTitle}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {/* Total pill */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                {users.length}
              </span>
              total
            </span>
            {/* Active pill */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <StatusDot active size="small" />
              <span className="font-semibold">{activeCount}</span>
              active
            </span>
            {/* Inactive pill */}
            {inactiveCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                <StatusDot active={false} size="small" />
                <span className="font-semibold">{inactiveCount}</span>
                inactive
              </span>
            )}
            {/* Team pill for admins */}
            {actorTeamName && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                {actorTeamName}
              </span>
            )}
          </div>
        </div>

        {(CAN_CREATE_ROLES[actorRole]?.length ?? 0) > 0 && (
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon />
            Add User
          </Button>
        )}
      </div>

      {/* ─── Filters ─── */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by ID or name…"
            className="flex-1 min-w-48"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRole(e.target.value)}
            className={filterSelectClasses}
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
          <select
            value={statusFilter}
            onChange={(e) => setStatus(e.target.value)}
            className={filterSelectClasses}
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          {actorRole === "SUPER_ADMIN" && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className={filterSelectClasses}
            >
              <option value="ALL">All Teams</option>
              <option value="NONE">No Team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          {/* Filter result count badge */}
          {isFiltering && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </Card>

      {/* ─── Table ─── */}
      <Card className="overflow-hidden">
        {error ? (
          <EmptyState
            icon="❌"
            title="Failed to load users"
            description={error}
          />
        ) : (
          <Table
            columns={columns}
            data={filtered}
            keyExtractor={(u) => u.id}
            isLoading={isLoading}
            emptyMessage="No users match your search"
            emptyIcon="👥"
          />
        )}
      </Card>

      {/* ─── Modals ─── */}
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

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
