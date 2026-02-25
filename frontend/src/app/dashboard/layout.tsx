"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ThemeProvider } from "../../context/ThemContext";
import Sidebar from "../../components/layout/Sidebar";
import Topbar from "../../components/layout/Topbar";
import { Spinner } from "../../components/ui";

// Page title mapping
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
  "/dashboard/settings": {
    title: "Settings",
    subtitle: "System configuration",
  },
};

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push("/login");
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isLoading && user?.mustChangePassword) router.push("/change-password");
  }, [isLoading, user, router]);

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

  const meta = PAGE_META[pathname] ?? { title: "Dashboard", subtitle: "" };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#0a0f1e] overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title={meta.title} subtitle={meta.subtitle} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
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
