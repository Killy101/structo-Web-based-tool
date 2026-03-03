"use client";
import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Input,
  Modal,
  Table,
  ToastContainer,
} from "../../../components/ui";
import { useTeams, useToast } from "../../../hooks";
import { Team } from "../../../types";

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
          : (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to create team";
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
          : (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to update team";
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

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
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

// ─── Settings Page ────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { teams, isLoading, createTeam, updateTeam, deleteTeam } = useTeams();
  const { toasts, show, dismiss } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Team | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  const handleCreate = async (name: string) => {
    await createTeam(name);
    show(`Team "${name}" created successfully`, "success");
  };

  const handleUpdate = async (id: number, name: string) => {
    await updateTeam(id, name);
    show(`Team renamed to "${name}"`, "success");
  };

  const handleDelete = async (id: number) => {
    const team = teams.find((t) => t.id === id);
    try {
      await deleteTeam(id);
      show(`Team "${team?.name}" deleted`, "success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Failed to delete team";
      show(msg, "error");
      throw err;
    }
  };

  const columns = [
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
            onClick={() => setEditTarget(row)}
          >
            Rename
          </Button>
          <Button
            size="xs"
            variant="danger"
            onClick={() => setDeleteTarget(row)}
            disabled={(row._count?.members ?? 0) > 0}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

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

      <Card>
        <CardHeader
          title="Teams"
          subtitle="Manage organization teams. Only Super Admins can create or delete teams."
          action={
            <Button size="sm" onClick={() => setShowAdd(true)}>
              + Add Team
            </Button>
          }
        />
        <Table
          columns={columns}
          data={teams}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="No teams yet. Create the first one."
          emptyIcon="👥"
        />
      </Card>

      <AddTeamModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={handleCreate}
      />

      <EditTeamModal
        team={editTarget}
        onClose={() => setEditTarget(null)}
        onUpdate={handleUpdate}
      />

      <DeleteTeamModal
        team={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
