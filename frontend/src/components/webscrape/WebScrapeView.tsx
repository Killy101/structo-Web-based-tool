"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import api from "@/app/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PageSummary {
  url: string;
  depth: number;
  parent_url: string | null;
  title: string;
  heading_count: number;
  paragraph_count: number;
  list_count: number;
  has_ocr_text: boolean;
  has_rich_content: boolean;
  child_url_count: number;
  error: string | null;
}

interface ScrapeJobStatus {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  url: string;
  pages: PageSummary[];
  page_count: number;
  success_count: number;
  html_available: boolean;
  pdf_available: boolean;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

interface ScrapeOptions {
  max_depth: number;
  max_pages: number;
  follow_same_domain: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const POLL_INTERVAL_MS = 2000;

// ── Helpers ────────────────────────────────────────────────────────────────────

function DepthBadge({ depth }: { depth: number }) {
  const colours = [
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
    "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400",
  ];
  const cls = colours[Math.min(depth, 3)];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${cls}`}>
      L{depth}
    </span>
  );
}

function StatusPill({ status }: { status: ScrapeJobStatus["status"] }) {
  const map: Record<ScrapeJobStatus["status"], string> = {
    queued:    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    running:   "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400",
    completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    failed:    "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400",
  };
  const labels: Record<ScrapeJobStatus["status"], string> = {
    queued: "Queued", running: "Running…", completed: "Completed", failed: "Failed",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${map[status]}`}>
      {status === "running" && (
        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/>
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
        </svg>
      )}
      {labels[status]}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WebScrapeView() {
  const [url, setUrl]               = useState("");
  const [options, setOptions]       = useState<ScrapeOptions>({
    max_depth: 2, max_pages: 30, follow_same_domain: true,
  });
  const [showOptions, setShowOptions] = useState(false);
  const [urlError, setUrlError]     = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob]               = useState<ScrapeJobStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"html" | "pdf" | null>(null);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);

