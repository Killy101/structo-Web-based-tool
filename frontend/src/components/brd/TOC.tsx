// ── TOC.tsx ──────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";

interface TocRow {
  id: string;
  level: string;
  name: string;
  required: "true" | "false" | "Conditional" | "";
  definition: string;
  example: string;
  note: string;
  tocRequirements: string;
  smeComments: string;
}

const INITIAL_ROWS: TocRow[] = [];

interface Props {
  initialData?: {
    sections?: Array<{
      id?: string;
      level?: string;
      name?: string;
      required?: string;
      definition?: string;
      example?: string;
      note?: string;
      tocRequirements?: string;
      smeComments?: string;
    }>;
  };
}

function buildRowsFromToc(initialData?: Props["initialData"]): TocRow[] {
  const sections = Array.isArray(initialData?.sections) ? initialData.sections : [];

  if (sections.length === 0) {
    // Return sample data for demonstration/empty state
    // Use a stable prefix so HMR doesn't regenerate ids on every re-render
    const prefix = "sample";
    return [
      {
        id: `${prefix}-0`,
        level: "0",
        name: "",
        required: "true",
        definition: "Hardcoded -- /AU",
        example: "",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: `${prefix}-1`,
        level: "1",
        name: "",
        required: "true",
        definition: "Hardcoded --/AUDEPLegInst",
        example: "",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: `${prefix}-2`,
        level: "2",
        name: "",
        required: "true",
        definition: "Document title",
        example: "Fair Work Regulations 2009",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: `${prefix}-10`,
        level: "10",
        name: "",
        required: "false",
        definition: "Sub-incrementing lowercase letter",
        example: "(a), (i)",
        note: "Anti-Money Laundering Rules/CHAPTER 27/27.1/(A)/(13)/(a)",
        tocRequirements: "",
        smeComments: "No need to include this level",
      },
    ];
  }

  // ── CRITICAL: always use positional index for id, never section.id ──────────
  // section.id from the extractor is often the level number (e.g. "2"), which
  // is NOT unique if the extractor returns duplicate entries or if two sections
  // share the same level value. Using the array index guarantees uniqueness.
  const timestamp = Date.now();

  return sections
    .filter((section): section is NonNullable<typeof sections[number]> =>
      typeof section === "object" && section !== null
    )
    .map((section, index) => {
      // Normalise level: strip any markdown bold formatting (e.g. "**10**")
      let rawLevel = String(section.level ?? section.id ?? index + 1);
      const levelMatch = rawLevel.match(/\*{1,2}(\d+)\*{1,2}|\b(\d+)\b/);
      const level = levelMatch
        ? (levelMatch[1] ?? levelMatch[2] ?? rawLevel)
        : rawLevel;

      return {
        // Always index-based — guarantees no duplicates regardless of extractor output
        id: `${timestamp}-${index}`,
        level: level.trim(),
        name: section.name ?? "",
        required: mapRequiredValue(section.required),
        definition: section.definition ?? "",
        example: section.example ?? "",
        note: section.note ?? "",
        tocRequirements: section.tocRequirements ?? "",
        smeComments: section.smeComments ?? "",
      };
    })
    .sort((a, b) => (parseInt(a.level) || 0) - (parseInt(b.level) || 0));
}

function mapRequiredValue(val?: string): TocRow["required"] {
  if (!val) return "";
  const lower = val.toLowerCase().trim();
  if (lower === "true"  || lower === "yes" || lower === "y") return "true";
  if (lower === "false" || lower === "no"  || lower === "n") return "false";
  if (lower.includes("conditional") || lower.includes("cond")) return "Conditional";
  if (val === "true" || val === "false" || val === "Conditional") return val;
  return "";
}

const REQUIRED_OPTIONS = ["true", "false", "Conditional"] as const;

const COLUMNS = [
  { key: "level",           label: "Level",            width: "w-20",  icon: "⬡" },
  { key: "name",            label: "Name",             width: "w-40",  icon: "≡" },
  { key: "required",        label: "Required",         width: "w-28",  icon: "◈" },
  { key: "definition",      label: "Definition",       width: "w-52",  icon: "◎" },
  { key: "example",         label: "Example",          width: "w-48",  icon: "✦" },
  { key: "note",            label: "Note",             width: "w-44",  icon: "↑" },
  { key: "tocRequirements", label: "TOC Requirements", width: "w-52",  icon: "≡" },
  { key: "smeComments",     label: "SME Comments",     width: "w-48",  icon: "◈" },
];

