import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import BrdTableHeaderCell from "./BrdTableHeaderCell";
import RichTextEditableField from "./RichTextEditableField";
import React, { useEffect, useState, useRef } from "react";
import api from "@/app/lib/api";
import BrdImage from "./BrdImage";
import { buildBrdImageBlobUrl } from "@/utils/brdImageUrl";
import { normalizeBrdCitationText } from "@/utils/brdCitationText";
import { brdRichTextToPlain, sanitizeBrdRichTextHtml } from "@/utils/brdRichText";
import { mergeUploadedImageLists, removeUploadedImageFromMap, toUploadedCellImage } from "@/utils/brdEditorImages";

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

function normalizeCitableValue(value: unknown): "Y" | "N" | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (["Y", "YES", "TRUE", "1"].includes(raw)) return "Y";
  if (["N", "NO", "FALSE", "0"].includes(raw)) return "N";
  return "";
}

function buildRowsFromCitations(initialData?: Record<string, unknown>): CitationRow[] {
  if (!initialData) return [];
  const references = Array.isArray(initialData.references) ? initialData.references : [];
  return references
    .filter((ref): ref is Record<string, unknown> => typeof ref === "object" && ref !== null)
    .map((ref, idx) => ({
      id:            `${Date.now()}-${idx}`,
      level:         typeof ref.level === "string" ? ref.level : String(ref.level ?? ""),
      citationRules: typeof ref.citationRules === "string" ? ref.citationRules : typeof ref.citation_rules === "string" ? ref.citation_rules : "",
      sourceOfLaw:   typeof ref.sourceOfLaw === "string" ? ref.sourceOfLaw : typeof ref.source_of_law === "string" ? ref.source_of_law : "",
      isCitable:     normalizeCitableValue(typeof ref.isCitable === "string" ? ref.isCitable : ref.is_citable),
      smeComments:   typeof ref.smeComments === "string" ? ref.smeComments : typeof ref.sme_comments === "string" ? ref.sme_comments : "",
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
  const normalized = normalizeCitableValue(val);
  if (normalized === "Y") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">Y</span>
  );
  if (normalized === "N") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-500 dark:text-slate-500 border border-slate-300 dark:border-[#2a3147]">N</span>
  );
  return <span className="text-slate-400 dark:text-slate-600 text-[11px]">—</span>;
}

function formatCitationRulesForDisplay(value: string) {
  return normalizeBrdCitationText(value);
}

function renderCitationRulesDisplay(value: string) {
  const normalized = formatCitationRulesForDisplay(value);
  if (!normalized) return null;

  return (
    <span
      className="whitespace-pre-wrap break-words"
      dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(normalized) }}
    />
  );
}

