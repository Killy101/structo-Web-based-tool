"use client";
import React from "react";
import type { Chunk } from "./types";
import { buildWordTokens, renderWordTokens } from "./DiffPane";
import { useTheme } from "@/context/ThemContext";

interface Props {
  chunk: Chunk | null;
  open: boolean;
  onToggle: () => void;
}

export default function WordDiffPanel({ chunk, open, onToggle }: Props) {
  const { dark } = useTheme();

  if (!chunk || chunk.kind !== "mod") return null;

  const tokensA = buildWordTokens(chunk, "a");
  const tokensB = buildWordTokens(chunk, "b");

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
        <div className="px-3 pb-2 text-[11px] font-mono space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-1.5 leading-relaxed">
            <span className="text-rose-500 flex-shrink-0">removed:</span>
            <span className="text-slate-600 dark:text-slate-300 break-words min-w-0">
              {tokensA ? renderWordTokens(tokensA, dark) : (chunk.words_removed || "—")}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 leading-relaxed">
            <span className="text-emerald-600 dark:text-emerald-400 flex-shrink-0">added:</span>
            <span className="text-slate-600 dark:text-slate-300 break-words min-w-0">
              {tokensB ? renderWordTokens(tokensB, dark) : (chunk.words_added || "—")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}