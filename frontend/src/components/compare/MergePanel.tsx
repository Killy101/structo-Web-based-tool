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
}

interface DiffResult {
  additions: DiffEntry[];
  removals: DiffEntry[];
  modifications: DiffEntry[];
  mismatches: DiffEntry[];
  summary: {
    total_additions: number;
    total_removals: number;
    total_modifications: number;
    total_mismatches: number;
  };
}

interface CompareResponse {
  success: boolean;
  diff: DiffResult;
  line_diff: unknown[];
}

type ChangeKind = "addition" | "removal" | "modification" | "mismatch";
type Decision = "accept" | "reject" | "pending";

interface MergeItem {
  kind: ChangeKind;
  entry: DiffEntry;
  decision: Decision;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const KIND_STYLES: Record<ChangeKind, { dot: string; label: string; badgeAccept: string; badgeReject: string }> = {
  addition:     { dot: "bg-emerald-500", label: "Addition",     badgeAccept: "bg-emerald-100 text-emerald-700", badgeReject: "bg-red-100 text-red-600" },
  removal:      { dot: "bg-red-500",     label: "Removal",      badgeAccept: "bg-red-100 text-red-700",         badgeReject: "bg-slate-100 text-slate-600" },
  modification: { dot: "bg-amber-500",   label: "Modification", badgeAccept: "bg-amber-100 text-amber-700",     badgeReject: "bg-slate-100 text-slate-600" },
  mismatch:     { dot: "bg-violet-500",  label: "Mismatch",     badgeAccept: "bg-violet-100 text-violet-700",   badgeReject: "bg-slate-100 text-slate-600" },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function MergePanel() {
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [oldXml, setOldXml] = useState<string>("");
  const [newXml, setNewXml] = useState<string>("");

  const [items, setItems] = useState<MergeItem[]>([]);
  const [mergedXml, setMergedXml] = useState<string | null>(null);

  const [loadingDiff, setLoadingDiff] = useState(false);
  const [loadingMerge, setLoadingMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDiff, setHasDiff] = useState(false);

  const oldInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  // Read file as text
  async function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  async function handleOldFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setOldFile(file);
    if (file) setOldXml(await readFile(file));
    e.target.value = "";
  }

  async function handleNewFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setNewFile(file);
    if (file) setNewXml(await readFile(file));
    e.target.value = "";
  }

  const handleLoadDiff = useCallback(async () => {
    if (!oldFile || !newFile) {
      setError("Please select both Old and New XML files");
      return;
    }
    setError(null);
    setLoadingDiff(true);
    setHasDiff(false);
    setItems([]);
    setMergedXml(null);

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
      const diff = data.diff;

      // Build merge items — additions/modifications accept by default, removals pending
      const newItems: MergeItem[] = [
        ...diff.additions.map((e) => ({ kind: "addition" as ChangeKind, entry: e, decision: "accept" as Decision })),
        ...diff.modifications.map((e) => ({ kind: "modification" as ChangeKind, entry: e, decision: "accept" as Decision })),
        ...diff.mismatches.map((e) => ({ kind: "mismatch" as ChangeKind, entry: e, decision: "pending" as Decision })),
        ...diff.removals.map((e) => ({ kind: "removal" as ChangeKind, entry: e, decision: "pending" as Decision })),
      ];

      setItems(newItems);
      setHasDiff(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoadingDiff(false);
    }
  }, [oldFile, newFile]);

