"use client";

import React, { useEffect, useMemo } from "react";

interface Props {
  file: File | null;
  title: string;
  onScrollFraction?: (scrollFraction: number) => void;
  syncScrollFraction?: number | null;
}

export default function RawPdfPane({ file, title, onScrollFraction, syncScrollFraction }: Props) {
  const fileUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  void onScrollFraction;
  void syncScrollFraction;

  if (!fileUrl) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        PDF source is unavailable for this session.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col border-r border-slate-200 dark:border-white/8 last:border-r-0">
      <div className="flex-shrink-0 px-3 py-1.5 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0d1525]">
        <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate" title={title}>
          {title}
        </span>
      </div>
      <div className="flex-1 min-h-0 bg-slate-100 dark:bg-[#0a1020]">
        <iframe
          title={title}
          src={fileUrl}
          className="w-full h-full border-0"
        />
      </div>
    </div>
  );
}
