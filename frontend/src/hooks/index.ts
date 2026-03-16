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
  UserRole,
  BaseRoleFeaturePolicy,
  TeamRoleFeaturePolicyItem,
  TeamFeatureOption,
  BrdSourceItem,
  TaskAssignment,
  UserLog,
  Notification,
  TaskComment,
} from "../types";
import {
  usersApi,
  filesApi,
  dashboardApi,
  teamsApi,
  rolesApi,
  tasksApi,
  userLogsApi,
  brdApi,
  authApi,
  notificationsApi,
  taskCommentsApi,
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

// ─── useRoles ──────────────────────────────────────────────
export function useRoles() {
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [basePolicies, setBasePolicies] = useState<BaseRoleFeaturePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { roles } = await rolesApi.getAll();
      const { policies } = await rolesApi.getBasePolicies();
      setRoles(roles);
      setBasePolicies(policies);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createRole = async (name: string, features: string[]) => {
    const result = await rolesApi.create(name, features);
    await refetch();
    return result;
  };

  const updateRole = async (
    id: number,
    data: { name?: string; features?: string[] },
  ) => {
    const result = await rolesApi.update(id, data);
    await refetch();
    return result;
  };

  const deleteRole = async (id: number) => {
    const result = await rolesApi.delete(id);
    await refetch();
    return result;
  };

  const updateBasePolicy = async (
    role: "ADMIN" | "USER",
    features: string[],
  ) => {
    const result = await rolesApi.updateBasePolicy(role, features);
    await refetch();
    return result;
  };

  return {
    roles,
    basePolicies,
    isLoading,
    error,
    refetch,
    createRole,
    updateRole,
    updateBasePolicy,
    deleteRole,
  };
}

// ─── useTeamPolicies ──────────────────────────────────────
export function useTeamPolicies() {
  const [policies, setPolicies] = useState<TeamRoleFeaturePolicyItem[]>([]);
  const [featureCatalog, setFeatureCatalog] = useState<TeamFeatureOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { policies, featureCatalog } = await teamsApi.getPolicies();
      setPolicies(policies);
      setFeatureCatalog(featureCatalog);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const updatePolicy = async (
    teamId: number,
    role: "ADMIN" | "USER",
    features: string[],
  ) => {
    const result = await teamsApi.updatePolicy(teamId, role, features);
    await refetch();
    return result;
  };

  return {
    policies,
    featureCatalog,
    isLoading,
    error,
    refetch,
    updatePolicy,
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

  const createTask = async (data: {
    title: string;
    description?: string;
    assigneeIds: number[];
    brdFileId?: number;
    dueDate?: string;
  }) => {
    const result = await tasksApi.create(data);
    await refetch();
    return result;
  };

  const updateProgress = async (
    id: number,
    percentage: number,
    status?: string,
  ) => {
    const result = await tasksApi.updateProgress(id, percentage, status);
    await refetch();
    return result;
  };

  const deleteTask = async (id: number) => {
    const result = await tasksApi.delete(id);
    await refetch();
    return result;
  };

  return {
    tasks,
    isLoading,
    error,
    refetch,
    createTask,
    updateProgress,
    deleteTask,
  };
}

// ─── useUserLogs ───────────────────────────────────────────
export function useUserLogs(scope: "all" | "mine" = "all") {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { logs } =
        scope === "all"
          ? await userLogsApi.getAll()
          : await userLogsApi.getMine();
      setLogs(logs);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  return { logs, isLoading, error, refetch };
}

// ─── useBrds ──────────────────────────────────────────────
export function useBrds() {
  const [brds, setBrds] = useState<BrdSourceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await brdApi.getAll();
      setBrds(data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { brds, isLoading, error, refetch };
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

// ─── useNotifications ──────────────────────────────────────
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await notificationsApi.getAll();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const markRead = async (id: number) => {
    await notificationsApi.markRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const remove = async (id: number) => {
    const notif = notifications.find((n) => n.id === id);
    await notificationsApi.delete(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (notif && !notif.isRead) setUnreadCount((c) => Math.max(0, c - 1));
  };

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refetch,
    markRead,
    markAllRead,
    remove,
  };
}

// ─── useTaskComments ───────────────────────────────────────
export function useTaskComments(taskId: number) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await taskCommentsApi.getAll(taskId);
      setComments(data.comments);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addComment = async (body: string) => {
    const { comment } = await taskCommentsApi.create(taskId, body);
    setComments((prev) => [...prev, comment]);
    return comment;
  };

  const deleteComment = async (commentId: number) => {
    await taskCommentsApi.delete(taskId, commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  return { comments, isLoading, error, refetch, addComment, deleteComment };
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
