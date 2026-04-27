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
} from "./types";
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

export default function DiffViewer({
  mode,
  result,
  onReset,
  initialXmlFile,
  xmlSections,
  initialSection,
  sectionMapper,
}: Props) {
  const [activeId,      setActiveId]      = useState<number | null>(result.chunks[0]?.id ?? null);
  const [appliedIds,    setAppliedIds]    = useState<Set<number>>(new Set());
  const [xmlText,       setXmlText]       = useState("");
  const [xmlFilename,   setXmlFilename]   = useState<string | null>(null);
  const [xmlStatus,     setXmlStatus]     = useState("");
  const [navSpan,       setNavSpan]       = useState<{ start: number; end: number } | null>(null);
  const [xmlOpen,       setXmlOpen]       = useState(mode === "wf3" || !!initialXmlFile);
  const [filterSection, setFilterSection] = useState<string | null>(initialSection ?? null);
  const [wrapLines,     setWrapLines]     = useState(false);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);

  const containerRef  = useRef<HTMLDivElement>(null);
  const paneARef      = useRef<DiffPaneHandle>(null);
  const paneBRef      = useRef<DiffPaneHandle>(null);
  const xmlRef        = useRef<HTMLDivElement | HTMLTextAreaElement>(null);
  const locateSeqRef   = useRef(0);
  const navSyncLockRef = useRef(false);

  const [splitPct,  startDragV] = useDragSplitter(containerRef, 50,  "x", 20,  80);
  const [xmlHeight, startDragH] = useDragSplitter(containerRef, 260, "y", 120, 560);

  useEffect(() => {
    if (!initialXmlFile || xmlText) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setXmlFilename(initialXmlFile.name);
      setXmlText(e.target?.result as string);
      setXmlStatus(mode === "wf2"
        ? `Baseline: ${initialXmlFile.name}`
        : `Loaded: ${initialXmlFile.name}`);
      setXmlOpen(true);
    };
    reader.readAsText(initialXmlFile);
  }, [initialXmlFile, xmlText, mode]);

  const mapSection = useCallback(
    (s: string) => sectionMapper ? sectionMapper(s) : s,
    [sectionMapper],
  );

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

  function scrollXmlToMark() {
    const el = xmlRef.current;
    if (!el || el.tagName === "TEXTAREA") return;
    (el as HTMLDivElement).querySelector("mark")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function getScrollFraction(paneData: typeof result.pane_a, chunkId: number) {
    const off = paneData?.offsets?.[String(chunkId)];
    if (off == null) return undefined;
    let total = 0;
    for (const [text] of paneData.segments) total += text.length;
    return total > 0 ? off / total : undefined;
  }

  const syncXmlScroll = useCallback((fraction: number) => {
    const xmlEl = xmlRef.current as HTMLElement | null;
    if (!xmlEl) return;
    const max = xmlEl.scrollHeight - xmlEl.clientHeight;
    if (max <= 0) return;
    xmlEl.scrollTop = Math.max(0, Math.min(1, fraction)) * max;
  }, []);

  const schedulePanelSync = useCallback(
    (source: "old" | "new" | "xml", fraction: number) => {
      if (navSyncLockRef.current) return;
      const f = Math.max(0, Math.min(1, fraction));
      if (source !== "old") paneARef.current?.scrollToFraction(f);
      if (source !== "new") paneBRef.current?.scrollToFraction(f);
      if (source !== "xml") syncXmlScroll(f);
    },
    [syncXmlScroll],
  );

  const selectChunk = useCallback(async (id: number) => {
    const seq = ++locateSeqRef.current;
    setActiveId(id);
    navSyncLockRef.current = true;

    try {
      const chunk = result.chunks.find((c) => c.id === id);
      const isAdd = chunk?.kind === "add";
      const isDel = chunk?.kind === "del";

      paneARef.current?.scrollToChunk(id, chunkIds, isAdd ? getScrollFraction(result.pane_b, id) : undefined);
      paneBRef.current?.scrollToChunk(id, chunkIds, isDel ? getScrollFraction(result.pane_a, id) : undefined);

      if (xmlText && chunk) {
        // Instant client-side highlight while the server request is in-flight
        const probe = (chunk.kind === "add" || chunk.kind === "mod")
          ? (chunk.text_b || chunk.text_a || "")
          : (chunk.text_a || "");
        if (probe.length >= 6) {
          const idx = xmlText.indexOf(probe.slice(0, Math.min(60, probe.length)));
          if (idx !== -1) {
            setNavSpan({ start: idx, end: idx + probe.length });
            requestAnimationFrame(scrollXmlToMark);
          }
        }

        // Debounce: abandon if a newer chunk was selected within 150 ms
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        if (seq !== locateSeqRef.current) return;

        // Precise server-side locate
        const loc = await apiLocate(xmlText, chunk);
        if (seq !== locateSeqRef.current) return;
        if (loc?.span_start != null) {
          setNavSpan({ start: loc.span_start, end: loc.span_end! });
          requestAnimationFrame(scrollXmlToMark);
        } else {
          setNavSpan(null);
        }
      }
    } finally {
      setTimeout(() => {
        if (seq === locateSeqRef.current) navSyncLockRef.current = false;
      }, 220);
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
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goTo(1);  }
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   { e.preventDefault(); goTo(-1); }
      if (e.key === "w" || e.key === "W") setWrapLines((v) => !v);
      if (e.key === "x" || e.key === "X") setXmlOpen((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goTo]);

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

  const loadXml = useCallback((f: File) => {
    setXmlFilename(f.name);
    setNavSpan(null);
    setAppliedIds(new Set());
    setXmlStatus(mode === "wf2" ? `Baseline: ${f.name}` : `Loaded: ${f.name}`);
    setXmlOpen(true);
    const reader = new FileReader();
    reader.onload = (e) => setXmlText(e.target?.result as string);
    reader.readAsText(f);
  }, [mode]);

  const downloadXml = useCallback(() => {
    if (mode !== "wf3") return;
    const blob = new Blob([xmlText], { type: "text/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = xmlFilename
      ? xmlFilename.replace(/(\\.xml)?$/, "_updated.xml")
      : "updated.xml";
    a.click();
    URL.revokeObjectURL(url);
  }, [mode, xmlText, xmlFilename]);

  const posLabel = activeFilteredIndex >= 0
    ? `${activeFilteredIndex + 1} / ${filteredChunks.length}`
    : `— / ${filteredChunks.length}`;

  const modeColor = mode === "wf3"
    ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
    : "bg-slate-500/10 text-slate-400 border-slate-500/20";

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0a1020] overflow-hidden">

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
        </div>

        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1 flex-shrink-0" />

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => goTo(-1)}
            disabled={activeFilteredIndex <= 0}
            title="Previous change  (← or ↑)"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[10px] font-mono text-slate-400 tabular-nums w-14 text-center select-none">
            {posLabel}
          </span>
          <button
            onClick={() => goTo(1)}
            disabled={activeFilteredIndex < 0 || activeFilteredIndex >= filteredChunks.length - 1}
            title="Next change  (→ or ↓)"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1 flex-shrink-0" />

        <div className="flex items-center gap-1 flex-shrink-0">
          <IconBtn
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            active={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="hidden sm:inline">List</span>
          </IconBtn>

          <IconBtn
            title={wrapLines ? "Aligned lines (W)" : "Wrap lines (W)"}
            active={wrapLines}
            onClick={() => setWrapLines((v) => !v)}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-4 6l4-4-4-4" />
            </svg>
            <span className="hidden sm:inline">Wrap</span>
          </IconBtn>

          <IconBtn
            title={xmlOpen ? "Hide XML panel (X)" : "Show XML panel (X)"}
            active={xmlOpen}
            onClick={() => setXmlOpen((v) => !v)}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <span className="hidden sm:inline">XML</span>
          </IconBtn>
        </div>

        <div className="flex-1" />

        <span className={`flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${modeColor}`}>
          {mode === "wf3" ? "WF2 · editable" : "WF1 · read-only"}
        </span>

        <span className="hidden lg:flex items-center gap-1 text-[9px] text-slate-500 dark:text-slate-600 flex-shrink-0">
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">← →</kbd>
          navigate
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">W</kbd>
          wrap
          <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/5 font-mono">X</kbd>
          xml
        </span>
      </div>

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
            const count   = sectionCountMap.get(sec.label) ?? 0;
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

      <div className="flex-1 overflow-hidden min-h-0 flex">

        {sidebarOpen && (
          <div className="flex-shrink-0 w-[240px] min-w-[240px] flex flex-col
            border-r border-slate-200 dark:border-white/8">
            <ChunkList
              chunks={filteredChunks}
              stats={filteredStats}
              activeId={activeId}
              appliedIds={appliedIds}
              onSelect={selectChunk}
            />
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
                headerStats={paneAHeaderStats}
                onJumpToFirst={firstPaneAChunk ? () => selectChunk(firstPaneAChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("old", f)}
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
                pane={result.pane_b}
                chunks={result.chunks}
                activeChunkId={activeId}
                activeChunk={activeChunk}
                filename={result.file_b}
                side="b"
                wrapLines={wrapLines}
                headerStats={paneBHeaderStats}
                onJumpToFirst={firstPaneBChunk ? () => selectChunk(firstPaneBChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("new", f)}
              />
            </div>
          </div>

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
                />
              </div>
            </>
          )}
        </div>
      </div>

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
      </div>
    </div>
  );
}