"use client";
/**
 * ComparePanel — IDE-style text diff viewer + React-PDF viewer with highlights
 *
 * Layout
 * ──────
 *  [TOP BAR]  File slots + Detect + Chunk dropdown + filter pills + Apply All + Save
 *  [MAIN]
 *    LEFT  → Changes list (narrow sidebar, inline Apply/Dismiss buttons per row)
 *    RIGHT → White IDE text-diff viewer (split OLD | NEW, big & clean)
 *             OR React-PDF side-by-side with bbox highlights + jump buttons
 *  [BOTTOM]  XML Editor (when XML available)
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import type { PdfChunk } from "./ChunkPanel";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure pdf.js worker
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChangeType = "addition" | "removal" | "modification" | "mismatch" | "emphasis";

interface Formatting {
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  strikethrough?: boolean;
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
  emphasis?: string[];
  xml_path: string | null;
  page: number;
  old_page?: number | null;
  new_page?: number | null;
  bbox?: [number, number, number, number] | null;
  old_bbox?: [number, number, number, number] | null;
  new_bbox?: [number, number, number, number] | null;
  suggested_xml: string | null;
  word_diff?: {
    tokens: Array<{ op: "eq" | "del" | "ins"; text: string }>;
    has_changes: boolean;
    change_ratio: number;
    summary: { addition: number; removal: number; modification: number };
    old_word_count: number;
    new_word_count: number;
  } | null;
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
  baseline?: "xml" | "old_pdf";
  old_full_text?: string;
  new_full_text?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ComparePanelProps {
  initialChunk?:       PdfChunk | null;
  initialSourceName?:  string;
  initialOldPdf?:      File | null;
  initialNewPdf?:      File | null;
  initialXmlFile?:     File | null;
  allChunks?:          PdfChunk[];
  onChunkDone?:        (chunk: PdfChunk) => void;
  onNavigateToChunk?:  (chunk: PdfChunk) => void;
  activeJob?:          { job_id: string; source_name: string; status: string } | null;
}

// ── Change-type metadata ───────────────────────────────────────────────────────

const CM: Record<ChangeType, {
  label: string; icon: string;
  bg: string; border: string; text: string; pill: string; dot: string;
  gutterColor: string;
  lineBgLight: string; lineTextLight: string;
  pdfFill: string; pdfStroke: string;
}> = {
  addition: {
    label: "Addition", icon: "+",
    bg: "bg-green-50", border: "border-green-300",
    text: "text-green-700", pill: "bg-green-100 text-green-700 border-green-300",
    dot: "bg-green-500", gutterColor: "#16a34a",
    lineBgLight: "bg-green-50/80", lineTextLight: "text-green-800",
    pdfFill: "rgba(22,163,74,0.18)", pdfStroke: "#16a34a",
  },
  removal: {
    label: "Removal", icon: "−",
    bg: "bg-pink-50", border: "border-pink-300",
    text: "text-pink-700", pill: "bg-pink-100 text-pink-700 border-pink-300",
    dot: "bg-pink-400", gutterColor: "#db2777",
    lineBgLight: "bg-pink-50/80", lineTextLight: "text-pink-800 line-through decoration-pink-400 decoration-2",
    pdfFill: "rgba(244,63,94,0.15)", pdfStroke: "#f43f5e",
  },
  modification: {
    label: "Modified", icon: "~",
    bg: "bg-fuchsia-50", border: "border-fuchsia-300",
    text: "text-fuchsia-700", pill: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
    dot: "bg-fuchsia-500", gutterColor: "#c026d3",
    lineBgLight: "bg-fuchsia-50/80", lineTextLight: "text-fuchsia-900",
    pdfFill: "rgba(192,38,211,0.15)", pdfStroke: "#c026d3",
  },
  mismatch: {
    label: "Mismatch", icon: "≠",
    bg: "bg-violet-50", border: "border-violet-300",
    text: "text-violet-700", pill: "bg-violet-100 text-violet-700 border-violet-300",
    dot: "bg-violet-500", gutterColor: "#7c3aed",
    lineBgLight: "bg-violet-50/70", lineTextLight: "text-violet-800",
    pdfFill: "rgba(124,58,237,0.18)", pdfStroke: "#7c3aed",
  },
  emphasis: {
    label: "Emphasis", icon: "★",
    bg: "bg-blue-50", border: "border-blue-300",
    text: "text-blue-700", pill: "bg-blue-100 text-blue-700 border-blue-300",
    dot: "bg-blue-500", gutterColor: "#2563eb",
    lineBgLight: "bg-blue-50/70", lineTextLight: "text-blue-800",
    pdfFill: "rgba(37,99,235,0.15)", pdfStroke: "#2563eb",
  },
};

const CHANGE_ORDER: ChangeType[] = ["addition", "modification", "mismatch", "emphasis", "removal"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fuzzyIndexOf(haystack: string, needle: string): [number, number] {
  if (!needle || !haystack) return [-1, -1];
  let idx = haystack.indexOf(needle);
  if (idx >= 0) return [idx, idx + needle.length];
  const trimmed = needle.trim();
  idx = haystack.indexOf(trimmed);
  if (idx >= 0) return [idx, idx + trimmed.length];
  const needleNorm = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (!needleNorm) return [-1, -1];
  const origIdx: number[] = [];
  let n = "";
  let prevWs = true;
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) {
      if (!prevWs) { origIdx.push(i); n += " "; prevWs = true; }
    } else { origIdx.push(i); n += ch.toLowerCase(); prevWs = false; }
  }
  const normIdx = n.indexOf(needleNorm);
  if (normIdx < 0) return [-1, -1];
  const start = normIdx < origIdx.length ? origIdx[normIdx] : -1;
  if (start < 0) return [-1, -1];
  const endNormIdx = Math.min(normIdx + needleNorm.length - 1, origIdx.length - 1);
  const end = origIdx[endNormIdx] + 1;
  return [start, Math.min(end, haystack.length)];
}

function fuzzyReplace(text: string, search: string, replacement: string): string {
  const [start, end] = fuzzyIndexOf(text, search);
  if (start < 0) return text;
  return text.slice(0, start) + replacement + text.slice(end);
}

function stripXmlTags(xml: string): { stripped: string; origPos: number[] } {
  const stripped: string[] = [];
  const origPos: number[] = [];
  let i = 0;
  while (i < xml.length) {
    if (xml[i] === "<") {
      const close = xml.indexOf(">", i);
      if (close < 0) { stripped.push(xml[i]); origPos.push(i); i++; }
      else { i = close + 1; }
    } else if (xml[i] === "&") {
      const semi = xml.indexOf(";", i);
      if (semi > 0 && semi - i <= 8) {
        const entity = xml.slice(i, semi + 1);
        const ch = entity === "&amp;" ? "&" : entity === "&lt;" ? "<" :
                   entity === "&gt;" ? ">" : entity === "&quot;" ? '"' :
                   entity === "&apos;" ? "'" : null;
        if (ch) { stripped.push(ch); origPos.push(i); i = semi + 1; continue; }
      }
      stripped.push(xml[i]); origPos.push(i); i++;
    } else { stripped.push(xml[i]); origPos.push(i); i++; }
  }
  return { stripped: stripped.join(""), origPos };
}

function findTextInXml(xmlContent: string, needle: string): [number, number] {
  if (!needle || !xmlContent) return [-1, -1];
  const { stripped, origPos } = stripXmlTags(xmlContent);
  const [normStart, normEnd] = fuzzyIndexOf(stripped, needle);
  if (normStart < 0) return [-1, -1];
  const origStart = origPos[normStart];
  const lastNormIdx = Math.min(normEnd - 1, origPos.length - 1);
  const origEnd = origPos[lastNormIdx] + 1;
  return [origStart, origEnd];
}

function buildHighlightedXml(xmlContent: string, changes: Change[], selectedId: string | null): string {
  const ranges: Array<{ start: number; end: number; type: ChangeType; selected: boolean }> = [];
  const colorStyle: Record<ChangeType, string> = {
    addition:     "background:rgba(22,163,74,0.18);border-radius:2px;outline:1.5px solid rgba(22,163,74,0.60);",
    removal:      "background:rgba(219,39,119,0.15);border-radius:2px;outline:1.5px solid rgba(219,39,119,0.55);",
    modification: "background:rgba(192,38,211,0.15);border-radius:2px;outline:1.5px solid rgba(192,38,211,0.55);",
    mismatch:     "background:rgba(124,58,237,0.18);border-radius:2px;outline:1.5px solid rgba(124,58,237,0.60);",
    emphasis:     "background:rgba(37,99,235,0.18);border-radius:2px;outline:1.5px solid rgba(37,99,235,0.60);",
  };
  const selectedExtra = "outline:2.5px solid rgba(245,158,11,0.95);box-shadow:0 0 0 3px rgba(245,158,11,0.15);";
  for (const change of changes) {
    if (change.dismissed) continue;
    const candidates = [change.old_text, change.new_text, change.text].filter(Boolean) as string[];
    let matched = false;
    for (const searchText of candidates) {
      if (!searchText || searchText.trim().length < 3) continue;
      let [start, end] = fuzzyIndexOf(xmlContent, searchText);
      if (start < 0) [start, end] = findTextInXml(xmlContent, searchText);
      if (start < 0) {
        const words = searchText.trim().split(/\s+/);
        if (words.length > 4) {
          const frag = words.slice(0, 8).join(" ");
          [start, end] = fuzzyIndexOf(xmlContent, frag);
          if (start < 0) [start, end] = findTextInXml(xmlContent, frag);
        }
      }
      if (start < 0) continue;
      ranges.push({ start, end, type: change.type, selected: change.id === selectedId });
      matched = true; break;
    }
    void matched;
  }
  ranges.sort((a, b) => a.start - b.start || (b.selected ? 1 : -1));
  let html = ""; let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue;
    html += escapeHtml(xmlContent.slice(pos, r.start));
    const style = colorStyle[r.type] + (r.selected ? selectedExtra : "");
    html += `<mark style="${style}">` + escapeHtml(xmlContent.slice(r.start, r.end)) + "</mark>";
    pos = r.end;
  }
  html += escapeHtml(xmlContent.slice(pos));
  return html;
}

// ── XML section slicer ────────────────────────────────────────────────────────

function _sliceXmlToHeading(xml: string, heading: string): string | null {
  if (!xml || !heading) return null;
  const h = heading.trim().toLowerCase();
  const terms = [h, h.toUpperCase(), heading.trim()];
  for (const term of terms) {
    const pat = new RegExp(`<innodLevel[^>]*last-path=["'][^"']*${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"']*["'][^>]*>`, "i");
    const m = pat.exec(xml);
    if (m) return _extractFromMatch(xml, m.index);
  }
  const headingPat = new RegExp(`<innodHeading[^>]*>[^<]*${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  const hm = headingPat.exec(xml);
  if (hm) { const before = xml.slice(0, hm.index); const lastOpen = before.lastIndexOf("<innodLevel"); if (lastOpen >= 0) return _extractFromMatch(xml, lastOpen); }
  for (const tag of ["part", "chapter", "section", "article"]) {
    const tagPat = new RegExp(`<${tag}[^>]*>`, "i");
    let tagM: RegExpExecArray | null; let searchFrom = 0;
    while ((tagM = tagPat.exec(xml.slice(searchFrom))) !== null) {
      const absIdx = searchFrom + tagM.index;
      const slice = xml.slice(absIdx, absIdx + 2000).toLowerCase();
      if (terms.some(t => slice.includes(t))) return _extractFromMatch(xml, absIdx);
      searchFrom = absIdx + 1;
    }
  }
  return null;
}

function _extractFromMatch(xml: string, startIdx: number): string {
  const MAX_SLICE = 500_000;
  const slice = xml.slice(startIdx, startIdx + MAX_SLICE);
  const lastClose = slice.lastIndexOf("</");
  const end = lastClose > 1000 ? lastClose + slice.slice(lastClose).indexOf(">") + 1 : slice.length;
  return slice.slice(0, end).trim();
}

// ── Text line classification ──────────────────────────────────────────────────

function classifyLine(text: string): "heading" | "subheading" | "bullet" | "numbered" | "blank" | "page-sep" | "paragraph-break" | "normal" {
  const t = text.trim();
  if (!t) return "blank";
  if (/^──\s*Page\s+\d+\s*──/.test(t)) return "page-sep";
  if (/^(PART|CHAPTER|SECTION|SCHEDULE|ANNEX|APPENDIX|ARTICLE)\s/i.test(t) && t.length < 120) return "heading";
  if (/^[A-Z][A-Z\s\d\-—:]{4,}$/.test(t) && t.length < 80) return "heading";
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(t) && t.length < 100) return "subheading";
  if (/^(\([a-z0-9ivxl]+\)|[a-z]\.|[0-9]+\.)\s/i.test(t)) return "numbered";
  if (/^[•·‣▸▹▷►–—\-]\s/.test(t) || /^\*\s/.test(t)) return "bullet";
  return "normal";
}

function tokensToHtmlLight(tokens: Array<{ op: "eq" | "del" | "ins"; text: string }>): string {
  return tokens.map(t => {
    const tx = escapeHtml(t.text);
    if (t.op === "del")
      return `<span style="background:rgba(219,39,119,0.13);color:#9d174d;text-decoration:line-through;text-decoration-color:#db2777;border-radius:2px;padding:0 2px;">${tx}</span>`;
    if (t.op === "ins")
      return `<span style="background:rgba(22,163,74,0.13);color:#166534;border-radius:2px;padding:0 2px;">${tx}</span>`;
    return `<span style="color:#1e293b;">${tx}</span>`;
  }).join("");
}

function normalise(s: string) { return s.replace(/\s+/g, " ").trim().toLowerCase(); }

function findLineRange(lines: string[], needle: string): [number, number] {
  if (!needle || !lines.length) return [-1, -1];
  const norm = normalise(needle);
  if (!norm || norm.length < 4) return [-1, -1];
  const lineStarts: number[] = [];
  let joined = "";
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(joined.length);
    joined += normalise(lines[i]) + " ";
  }
  let pos = joined.indexOf(norm);
  if (pos < 0 && norm.length > 60) pos = joined.indexOf(norm.slice(0, 60));
  if (pos < 0 && norm.length >= 20) {
    const anchor40 = norm.slice(0, 40);
    if (anchor40.trim().split(/\s+/).length >= 4) pos = joined.indexOf(anchor40);
  }
  if (pos < 0) {
    const words = norm.trim().split(/\s+/);
    if (words.length >= 3 && norm.length >= 15) {
      const short = norm.slice(0, 30);
      for (let i = 0; i < lines.length; i++) {
        if (normalise(lines[i]).includes(short)) {
          return [i, Math.min(i + needle.split("\n").length, lines.length)];
        }
      }
    }
    return [-1, -1];
  }
  let startLine = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i] <= pos) startLine = i; else break;
  }
  const needleLen = norm.length;
  let endLine = startLine + 1;
  while (endLine < lines.length && lineStarts[endLine] < pos + needleLen) endLine++;
  return [startLine, Math.min(endLine, lines.length)];
}

interface LineInfo {
  text: string;
  kind: "normal" | ChangeType;
  changeId: string | null;
  changeType: ChangeType | null;
  tokens: Array<{ op: "eq" | "del" | "ins"; text: string }> | null;
}

function buildAnnotatedLines(rawLines: string[], changes: Change[], side: "old" | "new"): LineInfo[] {
  const out: LineInfo[] = rawLines.map(text => ({ text, kind: "normal" as const, changeId: null, changeType: null, tokens: null }));
  for (const ch of changes) {
    if (ch.dismissed) continue;
    const needle = side === "old"
      ? (ch.old_text ?? (ch.type !== "addition" ? ch.text : null))
      : (ch.new_text ?? (ch.type !== "removal"  ? ch.text : null));
    if (!needle) continue;
    const needleTrimmed = needle.trim();
    if (needleTrimmed.length < 4) continue;
    if (/^[\d\s.,()[\]{}]+$/.test(needleTrimmed)) continue;
    const [start, end] = findLineRange(rawLines, needle);
    if (start < 0) continue;
    const matchedText = normalise(rawLines.slice(start, end).join(" "));
    const needleNorm  = normalise(needleTrimmed);
    const anchorLen   = Math.min(needleNorm.length, 40);
    const anchor      = needleNorm.slice(0, anchorLen);
    if (anchorLen >= 8 && !matchedText.includes(anchor)) continue;
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

// ── IDE Diff Pane ─────────────────────────────────────────────────────────────

interface DiffPaneProps {
  side: "old" | "new";
  label: string;
  lines: LineInfo[];
  selectedId: string | null;
  onLineClick: (changeId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

function IdeDiffPane({ side, label, lines, selectedId, onLineClick, scrollRef, onScroll }: DiffPaneProps) {
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
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden" style={{ borderRight: side === "old" ? "1px solid #e2e8f0" : "none" }}>
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-white">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-widest uppercase border ${side === "old" ? "bg-red-50 text-red-500 border-red-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}>
          {side === "old" ? "OLD" : "NEW"}
        </span>
        <span className="text-[11px] text-slate-400 truncate flex-1">{label}</span>
        <button onClick={copyText} className="text-[10px] px-2 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors flex-shrink-0">
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto bg-white"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent", fontSize: "13.5px", lineHeight: "1.75" }}>
        {lines.map((line, idx) => {
          const meta = line.changeType ? CM[line.changeType] : null;
          const isSelected = !!line.changeId && line.changeId === selectedId;
          const lineKind = classifyLine(line.text);
          if (lineKind === "blank") return <div key={idx} className="h-3" />;
          return (
            <div key={idx}
              ref={el => { if (line.changeId && el) rowRefs.current.set(line.changeId, el); }}
              onClick={() => line.changeId && onLineClick(line.changeId)}
              className={["flex min-w-0 transition-colors duration-75",
                lineKind === "page-sep" ? "opacity-30 pointer-events-none my-1" : "",
                line.changeId && lineKind !== "page-sep" ? "cursor-pointer group" : "",
                isSelected ? "ring-1 ring-inset ring-amber-400/60 bg-amber-50/60" : "",
                !isSelected && meta ? meta.lineBgLight : "",
                !isSelected && !meta && lineKind !== "page-sep" ? "hover:bg-slate-50/60" : "",
              ].join(" ")}
              style={meta && !isSelected ? { borderLeft: `3px solid ${meta.gutterColor}50` } : isSelected ? { borderLeft: "3px solid #f59e0b" } : { borderLeft: "3px solid transparent" }}>
              <div className={`flex-shrink-0 w-10 text-right pr-2 py-0.5 select-none text-[10px] font-mono mt-0.5 ${meta ? "" : "text-slate-200"}`}
                style={meta ? { color: meta.gutterColor + "80" } : {}}>
                {lineKind !== "page-sep" ? idx + 1 : ""}
              </div>
              <div className="flex-shrink-0 w-4 text-center py-0.5 text-[10px] font-bold select-none mt-0.5">
                {meta && <span style={{ color: meta.gutterColor }}>{CM[line.changeType!].icon}</span>}
              </div>
              <div className={["flex-1 min-w-0 pl-2 pr-6 py-0.5",
                lineKind === "heading" ? "font-bold text-slate-800 tracking-wide mt-3 mb-1" : "",
                lineKind === "subheading" ? "font-semibold text-slate-700 mt-2" : "",
                lineKind === "numbered" ? "pl-4 text-slate-700" : "",
                lineKind === "bullet" ? "pl-4 text-slate-700" : "",
                lineKind === "page-sep" ? "text-center" : "",
              ].join(" ")}>
                {lineKind === "page-sep" ? (
                  <span className="text-[10px] font-mono text-slate-300 tracking-widest select-none">{line.text}</span>
                ) : line.kind === "modification" && line.tokens && line.tokens.length > 0 ? (
                  <span dangerouslySetInnerHTML={{ __html: tokensToHtmlLight(line.tokens) }} />
                ) : meta ? (
                  <span className={meta.lineTextLight}>{line.text || "\u00a0"}</span>
                ) : (
                  <span className="text-slate-700 whitespace-pre-wrap">{line.text || "\u00a0"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PDF Page Highlights (SVG overlay) ────────────────────────────────────────

interface PageHighlightsProps {
  pageWidth: number;
  pageHeight: number;
  pdfWidth: number;
  pdfHeight: number;
  changes: Change[];
  pageNumber: number;
  side: "old" | "new";
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function PageHighlights({ pageWidth, pageHeight, pdfWidth, pdfHeight, changes, pageNumber, side, selectedId, onSelect }: PageHighlightsProps) {
  const scaleX = pageWidth  / pdfWidth;
  const scaleY = pageHeight / pdfHeight;
  const relevant = useMemo(() => changes.filter(c => {
    if (c.dismissed) return false;
    const pg = side === "old" ? (c.old_page ?? c.page) : (c.new_page ?? c.page);
    if (pg !== pageNumber) return false;
    const bbox = side === "old" ? (c.old_bbox ?? c.bbox) : (c.new_bbox ?? c.bbox);
    return !!bbox;
  }), [changes, pageNumber, side]);
  if (!relevant.length) return null;
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 10, overflow: "visible" }}>
      {relevant.map(c => {
        const bbox = (side === "old" ? (c.old_bbox ?? c.bbox) : (c.new_bbox ?? c.bbox))!;
        const [x0, y0, x1, y1] = bbox;
        const isSelected = c.id === selectedId;
        // PDF coords: origin bottom-left, y increases upward → flip for SVG
        const svgX = x0 * scaleX;
        const svgY = (pdfHeight - y1) * scaleY;
        const svgW = (x1 - x0) * scaleX;
        const svgH = Math.max((y1 - y0) * scaleY, 6);
        const fill   = isSelected ? "rgba(245,158,11,0.22)" : CM[c.type].pdfFill;
        const stroke = isSelected ? "#f59e0b" : CM[c.type].pdfStroke;
        return (
          <g key={c.id} style={{ pointerEvents: "all", cursor: "pointer" }} onClick={() => onSelect(c.id)}>
            <rect x={svgX} y={svgY} width={svgW} height={svgH}
              fill={fill} stroke={stroke} strokeWidth={isSelected ? 2 : 1.5} rx={2} ry={2} />
          </g>
        );
      })}
    </svg>
  );
}

// ── Single PDF Page ───────────────────────────────────────────────────────────

interface PdfPageItemProps {
  pageNumber: number;
  containerWidth: number;
  changes: Change[];
  side: "old" | "new";
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMounted: (pageNumber: number, el: HTMLDivElement | null) => void;
}

function PdfPageItem({ pageNumber, containerWidth, changes, side, selectedId, onSelect, onMounted }: PdfPageItemProps) {
  const [dims, setDims] = useState<{ pageWidth: number; pageHeight: number; pdfWidth: number; pdfHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { onMounted(pageNumber, wrapRef.current); }, [pageNumber, onMounted]);
  return (
    <div ref={wrapRef} data-page={pageNumber}
      style={{ position: "relative", marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.22)", background: "#fff", display: "inline-block", lineHeight: 0 }}>
      <Page
        pageNumber={pageNumber}
        width={containerWidth > 0 ? containerWidth - 2 : 600}
        renderTextLayer={true}
        renderAnnotationLayer={false}
        onRenderSuccess={(page) => {
          const vp = page.getViewport({ scale: 1 });
          const renderedW = containerWidth > 0 ? containerWidth - 2 : 600;
          const scale = renderedW / vp.width;
          setDims({ pageWidth: renderedW, pageHeight: vp.height * scale, pdfWidth: vp.width, pdfHeight: vp.height });
        }}
      />
      {dims && (
        <PageHighlights
          pageWidth={dims.pageWidth} pageHeight={dims.pageHeight}
          pdfWidth={dims.pdfWidth} pdfHeight={dims.pdfHeight}
          changes={changes} pageNumber={pageNumber}
          side={side} selectedId={selectedId} onSelect={onSelect}
        />
      )}
    </div>
  );
}

// ── PDF Viewer Pane (React-PDF, highlights, jump buttons) ─────────────────────

interface PdfViewerPaneProps {
  file: File | null;
  label: string;
  side: "old" | "new";
  changes: Change[];
  selectedId: string | null;
  onChangeSelect: (id: string) => void;
}

function PdfViewerPane({ file, label, side, changes, selectedId, onChangeSelect }: PdfViewerPaneProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [numPages, setNumPages]   = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef    = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!file) { setObjectUrl(null); setNumPages(0); return; }
    const url = URL.createObjectURL(file);
    setObjectUrl(url); setLoadError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(e.contentRect.width);
    });
    ro.observe(containerRef.current);
    setContainerW(containerRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Changes that have bbox coords, sorted by page
  const bboxChanges = useMemo(() => changes
    .filter(c => {
      if (c.dismissed) return false;
      const bbox = side === "old" ? (c.old_bbox ?? c.bbox) : (c.new_bbox ?? c.bbox);
      return !!bbox;
    })
    .sort((a, b) => {
      const pa = side === "old" ? (a.old_page ?? a.page) : (a.new_page ?? a.page);
      const pb = side === "old" ? (b.old_page ?? b.page) : (b.new_page ?? b.page);
      return pa - pb;
    }), [changes, side]);

  const jumpIndex = useMemo(() => {
    if (!selectedId) return 0;
    const idx = bboxChanges.findIndex(c => c.id === selectedId);
    return idx >= 0 ? idx : 0;
  }, [selectedId, bboxChanges]);

  // Auto-scroll to selected change's page
  useEffect(() => {
    if (!selectedId) return;
    const change = bboxChanges.find(c => c.id === selectedId);
    if (!change) return;
    const pg = side === "old" ? (change.old_page ?? change.page) : (change.new_page ?? change.page);
    pageEls.current.get(pg)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId, bboxChanges, side]);

  const handlePrev = useCallback(() => {
    if (!bboxChanges.length) return;
    const prev = (jumpIndex - 1 + bboxChanges.length) % bboxChanges.length;
    onChangeSelect(bboxChanges[prev].id);
  }, [jumpIndex, bboxChanges, onChangeSelect]);

  const handleNext = useCallback(() => {
    if (!bboxChanges.length) return;
    const next = (jumpIndex + 1) % bboxChanges.length;
    onChangeSelect(bboxChanges[next].id);
  }, [jumpIndex, bboxChanges, onChangeSelect]);

  const onMounted = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(pageNumber, el);
    else pageEls.current.delete(pageNumber);
  }, []);

  const sideAccent = side === "old" ? "#f43f5e" : "#16a34a";
  const sideLabel  = side === "old" ? "OLD" : "NEW";

  // Unique change types present for legend
  const typesPresent = useMemo(() => [...new Set(bboxChanges.map(c => c.type))], [bboxChanges]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
      style={{ borderRight: side === "old" ? "1px solid #1e293b" : "none" }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-slate-900"
        style={{ borderBottom: `1px solid ${sideAccent}40` }}>
        <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: sideAccent + "22", color: sideAccent, border: `1px solid ${sideAccent}44` }}>
          {sideLabel}
        </span>
        <span className="text-[11px] text-slate-400 truncate flex-1 font-mono">{file ? file.name : label}</span>
        {numPages > 0 && <span className="text-[10px] text-slate-500 flex-shrink-0">{numPages}p</span>}

        {/* Jump prev/next */}
        {bboxChanges.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={handlePrev} title="Previous change"
              className="w-6 h-6 rounded flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition-colors">
              ‹
            </button>
            <span className="text-[10px] text-slate-500 min-w-[42px] text-center tabular-nums">
              {jumpIndex + 1}/{bboxChanges.length}
            </span>
            <button onClick={handleNext} title="Next change"
              className="w-6 h-6 rounded flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition-colors">
              ›
            </button>
          </div>
        )}

        {/* Legend dots */}
        {typesPresent.length > 0 && (
          <div className="flex gap-1 flex-shrink-0">
            {typesPresent.map(t => (
              <span key={t} title={CM[t].label}
                style={{ width: 8, height: 8, borderRadius: 2, background: CM[t].pdfStroke, display: "inline-block", opacity: 0.85 }} />
            ))}
          </div>
        )}
      </div>

      {/* PDF Body */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-slate-800"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 transparent" }}>
        <div ref={containerRef} className="flex flex-col items-center py-4 px-3 min-h-full">
          {!file ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
              <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <p className="text-xs font-mono">No PDF loaded</p>
            </div>
          ) : loadError ? (
            <div className="text-red-400 text-xs p-6">Failed to load PDF: {loadError}</div>
          ) : (
            <Document
              file={objectUrl}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              onLoadError={err => setLoadError(err.message)}
              loading={<div className="text-slate-500 text-xs p-6 font-mono">Loading PDF…</div>}
            >
              {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNumber => (
                <PdfPageItem
                  key={pageNumber}
                  pageNumber={pageNumber}
                  containerWidth={containerW}
                  changes={changes}
                  side={side}
                  selectedId={selectedId}
                  onSelect={onChangeSelect}
                  onMounted={onMounted}
                />
              ))}
            </Document>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Split PDF Viewer ──────────────────────────────────────────────────────────

