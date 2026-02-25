'use client';
import { useState, useEffect, useCallback } from 'react';
import { User, FileUpload, DashboardStats, Toast, ToastType, CreateUserPayload } from '../types';
import { usersApi, filesApi, dashboardApi } from '../services/api';


  function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'response' in e) {
    const axiosErr = e as { response?: { data?: { error?: string } } };
    return axiosErr.response?.data?.error ?? 'An error occurred';
  }
  return 'An error occurred';
}
// ─── useUsers ──────────────────────────────────────────────────────────────────
export function useUsers() {
  const [users, setUsers]       = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);



 // ─── useUsers ──────────────────────────────────────────────────────────────────
const refetch = useCallback(async () => {
  setIsLoading(true); setError(null);
  try {
    const { users } = await usersApi.getAll();
    setUsers(users);
  } catch (e: unknown) { setError(getErrorMessage(e)); }
  finally { setIsLoading(false); }
}, []);

  useEffect(() => { refetch(); }, [refetch]);

  const createUser = async (data: CreateUserPayload) => {
    const result = await usersApi.create(data);
    await refetch();
    return result;
  };

  const deactivateUser = async (id: number) => {
    await usersApi.deactivate(id);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: 'INACTIVE' as const } : u));
  };

  const activateUser = async (id: number) => {
    await usersApi.activate(id);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: 'ACTIVE' as const } : u));
  };

  return { users, isLoading, error, refetch, createUser, deactivateUser, activateUser };
}

// ─── useFiles ──────────────────────────────────────────────────────────────────
export function useFiles() {
  const [files, setFiles]       = useState<FileUpload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const { files } = await filesApi.getAll();
      setFiles(files);
    } catch (e: unknown) { setError(getErrorMessage(e)); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { files, isLoading, error, refetch };
}

// ─── useDashboard ──────────────────────────────────────────────────────────────
export function useDashboard() {
  const [stats, setStats]       = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const data = await dashboardApi.getStats();
      setStats(data);
    } catch (e: unknown) { setError(getErrorMessage(e)); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, isLoading, error, refetch };
}

// ─── useToast ──────────────────────────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}

// ─── useLocalStorage ───────────────────────────────────────────────────────────
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initial;
    } catch { return initial; }
  });

  const set = (val: T) => {
    setValue(val);
    window.localStorage.setItem(key, JSON.stringify(val));
  };

  return [value, set] as const;
}