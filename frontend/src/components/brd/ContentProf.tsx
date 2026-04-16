import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import BrdImage from "./BrdImage";
import React, { useEffect, useState, useMemo, useRef } from "react";
import api from "@/app/lib/api";
import { buildBrdImageBlobUrl } from "@/utils/brdImageUrl";
import { mergeUploadedImageLists, removeUploadedImageFromMap, toUploadedCellImage } from "@/utils/brdEditorImages";

interface LevelRow {
  id: string;
  levelNumber: string;
  description: string;
  redjayXmlTag: string;
  path: string;
  remarksNotes: string;
}

interface WhitespaceRow {
  id: string;
  tags: string;
  innodReplace: string;
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
  section?: string;
  fieldLabel?: string;
}

interface Props {
  initialData?: Record<string, unknown>;
  brdId?: string;
  onDataChange?: (data: Record<string, unknown>) => void;
}

const HARDCODED_LEVELS = new Set(["0", "1"]);

// ── Default whitespace rows (mirrors _build_whitespace_rules in Python) ────────
const DEFAULT_WHITESPACE_ROWS: WhitespaceRow[] = [
  { id: "ws-def-0", tags: "</title>",         innodReplace: "2 hard returns after title with heading." },
  { id: "ws-def-1", tags: "</title>",         innodReplace: "1 space after title with identifier." },
  { id: "ws-def-2", tags: "</paragraph>",     innodReplace: "2 hard returns after closing para and before opening para" },
  { id: "ws-def-3", tags: "</ul>",            innodReplace: "1 hard return after" },
  { id: "ws-def-4", tags: "</li>",            innodReplace: "1 hard return after" },
  { id: "ws-def-5", tags: "<p> within <li>",  innodReplace: `</innodReplace><ul><innodReplace>\n  </innodReplace><li><innodReplace></innodReplace><p>(text)</p><innodReplace text="&#10;&#10;">\n  </innodReplace><li><innodReplace>...\n</innodReplace></ul><innodReplace>` },
  { id: "ws-def-6", tags: "table\n<td>\n<th>",innodReplace: `</innodReplace><innodTd><td><innodReplace></innodReplace><p>...</p><innodReplace>\n                   </innodReplace><p>...</p><innodReplace>\n                   </innodReplace><p>...</p><innodReplace>\n</innodReplace></td></innodTd>\n</innodReplace></tr><innodTr><innodReplace>` },
];

/* ─────────────── Shared image helpers ─────────────── */
const API_BASE_CP = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const CP_SECTION_ALIASES = new Set(["contentprofile", "content profile", "content_profile"]);
const LEVEL_COL_INDEX: Record<string, number> = { levelNumber: 0, description: 1, redjayXmlTag: 2, path: 3, remarksNotes: 4 };
const WS_COL_INDEX: Record<string, number> = { tags: 0, innodReplace: 1 };
function normCP(s: string) { return s.toLowerCase().replace(/\s+/g, " ").trim(); }
function isContentProfileSection(section?: string) {
  return CP_SECTION_ALIASES.has(normCP(section || ""));
}
function isStoredContentProfileField(fieldLabel: string): boolean {
  const normalized = normCP(fieldLabel);
  return !!normalized && (
    normalized === "headingannotation" ||
    normalized === "heading annotation" ||
    normalized === "rcfilename" ||
    normalized === "rc filename" ||
    /^lvl-\d+-/.test(normalized) ||
    /^ws-\d+-/.test(normalized)
  );
}
function matchCPImgs(pool: CellImageMeta[], row: LevelRow, rowIdx: number): CellImageMeta[] {
  const candidates = [row.levelNumber, row.description, row.redjayXmlTag, row.path, row.remarksNotes].map(normCP).filter(Boolean);
  if (!candidates.length) return [];
  return pool.filter((img) => {
    if (!isContentProfileSection(img.section) && !isStoredContentProfileField(img.fieldLabel || "")) return false;
    if (img.rowIndex !== rowIdx + 1) return false;
    const field = normCP(img.fieldLabel || "");
    const text = normCP(img.cellText || "");
    if (!field) return true;
    return candidates.some((candidate) => field === candidate || text === candidate);
  });
}