interface SplitPdfViewerProps {
  oldPdf: File | null;
  newPdf: File | null;
  oldLabel: string;
  newLabel: string;
  changes: Change[];
  selectedId: string | null;
  onChangeSelect: (id: string) => void;
}

function SplitPdfViewer({ oldPdf, newPdf, oldLabel, newLabel, changes, selectedId, onChangeSelect }: SplitPdfViewerProps) {
  return (
    <div className="flex flex-1 min-h-0 overflow-hidden" style={{ background: "#0f172a" }}>
      <PdfViewerPane file={oldPdf} label={oldLabel} side="old"
        changes={changes} selectedId={selectedId} onChangeSelect={onChangeSelect} />
      <PdfViewerPane file={newPdf} label={newLabel} side="new"
        changes={changes} selectedId={selectedId} onChangeSelect={onChangeSelect} />
    </div>
  );
}

// ── IDE Text Diff Viewer ──────────────────────────────────────────────────────

interface IdeTextDiffProps {
  changes: Change[];
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
  selectedId: string | null;
  onChangeSelect: (id: string) => void;
  loading?: boolean;
  oldPdf?: File | null;
  newPdf?: File | null;
}

function IdeTextDiff({ changes, oldText, newText, oldLabel, newLabel, selectedId, onChangeSelect, loading, oldPdf, newPdf }: IdeTextDiffProps) {
  const [syncScroll, setSyncScroll] = useState(true);
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");
  const [mainTab, setMainTab] = useState<"text" | "pdf">("text");
  const oldScrollRef = useRef<HTMLDivElement>(null);
  const newScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const oldLines = useMemo(() => (oldText || "").split("\n"), [oldText]);
  const newLines = useMemo(() => (newText || "").split("\n"), [newText]);
  const activeChanges = useMemo(() => changes.filter(c => !c.dismissed), [changes]);
  const oldAnnotated = useMemo(() => buildAnnotatedLines(oldLines, activeChanges, "old"), [oldLines, activeChanges]);
  const newAnnotated = useMemo(() => buildAnnotatedLines(newLines, activeChanges, "new"), [newLines, activeChanges]);

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
        <p className="text-xs text-slate-400">Upload files and run detection to see the diff</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center border-b border-slate-200 bg-white">
        {(["text", "pdf"] as const).map(tab => (
          <button key={tab} onClick={() => setMainTab(tab)}
            className={`px-5 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${mainTab === tab ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
            {tab === "pdf" ? "PDF" : "Text"}
          </button>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 ml-4 text-[11px] text-slate-400">
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span>Detecting…</span>
          </div>
        )}
        {mainTab === "text" && (
          <div className="flex items-center gap-1 ml-auto px-3">
            <button onClick={() => setSyncScroll(s => !s)}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${syncScroll ? "text-blue-500 bg-blue-50" : "text-slate-400 hover:text-slate-600"}`}
              title="Sync scroll">⇅ Sync</button>
            <div className="flex rounded overflow-hidden border border-slate-200 text-[11px]">
              {(["split", "unified"] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`px-2.5 py-1 capitalize transition-colors ${viewMode === m ? "bg-slate-700 text-white" : "bg-white text-slate-400 hover:text-slate-700"}`}>{m}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      {mainTab === "pdf" ? (
        <SplitPdfViewer
          oldPdf={oldPdf ?? null}
          newPdf={newPdf ?? null}
          oldLabel={oldLabel}
          newLabel={newLabel}
          changes={changes}
          selectedId={selectedId}
          onChangeSelect={onChangeSelect}
        />
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {viewMode === "split" ? (
              <>
                <IdeDiffPane side="old" label={oldLabel} lines={oldAnnotated} selectedId={selectedId}
                  onLineClick={onChangeSelect} scrollRef={oldScrollRef} onScroll={handleOldScroll} />
                <IdeDiffPane side="new" label={newLabel} lines={newAnnotated} selectedId={selectedId}
                  onLineClick={onChangeSelect} scrollRef={newScrollRef} onScroll={handleNewScroll} />
              </>
            ) : (
              <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-white">
                <div className="flex-1 overflow-auto bg-white"
                  style={{ scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent", fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontSize: "13px", lineHeight: "1.65" }}>
                  {unifiedLines.map(({ lineNo, side, info }, idx) => {
                    const meta = info.changeType ? CM[info.changeType] : null;
                    const isSelected = !!info.changeId && info.changeId === selectedId;
                    return (
                      <div key={idx} onClick={() => info.changeId && onChangeSelect(info.changeId)}
                        className={["flex min-w-0 transition-colors duration-75",
                          info.changeId ? "cursor-pointer" : "",
                          isSelected ? "bg-amber-50/70 ring-1 ring-inset ring-amber-400/50" : "",
                          !isSelected && meta ? meta.lineBgLight : "",
                          !isSelected && !meta ? "hover:bg-slate-50/60" : "",
                        ].join(" ")}
                        style={meta && !isSelected ? { borderLeft: `3px solid ${meta.gutterColor}50` } : isSelected ? { borderLeft: "3px solid #f59e0b" } : { borderLeft: "3px solid transparent" }}>
                        <div className="flex-shrink-0 w-8 text-center py-0.5 text-[9px] font-mono text-slate-400 select-none">
                          {side !== "ctx" && <span style={{ color: side === "old" ? "#db2777" : "#16a34a" }}>{side}</span>}
                        </div>
                        <div className="flex-shrink-0 w-12 text-right pr-3 py-0.5 text-[11px] font-mono select-none" style={meta ? { color: meta.gutterColor + "80" } : { color: "#cbd5e1" }}>{lineNo}</div>
                        <div className="flex-shrink-0 w-5 text-center py-0.5 font-bold select-none" style={{ color: meta?.gutterColor ?? "transparent", fontSize: "11px" }}>
                          {info.kind !== "normal" && meta ? CM[info.changeType!].icon : ""}
                        </div>
                        <div className="flex-1 min-w-0 pl-1 pr-4 py-0.5 whitespace-pre-wrap break-words">
                          {info.kind === "modification" && info.tokens && info.tokens.length > 0 ? (
                            <span dangerouslySetInnerHTML={{ __html: tokensToHtmlLight(info.tokens) }} />
                          ) : meta ? (
                            <span className={meta.lineTextLight}>{info.text || "\u00a0"}</span>
                          ) : (
                            <span className={/^──/.test(info.text) ? "text-[10px] font-mono text-slate-300 tracking-widest select-none" : "text-slate-600"}>{info.text || "\u00a0"}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* Footer legend */}
          <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-t border-slate-100 bg-white">
            {(["addition", "removal", "modification"] as ChangeType[]).map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: CM[type].gutterColor, opacity: 0.7 }} />
                <span className="text-[10px]" style={{ color: CM[type].gutterColor }}>{CM[type].label}</span>
              </div>
            ))}
            <span className="text-[10px] text-slate-300 ml-auto">{changes.filter(c => !c.dismissed).length} changes</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── XML Editor ────────────────────────────────────────────────────────────────

function XmlEditor({
  content, onChange, canEdit, highlightText, editorRef, changes, selectedId,
}: {
  content: string; onChange?: (v: string) => void; canEdit: boolean;
  highlightText?: string | null; editorRef?: React.RefObject<HTMLTextAreaElement | null>;
  changes: Change[]; selectedId: string | null;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = (editorRef ?? localRef) as React.RefObject<HTMLTextAreaElement>;
  const highlightedHtml = useMemo(() => { if (!content) return ""; return buildHighlightedXml(content, changes, selectedId); }, [content, changes, selectedId]);
  const syncScroll = useCallback(() => {
    if (ref.current && preRef.current) { preRef.current.scrollTop = ref.current.scrollTop; preRef.current.scrollLeft = ref.current.scrollLeft; }
  }, [ref]);
  const sharedStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontSize: "12px", lineHeight: "1.65",
    padding: "12px 16px", margin: 0, border: 0, whiteSpace: "pre-wrap", wordWrap: "break-word", overflowWrap: "break-word", tabSize: 2,
  };
  return (
    <div className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
      <pre ref={preRef} aria-hidden="true"
        style={{ ...sharedStyle, position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", userSelect: "none", color: "transparent", background: "transparent", zIndex: 0 }}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      <textarea ref={ref} value={content}
        onChange={canEdit ? (e) => { onChange?.(e.target.value); setTimeout(syncScroll, 0); } : undefined}
        onScroll={syncScroll} readOnly={!canEdit} spellCheck={false}
        style={{ ...sharedStyle, position: "absolute", inset: 0, width: "100%", height: "100%", resize: "none", background: "transparent", outline: "none", zIndex: 1, color: "rgba(15,23,42,0.9)", caretColor: "#0f172a", overflowY: "auto", overflowX: "auto" }}
        className={`${canEdit ? "cursor-text" : "cursor-default"} selection:bg-amber-400/30 text-slate-900`} />
    </div>
  );
}

// ── File Slot ─────────────────────────────────────────────────────────────────

function FileSlot({ label, accept, file, onFile, color }: {
  label: string; accept: string; file: File | null; onFile: (f: File | null) => void; color: "violet" | "blue" | "emerald";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const colorMap = {
    violet:  "border-violet-300 text-violet-600 bg-violet-50 hover:border-violet-400",
    blue:    "border-blue-300 text-blue-600 bg-blue-50 hover:border-blue-400",
    emerald: "border-emerald-300 text-emerald-600 bg-emerald-50 hover:border-emerald-400",
  };
  return (
    <div onClick={() => inputRef.current?.click()}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${colorMap[color]}`}>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      <span className="text-[11px] text-slate-600 truncate max-w-[140px]">
        {file ? file.name : <span className="text-slate-400 italic">no file</span>}
      </span>
      {file && (
        <>
          <span className="text-[10px] text-slate-400">{fmtBytes(file.size)}</span>
          <button onClick={(e) => { e.stopPropagation(); onFile(null); }} className="text-slate-400 hover:text-red-500 text-[11px]">✕</button>
        </>
      )}
    </div>
  );
}

// ── Validation Modal ──────────────────────────────────────────────────────────

function ValidationModal({ result, onClose, onConfirmSave }: { result: ValidationResult; onClose: () => void; onConfirmSave: () => void; }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {result.valid
              ? <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center"><svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg></div>
              : <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center"><svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
            }
            <h2 className="text-sm font-bold text-slate-900">{result.valid ? "XML Valid — Ready to Save" : "XML Validation Failed"}</h2>
          </div>
        </div>
        <div className="px-6 py-4 space-y-3">
          {result.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="text-red-500 mt-0.5">✕</span>{err}
            </div>
          ))}
          {result.warnings.map((warn, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="text-amber-500 mt-0.5">⚠</span>{warn}
            </div>
          ))}
          {result.valid && result.warnings.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-2">XML structure is valid and ready to save.</p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">Cancel</button>
          {result.valid && <button onClick={onConfirmSave} className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500">Download XML</button>}
        </div>
      </div>
    </div>
  );
}

// ── Main ComparePanel ─────────────────────────────────────────────────────────

export default function ComparePanel({
  initialChunk, initialSourceName, initialOldPdf, initialNewPdf, initialXmlFile,
  allChunks = [], onChunkDone, onNavigateToChunk, activeJob,
}: ComparePanelProps) {
  const { user } = useAuth();
  const canEdit = user?.role === "SUPER_ADMIN";

  const [oldPdf, setOldPdf] = useState<File | null>(initialOldPdf ?? null);
  const [newPdf, setNewPdf] = useState<File | null>(initialNewPdf ?? null);
  const [xmlFile, setXmlFile] = useState<File | null>(initialXmlFile ?? null);
  const oldPdfRef = useRef<File | null>(initialOldPdf ?? null);
  const newPdfRef = useRef<File | null>(initialNewPdf ?? null);

  useEffect(() => { if (initialOldPdf) { setOldPdf(initialOldPdf); oldPdfRef.current = initialOldPdf; } }, [initialOldPdf]);
  useEffect(() => { if (initialNewPdf) { setNewPdf(initialNewPdf); newPdfRef.current = initialNewPdf; } }, [initialNewPdf]);
  useEffect(() => {
    if (initialXmlFile) { setXmlFile(initialXmlFile); initialXmlFile.text().then(t => setXmlContent(t)).catch(() => {}); }
  }, [initialXmlFile]);

  const [changes, setChanges]       = useState<Change[]>([]);
  const [xmlContent, setXmlContent] = useState("");
  const [summary, setSummary]       = useState<DetectSummary | null>(null);
  const [baseline, setBaseline]     = useState<"xml" | "old_pdf">("old_pdf");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ChangeType | "all">("all");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [oldFullText, setOldFullText] = useState(initialChunk?.old_text ?? "");
  const [newFullText, setNewFullText] = useState(initialChunk?.new_text ?? "");
  const [xmlPreviewMode, setXmlPreviewMode] = useState<"edit" | "preview">("edit");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showValModal, setShowValModal] = useState(false);
  const [doneChunks, setDoneChunks] = useState<Set<number>>(new Set());
  const [visibleChanges, setVisibleChanges] = useState(50);
  const [chunkDropdownOpen, setChunkDropdownOpen] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const isDraggingSidebar = useRef(false);
  const containerRef    = useRef<HTMLDivElement>(null);
  const changesListRef  = useRef<HTMLDivElement>(null);
  const editorRef       = useRef<HTMLTextAreaElement | null>(null);

  const onSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSidebar.current = true;
    const startX = e.clientX; const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => { if (!isDraggingSidebar.current) return; setSidebarWidth(Math.max(180, Math.min(480, startW + ev.clientX - startX))); };
    const onUp = () => { isDraggingSidebar.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const chunkPageStart    = initialChunk?.old_page_start ?? initialChunk?.page_start;
  const chunkPageEnd      = initialChunk?.old_page_end   ?? initialChunk?.page_end;

  const chunkHasXml = !!(initialChunk?.xml_content || initialChunk?.xml_chunk_file);
  const hasXml      = !!xmlFile || chunkHasXml;
  const isChunkMode = !!initialChunk;
  const isReady     = !!oldPdf && !!newPdf;

  useEffect(() => {
    if (!initialChunk) return;
    setChanges([]); setSummary(null); setError(null);
    setSelectedId(null); setValidation(null); setLoading(false); setVisibleChanges(50);
    if (initialChunk.old_text) setOldFullText(initialChunk.old_text);
    if (initialChunk.new_text) setNewFullText(initialChunk.new_text);
    const chunkXml = initialChunk.xml_chunk_file || initialChunk.xml_content || "";
    if (chunkXml) {
      setXmlContent(chunkXml);
    } else {
      const heading = initialChunk.old_heading || initialChunk.new_heading || "";
      if (heading && xmlContent && xmlContent.length > 0) {
        const sliced = _sliceXmlToHeading(xmlContent, heading);
        if (sliced) setXmlContent(sliced);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChunk?.index]);

  const activeJobRef = useRef(activeJob);
  useEffect(() => { activeJobRef.current = activeJob; }, [activeJob]);

  const runChunkDetect = useCallback(async (
    chunk: NonNullable<typeof initialChunk>,
    isCancelled: () => boolean,
  ) => {
    setLoading(true);
    const _norm = (s: string) =>
      s.replace(/\s+/g, " ").trim().toLowerCase()
       .replace(/[\u2018\u2019\u201c\u201d'"]/g, "'")
       .replace(/[\u2013\u2014\u2012\u2015\u2212]/g, "-")
       .replace(/\ufb00/g, "ff").replace(/\ufb01/g, "fi").replace(/\ufb02/g, "fl")
       .replace(/\u00ad/g, "").replace(/\u00a0/g, " ").replace(/\u2026/g, "...");
    const _stripPunct = (s: string) => s.replace(/^[\s\W]+|[\s\W]+$/g, "");

    const denoiseChanges = (raw: Change[]): Change[] => {
      let out = raw.filter(c => {
        if (c.type === "emphasis") return true;
        const ot = _norm(c.old_text || c.text || "");
        const nt = _norm(c.new_text || c.text || "");
        if (ot && nt && ot === nt) return false;
        if (ot && nt && _stripPunct(ot) === _stripPunct(nt)) return false;
        const rawText = (c.text || c.new_text || c.old_text || "").trim();
        if (rawText.length < 4) return false;
        if (/^──\s*page\s+\d+\s*──/i.test(rawText)) return false;
        if (c.type === "modification" && c.word_diff) {
          const wc = (c.word_diff.summary.addition ?? 0) + (c.word_diff.summary.removal ?? 0) + (c.word_diff.summary.modification ?? 0);
          const ratio = c.word_diff.change_ratio ?? 1;
          if (wc < 1 && ratio < 0.01) return false;
          if (wc === 0 && ratio < 0.02) return false;
        }
        return true;
      });
      if (out.length > 80) {
        const strict = out.filter(c => {
          if (c.type === "addition" || c.type === "removal" || c.type === "emphasis") return true;
          const ratio = c.word_diff?.change_ratio ?? 1;
          const wordChanges = (c.word_diff?.summary.addition ?? 0) + (c.word_diff?.summary.removal ?? 0) + (c.word_diff?.summary.modification ?? 0);
          return ratio > 0.05 || wordChanges >= 3;
        });
        if (strict.length >= out.length * 0.3) out = strict;
      }
      return out;
    };

    const applyResult = (data: Record<string, any>) => {
      if (isCancelled()) return;
      const filtered = denoiseChanges(data.changes || []);
      setChanges(filtered);
      const s: DetectSummary = { addition: 0, removal: 0, modification: 0, emphasis: 0, mismatch: 0 };
      filtered.forEach((c: Change) => { if (c.type in s) (s as any)[c.type]++; });
      setSummary(s);
      if (data.baseline) setBaseline(data.baseline === "xml" ? "xml" : "old_pdf");
      setOldFullText(data.old_full_text || chunk.old_text || "");
      setNewFullText(data.new_full_text || chunk.new_text || "");
      if (data.xml_content) setXmlContent(data.xml_content);
    };

    try {
      const jobId = activeJobRef.current?.job_id;
      if (jobId) {
        try {
          const res = await fetch(`${PROCESSING_URL}/compare/detect-chunk`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: jobId, chunk_index: chunk.index }),
          });
          if (!isCancelled() && res.ok) { applyResult(await res.json()); return; }
          if (!isCancelled()) console.warn(`detect-chunk HTTP ${res.status} — falling back`);
        } catch (err) {
          if (!isCancelled()) console.warn("detect-chunk error, falling back:", err);
        }
      }
      const pdfOld = oldPdfRef.current || initialOldPdf;
      const pdfNew = newPdfRef.current || initialNewPdf;
      if (!pdfOld || !pdfNew) { if (!isCancelled()) setError("PDF files unavailable — please re-upload."); return; }
      const form = new FormData();
      form.append("old_pdf", pdfOld); form.append("new_pdf", pdfNew);
      const chunkXml = chunk.xml_chunk_file || chunk.xml_content;
      if (chunkXml) form.append("xml_file", new Blob([chunkXml], { type: "application/xml" }), chunk.filename);
      if (chunk.old_page_start != null) form.append("old_page_start", String(chunk.old_page_start));
      if (chunk.old_page_end   != null) form.append("old_page_end",   String(chunk.old_page_end));
      if (chunk.new_page_start != null) form.append("new_page_start", String(chunk.new_page_start));
      if (chunk.new_page_end   != null) form.append("new_page_end",   String(chunk.new_page_end));
      if (chunk.old_anchor)             form.append("old_anchor_text", chunk.old_anchor);
      if (chunk.new_anchor)             form.append("new_anchor_text", chunk.new_anchor);
      const res2 = await fetch(`${PROCESSING_URL}/compare/detect`, { method: "POST", body: form });
      if (isCancelled()) return;
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      applyResult(await res2.json());
    } catch (e) {
      if (!isCancelled()) setError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOldPdf, initialNewPdf]);

  useEffect(() => {
    if (!initialChunk) return;
    let _done = false;
    runChunkDetect(initialChunk, () => _done);
    return () => { _done = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChunk?.index, runChunkDetect]);

  const handleDetect = useCallback(async () => {
    if (!isReady) return;
    setLoading(true); setError(null); setChanges([]); setSummary(null); setSelectedId(null); setValidation(null);
    try {
      const form = new FormData();
      form.append("old_pdf", oldPdf!); form.append("new_pdf", newPdf!);
      if (xmlFile) form.append("xml_file", xmlFile);
      else if (initialChunk) {
        const xmlC = initialChunk.xml_chunk_file || initialChunk.xml_content;
        if (xmlC) form.append("xml_file", new Blob([xmlC], { type: "application/xml" }), initialChunk.filename);
      }
      if (chunkPageStart != null) form.append("page_start", String(chunkPageStart));
      if (chunkPageEnd   != null) form.append("page_end",   String(chunkPageEnd));
      const res = await fetch(`${PROCESSING_URL}/compare/detect`, { method: "POST", body: form });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        const detail = Array.isArray(e.detail) ? e.detail.map((d: any) => d.msg ?? JSON.stringify(d)).join("; ") : e.detail;
        throw new Error(detail ?? `HTTP ${res.status}`);
      }
      const data: DetectResponse = await res.json();
      setChanges(data.changes); setBaseline(data.baseline === "xml" ? "xml" : "old_pdf");
      if (data.xml_content) setXmlContent(data.xml_content);
      else if (xmlFile && !xmlContent) xmlFile.text().then(t => setXmlContent(t)).catch(() => {});
      setSummary(data.summary);
      if (data.old_full_text) setOldFullText(data.old_full_text);
      if (data.new_full_text) setNewFullText(data.new_full_text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally { setLoading(false); }
  }, [isReady, oldPdf, newPdf, xmlFile, initialChunk, chunkPageStart, chunkPageEnd, hasXml]);

  const handleSelect = useCallback((change: Change) => {
    setSelectedId(change.id);
    const searchText = change.old_text || change.text || change.new_text;
    if (!searchText || !editorRef.current || !xmlContent) return;
    const el = editorRef.current;
    let [idx, idxEnd] = fuzzyIndexOf(xmlContent, searchText);
    if (idx < 0) [idx, idxEnd] = findTextInXml(xmlContent, searchText);
    if (idx < 0) return;
    el.focus(); el.setSelectionRange(idx, idxEnd);
    const linesBefore = xmlContent.substring(0, idx).split("\n").length;
    const style = window.getComputedStyle(el);
    const lineHeightPx = parseFloat(style.lineHeight) || 19;
    el.scrollTop = Math.max(0, (linesBefore - 4) * lineHeightPx);
  }, [xmlContent]);

  const handleApply = useCallback((change: Change, mode: "textual" | "replace" | "emphasis") => {
    if (!canEdit) return;
    let xml = xmlContent;
    if (mode === "emphasis") {
      const t = change.new_text || change.text;
      if (t && change.new_formatting) {
        const { bold, italic, underline, strikethrough, is_colored } = change.new_formatting;
        let repl = t;
        if (strikethrough) repl = `<s>${repl}</s>`; if (underline) repl = `<u>${repl}</u>`;
        if (italic) repl = `<i>${repl}</i>`; if (bold) repl = `<b>${repl}</b>`;
        if (is_colored && !bold && !italic && !underline && !strikethrough) repl = `<em>${repl}</em>`;
        xml = fuzzyReplace(xml, t, repl);
      }
    } else if (change.suggested_xml) {
      const searchText = change.old_text || change.text;
      if (searchText) xml = fuzzyReplace(xml, searchText, change.suggested_xml);
    } else {
      switch (change.type) {
        case "modification": case "mismatch":
          if (change.old_text && change.new_text) xml = fuzzyReplace(xml, change.old_text, `<del>${change.old_text}</del><ins>${change.new_text}</ins>`); break;
        case "removal":
          if (change.old_text) xml = fuzzyReplace(xml, change.old_text, `<del>${change.old_text}</del>`); break;
        case "addition":
          if (change.new_text) {
            const insTag = `<ins>${change.new_text}</ins>`;
            if (xml.includes("</")) { const pos = xml.lastIndexOf("</"); xml = `${xml.slice(0, pos)}${insTag}\n${xml.slice(pos)}`; }
            else xml += `\n${insTag}`;
          } break;
      }
    }
    setXmlContent(xml);
    setChanges(prev => prev.map(c => c.id === change.id ? { ...c, applied: true } : c));
  }, [canEdit, xmlContent]);

  const handleApplyAll = useCallback(() => {
    if (!canEdit || !xmlContent) return;
    let xml = xmlContent; const appliedIds: string[] = [];
    for (const change of changes) {
      if (change.applied || change.dismissed) continue;
      if (change.type === "emphasis") {
        const t = change.new_text || change.text;
        if (t && change.new_formatting) {
          const { bold, italic, underline, strikethrough, is_colored } = change.new_formatting;
          let repl = t;
          if (strikethrough) repl = `<s>${repl}</s>`; if (underline) repl = `<u>${repl}</u>`;
          if (italic) repl = `<i>${repl}</i>`; if (bold) repl = `<b>${repl}</b>`;
          if (is_colored && !bold && !italic && !underline && !strikethrough) repl = `<em>${repl}</em>`;
          xml = fuzzyReplace(xml, t, repl);
        }
      } else if (change.suggested_xml) {
        const searchText = change.old_text || change.text;
        if (searchText) xml = fuzzyReplace(xml, searchText, change.suggested_xml);
      } else {
        switch (change.type) {
          case "modification": case "mismatch":
            if (change.old_text && change.new_text) xml = fuzzyReplace(xml, change.old_text, `<del>${change.old_text}</del><ins>${change.new_text}</ins>`); break;
          case "removal":
            if (change.old_text) xml = fuzzyReplace(xml, change.old_text, `<del>${change.old_text}</del>`); break;
          case "addition":
            if (change.new_text) {
              const insTag = `<ins>${change.new_text}</ins>`;
              if (xml.includes("</")) { const pos = xml.lastIndexOf("</"); xml = `${xml.slice(0, pos)}${insTag}\n${xml.slice(pos)}`; }
              else xml += `\n${insTag}`;
            } break;
        }
      }
      appliedIds.push(change.id);
    }
    setXmlContent(xml);
    setChanges(prev => prev.map(c => appliedIds.includes(c.id) ? { ...c, applied: true } : c));
  }, [canEdit, xmlContent, changes]);

  const handleDismiss  = useCallback((change: Change) => { setChanges(prev => prev.map(c => c.id === change.id ? { ...c, dismissed: true } : c)); }, []);
  const handleMarkDone = useCallback((chunk: PdfChunk) => { setDoneChunks(prev => new Set([...prev, chunk.index])); onChunkDone?.(chunk); }, [onChunkDone]);

  const handleValidateAndSave = useCallback(async () => {
    if (!xmlContent || !canEdit) return;
    setValidating(true);
    try {
      const res = await fetch(`${PROCESSING_URL}/compare/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml_content: xmlContent }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json(); setValidation(data); setShowValModal(true);
    } catch {
      const h = xmlContent.includes("<") && xmlContent.includes(">");
      setValidation({ valid: h, errors: h ? [] : ["Content does not appear to be valid XML"], warnings: [] });
      setShowValModal(true);
    } finally { setValidating(false); }
  }, [xmlContent, canEdit]);

  function handleConfirmSave() {
    setShowValModal(false);
    const filename = xmlFile?.name ?? initialChunk?.filename ?? "output.xml";
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  }

  function handleDownload() {
    const filename = xmlFile?.name ?? initialChunk?.filename ?? "output.xml";
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    let base = changes.filter(c => !c.dismissed);
    if (filterType !== "all") base = base.filter(c => c.type === filterType);
    return base;
  }, [changes, filterType]);

  const selectedChange   = useMemo(() => changes.find(c => c.id === selectedId) ?? null, [changes, selectedId]);
  const highlightText    = selectedChange ? (selectedChange.old_text || selectedChange.text || selectedChange.new_text) : null;

  useEffect(() => {
    if (!chunkDropdownOpen) return;
    const close = (e: MouseEvent) => {
      const dropdown = document.querySelector("[data-chunk-dropdown]");
      if (dropdown && dropdown.contains(e.target as Node)) return;
      setChunkDropdownOpen(false);
    };
    document.addEventListener("click", close, true);
    return () => document.removeEventListener("click", close, true);
  }, [chunkDropdownOpen]);

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden bg-white text-slate-900">

      {/* TOP TOOLBAR */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
          {!isChunkMode && (
            <>
              <FileSlot label="OLD PDF" accept=".pdf" file={oldPdf} onFile={f => { setOldPdf(f); if (f) oldPdfRef.current = f; }} color="violet" />
              <FileSlot label="NEW PDF" accept=".pdf" file={newPdf} onFile={f => { setNewPdf(f); if (f) newPdfRef.current = f; }} color="blue" />
              <FileSlot label="XML" accept=".xml" file={xmlFile} onFile={setXmlFile} color="emerald" />
            </>
          )}

          {isChunkMode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Chunk:</span>
              {allChunks.length > 0 ? (
                <div className="relative" data-chunk-dropdown onClick={e => e.stopPropagation()}>
                  <button onClick={() => setChunkDropdownOpen(v => !v)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors min-w-[180px] max-w-[280px]">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${initialChunk?.has_changes ? "bg-amber-400" : "bg-slate-300"}`} />
                    <span className="truncate flex-1 text-left">{initialChunk?.old_heading || initialChunk?.new_heading || `Chunk ${initialChunk?.index}`}</span>
                    {doneChunks.has(initialChunk?.index ?? -1) && <span className="text-emerald-600 text-[10px] font-bold">✓</span>}
                    <svg className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${chunkDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>
                  {chunkDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                      <div className="px-3 py-2 border-b border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{doneChunks.size}/{allChunks.filter(c => c.has_changes).length} done</span>
                      </div>
                      {allChunks.map(chunk => {
                        const isActive = initialChunk?.index === chunk.index;
                        const isDone = doneChunks.has(chunk.index);
                        const heading = chunk.old_heading || chunk.new_heading || `Chunk ${chunk.index}`;
                        return (
                          <div key={chunk.index}
                            onClick={e => { e.stopPropagation(); if (!isActive) { onNavigateToChunk?.(chunk); setChunkDropdownOpen(false); } }}
                            className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-slate-50 transition-colors select-none ${isActive ? "bg-blue-50 border-l-2 border-l-blue-500 cursor-default" : "cursor-pointer hover:bg-slate-50 active:bg-slate-100"} ${!chunk.has_changes ? "opacity-50" : ""}`}>
                            <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center border-2 text-[9px] ${isDone ? "bg-emerald-500 border-emerald-500 text-white" : chunk.has_changes ? "border-amber-400 bg-amber-50 text-amber-600" : "border-slate-200 bg-white"}`}>
                              {isDone ? "✓" : chunk.has_changes ? "!" : ""}
                            </div>
                            <span className="text-xs text-slate-700 truncate flex-1">{heading}</span>
                            {chunk.has_changes && !isDone && (
                              <span className="text-[10px] text-amber-600 font-semibold flex-shrink-0">
                                {((): React.ReactNode => { const cs = chunk.change_summary as any; return cs ? (Object.values(cs) as number[]).reduce((a, b) => a + b, 0) : "?"; })()}Δ
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs font-mono text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg">{initialChunk?.filename}</span>
              )}
              {changes.length > 0 && (
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border ${baseline === "xml" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-violet-50 text-violet-600 border-violet-200"}`}
                  title={baseline === "xml" ? "XML baseline → New PDF" : "Old PDF → New PDF"}>
                  {baseline === "xml" ? "XML→NEW" : "OLD→NEW"}
                </span>
              )}
            </div>
          )}

          <div className="w-px h-6 bg-slate-200 mx-1 flex-shrink-0" />

          {!isChunkMode && (
            <button onClick={handleDetect} disabled={!isReady || loading}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${isReady && !loading ? "bg-blue-600 hover:bg-blue-500 text-white shadow-sm" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}>
              {loading ? (
                <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Detecting…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>Detect Changes</>
              )}
            </button>
          )}

          {isChunkMode && (
            <button onClick={() => { if (!initialChunk) return; setChanges([]); setSummary(null); setError(null); setSelectedId(null); let _done = false; runChunkDetect(initialChunk, () => _done); }}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition-colors disabled:opacity-40">
              {loading
                ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>}
              {loading ? "Detecting…" : "Re-detect"}
            </button>
          )}

          {summary && (
            <div className="flex items-center gap-1">
              <button onClick={() => setFilterType("all")}
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all border ${filterType === "all" ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"}`}>All</button>
              {CHANGE_ORDER.map(key => summary[key] > 0 ? (
                <button key={key} onClick={() => setFilterType(filterType === key ? "all" : key)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-all ${filterType === key ? `${CM[key].bg} ${CM[key].text} ${CM[key].border}` : `${CM[key].pill} border opacity-70 hover:opacity-100`}`}>
                  {CM[key].icon} {summary[key]}
                </button>
              ) : null)}
            </div>
          )}

          {canEdit && changes.length > 0 && changes.some(c => !c.applied && !c.dismissed) && (
            <button onClick={handleApplyAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-700 text-xs font-semibold transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              Apply All ({changes.filter(c => !c.applied && !c.dismissed).length})
            </button>
          )}

          {isChunkMode && initialChunk && !doneChunks.has(initialChunk.index) && (
            <button onClick={() => handleMarkDone(initialChunk)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
              Mark Done
            </button>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {canEdit && hasXml && (
              <button onClick={handleValidateAndSave} disabled={validating || !xmlContent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                {validating ? "Validating…" : "Save XML"}
              </button>
            )}
            {hasXml && (
              <button onClick={handleDownload} disabled={!xmlContent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium transition-colors disabled:opacity-50">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                Download
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex-shrink-0 mx-3 mt-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p className="text-xs text-red-700 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
        </div>
      )}

      {/* MAIN AREA */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* LEFT SIDEBAR */}
        <div style={{ width: sidebarWidth, minWidth: 180, maxWidth: 480 }} className="flex-shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-hidden">
          <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-600">
              Changes {filtered.length > 0 && <span className="text-slate-400 font-normal">({filtered.length})</span>}
            </span>
            {loading && <svg className="w-3.5 h-3.5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
          </div>

          <div ref={changesListRef} className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <svg className="w-5 h-5 animate-spin text-blue-300" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                <p className="text-xs text-slate-400">Detecting changes…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center px-4 gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                </div>
                <p className="text-xs text-slate-400">{changes.length === 0 ? "No changes detected" : `No ${filterType} changes`}</p>
                {changes.length === 0 && !isChunkMode && <p className="text-[10px] text-slate-300">Upload files and click Detect</p>}
              </div>
            ) : (
              <>
                {filtered.slice(0, visibleChanges).map(change => {
                  const isSelected = selectedId === change.id;
                  const meta = CM[change.type];
                  const isDone = change.applied || change.dismissed;
                  const preview = (change.old_text ?? change.new_text ?? change.text ?? "").slice(0, 70).replace(/\s+/g, " ").trim();
                  return (
                    <div key={change.id} data-change-id={change.id} onClick={() => handleSelect(change)}
                      className={`border-b border-slate-100 transition-colors cursor-pointer ${isSelected ? "bg-amber-50" : change.dismissed ? "opacity-40" : "hover:bg-slate-50"}`}
                      style={{ borderLeft: `3px solid ${isSelected ? "#f59e0b" : meta.gutterColor + "50"}` }}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-[11px] font-bold flex-shrink-0" style={{ color: meta.gutterColor }}>{meta.icon}</span>
                        <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: meta.gutterColor }}>{meta.label}</span>
                        {(change.old_page || change.new_page || change.page) > 0 && (
                          <span className="text-[9px] text-slate-400 font-mono flex-shrink-0">p{change.old_page ?? change.new_page ?? change.page}</span>
                        )}
                        {isDone && (
                          <span className={`text-[9px] font-bold ml-auto ${change.applied ? "text-emerald-600" : "text-slate-400"}`}>
                            {change.applied ? "✓ applied" : "✗ dismissed"}
                          </span>
                        )}
                        {!isDone && canEdit && (
                          <div className="ml-auto flex items-center gap-1">
                            {(change.suggested_xml || change.type === "modification" || change.type === "addition" || change.type === "mismatch" || change.type === "removal" || change.type === "emphasis") && (
                              <button onClick={e => { e.stopPropagation(); handleApply(change, change.type === "emphasis" ? "emphasis" : "textual"); }}
                                title="Apply this change to XML"
                                className="w-6 h-6 rounded flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[11px] font-bold transition-colors">✓</button>
                            )}
                            <button onClick={e => { e.stopPropagation(); handleDismiss(change); }} title="Dismiss"
                              className="w-6 h-6 rounded flex items-center justify-center bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 text-[11px] font-bold transition-colors">✕</button>
                          </div>
                        )}
                      </div>
                      <div className="px-3 pb-2">
                        {change.type === "modification" && change.old_text && change.new_text ? (
                          <div className="space-y-0.5">
                            <div className="text-[10px] bg-red-50 border border-red-100 rounded px-1.5 py-0.5 text-red-700 line-through truncate">{change.old_text.slice(0, 60)}</div>
                            <div className="text-[10px] bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5 text-emerald-700 truncate">{change.new_text.slice(0, 60)}</div>
                          </div>
                        ) : (
                          <p className="text-[10px] text-slate-500 truncate leading-snug">{preview || "—"}</p>
                        )}
                        {change.word_diff?.summary && (
                          <div className="flex gap-2 mt-0.5">
                            {change.word_diff.summary.addition    > 0 && <span className="text-[9px] text-emerald-600">+{change.word_diff.summary.addition}w</span>}
                            {change.word_diff.summary.removal     > 0 && <span className="text-[9px] text-red-500">−{change.word_diff.summary.removal}w</span>}
                            {change.word_diff.summary.modification > 0 && <span className="text-[9px] text-amber-600">~{change.word_diff.summary.modification}w</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filtered.length > visibleChanges && (
                  <button onClick={() => setVisibleChanges(v => v + 50)}
                    className="w-full text-[10px] py-2.5 text-slate-400 hover:text-slate-600 border-b border-dashed border-slate-200 transition-colors">
                    Show {Math.min(50, filtered.length - visibleChanges)} more ({filtered.length - visibleChanges} remaining)
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* DRAG HANDLE */}
        <div onMouseDown={onSidebarMouseDown} className="w-1 flex-shrink-0 cursor-col-resize group relative hover:bg-blue-400/30 transition-colors">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-slate-200 group-hover:bg-blue-400 transition-colors"/>
        </div>

        {/* RIGHT: IDE text diff + XML editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className={`${(hasXml || xmlContent) ? "flex-[1]" : "flex-1"} min-h-0 overflow-hidden border-b border-slate-200`}>
            <IdeTextDiff
              changes={changes}
              oldText={oldFullText}
              newText={newFullText}
              oldLabel={oldPdf?.name ?? initialOldPdf?.name ?? "Original document"}
              newLabel={newPdf?.name ?? initialNewPdf?.name ?? "Revised document"}
              selectedId={selectedId}
              loading={loading}
              oldPdf={oldPdf ?? initialOldPdf ?? null}
              newPdf={newPdf ?? initialNewPdf ?? null}
              onChangeSelect={id => { const ch = changes.find(c => c.id === id); if (ch) handleSelect(ch); }}
            />
          </div>

          {(hasXml || xmlContent) && (
            <div className="flex-shrink-0 h-[30%] min-h-[160px] flex flex-col bg-white">
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                  </svg>
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    XML Editor
                    {(xmlFile?.name || initialChunk?.filename) && (
                      <span className="text-slate-400 font-normal ml-1 hidden xl:inline">— {xmlFile?.name ?? initialChunk?.filename}</span>
                    )}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${canEdit ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                    {canEdit ? "Editable" : "Read-only"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">{xmlContent.split("\n").length}L</span>
                  {changes.filter(c => c.applied).length > 0 && <span className="text-[10px] text-emerald-600">{changes.filter(c => c.applied).length} applied</span>}
                  {xmlContent && (
                    <div className="flex rounded overflow-hidden border border-slate-200 text-[10px]">
                      {(["edit", "preview"] as const).map(mode => (
                        <button key={mode} onClick={() => setXmlPreviewMode(mode)}
                          className={`px-2 py-0.5 font-semibold capitalize transition-colors ${xmlPreviewMode === mode ? "bg-slate-700 text-white" : "bg-white text-slate-500 hover:text-slate-700"}`}>{mode}</button>
                      ))}
                    </div>
                  )}
                  {selectedChange && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${CM[selectedChange.type].pill}`}>
                      {CM[selectedChange.type].label}
                    </span>
                  )}
                </div>
              </div>
              {xmlPreviewMode === "preview" ? (
                <div className="flex-1 overflow-auto bg-white">
                  <pre className="font-mono text-[12px] leading-[1.65] text-slate-700 px-4 py-3 whitespace-pre-wrap break-words min-h-full"
                    dangerouslySetInnerHTML={{ __html: buildHighlightedXml(xmlContent, changes, selectedId) }} />
                </div>
              ) : (
                <XmlEditor content={xmlContent} onChange={setXmlContent} canEdit={canEdit}
                  highlightText={highlightText} editorRef={editorRef} changes={changes} selectedId={selectedId} />
              )}
            </div>
          )}
        </div>
      </div>

      {showValModal && validation && (
        <ValidationModal result={validation} onClose={() => setShowValModal(false)} onConfirmSave={handleConfirmSave} />
      )}
    </div>
  );
}