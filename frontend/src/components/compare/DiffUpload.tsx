"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { XmlSection } from "./types";
import { parseXmlSectionsLocal } from "./api";

interface Props {
  fileA: File | null;
  fileB: File | null;
  xmlFile?: File | null;
  onFileA: (f: File) => void;
  onFileB: (f: File) => void;
  onXmlFile?: (f: File) => void;
  onRun: () => void;
  loading: boolean;
  loadingMsg: string;
  loadingPct: number;
  error: string | null;
  xmlSections?: XmlSection[];
  onSectionsLoaded?: (sections: XmlSection[]) => void;
  onAllSectionsLoaded?: (sections: XmlSection[]) => void;
  skipChunking?: boolean;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
}

/* ─── Accent palette ────────────────────────────────────────────────────── */
const ACCENT = {
  rose: {
    bg: "bg-rose-50 dark:bg-rose-500/5",
    border: "border-rose-300 dark:border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
    iconBg: "bg-rose-100 dark:bg-rose-500/15",
  },
  emerald: {
    bg: "bg-emerald-50 dark:bg-emerald-500/5",
    border: "border-emerald-300 dark:border-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-100 dark:bg-emerald-500/15",
  },
  amber: {
    bg: "bg-amber-50 dark:bg-amber-500/5",
    border: "border-amber-300 dark:border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-100 dark:bg-amber-500/15",
  },
} as const;

