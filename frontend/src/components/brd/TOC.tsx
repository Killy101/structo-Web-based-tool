// ── TOC.tsx ──────────────────────────────────────────────────────────────────
import React, { useState } from "react";

interface TocRow {
  id: string;
  level: string;
  name: string;
  required: "Yes" | "No" | "Conditional" | "";
  definition: string;
  example: string;
  note: string;
  tocRequirements: string;
  smeComments: string;
}

const INITIAL_ROWS: TocRow[] = [];

const REQUIRED_OPTIONS = ["Yes", "No", "Conditional"] as const;

const COLUMNS = [
  { key: "level",           label: "Level",            width: "w-16",  icon: "⬡" },
  { key: "name",            label: "Name",             width: "w-40",  icon: "≡" },
  { key: "required",        label: "Required",         width: "w-28",  icon: "◈" },
  { key: "definition",      label: "Definition",       width: "w-52",  icon: "◎" },
  { key: "example",         label: "Example",          width: "w-48",  icon: "✦" },
  { key: "note",            label: "Note",             width: "w-44",  icon: "↑" },
  { key: "tocRequirements", label: "TOC Requirements", width: "w-52",  icon: "≡" },
  { key: "smeComments",     label: "SME Comments",     width: "w-48",  icon: "◈" },
];

function requiredBadge(val: string) {
  if (val === "Yes") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">Yes</span>;
  if (val === "No") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-500 border border-slate-300 dark:border-[#2a3147]">No</span>;
  if (val === "Conditional") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40">Cond.</span>;
  return <span className="text-slate-400 dark:text-slate-600 text-[11px]">—</span>;
}

function levelBadge(val: string) {
  const colors: Record<string, string> = {
    "1": "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40",
    "2": "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700/40",
    "3": "bg-slate-100 dark:bg-[#252d45] text-slate-700 dark:text-slate-400 border-slate-300 dark:border-[#2a3147]",
    "4": "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/40",
    "5": "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40",
  };
  return <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${colors[val] ?? colors["3"]}`}>{val}</span>;
}

function ValidateButton() {
  return (
    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white dark:bg-[#1e2235] text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700/40 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      Validate
    </button>
  );
}

export default function TOC() {
  const [rows, setRows] = useState<TocRow[]>(INITIAL_ROWS);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [saved, setSaved] = useState(false);

  function updateCell(rowId: string, col: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [col]: value } : r)));
  }

  function addRow() {
    const nextLevel = ((rows.length % 5) + 1).toString();
    const newRow: TocRow = { id: Date.now().toString(), level: nextLevel, name: "", required: "", definition: "", example: "", note: "", tocRequirements: "", smeComments: "" };
    setRows((prev) => [...prev, newRow]);
    setEditingCell({ rowId: newRow.id, col: "name" });
  }

  function deleteRow(id: string) { setRows((prev) => prev.filter((r) => r.id !== id)); }

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2000); }

  function renderCell(row: TocRow, col: string) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
    const value = row[col as keyof TocRow] as string;

    if (col === "required") {
      if (isEditing) return <select autoFocus value={value} onChange={(e) => updateCell(row.id, col, e.target.value)} onBlur={() => setEditingCell(null)} className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none text-slate-700 dark:text-slate-200"><option value="">—</option>{REQUIRED_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
      return <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>{requiredBadge(value)}</div>;
    }

    if (col === "level") {
      if (isEditing) return <select autoFocus value={value} onChange={(e) => updateCell(row.id, col, e.target.value)} onBlur={() => setEditingCell(null)} className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none text-slate-700 dark:text-slate-200">{["1", "2", "3", "4", "5"].map((o) => <option key={o} value={o}>{o}</option>)}</select>;
      return <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>{levelBadge(value)}</div>;
    }

    if (isEditing) return <textarea autoFocus value={value} rows={2} onChange={(e) => updateCell(row.id, col, e.target.value)} onBlur={() => setEditingCell(null)} className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-none text-slate-700 dark:text-slate-200 leading-snug" />;

    return <div onClick={() => setEditingCell({ rowId: row.id, col })} className="cursor-pointer min-h-[24px] text-[11.5px] text-slate-700 dark:text-slate-300 leading-snug line-clamp-2 hover:text-slate-900 dark:hover:text-slate-100 transition-colors" title={value}>{value || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</div>;
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/30 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>Table of Contents</p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">Click any cell to edit · {rows.length} section{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <ValidateButton />
          <button onClick={handleSave} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${saved ? "bg-emerald-500 text-white" : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"}`}>
            {saved ? (<><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved!</>) : (<><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>)}
          </button>
          <button onClick={addRow} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add Row
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: "1100px" }}>
            <thead>
              <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                {COLUMNS.map((col) => (
                  <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-black dark:text-slate-400">{col.icon}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>{col.label}</span>
                    </div>
                  </th>
                ))}
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
              {rows.map((row, idx) => (
                <tr key={row.id} className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>{renderCell(row, col.key)}</td>
                  ))}
                  <td className="w-8 px-2 py-2 align-top">
                    <button onClick={() => deleteRow(row.id)} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} className="py-12 text-center"><p className="text-[12.5px] text-slate-500 dark:text-slate-500">No sections yet</p><button onClick={addRow} className="mt-2 text-[12px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first section</button></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}