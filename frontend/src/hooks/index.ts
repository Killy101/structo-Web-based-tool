"use client";
import { useState, useEffect, useCallback } from "react";
import {
  User,
  DashboardStats,
  Toast,
  ToastType,
  CreateUserPayload,
  Team,
  UserRole,
  BaseRoleFeaturePolicy,
  GovernanceSettings,
  TeamRoleFeaturePolicyItem,
  TeamFeatureOption,
  BrdSourceItem,
  UserLog,
  Notification,
} from "../types";
import {
  usersApi,
  dashboardApi,
  teamsApi,
  rolesApi,
  settingsApi,
  userLogsApi,
  brdApi,
  authApi,
  notificationsApi,
} from "../services/api";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "response" in e) {
    const axiosErr = e as { response?: { data?: { error?: string } } };
    return axiosErr.response?.data?.error ?? "An error occurred";
  }
  return "An error occurred";
}

// ─── API response cache ────────────────────────────────────
// Module-level TTL cache shared across all hook instances.
// Mutations call invalidateCache() so stale data is never served after a write.
const CACHE_TTL_MS = 30_000;
type CacheEntry = { data: unknown; ts: number };
const apiCache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { apiCache.delete(key); return null; }
  return entry.data as T;
}

function setCached<T>(key: string, data: T): void {
  apiCache.set(key, { data, ts: Date.now() });
}

function invalidateCache(key: string): void {
  apiCache.delete(key);
}

// ─── useUsers ──────────────────────────────────────────────
export function useUsers() {
  const [users, setUsers] = useState<User[]>(() => getCached<User[]>("users") ?? []);
  const [isLoading, setIsLoading] = useState(() => getCached("users") === null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    const silent = options?.silent ?? false;
    const force = options?.force ?? false;
    if (!force) {
      const cached = getCached<User[]>("users");
      if (cached) { setUsers(cached); if (!silent) setIsLoading(false); return; }
    }
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const { users } = await usersApi.getAll();
      setCached("users", users);
      setUsers(users);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refetch({ silent: true });
      }
    }, 30000);

    return () => window.clearInterval(id);
  }, [refetch]);

  const createUser = async (data: CreateUserPayload) => {
    const result = await usersApi.create(data);
    invalidateCache("users");
    await refetch({ force: true });
    return result;
  };

  const updateUserProfile = async (
    id: number,
    data: { userId: string; email: string; firstName: string; lastName: string },
  ) => {
    const result = await usersApi.updateProfile(id, data);
    invalidateCache("users");
    await refetch({ force: true });
    return result;
  };

  const assignTeam = async (id: number, teamId: number | null) => {
    await usersApi.assignTeam(id, teamId);
    invalidateCache("users");
    await refetch({ force: true });
  };

  const changeRole = async (id: number, role: string) => {
    await usersApi.changeRole(id, role);
    invalidateCache("users");
    await refetch({ force: true });
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

  const assignUserRole = async (id: number, userRoleId: number | null) => {
    await usersApi.assignUserRole(id, userRoleId);
    invalidateCache("users");
    await refetch({ force: true });
  };

  return {
    users,
    isLoading,
    error,
    refetch,
    createUser,
    updateUserProfile,
    assignTeam,
    changeRole,
    deactivateUser,
    activateUser,
    changePassword,
    resetPassword,
    assignUserRole,
  };
}

