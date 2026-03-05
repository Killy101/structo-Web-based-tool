import React, { useMemo, useState, useEffect, useRef } from "react";

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
  };
  onEdit?: (step: number) => void;
  onComplete?: () => void;
  canEdit?: boolean;
}

// ── Types ──────────────────────────────────────────────────────────────────────
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

// ── Icons ──────────────────────────────────────────────────────────────────────
const EditIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

// ── Helpers ────────────────────────────────────────────────────────────────────
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}
function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((i): i is Record<string, unknown> => !!i && typeof i === "object") : [];
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
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

// ── Content Profile helpers ────────────────────────────────────────────────────
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

// ── Default Whitespace Rows (from spreadsheet) ────────────────────────────────
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
const TH_BASE = "px-3 py-2 text-left font-bold text-[10px] uppercase tracking-[0.1em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147]";
const CELL = "px-3 py-2 border-r border-slate-100 dark:border-[#2a3147] align-top";
const TH_TOC = "px-3 py-2.5 text-left border-r border-slate-200 dark:border-[#2a3147] last:border-r-0";
const CELL_TOC = "px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0";

const TOC_COLUMNS = [
  { key: "level", label: "Level", width: "w-20", icon: "⬡" },
  { key: "name", label: "Name", width: "w-40", icon: "≡" },
  { key: "required", label: "Required", width: "w-28", icon: "◈" },
  { key: "definition", label: "Definition", width: "w-52", icon: "◎" },
  { key: "example", label: "Example", width: "w-48", icon: "✦" },
  { key: "note", label: "Note", width: "w-44", icon: "↑" },
  { key: "tocRequirements", label: "TOC Requirements", width: "w-52", icon: "≡" },
  { key: "smeComments", label: "SME Comments", width: "w-48", icon: "◈" },
];

const CP_LEVEL_COLS = [
  { key: "levelNumber", label: "Level Number", width: "w-24" },
  { key: "description", label: "Description", width: "w-72" },
  { key: "redjayXmlTag", label: "REDJAy XML Tag", width: "flex-1" },
  { key: "path", label: "Path", width: "w-52" },
  { key: "remarksNotes", label: "Remarks / Notes", width: "w-52" },
];
const CP_WS_COLS = [
  { key: "tags",        label: "Tags",         width: "w-44" },
  { key: "innodReplace", label: "InnodReplace", width: "flex-1" },
];

// ── Section config ─────────────────────────────────────────────────────────────
const SECTION_STYLES = [
  { icon: "◎", label: "Scope",              step: 1, accent: "blue",   header: "bg-blue-50   dark:bg-blue-500/10   border-blue-200  dark:border-blue-700/40",   iconCls: "text-blue-600  dark:text-blue-400",   labelCls: "text-blue-800  dark:text-blue-300",   badge: "bg-blue-100  dark:bg-blue-500/20  text-blue-700  dark:text-blue-300  border-blue-200  dark:border-blue-600/40"  },
  { icon: "≡", label: "Metadata",           step: 2, accent: "violet", header: "bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-700/40", iconCls: "text-violet-600 dark:text-violet-400", labelCls: "text-violet-800 dark:text-violet-300", badge: "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-600/40" },
  { icon: "✦", label: "Table of Contents",  step: 3, accent: "indigo", header: "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-700/40", iconCls: "text-indigo-600 dark:text-indigo-400", labelCls: "text-indigo-800 dark:text-indigo-300", badge: "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-600/40" },
  { icon: "§", label: "Citation Rules",     step: 4, accent: "amber",  header: "bg-amber-50  dark:bg-amber-500/10  border-amber-200  dark:border-amber-700/40",  iconCls: "text-amber-600  dark:text-amber-400",  labelCls: "text-amber-800  dark:text-amber-300",  badge: "bg-amber-100  dark:bg-amber-500/20  text-amber-700  dark:text-amber-300  border-amber-200  dark:border-amber-600/40"  },
  { icon: "⬡", label: "Content Profiling",  step: 5, accent: "emerald",header: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-700/40", iconCls: "text-emerald-600 dark:text-emerald-400", labelCls: "text-emerald-800 dark:text-emerald-300", badge: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-600/40" },
];