function splitExamples(example: string): string[] {
  let s = example.trim().replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "");
  for (const suffix of ["; etc.", ", etc.", " etc."]) {
    if (s.endsWith(suffix)) s = s.slice(0, -suffix.length).trim();
  }
  for (const sep of [";", "\n", " / "]) {
    if (s.includes(sep)) {
      return s.split(sep)
        .map((t) => t.trim().replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, ""))
        .filter(Boolean);
    }
  }
  return s ? [s] : [];
}

function buildRedjayTag(levelNumber: string, example: string): string {
  const n = levelNumber.replace(/\D/g, "").trim();
  if (HARDCODED_LEVELS.has(n)) return "Hardcoded";
  const tokens = splitExamples(example);
  if (!tokens.length) return `<section level="${n}"><title></title></section>`;
  return tokens
    .map((t) => `<section level="${n}"><title>${t}</title></section>`)
    .join("\n");
}

function extractExample(description: string): string {
  const match = description.match(/^Example:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractDefinition(description: string): string {
  const match = description.match(/^Definition:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function isPlaceholderLevelToken(value: string): boolean {
  const cleaned = value.trim().replace(/^\/+/, "").replace(/[_\-]+/g, " ").toLowerCase();
  return /^level\s*\d+$/.test(cleaned);
}

function pickHardcodedToken(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const slashMatch = text.match(/\/[A-Za-z0-9][A-Za-z0-9._/-]*/);
  if (slashMatch?.[0]) return slashMatch[0].replace(/[),.;]+$/, "");

  const tokenMatches = text.match(/[A-Za-z][A-Za-z0-9._-]*/g) ?? [];
  const ignored = new Set(["hardcoded", "path", "level", "definition"]);
  for (let i = tokenMatches.length - 1; i >= 0; i -= 1) {
    const token = tokenMatches[i];
    if (!token || ignored.has(token.toLowerCase()) || isPlaceholderLevelToken(token)) continue;
    return token.replace(/[),.;]+$/, "");
  }
  return "";
}

function stamp(prefix = "") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function asExtractedLevels(initialData?: Record<string, unknown>): LevelRow[] {
  return asObjectArray(initialData?.levels).map((row, i) => ({
    id:           `lvl-${i}`,
    levelNumber:  String(row.levelNumber  ?? ""),
    description:  String(row.description  ?? ""),
    redjayXmlTag: String(row.redjayXmlTag ?? ""),
    path:         String(row.path         ?? ""),
    remarksNotes: "",
  }));
}

function asExtractedWhitespace(initialData?: Record<string, unknown>): WhitespaceRow[] {
  const rows = asObjectArray(initialData?.whitespace).map((row, i) => ({
    id:           `ws-${i}`,
    tags:         String(row.tags         ?? ""),
    innodReplace: String(row.innodReplace ?? ""),
  }));
  // Fall back to defaults when the extractor returned nothing
  return rows.length > 0 ? rows : DEFAULT_WHITESPACE_ROWS;
}

function deriveHardcodedPathFromLevels(levels: LevelRow[]): string {
  let l0 = "", l1 = "";
  for (const row of levels) {
    const n = row.levelNumber.replace(/[^0-9]/g, "").trim();
    const pathVal       = row.path.trim();
    const definitionVal = extractDefinition(row.description).trim();
    const exampleVal    = extractExample(row.description).trim();
    const picked =
      pickHardcodedToken(pathVal) ||
      pickHardcodedToken(definitionVal) ||
      pickHardcodedToken(exampleVal);
    if (n === "0") l0 = picked;
    if (n === "1") l1 = picked;
  }
  if (!l0 && !l1) return "";
  const clean0 = l0.replace(/\/$/, "");
  const clean1 = l1.replace(/^\//, "");
  return (clean0 + "/" + clean1).replace(/\/+/g, "/");
}

function normalizeLevelRow(row: LevelRow) {
  return {
    levelNumber: row.levelNumber,
    description: row.description,
    redjayXmlTag: row.redjayXmlTag,
    path: row.path,
    remarksNotes: row.remarksNotes,
  };
}

function normalizeWhitespaceRow(row: WhitespaceRow) {
  return {
    tags: row.tags,
    innodReplace: row.innodReplace,
  };
}

function levelRowsEqualIgnoringIds(a: LevelRow[], b: LevelRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(normalizeLevelRow(a[i])) !== JSON.stringify(normalizeLevelRow(b[i]))) {
      return false;
    }
  }
  return true;
}

function whitespaceRowsEqualIgnoringIds(a: WhitespaceRow[], b: WhitespaceRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(normalizeWhitespaceRow(a[i])) !== JSON.stringify(normalizeWhitespaceRow(b[i]))) {
      return false;
    }
  }
  return true;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-700/40 px-2 py-0.5 rounded"
      style={{ fontFamily: "'DM Mono', monospace" }}
    >
      {children}
    </span>
  );
}

