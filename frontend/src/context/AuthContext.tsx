"use client";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { User } from "../types";
import { authApi, getToken, setToken, removeToken } from "../services/api";
import api from "@/app/lib/api";

interface AuthCtx {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (
    identifier: string,
    password: string,
  ) => Promise<{ mustChangePassword: boolean }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Attach bearer token to every axios request
  useEffect(() => {
    const interceptor = api.interceptors.request.use((cfg) => {
      const token = getToken();
      if (token && cfg.headers) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });
    return () => api.interceptors.request.eject(interceptor);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
    } catch {
      removeToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      if (getToken()) await refreshUser();
      setIsLoading(false);
    };
    init();
  }, [refreshUser]);

  const login = async (identifier: string, password: string) => {
    const res = await authApi.login(identifier, password);
    setToken(res.token);
    setUser(res.user as User);
    return { mustChangePassword: res.mustChangePassword };
  };

  const logout = () => {
    removeToken();
    setUser(null);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("signedOutNotice", "1");
    }
    router.push("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user && !!getToken(),
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
