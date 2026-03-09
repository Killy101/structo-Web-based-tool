"use client";
import React, { useState, useRef, useCallback } from "react";
import { Button, Card } from "../ui";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DiffEntry {
  path: string;
  tag?: string;
  description: string;
  xml?: string;
  old_xml?: string;
  new_xml?: string;
  content?: string;
  old_content?: string;
  new_content?: string;
  changes?: string[];
}

interface DiffSummary {
  total_additions: number;
  total_removals: number;
  total_modifications: number;
  total_mismatches: number;
}

interface LineDiff {
  type: "equal" | "replace" | "delete" | "insert";
  line_old: number | null;
  line_new: number | null;
  content_old: string | null;
  content_new: string | null;
}

interface DiffResult {
  additions: DiffEntry[];
  removals: DiffEntry[];
  modifications: DiffEntry[];
  mismatches: DiffEntry[];
  summary: DiffSummary;
}

interface CompareResponse {
  success: boolean;
  old_filename: string;
  new_filename: string;
  diff: DiffResult;
  line_diff: LineDiff[];
}

// ── Change list item ───────────────────────────────────────────────────────────

type ChangeKind = "addition" | "removal" | "modification" | "mismatch";

interface FlatChange {
  kind: ChangeKind;
  entry: DiffEntry;
  index: number;
}

const KIND_STYLES: Record<ChangeKind, { badge: string; bg: string; text: string; dot: string }> = {
  addition:     { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/10 border-l-2 border-emerald-400", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  removal:      { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-900/10 border-l-2 border-red-400",       text: "text-red-700 dark:text-red-400",       dot: "bg-red-500" },
  modification: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/10 border-l-2 border-amber-400", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  mismatch:     { badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/10 border-l-2 border-violet-400", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
};

const KIND_LABEL: Record<ChangeKind, string> = {
  addition: "Added",
  removal: "Removed",
  modification: "Modified",
  mismatch: "Mismatch",
};

// ── Line diff renderer ─────────────────────────────────────────────────────────

function LineNumber({ n }: { n: number | null }) {
  return (
    <span className="select-none w-10 shrink-0 text-right pr-3 text-slate-400 dark:text-slate-600 text-xs font-mono">
      {n ?? ""}
    </span>
  );
}

