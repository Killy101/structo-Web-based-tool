import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui";
import { mergeWithPreservedSections, validateMetajsonSchema } from "@/lib/metajsonValidation";
import { copyToClipboard } from "@/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface SimpleMetajsonProps {
  open: boolean;
  onClose: () => void;
  metajson: Record<string, unknown> | null;
  filename?: string;
  onDownload?: (json: Record<string, unknown>, filename: string) => void;
  onSave?: (json: Record<string, unknown>) => void;
}

interface ParseError {
  message: string;
  line: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const MONO = { fontFamily: "'DM Mono', monospace" } as const;
const LINE_HEIGHT = 20;

function tryParseJson(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: ParseError } {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      return { ok: false, error: { message: "Root value must be a JSON object", line: 1 } };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    const errorLine = extractErrorLine(raw, msg);
    return { ok: false, error: { message: msg, line: errorLine } };
  }
}

function extractErrorLine(raw: string, message: string): number | null {
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumnMatch?.[1]) return parseInt(lineColumnMatch[1], 10);
  const lineOnlyMatch = message.match(/line\s+(\d+)/i);
  if (lineOnlyMatch?.[1]) return parseInt(lineOnlyMatch[1], 10);
  const positionMatch = message.match(/position\s+(\d+)/i);
  if (positionMatch?.[1]) {
    const pos = parseInt(positionMatch[1], 10);
    if (!isNaN(pos)) return raw.slice(0, pos).split("\n").length;
  }
  return guessErrorLine(raw);
}

function guessErrorLine(raw: string): number | null {
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    if (!current) continue;
    if (/,$/.test(current)) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next) continue;
        if (/^[}\]]/.test(next)) return i + 1;
        break;
      }
    }
    const quoteCount = (current.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) return i + 1;
  }
  let running = "";
  for (let i = 0; i < lines.length; i++) {
    running += (i > 0 ? "\n" : "") + lines[i];
    try { JSON.parse(running); } catch { if (i > 0) return i + 1; }
  }
  return null;
}

function formatJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2);
}

function highlightJson(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^"\\])*"(?:\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = "smj-number";
        if (/^"/.test(match)) cls = /:$/.test(match) ? "smj-key" : "smj-string";
        else if (/true|false/.test(match)) cls = "smj-bool";
        else if (/null/.test(match)) cls = "smj-null";
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

const STRIPPED_KEYS = new Set(["levelPatterns", "pathTransform"]);

function stripLevelPatterns(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLevelPatterns);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, val]) => {
      if (STRIPPED_KEYS.has(key)) return;
      next[key] = stripLevelPatterns(val);
    });
    return next;
  }
  return value;
}

function sanitizeSimpleMetajson(obj: Record<string, unknown>): Record<string, unknown> {
  return stripLevelPatterns(obj) as Record<string, unknown>;
}

// ── Copy Button ────────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <Button
      onClick={handleCopy}
      variant="secondary"
      size="xs"
      className={`text-[10.5px] font-mono ${
        copied
          ? "!bg-emerald-50 dark:!bg-emerald-500/10 !border-emerald-300 dark:!border-emerald-700/50 !text-emerald-700 dark:!text-emerald-400"
          : ""
      }`}
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </Button>
  );
}

