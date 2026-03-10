"use client";
import { useState } from "react";
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
import { useTeams, useRoles, useTeamPolicies, useToast } from "../../../hooks";
import { Team, TeamRoleFeaturePolicyItem, UserRole } from "../../../types";
import { FEATURE_LABELS } from "../../../utils";

// ─── Available features for role configuration ──────────────────────────────
const ALL_FEATURES = Object.entries(FEATURE_LABELS);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Team name is required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onUpdate(team.id, trimmed);
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to update team");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={!!team} onClose={onClose} title="Rename Team" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
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

      {/* ─── Teams Section ─────────────────────────────────────── */}
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

      {/* ─── Team Role Policies Section ─────────────────────────── */}
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

      {/* ─── User Roles Section ────────────────────────────────── */}
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
