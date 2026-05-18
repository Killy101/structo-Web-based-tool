"use client";
// ─────────────────────────────────────────────────────────────────────────────
// ChunkDetectionModal.tsx — Chunk detection report modal
//
// Displays a concise chunk status list and provides grouped downloads:
// - ChunkedListHasChanges
// - ChunkedListNoChanges
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from "react";
import type { DiffResult, XmlSection } from "./types";

interface Props {
  result:        DiffResult;
  xmlSections:   XmlSection[];
  sectionMapper: (s: string) => string | null;
  onClose:       () => void;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim() || "document";
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChunkDetectionModal({ result, xmlSections, sectionMapper, onClose }: Props) {
  const coveredSectionLabels = useMemo(() => {
    const covered = new Set<string>();
    for (const chunk of result.chunks) {
      const label = sectionMapper(chunk.section ?? "");
      if (label) covered.add(label);
    }
    return covered;
  }, [result.chunks, sectionMapper]);

  const chunkStatusRows = useMemo(() => {
    return xmlSections.map((section, idx) => {
      const hasChanges = coveredSectionLabels.has(section.label);
      return {
        idx: idx + 1,
        section,
        hasChanges,
        status: hasChanges ? "Has Changes" : "No Changes",
      };
    });
  }, [xmlSections, coveredSectionLabels]);

  const hasChangesRows = useMemo(
    () => chunkStatusRows.filter((row) => row.hasChanges),
    [chunkStatusRows],
  );
  const noChangesRows = useMemo(
    () => chunkStatusRows.filter((row) => !row.hasChanges),
    [chunkStatusRows],
  );

  const downloadGroupedList = (target: "hasChanges" | "noChanges") => {
    const rows = target === "hasChanges" ? hasChangesRows : noChangesRows;
    const fileBase = sanitizeFilename(result.file_a || result.file_b || "document");
    const suffix = target === "hasChanges" ? "ChunkedListHasChanges" : "ChunkedListNoChanges";
    const lines = rows.map((row) => `Chunk ${row.idx} — ${row.section.label} — ${row.status}`);
    const header = `documents/${fileBase}/${suffix}`;
    const content = [header, "", ...lines].join("\n");
    downloadTextFile(`${fileBase}_${suffix}.txt`, content);
  };

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Chunk Detection Report</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {xmlSections.length} chunk section{xmlSections.length !== 1 ? "s" : ""} · {hasChangesRows.length} with changes · {noChangesRows.length} without changes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadGroupedList("hasChanges")}
              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              Download Has Changes
            </button>
            <button
              onClick={() => downloadGroupedList("noChanges")}
              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-500/30 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20 transition-colors"
            >
              Download No Changes
            </button>
            <button
              onClick={onClose}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors"
            >
              Continue to Viewer
            </button>
          </div>
        </div>

        {/* Chunk status list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {chunkStatusRows.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">
              No chunked sections available. Upload XML and choose a chunk level to see status.
            </p>
          ) : (
            chunkStatusRows.map((row) => {
              const leftPad = Math.max(0, row.section.level - 1) * 8;
              return (
                <div
                  key={`${row.section.id}-${row.idx}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    row.hasChanges
                      ? "bg-emerald-500/5 border border-emerald-500/15 dark:border-emerald-500/10"
                      : "bg-rose-500/5 border border-rose-500/15 dark:border-rose-500/10"
                  }`}
                >
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${
                      row.hasChanges ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                  />

                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 w-[70px] flex-shrink-0">
                    Chunk {row.idx}
                  </span>

                  <span
                    className={`text-xs truncate flex-1 ${
                      row.hasChanges
                        ? "text-emerald-400 dark:text-emerald-300"
                        : "text-rose-400 dark:text-rose-300"
                    }`}
                    style={{ paddingLeft: `${leftPad}px` }}
                    title={row.section.label}
                  >
                    {row.section.label}
                  </span>

                  <span
                    className={`text-[10px] font-semibold flex-shrink-0 ${
                      row.hasChanges ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {row.status}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="flex-shrink-0 px-4 py-3 border-t border-slate-200 dark:border-white/8 bg-slate-50/60 dark:bg-white/[0.02] rounded-b-2xl">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Downloads are grouped as:
            <span className="font-semibold"> documents/{sanitizeFilename(result.file_a || result.file_b || "document")}/ChunkedListHasChanges</span>
            {" "}and
            <span className="font-semibold"> documents/{sanitizeFilename(result.file_a || result.file_b || "document")}/ChunkedListNoChanges</span>.
          </p>
        </div>
      </div>
    </div>
  );
}