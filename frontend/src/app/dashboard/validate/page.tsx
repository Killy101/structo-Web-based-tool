"use client";
import { Card, EmptyState } from "../../../components/ui";

export default function ValidatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Validation
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          QA/QC review and approval queue
        </p>
      </div>
      <Card>
        <EmptyState
          icon="✅"
          title="Coming Soon"
          description="Validation queue will be built in the next step."
        />
      </Card>
    </div>
  );
}
