"use client";
import React, { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Modal,
  Table,
  ToastContainer,
} from "../../../components/ui";
import Unauthorized from "../../../components/layout/Unauthorized";
import { useAuth } from "../../../context/AuthContext";
import {
  useGovernanceSettings,
  useTeams,
  useRoles,
  useTeamPolicies,
  useToast,
  useGovernanceHistory,
} from "../../../hooks";
import {
  OperationsPolicyState,
  SecurityPolicyState,
  Team,
  TeamRoleFeaturePolicyItem,
  UserRole,
} from "../../../types";
import { FEATURE_LABELS } from "../../../utils";

// ─── Available features for role configuration ──────────────────────────────
const ALL_FEATURES = Object.entries(FEATURE_LABELS);

const DEFAULT_SECURITY_POLICY: SecurityPolicyState = {
  minPasswordLength: 15,
  requireUppercase: true,
  requireNumber: true,
  minSpecialChars: 1,
  rememberedCount: 24,
  minPasswordAgeDays: 7,
  maxPasswordAgeDays: 90,
  sessionTimeoutMinutes: 30,
  enforceMfaForAdmins: false,
};

const DEFAULT_OPERATIONS_POLICY: OperationsPolicyState = {
  maintenanceMode: false,
  strictRateLimitMode: false,
  auditDigestEnabled: true,
};

