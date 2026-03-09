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

// ── Design tokens ──────────────────────────────────────────────────────────────

const KIND: Record<
  ChangeKind,
  { label: string; dot: string; pill: string; rowBg: string; icon: string }
> = {
  addition: {
    label: "Addition",
    dot: "bg-emerald-400",
    pill: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
    rowBg: "border-l-2 border-l-emerald-500/40",
    icon: "text-emerald-400",
  },
  removal: {
    label: "Removal",
    dot: "bg-red-400",
    pill: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
    rowBg: "border-l-2 border-l-red-500/40",
    icon: "text-red-400",
  },
  modification: {
    label: "Modification",
    dot: "bg-amber-400",
    pill: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    rowBg: "border-l-2 border-l-amber-500/40",
    icon: "text-amber-400",
  },
  mismatch: {
    label: "Mismatch",
    dot: "bg-violet-400",
    pill: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30",
    rowBg: "border-l-2 border-l-violet-500/40",
    icon: "text-violet-400",
  },
};

// ── File picker ────────────────────────────────────────────────────────────────

function FilePicker({
  label,
  file,
  color,
  inputRef,
  onChange,
}: {
  label: string;
  file: File | null;
  color: "amber" | "emerald";
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (f: File | null, text: string) => void;
}) {
  const colors = {
    amber:
      "border-amber-500/40 bg-amber-500/8 text-amber-300 hover:bg-amber-500/15",
    emerald:
      "border-emerald-500/40 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/15",
  };
  const dots = { amber: "bg-amber-400", emerald: "bg-emerald-400" };

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      onChange(null, "");
      return;
    }
    const text = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error("Read failed"));
      r.readAsText(f);
    });
    onChange(f, text);
    e.target.value = "";
  }

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
            onClick={() => onChange(null, "")}
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
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

// ── Decision button ────────────────────────────────────────────────────────────

