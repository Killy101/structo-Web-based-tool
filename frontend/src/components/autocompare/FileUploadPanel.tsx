"use client";
/**
 * FileUploadPanel v3
 * • Auto-detects source name from the uploaded PDF filename
 * • Dark/light mode via the same ThemContext the Sidebar uses
 * • All dynamic colours use inline style props — no template-literal-in-className bugs
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemContext";
import { uploadFiles } from "./api";
import type { UploadResponse } from "./types";

// ── Slot colour palette ───────────────────────────────────────────────────────

const SLOT = {
  blue: {
    ring:     "#3b82f6",
    iconBg:   "rgba(59,130,246,0.15)",
    iconTxt:  "#60a5fa",
    activeBg: "rgba(59,130,246,0.08)",
    fileTxt:  "#60a5fa",
  },
  violet: {
    ring:     "#8b5cf6",
    iconBg:   "rgba(139,92,246,0.15)",
    iconTxt:  "#a78bfa",
    activeBg: "rgba(139,92,246,0.08)",
    fileTxt:  "#a78bfa",
  },
  emerald: {
    ring:     "#10b981",
    iconBg:   "rgba(16,185,129,0.15)",
    iconTxt:  "#34d399",
    activeBg: "rgba(16,185,129,0.08)",
    fileTxt:  "#34d399",
  },
} as const;
type SlotColor = keyof typeof SLOT;

// ── Single-file drop zone ─────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
  icon: React.ReactNode;
  color: SlotColor;
  dark: boolean;
}

function DropZone({ label, accept, file, onFile, icon, color, dark }: DropZoneProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const C = SLOT[color];

  const fmt = (n: number) =>
    n < 1024 ? `${n} B` :
    n < 1048576 ? `${(n / 1024).toFixed(1)} KB` :
    `${(n / 1048576).toFixed(1)} MB`;

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  const borderColor = over || file ? C.ring : dark ? "rgba(255,255,255,0.14)" : "#d1d5db";
  const bg          = over || file ? C.activeBg : dark ? "rgba(255,255,255,0.02)" : "#f9fafb";

  return (
    <div
      className="relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 cursor-pointer transition-all duration-150"
      style={{ borderColor, background: bg }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center"
        style={{ background: C.iconBg, color: C.iconTxt }}
      >
        {icon}
      </div>

      <p className="text-xs font-semibold text-center"
        style={{ color: dark ? "#cbd5e1" : "#374151" }}>
        {label}
      </p>

      {file ? (
        <div className="text-center">
          <p className="text-xs font-medium truncate max-w-[140px]"
            style={{ color: C.fileTxt }}>
            {file.name}
          </p>
          <p className="text-[10px] mt-0.5"
            style={{ color: dark ? "#64748b" : "#9ca3af" }}>
            {fmt(file.size)}
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-center"
          style={{ color: dark ? "#64748b" : "#9ca3af" }}>
          Drag & drop or click to browse
        </p>
      )}

      {file && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: C.ring }}
        >
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
          </svg>
        </div>
      )}
    </div>
  );
}

// ── Multi-file drop zone ──────────────────────────────────────────────────────

interface MultiDropZoneProps {
  label: string;
  accept: string;
  files: File[];
  onFiles: (f: File[]) => void;
  icon: React.ReactNode;
  color: SlotColor;
  dark: boolean;
}

function MultiDropZone({ label, accept, files, onFiles, icon, color, dark }: MultiDropZoneProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const C = SLOT[color];

  const fmt = (n: number) =>
    n < 1024 ? `${n} B` :
    n < 1048576 ? `${(n / 1024).toFixed(1)} KB` :
    `${(n / 1048576).toFixed(1)} MB`;

  const total = files.reduce((s, f) => s + f.size, 0);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith(".xml")
    );
    if (dropped.length > 0) onFiles(dropped);
  }, [onFiles]);

  const borderColor = over || files.length > 0 ? C.ring : dark ? "rgba(255,255,255,0.14)" : "#d1d5db";
  const bg          = over || files.length > 0 ? C.activeBg : dark ? "rgba(255,255,255,0.02)" : "#f9fafb";

  return (
    <div
      className="relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 cursor-pointer transition-all duration-150"
      style={{ borderColor, background: bg }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref} type="file" accept={accept} multiple className="hidden"
        onChange={(e) => {
          const sel = Array.from(e.target.files ?? []);
          if (sel.length > 0) onFiles(sel);
        }}
      />

      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center"
        style={{ background: C.iconBg, color: C.iconTxt }}
      >
        {icon}
      </div>

      <p className="text-xs font-semibold text-center"
        style={{ color: dark ? "#cbd5e1" : "#374151" }}>
        {label}
      </p>

      {files.length > 0 ? (
        <div className="text-center">
          <p className="text-xs font-medium"
            style={{ color: C.fileTxt }}>
            {files.length} file{files.length > 1 ? "s" : ""} selected
          </p>
          <p className="text-[10px] mt-0.5"
            style={{ color: dark ? "#64748b" : "#9ca3af" }}>
            {fmt(total)}
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-center"
          style={{ color: dark ? "#64748b" : "#9ca3af" }}>
          Drag & drop or click to select multiple files
        </p>
      )}

      {files.length > 0 && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: C.ring }}
        >
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
          </svg>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileUploadPanelProps {
  onUploaded: (response: UploadResponse, oldPdf: File, newPdf: File) => void;
}

export default function FileUploadPanel({ onUploaded }: FileUploadPanelProps) {
  const { dark } = useTheme();

  const [oldPdf,     setOldPdf]     = useState<File | null>(null);
  const [newPdf,     setNewPdf]     = useState<File | null>(null);
  const [xmlFiles,   setXmlFiles]   = useState<File[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [uploading,  setUploading]  = useState(false);
  const [uploadPct,  setUploadPct]  = useState(0);
  const [error,      setError]      = useState<string | null>(null);

  const canUpload = !!(oldPdf && newPdf && xmlFiles.length > 0 && sourceName.trim());

  // Auto-fill source name from PDF filename when Old PDF is selected
  useEffect(() => {
    if (oldPdf && !sourceName) {
      const stem = oldPdf.name
        .replace(/\.pdf$/i, "")
        .replace(/[_\-]+/g, " ")
        .trim();
      setSourceName(stem);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldPdf]);

  const handleUpload = async () => {
    if (!canUpload) return;
    setError(null);
    setUploading(true);
    setUploadPct(0);
    try {
      const response = await uploadFiles(
        oldPdf!, newPdf!, xmlFiles, sourceName.trim(),
        (pct) => setUploadPct(pct),
      );
      onUploaded(response, oldPdf!, newPdf!);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Theme tokens — all colours computed once, passed via style={}
  const cardBg    = dark ? "rgba(11,26,46,0.95)"       : "#ffffff";
  const cardBdr   = dark ? "rgba(26,143,209,0.18)"     : "#e2e8ef";
  const titleClr  = dark ? "#ffffff"                   : "#111827";
  const subClr    = dark ? "#94a3b8"                   : "#6b7280";
  const labelClr  = dark ? "#cbd5e1"                   : "#374151";
  const inputBg   = dark ? "rgba(26,143,209,0.06)"     : "#f9fafb";
  const inputBdr  = dark ? "rgba(26,143,209,0.2)"      : "#d1d5db";
  const inputClr  = dark ? "#ffffff"                   : "#111827";
  const trackBg   = dark ? "#1e293b"                   : "#e5e7eb";

  return (
    <div
      className="flex flex-col gap-6 p-6 rounded-2xl border shadow-sm"
      style={{ background: cardBg, borderColor: cardBdr }}
    >
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold" style={{ color: titleClr }}>
          Upload Files
        </h2>
        <p className="text-xs mt-0.5" style={{ color: subClr }}>
          Upload your OLD PDF, NEW PDF, and XML file(s).
          Large XMLs are automatically chunked by section on the server.
        </p>
      </div>

      {/* Source name — auto-filled from PDF filename */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{ color: labelClr }}>
          Project / Source Name
        </label>
        <input
          type="text"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="Auto-detected from PDF filename"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors border"
          style={{ background: inputBg, borderColor: inputBdr, color: inputClr }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(26,143,209,0.5)")}
          onBlur={(e)  => (e.target.style.borderColor = inputBdr)}
        />
      </div>

      {/* Drop zones */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DropZone
          label="Old PDF" accept=".pdf" file={oldPdf} onFile={setOldPdf}
          color="blue" dark={dark}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          }
        />
        <DropZone
          label="New PDF" accept=".pdf" file={newPdf} onFile={setNewPdf}
          color="violet" dark={dark}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          }
        />
        <MultiDropZone
          label="XML File(s)" accept=".xml" files={xmlFiles} onFiles={setXmlFiles}
          color="emerald" dark={dark}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
          }
        />
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span style={{ color: subClr }}>Uploading files…</span>
            <span className="font-semibold" style={{ color: "#1a8fd1" }}>{uploadPct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: trackBg }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${uploadPct}%`,
                background: "linear-gradient(90deg,#1a8fd1,#42b4f5)",
                boxShadow: uploadPct > 0 ? "0 0 8px rgba(26,143,209,0.5)" : "none",
              }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs"
          style={{
            background:  "rgba(239,68,68,0.08)",
            borderColor: "rgba(239,68,68,0.25)",
            color:       dark ? "#fca5a5" : "#b91c1c",
          }}
        >
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleUpload}
        disabled={!canUpload || uploading}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        style={canUpload && !uploading ? {
          background: "linear-gradient(135deg,#1a8fd1,#146da3)",
          boxShadow:  "0 4px 16px rgba(26,143,209,0.3)",
        } : {
          background: "rgba(26,143,209,0.2)",
        }}
      >
        {uploading ? "Uploading…" : "Upload & Continue"}
      </button>
    </div>
  );
}