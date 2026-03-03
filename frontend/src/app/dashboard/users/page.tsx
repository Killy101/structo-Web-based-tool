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
import { useUsers, useTeams, useToast } from "../../../hooks/index";
import { useAuth } from "../../../context/AuthContext";
import {
  ROLE_LABELS,
  ROLE_BADGE_COLORS,
  USER_STATUS_COLORS,
  CAN_CREATE_ROLES,
  ALLOWED_TARGET_ROLES,
  canDeactivate,
  canChangePassword,
  canChangeRoleTo,
  formatDate,
  copyToClipboard,
} from "../../../utils/index";
import { Role, User, CreateUserPayload } from "../../../types";

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

// ═══════════════════════════════════════════════════════════
// CREATE USER MODAL — No email, required firstName/lastName
// ═══════════════════════════════════════════════════════════
function CreateUserModal({
  isOpen,
  onClose,
  onSuccess,
  actorRole,
  teams,
  actorTeamId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (password: string, user: Partial<User>) => void;
  actorRole: Role;
  teams: { id: number; name: string }[];
  actorTeamId: number | null;
}) {
  const { createUser } = useUsers();
  const [form, setForm] = useState({
    userId: "",
    firstName: "",
    lastName: "",
    role: "USER" as Role,
    teamId: actorTeamId ?? 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const allowed = CAN_CREATE_ROLES[actorRole] ?? [];

  const validate = () => {
    const e: Record<string, string> = {};

    if (!form.userId.trim()) {
      e.userId = "Required";
    } else if (!/^[a-zA-Z0-9]{3,6}$/.test(form.userId.trim())) {
      e.userId = "User ID must be 3–6 alphanumeric characters";
    }

    if (!form.firstName.trim()) {
      e.firstName = "First name is required";
    }

    if (!form.lastName.trim()) {
      e.lastName = "Last name is required";
    }

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
      };

      const result = await createUser(payload);
      onSuccess(result.generatedPassword, {
        userId: payload.userId,
        firstName: payload.firstName,
        lastName: payload.lastName,
        role: payload.role,
      });
      setForm({
        userId: "",
        firstName: "",
        lastName: "",
        role: "USER",
        teamId: actorTeamId ?? 0,
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
        {/* User ID */}
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
        <p className="text-xs text-slate-400 -mt-2">
          3 to 6 alphanumeric characters (letters and numbers only)
        </p>

        {/* First Name — REQUIRED */}
        <Input
          label="First Name"
          type="text"
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          placeholder="e.g. Juan"
          error={errors.firstName}
          required
        />

        {/* Last Name — REQUIRED */}
        <Input
          label="Last Name"
          type="text"
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          placeholder="e.g. Dela Cruz"
          error={errors.lastName}
          required
        />

        {/* Role Selector */}
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          required
        >
          {allowed.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>

        {/* Team Selector — SuperAdmin picks any team; Admin auto-assigns own team */}
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
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Team:</span> User will be
              automatically assigned to your team.
            </p>
          </div>
        )}

        {/* Info Banner */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚡ A secure password will be auto-generated. Copy it and share with
            the user directly.
          </p>
        </div>

        {errors.submit && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p className="text-sm text-red-600 dark:text-red-400">
              {errors.submit}
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
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

// ═══════════════════════════════════════════════════════════
// PASSWORD REVEAL MODAL (after creating user)
// ═══════════════════════════════════════════════════════════
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
        <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full mx-auto">
          <span className="text-3xl">✅</span>
        </div>

        <div className="text-center">
          <p className="font-semibold text-slate-900 dark:text-white">
            {userData?.userId}
          </p>
          {(userData?.firstName || userData?.lastName) && (
            <p className="text-sm text-slate-500 mt-0.5">
              {userData?.firstName} {userData?.lastName}
            </p>
          )}
          {userData?.role && (
            <Badge className={`mt-2 ${ROLE_BADGE_COLORS[userData.role]}`}>
              {ROLE_LABELS[userData.role]}
            </Badge>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-center mb-2">
            Generated Password
          </p>
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center justify-between gap-3">
            <code className="text-lg font-mono font-bold text-[#1a56f0] tracking-widest">
              {password}
            </code>
            <button
              onClick={handleCopy}
              className="text-sm font-medium text-slate-500 hover:text-[#1a56f0] transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
              {copied ? "✓ Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 text-center">
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

// ═══════════════════════════════════════════════════════════
// CHANGE PASSWORD MODAL
// ═══════════════════════════════════════════════════════════
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
        <div className="text-center pb-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Changing password for{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {getDisplayName(targetUser)}
            </span>{" "}
            ({targetUser.userId})
          </p>
        </div>

        {/* Reset result display */}
        {resetResult && (
          <div className="space-y-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-3 text-center">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-2">
                Password reset successfully!
              </p>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex items-center justify-between">
                <code className="text-lg font-mono font-bold text-[#1a56f0] tracking-widest">
                  {resetResult}
                </code>
                <button
                  onClick={handleCopyReset}
                  className="text-sm font-medium text-slate-500 hover:text-[#1a56f0] transition-colors px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"
                >
                  {copied ? "✓ Copied!" : "Copy"}
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
            {/* Auto-generate reset */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl p-4">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
                Auto-generate new password
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-3">
                Generates a secure random password. You&apos;ll be shown the new
                password to share with the user.
              </p>
              <Button
                size="sm"
                onClick={handleAutoReset}
                loading={loading}
                className="w-full justify-center"
              >
                Reset & Generate Password
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <hr className="flex-1 border-slate-200 dark:border-slate-700" />
              <span className="text-xs text-slate-400 uppercase tracking-wider">
                or
              </span>
              <hr className="flex-1 border-slate-200 dark:border-slate-700" />
            </div>

            {/* Manual password change */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
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
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
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

// ═══════════════════════════════════════════════════════════
// CHANGE ROLE MODAL
// ═══════════════════════════════════════════════════════════
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
        <div className="text-center pb-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Changing role for{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {getDisplayName(targetUser)}
            </span>
          </p>
          <Badge className={`mt-2 ${ROLE_BADGE_COLORS[targetUser.role]}`}>
            Current: {ROLE_LABELS[targetUser.role]}
          </Badge>
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
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
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

// ═══════════════════════════════════════════════════════════
// ASSIGN TEAM MODAL
// ═══════════════════════════════════════════════════════════
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
        <div className="text-center pb-2">
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
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
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

// ═══════════════════════════════════════════════════════════
// USER DETAIL / ACTION DROPDOWN
// ═══════════════════════════════════════════════════════════
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

  // Admin cannot change role to ADMIN — only SuperAdmin can
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
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(!open)}
        className="px-2"
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
            strokeWidth={2}
            d="M12 5v.01M12 12v.01M12 19v.01"
          />
        </svg>
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
            {canManagePassword && (
              <button
                onClick={() => {
                  setOpen(false);
                  onChangePassword(user);
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                  />
                </svg>
                Change Password
              </button>
            )}

            {showRoleChange && (
              <button
                onClick={() => {
                  setOpen(false);
                  onChangeRole(user);
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                Change Role
              </button>
            )}

            {canManageTeam && (
              <button
                onClick={() => {
                  setOpen(false);
                  onAssignTeam(user);
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Assign Team
              </button>
            )}

            {canToggle && (
              <>
                <hr className="border-slate-200 dark:border-slate-700 my-1" />
                <button
                  onClick={() => {
                    setOpen(false);
                    onToggleStatus(user);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                    user.status === "ACTIVE"
                      ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                  }`}
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
                      strokeWidth={2}
                      d={
                        user.status === "ACTIVE"
                          ? "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                          : "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      }
                    />
                  </svg>
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

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════
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

  // Filter users:
  // - Admin sees only their team's users
  // - SuperAdmin sees all
  const filtered = users.filter((u) => {
    const q =
      `${u.userId ?? ""} ${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
    const matchesSearch = q.includes(search.toLowerCase());
    const matchesRole = roleFilter === "ALL" || u.role === roleFilter;
    const matchesStatus = statusFilter === "ALL" || u.status === statusFilter;
    const matchesTeam =
      teamFilter === "ALL" ||
      (teamFilter === "NONE" ? !u.teamId : u.teamId === parseInt(teamFilter));
    return matchesSearch && matchesRole && matchesStatus && matchesTeam;
  });

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

  const columns = [
    {
      key: "user",
      header: "User",
      render: (u: User) => {
        const displayName = getDisplayName(u);
        const hasName = u.firstName || u.lastName;
        return (
          <div className="flex items-center gap-3">
            <Avatar
              firstName={u.firstName ?? u.userId?.[0]}
              lastName={u.lastName ?? u.userId?.[1]}
            />
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {hasName ? displayName : u.userId}
              </p>
              {hasName && u.userId && (
                <p className="text-xs text-slate-400">{u.userId}</p>
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
        <Badge className={ROLE_BADGE_COLORS[u.role]}>
          {ROLE_LABELS[u.role]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u: User) => (
        <Badge className={USER_STATUS_COLORS[u.status]}>{u.status}</Badge>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (u: User) => (
        <span className="text-sm text-slate-500">
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
    <div className="space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            User Management
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {filtered.length} of {users.length} users
            {actorRole === "ADMIN" && currentUser?.teamId && (
              <span className="ml-1">
                •{" "}
                {teams.find((t) => t.id === currentUser.teamId)?.name ??
                  "Your Team"}
              </span>
            )}
          </p>
        </div>
        {(CAN_CREATE_ROLES[actorRole]?.length ?? 0) > 0 && (
          <Button onClick={() => setShowCreate(true)}>
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add User
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by ID or name…"
            className="flex-1 min-w-48"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRole(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1a56f0]"
          >
            <option value="ALL">All Roles</option>
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1a56f0]"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          {actorRole === "SUPER_ADMIN" && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1a56f0]"
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
        </div>
      </Card>

      {/* Table */}
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

      {/* Modals */}
      <CreateUserModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={handleCreateSuccess}
        actorRole={actorRole}
        teams={teams}
        actorTeamId={actorTeamId}
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
