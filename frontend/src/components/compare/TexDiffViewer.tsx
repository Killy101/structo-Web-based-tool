"use client";
/**
 * TextDiffViewer.tsx  — White-theme IDE text diff viewer
 *
 * Improvements over previous dark-theme version:
 *  - Clean white background (IDE-style, not terminal-style)
 *  - Better text rendering: headings, bullets, numbered lists properly formatted
 *  - Larger, more readable font (13px Mono)
 *  - Cleaner gutter with line numbers + change icons
 *  - Word diff tokens rendered in light theme colours
 *  - Reduced false positive visual noise
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChangeType = "addition" | "removal" | "modification" | "mismatch" | "emphasis";

interface WordToken { op: "eq" | "del" | "ins"; text: string; }

interface Change {
  id: string;
  type: ChangeType;
  text: string;
  old_text: string | null;
  new_text: string | null;
  page: number;
  old_page?: number | null;
  new_page?: number | null;
  word_diff?: {
    tokens: WordToken[];
    has_changes: boolean;
    change_ratio: number;
    summary: { addition: number; removal: number; modification: number };
    old_word_count: number;
    new_word_count: number;
  } | null;
  applied?: boolean;
  dismissed?: boolean;
}

interface TextDiffViewerProps {
  changes: Change[];
  oldText: string;
  newText: string;
  oldLabel?: string;
  newLabel?: string;
  onChangeSelect?: (changeId: string) => void;
  selectedId?: string | null;
}

// ─── Change-type meta (light theme) ──────────────────────────────────────────

const CM = {
  addition: {
    label: "Addition", icon: "+", gutterColor: "#16a34a",
    lineBg:    "bg-emerald-50/80",
    lineText:  "text-emerald-800",
    lineNumCls:"text-emerald-500",
    pillCls:   "bg-emerald-100 text-emerald-700 border-emerald-300",
    borderCss: "rgba(22,163,74,0.40)",
  },
  removal: {
    label: "Removal", icon: "−", gutterColor: "#dc2626",
    lineBg:    "bg-red-50/80",
    lineText:  "text-red-800 line-through decoration-red-400 decoration-2",
    lineNumCls:"text-red-400",
    pillCls:   "bg-red-100 text-red-700 border-red-300",
    borderCss: "rgba(220,38,38,0.40)",
  },
  modification: {
    label: "Modified", icon: "~", gutterColor: "#d97706",
    lineBg:    "bg-amber-50/80",
    lineText:  "text-amber-900",
    lineNumCls:"text-amber-500",
    pillCls:   "bg-amber-100 text-amber-700 border-amber-300",
    borderCss: "rgba(217,119,6,0.40)",
  },
  mismatch: {
    label: "Mismatch", icon: "≠", gutterColor: "#7c3aed",
    lineBg:    "bg-violet-50/80",
    lineText:  "text-violet-800",
    lineNumCls:"text-violet-400",
    pillCls:   "bg-violet-100 text-violet-700 border-violet-300",
    borderCss: "rgba(124,58,237,0.40)",
  },
  emphasis: {
    label: "Emphasis", icon: "★", gutterColor: "#2563eb",
    lineBg:    "bg-blue-50/80",
    lineText:  "text-blue-800",
    lineNumCls:"text-blue-400",
    pillCls:   "bg-blue-100 text-blue-700 border-blue-300",
    borderCss: "rgba(37,99,235,0.40)",
  },
} satisfies Record<ChangeType, {
  label: string; icon: string; gutterColor: string;
  lineBg: string; lineText: string; lineNumCls: string;
  pillCls: string; borderCss: string;
}>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Word-diff tokens → HTML (light theme) */
function tokensToHtml(tokens: WordToken[]): string {
  return tokens.map(t => {
    const tx = escHtml(t.text);
    if (t.op === "del")
      return `<span style="background:rgba(220,38,38,0.10);color:#b91c1c;text-decoration:line-through;text-decoration-color:#dc2626;border-radius:2px;padding:0 2px;">${tx}</span>`;
    if (t.op === "ins")
      return `<span style="background:rgba(22,163,74,0.10);color:#166534;border-radius:2px;padding:0 2px;">${tx}</span>`;
    return `<span style="color:#1e293b;">${tx}</span>`;
  }).join("");
}

function normalise(s: string) { return s.replace(/\s+/g, " ").trim().toLowerCase(); }

/**
 * Classify a line for improved display.
 * Returns one of: "heading" | "subheading" | "bullet" | "numbered" | "blank" | "normal"
 */
