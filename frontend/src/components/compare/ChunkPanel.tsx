"use client";
import React, { useState, useRef, useCallback, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface JobState {
  job_id: string;
  source_name: string;
  status: "uploaded" | "processing" | "done" | "error";
}

export interface DetectSummary {
  addition:     number;
  removal:      number;
  modification: number;
  emphasis:     number;
  mismatch?:    number;
}

export interface PdfChunk {
  index:           number;
  label:           string;
  filename:        string;
  old_text?:       string;
  new_text?:       string;
  old_heading:     string;
  new_heading:     string;
  old_heading_raw: string;
  new_heading_raw: string;
  has_changes:     boolean;
  change_types:    string[];
  change_summary:  DetectSummary;
  xml_content?:    string;
  xml_chunk_file?: string;
  xml_tag?:        string;
  xml_attributes?: Record<string, string>;
  xml_size?:       number;
  page_start?:     number | null;
  page_end?:       number | null;
  old_page_start?: number | null;
  old_page_end?:   number | null;
  new_page_start?: number | null;
  new_page_end?:   number | null;
  old_anchor?:     string;
  new_anchor?:     string;
  detected_changes?: unknown[];
  detect_summary?:   DetectSummary;
  old_word_count?:   number;
  new_word_count?:   number;
}

export type ConversionPair = "pdf-to-pdf" | "pdf-to-html" | "html-to-html";
type FileCount = 2 | 3;

interface XmlLevel {
  tag:     string;
  count:   number;
  label:   string;
  samples: string[];
}

interface ChunkPanelProps {
  onNavigateToCompare: (chunk: PdfChunk) => void;
  onAllChunksReady:    (chunks: PdfChunk[]) => void;
  onFilesReady:        (oldPdf: File, newPdf: File, xmlFile?: File) => void;
  onJobCreated:        (job: JobState) => void;
  activeJob?:          JobState | null;
  fileCount?:          FileCount;
  conversionPair?:     ConversionPair;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_PROCESSING_URL ?? "http://localhost:8000";

const EXT_MAP: Record<ConversionPair, { old: string; new: string }> = {
  "pdf-to-pdf":   { old: ".pdf",  new: ".pdf"  },
  "pdf-to-html":  { old: ".pdf",  new: ".html" },
  "html-to-html": { old: ".html", new: ".html" },
};


// ── Client-side XML structure detection ───────────────────────────────────────
// Innodata XML uses <innodLevel last-path="PART 1"> rather than <part>.
// We read the last-path attributes to find what structural levels exist,
// then use the common prefix of last-path values as the tag key sent to backend.
// Language-agnostic: works with English, French, Spanish, etc.

// Known labels for common structural prefixes (multilingual).
// Used to create nice display labels in the level picker.
const PREFIX_LABEL_MAP: Record<string, string> = {
  // English
  part: "Parts", chapter: "Chapters", section: "Sections",
  schedule: "Schedules", article: "Articles", regulation: "Regulations",
  division: "Divisions", title: "Titles", volume: "Volumes", book: "Books",
  appendix: "Appendices", annex: "Annexes",
  // French
  "art.": "Articles", titre: "Titres", chapitre: "Chapitres",
  partie: "Parties", livre: "Livres", annexe: "Annexes",
  // Spanish
  "artículo": "Artículos", "capítulo": "Capítulos", "título": "Títulos",
  "sección": "Secciones",
  // German
  teil: "Teile", kapitel: "Kapitel", abschnitt: "Abschnitte",
  artikel: "Artikel",
  // Portuguese
  "artigo": "Artigos", "capítulo_pt": "Capítulos", "título_pt": "Títulos",
  // Italian
  articolo: "Articoli", capitolo: "Capitoli", titolo: "Titoli",
  sezione: "Sezioni",
};

function parseXmlLevels(xml: string): XmlLevel[] {
  // Strategy 1: Read last-path attributes from <innodLevel last-path="...">
  // Group by the structural prefix — language-agnostic.
  const lpRe = /last-path="([^"]{1,120})"/gi;
  const prefixGroups: Record<string, string[]> = {};
  let m: RegExpExecArray | null;

  while ((m = lpRe.exec(xml)) !== null) {
    const val = m[1].trim();
    if (!val || val.length < 2) continue;

    // Extract structural prefix: first word (letters + optional period),
    // e.g. "art." from "art. L1", "PART" from "PART 1", "chapitre" from "chapitre III"
    const pfxMatch = val.match(/^([a-zà-ÿÀ-ÿ\u0100-\u024F]+\.?)/i);
    const prefix = pfxMatch
      ? pfxMatch[1].trim().toLowerCase()
      : val.split(/[\s\d]/)[0].toLowerCase();
    if (!prefix || prefix.length < 2) continue;

    if (!prefixGroups[prefix]) prefixGroups[prefix] = [];
    prefixGroups[prefix].push(val);
  }

  // Build levels from prefix groups (need ≥ 2 elements to be structural)
  if (Object.keys(prefixGroups).length > 0) {
    const levels: XmlLevel[] = [];
    for (const [prefix, samples] of Object.entries(prefixGroups)) {
      if (samples.length < 2) continue;
      const label =
        PREFIX_LABEL_MAP[prefix] ||
        prefix.charAt(0).toUpperCase() + prefix.slice(1).replace(/\.$/, "") + "s";
      levels.push({
        tag: prefix,
        count: samples.length,
        label,
        samples: samples.slice(0, 3),
      });
    }
    if (levels.length > 0) {
      return levels.sort((a, b) => a.count - b.count); // fewest = coarsest = first
    }
  }

  // Strategy 2: Fall back to scanning actual XML element names
  // (for non-Innodata XML that uses <part>, <chapter>, <section> directly)
  const INLINE = new Set([
    "b","i","u","em","strong","span","a","br","hr","p","li","ul","ol",
    "td","tr","th","table","div","sup","sub","ins","del","ref","fn",
    "note","body","html","head","meta","link","script","style",
    "innodreplace","innodidentifier","innodfootnote","innodheading",
    "innodlevel","innodref","innodimgs","imgs","footnotes","footnoterefs",
    "innodfootnoterefs","innodrefs","root","document","law","act","statute",
  ]);

  // Known structural element names (multilingual)
  const STRUCTURAL = new Set([
    "part", "chapter", "section", "article", "schedule", "appendix",
    "annex", "regulation", "division", "title", "volume", "book",
    "titre", "chapitre", "partie", "livre", "annexe",
    "artículo", "capítulo", "título", "sección",
    "teil", "kapitel", "abschnitt", "artikel",
    "articolo", "capitolo", "titolo", "sezione",
  ]);

  const tagCounts: Record<string, number> = {};
  const tagSamples: Record<string, string[]> = {};
  const tagRe = /<([a-zA-Z][a-zA-Z0-9_-]*)[\s>/]/g;
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[1].toLowerCase();
    if (!INLINE.has(tag)) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }

  const rootTag = (xml.match(/<([a-zA-Z][a-zA-Z0-9_-]*)[\s>]/) ?? [])[1]?.toLowerCase();

  // Extract samples for structural tags
  Object.keys(tagCounts).forEach(tag => {
    const samples: string[] = [];
    const innerRe = new RegExp(
      `<${tag}[^>]*>[\\s\\S]{0,300}?<(?:title|innodheading|heading)[^>]*>([^<]{1,80})`, "gi"
    );
    let sm: RegExpExecArray | null;
    while ((sm = innerRe.exec(xml)) !== null && samples.length < 3) {
      const t = sm[1]?.trim();
      if (t) samples.push(t);
    }
    tagSamples[tag] = samples;
  });

  return Object.entries(tagCounts)
    .filter(([tag, count]) =>
      tag !== rootTag && !INLINE.has(tag) && STRUCTURAL.has(tag) && count >= 2
    )
    .map(([tag, count]) => {
      const label =
        PREFIX_LABEL_MAP[tag] ||
        tag.charAt(0).toUpperCase() + tag.slice(1) + "s";
      return { tag, count, label, samples: tagSamples[tag] ?? [] };
    })
    .sort((a, b) => a.count - b.count);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pluralise(n: number, word: string) {
  return `${n} ${word}${n !== 1 ? "s" : ""}`;
}

