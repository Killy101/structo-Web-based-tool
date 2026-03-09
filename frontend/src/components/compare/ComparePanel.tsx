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

type ChangeKind = "addition" | "removal" | "modification" | "mismatch";

interface FlatChange {
  kind: ChangeKind;
  entry: DiffEntry;
  index: number;
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const KIND: Record<
  ChangeKind,
  {
    label: string;
    dot: string;
    pill: string;
    rowBg: string;
    headerBg: string;
    icon: string;
  }
> = {
  addition: {
    label: "Added",
    dot: "bg-emerald-400",
    pill: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
    rowBg: "hover:bg-emerald-500/5 border-l-2 border-l-emerald-500/40",
    headerBg: "bg-emerald-500/10 border-b border-emerald-500/20",
    icon: "text-emerald-400",
  },
  removal: {
    label: "Removed",
    dot: "bg-red-400",
    pill: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
    rowBg: "hover:bg-red-500/5 border-l-2 border-l-red-500/40",
    headerBg: "bg-red-500/10 border-b border-red-500/20",
    icon: "text-red-400",
  },
  modification: {
    label: "Modified",
    dot: "bg-amber-400",
    pill: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    rowBg: "hover:bg-amber-500/5 border-l-2 border-l-amber-500/40",
    headerBg: "bg-amber-500/10 border-b border-amber-500/20",
    icon: "text-amber-400",
  },
  mismatch: {
    label: "Mismatch",
    dot: "bg-violet-400",
    pill: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30",
    rowBg: "hover:bg-violet-500/5 border-l-2 border-l-violet-500/40",
    headerBg: "bg-violet-500/10 border-b border-violet-500/20",
    icon: "text-violet-400",
  },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function FilePickerButton({
  label,
  file,
  color,
  inputRef,
  accept,
  onChange,
}: {
  label: string;
  file: File | null;
  color: "amber" | "emerald";
  inputRef: React.RefObject<HTMLInputElement>;
  accept: string;
  onChange: (f: File | null) => void;
}) {
  const colors = {
    amber:
      "border-amber-500/40 bg-amber-500/8 text-amber-300 hover:bg-amber-500/15",
    emerald:
      "border-emerald-500/40 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/15",
  };
  const dots = { amber: "bg-amber-400", emerald: "bg-emerald-400" };

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <button
        onClick={() => inputRef.current?.click()}
        className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-semibold tracking-wide transition-all shrink-0 ${colors[color]}`}
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        {label}
      </button>
      {file ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${dots[color]}`}
          />
          <span className="text-xs text-slate-300 truncate max-w-[130px] font-mono">
            {file.name}
          </span>
          <button
            onClick={() => onChange(null)}
            className="w-4 h-4 rounded-full bg-slate-700 hover:bg-red-500/30 flex items-center justify-center transition-colors shrink-0"
          >
            <svg
              className="w-2.5 h-2.5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <span className="text-xs text-slate-600 italic">No file selected</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function LineNum({ n }: { n: number | null }) {
  return (
    <span className="select-none w-10 shrink-0 text-right pr-3 text-slate-600 text-[10px] font-mono tabular-nums">
      {n ?? ""}
    </span>
  );
}

function DiffRow({ line }: { line: LineDiff }) {
  const base = "flex items-start text-[11px] font-mono py-[3px] min-w-0";

  if (line.type === "equal") {
    return (
      <div className="flex divide-x divide-slate-800/60 group">
        <div className={`${base} flex-1 pr-2 group-hover:bg-slate-800/20`}>
          <LineNum n={line.line_old} />
          <span className="whitespace-pre text-slate-400 overflow-x-auto">
            {line.content_old}
          </span>
        </div>
        <div className={`${base} flex-1 pl-2 group-hover:bg-slate-800/20`}>
          <LineNum n={line.line_new} />
          <span className="whitespace-pre text-slate-400 overflow-x-auto">
            {line.content_new}
          </span>
        </div>
      </div>
    );
  }
  if (line.type === "delete") {
    return (
      <div className="flex divide-x divide-slate-800/60 bg-red-950/40">
        <div className={`${base} flex-1 pr-2`}>
          <LineNum n={line.line_old} />
          <span className="whitespace-pre text-red-300 overflow-x-auto">
            {line.content_old}
          </span>
        </div>
        <div className={`${base} flex-1 pl-2 opacity-0 pointer-events-none`}>
          <LineNum n={null} />
        </div>
      </div>
    );
  }
  if (line.type === "insert") {
    return (
      <div className="flex divide-x divide-slate-800/60 bg-emerald-950/40">
        <div className={`${base} flex-1 pr-2 opacity-0 pointer-events-none`}>
          <LineNum n={null} />
        </div>
        <div className={`${base} flex-1 pl-2`}>
          <LineNum n={line.line_new} />
          <span className="whitespace-pre text-emerald-300 overflow-x-auto">
            {line.content_new}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex divide-x divide-slate-800/60">
      <div
        className={`${base} flex-1 pr-2 ${line.content_old !== null ? "bg-red-950/40" : ""}`}
      >
        <LineNum n={line.line_old} />
        <span className="whitespace-pre text-red-300 overflow-x-auto">
          {line.content_old ?? ""}
        </span>
      </div>
      <div
        className={`${base} flex-1 pl-2 ${line.content_new !== null ? "bg-emerald-950/40" : ""}`}
      >
        <LineNum n={line.line_new} />
        <span className="whitespace-pre text-emerald-300 overflow-x-auto">
          {line.content_new ?? ""}
        </span>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function ComparePanel() {
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FlatChange | null>(null);
  const [filter, setFilter] = useState<ChangeKind | "all">("all");
  const [diffView, setDiffView] = useState<"line" | "structural">("line");

  const oldRef = useRef<HTMLInputElement>(
    null,
  ) as React.RefObject<HTMLInputElement>;
  const newRef = useRef<HTMLInputElement>(
    null,
  ) as React.RefObject<HTMLInputElement>;

  const handleCompare = useCallback(async () => {
    if (!oldFile || !newFile) {
      setError("Please select both files");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    setSelected(null);
    try {
      const form = new FormData();
      form.append("old_file", oldFile);
      form.append("new_file", newFile);
      const res = await fetch(`${PROCESSING_URL}/compare/diff`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(e.detail || "Comparison failed");
      }
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [oldFile, newFile]);

  const allChanges: FlatChange[] = result
    ? [
        ...result.diff.additions.map((e, i) => ({
          kind: "addition" as ChangeKind,
          entry: e,
          index: i,
        })),
        ...result.diff.removals.map((e, i) => ({
          kind: "removal" as ChangeKind,
          entry: e,
          index: i,
        })),
        ...result.diff.modifications.map((e, i) => ({
          kind: "modification" as ChangeKind,
          entry: e,
          index: i,
        })),
        ...result.diff.mismatches.map((e, i) => ({
          kind: "mismatch" as ChangeKind,
          entry: e,
          index: i,
        })),
      ]
    : [];

  const filtered =
    filter === "all" ? allChanges : allChanges.filter((c) => c.kind === filter);
  const s = result?.diff.summary;

  const filterButtons: {
    id: ChangeKind | "all";
    label: string;
    count: number;
  }[] = [
    { id: "all", label: "All", count: allChanges.length },
    { id: "addition", label: "Added", count: s?.total_additions ?? 0 },
    { id: "removal", label: "Removed", count: s?.total_removals ?? 0 },
    {
      id: "modification",
      label: "Modified",
      count: s?.total_modifications ?? 0,
    },
    { id: "mismatch", label: "Mismatch", count: s?.total_mismatches ?? 0 },
  ];

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-900/50 flex-wrap">
        <FilePickerButton
          label="OLD XML"
          file={oldFile}
          color="amber"
          inputRef={oldRef}
          accept=".xml,text/xml"
          onChange={setOldFile}
        />
        <div className="flex items-center gap-1 text-slate-600">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
        <FilePickerButton
          label="NEW XML"
          file={newFile}
          color="emerald"
          inputRef={newRef}
          accept=".xml,text/xml"
          onChange={setNewFile}
        />

        <div className="flex-1" />

        <button
          onClick={handleCompare}
          disabled={!oldFile || !newFile || loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all
            ${
              oldFile && newFile && !loading
                ? "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/20"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"
            }`}
        >
          {loading ? (
            <>
              <svg
                className="w-3.5 h-3.5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Comparing…
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              Run Compare
            </>
          )}
        </button>

        {error && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300">
            <svg
              className="w-3.5 h-3.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {error}
          </div>
        )}
      </div>

      {/* ── Results layout ── */}
      {result ? (
        <div className="flex-1 grid grid-cols-[240px_1fr] gap-3 min-h-0 overflow-hidden">
          {/* Left: Change navigator */}
          <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
            {/* Filter pills */}
            <div className="px-3 pt-3 pb-2.5 border-b border-slate-800 shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                Filter
              </p>
              <div className="flex flex-col gap-1">
                {filterButtons.map(({ id, label, count }) => {
                  const isActive = filter === id;
                  const dotColor =
                    id === "all" ? "bg-slate-400" : KIND[id as ChangeKind].dot;
                  const activeBg =
                    id === "all"
                      ? "bg-slate-700 text-white"
                      : `${KIND[id as ChangeKind].pill}`;
                  return (
                    <button
                      key={id}
                      onClick={() => setFilter(id)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
                        ${isActive ? activeBg : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${dotColor}`}
                        />
                        {label}
                      </div>
                      <span
                        className={`text-[10px] font-bold tabular-nums ${isActive ? "opacity-100" : "opacity-50"}`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Change list */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-xs text-slate-600">
                  No changes
                </div>
              ) : (
                filtered.map((change, i) => {
                  const k = KIND[change.kind];
                  const isSel =
                    selected?.kind === change.kind &&
                    selected?.index === change.index;
                  return (
                    <button
                      key={`${change.kind}-${change.index}`}
                      onClick={() => setSelected(isSel ? null : change)}
                      className={`w-full text-left px-3 py-2.5 transition-all flex items-start gap-2.5
                        ${k.rowBg} ${isSel ? "bg-slate-800" : ""}`}
                    >
                      <span
                        className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${k.dot}`}
                      />
                      <div className="min-w-0">
                        <p
                          className={`text-[10px] font-bold uppercase tracking-wider ${k.icon}`}
                        >
                          {k.label}
                        </p>
                        <p className="text-[11px] text-slate-300 truncate font-mono mt-0.5">
                          {change.entry.path?.split("/").pop() ||
                            change.entry.tag ||
                            "element"}
                        </p>
                        <p className="text-[10px] text-slate-600 truncate mt-0.5 leading-tight">
                          {change.entry.description}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: diff + detail stacked */}
          <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
            {/* Line diff panel */}
            <div
              className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden"
              style={{ flex: selected ? "0 0 55%" : "1" }}
            >
              {/* Header */}
              <div className="flex items-center gap-0 shrink-0 border-b border-slate-800">
                <div className="flex-1 flex items-center gap-2 px-4 py-2.5 border-r border-slate-800">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-[11px] font-medium text-slate-400 truncate font-mono">
                    {result.old_filename}
                  </span>
                </div>
                <div className="flex-1 flex items-center gap-2 px-4 py-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-[11px] font-medium text-slate-400 truncate font-mono">
                    {result.new_filename}
                  </span>
                </div>
                <div className="flex items-center gap-1 px-3 shrink-0 border-l border-slate-800">
                  <span className="text-[10px] text-slate-600 mr-1">View:</span>
                  {(["line", "structural"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setDiffView(v)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors capitalize
                        ${diffView === v ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-auto bg-[#080d16]">
                {diffView === "line" ? (
                  <div className="divide-y divide-slate-800/40 min-w-max">
                    {result.line_diff.map((line, i) => (
                      <DiffRow key={i} line={line} />
                    ))}
                  </div>
                ) : (
                  <div className="p-4 space-y-2">
                    {allChanges.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-8">
                        No structural changes detected
                      </p>
                    ) : (
                      allChanges.map((c, i) => {
                        const k = KIND[c.kind];
                        return (
                          <div
                            key={i}
                            className={`rounded-lg p-3 border ${k.rowBg} bg-slate-900/60`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`text-[10px] font-bold uppercase ${k.icon}`}
                              >
                                {k.label}
                              </span>
                              <code className="text-[10px] text-slate-500 font-mono truncate">
                                {c.entry.path}
                              </code>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              {c.entry.description}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Detail panel (shown when item selected) */}
            {selected && (
              <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden flex-1 min-h-0">
                {/* Header */}
                <div
                  className={`flex items-center justify-between px-4 py-2.5 shrink-0 ${KIND[selected.kind].headerBg}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${KIND[selected.kind].pill}`}
                    >
                      {KIND[selected.kind].label}
                    </span>
                    <code className="text-[11px] text-slate-400 font-mono truncate">
                      {selected.entry.path}
                    </code>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="w-6 h-6 rounded-full hover:bg-slate-700 flex items-center justify-center transition-colors shrink-0"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="flex-1 grid grid-cols-2 divide-x divide-slate-800 overflow-hidden min-h-0">
                  {/* Before */}
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-2 bg-red-950/40 border-b border-red-900/30 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">
                        Before
                      </span>
                    </div>
                    <pre className="flex-1 p-3 text-[11px] font-mono text-red-200/80 overflow-auto bg-red-950/20 whitespace-pre-wrap leading-relaxed">
                      {selected.entry.old_xml ??
                        selected.entry.xml ??
                        selected.entry.old_content ??
                        "—"}
                    </pre>
                  </div>
                  {/* After */}
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-950/40 border-b border-emerald-900/30 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                        After
                      </span>
                    </div>
                    <pre className="flex-1 p-3 text-[11px] font-mono text-emerald-200/80 overflow-auto bg-emerald-950/20 whitespace-pre-wrap leading-relaxed">
                      {selected.entry.new_xml ??
                        selected.entry.xml ??
                        selected.entry.new_content ??
                        selected.entry.content ??
                        "—"}
                    </pre>
                  </div>
                </div>

                {selected.entry.changes &&
                  selected.entry.changes.length > 0 && (
                    <div className="shrink-0 border-t border-slate-800 px-4 py-2.5 bg-slate-900/60">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                        Change Details
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selected.entry.changes.map((c, i) => (
                          <span
                            key={i}
                            className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800 px-2 py-1 rounded-lg"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Empty state */
        !loading && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center">
                <svg
                  className="w-9 h-9 text-slate-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              </div>
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <span className="text-[8px] font-bold text-amber-400">A</span>
              </div>
              <div className="absolute -bottom-1 -left-1 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <span className="text-[8px] font-bold text-emerald-400">B</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-300">
                Compare two XML files
              </p>
              <p className="text-xs text-slate-600 mt-1 max-w-xs">
                Select an OLD and NEW XML file above, then click Run Compare to
                see a full structural and line-level diff.
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
}
