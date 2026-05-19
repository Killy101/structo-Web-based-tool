"use client";
// ─────────────────────────────────────────────────────────────────────────────
// ChunkDetectionModal.tsx — Chunk detection report modal
//
// Displays a concise chunk status list and provides grouped downloads:
// - ChunkedListHasChanges
// - ChunkedListNoChanges
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef } from "react";
import type { DiffResult, XmlSection } from "./types";

type ChunkStatus = "no_changes" | "modified" | "added" | "removed";

interface Props {
  result:        DiffResult;
  xmlSections:   XmlSection[];
  sectionMapper: (s: string) => string | null;
  xmlFile?:      File | null;
  onViewChunk:   (payload: {
    chunkId: number | null;
    anchorChunkId: number | null;
    sectionLabel: string;
    chunkNumber: number;
    hasChanges: boolean;
    chunkXml: string;
    chunkXmlFilename: string;
  }) => void;
  listScrollTop?: number;
  onListScroll?: (scrollTop: number) => void;
  onClose:       () => void;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim() || "document";
}

function downloadXmlFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeChunkLabel(label: string): string {
  return label
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "chunk";
}

type ExportChunk = {
  filename: string;
  content: string;
};

function StatusIcon({ status }: { status: ChunkStatus }) {
  if (status === "no_changes") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400">
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6.5l2.2 2.2L10 3.5" />
        </svg>
      </span>
    );
  }

  if (status === "modified") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 text-amber-400">
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 9.5l1.2-3.1L7.8 1.8a1 1 0 011.4 0l1 1a1 1 0 010 1.4L5.6 8.8 2.5 10z" />
        </svg>
      </span>
    );
  }

  if (status === "added") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400">
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2v8M2 6h8" />
        </svg>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-500/20 text-rose-400">
      <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6h8" />
      </svg>
    </span>
  );
}

