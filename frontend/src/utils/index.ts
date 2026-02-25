import { Role, Status, TaskStatus } from '../types';

// ─── ROLE CONFIG ───────────────────────────────────────────────────────────────
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER_QA: 'Manager QA',
  MANAGER_QC: 'Manager QC',
  USER: 'User',
};

export const ROLE_BADGE_COLORS: Record<Role, string> = {
  SUPER_ADMIN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  ADMIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  MANAGER_QA: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MANAGER_QC: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  USER: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export const ROLE_CHART_COLORS: Record<Role, string> = {
  SUPER_ADMIN: '#6366f1',
  ADMIN: '#8b5cf6',
  MANAGER_QA: '#f59e0b',
  MANAGER_QC: '#14b8a6',
  USER: '#3b82f6',
};

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING:    'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400',
  PROCESSING: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  PROCESSED:  'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400',
  SUBMITTED:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  APPROVED:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  REJECTED:   'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
};

export const USER_STATUS_COLORS: Record<Status, string> = {
  ACTIVE:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  INACTIVE: 'bg-slate-100   text-slate-500   dark:bg-slate-700/50   dark:text-slate-400',
};

export const FILE_STATUS_HEX: Record<TaskStatus, string> = {
  PENDING:    '#f59e0b',
  PROCESSING: '#6366f1',
  PROCESSED:  '#3b82f6',
  SUBMITTED:  '#8b5cf6',
  APPROVED:   '#10b981',
  REJECTED:   '#ef4444',
};

// ─── PERMISSIONS ───────────────────────────────────────────────────────────────
export const CAN_CREATE_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER_QA', 'MANAGER_QC', 'USER'],
  ADMIN:       ['MANAGER_QA', 'MANAGER_QC', 'USER'],
};

export const CAN_DEACTIVATE_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER_QA', 'MANAGER_QC', 'USER'],
  ADMIN:       ['MANAGER_QA', 'MANAGER_QC', 'USER'],
};

export const canCreate    = (actor: Role, target: Role) => CAN_CREATE_ROLES[actor]?.includes(target) ?? false;
export const canDeactivate = (actor: Role, target: Role) => CAN_DEACTIVATE_ROLES[actor]?.includes(target) ?? false;

// ─── FORMATTERS ────────────────────────────────────────────────────────────────
export const formatDate = (date: string | null): string => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(date));
};

export const formatDateTime = (date: string | null): string => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatTimeAgo = (date: string): string => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const getInitials = (firstName: string, lastName: string) =>
  `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();

export const isInnodataEmail = (email: string) => email.toLowerCase().endsWith('@innodata.com');

export const generatePassword = (): string => {
  const alpha   = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums    = '23456789';
  const special = '!@#$%';
  let p = '';
  for (let i = 0; i < 9; i++) p += alpha[Math.floor(Math.random() * alpha.length)];
  p += nums[Math.floor(Math.random() * nums.length)];
  p += special[Math.floor(Math.random() * special.length)];
  return p;
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
};