// ─── useTeams ──────────────────────────────────────────────
export function useTeams() {
  const [teams, setTeams] = useState<Team[]>(() => getCached<Team[]>("teams") ?? []);
  const [isLoading, setIsLoading] = useState(() => getCached("teams") === null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force) {
      const cached = getCached<Team[]>("teams");
      if (cached) { setTeams(cached); setIsLoading(false); return; }
    }
    setIsLoading(true);
    setError(null);
    try {
      const { teams } = await teamsApi.getAll();
      setCached("teams", teams);
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
    invalidateCache("teams");
    await refetch({ force: true });
    return result;
  };

  const updateTeam = async (id: number, name: string) => {
    const result = await teamsApi.update(id, name);
    invalidateCache("teams");
    await refetch({ force: true });
    return result;
  };

  const deleteTeam = async (id: number) => {
    const result = await teamsApi.delete(id);
    invalidateCache("teams");
    await refetch({ force: true });
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
type RolesCache = { roles: UserRole[]; policies: BaseRoleFeaturePolicy[] };
export function useRoles() {
  const cached = getCached<RolesCache>("roles");
  const [roles, setRoles] = useState<UserRole[]>(() => cached?.roles ?? []);
  const [basePolicies, setBasePolicies] = useState<BaseRoleFeaturePolicy[]>(() => cached?.policies ?? []);
  const [isLoading, setIsLoading] = useState(() => cached === null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force) {
      const c = getCached<RolesCache>("roles");
      if (c) { setRoles(c.roles); setBasePolicies(c.policies); setIsLoading(false); return; }
    }
    setIsLoading(true);
    setError(null);
    try {
      const { roles } = await rolesApi.getAll();
      const { policies } = await rolesApi.getBasePolicies();
      setCached("roles", { roles, policies });
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
    invalidateCache("roles");
    await refetch({ force: true });
    return result;
  };

  const updateRole = async (
    id: number,
    data: { name?: string; features?: string[] },
  ) => {
    const result = await rolesApi.update(id, data);
    invalidateCache("roles");
    await refetch({ force: true });
    return result;
  };

  const deleteRole = async (id: number) => {
    const result = await rolesApi.delete(id);
    invalidateCache("roles");
    await refetch({ force: true });
    return result;
  };

  const updateBasePolicy = async (
    role: "ADMIN" | "USER",
    features: string[],
  ) => {
    const result = await rolesApi.updateBasePolicy(role, features);
    invalidateCache("roles");
    await refetch({ force: true });
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

// ─── useGovernanceSettings ───────────────────────────────
export function useGovernanceSettings() {
  const [settings, setSettings] = useState<GovernanceSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { settings } = await settingsApi.getGovernance();
      setSettings(settings);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const saveSettings = async (payload: GovernanceSettings) => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await settingsApi.updateGovernance(payload);
      setSettings(result.settings);
      return result;
    } catch (e) {
      setError(getErrorMessage(e));
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    settings,
    isLoading,
    isSaving,
    error,
    refetch,
    saveSettings,
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

// ─── useDashboard ──────────────────────────────────────────
export function useDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(() => getCached<DashboardStats>("dashboard"));
  const [isLoading, setIsLoading] = useState(() => getCached("dashboard") === null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force) {
      const cached = getCached<DashboardStats>("dashboard");
      if (cached) { setStats(cached); setIsLoading(false); return; }
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await dashboardApi.getStats();
      setCached("dashboard", data);
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

  const archive = async (id: number) => {
    // Virtual notifications (negative id) are removed client-side only
    if (id < 0) {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      return;
    }
    await notificationsApi.archive(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    // Also decrement unread if it was unread
    const notif = notifications.find((n) => n.id === id);
    if (notif && !notif.isRead) setUnreadCount((c) => Math.max(0, c - 1));
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refetch();
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refetch,
    markRead,
    markAllRead,
    archive,
    remove,
  };
}

// ─── useGovernanceHistory ────────────────────────────────
export function useGovernanceHistory() {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const { logs } = await settingsApi.getGovernanceHistory();
      setLogs(logs);
    } catch {
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { logs, isLoading, refetch };
}

// ─── usePasswordPolicy ────────────────────────────────────
export function usePasswordPolicy() {
  const [policy, setPolicy] = useState<{
    minPasswordLength: number;
    requireUppercase: boolean;
    requireNumber: boolean;
    minSpecialChars: number;
  } | null>(null);

  useEffect(() => {
    authApi
      .getPasswordPolicy()
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, []);

  return policy;
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
