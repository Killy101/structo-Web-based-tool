"use client";
// ─────────────────────────────────────────────────────────────────────────────
// DiffViewer.tsx — 4-panel comparison view
//
// Layout (left → right, top → bottom):
//
//   ┌─ Sidebar B ──┬─ Panel A (Old PDF) ──┬─ Panel C (New PDF) ─┐
//   │ Change list  │                      │                      │
//   │ + filters    ├──── drag handle ─────┤                      │
//   │              │                      │                      │
//   └──────────────┴──── drag handle ─────────────────────────── ┘
//                  │  Panel D (XML viewer / editor)              │
//                  └─────────────────────────────────────────────┘
//
// Workflow 2 (mode="wf2"):  XML panel D is read-only (no Apply / Save).
// Workflow 3 (mode="wf3"):  XML panel D is editable (Apply / Save enabled).
//
// Cross-panel sync:
//   Clicking a change in sidebar B scrolls panels A, C, and D simultaneously.
//   The <hid> attribute on each innodLevel node is the anchor key for D.
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DiffPaneHandle, DiffResult, WorkflowMode, XmlSection } from "./types";
import { apiApply, apiLocate } from "./api";
import ChunkList from "./ChunkList";
import DiffPane  from "./DiffPane";
import XmlPanel  from "./XmlPanel";

interface Props {
  mode:            WorkflowMode;  
  result:          DiffResult;
  onReset:         () => void;
  initialXmlFile?: File | null;
  xmlSections?:    XmlSection[];
  initialSection?: string | null;
  sectionMapper?:  (chunkSection: string) => string | null;
}

// ── Hook: resizable splitter ──────────────────────────────────────────────────

/**
 * Returns [value, startDrag].
 * axis="x" tracks width-percentage; axis="y" tracks height-px from bottom.
 */
