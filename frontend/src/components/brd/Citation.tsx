import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import React, { useEffect, useState, useRef } from "react";
import api from "@/app/lib/api";

interface CitationRow {
  id: string;
  level: string;
  citationRules: string;
  sourceOfLaw: string;
  isCitable: "Y" | "N" | "";
  smeComments: string;
}

interface CellImageMeta {
  id: number;
  tableIndex: number;
  rowIndex: number;
  colIndex: number;
  rid: string;
  mediaName: string;
  mimeType: string;
  cellText: string;
  section: string;
  fieldLabel: string;
}

// colIndex → CitationRow field key
const CITATION_COL_INDEX: Record<string, number> = {
  level: 0,
  citationRules: 1,
  sourceOfLaw: 2,
  smeComments: 3,
};

const INITIAL_ROWS: CitationRow[] = [];

interface Props {
  initialData?: Record<string, unknown>;
  brdId?: string;
  onDataChange?: (data: Record<string, unknown>) => void;
}

function buildRowsFromCitations(initialData?: Record<string, unknown>): CitationRow[] {
  if (!initialData) return [];
  const references = Array.isArray(initialData.references) ? initialData.references : [];
  return references
    .filter((ref): ref is Record<string, unknown> => typeof ref === "object" && ref !== null)
    .map((ref, idx) => ({
      id:            `${Date.now()}-${idx}`,
      level:         typeof ref.level         === "string" ? ref.level         : String(ref.level ?? ""),
      citationRules: typeof ref.citationRules === "string" ? ref.citationRules : "",
      sourceOfLaw:   typeof ref.sourceOfLaw   === "string" ? ref.sourceOfLaw   : "",
      isCitable:     (typeof ref.isCitable    === "string" ? ref.isCitable     : "") as "Y" | "N" | "",
      smeComments:   typeof ref.smeComments   === "string" ? ref.smeComments   : "",
    }));
}

function normalizeCitationRow(row: CitationRow) {
  return {
    level: row.level,
    citationRules: row.citationRules,
    sourceOfLaw: row.sourceOfLaw,
    isCitable: row.isCitable,
    smeComments: row.smeComments,
  };
}

function citationRowsEqualIgnoringIds(a: CitationRow[], b: CitationRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(normalizeCitationRow(a[i])) !== JSON.stringify(normalizeCitationRow(b[i]))) {
      return false;
    }
  }
  return true;
}

const COLUMNS = [
  { key: "level",         label: "Level",          width: "w-16",  icon: "⬡" },
  { key: "isCitable",     label: "Citable",        width: "w-20",  icon: "✓" },
  { key: "citationRules", label: "Citation Rules",  width: "w-72",  icon: "§" },
  { key: "sourceOfLaw",   label: "Source of Law",   width: "w-56",  icon: "⚖" },
  { key: "smeComments",   label: "SME Comments",    width: "w-52",  icon: "◈" },
];

