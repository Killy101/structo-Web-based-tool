"use client";
/**
 * ComparePanel — PDF Change Detection + XML Editor
 *
 * Workflow
 * ────────
 *  1. Upload OLD PDF, NEW PDF, XML reference file
 *  2. Click "Detect Changes" → POST /compare/detect
 *  3. Left sidebar lists all detected changes, grouped by type:
 *       Addition · Modification · Mismatch · Emphasis · Removal
 *  4. Click a change → XML editor scrolls to and selects that text
 *  5. MANAGER_QA / SUPER_ADMIN : can apply changes or edit XML directly
 *     MANAGER_QC / ADMIN / USER : read-only XML view
 *
 * Emphasis tags (whiteboard):  <b>  <s>  <u>  <i>
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChangeType =
  | "addition"
  | "removal"
  | "modification"
  | "mismatch"
  | "emphasis";

interface Formatting {
  bold: boolean;
  italic: boolean;
  color: number;
  is_colored?: boolean;
}

interface Change {
  id: string;
  type: ChangeType;
  text: string;
  old_text: string | null;
  new_text: string | null;
  old_formatting: Formatting | null;
  new_formatting: (Formatting & { is_colored?: boolean }) | null;
  xml_path: string | null;
  page: number;
  suggested_xml: string | null;
  applied?: boolean;
  dismissed?: boolean;
}

interface DetectSummary {
  addition: number;
  removal: number;
  modification: number;
  emphasis: number;
  mismatch: number;
}

interface DetectResponse {
  success: boolean;
  old_filename: string;
  new_filename: string;
  xml_filename: string;
  changes: Change[];
  xml_content: string;
  summary: DetectSummary;
}

// ── Change-type metadata ───────────────────────────────────────────────────────

const CM: Record<
  ChangeType,
  { label: string; icon: string; bg: string; border: string; text: string; pill: string }
> = {
  addition:     { label: "Addition",     icon: "+", bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", pill: "bg-emerald-500/20 text-emerald-300" },
  removal:      { label: "Removal",      icon: "−", bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-400",     pill: "bg-red-500/20 text-red-300"         },
  modification: { label: "Modification", icon: "~", bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   pill: "bg-amber-500/20 text-amber-300"     },
  mismatch:     { label: "Mismatch",     icon: "≠", bg: "bg-violet-500/10",  border: "border-violet-500/30",  text: "text-violet-400",  pill: "bg-violet-500/20 text-violet-300"   },
  emphasis:     { label: "Emphasis",     icon: "★", bg: "bg-blue-500/10",    border: "border-blue-500/30",    text: "text-blue-400",    pill: "bg-blue-500/20 text-blue-300"       },
};

const CHANGE_ORDER: ChangeType[] = [
  "addition", "modification", "mismatch", "emphasis", "removal",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ── DropZone ──────────────────────────────────────────────────────────────────

type DZColor = "violet" | "blue" | "emerald";

const DZC: Record<DZColor, Record<string, string>> = {
  violet:  { border: "border-violet-500/40",  bg: "bg-violet-500/8",  badge: "bg-violet-500/20 text-violet-300",  icon: "text-violet-400",  hover: "hover:border-violet-500/50 hover:bg-violet-500/5"  },
  blue:    { border: "border-blue-500/40",    bg: "bg-blue-500/8",    badge: "bg-blue-500/20 text-blue-300",      icon: "text-blue-400",    hover: "hover:border-blue-500/50 hover:bg-blue-500/5"      },
  emerald: { border: "border-emerald-500/40", bg: "bg-emerald-500/8", badge: "bg-emerald-500/20 text-emerald-300", icon: "text-emerald-400", hover: "hover:border-emerald-500/50 hover:bg-emerald-500/5" },
};

function DropZone({ label, sublabel, accept, file, onFile, color, icon }: {
  label: string; sublabel?: string; accept: string;
  file: File | null; onFile: (f: File | null) => void;
  color: DZColor; icon: "pdf" | "xml";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const c = DZC[color];
  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all p-3
        ${drag ? `${c.border} ${c.bg} scale-[1.01]` : `border-slate-700/50 ${c.hover}`}`}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.bg} ${c.icon}`}>
          {icon === "pdf" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
            {sublabel && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500">{sublabel}</span>}
          </div>
          {file ? (
            <p className="text-xs font-medium text-white truncate">
              {file.name}
              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${c.badge}`}>{fmtBytes(file.size)}</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500">Drop or click to browse</p>
          )}
        </div>
        {file && (
          <button onClick={(e) => { e.stopPropagation(); onFile(null); }}
            className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700/80 hover:bg-red-500/30 flex items-center justify-center transition-colors">
            <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── ChangeItem ────────────────────────────────────────────────────────────────

function ChangeItem({ change, isSelected, canEdit, onSelect, onApply, onDismiss }: {
  change: Change; isSelected: boolean; canEdit: boolean;
  onSelect: () => void;
  onApply: (mode: "textual" | "replace" | "emphasis") => void;
  onDismiss: () => void;
}) {
  const m = CM[change.type];
  const isDone = change.applied || change.dismissed;

  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border transition-all cursor-pointer
        ${isSelected ? `${m.bg} ${m.border} ring-1 ring-inset ring-current/20` : "border-slate-700/40 hover:border-slate-600/60 bg-slate-900/30"}
        ${isDone ? "opacity-40" : ""}`}
    >
      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-start gap-2">
          <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5 ${m.bg} ${m.text} border ${m.border}`}>
            {m.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${m.text}`}>{m.label}</span>
              <span className="text-[10px] text-slate-600 flex-shrink-0">Pg {change.page}</span>
            </div>

            {/* Text snippet */}
            <div className="mt-1 text-[11px] font-mono leading-relaxed">
              {change.type === "modification" && change.old_text && change.new_text ? (
                <>
                  <span className="text-red-400 line-through block truncate">
                    {change.old_text.slice(0, 60)}{change.old_text.length > 60 ? "…" : ""}
                  </span>
                  <span className="text-slate-500 text-[10px]">→</span>
                  <span className="text-emerald-400 block truncate">
                    {change.new_text.slice(0, 60)}{change.new_text.length > 60 ? "…" : ""}
                  </span>
                </>
              ) : change.type === "removal" ? (
                <span className="text-red-300/70 truncate block">
                  {change.text.slice(0, 80)}{change.text.length > 80 ? "…" : ""}
                </span>
              ) : (
                <span className="text-slate-300 truncate block">
                  {change.text.slice(0, 80)}{change.text.length > 80 ? "…" : ""}
                </span>
              )}
            </div>

            {/* Formatting badges for emphasis */}
            {change.type === "emphasis" && change.new_formatting && (
              <div className="flex items-center gap-1 mt-1">
                {change.new_formatting.bold    && <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-bold">B</span>}
                {change.new_formatting.italic  && <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 italic">I</span>}
                {change.new_formatting.is_colored && <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-blue-400">Color</span>}
              </div>
            )}

            {/* Suggested XML for emphasis */}
            {change.suggested_xml && change.type === "emphasis" && (
              <p className="text-[10px] text-blue-400/70 font-mono mt-1 truncate">{change.suggested_xml}</p>
            )}
          </div>
        </div>

        {/* XML path hint */}
        {change.xml_path && (
          <p className="text-[9px] text-slate-700 font-mono mt-1 truncate pl-7">{change.xml_path}</p>
        )}

        {/* Action buttons (editors only, when selected) */}
        {isSelected && canEdit && !isDone && (
          <div className="mt-2.5 pt-2 border-t border-slate-700/40 space-y-1.5">
            <div className="grid grid-cols-3 gap-1">
              {/* Textual — plain text edit */}
              {(change.type === "modification" || change.type === "addition" || change.type === "mismatch") && (
                <button onClick={(e) => { e.stopPropagation(); onApply("textual"); }}
                  className="py-1.5 rounded-lg bg-slate-700/40 hover:bg-slate-600/50 border border-slate-600/30 text-slate-300 text-[10px] font-semibold transition-all">
                  Textual
                </button>
              )}
              {/* Immod-replace — immediate replacement */}
              {(change.type === "modification" || change.type === "mismatch" || change.type === "removal") && (
                <button onClick={(e) => { e.stopPropagation(); onApply("replace"); }}
                  className="py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-[10px] font-semibold transition-all">
                  Immod
                </button>
              )}
              {/* Emphasis — wrap in formatting tag */}
              {(change.type === "emphasis" || change.new_formatting?.bold || change.new_formatting?.italic || change.new_formatting?.is_colored) && (
                <button onClick={(e) => { e.stopPropagation(); onApply("emphasis"); }}
                  className="py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[10px] font-semibold transition-all">
                  Emphasis
                </button>
              )}
            </div>

            {/* Emphasis tag picker */}
            {change.type === "emphasis" && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[9px] text-slate-600">Tag:</span>
                {(["b", "i", "s", "u"] as const).map((tag) => (
                  <button key={tag} onClick={(e) => { e.stopPropagation(); onApply("emphasis"); }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors font-mono">
                    &lt;{tag}&gt;
                  </button>
                ))}
              </div>
            )}

            <button onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="w-full py-1 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-500 hover:text-slate-400 text-[10px] font-medium transition-all">
              Skip
            </button>
          </div>
        )}

        {isDone && (
          <p className={`text-[10px] mt-1 pl-7 ${change.applied ? "text-emerald-600" : "text-slate-700"}`}>
            {change.applied ? "✓ Applied" : "Skipped"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── XML Editor ────────────────────────────────────────────────────────────────

function XmlEditor({ content, onChange, canEdit, highlightText, editorRef }: {
  content: string; onChange?: (v: string) => void;
  canEdit: boolean; highlightText?: string | null;
  editorRef: React.RefObject<HTMLTextAreaElement>;
}) {
  // Scroll to + select matching text whenever highlight target changes
  useEffect(() => {
    if (!highlightText || !editorRef.current || !content) return;
    const el = editorRef.current;
    const idx = content.indexOf(highlightText);
    if (idx < 0) return;
    el.focus();
    el.setSelectionRange(idx, idx + highlightText.length);
    const linesBefore = content.substring(0, idx).split("\n").length;
    el.scrollTop = Math.max(0, (linesBefore - 4) * 19);
  }, [highlightText]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!content) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
        <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center">
          <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-400">XML Editor</p>
          <p className="text-xs text-slate-600 mt-1 max-w-xs">
            Upload OLD PDF, NEW PDF, and an XML file, then click{" "}
            <span className="text-blue-400">Detect Changes</span> to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <textarea
      ref={editorRef}
      value={content}
      onChange={canEdit ? (e) => onChange?.(e.target.value) : undefined}
      readOnly={!canEdit}
      spellCheck={false}
      className={`flex-1 w-full px-4 py-3 font-mono text-[12px] leading-[1.6] resize-none
        bg-slate-950 border-0 focus:outline-none focus:ring-0
        ${canEdit ? "text-slate-200 cursor-text" : "text-slate-400 cursor-default"}
        selection:bg-amber-400/30 selection:text-white`}
    />
  );
}

// ── Main ComparePanel ─────────────────────────────────────────────────────────

export default function ComparePanel() {
  const { user } = useAuth();
  // Updating Team (MANAGER_QA) and Super Admin can edit XML
  const canEdit = user?.role === "SUPER_ADMIN" || user?.role === "MANAGER_QA";

  const [oldPdf,   setOldPdf]   = useState<File | null>(null);
  const [newPdf,   setNewPdf]   = useState<File | null>(null);
  const [xmlFile,  setXmlFile]  = useState<File | null>(null);

  const [changes,    setChanges]    = useState<Change[]>([]);
  const [xmlContent, setXmlContent] = useState("");
  const [summary,    setSummary]    = useState<DetectSummary | null>(null);

  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [filterType,  setFilterType]  = useState<ChangeType | "all">("all");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const isReady   = !!oldPdf && !!newPdf && !!xmlFile;

  // ── Detect changes
  const handleDetect = useCallback(async () => {
    if (!isReady) return;
    setLoading(true); setError(null);
    setChanges([]); setSummary(null); setSelectedId(null);
    try {
      const form = new FormData();
      form.append("old_pdf",  oldPdf!);
      form.append("new_pdf",  newPdf!);
      form.append("xml_file", xmlFile!);
      const res = await fetch(`${PROCESSING_URL}/compare/detect`, { method: "POST", body: form });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ?? `HTTP ${res.status}`); }
      const data: DetectResponse = await res.json();
      setChanges(data.changes);
      setXmlContent(data.xml_content);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally { setLoading(false); }
  }, [isReady, oldPdf, newPdf, xmlFile]);

  // ── Select a change and scroll XML editor to it
  const handleSelect = useCallback((change: Change) => {
    setSelectedId(change.id);
    const searchText = change.old_text || change.new_text || change.text;
    if (!searchText || !editorRef.current || !xmlContent) return;
    const el  = editorRef.current;
    const idx = xmlContent.indexOf(searchText);
    if (idx < 0) return;
    el.focus();
    el.setSelectionRange(idx, idx + searchText.length);
    el.scrollTop = Math.max(0, (xmlContent.substring(0, idx).split("\n").length - 4) * 19);
  }, [xmlContent]);

  // ── Apply change to XML
  const handleApply = useCallback((change: Change, mode: "textual" | "replace" | "emphasis") => {
    if (!canEdit) return;
    let xml = xmlContent;

    if (mode === "emphasis") {
      const t = change.new_text || change.text;
      if (t && change.new_formatting) {
        const { bold, italic, is_colored } = change.new_formatting;
        let repl = t;
        if (italic)    repl = `<i>${repl}</i>`;
        if (bold)      repl = `<b>${repl}</b>`;
        if (is_colored && !bold && !italic) repl = `<em>${repl}</em>`;
        xml = xml.replace(t, repl);
      }
    } else {
      // textual / replace
      switch (change.type) {
        case "modification": case "mismatch":
          if (change.old_text && change.new_text) xml = xml.replace(change.old_text, change.new_text);
          break;
        case "removal":
          if (change.old_text) xml = xml.replace(change.old_text, `<del>${change.old_text}</del>`);
          break;
        case "addition":
          if (change.new_text && xml.includes("</")) {
            const pos = xml.lastIndexOf("</");
            xml = `${xml.slice(0, pos)}<!-- ADD: ${change.new_text} -->\n${xml.slice(pos)}`;
          }
          break;
      }
    }

    setXmlContent(xml);
    setChanges((prev) => prev.map((c) => c.id === change.id ? { ...c, applied: true } : c));
  }, [canEdit, xmlContent]);

  const handleDismiss = useCallback((change: Change) => {
    setChanges((prev) => prev.map((c) => c.id === change.id ? { ...c, dismissed: true } : c));
  }, []);

  function handleDownload() {
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = xmlFile?.name ?? "output.xml"; a.click();
    URL.revokeObjectURL(url);
  }

  const selectedChange = changes.find((c) => c.id === selectedId) ?? null;
  const filtered       = filterType === "all" ? changes : changes.filter((c) => c.type === filterType);
  const highlightText  = selectedChange
    ? (selectedChange.old_text || selectedChange.new_text || selectedChange.text)
    : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── File pickers ──────────────────────────────────────── */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-2 px-4 pt-3 pb-2 border-b border-slate-800 bg-slate-900/30">
        <DropZone label="OLD PDF"  sublabel="baseline" accept=".pdf,application/pdf"             file={oldPdf}  onFile={setOldPdf}  color="violet"  icon="pdf" />
        <DropZone label="NEW PDF"  sublabel="updated"  accept=".pdf,application/pdf"             file={newPdf}  onFile={setNewPdf}  color="blue"    icon="pdf" />
        <DropZone label="XML File" sublabel="reference" accept=".xml,text/xml,application/xml"  file={xmlFile} onFile={setXmlFile} color="emerald" icon="xml" />
      </div>

      {/* ── Action row ────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-slate-800 flex-wrap">
        <button onClick={handleDetect} disabled={!isReady || loading}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all
            ${isReady && !loading
              ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/20"
              : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
        >
          {loading ? (
            <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>Detecting…</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>Detect Changes</>
          )}
        </button>

        {/* Summary pills */}
        {summary && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {CHANGE_ORDER.map((key) => summary[key] > 0 ? (
              <span key={key} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${CM[key].bg} ${CM[key].text} ${CM[key].border}`}>
                {summary[key]} {CM[key].label}
              </span>
            ) : null)}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canEdit && xmlContent && (
            <button onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download XML
            </button>
          )}
          {!canEdit && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-slate-800/80 text-slate-500">
              Read-only · contact Updating Team to edit
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* ── Main 2-column layout ──────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* ── LEFT SIDEBAR — change list ───────────────────── */}
        <div className="w-[280px] flex-shrink-0 flex flex-col border-r border-slate-800 bg-slate-900/20 overflow-hidden">

          {/* Filter row */}
          <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-slate-800/60">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Changes{" "}
              {changes.length > 0 && <span className="text-slate-700 font-normal normal-case tracking-normal">({changes.filter(c => !c.dismissed).length} active)</span>}
            </p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setFilterType("all")}
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all
                  ${filterType === "all" ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-300"}`}>
                All
              </button>
              {CHANGE_ORDER.map((key) => summary?.[key] ? (
                <button key={key} onClick={() => setFilterType(filterType === key ? "all" : key)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-all
                    ${filterType === key
                      ? `${CM[key].bg} ${CM[key].text} ${CM[key].border}`
                      : "bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-slate-300"}`}>
                  {CM[key].icon} {summary[key]}
                </button>
              ) : null)}
            </div>
          </div>

          {/* Change list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filtered.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                {changes.length === 0 ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-slate-800/60 flex items-center justify-center mb-2">
                      <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <p className="text-xs text-slate-600">No changes detected yet</p>
                    <p className="text-[10px] text-slate-700 mt-1">Upload files and click Detect Changes</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-600">No {filterType} changes</p>
                )}
              </div>
            )}
            {filtered.map((change) => (
              <ChangeItem
                key={change.id}
                change={change}
                isSelected={selectedId === change.id}
                canEdit={canEdit}
                onSelect={() => handleSelect(change)}
                onApply={(mode) => handleApply(change, mode)}
                onDismiss={() => handleDismiss(change)}
              />
            ))}
          </div>
        </div>

        {/* ── RIGHT — XML Editor ────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
          {/* Editor header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/30">
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-semibold text-slate-300">
                XML Editor{xmlFile?.name ? <span className="text-slate-500 font-normal ml-1">— {xmlFile.name}</span> : null}
              </span>
              {canEdit
                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Editable</span>
                : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500">Read-only</span>
              }
            </div>
            {selectedChange && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-600">Navigated to:</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${CM[selectedChange.type].pill}`}>
                  {CM[selectedChange.type].label}
                </span>
              </div>
            )}
          </div>

          <XmlEditor
            content={xmlContent}
            onChange={setXmlContent}
            canEdit={canEdit}
            highlightText={highlightText}
            editorRef={editorRef}
          />
        </div>
      </div>
    </div>
  );
}