function requiredBadge(val: string) {
  if (val === "true")
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">true</span>;
  if (val === "false")
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-500 border border-slate-300 dark:border-[#2a3147]">false</span>;
  if (val === "Conditional")
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40">Cond.</span>;
  return <span className="text-slate-400 dark:text-slate-600 text-[11px]">—</span>;
}

function levelBadge(val: string) {
  const colors: Record<string, string> = {
    "0":  "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700/40",
    "1":  "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40",
    "2":  "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700/40",
    "3":  "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700/40",
    "4":  "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/40",
    "5":  "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40",
    "6":  "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700/40",
    "7":  "bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-700/40",
    "8":  "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700/40",
    "9":  "bg-pink-50 dark:bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-300 dark:border-pink-700/40",
    "10": "bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700/40",
    "11": "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700/40",
    "12": "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700/40",
    "13": "bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700/40",
    "14": "bg-gray-50 dark:bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-700/40",
    "15": "bg-slate-100 dark:bg-[#252d45] text-slate-700 dark:text-slate-400 border-slate-300 dark:border-[#2a3147]",
  };
  const defaultColor = "bg-slate-100 dark:bg-[#252d45] text-slate-700 dark:text-slate-400 border-slate-300 dark:border-[#2a3147]";
  const colorClass = colors[val] ?? defaultColor;
  const widthClass = val.length >= 2 ? "w-8" : "w-7";
  return (
    <span className={`inline-flex items-center justify-center ${widthClass} h-7 rounded-full text-[11px] font-bold border ${colorClass}`}>
      {val}
    </span>
  );
}

function formatTocCellForDisplay(value: string, col: string) {
  let formatted = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (["name", "definition", "example", "note", "tocRequirements", "smeComments"].includes(col)) {
    formatted = formatted.replace(/[ \t]{2,}/g, "\n");
  }
  return formatted;
}

export default function TOC({ initialData }: Props) {
  const [rows, setRows]             = useState<TocRow[]>(INITIAL_ROWS);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [saved, setSaved]           = useState(false);

  useEffect(() => {
    setRows(buildRowsFromToc(initialData));
    setEditingCell(null);
    setSaved(false);
  }, [initialData]);

  function updateCell(rowId: string, col: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [col]: value } : r)));
  }

  function addRow() {
    const maxLevel = rows.reduce((max, row) => Math.max(max, parseInt(row.level) || 0), 0);
    const newRow: TocRow = {
      id: `${Date.now()}-new`,
      level: String(maxLevel + 1),
      name: "",
      required: "",
      definition: "",
      example: "",
      note: "",
      tocRequirements: "",
      smeComments: "",
    };
    setRows((prev) => [...prev, newRow]);
    setEditingCell({ rowId: newRow.id, col: "name" });
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function renderCell(row: TocRow, col: string) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
    const rawValue  = row[col as keyof TocRow] as string;
    const value     = formatTocCellForDisplay(rawValue, col);

    if (col === "required") {
      if (isEditing) {
        return (
          <select
            autoFocus
            value={rawValue}
            onChange={(e) => updateCell(row.id, col, e.target.value)}
            onBlur={() => setEditingCell(null)}
            className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none text-slate-700 dark:text-slate-200"
          >
            <option value="">—</option>
            {REQUIRED_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      return (
        <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>
          {requiredBadge(value)}
        </div>
      );
    }

    if (col === "level") {
      if (isEditing) {
        return (
          <input
            type="text"
            autoFocus
            value={rawValue}
            onChange={(e) => updateCell(row.id, col, e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => setEditingCell(null)}
            className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none text-slate-700 dark:text-slate-200"
            placeholder="0-99"
            maxLength={2}
          />
        );
      }
      return (
        <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>
          {levelBadge(value)}
        </div>
      );
    }

    if (isEditing) {
      return (
        <textarea
          autoFocus
          value={rawValue}
          rows={2}
          onChange={(e) => updateCell(row.id, col, e.target.value)}
          onBlur={() => setEditingCell(null)}
          className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-none text-slate-700 dark:text-slate-200 leading-snug"
        />
      );
    }

    return (
      <div
        onClick={() => setEditingCell({ rowId: row.id, col })}
        className="cursor-pointer min-h-[24px] text-[11.5px] text-slate-700 dark:text-slate-300 leading-snug whitespace-pre-wrap break-words hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
        title={rawValue}
      >
        {value || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/30 p-4">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-700/40">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-800 dark:text-indigo-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            Table of Contents
          </p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">
            Click any cell to edit · {rows.length} section{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
              saved
                ? "bg-emerald-500 text-white"
                : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"
            }`}
          >
            {saved ? (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved!</>
            ) : (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>
            )}
          </button>
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            Add Row
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
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>
                        {col.label}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
              {rows.map((row, idx) => (
                <tr
                  key={row.id}   // ← always `${timestamp}-${index}`, guaranteed unique
                  className={`group transition-colors ${
                    idx % 2 === 0
                      ? "bg-white dark:bg-[#161b2e]"
                      : "bg-slate-50/60 dark:bg-[#1a1f35]"
                  } hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}
                >
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>
                      {renderCell(row, col.key)}
                    </td>
                  ))}
                  <td className="w-8 px-2 py-2 align-top">
                    <button
                      onClick={() => deleteRow(row.id)}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-12 text-center">
                    <p className="text-[12.5px] text-slate-500 dark:text-slate-500">No sections yet</p>
                    <button onClick={addRow} className="mt-2 text-[12px] text-blue-600 dark:text-blue-400 hover:underline">
                      + Add first section
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}