function levelBadge(val: string) {
  const colors: Record<string, string> = {
    "1": "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40",
    "2": "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700/40",
    "3": "bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-400 border-slate-300 dark:border-[#2a3147]",
    "4": "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/40",
    "5": "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40",
  };
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${colors[val] ?? colors["3"]}`}>
      {val}
    </span>
  );
}

function citableBadge(val: string) {
  if (val === "Y") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">Y</span>
  );
  if (val === "N") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-500 dark:text-slate-500 border border-slate-300 dark:border-[#2a3147]">N</span>
  );
  return <span className="text-slate-400 dark:text-slate-600 text-[11px]">—</span>;
}

function formatCitationRulesForDisplay(value: string) {
  return value
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/\s*(Example\s*:)/gi, "\n$1\n")
    .replace(/\s*(Notes?\s*:)/gi, "\n$1\n")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

function renderCitationRulesDisplay(value: string) {
  return value.split("\n").map((line, i) => {
    const match = line.match(/^(Example\s*:|Notes?\s*:)(.*)$/i);
    if (!match) return <React.Fragment key={i}>{i > 0 ? "\n" : ""}{line}</React.Fragment>;
    return <React.Fragment key={i}>{i > 0 ? "\n" : ""}<span className="font-semibold">{match[1]}</span>{match[2] ?? ""}</React.Fragment>;
  });
}


function CellEditor({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onMD(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMD);
    return () => document.removeEventListener("mousedown", onMD);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref}>{children}</div>;
}

// Buffered textarea — only calls onChange on commit, not every keystroke.
// Prevents parent re-renders from unmounting the editor mid-edit.
function BufferedTextarea({ initialValue, rows, onCommit, onCancel, className }: {
  initialValue: string; rows: number;
  onCommit: (v: string) => void; onCancel: () => void; className: string;
}) {
  const [draft, setDraft] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <textarea ref={ref} value={draft} rows={rows}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => { if (e.key === "Escape") { onCancel(); } }}
      onBlur={() => onCommit(draft)}
      className={className}
    />
  );
}

function BufferedSelect({ initialValue, options, onCommit, className }: {
  initialValue: string;
  options: { value: string; label: string }[];
  onCommit: (v: string) => void; className: string;
}) {
  const [draft, setDraft] = useState(initialValue);
  return (
    <select autoFocus value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      className={className}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default function Citation({ initialData, brdId, onDataChange }: Props) {
  const [rows, setRows]               = useState<CitationRow[]>(INITIAL_ROWS);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [saved, setSaved]             = useState(false);
  const [images, setImages]           = useState<CellImageMeta[]>([]);
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  const API_BASE_CIT = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  function cellKey(a: string, b: string) { return `${a}-${b}`; }
  function getCellImgs(a: string, b: string): UploadedCellImage[] { return cellImages[cellKey(a, b)] ?? []; }
  function onCellUploaded(a: string, b: string, img: UploadedCellImage) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: [...(prev[k] ?? []), img] })); }
  function onCellDeleted(a: string, b: string, id: number) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: (prev[k] ?? []).filter(i => i.id !== id) })); }
  const isInitializing = useRef(false);
  const rowsRef = useRef<CitationRow[]>(INITIAL_ROWS);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    const nextRows = buildRowsFromCitations(initialData);
    if (citationRowsEqualIgnoringIds(rowsRef.current, nextRows)) return;

    isInitializing.current = true;
    setRows(nextRows);
    setEditingCell(null);
    setSaved(false);
  }, [initialData]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!onDataChange) return;
    if (isInitializing.current) { isInitializing.current = false; return; }
    onDataChange({
      references: rows.map(r => ({
        level: r.level, citationRules: r.citationRules,
        sourceOfLaw: r.sourceOfLaw, isCitable: r.isCitable,
        smeComments: r.smeComments,
      })),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    if (!brdId) return;
    const fetchImages = async () => {
      try {
        const response = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images`);
        const all: CellImageMeta[] = response.data.images ?? [];
        // Keep citation images: by section tag (new records) or tableIndex=4 (old/stale records)
        setImages(all.filter(img =>
          img.section === "citations" ||
          img.section === "unknown" && img.tableIndex === 4 ||
          !img.section && img.tableIndex === 4
        ));
        // Restore manually uploaded images into cellImages state
        const manualImgs = all.filter(img => img.section === "citations" && img.rid?.startsWith("manual-"));
        const restored: Record<string, UploadedCellImage[]> = {};
        manualImgs.forEach(img => {
          const key = img.fieldLabel ?? "";
          if (!key) return;
          if (!restored[key]) restored[key] = [];
          restored[key].push({ id: img.id, mediaName: img.mediaName, mimeType: img.mimeType, cellText: img.cellText, section: img.section, fieldLabel: img.fieldLabel });
        });
        setCellImages(restored);
      } catch (err) {
        console.error("[Citation] Error fetching images:", err);
      }
    };
    fetchImages();
  }, [brdId]);

  // Returns images for a specific row+column.
  // Primary: fieldLabel match ("Level 13") + exact colIndex.
  // Fallback: rowIndex (Word table row, 1-based because row 0 = header) + colIndex.
  function getCellImages(row: CitationRow, col: string, arrayIdx: number): CellImageMeta[] {
    const colIdx = CITATION_COL_INDEX[col] ?? -1;
    if (colIdx === -1) return [];

    const byLabel = images.filter(img =>
      img.colIndex === colIdx &&
      img.fieldLabel?.trim() === `Level ${row.level}`
    );
    if (byLabel.length > 0) return byLabel;

    return images.filter(img =>
      img.colIndex === colIdx &&
      img.rowIndex === arrayIdx + 1
    );
  }

  function updateCell(rowId: string, col: string, value: string) {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [col]: value } : r));
  }

  function addRow() {
    const newRow: CitationRow = { id: Date.now().toString(), level: "1", citationRules: "", sourceOfLaw: "", isCitable: "", smeComments: "" };
    setRows(prev => [...prev, newRow]);
    setEditingCell({ rowId: newRow.id, col: "citationRules" });
  }

  function deleteRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
    if (editingCell?.rowId === id) setEditingCell(null);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function renderCell(row: CitationRow, col: string, rowIdx: number) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
    const closeEdit = () => setEditingCell(null);
    const rawValue  = row[col as keyof CitationRow] as string;
    const shouldFmt = col === "citationRules" || col === "smeComments";
    const value     = shouldFmt ? formatCitationRulesForDisplay(rawValue) : rawValue;
    const cellImgs  = getCellImages(row, col, rowIdx);

    if (col === "level") {
      if (isEditing) return (
        <select autoFocus value={value} onChange={e => updateCell(row.id, col, e.target.value)}           className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none text-slate-700 dark:text-slate-200">
          {Array.from({ length: 15 }, (_, i) => String(i + 1)).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      return <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>{levelBadge(value)}</div>;
    }

    if (col === "isCitable") {
      if (isEditing) return (
        <select autoFocus value={value} onChange={e => updateCell(row.id, col, e.target.value)}           className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-1.5 py-1 outline-none text-slate-700 dark:text-slate-200">
          <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
        </select>
      );
      return <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>{citableBadge(value)}</div>;
    }

    if (isEditing) return (
      <textarea autoFocus value={rawValue} rows={2} onChange={e => updateCell(row.id, col, e.target.value)}         className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-none text-slate-700 dark:text-slate-200 leading-snug" />
    );

    return (
      <div onClick={() => setEditingCell({ rowId: row.id, col })}
        className="cursor-pointer min-h-[24px] text-[11.5px] text-slate-700 dark:text-slate-300 leading-snug whitespace-pre-wrap break-words hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
        title={rawValue}>
        {value ? (shouldFmt ? renderCitationRulesDisplay(value) : value) : <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
        {cellImgs.map(img => (
          <img key={img.id}
            src={`${API_BASE}/brd/${brdId}/images/${img.id}/blob`}
            alt={img.cellText || img.mediaName}
            className="mt-1 max-w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f35]"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-700/40">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300" style={{ fontFamily: "'DM Mono', monospace" }}>Citation</p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">Click any cell to edit · {rows.length} rule{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSave} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${saved ? "bg-emerald-500 text-white" : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"}`}>
            {saved
              ? <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved!</>
              : <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>}
          </button>
          <button onClick={addRow} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            Add Row
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: "860px" }}>
            <thead>
              <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                {COLUMNS.map(col => (
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
                  {COLUMNS.map(col => (
                    <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>
                      <div className="group">
                        {renderCell(row, col.key, idx)}
                        {getCellImgs(row.level, col.key).map(img => (
                          <img key={`m-${img.id}`} src={`${API_BASE_CIT}/brd/${brdId}/images/${img.id}/blob`} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                        ))}
                        {brdId && <CellImageUploader brdId={brdId} section="citations" fieldLabel={cellKey(row.level, col.key)} existingImages={getCellImgs(row.level, col.key)} onUploaded={img => onCellUploaded(row.level, col.key, img)} onDeleted={id => onCellDeleted(row.level, col.key, id)}/>}
                      </div>
                    </td>
                  ))}
                  <td className="w-8 px-2 py-2 align-top">
                    <button onClick={() => deleteRow(row.id)} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-12 text-center">
                    <p className="text-[12.5px] text-slate-500 dark:text-slate-500">No citation rules yet</p>
                    <button onClick={addRow} className="mt-2 text-[12px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first rule</button>
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