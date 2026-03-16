import React, { useMemo, useState, useEffect, useRef } from "react";
import api from "@/app/lib/api";
import SimpleMetajson from "@/components/brd/simplemetajson";
import InnodMetajson from "@/components/brd/innodmetajson";

// ── Cell image types ───────────────────────────────────────────────────────────
interface CellImageMeta {
  id:         number;
  tableIndex: number;
  rowIndex:   number;
  colIndex:   number;
  rid:        string;
  mediaName:  string;
  mimeType:   string;
  cellText:   string;
  blobUrl:    string | null;
  section:    string;
  fieldLabel: string;
}

// ── useCellImages hook ─────────────────────────────────────────────────────────
function useCellImages(brdId?: string) {
  const [images,  setImages]  = useState<CellImageMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!brdId) return;
    setLoading(true);
    setError(null);
    api
      .get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images`)
      .then(r => {
        console.log(`[useCellImages] Fetched ${r.data.images?.length || 0} images for BRD ${brdId}`);
        setImages(r.data.images ?? []);
      })
      .catch((err) => {
        console.error("[useCellImages] Error fetching images:", err);
        setError("Could not load images");
      })
      .finally(() => setLoading(false));
  }, [brdId]);

  return { images, loading, error };
}

// ── InlineImageCell component for displaying images in table cells ────────────
function InlineImageCell({ brdId, image }: { brdId?: string; image: CellImageMeta }) {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  if (!brdId) return null;
  const imgSrc = image.blobUrl || `${API_BASE}/brd/${brdId}/images/${image.id}/blob`;
  return (
    <img
      src={imgSrc}
      alt={image.cellText || image.mediaName}
      className="mt-1 max-w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f35]"
      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

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

function deriveTitle(metadata: Record<string, unknown> | undefined, fallback: string | undefined): string {
  if (!metadata) return fallback || "Untitled BRD";
  const t = (k: string) => (typeof metadata[k] === "string" ? (metadata[k] as string).trim() : "");

  const catName  = t("content_category_name") || t("source_name");
  const docTitle = t("document_title");

  if (catName && docTitle) {
    const catL = catName.toLowerCase();
    const docL = docTitle.toLowerCase();
    // If one contains the other, use the longer (more specific) one
    const isRedundant = catL === docL || catL.includes(docL) || docL.includes(catL);
    if (isRedundant) {
      return catName.length >= docTitle.length ? catName : docTitle;
    }
    return `${catName} - ${docTitle}`;
  }

  return catName || docTitle || fallback || "Untitled BRD";
}

function buildTemplateMetadataValues(format: Format, metadata?: Record<string, unknown>): Record<string, string> {
  if (!metadata) return {};
  const t = (key: string): string => (typeof metadata[key] === "string" ? String(metadata[key]).trim() : "");
  if (format === "old") {
    return {
      // Legacy "Source Name" label → stored as content_category_name by extractor
      sourceName:           t("content_category_name") || t("source_name") || t("document_title"),
      // Legacy "Authoritative Source" label → stored as authoritative_source (and mirrored to issuing_agency)
      authoritativeSource:  t("authoritative_source") || t("issuing_agency"),
      sourceType:           t("source_type"),
      publicationDate:      t("publication_date"),
      lastUpdatedDate:      t("last_updated_date"),
      processingDate:       t("processing_date"),
      issuingAgency:        t("issuing_agency"),
      contentUrl:           t("content_uri"),
      geography:            t("geography"),
      language:             t("language"),
      payloadSubtype:       t("payload_subtype"),
      status:               t("status"),
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
      return {
        id: `${ts}-${i}`,
        level: level.trim(),
        name: asString(s.name),
        required: mapRequiredValue(asString(s.required)),
        definition: asString(s.definition),
        example: asString(s.example),
        note: asString(s.note),
        tocRequirements: asString(s.tocRequirements),
        smeComments: asString(s.smeComments),
      };
    })
    .sort((a, b) => (parseInt(a.level) || 0) - (parseInt(b.level) || 0));
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

const MONO  = { fontFamily: "'DM Mono', monospace" } as const;
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

const GenBtnIcons: Record<string, React.ReactNode> = {
  brd: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="2" width="14" height="16" rx="2" /><path d="M7 7h6M7 10h6M7 13h4" strokeLinecap="round" /></svg>),
  metajson: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><path d="M5 4C5 4 3 5 3 10s2 6 2 6M15 4s2 1 2 6-2 6-2 6M8 7l-2 3 2 3M12 7l2 3-2 3" strokeLinecap="round" strokeLinejoin="round" /></svg>),
  innod: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><path d="M10 3v14M6 6l4-3 4 3M6 14l4 3 4-3" strokeLinecap="round" strokeLinejoin="round" /><rect x="7" y="8" width="6" height="4" rx="1" /></svg>),
  content: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M6 8h8M6 11h5" strokeLinecap="round" /><circle cx="14" cy="13" r="2.5" /><path d="M16 15l1.5 1.5" strokeLinecap="round" /></svg>),
};

// ── Helper: find the app's actual scroll container ──────────────────────────
function getScrollContainer(): HTMLElement {
  const explicit = document.querySelector<HTMLElement>("[data-scroll-container]");
  if (explicit) return explicit;

  const overflowScrollable = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    const overflow = style.overflow + style.overflowY;
    return /(auto|scroll)/.test(overflow) && el.scrollHeight > el.clientHeight + 1;
  };

  for (const sel of ["main", "article", "#__next > div", "#root > div", "body > div"]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && overflowScrollable(el)) return el;
  }

  const allDivs = Array.from(document.querySelectorAll<HTMLElement>("div"));
  for (const el of allDivs) {
    if (overflowScrollable(el)) return el;
  }

  return document.scrollingElement as HTMLElement || document.documentElement;
}

function AssistiveTouch() {
  const [open, setOpen]             = useState(false);
  const [activeId, setActiveId]     = useState<string>("");
  const [pos, setPos]               = useState(() => ({ x: Math.max(12, window.innerWidth - 72), y: Math.max(12, window.innerHeight / 2) }));
  const [dragging, setDragging]     = useState(false);
  const [didDrag, setDidDrag]       = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const btnRef    = useRef<HTMLDivElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollEl = getScrollContainer();
    function onScroll() {
      setShowScrollTop(scrollEl.scrollTop > 200);
    }
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      const SZ = 52;
      setPos(p => { const maxY = window.innerHeight - SZ - 12; const cx = p.x + SZ / 2; const snapX = cx < window.innerWidth / 2 ? 12 : Math.max(12, window.innerWidth - SZ - 12); return { x: snapX, y: Math.min(Math.max(12, p.y), maxY) }; });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const ids = NAV_ITEMS.map(n => n.id);
    const visibleMap: Record<string, number> = {};
    const scrollEl = getScrollContainer();
    const root = scrollEl === document.documentElement || scrollEl === document.body
      ? null
      : scrollEl;
    const observers = ids.map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(([entry]) => {
        visibleMap[id] = entry.intersectionRatio;
        const best = Object.entries(visibleMap).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActiveId(best[0]);
      }, { root, threshold: [0, 0.1, 0.5, 1] });
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, []);

  function onPointerDown(e: React.PointerEvent) { if (open) return; e.currentTarget.setPointerCapture(e.pointerId); dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }; setDragging(true); setDidDrag(false); }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx; const dy = e.clientY - dragStart.current.my;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setDidDrag(true);
    const SZ = 52;
    setPos({ x: Math.max(0, Math.min(window.innerWidth - SZ, dragStart.current.px + dx)), y: Math.max(0, Math.min(window.innerHeight - SZ, dragStart.current.py + dy)) });
  }
  function onPointerUp(_e: React.PointerEvent) {
    if (!dragStart.current) return; dragStart.current = null; setDragging(false);
    const SZ = 52; const cx = pos.x + SZ / 2;
    setPos(p => ({ ...p, x: cx < window.innerWidth / 2 ? 12 : window.innerWidth - SZ - 12 }));
    if (!didDrag) setOpen(o => !o);
  }
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) { if (menuRef.current?.contains(e.target as Node)) return; if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }
    setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function scrollTo(id: string) {
    const scrollEl = getScrollContainer();
    const target = document.getElementById(id);
    if (target) {
      const containerRect = scrollEl === document.documentElement
        ? { top: 0 }
        : scrollEl.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset = scrollEl.scrollTop + (targetRect.top - containerRect.top) - 80;
      scrollEl.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
    }
    setActiveId(id);
    setOpen(false);
  }

  function scrollToTop() {
    const scrollEl = getScrollContainer();
    scrollEl.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    setShowScrollTop(false);
    setOpen(false);
  }

  const SZ = 52; const onRight = pos.x + SZ / 2 > window.innerWidth / 2;
  const menuX = onRight ? Math.max(8, pos.x - 216 - 8) : Math.min(pos.x + SZ + 8, window.innerWidth - 216 - 8);
  const menuTop = Math.min(Math.max(8, pos.y), window.innerHeight - 440);
  const colorMap: Record<string, { dot: string; bg: string; text: string; hover: string }> = {
    blue:    { dot: "bg-blue-500",    bg: "bg-blue-50 dark:bg-blue-500/10",      text: "text-blue-700 dark:text-blue-300",    hover: "hover:bg-blue-50 dark:hover:bg-blue-500/10"    },
    violet:  { dot: "bg-violet-500",  bg: "bg-violet-50 dark:bg-violet-500/10",  text: "text-violet-700 dark:text-violet-300", hover: "hover:bg-violet-50 dark:hover:bg-violet-500/10" },
    indigo:  { dot: "bg-indigo-500",  bg: "bg-indigo-50 dark:bg-indigo-500/10",  text: "text-indigo-700 dark:text-indigo-300", hover: "hover:bg-indigo-50 dark:hover:bg-indigo-500/10" },
    amber:   { dot: "bg-amber-500",   bg: "bg-amber-50 dark:bg-amber-500/10",    text: "text-amber-700 dark:text-amber-300",   hover: "hover:bg-amber-50 dark:hover:bg-amber-500/10"   },
    emerald: { dot: "bg-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10",text: "text-emerald-700 dark:text-emerald-300",hover: "hover:bg-emerald-50 dark:hover:bg-emerald-500/10"},
    slate:   { dot: "bg-slate-500",   bg: "bg-slate-100 dark:bg-[#252d45]",      text: "text-slate-700 dark:text-slate-300",   hover: "hover:bg-slate-100 dark:hover:bg-[#252d45]"    },
  };

  return (
    <>
      <style>{`@keyframes at-pop{0%{transform:scale(0.7) rotate(-10deg);opacity:0}60%{transform:scale(1.08) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}@keyframes at-menu-in{from{opacity:0;transform:scale(0.94) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes at-item-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}.at-btn-ring{box-shadow:0 0 0 3px rgba(100,116,139,.15),0 8px 32px rgba(0,0,0,.18)}.at-btn-ring-open{box-shadow:0 0 0 4px rgba(99,102,241,.25),0 8px 32px rgba(0,0,0,.22)}`}</style>
      <div ref={btnRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        style={{ position:"fixed", left:pos.x, top:pos.y, width:SZ, height:SZ, zIndex:9999, cursor:dragging?"grabbing":"grab", transition:dragging?"none":"left 0.3s cubic-bezier(0.34,1.56,0.64,1),top 0.15s ease", userSelect:"none", touchAction:"none" }}>
        <div className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-200 select-none ${open?"at-btn-ring-open":"at-btn-ring"}`}
          style={{ animation:"at-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both", background:open?"#1e293b":"rgba(255,255,255,0.95)" }}>
          {open ? <svg className="w-5 h-5" fill="none" stroke="#ffffff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
            : <div className="flex flex-col items-center justify-center gap-[4px]"><span className="block w-[17px] h-[2px] rounded-full" style={{background:"#334155"}}/><span className="block w-[17px] h-[2px] rounded-full" style={{background:"#334155"}}/><span className="block w-[11px] h-[2px] rounded-full" style={{background:"#334155"}}/></div>}
        </div>
        {!open && activeId && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white dark:border-[#1e2235]"/>}
      </div>
      {open && (
        <div ref={menuRef} style={{ position:"fixed", left:menuX, top:menuTop, width:216, zIndex:9998, animation:"at-menu-in 0.2s cubic-bezier(0.16,1,0.3,1) both" }}>
          <div className="rounded-2xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] shadow-2xl overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#181d30] border-b border-slate-100 dark:border-[#2a3147] flex items-center justify-between">
              <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"/><span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Navigation</span></div>
              <span className="text-[8.5px] text-slate-300 dark:text-slate-600 italic" style={MONO}>drag to move</span>
            </div>
            <button onClick={scrollToTop} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left group transition-all border-b border-slate-100 dark:border-[#2a3147] ${showScrollTop?"bg-slate-800 dark:bg-slate-100":"hover:bg-slate-50 dark:hover:bg-[#252d45]/60"}`} style={{animation:"at-item-in 0.15s ease both"}}>
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${showScrollTop?"bg-white/20":"bg-slate-100 dark:bg-[#252d45]"}`}><svg className={`w-3.5 h-3.5 ${showScrollTop?"text-white dark:text-slate-900":"text-slate-600 dark:text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg></span>
              <span className="text-[11px] font-semibold flex-1" style={{...MONO,color:showScrollTop?"#ffffff":"#475569"}}>Back to Top</span>
            </button>
            <div className="py-1">
              {NAV_ITEMS.map((item, idx) => {
                const isActive = activeId === item.id; const isGen = item.id === "section-generate"; const c = colorMap[item.color ?? "slate"];
                return (
                  <React.Fragment key={item.id}>
                    {isGen && <div className="mx-3 my-1 h-px bg-slate-100 dark:bg-[#2a3147]"/>}
                    <button onClick={() => scrollTo(item.id)} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left group transition-all relative ${isActive?c.bg:c.hover}`} style={{animation:`at-item-in 0.15s ${0.04*idx}s ease both`}}>
                      {isActive && <span className={`absolute left-0 inset-y-0 w-[3px] rounded-r-full ${c.dot}`}/>}
                      <span className={`w-5 text-center text-[11px] font-bold flex-shrink-0 ${isActive?"scale-110":"group-hover:scale-105"}`} style={{...MONO,color:isActive?undefined:"#475569"}}>{item.icon}</span>
                      <span className={`text-[11px] flex-1 leading-tight ${isActive?`font-semibold ${c.text}`:"font-medium"}`} style={{...MONO,color:isActive?undefined:"#475569"}}>{item.label}</span>
                      {item.step && <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isActive?`${c.dot} text-white`:""}`} style={isActive?undefined:{color:"#94a3b8"}}>{item.step}</span>}
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

function RequiredBadge({ val }: { val: string }) {
  if (val === "true") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">true</span>;
  if (val === "false") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-[#2a3147]">false</span>;
  if (val === "Conditional") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40">Cond.</span>;
  return <span className="text-slate-300 dark:text-slate-600 text-[11px]">—</span>;
}
function LevelBadge({ val }: { val: string }) {
  const colors: Record<string, string> = {"0":"bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200","1":"bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200","2":"bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200","3":"bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200","4":"bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200","5":"bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200","6":"bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200"};
  const cls = colors[val] ?? "bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-400 border-slate-200";
  return <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-[11px] font-bold border ${cls}`} style={MONO}>{val}</span>;
}

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
        <button onClick={() => onEdit(s.step)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-[#3a4460] bg-white dark:bg-[#1e2235] hover:bg-slate-50 dark:hover:bg-[#252d45] hover:text-slate-700 dark:hover:text-slate-200 transition-all">
          <EditIcon /> Edit
        </button>
      )}
    </div>
  );
}

function DocBlock({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6" style={{ background:"var(--doc-bg, #fff)", border:"1px solid #e2e2dc", borderRadius:3, boxShadow:"0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04), 2px 2px 0 #f0ede8", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:28, right:28, height:1, background:"linear-gradient(90deg, transparent, #d6d0c8 20%, #d6d0c8 80%, transparent)" }}/>
      <div style={{ padding:"28px 32px 24px" }}>{children}</div>
    </div>
  );
}

function Empty() { return <p className="text-[12px] text-slate-400 dark:text-slate-600 italic py-4 text-center">No data defined</p>; }
function Nil()   { return <span className="text-slate-300 dark:text-slate-600 italic">—</span>; }

const TBL_WRAP = "tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]";
const TH = "px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 border-b border-r border-slate-200 dark:border-[#2a3147] last:border-r-0 bg-slate-50 dark:bg-[#1e2235] whitespace-nowrap";
const TD = "px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0 text-[11.5px] text-slate-700 dark:text-slate-300";

function ScopeTable({ scopeData, brdId, images }: { scopeData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const rows = buildScopeRows(scopeData); const extra = hasExtraCols(rows);
  if (rows.length === 0) return <Empty />;
  
  // Group scope images by fieldLabel for direct cell matching
  const imagesByLabel = new Map<string, CellImageMeta[]>();
  images.filter(img => img.section === "scope").forEach(img => {
    const key = (img.fieldLabel || img.cellText || "").toLowerCase().trim();
    if (!key) return;
    const arr = imagesByLabel.get(key) || [];
    arr.push(img);
    imagesByLabel.set(key, arr);
  });
  const getScopeImgs = (...texts: string[]) => {
    for (const t of texts) {
      const key = t.toLowerCase().trim();
      const found = imagesByLabel.get(key);
      if (found?.length) return found;
    }
    return [];
  };
  
  return (
    <div className={TBL_WRAP}>
      <table className="w-full text-[11.5px]" style={{ minWidth: 860, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 180 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 200 }} />
          {extra.evergreen && <col style={{ width: 80 }} />}
          {extra.ingestion && <col style={{ width: 100 }} />}
        </colgroup>
        <thead><tr>
          <th className={TH}>Document Title</th>
          <th className={TH}>Reference Link</th>
          <th className={TH}>Content URL</th>
          <th className={TH}>Issuing Authority</th>
          <th className={TH}>ASRB ID</th>
          <th className={TH}>SME Comments</th>
          {extra.evergreen && <th className={TH}>Evergreen</th>}
          {extra.ingestion && <th className={TH}>Date of Ingestion</th>}
        </tr></thead>
        <tbody>
          {rows.map((row, i) => {
            const oos = row.isOutOfScope;
            const rowImages = getScopeImgs(row.title, row.smeComments);
            return (
              <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"} style={{opacity:oos?0.55:1}}>
                <td className={TD} style={{wordBreak:"break-word"}}>
                  <span className={oos?"line-through":""}>{row.title||<Nil/>}</span>
                  {rowImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                </td>
                <td className={TD}>
                  {row.referenceLink
                    ? <a href={row.referenceLink} target="_blank" rel="noreferrer"
                        className={`text-blue-600 dark:text-blue-400 hover:underline text-[11px] block truncate ${oos?"line-through":""}`}
                        title={row.referenceLink}>{row.referenceLink}</a>
                    : <Nil/>}
                </td>
                <td className={TD}>
                  {row.contentUrl
                    ? <a href={row.contentUrl} target="_blank" rel="noreferrer"
                        className={`text-blue-600 dark:text-blue-400 hover:underline text-[11px] block truncate ${oos?"line-through":""}`}
                        title={row.contentUrl}>{row.contentUrl}</a>
                    : <Nil/>}
                </td>
                <td className={TD} style={{wordBreak:"break-word"}}><span className={oos?"line-through":""}>{row.issuingAuth||<Nil/>}</span></td>
                <td className={TD}>{row.asrbId?<span className="font-mono text-[10.5px] bg-slate-100 dark:bg-[#1e2235] px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#2a3147]">{row.asrbId}</span>:<Nil/>}</td>
                <td className={TD} style={{wordBreak:"break-word", whiteSpace:"pre-wrap"}}>
                  <span className={oos?"line-through":""}>{row.smeComments||<Nil/>}</span>
                </td>
                {extra.evergreen && <td className={TD}>{row.initialEvergreen||"—"}</td>}
                {extra.ingestion && <td className={TD}>{row.dateOfIngestion||"—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-8 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147] flex justify-between items-center">
        <span className="text-[10px] text-slate-400" style={MONO}>{rows.length} document{rows.length!==1?"s":""}{rows.filter(r=>r.isOutOfScope).length>0&&` · ${rows.filter(r=>r.isOutOfScope).length} out of scope`}</span>
        {rows.filter(r=>r.isOutOfScope).length>0&&<span className="text-[9.5px] italic text-slate-400" style={MONO}>Strikethrough = out of scope</span>}
      </div>
    </div>
  );
}

function MetaGrid({ values, format, brdId, images }: { values: Record<string, string>; format: Format; brdId?: string; images: CellImageMeta[] }) {
  const fields = format === "old"
    ? [{label:"Source Name",key:"sourceName"},{label:"Source Type",key:"sourceType"},{label:"Publication Date",key:"publicationDate"},{label:"Last Updated Date",key:"lastUpdatedDate"},{label:"Processing Date",key:"processingDate"},{label:"Issuing Agency",key:"issuingAgency"},{label:"Content URL",key:"contentUrl"},{label:"Geography",key:"geography"},{label:"Language",key:"language"},{label:"Payload Subtype",key:"payloadSubtype"},{label:"Status",key:"status"}]
    : [{label:"Content Category Name",key:"contentCategoryName"},{label:"Publication Date",key:"publicationDate"},{label:"Last Updated Date",key:"lastUpdatedDate"},{label:"Processing Date",key:"processingDate"},{label:"Issuing Agency",key:"issuingAgency"},{label:"Related Government Agency",key:"relatedGovernmentAgency"},{label:"Content URI",key:"contentUri"},{label:"Geography",key:"geography"},{label:"Language",key:"language"}];

  // tableIndex=5 is the metadata table: col0=label, col1=value(Document Location)
  const metaImgs = images.filter(img =>
    img.section === "metadata" ||
    ((!img.section || img.section === "unknown") && img.tableIndex === 5)
  );
  const imagesByLabel = new Map<string, CellImageMeta[]>();
  const imagesByMetaRow = new Map<number, CellImageMeta[]>();
  metaImgs.forEach(img => {
    // New records: keyed by fieldLabel
    const fl = (img.fieldLabel || "").toLowerCase().trim();
    if (fl) {
      const arr = imagesByLabel.get(fl) || [];
      arr.push(img);
      imagesByLabel.set(fl, arr);
    }
    // Old records: keyed by rowIndex
    const ri = imagesByMetaRow.get(img.rowIndex) || [];
    ri.push(img);
    imagesByMetaRow.set(img.rowIndex, ri);
  });

  return (
    <div className="tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]">
      <table className="w-full text-[11.5px]"><tbody>
        {fields.map((f, i) => {
          // Try fieldLabel first, then rowIndex fallback (metadata header = row 0, data from row 1)
          const byLabel = imagesByLabel.get(f.label.toLowerCase()) || [];
          const rowImages = byLabel.length > 0 ? byLabel : (imagesByMetaRow.get(i + 1) || []);
          return (
            <tr key={f.key} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
              <td className="px-3 py-2 w-36 border-r border-slate-100 dark:border-[#2a3147] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 align-middle whitespace-nowrap" style={MONO}>{f.label}</td>
              <td className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300">
                {values[f.key] || <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
                {rowImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
              </td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

function TocTable({ tocData, brdId, images }: { tocData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const rows = buildTocRows(tocData);
  if (rows.length === 0) return <Empty />;
  
  const TOC_COL_MAP: Record<number,string> = {0:"level",1:"name",2:"required",3:"definition",4:"example",5:"note",6:"tocRequirements",7:"smeComments"};
  // Include section="toc" (new records) OR tableIndex=2 with unknown section (old records)
  const tocImgs = images.filter(img =>
    img.section === "toc" ||
    ((!img.section || img.section === "unknown") && img.tableIndex === 2)
  );
  // Build lookup: "levelStr__colKey" → images[]  (fieldLabel match for new records)
  const imagesByLevelCol = new Map<string, CellImageMeta[]>();
  tocImgs.forEach(img => {
    const colKey = TOC_COL_MAP[img.colIndex] ?? "note";
    const fl = (img.fieldLabel || "").trim();
    const key = fl ? `${fl}__${colKey}` : `__row_${img.rowIndex}__${colKey}`;
    const arr = imagesByLevelCol.get(key) || [];
    arr.push(img);
    imagesByLevelCol.set(key, arr);
  });
  
  return (
    <div className={TBL_WRAP}>
      <table className="w-full border-collapse" style={{ minWidth: 1080 }}>
        <thead><tr>
          {[["Level","w-16"],["Name","w-36"],["Required","w-24"],["Definition","w-52"],["Example","w-44"],["Note","w-40"],["TOC Requirements","w-48"],["SME Comments","w-44"]].map(([h,w])=>(
            <th key={h} className={`${w} ${TH}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((row, i) => {
            const lvl = (row.level||"").trim();
            const getImgs = (col: string) => {
              // Try fieldLabel match first, then rowIndex fallback for old DB records
              const byLabel = imagesByLevelCol.get(`${lvl}__${col}`) || [];
              if (byLabel.length > 0) return byLabel;
              return imagesByLevelCol.get(`__row_${i + 1}__${col}`) || [];
            };
            return (
              <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                <td className={TD}><LevelBadge val={row.level}/></td>
                <td className={TD}>{row.name||<Nil/>}</td>
                <td className={TD}><RequiredBadge val={row.required}/></td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>{row.definition||<Nil/>}</td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>
                  {row.example||<Nil/>}
                  {getImgs("example").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                </td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>
                  {row.note||<Nil/>}
                  {getImgs("note").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                </td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>{row.tocRequirements||<Nil/>}</td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>
                  {row.smeComments||<Nil/>}
                  {getImgs("smeComments").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-8 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
        <span className="text-[10px] text-slate-400" style={MONO}>{rows.length} section{rows.length!==1?"s":""}</span>
      </div>
    </div>
  );
}

function formatDisplay(value: string) {
  const normalized = value.replace(/\r\n/g,"\n").replace(/\r/g,"\n").replace(/\s*(Example\s*:)/gi,"\n$1\n").replace(/\s*(Notes?\s*:)/gi,"\n$1\n");
  const lines = normalized.split("\n").map(l=>l.trim()).filter(Boolean);
  return lines.map((line, i) => {
    const match = line.match(/^(Example\s*:|Notes?\s*:)(.*)$/i);
    if (!match) return <React.Fragment key={i}>{i>0?"\n":""}{line}</React.Fragment>;
    return <React.Fragment key={i}>{i>0?"\n":""}<span className="font-semibold">{match[1]}</span>{match[2]??""}</React.Fragment>;
  });
}

function CitationTable({ citationsData, brdId, images }: { citationsData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const citations = asRecordArray(citationsData?.references);
  if (citations.length === 0) return <Empty />;
  
  const CIT_COL_MAP: Record<number,string> = {0:"level",1:"citationRules",2:"sourceOfLaw",3:"smeComments"};
  // tableIndex=4 is the citation rules table (col1=citationRules, col3=smeComments)
  const citImgs = images.filter(img =>
    img.section === "citations" ||
    ((!img.section || img.section === "unknown") && img.tableIndex === 4)
  );
  const imagesByLevelCol = new Map<string, CellImageMeta[]>();
  citImgs.forEach(img => {
    const colKey = CIT_COL_MAP[img.colIndex] ?? "smeComments";
    const fl = (img.fieldLabel || "").trim();
    const key = fl ? `${fl}__${colKey}` : `__row_${img.rowIndex}__${colKey}`;
    const arr = imagesByLevelCol.get(key) || [];
    arr.push(img);
    imagesByLevelCol.set(key, arr);
  });
  
  return (
    <div className={TBL_WRAP}>
      <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: 600 }}>
        <thead><tr>{["Lvl","Citation Rules","Source of Law","SME Comments"].map(h=><th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {citations.map((row, i) => {
            const lvl = `Level ${asString(row.level)}`;
            const getImgs = (col: string) => {
              const byLabel = imagesByLevelCol.get(`${lvl}__${col}`) || [];
              if (byLabel.length > 0) return byLabel;
              return imagesByLevelCol.get(`__row_${i + 1}__${col}`) || [];
            };
            return (
              <tr key={i} className={i%2===0?"bg-white dark:bg-transparent":"bg-slate-50/40 dark:bg-[#1a1f35]/40"}>
                <td className={`w-14 ${TD}`}><LevelBadge val={asString(row.level)}/></td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>
                  {formatDisplay(asString(row.citationRules))||"—"}
                  {getImgs("citationRules").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                </td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>{asString(row.sourceOfLaw)||"—"}</td>
                <td className={`${TD} whitespace-pre-wrap break-words`}>
                  {formatDisplay(asString(row.smeComments))}
                  {getImgs("smeComments").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContentProfile({ cpData, brdId, images }: { cpData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const levels = useMemo(() => asExtractedLevels(cpData), [cpData]);
  const hardcodedPath = useMemo(() => deriveHardcodedPath(levels), [levels]);
  const rcFilename = String(cpData?.rc_filename ?? "");
  const headingAnnotation = String(cpData?.heading_annotation ?? "");
  const wsRows = useMemo(() => { const e = asExtractedWhitespace(cpData); return e.length > 0 ? e : DEFAULT_WHITESPACE_ROWS; }, [cpData]);
  
  // Group images by fieldLabel (= level number) and colIndex
  const TOC_COL_MAP2: Record<number,string> = {0:"levelNumber",1:"name",3:"definition",4:"example",5:"note"};
  const imagesByLevelCol = new Map<string, CellImageMeta[]>();
  images.filter(img => img.section === "toc").forEach(img => {
    const colKey = TOC_COL_MAP2[img.colIndex] ?? "note";
    const key = `${(img.fieldLabel||"").trim()}__${colKey}`;
    const arr = imagesByLevelCol.get(key) || [];
    arr.push(img);
    imagesByLevelCol.set(key, arr);
  });
  
  return (
    <div className="space-y-5">
      <div className="tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]">
        {[["RC Filename",rcFilename,true],["Hardcoded Path",hardcodedPath,true],["Heading Annotation",headingAnnotation,false]].map(([label,value,mono],i)=>(
          <div key={label as string} className={`flex items-center border-b border-slate-100 dark:border-[#2a3147] last:border-0 ${i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}`}>
            <div className="w-40 shrink-0 px-3 py-2 border-r border-slate-100 dark:border-[#2a3147]"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400" style={MONO}>{label as string}</span></div>
            <div className="flex-1 px-3 py-1.5"><span className={`text-[11.5px] ${mono?"font-mono":""} ${value?"text-sky-700 dark:text-sky-400 font-semibold":"text-slate-400 dark:text-slate-600 italic"}`}>{(value as string)||"—"}</span></div>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-2" style={MONO}>Level Numbers</p>
        <div className={TBL_WRAP}>
          <table className="w-full border-collapse" style={{ minWidth: 860 }}>
            <thead><tr>
              <th className={`w-20 ${TH}`}>Level #</th><th className={`w-64 ${TH}`}>Description</th>
              <th className={TH}>REDJAy XML Tag <span className="text-sky-500 ml-1 normal-case">⚡ auto</span></th>
              <th className={`w-48 ${TH}`}>Path</th><th className={`w-44 ${TH}`}>Remarks / Notes</th>
            </tr></thead>
            <tbody>
              {levels.length===0
                ?<tr><td colSpan={5} className="py-6 text-center text-[12px] text-slate-400 italic">No levels defined</td></tr>
                :levels.map((row,i)=>{
                    // levelNumber is "Level N", fieldLabel from extractor is just "N"
                    const lvlNum = (row.levelNumber||"").replace(/^Level\s*/i,"").trim();
                    const getImgs = (col: string) => imagesByLevelCol.get(`${lvlNum}__${col}`) || [];
                    return (
                      <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                        <td className={TD}><span className="font-mono text-[11px]">{row.levelNumber||"—"}</span></td>
                        <td className={`${TD} whitespace-pre-line`}>{row.description||<Nil/>}</td>
                        <td className={TD}>
                          <span className={`text-[11px] font-mono whitespace-pre-line select-all ${row.redjayXmlTag==="Hardcoded"?"text-amber-700 dark:text-amber-400 font-semibold":"text-sky-700 dark:text-sky-400"}`}>{row.redjayXmlTag||<Nil/>}</span>
                          {getImgs("note").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                        </td>
                        <td className={TD}><span className="font-mono text-[11px]">{row.path||<Nil/>}</span></td>
                        <td className={TD}>{row.remarksNotes||<Nil/>}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-2" style={MONO}>Whitespace Handling</p>
        <div className={TBL_WRAP}>
          <table className="w-full border-collapse" style={{ minWidth: 480 }}>
            <thead><tr><th className={`w-44 ${TH}`}>Tags</th><th className={TH}>InnodReplace</th></tr></thead>
            <tbody>
              {wsRows.map((row,i)=>(
                <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                  <td className={`${TD} font-mono text-violet-700 dark:text-violet-400`}>{row.tags||<Nil/>}</td>
                  <td className={TD}>{row.innodReplace||<Nil/>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
            <span className="text-[10px] text-slate-400" style={MONO}>{wsRows.length} rule{wsRows.length!==1?"s":""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const GEN_BTN_CONFIG: Record<string, { label:string; sublabel:string; description:string; iconKey:keyof typeof GenBtnIcons; accentLight:string; accentDark:string; iconColorLight:string; iconColorDark:string; btnBg:string; btnHover:string; badgeLabel:string }> = {
  brd:      { label:"BRD Document",    sublabel:"Export",    description:"Full BRD content as Excel workbook",       iconKey:"brd",      accentLight:"#f1f5f9", accentDark:"#252d45", iconColorLight:"#475569", iconColorDark:"#94a3b8", btnBg:"#1e293b", btnHover:"#334155", badgeLabel:".xls"  },
  metajson: { label:"Metajson",         sublabel:"Generate", description:"Structured metadata as JSON schema",        iconKey:"metajson", accentLight:"#eff6ff", accentDark:"#1e2d4d", iconColorLight:"#1d4ed8", iconColorDark:"#60a5fa", btnBg:"#1d4ed8", btnHover:"#1e40af", badgeLabel:".json" },
  innod:    { label:"Innod Metajson",   sublabel:"Generate", description:"Innod.Xml-compatible metadata output",      iconKey:"innod",    accentLight:"#eef2ff", accentDark:"#1e1f4d", iconColorLight:"#4338ca", iconColorDark:"#818cf8", btnBg:"#4338ca", btnHover:"#3730a3", badgeLabel:".json" },
  content:  { label:"Content Profile",  sublabel:"Export",   description:"Levels & whitespace rules as Excel",        iconKey:"content",  accentLight:"#f5f3ff", accentDark:"#2a1f45", iconColorLight:"#7c3aed", iconColorDark:"#a78bfa", btnBg:"#7c3aed", btnHover:"#6d28d9", badgeLabel:".xls"  },
};

export default function Generate({ brdId, title, format, initialData, onEdit, onComplete, canEdit = true }: Props) {
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [done, setDone]             = useState<Record<string, boolean>>({});
  const [completed, setCompleted]   = useState<Record<string, boolean>>({});
  const [saving,    setSaving]      = useState(false);
  const [savedToDB, setSavedToDB]   = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const generateUnlocked            = !canEdit || savedToDB;
  const [metajsonModal, setMetajsonModal] = useState<{open:boolean;data:Record<string,unknown>|null;filename:string}>({open:false,data:null,filename:"metajson.json"});
  const [innodModal,    setInnodModal]    = useState<{open:boolean;data:Record<string,unknown>|null;filename:string}>({open:false,data:null,filename:"innod_metajson.json"});
  const doneResetTimers   = useRef<Record<string, number>>({});
  const docPageRef        = useRef<HTMLDivElement>(null);
  const contentProfileRef = useRef<HTMLDivElement>(null);
  
  const { images } = useCellImages(brdId);

  useEffect(() => { return () => { Object.values(doneResetTimers.current).forEach(t => window.clearTimeout(t)); }; }, []);

  const scopeData          = asRecord(initialData?.scope);
  const metadataData       = asRecord(initialData?.metadata);
  const tocData            = asRecord(initialData?.toc);
  const citationsData      = asRecord(initialData?.citations);
  const contentProfileData = asRecord(initialData?.contentProfile);
  const brdConfigData      = asRecord(initialData?.brdConfig);

  const activeFormat: Format   = format === "old" ? "old" : "new";
  const metadataValues         = buildTemplateMetadataValues(activeFormat, metadataData);
  const displayTitle           = deriveTitle(metadataData, title);

  function markDone(key: string, ms = 1600) {
    if (doneResetTimers.current[key]) window.clearTimeout(doneResetTimers.current[key]);
    setDone(p => ({ ...p, [key]: true }));
    doneResetTimers.current[key] = window.setTimeout(() => { setDone(p => ({ ...p, [key]: false })); delete doneResetTimers.current[key]; }, ms);
  }

  function sanitizeFilePart(v: string) { return v.replace(/[^a-zA-Z0-9._-]/g, "_"); }

  function buildExcelHtml(html: string, t: string) {
    return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><title>${t}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111827}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px;vertical-align:top;white-space:normal!important;word-break:break-word}.tbl-scroll{overflow:visible!important}.dark *{color:#111827!important;background:#ffffff!important}</style></head><body>${html}</body></html>`;
  }

  function downloadExcelFile(base: string, t: string, el: HTMLElement) {
    const blob = new Blob(["\ufeff", buildExcelHtml(el.outerHTML, t)], {type:"application/vnd.ms-excel;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${sanitizeFilePart(base)}.xls`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function handleSaveBrd() {
    if (!brdId) return; setSaving(true); setSaveError(null);
    try {
      await api.post("/brd/save", { brdId, title: displayTitle, format, status: "COMPLETED", scope: scopeData, metadata: metadataData, toc: tocData, citations: citationsData, contentProfile: contentProfileData, brdConfig: brdConfigData });
      setSavedToDB(true);
    } catch (err: any) { setSaveError(err?.response?.data?.error ?? err?.message ?? "Save failed."); }
    finally { setSaving(false); }
  }

  async function runGenerateBrdExcel() {
    setGenerating(p=>({...p,brd:true}));
    try {
      const page = docPageRef.current; if (!page) throw new Error("BRD content not found");
      const clone = page.cloneNode(true) as HTMLElement;
      clone.querySelector("#section-generate")?.closest("[style*='paddingTop']")?.remove();
      clone.querySelector("#section-generate")?.remove();
      const cpBlock = clone.querySelector("#section-content-profile");
      cpBlock?.parentElement?.remove();
      clone.querySelectorAll("button").forEach(btn => btn.remove());
      clone.querySelectorAll("div").forEach(div => {
        const style = div.getAttribute("style") ?? "";
        if ((style.includes("borderBottom") || style.includes("border-bottom")) && div.querySelector("span")) {
          const labelEl = Array.from(div.querySelectorAll("span")).find(s =>
            (s.getAttribute("style") ?? "").includes("serif") || (s.getAttribute("style") ?? "").includes("Georgia")
          );
          const label = labelEl?.textContent?.trim();
          if (label) {
            const replacement = document.createElement("div");
            replacement.style.cssText = "font-weight:700;font-size:13pt;padding-bottom:6px;margin-bottom:10px;border-bottom:2px solid #1e293b;font-family:Georgia,serif;letter-spacing:-0.01em;";
            replacement.textContent = label;
            div.replaceWith(replacement);
          }
        }
      });
      clone.querySelectorAll("div").forEach(div => {
        if (/^\s*\d+\s+(document|section|rule)/i.test(div.textContent ?? "") && div.children.length <= 3) {
          div.remove();
        }
      });
      clone.querySelectorAll("[style*='linear-gradient']").forEach(d => d.remove());
      downloadExcelFile(`${brdId||"BRD"}_BRD`, `${brdId||"BRD"} - BRD`, clone);
      setCompleted(p=>({...p,brd:true})); markDone("brd");
    } catch { window.alert("Failed to generate BRD Excel."); setDone(p=>({...p,brd:false})); setCompleted(p=>({...p,brd:false})); }
    finally { setGenerating(p=>({...p,brd:false})); }
  }

  async function runGenerateContentProfileExcel() {
    setGenerating(p=>({...p,content:true}));
    try {
      const s = contentProfileRef.current; if (!s) throw new Error("Section not found");
      downloadExcelFile(`${brdId||"BRD"}_ContentProfile`, `${brdId||"BRD"} - Content Profile`, s.cloneNode(true) as HTMLElement);
      setCompleted(p=>({...p,content:true})); markDone("content");
    } catch { window.alert("Failed to generate Content Profile Excel."); setDone(p=>({...p,content:false})); setCompleted(p=>({...p,content:false})); }
    finally { setGenerating(p=>({...p,content:false})); }
  }

  async function runGenerateMetajson() {
    setGenerating(p=>({...p,metajson:true}));
    try {
      const r = await api.post<{success:boolean;metajson:Record<string,unknown>;filename?:string}>("/brd/generate/metajson",{brdId,title:displayTitle,format,scope:scopeData,metadata:metadataData,toc:tocData,citations:citationsData,contentProfile:contentProfileData,brdConfig:brdConfigData});
      // Load any previously saved version and merge — saved takes priority as initial value
      let initialData = r.data.metajson;
      if (brdId) {
        try {
          const saved = await api.get<{simpleMetajson: Record<string,unknown>|null}>(`/brd/${brdId}/sections/simpleMetajson`);
          if (saved.data.simpleMetajson) initialData = saved.data.simpleMetajson;
        } catch { /* no saved version yet, use generated */ }
      }
      setMetajsonModal({open:true,data:initialData,filename:r.data.filename||`${brdId||"metajson"}.json`});
      setCompleted(p=>({...p,metajson:true})); markDone("metajson");
    } catch { window.alert("Failed to generate Metajson."); setDone(p=>({...p,metajson:false})); setCompleted(p=>({...p,metajson:false})); }
    finally { setGenerating(p=>({...p,metajson:false})); }
  }

  async function handleSaveSimpleMetajson(json: Record<string, unknown>) {
    if (!brdId) return;
    try {
      await api.put(`/brd/${brdId}/sections/simpleMetajson`, { data: json });
    } catch (err) {
      console.error("[handleSaveSimpleMetajson]", err);
      window.alert("Failed to save Metajson to database.");
    }
  }

  async function runGenerateInnod() {
    setGenerating(p=>({...p,innod:true}));
    try {
      const r = await api.post<{success:boolean;metajson:Record<string,unknown>;filename?:string}>("/brd/generate/metajson",{brdId,title:displayTitle,format,scope:scopeData,metadata:metadataData,toc:tocData,citations:citationsData,contentProfile:contentProfileData,brdConfig:brdConfigData});
      // Load any previously saved version — saved takes priority as initial value
      let initialData = r.data.metajson;
      if (brdId) {
        try {
          const saved = await api.get<{innodMetajson: Record<string,unknown>|null}>(`/brd/${brdId}/sections/innodMetajson`);
          if (saved.data.innodMetajson) initialData = saved.data.innodMetajson;
        } catch { /* no saved version yet, use generated */ }
      }
      setInnodModal({open:true,data:initialData,filename:r.data.filename||`${brdId||"innod"}_metajson.json`});
      setCompleted(p=>({...p,innod:true})); markDone("innod");
    } catch { window.alert("Failed to generate Innod Metajson."); setDone(p=>({...p,innod:false})); setCompleted(p=>({...p,innod:false})); }
    finally { setGenerating(p=>({...p,innod:false})); }
  }

  async function handleSaveInnodMetajson(json: Record<string, unknown>) {
    if (!brdId) return;
    try {
      await api.put(`/brd/${brdId}/sections/innodMetajson`, { data: json });
    } catch (err) {
      console.error("[handleSaveInnodMetajson]", err);
      window.alert("Failed to save Innod Metajson to database.");
    }
  }

  const allDone = completed["brd"] && completed["metajson"] && completed["innod"] && completed["content"];
  const noop = () => {};

  return (
    <>
      <style>{`:root{--doc-bg:#fefefe}.dark{--doc-bg:#1a1f31}.tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,0.4) transparent}.tbl-scroll::-webkit-scrollbar{height:5px}.tbl-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(148,163,184,0.45)}.doc-page{max-width:100%;margin:0 auto}:root{--brd-title-color:#1e293b}.dark{--brd-title-color:#f1f5f9}.dark .gen-btn-card{background:#1e2235!important;border-color:#2a3147!important}.dark .gen-btn-card.gen-btn-done{background:#0d2318!important;border-color:#166534!important}.dark .gen-btn-icon-wrap{background:#252d45!important;color:#94a3b8!important}.dark .gen-btn-icon-wrap.icon-metajson{background:#1e2d4d!important;color:#60a5fa!important}.dark .gen-btn-icon-wrap.icon-innod{background:#1e1f4d!important;color:#818cf8!important}.dark .gen-btn-icon-wrap.icon-content{background:#2a1f45!important;color:#a78bfa!important}.dark .gen-btn-icon-wrap.icon-done{background:#14532d!important;color:#4ade80!important}.dark .gen-btn-title{color:#e2e8f0!important}.dark .gen-btn-title.done{color:#4ade80!important}`}</style>
      <AssistiveTouch />
      <div ref={docPageRef} className="doc-page px-4 py-6 space-y-1">

        {/* Document Header */}
        <div style={{textAlign:"center",marginBottom:36,paddingBottom:28,borderBottom:"1.5px solid #ddd8d0"}}>
          <h1 style={{fontFamily:"'Georgia','Times New Roman',serif",fontSize:26,fontWeight:700,color:"var(--brd-title-color,#1e293b)",letterSpacing:"-0.02em",lineHeight:1.25,margin:"0 0 14px"}}>
            {displayTitle}
          </h1>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap" as const}}>
            {brdId && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#64748b",background:"#f1f5f9",border:"1px solid #e2e8f0",padding:"3px 10px",borderRadius:4}}>{brdId}</span>}
            <span style={{color:"#cbd5e1",fontSize:13}}>·</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#94a3b8"}}>5 Sections</span>
          </div>
        </div>

        <DocBlock id="section-scope">
          <DocSectionHeader idx={0} onEdit={onEdit??noop} canEdit={canEdit}/>
          <ScopeTable scopeData={scopeData} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>
        
        <DocBlock id="section-metadata">
          <DocSectionHeader idx={1} onEdit={onEdit??noop} canEdit={canEdit}/>
          <MetaGrid values={metadataValues} format={activeFormat} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>
        
        <DocBlock id="section-toc">
          <DocSectionHeader idx={2} onEdit={onEdit??noop} canEdit={canEdit}/>
          <TocTable tocData={tocData} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>
        
        <DocBlock id="section-citations">
          <DocSectionHeader idx={3} onEdit={onEdit??noop} canEdit={canEdit}/>
          <CitationTable citationsData={citationsData} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>
        
        <div ref={contentProfileRef}>
          <DocBlock id="section-content-profile">
            <DocSectionHeader idx={4} onEdit={onEdit??noop} canEdit={canEdit}/>
            <ContentProfile cpData={contentProfileData} brdId={brdId} images={images} />
          </DocBlock>
        </div>

        {/* Generate Outputs */}
        <div id="section-generate" className="scroll-mt-6" style={{paddingTop:28}}>
          <div style={{borderTop:"2px solid #e2e2dc",paddingTop:24}}>

            {canEdit && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div style={{width:3,height:16,borderRadius:99,background:"#64748b"}}/>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Save BRD</p>
                  <div style={{flex:1,height:1,background:"linear-gradient(90deg, #e2e8f0, transparent)"}}/>
                </div>
                {!savedToDB ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#1e2235]">
                    <div className="flex-1">
                      <p className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">Save all sections to database</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Review the data above, then save before generating outputs.</p>
                      {saveError && <p className="text-[11px] text-red-500 mt-1 font-medium">{saveError}</p>}
                    </div>
                    <button onClick={handleSaveBrd} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                      {saving?(<><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>Saving…</>)
                        :(<><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>Save BRD</>)}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-500/10">
                    <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <p className="text-[12px] font-medium text-emerald-800 dark:text-emerald-400">Saved — <span className="font-bold">{brdId}</span> is now visible in the registry as <span className="font-bold">Completed</span></p>
                    <button onClick={()=>setSavedToDB(false)} className="ml-auto text-[11px] text-emerald-600 dark:text-emerald-400 underline hover:no-underline">Re-save</button>
                  </div>
                )}
              </div>
            )}

            <div className={!generateUnlocked?"opacity-40 pointer-events-none select-none":""}>
              {!generateUnlocked&&<p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3 text-center italic">Save the BRD first to unlock generate options</p>}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2"><div style={{width:3,height:16,borderRadius:99,background:"#64748b"}}/><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Generate Outputs</p></div>
                <div style={{flex:1,height:1,background:"linear-gradient(90deg, #e2e8f0, transparent)"}}/>
                <span className="text-[10px] text-slate-300 dark:text-slate-600" style={MONO}>4 outputs</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:12,alignItems:"stretch"}}>
                {(["brd","metajson","innod","content"] as const).map(key=>(
                  <div key={key} className={`gen-btn-card flex flex-col${done[key]?" gen-btn-done":""}`}
                    style={{border:done[key]?"1.5px solid #bbf7d0":"1.5px solid #e2e8f0",borderRadius:8,background:done[key]?"#f0fdf4":"#ffffff",boxShadow:"0 1px 4px rgba(0,0,0,0.05)",overflow:"hidden",transition:"border-color 0.2s, background 0.2s"}}>
                    <div className="flex items-start gap-3 p-4 pb-2.5" style={{flex:1}}>
                      <div className={`gen-btn-icon-wrap icon-${key}${done[key]?" icon-done":""} flex-shrink-0 flex items-center justify-center rounded-lg`}
                        style={{width:38,height:38,background:done[key]?"#dcfce7":GEN_BTN_CONFIG[key].accentLight,color:done[key]?"#16a34a":GEN_BTN_CONFIG[key].iconColorLight,transition:"background 0.2s, color 0.2s"}}>
                        {done[key]?<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2"><path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/></svg>:GenBtnIcons[GEN_BTN_CONFIG[key].iconKey]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`gen-btn-sublabel${done[key]?" done":""} text-[10px] font-bold uppercase tracking-[0.14em]`} style={{...MONO,color:done[key]?"#15803d":"#94a3b8"}}>{done[key]?"Done":GEN_BTN_CONFIG[key].sublabel}</span>
                          <span className={`gen-btn-badge${done[key]?" done":""} text-[9px] font-semibold px-1.5 py-0.5 rounded`} style={{...MONO,background:done[key]?"#bbf7d0":"#f1f5f9",color:done[key]?"#15803d":"#64748b"}}>{GEN_BTN_CONFIG[key].badgeLabel}</span>
                        </div>
                        <p className={`gen-btn-title${done[key]?" done":""} text-[13px] font-semibold leading-snug`} style={{color:done[key]?"#15803d":"#1e293b"}}>{GEN_BTN_CONFIG[key].label}</p>
                        <p className="gen-btn-desc text-[11px] text-slate-400 mt-0.5 leading-snug">{GEN_BTN_CONFIG[key].description}</p>
                      </div>
                    </div>
                    <div className="px-4 pb-4 pt-1">
                      <button
                        onClick={key==="brd"?runGenerateBrdExcel:key==="metajson"?runGenerateMetajson:key==="innod"?runGenerateInnod:runGenerateContentProfileExcel}
                        disabled={!!generating[key]||!!done[key]}
                        className="w-full py-2 rounded-md text-[12px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{background:done[key]?"#16a34a":GEN_BTN_CONFIG[key].btnBg,transition:"background 0.15s"}}
                        onMouseEnter={e=>{if(!done[key]&&!generating[key])(e.currentTarget as HTMLButtonElement).style.background=GEN_BTN_CONFIG[key].btnHover;}}
                        onMouseLeave={e=>{if(!done[key]&&!generating[key])(e.currentTarget as HTMLButtonElement).style.background=GEN_BTN_CONFIG[key].btnBg;}}>
                        {generating[key]?(<><svg className="animate-spin w-3.5 h-3.5 text-white/80" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>Generating…</>)
                          :done[key]?(<><svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth="2.5"><path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/></svg>Generated</>)
                          :(<><svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth="2"><path d="M10 3v11M5 9l5 5 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>{GEN_BTN_CONFIG[key].sublabel} {GEN_BTN_CONFIG[key].label}</>)}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {allDone&&(
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 mt-4 rounded border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-500/10">
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <p className="text-[12.5px] font-medium text-emerald-800 dark:text-emerald-400">All outputs generated — <span className="font-bold">{brdId??"BRD"}</span> is ready</p>
                </div>
                <button onClick={onComplete} className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 rounded text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all">
                  Back to Registry<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <SimpleMetajson open={metajsonModal.open} onClose={()=>setMetajsonModal(p=>({...p,open:false}))} metajson={metajsonModal.data} filename={metajsonModal.filename} onSave={handleSaveSimpleMetajson}/>
      <InnodMetajson open={innodModal.open} onClose={()=>setInnodModal(p=>({...p,open:false}))} metajson={innodModal.data} filename={innodModal.filename} onSave={handleSaveInnodMetajson}/>
    </>
  );
}