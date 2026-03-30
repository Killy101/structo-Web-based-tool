import React, { useState, useEffect, useRef, useCallback } from "react";

interface InnodMetajsonProps {
  open: boolean;
  onClose: () => void;
  metajson: Record<string, unknown> | null;
  filename?: string;
  onDownload?: (json: Record<string, unknown>, filename: string) => void;
  onSave?: (json: Record<string, unknown>) => void;
}

const MONO = { fontFamily: "'DM Mono', monospace" } as const;
const LINE_HEIGHT = 20;

function tryParseJson(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      return { ok: false, error: "Root value must be a JSON object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

function formatJson(obj: Record<string, unknown>): string {
  const INDENT = "  ";

  const isPatternRow = (value: unknown): value is [string, string, number, string] => {
    return (
      Array.isArray(value) &&
      value.length === 4 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      typeof value[2] === "number" &&
      typeof value[3] === "string"
    );
  };

  // Compact inline array: all items are short strings (level numbers like "2","3",...)
  const isCompactStringArray = (value: unknown): value is string[] => {
    return (
      Array.isArray(value) &&
      value.every((v) => typeof v === "string" && v.length <= 4)
    );
  };

  const print = (value: unknown, depth: number): string => {
    const pad = INDENT.repeat(depth);
    const nextPad = INDENT.repeat(depth + 1);

    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      if (isPatternRow(value)) {
        return `[${JSON.stringify(value[0])}, ${JSON.stringify(value[1])}, ${value[2]}, ${JSON.stringify(value[3])}]`;
      }
      if (value.length === 0) return "[]";
      if (isCompactStringArray(value)) {
        return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      }
      return `[
${value.map((item) => `${nextPad}${print(item, depth + 1)}`).join(",\n")}
${pad}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{
${entries
  .map(([k, v]) => `${nextPad}${JSON.stringify(k)}: ${print(v, depth + 1)}`)
  .join(",\n")}
${pad}}`;
  };

  return print(obj, 0);
}

function highlightJson(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^"\\])*"(?:\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = "inj-number";
        if (/^"/.test(match)) cls = /:$/.test(match) ? "inj-key" : "inj-string";
        else if (/true|false/.test(match)) cls = "inj-bool";
        else if (/null/.test(match)) cls = "inj-null";
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all ${
        copied
          ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-400"
          : "bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2e3a55]"
      }`}
      style={MONO}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function InnodMetajson({
  open,
  onClose,
  metajson,
  filename = "innod_metajson.json",
  onDownload,
  onSave,
}: InnodMetajsonProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "edit">("edit");
  const [raw, setRaw] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [liveJson, setLiveJson] = useState<Record<string, unknown> | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [savedJson, setSavedJson] = useState<Record<string, unknown> | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const nextRaw = metajson ? formatJson(metajson) : "{}";
    const nextLiveJson = metajson ?? null;

    // Defer local state sync so the effect does not synchronously trigger cascading renders.
    queueMicrotask(() => {
      if (cancelled) return;
      setRaw(nextRaw);
      setLiveJson(nextLiveJson);
      setParseError(null);
      setSavedJson(null);
    });

    return () => {
      cancelled = true;
    };
  }, [open, metajson]);

  // Focus textarea when switching to edit tab
  useEffect(() => {
    if (!open || activeTab !== "edit") return;
    const id = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, activeTab]);

  const handleRawChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setRaw(value);
    const result = tryParseJson(value);
    if (result.ok) {
      setLiveJson(result.value);
      setParseError(null);
    } else {
      setLiveJson(null);
      setParseError(result.error);
    }
  }, []);

  const handleTextareaScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function handleFormat() {
    if (!liveJson) return;
    setRaw(formatJson(liveJson));
  }

  function handleSave() {
    const json = liveJson ?? metajson;
    if (!json || parseError) return;
    setSavedJson(json);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 2000);
    if (onSave) onSave(json);
  }

  function handleDownload() {
    const json = liveJson ?? metajson;
    if (!json) return;
    if (onDownload) {
      onDownload(json, filename);
      return;
    }
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  const displayJson = savedJson ?? liveJson ?? metajson;
  const rawLines = raw.split("\n");
  const lineCount = rawLines.length;
  const hasUnsavedChanges = !!liveJson && liveJson !== savedJson && !parseError;

  return (
    <>
      <style>{`
        @keyframes inj-overlay-in { from{opacity:0} to{opacity:1} }
        @keyframes inj-modal-in   { from{opacity:0;transform:scale(0.97) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
        .inj-overlay { animation: inj-overlay-in 0.18s ease both; }
        .inj-modal   { animation: inj-modal-in 0.22s cubic-bezier(0.16,1,0.3,1) both; }

        .inj-key    { color:#4f46e5 } .inj-string { color:#059669 }
        .inj-number { color:#d97706 } .inj-bool   { color:#2563eb;font-weight:600 }
        .inj-null   { color:#db2777;font-weight:600 }
        .dark .inj-key    { color:#a5b4fc } .dark .inj-string { color:#6ee7b7 }
        .dark .inj-number { color:#fdba74 } .dark .inj-bool   { color:#93c5fd }
        .dark .inj-null   { color:#f9a8d4 }

        .inj-tab-bar { display:flex; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
        .dark .inj-tab-bar { border-bottom-color:#2a3147; background:#161b2e; }
        .inj-tab {
          padding:7px 14px;
          font-size:10.5px;
          font-weight:600;
          cursor:pointer;
          border-bottom:2px solid transparent;
          transition:all .15s;
          font-family:'DM Mono',monospace;
          text-transform:uppercase;
          letter-spacing:.1em;
          color:#94a3b8;
          user-select:none;
        }
        .inj-tab:hover { color:#64748b; }
        .dark .inj-tab { color:#475569; }
        .dark .inj-tab:hover { color:#64748b; }
        .inj-tab-active { color:#4f46e5!important; border-bottom-color:#4f46e5; }
        .dark .inj-tab-active { color:#818cf8!important; border-bottom-color:#818cf8; }

        .inj-scrollbar::-webkit-scrollbar { width:10px; height:10px; }
        .inj-scrollbar::-webkit-scrollbar-track { background:#f1f5f9; border-radius:999px; }
        .inj-scrollbar::-webkit-scrollbar-thumb { border-radius:999px; background:#94a3b8; border:2px solid #f1f5f9; }
        .inj-scrollbar::-webkit-scrollbar-thumb:hover { background:#64748b; }
        .dark .inj-scrollbar::-webkit-scrollbar-track { background:#1e2235; }
        .dark .inj-scrollbar::-webkit-scrollbar-thumb { background:#475569; border-color:#1e2235; }
        .dark .inj-scrollbar::-webkit-scrollbar-thumb:hover { background:#64748b; }
        .inj-scrollbar { scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9; }
        .dark .inj-scrollbar { scrollbar-color: #475569 #1e2235; }
      `}</style>

      <div
        ref={overlayRef}
        onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
        className="inj-overlay fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6"
        style={{ background: "rgba(15,20,40,.75)", backdropFilter: "blur(4px)" }}
      >
        <div
          className="inj-modal w-full max-w-4xl rounded-2xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] shadow-2xl shadow-black/40"
          style={{ maxHeight: "calc(100vh - 48px)", minHeight: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#181d30] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-100 dark:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-700/40 flex-shrink-0">
                <span className="text-cyan-600 dark:text-cyan-400 text-sm">◇</span>
              </div>
              <div className="min-w-0">
                <p className="text-[11.5px] font-bold text-slate-800 dark:text-slate-200 leading-tight truncate" style={MONO}>
                  Innod.XML Metajson
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-600 truncate" style={MONO}>
                  {filename}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {parseError && activeTab === "edit" && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-700/40" style={MONO}>
                  Parse error
                </span>
              )}
              {activeTab === "edit" && (
                <button
                  onClick={handleFormat}
                  disabled={!!parseError}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#2e3a55] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={MONO}
                >
                  Format
                </button>
              )}
              {activeTab === "edit" && (
                <button
                  onClick={handleSave}
                  disabled={!!parseError || !hasUnsavedChanges}
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
                disabled={!!parseError && activeTab === "edit"}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-cyan-600 hover:bg-cyan-700 border-cyan-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={MONO}
              >
                Download
              </button>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-[#2a3147] hover:text-slate-700 dark:hover:text-slate-300 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="inj-tab-bar flex-shrink-0">
            <button className={`inj-tab ${activeTab === "preview" ? "inj-tab-active" : ""}`} onClick={() => setActiveTab("preview")}>
              Preview
            </button>
            <button
              className={`inj-tab ${activeTab === "edit" ? "inj-tab-active" : ""}`}
              onClick={() => {
                setActiveTab("edit");
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
            >
              Edit JSON
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-3 px-4 text-[10px] text-slate-400 dark:text-slate-600" style={MONO}>
              {displayJson && <span>{Object.keys(displayJson).length} keys</span>}
              <span>{lineCount} lines</span>
            </div>
          </div>

          {/* Body */}
          <div ref={bodyRef} className="flex-1 min-h-0 bg-white dark:bg-[#161b2e]" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* ── PREVIEW TAB ── */}
            {activeTab === "preview" && displayJson && (
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "40px 1fr", overflowY: "scroll", overflowX: "auto" }} className="inj-scrollbar">
                <div className="bg-slate-100 dark:bg-[#161b2e] border-r border-slate-200 dark:border-[#2a3147] py-[14px] text-right select-none">
                  {formatJson(displayJson).split("\n").map((_, i) => (
                    <span key={i} className="block px-2 text-[11px] leading-5 text-slate-400 dark:text-slate-600" style={MONO}>{i + 1}</span>
                  ))}
                </div>
                <pre
                  className="m-0 p-[14px_16px] text-[12px] leading-5 text-slate-800 dark:text-slate-200 whitespace-pre"
                  style={MONO}
                >
                  <span dangerouslySetInnerHTML={{ __html: highlightJson(formatJson(displayJson)) }} />
                </pre>
              </div>
            )}

            {/* ── EDIT TAB ── */}
            {activeTab === "edit" && (
              <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                {/* Line numbers — scroll-synced via translateY */}
                <div style={{ width: 40, flexShrink: 0, overflow: "hidden", background: "#f8fafc", borderRight: "1px solid #e2e8f0" }} className="dark:bg-[#161b2e] dark:border-[#2a3147] select-none">
                  <div style={{ transform: `translateY(-${scrollTop}px)`, paddingTop: 14, paddingBottom: 14 }}>
                    {rawLines.map((_, i) => (
                      <div
                        key={i}
                        style={{ ...MONO, height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px`, textAlign: "right", paddingRight: 8, fontSize: 11, color: "#94a3b8" }}
                      >
                        {i + 1}
                      </div>
                    ))}
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
                    caretColor: "#06b6d4",
                    display: "block",
                  }}
                  value={raw}
                  onChange={handleRawChange}
                  onScroll={handleTextareaScroll}
                  onKeyDown={(e) => e.stopPropagation()}
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
            <div className="text-[10.5px] text-slate-400 dark:text-slate-600" style={MONO}>
              {activeTab === "preview"
                ? "Read-only preview — switch to Edit JSON to modify"
                : parseError
                  ? <span className="text-rose-500">{parseError}</span>
                  : savedJson
                    ? <><span className="text-emerald-500 mr-1">✓</span>Saved</>
                    : hasUnsavedChanges
                      ? <span className="text-amber-500">Unsaved changes</span>
                      : <><span className="text-emerald-500 mr-1">✓</span>Valid JSON</>
              }
            </div>
            <div className="flex items-center gap-2">
              {activeTab === "edit" && (
                <button
                  onClick={() => {
                    const base = savedJson ?? metajson;
                    if (base) {
                      setRaw(formatJson(base));
                      setLiveJson(base);
                      setParseError(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-all bg-white dark:bg-[#252d45] border-slate-300 dark:border-[#3a4460] text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-50 dark:hover:bg-[#2e3a55]"
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