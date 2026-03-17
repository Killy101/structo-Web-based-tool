"use client";


import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DiffCategory,
  DiffGroup,
  DiffLine,
  DiffSubType,
  InlineSpan,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

// ── Colour config ──────────────────────────────────────────────────────────────

const CAT: Record<DiffCategory, {
  label: string; prefix: string; accent: string;
  bgLine: string; borderLine: string; headerBg: string;
  badge: string; icon: string;
}> = {
  addition: {
    label: "Additions", prefix: "+", accent: "#86efac",
    bgLine: "rgba(34,197,94,0.07)", borderLine: "rgba(34,197,94,0.40)",
    headerBg: "rgba(34,197,94,0.08)",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: "+",
  },
  removal: {
    label: "Removals", prefix: "−", accent: "#fca5a5",
    bgLine: "rgba(239,68,68,0.07)", borderLine: "rgba(239,68,68,0.40)",
    headerBg: "rgba(239,68,68,0.08)",
    badge: "bg-red-500/20 text-red-300 border-red-500/30", icon: "−",
  },
  modification: {
    label: "Modifications", prefix: "~", accent: "#fcd34d",
    bgLine: "rgba(245,158,11,0.08)", borderLine: "rgba(245,158,11,0.45)",
    headerBg: "rgba(245,158,11,0.08)",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: "~",
  },
  mismatch: {
    label: "Mismatch", prefix: "≠", accent: "#fdba74",
    bgLine: "rgba(249,115,22,0.08)", borderLine: "rgba(249,115,22,0.45)",
    headerBg: "rgba(249,115,22,0.08)",
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/30", icon: "≠",
  },
  emphasis: {
    label: "Emphasis Changes", prefix: "✦", accent: "#e879f9",
    bgLine: "rgba(217,70,239,0.07)", borderLine: "rgba(217,70,239,0.40)",
    headerBg: "rgba(217,70,239,0.07)",
    badge: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30", icon: "✦",
  },
};

const SUB: Record<DiffSubType, { label: string; cls: string }> = {
  edit:         { label: "edit",         cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  textual:      { label: "textual",      cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  innodreplace: { label: "innod",        cls: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  emphasis:     { label: "formatting",   cls: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
};

// ── Inline word spans ──────────────────────────────────────────────────────────

const SpanRow = memo(function SpanRow({
  spans, isOld,
}: { spans: InlineSpan[]; isOld: boolean }) {
  return (
    <span className="flex flex-wrap leading-5">
      {spans.map((s, i) =>
        s.changed ? (
          <span
            key={i}
            className={
              isOld
                ? "bg-red-500/25 text-red-200 rounded px-0.5 line-through"
                : "bg-emerald-500/25 text-emerald-200 rounded px-0.5"
            }
          >
            {s.text}
          </span>
        ) : (
          <span key={i} className="text-slate-400">{s.text}</span>
        )
      )}
    </span>
  );
});

// ── Page badges — old and new are always clearly distinguished ────────────────

function PageBadges({ oldPage, newPage }: { oldPage?: number | null; newPage?: number | null }) {
  return (
    <span className="flex items-center gap-1 flex-shrink-0">
      {oldPage != null && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border"
          style={{
            color: "#93c5fd",
            background: "rgba(59,130,246,0.12)",
            borderColor: "rgba(59,130,246,0.35)",
          }}
          title={`Old PDF page ${oldPage}`}
        >
          OLD p.{oldPage}
        </span>
      )}
      {newPage != null && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border"
          style={{
            color: "#c4b5fd",
            background: "rgba(139,92,246,0.12)",
            borderColor: "rgba(139,92,246,0.35)",
          }}
          title={`New PDF page ${newPage}`}
        >
          NEW p.{newPage}
        </span>
      )}
    </span>
  );
}

// ── Emphasis change pill ───────────────────────────────────────────────────────

function EmphasisPill({ text }: { text: string }) {
  // Parse out the change description from "Phrase Text  [bold added]"
  const match   = text.match(/^(.*?)\s*\[([^\]]+)\]$/);
  const phrase  = match ? match[1].trim() : text;
  const change  = match ? match[2].trim() : "";

  const isBoldAdd    = change.includes("bold added");
  const isBoldRemove = change.includes("bold removed");
  const isItalicAdd  = change.includes("italic added");
  const isItalicRemove = change.includes("italic removed");

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {/* Show the phrase with its formatting state */}
      <span
        className="text-slate-300"
        style={{ fontWeight: isBoldAdd ? 700 : isBoldRemove ? 400 : undefined }}
      >
        {phrase}
      </span>
      {/* Change pill(s) */}
      {isBoldAdd && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40">
          bold added
        </span>
      )}
      {isBoldRemove && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-slate-600/20 text-slate-400 border-slate-600/40 line-through">
          bold removed
        </span>
      )}
      {isItalicAdd && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40 italic">
          italic added
        </span>
      )}
      {isItalicRemove && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-slate-600/20 text-slate-400 border-slate-600/40">
          italic removed
        </span>
      )}
    </span>
  );
}

