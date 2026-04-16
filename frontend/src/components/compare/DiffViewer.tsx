"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chunk, DiffPaneHandle, DiffResult, XmlSection } from "./types";
import { apiApply, apiLocate } from "./api";
import ChunkList from "./ChunkList";
import DiffPane from "./DiffPane";
import XmlPanel from "./XmlPanel";

interface Props {
  result: DiffResult;
  onReset: () => void;
  initialXmlFile?: File | null;
  xmlSections?: XmlSection[];
  initialSection?: string | null;
  sectionMapper?: (chunkSection: string) => string | null;
}

export default function DiffViewer({ result, onReset, initialXmlFile, xmlSections, initialSection, sectionMapper }: Props) {
  const [activeId, setActiveId]       = useState<number | null>(result.chunks[0]?.id ?? null);
  const [appliedIds, setAppliedIds]   = useState<Set<number>>(new Set());
  const [xmlText, setXmlText]         = useState("");
  const [xmlFilename, setXmlFilename] = useState<string | null>(null);
  const [xmlStatus, setXmlStatus]     = useState("");
  const [navSpan, setNavSpan]         = useState<{ start: number; end: number } | null>(null);
  const [xmlOpen, setXmlOpen]         = useState(false);
  const [filterSection, setFilterSection] = useState<string | null>(initialSection ?? null);

  /* ── Resizable splitters state ─────────────────────────────────────────── */
  const [splitPct, setSplitPct]     = useState(50);   // vertical split between panes (%)
  const [xmlHeight, setXmlHeight]   = useState(280);  // XML panel height (px)
  const containerRef = useRef<HTMLDivElement>(null);

  const startDragV = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const startDragH = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = xmlHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setXmlHeight(Math.min(600, Math.max(120, startH + delta)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [xmlHeight]);

  const paneARef = useRef<DiffPaneHandle>(null);
  const paneBRef = useRef<DiffPaneHandle>(null);
  const xmlRef   = useRef<HTMLDivElement>(null);

  // ── Auto-load XML if provided from upload ───────────────────────────────
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

  // ── Scroll XML to a <mark> element ──────────────────────────────────────
  function scrollXmlToMark() {
    if (!xmlRef.current) return;
    const mark = xmlRef.current.querySelector("mark");
    if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── Ordered chunk IDs (used for scroll fallback + keyboard nav) ─────────
  const chunkIds = useMemo(() => result.chunks.map((c) => c.id), [result.chunks]);

  // ── Select chunk ────────────────────────────────────────────────────────
  const selectChunk = useCallback(async (id: number) => {
    setActiveId(id);

    // Determine which pane owns this chunk and compute a proportional
    // scroll fraction so the other pane can scroll to the same region.
    const chunk = result.chunks.find((c) => c.id === id);
    const isAdd = chunk?.kind === "add";
    const isDel = chunk?.kind === "del";

    // Compute scroll fraction from the pane that HAS the chunk
    const getScrollFraction = (paneData: typeof result.pane_a, chunkId: number): number | undefined => {
      const off = paneData?.offsets?.[String(chunkId)];
      if (off == null) return undefined;
      // Total text length from segments
      let total = 0;
      for (const [text] of paneData.segments) total += text.length;
      return total > 0 ? off / total : undefined;
    };

    // For ADD: pane B has it, compute fraction from B for pane A
    // For DEL: pane A has it, compute fraction from A for pane B
    const fractionForA = isAdd ? getScrollFraction(result.pane_b, id) : undefined;
    const fractionForB = isDel ? getScrollFraction(result.pane_a, id) : undefined;

    paneARef.current?.scrollToChunk?.(id, chunkIds, fractionForA);
    paneBRef.current?.scrollToChunk?.(id, chunkIds, fractionForB);

    if (xmlText) {
      const chunk = result.chunks.find((c) => c.id === id);
      if (chunk) {
        const loc = await apiLocate(xmlText, chunk);
        if (loc?.span_start != null) {
          setNavSpan({ start: loc.span_start, end: loc.span_end! });
          // Wait a tick for the <mark> to render, then scroll to it
          requestAnimationFrame(() => scrollXmlToMark());
        } else {
          setNavSpan(null);
        }
      }
    }
  }, [result, xmlText, chunkIds]);

  // ── Apply chunk ─────────────────────────────────────────────────────────
  const applyChunk = useCallback(async () => {
    if (!xmlText || activeId === null) return;
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
          requestAnimationFrame(() => scrollXmlToMark());
        }
      }
    } catch (e) {
      setXmlStatus(`Error: ${(e as Error).message}`);
    }
  }, [xmlText, activeId, result]);

  // ── Load XML ────────────────────────────────────────────────────────────
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

  // ── Download XML ────────────────────────────────────────────────────────
  const downloadXml = useCallback(() => {
    const blob = new Blob([xmlText], { type: "text/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = xmlFilename ?? "updated.xml";
    a.click();
    URL.revokeObjectURL(url);
  }, [xmlText, xmlFilename]);

  // ── Keyboard nav (↑ / ↓) ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      const idx = chunkIds.indexOf(activeId ?? -1);
      if (e.key === "ArrowDown" && idx < chunkIds.length - 1) selectChunk(chunkIds[idx + 1]);
      if (e.key === "ArrowUp"   && idx > 0)              selectChunk(chunkIds[idx - 1]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chunkIds, activeId, selectChunk]);

  const activeChunk: Chunk | null = useMemo(
    () => result.chunks.find((c) => c.id === activeId) ?? null,
    [result.chunks, activeId],
  );

  // ── Filtered chunks by section ──────────────────────────────────────────
  const mapSection = useCallback(
    (section: string) => (sectionMapper ? sectionMapper(section) : section || null),
    [sectionMapper],
  );

  const filteredChunks = useMemo(
    () => filterSection
      ? result.chunks.filter((c) => mapSection(c.section ?? "") === filterSection)
      : result.chunks,
    [result.chunks, filterSection, mapSection],
  );

  const filteredStats = useMemo(() => {
    if (!filterSection) return result.stats;
    const fc = filteredChunks;
    return {
      total: fc.length,
      additions: fc.filter((c) => c.kind === "add").length,
      deletions: fc.filter((c) => c.kind === "del").length,
      modifications: fc.filter((c) => c.kind === "mod").length,
      emphasis: fc.filter((c) => c.kind === "emp").length,
    };
  }, [filteredChunks, filterSection, result.stats]);

  // Pre-compute per-section change counts once
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0a1020]">
      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden min-h-0 flex relative">
        {/* Permanent changes sidebar */}
        <div className="flex-shrink-0 w-[250px] min-w-[250px] flex flex-col border-r border-slate-200 dark:border-white/8">
          {/* Section dropdown */}
          {xmlSections && xmlSections.length > 0 && (
            <div className="px-2 pt-2 pb-1.5 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#0d1424]">
              <div className="relative">
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
                  className="w-full text-[10px] font-semibold rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-slate-700 dark:text-slate-200 pl-7 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500/40 focus:border-teal-500/40 appearance-none cursor-pointer truncate"
                >
                  <option value="">All Sections ({totalNonEmp})</option>
                  {sectionsWithChanges.map((s) => (
                    <option key={s.id} value={s.label}>
                      {s.label} ({sectionCountMap.get(s.label) ?? 0})
                    </option>
                  ))}
                </select>
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-teal-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                </svg>
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
              <div className="flex items-center gap-2">
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
                <button
                  onClick={() => setXmlOpen(!xmlOpen)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold transition-all
                    ${xmlOpen
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                      : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                    }`}
                >
                  &lt;/&gt; XML
                </button>
                <div className="ml-auto flex items-center gap-1.5 text-[9px] font-mono font-semibold">
                  <span className="text-emerald-500">+{result.stats.additions}</span>
                  <span className="text-rose-500">-{result.stats.deletions}</span>
                  <span className="text-amber-500">~{result.stats.modifications}</span>
                </div>
              </div>
            }
          />
        </div>

        {/* PDF panes + XML in a column */}
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

          {/* Vertical drag handle */}
          <div
            className="flex-shrink-0 w-1 cursor-col-resize group relative z-10 hover:bg-blue-400/40 active:bg-blue-500/50 transition-colors"
            style={{ background: "var(--divider, rgba(148,163,184,0.2))" }}
            onMouseDown={startDragV}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>

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
          </>
        )}
        </div>{/* end column */}
      </div>
    </div>
  );
}