// ── Nav items config ───────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "section-scope",           label: "Scope",             icon: "◎", step: 1,    color: "blue"    },
  { id: "section-metadata",        label: "Metadata",          icon: "≡", step: 2,    color: "violet"  },
  { id: "section-toc",             label: "Table of Contents", icon: "✦", step: 3,    color: "indigo"  },
  { id: "section-citations",       label: "Citation Rules",    icon: "§", step: 4,    color: "amber"   },
  { id: "section-content-profile", label: "Content Profile",   icon: "⬡", step: 5,    color: "emerald" },
  { id: "section-generate",        label: "Generate",          icon: "▶", step: null, color: "slate"   },
];

// ── Assistive Touch Widget ─────────────────────────────────────────────────────
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
        const snapX = cx < window.innerWidth / 2
          ? 12
          : Math.max(12, window.innerWidth - BUTTON_SIZE - 12);
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
    setDragging(true);
    setDidDrag(false);
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
    dragStart.current = null;
    setDragging(false);
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
    setActiveId(id);
    setOpen(false);
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
        if (/auto|scroll/.test(overflow)) {
          el.scrollTo({ top: 0, behavior: "smooth" });
          break;
        }
        el = el.parentElement;
      }
    }
    setShowScrollTop(false);
    setOpen(false);
  }

  const BUTTON_SIZE = 52;
  const onRightEdge = pos.x + BUTTON_SIZE / 2 > window.innerWidth / 2;
  const menuX = onRightEdge
    ? Math.max(8, pos.x - 216 - 8)
    : Math.min(pos.x + BUTTON_SIZE + 8, window.innerWidth - 216 - 8);
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
        .tbl-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .tbl-scroll::-webkit-scrollbar { height: 6px; }
        .tbl-scroll::-webkit-scrollbar-track { background: transparent; }
        .tbl-scroll::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(148, 163, 184, 0.45); }
        .tbl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.7); }
        .dark .tbl-scroll::-webkit-scrollbar-thumb { background: rgba(71, 85, 105, 0.55); }
        .dark .tbl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.8); }
        .tbl-scroll { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.45) transparent; }
        .dark .tbl-scroll { scrollbar-color: rgba(71,85,105,0.55) transparent; }
        @keyframes at-pop { 0% { transform: scale(0.7) rotate(-10deg); opacity: 0; } 60% { transform: scale(1.08) rotate(2deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
        @keyframes at-menu-in { from { opacity: 0; transform: scale(0.94) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes at-item-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
        .at-btn-ring { box-shadow: 0 0 0 3px rgba(100,116,139,0.15), 0 8px 32px rgba(0,0,0,0.18); }
        .at-btn-ring-open { box-shadow: 0 0 0 4px rgba(99,102,241,0.25), 0 8px 32px rgba(0,0,0,0.22); }
      `}</style>

      <div
        ref={btnRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "fixed", left: pos.x, top: pos.y, width: BUTTON_SIZE, height: BUTTON_SIZE,
          zIndex: 9999, cursor: dragging ? "grabbing" : "grab",
          transition: dragging ? "none" : "left 0.3s cubic-bezier(0.34,1.56,0.64,1), top 0.15s ease",
          userSelect: "none", touchAction: "none",
        }}
      >
        <div
          className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-200 select-none ${open ? "bg-slate-800 dark:bg-slate-100 at-btn-ring-open" : "bg-white/90 dark:bg-[#1e2235]/90 backdrop-blur-md at-btn-ring"}`}
          style={{ animation: "at-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          {open ? (
            <svg className="w-5 h-5 text-white dark:text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <div className="flex flex-col items-center justify-center gap-[3px]">
              <span className="block w-4 h-[1.5px] bg-slate-600 dark:bg-slate-300 rounded-full" />
              <span className="block w-4 h-[1.5px] bg-slate-600 dark:bg-slate-300 rounded-full" />
              <span className="block w-2.5 h-[1.5px] bg-slate-600 dark:bg-slate-300 rounded-full" />
            </div>
          )}
        </div>
        {!open && activeId && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white dark:border-[#1e2235]" />
        )}
      </div>

      {open && (
        <div
          ref={menuRef}
          style={{ position: "fixed", left: menuX, top: menuTop, width: 216, zIndex: 9998, animation: "at-menu-in 0.2s cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <div className="rounded-2xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#181d30] border-b border-slate-100 dark:border-[#2a3147] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Navigation</span>
              </div>
              <span className="text-[8.5px] text-slate-300 dark:text-slate-600 italic" style={MONO}>drag to move</span>
            </div>
            <button
              onClick={scrollToTop}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left group transition-all border-b border-slate-100 dark:border-[#2a3147] ${showScrollTop ? "bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-slate-200" : "hover:bg-slate-50 dark:hover:bg-[#252d45]/60"}`}
              style={{ animation: "at-item-in 0.15s ease both" }}
            >
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${showScrollTop ? "bg-white/20 dark:bg-black/20" : "bg-slate-100 dark:bg-[#252d45] group-hover:bg-slate-200 dark:group-hover:bg-[#2e3a55]"}`}>
                <svg className={`w-3.5 h-3.5 ${showScrollTop ? "text-white dark:text-slate-900" : "text-slate-500 dark:text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
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
                    <button
                      onClick={() => scrollTo(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left group transition-all relative ${isActive ? c.bg : `${c.hover}`}`}
                      style={{ animation: `at-item-in 0.15s ${0.04 * idx}s ease both` }}
                    >
                      {isActive && <span className={`absolute left-0 inset-y-0 w-[3px] rounded-r-full ${c.dot}`} />}
                      <span className={`w-5 text-center text-[12px] flex-shrink-0 transition-transform ${isActive ? "scale-110" : "group-hover:scale-105"}`}>{item.icon}</span>
                      <span className={`text-[11px] flex-1 leading-tight ${isActive ? `font-semibold ${c.text}` : "text-slate-600 dark:text-slate-400 font-medium"}`} style={MONO}>{item.label}</span>
                      {item.step && (
                        <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? `${c.dot} text-white` : "text-slate-300 dark:text-slate-600"}`}>{item.step}</span>
                      )}
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
  if (val === "true") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">true</span>;
  if (val === "false") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-500 border border-slate-300 dark:border-[#2a3147]">false</span>;
  if (val === "Conditional") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40">Cond.</span>;
  return <span className="text-slate-400 dark:text-slate-600 text-[11px]">—</span>;
}
function LevelBadgeToc({ val }: { val: string }) {
  const colors: Record<string, string> = { "0": "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700/40", "1": "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40", "2": "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-700/40", "3": "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700/40", "4": "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/40", "5": "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40", "6": "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700/40", "7": "bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-700/40", "8": "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700/40", "9": "bg-pink-50 dark:bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-300 dark:border-pink-700/40", "10": "bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700/40" };
  const cls = colors[val] ?? "bg-slate-100 dark:bg-[#252d45] text-slate-700 dark:text-slate-400 border-slate-300 dark:border-[#2a3147]";
  return <span className={`inline-flex items-center justify-center ${val.length >= 2 ? "w-8" : "w-7"} h-7 rounded-full text-[11px] font-bold border ${cls}`}>{val}</span>;
}

// ── Section Card ───────────────────────────────────────────────────────────────
function SectionCard({ styleIdx, onEdit, children, canEdit = true, id }: {
  styleIdx: number; onEdit: (step: number) => void; children: React.ReactNode; canEdit?: boolean; id?: string;
}) {
  const s = SECTION_STYLES[styleIdx];
  return (
    <div id={id} className="rounded-xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] overflow-hidden scroll-mt-4">
      <div className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${s.header}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold border ${s.badge}`}>{s.icon}</div>
          <div className="flex items-center gap-2">
            <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${s.labelCls}`} style={MONO}>{s.label}</p>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${s.badge}`} style={MONO}>Step {s.step}</span>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => onEdit(s.step)}
            className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#3a4460] hover:bg-slate-100 dark:hover:bg-[#2e3a55] hover:text-slate-800 dark:hover:text-slate-200 transition-all">
            <EditIcon /> Edit
          </button>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 py-1.5 border-b border-slate-50 dark:border-[#252d45] last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-black dark:text-slate-300 w-full sm:w-32 flex-shrink-0 pt-px" style={MONO}>{label}</span>
      <span className="text-[12px] text-slate-700 dark:text-slate-300 flex-1 break-all">{value || <span className="text-slate-300 dark:text-slate-600 italic">—</span>}</span>
    </div>
  );
}

// ── FieldRowRO ─────────────────────────────────────────────────────────────────
function FieldRowRO({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center border-b border-slate-100 dark:border-[#2a3147] last:border-b-0">
      <div className="w-44 shrink-0 px-3 py-2 bg-slate-100 dark:bg-[#1e2235] border-r border-slate-200 dark:border-[#2a3147]">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300" style={MONO}>{label}</span>
      </div>
      <div className="flex-1 px-3 py-1.5 bg-slate-50 dark:bg-[#181d30]">
        <span className={`text-[11.5px] ${mono ? "font-mono" : ""} ${value ? "text-sky-700 dark:text-sky-400 font-semibold" : "text-slate-400 dark:text-slate-600 italic"}`}>{value || "—"}</span>
      </div>
    </div>
  );
}

// ── SectionLabel ───────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-700/40 px-2 py-0.5 rounded" style={MONO}>{children}</span>
  );
}

// ── formatExampleNoteDisplay ───────────────────────────────────────────────────
function formatExampleNoteDisplay(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s*(Example\s*:)/gi, "\n$1\n").replace(/\s*(Notes?\s*:)/gi, "\n$1\n");
  const lines = normalized.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const match = line.match(/^(Example\s*:|Notes?\s*:)(.*)$/i);
    if (!match) return <React.Fragment key={index}>{index > 0 ? "\n" : ""}{line}</React.Fragment>;
    return <React.Fragment key={index}>{index > 0 ? "\n" : ""}<span className="font-semibold">{match[1]}</span>{match[2] ?? ""}</React.Fragment>;
  });
}

// ── Scope RO Table ─────────────────────────────────────────────────────────────
function ScopeReadOnlyTable({ scopeData }: { scopeData?: Record<string, unknown> }) {
  const rows = buildScopeRows(scopeData);
  const extra = hasExtraCols(rows);
  if (rows.length === 0) return <p className="text-[12px] text-slate-400 dark:text-slate-600 italic py-6 text-center">No scope documents defined</p>;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden -mx-4">
      <div className="tbl-scroll">
        <table className="w-full text-[11.5px]" style={{ minWidth: 860 }}>
          <thead>
            <tr className="bg-slate-100 dark:bg-[#1e2235]">
              <th rowSpan={2} className={`${TH_BASE} w-[180px]`} style={MONO}>Document Title</th>
              <th rowSpan={2} className={`${TH_BASE} w-[120px]`} style={MONO}>Reference Link</th>
              <th rowSpan={2} className={`${TH_BASE} w-[160px]`} style={MONO}>Content URL</th>
              <th colSpan={2} className={`${TH_BASE} text-center bg-slate-200/60 dark:bg-[#252d45]`} style={MONO}>Issuing Agency</th>
              <th rowSpan={2} className={`${TH_BASE} w-[130px]`} style={MONO}>SME Comments</th>
              {extra.evergreen && <th rowSpan={2} className={`${TH_BASE} w-[90px]`} style={MONO}>Initial / Evergreen</th>}
              {extra.ingestion && <th rowSpan={2} className={`${TH_BASE} w-[110px]`} style={MONO}>Date of Ingestion</th>}
            </tr>
            <tr className="bg-slate-100 dark:bg-[#1e2235]">
              <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-[0.08em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147] w-[140px] bg-slate-200/60 dark:bg-[#252d45]/70" style={MONO}>Issuing Authority</th>
              <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-[0.08em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147] w-[100px] bg-slate-200/60 dark:bg-[#252d45]/70" style={MONO}>ASRB ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
            {rows.map((row, idx) => {
              const oos = row.isOutOfScope;
              return (
                <tr key={row.id} className={`${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} ${oos ? "opacity-60" : ""}`}>
                  <td className={CELL}><span className={`font-medium text-[11.5px] text-slate-800 dark:text-slate-300 ${oos ? "line-through text-slate-400 dark:text-slate-600" : ""}`}>{row.title || <span className="text-slate-300 dark:text-slate-600 italic" style={{ textDecoration: "none" }}>—</span>}</span></td>
                  <td className={CELL}>{row.referenceLink ? <a href={row.referenceLink} target="_blank" rel="noreferrer" className={`text-blue-600 dark:text-blue-400 hover:underline text-[11px] break-all ${oos ? "line-through" : ""}`}>{row.referenceLink}</a> : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}</td>
                  <td className={CELL}>{row.contentUrl ? <a href={row.contentUrl} target="_blank" rel="noreferrer" className={`text-blue-600 dark:text-blue-400 hover:underline text-[11px] break-all ${oos ? "line-through" : ""}`}>{row.contentUrl}</a> : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}</td>
                  <td className={CELL}><span className={`text-[11.5px] text-slate-700 dark:text-slate-400 ${oos ? "line-through" : ""}`}>{row.issuingAuth || <span className="text-slate-300 dark:text-slate-600 italic" style={{ textDecoration: "none" }}>—</span>}</span></td>
                  <td className={CELL}>{row.asrbId ? <span className={`font-mono text-[11px] text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] px-2 py-0.5 rounded ${oos ? "line-through" : ""}`}>{row.asrbId}</span> : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}</td>
                  <td className={CELL}><span className={`text-[11.5px] text-slate-700 dark:text-slate-400 ${oos ? "line-through" : ""}`}>{row.smeComments || <span className="text-slate-300 dark:text-slate-600 italic" style={{ textDecoration: "none" }}>—</span>}</span></td>
                  {extra.evergreen && <td className={CELL}><span className={`text-[11.5px] text-slate-700 dark:text-slate-400 ${oos ? "line-through" : ""}`}>{row.initialEvergreen || "—"}</span></td>}
                  {extra.ingestion && <td className={CELL}><span className={`text-[11.5px] text-slate-700 dark:text-slate-400 ${oos ? "line-through" : ""}`}>{row.dateOfIngestion || "—"}</span></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147] flex items-center justify-between">
        <p className="text-[10.5px] text-slate-500 dark:text-slate-600 m-0" style={MONO}>{rows.length} {rows.length === 1 ? "document" : "documents"}{rows.filter(r => r.isOutOfScope).length > 0 && ` · ${rows.filter(r => r.isOutOfScope).length} out of scope`}</p>
        {rows.filter(r => r.isOutOfScope).length > 0 && <span className="text-[10px] text-slate-400 dark:text-slate-600 italic" style={MONO}>Strikethrough = out of scope</span>}
      </div>
    </div>
  );
}

// ── TOC RO Table ───────────────────────────────────────────────────────────────
function TocReadOnlyTable({ tocData }: { tocData?: Record<string, unknown> }) {
  const rows = buildTocRows(tocData);
  if (rows.length === 0) return <p className="text-[12px] text-slate-400 dark:text-slate-600 italic py-6 text-center">No TOC sections defined</p>;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden -mx-4">
      <div className="tbl-scroll">
        <table className="w-full border-collapse" style={{ minWidth: "1100px" }}>
          <thead>
            <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
              {TOC_COLUMNS.map(col => (
                <th key={col.key} className={`${col.width} ${TH_TOC}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-black dark:text-slate-400">{col.icon}</span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={MONO}>{col.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
            {rows.map((row, idx) => (
              <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"}>
                <td className={`w-20 ${CELL_TOC}`}><LevelBadgeToc val={row.level} /></td>
                <td className={`w-40 ${CELL_TOC}`}><span className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{row.name || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                <td className={`w-28 ${CELL_TOC}`}><RequiredBadge val={row.required} /></td>
                <td className={`w-52 ${CELL_TOC}`}><span className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{row.definition || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                <td className={`w-48 ${CELL_TOC}`}><span className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{row.example || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                <td className={`w-44 ${CELL_TOC}`}><span className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{row.note || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                <td className={`w-52 ${CELL_TOC}`}><span className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{row.tocRequirements || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                <td className={`w-48 ${CELL_TOC}`}><span className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{row.smeComments || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
        <p className="text-[10.5px] text-slate-500 dark:text-slate-600 m-0" style={MONO}>{rows.length} section{rows.length !== 1 ? "s" : ""}</p>
      </div>
    </div>
  );
}

// ── Whitespace RO Table ───────────────────────────────────────────────────────
function WhitespaceReadOnlyTable({ rows }: {
  rows: WhitespaceRow[];
}) {

  return (
    <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
      <div className="tbl-scroll">
        <table className="w-full border-collapse" style={{ minWidth: "520px" }}>
          <thead>
            <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
              {CP_WS_COLS.map(col => (
                <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={MONO}>{col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-8 text-center text-[12px] text-slate-400 dark:text-slate-600 italic">No whitespace rules</td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"}>
                  <td className="w-44 px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]">
                    <span className="text-[11px] font-mono text-violet-700 dark:text-violet-400 whitespace-pre-wrap break-words">{row.tags || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</span>
                  </td>
                  <td className="flex-1 px-3 py-2 align-top">
                    <span className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{row.innodReplace || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
        <p className="text-[10.5px] text-slate-500 dark:text-slate-600 m-0" style={MONO}>{rows.length} rule{rows.length !== 1 ? "s" : ""}</p>
      </div>
    </div>
  );
}

// ── Content Profile RO ─────────────────────────────────────────────────────────
function ContentProfileReadOnly({ cpData }: { cpData?: Record<string, unknown> }) {
  const levels = useMemo(() => asExtractedLevels(cpData), [cpData]);
  const hardcodedPath = useMemo(() => deriveHardcodedPath(levels), [levels]);

  const rcFilename       = String(cpData?.rc_filename ?? "");
  const headingAnnotation = String(cpData?.heading_annotation ?? "");

  const wsRows = useMemo(() => {
    const extracted = asExtractedWhitespace(cpData);
    return extracted.length > 0 ? extracted : DEFAULT_WHITESPACE_ROWS;
  }, [cpData]);

  return (
    <div className="space-y-5">
      {/* Top fields */}
      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <FieldRowRO label="RC Filename"        value={rcFilename}        mono />
        <FieldRowRO label="Hardcoded Path"     value={hardcodedPath}     mono />
        <FieldRowRO label="Heading Annotation" value={headingAnnotation} />
      </div>

      {/* Level Numbers table */}
      <div className="space-y-2">
        <SectionLabel>Level Numbers</SectionLabel>
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="tbl-scroll">
            <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                  {CP_LEVEL_COLS.map(col => (
                    <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={MONO}>{col.label}</span>
                        {col.key === "redjayXmlTag" && <span className="text-[9px] text-sky-500 dark:text-sky-600">⚡ auto</span>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]">
                {levels.length === 0
                  ? <tr><td colSpan={CP_LEVEL_COLS.length} className="py-8 text-center text-[12px] text-slate-400 dark:text-slate-600 italic">No levels defined</td></tr>
                  : levels.map((row, idx) => (
                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"}>
                      <td className="w-24 px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]"><span className="text-[11px] text-slate-700 dark:text-slate-300 font-mono">{row.levelNumber || "—"}</span></td>
                      <td className="w-72 px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]"><span className={`text-[11px] leading-snug whitespace-pre-line ${row.description.startsWith("Required: True") ? "text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}>{row.description || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                      <td className="flex-1 px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]"><span className={`text-[11px] leading-snug whitespace-pre-line font-mono select-all ${row.redjayXmlTag === "Hardcoded" ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-sky-700 dark:text-sky-400"}`}>{row.redjayXmlTag || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</span></td>
                      <td className="w-52 px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]"><span className="text-[11px] font-mono text-slate-700 dark:text-slate-300">{row.path || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</span></td>
                      <td className="w-52 px-3 py-2 align-top"><span className="text-[11px] text-slate-700 dark:text-slate-300">{row.remarksNotes || <span className="text-slate-400 dark:text-slate-600 italic">—</span>}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Whitespace Handling */}
      <div className="space-y-2">
        <SectionLabel>Whitespace Handling</SectionLabel>
        <WhitespaceReadOnlyTable rows={wsRows} />
      </div>
    </div>
  );
}

// ── Citation Table ─────────────────────────────────────────────────────────────
function CitationTable({ citationsData }: { citationsData?: Record<string, unknown> }) {
  const citations = asRecordArray(citationsData?.references);
  if (citations.length === 0) return <p className="text-[12px] text-slate-400 dark:text-slate-600 italic py-6 text-center">No citation rules defined</p>;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden -mx-4">
      <div className="tbl-scroll">
        <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: 600 }}>
          <thead>
            <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
              {["Lvl", "Citation Rules", "Source of Law", "SME Comments"].map(h => (
                <th key={h} className="px-4 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-black dark:text-slate-300 whitespace-nowrap border-r border-slate-200 dark:border-[#2a3147] last:border-r-0" style={MONO}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-[#252d45]" style={{ fontWeight: 400 }}>
            {citations.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-[#1a1f35]/40"}>
                <td className="px-4 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]"><LevelBadgeToc val={asString(row.level)} /></td>
                <td className="px-4 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] text-slate-700 dark:text-slate-300 break-words">{formatExampleNoteDisplay(asString(row.citationRules)) || "—"}</td>
                <td className="px-4 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{asString(row.sourceOfLaw) || "—"}</td>
                <td className="px-4 py-2 align-top text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{formatExampleNoteDisplay(asString(row.smeComments))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Generate button ────────────────────────────────────────────────────────────
function GenerateBtn({ label, icon, description, color, onClick, loading, done }: {
  label: string; icon: string; description: string;
  color: "slate" | "blue" | "violet" | "indigo";
  onClick: () => void; loading: boolean; done: boolean;
}) {
  const btnStyles: Record<string, string> = {
    slate: "bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 ring-slate-200 dark:ring-slate-700",
    blue: "bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 ring-blue-100 dark:ring-blue-900/40",
    violet: "bg-violet-600 hover:bg-violet-700 dark:hover:bg-violet-500 ring-violet-100 dark:ring-violet-900/40",
    indigo: "bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 ring-indigo-100 dark:ring-indigo-900/40",
  };
  return (
    <div className={`flex-1 rounded-xl border-2 transition-all p-3.5 flex flex-col gap-3 ${done ? "border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/40 dark:bg-emerald-500/5" : "border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1e2235]"}`}>
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${done ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-slate-100 dark:bg-[#252d45]"}`}>
          {done ? <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg> : icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[11.5px] font-semibold leading-tight ${done ? "text-emerald-700 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"}`}>{label}</p>
          <p className="text-[10.5px] text-slate-500 dark:text-slate-500 mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
      <button onClick={onClick} disabled={loading || done}
        className={`w-full py-1.5 rounded-lg text-[11.5px] font-semibold text-white transition-all ring-4 ${btnStyles[color]} disabled:opacity-40 disabled:cursor-not-allowed`}>
        {loading
          ? <span className="flex items-center justify-center gap-2"><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>Generating…</span>
          : done ? "Generated ✓" : label}
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Generate({ brdId, title, initialData, onEdit, onComplete, canEdit = true }: Props) {
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [done, setDone]             = useState<Record<string, boolean>>({});

  const scopeData          = asRecord(initialData?.scope);
  const metadataData       = asRecord(initialData?.metadata);
  const tocData            = asRecord(initialData?.toc);
  const citationsData      = asRecord(initialData?.citations);
  const contentProfileData = asRecord(initialData?.contentProfile);

  const inScopeRows = asRecordArray(scopeData?.in_scope);
  const metadataValues = {
    sourceType:      asString(metadataData?.version || metadataData?.source_type),
    issuingAgency:   asString(metadataData?.issuing_agency),
    geography:       asString(metadataData?.geography),
    language:        asString(metadataData?.language),
    publicationDate: asString(metadataData?.publication_date),
    lastUpdatedDate: asString(metadataData?.last_updated_date),
    status:          asString(metadataData?.status),
    payloadType:     asString(metadataData?.payload_type || metadataData?.payload_subtype || metadataData?.version),
    contentUrl:      asString(metadataData?.content_uri || metadataData?.content_url || inScopeRows[0]?.content_url),
  };

  function runGenerate(key: string) {
    setGenerating(p => ({ ...p, [key]: true }));
    setTimeout(() => { setGenerating(p => ({ ...p, [key]: false })); setDone(p => ({ ...p, [key]: true })); }, 3000);
  }
  const allDone = done["brd"] && done["metajson"] && done["innod"] && done["content"];
  const noop = () => {};

  return (
    <div className="space-y-4">
      <AssistiveTouch />

      {/* Active BRD */}
      <div className="rounded-xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-black dark:text-slate-300 flex-shrink-0" style={MONO}>Active BRD</span>
            <span className="font-mono text-[10.5px] bg-slate-100 dark:bg-[#252d45] border border-slate-200 dark:border-[#3a4460] px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 flex-shrink-0">{brdId ?? "BRD"}</span>
            {title && <span className="text-[11.5px] text-slate-800 dark:text-slate-300 truncate">{title}</span>}
          </div>
        </div>
      </div>

      {/* 1. Scope */}
      <SectionCard styleIdx={0} onEdit={onEdit ?? noop} canEdit={canEdit} id="section-scope">
        <ScopeReadOnlyTable scopeData={scopeData} />
      </SectionCard>

      {/* 2. Metadata */}
      <SectionCard styleIdx={1} onEdit={onEdit ?? noop} canEdit={canEdit} id="section-metadata">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8">
          <Field label="Source Type"    value={metadataValues.sourceType} />
          <Field label="Issuing Agency" value={metadataValues.issuingAgency} />
          <Field label="Geography"      value={metadataValues.geography} />
          <Field label="Language"       value={metadataValues.language} />
          <Field label="Pub. Date"      value={metadataValues.publicationDate} />
          <Field label="Last Updated"   value={metadataValues.lastUpdatedDate} />
          <Field label="Status"         value={metadataValues.status} />
          <Field label="Payload Type"   value={metadataValues.payloadType} />
          <Field label="Content URL"    value={metadataValues.contentUrl} />
        </div>
      </SectionCard>

      {/* 3. TOC */}
      <SectionCard styleIdx={2} onEdit={onEdit ?? noop} canEdit={canEdit} id="section-toc">
        <TocReadOnlyTable tocData={tocData} />
      </SectionCard>

      {/* 4. Citations */}
      <SectionCard styleIdx={3} onEdit={onEdit ?? noop} canEdit={canEdit} id="section-citations">
        <CitationTable citationsData={citationsData} />
      </SectionCard>

      {/* 5. Content Profile */}
      <SectionCard styleIdx={4} onEdit={onEdit ?? noop} canEdit={canEdit} id="section-content-profile">
        <ContentProfileReadOnly cpData={contentProfileData} />
      </SectionCard>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-[#2a3147] to-transparent"/>

      {/* Generate outputs */}
      <div id="section-generate" className="scroll-mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-black dark:text-slate-300 mb-3" style={MONO}>Generate Outputs</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <GenerateBtn label="Generate BRD" icon="✦" description="Compile all sections into the final BRD document" color="slate" onClick={() => runGenerate("brd")} loading={!!generating["brd"]} done={!!done["brd"]}/>
          <GenerateBtn label="Generate Metajson" icon="≡" description="Export metadata as structured JSON in the selected schema" color="blue" onClick={() => runGenerate("metajson")} loading={!!generating["metajson"]} done={!!done["metajson"]}/>
          <GenerateBtn label="Generate Metajson for Innod.Xml" icon="◇" description="Build Innod-compatible XML metadata JSON output" color="indigo" onClick={() => runGenerate("innod")} loading={!!generating["innod"]} done={!!done["innod"]}/>
          <GenerateBtn label="Generate Content Profile" icon="⬡" description="Build the XML content profile with level and whitespace rules" color="violet" onClick={() => runGenerate("content")} loading={!!generating["content"]} done={!!done["content"]}/>
        </div>
      </div>

      {/* All done */}
      {allDone && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-700/40">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p className="text-[12.5px] font-medium text-emerald-800 dark:text-emerald-400">All outputs generated — <span className="font-bold">{brdId ?? "BRD"}</span> is ready</p>
          </div>
          <button onClick={onComplete} className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20">
            Back to Registry
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}