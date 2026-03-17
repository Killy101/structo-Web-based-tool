"use client";
/**
 * FileUploadPanel — Upload OLD PDF, NEW PDF, and multiple pre-chunked XMLs.
 *
 * Features
 * ────────
 * - Drag-and-drop or click-to-browse for each file slot
 * - Multi-file XML upload (pre-chunked XML files)
 * - Real-time upload progress bar (XHR-based, separate from processing progress)
 * - Visual file previews with size and name
 * - Source name input for project identification
 * - Calls parent `onUploaded` callback with the session_id when done
 * - Also passes File objects to parent so PDFs can be rendered in viewers
 */

import React, { useCallback, useRef, useState } from "react";
import { uploadFiles } from "./api";
import type { UploadResponse } from "./types";

// ── Sub-components ────────────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
  icon: React.ReactNode;
  color: string;   // Tailwind border/bg color suffix, e.g. "blue", "violet", "emerald"
}

function DropZone({ label, accept, file, onFile, icon, color }: DropZoneProps) {
  const inputRef  = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const borderClass = dragOver
    ? `border-${color}-400 bg-${color}-500/10`
    : file
    ? `border-${color}-500/50 bg-${color}-500/5`
    : `border-slate-300 dark:border-slate-600/50 bg-slate-50 dark:bg-slate-800/30 hover:border-${color}-400 dark:hover:border-${color}-500/40 hover:bg-${color}-50 dark:hover:bg-${color}-500/5`;

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) onFile(dropped);
    },
    [onFile],
  );

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition-all duration-150 cursor-pointer ${borderClass}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${color}-500/15 text-${color}-400`}>
        {icon}
      </div>

      {/* Label */}
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 text-center">{label}</p>

      {/* File info or placeholder */}
      {file ? (
        <div className="text-center">
          <p className={`text-xs font-medium text-${color}-600 dark:text-${color}-300 truncate max-w-[140px]`}>{file.name}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{formatBytes(file.size)}</p>
        </div>
      ) : (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
          Drag &amp; drop or click to browse
        </p>
      )}

      {/* Checkmark overlay */}
      {file && (
        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full bg-${color}-500 flex items-center justify-center`}>
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ── Multi-file DropZone (for XML) ──────────────────────────────────────────────

interface MultiDropZoneProps {
  label: string;
  accept: string;
  files: File[];
  onFiles: (files: File[]) => void;
  icon: React.ReactNode;
  color: string;
}

function MultiDropZone({ label, accept, files, onFiles, icon, color }: MultiDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const borderClass = dragOver
    ? `border-${color}-400 bg-${color}-500/10`
    : files.length > 0
    ? `border-${color}-500/50 bg-${color}-500/5`
    : `border-slate-300 dark:border-slate-600/50 bg-slate-50 dark:bg-slate-800/30 hover:border-${color}-400 dark:hover:border-${color}-500/40 hover:bg-${color}-50 dark:hover:bg-${color}-500/5`;

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.toLowerCase().endsWith(".xml"),
      );
      if (dropped.length > 0) onFiles(dropped);
    },
    [onFiles],
  );

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition-all duration-150 cursor-pointer ${borderClass}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length > 0) onFiles(selected);
        }}
      />

      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${color}-500/15 text-${color}-400`}>
        {icon}
      </div>

      {/* Label */}
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 text-center">{label}</p>

      {/* File info or placeholder */}
      {files.length > 0 ? (
        <div className="text-center">
          <p className={`text-xs font-medium text-${color}-600 dark:text-${color}-300`}>
            {files.length} file{files.length > 1 ? "s" : ""} selected
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{formatBytes(totalSize)}</p>
        </div>
      ) : (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
          Drag &amp; drop or click to select multiple files
        </p>
      )}

      {/* Checkmark overlay */}
      {files.length > 0 && (
        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full bg-${color}-500 flex items-center justify-center`}>
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-xs font-semibold text-[#1a8fd1]">{pct}%</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-700/50 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #1a8fd1, #42b4f5)",
            boxShadow: pct > 0 ? "0 0 8px rgba(26,143,209,0.5)" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileUploadPanelProps {
  onUploaded: (response: UploadResponse, oldPdf: File, newPdf: File) => void;
}

export default function FileUploadPanel({ onUploaded }: FileUploadPanelProps) {
  const [oldPdf,     setOldPdf]     = useState<File | null>(null);
  const [newPdf,     setNewPdf]     = useState<File | null>(null);
  const [xmlFiles,   setXmlFiles]   = useState<File[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [uploading,  setUploading]  = useState(false);
  const [uploadPct,  setUploadPct]  = useState(0);
  const [error,      setError]      = useState<string | null>(null);

  const canUpload = oldPdf && newPdf && xmlFiles.length > 0 && sourceName.trim();

  const handleUpload = async () => {
    if (!canUpload) return;
    setError(null);
    setUploading(true);
    setUploadPct(0);

    try {
      const response = await uploadFiles(
        oldPdf!,
        newPdf!,
        xmlFiles,
        sourceName.trim(),
        (pct) => setUploadPct(pct),
      );
      onUploaded(response, oldPdf!, newPdf!);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 rounded-2xl border border-blue-200/60 dark:border-blue-500/15 bg-white/90 dark:bg-[rgba(11,26,46,0.8)] backdrop-blur-md shadow-xl">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Upload Files</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Upload your OLD PDF, NEW PDF, and pre-chunked XML files to begin the comparison.
        </p>
      </div>

      {/* Source name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Project / Source Name</label>
        <input
          type="text"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="e.g. LegalDoc_v2_Update"
          className="w-full px-3 py-2 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 border border-blue-200 dark:border-blue-500/20 bg-blue-50/40 dark:bg-blue-500/[.06] outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-colors"
        />
      </div>

      {/* File drop zones */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DropZone
          label="Old PDF"
          accept=".pdf"
          file={oldPdf}
          onFile={setOldPdf}
          color="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <DropZone
          label="New PDF"
          accept=".pdf"
          file={newPdf}
          onFile={setNewPdf}
          color="violet"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <MultiDropZone
          label="XML Chunks"
          accept=".xml"
          files={xmlFiles}
          onFiles={setXmlFiles}
          color="emerald"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          }
        />
      </div>

      {/* Upload progress */}
      {uploading && (
        <ProgressBar value={uploadPct} label="Uploading files…" />
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25 text-red-600 dark:text-red-300 text-xs">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleUpload}
        disabled={!canUpload || uploading}
        className={`w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
          canUpload && !uploading
            ? "bg-gradient-to-br from-[#1a8fd1] to-[#146da3] shadow-[0_4px_16px_rgba(26,143,209,0.3)] hover:shadow-[0_4px_20px_rgba(26,143,209,0.45)]"
            : "bg-[#1a8fd1]/20"
        }`}
      >
        {uploading ? "Uploading…" : "Upload & Continue"}
      </button>
    </div>
  );
}