function DiffLineRow({ line }: { line: LineDiff }) {
  const baseCell =
    "flex items-start text-xs font-mono py-0.5 min-w-0 overflow-x-auto";

  if (line.type === "equal") {
    return (
      <div className="flex divide-x divide-slate-100 dark:divide-slate-800">
        <div className={`${baseCell} flex-1 pr-2`}>
          <LineNumber n={line.line_old} />
          <span className="whitespace-pre text-slate-700 dark:text-slate-300">{line.content_old}</span>
        </div>
        <div className={`${baseCell} flex-1 pl-2`}>
          <LineNumber n={line.line_new} />
          <span className="whitespace-pre text-slate-700 dark:text-slate-300">{line.content_new}</span>
        </div>
      </div>
    );
  }

  if (line.type === "delete") {
    return (
      <div className="flex divide-x divide-slate-100 dark:divide-slate-800 bg-red-50/60 dark:bg-red-900/10">
        <div className={`${baseCell} flex-1 pr-2`}>
          <LineNumber n={line.line_old} />
          <span className="whitespace-pre text-red-700 dark:text-red-400">{line.content_old}</span>
        </div>
        <div className={`${baseCell} flex-1 pl-2 opacity-0 pointer-events-none`}>
          <LineNumber n={null} />
        </div>
      </div>
    );
  }

  if (line.type === "insert") {
    return (
      <div className="flex divide-x divide-slate-100 dark:divide-slate-800 bg-emerald-50/60 dark:bg-emerald-900/10">
        <div className={`${baseCell} flex-1 pr-2 opacity-0 pointer-events-none`}>
          <LineNumber n={null} />
        </div>
        <div className={`${baseCell} flex-1 pl-2`}>
          <LineNumber n={line.line_new} />
          <span className="whitespace-pre text-emerald-700 dark:text-emerald-400">{line.content_new}</span>
        </div>
      </div>
    );
  }

  // replace
  return (
    <div className="flex divide-x divide-slate-100 dark:divide-slate-800">
      <div className={`${baseCell} flex-1 pr-2 ${line.content_old !== null ? "bg-red-50/60 dark:bg-red-900/10" : ""}`}>
        <LineNumber n={line.line_old} />
        <span className="whitespace-pre text-red-700 dark:text-red-400">{line.content_old ?? ""}</span>
      </div>
      <div className={`${baseCell} flex-1 pl-2 ${line.content_new !== null ? "bg-emerald-50/60 dark:bg-emerald-900/10" : ""}`}>
        <LineNumber n={line.line_new} />
        <span className="whitespace-pre text-emerald-700 dark:text-emerald-400">{line.content_new ?? ""}</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ComparePanel() {
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChange, setSelectedChange] = useState<FlatChange | null>(null);
  const [activeFilter, setActiveFilter] = useState<ChangeKind | "all">("all");

  const oldInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  const handleCompare = useCallback(async () => {
    if (!oldFile || !newFile) {
      setError("Please select both Old and New XML files");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    setSelectedChange(null);

    try {
      const form = new FormData();
      form.append("old_file", oldFile);
      form.append("new_file", newFile);

      const res = await fetch(`${PROCESSING_URL}/compare/diff`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || "Comparison failed");
      }
      const data: CompareResponse = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [oldFile, newFile]);

  // Flatten all changes for the sidebar
  const allChanges: FlatChange[] = result
    ? [
        ...result.diff.additions.map((e, i) => ({ kind: "addition" as ChangeKind, entry: e, index: i })),
        ...result.diff.removals.map((e, i) => ({ kind: "removal" as ChangeKind, entry: e, index: i })),
        ...result.diff.modifications.map((e, i) => ({ kind: "modification" as ChangeKind, entry: e, index: i })),
        ...result.diff.mismatches.map((e, i) => ({ kind: "mismatch" as ChangeKind, entry: e, index: i })),
      ]
    : [];

  const filteredChanges =
    activeFilter === "all"
      ? allChanges
      : allChanges.filter((c) => c.kind === activeFilter);

  const summary = result?.diff.summary;

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* Upload bar */}
      <Card className="px-4 py-3 flex items-center gap-4 flex-wrap shrink-0">
        {/* Old file */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => oldInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Old XML
          </button>
          <span className="text-xs text-slate-500 truncate max-w-[140px]">
            {oldFile ? oldFile.name : "No file"}
          </span>
          <input ref={oldInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => setOldFile(e.target.files?.[0] ?? null)} />
        </div>

        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>

        {/* New file */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => newInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            New XML
          </button>
          <span className="text-xs text-slate-500 truncate max-w-[140px]">
            {newFile ? newFile.name : "No file"}
          </span>
          <input ref={newInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} />
        </div>

        <Button onClick={handleCompare} loading={loading} disabled={!oldFile || !newFile} size="sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Compare
        </Button>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">{error}</p>
        )}
      </Card>

      {/* 4-panel layout */}
      {result && (
        <div className="flex-1 grid grid-cols-[260px_1fr] grid-rows-2 gap-2 min-h-0 overflow-hidden">
          {/* ── Panel 1: Change navigator (left, full height) ── */}
          <Card className="row-span-2 flex flex-col overflow-hidden">
            {/* Summary badges */}
            <div className="px-3 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Changes</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(["all", "addition", "removal", "modification", "mismatch"] as (ChangeKind | "all")[]).map((k) => {
                  const count =
                    k === "all"
                      ? allChanges.length
                      : k === "addition"
                      ? summary!.total_additions
                      : k === "removal"
                      ? summary!.total_removals
                      : k === "modification"
                      ? summary!.total_modifications
                      : summary!.total_mismatches;
                  const style = k === "all"
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    : KIND_STYLES[k as ChangeKind].badge;
                  return (
                    <button
                      key={k}
                      onClick={() => setActiveFilter(k)}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        activeFilter === k ? "border-current ring-1 ring-current" : "border-transparent"
                      } ${style}`}
                    >
                      <span className="capitalize">{k === "all" ? "All" : KIND_LABEL[k as ChangeKind]}</span>
                      <span className="font-bold">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Change list */}
            <div className="flex-1 overflow-y-auto py-1">
              {filteredChanges.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-400">No changes</div>
              ) : (
                filteredChanges.map((change, i) => {
                  const styles = KIND_STYLES[change.kind];
                  const isSelected =
                    selectedChange?.kind === change.kind &&
                    selectedChange?.index === change.index;
                  return (
                    <button
                      key={`${change.kind}-${change.index}`}
                      onClick={() => setSelectedChange(isSelected ? null : change)}
                      className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                        isSelected ? "bg-slate-100 dark:bg-slate-800" : ""
                      }`}
                    >
                      <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${styles.dot}`} />
                      <div className="min-w-0">
                        <p className={`text-xs font-medium truncate ${styles.text}`}>
                          {KIND_LABEL[change.kind]}
                        </p>
                        <p className="text-xs text-slate-500 truncate font-mono">
                          {change.entry.path || change.entry.tag || "element"}
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {change.entry.description}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Card>

          {/* ── Panel 2: Side-by-side line diff (top-right) ── */}
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate">{result.old_filename}</span>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate">{result.new_filename}</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {result.line_diff.map((line, i) => (
                  <DiffLineRow key={i} line={line} />
                ))}
              </div>
            </div>
          </Card>

          {/* ── Panel 3 & 4: Detail view (bottom-right, split) ── */}
          <Card className="flex flex-col overflow-hidden">
            {selectedChange ? (
              <>
                <div className={`px-4 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0 ${KIND_STYLES[selectedChange.kind].bg}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${KIND_STYLES[selectedChange.kind].badge}`}>
                      {KIND_LABEL[selectedChange.kind]}
                    </span>
                    <code className="text-xs text-slate-600 dark:text-slate-400 font-mono truncate">
                      {selectedChange.entry.path}
                    </code>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedChange.entry.description}</p>
                </div>
                <div className="flex-1 grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-800 overflow-hidden">
                  {/* Old XML */}
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/10 border-b border-red-100 dark:border-red-900/30 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">Before</span>
                    </div>
                    <pre className="flex-1 p-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-auto bg-red-50/30 dark:bg-red-900/5 whitespace-pre-wrap">
                      {selectedChange.entry.old_xml ?? selectedChange.entry.xml ?? selectedChange.entry.old_content ?? "–"}
                    </pre>
                  </div>
                  {/* New XML */}
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 border-b border-emerald-100 dark:border-emerald-900/30 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">After</span>
                    </div>
                    <pre className="flex-1 p-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-auto bg-emerald-50/30 dark:bg-emerald-900/5 whitespace-pre-wrap">
                      {selectedChange.entry.new_xml ?? selectedChange.entry.xml ?? selectedChange.entry.new_content ?? selectedChange.entry.content ?? "–"}
                    </pre>
                  </div>
                </div>
                {selectedChange.entry.changes && selectedChange.entry.changes.length > 0 && (
                  <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 px-4 py-2 bg-slate-50 dark:bg-slate-900">
                    <p className="text-xs font-semibold text-slate-500 mb-1">Change details</p>
                    <ul className="space-y-0.5">
                      {selectedChange.entry.changes.map((c, i) => (
                        <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1.5">
                          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Select a change</p>
                <p className="text-xs text-slate-400 mt-1">Click any item in the change list to inspect it</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Compare XML files</p>
          <p className="text-sm text-slate-400 mt-1 max-w-xs">
            Upload an Old and New XML file above, then click Compare to see additions, removals, modifications, and mismatches.
          </p>
        </div>
      )}
    </div>
  );
}
