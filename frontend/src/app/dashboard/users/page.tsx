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
import { useUsers, useToast } from "../../../hooks/index";
import { useAuth } from "../../../context/AuthContext";
import {
  ROLE_LABELS,
  ROLE_BADGE_COLORS,
  USER_STATUS_COLORS,
  CAN_CREATE_ROLES,
  canDeactivate,
  formatDate,
  isInnodataEmail,
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

// ─── CREATE USER MODAL ────────────────────────────────────────────────────────
function CreateUserModal({
  isOpen,
  onClose,
  onSuccess,
  actorRole,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (password: string, user: Partial<User>) => void;
  actorRole: Role;
}) {
  const { createUser } = useUsers();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    role: "USER" as Role,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const allowed = CAN_CREATE_ROLES[actorRole] ?? [];

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "Required";
    if (!form.lastName.trim()) e.lastName = "Required";
    if (!form.email.trim()) e.email = "Required";
    else if (!isInnodataEmail(form.email))
      e.email = "Must be an @innodata.com email";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const result = await createUser(form as CreateUserPayload);
      onSuccess(result.generatedPassword, { ...form });
      setForm({ firstName: "", lastName: "", email: "", role: "USER" });
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
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First Name"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            placeholder="Juan"
            error={errors.firstName}
            required
          />
          <Input
            label="Last Name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            placeholder="Dela Cruz"
            error={errors.lastName}
            required
          />
        </div>
        <Input
          label="Innodata Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="juan.delacruz@innodata.com"
          error={errors.email}
          required
        />
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

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            ⚡ A secure password will be auto-generated and sent to the
            user&apos;s Innodata email. The user must change it on first login.
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

// ─── PASSWORD REVEAL MODAL ────────────────────────────────────────────────────
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
            {userData?.firstName} {userData?.lastName}
          </p>
          <p className="text-sm text-slate-500">{userData?.email}</p>
          {userData?.role && (
            <Badge className={`mt-1.5 ${ROLE_BADGE_COLORS[userData.role]}`}>
              {ROLE_LABELS[userData.role]}
            </Badge>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-center mb-2">
            Temporary Password
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
            ⚠️ This password is shown only once. An email has been sent to the
            user.
          </p>
        </div>

        <Button className="w-full justify-center" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { users, isLoading, error, deactivateUser, activateUser } = useUsers();
  const { toasts, show, dismiss } = useToast();

  const [search, setSearch] = useState("");
  const [roleFilter, setRole] = useState("ALL");
  const [statusFilter, setStatus] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [genPassword, setGenPwd] = useState("");
  const [newUser, setNewUser] = useState<Partial<User> | null>(null);

  const actorRole = currentUser?.role ?? "USER";

  const filtered = users.filter((u) => {
    const q = `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase();
    return (
      q.includes(search.toLowerCase()) &&
      (roleFilter === "ALL" || u.role === roleFilter) &&
      (statusFilter === "ALL" || u.status === statusFilter)
    );
  });

  const handleToggle = async (u: User) => {
    try {
      if (u.status === "ACTIVE") {
        await deactivateUser(u.id);
        show(`${u.firstName} ${u.lastName} deactivated`, "success");
      } else {
        await activateUser(u.id);
        show(`${u.firstName} ${u.lastName} activated`, "success");
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
  };

  const columns = [
    {
      key: "user",
      header: "User",
      render: (u: User) => (
        <div className="flex items-center gap-3">
          <Avatar firstName={u.firstName} lastName={u.lastName} />
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {u.firstName} {u.lastName}
            </p>
            <p className="text-xs text-slate-400">{u.email}</p>
          </div>
        </div>
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
        <div className="flex items-center justify-end gap-2">
          {canDeactivate(actorRole, u.role) && u.id !== currentUser?.id && (
            <Button
              variant={u.status === "ACTIVE" ? "danger" : "success"}
              size="sm"
              onClick={() => handleToggle(u)}
            >
              {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
            </Button>
          )}
        </div>
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
            placeholder="Search by name or email…"
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
      />
      <PasswordModal
        isOpen={showPwd}
        onClose={() => setShowPwd(false)}
        password={genPassword}
        userData={newUser}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
