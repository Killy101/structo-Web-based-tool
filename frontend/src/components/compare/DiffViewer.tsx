"use client";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DiffPaneHandle,
  DiffResult,
  PaneData,
  WorkflowMode,
  XmlSection,
  XmlScrollTarget,
} from "./types";
import { apiApply, apiLocate, apiChunkLocate, invalidateXmlSession } from "./api";
import type { DiffProgress } from "./api";
import ChunkList from "./ChunkList";
import DiffPane, { buildLines, foldUnchangedLines } from "./DiffPane";
import type { AlignedLine, FoldMapEntry } from "./DiffPane";
import XmlPanel  from "./XmlPanel";
import XmlPreviewPanel from "./XmlPreviewPanel";
import type { XmlPreviewHandle } from "./XmlPreviewPanel";
import WordDiffPanel from "./WordDiffPanel";

interface Props {
  mode:              WorkflowMode;
  result:            DiffResult;
  onReset:           () => void;
  initialXmlFile?:   File | null;
  xmlSections?:      XmlSection[];
  initialSection?:   string | null;
  sectionMapper?:    (chunkSection: string) => string | null;
  isStreaming?:      boolean;
  streamingProgress?: DiffProgress | null;
}

type ApplyStatus = "idle" | "applying" | "done" | "error";

function useDragSplitter(
  containerRef: React.RefObject<HTMLDivElement>,
  initial: number,
  axis: "x" | "y",
  min: number,
  max: number,
): [number, (e: React.MouseEvent<HTMLElement>) => void] {
  const [value, setValue] = useState(initial);

  const startDrag = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const raw = axis === "x"
        ? ((ev.clientX - rect.left) / rect.width) * 100
        : rect.bottom - ev.clientY;
      setValue(Math.min(max, Math.max(min, raw)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",  onUp);
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor     = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",  onUp);
  }, [containerRef, axis, min, max]);

  return [value, startDrag];
}

