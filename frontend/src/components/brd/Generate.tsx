import React, { useState } from "react";

interface Props {
  brdId?: string;
  title?: string;
  format?: "new" | "old";
  onEdit?: (step: number) => void;
  onComplete?: () => void;
  canEdit?: boolean;
}

// ── Icons ──────────────────────────────────────────────────────────────────────
const EditIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

// ── Section wrapper ────────────────────────────────────────────────────────────
function SectionCard({ icon, label, step, onEdit, children, canEdit = true }: {
  icon: string; label: string; step: number;
  onEdit: (step: number) => void; children: React.ReactNode;
  canEdit?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-[#2a3147] flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-[#161b2e]">
        <div className="flex items-center gap-2">
          <span className="text-black dark:text-slate-400 text-sm leading-none">{icon}</span>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-black dark:text-slate-300"
             style={{ fontFamily: "'DM Mono', monospace" }}>{label}</p>
        </div>
        {canEdit && (
          <button
            onClick={() => onEdit(step)}
            className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#3a4460] hover:bg-slate-100 dark:hover:bg-[#2e3a55] hover:text-slate-800 dark:hover:text-slate-200 transition-all"
          >
            <EditIcon /> Edit
          </button>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ── Key-value field ────────────────────────────────────────────────────────────
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 py-1.5 border-b border-slate-50 dark:border-[#252d45] last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-black dark:text-slate-300 w-full sm:w-32 flex-shrink-0 pt-px"
            style={{ fontFamily: "'DM Mono', monospace" }}>{label}</span>
      <span className="text-[12px] text-slate-700 dark:text-slate-300 flex-1 break-all">
        {value || <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
      </span>
    </div>
  );
}

// ── Mini inline table ──────────────────────────────────────────────────────────
function MiniTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto -mx-4">
      <table className="w-full text-[11.5px] border-collapse min-w-[500px]">
        <thead>
          <tr className="bg-slate-100 dark:bg-[#161b2e] border-b border-slate-200 dark:border-[#2a3147]">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-black dark:text-slate-300 whitespace-nowrap"
                  style={{ fontFamily: "'DM Mono', monospace" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-[#252d45]" style={{ fontWeight: 400 }}>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-[#1a1f35]/40"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-slate-700 dark:text-slate-300 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Level badge ────────────────────────────────────────────────────────────────
function LevelBadge({ level }: { level: string }) {
  const c: Record<string, string> = {
    "1": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-700/40",
    "2": "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-700/40",
    "3": "bg-slate-100 text-slate-600 border-slate-200 dark:bg-[#252d45] dark:text-slate-400 dark:border-[#3a4460]",
  };
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border ${c[level] ?? c["3"]}`}>{level}</span>
  );
}

// ── Required badge ─────────────────────────────────────────────────────────────
function RequiredBadge({ val }: { val: string }) {
  if (val === "Yes")         return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-700/40">Yes</span>;
  if (val === "Conditional") return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-700/40">Cond.</span>;
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 dark:bg-[#252d45] dark:text-slate-500 dark:border-[#3a4460]">No</span>;
}

// ── Generate action card ───────────────────────────────────────────────────────
function GenerateBtn({ label, icon, description, color, onClick, loading, done }: {
  label: string; icon: string; description: string;
  color: "slate" | "blue" | "violet" | "indigo";
  onClick: () => void; loading: boolean; done: boolean;
}) {
  const btnStyles: Record<string, string> = {
    slate:  "bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 ring-slate-200 dark:ring-slate-700",
    blue:   "bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 ring-blue-100 dark:ring-blue-900/40",
    violet: "bg-violet-600 hover:bg-violet-700 dark:hover:bg-violet-500 ring-violet-100 dark:ring-violet-900/40",
    indigo:  "bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 ring-indigo-100 dark:ring-indigo-900/40",
  };

  return (
    <div className={`flex-1 rounded-xl border-2 transition-all p-3.5 flex flex-col gap-3 ${
      done
        ? "border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/40 dark:bg-emerald-500/5"
        : "border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1e2235]"
    }`}>
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
          done ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-slate-100 dark:bg-[#252d45]"
        }`}>
          {done
            ? <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            : icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[11.5px] font-semibold leading-tight ${done ? "text-emerald-700 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"}`}>{label}</p>
          <p className="text-[10.5px] text-slate-500 dark:text-slate-500 mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={loading || done}
        className={`w-full py-1.5 rounded-lg text-[11.5px] font-semibold text-white transition-all ring-4 ${btnStyles[color]} disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {loading
          ? <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
              </svg>
              Generating…
            </span>
          : done ? "Generated ✓" : label}
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Generate({ brdId, title, format, onEdit, onComplete, canEdit = true }: Props) {
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [done, setDone]             = useState<Record<string, boolean>>({});

  function runGenerate(key: string) {
    setGenerating((p) => ({ ...p, [key]: true }));
    setTimeout(() => {
      setGenerating((p) => ({ ...p, [key]: false }));
      setDone((p)       => ({ ...p, [key]: true  }));
    }, 3000);
  }

  const allDone = done["brd"] && done["metajson"] && done["innod"] && done["content"];
  const noop = () => {};

  return (
    <div className="space-y-4">

      {/* ── Active BRD Context ── */}
      <div className="rounded-xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            Active BRD
          </span>
          <span className="font-mono text-[10.5px] bg-slate-100 dark:bg-[#252d45] border border-slate-200 dark:border-[#3a4460] px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
            {brdId ?? "BRD"}
          </span>
          {title && (
            <span className="text-[11.5px] text-slate-800 dark:text-slate-300 truncate">{title}</span>
          )}
        </div>
      </div>

      {/* ── 1. Scope — full table ── */}
      <SectionCard icon="◎" label="Scope" step={1} onEdit={onEdit ?? noop} canEdit={canEdit}>
        <MiniTable
          headers={["Document Title", "Reference Link", "Content URL", "Issuing Authority", "ASRB ID"]}
          rows={[]}
        />
      </SectionCard>

      {/* ── 2. Metadata ── */}
      <SectionCard icon="≡" label="Metadata" step={2} onEdit={onEdit ?? noop} canEdit={canEdit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8">
          <Field label="Source Type"    value="" />
          <Field label="Issuing Agency" value="" />
          <Field label="Geography"      value="" />
          <Field label="Language"       value="" />
          <Field label="Pub. Date"      value="" />
          <Field label="Last Updated"   value="" />
          <Field label="Status"         value="" />
          <Field label="Payload Type"   value="" />
          <Field label="Content URL"    value="" />
        </div>
      </SectionCard>

      {/* ── 3. TOC — full table ── */}
      <SectionCard icon="✦" label="Table of Contents" step={3} onEdit={onEdit ?? noop} canEdit={canEdit}>
        <MiniTable
          headers={["Lvl", "Name", "Required", "Definition", "TOC Requirements"]}
          rows={[]}
        />
      </SectionCard>

      {/* ── 4. Citation — full table ── */}
      <SectionCard icon="§" label="Citation Rules" step={4} onEdit={onEdit ?? noop} canEdit={canEdit}>
        <MiniTable
          headers={["Lvl", "Citation Rules", "Source of Law", "SME Comments"]}
          rows={[]}
        />
      </SectionCard>

      {/* ── 5. Content Profile — two sub-tables ── */}
      <SectionCard icon="⬡" label="Content Profiling" step={5} onEdit={onEdit ?? noop} canEdit={canEdit}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 pb-3 border-b border-slate-100 dark:border-[#252d45]">
            <Field label="RC Filename"      value="" />
            <Field label="Heading Ann."     value="" />
            <Field label="Hardcoded Path"   value="" />
          </div>

           <p className="text-[10px] font-bold uppercase tracking-widest text-black dark:text-slate-300"
             style={{ fontFamily: "'DM Mono', monospace" }}>Level Numbers</p>
          <MiniTable
            headers={["Level", "REDJAy XML Tag", "Remarks"]}
            rows={[]}
          />

           <p className="text-[10px] font-bold uppercase tracking-widest text-black dark:text-slate-300 pt-1"
             style={{ fontFamily: "'DM Mono', monospace" }}>Whitespace Handling</p>
          <MiniTable
            headers={["Tags", "InnodReplace"]}
            rows={[]}
          />
        </div>
      </SectionCard>

      {/* ── Divider ── */}
      <div className="h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-[#2a3147] to-transparent" />

      {/* ── Generate outputs ── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-black dark:text-slate-300 mb-3"
           style={{ fontFamily: "'DM Mono', monospace" }}>
          Generate Outputs
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <GenerateBtn
            label="Generate BRD"
            icon="✦"
            description="Compile all sections into the final BRD document"
            color="slate"
            onClick={() => runGenerate("brd")}
            loading={!!generating["brd"]}
            done={!!done["brd"]}
          />
          <GenerateBtn
            label="Generate Metajson"
            icon="≡"
            description="Export metadata as structured JSON in the selected schema"
            color="blue"
            onClick={() => runGenerate("metajson")}
            loading={!!generating["metajson"]}
            done={!!done["metajson"]}
          />
          <GenerateBtn
            label="Generate Metajson for Innod.Xml"
            icon="◇"
            description="Build Innod-compatible XML metadata JSON output"
            color="indigo"
            onClick={() => runGenerate("innod")}
            loading={!!generating["innod"]}
            done={!!done["innod"]}
          />
          <GenerateBtn
            label="Generate Content Profile"
            icon="⬡"
            description="Build the XML content profile with level and whitespace rules"
            color="violet"
            onClick={() => runGenerate("content")}
            loading={!!generating["content"]}
            done={!!done["content"]}
          />
        </div>
      </div>

      {/* ── All done banner ── */}
      {allDone && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-700/40">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[12.5px] font-medium text-emerald-800 dark:text-emerald-400">
              All outputs generated — <span className="font-bold">{brdId ?? "BRD"}</span> is ready
            </p>
          </div>
          <button
            onClick={onComplete}
            className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20"
          >
            Back to Registry
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}