  const pollRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobIdRef   = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [expandAll, setExpandAll] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ──────────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const poll = useCallback(async (jobId: string) => {
    try {
      const res = await api.get<ScrapeJobStatus>(`/webscrape/${jobId}`);
      setJob(res.data);
      if (res.data.status === "running" || res.data.status === "queued") {
        pollRef.current = setTimeout(() => void poll(jobId), POLL_INTERVAL_MS);
      } else {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }
    } catch {
      pollRef.current = setTimeout(() => void poll(jobId), POLL_INTERVAL_MS * 2);
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
    }, 1000);
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  function handleReset() {
    stopPolling();
    stopTimer();
    setJob(null);
    setUrl("");
    setUrlError(null);
    setSubmitError(null);
    setElapsed(0);
    setExpandAll(false);
    jobIdRef.current = null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  function validateUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return "URL is required.";
    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "Only http:// and https:// URLs are allowed.";
      }
    } catch {
      return "Enter a valid URL (e.g. https://example.com).";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateUrl(url);
    if (err) { setUrlError(err); return; }
    setUrlError(null);
    setSubmitError(null);
    setJob(null);
    setSubmitting(true);
    stopPolling();

    try {
      const res = await api.post<{ job_id: string; status: string }>("/webscrape/start", {
        url: url.trim(),
        ...options,
      });
      jobIdRef.current = res.data.job_id;
      startTimer();
      void poll(res.data.job_id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string; error?: string } }; message?: string };
      const detail = e?.response?.data?.detail ?? e?.response?.data?.error ?? e?.message ?? "Failed to start scrape.";
      setSubmitError(Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg ?? String(d)).join("; ") : String(detail));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Downloads ─────────────────────────────────────────────────────────────────
  async function handleDownload(format: "html" | "pdf") {
    if (!job) return;
    setDownloading(format);
    try {
      const res = await api.get(`/webscrape/${job.job_id}/${format}`, {
        responseType: format === "pdf" ? "arraybuffer" : "text",
      });
      const mimeType = format === "pdf" ? "application/pdf" : "text/html";
      const ext      = format === "pdf" ? ".pdf" : ".html";
      const blob     = new Blob([res.data as string | ArrayBuffer], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `scrape-output${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // silent – the button will re-enable
    } finally {
      setDownloading(null);
    }
  }

  // ── Page tree helpers ─────────────────────────────────────────────────────────
  function buildTree(pages: PageSummary[]): Map<string | null, PageSummary[]> {
    const tree = new Map<string | null, PageSummary[]>();
    for (const p of pages) {
      const key = p.parent_url ?? null;
      if (!tree.has(key)) tree.set(key, []);
      tree.get(key)!.push(p);
    }
    return tree;
  }

  function renderTree(
    tree: Map<string | null, PageSummary[]>,
    parentUrl: string | null,
    depth: number,
  ): React.ReactNode {
    const children = tree.get(parentUrl) ?? [];
    if (!children.length) return null;
    return (
      <ul className={depth === 0 ? "space-y-1.5" : "mt-1.5 ml-4 space-y-1.5 border-l border-slate-200 dark:border-slate-700 pl-3"}>
        {children.map((page) => {
          const expanded = expandAll || expandedPage === page.url;
          return (
            <li key={page.url}>
              <button
                onClick={() => setExpandedPage(expanded ? null : page.url)}
                className="w-full text-left flex items-start gap-2 py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
              >
                <DepthBadge depth={page.depth} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-slate-800 dark:text-slate-200 truncate flex-1">
                      {page.title || page.url}
                    </span>
                    {page.error && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-red-600 dark:text-red-400">ERR</span>
                    )}
                    {page.has_rich_content && (
                      <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        Rich
                      </span>
                    )}
                    {page.has_ocr_text && (
                      <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                        OCR
                      </span>
                    )}
                    {/\.pdf$/i.test(page.url) && (
                      <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        PDF
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono truncate block">{page.url}</span>
                </div>
                <svg
                  className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </button>

              {expanded && !page.error && (
                <div className="ml-7 mt-1 mb-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                  <span className="inline-flex gap-3">
                    <span>{page.heading_count} heading{page.heading_count !== 1 ? "s" : ""}</span>
                    <span>{page.paragraph_count} paragraph{page.paragraph_count !== 1 ? "s" : ""}</span>
                    <span>{page.list_count} list{page.list_count !== 1 ? "s" : ""}</span>
                    <span>{page.child_url_count} child link{page.child_url_count !== 1 ? "s" : ""}</span>
                  </span>
                </div>
              )}

              {expanded && page.error && (
                <p className="ml-7 mt-1 mb-2 text-[11px] text-red-600 dark:text-red-400">{page.error}</p>
              )}

              {renderTree(tree, page.url, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  const isRunning = job?.status === "running" || job?.status === "queued";
  const isDone    = job?.status === "completed";
  const isFailed  = job?.status === "failed";
  const tree      = job ? buildTree(job.pages) : null;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">

      {/* ── URL input card ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#161b2e] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/40 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
            </svg>
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">WebScrape</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Recursively crawl a website and export structured content as HTML or PDF
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          {/* URL field */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
              Website URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
                placeholder="https://example.com"
                disabled={submitting || isRunning}
                className={`flex-1 px-3 py-2 text-[13px] rounded-lg border bg-white dark:bg-[#1a2035] text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all ${
                  urlError
                    ? "border-red-400 dark:border-red-500"
                    : "border-slate-300 dark:border-slate-600"
                } disabled:opacity-60`}
              />
              <button
                type="submit"
                disabled={submitting || isRunning || !url.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting || isRunning ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/>
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
                    </svg>
                    {isRunning ? "Scraping…" : "Starting…"}
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    Scrape
                  </>
                )}
              </button>
            </div>
            {urlError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{urlError}</p>}
          </div>

          {/* Options toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowOptions(v => !v)}
              className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${showOptions ? "rotate-90" : ""}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
              </svg>
              Advanced options
            </button>

            {showOptions && (
              <div className="mt-3 grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/40">
                {/* Max depth */}
                <div>
                  <label className="block text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                    Max depth
                  </label>
                  <select
                    value={options.max_depth}
                    onChange={(e) => setOptions(o => ({ ...o, max_depth: Number(e.target.value) }))}
                    disabled={submitting || isRunning}
                    className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1a2035] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60"
                  >
                    {[0, 1, 2, 3, 4, 5].map(d => <option key={d} value={d}>Level {d}{d === 0 ? " (root page only)" : d === 2 ? " (recommended)" : ""}</option>)}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    How many nested child-link levels to follow. Level 0 = root page only, Level 2 = root → children → grandchildren.
                  </p>
                </div>

                {/* Max pages */}
                <div>
                  <label className="block text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                    Max pages
                  </label>
                  <select
                    value={options.max_pages}
                    onChange={(e) => setOptions(o => ({ ...o, max_pages: Number(e.target.value) }))}
                    disabled={submitting || isRunning}
                    className="w-full px-2 py-1.5 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1a2035] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60"
                  >
                    {[5, 10, 20, 30, 50, 100].map(n => <option key={n} value={n}>{n} pages{n === 30 ? " (default)" : ""}</option>)}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    Hard limit on total pages scraped. Prevents runaway crawls on large sites.
                  </p>
                </div>

                {/* Toggles */}
                <label className="flex items-center gap-2 col-span-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.follow_same_domain}
                    onChange={(e) => setOptions(o => ({ ...o, follow_same_domain: e.target.checked }))}
                    disabled={submitting || isRunning}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/40 disabled:opacity-60"
                  />
                  <span className="text-[12px] text-slate-600 dark:text-slate-400">
                    Follow same-domain links only <span className="text-slate-400 text-[11px]">(recommended — prevents crawling external sites)</span>
                  </span>
                </label>

                <div className="col-span-2 flex items-start gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 px-3 py-2">
                  <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                  </svg>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    <strong>OCR is automatic.</strong> The system detects image-embedded text and runs OCR automatically — no manual toggle needed.
                  </p>
                </div>
              </div>
            )}
          </div>

          {submitError && (
            <p className="text-[12px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}
        </form>
      </div>

      {/* ── Job status card ── */}
      {job && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#161b2e] shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/40 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <StatusPill status={job.status} />
              <span className="text-[11px] text-slate-400 font-mono truncate max-w-[220px]">{job.url}</span>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-[10px] text-slate-400 font-mono">
                {job.success_count}/{job.page_count} pages
              </span>
              {(isDone || isFailed) && (
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  title="Clear result and start a new scrape"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  New Scrape
                </button>
              )}
            </div>
          </div>

          {/* Progress bar + elapsed timer */}
          {isRunning && (
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/40">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-500">Crawling…</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                    <svg className="inline w-3 h-3 mr-0.5 -mt-0.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    {formatElapsed(elapsed)}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">{job.progress}%</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {isFailed && job.error && (
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/40">
              <p className="text-[12px] text-red-600 dark:text-red-400">{job.error}</p>
            </div>
          )}

          {/* Download buttons */}
          {isDone && (
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/40 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mr-1">Export:</span>
              <button
                onClick={() => void handleDownload("html")}
                disabled={downloading === "html"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1a2035] text-slate-700 dark:text-slate-300 text-[11.5px] font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-60 transition-colors"
              >
                {downloading === "html" ? (
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/>
                    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                  </svg>
                )}
                HTML
              </button>

              {job.pdf_available ? (
                <button
                  onClick={() => void handleDownload("pdf")}
                  disabled={downloading === "pdf"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1a2035] text-slate-700 dark:text-slate-300 text-[11.5px] font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-60 transition-colors"
                >
                  {downloading === "pdf" ? (
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/>
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                  )}
                  PDF
                </button>
              ) : (
                <span className="text-[11px] text-slate-400 italic">
                  PDF unavailable — install <code className="text-[10px]">weasyprint</code> or <code className="text-[10px]">xhtml2pdf</code>
                </span>
              )}
            </div>
          )}

          {/* Completion stats bar */}
          {isDone && job.pages.length > 0 && (() => {
            const errCount  = job.pages.filter(p => p.error).length;
            const pdfCount  = job.pages.filter(p => /\.pdf$/i.test(p.url)).length;
            const ocrCount  = job.pages.filter(p => p.has_ocr_text).length;
            const richCount = job.pages.filter(p => p.has_rich_content).length;
            return (
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/40 flex flex-wrap gap-3">
                {([
                  { label: "Pages",  value: job.success_count, icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", color: "text-slate-600 dark:text-slate-400" },
                  { label: "Errors", value: errCount,  icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: errCount > 0 ? "text-red-600 dark:text-red-400" : "text-slate-400 dark:text-slate-600" },
                  { label: "PDF",    value: pdfCount,  icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z", color: "text-red-500 dark:text-red-400" },
                  { label: "OCR",    value: ocrCount,  icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z", color: "text-violet-600 dark:text-violet-400" },
                  { label: "Rich",   value: richCount, icon: "M4 6h16M4 12h16M4 18h7", color: "text-blue-600 dark:text-blue-400" },
                ] as { label: string; value: number; icon: string; color: string }[]).map(({ label, value, icon, color }) => (
                  <div key={label} className={`flex items-center gap-1.5 text-[11px] font-semibold ${color}`}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon}/>
                    </svg>
                    <span className="tabular-nums">{value}</span>
                    <span className="text-[10px] font-normal text-slate-400">{label}</span>
                  </div>
                ))}
                {elapsed > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 ml-auto">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    {formatElapsed(elapsed)}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Page tree */}
          {job.pages.length > 0 && (
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Scraped Pages
                </p>
                {job.pages.length > 1 && (
                  <button
                    onClick={() => setExpandAll(v => !v)}
                    className="text-[10.5px] text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    {expandAll ? "Collapse all" : "Expand all"}
                  </button>
                )}
              </div>
              {renderTree(tree!, null, 0)}
            </div>
          )}

          {/* Empty state while running */}
          {isRunning && job.pages.length === 0 && (
            <div className="px-5 py-8 text-center">
              <p className="text-[12px] text-slate-400 dark:text-slate-500">Fetching pages…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
