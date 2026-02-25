"use client";
import { Card, EmptyState } from "../../../components/ui";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Settings
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          System configuration — Super Admin only
        </p>
      </div>
      <Card>
        <EmptyState
          icon="⚙️"
          title="Coming Soon"
          description="System settings will be built in the next step."
        />
      </Card>
    </div>
  );
}
