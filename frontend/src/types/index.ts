export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MANAGER_QA"
  | "MANAGER_QC"
  | "USER";
export type Status = "ACTIVE" | "INACTIVE";
export type TaskStatus =
  | "PENDING"
  | "PROCESSING"
  | "PROCESSED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED";
export type AssignmentStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export interface Team {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count?: { members: number; taskAssignments: number };
  members?: Pick<
    User,
    "id" | "userId" | "firstName" | "lastName" | "role" | "status"
  >[];
}

export interface User {
  id: number;
  userId: string;
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
}

export interface TaskAssignment {
  id: number;
  title: string;
  description?: string | null;
  status: AssignmentStatus;
  percentage: number;
  createdAt: string;
  updatedAt: string;
  dueDate?: string | null;
  teamId: number;
  team?: { id: number; name: string };
  createdById: number;
  createdBy?: Pick<User, "id" | "userId" | "firstName" | "lastName">;
  assignees?: {
    id: number;
    userId: number;
    user: Pick<User, "id" | "userId" | "firstName" | "lastName">;
  }[];
  brdFileId?: number | null;
  brdFile?: { id: number; originalName: string; status: TaskStatus } | null;
}

export interface UserLog {
  id: number;
  action: string;
  details?: string | null;
  createdAt: string;
  userId: number;
  user?: Pick<User, "id" | "userId" | "firstName" | "lastName" | "role">;
}

export interface FileUpload {
  id: number;
  originalName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  status: TaskStatus;
  uploadedAt: string;
  processedAt: string | null;
  submittedAt: string | null;
  uploadedById: number;
  uploadedBy?: Pick<User, "id" | "userId" | "firstName" | "lastName" | "role">;
  output?: FileOutput | null;
  validation?: Validation | null;
}

export interface FileOutput {
  id: number;
  filename: string;
  storagePath: string;
  fileSize: number;
  createdAt: string;
  uploadId: number;
}

export interface Validation {
  id: number;
  status: string;
  remarks: string | null;
  validatedAt: string;
  uploadId: number;
  validatedById: number;
  validatedBy?: Pick<User, "id" | "userId" | "firstName" | "lastName">;
}

export interface AuthResponse {
  token: string;
  user: Pick<User, "id" | "userId" | "firstName" | "lastName" | "role"> & {
    teamId: number | null;
    teamName: string | null;
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
  totalFiles: number;
  pendingValidation: number;
  approvedTasks: number;
  totalTeams: number;
  usersByRole: { role: Role; count: number }[];
  filesByStatus: { status: TaskStatus; count: number }[];
  recentActivity: FileUpload[];
}

export interface CreateUserPayload {
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
  teamId?: number;
}

export interface CreateUserResponse {
  message: string;
  generatedPassword: string;
  id: number;
  userIdStr: string;
}

export type ToastType = "success" | "error" | "warning" | "info";
export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}
