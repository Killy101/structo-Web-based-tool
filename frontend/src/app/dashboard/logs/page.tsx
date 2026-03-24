"use client";
import { useAuth } from "../../../context/AuthContext";
import { InteractiveLogsTable } from "../../../components/ui/interactive-logs-table-shadcnui";

export default function LogsPage() {
  const { user } = useAuth();
  const role = user?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";

  return <InteractiveLogsTable role={role} />;
}