function classifyLine(text: string): "heading" | "subheading" | "bullet" | "numbered" | "blank" | "normal" {
  const t = text.trim();
  if (!t) return "blank";
  // ALL CAPS headings (Part, Chapter, Section, Schedule titles)
  if (/^(PART|CHAPTER|SECTION|SCHEDULE|ANNEX|APPENDIX|ARTICLE)\b/i.test(t) && t.length < 100) return "heading";
  if (/^[A-Z][A-Z\s\d\-—:]{4,}$/.test(t) && t.length < 80) return "heading";
  // Numbered sections like "1.", "1.1", "1.1.1"
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(t)) return "subheading";
  // Lettered/numbered list items: "(1)", "(a)", "a.", "1.", "(i)"
  if (/^(\([a-z0-9ivxl]+\)|[a-z]\.|[0-9]+\.)\s/i.test(t)) return "numbered";
  // Bullet/dash items
  if (/^[•·‣▸▹▷►–—\-]\s/.test(t) || /^\*\s/.test(t)) return "bullet";
  return "normal";
}

function findLineRange(lines: string[], needle: string): [number, number] {
  if (!needle || !lines.length) return [-1, -1];
  const norm = normalise(needle);
  if (!norm) return [-1, -1];
  const anchor = norm.slice(0, 50);
  const lineStarts: number[] = [];
  let joined = "";
  for (let i = 0; i < lines.length; i++) { lineStarts.push(joined.length); joined += normalise(lines[i]) + " "; }
  let pos = joined.indexOf(norm);
  if (pos < 0) pos = joined.indexOf(anchor);
  if (pos < 0) {
    const short = anchor.slice(0, 30);
    if (!short) return [-1, -1];
    for (let i = 0; i < lines.length; i++) {
      if (normalise(lines[i]).includes(short)) {
        return [i, Math.min(i + needle.split("\n").length, lines.length)];
      }
    }
    return [-1, -1];
  }
  let startLine = 0;
  for (let i = 0; i < lineStarts.length; i++) { if (lineStarts[i] <= pos) startLine = i; else break; }
  const needleLen = norm.length; let endLine = startLine + 1;
  while (endLine < lines.length && lineStarts[endLine] < pos + needleLen) endLine++;
  return [startLine, Math.min(endLine, lines.length)];
}

// ─── Line annotation ──────────────────────────────────────────────────────────

interface LineInfo {
  text: string;
  kind: "normal" | ChangeType;
  changeId: string | null;
  changeType: ChangeType | null;
  tokens: WordToken[] | null;
}

function buildAnnotatedLines(rawLines: string[], changes: Change[], side: "old" | "new"): LineInfo[] {
  const out: LineInfo[] = rawLines.map(text => ({ text, kind: "normal" as const, changeId: null, changeType: null, tokens: null }));
  for (const ch of changes) {
    if (ch.dismissed) continue;
    const needle = side === "old"
      ? (ch.old_text ?? (ch.type !== "addition" ? ch.text : null))
      : (ch.new_text ?? (ch.type !== "removal"  ? ch.text : null));
    if (!needle) continue;
    const [start, end] = findLineRange(rawLines, needle);
    if (start < 0) continue;
    for (let i = start; i < end; i++) {
      if (out[i].kind === "normal") {
        out[i].kind = ch.type as ChangeType;
        out[i].changeId = ch.id;
        out[i].changeType = ch.type;
        out[i].tokens = ch.word_diff?.tokens ?? null;
      }
    }
  }
  return out;
}

// ─── Diff Pane (white, IDE-style) ─────────────────────────────────────────────

