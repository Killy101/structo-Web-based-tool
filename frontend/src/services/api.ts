// This works alongside your existing src/app/lib/api.ts (axios instance).
// These functions use your existing axios api instance for all calls.

import api from '@/app/lib/api';
import {
  AuthResponse, User, FileUpload,
  DashboardStats, CreateUserPayload, CreateUserResponse,
} from '../types';

// ─── TOKEN HELPERS ─────────────────────────────────────────────────────────────
export const getToken  = () => (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
export const setToken  = (t: string) => localStorage.setItem('token', t);
export const removeToken = () => localStorage.removeItem('token');

// ─── ATTACH TOKEN TO REQUESTS ──────────────────────────────────────────────────
// Add this interceptor once in your layout or provider:
// api.interceptors.request.use(cfg => {
//   const token = getToken();
//   if (token && cfg.headers) cfg.headers.Authorization = `Bearer ${token}`;
//   return cfg;
// });

// ─── AUTH ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (identifier: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { identifier, password }).then(r => r.data),

  me: () =>
    api.get<{ user: User }>('/auth/me').then(r => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }).then(r => r.data),
};

// ─── USERS ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  getAll: () =>
    api.get<{ users: User[] }>('/users').then(r => r.data),

  create: (data: CreateUserPayload) =>
    api.post<CreateUserResponse>('/users/create', data).then(r => r.data),

  deactivate: (id: number) =>
    api.patch<{ message: string }>(`/users/${id}/deactivate`).then(r => r.data),

  activate: (id: number) =>
    api.patch<{ message: string }>(`/users/${id}/activate`).then(r => r.data),
};

// ─── FILES ─────────────────────────────────────────────────────────────────────
export const filesApi = {
  getAll: () =>
    api.get<{ files: FileUpload[] }>('/files').then(r => r.data),

  upload: (formData: FormData) =>
    api.post<{ message: string; file: FileUpload }>('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),

  process: (id: number) =>
    api.post<{ message: string }>(`/files/${id}/process`).then(r => r.data),

  submit: (id: number) =>
    api.post<{ message: string }>(`/files/${id}/submit`).then(r => r.data),

  download: (id: number) => {
    const token = getToken();
    window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/${id}/download?token=${token}`, '_blank');
  },

  delete: (id: number) =>
    api.delete<{ message: string }>(`/files/${id}`).then(r => r.data),
};

// ─── VALIDATION ────────────────────────────────────────────────────────────────
export const validationApi = {
  validate: (uploadId: number, status: 'approved' | 'rejected', remarks?: string) =>
    api.post<{ message: string }>(`/validate/${uploadId}`, { status, remarks }).then(r => r.data),
};

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
export const dashboardApi = {
  getStats: () =>
    api.get<DashboardStats>('/dashboard/stats').then(r => r.data),
};