// ── Single diff line row ───────────────────────────────────────────────────────

const DiffLineRow = memo(function DiffLineRow({
  line, isSelected, cfg, onClick, onContextMenu,
}: {
  line: DiffLine;
  isSelected: boolean;
  cfg: typeof CAT[DiffCategory];
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const MAX = 300;

  const sub    = line.sub_type ?? "edit";
  const subCfg = SUB[sub] ?? SUB.edit;

  // Emphasis lines get special rendering
  const isEmphasis = line.category === "emphasis";

  // Modification lines with word spans get inline diff
  const hasSpans =
    line.type === "modified" &&
    line.old_spans && line.old_spans.length > 0 &&
    line.new_spans && line.new_spans.length > 0;

  // For plain text display (additions/removals)
  const raw     = line.text || "\u00A0";
  const long    = raw.length > MAX;
  const display = expanded || !long ? raw : `${raw.slice(0, MAX)}…`;

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-full flex items-start gap-0 font-mono text-[11px] leading-5 text-left transition-colors"
      style={{
        background:  isSelected ? "rgba(26,143,209,0.18)" : cfg.bgLine,
        borderLeft:  `2px solid ${isSelected ? "#1a8fd1" : cfg.borderLine}`,
      }}
    >
      {/* Prefix gutter */}
      <span
        className="flex-shrink-0 w-6 text-center py-1.5 font-bold select-none"
        style={{ color: cfg.accent }}
      >
        {cfg.prefix}
      </span>

      {/* Main content */}
      <span className="flex-1 py-1.5 pr-2 break-words min-w-0 flex flex-col gap-1">
        {isEmphasis ? (
          <EmphasisPill text={raw} />
        ) : hasSpans ? (
          // Modification: show old (strikethrough) then new
          <>
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">
              Old
            </span>
            <SpanRow spans={line.old_spans!} isOld={true} />
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mt-0.5">
              New
            </span>
            <SpanRow spans={line.new_spans!} isOld={false} />
          </>
        ) : (
          <>
            <span style={{ color: "#e2e8f0" }}>{display}</span>
            {long && !expanded && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); setExpanded(true); }}
                className="text-[9px] text-cyan-300 hover:text-cyan-100 underline"
              >
                Show more
              </span>
            )}
            {long && expanded && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); setExpanded(false); }}
                className="text-[9px] text-slate-400 hover:text-slate-200 underline"
              >
                Show less
              </span>
            )}
          </>
        )}
      </span>

      {/* Right-side badges: sub_type + page refs */}
      <span className="flex-shrink-0 flex flex-col items-end gap-1 py-1.5 pr-2">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${subCfg.cls}`}>
          {subCfg.label}
        </span>
        <PageBadges oldPage={line.old_page} newPage={line.new_page} />
      </span>
    </button>
  );
});

// ── Paged collapsible section ──────────────────────────────────────────────────

const ModifySection = memo(function ModifySection({
  group, selectedLineIndex, onSelectLine, onContextMenu, defaultOpen,
}: {
  group: DiffGroup;
  selectedLineIndex: number | null;
  onSelectLine: (line: DiffLine, idx: number) => void;
  onContextMenu: (line: DiffLine, idx: number, e: React.MouseEvent) => void;
  defaultOpen: boolean;
}) {
  const [open,    setOpen]    = useState(defaultOpen);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const cfg   = CAT[group.category];
  const total = group.lines.length;

  return (
    <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:brightness-125 transition-all"
        style={{ background: cfg.headerBg }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{ color: cfg.accent, background: cfg.borderLine.replace("0.40", "0.18") }}
          >
            {cfg.icon}
          </span>
          <span className="text-xs font-semibold" style={{ color: cfg.accent }}>
            {group.label}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${cfg.badge}`}>
            {total}
          </span>
        </div>
        <svg
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
          style={{ color: cfg.accent, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div>
          {group.lines.slice(0, visible).map((line, i) => (
            <DiffLineRow
              key={`${group.category}-${line.line}-${i}`}
              line={line}
              isSelected={selectedLineIndex === line.line}
              cfg={cfg}
              onClick={() => onSelectLine(line, line.line)}
              onContextMenu={e => { e.preventDefault(); onContextMenu(line, line.line, e); }}
            />
          ))}
          {visible < total && (
            <button
              type="button"
              onClick={() => setVisible(n => Math.min(n + PAGE_SIZE, total))}
              className="w-full py-1.5 text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              Show {Math.min(PAGE_SIZE, total - visible)} more of {total - visible} remaining…
            </button>
          )}
        </div>
      )}
    </div>
  );
});