// ─── Add Team Modal ───────────────────────────────────────────────────────────
function AddTeamModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Team name is required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onCreate(trimmed);
      setName("");
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to create team");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Team" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Team Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. QA Team Alpha"
          error={error}
          required
          autoComplete="off"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create Team
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Edit Team Modal ──────────────────────────────────────────────────────────
function toTeamSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function EditTeamModal({
  team,
  onClose,
  onUpdate,
}: {
  team: Team | null;
  onClose: () => void;
  onUpdate: (id: number, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const prevTeamId = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (team && team.id !== prevTeamId.current) {
      prevTeamId.current = team.id;
      setName(team.name);
      setError("");
      setConfirming(false);
    }
  }, [team]);

  const trimmed = name.trim();
  const newSlug = toTeamSlug(trimmed);
  const slugWillChange = team ? newSlug !== team.slug : false;

  const doSave = async () => {
    if (!team) return;
    setLoading(true);
    try {
      await onUpdate(team.id, trimmed);
      setConfirming(false);
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to update team");
      setError(msg);
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFirstStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) { setError("Team name is required"); return; }
    setError("");
    if (slugWillChange) { setConfirming(true); return; }
    void doSave();
  };

  if (confirming && team) {
    return (
      <Modal isOpen={!!team} onClose={onClose} title="Confirm Team Rename" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
            <p className="font-semibold mb-1">Slug will change</p>
            <p className="text-xs">
              <span className="font-mono">{team.slug}</span>{" → "}
              <span className="font-mono">{newSlug}</span>. Team feature
              policies will be updated automatically.
            </p>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Rename <span className="font-semibold">{team.name}</span> to{" "}
            <span className="font-semibold">{trimmed}</span>?
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} type="button">
              Back
            </Button>
            <Button onClick={() => void doSave()} loading={loading}>
              Confirm Rename
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={!!team} onClose={onClose} title="Rename Team" size="sm">
      <form onSubmit={handleFirstStep} className="space-y-4">
        <Input
          label="Team Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name"
          error={error}
          required
          autoComplete="off"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Delete Team Confirm Modal ───────────────────────────────────────────────
function DeleteTeamModal({
  team,
  onClose,
  onDelete,
}: {
  team: Team | null;
  onClose: () => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!team) return;
    setLoading(true);
    try {
      await onDelete(team.id);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={!!team} onClose={onClose} title="Delete Team" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-slate-900 dark:text-white">
            {team?.name}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={loading}>
            Delete Team
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Add Role Modal ───────────────────────────────────────────────────────────
function AddRoleModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, features: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleFeature = (feature: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(feature)
        ? prev.filter((f) => f !== feature)
        : [...prev, feature],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Role name is required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onCreate(trimmed, selectedFeatures);
      setName("");
      setSelectedFeatures([]);
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to create role");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New User Role">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Role Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Support, Manager QA"
          error={error}
          required
          autoComplete="off"
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Feature Access
          </label>
          <p className="text-xs text-slate-400 mb-3">
            Select which features users with this role can access.
          </p>
          <div className="space-y-2">
            {ALL_FEATURES.map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedFeatures.includes(key)}
                  onChange={() => toggleFeature(key)}
                  className="w-4 h-4 rounded border-slate-300 text-[#1a56f0] focus:ring-[#1a56f0]"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create Role
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Edit Role Modal ──────────────────────────────────────────────────────────
function EditRoleModal({
  role,
  onClose,
  onUpdate,
}: {
  role: UserRole | null;
  onClose: () => void;
  onUpdate: (
    id: number,
    data: { name?: string; features?: string[] },
  ) => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(
    role?.features ?? [],
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleFeature = (feature: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(feature)
        ? prev.filter((f) => f !== feature)
        : [...prev, feature],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Role name is required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onUpdate(role.id, { name: trimmed, features: selectedFeatures });
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to update role");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={!!role} onClose={onClose} title="Edit User Role">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Role Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Role name"
          error={error}
          required
          autoComplete="off"
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Feature Access
          </label>
          <div className="space-y-2">
            {ALL_FEATURES.map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedFeatures.includes(key)}
                  onChange={() => toggleFeature(key)}
                  className="w-4 h-4 rounded border-slate-300 text-[#1a56f0] focus:ring-[#1a56f0]"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Delete Role Confirm Modal ───────────────────────────────────────────────
function DeleteRoleModal({
  role,
  onClose,
  onDelete,
}: {
  role: UserRole | null;
  onClose: () => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!role) return;
    setLoading(true);
    try {
      await onDelete(role.id);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={!!role} onClose={onClose} title="Delete User Role" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-slate-900 dark:text-white">
            {role?.name}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={loading}>
            Delete Role
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const {
    settings: governanceSettings,
    isLoading: governanceLoading,
    isSaving: governanceSaving,
    saveSettings: saveGovernanceSettings,
  } = useGovernanceSettings();
  const {
    teams,
    isLoading: teamsLoading,
    createTeam,
    updateTeam,
    deleteTeam,
  } = useTeams();
  const {
    roles,
    isLoading: rolesLoading,
    createRole,
    updateRole,
    deleteRole,
  } = useRoles();
  const {
    policies: teamPolicies,
    featureCatalog,
    isLoading: teamPoliciesLoading,
    updatePolicy,
  } = useTeamPolicies();
  const { toasts, show, dismiss } = useToast();

  // Team modal states
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [editTeamTarget, setEditTeamTarget] = useState<Team | null>(null);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<Team | null>(null);

  // Role modal states
  const [showAddRole, setShowAddRole] = useState(false);
  const [editRoleTarget, setEditRoleTarget] = useState<UserRole | null>(null);
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<UserRole | null>(
    null,
  );
  const [savingPolicyKey, setSavingPolicyKey] = useState<string | null>(null);
  const [securityPolicy, setSecurityPolicy] =
    useState<SecurityPolicyState>(DEFAULT_SECURITY_POLICY);
  const [operationsPolicy, setOperationsPolicy] =
    useState<OperationsPolicyState>(DEFAULT_OPERATIONS_POLICY);
  const [activeSection, setActiveSection] = useState<
    "governance" | "teams" | "team-policies" | "roles" | "history"
  >("governance");
  const { logs: historyLogs, isLoading: historyLoading } = useGovernanceHistory();

  // ─── Dirty-state tracking ────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!governanceSettings) return;
    setSecurityPolicy(governanceSettings.securityPolicy);
    setOperationsPolicy(governanceSettings.operationsPolicy);
    setIsDirty(false);
  }, [governanceSettings]);

  // Mark dirty whenever user edits local policy state
  useEffect(() => {
    if (!governanceSettings) return;
    const secChanged =
      JSON.stringify(securityPolicy) !==
      JSON.stringify(governanceSettings.securityPolicy);
    const opsChanged =
      JSON.stringify(operationsPolicy) !==
      JSON.stringify(governanceSettings.operationsPolicy);
    setIsDirty(secChanged || opsChanged);
  }, [securityPolicy, operationsPolicy, governanceSettings]);

  // Warn before browser navigation when unsaved changes exist
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Guard section switches when governance changes are unsaved
  const handleSectionChange = (
    next: "governance" | "teams" | "team-policies" | "roles" | "history",
  ) => {
    if (
      isDirty &&
      activeSection === "governance" &&
      next !== "governance" &&
      !window.confirm(
        "You have unsaved governance changes. Leave without saving?",
      )
    ) {
      return;
    }
    setActiveSection(next);
  };

  useEffect(() => {
    if (!governanceLoading && !governanceSettings) {
      show("Failed to load governance settings; defaults are shown", "warning");
    }
  }, [governanceLoading, governanceSettings, show]);

  // ─── Team handlers ──────────────────────────────────────────
  const handleCreateTeam = async (name: string) => {
    await createTeam(name);
    show(`Team "${name}" created successfully`, "success");
  };

  const handleUpdateTeam = async (id: number, name: string) => {
    await updateTeam(id, name);
    show(`Team renamed to "${name}"`, "success");
  };

  const handleDeleteTeam = async (id: number) => {
    const team = teams.find((t) => t.id === id);
    try {
      await deleteTeam(id);
      show(`Team "${team?.name}" deleted`, "success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to delete team");
      show(msg, "error");
      throw err;
    }
  };

  // ─── Role handlers ──────────────────────────────────────────
  const handleCreateRole = async (name: string, features: string[]) => {
    await createRole(name, features);
    show(`User role "${name}" created successfully`, "success");
  };

  const handleUpdateRole = async (
    id: number,
    data: { name?: string; features?: string[] },
  ) => {
    await updateRole(id, data);
    show(`User role updated`, "success");
  };

  const handleDeleteRole = async (id: number) => {
    const role = roles.find((r) => r.id === id);
    try {
      await deleteRole(id);
      show(`User role "${role?.name}" deleted`, "success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to delete role");
      show(msg, "error");
      throw err;
    }
  };

  const handleTeamPolicyToggle = async (
    policy: TeamRoleFeaturePolicyItem,
    role: "ADMIN" | "USER",
    feature: string,
  ) => {
    const current = policy[role].features ?? [];
    const next = current.includes(feature)
      ? current.filter((f) => f !== feature)
      : [...current, feature];

    const key = `${policy.team.id}:${role}`;
    setSavingPolicyKey(key);
    try {
      await updatePolicy(policy.team.id, role, next);
      show(`${policy.team.name} ${role} access updated`, "success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to update team policy");
      show(msg, "error");
    } finally {
      setSavingPolicyKey(null);
    }
  };

  const persistGovernanceConfig = async () => {
    try {
      await saveGovernanceSettings({ securityPolicy, operationsPolicy });
      setIsDirty(false);
      show("Governance settings saved", "success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to save governance settings");
      show(msg, "error");
    }
  };

  // ─── Team columns ──────────────────────────────────────────
  const teamColumns = [
    {
      key: "name",
      header: "Team Name",
      render: (row: Team) => (
        <span className="font-medium text-slate-900 dark:text-white">
          {row.name}
        </span>
      ),
    },
    {
      key: "slug",
      header: "Slug",
      render: (row: Team) => (
        <span className="text-xs font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
          {row.slug}
        </span>
      ),
    },
    {
      key: "members",
      header: "Members",
      render: (row: Team) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row._count?.members ?? 0}
        </span>
      ),
    },
    {
      key: "tasks",
      header: "Tasks",
      render: (row: Team) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row._count?.taskAssignments ?? 0}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (row: Team) => (
        <span className="text-sm text-slate-500">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row: Team) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setEditTeamTarget(row)}
          >
            Rename
          </Button>
          <Button
            size="xs"
            variant="danger"
            onClick={() => setDeleteTeamTarget(row)}
            disabled={(row._count?.members ?? 0) > 0}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // ─── Role columns ──────────────────────────────────────────
  const roleColumns = [
    {
      key: "name",
      header: "Role Name",
      render: (row: UserRole) => (
        <span className="font-medium text-slate-900 dark:text-white">
          {row.name}
        </span>
      ),
    },
    {
      key: "slug",
      header: "Slug",
      render: (row: UserRole) => (
        <span className="text-xs font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
          {row.slug}
        </span>
      ),
    },
    {
      key: "features",
      header: "Features",
      render: (row: UserRole) => (
        <div className="flex flex-wrap gap-1">
          {row.features.length > 0 ? (
            row.features.map((f) => (
              <Badge
                key={f}
                className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs"
              >
                {FEATURE_LABELS[f] ?? f}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-slate-400 italic">No features</span>
          )}
        </div>
      ),
    },
    {
      key: "users",
      header: "Users",
      render: (row: UserRole) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row._count?.users ?? 0}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (row: UserRole) => (
        <span className="text-sm text-slate-500">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row: UserRole) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setEditRoleTarget(row)}
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="danger"
            onClick={() => setDeleteRoleTarget(row)}
            disabled={(row._count?.users ?? 0) > 0}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const teamPolicyColumns = [
    {
      key: "team",
      header: "Team",
      render: (row: TeamRoleFeaturePolicyItem) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-white">
            {row.team.name}
          </p>
          <p className="text-[11px] text-slate-500 font-mono">
            {row.team.slug}
          </p>
        </div>
      ),
    },
    {
      key: "adminFeatures",
      header: "Admin Access",
      render: (row: TeamRoleFeaturePolicyItem) => {
        const isSaving = savingPolicyKey === `${row.team.id}:ADMIN`;
        return (
          <div className="flex flex-wrap gap-2">
            {featureCatalog.map((feature) => {
              const isOn = row.ADMIN.features.includes(feature.key);
              return (
                <label
                  key={`${row.team.id}-ADMIN-${feature.key}`}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    disabled={isSaving}
                    onChange={() =>
                      handleTeamPolicyToggle(row, "ADMIN", feature.key)
                    }
                    className="w-3.5 h-3.5 rounded border-slate-300 text-[#1a56f0] focus:ring-[#1a56f0]"
                  />
                  <span className="text-slate-600 dark:text-slate-300">
                    {feature.label}
                  </span>
                </label>
              );
            })}
            {isSaving && (
              <span className="text-xs text-slate-400 italic">Saving...</span>
            )}
          </div>
        );
      },
    },
    {
      key: "userFeatures",
      header: "User Access",
      render: (row: TeamRoleFeaturePolicyItem) => {
        const isSaving = savingPolicyKey === `${row.team.id}:USER`;
        return (
          <div className="flex flex-wrap gap-2">
            {featureCatalog.map((feature) => {
              const isOn = row.USER.features.includes(feature.key);
              return (
                <label
                  key={`${row.team.id}-USER-${feature.key}`}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    disabled={isSaving}
                    onChange={() =>
                      handleTeamPolicyToggle(row, "USER", feature.key)
                    }
                    className="w-3.5 h-3.5 rounded border-slate-300 text-[#1a56f0] focus:ring-[#1a56f0]"
                  />
                  <span className="text-slate-600 dark:text-slate-300">
                    {feature.label}
                  </span>
                </label>
              );
            })}
            {isSaving && (
              <span className="text-xs text-slate-400 italic">Saving...</span>
            )}
          </div>
        );
      },
    },
  ];

  if (user?.role !== "SUPER_ADMIN") {
    return <Unauthorized />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Settings
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          System configuration — Super Admin only
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full lg:w-64 shrink-0 lg:sticky lg:top-6">
          <Card>
            <div className="p-2 space-y-1">
              {[
                {
                  key: "governance" as const,
                  title: "Governance Controls",
                  subtitle: "Security and operations",
                  icon: "⚙️",
                },
                {
                  key: "teams" as const,
                  title: "Teams",
                  subtitle: "Manage organization teams",
                  icon: "👥",
                },
                {
                  key: "team-policies" as const,
                  title: "Team Feature Access",
                  subtitle: "Configure Admin/User access",
                  icon: "🧩",
                },
                {
                  key: "roles" as const,
                  title: "User Roles",
                  subtitle: "Manage custom feature profiles",
                  icon: "🛡️",
                },
                {
                  key: "history" as const,
                  title: "Change History",
                  subtitle: "Governance audit trail",
                  icon: "📋",
                },
              ].map((item) => {
                const isActive = activeSection === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSectionChange(item.key)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-blue-200 bg-blue-50 dark:border-blue-800/70 dark:bg-blue-900/20"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-base leading-none mt-0.5">{item.icon}</span>
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-semibold flex items-center gap-1.5 ${
                            isActive
                              ? "text-blue-700 dark:text-blue-300"
                              : "text-slate-800 dark:text-slate-100"
                          }`}
                        >
                          {item.title}
                          {item.key === "governance" && isDirty && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                          )}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="flex-1 space-y-6">
          {activeSection === "governance" && (
            <Card>
              <CardHeader
                title="Governance Controls"
                subtitle="Security and operations baselines for Super Admin oversight."
                action={
                  <div className="flex items-center gap-3">
                    {isDirty && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        Unsaved changes
                      </span>
                    )}
                    <Button
                      size="sm"
                      onClick={() => void persistGovernanceConfig()}
                      loading={governanceSaving}
                      disabled={!isDirty}
                    >
                      Save Governance Settings
                    </Button>
                  </div>
                }
              />
              {governanceLoading && (
                <div className="px-6 pb-2 text-xs text-slate-500 dark:text-slate-400">
                  Loading saved governance settings...
                </div>
              )}
              <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Security Policy
                  </h4>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Input
                      label="Min Password Length"
                      type="number"
                      value={String(securityPolicy.minPasswordLength)}
                      onChange={(e) =>
                        setSecurityPolicy((prev) => ({
                          ...prev,
                          minPasswordLength: Math.max(15, Number(e.target.value || 15)),
                        }))
                      }
                    />
                    <Input
                      label="Min Special Characters"
                      type="number"
                      value={String(securityPolicy.minSpecialChars)}
                      onChange={(e) =>
                        setSecurityPolicy((prev) => ({
                          ...prev,
                          minSpecialChars: Math.max(1, Number(e.target.value || 1)),
                        }))
                      }
                    />
                    <Input
                      label="Remember Last Passwords"
                      type="number"
                      value={String(securityPolicy.rememberedCount)}
                      onChange={(e) =>
                        setSecurityPolicy((prev) => ({
                          ...prev,
                          rememberedCount: Math.max(1, Number(e.target.value || 1)),
                        }))
                      }
                    />
                    <Input
                      label="Min Password Age (days)"
                      type="number"
                      value={String(securityPolicy.minPasswordAgeDays)}
                      onChange={(e) =>
                        setSecurityPolicy((prev) => {
                          const minDays = Math.max(0, Number(e.target.value || 0));
                          return {
                            ...prev,
                            minPasswordAgeDays: minDays,
                            maxPasswordAgeDays: Math.max(prev.maxPasswordAgeDays, minDays),
                          };
                        })
                      }
                    />
                    <Input
                      label="Max Password Age (days)"
                      type="number"
                      value={String(securityPolicy.maxPasswordAgeDays)}
                      onChange={(e) =>
                        setSecurityPolicy((prev) => ({
                          ...prev,
                          maxPasswordAgeDays: Math.max(
                            prev.minPasswordAgeDays,
                            Number(e.target.value || prev.minPasswordAgeDays),
                          ),
                        }))
                      }
                    />
                    <Input
                      label="Session Timeout (minutes)"
                      type="number"
                      value={String(securityPolicy.sessionTimeoutMinutes)}
                      onChange={(e) =>
                        setSecurityPolicy((prev) => ({
                          ...prev,
                          sessionTimeoutMinutes: Math.max(5, Number(e.target.value || 5)),
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    {(
                      [
                        ["requireUppercase", "Require uppercase character"],
                        ["requireNumber", "Require numeric character"],
                      ] as [keyof SecurityPolicyState, string][]
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(securityPolicy[key])}
                          onChange={(e) =>
                            setSecurityPolicy((prev) => ({
                              ...prev,
                              [key]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4"
                        />
                        <span className="text-slate-700 dark:text-slate-300">
                          {label}
                        </span>
                      </label>
                    ))}
                    {/* MFA — groundwork only, not yet implemented */}
                    <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 opacity-60">
                      <span className="text-slate-500 dark:text-slate-400">
                        Enforce MFA for admins
                      </span>
                      <span className="text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                        Coming soon
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Operations Policy
                  </h4>
                  <div className="space-y-2">
                    {[
                      ["maintenanceMode", "Enable maintenance mode"],
                      ["strictRateLimitMode", "Enable strict rate-limit mode"],
                      ["auditDigestEnabled", "Enable daily audit digest"],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(
                            operationsPolicy[key as keyof OperationsPolicyState],
                          )}
                          onChange={(e) =>
                            setOperationsPolicy((prev) => ({
                              ...prev,
                              [key]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4"
                        />
                        <span className="text-slate-700 dark:text-slate-300">
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {activeSection === "teams" && (
            <Card>
              <CardHeader
                title="Teams"
                subtitle="Manage organization teams. Only Super Admins can create or delete teams."
                action={
                  <Button size="sm" onClick={() => setShowAddTeam(true)}>
                    + Add Team
                  </Button>
                }
              />
              <Table
                columns={teamColumns}
                data={teams}
                keyExtractor={(row) => row.id}
                isLoading={teamsLoading}
                emptyMessage="No teams yet. Create the first one."
                emptyIcon="👥"
              />
            </Card>
          )}

          {activeSection === "team-policies" && (
            <Card>
              <CardHeader
                title="Team Feature Access"
                subtitle="Configure feature access per team for Admin and User. New teams get default policies automatically and can be edited here."
              />
              <Table
                columns={teamPolicyColumns}
                data={teamPolicies}
                keyExtractor={(row) => row.team.id}
                isLoading={teamPoliciesLoading}
                emptyMessage="No team policies found"
                emptyIcon="🧩"
              />
            </Card>
          )}

          {activeSection === "roles" && (
            <Card>
              <CardHeader
                title="User Roles"
                subtitle="Manage feature access profiles. Assign these roles to Admin and User accounts from User Management."
                action={
                  <Button size="sm" onClick={() => setShowAddRole(true)}>
                    + Add Role
                  </Button>
                }
              />
              <Table
                columns={roleColumns}
                data={roles}
                keyExtractor={(row) => row.id}
                isLoading={rolesLoading}
                emptyMessage="No custom roles yet. Create one to assign specific feature access to users."
                emptyIcon="🛡️"
              />
            </Card>
          )}

          {activeSection === "history" && (
            <Card>
              <CardHeader
                title="Change History"
                subtitle="Last 50 governance settings changes made by Super Admins."
              />
              {historyLoading ? (
                <div className="px-6 py-8 text-sm text-slate-400 dark:text-slate-500 text-center">
                  Loading history…
                </div>
              ) : historyLogs.length === 0 ? (
                <div className="px-6 py-8 text-sm text-slate-400 dark:text-slate-500 text-center">
                  No governance changes recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {historyLogs.map((log) => {
                    const actor = log.user
                      ? `${[log.user.firstName, log.user.lastName].filter(Boolean).join(" ") || log.user.userId}`
                      : `User #${log.userId}`;
                    return (
                      <div key={log.id} className="flex items-start gap-4 px-6 py-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0 text-xs font-bold">
                          {actor.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 dark:text-slate-100">
                            <span className="font-medium">{actor}</span>{" "}
                            updated governance settings
                          </p>
                          {log.details && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {log.details}
                            </p>
                          )}
                        </div>
                        <time className="text-xs text-slate-400 whitespace-nowrap mt-0.5">
                          {new Date(log.createdAt).toLocaleString()}
                        </time>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* ─── Team Modals ──────────────────────────────────────── */}
      <AddTeamModal
        isOpen={showAddTeam}
        onClose={() => setShowAddTeam(false)}
        onCreate={handleCreateTeam}
      />
      <EditTeamModal
        team={editTeamTarget}
        onClose={() => setEditTeamTarget(null)}
        onUpdate={handleUpdateTeam}
      />
      <DeleteTeamModal
        team={deleteTeamTarget}
        onClose={() => setDeleteTeamTarget(null)}
        onDelete={handleDeleteTeam}
      />

      {/* ─── Role Modals ──────────────────────────────────────── */}
      <AddRoleModal
        isOpen={showAddRole}
        onClose={() => setShowAddRole(false)}
        onCreate={handleCreateRole}
      />
      <EditRoleModal
        role={editRoleTarget}
        onClose={() => setEditRoleTarget(null)}
        onUpdate={handleUpdateRole}
      />
      <DeleteRoleModal
        role={deleteRoleTarget}
        onClose={() => setDeleteRoleTarget(null)}
        onDelete={handleDeleteRole}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
