"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  apiBuildChunkedXmlMerge,
  apiInspectChunkedXmlMerge,
  type MergeChunkBuildResult,
  type MergeChunkInspectResult,
  type MergeChunkedXmlInput,
} from "./api";

type Props = {
  onBack?: () => void;
};

type ExportMode = "single" | "versioned" | "backup";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite"; startIn?: "documents" | "downloads" }) => Promise<FileSystemDirectoryHandle>;
};

function xmlDownload(filename: string, xml: string): void {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function inferBaseFilename(files: MergeChunkedXmlInput[]): string {
  if (files.length === 0) return "merged";

  const sourceCommentRe = /<!--\s*Source:\s*([^\n\r<]+?)\s*-->/i;
  for (const f of files) {
    const m = sourceCommentRe.exec(f.content);
    if (m?.[1]) {
      const fromSource = m[1]
        .trim()
        .replace(/\.xml$/i, "")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/[_\-]+$/g, "");
      if (fromSource) return fromSource;
    }
  }

  const groupRootRe = /^(.*?)(?:\/)?(?:haschanges|nochanges|corrected|correctedchunk|has_changes|no_changes|corrected_chunk)\b/i;
  for (const f of files) {
    const rel = (f.relative_path ?? "").replace(/\\/g, "/");
    const m = groupRootRe.exec(rel);
    if (m?.[1]) {
      const parts = m[1].split("/").filter(Boolean);
      const base = (parts[parts.length - 1] ?? "")
        .replace(/\.xml$/i, "")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/[_\-]+$/g, "");
      if (base) return base;
    }
  }

  const first = files[0].filename.replace(/\.xml$/i, "");
  return first.replace(/(?:_innod\.\d+|Chunk\d+.*)$/i, "").replace(/[_\-]+$/, "") || "merged";
}

function normalizeGroupInputs(files: MergeChunkedXmlInput[], groupFolder: "haschanges" | "nochanges" | "corrected"): MergeChunkedXmlInput[] {
  const groupRe = new RegExp(`(^|/)${groupFolder}(/|$)`, "i");
  return files.map((f) => {
    const rel = (f.relative_path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    const nextRel = rel
      ? groupRe.test(rel)
        ? rel
        : `${groupFolder}/${rel}`
      : `${groupFolder}/${f.filename}`;
    return { ...f, relative_path: nextRel };
  });
}

async function filesToInputs(fileList: FileList | null): Promise<MergeChunkedXmlInput[]> {
  if (!fileList || fileList.length === 0) return [];

  const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".xml"));
  const out = await Promise.all(
    files.map(async (f) => {
      const relativePath = ((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? "").replace(/\\/g, "/");
      return {
        filename: f.name,
        content: await f.text(),
        relative_path: relativePath,
      };
    }),
  );

  return out;
}

async function collectDirectoryXmlFiles(dir: FileSystemDirectoryHandle, prefix = ""): Promise<MergeChunkedXmlInput[]> {
  const out: MergeChunkedXmlInput[] = [];

  for await (const [name, entry] of dir.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      out.push(...(await collectDirectoryXmlFiles(entry, rel)));
      continue;
    }

    if (!name.toLowerCase().endsWith(".xml")) continue;
    const file = await entry.getFile();
    out.push({
      filename: file.name,
      content: await file.text(),
      relative_path: rel,
    });
  }

  return out;
}