interface PaneProps {
  side: "old" | "new";
  label: string;
  lines: LineInfo[];
  selectedId: string | null;
  onLineClick: (changeId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code','Consolas',monospace",
  fontSize: "13px",
  lineHeight: "1.65",
};

function DiffPane({ side, label, lines, selectedId, onLineClick, scrollRef, onScroll }: PaneProps) {
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!selectedId) return;
    const el = rowRefs.current.get(selectedId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedId]);

  const [copied, setCopied] = useState(false);
  const copyText = useCallback(() => {
    navigator.clipboard.writeText(lines.map(l => l.text).join("\n")).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }, [lines]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-white"
      style={{ borderRight: side === "old" ? "1px solid #e2e8f0" : "none" }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-widest uppercase border font-mono ${
          side === "old" ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
        }`}>{side === "old" ? "OLD" : "NEW"}</span>
        <span className="text-xs text-slate-500 font-mono truncate flex-1">{label}</span>
        <span className="text-[10px] text-slate-400 font-mono">{lines.length}L</span>
        <button onClick={copyText}
          className="text-[10px] font-mono px-2 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-400 transition-colors">
          {copied ? "✓" : "Copy"}
        </button>
      </div>

      {/* Code area */}
      <div ref={scrollRef} onScroll={onScroll}
        className="flex-1 overflow-auto"
        style={{ ...MONO_STYLE, scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent" }}>
        {lines.map((line, idx) => {
          const meta = line.changeType ? CM[line.changeType] : null;
          const isSelected = !!line.changeId && line.changeId === selectedId;
          const lineKind = classifyLine(line.text);

          return (
            <div
              key={idx}
              ref={el => { if (line.changeId && el) rowRefs.current.set(line.changeId, el); }}
              onClick={() => line.changeId && onLineClick(line.changeId)}
              className={[
                "flex min-w-0 transition-colors duration-75",
                line.changeId ? "cursor-pointer" : "",
                isSelected ? "bg-amber-50/80 ring-1 ring-inset ring-amber-300/60" : "",
                !isSelected && meta ? meta.lineBg : "",
                !isSelected && !meta ? "hover:bg-slate-50/60" : "",
              ].join(" ")}
              style={{
                borderLeft: isSelected ? "3px solid #f59e0b" : meta ? `3px solid ${meta.borderCss}` : "3px solid transparent"
              }}
            >
              {/* Line number */}
              <div className={[
                "flex-shrink-0 w-12 text-right pr-3 py-0.5 select-none",
                meta ? meta.lineNumCls : "text-slate-300",
              ].join(" ")} style={{ fontSize: "11px" }}>
                {idx + 1}
              </div>

              {/* Change icon */}
              <div className="flex-shrink-0 w-5 text-center py-0.5 select-none font-bold"
                style={{ color: meta?.gutterColor ?? "transparent", fontSize: "11px" }}>
                {meta && CM[line.changeType!].icon}
              </div>

              {/* Content */}
              <div className={[
                "flex-1 min-w-0 pl-1 pr-4 py-0.5 whitespace-pre-wrap break-words",
                lineKind === "heading" ? "font-semibold tracking-wide" : "",
                lineKind === "subheading" ? "font-medium" : "",
              ].join(" ")}>
                {line.kind === "modification" && line.tokens && line.tokens.length > 0 ? (
                  <span dangerouslySetInnerHTML={{ __html: tokensToHtml(line.tokens) }} />
                ) : meta ? (
                  <span className={meta.lineText}>{line.text || "\u00a0"}</span>
                ) : (
                  <span className={
                    lineKind === "heading" ? "text-slate-800" :
                    lineKind === "subheading" ? "text-slate-700" :
                    lineKind === "blank" ? "" :
                    lineKind === "bullet" || lineKind === "numbered" ? "text-slate-600" :
                    "text-slate-600"
                  }>{line.text || "\u00a0"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TextDiffViewer({
  changes,
  oldText,
  newText,
  oldLabel = "Original document",
  newLabel  = "Revised document",
  onChangeSelect,
  selectedId: externalSelectedId,
}: TextDiffViewerProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = externalSelectedId ?? internalSelectedId;

  const [filterTypes, setFilterTypes] = useState<Set<ChangeType>>(
    new Set(["addition", "removal", "modification", "mismatch", "emphasis"]),
  );
  const [syncScroll, setSyncScroll] = useState(true);
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");

  const oldScrollRef = useRef<HTMLDivElement>(null);
  const newScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing    = useRef(false);

  const oldLines = useMemo(() => (oldText || "").split("\n"), [oldText]);
  const newLines = useMemo(() => (newText || "").split("\n"), [newText]);

  const activeChanges = useMemo(
    () => changes.filter(c => !c.dismissed && filterTypes.has(c.type)),
    [changes, filterTypes],
  );

  const oldAnnotated = useMemo(() => buildAnnotatedLines(oldLines, activeChanges, "old"), [oldLines, activeChanges]);
  const newAnnotated = useMemo(() => buildAnnotatedLines(newLines, activeChanges, "new"), [newLines, activeChanges]);

  const totalCounts = useMemo(() => {
    const c: Record<ChangeType, number> = { addition: 0, removal: 0, modification: 0, mismatch: 0, emphasis: 0 };
    changes.filter(ch => !ch.dismissed).forEach(ch => { c[ch.type] = (c[ch.type] ?? 0) + 1; });
    return c;
  }, [changes]);

  const handleOldScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const pct = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    if (syncScroll && !isSyncing.current && newScrollRef.current) {
      isSyncing.current = true;
      newScrollRef.current.scrollTop = pct * (newScrollRef.current.scrollHeight - newScrollRef.current.clientHeight);
      setTimeout(() => { isSyncing.current = false; }, 40);
    }
  }, [syncScroll]);

  const handleNewScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const pct = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    if (syncScroll && !isSyncing.current && oldScrollRef.current) {
      isSyncing.current = true;
      oldScrollRef.current.scrollTop = pct * (oldScrollRef.current.scrollHeight - oldScrollRef.current.clientHeight);
      setTimeout(() => { isSyncing.current = false; }, 40);
    }
  }, [syncScroll]);

  const handleSelect = useCallback((changeId: string) => {
    const next = changeId === selectedId ? null : changeId;
    setInternalSelectedId(next);
    if (next) onChangeSelect?.(next);
  }, [selectedId, onChangeSelect]);

  const toggleFilter = useCallback((type: ChangeType) => {
    setFilterTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  // Unified view
  const unifiedLines = useMemo(() => {
    if (viewMode !== "unified") return [];
    type ULine = { lineNo: number; side: "old" | "new" | "ctx"; info: LineInfo };
    const out: ULine[] = [];
    let oi = 0, ni = 0;
    while (oi < oldAnnotated.length || ni < newAnnotated.length) {
      const ol = oldAnnotated[oi]; const nl = newAnnotated[ni];
      if (ol && ol.kind !== "normal") { out.push({ lineNo: oi + 1, side: "old", info: ol }); oi++; }
      else if (nl && nl.kind !== "normal") { out.push({ lineNo: ni + 1, side: "new", info: nl }); ni++; }
      else if (oi < oldAnnotated.length) { out.push({ lineNo: oi + 1, side: "ctx", info: ol }); oi++; ni++; }
      else if (ni < newAnnotated.length) { out.push({ lineNo: ni + 1, side: "ctx", info: nl }); ni++; }
    }
    return out;
  }, [viewMode, oldAnnotated, newAnnotated]);

  if (!oldText && !newText) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white text-slate-400 text-sm gap-3">
        <svg className="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-xs text-slate-400">Run detection to populate the text diff viewer</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 flex-wrap">

        {/* Filter pills */}
        <div className="flex items-center gap-1.5">
          {(Object.entries(CM) as [ChangeType, typeof CM[ChangeType]][]).map(([type, m]) => {
            const total = totalCounts[type]; const active = filterTypes.has(type);
            if (!total) return null;
            return (
              <button key={type} onClick={() => toggleFilter(type)}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-mono font-semibold transition-all ${
                  active ? m.pillCls : "bg-white border-slate-200 text-slate-400 opacity-50 hover:opacity-80"
                }`}>
                <span>{m.icon}</span><span>{total}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={() => setSyncScroll(s => !s)}
            className={`text-[11px] px-2.5 py-1 rounded border font-mono transition-colors ${
              syncScroll ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-200 text-slate-400"
            }`} title="Sync scroll">⇅ Sync</button>
          <div className="flex rounded overflow-hidden border border-slate-200 text-[11px] font-mono">
            {(["split", "unified"] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 capitalize transition-colors ${
                  viewMode === m ? "bg-slate-700 text-white" : "bg-white text-slate-400 hover:text-slate-700"
                }`}>{m}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Changes list */}
        <div className="flex-shrink-0 w-52 flex flex-col border-r border-slate-200 bg-white overflow-hidden">
          <div className="flex-shrink-0 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">
              {activeChanges.length} change{activeChanges.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {activeChanges.length === 0 && (
              <p className="text-center text-[11px] text-slate-400 italic py-4 px-2">No changes</p>
            )}
            {activeChanges.map(ch => {
              const m = CM[ch.type]; const isSel = selectedId === ch.id;
              const preview = (ch.old_text ?? ch.new_text ?? ch.text ?? "").slice(0, 55).replace(/\s+/g, " ").trim();
              return (
                <button key={ch.id} onClick={() => handleSelect(ch.id)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100 transition-colors ${isSel ? "bg-amber-50" : "hover:bg-slate-50"}`}
                  style={{ borderLeft: `3px solid ${isSel ? "#f59e0b" : m.borderCss}` }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[11px] font-bold font-mono" style={{ color: m.gutterColor }}>{m.icon}</span>
                    <span className="text-[10px] font-semibold" style={{ color: m.gutterColor }}>{m.label}</span>
                    {ch.page > 0 && <span className="text-[9px] text-slate-400 ml-auto font-mono">p{ch.page}</span>}
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono truncate leading-tight">{preview || "—"}</p>
                  {ch.word_diff?.summary && (
                    <div className="flex gap-1.5 mt-0.5">
                      {ch.word_diff.summary.addition    > 0 && <span className="text-[9px] text-emerald-600">+{ch.word_diff.summary.addition}</span>}
                      {ch.word_diff.summary.removal     > 0 && <span className="text-[9px] text-red-500">−{ch.word_diff.summary.removal}</span>}
                      {ch.word_diff.summary.modification > 0 && <span className="text-[9px] text-amber-600">~{ch.word_diff.summary.modification}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Diff panes */}
        {viewMode === "split" ? (
          <div className="flex flex-1 min-w-0 min-h-0">
            <DiffPane side="old" label={oldLabel} lines={oldAnnotated} selectedId={selectedId}
              onLineClick={handleSelect} scrollRef={oldScrollRef} onScroll={handleOldScroll} />
            <DiffPane side="new" label={newLabel} lines={newAnnotated} selectedId={selectedId}
              onLineClick={handleSelect} scrollRef={newScrollRef} onScroll={handleNewScroll} />
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-white overflow-hidden">
            <div className="flex-1 overflow-auto" style={{ ...MONO_STYLE, scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent" }}>
              {unifiedLines.map(({ lineNo, side, info }, idx) => {
                const meta = info.changeType ? CM[info.changeType] : null;
                const isSelected = !!info.changeId && info.changeId === selectedId;
                const lineKind = classifyLine(info.text);
                return (
                  <div key={idx}
                    onClick={() => info.changeId && handleSelect(info.changeId)}
                    className={[
                      "flex min-w-0 transition-colors duration-75",
                      info.changeId ? "cursor-pointer" : "",
                      isSelected ? "bg-amber-50/80 ring-1 ring-inset ring-amber-300/60" : "",
                      !isSelected && meta ? meta.lineBg : "",
                      !isSelected && !meta ? "hover:bg-slate-50/50" : "",
                      lineKind === "heading" ? "font-semibold" : "",
                    ].join(" ")}
                    style={{ borderLeft: isSelected ? "3px solid #f59e0b" : meta ? `3px solid ${meta.borderCss}` : "3px solid transparent" }}
                  >
                    <div className="flex-shrink-0 w-8 text-center py-0.5 select-none" style={{ fontSize: "9px", fontFamily: "monospace" }}>
                      {side !== "ctx" && <span className={side === "old" ? "text-red-400" : "text-emerald-600"}>{side}</span>}
                    </div>
                    <div className={`flex-shrink-0 w-12 text-right pr-3 py-0.5 select-none ${meta ? meta.lineNumCls : "text-slate-300"}`} style={{ fontSize: "11px" }}>{lineNo}</div>
                    <div className="flex-shrink-0 w-5 text-center py-0.5 font-bold select-none"
                      style={{ color: meta?.gutterColor ?? "transparent", fontSize: "11px" }}>
                      {info.kind !== "normal" && meta ? CM[info.changeType!].icon : ""}
                    </div>
                    <div className="flex-1 min-w-0 pl-1 pr-4 py-0.5 whitespace-pre-wrap break-words">
                      {info.kind === "modification" && info.tokens && info.tokens.length > 0 ? (
                        <span dangerouslySetInnerHTML={{ __html: tokensToHtml(info.tokens) }} />
                      ) : meta ? (
                        <span className={meta.lineText}>{info.text || "\u00a0"}</span>
                      ) : (
                        <span className="text-slate-600">{info.text || "\u00a0"}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer legend ── */}
      <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 bg-slate-50 border-t border-slate-200">
        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Legend</span>
        {(["addition", "removal", "modification"] as ChangeType[]).map(type => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: CM[type].gutterColor, opacity: 0.7 }} />
            <span className="text-[10px] font-mono" style={{ color: CM[type].gutterColor }}>{CM[type].label}</span>
          </div>
        ))}
        <span className="text-[10px] font-mono ml-auto text-slate-400">
          {changes.filter(c => !c.dismissed).length} changes total · Read-only
        </span>
      </div>
    </div>
  );
}