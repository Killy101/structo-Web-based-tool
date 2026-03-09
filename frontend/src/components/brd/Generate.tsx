import React, { useMemo, useState, useEffect, useRef } from "react";
import api from "@/app/lib/api";
import SimpleMetajson from "@/components/brd/simplemetajson";
import InnodMetajson from "@/components/brd/innodmetajson";

interface Props {
  brdId?: string;
  title?: string;
  format?: "new" | "old";
  initialData?: {
    scope?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    toc?: Record<string, unknown>;
    citations?: Record<string, unknown>;
    contentProfile?: Record<string, unknown>;
    brdConfig?: Record<string, unknown>;
  };
  onEdit?: (step: number) => void;
  onComplete?: () => void;
  canEdit?: boolean;
}

type Format = "new" | "old";

interface ScopeRow {
  id: string; title: string; referenceLink: string; contentUrl: string;
  issuingAuth: string; asrbId: string; smeComments: string;
  initialEvergreen: string; dateOfIngestion: string; isOutOfScope: boolean;
}
interface ScopeEntry {
  document_title?: string; regulator_url?: string; content_url?: string;
  issuing_authority?: string; issuing_authority_code?: string;
  asrb_id?: string; sme_comments?: string;
  initial_evergreen?: string; date_of_ingestion?: string; strikethrough?: boolean;
}
interface TocRow {
  id: string; level: string; name: string;
  required: "true" | "false" | "Conditional" | "";
  definition: string; example: string; note: string;
  tocRequirements: string; smeComments: string;
}
interface LevelRow { id: string; levelNumber: string; description: string; redjayXmlTag: string; path: string; remarksNotes: string; }
interface WhitespaceRow { id: string; tags: string; innodReplace: string; }

const EditIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}
function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((i): i is Record<string, unknown> => !!i && typeof i === "object") : [];
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function buildTemplateMetadataValues(format: Format, metadata?: Record<string, unknown>): Record<string, string> {
  if (!metadata) return {};
  const t = (key: string): string => (typeof metadata[key] === "string" ? String(metadata[key]).trim() : "");

  if (format === "old") {
    return {
      sourceName:      t("source_name") || t("content_category_name") || t("document_title"),
      sourceType:      t("source_type"),
      publicationDate: t("publication_date"),
      lastUpdatedDate: t("last_updated_date"),
      processingDate:  t("processing_date"),
      issuingAgency:   t("issuing_agency"),
      contentUrl:      t("content_uri"),
      geography:       t("geography"),
      language:        t("language"),
      payloadSubtype:  t("payload_subtype"),
      status:          t("status"),
    };
  }

  return {
    contentCategoryName:     t("content_category_name") || t("document_title"),
    publicationDate:         t("publication_date"),
    lastUpdatedDate:         t("last_updated_date"),
    processingDate:          t("processing_date"),
    issuingAgency:           t("issuing_agency"),
    relatedGovernmentAgency: t("related_government_agency"),
    contentUri:              t("content_uri"),
    geography:               t("geography"),
    language:                t("language"),
  };
}
function asScopeEntryArray(v: unknown): ScopeEntry[] {
  return Array.isArray(v) ? v.filter(i => i !== null && typeof i === "object") as ScopeEntry[] : [];
}
function toScopeRow(e: ScopeEntry, id: string, oos: boolean): ScopeRow {
  const auth = e.issuing_authority ? `${e.issuing_authority}${e.issuing_authority_code ? ` (${e.issuing_authority_code})` : ""}` : "";
  return { id, isOutOfScope: oos || !!e.strikethrough, title: e.document_title ?? "", referenceLink: e.regulator_url ?? "", contentUrl: e.content_url ?? "", issuingAuth: auth, asrbId: e.asrb_id ?? "", smeComments: e.sme_comments ?? "", initialEvergreen: e.initial_evergreen ?? "", dateOfIngestion: e.date_of_ingestion ?? "" };
}
function buildScopeRows(d?: Record<string, unknown>): ScopeRow[] {
  if (!d) return [];
  const now = Date.now().toString(); const rows: ScopeRow[] = [];
  asScopeEntryArray(d.in_scope).forEach((e, i) => rows.push(toScopeRow(e, `${now}-in-${i}`, false)));
  asScopeEntryArray(d.out_of_scope).forEach((e, i) => rows.push(toScopeRow(e, `${now}-out-${i}`, true)));
  return rows;
}
function hasExtraCols(rows: ScopeRow[]) {
  return { evergreen: rows.some(r => r.initialEvergreen), ingestion: rows.some(r => r.dateOfIngestion) };
}
function mapRequiredValue(val?: string): TocRow["required"] {
  if (!val) return "";
  const lower = val.toLowerCase().trim();
  if (lower === "true" || lower === "yes" || lower === "y") return "true";
  if (lower === "false" || lower === "no" || lower === "n") return "false";
  if (lower.includes("conditional") || lower.includes("cond")) return "Conditional";
  if (val === "true" || val === "false" || val === "Conditional") return val as TocRow["required"];
  return "";
}
function buildTocRows(d?: Record<string, unknown>): TocRow[] {
  if (!d) return [];
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const ts = Date.now();
  return (sections as Record<string, unknown>[])
    .filter(s => !!s && typeof s === "object")
    .map((s, i) => {
      let level = String(asString(s.level) || asString(s.id) || i + 1);
      const m = level.match(/\*\*?(\d+)\*\*?|\b(\d+)\b/);
      if (m) level = m[1] || m[2] || level;
      return { id: asString(s.id) || `${ts}-${i}`, level: level.trim(), name: asString(s.name), required: mapRequiredValue(asString(s.required)), definition: asString(s.definition), example: asString(s.example), note: asString(s.note), tocRequirements: asString(s.tocRequirements), smeComments: asString(s.smeComments) };
    })
    .sort((a, b) => (parseInt(a.level) || 0) - (parseInt(b.level) || 0));
}