function StatPill({ label, count, cls }: { label: string; count: number; cls: string }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold font-mono tabular-nums ${cls}`}>
      {label}{count}
    </span>
  );
}

function IconBtn({
  title, active, disabled, onClick, children,
}: {
  title: string; active?: boolean; disabled?: boolean;
  onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-all
        ${active
          ? "bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/30"
          : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
        }
        disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}


// ── patchPaneB ────────────────────────────────────────────────────────────────
// Immutably replace a single chunk's text inside pane_b after an XML apply.
// Updates segments and adjusts all offsets so downstream buildLines stays correct.
function patchPaneB(pane: PaneData, chunkId: number, newText: string): PaneData {
  const chunkStart = (pane.offsets ?? {})[String(chunkId)];
  const chunkEnd   = (pane.offset_ends ?? {})[String(chunkId)];
  if (chunkStart == null || chunkEnd == null) return pane;

  const origLen = chunkEnd - chunkStart;
  const newLen  = newText.length;
  const delta   = newLen - origLen;

  const newSegments: [string, string][] = [];
  let pos = 0;
  let inserted = false;
  let chunkTag = "";

  for (const [text, tagName] of pane.segments) {
    const segEnd = pos + text.length;
    if (segEnd <= chunkStart || pos >= chunkEnd) {
      // Entirely outside chunk range — keep as-is
      newSegments.push([text, tagName]);
    } else {
      if (!chunkTag) chunkTag = tagName;
      // Keep text before chunk start
      if (pos < chunkStart) {
        newSegments.push([text.slice(0, chunkStart - pos), tagName]);
      }
      // Insert replacement text once
      if (!inserted) {
        if (newText) newSegments.push([newText, chunkTag]);
        inserted = true;
      }
      // Keep text after chunk end
      if (segEnd > chunkEnd) {
        newSegments.push([text.slice(chunkEnd - pos), tagName]);
      }
    }
    pos += text.length;
  }

  // Adjust all offsets by delta for chunks that start after the replaced range
  if (delta !== 0) {
    const newOffsets: Record<string, number>    = {};
    const newOffsetEnds: Record<string, number> = {};
    for (const [k, v] of Object.entries(pane.offsets ?? {})) {
      const e = (pane.offset_ends ?? {})[k] ?? v;
      if (Number(k) === chunkId) {
        newOffsets[k]    = v;
        newOffsetEnds[k] = v + newLen;
      } else if (v > chunkStart) {
        newOffsets[k]    = v + delta;
        newOffsetEnds[k] = e + delta;
      } else {
        newOffsets[k]    = v;
        newOffsetEnds[k] = e > chunkStart ? e + delta : e;
      }
    }
    return { ...pane, segments: newSegments, offsets: newOffsets, offset_ends: newOffsetEnds };
  }

  return { ...pane, segments: newSegments };
}

export default function DiffViewer({
  mode,
  result,
  onReset,
  initialXmlFile,
  xmlSections,
  initialSection,
  sectionMapper,
  isStreaming = false,
  streamingProgress = null,
}: Props) {
  const [activeId,      setActiveId]      = useState<number | null>(result.chunks[0]?.id ?? null);
  const [appliedIds,    setAppliedIds]    = useState<Set<number>>(new Set());
  // Track which chunks have been edited via XML (for live sync and icon)
  const [xmlEditedIds, setXmlEditedIds] = useState<Set<number>>(new Set());
  // Local override for chunk text_b (live sync)
  const [chunkTextBOverrides, setChunkTextBOverrides] = useState<Record<number, string>>({});
  const [applyStatus,   setApplyStatus]   = useState<ApplyStatus>("idle");
  const [xmlText,       setXmlText]       = useState("");
  const [xmlFilename,   setXmlFilename]   = useState<string | null>(null);
  const [xmlStatus,     setXmlStatus]     = useState("");
  const [navSpan,       setNavSpan]       = useState<{ start: number; end: number } | null>(null);
  // XML panel is now collapsed by default, user can toggle open
  const [xmlOpen, setXmlOpen] = useState(false);
  const [filterSection, setFilterSection] = useState<string | null>(initialSection ?? null);
  const [wrapLines,     setWrapLines]     = useState(true);
  const [syncScrollLeft, setSyncScrollLeft] = useState<{side:"a"|"b"; left:number} | null>(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);
  // Only one WordDiffPanel open at a time; store the chunk id or null
  const [wordPanelOpenId, setWordPanelOpenId] = useState<number | null>(null);
  // Live HTML preview panel alongside the XML editor
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applyHistory, setApplyHistory]   = useState<{ xmlText: string; appliedId: number }[]>([]);
  const [expandedFoldKeys, setExpandedFoldKeys] = useState<Set<number>>(() => new Set());

  // showAllContext = true means ALL lines are visible (no folding).
  // This is the correct default — matches Beyond Compare / VSCode behaviour.
  // Users can toggle folding with the "Collapse" button or press C.
  const [showAllContext, setShowAllContext] = useState(true);

  const [reviewedIds,  setReviewedIds]    = useState<Set<number>>(new Set());
  const [pulseSide,    setPulseSide]      = useState<"old" | "new" | null>(null);

  // Local copy of pane_b that gets patched after each apply so the B pane
  // re-renders with the updated text without a full re-diff.
  const [localPaneB,   setLocalPaneB]    = useState<PaneData>(result.pane_b);

  const containerRef   = useRef<HTMLDivElement>(null);
  const paneARef       = useRef<DiffPaneHandle>(null);
  const paneBRef       = useRef<DiffPaneHandle>(null);
  const xmlRef         = useRef<XmlScrollTarget>(null);
  const previewRef     = useRef<XmlPreviewHandle>(null);
  const locateSeqRef   = useRef(0);
  const navSyncLockRef = useRef(false);
  const navSyncLockSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // xmlNavLockRef: set while handleXmlLineClick is in flight so that
  //   syncXmlScroll does NOT move the XML panel away from the clicked position.
  // xmlScrollLockRef: set inside syncXmlScroll so the resulting onScrollFraction
  //   event from the XML panel does NOT loop back and sync panes again.
  const xmlNavLockRef    = useRef(false);
  const xmlScrollLockRef = useRef(false);

  const [splitPct,  startDragV] = useDragSplitter(containerRef, 50,  "x", 20,  80);
  const [xmlHeight, startDragH] = useDragSplitter(containerRef, 260, "y", 120, 560);
  const xmlPanelContainerRef = useRef<HTMLDivElement>(null);
  // previewSplit: XML editor width % within the XML+preview row (preview gets the rest)
  const [previewSplit, startDragPreview] = useDragSplitter(xmlPanelContainerRef, 62, "x", 20, 85);

  useEffect(() => {
    if (!initialXmlFile || xmlText) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setXmlFilename(initialXmlFile.name);
      setXmlText(typeof e.target?.result === "string" ? e.target.result : "");
      setXmlStatus((prev) => prev ? prev : (mode === "browse"
        ? `Baseline: ${initialXmlFile.name}`
        : `Loaded: ${initialXmlFile.name}`));
      setXmlOpen(true);
    };
    reader.readAsText(initialXmlFile);
    // Only run when initialXmlFile changes, not on every xmlText change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialXmlFile, mode]);

  // Ensure alignmentChunks is always in sync with result.chunks for alignment
  const alignmentChunks = useMemo(
    () => result.chunks.map((c) => ({ ...c })),
    [result.chunks],
  );

  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (didAutoScrollRef.current) return;
    const firstId = result.chunks[0]?.id;
    if (firstId == null) return;
    const timer = setTimeout(() => {
      didAutoScrollRef.current = true;
      paneARef.current?.scrollToChunk(firstId);
      paneBRef.current?.scrollToChunk(firstId);
    }, 120);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.pane_a, result.pane_b, alignmentChunks]);

  const mapSection = useCallback(
    (s: string) => sectionMapper ? sectionMapper(s) : s,
    [sectionMapper],
  );

  // Store original text_b for robust XML navigation
  const originalTextBMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const c of result.chunks) map[c.id] = c.text_b;
    return map;
  }, [result.chunks]);

  // Use overrides for text_b if present (live sync)
  const filteredChunks = useMemo(() => {
    const base = result.chunks.map((c) => {
      if (chunkTextBOverrides[c.id] !== undefined) {
        return { ...c, text_b: chunkTextBOverrides[c.id] };
      }
      return c;
    });
    if (!filterSection) return base;
    return base.filter((c) => {
      const section = mapSection(c.section ?? "");
      return section === filterSection;
    });
  }, [result.chunks, chunkTextBOverrides, filterSection, mapSection]);

  const filteredStats = useMemo(() => {
    if (!filterSection) return result.stats;
    const fc = filteredChunks;
    return {
      total:         fc.length,
      additions:     fc.filter((c) => c.kind === "add").length,
      deletions:     fc.filter((c) => c.kind === "del").length,
      modifications: fc.filter((c) => c.kind === "mod").length,
      emphasis:      fc.filter((c) => c.kind === "emp").length,
      strike:        fc.filter((c) => c.kind === "strike").length,
    };
  }, [filteredChunks, filterSection, result.stats]);

  const sectionCountMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of result.chunks) {
      if (c.kind === "emp") continue;
      const label = mapSection(c.section ?? "");
      if (!label) continue;
      m.set(label, (m.get(label) ?? 0) + 1);
    }
    return m;
  }, [result.chunks, mapSection]);

  const sectionsWithChanges = useMemo(
    () => xmlSections?.filter((s) => sectionCountMap.has(s.label)) ?? [],
    [xmlSections, sectionCountMap],
  );

  const activeChunk = useMemo(
    () => result.chunks.find((c) => c.id === activeId) ?? null,
    [result.chunks, activeId],
  );

  // Handler to open/close WordDiffPanel for a specific chunk
  const handleWordPanelToggle = useCallback((chunkId: number) => {
    setWordPanelOpenId((prev) => (prev === chunkId ? null : chunkId));
  }, []);

  const chunkIds = useMemo(() => result.chunks.map((c) => c.id), [result.chunks]);

  const activeFilteredIndex = useMemo(
    () => filteredChunks.findIndex((c) => c.id === activeId),
    [filteredChunks, activeId],
  );

  const paneAHeaderStats = useMemo(() => [
    { label: "-", count: filteredStats.deletions,     colorClass: "text-rose-500",   title: `${filteredStats.deletions} deletions` },
    { label: "~", count: filteredStats.modifications, colorClass: "text-amber-500",  title: `${filteredStats.modifications} modifications` },
  ].filter((s) => s.count > 0), [filteredStats]);

  const paneBHeaderStats = useMemo(() => [
    { label: "+", count: filteredStats.additions,     colorClass: "text-emerald-500", title: `${filteredStats.additions} additions` },
    { label: "~", count: filteredStats.modifications, colorClass: "text-amber-500",   title: `${filteredStats.modifications} modifications` },
  ].filter((s) => s.count > 0), [filteredStats]);

  const firstPaneAChunk = useMemo(
    () => filteredChunks.find((c) => c.kind === "del" || c.kind === "mod"),
    [filteredChunks],
  );
  const firstPaneBChunk = useMemo(
    () => filteredChunks.find((c) => c.kind === "add" || c.kind === "mod"),
    [filteredChunks],
  );

  // ── Build lines independently per pane — no null/gap rows ─────────────────
  // Each pane shows all lines from its own PDF in order, starting from row 1.
  // Differences are highlighted via chunkId on each segment. Scroll sync is
  // handled by fraction so both panes stay roughly aligned while scrolling.
  const { linesA: rawLinesA, linesB: rawLinesB } = useMemo(() => {
    const la: AlignedLine[] = buildLines(result.pane_a);
    // Use localPaneB so pane B re-renders after each XML apply
    const lb: AlignedLine[] = buildLines(localPaneB);
    // Pad to equal length so foldUnchangedLines (opt-in) works correctly
    const maxLen = Math.max(la.length, lb.length);
    const linesA = la.length < maxLen ? [...la, ...Array(maxLen - la.length).fill(null)] : la;
    const linesB = lb.length < maxLen ? [...lb, ...Array(maxLen - lb.length).fill(null)] : lb;
    return { linesA, linesB };
  }, [result.pane_a, localPaneB]);

  // ── Apply optional folding ────────────────────────────────────────────────
  // When showAllContext is true (default) NO lines are hidden — every line
  // from both PDFs is visible, matching professional diff tool behaviour.
  // When the user explicitly toggles folding, foldUnchangedLines runs and
  // the foldMap returned is used for O(1) safe fold expansion.
  const { linesA, linesB } = useMemo(() => {
    if (showAllContext || wrapLines) {
      // No folding — return aligned lines unchanged.
      return { linesA: rawLinesA, linesB: rawLinesB };
    }

    // Folding is opt-in. foldUnchangedLines now returns foldMap so we can
    // expand folds using the exact raw-array slice (no fragile rawIdx loop).
    const { linesA: fA, linesB: fB, foldMap } = foldUnchangedLines(rawLinesA, rawLinesB);

    const outA: AlignedLine[] = [];
    const outB: AlignedLine[] = [];

    for (let i = 0; i < fA.length; i++) {
      const a = fA[i];
      const b = fB[i];

      if (a && !Array.isArray(a) && typeof a === "object" && a.type === "fold") {
        if (expandedFoldKeys.has(a.key)) {
          // Use foldMap for the exact raw slice — avoids wrong-lines bug.
          const meta: FoldMapEntry | undefined = foldMap.get(a.key);
          if (meta) {
            outA.push(...rawLinesA.slice(meta.rawStart, meta.rawStart + meta.count));
            outB.push(...rawLinesB.slice(meta.rawStart, meta.rawStart + meta.count));
          }
        } else {
          outA.push(a);
          outB.push(b);
        }
        continue;
      }

      outA.push(a);
      outB.push(b);
    }

    return { linesA: outA, linesB: outB };
  }, [showAllContext, wrapLines, rawLinesA, rawLinesB, expandedFoldKeys]);


  useEffect(() => {
    setExpandedFoldKeys(new Set());
    setReviewedIds(new Set());
  }, [result.chunks]);

  const handleUnfoldRow = useCallback((foldKey: number) => {
    setExpandedFoldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(foldKey)) next.delete(foldKey); else next.add(foldKey);
      return next;
    });
  }, []);


  // Only scroll XML to mark if a new chunk is selected by user action
  const lastNavSpanRef = useRef<{start:number,end:number}|null>(null);
  function scrollXmlToMark(force = false) {
    const el = xmlRef.current;
    if (!el) return;
    if (el.tagName !== "DIV") return;
    // Only scroll if navSpan changed (new chunk selected) or forced
    if (force || JSON.stringify(navSpan) !== JSON.stringify(lastNavSpanRef.current)) {
      (el as unknown as HTMLDivElement).querySelector("mark")?.scrollIntoView({ behavior: "smooth", block: "center" });
      lastNavSpanRef.current = navSpan ? { ...navSpan } : null;
    }
  }

  function getScrollFraction(paneData: typeof result.pane_a, chunkId: number) {
    const off = paneData?.offsets?.[String(chunkId)];
    if (off == null) return undefined;
    let total = 0;
    for (const [text] of paneData.segments) total += text.length;
    return total > 0 ? off / total : undefined;
  }

  const syncXmlScroll = useCallback((fraction: number) => {
    // When the user just clicked inside the XML panel, don't scroll it away.
    if (xmlNavLockRef.current) return;
    const xmlEl = xmlRef.current;
    if (!xmlEl) return;
    const max = xmlEl.scrollHeight - xmlEl.clientHeight;
    if (max <= 0) return;
    // Set feedback lock so the scroll event that fires from setting scrollTop
    // does not loop back into schedulePanelSync and re-sync the panes.
    xmlScrollLockRef.current = true;
    xmlEl.scrollTop = Math.max(0, Math.min(1, fraction)) * max;
    requestAnimationFrame(() => { xmlScrollLockRef.current = false; });
  }, []);

  const schedulePanelSync = useCallback(
    (source: "old" | "new" | "xml", fraction: number) => {
      if (navSyncLockRef.current) return;
      const f = Math.max(0, Math.min(1, fraction));
      // Pane A ↔ Pane B cross-sync.
      if (source === "new") paneARef.current?.scrollToFraction(f);
      if (source === "old") paneBRef.current?.scrollToFraction(f);
      // Pane scrolling drives XML.
      if (source !== "xml") syncXmlScroll(f);
      // XML scrolling drives both panes — but only when NOT caused by a
      // programmatic syncXmlScroll call (xmlScrollLockRef prevents that loop)
      // and NOT while an XML-click navigation is in flight (xmlNavLockRef).
      if (source === "xml" && !xmlScrollLockRef.current && !xmlNavLockRef.current) {
        paneARef.current?.scrollToFraction(f);
        paneBRef.current?.scrollToFraction(f);
      }
      // PDF pane scrolling drives the live preview (one-way, no feedback loop).
      if (source === "old" || source === "new" || source === "xml") {
        previewRef.current?.scrollToFraction(f);
      }
      if (source === "old" || source === "new") {
        if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
        setPulseSide(source);
        pulseTimerRef.current = setTimeout(() => setPulseSide(null), 700);
      }
    },
    [syncXmlScroll],
  );

  const selectChunk = useCallback(async (id: number, skipXmlScroll = false) => {
    const seq = ++locateSeqRef.current;
    setActiveId(id);
    setApplyStatus("idle");
    navSyncLockRef.current = true;
    if (navSyncLockSafetyTimerRef.current) clearTimeout(navSyncLockSafetyTimerRef.current);
    navSyncLockSafetyTimerRef.current = setTimeout(() => { navSyncLockRef.current = false; }, 500);
    if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null; }
    setReviewedIds((prev) => { const next = new Set(prev); next.add(id); return next; });

    try {
      const chunk = result.chunks.find((c) => c.id === id);
      const isAdd = chunk?.kind === "add";
      const isDel = chunk?.kind === "del";

      paneARef.current?.scrollToChunk(id, chunkIds, isAdd ? getScrollFraction(result.pane_b, id) : undefined);
      paneBRef.current?.scrollToChunk(id, chunkIds, isDel ? getScrollFraction(result.pane_a, id) : undefined);

      if (xmlText && chunk) {
        const probe = (chunk.kind === "add" || chunk.kind === "mod")
          ? (chunk.text_b || chunk.text_a || "")
          : (chunk.text_a || "");
        if (probe.length >= 6) {
          const idx = xmlText.indexOf(probe.slice(0, Math.min(60, probe.length)));
          if (idx !== -1) {
            // When triggered by an XML click (skipXmlScroll), don't set navSpan
            // — doing so would make XmlEditor.revealLineInCenterIfOutsideViewport
            // scroll Monaco away from the position the user just clicked.
            if (!skipXmlScroll) {
              setNavSpan({ start: idx, end: idx + probe.length });
              requestAnimationFrame(() => scrollXmlToMark());
            }
          }
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        if (seq !== locateSeqRef.current) return;

        const loc = await apiLocate(xmlText, chunk);
        if (seq !== locateSeqRef.current) return;
        if (loc?.span_start != null && loc.span_end != null) {
          if (!skipXmlScroll) setNavSpan({ start: loc.span_start, end: loc.span_end });
        } else {
          if (!skipXmlScroll) setNavSpan(null);
        }
      }
    } catch {
      /* swallow — selectChunk is void-called throughout */
    } finally {
      setTimeout(() => {
        if (seq === locateSeqRef.current) navSyncLockRef.current = false;
      }, 350);
    }
  }, [result, xmlText, chunkIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = useCallback((dir: -1 | 1) => {
    if (filteredChunks.length === 0) return;
    const cur  = activeFilteredIndex >= 0 ? activeFilteredIndex : 0;
    const next = Math.max(0, Math.min(filteredChunks.length - 1, cur + dir));
    const tgt  = filteredChunks[next];
    if (tgt) void selectChunk(tgt.id);
  }, [filteredChunks, activeFilteredIndex, selectChunk]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target?.closest?.(".monaco-editor")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); goTo(1);  }
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp"   || e.key === "k") { e.preventDefault(); goTo(-1); }
      if (e.key === "w" || e.key === "W") setWrapLines((v) => !v);
      if ((e.key === "x" || e.key === "X") && mode === "edit") setXmlOpen((v) => !v);
      if ((e.key === "p" || e.key === "P") && mode === "edit") setPreviewOpen((v) => !v);
      if (e.key === "c" || e.key === "C") setShowAllContext((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goTo, mode]);

  useEffect(() => {
    return () => {
      if (navSyncLockSafetyTimerRef.current) clearTimeout(navSyncLockSafetyTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, []);

  const applyChunk = useCallback(async () => {
    if (mode !== "edit" || !xmlText || activeId === null) return;
    const chunk = result.chunks.find((c) => c.id === activeId);
    if (!chunk) return;

    setApplyHistory((prev) => {
      const entry = { xmlText, appliedId: activeId };
      return prev.length >= 50 ? [...prev.slice(1), entry] : [...prev, entry];
    });

    setApplyStatus("applying");
    setXmlStatus("Applying change…");

    try {
      const res = await apiApply(xmlText, chunk);
      setXmlText(res.xml_text);
      if (res.changed) {
        setApplyStatus("done");
        setXmlStatus(`✓ ${res.message}`);
        setAppliedIds((prev) => {
          const next = new Set(prev);
          if (activeId !== null) next.add(activeId);
          return next;
        });
        // Mark as XML-edited and update text_b for live sync
        setXmlEditedIds((prev) => {
          const next = new Set(prev);
          next.add(activeId);
          return next;
        });
        // Extract the actual new text from the updated XML at the applied span
        const newChunkText = (res.span_start != null && res.span_end != null)
          ? res.xml_text
              .slice(res.span_start, res.span_end)
              .replace(/<[^>]*>/g, " ")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
          : chunk.text_b;
        setChunkTextBOverrides((prev) => ({ ...prev, [activeId]: newChunkText }));
        // Patch localPaneB so the B pane re-renders with the updated text
        if (newChunkText !== chunk.text_b) {
          setLocalPaneB((prev) => patchPaneB(prev, activeId, newChunkText));
        }
        if (res.span_start != null) {
          setNavSpan({ start: res.span_start, end: res.span_end! });
          requestAnimationFrame(() => scrollXmlToMark());
          // Scroll B pane to the updated location
          const bFraction = res.xml_text.length > 0 ? res.span_start / res.xml_text.length : undefined;
          if (bFraction !== undefined) {
            setTimeout(() => paneBRef.current?.scrollToFraction(bFraction), 120);
          }
        }
        // Capture snapshot to avoid stale-closure bug in the 800ms timer.
        const snapshotFiltered = filteredChunks;
        const snapshotApplied  = new Set(appliedIds);
        snapshotApplied.add(activeId);
        autoAdvanceTimerRef.current = setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          const nextChunk = snapshotFiltered.find(
            (c) => c.id !== activeId && !snapshotApplied.has(c.id)
          );
          if (nextChunk) void selectChunk(nextChunk.id);
        }, 800);
      } else {
        setApplyStatus("idle");
        setXmlStatus(`— ${res.message}`);
      }
    } catch (e) {
      setApplyHistory((prev) => prev.slice(0, -1));
      setApplyStatus("error");
      setXmlStatus(`Error: ${(e as Error).message}`);
      setTimeout(() => setApplyStatus("idle"), 3000);
    }
  }, [mode, xmlText, activeId, result, filteredChunks, appliedIds, selectChunk]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadXml = useCallback((f: File) => {
    setXmlFilename(f.name);
    setNavSpan(null);
    setAppliedIds(new Set());
    setApplyStatus("idle");
    setApplyHistory([]);
    invalidateXmlSession();
    setXmlStatus(mode === "browse" ? `Baseline: ${f.name}` : `Loaded: ${f.name}`);
    setXmlOpen(true);
    const reader = new FileReader();
    reader.onload = (e) => setXmlText(e.target?.result as string);
    reader.readAsText(f);
  }, [mode]);

  const undoApply = useCallback(() => {
    setApplyHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setXmlText(last.xmlText);
      setAppliedIds((ids) => {
        const next = new Set(ids);
        next.delete(last.appliedId);
        return next;
      });
      setXmlStatus(`↩ Undid apply for chunk #${last.appliedId}`);
      setApplyStatus("idle");
      return prev.slice(0, -1);
    });
  }, []);

  const applyAllVisible = useCallback(async () => {
    if (mode !== "edit" || !xmlText) return;
    if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null; }
    const toApply = filteredChunks.filter((c) => !appliedIds.has(c.id));
    if (toApply.length === 0) return;
    setXmlStatus(`Applying ${toApply.length} change${toApply.length !== 1 ? "s" : ""}…`);
    setApplyStatus("applying");
    let currentXml = xmlText;
    let appliedCount = 0;
    for (const chunk of toApply) {
      try {
        const res = await apiApply(currentXml, chunk);
        if (res.changed) {
          const prevXml = currentXml;
          currentXml = res.xml_text;
          appliedCount++;
          setApplyHistory((prev) => {
            const entry = { xmlText: prevXml, appliedId: chunk.id };
            return prev.length >= 50 ? [...prev.slice(1), entry] : [...prev, entry];
          });
          setAppliedIds((prev) => new Set([...prev, chunk.id]));
        }
      } catch {
        // Non-fatal: continue applying remaining chunks
      }
    }
    setXmlText(currentXml);
    setXmlStatus(`✓ Applied ${appliedCount} of ${toApply.length} change${toApply.length !== 1 ? "s" : ""}`);
    setApplyStatus(appliedCount > 0 ? "done" : "idle");
    if (appliedCount > 0) setTimeout(() => setApplyStatus((s) => s === "done" ? "idle" : s), 3000);
  }, [mode, xmlText, filteredChunks, appliedIds]);

  // FIX: was finding the next chunk but never calling selectChunk(next.id).
  const goToNextUnreviewed = useCallback(() => {
    const startIdx = activeFilteredIndex >= 0 ? activeFilteredIndex + 1 : 0;
    const candidates = [
      ...filteredChunks.slice(startIdx),
      ...filteredChunks.slice(0, startIdx),
    ];
    const next = candidates.find((c) => !reviewedIds.has(c.id));
    if (next) void selectChunk(next.id);
  }, [filteredChunks, activeFilteredIndex, reviewedIds, selectChunk]);

  const downloadXml = useCallback(() => {
    if (mode !== "edit") return;
    const blob = new Blob([xmlText], { type: "text/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = xmlFilename
      ? xmlFilename.replace(/(\.xml)?$/, "_updated.xml")
      : "updated.xml";
    a.click();
    URL.revokeObjectURL(url);
  }, [mode, xmlText, xmlFilename]);

  const downloadUnchanged = useCallback(() => {
    const empChunks = result.chunks.filter((c) => c.kind === "emp");
    const blob = new Blob([JSON.stringify(empChunks, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "unchanged-chunks.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [result.chunks]);

  const chunkNgramCache = useMemo(() => {
    const BASE = 31;
    const MOD  = 0x1_0000_0000;

    function rollingHashes(s: string): Set<number> {
      const n = s.length;
      if (n < 6) return new Set();
      const set = new Set<number>();
      let h = 0;
      let pow = 1;
      for (let j = 0; j < 5; j++) pow = (pow * BASE) % MOD;
      for (let i = 0; i < 6; i++) h = (h * BASE + s.charCodeAt(i)) % MOD;
      set.add(h >>> 0);
      for (let i = 6; i < n; i++) {
        h = (h - (s.charCodeAt(i - 6) * pow) % MOD + MOD) % MOD;
        h = (h * BASE + s.charCodeAt(i)) % MOD;
        set.add(h >>> 0);
      }
      return set;
    }

    const cache = new Map<number, { hashes: Set<number>; total: number }>();
    for (const chunk of result.chunks) {
      const raw = (chunk.text_b ?? chunk.text_a ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (raw.length < 6) continue;
      cache.set(chunk.id, { hashes: rollingHashes(raw), total: Math.ceil((raw.length - 5) / 3) });
    }
    return cache;
  }, [result.chunks]);

  const handleXmlLineClick = useCallback(async (lineStart: number, lineEnd: number) => {
    if (!xmlText || result.chunks.length === 0) return;
    try {
      const CONTEXT_RADIUS = 600;   // reduced from 1500 — tighter = fewer false matches
      const ctxStart = Math.max(0, lineStart - CONTEXT_RADIUS);
      const ctxEnd   = Math.min(xmlText.length, lineEnd + CONTEXT_RADIUS);

      const serverLocatePromise = apiChunkLocate(xmlText, lineStart, result.chunks);

      const plainCtx = xmlText.slice(ctxStart, ctxEnd)
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();

      // ── linePlain: clicked-element text only (no radius) ─────────────────
      // Computed early so it is available for the scrollToText fallback at
      // the end of the function (when no diff chunk was matched).
      const linePlain = xmlText
        .slice(lineStart, lineEnd)
        .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
        .replace(/\s+/g, " ").trim().toLowerCase();

      // ── Earliest path: xml_context position match ──────────────────────
      // chunk.xml_context is populated by the processing service with the
      // actual XML snippet where that chunk was located. Searching for its
      // position in xmlText gives a direct, reliable XML-offset→chunk mapping
      // that bypasses all text-normalisation issues (Nº vs n°, date formats,
      // abbreviations, etc.).
      {
        let xmlCtxBestId: number | null = null;
        let xmlCtxBestDist = Infinity;
        for (const chunk of result.chunks) {
          if (chunk.kind === "del") continue;
          if (!chunk.xml_context || chunk.xml_context.length < 8) continue;
          // Use first 80 chars as the search key to avoid matching too broadly
          const key = chunk.xml_context.slice(0, 80);
          let pos = xmlText.indexOf(key);
          if (pos === -1) {
            // Try shorter key in case the stored snippet was trimmed/modified
            const shortKey = chunk.xml_context.slice(0, 40);
            pos = shortKey.length >= 8 ? xmlText.indexOf(shortKey) : -1;
          }
          if (pos === -1) continue;
          const dist = Math.abs(pos - lineStart);
          if (dist < xmlCtxBestDist) {
            xmlCtxBestDist = dist;
            xmlCtxBestId   = chunk.id;
          }
        }
        // Accept if the closest match is within 1000 chars of the click point
        if (xmlCtxBestId !== null && xmlCtxBestDist < 1000) {
          xmlNavLockRef.current = true;
          const isInPaneB = localPaneB.offsets && String(xmlCtxBestId) in localPaneB.offsets;
          void selectChunk(xmlCtxBestId, true);
          if (!isInPaneB) {
            const xmlFrac = xmlText.length > 0 ? lineStart / xmlText.length : 0;
            setTimeout(() => paneBRef.current?.scrollToFraction(xmlFrac), 100);
          }
          setTimeout(() => { xmlNavLockRef.current = false; }, 600);
          return;
        }
      }

      // ── Fast path: tight-context substring match (using original text_b) ──
      const TIGHT_RADIUS = 200;
      const tightPlain = xmlText
        .slice(Math.max(0, lineStart - TIGHT_RADIUS), Math.min(xmlText.length, lineEnd + TIGHT_RADIUS))
        .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
        .replace(/\s+/g, " ").trim().toLowerCase();
      // linePlain is now computed above (at function top) for the fallback.

      if (tightPlain.length >= 10) {
        let subMatchId: number | null = null;
        let subMatchLen = 0;
        for (const chunk of result.chunks) {
          // Skip del chunks — deleted content is NOT in the XML (new file B)
          if (chunk.kind === "del") continue;
          // Use text_b for add/mod, text_a for emp/strike (same content in both)
          const chunkProbe = ((chunk.kind === "add" || chunk.kind === "mod")
            ? (originalTextBMap[chunk.id] || chunk.text_b || chunk.text_a)
            : chunk.text_a
          )?.replace(/\s+/g, " ").trim() ?? "";
          if (chunkProbe.length < 10) continue;
          const needle = chunkProbe.slice(0, 60).toLowerCase().replace(/\s+/g, " ").trim();
          if (needle.length >= 10 && tightPlain.includes(needle) && needle.length > subMatchLen) {
            subMatchLen = needle.length;
            subMatchId  = chunk.id;
          }
        }

        // Word-overlap fallback: handles cases where chunk text and XML title are
        // semantically the same but lexically different — e.g. "n° 2 de 12/8/2020"
        // vs "Nº 2, DE 12 DE AGOSTO DE 2020" (different Unicode degree/ordinal chars,
        // different date formats). Strip punctuation/ordinals, split into words ≥3 chars,
        // and accept if ≥50% of the chunk's meaningful words appear in the XML context.
        // IMPORTANT: use linePlain (clicked line only, no radius) NOT tightPlain here —
        // tightPlain includes adjacent paragraphs whose vocabulary falsely matches other
        // chunks (e.g. the "Consolida os critérios..." paragraph right below the heading).
        if (subMatchId === null) {
          const normalizeWords = (s: string) =>
            s.toLowerCase().replace(/[°º\/,\.]/g, " ").replace(/\s+/g, " ").trim()
              .split(" ").filter(w => w.length >= 3);
          const ctxWordSet = new Set(normalizeWords(linePlain));
          let wordBestId: number | null = null;
          let wordBestRatio = 0;
          for (const chunk of result.chunks) {
            if (chunk.kind === "del") continue;
            const chunkProbeW = ((chunk.kind === "add" || chunk.kind === "mod")
              ? (originalTextBMap[chunk.id] || chunk.text_b || chunk.text_a)
              : chunk.text_a
            )?.replace(/\s+/g, " ").trim() ?? "";
            const chunkWords = normalizeWords(chunkProbeW);
            if (chunkWords.length < 2) continue;
            let hits = 0;
            for (const w of chunkWords) { if (ctxWordSet.has(w)) hits++; }
            const ratio = hits / chunkWords.length;
            if (ratio >= 0.5 && ratio > wordBestRatio) {
              wordBestRatio = ratio;
              wordBestId = chunk.id;
            }
          }
          if (wordBestId !== null) subMatchId = wordBestId;
        }

        if (subMatchId !== null) {
          xmlNavLockRef.current = true;
          const isInPaneB = localPaneB.offsets && String(subMatchId) in localPaneB.offsets;
          void selectChunk(subMatchId, true);
          if (!isInPaneB) {
            // Chunk not tracked in pane B offsets — scroll B directly by XML fraction
            const xmlFrac = xmlText.length > 0 ? lineStart / xmlText.length : 0;
            setTimeout(() => paneBRef.current?.scrollToFraction(xmlFrac), 100);
          }
          setTimeout(() => { xmlNavLockRef.current = false; }, 600);
          return;
        }
      }

      let fastBestId: number | null = null;
      let fastBestScore = 0;

      if (plainCtx.length >= 6) {
        const BASE = 31;
        const MOD  = 0x1_0000_0000;
        const ctxLower = plainCtx.toLowerCase();
        const ctxHashes = new Set<number>();
        let h = 0;
        let pow = 1;
        for (let j = 0; j < 5; j++) pow = (pow * BASE) % MOD;
        for (let i = 0; i < 6; i++) h = (h * BASE + ctxLower.charCodeAt(i)) % MOD;
        ctxHashes.add(h >>> 0);
        for (let i = 6; i < ctxLower.length; i++) {
          h = (h - (ctxLower.charCodeAt(i - 6) * pow) % MOD + MOD) % MOD;
          h = (h * BASE + ctxLower.charCodeAt(i)) % MOD;
          ctxHashes.add(h >>> 0);
        }

        for (const chunk of result.chunks) {
          // Skip del chunks — deleted content is NOT in the XML (new file B)
          if (chunk.kind === "del") continue;
          const cached = chunkNgramCache.get(chunk.id);
          if (!cached) continue;
          let hits = 0;
          for (const nh of cached.hashes) {
            if (ctxHashes.has(nh)) hits++;
          }
          const score = cached.total > 0 ? hits / cached.total : 0;
          if (score > fastBestScore) {
            fastBestScore = score;
            fastBestId = chunk.id;
          }
        }
      }

      // Lock: prevent syncXmlScroll from scrolling the XML panel away from
      // the position the user just clicked, for the duration of this navigation.
      xmlNavLockRef.current = true;
      const releaseNavLock = () => { xmlNavLockRef.current = false; };

      const serverResult = await serverLocatePromise;
      if (serverResult?.success && serverResult.chunk_id != null) {
        const isInPaneBServer = localPaneB.offsets && String(serverResult.chunk_id) in localPaneB.offsets;
        void selectChunk(serverResult.chunk_id, true /* skipXmlScroll */);
        if (!isInPaneBServer) {
          const xmlFrac = xmlText.length > 0 ? lineStart / xmlText.length : 0;
          setTimeout(() => paneBRef.current?.scrollToFraction(xmlFrac), 100);
        }
        setTimeout(releaseNavLock, 600);
        return;
      }

      if (plainCtx.length >= 10) {
        const probe     = plainCtx.slice(0, 160).replace(/\s+/g, " ").trim();
        const locChunk  = fastBestId !== null ? result.chunks.find((c) => c.id === fastBestId) ?? null : null;
        const synthetic = locChunk ?? {
          id: -1, kind: "mod" as const, block_a: -1, block_b: -1,
          text_a: probe, text_b: probe, confidence: 1.0, reason: "",
          context_a: "", context_b: "", xml_context: "", words_removed: "",
          words_added: "", words_before: "", words_after: "", section: "", emp_detail: "",
        };
        const loc = await apiLocate(xmlText, synthetic);
        if (loc?.span_start != null) {
          const spanMid = (loc.span_start + (loc.span_end ?? loc.span_start)) / 2;
          let closestId: number | null = null;
          let closestDist = Infinity;
          // XML is based on the new file (pane B) — use pane_b.offsets as primary.
          // Fall back to pane_a.offsets only if pane_b has no offsets at all.
          const primaryOffsets = Object.keys(result.pane_b.offsets ?? {}).length > 0
            ? result.pane_b.offsets
            : result.pane_a.offsets;
          for (const [k, off] of Object.entries(primaryOffsets ?? {}) as Array<[string, number]>) {
            const d = Math.abs(Number(off) - spanMid);
            if (d < closestDist) { closestDist = d; closestId = Number(k); }
          }
          if (closestId !== null) void selectChunk(closestId, true /* skipXmlScroll */);
        } else if (fastBestId !== null && fastBestScore < 0.30) {
          void selectChunk(fastBestId, true /* skipXmlScroll */);
        }
      }
      // ── Text-search fallback (Option 2): scroll both panes to the clicked text ─
      // Runs when no diff chunk could be matched — handles unchanged XML content
      // whose text exists in the PDF but is not part of any diff chunk.
      // Both panes are scrolled independently so A and B stay in sync.
      // scrollToText returns false (no-op) if the text scores below threshold,
      // so pane A won't jump to a wrong position when text only exists in B.
      if (linePlain.length >= 4) {
        paneBRef.current?.scrollToText(linePlain);
        paneARef.current?.scrollToText(linePlain);
      }

      setTimeout(releaseNavLock, 600);
    } catch { /* best-effort; must not throw */ }
  }, [xmlText, result.chunks, result.pane_a.offsets, localPaneB.offsets, chunkNgramCache, selectChunk, localPaneB]); // eslint-disable-line react-hooks/exhaustive-deps

  const posLabel = activeFilteredIndex >= 0
    ? `${activeFilteredIndex + 1} / ${filteredChunks.length}`
    : `— / ${filteredChunks.length}`;

  const modeBadgeText  = mode === "edit" ? "WF2 · editable" : "WF1 · read-only";
  const modeBadgeColor = mode === "edit"
    ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
    : "bg-slate-500/10 text-slate-400 border-slate-500/20";

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0a1020] overflow-hidden">

      {/* Chunk Level Filter UI (WF2 only) */}
      {mode === "edit" && sectionsWithChanges.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1.5 bg-white dark:bg-[#0a1020] z-10">
          <span className="text-[11px] font-semibold text-slate-400 mr-2 mt-1">CHUNK LEVEL</span>
          <button
            className={`px-2 py-0.5 rounded-full text-[11px] font-bold border transition-all ${!filterSection ? "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-900/30 dark:text-orange-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
            onClick={() => setFilterSection(null)}
          >
            All
          </button>
          {sectionsWithChanges.map((s) => (
            <button
              key={s.label}
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold border transition-all ${filterSection === s.label ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/60 dark:text-orange-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
              onClick={() => setFilterSection(s.label)}
            >
              {s.label} <span className="ml-1 text-[10px] font-mono font-normal">({sectionCountMap.get(s.label) ?? 0})</span>
            </button>
          ))}
        </div>
      )}

      {isStreaming && (
        <div className="flex-shrink-0 relative h-0.5 bg-slate-200 dark:bg-white/8 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-teal-500 transition-all duration-500"
            style={{ width: `${streamingProgress?.pct ?? 0}%` }}
          />
        </div>
      )}

      {/* Top toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5
        border-b border-slate-200 dark:border-white/8
        bg-slate-50 dark:bg-[#0d1525]">

        <button
          onClick={onReset}
          title="New comparison"
          className="flex items-center gap-1 text-[11px] font-semibold text-slate-400
            hover:text-slate-700 dark:hover:text-slate-200 transition-colors pr-2
            border-r border-slate-200 dark:border-white/10 mr-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          New
        </button>

        <span className="text-[11px] font-mono text-rose-400 truncate max-w-[140px]" title={result.file_a}>
          {result.file_a}
        </span>
        <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4M4 17h12m0 0l-4-4m4 4l-4 4" />
        </svg>
        <span className="text-[11px] font-mono text-emerald-400 truncate max-w-[140px]" title={result.file_b}>
          {result.file_b}
        </span>

        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1 flex-shrink-0" />

        <div className="flex items-center gap-2 flex-shrink-0">
          <StatPill label="+" count={result.stats.additions}     cls="text-emerald-500" />
          <StatPill label="-" count={result.stats.deletions}     cls="text-rose-500" />
          <StatPill label="~" count={result.stats.modifications} cls="text-amber-500" />
          <StatPill label="○" count={result.stats.emphasis}      cls="text-violet-500" />
          <StatPill label="~̶" count={result.stats.strike ?? 0}  cls="text-rose-300" />
          {isStreaming && streamingProgress && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-teal-400 bg-teal-500/10 border border-teal-500/25 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse flex-shrink-0" />
              {streamingProgress.batch != null && streamingProgress.totalBatches != null
                ? `Batch ${streamingProgress.batch}/${streamingProgress.totalBatches}`
                : "Loading…"}
            </span>
          )}
        </div>

        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1 flex-shrink-0" />

        {/* Chunk navigation */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => goTo(-1)} disabled={activeFilteredIndex <= 0}
            title="Previous change (← ↑ K)"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[10px] font-mono text-slate-400 tabular-nums w-14 text-center select-none">
            {posLabel}
          </span>
          <button onClick={() => goTo(1)}
            disabled={activeFilteredIndex < 0 || activeFilteredIndex >= filteredChunks.length - 1}
            title="Next change (→ ↓ J)"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {filteredChunks.length > 0 && reviewedIds.size > 0 && filteredChunks.some((c) => !reviewedIds.has(c.id)) && (
          <button onClick={goToNextUnreviewed} title="Jump to next unreviewed change"
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold
              bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-all">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="hidden sm:inline">Unreviewed ({filteredChunks.filter((c) => !reviewedIds.has(c.id)).length})</span>
          </button>
        )}

        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1 flex-shrink-0" />

        <div className="flex items-center gap-1 flex-shrink-0">
          <IconBtn title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} active={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="hidden sm:inline">List</span>
          </IconBtn>

          <IconBtn title={wrapLines ? "Aligned lines (W)" : "Wrap lines (W)"} active={wrapLines} onClick={() => setWrapLines((v) => !v)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-4 6l4-4-4-4" />
            </svg>
            <span className="hidden sm:inline">Wrap</span>
          </IconBtn>

          {/* Show All Lines toggle — default ON so nothing is hidden */}

          <IconBtn
            title={showAllContext ? "Collapse unchanged lines (C)" : "Show all lines (C)"}
            active={showAllContext}
            onClick={() => setShowAllContext((v) => !v)}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="hidden sm:inline">All Lines</span>
          </IconBtn>

          {mode === "edit" && (
            <>
              <IconBtn title={xmlOpen ? "Hide XML panel (X)" : "Show XML panel (X)"} active={xmlOpen} onClick={() => setXmlOpen((v) => !v)}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span className="hidden sm:inline">XML</span>
              </IconBtn>
              {xmlOpen && (
                <IconBtn title={previewOpen ? "Hide live preview (P)" : "Show live preview (P)"} active={previewOpen} onClick={() => setPreviewOpen((v) => !v)}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span className="hidden sm:inline">Preview</span>
                </IconBtn>
              )}
            </>
          )}

          {result.chunks.some((c) => c.kind === "emp") && (
            <IconBtn title="Download unchanged chunks as JSON" active={false} onClick={downloadUnchanged}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
              </svg>
              <span className="hidden sm:inline">Unchanged</span>
            </IconBtn>
          )}
        </div>

        <div className="flex-1" />

        {mode === "edit" && applyStatus !== "idle" && (
          <div className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold ${
            applyStatus === "applying" ? "bg-amber-500/15 text-amber-400" :
            applyStatus === "done"     ? "bg-emerald-500/15 text-emerald-400" :
            "bg-rose-500/15 text-rose-400"
          }`}>
            {applyStatus === "applying" && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {applyStatus === "done" && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {applyStatus === "applying" ? "Applying…" : applyStatus === "done" ? "Applied" : "Error"}
          </div>
        )}

        <span className={`flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${modeBadgeColor}`}>
          {modeBadgeText}
        </span>

        <span className="hidden lg:flex items-center gap-1 text-[9px] text-slate-500 dark:text-slate-600 flex-shrink-0">
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">← →</kbd>
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">J K</kbd>
          navigate
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">W</kbd>
          wrap
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">C</kbd>
          context
          {mode === "edit" && (
            <>
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">X</kbd>
              xml
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">P</kbd>
              preview
            </>
          )}
        </span>
      </div>

      {/* Section filter tabs */}
      {sectionsWithChanges.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto
          border-b border-slate-200 dark:border-white/8
          bg-white dark:bg-[#0a1020] scrollbar-none">
          <button
            onClick={() => setFilterSection(null)}
            className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all
              ${!filterSection
                ? "bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/30"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
          >
            All ({result.stats.total})
          </button>
          {sectionsWithChanges.map((sec) => {
            const count    = sectionCountMap.get(sec.label) ?? 0;
            const isActive = filterSection === sec.label;
            return (
              <button
                key={sec.id}
                onClick={() => {
                  setFilterSection(isActive ? null : sec.label);
                  if (!isActive) {
                    const first = result.chunks.find(
                      (c) => mapSection(c.section ?? "") === sec.label,
                    );
                    if (first) void selectChunk(first.id);
                  }
                }}
                className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-all
                  ${isActive
                    ? "bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/30"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}
              >
                <span className="truncate max-w-[120px]">{sec.label}</span>
                <span className="opacity-60 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-hidden min-h-0 flex">

        {sidebarOpen && (
          <div className="flex-shrink-0 w-[240px] min-w-[240px] flex flex-col
            border-r border-slate-200 dark:border-white/8">
            <ChunkList
              chunks={filteredChunks}
              stats={filteredStats}
              activeId={activeId}
              appliedIds={appliedIds}
              reviewedIds={reviewedIds}
              onSelect={selectChunk}
              collapsed={false}
              onToggle={() => setSidebarOpen(false)}
              headerActions={mode === "edit" && filteredChunks.some((c) => !appliedIds.has(c.id)) ? (
                <button
                  onClick={() => void applyAllVisible()}
                  disabled={applyStatus === "applying"}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                    text-[10px] font-semibold bg-violet-500/15 text-violet-400
                    hover:bg-violet-500/25 border border-violet-500/30 transition-all
                    disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Apply all currently-visible unapplied changes to the XML"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Apply All Visible ({filteredChunks.filter((c) => !appliedIds.has(c.id)).length})
                </button>
              ) : undefined}
              xmlEditedIds={xmlEditedIds}
            />
          </div>
        )}

        {!sidebarOpen && (
          <div className="flex-shrink-0 flex flex-col items-center py-3 gap-2 bg-slate-50 dark:bg-[#0d1424]
            border-r border-slate-200 dark:border-white/8">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/8 text-slate-400 transition-colors"
              title="Expand sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
            <span className="text-[9px] font-bold text-slate-400 [writing-mode:vertical-lr] tracking-wider">
              {filteredStats.total} CHANGES
            </span>
          </div>
        )}

        <div ref={containerRef} className="flex-1 min-w-0 flex flex-col overflow-hidden">

          <div className="flex-1 min-h-0 flex relative overflow-hidden">

            <div className="min-w-0 overflow-hidden" style={{ width: `${splitPct}%` }}>
              <DiffPane
                ref={paneARef}
                pane={result.pane_a}
                chunks={result.chunks}
                activeChunkId={activeId}
                activeChunk={activeChunk}
                filename={result.file_a}
                side="a"
                wrapLines={wrapLines}
                alignedLines={linesA}
                headerStats={paneAHeaderStats}
                onJumpToFirst={firstPaneAChunk ? () => selectChunk(firstPaneAChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("old", f)}
                onScrollLeft={(left) => !wrapLines && setSyncScrollLeft({ side: "a", left })}
                syncScrollLeft={syncScrollLeft?.side === "b" ? syncScrollLeft.left : null}
                onUnfoldRow={handleUnfoldRow}
                isScrollSource={pulseSide === "old"}
              />
            </div>

            <div
              className="flex-shrink-0 w-1 cursor-col-resize hover:bg-teal-400/40
                active:bg-teal-500/50 transition-colors relative z-10
                bg-slate-200/60 dark:bg-white/[0.06]"
              onMouseDown={startDragV}
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                flex flex-col gap-0.5 opacity-40">
                {[0,1,2].map((i) => (
                  <div key={i} className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500" />
                ))}
              </div>
            </div>

            <div className="min-w-0 flex-1 overflow-hidden">
              <DiffPane
                ref={paneBRef}
                pane={localPaneB}
                chunks={result.chunks}
                activeChunkId={activeId}
                activeChunk={activeChunk}
                filename={result.file_b}
                side="b"
                wrapLines={wrapLines}
                alignedLines={linesB}
                headerStats={paneBHeaderStats}
                onJumpToFirst={firstPaneBChunk ? () => selectChunk(firstPaneBChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("new", f)}
                onScrollLeft={(left) => !wrapLines && setSyncScrollLeft({ side: "b", left })}
                syncScrollLeft={syncScrollLeft?.side === "a" ? syncScrollLeft.left : null}
                onUnfoldRow={handleUnfoldRow}
                isScrollSource={pulseSide === "new"}
              />
            </div>
          </div>

          {mode === "edit" && xmlOpen && (
            <>
              <div
                className="flex-shrink-0 h-1 cursor-row-resize hover:bg-teal-400/40
                  active:bg-teal-500/50 transition-colors relative z-10
                  bg-slate-200/60 dark:bg-white/[0.06]"
                onMouseDown={startDragH}
              >
                <div className="absolute -top-1.5 -bottom-1.5 inset-x-0" />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                  flex gap-0.5 opacity-40">
                  {[0,1,2].map((i) => (
                    <div key={i} className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500" />
                  ))}
                </div>
              </div>
              <div ref={xmlPanelContainerRef} className="flex-shrink-0 overflow-hidden flex" style={{ height: xmlHeight }}>
                {/* XML editor — width controlled by previewSplit when preview is open */}
                <div
                  className="overflow-hidden"
                  style={previewOpen ? { width: `${previewSplit}%`, flexShrink: 0 } : { flex: 1, minWidth: 0 }}
                >
                  <XmlPanel
                    ref={xmlRef}
                    mode={mode}
                    xmlText={xmlText}
                    xmlFilename={xmlFilename}
                    activeChunk={activeChunk}
                    appliedIds={appliedIds}
                    navSpan={navSpan}
                    status={xmlStatus}
                    onLoad={loadXml}
                    onApply={applyChunk}
                    onDownload={downloadXml}
                    onXmlChange={setXmlText}
                    onScrollFraction={(f) => schedulePanelSync("xml", f)}
                    canUndo={applyHistory.length > 0}
                    onUndo={undoApply}
                    onXmlLineClick={handleXmlLineClick}
                  />
                </div>

                {/* Draggable splitter between XML editor and preview */}
                {previewOpen && (
                  <>
                    <div
                      className="flex-shrink-0 w-1 cursor-col-resize hover:bg-teal-400/40
                        active:bg-teal-500/50 transition-colors relative z-10
                        bg-slate-200/60 dark:bg-white/[0.06]"
                      onMouseDown={startDragPreview}
                    >
                      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                        flex flex-col gap-0.5 opacity-40">
                        {[0,1,2].map((i) => (
                          <div key={i} className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500" />
                        ))}
                      </div>
                    </div>

                    {/* Live HTML preview — takes the remaining width */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <XmlPreviewPanel ref={previewRef} xmlText={xmlText} />
                    </div>
                  </>
                )}
              </div>
            </>
          )}


          {/* Only show WordDiffPanel for the active chunk, and only if open for that chunk */}
          <WordDiffPanel
            chunk={activeChunk}
            open={wordPanelOpenId === activeChunk?.id}
            onToggle={() => handleWordPanelToggle(activeChunk?.id ?? -1)}
          />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-3 h-6
        border-t border-slate-200 dark:border-white/8
        bg-slate-50 dark:bg-[#0d1525] text-[10px] font-mono">

        {activeChunk && (
          <span className={`font-bold ${
            activeChunk.kind === "add" ? "text-emerald-500" :
            activeChunk.kind === "del" ? "text-rose-500" :
            activeChunk.kind === "mod" ? "text-amber-500" : "text-violet-500"
          }`}>
            {activeChunk.kind.toUpperCase()}
          </span>
        )}

        {activeChunk?.section && (
          <span className="text-slate-400 dark:text-slate-500 truncate max-w-[200px]">
            {activeChunk.section}
          </span>
        )}

        <div className="flex-1" />

        {activeChunk && (
          <span className={`tabular-nums ${
            activeChunk.confidence >= 0.8 ? "text-emerald-500" :
            activeChunk.confidence >= 0.5 ? "text-amber-500" : "text-rose-500"
          }`}>
            {Math.round(activeChunk.confidence * 100)}% conf
          </span>
        )}

        {appliedIds.size > 0 && (
          <span className="text-teal-500">✓ {appliedIds.size} applied</span>
        )}

        <span className="text-slate-400 dark:text-slate-600">
          {posLabel} changes
        </span>

        {wrapLines && (
          <span className="text-teal-500/70">wrap</span>
        )}

        {!showAllContext && (
          <span className="text-amber-500/70">folded</span>
        )}
      </div>
    </div>
  );
}