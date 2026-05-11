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
import { apiApply, apiLocate, invalidateXmlSession } from "./api";
import type { DiffProgress } from "./api";
import ChunkList from "./ChunkList";
import DiffPane, { buildAlignedLines, foldUnchangedLines } from "./DiffPane";
import XmlPanel  from "./XmlPanel";
import WordDiffPanel from "./WordDiffPanel";

interface Props {
  mode:              WorkflowMode;
  result:            DiffResult;
  onReset:           () => void;
  initialXmlFile?:   File | null;
  xmlSections?:      XmlSection[];
  initialSection?:   string | null;
  sectionMapper?:    (chunkSection: string) => string | null;
  /** True while large-document batch streaming is still in progress. */
  isStreaming?:      boolean;
  /** Current streaming progress for the progress bar in the header. */
  streamingProgress?: DiffProgress | null;
}

// ── Apply status per chunk ────────────────────────────────────────────────────
type ApplyStatus = "idle" | "applying" | "done" | "error";

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
  isStreaming = false,
  streamingProgress = null,
}: Props) {
  const [activeId,      setActiveId]      = useState<number | null>(result.chunks[0]?.id ?? null);
  const [appliedIds,    setAppliedIds]    = useState<Set<number>>(new Set());
  const [applyStatus,   setApplyStatus]   = useState<ApplyStatus>("idle");
  const [xmlText,       setXmlText]       = useState("");
  const [xmlFilename,   setXmlFilename]   = useState<string | null>(null);
  const [xmlStatus,     setXmlStatus]     = useState("");
  const [navSpan,       setNavSpan]       = useState<{ start: number; end: number } | null>(null);
  const [xmlOpen,       setXmlOpen]       = useState(mode === "wf3" || !!initialXmlFile);
  const [filterSection, setFilterSection] = useState<string | null>(initialSection ?? null);
  const [wrapLines,     setWrapLines]     = useState(false);
  const [syncScrollLeft, setSyncScrollLeft] = useState<{side:"a"|"b"; left:number} | null>(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);
  const [wordPanelOpen, setWordPanelOpen] = useState(true);
  // FIX Issue 2: "Show all context" disables folding by passing Infinity to
  // foldUnchangedLines.  Default is false (folded, CONTEXT_LINES = 10).
  const [showAllContext, setShowAllContext] = useState(false);
  /**
   * Apply history stack for undo support.
   * Each entry captures the xmlText and the chunk ID that was applied, so
   * undoApply() can restore both the text and remove the ID from appliedIds.
   */
  const [applyHistory, setApplyHistory] = useState<{ xmlText: string; appliedId: number }[]>([]);
  // Fix 1: fold expansion state lives here (DiffViewer) so that both panes
  // see the same expanded fold rows simultaneously.
  const [expandedFoldKeys, setExpandedFoldKeys] = useState<Set<number>>(new Set());

  const containerRef   = useRef<HTMLDivElement>(null);
  const paneARef       = useRef<DiffPaneHandle>(null);
  const paneBRef       = useRef<DiffPaneHandle>(null);
  // XmlScrollTarget covers both the read-only div (WF2) and the Monaco editor
  // handle (WF3). DiffViewer.syncXmlScroll uses the common scrollHeight /
  // clientHeight / scrollTop interface without knowing which concrete type
  // is behind the ref.
  const xmlRef         = useRef<XmlScrollTarget>(null);
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

  // Auto-scroll to the first chunk on mount so large batch results
  // immediately show the first change instead of a blank viewport.
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (didAutoScrollRef.current) return;
    const firstId = result.chunks[0]?.id;
    if (firstId == null) return;
    // Defer until after the virtualizer has measured rows
    const timer = setTimeout(() => {
      didAutoScrollRef.current = true;
      paneARef.current?.scrollToChunk(firstId);
      paneBRef.current?.scrollToChunk(firstId);
    }, 120);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const alignmentChunks = useMemo(
    () => result.chunks.filter((c) => c.kind !== "emp" && c.kind !== "strike"),
    [result.chunks],
  );

  const { linesA: rawLinesA, linesB: rawLinesB } = useMemo(
    () => buildAlignedLines(result.pane_a, result.pane_b, alignmentChunks),
    [result.pane_a, result.pane_b, alignmentChunks],
  );
  // Single source of truth for fold state. DiffPane no longer folds —
  // it renders whatever we give it. expandedFoldKeys identifies fold rows
  // (by their index in the folded array) that have been expanded by the user.
  const { linesA: alignedLinesA, linesB: alignedLinesB } = useMemo(() => {
    // FIX Issue 2: pass Infinity when showAllContext is on to disable folding
    if (showAllContext || wrapLines) return { linesA: rawLinesA, linesB: rawLinesB };
    const folded = foldUnchangedLines(rawLinesA, rawLinesB);
    if (expandedFoldKeys.size === 0) return folded;

    // Expand selected fold rows back into the original unchanged lines.
    // We walk the folded array, tracking the cursor into the raw array.
    const outA: typeof folded.linesA = [];
    const outB: typeof folded.linesB = [];
    let rawCursor = 0;
    for (let fi = 0; fi < folded.linesA.length; fi++) {
      const a = folded.linesA[fi];
      if (a && typeof a === "object" && !Array.isArray(a) && "type" in a && a.type === "fold") {
        if (expandedFoldKeys.has(fi)) {
          for (let k = 0; k < a.count; k++) {
            if (rawCursor + k < rawLinesA.length) {
              outA.push(rawLinesA[rawCursor + k]);
              outB.push(rawLinesB[rawCursor + k]);
            }
          }
        } else {
          outA.push(a);
          outB.push(folded.linesB[fi]);
        }
        rawCursor += a.count;
      } else {
        outA.push(a);
        outB.push(folded.linesB[fi]);
        rawCursor++;
      }
    }
    return { linesA: outA, linesB: outB };
  }, [rawLinesA, rawLinesB, wrapLines, expandedFoldKeys, showAllContext]);

  // Reset fold expansion when chunks change (new diff loaded).
  useEffect(() => {
    setExpandedFoldKeys(new Set());
    setShowAllContext(false);  // FIX: reset to folded view on new diff
  }, [result.chunks]);

  const handleUnfoldRow = useCallback((foldIndex: number) => {
    setExpandedFoldKeys((prev) => {
      const next = new Set(prev);
      next.add(foldIndex);
      return next;
    });
  }, []);

  function scrollXmlToMark() {
    const el = xmlRef.current;
    if (!el) return;
    // Monaco and textarea handle their own scroll via navSpan/revealSpan;
    // only the WF2 read-only <div> uses DOM <mark> scrollIntoView.
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
   * FIX Issue 3b — Row-index scroll sync replaces fraction-based sync.
   *
   * Old approach: compute `scrollTop / scrollHeight` and apply the same
   * fraction to the sibling pane. This breaks when the two panes have
   * different pixel heights (because one has more null-gap rows or more
   * unchanged content), causing the panes to show completely different
   * sections of the document when the user scrolls.
   *
   * New approach: the panes share the same alignedLines array (equal length).
   * Logical row N in pane A is the SAME document position as row N in pane B.
   * We compute the first-visible row index from the scroll position, then
   * `scrollToIndex` on the sibling using the same row. This gives exact
   * content alignment regardless of pane height differences.
   *
   * The `rowFraction` parameter is `firstVisibleRow / totalRows`, emitted
   * by the pane's onScrollFraction. scrollToFraction on the receiving side
   * uses it to call `virtualizer.scrollToIndex(Math.round(f * totalRows))`.
   */
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
    setApplyStatus("idle");  // FIX: reset apply status when selecting a new chunk
    navSyncLockRef.current = true;

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
            setNavSpan({ start: idx, end: idx + probe.length });
            requestAnimationFrame(scrollXmlToMark);
          }
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        if (seq !== locateSeqRef.current) return;

        const loc = await apiLocate(xmlText, chunk);
        if (seq !== locateSeqRef.current) return;
        if (loc?.span_start != null) {
          setNavSpan({ start: loc.span_start, end: loc.span_end! });
          requestAnimationFrame(scrollXmlToMark);
        } else {
          setNavSpan(null);
        }
      }
    } catch {
      // selectChunk is called with `void` throughout; any error (including plain
      // objects thrown by TanStack Virtual's scrollToIndex during initialisation)
      // must be caught here so the promise never becomes an unhandled rejection
      // that Next.js devtools display as "[object Object]".
    } finally {
      setTimeout(() => {
        if (seq === locateSeqRef.current) navSyncLockRef.current = false;
      }, 350);  // 350ms covers smooth-scroll animations on slow devices
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

  // FIX: Optimistic apply UI with per-chunk status feedback
  const applyChunk = useCallback(async () => {
    if (mode !== "wf3" || !xmlText || activeId === null) return;
    const chunk = result.chunks.find((c) => c.id === activeId);
    if (!chunk) return;
    // All chunk kinds (including emp) are now sent to the backend.
    // The backend's _apply_chunk_to_xml handles emp via _apply_emp_chunk_to_xml.

    // Push current state to the undo history stack before mutating.
    setApplyHistory((prev) => [...prev, { xmlText, appliedId: activeId }]);

    // Optimistic: show "applying" immediately, don't wait for server
    setApplyStatus("applying");
    setXmlStatus("Applying change…");

    try {
      const res = await apiApply(xmlText, chunk);
      setXmlText(res.xml_text);
      if (res.changed) {
        setApplyStatus("done");
        setXmlStatus(`✓ ${res.message}`);
        setAppliedIds((prev) => new Set([...prev, activeId]));
        if (res.span_start != null) {
          setNavSpan({ start: res.span_start, end: res.span_end! });
          requestAnimationFrame(scrollXmlToMark);
        }
        // Auto-advance to next unapplied chunk after a short delay
        setTimeout(() => {
          const nextChunk = filteredChunks.find(
            (c) => c.id !== activeId && !appliedIds.has(c.id)
          );
          if (nextChunk) void selectChunk(nextChunk.id);
        }, 800);
      } else {
        setApplyStatus("idle");
        setXmlStatus(`— ${res.message}`);
      }
    } catch (e) {
      // On error, roll back the optimistic history push
      setApplyHistory((prev) => prev.slice(0, -1));
      setApplyStatus("error");
      setXmlStatus(`Error: ${(e as Error).message}`);
      // Reset to idle after a delay so user can retry
      setTimeout(() => setApplyStatus("idle"), 3000);
    }
  }, [mode, xmlText, activeId, result, filteredChunks, appliedIds, selectChunk]);

  const loadXml = useCallback((f: File) => {
    setXmlFilename(f.name);
    setNavSpan(null);
    setAppliedIds(new Set());
    setApplyStatus("idle");
    // Clear apply history when a new file is loaded
    setApplyHistory([]);
    // Invalidate the server-side XML session so the next apply/locate
    // creates a fresh session for the new file rather than reusing a stale one.
    invalidateXmlSession();
    setXmlStatus(mode === "wf2" ? `Baseline: ${f.name}` : `Loaded: ${f.name}`);
    setXmlOpen(true);
    const reader = new FileReader();
    reader.onload = (e) => setXmlText(e.target?.result as string);
    reader.readAsText(f);
  }, [mode]);

  /**
   * Undo the last successful apply operation.
   * Pops the history stack to restore the previous xmlText and removes the
   * applied chunk ID from appliedIds so it becomes appliable again.
   */
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

  const downloadXml = useCallback(() => {
    if (mode !== "wf3") return;
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

  /**
   * handleXmlLineClick — bidirectional XML → PDF synchronisation.
   *
   * ISSUE 3 FIX — Previous implementation failures:
   *   1. Sliced only a single XML line → Innodata XML is tag-dense; after stripping
   *      tags most lines yield < 6 chars → early return fires on nearly every click.
   *   2. Used a 40-char verbatim probe from PDF text → XML wraps every few words in
   *      innodIdentifier / innodReplace / innodRef tags → probe never appears verbatim.
   *   3. Never called the proven server-side apiLocate path.
   *
   * New strategy:
   *   1. Widen context to ±600 chars around the click → captures full paragraphs.
   *   2. Strip all tags + entities → clean plain text for matching.
   *   3. Score chunks via 6-char n-gram overlap → tolerates tag interleaving.
   *   4. Fast path: if best score ≥ 0.45 → selectChunk immediately.
   *   5. Async fallback: apiLocate uses the server's tag-aware regex to find the
   *      exact span, then we find the nearest chunk by character offset.
   */
  const handleXmlLineClick = useCallback(async (lineStart: number, lineEnd: number) => {
    if (!xmlText || result.chunks.length === 0) return;
    try {
      const CONTEXT_RADIUS = 600;
      const ctxStart = Math.max(0, lineStart - CONTEXT_RADIUS);
      const ctxEnd   = Math.min(xmlText.length, lineEnd + CONTEXT_RADIUS);

      const plainCtx = xmlText.slice(ctxStart, ctxEnd)
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();

      if (plainCtx.length < 6) return;

      // Build n-gram set from the context region
      const ctxLower  = plainCtx.toLowerCase();
      const ctxNgrams = new Set<string>();
      for (let i = 0; i <= ctxLower.length - 6; i++) ctxNgrams.add(ctxLower.slice(i, i + 6));

      let bestId: number | null = null;
      let bestScore = 0;
      for (const chunk of result.chunks) {
        for (const text of [chunk.text_b, chunk.text_a]) {
          if (!text || text.length < 6) continue;
          const needle = text.replace(/\s+/g, " ").trim().toLowerCase();
          let hits = 0, total = 0;
          for (let i = 0; i <= needle.length - 6; i += 3) {
            total++;
            if (ctxNgrams.has(needle.slice(i, i + 6))) hits++;
          }
          const score = total > 0 ? hits / total : 0;
          if (score > bestScore) { bestScore = score; bestId = chunk.id; }
        }
      }

      if (bestId !== null && bestScore >= 0.45) {
        void selectChunk(bestId);
        return;
      }

      // Async fallback: server apiLocate with tag-aware regex
      if (plainCtx.length >= 10) {
        const probe      = plainCtx.slice(0, 160).replace(/\s+/g, " ").trim();
        const locChunk   = bestId !== null ? result.chunks.find((c) => c.id === bestId) ?? null : null;
        const synthetic  = locChunk ?? {
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
          for (const [k, off] of Object.entries(result.pane_a.offsets ?? {})) {
            const d = Math.abs(Number(off) - spanMid);
            if (d < closestDist) { closestDist = d; closestId = Number(k); }
          }
          for (const [k, off] of Object.entries(result.pane_b.offsets ?? {})) {
            const d = Math.abs(Number(off) - spanMid);
            if (d < closestDist) { closestDist = d; closestId = Number(k); }
          }
          if (closestId !== null) void selectChunk(closestId);
        } else if (bestId !== null) {
          void selectChunk(bestId);
        }
      }
    } catch { /* XML locate is best-effort; errors must not surface as unhandled rejections */ }
  }, [xmlText, result.chunks, result.pane_a.offsets, result.pane_b.offsets, selectChunk]);

  const posLabel = activeFilteredIndex >= 0
    ? `${activeFilteredIndex + 1} / ${filteredChunks.length}`
    : `— / ${filteredChunks.length}`;

  const modeColor = mode === "wf3"
    ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
    : "bg-slate-500/10 text-slate-400 border-slate-500/20";

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0a1020] overflow-hidden">

      {/* Streaming progress bar — visible only while batches are still arriving */}
      {isStreaming && (
        <div className="flex-shrink-0 relative h-0.5 bg-slate-200 dark:bg-white/8 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-teal-500 transition-all duration-500"
            style={{ width: `${streamingProgress?.pct ?? 0}%` }}
          />
        </div>
      )}

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
          {/* Streaming batch indicator */}
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

          {/* FIX Issue 2: "Show all context" — disables folding so every line is visible */}
          <IconBtn
            title={showAllContext ? "Hide unchanged lines (fold mode)" : "Show all context lines"}
            active={showAllContext}
            onClick={() => setShowAllContext((v) => !v)}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span className="hidden sm:inline">All</span>
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

          {result.chunks.some((c) => c.kind === "emp") && (
            <IconBtn
              title="Download unchanged chunks as JSON"
              active={false}
              onClick={downloadUnchanged}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
              </svg>
              <span className="hidden sm:inline">Unchanged</span>
            </IconBtn>
          )}
        </div>

        <div className="flex-1" />

        {/* FIX: Apply status indicator in header */}
        {mode === "wf3" && applyStatus !== "idle" && (
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
            {applyStatus === "error" && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {applyStatus === "applying" ? "Applying…" :
             applyStatus === "done"     ? "Applied" : "Error"}
          </div>
        )}

        <span className={`flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${modeColor}`}>
          {mode === "wf3" ? "WF3 · editable" : "WF1 · read-only"}
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
                alignedLines={alignedLinesA}
                headerStats={paneAHeaderStats}
                onJumpToFirst={firstPaneAChunk ? () => selectChunk(firstPaneAChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("old", f)}
                onScrollLeft={(left) => !wrapLines && setSyncScrollLeft({ side: "a", left })}
                syncScrollLeft={syncScrollLeft?.side === "b" ? syncScrollLeft.left : null}
                onUnfoldRow={handleUnfoldRow}
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
                alignedLines={alignedLinesB}
                headerStats={paneBHeaderStats}
                onJumpToFirst={firstPaneBChunk ? () => selectChunk(firstPaneBChunk.id) : undefined}
                onChunkClick={selectChunk}
                onScrollFraction={(f) => schedulePanelSync("new", f)}
                onScrollLeft={(left) => !wrapLines && setSyncScrollLeft({ side: "b", left })}
                syncScrollLeft={syncScrollLeft?.side === "a" ? syncScrollLeft.left : null}
                onUnfoldRow={handleUnfoldRow}
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
                  canUndo={applyHistory.length > 0}
                  onUndo={undoApply}
                  onXmlLineClick={handleXmlLineClick}
                />
              </div>
            </>
          )}

          <WordDiffPanel
            chunk={activeChunk}
            open={wordPanelOpen}
            onToggle={() => setWordPanelOpen((v) => !v)}
          />
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