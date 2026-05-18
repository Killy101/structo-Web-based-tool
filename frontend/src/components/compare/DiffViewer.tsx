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
  WorkflowMode,
  XmlSection,
  XmlScrollTarget,
} from "./types";
import { apiApply, apiLocate, apiChunkLocate, invalidateXmlSession } from "./api";
import type { DiffProgress } from "./api";
import ChunkList from "./ChunkList";
import DiffPane, { buildAlignedLines, foldUnchangedLines } from "./DiffPane";
import type { AlignedLine, FoldMapEntry } from "./DiffPane";
import XmlPanel  from "./XmlPanel";
import WordDiffPanel from "./WordDiffPanel";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  mode:               WorkflowMode;
  result:             DiffResult;
  onReset:            () => void;
  initialXmlFile?:    File | null;
  xmlSections?:       XmlSection[];
  initialSection?:    string | null;
  sectionMapper?:     (chunkSection: string) => string | null;
  isStreaming?:       boolean;
  streamingProgress?: DiffProgress | null;
}

type ApplyStatus = "idle" | "applying" | "done" | "error";
type LocateSignal = {
  source: "server" | "heuristic";
  score: number;
  chunkId: number;
};
const FAST_XML_LOCATE_MIN_SCORE = 0.30;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export default function DiffViewer({
  mode,
  result,
  onReset,
  initialXmlFile,
  xmlSections,
  initialSection,
  sectionMapper,
  isStreaming       = false,
  streamingProgress = null,
}: Props) {
  const [activeId,      setActiveId]      = useState<number | null>(result.chunks[0]?.id ?? null);
  const [appliedIds,    setAppliedIds]    = useState<Set<number>>(new Set());
  const [applyStatus,   setApplyStatus]   = useState<ApplyStatus>("idle");
  const [xmlText,       setXmlText]       = useState("");
  const [xmlFilename,   setXmlFilename]   = useState<string | null>(null);
  const [xmlStatus,     setXmlStatus]     = useState("");
  const [locateSignal,  setLocateSignal]  = useState<LocateSignal | null>(null);
  const [navSpan,       setNavSpan]       = useState<{ start: number; end: number } | null>(null);
  const [xmlOpen,       setXmlOpen]       = useState(mode === "edit" || !!initialXmlFile);
  const [filterSection, setFilterSection] = useState<string | null>(initialSection ?? null);
  const [syncScrollLeft, setSyncScrollLeft] = useState<{side:"a"|"b"; left:number} | null>(null);
  const [wordPanelOpen, setWordPanelOpen] = useState(true);
  const [applyHistory, setApplyHistory]   = useState<{ xmlText: string; appliedId: number }[]>([]);
  const [expandedFoldKeys, setExpandedFoldKeys] = useState<Set<number>>(() => new Set());

  // showAllContext = true means ALL lines are visible (no folding).
  // This is the correct default — matches Beyond Compare / VSCode behaviour.
  // Users can toggle folding with the "Collapse" button or press C.
  const [showAllContext, setShowAllContext] = useState(true);

  const [pulseSide,    setPulseSide]      = useState<"old" | "new" | null>(null);

  const containerRef   = useRef<HTMLDivElement>(null);
  const paneARef       = useRef<DiffPaneHandle>(null);
  const paneBRef       = useRef<DiffPaneHandle>(null);
  const xmlRef         = useRef<XmlScrollTarget>(null);
  const locateSeqRef   = useRef(0);
  const xmlLocateSeqRef = useRef(0);
  // navSyncLock prevents scroll-sync echo immediately after chunk navigation
  const navSyncLockRef = useRef(false);
  const navSyncLockSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyLockRef   = useRef(false);
  const appliedIdsRef  = useRef<Set<number>>(new Set());

  const [splitPct,  startDragV] = useDragSplitter(containerRef, 50,  "x", 20, 80);
  const [xmlHeight, startDragH] = useDragSplitter(containerRef, 260, "y", 120, 560);

  // ── Load initial XML file ─────────────────────────────────────────────────
  useEffect(() => {
    if (!initialXmlFile || xmlText) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setXmlFilename(initialXmlFile.name);
      setXmlText(typeof e.target?.result === "string" ? e.target.result : "");
      setXmlStatus(mode === "browse"
        ? `Baseline: ${initialXmlFile.name}`
        : `Loaded: ${initialXmlFile.name}`);
      setXmlOpen(true);
    };
    reader.readAsText(initialXmlFile);
  }, [initialXmlFile, xmlText, mode]);

  // ── Alignment — separate from chunks (visual layer only) ──────────────────
  // alignmentChunks is stable: changes only when result.chunks identity changes.
  const alignmentChunks = useMemo(() => [...result.chunks], [result.chunks]);

  // Build raw aligned lines from pane data + chunk positions.
  // This is the pure alignment computation; it knows nothing about UI state

  // Reset fold/review state when result changes

  // ── Auto-scroll to first chunk on load ───────────────────────────────────
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    // New compare payload should start from first chunk and clear stale review state.
    setActiveId(result.chunks[0]?.id ?? null);
    setNavSpan(null);
    setLocateSignal(null);
    setAppliedIds(new Set());
    appliedIdsRef.current = new Set();
    didAutoScrollRef.current = false;
  }, [result.chunks, result.file_a, result.file_b]);

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

  // ── Section / filter helpers ──────────────────────────────────────────────
  const mapSection = useCallback(
    (s: string) => sectionMapper ? sectionMapper(s) : s,
    [sectionMapper],
  );

  const filteredChunks = useMemo(() => {
    const base = result.chunks;
    if (!filterSection) return base;
    return base.filter((c) => mapSection(c.section ?? "") === filterSection);
  }, [result.chunks, filterSection, mapSection]);

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

  // ── Build aligned lines (visual layer only) ───────────────────────────────
  const { linesA: rawLinesA, linesB: rawLinesB } = useMemo(() => {
    return buildAlignedLines(result.pane_a, result.pane_b, alignmentChunks);
  }, [result.pane_a, result.pane_b, alignmentChunks]);

  // ── Apply optional folding ────────────────────────────────────────────────
  // When showAllContext is true (default) NO lines are hidden — every line
  // from both PDFs is visible, matching professional diff tool behaviour.
  // When the user explicitly toggles folding, foldUnchangedLines runs and
  // the foldMap returned is used for O(1) safe fold expansion.
  const { linesA, linesB } = useMemo(() => {
    if (showAllContext) {
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
  }, [showAllContext, rawLinesA, rawLinesB, expandedFoldKeys]);


  useEffect(() => {
    setExpandedFoldKeys(new Set());
  }, [result.chunks]);

  const handleUnfoldRow = useCallback((foldKey: number) => {
    setExpandedFoldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(foldKey)) next.delete(foldKey); else next.add(foldKey);
      return next;
    });
  }, []);

  function scrollXmlToMark() {
    const el = xmlRef.current;
    if (!el) return;
    if (el.tagName !== "DIV") return;
    (el as unknown as HTMLDivElement).querySelector("mark")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function getScrollFraction(paneData: typeof result.pane_a, chunkId: number) {
    const off = paneData?.offsets?.[String(chunkId)];
    if (off == null) return undefined;
    let total = 0;
    for (const [text] of paneData.segments) total += text.length;
    return total > 0 ? off / total : undefined;
  }

  const syncXmlScroll = useCallback((fraction: number) => {
    const xmlEl = xmlRef.current;
    if (!xmlEl) return;
    const max = xmlEl.scrollHeight - xmlEl.clientHeight;
    if (max <= 0) return;
    xmlEl.scrollTop = Math.max(0, Math.min(1, fraction)) * max;
  }, []);

  /**
   * Central scroll-sync dispatcher.
   * Receives a scroll fraction from one panel and propagates to all others.
   * navSyncLock suppresses echo when navigating by chunk.
   */
  const schedulePanelSync = useCallback(
    (source: "old" | "new" | "xml", fraction: number) => {
      if (navSyncLockRef.current) return;
      const f = Math.max(0, Math.min(1, fraction));
      if (source !== "old") paneARef.current?.scrollToFraction(f);
      if (source !== "new") paneBRef.current?.scrollToFraction(f);
      if (source !== "xml") syncXmlScroll(f);
      if (source === "old" || source === "new") {
        if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
        setPulseSide(source);
        pulseTimerRef.current = setTimeout(() => setPulseSide(null), 700);
      }
    },
    [syncXmlScroll],
  );

  // ── Chunk selection ───────────────────────────────────────────────────────

  const selectChunk = useCallback(async (id: number, signal?: LocateSignal) => {
    const seq = ++locateSeqRef.current;
    setLocateSignal(signal ?? null);
    setActiveId(id);
    setApplyStatus("idle");

    // Lock scroll-sync during navigation to prevent echo
    navSyncLockRef.current = true;
    if (navSyncLockSafetyTimerRef.current) clearTimeout(navSyncLockSafetyTimerRef.current);
    navSyncLockSafetyTimerRef.current = setTimeout(() => { navSyncLockRef.current = false; }, 500);
    if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null; }

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
          // Escape XML entities in the probe so it matches the serialized XML text
          const escaped = probe.slice(0, Math.min(60, probe.length))
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
          const idx = xmlText.indexOf(escaped);
          if (idx !== -1) {
            setNavSpan({ start: idx, end: idx + escaped.length });
            requestAnimationFrame(scrollXmlToMark);
          }
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        if (seq !== locateSeqRef.current) return;

        const loc = await apiLocate(xmlText, chunk);
        if (seq !== locateSeqRef.current) return;
        if (loc?.span_start != null && loc.span_end != null) {
          setNavSpan({ start: loc.span_start, end: loc.span_end });
        } else {
          setNavSpan(null);
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

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target?.closest?.(".monaco-editor")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); goTo(1);  }
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp"   || e.key === "k") { e.preventDefault(); goTo(-1); }
      if (e.key === "x" || e.key === "X") setXmlOpen((v) => !v);
      if (e.key === "c" || e.key === "C") setShowAllContext((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goTo]);

  useEffect(() => {
    return () => {
      if (navSyncLockSafetyTimerRef.current) clearTimeout(navSyncLockSafetyTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, []);

  // ── Apply logic ───────────────────────────────────────────────────────────

  const applyChunk = useCallback(async () => {
    if (mode !== "edit" || !xmlText || activeId === null) return;
    if (applyLockRef.current) return;
    const chunk = result.chunks.find((c) => c.id === activeId);
    if (!chunk) return;

    applyLockRef.current = true;
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
        appliedIdsRef.current = new Set([...appliedIdsRef.current, activeId]);
        setAppliedIds((prev) => {
          const next = new Set(prev);
          if (activeId !== null) next.add(activeId);
          return next;
        });
        if (res.span_start != null && res.span_end != null) {
          setNavSpan({ start: res.span_start, end: res.span_end });
          requestAnimationFrame(scrollXmlToMark);
        }
        const snapshotFiltered = filteredChunks;
        const snapshotApplied  = new Set(appliedIdsRef.current);
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
    } finally {
      applyLockRef.current = false;
    }
  }, [mode, xmlText, activeId, result, filteredChunks, selectChunk]);

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
    if (applyLockRef.current) return;
    if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null; }
    const toApply = filteredChunks.filter((c) => !appliedIdsRef.current.has(c.id));
    if (toApply.length === 0) return;
    applyLockRef.current = true;
    setXmlStatus(`Applying ${toApply.length} change${toApply.length !== 1 ? "s" : ""}…`);
    setApplyStatus("applying");
    let currentXml   = xmlText;
    let appliedCount = 0;
    try {
      for (const chunk of toApply) {
        try {
          const res = await apiApply(currentXml, chunk);
          if (res.changed) {
            const prevXml = currentXml;
            currentXml = res.xml_text;
            appliedCount++;
            appliedIdsRef.current = new Set([...appliedIdsRef.current, chunk.id]);
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
    } finally {
      applyLockRef.current = false;
    }
  }, [mode, xmlText, filteredChunks]);

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

  // ── XML → PDF navigation (chunk locate from cursor position) ─────────────

  // Pre-build n-gram cache for fast client-side chunk matching
  const chunkNgramCache = useMemo(() => {
    const BASE = 31;
    const MOD  = 0x1_0000_0000;

    function rollingHashes(s: string): Set<number> {
      const n = s.length;
      if (n < 6) return new Set();
      const set = new Set<number>();
      let h = 0, pow = 1;
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
    const reqId = ++xmlLocateSeqRef.current;
    try {
      const CONTEXT_RADIUS = 1500;
      const ctxStart = Math.max(0, lineStart - CONTEXT_RADIUS);
      const ctxEnd   = Math.min(xmlText.length, lineEnd + CONTEXT_RADIUS);

      const serverLocatePromise = apiChunkLocate(xmlText, lineStart);

      const plainCtx = xmlText.slice(ctxStart, ctxEnd)
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();

      let fastBestId: number | null = null;
      let fastBestScore = 0;

      if (plainCtx.length >= 6) {
        const BASE = 31;
        const MOD  = 0x1_0000_0000;
        const ctxLower  = plainCtx.toLowerCase();
        const ctxHashes = new Set<number>();
        let h = 0, pow = 1;
        for (let j = 0; j < 5; j++) pow = (pow * BASE) % MOD;
        for (let i = 0; i < 6; i++) h = (h * BASE + ctxLower.charCodeAt(i)) % MOD;
        ctxHashes.add(h >>> 0);
        for (let i = 6; i < ctxLower.length; i++) {
          h = (h - (ctxLower.charCodeAt(i - 6) * pow) % MOD + MOD) % MOD;
          h = (h * BASE + ctxLower.charCodeAt(i)) % MOD;
          ctxHashes.add(h >>> 0);
        }

        for (const chunk of result.chunks) {
          const cached = chunkNgramCache.get(chunk.id);
          if (!cached) continue;
          let hits = 0;
          for (const nh of cached.hashes) {
            if (ctxHashes.has(nh)) hits++;
          }
          const score = cached.total > 0 ? hits / cached.total : 0;
          if (score > fastBestScore) {
            fastBestScore = score;
            fastBestId    = chunk.id;
          }
        }
      }

      const serverResult = await serverLocatePromise;
      if (reqId !== xmlLocateSeqRef.current) return;
      if (serverResult?.success && serverResult.chunk_id != null) {
        const serverScoreRaw = Number(serverResult.score);
        const serverScore = Number.isFinite(serverScoreRaw)
          ? Math.max(0, Math.min(1, serverScoreRaw))
          : 1;
        void selectChunk(serverResult.chunk_id, {
          source: "server",
          score: serverScore,
          chunkId: serverResult.chunk_id,
        });
        return;
      }

      if (fastBestId !== null && fastBestScore >= FAST_XML_LOCATE_MIN_SCORE) {
        void selectChunk(fastBestId, {
          source: "heuristic",
          score: fastBestScore,
          chunkId: fastBestId,
        });
        return;
      }

      if (plainCtx.length >= 10) {
        const probe    = plainCtx.slice(0, 160).replace(/\s+/g, " ").trim();
        const locChunk = fastBestId !== null ? result.chunks.find((c) => c.id === fastBestId) ?? null : null;
        const synthetic = locChunk ?? {
          id: -1, kind: "mod" as const, block_a: -1, block_b: -1,
          text_a: probe, text_b: probe, confidence: 1.0, reason: "",
          context_a: "", context_b: "", xml_context: "", words_removed: "",
          words_added: "", words_before: "", words_after: "", section: "", emp_detail: "",
        };
        const loc = await apiLocate(xmlText, synthetic);
        if (reqId !== xmlLocateSeqRef.current) return;
        if (loc?.span_start != null && loc.span_end != null) {
          setNavSpan({ start: loc.span_start, end: loc.span_end });
          requestAnimationFrame(scrollXmlToMark);
        }
      }
    } catch { /* best-effort; must not throw */ }
  }, [xmlText, result.chunks, chunkNgramCache, selectChunk]);

  // ── Derived UI values ─────────────────────────────────────────────────────

  const posLabel = activeFilteredIndex >= 0
    ? `${activeFilteredIndex + 1} / ${filteredChunks.length}`
    : `— / ${filteredChunks.length}`;

  const modeBadgeText  = mode === "edit" ? "WF2 · editable" : "WF1 · read-only";
  const modeBadgeColor = mode === "edit"
    ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
    : "bg-slate-500/10 text-slate-400 border-slate-500/20";

  const locateBadgeClass = useMemo(() => {
    if (!locateSignal) return "";
    if (locateSignal.score >= 0.8) {
      return locateSignal.source === "server"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : "bg-teal-500/15 text-teal-400 border-teal-500/30";
    }
    if (locateSignal.score >= FAST_XML_LOCATE_MIN_SCORE) {
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    }
    return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  }, [locateSignal]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0a1020] overflow-hidden">

      {/* Streaming progress bar */}
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

        {/* Stats */}
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

        <div className="flex items-center gap-1 flex-shrink-0">
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

          <IconBtn title={xmlOpen ? "Hide XML panel (X)" : "Show XML panel (X)"} active={xmlOpen} onClick={() => setXmlOpen((v) => !v)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <span className="hidden sm:inline">XML</span>
          </IconBtn>

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

        {/* Apply status */}
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

        {locateSignal && (
          <span
            className={`flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${locateBadgeClass}`}
            title={`XML locate via ${locateSignal.source} for chunk #${locateSignal.chunkId}`}
          >
            {locateSignal.source === "server" ? "Locate" : "Heuristic"} {Math.round(locateSignal.score * 100)}%
          </span>
        )}

        <span className={`flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${modeBadgeColor}`}>
          {modeBadgeText}
        </span>

        <span className="hidden lg:flex items-center gap-1 text-[9px] text-slate-500 dark:text-slate-600 flex-shrink-0">
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">← →</kbd>
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">J K</kbd>
          navigate
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">C</kbd>
          context
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">X</kbd>
          xml
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

        <div className="flex-shrink-0 w-[240px] min-w-[240px] flex flex-col
          border-r border-slate-200 dark:border-white/8">
          <ChunkList
            chunks={filteredChunks}
            stats={filteredStats}
            activeId={activeId}
            appliedIds={appliedIds}
            onSelect={selectChunk}
            collapsed={false}
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
          />
        </div>

        {/* Diff panes container */}
        <div ref={containerRef} className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Side-by-side panes */}
          <div className="flex-1 min-h-0 flex relative overflow-hidden">

            {/* Left pane (old / A) */}
            <div className="min-w-0 overflow-hidden" style={{ width: `${splitPct}%` }}>
              <DiffPane
                ref={paneARef}
                pane={result.pane_a}
                chunks={result.chunks}
                activeChunkId={activeId}
                activeChunk={activeChunk}
                filename={result.file_a}
                side="a"
                alignedLines={linesA}
                headerStats={paneAHeaderStats}
                onJumpToFirst={firstPaneAChunk ? () => selectChunk(firstPaneAChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("old", f)}
                onScrollLeft={(left) => setSyncScrollLeft({ side: "a", left })}
                syncScrollLeft={syncScrollLeft?.side === "b" ? syncScrollLeft.left : null}
                onUnfoldRow={handleUnfoldRow}
                isScrollSource={pulseSide === "old"}
              />
            </div>

            {/* Vertical splitter */}
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

            {/* Right pane (new / B) */}
            <div className="min-w-0 flex-1 overflow-hidden">
              <DiffPane
                ref={paneBRef}
                pane={result.pane_b}
                chunks={result.chunks}
                activeChunkId={activeId}
                activeChunk={activeChunk}
                filename={result.file_b}
                side="b"
                alignedLines={linesB}
                headerStats={paneBHeaderStats}
                onJumpToFirst={firstPaneBChunk ? () => selectChunk(firstPaneBChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("new", f)}
                onScrollLeft={(left) => setSyncScrollLeft({ side: "b", left })}
                syncScrollLeft={syncScrollLeft?.side === "a" ? syncScrollLeft.left : null}
                onUnfoldRow={handleUnfoldRow}
                isScrollSource={pulseSide === "new"}
              />
            </div>
          </div>

          {/* XML panel */}
          {xmlOpen && (
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
              <div className="flex-shrink-0 overflow-hidden" style={{ height: xmlHeight }}>
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
            </>
          )}

          {/* Word diff panel */}
          <WordDiffPanel
            chunk={activeChunk}
            open={wordPanelOpen}
            onToggle={() => setWordPanelOpen((v) => !v)}
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

        {!showAllContext && (
          <span className="text-amber-500/70">folded</span>
        )}
      </div>
    </div>
  );
}