// ── SimpleMetajson Modal ───────────────────────────────────────────────────────
export default function SimpleMetajson({
  open,
  onClose,
  metajson,
  filename = "meta.json",
  onDownload,
  onSave,
}: SimpleMetajsonProps) {
  const [editMode, setEditMode]     = useState(false);
  const [raw, setRaw]               = useState("");
  const [parseError, setParseError] = useState<ParseError | null>(null);
  const [liveJson, setLiveJson]     = useState<Record<string, unknown> | null>(null);
  const [validated, setValidated]   = useState<boolean | null>(null);
  const [scrollTop, setScrollTop]   = useState(0);
  const [savedJson, setSavedJson]   = useState<Record<string, unknown> | null>(null);
  const [saveFlash, setSaveFlash]   = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef  = useRef<HTMLDivElement>(null);

  // Sync incoming metajson → local state
  useEffect(() => {
    if (!metajson) return;

    let cancelled = false;
    const sanitized = sanitizeSimpleMetajson(metajson);
    const formatted = formatJson(sanitized);

    queueMicrotask(() => {
      if (cancelled) return;
      setRaw(formatted);
      setLiveJson(sanitized);
      setParseError(null);
      setValidated(null);
      setScrollTop(0);
      setSavedJson(null);
    });

    return () => {
      cancelled = true;
    };
  }, [metajson]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    let cancelled = false;

    if (editMode && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(0, 0);
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setValidated(null);
      setScrollTop(0);
    });

    return () => {
      cancelled = true;
    };
  }, [editMode]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Auto-scroll to error line
  useEffect(() => {
    let rafId: number | null = null;

    if (validated === false && parseError?.line && textareaRef.current) {
      const targetScrollTop = Math.max(0, (parseError.line - 4) * LINE_HEIGHT);
      textareaRef.current.scrollTop = targetScrollTop;

      rafId = requestAnimationFrame(() => {
        setScrollTop(targetScrollTop);
      });
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [validated, parseError]);

  const handleRawChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setRaw(value);
    setValidated(null);
    const result = tryParseJson(value);
    if (result.ok) {
      setLiveJson(sanitizeSimpleMetajson(result.value));
      setParseError(null);
    } else {
      setLiveJson(null);
      setParseError(result.error);
    }
  }, []);

  const handleTextareaScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  function handleValidate() {
    const result = tryParseJson(raw);
    if (result.ok) {
      const sanitized = sanitizeSimpleMetajson(result.value);
      const validation = validateMetajsonSchema(sanitized, { requireTransforms: false });
      if (!validation.valid) {
        setLiveJson(null);
        setParseError({ message: validation.errors[0] || "Metajson structure is invalid", line: null });
        setValidated(false);
        return;
      }
      setLiveJson(sanitized);
      setParseError(null);
      setValidated(true);
    } else {
      setLiveJson(null);
      setParseError(result.error);
      setValidated(false);
    }
  }

  function handleFormat() {
    if (!liveJson) return;
    setRaw(formatJson(liveJson));
    setValidated(null);
  }

  function handleSave() {
    const json = liveJson ?? (metajson ? sanitizeSimpleMetajson(metajson) : null);
    if (!json || parseError) return;

    const merged = mergeWithPreservedSections(json, metajson);
    const validation = validateMetajsonSchema(merged, { requireTransforms: !!(metajson?.levelPatterns || metajson?.pathTransform) });
    if (!validation.valid) {
      setParseError({ message: validation.errors[0] || "Metajson structure is invalid", line: null });
      setValidated(false);
      return;
    }

    setSavedJson(json);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 2000);
    setValidated(true);
    if (onSave) onSave(merged);
  }

  function handleDownload() {
    const json = liveJson ?? (metajson ? sanitizeSimpleMetajson(metajson) : null);
    if (!json) return;

    const merged = mergeWithPreservedSections(json, metajson);
    if (onDownload) { onDownload(merged, filename); return; }
    const blob = new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  const displayJson = savedJson ?? liveJson ?? metajson;
  const rawLines    = raw.split("\n");
  const lineCount   = rawLines.length;
  const errorLine   = parseError?.line ?? null;
  const hasUnsavedChanges = !!liveJson && liveJson !== savedJson && !parseError;

  return (
    <>
      <style>{`
        .smj-key    { color:#4f46e5 }  .smj-string { color:#059669 }
        .smj-number { color:#d97706 }  .smj-bool   { color:#2563eb;font-weight:600 }
        .smj-null   { color:#db2777;font-weight:600 }
        .dark .smj-key    { color:#a5b4fc } .dark .smj-string { color:#6ee7b7 }
        .dark .smj-number { color:#fdba74 } .dark .smj-bool   { color:#93c5fd }
        .dark .smj-null   { color:#f9a8d4 }
        .smj-scrollbar::-webkit-scrollbar { width:10px; height:10px; }
        .smj-scrollbar::-webkit-scrollbar-track { background:#f1f5f9; border-radius:999px; }
        .smj-scrollbar::-webkit-scrollbar-thumb { border-radius:999px; background:#94a3b8; border:2px solid #f1f5f9; }
        .smj-scrollbar::-webkit-scrollbar-thumb:hover { background:#64748b; }
        .dark .smj-scrollbar::-webkit-scrollbar-track { background:#1e2235; }
        .dark .smj-scrollbar::-webkit-scrollbar-thumb { background:#475569; border-color:#1e2235; }
        .dark .smj-scrollbar::-webkit-scrollbar-thumb:hover { background:#64748b; }
        .smj-scrollbar { scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9; }
        .dark .smj-scrollbar { scrollbar-color: #475569 #1e2235; }
      `}</style>

      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6"
        style={{ background: "rgba(15,20,40,0.7)", backdropFilter: "blur(4px)" }}
      >
        {/* Modal */}
        <div
          className="w-full max-w-4xl rounded-2xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] shadow-2xl shadow-black/40"
          style={{ maxHeight: "calc(100vh - 48px)", minHeight: 400, display: "flex", flexDirection: "column", overflow: "hidden" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#181d30] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-700/40 flex-shrink-0">
                <span className="text-indigo-600 dark:text-indigo-400">≡</span>
              </div>
              <div className="min-w-0">
                <p className="text-[11.5px] font-bold text-slate-800 dark:text-slate-200 leading-tight truncate" style={MONO}>
                  Metajson Preview
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-600 truncate" style={MONO}>
                  {filename}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {parseError && editMode && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-700/40" style={MONO}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {errorLine ? `Line ${errorLine}` : "Parse error"}
                </span>
              )}

              {editMode && (
                <button
                  onClick={handleFormat}
                  disabled={!!parseError}
                  title="Format / Prettify JSON"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2e3a55] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={MONO}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h10M4 14h16M4 18h10" />
                  </svg>
                  Format
                </button>
              )}

              {editMode && (
                <button
                  onClick={handleValidate}
                  title="Validate JSON"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all ${
                    validated === true
                      ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-400"
                      : validated === false
                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-700/40 text-rose-600 dark:text-rose-400"
                      : "bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2e3a55]"
                  }`}
                  style={MONO}
                >
                  {validated === true ? (
                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Valid</>
                  ) : validated === false ? (
                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>Invalid</>
                  ) : (
                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Validate</>
                  )}
                </button>
              )}

              {editMode && (
                <button
                  onClick={handleSave}
                  disabled={!!parseError || !hasUnsavedChanges}
                  title="Save changes"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    saveFlash
                      ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-400"
                      : "bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2e3a55]"
                  }`}
                  style={MONO}
                >
                  {saveFlash ? (
                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved</>
                  ) : (
                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>
                  )}
                </button>
              )}

              <CopyButton text={raw} />

              <button
                onClick={handleDownload}
                disabled={!!parseError && editMode}
                title="Download JSON file"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 border-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={MONO}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </button>

              <button
                onClick={onClose}
                title="Close"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-[#2a3147] hover:text-slate-700 dark:hover:text-slate-300 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex flex-shrink-0 border-b border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#161b2e]">
            <button
              className={`px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] border-b-2 transition-all ${
                !editMode
                  ? "text-indigo-600 dark:text-indigo-400 border-indigo-600 dark:border-indigo-400"
                  : "text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400"
              }`}
              style={MONO}
              onClick={() => setEditMode(false)}
            >
              Preview
            </button>
            <button
              className={`px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] border-b-2 transition-all ${
                editMode
                  ? "text-indigo-600 dark:text-indigo-400 border-indigo-600 dark:border-indigo-400"
                  : "text-slate-400 dark:text-slate-600 border-transparent hover:text-slate-600 dark:hover:text-slate-400"
              }`}
              style={MONO}
              onClick={() => setEditMode(true)}
            >
              Edit
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-3 px-4 text-[10px] text-slate-400 dark:text-slate-600" style={MONO}>
              {displayJson && <span>{Object.keys(displayJson).length} keys</span>}
              <span>{lineCount} lines</span>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: "#ffffff" }} className="dark:bg-[#161b2e]">

            {/* PREVIEW TAB */}
            {!editMode && (
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "40px 1fr", overflowY: "scroll", overflowX: "auto" }} className="smj-scrollbar">
                <div style={{ background: "#f8fafc", borderRight: "1px solid #e2e8f0", paddingTop: 14, paddingBottom: 14, userSelect: "none" }} className="dark:bg-[#161b2e] dark:border-[#2a3147]">
                  {formatJson(displayJson ?? {}).split("\n").map((_, i) => (
                    <div key={i} style={{ ...MONO, height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px`, paddingRight: 8, fontSize: 11, color: "#94a3b8", textAlign: "right" }}>
                      {i + 1}
                    </div>
                  ))}
                </div>
                <pre style={{ margin: 0, padding: "14px 16px", fontSize: 12, lineHeight: `${LINE_HEIGHT}px`, color: "#1e293b", whiteSpace: "pre", ...MONO }} className="dark:text-slate-200">
                  <span dangerouslySetInnerHTML={{ __html: highlightJson(formatJson(displayJson ?? {})) }} />
                </pre>
              </div>
            )}

            {/* EDIT TAB */}
            {editMode && (
              <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {/* Line numbers */}
                <div style={{ width: 40, flexShrink: 0, overflow: "hidden", background: "#f8fafc", borderRight: "1px solid #e2e8f0", userSelect: "none" }} className="dark:bg-[#161b2e] dark:border-[#2a3147]">
                  <div style={{ transform: `translateY(-${scrollTop}px)`, paddingTop: 14, paddingBottom: 14 }}>
                    {rawLines.map((_, i) => {
                      const lineNum = i + 1;
                      const isError = validated === false && errorLine === lineNum;
                      return (
                        <div
                          key={lineNum}
                          style={{ ...MONO, height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px`, textAlign: "right", paddingRight: 8, fontSize: 11, color: isError ? "#f43f5e" : "#94a3b8", fontWeight: isError ? 700 : 400, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}
                        >
                          {isError && <svg width="8" height="8" viewBox="0 0 8 8" fill="#f43f5e"><circle cx="4" cy="4" r="4"/></svg>}
                          {lineNum}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "14px 16px",
                    fontSize: 12,
                    lineHeight: `${LINE_HEIGHT}px`,
                    fontFamily: "'DM Mono', monospace",
                    color: "#1e293b",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    overflowY: "scroll",
                    overflowX: "auto",
                    boxSizing: "border-box",
                    caretColor: "#6366f1",
                    display: "block",
                  }}
                  value={raw}
                  onChange={handleRawChange}
                  onScroll={handleTextareaScroll}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  data-gramm="false"
                  wrap="off"
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#181d30] flex-shrink-0">
            {parseError && editMode && validated === false ? (
              <div className="flex items-center gap-2 text-[10.5px] text-rose-600 dark:text-rose-400 min-w-0 flex-1" style={MONO}>
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate">{errorLine ? `Line ${errorLine}: ` : ""}{parseError.message}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10.5px] text-slate-400 dark:text-slate-600" style={MONO}>
                {editMode && validated === true ? (
                  <>
                    <svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-emerald-600 dark:text-emerald-400">Valid metajson</span>
                  </>
                ) : editMode ? (
                  savedJson
                    ? <><svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg><span className="text-emerald-600 dark:text-emerald-400">Saved</span></>
                    : hasUnsavedChanges
                      ? <span className="text-amber-500 dark:text-amber-400">Unsaved changes — click Save to keep edits</span>
                      : <span>Click Validate to check for errors</span>
                ) : (
                  <span>Read-only preview — switch to Edit tab to modify</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-shrink-0">
              {editMode && (
                <button
                  onClick={() => {
                    const base = savedJson ?? (metajson ? sanitizeSimpleMetajson(metajson) : null);
                    if (base) {
                      setRaw(formatJson(base as Record<string, unknown>));
                      setLiveJson(base as Record<string, unknown>);
                      setParseError(null);
                      setValidated(null);
                      setScrollTop(0);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#2e3a55]"
                  style={MONO}
                >
                  Reset
                </button>
              )}
              <button
                onClick={onClose}
                className="inline-flex items-center px-3 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2e3a55]"
                style={MONO}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}