function FieldRow({
  label, value, onChange, placeholder, mono, readOnly,
}: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; mono?: boolean; readOnly?: boolean;
}) {
  return (
    <div className="flex items-center border-b border-slate-100 dark:border-[#2a3147] last:border-b-0">
      <div className="w-44 shrink-0 px-3 py-2 bg-slate-100 dark:bg-[#1e2235] border-r border-slate-200 dark:border-[#2a3147]">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {label}
        </span>
      </div>
      <div className={`flex-1 px-3 py-1.5 flex items-center gap-2 ${readOnly ? "bg-slate-50 dark:bg-[#181d30]" : ""}`}>
        {readOnly ? (
          <span className={`text-[11.5px] ${mono ? "font-mono" : ""} ${value ? "text-sky-700 dark:text-sky-400 font-semibold" : "text-slate-400 dark:text-slate-600 italic"}`}>
            {value || "—"}
          </span>
        ) : (
          <input
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            className={`w-full bg-transparent text-[11.5px] text-slate-800 dark:text-slate-300 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600 ${mono ? "font-mono" : ""}`}
          />
        )}
      </div>
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

const LEVEL_COLUMNS = [
  { key: "levelNumber",  label: "Level Number",    width: "w-24"   },
  { key: "description",  label: "Description",     width: "w-72"   },
  { key: "redjayXmlTag", label: "REDJAy XML Tag",  width: "flex-1" },
  { key: "path",         label: "Path",            width: "w-52"   },
  { key: "remarksNotes", label: "Remarks / Notes", width: "w-52"   },
];

const WS_COLUMNS = [
  { key: "tags",         label: "Tags",         width: "w-44"   },
  { key: "innodReplace", label: "InnodReplace", width: "flex-1" },
];


function LevelCellEditor({ value, rows, onChange, onClose }: {
  value: string; rows: number; onChange: (v: string) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => {
    function onMD(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onChange(draft);
        onClose();
      }
    }
    document.addEventListener("mousedown", onMD);
    return () => document.removeEventListener("mousedown", onMD);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <div ref={containerRef}>
      <textarea ref={taRef} value={draft} rows={rows}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Escape") { onClose(); }
        }}
        className="w-full text-[11px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-y text-slate-700 dark:text-slate-200 leading-snug font-mono"
      />
    </div>
  );
}

