// ── TOC.tsx ──────────────────────────────────────────────────────────────────
import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import React, { useEffect, useState, useRef } from "react";
import api from "@/app/lib/api";

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
  // Previous values — captured the first time a field is manually edited,
  // so both the original and the user's edit are visible in the Generate view.
  _prevName?: string;
  _prevDefinition?: string;
  _prevExample?: string;
  _prevNote?: string;
  _prevTocRequirements?: string;
  _prevSmeComments?: string;
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
  section: string;    // "toc" | "metadata" | "scope" | "citations" | "unknown"
  fieldLabel: string; // e.g. "Level", "Definition", "Example"
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
  brdId?: string;
  onDataChange?: (data: Record<string, unknown>) => void;
}

function buildRowsFromToc(initialData?: Props["initialData"]): TocRow[] {
  const sections = Array.isArray(initialData?.sections) ? initialData.sections : [];

  if (sections.length === 0) {
    // Sample data based on your screenshot
    return [
      {
        id: "sample-0",
        level: "0",
        name: "",
        required: "true",
        definition: "/KR",
        example: "",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-1",
        level: "1",
        name: "",
        required: "true",
        definition: "/KRNARKActs",
        example: "",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-2",
        level: "2",
        name: "",
        required: "true",
        definition: "document title",
        example: "금융회사의 지배구조에 관한 법률",
        note: "Act on Corporate Governance of Financial Companies (금융회사의 지배구조에 관한 법률) Product Note - To be taken as mentioned in document title of the scope section",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-3",
        level: "3",
        name: "Part",
        required: "true",
        definition: "제 + incrementing number + 편",
        example: "제1편",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-4",
        level: "4",
        name: "Chapter",
        required: "true",
        definition: "제 + incrementing number + 장",
        example: "제1장 임원",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-5",
        level: "5",
        name: "Section",
        required: "true",
        definition: "제 + incrementing number + 절",
        example: "제1절 임원의 자격요건",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-6",
        level: "6",
        name: "Subsection",
        required: "false",
        definition: "제 + incrementing number + 관",
        example: "제1관",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-7",
        level: "7",
        name: "Article",
        required: "true",
        definition: "제 + incrementing number + 조",
        example: "제2조",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
      {
        id: "sample-8",
        level: "8",
        name: "",
        required: "false",
        definition: "encircled incrementing number",
        example: "①",
        note: "",
        tocRequirements: "",
        smeComments: "",
      },
    ];
  }

  const timestamp = Date.now();
  return sections
    .filter((section): section is NonNullable<typeof sections[number]> =>
      typeof section === "object" && section !== null
    )
    .map((section, index) => {
      let rawLevel = String(section.level ?? section.id ?? index + 1);
      const levelMatch = rawLevel.match(/\*{1,2}(\d+)\*{1,2}|\b(\d+)\b/);
      const level = levelMatch
        ? (levelMatch[1] ?? levelMatch[2] ?? rawLevel)
        : rawLevel;

      return {
        id: `${timestamp}-${index}`,
        level: level.trim(),
        name: section.name ?? "",
        required: mapRequiredValue(section.required),
        definition: section.definition ?? "",
        example: section.example ?? "",
        note: section.note ?? "",
        tocRequirements: section.tocRequirements ?? "",
        smeComments: section.smeComments ?? "",
        // Restore previously captured original values from saved data
        _prevName:             (section as Record<string, unknown>)._prevName as string | undefined,
        _prevDefinition:       (section as Record<string, unknown>)._prevDefinition as string | undefined,
        _prevExample:          (section as Record<string, unknown>)._prevExample as string | undefined,
        _prevNote:             (section as Record<string, unknown>)._prevNote as string | undefined,
        _prevTocRequirements:  (section as Record<string, unknown>)._prevTocRequirements as string | undefined,
        _prevSmeComments:      (section as Record<string, unknown>)._prevSmeComments as string | undefined,
      };
    })
    .sort((a, b) => (parseInt(a.level) || 0) - (parseInt(b.level) || 0));
}

function normalizeRowForCompare(row: TocRow) {
  return {
    level: row.level,
    name: row.name,
    required: row.required,
    definition: row.definition,
    example: row.example,
    note: row.note,
    tocRequirements: row.tocRequirements,
    smeComments: row.smeComments,
  };
}

function rowsEqualIgnoringIds(a: TocRow[], b: TocRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(normalizeRowForCompare(a[i])) !== JSON.stringify(normalizeRowForCompare(b[i]))) {
      return false;
    }
  }
  return true;
}