function totalChanges(s: DetectSummary) {
  return (s.addition ?? 0) + (s.removal ?? 0) + (s.modification ?? 0) + (s.emphasis ?? 0);
}

// ── Drop Zone ──────────────────────────────────────────────────────────────────

function DropZone({
  label, sublabel, accept, file, onChange, color = "slate",
}: {
  label: string; sublabel?: string; accept: string;
  file: File | null; onChange: (f: File | null) => void;
  color?: "red" | "blue" | "green" | "slate";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const cfg = {
    red: {
      wrap:  "border-red-300 bg-red-50 hover:border-red-400 dark:border-red-500/40 dark:bg-red-500/5 dark:hover:border-red-400/60",
      text:  "text-red-500 dark:text-red-400",
      badge: "bg-red-100 border-red-200 text-red-600 dark:bg-white/5 dark:border-white/10 dark:text-red-400",
    },
    blue: {
      wrap:  "border-blue-300 bg-blue-50 hover:border-blue-400 dark:border-blue-500/40 dark:bg-blue-500/5 dark:hover:border-blue-400/60",
      text:  "text-blue-500 dark:text-blue-400",
      badge: "bg-blue-100 border-blue-200 text-blue-600 dark:bg-white/5 dark:border-white/10 dark:text-blue-400",
    },
    green: {
      wrap:  "border-emerald-300 bg-emerald-50 hover:border-emerald-400 dark:border-emerald-500/40 dark:bg-emerald-500/5 dark:hover:border-emerald-400/60",
      text:  "text-emerald-500 dark:text-emerald-400",
      badge: "bg-emerald-100 border-emerald-200 text-emerald-600 dark:bg-white/5 dark:border-white/10 dark:text-emerald-400",
    },
    slate: {
      wrap:  "border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-white/10 dark:bg-white/3 dark:hover:border-white/20",
      text:  "text-slate-400 dark:text-slate-500",
      badge: "bg-slate-100 border-slate-200 text-slate-500 dark:bg-white/5 dark:border-white/10 dark:text-slate-400",
    },
  }[color];

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed ${cfg.wrap} transition-all cursor-pointer p-3 flex flex-col items-center justify-center gap-1 min-h-[68px] ${drag ? "scale-[0.97] opacity-75" : ""}`}
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onChange(f); }}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => onChange(e.target.files?.[0] ?? null)} />

      {file ? (
        <div className="flex items-center gap-2 w-full">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${cfg.badge}`}>
            {file.name.split(".").pop()?.toUpperCase()}
          </span>
          <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1 min-w-0">{file.name}</span>
          <button onClick={e => { e.stopPropagation(); onChange(null); }}
            className="flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <svg className={`w-5 h-5 ${cfg.text} opacity-60`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span className={`text-[11px] font-semibold ${cfg.text}`}>{label}</span>
          {sublabel && <span className="text-[10px] text-slate-400">{sublabel}</span>}
        </>
      )}
    </div>
  );
}

