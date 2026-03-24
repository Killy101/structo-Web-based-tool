"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ThemeProvider } from "../../context/ThemContext";
import Sidebar from "../../components/layout/Sidebar";
import Unauthorized from "../../components/layout/Unauthorized";
import { Button } from "../../components/ui";
import TetrisLoading from "../../components/ui/tetris-loader";
import WelcomeSplash from "../../components/layout/Welcomesplash";
import { getToken, settingsApi } from "../../services/api";
import { useAutoLogout } from "../../hooks/useAutoLogout";
import type { Role } from "../../types";

const DEFAULT_MAINTENANCE_BANNER =
  "Our system is currently undergoing maintenance to improve performance and reliability. We'll be back shortly. Thank you for your patience and understanding.";

function formatMaintenanceBanner(operationsPolicy: {
  maintenanceBannerMessage?: string;
  maintenanceWindowStartUtc?: string;
  maintenanceWindowEndUtc?: string;
}): string {
  const custom = String(operationsPolicy.maintenanceBannerMessage ?? "").trim();
  if (custom) return custom;

  const start = String(operationsPolicy.maintenanceWindowStartUtc ?? "").trim();
  const end = String(operationsPolicy.maintenanceWindowEndUtc ?? "").trim();
  if (start && end) {
    return `Scheduled maintenance window: ${start} to ${end}. Write operations are temporarily unavailable.`;
  }

  return DEFAULT_MAINTENANCE_BANNER;
}

const RESTRICTED_ROUTES: Record<string, Role[]> = {
  "/dashboard/users": ["SUPER_ADMIN", "ADMIN"],
  "/dashboard/settings": ["SUPER_ADMIN"],
  "/dashboard/validate": [],
  "/dashboard/history": [],
  "/dashboard/tasks": [
    "SUPER_ADMIN",
    "ADMIN",
    "USER",
  ],
  // SUPER_ADMIN: full access (all tabs, can edit XML)
  // ADMIN / USER: compare-only, read-only XML
  "/dashboard/compare": [
    "SUPER_ADMIN",
    "ADMIN",
    "USER",
  ],
  // AutoCompare: same access as Compare
  "/dashboard/autocompare": [
    "SUPER_ADMIN",
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
    subtitle: "Manage user accounts, roles, and team assignments",
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
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(15);
  useAutoLogout(sessionTimeoutMinutes);
  const [collapsed, setCollapsed] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [visible, setVisible] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceBannerMessage, setMaintenanceBannerMessage] = useState(
    DEFAULT_MAINTENANCE_BANNER,
  );
  const [strictRateLimitMode, setStrictRateLimitMode] = useState(false);
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

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let active = true;

    const fetchOperationsStatus = async () => {
      try {
        const { operationsPolicy, sessionTimeoutMinutes: timeout } =
          await settingsApi.getOperationsStatus();
        if (!active) return;
        setMaintenanceMode(Boolean(operationsPolicy.maintenanceMode));
        setMaintenanceBannerMessage(formatMaintenanceBanner(operationsPolicy));
        setStrictRateLimitMode(Boolean(operationsPolicy.strictRateLimitMode));
        if (typeof timeout === "number" && timeout >= 5) {
          setSessionTimeoutMinutes(timeout);
        }
      } catch {
        if (!active) return;
        setMaintenanceMode(false);
        setMaintenanceBannerMessage(DEFAULT_MAINTENANCE_BANNER);
        setStrictRateLimitMode(false);
      }
    };

    void fetchOperationsStatus();
    const interval = setInterval(fetchOperationsStatus, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

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
        <TetrisLoading size="sm" speed="fast" loadingText="Loading..." />
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
      !hasFeature([
        "compare-basic",
        "compare-chunk",
        "compare-merge",
        "compare-pdf-xml-only",
      ])) ||
    (pathname.startsWith("/dashboard/autocompare") &&
      !hasFeature([
        "compare-basic",
        "compare-chunk",
        "compare-merge",
        "compare-pdf-xml-only",
      ]));

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
        {maintenanceMode && (
          <div className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            {maintenanceBannerMessage}
          </div>
        )}
        {!maintenanceMode && strictRateLimitMode && (
          <div className="flex-shrink-0 border-b border-orange-200 bg-orange-50 px-6 py-2 text-xs font-medium text-orange-800 dark:border-orange-900/40 dark:bg-orange-900/20 dark:text-orange-300">
            Strict rate-limit mode is active — requests are limited to 60 per minute per IP.
          </div>
        )}
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