// ── Chunk summary bar — sits ABOVE the sections ────────────────────────────────

function ChunkSummaryBar({
  groups, similarity, changeType,
}: {
  groups: DiffGroup[];
  similarity?: number;
  changeType?: string;
}) {
  const simPct   = similarity != null ? Math.round(similarity * 100) : null;
  const simColor = simPct == null       ? "#64748b"
    : simPct >= 90 ? "#22c55e"
    : simPct >= 60 ? "#f59e0b"
    : "#ef4444";

  const changeBadge: Record<string, string> = {
    added:     "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    removed:   "bg-red-500/20 text-red-300 border-red-500/30",
    modified:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
    unchanged: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };

  return (
    <div
      className="flex-shrink-0 flex items-center flex-wrap gap-2 px-3 py-2 border-b"
      style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
    >
      {/* Per-category counts */}
      {groups.map(g => {
        const c = CAT[g.category];
        return (
          <span
            key={g.category}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.badge}`}
          >
            {c.icon} {g.lines.length}
          </span>
        );
      })}
      <span className="flex-1" />
      {changeType && changeType !== "unchanged" && (
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0
            ${changeBadge[changeType] ?? changeBadge.unchanged}`}
        >
          {changeType}
        </span>
      )}
      {simPct != null && (
        <span
          className="text-[10px] font-semibold flex-shrink-0"
          style={{ color: simColor }}
        >
          {simPct}% match
        </span>
      )}
    </div>
  );
}

// ── Client-side group builder (fallback only) ──────────────────────────────────

const _EMPH_RE  = /<\/?(emphasis|emph|bold|italic|underline|strong|b|i|u|sub|sup)[^>]*>/i;
const _INNOD_RE = /<\/?\w+:/i;

function buildGroupsClient(lines: DiffLine[]): DiffGroup[] {
  const ORDER: DiffCategory[]            = ["addition","removal","modification","mismatch","emphasis"];
  const LABELS: Record<DiffCategory, string> = {
    addition: "Additions", removal: "Removals", modification: "Modifications",
    mismatch: "Mismatch",  emphasis: "Emphasis Changes",
  };
  const buckets: Record<DiffCategory, DiffLine[]> = {
    addition: [], removal: [], modification: [], mismatch: [], emphasis: [],
  };
  for (const line of lines) {
    const combined = (line.old_text ?? "") + (line.new_text ?? "") + line.text;
    let cat: DiffCategory = line.category ?? (
      line.type === "added"   ? "addition"  :
      line.type === "removed" ? "removal"   : "modification"
    );
    if (_EMPH_RE.test(combined)) cat = "emphasis";
    const sub: DiffSubType = line.sub_type ?? (
      _EMPH_RE.test(combined)  ? "emphasis"     :
      _INNOD_RE.test(combined) ? "innodreplace"  :
      Math.abs((line.old_text ?? "").length - (line.new_text ?? "").length) <= 60
        ? "edit" : "textual"
    );
    buckets[cat].push({ ...line, category: cat, sub_type: sub });
  }
  return ORDER.filter(c => buckets[c].length > 0).map(c => ({
    category: c, label: LABELS[c], lines: buckets[c],
  }));
}