export default function MergeChunkedXmlPanel({ onBack }: Props) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const hasFolderRef = useRef<HTMLInputElement>(null);
  const noFolderRef = useRef<HTMLInputElement>(null);
  const correctedFolderRef = useRef<HTMLInputElement>(null);
  const rootFolderRef = useRef<HTMLInputElement>(null);

  const [chunkFiles, setChunkFiles] = useState<MergeChunkedXmlInput[]>([]);
  const [hasChangesFiles, setHasChangesFiles] = useState<MergeChunkedXmlInput[]>([]);
  const [noChangesFiles, setNoChangesFiles] = useState<MergeChunkedXmlInput[]>([]);
  const [correctedFiles, setCorrectedFiles] = useState<MergeChunkedXmlInput[]>([]);
  const [hasFolderLabel, setHasFolderLabel] = useState<string>("");
  const [noFolderLabel, setNoFolderLabel] = useState<string>("");
  const [correctedFolderLabel, setCorrectedFolderLabel] = useState<string>("");
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [inspect, setInspect] = useState<MergeChunkInspectResult | null>(null);
  const [buildResult, setBuildResult] = useState<MergeChunkBuildResult | null>(null);

  const [busyInspect, setBusyInspect] = useState(false);
  const [busyMerge, setBusyMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exportMode, setExportMode] = useState<ExportMode>("single");
  const [baseFilename, setBaseFilename] = useState("merged");
  const [strictMode, setStrictMode] = useState(true);

  useEffect(() => {
    const refs = [hasFolderRef.current, noFolderRef.current, correctedFolderRef.current, rootFolderRef.current];
    for (const ref of refs) {
      if (!ref) continue;
      const el = ref as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean };
      el.webkitdirectory = true;
      el.directory = true;
    }
  }, []);

  const selectedNames = useMemo(
    () => Object.entries(selectedMap).filter(([, on]) => on).map(([name]) => name),
    [selectedMap],
  );

  const previewXml = buildResult?.merged_xml ?? "";

  const groupedMode = hasChangesFiles.length > 0 || noChangesFiles.length > 0 || correctedFiles.length > 0;

  const inspectNow = async (files: MergeChunkedXmlInput[], selected: string[] = []): Promise<void> => {
    setBusyInspect(true);
    setError(null);
    try {
      const data = await apiInspectChunkedXmlMerge(files, selected);
      setInspect(data);
      setBuildResult(null);

      const nextSelection: Record<string, boolean> = {};
      for (const row of data.chunk_rows) {
        nextSelection[row.selection_key] = selected.length > 0
          ? selected.includes(row.selection_key)
          : !row.duplicate;
      }
      setSelectedMap(nextSelection);
    } catch (e) {
      setInspect(null);
      setBuildResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyInspect(false);
    }
  };

  const loadFiles = async (files: MergeChunkedXmlInput[]) => {
    if (files.length === 0) {
      setError("No XML chunk files detected.");
      return;
    }
    setChunkFiles(files);
    setBaseFilename(inferBaseFilename(files));
    await inspectNow(files, []);
  };

  const loadFromGroups = async (
    hasFiles: MergeChunkedXmlInput[],
    noFiles: MergeChunkedXmlInput[],
    corrected: MergeChunkedXmlInput[],
  ) => {
    const combined = [...hasFiles, ...noFiles, ...corrected];
    if (combined.length === 0) {
      setChunkFiles([]);
      setInspect(null);
      setBuildResult(null);
      setSelectedMap({});
      setError("No XML chunk files detected.");
      return;
    }
    await loadFiles(combined);
  };

  const onUploadMixed = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = await filesToInputs(ev.target.files);
    setHasChangesFiles([]);
    setNoChangesFiles([]);
    setCorrectedFiles([]);
    setHasFolderLabel("");
    setNoFolderLabel("");
    setCorrectedFolderLabel("");
    await loadFiles(files);
    ev.target.value = "";
  };

  const onUploadGrouped = (group: "haschanges" | "nochanges" | "corrected") =>
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const files = normalizeGroupInputs(await filesToInputs(ev.target.files), group);
      if (group === "haschanges") {
        setHasChangesFiles(files);
        setHasFolderLabel(ev.target.files?.[0]?.webkitRelativePath?.split("/")?.[0] ?? "haschanges");
        await loadFromGroups(files, noChangesFiles, correctedFiles);
      } else if (group === "nochanges") {
        setNoChangesFiles(files);
        setNoFolderLabel(ev.target.files?.[0]?.webkitRelativePath?.split("/")?.[0] ?? "nochanges");
        await loadFromGroups(hasChangesFiles, files, correctedFiles);
      } else {
        setCorrectedFiles(files);
        setCorrectedFolderLabel(ev.target.files?.[0]?.webkitRelativePath?.split("/")?.[0] ?? "corrected");
        await loadFromGroups(hasChangesFiles, noChangesFiles, files);
      }
      ev.target.value = "";
    };

  const pickGroupedFolderWithFSAPI = async (group: "haschanges" | "nochanges" | "corrected") => {
    const w = window as DirectoryPickerWindow;
    if (!w.showDirectoryPicker) {
      if (group === "haschanges") {
        hasFolderRef.current?.click();
      } else if (group === "nochanges") {
        noFolderRef.current?.click();
      } else {
        correctedFolderRef.current?.click();
      }
      return;
    }
    setError(null);
    try {
      const dir = await w.showDirectoryPicker({ mode: "read", startIn: "documents" });
      const files = normalizeGroupInputs(await collectDirectoryXmlFiles(dir, ""), group);
      if (group === "haschanges") {
        setHasChangesFiles(files);
        setHasFolderLabel(dir.name || "haschanges");
        await loadFromGroups(files, noChangesFiles, correctedFiles);
      } else if (group === "nochanges") {
        setNoChangesFiles(files);
        setNoFolderLabel(dir.name || "nochanges");
        await loadFromGroups(hasChangesFiles, files, correctedFiles);
      } else {
        setCorrectedFiles(files);
        setCorrectedFolderLabel(dir.name || "corrected");
        await loadFromGroups(hasChangesFiles, noChangesFiles, files);
      }
    } catch {
      // user cancelled
    }
  };

  const detectGroupFromRelativePath = (relativePath: string): "haschanges" | "nochanges" | "corrected" | null => {
    const p = (relativePath || "").replace(/\\/g, "/").toLowerCase();
    if (/\/(correctedchunk|corrected|corrected_chunk)\//.test(`/${p}`)) return "corrected";
    if (/\/(haschanges|has_changes)\//.test(`/${p}`)) return "haschanges";
    if (/\/(nochanges|no_changes)\//.test(`/${p}`)) return "nochanges";
    return null;
  };

  const splitByGroup = (files: MergeChunkedXmlInput[]) => {
    const has: MergeChunkedXmlInput[] = [];
    const no: MergeChunkedXmlInput[] = [];
    const corrected: MergeChunkedXmlInput[] = [];
    const unknown: MergeChunkedXmlInput[] = [];

    for (const f of files) {
      const grp = detectGroupFromRelativePath(f.relative_path ?? "");
      if (grp === "haschanges") has.push(normalizeGroupInputs([f], "haschanges")[0]);
      else if (grp === "nochanges") no.push(normalizeGroupInputs([f], "nochanges")[0]);
      else if (grp === "corrected") corrected.push(normalizeGroupInputs([f], "corrected")[0]);
      else unknown.push(f);
    }

    return { has, no, corrected, unknown };
  };

  const pickRootFolderWithFSAPI = async () => {
    const w = window as DirectoryPickerWindow;
    if (!w.showDirectoryPicker) {
      rootFolderRef.current?.click();
      return;
    }

    setError(null);
    try {
      const dir = await w.showDirectoryPicker({ mode: "read", startIn: "documents" });
      const files = await collectDirectoryXmlFiles(dir, dir.name);
      const { has, no, corrected, unknown } = splitByGroup(files);

      if (has.length + no.length + corrected.length === 0) {
        setError("Main folder must contain subfolders haschanges, nochanges, and/or corrected with XML files.");
        return;
      }

      setHasChangesFiles(has);
      setNoChangesFiles(no);
      setCorrectedFiles(corrected);
      setHasFolderLabel(has.length > 0 ? "haschanges" : "");
      setNoFolderLabel(no.length > 0 ? "nochanges" : "");
      setCorrectedFolderLabel(corrected.length > 0 ? "corrected" : "");
      await loadFromGroups(has, no, corrected);
      if (unknown.length > 0) {
        setError(`Ignored ${unknown.length} XML file(s) outside haschanges/nochanges/corrected folders.`);
      }
    } catch {
      // user cancelled
    }
  };

  const onUploadRoot = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = await filesToInputs(ev.target.files);
    const { has, no, corrected, unknown } = splitByGroup(files);
    setHasChangesFiles(has);
    setNoChangesFiles(no);
    setCorrectedFiles(corrected);
    setHasFolderLabel(has.length > 0 ? "haschanges" : "");
    setNoFolderLabel(no.length > 0 ? "nochanges" : "");
    setCorrectedFolderLabel(corrected.length > 0 ? "corrected" : "");
    await loadFromGroups(has, no, corrected);
    if (unknown.length > 0) {
      setError(`Ignored ${unknown.length} XML file(s) outside haschanges/nochanges/corrected folders.`);
    }
    ev.target.value = "";
  };

  const toggleFile = async (filename: string) => {
    const next = { ...selectedMap, [filename]: !selectedMap[filename] };
    setSelectedMap(next);
    if (inspect) {
      const selected = Object.entries(next).filter(([, v]) => v).map(([k]) => k);
      await inspectNow(chunkFiles, selected);
    }
  };

  const mergeNow = async () => {
    if (chunkFiles.length === 0) return;
    setBusyMerge(true);
    setError(null);
    try {
      const data = await apiBuildChunkedXmlMerge(
        chunkFiles,
        selectedNames,
        exportMode,
        baseFilename || "merged",
        strictMode,
      );
      setBuildResult(data);
      setInspect(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyMerge(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-4">
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All Workflows
          </button>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] p-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">MERGE CHUNKED XML</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Upload XML chunks or load a folder, validate order and completeness, preview merged output, then export final XML.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <input ref={uploadRef} type="file" accept=".xml" multiple className="hidden" onChange={onUploadMixed} />
            <input ref={hasFolderRef} type="file" multiple className="hidden" onChange={onUploadGrouped("haschanges")} />
            <input ref={noFolderRef} type="file" multiple className="hidden" onChange={onUploadGrouped("nochanges")} />
            <input ref={correctedFolderRef} type="file" multiple className="hidden" onChange={onUploadGrouped("corrected")} />
            <input ref={rootFolderRef} type="file" multiple className="hidden" onChange={onUploadRoot} />

            <button
              onClick={() => uploadRef.current?.click()}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-white/15 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              Upload Mixed XML Chunks
            </button>
            <button
              onClick={() => void pickGroupedFolderWithFSAPI("haschanges")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-amber-300/70 dark:border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-500/10"
            >
              Select HasChanges Folder
            </button>
            <button
              onClick={() => void pickGroupedFolderWithFSAPI("nochanges")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-emerald-300/70 dark:border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
            >
              Select NoChanges Folder
            </button>
            <button
              onClick={() => void pickGroupedFolderWithFSAPI("corrected")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-cyan-300/70 dark:border-cyan-500/30 hover:bg-cyan-50 dark:hover:bg-cyan-500/10"
            >
              Select Corrected Folder
            </button>
            <button
              onClick={pickRootFolderWithFSAPI}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-violet-300/70 dark:border-violet-500/30 hover:bg-violet-50 dark:hover:bg-violet-500/10"
            >
              Select Main Folder
            </button>

            <span className="text-[11px] text-slate-500 self-center ml-1">
              {groupedMode
                ? `Loaded: haschanges ${hasChangesFiles.length}${hasFolderLabel ? ` (${hasFolderLabel})` : ""}, nochanges ${noChangesFiles.length}${noFolderLabel ? ` (${noFolderLabel})` : ""}, corrected ${correctedFiles.length}${correctedFolderLabel ? ` (${correctedFolderLabel})` : ""}`
                : "Use either separate has/no/corrected folders or one main folder containing those subfolders."}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 mr-2">
                <input
                  type="checkbox"
                  checked={strictMode}
                  onChange={(e) => setStrictMode(e.target.checked)}
                />
                Strict Integrity
              </label>
              <label className="text-[11px] text-slate-500">Export Mode</label>
              <select
                value={exportMode}
                onChange={(e) => setExportMode(e.target.value as ExportMode)}
                className="text-xs px-2 py-1.5 rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-slate-900"
              >
                <option value="single">Single final XML</option>
                <option value="versioned">Versioned XML</option>
                <option value="backup">Backup copy</option>
              </select>
              <input
                value={baseFilename}
                onChange={(e) => setBaseFilename(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-slate-900 w-44"
                placeholder="base filename"
              />
            </div>
          </div>

          {(busyInspect || busyMerge) && (
            <div className="mt-3 text-xs text-teal-600 dark:text-teal-400 font-medium">
              {busyMerge ? "Merging chunked XML..." : "Scanning chunk files..."}
            </div>
          )}

          {error && (
            <div className="mt-3 text-xs text-rose-600 dark:text-rose-300 rounded-lg border border-rose-300/60 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Detected Chunk List</h3>
              <span className="text-[11px] text-slate-500">
                {inspect?.summary.total_detected ?? 0} detected / {inspect?.summary.selected ?? 0} selected
              </span>
            </div>

            <div className="max-h-[420px] overflow-auto border border-slate-200 dark:border-white/10 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/70 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">Pick</th>
                    <th className="px-2 py-2 text-left">Seq</th>
                    <th className="px-2 py-2 text-left">File</th>
                    <th className="px-2 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inspect?.chunk_rows?.map((row) => (
                    <tr key={row.selection_key} className="border-t border-slate-200/80 dark:border-white/10">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!selectedMap[row.selection_key]}
                          disabled={row.duplicate}
                          onChange={() => { void toggleFile(row.selection_key); }}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.sequence ?? "-"}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-slate-700 dark:text-slate-200 truncate">{row.filename}</div>
                        {row.relative_path && <div className="text-[10px] text-slate-500 truncate">{row.relative_path}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.duplicate ? (
                          <span className="text-rose-500">Duplicate</span>
                        ) : row.source_group === "corrected" ? (
                          <span className="text-cyan-600 dark:text-cyan-300">Corrected</span>
                        ) : row.has_changes ? (
                          <span className="text-amber-600 dark:text-amber-400">Changed</span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">No changes</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!inspect && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-slate-500">No chunks loaded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void inspectNow(chunkFiles, selectedNames)}
                disabled={chunkFiles.length === 0 || busyInspect}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-white/15 disabled:opacity-50"
              >
                Refresh Preview
              </button>
              <button
                onClick={() => void mergeNow()}
                disabled={chunkFiles.length === 0 || busyMerge || selectedNames.length === 0}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50"
              >
                Merge Chunks
              </button>
              <button
                onClick={() => buildResult && xmlDownload(buildResult.export_filename, buildResult.merged_xml)}
                disabled={!buildResult}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                Export Final XML
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d1628] p-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Validation & Merge Preview</h3>

            <div className="space-y-2 mb-3">
              {strictMode && (
                <div className="text-xs text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-300/50 dark:border-cyan-500/30 rounded px-2.5 py-2">
                  Strict Integrity is ON: merge will be blocked if chunk sequences are missing or invalid files are detected.
                </div>
              )}
              {(inspect?.warnings ?? []).map((w, i) => (
                <div key={`${w}-${i}`} className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-300/50 dark:border-amber-500/30 rounded px-2.5 py-2">
                  {w}
                </div>
              ))}
              {(inspect?.invalid_files ?? []).map((inv) => (
                <div key={inv.filename} className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-300/50 dark:border-rose-500/30 rounded px-2.5 py-2">
                  {inv.reason}
                </div>
              ))}
            </div>

            <textarea
              readOnly
              value={previewXml}
              placeholder="Merged XML preview will appear here after merge."
              className="w-full h-[420px] rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 p-3 text-[11px] font-mono leading-5"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
