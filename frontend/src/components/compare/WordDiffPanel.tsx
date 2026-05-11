"use client";
import React from "react";
import type { Chunk } from "./types";

interface Props {
  chunk: Chunk | null;
  open: boolean;
  onToggle: () => void;
}

export default function WordDiffPanel({ chunk, open, onToggle }: Props) {
  if (!chunk || chunk.kind !== "mod") return null;

  const removed = chunk.words_removed || "—";
  const added   = chunk.words_added   || "—";

  return (
    <div className="flex-shrink-0 border-t border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0d1525]">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
      >
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Word Diff
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          {chunk.kind.toUpperCase()}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2 text-[11px] font-mono">
          <span className="text-red-500">removed:</span>{" "}
          <span className="text-slate-600 dark:text-slate-300">{removed}</span>
          {"   "}
          <span className="text-green-600 dark:text-green-400">added:</span>{" "}
          <span className="text-slate-600 dark:text-slate-300">{added}</span>
        </div>
      )}
    </div>
  );
}