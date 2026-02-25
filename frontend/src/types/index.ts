// ─── ENUMS (match Prisma schema exactly) ──────────────────────────────────────
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER_QA' | 'MANAGER_QC' | 'USER';
export type Status = 'ACTIVE' | 'INACTIVE';
export type TaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

// ─── PRISMA MODELS ─────────────────────────────────────────────────────────────
export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: Status;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById?: number | null;
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
  uploadedBy?: Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'role'>;
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
  validatedBy?: Pick<User, 'id' | 'firstName' | 'lastName'>;
}

// ─── API RESPONSE TYPES ────────────────────────────────────────────────────────
export interface AuthResponse {
  token: string;
  mustChangePassword: boolean;
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role' | 'status'>;
}

export interface DashboardStats {
  totalUsers: number;
  totalFiles: number;
  pendingValidation: number;
  approvedTasks: number;
  usersByRole: { role: Role; count: number }[];
  filesByStatus: { status: TaskStatus; count: number }[];
  recentActivity: FileUpload[];
}

// ─── UI TYPES ──────────────────────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
}

export interface CreateUserResponse {
  message: string;
  generatedPassword: string;
  userId: number;
}