// ── Progress Bar ───────────────────────────────────────────────────────────────

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-xs font-mono text-slate-400">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: `${value}%`, background: "linear-gradient(90deg,#6d28d9,#4f46e5)" }} />
      </div>
    </div>
  );
}

// ── XML Tag Selector ───────────────────────────────────────────────────────────
// Only rendered after XML is uploaded. Shows auto-detected levels from the XML.
// If none detected, falls back to a free-text field so any language/schema works.

function XmlTagSelector({
  levels, loadingLevels, selected, onChange,
}: {
  levels: XmlLevel[]; loadingLevels: boolean;
  selected: string; onChange: (t: string) => void;
}) {
  const [custom, setCustom] = useState("");

  if (loadingLevels) {
    return (
      <div className="flex items-center gap-2 py-2">
        <svg className="w-3.5 h-3.5 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-xs text-slate-400 dark:text-slate-500">Detecting XML structure…</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-3 space-y-2.5 bg-white dark:bg-white/3 border border-slate-200 dark:border-white/8">
      {levels.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {levels.map(lv => (
              <button
                key={lv.tag}
                onClick={() => onChange(lv.tag)}
                title={lv.samples.length ? `e.g. ${lv.samples.slice(0,3).join(", ")}` : lv.label}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  selected === lv.tag
                    ? "bg-violet-100 border-violet-400 text-violet-700 dark:bg-violet-500/20 dark:border-violet-500/50 dark:text-violet-300"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:border-violet-300 hover:bg-violet-50 dark:bg-white/4 dark:border-white/10 dark:text-slate-400 dark:hover:border-violet-500/30 dark:hover:text-slate-200"
                }`}
              >
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                  selected === lv.tag
                    ? "bg-violet-200 text-violet-700 dark:bg-violet-500/30 dark:text-violet-200"
                    : "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-500"
                }`}>
                  {lv.count}
                </span>
                {lv.label}
              </button>
            ))}
          </div>
          {levels.find(l => l.tag === selected)?.samples?.length ? (
            <p className="text-[10px] text-slate-400 dark:text-slate-600 truncate leading-relaxed">
              e.g. {levels.find(l => l.tag === selected)?.samples.slice(0, 3).join(" · ")}
            </p>
          ) : null}
          <input
            type="text"
            placeholder="Or type a custom tag name…"
            value={custom}
            onChange={e => { setCustom(e.target.value); if (e.target.value) onChange(e.target.value); }}
            className="w-full bg-slate-50 dark:bg-white/4 border border-slate-200 dark:border-white/8 rounded-lg px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-violet-400 dark:focus:border-violet-500/40 transition-colors"
          />
        </>
      ) : (
        <>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            No repeating structural tags found in this XML. Type the tag name you want to chunk by:
          </p>
          <input
            type="text"
            placeholder="e.g. part, chapter, section, artikel, mục, 条…"
            value={custom || selected}
            onChange={e => { setCustom(e.target.value); onChange(e.target.value); }}
            autoFocus
            className="w-full bg-slate-50 dark:bg-white/4 border border-slate-200 dark:border-white/8 rounded-lg px-3 py-2 text-xs text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-violet-400 dark:focus:border-violet-500/40 transition-colors"
          />
        </>
      )}
    </div>
  );
}