// ── Main component ─────────────────────────────────────────────────────────────

interface DiffPanelProps {
  diffLines:           DiffLine[];
  diffGroups?:         DiffGroup[];
  chunkLabel?:         string;
  changeType?:         string;
  similarity?:         number;
  selectedLineIndex?:  number | null;
  onSelectLine?:       (line: DiffLine, index: number) => void;
  onGenerateFromLine?: (line: DiffLine, index: number) => void;
}

export default function DiffPanel({
  diffLines, diffGroups, chunkLabel, changeType, similarity,
  selectedLineIndex = null, onSelectLine, onGenerateFromLine,
}: DiffPanelProps) {
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; line: DiffLine; idx: number;
  } | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node))
        setCtxMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [ctxMenu]);

  const groups = useMemo<DiffGroup[]>(
    () => (diffGroups && diffGroups.length > 0) ? diffGroups : buildGroupsClient(diffLines),
    [diffLines, diffGroups],
  );

  const hasChanges = groups.length > 0;

  const handleCtx = useCallback((line: DiffLine, idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, line, idx });
  }, []);

  const handleSelect = useCallback((line: DiffLine, idx: number) => {
    onSelectLine?.(line, idx);
  }, [onSelectLine]);

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden border border-[#1e2d42] dark:bg-[#0d1117] bg-white">

      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 dark:border-[#1e2d42] bg-white/95 dark:bg-[#0d1420]/95">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-xs font-bold text-white tracking-wide">Changes</span>
          {chunkLabel && (
            <span className="text-[10px] text-slate-500 truncate max-w-[150px]">{chunkLabel}</span>
          )}
        </div>
      </div>

      {/* Chunk summary bar */}
      {hasChanges && (
        <ChunkSummaryBar groups={groups} similarity={similarity} changeType={changeType} />
      )}

      {/* Page legend */}
      <div
        className="flex-shrink-0 flex items-center gap-3 flex-wrap px-3 py-1.5 border-b text-[9px]"
        style={{ borderColor: "rgba(255,255,255,0.04)", background: "#161b22" }}
      >
        <span className="text-slate-600 font-semibold">pages:</span>
        <span
          className="px-1.5 py-0.5 rounded border font-bold"
          style={{ color: "#93c5fd", background: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.35)" }}
        >
          OLD p.N
        </span>
        <span
          className="px-1.5 py-0.5 rounded border font-bold"
          style={{ color: "#c4b5fd", background: "rgba(139,92,246,0.12)", borderColor: "rgba(139,92,246,0.35)" }}
        >
          NEW p.N
        </span>
        <span className="flex-1" />
        {/* Sub-type legend */}
        {(Object.entries(SUB) as [DiffSubType, { label: string; cls: string }][]).map(([k, v]) => (
          <span key={k} className={`px-1.5 py-0.5 rounded border font-semibold ${v.cls}`}>
            {v.label}
          </span>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {!hasChanges ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-slate-600">
            <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs">No changes detected in this chunk</p>
          </div>
        ) : (
          groups.map((group, gi) => (
            <ModifySection
              key={group.category}
              group={group}
              selectedLineIndex={selectedLineIndex}
              onSelectLine={handleSelect}
              onContextMenu={handleCtx}
              defaultOpen={gi === 0 || group.lines.length <= 20}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[160px] rounded-lg border shadow-xl bg-white dark:bg-[#161b22] border-gray-200 dark:border-[rgba(255,255,255,0.12)]"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 180),
            top:  Math.min(ctxMenu.y, window.innerHeight - 80),
          }}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-[11px] font-semibold text-violet-700 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-500/15 transition-colors rounded-lg"
            onClick={() => { onGenerateFromLine?.(ctxMenu.line, ctxMenu.idx); setCtxMenu(null); }}
          >
            ✨ Generate XML for this line
          </button>
        </div>
      )}
    </div>
  );
}