export default function Citation({ initialData, brdId, onDataChange }: Props) {
  const [rows, setRows]               = useState<CitationRow[]>(INITIAL_ROWS);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [saved, setSaved]             = useState(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [images, setImages]           = useState<CellImageMeta[]>([]);
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  const [citationLevelSmeCheckpoint, setCitationLevelSmeCheckpoint] = useState("");
  const [citationRulesSmeCheckpoint, setCitationRulesSmeCheckpoint] = useState("");
  const API_BASE_CIT = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  function cellKey(a: string, b: string) { return `${a}-${b}`; }
  function getCellImgs(a: string, b: string): UploadedCellImage[] { return cellImages[cellKey(a, b)] ?? []; }
  function onCellUploaded(a: string, b: string, img: UploadedCellImage) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: [...(prev[k] ?? []), img] })); }
  function onCellDeleted(_a: string, _b: string, id: number) {
    setImages(prev => prev.filter(img => img.id !== id));
    setCellImages(prev => removeUploadedImageFromMap(prev, id));
  }
  const isInitializing = useRef(false);
  const rowsRef = useRef<CitationRow[]>(INITIAL_ROWS);
  const containerRef = useRef<HTMLDivElement>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    const nextRows = buildRowsFromCitations(initialData);
    const nextCitationLevelSmeCheckpoint = typeof initialData?.citationLevelSmeCheckpoint === "string"
      ? initialData.citationLevelSmeCheckpoint
      : typeof initialData?.citableLevelsSmeCheckpoint === "string"
        ? initialData.citableLevelsSmeCheckpoint
        : "";
    const nextCitationRulesSmeCheckpoint = typeof initialData?.citationRulesSmeCheckpoint === "string"
      ? initialData.citationRulesSmeCheckpoint
      : "";

    if (
      citationRowsEqualIgnoringIds(rowsRef.current, nextRows)
      && citationLevelSmeCheckpoint === nextCitationLevelSmeCheckpoint
      && citationRulesSmeCheckpoint === nextCitationRulesSmeCheckpoint
    ) {
      return;
    }

    isInitializing.current = true;
    setRows(nextRows);
    setCitationLevelSmeCheckpoint(nextCitationLevelSmeCheckpoint);
    setCitationRulesSmeCheckpoint(nextCitationRulesSmeCheckpoint);
    setEditingCell(null);
    setSaved(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        sourceOfLaw: r.sourceOfLaw, isCitable: normalizeCitableValue(r.isCitable),
        smeComments: r.smeComments,
      })),
      citationLevelSmeCheckpoint,
      citationRulesSmeCheckpoint,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, citationLevelSmeCheckpoint, citationRulesSmeCheckpoint]);

  useEffect(() => {
    if (!brdId) return;
    const fetchImages = async () => {
      try {
        const response = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images?section=citations`, { timeout: 30000 });
        let all: CellImageMeta[] = response.data.images ?? [];
        if (all.length === 0) {
          const fallback = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images`, { timeout: 30000 });
          all = fallback.data.images ?? [];
        }
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
        console.log("[Citation] Error fetching images:", err);
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
    setActiveRowId(newRow.id);
  }

  function deleteRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
    if (editingCell?.rowId === id) setEditingCell(null);
    if (activeRowId === id) setActiveRowId(null);
  }

  // ── Keyboard shortcuts: Ctrl+Shift+A = add row, Ctrl+Shift+D = delete focused/last row ──
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const _kbRef = useRef({ rows, focusedRowId, addRow, deleteRow });
  _kbRef.current = { rows, focusedRowId, addRow, deleteRow };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.shiftKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === "A" || e.key === "a") {
        e.preventDefault();
        _kbRef.current.addRow();
      } else if (e.key === "D" || e.key === "d") {
        e.preventDefault();
        const { rows: r, focusedRowId: fid } = _kbRef.current;
        const target = fid ?? (r.length > 0 ? r[r.length - 1].id : null);
        if (target) _kbRef.current.deleteRow(target);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // ── End keyboard shortcuts ──────────────────────────────────────────────────

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const root = containerRef.current;
      if (!root) return;
      const activeElement = document.activeElement;
      const targetNode = e.target as Node | null;
      const withinEditor = (activeElement ? root.contains(activeElement) : false)
        || (targetNode ? root.contains(targetNode) : false)
        || activeRowId !== null;
      if (!withinEditor) return;

      const target = e.target as HTMLElement | null;
      const isTypingTarget = !!target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
      );

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        addRow();
        return;
      }

      if (e.key === "Delete" && !isTypingTarget && activeRowId) {
        e.preventDefault();
        deleteRow(activeRowId);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRowId, rows.length, editingCell]);

  function renderCell(row: CitationRow, col: string, rowIdx: number) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
    const rawValue  = row[col as keyof CitationRow] as string;
    const editorValue = brdRichTextToPlain(rawValue) || rawValue;
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
      return <div className="cursor-pointer min-h-[24px] flex items-center" onClick={() => setEditingCell({ rowId: row.id, col })}>{citableBadge(normalizeCitableValue(value))}</div>;
    }

    if (isEditing) return (
      <textarea autoFocus value={editorValue} rows={2} onChange={e => updateCell(row.id, col, e.target.value)}         className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-none text-slate-700 dark:text-slate-200 leading-snug" />
    );

    return (
      <div onClick={() => setEditingCell({ rowId: row.id, col })}
        className="cursor-pointer min-h-[24px] text-[11.5px] text-slate-700 dark:text-slate-300 leading-snug whitespace-pre-wrap break-words hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
        title={brdRichTextToPlain(value)}>
        {value ? (
          shouldFmt
            ? renderCitationRulesDisplay(rawValue)
            : <span className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(rawValue) }} />
        ) : <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
        {cellImgs.map(img => (
          <BrdImage key={img.id}
            src={buildBrdImageBlobUrl(brdId, img.id, API_BASE)}
            alt={img.cellText || img.mediaName}
            className="mt-1 max-w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f35]"
            width={320}
            height={180}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-4">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-700/40">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300" style={{ fontFamily: "'DM Mono', monospace" }}>Citation</p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">
            Click any cell to edit · {rows.length} rule{rows.length !== 1 ? "s" : ""}
            {" "}· <kbd className="font-mono text-[10px]">Ctrl+Shift+A</kbd> add · <kbd className="font-mono text-[10px]">Ctrl+Shift+D</kbd> delete
          </p>
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

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-blue-200 dark:border-blue-700/40 overflow-hidden">
          <div className="px-3 py-2 bg-blue-50 dark:bg-blue-500/10 border-b border-blue-200 dark:border-blue-700/40">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800 dark:text-blue-300" style={{ fontFamily: "'DM Mono', monospace" }}>Citation Level · SME Checkpoint</p>
          </div>
          <div className="p-3">
            <RichTextEditableField
              value={citationLevelSmeCheckpoint}
              onChange={setCitationLevelSmeCheckpoint}
              rows={4}
              labelPrefix="SME Checkpoint"
              placeholder="Add the SME checkpoint note for citation level guidance"
            />
          </div>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-700/40 overflow-hidden">
          <div className="px-3 py-2 bg-blue-50 dark:bg-blue-500/10 border-b border-blue-200 dark:border-blue-700/40">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800 dark:text-blue-300" style={{ fontFamily: "'DM Mono', monospace" }}>Citation Rules · SME Checkpoint</p>
          </div>
          <div className="p-3">
            <RichTextEditableField
              value={citationRulesSmeCheckpoint}
              onChange={setCitationRulesSmeCheckpoint}
              rows={4}
              labelPrefix="SME Checkpoint"
              placeholder="Add the SME checkpoint note for citation rules"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: "860px" }}>
            <thead>
              <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                <BrdTableHeaderCell className="w-16" title="Level" greenNote="Citation level" />
                <BrdTableHeaderCell className="w-20" title="Citable" greenNote="Should this level be citable" />
                <BrdTableHeaderCell className="w-72" title="Citation Rules" checkpoint="SME Checkpoint" blueNote="Include the levels and punctuation that should appear in ELA citations" />
                <BrdTableHeaderCell className="w-56" title="Source of Law" checkpoint="SME Checkpoint" blueNote="Identify the level that should serve as the Source of Law" />
                <BrdTableHeaderCell className="w-52" title="SME Comments" checkpoint="SME Checkpoint" blueNote="If anything needs be changed, please specify" />
                <th className="w-8 px-2 py-2.5 bg-slate-50 dark:bg-[#1e2235]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
              {rows.map((row, idx) => (
                <tr key={row.id} className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`} onFocus={() => setFocusedRowId(row.id)}>
                  {COLUMNS.map(col => (
                    <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>
                      <div className="group">
                        {renderCell(row, col.key, idx)}
                        {getCellImgs(row.level, col.key).map(img => (
                          <BrdImage key={`m-${img.id}`} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_CIT)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" width={320} height={180} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                        ))}
                        {brdId && <CellImageUploader brdId={brdId} section="citations" fieldLabel={cellKey(row.level, col.key)} existingImages={mergeUploadedImageLists(getCellImgs(row.level, col.key), getCellImages(row, col.key, idx).map(toUploadedCellImage) as UploadedCellImage[])} defaultCellText={String(row[col.key as keyof CitationRow] ?? "")} onUploaded={img => onCellUploaded(row.level, col.key, img)} onDeleted={id => onCellDeleted(row.level, col.key, id)}/>}
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