// ── Filter Tabs ────────────────────────────────────────────────────────────────

function FilterTabs({
  filter, onChange, changed, total,
}: {
  filter: "all" | "changed" | "unchanged";
  onChange: (f: "all" | "changed" | "unchanged") => void;
  changed: number; total: number;
}) {
  const tabs = [
    { key: "all",       label: `All (${total})` },
    { key: "changed",   label: `Changed (${changed})` },
    { key: "unchanged", label: `OK (${total - changed})` },
  ] as const;

  return (
    <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/8 bg-slate-100 dark:bg-white/2">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 py-1.5 text-[11px] font-semibold transition-all ${
            filter === tab.key
              ? "bg-white dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 shadow-sm"
              : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Summary Stats ──────────────────────────────────────────────────────────────

function SummaryStats({ chunks }: { chunks: PdfChunk[] }) {
  const changed   = chunks.filter(c => c.has_changes).length;
  const unchanged = chunks.length - changed;
  const totAdd    = chunks.reduce((s, c) => s + (c.change_summary?.addition ?? 0), 0);
  const totRem    = chunks.reduce((s, c) => s + (c.change_summary?.removal ?? 0), 0);
  const totMod    = chunks.reduce((s, c) => s + (c.change_summary?.modification ?? 0), 0);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 dark:bg-amber-500/7 dark:border-amber-500/20">
        <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{changed}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">Changed</p>
      </div>
      <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/6 dark:border-emerald-500/18">
        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{unchanged}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">Unchanged</p>
      </div>
      {(totAdd + totRem + totMod) > 0 && (
        <div className="col-span-2 rounded-xl p-3 bg-white dark:bg-white/2 border border-slate-200 dark:border-white/7">
          <div className="flex items-center gap-4">
            {totAdd > 0 && <div className="text-center"><p className="text-lg font-bold text-green-600 dark:text-green-400">+{totAdd}</p><p className="text-[10px] text-slate-500">Added</p></div>}
            {totRem > 0 && <div className="text-center"><p className="text-lg font-bold text-red-600 dark:text-red-400">−{totRem}</p><p className="text-[10px] text-slate-500">Removed</p></div>}
            {totMod > 0 && <div className="text-center"><p className="text-lg font-bold text-amber-600 dark:text-amber-400">~{totMod}</p><p className="text-[10px] text-slate-500">Modified</p></div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chunk Row ──────────────────────────────────────────────────────────────────

function ChunkRow({ chunk, selected, onOpen }: { chunk: PdfChunk; selected: boolean; onOpen: () => void }) {
  const cs    = chunk.change_summary ?? {};
  const total = totalChanges(cs);

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-xl px-4 py-3 transition-all duration-150 border group ${
        selected
          ? "bg-violet-50 border-violet-300 dark:bg-violet-500/15 dark:border-violet-500/40"
          : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:bg-white/2 dark:border-white/6 dark:hover:bg-white/4 dark:hover:border-white/12"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="flex-shrink-0 mt-0.5">
          {chunk.has_changes ? (
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: "rgba(251,191,36,0.2)", color: "#d97706", border: "1px solid rgba(251,191,36,0.4)" }}>
              {total > 0 && total < 100 ? total : "!"}
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: "rgba(34,197,94,0.15)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.3)" }}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600 flex-shrink-0">
                #{String(chunk.index).padStart(2, "0")}
              </span>
              <span className={`text-sm font-semibold truncate ${
                selected
                  ? "text-violet-700 dark:text-violet-200"
                  : "text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white"
              }`}>
                {chunk.old_heading_raw || chunk.old_heading || chunk.label}
              </span>
            </div>
            {chunk.has_changes && (
              <svg className="w-4 h-4 flex-shrink-0 text-slate-400 dark:text-slate-600 group-hover:text-slate-600 transition-colors"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>

          {chunk.has_changes && total > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {(cs.addition ?? 0) > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-green-100 text-green-700 dark:bg-green-500/12 dark:text-green-400">+{cs.addition}</span>
              )}
              {(cs.removal ?? 0) > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-500/12 dark:text-red-400">−{cs.removal}</span>
              )}
              {(cs.modification ?? 0) > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-400">~{cs.modification}</span>
              )}
              {(cs.emphasis ?? 0) > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 dark:bg-violet-500/12 dark:text-violet-400">◎{cs.emphasis}</span>
              )}
            </div>
          )}

          {chunk.old_word_count !== undefined && chunk.new_word_count !== undefined &&
            Math.abs((chunk.old_word_count ?? 0) - (chunk.new_word_count ?? 0)) > 50 && (
            <div className="flex items-center gap-1 mt-1">
              <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-[9px] text-amber-600 dark:text-amber-500">
                {chunk.old_word_count} → {chunk.new_word_count} words
              </span>
            </div>
          )}

          {(chunk.old_page_start || chunk.new_page_start) && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[9px] text-slate-400 dark:text-slate-700">
                Old p.{chunk.old_page_start ?? "?"}–{chunk.old_page_end ?? "?"}
              </span>
              <span className="text-[9px] text-slate-300 dark:text-slate-700">·</span>
              <span className="text-[9px] text-slate-400 dark:text-slate-700">
                New p.{chunk.new_page_start ?? "?"}–{chunk.new_page_end ?? "?"}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Main ChunkPanel ────────────────────────────────────────────────────────────

export default function ChunkPanel({
  onNavigateToCompare,
  onAllChunksReady,
  onFilesReady,
  onJobCreated,
  activeJob,
  fileCount = 2,
  conversionPair = "pdf-to-pdf",
}: ChunkPanelProps) {
  const exts = EXT_MAP[conversionPair];

  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [tagName, setTagName] = useState("");

  const [xmlLevels,     setXmlLevels]     = useState<XmlLevel[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);

  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage,    setStage]    = useState("");
  const [error,    setError]    = useState<string | null>(null);

  const [chunks,      setChunks]      = useState<PdfChunk[]>([]);
  const [jobId,       setJobId]       = useState<string | null>(activeJob?.job_id ?? null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [filter,      setFilter]      = useState<"all" | "changed" | "unchanged">("all");
  const [search,      setSearch]      = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startProgressPolling = useCallback((currentJobId: string) => {
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/compare/progress?job_id=${encodeURIComponent(currentJobId)}`);
        if (!res.ok) return;

        const data = await res.json();
        if (typeof data.progress === "number") setProgress(data.progress);
        if (typeof data.stage === "string" && data.stage) setStage(data.stage);

        if (data.status === "error") {
          stopPolling();
          setLoading(false);
          setError(data.error ?? "Processing failed");
        } else if (data.status === "done") {
          stopPolling();
          // Fetch the completed chunks
          try {
            setStage("Loading results…");
            const chunksRes = await fetch(`${API}/compare/chunks?job_id=${encodeURIComponent(currentJobId)}`);
            const chunksData = await chunksRes.json();
            const allChunks: PdfChunk[] = chunksData.chunks ?? [];
            setChunks(allChunks);
            setProgress(100);
            setStage("Complete");
            setLoading(false);
            onAllChunksReady(allChunks);
            onJobCreated({ job_id: currentJobId, source_name: chunksData.source_name ?? "", status: "done" });
            const firstChanged = allChunks.find((c: PdfChunk) => c.has_changes);
            if (firstChanged) setSelectedIdx(firstChanged.index);
          } catch (fetchErr) {
            setLoading(false);
            setError("Failed to load results. Try refreshing.");
          }
        }
      } catch {
        // Ignore transient polling failures
      }
    }, 800);
  }, [stopPolling, onAllChunksReady, onJobCreated]);

  // ── Auto-detect XML structure client-side (no endpoint needed) ─────────────
  useEffect(() => {
    if (!xmlFile) { setXmlLevels([]); setTagName(""); return; }
    setLoadingLevels(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xml = e.target?.result as string;
        const levels = parseXmlLevels(xml);
        setXmlLevels(levels);
        setTagName(levels.length > 0 ? levels[0].tag : "");
      } catch {
        setXmlLevels([]);
        setTagName("");
      } finally {
        setLoadingLevels(false);
      }
    };
    reader.onerror = () => { setXmlLevels([]); setTagName(""); setLoadingLevels(false); };
    reader.readAsText(xmlFile, "utf-8");
  }, [xmlFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredChunks = chunks.filter(c => {
    const matchFilter =
      filter === "all" ||
      (filter === "changed"   && c.has_changes) ||
      (filter === "unchanged" && !c.has_changes);
    const matchSearch = !search ||
      (c.old_heading_raw || c.old_heading || "").toLowerCase().includes(search.toLowerCase()) ||
      c.label.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const changedCount = chunks.filter(c => c.has_changes).length;
  const canRun = !loading && !!oldFile && !!newFile && !!xmlFile && !!tagName;

  async function handleRun() {
    if (!oldFile || !newFile) { setError("Upload both PDF files first."); return; }
    setError(null);
    setLoading(true);
    setProgress(0);
    setStage("Uploading files…");
    setChunks([]);
    setSelectedIdx(null);
    stopPolling();

    onFilesReady(oldFile, newFile, xmlFile ?? undefined);

    const sourceName = oldFile.name.replace(/\.[^.]+$/, "");
    const uploadFd = new FormData();
    uploadFd.append("old_pdf", oldFile);
    uploadFd.append("new_pdf", newFile);
    if (xmlFile) uploadFd.append("xml_file", xmlFile);
    uploadFd.append("source_name", sourceName);

    try {
      const uploadRes = await fetch(`${API}/compare/upload`, { method: "POST", body: uploadFd });

      const uploadCt = uploadRes.headers.get("content-type") ?? "";
      if (!uploadCt.includes("application/json")) {
        throw new Error(`Server error (${uploadRes.status}): upload failed`);
      }

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadData.detail ?? "Upload failed");
      }

      const jid: string = uploadData.job_id ?? "";
      if (!jid) throw new Error("Upload succeeded but no job_id was returned");

      setJobId(jid);
      onJobCreated({ job_id: jid, source_name: uploadData.source_name ?? sourceName, status: "uploaded" });

      setStage("Starting chunking…");
      setProgress(3);
      startProgressPolling(jid);

      const res = await fetch(`${API}/compare/start-chunking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jid,
          tag_name: tagName || "part",
        }),
      });

      // Check content-type before parsing — a server crash returns HTML, not JSON
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const text = await res.text();
        // Extract useful info from the HTML error page if possible
        const match = text.match(/<pre[^>]*>([\s\S]{0,400})<\/pre>/i) ??
                      text.match(/Internal Server Error[\s\S]{0,200}/i);
        throw new Error(
          `Server error (${res.status}): ${match ? match[0].replace(/<[^>]+>/g, "").trim().slice(0, 200) : "Check server logs"}`
        );
      }

      const ct2 = res.headers.get("content-type") ?? "";
      if (!ct2.includes("application/json")) {
        const txt = await res.text();
        throw new Error(`start-chunking error (${res.status}): ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail));

      // start-chunking now returns immediately with status="processing"
      // The polling loop (already running) will detect "done" and fetch chunks.
      // Nothing more to do here — just wait for polling to finish.
      setStage("Analysing document structure…");

    } catch (e: unknown) {
      stopPolling();
      setLoading(false);
      const msg = e instanceof Error ? e.message : "An error occurred";
      // Network errors (server not running, CORS, etc.)
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError(`Cannot reach server at ${API}. Is the backend running?`);
      } else {
        setError(msg);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/6 shadow-sm">

      {/* ── Left sidebar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[19rem] flex-shrink-0 bg-slate-50 dark:bg-[#0a0d1a] border-r border-slate-200 dark:border-white/6">

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Step 1 — PDFs */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">
              Step 1 — Documents
            </p>
            <DropZone label={`Old ${exts.old.toUpperCase()}`} sublabel="Original version"
              accept={exts.old} file={oldFile} onChange={setOldFile} color="red" />
            <DropZone label={`New ${exts.new.toUpperCase()}`} sublabel="Updated version"
              accept={exts.new} file={newFile} onChange={setNewFile} color="blue" />
          </div>

          {/* Step 2 — XML (required) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">
                Step 2 — XML file
              </p>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
                Required
              </span>
            </div>
            <DropZone label="XML file" sublabel="The document to be updated"
              accept=".xml" file={xmlFile} onChange={setXmlFile} color="green" />
          </div>

          {/* Step 3 — Tag selector (only appears after XML uploaded) */}
          {xmlFile && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">
                Step 3 — Chunk level
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-600 -mt-0.5">
                Detected from your XML
              </p>
              <XmlTagSelector
                levels={xmlLevels}
                loadingLevels={loadingLevels}
                selected={tagName}
                onChange={setTagName}
              />
            </div>
          )}

          {/* Run */}
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background: canRun ? "linear-gradient(135deg,#6d28d9 0%,#4f46e5 100%)" : "rgba(109,40,217,0.12)",
              color: canRun ? "#fff" : "#a78bfa",
              boxShadow: canRun ? "0 4px 18px rgba(109,40,217,0.35)" : "none",
            }}
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Chunk & Compare
              </>
            )}
          </button>

          {loading && <ProgressBar value={progress} label={stage || "Processing…"} />}

          {error && (
            <div className="px-3 py-2.5 rounded-xl text-xs text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/25 bg-red-50 dark:bg-red-500/8 leading-relaxed max-h-32 overflow-y-auto break-words">
              <p className="font-semibold mb-1">Error</p>
              <p className="font-mono whitespace-pre-wrap">{error}</p>
            </div>
          )}

          {/* Summary after results */}
          {chunks.length > 0 && (
            <div className="pt-1">
              <SummaryStats chunks={chunks} />
            </div>
          )}
        </div>

        {jobId && (
          <div className="flex-shrink-0 px-4 py-3 border-t border-slate-200 dark:border-white/5">
            <p className="text-[9px] font-mono text-slate-400 dark:text-slate-700 truncate">job: {jobId}</p>
          </div>
        )}
      </div>

      {/* ── Right: Chunk list ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-[#080b14]">
        {chunks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
            {loading ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto bg-violet-100 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20">
                  <svg className="w-8 h-8 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{stage || "Processing…"}</p>
                  <p className="text-xs text-slate-400 mt-1">{progress}% complete</p>
                </div>
                <div className="w-48 h-1.5 rounded-full bg-slate-200 dark:bg-white/5 mx-auto overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${progress}%`, background: "linear-gradient(90deg,#6d28d9,#4f46e5)" }} />
                </div>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-slate-100 dark:bg-violet-500/8 border border-slate-200 dark:border-violet-500/15">
                  <svg className="w-8 h-8 text-slate-400 dark:text-violet-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No chunks yet</p>
                  <p className="text-xs text-slate-400 dark:text-slate-600 mt-1 max-w-xs leading-relaxed">
                    Upload your files on the left, then click Chunk & Compare
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex-shrink-0 p-5 space-y-3 border-b border-slate-200 dark:border-white/6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {pluralise(chunks.length, "chunk")}
                </p>
                <button
                  onClick={() => {
                    const first = chunks.find(c => c.has_changes);
                    if (first) { setSelectedIdx(first.index); onNavigateToCompare(first); }
                  }}
                  disabled={changedCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30 dark:hover:bg-violet-500/25"
                >
                  Review changes →
                </button>
              </div>

              <FilterTabs filter={filter} onChange={setFilter} changed={changedCount} total={chunks.length} />

              <div className="relative">
                <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search chunks…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-white/4 border border-slate-200 dark:border-white/8 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-700 dark:text-slate-300 placeholder-slate-400 outline-none focus:border-violet-400 dark:focus:border-violet-500/30 transition-colors"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredChunks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No chunks match</p>
                  <button onClick={() => { setFilter("all"); setSearch(""); }}
                    className="text-xs text-violet-600 dark:text-violet-400 hover:underline">
                    Clear filter
                  </button>
                </div>
              ) : (
                filteredChunks.map(chunk => (
                  <ChunkRow
                    key={chunk.index}
                    chunk={chunk}
                    selected={selectedIdx === chunk.index}
                    onOpen={() => { setSelectedIdx(chunk.index); onNavigateToCompare(chunk); }}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}