  function setDecision(idx: number, decision: Decision) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, decision } : item));
  }

  function acceptAll() {
    setItems((prev) => prev.map((item) => ({ ...item, decision: "accept" })));
  }

  function rejectAll() {
    setItems((prev) => prev.map((item) => ({ ...item, decision: "reject" })));
  }

  const handleMerge = useCallback(async () => {
    setError(null);
    setLoadingMerge(true);

    const accept = items.filter((i) => i.decision === "accept").map((i) => i.entry.path);
    const reject = items.filter((i) => i.decision === "reject").map((i) => i.entry.path);

    try {
      const res = await fetch(`${PROCESSING_URL}/compare/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_xml: oldXml, new_xml: newXml, accept, reject }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || "Merge failed");
      }
      const data = await res.json();
      setMergedXml(data.merged_xml);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoadingMerge(false);
    }
  }, [items, oldXml, newXml]);

  function downloadMerged() {
    if (!mergedXml) return;
    const blob = new Blob([mergedXml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged.xml";
    a.click();
    URL.revokeObjectURL(url);
  }

  const accepted = items.filter((i) => i.decision === "accept").length;
  const rejected = items.filter((i) => i.decision === "reject").length;
  const pending = items.filter((i) => i.decision === "pending").length;

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* Upload bar */}
      <Card className="px-4 py-3 flex items-center gap-4 flex-wrap shrink-0">
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
          <input ref={oldInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleOldFile} />
        </div>

        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>

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
          <input ref={newInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleNewFile} />
        </div>

        <Button onClick={handleLoadDiff} loading={loadingDiff} disabled={!oldFile || !newFile} size="sm">
          Load Changes
        </Button>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">{error}</p>
        )}
      </Card>

      {/* Merge workspace */}
      {hasDiff && (
        <div className="flex-1 grid grid-cols-[1fr_380px] gap-3 min-h-0 overflow-hidden">
          {/* Left: merged XML preview */}
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#1a56f0]" />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Merged Result</span>
              </div>
              <div className="flex items-center gap-2">
                {mergedXml && (
                  <Button size="xs" variant="success" onClick={downloadMerged}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </Button>
                )}
                <Button size="xs" onClick={handleMerge} loading={loadingMerge} disabled={pending > 0}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Merge
                </Button>
              </div>
            </div>

            {pending > 0 && (
              <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/30 shrink-0">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {pending} change{pending > 1 ? "s" : ""} still pending — resolve all before generating merge.
                </p>
              </div>
            )}

            {mergedXml ? (
              <pre className="flex-1 p-4 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-auto bg-slate-50 dark:bg-slate-950 whitespace-pre-wrap">
                {mergedXml}
              </pre>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium">Merged XML will appear here</p>
                <p className="text-xs mt-1">Resolve all changes then click Generate Merge</p>
              </div>
            )}
          </Card>

          {/* Right: change decisions */}
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {items.length} changes
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-emerald-600 font-medium">{accepted}✓</span>
                <span className="text-xs text-red-500 font-medium">{rejected}✗</span>
                {pending > 0 && <span className="text-xs text-amber-600 font-medium">{pending}?</span>}
                <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 mx-1" />
                <button onClick={acceptAll} className="text-xs text-emerald-600 hover:underline font-medium">All</button>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <button onClick={rejectAll} className="text-xs text-red-500 hover:underline font-medium">None</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800/60">
              {items.map((item, idx) => {
                const styles = KIND_STYLES[item.kind];
                return (
                  <div key={idx} className="px-3 py-2.5 flex items-start gap-3">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${styles.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                          item.decision === "accept" ? styles.badgeAccept :
                          item.decision === "reject" ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" :
                          "bg-amber-50 text-amber-600 dark:bg-amber-900/20"
                        }`}>
                          {styles.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate font-mono">{item.entry.path || item.entry.tag}</p>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{item.entry.description}</p>
                    </div>
                    {/* Decision buttons */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => setDecision(idx, "accept")}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-sm ${
                          item.decision === "accept"
                            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-emerald-50 hover:text-emerald-500"
                        }`}
                        title="Accept this change"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setDecision(idx, "reject")}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-sm ${
                          item.decision === "reject"
                            ? "bg-red-100 text-red-600 dark:bg-red-900/40"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-red-50 hover:text-red-500"
                        }`}
                        title="Reject this change"
                      >
                        ✗
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!hasDiff && !loadingDiff && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Merge XML files</p>
          <p className="text-sm text-slate-400 mt-1 max-w-xs">
            Upload Old and New XML files, load their differences, then accept or reject each change before generating the final merged XML.
          </p>
        </div>
      )}
    </div>
  );
}
