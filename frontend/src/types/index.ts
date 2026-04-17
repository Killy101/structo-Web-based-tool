export type Role =
  | "SUPER_ADMIN"
  | "SADMIN"
  | "ADMIN"
  | "USER";
export type Status = "ACTIVE" | "INACTIVE";

export interface UserRole {
  id: number;
  name: string;
  slug: string;
  features: string[];
  createdAt: string;
  updatedAt: string;
  _count?: { users: number };
}

export interface BaseRoleFeaturePolicy {
  id: number;
  role: "ADMIN" | "USER";
  features: string[];
  updatedAt: string;
}

export interface SecurityPolicyState {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireNumber: boolean;
  minSpecialChars: number;
  rememberedCount: number;
  minPasswordAgeDays: number;
  maxPasswordAgeDays: number;
  sessionTimeoutMinutes: number;
  enforceMfaForAdmins: boolean;
}

export interface OperationsPolicyState {
  maintenanceMode: boolean;
  strictRateLimitMode: boolean;
  auditDigestEnabled: boolean;
  maintenanceBannerMessage: string;
  maintenanceWindowStartUtc: string;
  maintenanceWindowEndUtc: string;
  maintenanceLearnMoreUrl: string;
}

export interface GovernanceSettings {
  securityPolicy: SecurityPolicyState;
  operationsPolicy: OperationsPolicyState;
}

export interface TeamFeatureOption {
  key: string;
  label: string;
}

export interface TeamRoleFeaturePolicyItem {
  team: { id: number; name: string; slug: string };
  ADMIN: {
    role: "ADMIN";
    id: number | null;
    features: string[];
    updatedAt: string | null;
  };
  USER: {
    role: "USER";
    id: number | null;
    features: string[];
    updatedAt: string | null;
  };
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count?: { members: number };
  members?: Pick<
    User,
    "id" | "userId" | "firstName" | "lastName" | "role" | "status"
  >[];
}

export interface User {
  id: number;
  userId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: Role;
  status: Status;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById?: number | null;
  teamId?: number | null;
  team?: { id: number; name: string; slug: string } | null;
  effectiveFeatures?: string[];
  userRoleId?: number | null;
  userRole?: {
    id: number;
    name: string;
    slug: string;
    features: string[];
  } | null;
}


export interface UserLog {
  id: number;
  action: string;
  details?: string | null;
  createdAt: string;
  userId: number;
  user?: Pick<User, "id" | "userId" | "firstName" | "lastName" | "role">;
}


export interface AuthResponse {
  token: string;
  user: Pick<User, "id" | "userId" | "firstName" | "lastName" | "role"> & {
    teamId: number | null;
    teamName: string | null;
    mustChangePassword?: boolean;
  };
}

export interface DashboardStats {
  currentUser: Pick<
    User,
    "id" | "userId" | "firstName" | "lastName" | "role" | "teamId"
  > & {
    team: { id: number; name: string } | null;
  };
  totalUsers: number;
  totalTeams: number;
  totalBrds: number;
  usersByRole: { role: Role; count: number }[];
  brdsByStatus: { status: string; count: number }[];
}

export type NotificationType = "BRD_STATUS" | "SYSTEM";

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}


export interface BrdSourceItem {
  id: string;
  title: string;
  format: "old" | "new";
  status: string;
  version: string;
  lastUpdated: string;
  geography: string;
}

export interface CreateUserPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  teamId?: number;
  userRoleId?: number;
}

export interface CreateUserResponse {
  message: string;
  generatedPassword: string;
  emailSent?: boolean;
  emailError?: string;
  id: number;
  userIdStr: string;
}

export interface UpdateUserProfilePayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface UpdateUserProfileResponse {
  message: string;
  user: Pick<User, "id" | "userId" | "email" | "firstName" | "lastName">;
}

export type ToastType = "success" | "error" | "warning" | "info";
export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}