/* ─── Reusable drop zone ────────────────────────────────────────────────── */
function DropZone({
  label,
  hint,
  file,
  onFile,
  accept,
  accent,
  icon,
}: {
  label: string;
  hint: string;
  file: File | null;
  onFile: (f: File) => void;
  accept: string;
  accent: (typeof ACCENT)[keyof typeof ACCENT];
  icon: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const sizeLabel = file
    ? file.size >= 1048576
      ? `${(file.size / 1048576).toFixed(1)} MB`
      : `${(file.size / 1024).toFixed(0)} KB`
    : "";

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-xl border-2 transition-all duration-200
        cursor-pointer select-none group min-h-[7.5rem]
        ${file
          ? `${accent.border} ${accent.bg}`
          : drag
            ? "border-blue-400 dark:border-blue-400/60 bg-blue-50/50 dark:bg-blue-500/5 scale-[1.02]"
            : "border-dashed border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-slate-50/40 dark:bg-white/[0.015]"
        }`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />

      {file ? (
        <>
          <div className={`w-10 h-10 rounded-xl ${accent.iconBg} flex items-center justify-center mb-2`}>
            <svg className={`w-5 h-5 ${accent.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className={`text-xs font-semibold ${accent.text} truncate max-w-[90%] text-center`}>
            {file.name}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{sizeLabel}</p>
        </>
      ) : (
        <>
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-2
            group-hover:bg-slate-200/70 dark:group-hover:bg-white/8 transition-colors duration-200">
            {icon}
          </div>
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>
        </>
      )}
    </div>
  );
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */
const CloudUploadIcon = (
  <svg className="w-5 h-5 text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);
const CodeBrackets = (
  <svg className="w-5 h-5 text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
);

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function DiffUpload({
  fileA, fileB, xmlFile, onFileA, onFileB, onXmlFile, onRun, loading, loadingMsg, loadingPct, error,
  xmlSections, onSectionsLoaded, onAllSectionsLoaded, skipChunking, title, subtitle, onBack,
}: Props) {
  const [allSections, setAllSections] = useState<XmlSection[]>([]);
  const [chosenLevel, setChosenLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!xmlFile || !onSectionsLoaded) return;
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (cancelled) return;
      const text = e.target?.result as string;
      const sections = parseXmlSectionsLocal(text);
      setAllSections(sections);
      setChosenLevel(null);
      onAllSectionsLoaded?.(sections);
    };
    reader.readAsText(xmlFile);
    return () => { cancelled = true; };
  }, [xmlFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const distinctLevels = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of allSections) {
      if (!map.has(s.level)) {
        const first = s.label.split(/\s+/)[0];
        map.set(s.level, first);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, hint]) => ({ level, hint, count: allSections.filter((s) => s.level === level).length }));
  }, [allSections]);

  const pickLevel = (lvl: number) => {
    setChosenLevel(lvl);
    const filtered = allSections.filter((s) => s.level === lvl);
    onSectionsLoaded?.(filtered);
  };

  const ready = !!(fileA && fileB) && (!xmlFile || skipChunking || chosenLevel !== null);
  const hasBothPdfs = !!(fileA && fileB);

  const headingTitle = title ?? (onXmlFile ? (skipChunking ? "Compare & Apply" : "Chunk & Compare") : "Direct Compare");
  const headingSub = subtitle ?? (onXmlFile
    ? (skipChunking ? "Upload PDFs and XML to compare and apply changes" : "Upload PDFs and XML to chunk and compare by section")
    : "Upload two PDFs for side-by-side comparison");

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto px-4 py-8">
      <div className="w-full max-w-lg space-y-5">

        {/* ── Back button ────────────────────────────────────────────── */}
        {onBack && (
          <div className="flex justify-start -mb-2">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400
                hover:text-slate-700 dark:hover:text-slate-200 transition-colors group"
            >
              <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              All Workflows
            </button>
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">{headingTitle}</h2>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">{headingSub}</p>
        </div>

        {/* ── Step 1 · PDF Files ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200/80 dark:border-white/8
          bg-white dark:bg-white/[0.025] shadow-sm dark:shadow-none p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-5 h-5 rounded-md bg-teal-500/10 dark:bg-teal-500/15
              text-teal-600 dark:text-teal-400 text-[10px] font-bold flex items-center justify-center">
              1
            </span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
              PDF Documents
            </span>
            {hasBothPdfs && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium
                text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-500/10 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Ready
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">
                Old Version
              </p>
              <DropZone label="Old PDF" hint="Drop or click to browse" file={fileA} onFile={onFileA}
                accept=".pdf" accent={ACCENT.rose} icon={CloudUploadIcon} />
            </div>
            <div>
              <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">
                New Version
              </p>
              <DropZone label="New PDF" hint="Drop or click to browse" file={fileB} onFile={onFileB}
                accept=".pdf" accent={ACCENT.emerald} icon={CloudUploadIcon} />
            </div>
          </div>
        </section>

        {/* ── Step 2 · XML File ───────────────────────────────────────────── */}
        {onXmlFile && (
          <section className="rounded-2xl border border-slate-200/80 dark:border-white/8
            bg-white dark:bg-white/[0.025] shadow-sm dark:shadow-none p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-5 h-5 rounded-md bg-amber-500/10 dark:bg-amber-500/15
                text-amber-600 dark:text-amber-400 text-[10px] font-bold flex items-center justify-center">
                2
              </span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                XML Source (Old / Reference)
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-white/5
                px-1.5 py-0.5 rounded font-normal normal-case">
                optional
              </span>
              {xmlFile && (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium
                  text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Loaded
                </span>
              )}
            </div>

            <DropZone label="XML File" hint="Drop or click to browse" file={xmlFile ?? null}
              onFile={onXmlFile} accept=".xml" accent={ACCENT.amber} icon={CodeBrackets} />

            {/* ── Level picker chips ───────────────────────────────────────── */}
            {!skipChunking && allSections.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 mb-2.5">
                  <svg className="w-3.5 h-3.5 text-amber-500/70 dark:text-amber-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Chunk Level
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {distinctLevels.map(({ level, hint, count }) => {
                    const active = chosenLevel === level;
                    return (
                      <button
                        key={level}
                        onClick={(e) => { e.stopPropagation(); pickLevel(level); }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-150
                          ${active
                            ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-400/40 shadow-sm"
                            : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                          }`}
                      >
                        {hint}
                        <span className={`text-[9px] tabular-nums ${active ? "text-amber-500 dark:text-amber-400/70" : "text-slate-400 dark:text-slate-500"}`}>
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {chosenLevel !== null && xmlSections && xmlSections.length > 0 && (
                  <div className="mt-2.5 max-h-32 overflow-y-auto rounded-xl bg-slate-50 dark:bg-white/[0.02]
                    border border-slate-100 dark:border-white/5">
                    {xmlSections.map((s, i) => (
                      <div key={s.id}
                        className="flex items-center gap-2 px-3 py-1.5 text-[10px]
                          border-b border-slate-100/80 dark:border-white/3 last:border-0">
                        <span className="text-slate-400 dark:text-slate-500 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                        <span className="text-slate-600 dark:text-slate-300 truncate">{s.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-500/25
            bg-rose-50 dark:bg-rose-500/8 px-4 py-3">
            <svg className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-rose-700 dark:text-rose-300 font-medium break-all">{error}</p>
          </div>
        )}

        {/* ── Action ─────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="rounded-2xl border border-teal-200 dark:border-teal-500/20
            bg-teal-50 dark:bg-teal-500/5 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">{loadingMsg}</span>
              <span className="text-sm font-bold text-teal-600 dark:text-teal-400 tabular-nums">{loadingPct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-teal-100 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 transition-all duration-500 ease-out
                  shadow-[0_0_8px_rgba(20,184,166,0.4)]"
                style={{ width: `${loadingPct}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            disabled={!ready}
            onClick={onRun}
            className={`w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold transition-all duration-200
              ${ready
                ? "bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-lg shadow-teal-500/25 hover:shadow-teal-500/35 active:scale-[0.98]"
                : "bg-slate-100 dark:bg-white/[0.04] text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-white/8"
              }`}
          >
            {ready ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
            Run Diff
          </button>
        )}
      </div>
    </div>
  );
}