function mapRequiredValue(val?: string): TocRow["required"] {
  if (!val) return "";
  const lower = val.toLowerCase().trim();
  if (lower === "true" || lower === "yes" || lower === "y") return "true";
  if (lower === "false" || lower === "no" || lower === "n") return "false";
  if (lower.includes("conditional") || lower.includes("cond")) return "Conditional";
  if (val === "true" || val === "false" || val === "Conditional") return val;
  return "";
}

const REQUIRED_OPTIONS = ["true", "false", "Conditional"] as const;

const COLUMNS = [
  { key: "level", label: "Level", width: "w-20", icon: "⬡" },
  { key: "name", label: "Name", width: "w-40", icon: "≡" },
  { key: "required", label: "Required", width: "w-28", icon: "◈" },
  { key: "definition", label: "Definition", width: "w-52", icon: "◎" },
  { key: "example", label: "Example", width: "w-48", icon: "✦" },
  { key: "note", label: "Note", width: "w-44", icon: "↑" },
  { key: "tocRequirements", label: "TOC Requirements", width: "w-52", icon: "≡" },
  { key: "smeComments", label: "SME Comments", width: "w-48", icon: "◈" },
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
    "0": "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700/40",
    "1": "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40",
    "2": "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700/40",
    "3": "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700/40",
    "4": "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/40",
    "5": "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40",
    "6": "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700/40",
    "7": "bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-700/40",
    "8": "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700/40",
    "9": "bg-pink-50 dark:bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-300 dark:border-pink-700/40",
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

export default function TOC({ initialData, brdId, onDataChange }: Props) {
  const [rows, setRows] = useState<TocRow[]>(INITIAL_ROWS);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [images, setImages] = useState<CellImageMeta[]>([]);
  const [imageMap, setImageMap] = useState<Map<number, CellImageMeta[]>>(new Map());
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  const API_BASE_TOC = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  function cellKey(a: string, b: string) { return `${a}-${b}`; }
  function getCellImgs(a: string, b: string): UploadedCellImage[] { return cellImages[cellKey(a, b)] ?? []; }
  function onCellUploaded(a: string, b: string, img: UploadedCellImage) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: [...(prev[k] ?? []), img] })); }
  function onCellDeleted(a: string, b: string, id: number) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: (prev[k] ?? []).filter(i => i.id !== id) })); }
  const isInitializing = useRef(false);
  const rowsRef = useRef<TocRow[]>(INITIAL_ROWS);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    const newRows = buildRowsFromToc(initialData);
    if (rowsEqualIgnoringIds(rowsRef.current, newRows)) return;

    isInitializing.current = true;
    setRows(newRows);
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
      sections: rows.map(r => ({
        level: r.level, name: r.name, required: r.required,
        definition: r.definition, example: r.example, note: r.note,
        tocRequirements: r.tocRequirements, smeComments: r.smeComments,
        // Persist captured originals so they survive save/reload cycles
        ...(r._prevName            && { _prevName: r._prevName }),
        ...(r._prevDefinition      && { _prevDefinition: r._prevDefinition }),
        ...(r._prevExample         && { _prevExample: r._prevExample }),
        ...(r._prevNote            && { _prevNote: r._prevNote }),
        ...(r._prevTocRequirements && { _prevTocRequirements: r._prevTocRequirements }),
        ...(r._prevSmeComments     && { _prevSmeComments: r._prevSmeComments }),
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
        // Use section tag if present (new records), fall back to tableIndex=2 (old records)
        const tocImages = all.filter(img =>
          img.section === "toc" || ((!img.section || img.section === "unknown") && img.tableIndex === 2)
        );
        setImages(tocImages);
        // Restore manually uploaded images into cellImages state
        const manualImgs = all.filter(img => img.section === "toc" && img.rid?.startsWith("manual-"));
        const restored: Record<string, UploadedCellImage[]> = {};
        manualImgs.forEach(img => {
          const key = img.fieldLabel ?? "";
          if (!key) return;
          if (!restored[key]) restored[key] = [];
          restored[key].push({ id: img.id, mediaName: img.mediaName, mimeType: img.mimeType, cellText: img.cellText, section: img.section, fieldLabel: img.fieldLabel });
        });
        setCellImages(restored);
      } catch (err) {
        console.error("[TOC] Error fetching images:", err);
      }
    };
    fetchImages();
  }, [brdId]);

  // Maps editable text columns to their _prev* sibling key
  const PREV_KEY: Record<string, keyof TocRow> = {
    name:             "_prevName",
    definition:       "_prevDefinition",
    example:          "_prevExample",
    note:             "_prevNote",
    tocRequirements:  "_prevTocRequirements",
    smeComments:      "_prevSmeComments",
  };

  function updateCell(rowId: string, col: string, value: string) {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const prevKey = PREV_KEY[col];
      const current = r[col as keyof TocRow] as string;
      // Capture the original value the first time a text field is changed
      if (prevKey && current && current !== value && !r[prevKey]) {
        return { ...r, [col]: value, [prevKey]: current };
      }
      return { ...r, [col]: value };
    }));
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

  // colIndex → column field key (matches actual Word TOC table structure)
  const TOC_COL_MAP: Record<number, string> = { 0: "level", 1: "name", 2: "required", 3: "definition", 4: "example", 5: "note", 6: "tocRequirements", 7: "smeComments" };

  // Match images to a TOC row.
  // Primary: fieldLabel (= level number e.g. "3") + colIndex — works for new DB records.
  // Fallback: rowIndex (arrayIdx+1 because row 0 is header) + colIndex — works for stale DB records.
  function matchRowImgs(row: TocRow, rowIdx: number): { [col: string]: CellImageMeta[] } {
    if (!images.length) return {};
    const levelStr = row.level.trim();

    const byFieldLabel = images.filter(img => {
      const fl = (img.fieldLabel || "").trim();
      return fl === levelStr || fl === `Level ${levelStr}`;
    });

    const byRowIndex = byFieldLabel.length === 0
      ? images.filter(img => img.rowIndex === rowIdx + 1 && (!img.fieldLabel || img.fieldLabel === ""))
      : [];

    const matched = byFieldLabel.length > 0 ? byFieldLabel : byRowIndex;
    const byCol: { [col: string]: CellImageMeta[] } = {};
    matched.forEach(img => {
      const colKey = TOC_COL_MAP[img.colIndex] ?? "note";
      if (!byCol[colKey]) byCol[colKey] = [];
      byCol[colKey].push(img);
    });
    return byCol;
  }

  function renderCell(row: TocRow, col: string, rowIndex: number) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
    const closeEdit = () => setEditingCell(null);
    const rawValue = row[col as keyof TocRow] as string;
    const value = formatTocCellForDisplay(rawValue, col);


    // Handle different column types
    if (col === "required") {
      if (isEditing) {
        return (
          <select
            autoFocus
            value={rawValue}
            onChange={(e) => updateCell(row.id, col, e.target.value)}
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

    // For the Example column - show images inline
    if (col === "example") {
      if (isEditing) {
        return (
          <textarea
            autoFocus
            value={rawValue}
            rows={2}
            onChange={(e) => updateCell(row.id, col, e.target.value)}
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
          {/* Show the example text */}
          <div>{value || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</div>
          

        </div>
      );
    }

    // For all other columns
    if (isEditing) {
      return (
        <textarea
          autoFocus
          value={rawValue}
          rows={2}
          onChange={(e) => updateCell(row.id, col, e.target.value)}
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
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-700/40">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-800 dark:text-indigo-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            Table of Contents
          </p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">
            Click any cell to edit · {rows.length} sections
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

      {/* Main Table */}
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
              {rows.map((row, idx) => {
                const rowImgsByCol = matchRowImgs(row, idx);
                return (
                  <React.Fragment key={row.id}>
                    <tr className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}>
                      {COLUMNS.map((col) => (
                        <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>
                          <div className="group">
                          {renderCell(row, col.key, idx)}
                          {rowImgsByCol[col.key]?.map(img => (
                            <img key={img.id} src={`${API_BASE}/brd/${brdId}/images/${img.id}/blob`} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {getCellImgs(row.level, col.key).map(img => (
                            <img key={`m-${img.id}`} src={`${API_BASE_TOC}/brd/${brdId}/images/${img.id}/blob`} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="toc" fieldLabel={cellKey(row.level, col.key)} existingImages={getCellImgs(row.level, col.key)} onUploaded={img => onCellUploaded(row.level, col.key, img)} onDeleted={id => onCellDeleted(row.level, col.key, id)}/>}
                        </div>
                        </td>
                      ))}
                      <td className="w-8 px-2 py-2 align-top">
                        <button onClick={() => deleteRow(row.id)} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-12 text-center">
                    <p className="text-[12.5px] text-slate-500 dark:text-slate-500">No sections yet</p>
                    <button onClick={addRow} className="mt-2 text-[12px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first section</button>
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