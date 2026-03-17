import api from "@/app/lib/api";
import {
  AuthResponse,
  User,
  FileUpload,
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
  TaskAssignment,
  UserLog,
  Notification,
  TaskComment,
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
};

export const usersApi = {
  getAll: () => api.get<{ users: User[] }>("/users").then((r) => r.data),
  create: (data: CreateUserPayload) =>
    api.post<CreateUserResponse>("/users/create", data).then((r) => r.data),
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

export const tasksApi = {
  getAll: () =>
    api.get<{ tasks: TaskAssignment[] }>("/tasks").then((r) => r.data),
  create: (data: {
    title: string;
    description?: string;
    assigneeIds: number[];
    brdFileId?: number;
    dueDate?: string;
  }) =>
    api
      .post<{ message: string; task: TaskAssignment }>("/tasks", data)
      .then((r) => r.data),
  updateProgress: (id: number, percentage: number, status?: string) =>
    api
      .patch<{
        message: string;
        task: TaskAssignment;
      }>(`/tasks/${id}/progress`, { percentage, status })
      .then((r) => r.data),
  delete: (id: number) =>
    api.delete<{ message: string }>(`/tasks/${id}`).then((r) => r.data),
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

export const filesApi = {
  getAll: () => api.get<{ files: FileUpload[] }>("/files").then((r) => r.data),
  upload: (formData: FormData) =>
    api
      .post<{
        message: string;
        file: FileUpload;
      }>("/files/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data),
  process: (id: number) =>
    api.post<{ message: string }>(`/files/${id}/process`).then((r) => r.data),
  submit: (id: number) =>
    api.post<{ message: string }>(`/files/${id}/submit`).then((r) => r.data),
  download: (id: number) => {
    const token = getToken();
    window.open(
      `${process.env.NEXT_PUBLIC_API_URL}/files/${id}/download?token=${token}`,
      "_blank",
    );
  },
  delete: (id: number) =>
    api.delete<{ message: string }>(`/files/${id}`).then((r) => r.data),
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
  markRead: (id: number) =>
    api
      .patch<{ notification: Notification }>(`/notifications/${id}/read`)
      .then((r) => r.data),
  markAllRead: () =>
    api
      .patch<{ message: string }>("/notifications/read-all")
      .then((r) => r.data),
  delete: (id: number) =>
    api.delete<{ message: string }>(`/notifications/${id}`).then((r) => r.data),
};

export const taskCommentsApi = {
  getAll: (taskId: number) =>
    api
      .get<{ comments: TaskComment[] }>(`/tasks/${taskId}/comments`)
      .then((r) => r.data),
  create: (taskId: number, body: string) =>
    api
      .post<{ comment: TaskComment }>(`/tasks/${taskId}/comments`, { body })
      .then((r) => r.data),
  delete: (taskId: number, commentId: number) =>
    api
      .delete<{ message: string }>(`/tasks/${taskId}/comments/${commentId}`)
      .then((r) => r.data),
};