async function saveChunksToDirectory(
  chunks: ExportChunk[],
  xmlFolderName: string,
  groupFolderName: "HasChanges" | "NoChanges",
): Promise<boolean> {
  type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite"; startIn?: "documents" | "downloads" }) => Promise<FileSystemDirectoryHandle>;
  };

  const w = window as DirectoryPickerWindow;
  if (!w.showDirectoryPicker) return false;

  try {
    const picked = await w.showDirectoryPicker({ mode: "readwrite", startIn: "documents" });
    const lrduRoot = picked.name.toLowerCase() === "lrdu"
      ? picked
      : await picked.getDirectoryHandle("LRDU", { create: true });
    const xmlRoot = await lrduRoot.getDirectoryHandle(xmlFolderName, { create: true });
    const target = await xmlRoot.getDirectoryHandle(groupFolderName, { create: true });

    for (const chunk of chunks) {
      const fileHandle = await target.getFileHandle(chunk.filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(chunk.content);
      await writable.close();
    }

    return true;
  } catch {
    return false;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default function ChunkDetectionModal({
  result,
  xmlSections,
  sectionMapper,
  xmlFile,
  onViewChunk,
  listScrollTop = 0,
  onListScroll,
  onClose,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listScrollTop;
  }, [listScrollTop]);

  const statusMeta = (status: ChunkStatus) => {
    if (status === "no_changes") {
      return {
        label: "No Changes",
        dotClass: "bg-emerald-400",
        rowClass: "bg-emerald-500/5 border border-emerald-500/15 dark:border-emerald-500/10",
        textClass: "text-emerald-400 dark:text-emerald-300",
      };
    }
    if (status === "added") {
      return {
        label: "Added",
        dotClass: "bg-emerald-400",
        rowClass: "bg-emerald-500/5 border border-emerald-500/15 dark:border-emerald-500/10",
        textClass: "text-emerald-400 dark:text-emerald-300",
      };
    }
    if (status === "removed") {
      return {
        label: "Removed",
        dotClass: "bg-rose-400",
        rowClass: "bg-rose-500/5 border border-rose-500/15 dark:border-rose-500/10",
        textClass: "text-rose-400 dark:text-rose-300",
      };
    }
    return {
      label: "Modified",
      dotClass: "bg-amber-400",
      rowClass: "bg-amber-500/5 border border-amber-500/15 dark:border-amber-500/10",
      textClass: "text-amber-400 dark:text-amber-300",
    };
  };
  const coveredSectionLabels = useMemo(() => {
    const covered = new Set<string>();
    for (const chunk of result.chunks) {
      const label = sectionMapper(chunk.section ?? "");
      if (label) covered.add(label);
    }
    return covered;
  }, [result.chunks, sectionMapper]);

  const fallbackSectionsFromChunks = useMemo(() => {
    const seen = new Set<string>();
    const rows: XmlSection[] = [];
    for (const chunk of result.chunks) {
      const raw = (chunk.section ?? "").trim();
      if (!raw) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      rows.push({
        id: rows.length + 1,
        label: raw,
        level: 1,
        parent_id: -1,
      });
    }
    return rows;
  }, [result.chunks]);

  const sectionsForList = xmlSections.length > 0 ? xmlSections : fallbackSectionsFromChunks;

  const chunkStatusRows = useMemo(() => {
    const sectionFirstChunkId = new Map<string, number>();
    const sectionKinds = new Map<string, Set<string>>();
    for (const chunk of result.chunks) {
      const label = sectionMapper(chunk.section ?? "");
      if (!label) continue;
      if (!sectionFirstChunkId.has(label)) sectionFirstChunkId.set(label, chunk.id);
      const kinds = sectionKinds.get(label) ?? new Set<string>();
      kinds.add(chunk.kind);
      sectionKinds.set(label, kinds);
    }

    const resolveStatus = (kinds: Set<string> | undefined): ChunkStatus => {
      if (!kinds || kinds.size === 0) return "no_changes";
      const hasAdd = kinds.has("add");
      const hasDel = kinds.has("del");
      const hasModLike = kinds.has("mod") || kinds.has("emp") || kinds.has("strike");
      if (hasModLike || (hasAdd && hasDel)) return "modified";
      if (hasAdd) return "added";
      if (hasDel) return "removed";
      return "modified";
    };

    return sectionsForList.map((section, idx) => {
      const hasChanges = coveredSectionLabels.has(section.label);
      const chunkId = sectionFirstChunkId.get(section.label) ?? null;
      const status = resolveStatus(sectionKinds.get(section.label));
      return {
        idx: idx + 1,
        section,
        chunkId,
        hasChanges,
        status,
      };
    });
  }, [sectionsForList, coveredSectionLabels, result.chunks, sectionMapper]);

  const hasChangesRows = useMemo(
    () => chunkStatusRows.filter((row) => row.hasChanges),
    [chunkStatusRows],
  );
  const noChangesRows = useMemo(
    () => chunkStatusRows.filter((row) => !row.hasChanges),
    [chunkStatusRows],
  );

  const chunkRowsWithAnchors = useMemo(() => {
    const changedIndexes = chunkStatusRows
      .map((row, i) => ({ i, chunkId: row.chunkId }))
      .filter((x) => x.chunkId != null) as Array<{ i: number; chunkId: number }>;

    return chunkStatusRows.map((row, i) => {
      if (row.chunkId != null) {
        return { ...row, anchorChunkId: row.chunkId };
      }
      if (changedIndexes.length === 0) {
        return { ...row, anchorChunkId: null };
      }

      let nearest = changedIndexes[0];
      let minDist = Math.abs(changedIndexes[0].i - i);
      for (const entry of changedIndexes) {
        const d = Math.abs(entry.i - i);
        if (d < minDist) {
          minDist = d;
          nearest = entry;
        }
      }
      return { ...row, anchorChunkId: nearest.chunkId };
    });
  }, [chunkStatusRows]);

  const getSectionLabelFromElement = (el: Element): string => {
    const heading =
      el.querySelector("innodHeading > title") ??
      el.querySelector("innodHeading title") ??
      el.querySelector("title");
    const headingText = (heading?.textContent ?? "").trim();
    if (headingText.length > 0) return headingText;
    return (el.getAttribute("last-path") ?? "").trim();
  };

  const buildChunkXmlBySection = (xmlText: string): Map<number, string> => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) return new Map();

    const preferredLevel = sectionsForList[0]?.level;
    const allLevelNodes = Array.from(doc.querySelectorAll("innodLevel"));
    const levelNodes = preferredLevel != null
      ? allLevelNodes.filter((el) => Number.parseInt(el.getAttribute("level") ?? "-1", 10) === preferredLevel)
      : allLevelNodes;

    const usableNodes = levelNodes.length > 0 ? levelNodes : allLevelNodes;
    const serializer = new XMLSerializer();
    const byRow = new Map<number, string>();
    const used = new Set<Element>();
    const byLabel = new Map<string, Element[]>();

    for (const node of usableNodes) {
      const key = getSectionLabelFromElement(node).replace(/\W+/g, " ").trim().toLowerCase();
      if (!key) continue;
      const arr = byLabel.get(key) ?? [];
      arr.push(node);
      byLabel.set(key, arr);
    }

    for (const row of chunkStatusRows) {
      const rowKey = row.section.label.replace(/\W+/g, " ").trim().toLowerCase();
      let chosen: Element | undefined;

      if (rowKey) {
        const candidates = byLabel.get(rowKey) ?? [];
        chosen = candidates.find((el) => !used.has(el));
      }

      if (!chosen) {
        chosen = usableNodes.find((el) => !used.has(el));
      }

      if (!chosen) continue;
      used.add(chosen);

      const xmlBody = serializer.serializeToString(chosen);
      const content = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<!-- Source: ${escapeXml(sanitizeFilename(result.file_a || result.file_b || "document"))} -->`,
        `<!-- Chunk: ${row.idx} | ${escapeXml(row.section.label)} -->`,
        xmlBody,
        "",
      ].join("\n");
      byRow.set(row.idx, content);
    }

    return byRow;
  };

  const buildChunkExports = async (target: "hasChanges" | "noChanges"): Promise<ExportChunk[]> => {
    const rows = target === "hasChanges" ? hasChangesRows : noChangesRows;

    let xmlByRow = new Map<number, string>();
    if (xmlFile) {
      try {
        const xmlText = await xmlFile.text();
        xmlByRow = buildChunkXmlBySection(xmlText);
      } catch {
        xmlByRow = new Map();
      }
    }

    return rows.map((row) => {
      const status = row.hasChanges ? "has_changes" : "no_changes";
      const safeLabel = sanitizeChunkLabel(row.section.label);
      const fallback = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<chunk index="${row.idx}" level="${row.section.level}" status="${status}">`,
        `  <label>${escapeXml(row.section.label)}</label>`,
        "</chunk>",
        "",
      ].join("\n");
      const content = xmlByRow.get(row.idx) ?? fallback;
      return {
        filename: `Chunk${String(row.idx).padStart(3, "0")}_${safeLabel}.xml`,
        content,
      };
    });
  };

  const buildSingleChunkView = async (row: {
    idx: number;
    section: XmlSection;
    hasChanges: boolean;
  }): Promise<{ chunkXml: string; chunkXmlFilename: string }> => {
    let xmlByRow = new Map<number, string>();
    if (xmlFile) {
      try {
        const xmlText = await xmlFile.text();
        xmlByRow = buildChunkXmlBySection(xmlText);
      } catch {
        xmlByRow = new Map();
      }
    }

    const status = row.hasChanges ? "has_changes" : "no_changes";
    const safeLabel = sanitizeChunkLabel(row.section.label);
    const fallback = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<chunk index="${row.idx}" level="${row.section.level}" status="${status}">`,
      `  <label>${escapeXml(row.section.label)}</label>`,
      "</chunk>",
      "",
    ].join("\n");

    return {
      chunkXml: xmlByRow.get(row.idx) ?? fallback,
      chunkXmlFilename: `Chunk${String(row.idx).padStart(3, "0")}_${safeLabel}.xml`,
    };
  };

  const handleViewRow = async (row: {
    idx: number;
    section: XmlSection;
    chunkId: number | null;
    anchorChunkId: number | null;
    hasChanges: boolean;
  }) => {
    const viewData = await buildSingleChunkView(row);
    onViewChunk({
      chunkId: row.chunkId,
      anchorChunkId: row.anchorChunkId,
      sectionLabel: row.section.label,
      chunkNumber: row.idx,
      hasChanges: row.hasChanges,
      chunkXml: viewData.chunkXml,
      chunkXmlFilename: viewData.chunkXmlFilename,
    });
  };

  const downloadGroupedList = async (target: "hasChanges" | "noChanges") => {
    const chunkFiles = await buildChunkExports(target);
    if (chunkFiles.length === 0) return;

    const xmlFolderName = sanitizeFilename(xmlFile?.name || fileBaseName);
    const groupFolderName: "HasChanges" | "NoChanges" = target === "hasChanges" ? "HasChanges" : "NoChanges";

    const savedToFolder = await saveChunksToDirectory(chunkFiles, xmlFolderName, groupFolderName);
    if (savedToFolder) return;

    // Fallback for browsers without File System Access API: trigger one download per chunk.
    for (const chunk of chunkFiles) {
      downloadXmlFile(chunk.filename, chunk.content);
    }
  };

  const fileBaseName = sanitizeFilename(result.file_a || result.file_b || "document");
  const xmlFolderName = sanitizeFilename(xmlFile?.name || fileBaseName);

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Chunk Detection Report</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {xmlSections.length} chunk section{xmlSections.length !== 1 ? "s" : ""} · {hasChangesRows.length} with changes · {noChangesRows.length} without changes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void downloadGroupedList("hasChanges")}
              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              disabled={hasChangesRows.length === 0}
            >
              Download Has Changes
            </button>
            <button
              onClick={() => void downloadGroupedList("noChanges")}
              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-500/30 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20 transition-colors"
              disabled={noChangesRows.length === 0}
            >
              Download No Changes
            </button>
            <button
              onClick={onClose}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors"
            >
              Continue View More
            </button>
          </div>
        </div>

        {/* Chunk status list */}
        <div
          ref={listRef}
          onScroll={(e) => onListScroll?.(e.currentTarget.scrollTop)}
          className="flex-1 overflow-y-auto p-3 space-y-0.5"
        >
          {chunkStatusRows.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">
              No chunked sections available. Upload XML and choose a chunk level to see status.
            </p>
          ) : (
            chunkRowsWithAnchors.map((row) => {
              const leftPad = Math.max(0, row.section.level - 1) * 8;
              const meta = statusMeta(row.status);
              return (
                <div
                  key={`${row.section.id}-${row.idx}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${meta.rowClass}`}
                >
                  <span className={`flex-shrink-0 w-2 h-2 rounded-full ${meta.dotClass}`} />

                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 w-[70px] flex-shrink-0">
                    Chunk {row.idx}
                  </span>

                  <span
                    className={`text-xs truncate flex-1 ${meta.textClass}`}
                    style={{ paddingLeft: `${leftPad}px` }}
                    title={row.section.label}
                  >
                    {row.section.label}
                  </span>

                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold flex-shrink-0 ${meta.textClass}`}>
                    <StatusIcon status={row.status} />
                    {meta.label}
                  </span>

                  <button
                    onClick={() => { void handleViewRow(row); }}
                    className="ml-2 text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                  >
                    View
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex-shrink-0 px-4 py-3 border-t border-slate-200 dark:border-white/8 bg-slate-50/60 dark:bg-white/[0.02] rounded-b-2xl">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Export path structure:
            <span className="font-semibold"> C:/Users/T7I/Documents/LRDU/{xmlFolderName}/HasChanges</span>
            {" "}and
            <span className="font-semibold"> C:/Users/T7I/Documents/LRDU/{xmlFolderName}/NoChanges</span>.
          </p>
        </div>
      </div>
    </div>
  );
}