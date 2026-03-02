"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ThemeProvider } from "../../context/ThemContext";
import Sidebar from "../../components/layout/Sidebar";
import { Spinner } from "../../components/ui";
import WelcomeSplash from "../../components/layout/Welcomesplash";

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Dashboard", subtitle: "Overview of your document processing system" },
  "/dashboard/users": { title: "User Management", subtitle: "Manage team members and roles" },
  "/dashboard/compare": { title: "Compare BRD Sources", subtitle: "Compare document processing sources" },
  "/dashboard/files": { title: "File Upload", subtitle: "Upload and process PDF / XML files" },
  "/dashboard/validate": { title: "Validation", subtitle: "QA/QC review and approval queue" },
  "/dashboard/history": { title: "History", subtitle: "All file operations and activity" },
  "/dashboard/brd": { title: "BRD Sources", subtitle: "Manage document processing sources" },
  "/dashboard/settings": { title: "Settings", subtitle: "System configuration" },
};

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const [showSplash, setShowSplash] = useState(false);
  const [pendingLoginSplash, setPendingLoginSplash] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("justLoggedIn") === "1";
  });
  const [dashboardReady, setDashboardReady] = useState(() => !showSplash);

  useEffect(() => {
    if (!pendingLoginSplash || !user) return;

    const userIdentity = user.id ?? user.email;
    if (!userIdentity) {
      sessionStorage.removeItem("justLoggedIn");
      setPendingLoginSplash(false);
      return;
    }

    const seenKey = `welcomeSplashSeen:${userIdentity}`;
    const hasSeenSplash = localStorage.getItem(seenKey) === "1";

    if (!hasSeenSplash) {
      localStorage.setItem(seenKey, "1");
      setShowSplash(true);
    }

    sessionStorage.removeItem("justLoggedIn");
    setPendingLoginSplash(false);
  }, [pendingLoginSplash, user]);

  useEffect(() => {
    if (showSplash) {
      setDashboardReady(false);
      return;
    }
    const raf = window.requestAnimationFrame(() => setDashboardReady(true));
    return () => window.cancelAnimationFrame(raf);
  }, [showSplash]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push("/login");
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isLoading && user?.mustChangePassword) router.push("/change-password");
  }, [isLoading, user, router]);

  const handleSplashDone = useCallback(() => setShowSplash(false), []);

  // Show splash before any loading check — it's highest priority
  if (showSplash) {
    return (
      <WelcomeSplash
        firstName={user?.firstName ?? ""}
        onDone={handleSplashDone}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Spinner className="w-8 h-8 mx-auto" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const isBrdRoute = pathname.startsWith("/dashboard/brd");

  return (
    <div
      className={`flex h-screen bg-slate-50 dark:bg-[#0a0f1e] overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        dashboardReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
      }`}
    >
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className={isBrdRoute ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-6"}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DashboardShell>{children}</DashboardShell>
      </AuthProvider>
    </ThemeProvider>
  );
}