function DecisionBtn({
  active,
  type,
  onClick,
}: {
  active: boolean;
  type: "accept" | "reject";
  onClick: () => void;
}) {
  const styles = {
    accept: {
      active: "bg-emerald-500/20 border-emerald-500/50 text-emerald-300",
      idle: "border-slate-700 text-slate-600 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5",
    },
    reject: {
      active: "bg-red-500/20 border-red-500/50 text-red-300",
      idle: "border-slate-700 text-slate-600 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5",
    },
  };
  const s = styles[type];
  return (
    <button
      onClick={onClick}
      title={type === "accept" ? "Accept this change" : "Reject this change"}
      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all text-sm font-bold
        ${active ? s.active : s.idle}`}
    >
      {type === "accept" ? "✓" : "✗"}
    </button>
  );
}

// ── Progress ring ──────────────────────────────────────────────────────────────

function ProgressRing({
  accepted,
  rejected,
  total,
}: {
  accepted: number;
  rejected: number;
  total: number;
}) {
  if (total === 0) return null;
  const pct = Math.round(((accepted + rejected) / total) * 100);
  const r = 18,
    c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="flex items-center gap-2">
      <svg width="44" height="44" className="-rotate-90">
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#1e293b"
          strokeWidth="4"
        />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={pct === 100 ? "#34d399" : "#3b82f6"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div>
        <p className="text-sm font-bold text-white tabular-nums leading-none">
          {pct}%
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">resolved</p>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function MergePanel() {
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [oldXml, setOldXml] = useState("");
  const [newXml, setNewXml] = useState("");

  const [items, setItems] = useState<MergeItem[]>([]);
  const [mergedXml, setMerged] = useState<string | null>(null);
  const [loadingDiff, setLDiff] = useState(false);
  const [loadingMerge, setLMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDiff, setHasDiff] = useState(false);
  const [preview, setPreview] = useState<MergeItem | null>(null);

  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const handleLoadDiff = useCallback(async () => {
    if (!oldFile || !newFile) {
      setError("Please select both files");
      return;
    }
    setError(null);
    setLDiff(true);
    setHasDiff(false);
    setItems([]);
    setMerged(null);
    setPreview(null);
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
      const data: CompareResponse = await res.json();
      const d = data.diff;
      setItems([
        ...d.additions.map((e) => ({
          kind: "addition" as ChangeKind,
          entry: e,
          decision: "accept" as Decision,
        })),
        ...d.modifications.map((e) => ({
          kind: "modification" as ChangeKind,
          entry: e,
          decision: "accept" as Decision,
        })),
        ...d.mismatches.map((e) => ({
          kind: "mismatch" as ChangeKind,
          entry: e,
          decision: "pending" as Decision,
        })),
        ...d.removals.map((e) => ({
          kind: "removal" as ChangeKind,
          entry: e,
          decision: "pending" as Decision,
        })),
      ]);
      setHasDiff(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLDiff(false);
    }
  }, [oldFile, newFile]);

  function decide(idx: number, d: Decision) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, decision: d } : it)),
    );
  }

  const handleMerge = useCallback(async () => {
    setError(null);
    setLMerge(true);
    const accept = items
      .filter((i) => i.decision === "accept")
      .map((i) => i.entry.path);
    const reject = items
      .filter((i) => i.decision === "reject")
      .map((i) => i.entry.path);
    try {
      const res = await fetch(`${PROCESSING_URL}/compare/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_xml: oldXml,
          new_xml: newXml,
          accept,
          reject,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(e.detail || "Merge failed");
      }
      const data = await res.json();
      setMerged(data.merged_xml);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLMerge(false);
    }
  }, [items, oldXml, newXml]);

  function downloadMerged() {
    if (!mergedXml) return;
    const url = URL.createObjectURL(
      new Blob([mergedXml], { type: "application/xml" }),
    );
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "merged.xml",
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  const accepted = items.filter((i) => i.decision === "accept").length;
  const rejected = items.filter((i) => i.decision === "reject").length;
  const pending = items.filter((i) => i.decision === "pending").length;
  const total = items.length;

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-900/50 flex-wrap">
        <FilePicker
          label="OLD XML"
          file={oldFile}
          color="amber"
          inputRef={oldRef as React.RefObject<HTMLInputElement>}
          onChange={(f, t) => {
            setOldFile(f);
            setOldXml(t);
          }}
        />
        <div className="text-slate-700">
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
        <FilePicker
          label="OLD XML"
          file={oldFile}
          color="amber"
          inputRef={oldRef as React.RefObject<HTMLInputElement>}
          onChange={(f, t) => {
            setOldFile(f);
            setOldXml(t);
          }}
        />
        <div className="text-slate-700">
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
        <FilePicker
          label="NEW XML"
          file={newFile}
          color="emerald"
          inputRef={newRef as React.RefObject<HTMLInputElement>}
          onChange={(f, t) => {
            setNewFile(f);
            setNewXml(t);
          }}
        />

        <div className="flex-1" />

        <button
          onClick={handleLoadDiff}
          disabled={!oldFile || !newFile || loadingDiff}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all
            ${
              oldFile && newFile && !loadingDiff
                ? "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/20"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"
            }`}
        >
          {loadingDiff ? (
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
              Loading…
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Load Changes
            </>
          )}
        </button>

        {error && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300">
            <svg
              className="w-3.5 h-3.5 shrink-0"
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

      {/* ── Workspace ── */}
      {hasDiff ? (
        <div className="flex-1 grid grid-cols-[1fr_360px] gap-3 min-h-0 overflow-hidden">
          {/* Left: merged result */}
          <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-xs font-semibold text-slate-300">
                  Merged Result
                </span>
                {mergedXml && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                    Ready
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {mergedXml && (
                  <button
                    onClick={downloadMerged}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 transition-colors"
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
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    Download
                  </button>
                )}
                <button
                  onClick={handleMerge}
                  disabled={pending > 0 || loadingMerge}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                    ${
                      pending === 0 && !loadingMerge
                        ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-md shadow-blue-500/20"
                        : "bg-slate-800 text-slate-600 cursor-not-allowed"
                    }`}
                >
                  {loadingMerge ? (
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
                      Merging…
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
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      Generate Merge
                    </>
                  )}
                </button>
              </div>
            </div>

            {pending > 0 && (
              <div className="flex items-center gap-2.5 px-4 py-2 bg-amber-950/40 border-b border-amber-900/30 shrink-0">
                <svg
                  className="w-3.5 h-3.5 text-amber-400 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xs text-amber-300">
                  {pending} change{pending > 1 ? "s" : ""} still pending —
                  resolve all to unlock merge
                </p>
              </div>
            )}

            {mergedXml ? (
              <pre className="flex-1 p-4 text-[11px] font-mono text-slate-300 overflow-auto bg-[#080d16] whitespace-pre-wrap leading-relaxed">
                {mergedXml}
              </pre>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
                <div className="w-14 h-14 rounded-xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-slate-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-400">
                    Merged XML will appear here
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    Resolve all {total} changes, then click Generate Merge
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right: change decisions */}
          <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
            {/* Stats header */}
            <div className="px-4 py-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <ProgressRing
                  accepted={accepted}
                  rejected={rejected}
                  total={total}
                />
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {accepted} accepted
                    </span>
                    <span className="flex items-center gap-1 text-red-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      {rejected} rejected
                    </span>
                  </div>
                  {pending > 0 && (
                    <span className="flex items-center gap-1 text-amber-400 text-[11px] font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {pending} pending
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setItems((p) =>
                      p.map((i) => ({ ...i, decision: "accept" })),
                    )
                  }
                  className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[11px] font-semibold hover:bg-emerald-500/20 transition-colors"
                >
                  Accept All
                </button>
                <button
                  onClick={() =>
                    setItems((p) =>
                      p.map((i) => ({ ...i, decision: "reject" })),
                    )
                  }
                  className="flex-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-[11px] font-semibold hover:bg-red-500/20 transition-colors"
                >
                  Reject All
                </button>
                <button
                  onClick={() =>
                    setItems((p) =>
                      p.map((i) => ({ ...i, decision: "pending" })),
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-semibold hover:bg-slate-700 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Change list */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
              {items.map((item, idx) => {
                const k = KIND[item.kind];
                const decisionBg =
                  item.decision === "accept"
                    ? "bg-emerald-500/5"
                    : item.decision === "reject"
                      ? "bg-red-500/5"
                      : "";
                const isPreviewing =
                  preview?.entry.path === item.entry.path &&
                  preview?.kind === item.kind;

                return (
                  <div
                    key={idx}
                    className={`px-3 py-2.5 flex items-start gap-3 transition-all cursor-pointer ${k.rowBg} ${decisionBg}
                      ${isPreviewing ? "ring-1 ring-inset ring-blue-500/30 bg-blue-500/5" : "hover:bg-slate-800/30"}`}
                    onClick={() => setPreview(isPreviewing ? null : item)}
                  >
                    <span
                      className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${k.dot}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider ${k.icon}`}
                        >
                          {k.label}
                        </span>
                        {item.decision === "accept" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                            ACCEPTED
                          </span>
                        )}
                        {item.decision === "reject" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 font-semibold">
                            REJECTED
                          </span>
                        )}
                        {item.decision === "pending" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold animate-pulse">
                            PENDING
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate font-mono">
                        {item.entry.path?.split("/").pop() || item.entry.tag}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-1">
                        {item.entry.description}
                      </p>
                    </div>
                    <div
                      className="flex flex-col gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DecisionBtn
                        active={item.decision === "accept"}
                        type="accept"
                        onClick={() => decide(idx, "accept")}
                      />
                      <DecisionBtn
                        active={item.decision === "reject"}
                        type="reject"
                        onClick={() => decide(idx, "reject")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline preview */}
            {preview && (
              <div className="border-t border-slate-700 bg-slate-950/60 shrink-0 max-h-48 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Preview
                  </span>
                  <button
                    onClick={() => setPreview(null)}
                    className="w-5 h-5 rounded hover:bg-slate-700 flex items-center justify-center transition-colors"
                  >
                    <svg
                      className="w-3 h-3 text-slate-500"
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
                <div className="flex divide-x divide-slate-800 overflow-hidden flex-1">
                  <pre className="flex-1 p-2 text-[10px] font-mono text-red-300/80 overflow-auto bg-red-950/20 whitespace-pre-wrap">
                    {preview.entry.old_xml ?? preview.entry.xml ?? "—"}
                  </pre>
                  <pre className="flex-1 p-2 text-[10px] font-mono text-emerald-300/80 overflow-auto bg-emerald-950/20 whitespace-pre-wrap">
                    {preview.entry.new_xml ?? preview.entry.xml ?? "—"}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        !loadingDiff && (
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
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </div>
              {/* Decorative dots */}
              {[
                { color: "bg-emerald-400", pos: "-top-1 -right-1", label: "A" },
                { color: "bg-red-400", pos: "-bottom-1 -left-1", label: "R" },
              ].map(({ color, pos, label }) => (
                <div
                  key={label}
                  className={`absolute ${pos} w-5 h-5 rounded-full ${color}/20 border ${color.replace("bg-", "border-")}/40 flex items-center justify-center`}
                >
                  <span
                    className={`text-[8px] font-bold ${color.replace("bg-", "text-")}`}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-300">
                Merge XML changes
              </p>
              <p className="text-xs text-slate-600 mt-1 max-w-xs">
                Select OLD and NEW XML files, load their differences, then
                accept or reject each change to produce the final merged output.
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
}
