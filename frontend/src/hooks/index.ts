"use client";
import { useState, useEffect, useCallback } from "react";
import {
  User,
  FileUpload,
  DashboardStats,
  Toast,
  ToastType,
  CreateUserPayload,
  Team,
  TaskAssignment,
  UserLog,
} from "../types";
import {
  usersApi,
  filesApi,
  dashboardApi,
  teamsApi,
  tasksApi,
  userLogsApi,
  authApi,
} from "../services/api";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "response" in e) {
    const axiosErr = e as { response?: { data?: { error?: string } } };
    return axiosErr.response?.data?.error ?? "An error occurred";
  }
  return "An error occurred";
}

// ─── useUsers ──────────────────────────────────────────────
export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { users } = await usersApi.getAll();
      setUsers(users);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createUser = async (data: CreateUserPayload) => {
    const result = await usersApi.create(data);
    await refetch();
    return result;
  };

  const assignTeam = async (id: number, teamId: number | null) => {
    await usersApi.assignTeam(id, teamId);
    await refetch();
  };

  const changeRole = async (id: number, role: string) => {
    await usersApi.changeRole(id, role);
    await refetch();
  };

  const deactivateUser = async (id: number) => {
    await usersApi.deactivate(id);
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, status: "INACTIVE" as const } : u,
      ),
    );
  };

  const activateUser = async (id: number) => {
    await usersApi.activate(id);
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, status: "ACTIVE" as const } : u)),
    );
  };

  const changePassword = async (targetUserId: number, newPassword: string) => {
    return await authApi.changePassword(targetUserId, newPassword);
  };

  const resetPassword = async (targetUserId: number) => {
    return await authApi.resetUserPassword(targetUserId);
  };

  return {
    users,
    isLoading,
    error,
    refetch,
    createUser,
    assignTeam,
    changeRole,
    deactivateUser,
    activateUser,
    changePassword,
    resetPassword,
  };
}

// ─── useTeams ──────────────────────────────────────────────
export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { teams } = await teamsApi.getAll();
      setTeams(teams);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createTeam = async (name: string) => {
    const result = await teamsApi.create(name);
    await refetch();
    return result;
  };

  const updateTeam = async (id: number, name: string) => {
    const result = await teamsApi.update(id, name);
    await refetch();
    return result;
  };

  const deleteTeam = async (id: number) => {
    const result = await teamsApi.delete(id);
    await refetch();
    return result;
  };

  return {
    teams,
    isLoading,
    error,
    refetch,
    createTeam,
    updateTeam,
    deleteTeam,
  };
}

// ─── useTasks ──────────────────────────────────────────────
export function useTasks() {
  const [tasks, setTasks] = useState<TaskAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { tasks } = await tasksApi.getAll();
      setTasks(tasks);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  return { tasks, isLoading, error, refetch };
}

// ─── useUserLogs ───────────────────────────────────────────
export function useUserLogs() {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { logs } = await userLogsApi.getAll();
      setLogs(logs);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  return { logs, isLoading, error, refetch };
}

// ─── useFiles ──────────────────────────────────────────────
export function useFiles() {
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { files } = await filesApi.getAll();
      setFiles(files);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  return { files, isLoading, error, refetch };
}

// ─── useDashboard ──────────────────────────────────────────
export function useDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await dashboardApi.getStats();
      setStats(data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  return { stats, isLoading, error, refetch };
}

// ─── useToast ──────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}