const HARDCODED_LEVELS = new Set(["0", "1"]);
function splitExamples(example: string): string[] {
  let s = example.trim().replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "");
  for (const suffix of ["; etc.", ", etc.", " etc."]) { if (s.endsWith(suffix)) s = s.slice(0, -suffix.length).trim(); }
  for (const sep of [";", "\n", " / "]) { if (s.includes(sep)) return s.split(sep).map(t => t.trim().replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "")).filter(Boolean); }
  return s ? [s] : [];
}
function buildRedjayTag(levelNumber: string, example: string): string {
  const n = levelNumber.replace(/\D/g, "").trim();
  if (HARDCODED_LEVELS.has(n)) return "Hardcoded";
  const tokens = splitExamples(example);
  if (!tokens.length) return `<section level="${n}"><title></title></section>`;
  return tokens.map(t => `<section level="${n}"><title>${t}</title></section>`).join("\n");
}
function extractExample(desc: string): string { const m = desc.match(/^Example:\s*(.+)$/m); return m ? m[1].trim() : ""; }
function extractDefinition(desc: string): string { const m = desc.match(/^Definition:\s*(.+)$/m); return m ? m[1].trim() : ""; }
function isPlaceholderLevelToken(v: string): boolean { return /^level\s*\d+$/.test(v.trim().replace(/^\/+/, "").replace(/[_\-]+/g, " ").toLowerCase()); }
function pickHardcodedToken(raw: string): string {
  if (!raw) return "";
  const sm = raw.match(/\/[A-Za-z][A-Za-z0-9-]*/); if (sm?.[0]) return sm[0];
  const tm = raw.match(/[A-Za-z][A-Za-z0-9-]*/); if (!tm?.[0]) return "";
  return isPlaceholderLevelToken(tm[0]) ? "" : tm[0];
}
function deriveHardcodedPath(levels: LevelRow[]): string {
  let l0 = "", l1 = "";
  for (const row of levels) {
    const n = row.levelNumber.replace(/[^0-9]/g, "").trim();
    const picked = pickHardcodedToken(row.path.trim()) || pickHardcodedToken(extractDefinition(row.description).trim()) || pickHardcodedToken(extractExample(row.description).trim());
    if (n === "0") l0 = picked;
    if (n === "1") l1 = picked;
  }
  if (!l0 && !l1) return "";
  return (l0.replace(/\/$/, "") + "/" + l1.replace(/^\//, "")).replace(/\/+/g, "/");
}
function asExtractedLevels(d?: Record<string, unknown>): LevelRow[] {
  return asRecordArray(d?.levels).map((row, i) => ({ id: `lvl-${i}`, levelNumber: String(row.levelNumber ?? ""), description: String(row.description ?? ""), redjayXmlTag: String(row.redjayXmlTag ?? ""), path: String(row.path ?? ""), remarksNotes: "" }));
}
function asExtractedWhitespace(d?: Record<string, unknown>): WhitespaceRow[] {
  return asRecordArray(d?.whitespace).map((row, i) => ({ id: `ws-${i}`, tags: String(row.tags ?? ""), innodReplace: String(row.innodReplace ?? "") }));
}

const DEFAULT_WHITESPACE_ROWS: WhitespaceRow[] = [
  { id: "ws-def-0", tags: "</title>",         innodReplace: "2 hard returns after title with heading." },
  { id: "ws-def-1", tags: "</title>",         innodReplace: "1 space after title with identifier (levels 4 to 6)." },
  { id: "ws-def-2", tags: "</paragraph>",     innodReplace: "2 hard returns after closing para and before opening para" },
  { id: "ws-def-3", tags: "</ul>",            innodReplace: "1 hard return after" },
  { id: "ws-def-4", tags: "</li>",            innodReplace: "1 hard return after" },
  { id: "ws-def-5", tags: "<p> within <li>",  innodReplace: `InnodReplace text="&#10;&#10;"` },
  { id: "ws-def-6", tags: "table",            innodReplace: `one hard return in every end of </p> tag inside <th> and <td>. Replicate set-up of "(KR.FSS) Decree" for table` },
  { id: "ws-def-7", tags: "<td>",             innodReplace: "" },
  { id: "ws-def-8", tags: "<th>",             innodReplace: "" },
];

// ── Style constants ────────────────────────────────────────────────────────────
const MONO = { fontFamily: "'DM Mono', monospace" } as const;
const SERIF = { fontFamily: "'Georgia', 'Times New Roman', serif" } as const;

const SECTION_META = [
  { num: "I",   label: "Scope",             step: 1, color: "#1e40af" },
  { num: "II",  label: "Metadata",          step: 2, color: "#5b21b6" },
  { num: "III", label: "Table of Contents", step: 3, color: "#312e81" },
  { num: "IV",  label: "Citation Rules",    step: 4, color: "#92400e" },
  { num: "V",   label: "Content Profiling", step: 5, color: "#065f46" },
];

const NAV_ITEMS = [
  { id: "section-scope",           label: "Scope",             icon: "I",   step: 1,    color: "blue"    },
  { id: "section-metadata",        label: "Metadata",          icon: "II",  step: 2,    color: "violet"  },
  { id: "section-toc",             label: "Table of Contents", icon: "III", step: 3,    color: "indigo"  },
  { id: "section-citations",       label: "Citation Rules",    icon: "IV",  step: 4,    color: "amber"   },
  { id: "section-content-profile", label: "Content Profile",   icon: "V",   step: 5,    color: "emerald" },
  { id: "section-generate",        label: "Generate",          icon: "▶",   step: null, color: "slate"   },
];

// ── AssistiveTouch (preserved exactly) ────────────────────────────────────────
function AssistiveTouch() {
  const [open, setOpen]             = useState(false);
  const [activeId, setActiveId]     = useState<string>("");
  const [pos, setPos]               = useState(() => ({
    x: Math.max(12, window.innerWidth - 72),
    y: Math.max(12, window.innerHeight / 2),
  }));
  const [dragging, setDragging]     = useState(false);
  const [didDrag, setDidDrag]       = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const dragStart  = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const btnRef     = useRef<HTMLDivElement>(null);
  const menuRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function getScrollTop() {
      if (window.scrollY > 0) return window.scrollY;
      const el = document.scrollingElement || document.documentElement;
      return el.scrollTop;
    }
    function onScroll() { setShowScrollTop(getScrollTop() > 200); }
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll, { capture: true } as any);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      const BUTTON_SIZE = 52;
      setPos(p => {
        const maxY = window.innerHeight - BUTTON_SIZE - 12;
        const cx = p.x + BUTTON_SIZE / 2;
        const snapX = cx < window.innerWidth / 2 ? 12 : Math.max(12, window.innerWidth - BUTTON_SIZE - 12);
        const clampedY = Math.min(Math.max(12, p.y), maxY);
        return { x: snapX, y: clampedY };
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const ids = NAV_ITEMS.map(n => n.id);
    const visibleMap: Record<string, number> = {};
    const observers = ids.map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(([entry]) => {
        visibleMap[id] = entry.intersectionRatio;
        const best = Object.entries(visibleMap).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActiveId(best[0]);
      }, { threshold: [0, 0.1, 0.5, 1] });
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (open) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    setDragging(true); setDidDrag(false);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setDidDrag(true);
    const BUTTON_SIZE = 52;
    const x = Math.max(0, Math.min(window.innerWidth  - BUTTON_SIZE, dragStart.current.px + dx));
    const y = Math.max(0, Math.min(window.innerHeight - BUTTON_SIZE, dragStart.current.py + dy));
    setPos({ x, y });
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragStart.current) return;
    dragStart.current = null; setDragging(false);
    const BUTTON_SIZE = 52;
    const cx = pos.x + BUTTON_SIZE / 2;
    const snapX = cx < window.innerWidth / 2 ? 12 : window.innerWidth - BUTTON_SIZE - 12;
    setPos(p => ({ ...p, x: snapX }));
    if (!didDrag) setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id); setOpen(false);
  }
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
    document.body.scrollTo({ top: 0, behavior: "smooth" });
    const scrollingEl = document.scrollingElement;
    if (scrollingEl) scrollingEl.scrollTo({ top: 0, behavior: "smooth" });
    const anchor = document.getElementById("section-scope");
    if (anchor) {
      let el: Element | null = anchor.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        const overflow = style.overflow + style.overflowY;
        if (/auto|scroll/.test(overflow)) { el.scrollTo({ top: 0, behavior: "smooth" }); break; }
        el = el.parentElement;
      }
    }
    setShowScrollTop(false); setOpen(false);
  }

  const BUTTON_SIZE = 52;
  const onRightEdge = pos.x + BUTTON_SIZE / 2 > window.innerWidth / 2;
  const menuX = onRightEdge ? Math.max(8, pos.x - 216 - 8) : Math.min(pos.x + BUTTON_SIZE + 8, window.innerWidth - 216 - 8);
  const menuTop = Math.min(Math.max(8, pos.y), window.innerHeight - 440);

  const colorMap: Record<string, { dot: string; bg: string; text: string; hover: string }> = {
    blue:    { dot: "bg-blue-500",    bg: "bg-blue-50 dark:bg-blue-500/10",    text: "text-blue-700 dark:text-blue-300",    hover: "hover:bg-blue-50 dark:hover:bg-blue-500/10"    },
    violet:  { dot: "bg-violet-500",  bg: "bg-violet-50 dark:bg-violet-500/10",  text: "text-violet-700 dark:text-violet-300",  hover: "hover:bg-violet-50 dark:hover:bg-violet-500/10"  },
    indigo:  { dot: "bg-indigo-500",  bg: "bg-indigo-50 dark:bg-indigo-500/10",  text: "text-indigo-700 dark:text-indigo-300",  hover: "hover:bg-indigo-50 dark:hover:bg-indigo-500/10"  },
    amber:   { dot: "bg-amber-500",   bg: "bg-amber-50 dark:bg-amber-500/10",   text: "text-amber-700 dark:text-amber-300",   hover: "hover:bg-amber-50 dark:hover:bg-amber-500/10"   },
    emerald: { dot: "bg-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", hover: "hover:bg-emerald-50 dark:hover:bg-emerald-500/10" },
    slate:   { dot: "bg-slate-500",   bg: "bg-slate-100 dark:bg-[#252d45]",     text: "text-slate-700 dark:text-slate-300",   hover: "hover:bg-slate-100 dark:hover:bg-[#252d45]"   },
  };

  return (
    <>
      <style>{`
        @keyframes at-pop { 0% { transform: scale(0.7) rotate(-10deg); opacity: 0; } 60% { transform: scale(1.08) rotate(2deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
        @keyframes at-menu-in { from { opacity: 0; transform: scale(0.94) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes at-item-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
        .at-btn-ring { box-shadow: 0 0 0 3px rgba(100,116,139,0.15), 0 8px 32px rgba(0,0,0,0.18); }
        .at-btn-ring-open { box-shadow: 0 0 0 4px rgba(99,102,241,0.25), 0 8px 32px rgba(0,0,0,0.22); }
      `}</style>
      <div ref={btnRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        style={{ position: "fixed", left: pos.x, top: pos.y, width: BUTTON_SIZE, height: BUTTON_SIZE, zIndex: 9999, cursor: dragging ? "grabbing" : "grab", transition: dragging ? "none" : "left 0.3s cubic-bezier(0.34,1.56,0.64,1), top 0.15s ease", userSelect: "none", touchAction: "none" }}>
        <div className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-200 select-none ${open ? "bg-slate-800 dark:bg-slate-100 at-btn-ring-open" : "bg-white/90 dark:bg-[#1e2235]/90 backdrop-blur-md at-btn-ring"}`}
          style={{ animation: "at-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both" }}>
          {open ? (
            <svg className="w-5 h-5 text-white dark:text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <div className="flex flex-col items-center justify-center gap-[3px]">
              <span className="block w-4 h-[1.5px] bg-slate-600 dark:bg-slate-300 rounded-full" />
              <span className="block w-4 h-[1.5px] bg-slate-600 dark:bg-slate-300 rounded-full" />
              <span className="block w-2.5 h-[1.5px] bg-slate-600 dark:bg-slate-300 rounded-full" />
            </div>
          )}
        </div>
        {!open && activeId && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white dark:border-[#1e2235]" />}
      </div>

      {open && (
        <div ref={menuRef} style={{ position: "fixed", left: menuX, top: menuTop, width: 216, zIndex: 9998, animation: "at-menu-in 0.2s cubic-bezier(0.16,1,0.3,1) both" }}>
          <div className="rounded-2xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#181d30] border-b border-slate-100 dark:border-[#2a3147] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Navigation</span>
              </div>
              <span className="text-[8.5px] text-slate-300 dark:text-slate-600 italic" style={MONO}>drag to move</span>
            </div>
            <button onClick={scrollToTop}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left group transition-all border-b border-slate-100 dark:border-[#2a3147] ${showScrollTop ? "bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-slate-200" : "hover:bg-slate-50 dark:hover:bg-[#252d45]/60"}`}
              style={{ animation: "at-item-in 0.15s ease both" }}>
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${showScrollTop ? "bg-white/20 dark:bg-black/20" : "bg-slate-100 dark:bg-[#252d45] group-hover:bg-slate-200 dark:group-hover:bg-[#2e3a55]"}`}>
                <svg className={`w-3.5 h-3.5 ${showScrollTop ? "text-white dark:text-slate-900" : "text-slate-500 dark:text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              </span>
              <span className={`text-[11px] font-semibold flex-1 ${showScrollTop ? "text-white dark:text-slate-900" : "text-slate-500 dark:text-slate-400"}`} style={MONO}>Back to Top</span>
            </button>
            <div className="py-1">
              {NAV_ITEMS.map((item, idx) => {
                const isActive = activeId === item.id;
                const isGenerate = item.id === "section-generate";
                const c = colorMap[item.color ?? "slate"];
                return (
                  <React.Fragment key={item.id}>
                    {isGenerate && <div className="mx-3 my-1 h-px bg-slate-100 dark:bg-[#2a3147]" />}
                    <button onClick={() => scrollTo(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left group transition-all relative ${isActive ? c.bg : c.hover}`}
                      style={{ animation: `at-item-in 0.15s ${0.04 * idx}s ease both` }}>
                      {isActive && <span className={`absolute left-0 inset-y-0 w-[3px] rounded-r-full ${c.dot}`} />}
                      <span className={`w-5 text-center text-[11px] font-bold flex-shrink-0 transition-transform ${isActive ? "scale-110" : "group-hover:scale-105"}`} style={MONO}>{item.icon}</span>
                      <span className={`text-[11px] flex-1 leading-tight ${isActive ? `font-semibold ${c.text}` : "text-slate-600 dark:text-slate-400 font-medium"}`} style={MONO}>{item.label}</span>
                      {item.step && <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? `${c.dot} text-white` : "text-slate-300 dark:text-slate-600"}`}>{item.step}</span>}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Badges ─────────────────────────────────────────────────────────────────────
function RequiredBadge({ val }: { val: string }) {
  if (val === "true") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">true</span>;
  if (val === "false") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-[#2a3147]">false</span>;
  if (val === "Conditional") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40">Cond.</span>;
  return <span className="text-slate-300 dark:text-slate-600 text-[11px]">—</span>;
}
function LevelBadge({ val }: { val: string }) {
  const colors: Record<string, string> = { "0": "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200", "1": "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200", "2": "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200", "3": "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200", "4": "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200", "5": "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200", "6": "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200" };
  const cls = colors[val] ?? "bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-400 border-slate-200";
  return <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-[11px] font-bold border ${cls}`} style={MONO}>{val}</span>;
}

// ── Section Header ─────────────────────────────────────────────────────────────
function DocSectionHeader({ idx, onEdit, canEdit = true }: { idx: number; onEdit: (step: number) => void; canEdit?: boolean }) {
  const s = SECTION_META[idx];
  return (
    <div className="flex items-center justify-between mb-4 pb-3" style={{ borderBottom: `2px solid ${s.color}22` }}>
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ ...MONO, color: s.color, opacity: 0.7 }}>Section {s.num}</span>
        <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100 tracking-tight" style={SERIF}>{s.label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-semibold" style={{ ...MONO, color: s.color, borderColor: `${s.color}44`, backgroundColor: `${s.color}0d` }}>Step {s.step}</span>
      </div>
      {canEdit && (
        <button onClick={() => onEdit(s.step)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-[#3a4460] bg-white dark:bg-[#1e2235] hover:bg-slate-50 dark:hover:bg-[#252d45] hover:text-slate-700 dark:hover:text-slate-200 transition-all">
          <EditIcon /> Edit
        </button>
      )}
    </div>
  );
}

// ── Document Block (paper card) ────────────────────────────────────────────────
function DocBlock({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6"
      style={{
        background: "var(--doc-bg, #fff)",
        border: "1px solid #e2e2dc",
        borderRadius: 3,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04), 2px 2px 0 #f0ede8",
        position: "relative",
        overflow: "hidden",
      }}>
      {/* Paper edge line */}
      <div style={{ position: "absolute", top: 0, left: 28, right: 28, height: 1, background: "linear-gradient(90deg, transparent, #d6d0c8 20%, #d6d0c8 80%, transparent)" }} />
      <div style={{ padding: "28px 32px 24px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function Empty() {
  return <p className="text-[12px] text-slate-400 dark:text-slate-600 italic py-4 text-center">No data defined</p>;
}
function Nil() {
  return <span className="text-slate-300 dark:text-slate-600 italic">—</span>;
}

// ── Table base styles ──────────────────────────────────────────────────────────
// Negative margin so tables bleed to card edges, scroll horizontally within that
// TBL_WRAP: negative margin bleeds the table to the card edges; tbl-scroll provides horizontal scroll
const TBL_WRAP = "tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]";
const TH = "px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 border-b border-r border-slate-200 dark:border-[#2a3147] last:border-r-0 bg-slate-50 dark:bg-[#1e2235] whitespace-nowrap";
const TD = "px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0 text-[11.5px] text-slate-700 dark:text-slate-300";

// ── Scope Table ────────────────────────────────────────────────────────────────
function ScopeTable({ scopeData }: { scopeData?: Record<string, unknown> }) {
  const rows = buildScopeRows(scopeData);
  const extra = hasExtraCols(rows);
  if (rows.length === 0) return <Empty />;
  return (
    <div className={TBL_WRAP}>
      <table className="w-full text-[11.5px]" style={{ minWidth: 840 }}>
        <thead>
          <tr>
            <th className={TH} style={{ width: 180 }}>Document Title</th>
            <th className={TH} style={{ width: 120 }}>Reference Link</th>
            <th className={TH} style={{ width: 160 }}>Content URL</th>
            <th className={TH} style={{ width: 160 }}>Issuing Authority</th>
            <th className={TH} style={{ width: 90 }}>ASRB ID</th>
            <th className={TH}>SME Comments</th>
            {extra.evergreen && <th className={TH} style={{ width: 90 }}>Evergreen</th>}
            {extra.ingestion && <th className={TH} style={{ width: 110 }}>Date of Ingestion</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const oos = row.isOutOfScope;
            return (
              <tr key={row.id} className={i % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"} style={{ opacity: oos ? 0.55 : 1 }}>
                <td className={TD}><span className={oos ? "line-through" : ""}>{row.title || <Nil />}</span></td>
                <td className={TD}>{row.referenceLink ? <a href={row.referenceLink} target="_blank" rel="noreferrer" className={`text-blue-600 dark:text-blue-400 hover:underline break-all text-[11px] ${oos ? "line-through" : ""}`}>{row.referenceLink}</a> : <Nil />}</td>
                <td className={TD}>{row.contentUrl ? <a href={row.contentUrl} target="_blank" rel="noreferrer" className={`text-blue-600 dark:text-blue-400 hover:underline break-all text-[11px] ${oos ? "line-through" : ""}`}>{row.contentUrl}</a> : <Nil />}</td>
                <td className={TD}><span className={oos ? "line-through" : ""}>{row.issuingAuth || <Nil />}</span></td>
                <td className={TD}>{row.asrbId ? <span className="font-mono text-[10.5px] bg-slate-100 dark:bg-[#1e2235] px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#2a3147]">{row.asrbId}</span> : <Nil />}</td>
                <td className={TD}><span className={oos ? "line-through" : ""}>{row.smeComments || <Nil />}</span></td>
                {extra.evergreen && <td className={TD}>{row.initialEvergreen || "—"}</td>}
                {extra.ingestion && <td className={TD}>{row.dateOfIngestion || "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-8 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147] flex justify-between items-center">
        <span className="text-[10px] text-slate-400" style={MONO}>{rows.length} document{rows.length !== 1 ? "s" : ""}{rows.filter(r => r.isOutOfScope).length > 0 && ` · ${rows.filter(r => r.isOutOfScope).length} out of scope`}</span>
        {rows.filter(r => r.isOutOfScope).length > 0 && <span className="text-[9.5px] italic text-slate-400" style={MONO}>Strikethrough = out of scope</span>}
      </div>
    </div>
  );
}

// ── Metadata Fields ────────────────────────────────────────────────────────────
function MetaGrid({ values, format }: { values: Record<string, string>; format: Format }) {
  const fields = format === "old"
    ? [
        { label: "Source Name", key: "sourceName" },
        { label: "Source Type", key: "sourceType" },
        { label: "Publication Date", key: "publicationDate" },
        { label: "Last Updated Date", key: "lastUpdatedDate" },
        { label: "Processing Date", key: "processingDate" },
        { label: "Issuing Agency", key: "issuingAgency" },
        { label: "Content URL", key: "contentUrl" },
        { label: "Geography", key: "geography" },
        { label: "Language", key: "language" },
        { label: "Payload Subtype", key: "payloadSubtype" },
        { label: "Status", key: "status" },
      ]
    : [
        { label: "Content Category Name", key: "contentCategoryName" },
        { label: "Publication Date", key: "publicationDate" },
        { label: "Last Updated Date", key: "lastUpdatedDate" },
        { label: "Processing Date", key: "processingDate" },
        { label: "Issuing Agency", key: "issuingAgency" },
        { label: "Related Government Agency", key: "relatedGovernmentAgency" },
        { label: "Content URI", key: "contentUri" },
        { label: "Geography", key: "geography" },
        { label: "Language", key: "language" },
      ];
  return (
    <div className="tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]">
      <table className="w-full text-[11.5px]">
        <tbody>
          {fields.map((f, i) => (
            <tr key={f.key} className={i % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}>
              <td className="px-3 py-2 w-36 border-r border-slate-100 dark:border-[#2a3147] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 align-middle whitespace-nowrap" style={MONO}>{f.label}</td>
              <td className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300">
                {values[f.key] || <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── TOC Table ──────────────────────────────────────────────────────────────────
function TocTable({ tocData }: { tocData?: Record<string, unknown> }) {
  const rows = buildTocRows(tocData);
  if (rows.length === 0) return <Empty />;
  return (
    <div className={TBL_WRAP}>
      <table className="w-full border-collapse" style={{ minWidth: 1080 }}>
        <thead>
          <tr>
            {[["Level","w-16"],["Name","w-36"],["Required","w-24"],["Definition","w-52"],["Example","w-44"],["Note","w-40"],["TOC Requirements","w-48"],["SME Comments","w-44"]].map(([h, w]) => (
              <th key={h} className={`${w} ${TH}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id} className={i % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}>
              <td className={TD}><LevelBadge val={row.level} /></td>
              <td className={TD}>{row.name || <Nil />}</td>
              <td className={TD}><RequiredBadge val={row.required} /></td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{row.definition || <Nil />}</td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{row.example || <Nil />}</td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{row.note || <Nil />}</td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{row.tocRequirements || <Nil />}</td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{row.smeComments || <Nil />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-8 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
        <span className="text-[10px] text-slate-400" style={MONO}>{rows.length} section{rows.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

// ── Citations Table ────────────────────────────────────────────────────────────
function formatDisplay(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s*(Example\s*:)/gi, "\n$1\n").replace(/\s*(Notes?\s*:)/gi, "\n$1\n");
  const lines = normalized.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.map((line, i) => {
    const match = line.match(/^(Example\s*:|Notes?\s*:)(.*)$/i);
    if (!match) return <React.Fragment key={i}>{i > 0 ? "\n" : ""}{line}</React.Fragment>;
    return <React.Fragment key={i}>{i > 0 ? "\n" : ""}<span className="font-semibold">{match[1]}</span>{match[2] ?? ""}</React.Fragment>;
  });
}
function CitationTable({ citationsData }: { citationsData?: Record<string, unknown> }) {
  const citations = asRecordArray(citationsData?.references);
  if (citations.length === 0) return <Empty />;
  return (
    <div className={TBL_WRAP}>
      <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: 600 }}>
        <thead>
          <tr>
            {["Lvl","Citation Rules","Source of Law","SME Comments"].map(h => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {citations.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/40 dark:bg-[#1a1f35]/40"}>
              <td className={`w-14 ${TD}`}><LevelBadge val={asString(row.level)} /></td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{formatDisplay(asString(row.citationRules)) || "—"}</td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{asString(row.sourceOfLaw) || "—"}</td>
              <td className={`${TD} whitespace-pre-wrap break-words`}>{formatDisplay(asString(row.smeComments))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Content Profile ────────────────────────────────────────────────────────────
function ContentProfile({ cpData }: { cpData?: Record<string, unknown> }) {
  const levels = useMemo(() => asExtractedLevels(cpData), [cpData]);
  const hardcodedPath = useMemo(() => deriveHardcodedPath(levels), [levels]);
  const rcFilename = String(cpData?.rc_filename ?? "");
  const headingAnnotation = String(cpData?.heading_annotation ?? "");
  const wsRows = useMemo(() => { const e = asExtractedWhitespace(cpData); return e.length > 0 ? e : DEFAULT_WHITESPACE_ROWS; }, [cpData]);

  return (
    <div className="space-y-5">
      {/* Key fields */}
      <div className="tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]">
        {[["RC Filename", rcFilename, true], ["Hardcoded Path", hardcodedPath, true], ["Heading Annotation", headingAnnotation, false]].map(([label, value, mono], i) => (
          <div key={label as string} className={`flex items-center border-b border-slate-100 dark:border-[#2a3147] last:border-0 ${i % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}`}>
            <div className="w-40 shrink-0 px-3 py-2 border-r border-slate-100 dark:border-[#2a3147]">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400" style={MONO}>{label as string}</span>
            </div>
            <div className="flex-1 px-3 py-1.5">
              <span className={`text-[11.5px] ${mono ? "font-mono" : ""} ${value ? "text-sky-700 dark:text-sky-400 font-semibold" : "text-slate-400 dark:text-slate-600 italic"}`}>{(value as string) || "—"}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Level Numbers */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-2" style={MONO}>Level Numbers</p>
        <div className={TBL_WRAP}>
          <table className="w-full border-collapse" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th className={`w-20 ${TH}`}>Level #</th>
                <th className={`w-64 ${TH}`}>Description</th>
                <th className={`${TH}`}>REDJAy XML Tag <span className="text-sky-500 ml-1 normal-case">⚡ auto</span></th>
                <th className={`w-48 ${TH}`}>Path</th>
                <th className={`w-44 ${TH}`}>Remarks / Notes</th>
              </tr>
            </thead>
            <tbody>
              {levels.length === 0
                ? <tr><td colSpan={5} className="py-6 text-center text-[12px] text-slate-400 italic">No levels defined</td></tr>
                : levels.map((row, i) => (
                  <tr key={row.id} className={i % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}>
                    <td className={TD}><span className="font-mono text-[11px]">{row.levelNumber || "—"}</span></td>
                    <td className={`${TD} whitespace-pre-line`}>{row.description || <Nil />}</td>
                    <td className={TD}><span className={`text-[11px] font-mono whitespace-pre-line select-all ${row.redjayXmlTag === "Hardcoded" ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-sky-700 dark:text-sky-400"}`}>{row.redjayXmlTag || <Nil />}</span></td>
                    <td className={TD}><span className="font-mono text-[11px]">{row.path || <Nil />}</span></td>
                    <td className={TD}>{row.remarksNotes || <Nil />}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Whitespace */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-2" style={MONO}>Whitespace Handling</p>
        <div className={TBL_WRAP}>
          <table className="w-full border-collapse" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th className={`w-44 ${TH}`}>Tags</th>
                <th className={TH}>InnodReplace</th>
              </tr>
            </thead>
            <tbody>
              {wsRows.map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}>
                  <td className={`${TD} font-mono text-violet-700 dark:text-violet-400`}>{row.tags || <Nil />}</td>
                  <td className={TD}>{row.innodReplace || <Nil />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
            <span className="text-[10px] text-slate-400" style={MONO}>{wsRows.length} rule{wsRows.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Generate Button ────────────────────────────────────────────────────────────
function GenBtn({ label, icon, description, color, onClick, loading, done }: {
  label: string; icon: string; description: string;
  color: "slate" | "blue" | "violet" | "indigo";
  onClick: () => void; loading: boolean; done: boolean;
}) {
  const styles: Record<string, string> = {
    slate: "bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 ring-slate-200 dark:ring-slate-700",
    blue: "bg-blue-600 hover:bg-blue-700 ring-blue-100 dark:ring-blue-900/40",
    violet: "bg-violet-600 hover:bg-violet-700 ring-violet-100 dark:ring-violet-900/40",
    indigo: "bg-indigo-600 hover:bg-indigo-700 ring-indigo-100 dark:ring-indigo-900/40",
  };
  return (
    <div className={`flex-1 rounded border-2 transition-all p-3.5 flex flex-col gap-3 ${done ? "border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/30 dark:bg-emerald-500/5" : "border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1e2235]"}`}
      style={{ boxShadow: done ? "none" : "0 1px 4px rgba(0,0,0,0.05)" }}>
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded flex items-center justify-center text-sm flex-shrink-0 ${done ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-slate-100 dark:bg-[#252d45]"}`}>
          {done ? <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg> : icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[11.5px] font-semibold leading-tight ${done ? "text-emerald-700 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"}`}>{label}</p>
          <p className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
      <button onClick={onClick} disabled={loading || done}
        className={`w-full py-1.5 rounded text-[11.5px] font-semibold text-white transition-all ring-4 ${styles[color]} disabled:opacity-40 disabled:cursor-not-allowed`}>
        {loading
          ? <span className="flex items-center justify-center gap-2"><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>Generating…</span>
          : done ? "Generated ✓" : label}
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Generate({ brdId, title, format, initialData, onEdit, onComplete, canEdit = true }: Props) {
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [done, setDone]             = useState<Record<string, boolean>>({});
  const [completed, setCompleted]   = useState<Record<string, boolean>>({});
  const [metajsonModal, setMetajsonModal] = useState<{ open: boolean; data: Record<string, unknown> | null; filename: string }>({ open: false, data: null, filename: "metajson.json" });
  const [innodModal, setInnodModal] = useState<{ open: boolean; data: Record<string, unknown> | null; filename: string }>({ open: false, data: null, filename: "innod_metajson.json" });
  const doneResetTimers = useRef<Record<string, number>>({});
  const docPageRef = useRef<HTMLDivElement>(null);
  const contentProfileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      Object.values(doneResetTimers.current).forEach(timer => window.clearTimeout(timer));
    };
  }, []);

  const scopeData          = asRecord(initialData?.scope);
  const metadataData       = asRecord(initialData?.metadata);
  const tocData            = asRecord(initialData?.toc);
  const citationsData      = asRecord(initialData?.citations);
  const contentProfileData = asRecord(initialData?.contentProfile);
  const brdConfigData      = asRecord(initialData?.brdConfig);

  const activeFormat: Format = format === "old" ? "old" : "new";
  const metadataValues = buildTemplateMetadataValues(activeFormat, metadataData);
  const displayTitle = activeFormat === "old"
    ? (metadataValues.sourceName || title || "Untitled BRD")
    : (title || "Untitled BRD");

  function markDone(key: string, ms = 1600) {
    if (doneResetTimers.current[key]) window.clearTimeout(doneResetTimers.current[key]);
    setDone(p => ({ ...p, [key]: true }));
    doneResetTimers.current[key] = window.setTimeout(() => {
      setDone(p => ({ ...p, [key]: false }));
      delete doneResetTimers.current[key];
    }, ms);
  }

  function runGenerate(key: string) {
    setGenerating(p => ({ ...p, [key]: true }));
    setTimeout(() => {
      setGenerating(p => ({ ...p, [key]: false }));
      setCompleted(p => ({ ...p, [key]: true }));
      markDone(key);
    }, 3000);
  }

  function sanitizeFilePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  function buildExcelHtml(contentHtml: string, titleText: string): string {
    return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
  <head>
    <meta charset="utf-8" />
    <meta name="ProgId" content="Excel.Sheet" />
    <meta name="Generator" content="Structo" />
    <title>${titleText}</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #111827; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; white-space: normal !important; word-break: break-word; }
      .tbl-scroll { overflow: visible !important; }
      .dark * { color: #111827 !important; background: #ffffff !important; }
      [style*="min-width"] { min-width: 0 !important; }
    </style>
  </head>
  <body>
    ${contentHtml}
  </body>
</html>`;
  }

  function downloadExcelFile(filenameBase: string, titleText: string, contentElement: HTMLElement) {
    const html = buildExcelHtml(contentElement.outerHTML, titleText);
    const blob = new Blob(["\ufeff", html], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilePart(filenameBase)}.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function runGenerateBrdExcel() {
    setGenerating(p => ({ ...p, brd: true }));
    try {
      const page = docPageRef.current;
      if (!page) throw new Error("BRD content not found");

      // Exclude output controls from BRD export.
      const pageClone = page.cloneNode(true) as HTMLElement;
      pageClone.querySelector("#section-generate")?.remove();

      downloadExcelFile(`${brdId || "BRD"}_BRD`, `${brdId || "BRD"} - BRD`, pageClone);
      setCompleted(p => ({ ...p, brd: true }));
      markDone("brd");
    } catch (error) {
      console.error("[Generate BRD Excel] failed:", error);
      setDone(p => ({ ...p, brd: false }));
      setCompleted(p => ({ ...p, brd: false }));
      if (typeof window !== "undefined") window.alert("Failed to generate BRD Excel.");
    } finally {
      setGenerating(p => ({ ...p, brd: false }));
    }
  }

  async function runGenerateContentProfileExcel() {
    setGenerating(p => ({ ...p, content: true }));
    try {
      const section = contentProfileRef.current;
      if (!section) throw new Error("Content Profile section not found");
      const sectionClone = section.cloneNode(true) as HTMLElement;
      downloadExcelFile(`${brdId || "BRD"}_ContentProfile`, `${brdId || "BRD"} - Content Profile`, sectionClone);
      setCompleted(p => ({ ...p, content: true }));
      markDone("content");
    } catch (error) {
      console.error("[Generate Content Profile Excel] failed:", error);
      setDone(p => ({ ...p, content: false }));
      setCompleted(p => ({ ...p, content: false }));
      if (typeof window !== "undefined") window.alert("Failed to generate Content Profile Excel.");
    } finally {
      setGenerating(p => ({ ...p, content: false }));
    }
  }

  async function runGenerateMetajson() {
    setGenerating(p => ({ ...p, metajson: true }));
    try {
      const response = await api.post<{ success: boolean; metajson: Record<string, unknown>; filename?: string }>("/brd/generate/metajson", { brdId, title, format, scope: scopeData, metadata: metadataData, toc: tocData, citations: citationsData, contentProfile: contentProfileData, brdConfig: brdConfigData });
      const { metajson, filename } = response.data;
      setMetajsonModal({ open: true, data: metajson, filename: filename || `${brdId || "metajson"}.json` });
      setCompleted(p => ({ ...p, metajson: true }));
      markDone("metajson");
    } catch (error) {
      console.error("[Generate Metajson] failed:", error);
      setDone(p => ({ ...p, metajson: false }));
      setCompleted(p => ({ ...p, metajson: false }));
      if (typeof window !== "undefined") window.alert("Failed to generate Metajson. Please try again.");
    } finally {
      setGenerating(p => ({ ...p, metajson: false }));
    }
  }

  async function runGenerateInnod() {
    setGenerating(p => ({ ...p, innod: true }));
    try {
      const response = await api.post<{ success: boolean; metajson: Record<string, unknown>; filename?: string }>("/brd/generate/metajson", { brdId, title, format, scope: scopeData, metadata: metadataData, toc: tocData, citations: citationsData, contentProfile: contentProfileData, brdConfig: brdConfigData });
      const { metajson, filename } = response.data;
      setInnodModal({ open: true, data: metajson, filename: filename || `${brdId || "innod"}_metajson.json` });
      setCompleted(p => ({ ...p, innod: true }));
      markDone("innod");
    } catch (error) {
      console.error("[Generate Innod Metajson] failed:", error);
      setDone(p => ({ ...p, innod: false }));
      setCompleted(p => ({ ...p, innod: false }));
      if (typeof window !== "undefined") window.alert("Failed to generate Innod Metajson. Please try again.");
    } finally {
      setGenerating(p => ({ ...p, innod: false }));
    }
  }

  const allDone = completed["brd"] && completed["metajson"] && completed["innod"] && completed["content"];
  const noop = () => {};

  return (
    <>
      <style>{`
        :root { --doc-bg: #fefefe; }
        .dark { --doc-bg: #1a1f31; }
        .tbl-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.4) transparent; }
        .tbl-scroll::-webkit-scrollbar { height: 5px; }
        .tbl-scroll::-webkit-scrollbar-track { background: transparent; }
        .tbl-scroll::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(148,163,184,0.45); }
        .tbl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.7); }
        .dark .tbl-scroll::-webkit-scrollbar-thumb { background: rgba(71,85,105,0.55); }
        .doc-page { max-width: 100%; margin: 0 auto; }
        :root { --brd-title-color: #1e293b; }
        .dark { --brd-title-color: #f1f5f9; }
        @media print { .doc-page { max-width: 100%; } }
      `}</style>

      <AssistiveTouch />

      <div ref={docPageRef} className="doc-page px-4 py-6 space-y-1">

        {/* ── Document Header ── */}
        <div style={{ textAlign: "center", marginBottom: 36, paddingBottom: 28, borderBottom: "1.5px solid #ddd8d0" }}>
          <h1 style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: 26,
            fontWeight: 700,
            color: "var(--brd-title-color, #1e293b)",
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
            margin: "0 0 14px",
          }}>
            {displayTitle}
          </h1>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" as const }}>
            {brdId && (
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "#64748b",
                background: "#f1f5f9",
                border: "1px solid #e2e8f0",
                padding: "3px 10px",
                borderRadius: 4,
              }}>
                {brdId}
              </span>
            )}
            <span style={{ color: "#cbd5e1", fontSize: 13 }}>·</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#94a3b8" }}>5 Sections</span>
          </div>
        </div>

        {/* ── Section I: Scope ── */}
        <DocBlock id="section-scope">
          <DocSectionHeader idx={0} onEdit={onEdit ?? noop} canEdit={canEdit} />
          <ScopeTable scopeData={scopeData} />
        </DocBlock>

        {/* Section divider */}
        <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)", margin: "4px 0" }} />

        {/* ── Section II: Metadata ── */}
        <DocBlock id="section-metadata">
          <DocSectionHeader idx={1} onEdit={onEdit ?? noop} canEdit={canEdit} />
          <MetaGrid values={metadataValues} format={activeFormat} />
        </DocBlock>

        <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)", margin: "4px 0" }} />

        {/* ── Section III: TOC ── */}
        <DocBlock id="section-toc">
          <DocSectionHeader idx={2} onEdit={onEdit ?? noop} canEdit={canEdit} />
          <TocTable tocData={tocData} />
        </DocBlock>

        <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)", margin: "4px 0" }} />

        {/* ── Section IV: Citations ── */}
        <DocBlock id="section-citations">
          <DocSectionHeader idx={3} onEdit={onEdit ?? noop} canEdit={canEdit} />
          <CitationTable citationsData={citationsData} />
        </DocBlock>

        <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)", margin: "4px 0" }} />

        {/* ── Section V: Content Profile ── */}
        <div ref={contentProfileRef}>
          <DocBlock id="section-content-profile">
            <DocSectionHeader idx={4} onEdit={onEdit ?? noop} canEdit={canEdit} />
            <ContentProfile cpData={contentProfileData} />
          </DocBlock>
        </div>

        {/* ── Generate Outputs ── */}
        <div id="section-generate" className="scroll-mt-6" style={{ paddingTop: 24 }}>
          <div style={{ borderTop: "2px solid #e2e2dc", paddingTop: 20 }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-3" style={MONO}>Generate Outputs</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <GenBtn label="Generate BRD" icon="✦" description="Export BRD content to Excel" color="slate" onClick={runGenerateBrdExcel} loading={!!generating["brd"]} done={!!done["brd"]} />
              <GenBtn label="Generate Metajson" icon="≡" description="Export metadata as structured JSON in the selected schema" color="blue" onClick={runGenerateMetajson} loading={!!generating["metajson"]} done={!!done["metajson"]} />
              <GenBtn label="Metajson for Innod.Xml" icon="◇" description="Build Innod-compatible XML metadata JSON output" color="indigo" onClick={runGenerateInnod} loading={!!generating["innod"]} done={!!done["innod"]} />
              <GenBtn label="Content Profile" icon="⬡" description="Export Content Profile to Excel" color="violet" onClick={runGenerateContentProfileExcel} loading={!!generating["content"]} done={!!done["content"]} />
            </div>
          </div>
        </div>

        {/* ── All done ── */}
        {allDone && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-500/10">
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <p className="text-[12.5px] font-medium text-emerald-800 dark:text-emerald-400">All outputs generated — <span className="font-bold">{brdId ?? "BRD"}</span> is ready</p>
            </div>
            <button onClick={onComplete} className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 rounded text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all">
              Back to Registry
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        )}

      </div>

      <SimpleMetajson open={metajsonModal.open} onClose={() => setMetajsonModal(p => ({ ...p, open: false }))} metajson={metajsonModal.data} filename={metajsonModal.filename} />
      <InnodMetajson open={innodModal.open} onClose={() => setInnodModal(p => ({ ...p, open: false }))} metajson={innodModal.data} filename={innodModal.filename} />
    </>
  );
}