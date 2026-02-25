"use client";
import { Card, EmptyState } from "../../../components/ui";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          History
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          All file operations and activity log
        </p>
      </div>
      <Card>
        <EmptyState
          icon="🕐"
          title="Coming Soon"
          description="Full history log will be built in the next step."
        />
      </Card>
    </div>
  );
}
