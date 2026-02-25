"use client";
import { Card, EmptyState } from "../../../components/ui";

export default function FilesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          File Upload
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload and process PDF / XML files
        </p>
      </div>
      <Card>
        <EmptyState
          icon="📁"
          title="Coming Soon"
          description="File upload feature will be built in the next step."
        />
      </Card>
    </div>
  );
}
