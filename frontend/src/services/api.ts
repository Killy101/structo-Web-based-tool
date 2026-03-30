import api from "@/app/lib/api";
import {
  AuthResponse,
  User,
  DashboardStats,
  CreateUserPayload,
  CreateUserResponse,
  Team,
  UserRole,
  BaseRoleFeaturePolicy,
  GovernanceSettings,
  OperationsPolicyState,
  TeamRoleFeaturePolicyItem,
  TeamFeatureOption,
  BrdSourceItem,
  UserLog,
  Notification,
  UpdateUserProfilePayload,
  UpdateUserProfileResponse,
} from "../types";

export const getToken = () =>
  typeof window !== "undefined" ? localStorage.getItem("token") : null;
export const setToken = (t: string) => localStorage.setItem("token", t);
export const removeToken = () => localStorage.removeItem("token");

export const authApi = {
  login: (userId: string, password: string) =>
    api
      .post<AuthResponse>("/auth/login", { userId, password })
      .then((r) => r.data),
  me: () => api.get<{ user: User }>("/auth/me").then((r) => r.data),
  changePassword: (targetUserId: number, newPassword: string) =>
    api
      .post<{
        message: string;
      }>("/auth/change-password", { targetUserId, newPassword })
      .then((r) => r.data),
  resetUserPassword: (targetUserId: number) =>
    api
      .post<{
        message: string;
        newPassword: string;
        targetUserId: string;
        emailSent?: boolean;
        emailError?: string;
      }>("/auth/reset-user-password", { targetUserId })
      .then((r) => r.data),
  getPasswordPolicy: () =>
    api
      .get<{
        minPasswordLength: number;
        requireUppercase: boolean;
        requireNumber: boolean;
        minSpecialChars: number;
      }>("/auth/password-policy")
      .then((r) => r.data),
  logout: () =>
    api
      .post<{ message: string }>("/auth/logout")
      .then((r) => r.data),
};

export const usersApi = {
  getAll: () => api.get<{ users: User[] }>("/users").then((r) => r.data),
  create: (data: CreateUserPayload) =>
    api.post<CreateUserResponse>("/users/create", data).then((r) => r.data),
  updateProfile: (id: number, data: UpdateUserProfilePayload) =>
    api
      .patch<UpdateUserProfileResponse>(`/users/${id}/profile`, data)
      .then((r) => r.data),
  assignTeam: (id: number, teamId: number | null) =>
    api
      .patch<{ message: string }>(`/users/${id}/team`, { teamId })
      .then((r) => r.data),
  changeRole: (id: number, role: string) =>
    api
      .patch<{ message: string }>(`/users/${id}/role`, { role })
      .then((r) => r.data),
  deactivate: (id: number) =>
    api
      .patch<{ message: string }>(`/users/${id}/deactivate`)
      .then((r) => r.data),
  activate: (id: number) =>
    api.patch<{ message: string }>(`/users/${id}/activate`).then((r) => r.data),
  assignUserRole: (id: number, userRoleId: number | null) =>
    api
      .patch<{ message: string }>(`/users/${id}/user-role`, { userRoleId })
      .then((r) => r.data),
};

export const teamsApi = {
  getAll: () => api.get<{ teams: Team[] }>("/teams").then((r) => r.data),
  getPolicies: () =>
    api
      .get<{
        policies: TeamRoleFeaturePolicyItem[];
        featureCatalog: TeamFeatureOption[];
      }>("/teams/policies")
      .then((r) => r.data),
  updatePolicy: (teamId: number, role: "ADMIN" | "USER", features: string[]) =>
    api
      .patch<{ message: string }>(`/teams/${teamId}/policies/${role}`, {
        features,
      })
      .then((r) => r.data),
  create: (name: string) =>
    api
      .post<{ message: string; team: Team }>("/teams", { name })
      .then((r) => r.data),
  update: (id: number, name: string) =>
    api
      .patch<{ message: string; team: Team }>(`/teams/${id}`, { name })
      .then((r) => r.data),
  delete: (id: number) =>
    api.delete<{ message: string }>(`/teams/${id}`).then((r) => r.data),
};

export const rolesApi = {
  getAll: () => api.get<{ roles: UserRole[] }>("/roles").then((r) => r.data),
  getBasePolicies: () =>
    api
      .get<{ policies: BaseRoleFeaturePolicy[] }>("/roles/base-policies")
      .then((r) => r.data),
  create: (name: string, features: string[]) =>
    api
      .post<{ message: string; role: UserRole }>("/roles", { name, features })
      .then((r) => r.data),
  update: (id: number, data: { name?: string; features?: string[] }) =>
    api
      .patch<{ message: string; role: UserRole }>(`/roles/${id}`, data)
      .then((r) => r.data),
  updateBasePolicy: (role: "ADMIN" | "USER", features: string[]) =>
    api
      .patch<{
        message: string;
        policy: BaseRoleFeaturePolicy;
      }>(`/roles/base-policies/${role}`, { features })
      .then((r) => r.data),
  delete: (id: number) =>
    api.delete<{ message: string }>(`/roles/${id}`).then((r) => r.data),
};

export const settingsApi = {
  getGovernance: () =>
    api
      .get<{ settings: GovernanceSettings }>("/settings/governance")
      .then((r) => r.data),
  updateGovernance: (payload: GovernanceSettings) =>
    api
      .patch<{ message: string; settings: GovernanceSettings }>(
        "/settings/governance",
        payload,
      )
      .then((r) => r.data),
  getOperationsStatus: () =>
    api
      .get<{ operationsPolicy: OperationsPolicyState; sessionTimeoutMinutes: number }>(
        "/settings/operations-status",
      )
      .then((r) => r.data),
  getGovernanceHistory: () =>
    api
      .get<{ logs: UserLog[] }>("/settings/governance-history")
      .then((r) => r.data),
};

export const userLogsApi = {
  getAll: () => api.get<{ logs: UserLog[] }>("/user-logs").then((r) => r.data),
  getMine: () =>
    api.get<{ logs: UserLog[] }>("/user-logs/my").then((r) => r.data),
};

export const brdApi = {
  getAll: () => api.get<BrdSourceItem[]>("/brd").then((r) => r.data),
  submitQuery: (brdId: string, body: string) =>
    api
      .post<{ message: string; recipients: number }>(`/brd/${brdId}/query`, { body })
      .then((r) => r.data),
};

export const dashboardApi = {
  getStats: () =>
    api.get<DashboardStats>("/dashboard/stats").then((r) => r.data),
};

export const notificationsApi = {
  getAll: () =>
    api
      .get<{ notifications: Notification[]; unreadCount: number }>("/notifications")
      .then((r) => r.data),
  getArchived: () =>
    api
      .get<{ notifications: Notification[] }>("/notifications/archived")
      .then((r) => r.data),
  markRead: (id: number) =>
    api
      .patch<{ notification: Notification }>(`/notifications/${id}/read`)
      .then((r) => r.data),
  markAllRead: () =>
    api
      .patch<{ message: string }>("/notifications/read-all")
      .then((r) => r.data),
  archive: (id: number) =>
    api
      .patch<{ message: string }>(`/notifications/${id}/archive`)
      .then((r) => r.data),
  delete: (id: number) =>
    api.delete<{ message: string }>(`/notifications/${id}`).then((r) => r.data),
};