function useDragSplitter(
  containerRef: React.RefObject<HTMLDivElement>,
  initial: number,
  axis: "x" | "y",
  min: number,
  max: number,
): [number, (e: React.MouseEvent) => void] {
  const [value, setValue] = useState(initial);

  const startDrag = useCallback((e: React.MouseEvent) => {
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function DiffViewer({
  mode,
  result,
  onReset,
  initialXmlFile,
  xmlSections,
  initialSection,
  sectionMapper,
}: Props) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [activeId,      setActiveId]      = useState<number | null>(result.chunks[0]?.id ?? null);
  const [appliedIds,    setAppliedIds]    = useState<Set<number>>(new Set());
  const [xmlText,       setXmlText]       = useState("");
  const [xmlFilename,   setXmlFilename]   = useState<string | null>(null);
  const [xmlStatus,     setXmlStatus]     = useState("");
  const [navSpan,       setNavSpan]       = useState<{ start: number; end: number } | null>(null);
  const [xmlOpen,       setXmlOpen]       = useState(false);
  const [filterSection, setFilterSection] = useState<string | null>(initialSection ?? null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const paneARef     = useRef<DiffPaneHandle>(null);
  const paneBRef     = useRef<DiffPaneHandle>(null);
  const xmlRef       = useRef<HTMLDivElement>(null);
  const locateSeqRef = useRef(0);
  const syncRafRef = useRef<number | null>(null);
  const syncPendingRef = useRef<{ source: "old" | "new" | "xml"; fraction: number } | null>(null);
  const xmlSyncingRef = useRef(false);

  // ── Resizable splitters ───────────────────────────────────────────────────
  const [splitPct,  startDragV] = useDragSplitter(containerRef, 50,  "x", 20,  80);
  const [xmlHeight, startDragH] = useDragSplitter(containerRef, 280, "y", 120, 600);

  // ── Auto-load XML from upload ─────────────────────────────────────────────
  useEffect(() => {
    if (!initialXmlFile || xmlText) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setXmlFilename(initialXmlFile.name);
      setXmlText(e.target?.result as string);
      setXmlStatus(`Loaded ${initialXmlFile.name}`);
      setXmlOpen(true);
    };
    reader.readAsText(initialXmlFile);
  }, [initialXmlFile, xmlText]);

  // ── Stable mapSection ─────────────────────────────────────────────────────
  const mapSection = useCallback(
    (s: string) => sectionMapper ? sectionMapper(s) : s,
    [sectionMapper],
  );

  // ── Filtered chunks ───────────────────────────────────────────────────────
  const filteredChunks = useMemo(() =>
    filterSection
      ? result.chunks.filter((c) => mapSection(c.section ?? "") === filterSection)
      : result.chunks,
    [result.chunks, filterSection, mapSection],
  );

  const filteredStats = useMemo(() => {
    if (!filterSection) return result.stats;
    const fc = filteredChunks;
    return {
      total:         fc.length,
      additions:     fc.filter((c) => c.kind === "add").length,
      deletions:     fc.filter((c) => c.kind === "del").length,
      modifications: fc.filter((c) => c.kind === "mod").length,
      emphasis:      fc.filter((c) => c.kind === "emp").length,
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

  const totalNonEmp = useMemo(
    () => result.chunks.filter((c) => c.kind !== "emp").length,
    [result.chunks],
  );

  // ── Per-pane header stats ────────────────────────────────────────────────
  // Pane A (old): highlight deletions + modifications removed from this version
  const paneAHeaderStats = useMemo(() => [
    { label: "-", count: filteredStats.deletions,     colorClass: "text-rose-500",   title: `${filteredStats.deletions} deletion${filteredStats.deletions !== 1 ? "s" : ""}` },
    { label: "~", count: filteredStats.modifications, colorClass: "text-amber-500",  title: `${filteredStats.modifications} modification${filteredStats.modifications !== 1 ? "s" : ""}` },
  ].filter((s) => s.count > 0), [filteredStats]);

  // Pane B (new): highlight additions + modifications introduced in this version
  const paneBHeaderStats = useMemo(() => [
    { label: "+", count: filteredStats.additions,     colorClass: "text-emerald-500", title: `${filteredStats.additions} addition${filteredStats.additions !== 1 ? "s" : ""}` },
    { label: "~", count: filteredStats.modifications, colorClass: "text-amber-500",   title: `${filteredStats.modifications} modification${filteredStats.modifications !== 1 ? "s" : ""}` },
  ].filter((s) => s.count > 0), [filteredStats]);

  // First chunk to scroll to per pane (within the current filter)
  const firstPaneAChunk = useMemo(
    () => filteredChunks.find((c) => c.kind === "del" || c.kind === "mod"),
    [filteredChunks],
  );
  const firstPaneBChunk = useMemo(
    () => filteredChunks.find((c) => c.kind === "add" || c.kind === "mod"),
    [filteredChunks],
  );

  // Sections that actually have changes (for dropdown)
  const sectionsWithChanges = useMemo(
    () => xmlSections?.filter((s) => sectionCountMap.has(s.label)) ?? [],
    [xmlSections, sectionCountMap],
  );

  const totalNonEmp = useMemo(
    () => result.chunks.filter((c) => c.kind !== "emp").length,
    [result.chunks],
  );

  const activeChunk = useMemo(
    () => result.chunks.find((c) => c.id === activeId) ?? null,
    [result.chunks, activeId],
  );

  const chunkIds = useMemo(() => result.chunks.map((c) => c.id), [result.chunks]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function scrollXmlToMark() {
    const mark = xmlRef.current?.querySelector("mark");
    if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function getScrollFraction(paneData: typeof result.pane_a, chunkId: number) {
    const off = paneData?.offsets?.[String(chunkId)];
    if (off == null) return undefined;
    let total = 0;
    for (const [text] of paneData.segments) total += text.length;
    return total > 0 ? off / total : undefined;
  }

  const syncXmlScroll = useCallback((scrollFraction: number) => {
    const xmlEl = xmlRef.current;
    if (!xmlEl) return;
    const max = xmlEl.scrollHeight - xmlEl.clientHeight;
    if (max <= 0) return;
    xmlSyncingRef.current = true;
    xmlEl.scrollTop = Math.max(0, Math.min(1, scrollFraction)) * max;
    requestAnimationFrame(() => {
      xmlSyncingRef.current = false;
    });
  }, []);

  const schedulePanelSync = useCallback(
    (source: "old" | "new" | "xml", scrollFraction: number) => {
      syncPendingRef.current = {
        source,
        fraction: Math.max(0, Math.min(1, scrollFraction)),
      };

      if (syncRafRef.current !== null) return;

      syncRafRef.current = requestAnimationFrame(() => {
        const pending = syncPendingRef.current;
        syncRafRef.current = null;
        if (!pending) return;

        if (pending.source === "old") {
          paneBRef.current?.scrollToFraction(pending.fraction);
          syncXmlScroll(pending.fraction);
          return;
        }

        if (pending.source === "new") {
          paneARef.current?.scrollToFraction(pending.fraction);
          syncXmlScroll(pending.fraction);
          return;
        }

        if (!xmlSyncingRef.current) {
          paneARef.current?.scrollToFraction(pending.fraction);
          paneBRef.current?.scrollToFraction(pending.fraction);
        }
      });
    },
    [syncXmlScroll],
  );

  const syncScrollFromOldPane = useCallback(
    (scrollFraction: number) => schedulePanelSync("old", scrollFraction),
    [schedulePanelSync],
  );

  const syncScrollFromNewPane = useCallback(
    (scrollFraction: number) => schedulePanelSync("new", scrollFraction),
    [schedulePanelSync],
  );

  const syncScrollFromXmlPane = useCallback(
    (scrollFraction: number) => schedulePanelSync("xml", scrollFraction),
    [schedulePanelSync],
  );

  useEffect(() => {
    return () => {
      if (syncRafRef.current !== null) {
        cancelAnimationFrame(syncRafRef.current);
      }
    };
  }, []);

  // ── Select chunk — scrolls all 4 panels ──────────────────────────────────
  const selectChunk = useCallback(async (id: number) => {
    const seq = ++locateSeqRef.current;
    setActiveId(id);

    const chunk = result.chunks.find((c) => c.id === id);
    const isAdd = chunk?.kind === "add";
    const isDel = chunk?.kind === "del";

    // Sync PDF panes
    paneARef.current?.scrollToChunk(id, chunkIds, isAdd ? getScrollFraction(result.pane_b, id) : undefined);
    paneBRef.current?.scrollToChunk(id, chunkIds, isDel ? getScrollFraction(result.pane_a, id) : undefined);

    // Sync XML panel (read-only locate — both wf2 and wf3)
    if (xmlText && chunk) {
      const loc = await apiLocate(xmlText, chunk);
      if (seq !== locateSeqRef.current) return;
      if (loc?.span_start != null) {
        setNavSpan({ start: loc.span_start, end: loc.span_end! });
        requestAnimationFrame(scrollXmlToMark);
      } else {
        setNavSpan(null);
      }
    }
  }, [result, xmlText, chunkIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply chunk (wf3 only) ────────────────────────────────────────────────
  const applyChunk = useCallback(async () => {
    if (mode !== "wf3" || !xmlText || activeId === null) return;
    const chunk = result.chunks.find((c) => c.id === activeId);
    if (!chunk || chunk.kind === "emp") return;

    try {
      const res = await apiApply(xmlText, chunk);
      setXmlText(res.xml_text);
      setXmlStatus(res.changed ? `✓ ${res.message}` : `— ${res.message}`);
      if (res.changed) {
        setAppliedIds((prev) => new Set([...prev, activeId]));
        if (res.span_start != null) {
          setNavSpan({ start: res.span_start, end: res.span_end! });
          requestAnimationFrame(scrollXmlToMark);
        }
      }
    } catch (e) {
      setXmlStatus(`Error: ${(e as Error).message}`);
    }
  }, [mode, xmlText, activeId, result]);

  // ── Load XML ──────────────────────────────────────────────────────────────
  const loadXml = useCallback((f: File) => {
    setXmlFilename(f.name);
    setNavSpan(null);
    setAppliedIds(new Set());
    setXmlStatus(`Loaded ${f.name}`);
    setXmlOpen(true);
    const reader = new FileReader();
    reader.onload = (e) => setXmlText(e.target?.result as string);
    reader.readAsText(f);
  }, []);

  // ── Download XML (wf3 only) ───────────────────────────────────────────────
  const downloadXml = useCallback(() => {
    if (mode !== "wf3") return;
    const blob = new Blob([xmlText], { type: "text/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = xmlFilename ? xmlFilename.replace(/(\.xml)?$/, "_updated.xml") : "updated.xml";
    a.click();
    URL.revokeObjectURL(url);
  }, [mode, xmlText, xmlFilename]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0a1020]">
      <div className="flex-1 overflow-hidden min-h-0 flex">

        {/* ── Sidebar B — change list ───────────────────────────────────── */}
        <div className="flex-shrink-0 w-[250px] min-w-[250px] flex flex-col border-r border-slate-200 dark:border-white/8">

          {/* Section dropdown */}
          {xmlSections && xmlSections.length > 0 && (
            <div className="px-2 pt-2 pb-1.5 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0d1424]">
              <div className="relative">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-teal-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                </svg>
                <select
                  value={filterSection ?? ""}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    setFilterSection(val);
                    if (val) {
                      const first = result.chunks.find((c) => mapSection(c.section ?? "") === val);
                      if (first) selectChunk(first.id);
                    }
                  }}
                  className="w-full text-[10px] font-semibold rounded-lg border border-slate-200 dark:border-white/10
                    bg-white dark:bg-white/[0.04] text-slate-700 dark:text-slate-200
                    pl-7 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500/40 appearance-none cursor-pointer"
                >
                  <option value="">All Sections ({totalNonEmp})</option>
                  {sectionsWithChanges.map((s) => (
                    <option key={s.id} value={s.label}>
                      {s.label} ({sectionCountMap.get(s.label) ?? 0})
                    </option>
                  ))}
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          )}

          <ChunkList
            chunks={filteredChunks}
            stats={filteredStats}
            activeId={activeId}
            appliedIds={appliedIds}
            onSelect={selectChunk}
            headerActions={
              <div className="flex items-center gap-2 flex-wrap">
                {/* Back */}
                <button
                  onClick={onReset}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  New Diff
                </button>

                <div className="w-px h-3.5 bg-slate-200 dark:bg-white/10" />

                {/* XML toggle */}
                <button
                  onClick={() => setXmlOpen((o) => !o)}
                  title={xmlOpen ? "Hide XML panel" : "Show XML panel"}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold transition-all ${
                    xmlOpen
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                      : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}
                >
                  &lt;/&gt; XML
                </button>

                {/* Mode badge + stats */}
                <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  mode === "wf3"
                    ? "bg-violet-500/15 text-violet-400"
                    : "bg-slate-500/10 text-slate-400"
                }`}>
                  {mode.toUpperCase()}
                </span>

                <span className="flex items-center gap-1 text-[9px] font-mono font-semibold">
                  <span className="text-emerald-500">+{result.stats.additions}</span>
                  <span className="text-rose-500">-{result.stats.deletions}</span>
                  <span className="text-amber-500">~{result.stats.modifications}</span>
                </span>
              </div>
            }
          />
        </div>

        {/* ── Right column: PDF panes + XML ────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* PDF panes with draggable vertical splitter */}
        <div ref={containerRef} className="flex-1 min-h-0 flex relative">
          {/* Left pane */}
          <div className="min-w-0 overflow-hidden" style={{ width: `${splitPct}%` }}>
            <DiffPane
              ref={paneARef}
              pane={result.pane_a}
              chunks={result.chunks}
              activeChunkId={activeId}
              filename={result.file_a}
              side="a"
              headerStats={paneAHeaderStats}
              onJumpToFirst={firstPaneAChunk ? () => selectChunk(firstPaneAChunk.id) : undefined}
            />
          </div>

          {/* PDF panes with draggable vertical splitter */}
          <div ref={containerRef} className="flex-1 min-h-0 flex relative overflow-hidden">

          {/* Right pane */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <DiffPane
              ref={paneBRef}
              pane={result.pane_b}
              chunks={result.chunks}
              activeChunkId={activeId}
              filename={result.file_b}
              side="b"
              headerStats={paneBHeaderStats}
              onJumpToFirst={firstPaneBChunk ? () => selectChunk(firstPaneBChunk.id) : undefined}
            />
          </div>
        </div>

        {/* XML Editor panel — below panes, with draggable horizontal splitter */}
        {xmlOpen && (
          <>
            {/* Horizontal drag handle */}
            <div
              className="flex-shrink-0 h-1 cursor-row-resize hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors relative z-10"
              style={{ background: "var(--divider, rgba(148,163,184,0.2))" }}
              onMouseDown={startDragH}
            >
              <div className="absolute -top-1 -bottom-1 inset-x-0" />
            </div>
            <div className="flex-shrink-0 overflow-hidden" style={{ height: xmlHeight }}>
              <XmlPanel
                ref={xmlRef}
                xmlText={xmlText}
                xmlFilename={xmlFilename}
                activeChunk={activeChunk}
                appliedIds={appliedIds}
                navSpan={navSpan}
                status={xmlStatus}
                onLoad={loadXml}
                onApply={applyChunk}
                onDownload={downloadXml}
              />
            </div>

            {/* Vertical drag handle */}
            <div
              className="flex-shrink-0 w-1 cursor-col-resize hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors relative z-10"
              style={{ background: "rgba(148,163,184,0.2)" }}
              onMouseDown={startDragV}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>

            {/* Panel C — New PDF */}
            <div className="min-w-0 flex-1 overflow-hidden">
              <DiffPane
                ref={paneBRef}
                pane={result.pane_b}
                chunks={result.chunks}
                activeChunkId={activeId}
                filename={result.file_b}
                side="b"
                onChunkClick={selectChunk}
                onScrollFraction={syncScrollFromNewPane}
              />
            </div>
          </div>

          {/* Panel D — XML (both wf2 read-only and wf3 editable) */}
          {xmlOpen && (
            <>
              {/* Horizontal drag handle */}
              <div
                className="flex-shrink-0 h-1 cursor-row-resize hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors relative z-10"
                style={{ background: "rgba(148,163,184,0.2)" }}
                onMouseDown={startDragH}
              >
                <div className="absolute -top-1 -bottom-1 inset-x-0" />
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
                  onScrollFraction={syncScrollFromXmlPane}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}