"use client";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { User } from "../types";
import { authApi, getToken, setToken, removeToken } from "../services/api";
import api from "@/app/lib/api";

interface AuthCtx {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
    } catch (error) {
      // Only remove token for auth errors (401/403).
      // Keep the token for transient network errors so the user
      // isn't silently logged out and stuck in a redirect loop.
      if (
        axios.isAxiosError(error) &&
        error.response &&
        (error.response.status === 401 || error.response.status === 403)
      ) {
        removeToken();
        setUser(null);
      } else {
        // Network error or server error — keep token, clear user
        // so isAuthenticated becomes false but token stays for retry.
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      if (getToken()) await refreshUser();
      setIsLoading(false);
    };
    init();
  }, [refreshUser]);

  const login = async (userId: string, password: string) => {
    const res = await authApi.login(userId, password);
    setToken(res.token);
    setUser(res.user as unknown as User);
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