export default function ContentProfile({ initialData, brdId, onDataChange }: Props) {
  const [rcFilename,        setRcFilename]        = useState("");
  const [headingAnnotation, setHeadingAnnotation] = useState("Level 2");
  const [levels,       setLevels]       = useState<LevelRow[]>([]);
  const [levelEditing, setLevelEditing] = useState<{ rowId: string; col: string } | null>(null);
  const [whitespace, setWhitespace] = useState<WhitespaceRow[]>(() => DEFAULT_WHITESPACE_ROWS);
  const [wsEditing,  setWsEditing]  = useState<{ rowId: string; col: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [contentImages, setContentImages] = useState<CellImageMeta[]>([]);
  const [expandedImage, setExpandedImage] = useState<CellImageMeta | null>(null);
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  const API_BASE_CP2 = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  function cellKey(a: string, b: string) { return `${a}-${b}`; }
  function getCellImgs(a: string, b: string): UploadedCellImage[] { return cellImages[cellKey(a, b)] ?? []; }
  function onCellUploaded(a: string, b: string, img: UploadedCellImage) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: [...(prev[k] ?? []), img] })); }
  function onCellDeleted(_a: string, _b: string, id: number) {
    setContentImages(prev => prev.filter(img => img.id !== id));
    setCellImages(prev => removeUploadedImageFromMap(prev, id));
  }
  function matchesContentProfileImage(img: CellImageMeta, expectedCol: number, candidates: string[], rowIndex?: number): boolean {
    if (!isContentProfileSection(img.section) && !isStoredContentProfileField(img.fieldLabel || "")) return false;
    if (img.colIndex !== expectedCol) return false;
    if (rowIndex === undefined || img.rowIndex !== rowIndex) return false;

    const normalizedField = normCP(img.fieldLabel || "");
    const normalizedCellText = normCP(img.cellText || "");
    if (!normalizedField) return true;

    return candidates.some(candidate => normalizedField === candidate || normalizedCellText === candidate);
  }
  function getPersistedLevelImages(row: LevelRow, col: string, rowIdx: number): UploadedCellImage[] {
    const expectedCol = LEVEL_COL_INDEX[col];
    if (expectedCol === undefined) return [];
    const candidates = [row.levelNumber, row.description, row.redjayXmlTag, row.path, row.remarksNotes].map(normCP).filter(Boolean);
    return contentImages.filter(img => matchesContentProfileImage(img, expectedCol, candidates, rowIdx + 1)).map(img => toUploadedCellImage(img) as UploadedCellImage);
  }
  function getPersistedWhitespaceImages(row: WhitespaceRow, col: string, rowIdx: number): UploadedCellImage[] {
    const expectedCol = WS_COL_INDEX[col];
    if (expectedCol === undefined) return [];
    const candidates = [row.tags, row.innodReplace].map(normCP).filter(Boolean);
    return contentImages.filter(img => matchesContentProfileImage(img, expectedCol, candidates, rowIdx + 1)).map(img => toUploadedCellImage(img) as UploadedCellImage);
  }
  function getHeadingAnnotationImages(): UploadedCellImage[] {
    const candidates = ["heading annotation", "headingannotation", headingAnnotation].map(normCP).filter(Boolean);
    return contentImages.filter(img => {
      if (!isContentProfileSection(img.section) && !isStoredContentProfileField(img.fieldLabel || "")) return false;
      const normalizedField = normCP(img.fieldLabel || "");
      const normalizedCellText = normCP(img.cellText || "");
      return candidates.some(candidate => normalizedField === candidate || normalizedCellText === candidate);
    }).map(img => toUploadedCellImage(img) as UploadedCellImage);
  }
  const isInitializing = useRef(false);
  const levelsRef = useRef<LevelRow[]>([]);
  const whitespaceRef = useRef<WhitespaceRow[]>(DEFAULT_WHITESPACE_ROWS);
  const topFieldsRef = useRef<{ rcFilename: string; headingAnnotation: string }>({ rcFilename: "", headingAnnotation: "Level 2" });

  const hardcodedPathFromData = useMemo(
    () => String(initialData?.hardcoded_path ?? initialData?.hardcodedPath ?? "").trim(),
    [initialData],
  );
  const derivedHardcodedPath = useMemo(() => deriveHardcodedPathFromLevels(levels), [levels]);
  const hardcodedPath = derivedHardcodedPath || hardcodedPathFromData;

  useEffect(() => {
    const nextRcFilename = String(initialData?.rc_filename ?? "");
    const nextHeadingAnnotation = String(initialData?.heading_annotation ?? "Level 2");
    const nextLevels = asExtractedLevels(initialData);
    const nextWhitespace = asExtractedWhitespace(initialData);

    const topUnchanged =
      topFieldsRef.current.rcFilename === nextRcFilename &&
      topFieldsRef.current.headingAnnotation === nextHeadingAnnotation;

    if (
      topUnchanged &&
      levelRowsEqualIgnoringIds(levelsRef.current, nextLevels) &&
      whitespaceRowsEqualIgnoringIds(whitespaceRef.current, nextWhitespace)
    ) {
      return;
    }

    isInitializing.current = true;
    setRcFilename(nextRcFilename);
    setHeadingAnnotation(nextHeadingAnnotation);
    setLevels(nextLevels);
    setWhitespace(nextWhitespace);
    setLevelEditing(null);
    setWsEditing(null);
    setSaved(false);
  }, [initialData]);

  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  useEffect(() => {
    whitespaceRef.current = whitespace;
  }, [whitespace]);

  useEffect(() => {
    topFieldsRef.current = { rcFilename, headingAnnotation };
  }, [rcFilename, headingAnnotation]);

  useEffect(() => {
    if (!onDataChange) return;
    if (isInitializing.current) { isInitializing.current = false; return; }
    onDataChange({
      rc_filename:        rcFilename,
      heading_annotation: headingAnnotation,
      hardcoded_path:     hardcodedPath,
      levels:    levels.map(r => ({ levelNumber: r.levelNumber, description: r.description, redjayXmlTag: r.redjayXmlTag, path: r.path, remarksNotes: r.remarksNotes })),
      whitespace: whitespace.map(r => ({ tags: r.tags, innodReplace: r.innodReplace })),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcFilename, headingAnnotation, levels, whitespace]);

  useEffect(() => {
    if (!brdId) return;
    
    const fetchImages = async () => {
      try {
        const response = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images?section=contentProfile`, { timeout: 30000 });
        let all: CellImageMeta[] = response.data.images ?? [];
        if (all.length === 0) {
          const fallback = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images`, { timeout: 30000 });
          all = fallback.data.images ?? [];
        }
        const cpImgs = all.filter((img) => isContentProfileSection(img.section) || isStoredContentProfileField(img.fieldLabel || ""));
        setContentImages(cpImgs);
        // Restore manually uploaded images into cellImages
        const manualImgs = all.filter((img): img is CellImageMeta & { section: string; rid: string; fieldLabel: string } => img.section === "contentProfile" && img.rid?.startsWith("manual-"));
        const restored: Record<string, UploadedCellImage[]> = {};
        manualImgs.forEach((img) => {
          const key = img.fieldLabel ?? "";
          if (!key) return;
          if (!restored[key]) restored[key] = [];
          restored[key].push({ id: img.id, mediaName: img.mediaName, mimeType: img.mimeType, cellText: img.cellText, section: img.section, fieldLabel: img.fieldLabel });
        });
        setCellImages(restored);
      } catch (err) {
        console.log("[ContentProfile] Error fetching images:", err);
      }
    };
    
    fetchImages();
  }, [brdId]);

  function updateLevel(id: string, col: string, value: string) {
    setLevels((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [col]: value };
        if (col === "description" || col === "levelNumber") {
          const example = extractExample(
            col === "description" ? value : updated.description
          );
          updated.redjayXmlTag = buildRedjayTag(updated.levelNumber, example);
        }
        return updated;
      })
    );
  }

  function addLevel() {
    const n = levels.length;
    const newRow: LevelRow = {
      id: stamp("lvl"), levelNumber: `Level ${n}`,
      description: "", redjayXmlTag: buildRedjayTag(String(n), ""),
      path: "", remarksNotes: "",
    };
    setLevels((prev) => [...prev, newRow]);
    setLevelEditing({ rowId: newRow.id, col: "description" });
  }

  function deleteLevel(id: string) {
    setLevels((prev) => prev.filter((r) => r.id !== id));
    if (levelEditing?.rowId === id) setLevelEditing(null);
  }

  function updateWs(id: string, col: string, value: string) {
    setWhitespace((prev) => prev.map((r) => (r.id === id ? { ...r, [col]: value } : r)));
  }
  function addWs() {
    const newRow: WhitespaceRow = { id: stamp("ws"), tags: "", innodReplace: "" };
    setWhitespace((prev) => [...prev, newRow]);
    setWsEditing({ rowId: newRow.id, col: "tags" });
  }
  function deleteWs(id: string) {
    setWhitespace((prev) => prev.filter((r) => r.id !== id));
    if (wsEditing?.rowId === id) setWsEditing(null);
  }

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2000); }


  function renderLevelCell(row: LevelRow, col: string) {
    const isEditing = levelEditing?.rowId === row.id && levelEditing?.col === col;
    const value     = row[col as keyof LevelRow] as string;
    if (col === "redjayXmlTag") {
      const isHardcoded = value === "Hardcoded";
      return (<div className={`min-h-[24px] text-[11px] leading-snug whitespace-pre-line select-all font-mono ${isHardcoded ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-sky-700 dark:text-sky-400"}`} title="Auto-generated from Example in Description">{value || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</div>);
    }
    if (isEditing) {
      return (<LevelCellEditor value={value} rows={col === "description" ? 4 : 2} onChange={v => updateLevel(row.id, col, v)} onClose={() => setLevelEditing(null)}/>);
    }
    const isMono = col === "path";
    const isRequired = col === "description" && value.startsWith("Required: True");
    return (<div onClick={() => setLevelEditing({ rowId: row.id, col })} className={`cursor-pointer min-h-[24px] text-[11px] leading-snug whitespace-pre-line hover:text-slate-900 dark:hover:text-slate-100 transition-colors ${isMono ? "font-mono" : ""} ${isRequired ? "text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`} title={value}>{value || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</div>);
  }

  function renderWsCell(row: WhitespaceRow, col: string) {
    const isEditing = wsEditing?.rowId === row.id && wsEditing?.col === col;
    const value     = row[col as keyof WhitespaceRow] as string;
    if (isEditing) {
      return (
        <LevelCellEditor
          value={value}
          rows={2}
          onChange={v => updateWs(row.id, col, v)}
          onClose={() => setWsEditing(null)}
        />
      );
    }
    return (
      <div
        onClick={() => setWsEditing({ rowId: row.id, col })}
        className={`cursor-pointer min-h-[24px] text-[11px] leading-snug whitespace-pre-line
          hover:text-slate-900 dark:hover:text-slate-100 transition-colors
          ${col === "tags"
            ? "font-mono text-violet-700 dark:text-violet-400"
            : "text-slate-700 dark:text-slate-300"
          }`}
        title={value}
      >
        {value || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-700/40">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-300"
             style={{ fontFamily: "'DM Mono', monospace" }}>
            Content Profile
          </p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">
            XML structure, heading levels &amp; whitespace rules
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
            {saved
              ? <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved!</>
              : <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>
            }
          </button>
        </div>
      </div>

      {/* RC Filename + Hardcoded Path */}
      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <FieldRow label="RC Filename"    value={rcFilename}    onChange={setRcFilename}    placeholder="Enter filename…" mono />
        <FieldRow label="Hardcoded Path" value={hardcodedPath} readOnly mono />
      </div>

      {/* Level Number Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Level Numbers</SectionLabel>
          <button
            onClick={addLevel}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Level
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                  {LEVEL_COLUMNS.map((col) => (
                    <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>
                        {col.label}
                      </span>
                    </th>
                  ))}
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]">
                {levels.map((row, idx) => {
                  const rowImgs = matchCPImgs(contentImages, row, idx);
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}>
                        {LEVEL_COLUMNS.map((col) => (
                          <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>
                            <div className="group">
                            {renderLevelCell(row, col.key)}
                            {getCellImgs(row.id, col.key).map(img => (
                              <BrdImage key={`m-${img.id}`} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_CP2)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                            ))}
                            {brdId && <CellImageUploader brdId={brdId} section="contentProfile" fieldLabel={cellKey(row.id, col.key)} existingImages={mergeUploadedImageLists(getCellImgs(row.id, col.key), getPersistedLevelImages(row, col.key, idx))} defaultCellText={String(row[col.key as keyof typeof row] ?? "")} onUploaded={img => onCellUploaded(row.id, col.key, img)} onDeleted={id => onCellDeleted(row.id, col.key, id)}/>}
                          </div>
                          </td>
                        ))}
                        <td className="w-8 px-2 py-2 align-top"><DeleteBtn onClick={() => deleteLevel(row.id)} /></td>
                      </tr>
                      {rowImgs.length > 0 && (
                        <tr className={`${idx % 2 === 0 ? "bg-amber-50/30 dark:bg-amber-900/10" : "bg-amber-50/20 dark:bg-amber-900/5"} border-t border-dashed border-amber-300 dark:border-amber-700/40`}>
                          <td colSpan={LEVEL_COLUMNS.length + 1} className="px-4 py-2">
                            <div className="flex flex-wrap gap-3 items-center">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400" style={{ fontFamily: "'DM Mono', monospace" }}>◆ Images ({row.levelNumber})</span>
                              {rowImgs.map(img => (
                                <div key={img.id} className="group/img inline-flex items-center gap-2 cursor-pointer" onClick={() => setExpandedImage(img)}>
                                  <div className="relative rounded overflow-hidden border border-amber-200 dark:border-amber-700/40 bg-white dark:bg-[#1a1f35]" style={{width:72,height:52}}>
                                    <BrdImage
                                      src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_CP)}
                                      alt={img.cellText || img.mediaName}
                                      className="w-full h-full object-contain group-hover/img:scale-105 transition-transform"
                                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                    <span className="absolute top-0.5 right-0.5 text-[7px] font-mono px-1 rounded bg-black/40 text-white/80">{img.mediaName.split(".").pop()?.toUpperCase()}</span>
                                  </div>
                                  <div>
                                    {img.cellText && <p className="text-[10px] text-slate-500 dark:text-slate-400 max-w-[90px] truncate">{img.cellText}</p>}
                                    <p className="text-[8.5px] text-emerald-500 group-hover/img:underline">expand ↗</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {levels.length === 0 && (
                  <tr>
                    <td colSpan={LEVEL_COLUMNS.length + 1} className="py-10 text-center">
                      <p className="text-[12px] text-slate-500 dark:text-slate-500">No levels defined</p>
                      <button onClick={addLevel} className="mt-2 text-[11.5px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first level</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Heading Annotation */}
      <div className="space-y-2">
        <SectionLabel>Heading Annotation</SectionLabel>
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="flex items-center gap-2">
            <div className="flex-1"><FieldRow label="Heading Annotation" value={headingAnnotation} onChange={setHeadingAnnotation} placeholder="e.g. Level 2" /></div>
            {brdId && <CellImageUploader brdId={brdId} section="contentProfile" fieldLabel="headingAnnotation" existingImages={mergeUploadedImageLists(getCellImgs("headingAnnotation", "value"), getHeadingAnnotationImages())} defaultCellText={headingAnnotation} onUploaded={img => onCellUploaded("headingAnnotation", "value", img)} onDeleted={id => onCellDeleted("headingAnnotation", "value", id)}/>}
          </div>
          {getCellImgs("headingAnnotation", "value").map(img => (
            <BrdImage key={`m-${img.id}`} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_CP2)} alt={img.cellText || img.mediaName} className="mt-2 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
          ))}
        </div>
      </div>

      {/* Whitespace Handling */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Whitespace Handling</SectionLabel>
          <button
            onClick={addWs}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Rule
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: "500px" }}>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                  {WS_COLUMNS.map((col) => (
                    <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>
                        {col.label}
                      </span>
                    </th>
                  ))}
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]">
                {whitespace.map((row, idx) => (
                  <tr key={row.id}
                      className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}>
                    {WS_COLUMNS.map((col) => (
                      <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>
                        <div className="group">
                        {renderWsCell(row, col.key)}
                        {getCellImgs(row.id, col.key).map(img => (
                          <BrdImage key={`m-${img.id}`} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_CP2)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                        ))}
                        {brdId && <CellImageUploader brdId={brdId} section="contentProfile" fieldLabel={cellKey(row.id, col.key)} existingImages={mergeUploadedImageLists(getCellImgs(row.id, col.key), getPersistedWhitespaceImages(row, col.key, idx))} defaultCellText={String(row[col.key as keyof typeof row] ?? "")} onUploaded={img => onCellUploaded(row.id, col.key, img)} onDeleted={id => onCellDeleted(row.id, col.key, id)}/>}
                      </div>
                      </td>
                    ))}
                    <td className="w-8 px-2 py-2 align-top"><DeleteBtn onClick={() => deleteWs(row.id)} /></td>
                  </tr>
                ))}
                {whitespace.length === 0 && (
                  <tr>
                    <td colSpan={WS_COLUMNS.length + 1} className="py-10 text-center">
                      <p className="text-[12px] text-slate-500 dark:text-slate-500">No whitespace rules</p>
                      <button onClick={addWs} className="mt-2 text-[11.5px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first rule</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>


      {/* Lightbox */}
      {expandedImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setExpandedImage(null)}>
          <div className="relative max-w-3xl w-full mx-4 rounded-2xl overflow-hidden bg-white dark:bg-[#1e2235] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-[#2a3147]">
              <div>
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{expandedImage.cellText || expandedImage.mediaName}</p>
                <p className="text-[9px] text-slate-400 font-mono mt-0.5">T{expandedImage.tableIndex} · R{expandedImage.rowIndex} · C{expandedImage.colIndex}</p>
              </div>
              <button onClick={() => setExpandedImage(null)} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-[#252d45] transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-slate-50 dark:bg-[#161b2e] max-h-[70vh]">
              <BrdImage src={buildBrdImageBlobUrl(brdId, expandedImage.id, API_BASE_CP)} alt={expandedImage.mediaName} className="max-w-full max-h-[65vh] object-contain rounded"/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}