"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ThemeProvider } from "../../context/ThemContext";
import Sidebar from "../../components/layout/Sidebar";
import Unauthorized from "../../components/layout/Unauthorized";
import { Spinner, Button } from "../../components/ui";
import WelcomeSplash from "../../components/layout/Welcomesplash";
import { getToken } from "../../services/api";
import { useAutoLogout } from "../../hooks/useAutoLogout";
import type { Role } from "../../types";

const RESTRICTED_ROUTES: Record<string, Role[]> = {
  "/dashboard/users": ["SUPER_ADMIN", "ADMIN"],
  "/dashboard/settings": ["SUPER_ADMIN"],
  "/dashboard/validate": [],
  "/dashboard/history": [],
  "/dashboard/tasks": [
    "SUPER_ADMIN",
    "ADMIN",
    "MANAGER_QA",
    "MANAGER_QC",
    "USER",
  ],
  // SUPER_ADMIN + MANAGER_QA: full access (all tabs, can edit XML)
  // MANAGER_QC / ADMIN / USER: compare-only, read-only XML
  "/dashboard/compare": [
    "SUPER_ADMIN",
    "MANAGER_QA",
    "MANAGER_QC",
    "ADMIN",
    "USER",
  ],
  // AutoCompare: same access as Compare
  "/dashboard/autocompare": [
    "SUPER_ADMIN",
    "MANAGER_QA",
    "MANAGER_QC",
    "ADMIN",
    "USER",
  ],
};

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Overview of your document processing system",
  },
  "/dashboard/users": {
    title: "User Management",
    subtitle: "Manage team members and roles",
  },
  "/dashboard/compare": {
    title: "Compare BRD Sources",
    subtitle: "Compare document processing sources",
  },
  "/dashboard/autocompare": {
    title: "AutoCompare",
    subtitle: "AI-assisted PDF + XML comparison and update",
  },
  "/dashboard/files": {
    title: "File Upload",
    subtitle: "Upload and process PDF / XML files",
  },
  "/dashboard/validate": {
    title: "Validation",
    subtitle: "QA/QC review and approval queue",
  },
  "/dashboard/history": {
    title: "History",
    subtitle: "All file operations and activity",
  },
  "/dashboard/brd": {
    title: "BRD Sources",
    subtitle: "Manage document processing sources",
  },
  "/dashboard/tasks": {
    title: "My Tasks",
    subtitle: "View and manage assigned tasks",
  },
  "/dashboard/settings": {
    title: "Settings",
    subtitle: "Manage teams and system configuration",
  },
};

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user, refreshUser } = useAuth();
  useAutoLogout(15);
  const [collapsed, setCollapsed] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [visible, setVisible] = useState(false);
  const splashCheckedRef = useRef(false);
  const redirectedRef = useRef(false);

  // ── Auth redirects (no setState, only router calls) ──
  useEffect(() => {
    if (isLoading || redirectedRef.current) return;
    if (!isAuthenticated) {
      // Only redirect to login if there's no token at all.
      // If token exists but /auth/me failed (network error), stay and allow retry.
      if (!getToken()) {
        redirectedRef.current = true;
        router.replace("/login");
      }
      return;
    }
  }, [isAuthenticated, isLoading, user, router]);

  // ── Splash check (runs once when user is available) ──
  useEffect(() => {
    if (splashCheckedRef.current || !user || isLoading) return;
    splashCheckedRef.current = true;

    const justLoggedIn = sessionStorage.getItem("justLoggedIn") === "1";
    sessionStorage.removeItem("justLoggedIn");
    if (!justLoggedIn) return;

    const userIdentity = user.id ?? user.userId;
    if (!userIdentity) return;

    const seenKey = `welcomeSplashSeen:${userIdentity}`;
    if (localStorage.getItem(seenKey) !== "1") {
      localStorage.setItem(seenKey, "1");
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => setShowSplash(true), 0);
    }
  }, [user, isLoading]);

  // ── Fade-in animation (only when not showing splash and authenticated) ──
  useEffect(() => {
    if (showSplash || isLoading || !isAuthenticated) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [showSplash, isLoading, isAuthenticated]);

  const handleSplashDone = useCallback(() => {
    setShowSplash(false);
    setVisible(false);
    // Trigger fade-in after splash ends
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // ── Render ──
  if (showSplash && user) {
    return (
      <WelcomeSplash
        firstName={user.firstName ?? ""}
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

  if (!isAuthenticated) {
    // Token exists but /auth/me failed (likely network/server error) — show retry
    if (getToken()) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm px-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Unable to connect to the server. Please check your connection and
              try again.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                await refreshUser();
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return null;
  }

  const isBrdRoute =
    pathname.startsWith("/dashboard/brd") ||
    pathname.startsWith("/dashboard/compare") ||
    pathname.startsWith("/dashboard/autocompare");

  const hasFeature = (feature: string | string[]) => {
    if (user?.role === "SUPER_ADMIN") return true;
    const enabled = user?.effectiveFeatures ?? [];
    if (enabled.includes("*")) return true;
    if (Array.isArray(feature)) return feature.some((f) => enabled.includes(f));
    return enabled.includes(feature);
  };

  const allowedRoles = RESTRICTED_ROUTES[pathname];
  const roleUnauthorized =
    allowedRoles !== undefined && !allowedRoles.includes(user?.role as Role);

  const featureUnauthorized =
    (pathname === "/dashboard" && !hasFeature("dashboard")) ||
    (pathname.startsWith("/dashboard/users") &&
      !hasFeature("user-management")) ||
    (pathname.startsWith("/dashboard/brd") &&
      !hasFeature(["brd-process", "brd-view-generate"])) ||
    (pathname.startsWith("/dashboard/compare") &&
      !hasFeature(["compare-basic", "compare-chunk", "compare-merge"])) ||
    (pathname.startsWith("/dashboard/autocompare") &&
      !hasFeature(["compare-basic", "compare-chunk", "compare-merge"]));

  const isUnauthorized = roleUnauthorized || featureUnauthorized;

  return (
    <div
      className={`flex h-screen bg-slate-50 dark:bg-[#0a0f1e] overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-1 pointer-events-none"
      }`}
    >
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isBrdRoute && (
          <header className="flex-shrink-0 flex items-center px-6 h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white leading-none">
                {PAGE_META[pathname]?.title ?? "Dashboard"}
              </h1>
              {PAGE_META[pathname]?.subtitle && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {PAGE_META[pathname].subtitle}
                </p>
              )}
            </div>
          </header>
        )}
        <main
          className={
            isBrdRoute ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-6"
          }
        >
          {isUnauthorized ? <Unauthorized /> : children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DashboardShell>{children}</DashboardShell>
      </AuthProvider>
    </ThemeProvider>
  );
}
