"use client";
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useDashboard, useUserLogs } from "../../hooks";
import api from "../lib/api";
import { formatTimeAgo } from "../../utils";
import TetrisLoading from "../../components/ui/tetris-loader";
import dynamic from "next/dynamic";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Cell } from "recharts";
const CompareUsageChart = dynamic(
  () => import("../../components/ui/compare-usage-chart"),
  { ssr: false }
);

/* ─── Injected styles ──────────────────────────────────────────────────────── */
// ── Brd type (mirrors BRD page) ─────────────────────────────────────────────
type BrdStatus = "DRAFT" | "PAUSED" | "COMPLETED" | "APPROVED" | "ON_HOLD";
interface Brd {
  id: string; title: string; sourceName?: string; contentName?: string;
  status: BrdStatus; version: string; lastUpdated: string;
  geography: string; format: "new" | "old";
}
function brdDisplayTitle(b: Brd) {
  return b.sourceName?.trim() || b.contentName?.trim() || b.title;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&family=JetBrains+Mono:wght@400;500&display=swap');

.db { font-family:'Plus Jakarta Sans',sans-serif; }
.db .jb { font-family:'JetBrains Mono',monospace; }

/* tokens — light */
.db {
  --c-bg:    #f6f8fc;
  --c-card:  #ffffff;
  --c-b:     #e6ebf3;
  --c-txt:   #0f172a;
  --c-sub:   #5b667a;
  --c-dim:   #9aa4b8;
  --c-a:     #2563eb;
  --c-ahi:   #3b82f6;
  --c-alo:   rgba(37,99,235,.08);
  --c-sh:    0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.05);
  --c-shl:   0 14px 36px rgba(15,23,42,.10);
}
/* tokens — dark */
.dark .db {
  --c-bg:    #0a1222;
  --c-card:  #0f1a2f;
  --c-b:     #1e2b45;
  --c-txt:   #e2e8f0;
  --c-sub:   #8c98ae;
  --c-dim:   #51607a;
  --c-a:     #60a5fa;
  --c-ahi:   #93c5fd;
  --c-alo:   rgba(96,165,250,.11);
  --c-sh:    0 2px 8px rgba(0,0,0,.24),0 10px 30px rgba(0,0,0,.24);
  --c-shl:   0 18px 40px rgba(0,0,0,.48);
}

.db .card {
  background:var(--c-card);
  border:1px solid var(--c-b);
  border-radius:14px;
  box-shadow:var(--c-sh);
}

/* entrance */
@keyframes db-up { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes db-in { from{opacity:0} to{opacity:1} }
@keyframes db-cx { from{transform:scaleX(0)} to{transform:scaleX(1)} }
@keyframes db-cy { from{transform:scaleY(0)} to{transform:scaleY(1)} }
@keyframes db-num{ from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
@keyframes db-ln { from{stroke-dashoffset:600;opacity:0} to{stroke-dashoffset:0;opacity:1} }
@keyframes db-pl { 0%,100%{opacity:1}50%{opacity:.35} }

.db .u  { animation:db-up .42s cubic-bezier(.16,1,.3,1) both }
.db .d1 { animation-delay:.04s } .db .d2 { animation-delay:.08s }
.db .d3 { animation-delay:.12s } .db .d4 { animation-delay:.16s }
.db .d5 { animation-delay:.20s } .db .d6 { animation-delay:.24s }
.db .d7 { animation-delay:.28s } .db .d8 { animation-delay:.32s }

/* progress bars */
.db .pb { height:5px; border-radius:5px; background:var(--c-b); overflow:hidden; }
.db .pf {
  height:100%; border-radius:5px; transform-origin:left;
  animation:db-cx .75s cubic-bezier(.16,1,.3,1) both;
}

/* row hover */
.db .tr { border-radius:9px; transition:background .12s; cursor:default; }
.db .tr:hover { background:var(--c-alo); }

/* live dot */
.db .ld { width:7px;height:7px;border-radius:50%;background:#22c55e;animation:db-pl 1.8s infinite; }

/* badge */
.db .bdg {
  display:inline-flex;align-items:center;
  padding:1px 7px;border-radius:20px;
  font-size:9.5px;font-weight:700;letter-spacing:.04em;
  white-space:nowrap;font-family:'JetBrains Mono',monospace;
}

/* scrollbar */
.db ::-webkit-scrollbar { width:3px; height:3px; }
.db ::-webkit-scrollbar-track { background:transparent; }
.db ::-webkit-scrollbar-thumb { background:var(--c-b); border-radius:3px; }

/* ── Pipeline bubble bounce animations ── */
@keyframes db-bob0 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-8px)} }
@keyframes db-bob1 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-11px)} }
@keyframes db-bob2 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-6px)} }
@keyframes db-bob3 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-9px)} }
.db .bubble-0 { animation: db-up .5s cubic-bezier(.16,1,.3,1) .1s both, db-bob0 3.2s ease-in-out 0.7s infinite; }
.db .bubble-1 { animation: db-up .5s cubic-bezier(.16,1,.3,1) .2s both, db-bob1 2.8s ease-in-out 1.0s infinite; }
.db .bubble-2 { animation: db-up .5s cubic-bezier(.16,1,.3,1) .3s both, db-bob2 3.6s ease-in-out 0.4s infinite; }
.db .bubble-3 { animation: db-up .5s cubic-bezier(.16,1,.3,1) .4s both, db-bob3 3.0s ease-in-out 1.3s infinite; }

/* ── Responsive layout ── */
.db .db-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0,1fr) minmax(0,1fr) 270px;
}
@media (max-width: 1100px) {
  .db .db-grid {
    grid-template-columns: minmax(0,1fr) minmax(0,1fr);
  }
  .db .db-col3 {
    grid-column: 1 / -1;
    display: grid !important;
    grid-template-columns: repeat(auto-fit, minmax(260px,1fr));
    gap: 16px;
  }
}
@media (max-width: 700px) {
  .db .db-grid {
    grid-template-columns: 1fr;
  }
  .db .db-col3 {
    grid-column: 1 !important;
    display: flex !important;
    flex-direction: column;
  }
  .db .db-header {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 8px;
  }
  .db .db-kpi {
    grid-template-columns: 1fr 1fr !important;
  }
}
@media (max-width: 420px) {
  .db .db-kpi {
    grid-template-columns: 1fr !important;
  }
}
`;

/* ─── Status colours ──────────────────────────────────────────────────────── */
type SC = { bg: string; fg: string };
const LIGHT: Record<string, SC> = {
  COMPLETED:   { bg:"#dcfce7", fg:"#15803d" },
  APPROVED:    { bg:"#dcfce7", fg:"#15803d" },
  PENDING:     { bg:"#fef3c7", fg:"#b45309" },
  IN_PROGRESS: { bg:"#dbeafe", fg:"#1d4ed8" },
  IN_REVIEW:   { bg:"#dbeafe", fg:"#1d4ed8" },
  DRAFT:       { bg:"#f1f5f9", fg:"#475569" },
  ARCHIVED:    { bg:"#ede9fe", fg:"#6d28d9" },
  PAUSED:      { bg:"#fef3c7", fg:"#b45309" },
  ON_HOLD:     { bg:"#fee2e2", fg:"#c53030" },
  SYSTEM:      { bg:"#f1f5f9", fg:"#475569" },
};
const DARK: Record<string, SC> = {
  COMPLETED:   { bg:"rgba(21,128,61,.18)",  fg:"#4ade80" },
  APPROVED:    { bg:"rgba(21,128,61,.18)",  fg:"#4ade80" },
  PENDING:     { bg:"rgba(180,83,9,.18)",   fg:"#fbbf24" },
  IN_PROGRESS: { bg:"rgba(29,78,216,.2)",   fg:"#60a5fa" },
  IN_REVIEW:   { bg:"rgba(29,78,216,.2)",   fg:"#60a5fa" },
  DRAFT:       { bg:"rgba(71,85,105,.15)",  fg:"#94a3b8" },
  ARCHIVED:    { bg:"rgba(109,40,217,.18)", fg:"#a78bfa" },
  PAUSED:      { bg:"rgba(180,83,9,.18)",   fg:"#fbbf24" },
  ON_HOLD:     { bg:"rgba(197,48,48,.18)",  fg:"#f87171" },
  SYSTEM:      { bg:"rgba(71,85,105,.15)",  fg:"#94a3b8" },
};

/* ─── Accent palette for bars / rings ─────────────────────────────────────── */
/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains("dark"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function Badge({ label }: { label: string }) {
  const dark = useDark();
  const map  = dark ? DARK : LIGHT;
  const c    = map[label] ?? map.SYSTEM;
  return <span className="bdg" style={{ background: c.bg, color: c.fg }}>{label}</span>;
}

function CountUp({ to, prefix = "", suffix = "" }: { to: number; prefix?: string; suffix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let s: number | null = null;
    const step = (ts: number) => {
      if (!s) s = ts;
      const p = Math.min((ts - s) / 900, 1);
      setV(Math.round((1 - Math.pow(1 - p, 4)) * to));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [to]);
  return <>{prefix}{v.toLocaleString()}{suffix}</>;
}

/* ─── Live clock / date widget ────────────────────────────────────────────── */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const mm   = now.getMinutes().toString().padStart(2, "0");
  const ss   = now.getSeconds().toString().padStart(2, "0");
  const ampm = now.getHours() >= 12 ? "PM" : "AM";
  const hh12 = (now.getHours() % 12 || 12).toString().padStart(2, "0");

  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 4,
      minWidth: 180,
    }}>
      {/* Time row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          className="jb"
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "var(--c-txt)",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {hh12}:{mm}
          <span style={{ opacity: now.getSeconds() % 2 === 0 ? 1 : 0.3, transition: "opacity 0.15s" }}>:</span>
          {ss}
        </span>
        <span
          className="jb"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--c-a)",
            letterSpacing: "0.05em",
            paddingBottom: 2,
          }}
        >
          {ampm}
        </span>
      </div>

      {/* Date row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--c-sub)", letterSpacing: "0.01em" }}>
          {dayName},&nbsp;{dateStr}
        </span>
      </div>

    </div>
  );
}

/* SVG area line chart */
function LineChart({ data }: { data: number[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hov, setHov] = useState<{ xi: number; xp: number; yp: number; val: number } | null>(null);
  if (data.length < 2) return null;

  const W = 500, H = 140, pl = 34, pr = 10, pt = 8, pb = 24;
  const cw = W - pl - pr, ch = H - pt - pb;
  const mn = Math.min(...data) * 0.88, mx = Math.max(...data) * 1.08 || 1;
  const px = (i: number) => pl + (i / (data.length - 1)) * cw;
  const py = (v: number) => pt + ch - ((v - mn) / (mx - mn)) * ch;
  const pts = data.map((v, i) => [px(i), py(v)] as [number, number]);
  const linePath = `M ${pts.map(p => p.join(",")).join(" L ")}`;
  const areaPath = `M ${px(0)},${pt + ch} ${pts.map(p => `L ${p.join(",")}`).join(" ")} L ${px(data.length - 1)},${pt + ch} Z`;
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const yTicks = [0, .25, .5, .75, 1].map(t => ({ y: pt + ch * (1 - t), v: Math.round(mn + (mx - mn) * t) }));

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={ref}
        width="100%" viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", cursor: "crosshair" }}
        onMouseLeave={() => setHov(null)}
        onMouseMove={e => {
          const r = ref.current!.getBoundingClientRect();
          const rx = (e.clientX - r.left) / r.width * W;
          const ci = Math.max(0, Math.min(data.length - 1, Math.round((rx - pl) / cw * (data.length - 1))));
          setHov({ xi: ci, xp: (px(ci) / W) * 100, yp: ((py(data[ci]) - pt) / ch) * 100, val: data[ci] });
        }}
      >
        <defs>
          <linearGradient id="dbg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-a)" stopOpacity=".18" />
            <stop offset="100%" stopColor="var(--c-a)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pl} y1={t.y} x2={W - pr} y2={t.y}
              stroke="var(--c-b)" strokeWidth=".75" strokeDasharray="3 4" />
            <text x={pl - 4} y={t.y + 3.5} textAnchor="end"
              fontSize="9" fill="var(--c-dim)"
              fontFamily="'JetBrains Mono',monospace">{t.v}</text>
          </g>
        ))}
        {data.map((_, i) => (
          <text key={i} x={px(i)} y={H - 5} textAnchor="middle"
            fontSize="9" fill="var(--c-dim)"
            fontFamily="'Plus Jakarta Sans',sans-serif">
            {DAYS[i % 7]}
          </text>
        ))}
        <path d={areaPath} fill="url(#dbg)"
          style={{ animation: "db-in .7s ease .5s both" }} />
        <path d={linePath} fill="none" stroke="var(--c-a)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="600"
          style={{ animation: "db-ln 1s cubic-bezier(.16,1,.3,1) .2s both" }} />
        {hov && (
          <>
            <line x1={px(hov.xi)} y1={pt} x2={px(hov.xi)} y2={pt + ch}
              stroke="var(--c-a)" strokeWidth=".8" strokeDasharray="3 3" opacity=".5" />
            <circle cx={px(hov.xi)} cy={py(data[hov.xi])} r="4.5"
              fill="var(--c-a)" stroke="white" strokeWidth="2" />
          </>
        )}
      </svg>
      {hov && (
        <div style={{
          position: "absolute",
          left: `${hov.xp}%`, top: `${Math.max(4, hov.yp - 10)}%`,
          transform: "translate(-50%,-100%)",
          background: "var(--c-card)", border: "1px solid var(--c-b)",
          borderRadius: 9, padding: "6px 10px",
          boxShadow: "var(--c-shl)", pointerEvents: "none", zIndex: 10,
        }}>
          <p className="jb" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-a)" }}>
            {hov.val.toLocaleString()}
          </p>
          <p style={{ fontSize: 10, color: "var(--c-sub)" }}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][hov.xi % 7]}
          </p>
        </div>
      )}
    </div>
  );
}

/* Concentric donut */
function Donut({ segs, size = 140 }: {
  segs: { pct: number; color: string; track: string; label: string }[];
  size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 8, gap = 13, sw = 9;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {segs.map((s, i) => {
        const r    = outerR - i * gap;
        const circ = 2 * Math.PI * r;
        const arc  = (s.pct / 100) * circ;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={s.track} strokeWidth={sw} />
            <circle cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={sw} strokeLinecap="round"
              strokeDasharray={`${arc} ${circ - arc}`}
              strokeDashoffset={circ * .25}
              style={{ animation: `db-in .4s ease ${.2 + i * .12}s both` }} />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────────── */
const TXN_SIZE = 6;

export default function DashboardPage() {
  const { user }    = useAuth();
  const { stats, isLoading, refetch } = useDashboard();
  const { logs, isLoading: logLoad, refetch: refetchLogs } = useUserLogs(
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" ? "all" : "mine"
  );
  const [brds,    setBrds]    = useState<Brd[]>([]);
  const [brdLoad, setBrdLoad] = useState(true);
  const [txp, setTxp] = useState(1);
  const [balancePage, setBalancePage] = useState(1);
  const BALANCE_PAGE_SIZE = 8;
  const dark = useDark();

  // Fetch full BRD list directly — same call as BRD page, gives real status/geography/title
  const refetchBrds = useCallback(async () => {
    setBrdLoad(true);
    try { const r = await api.get<Brd[]>("/brd"); setBrds(r.data); }
    catch { /* silent — dashboard degrades gracefully */ }
    finally { setBrdLoad(false); }
  }, []);
  useEffect(() => { refetchBrds(); }, [refetchBrds]);

  type Act = { id: string; at: string; action: string; user: string; source: string; tag: string };

  const acts: Act[] = useMemo(() => {
    return logs.map(l => ({
      id:     `l${l.id}`,
      at:     l.createdAt,
      action: l.action.replace(/_/g, " "),
      user:   `${l.user?.firstName ?? ""} ${l.user?.lastName ?? ""}`.trim() || "—",
      source: l.details?.slice(0, 14) ?? "—",
      tag:    "SYSTEM",
    })).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
       .slice(0, 100);
  }, [logs]);

  const totalTxp = Math.max(1, Math.ceil(acts.length / TXN_SIZE));
  useEffect(() => { if (txp > totalTxp) setTxp(totalTxp); }, [txp, totalTxp]);
  const paged = acts.slice((txp - 1) * TXN_SIZE, txp * TXN_SIZE);



  const totalUsers  = stats?.usersByRole?.reduce((a, b) => a + b.count, 0) ?? 0;

  // Derive BRD stats directly from the real Brd[] — no approximations
  const totalBrds = brds.length;
  const brdsByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    brds.forEach(b => { counts[b.status] = (counts[b.status] ?? 0) + 1; });
    return Object.entries(counts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [brds]);
  const brdByContinent = useMemo(() => {
    const CONT_KW: Record<string, string[]> = {
      Americas: ["united states","usa","canada","brazil","mexico","colombia","argentina","chile","peru","venezuela","ecuador","bolivia","administrative code","code of federal","cfr","federal register","alabama","alaska","arizona","california","florida","georgia","illinois","new york","texas","washington"],
      Asia:     ["china","japan","korea","india","singapore","philippines","indonesia","thailand","vietnam","malaysia","hong kong","taiwan"],
      Europe:   ["europe","uk","united kingdom","france","germany","spain","italy","netherlands","poland","sweden","norway","denmark","finland","switzerland","austria","belgium","portugal","russia"],
      Africa:   ["africa","nigeria","kenya","south africa","egypt","ghana","ethiopia"],
      Oceania:  ["australia","new zealand","pacific","anz"],
    };
    const counts: Record<string, number> = { Americas:0, Asia:0, Europe:0, Africa:0, Oceania:0, Other:0 };
    brds.forEach(b => {
      const g = b.geography.toLowerCase();
      let matched = false;
      for (const [cont, kws] of Object.entries(CONT_KW)) {
        if (kws.some(kw => g.includes(kw))) { counts[cont]++; matched = true; break; }
      }
      if (!matched) counts.Other++;
    });
    return Object.entries(counts).filter(([,v])=>v>0).map(([region,count])=>({region,count}));
  }, [brds]);

  // Real: events per day for the last 7 days
  const lineData = useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const buckets = Array(7).fill(0);
    // Count login events per day for user traffic
    logs.forEach(l => {
      if (l.action?.toUpperCase().includes("LOGIN")) {
        const daysAgo = Math.floor((now - new Date(l.createdAt).getTime()) / DAY);
        if (daysAgo >= 0 && daysAgo < 7) buckets[6 - daysAgo]++;
      }
    });
    return buckets;
  }, [logs]);

  /* Donut rings */
  const RING_C = [
    { l:"BRDs",  v:totalBrds,  color:"#2563eb", trackL:"#dbeafe", trackD:"rgba(37,99,235,.22)" },
    { l:"Users", v:totalUsers, color:"#0f766e", trackL:"#ccfbf1", trackD:"rgba(15,118,110,.22)"  },
  ];
  // Ring fill = that metric as % of the combined total (visual proportion)
  const sumOf4 = Math.max(totalBrds + totalUsers, 1);
  const ringSegs = RING_C.map(r => ({
    pct:   r.v === 0 ? 0 : Math.max(5, Math.round((r.v / sumOf4) * 90)),
    color: r.color,
    track: dark ? r.trackD : r.trackL,
    label: r.l,
    raw:   r.v,
  }));

  /* BRD status bars — real data from /brd */
  const brdStatuses = brdsByStatus;

  if (isLoading || brdLoad || logLoad) {
    return (
      <div className="db flex items-center justify-center h-full" style={{ background: "var(--c-bg)" }}>
        <style>{CSS}</style>
        <div className="flex flex-col items-center gap-3">
          <TetrisLoading size="sm" speed="fast" loadingText="" />
          <p className="jb text-[10px] tracking-widest uppercase" style={{ color: "var(--c-sub)" }}>Loading</p>
        </div>
      </div>
    );
  }

  /* ── Shared card class ── */
  const C = "card";

  return (
    <div className="db" style={{ background: "radial-gradient(circle at 0% 0%, var(--c-alo), transparent 28%), var(--c-bg)", minHeight: "100%", padding: "clamp(12px,3vw,20px) clamp(12px,4vw,32px) 28px", maxWidth: 1700, margin: "0 auto" }}>
      <style>{CSS}</style>

      {/* ── Page heading ── */}
      <div className="db-header u mb-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
        <div>
          <h1 className="text-[20px] font-bold tracking-tight" style={{ color: "var(--c-txt)" }}>Dashboard</h1>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--c-sub)" }}>
            {user?.firstName ? `Welcome back, ${user.firstName}` : "Document processing overview"}
          </p>
        </div>
        <LiveClock />
      </div>

      {/* ══ FULL-WIDTH KPI ROW ══ */}
      <div className="db-kpi grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "BRD Sources",  val: totalBrds,                          sub: "total registered",   color: "#2563eb" },
          { label: "Users",        val: totalUsers,                          sub: "registered accounts", color: "#0f766e" },
          { label: "Logins Today", val: lineData[6] ?? 0,                    sub: "login events today",  color: "#7c3aed" },
          { label: "Total Events", val: acts.length,                         sub: "activity log entries", color: "#b45309" },
        ].map((k, i) => (
          <div key={k.label} className={`${C} u d${i+1}`} style={{ padding: "16px 18px 14px" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium" style={{ color:"var(--c-sub)" }}>{k.label}</p>
              <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${k.color}18` }}>
                <span className="w-2 h-2 rounded-full" style={{ background: k.color }} />
              </span>
            </div>
            <p className="jb text-[28px] font-bold leading-none" style={{ color:"var(--c-txt)" }}>
              <CountUp to={k.val} />
            </p>
            <p className="text-[10px] mt-2" style={{ color:"var(--c-sub)" }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ══ 3-COLUMN GRID ══ */}
      <div className="db-grid gap-5">

        {/* ╔══════════ COL 1 ══════════╗ */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* Line chart */}
          <div className={`${C} u d5 p-4`}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-[13px] font-bold" style={{ color:"var(--c-txt)" }}>User Traffic</p>
                <p className="text-[11px] mt-0.5" style={{ color:"var(--c-sub)" }}>Last 7 days · login activity</p>
              </div>
              <div className="flex gap-3 text-[10px]" style={{ color:"var(--c-sub)" }}>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded" style={{ background:"var(--c-a)" }}/>Logins
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background:"var(--c-dim)" }}/>Daily
                </span>
              </div>
            </div>
            <p className="jb text-[22px] font-bold mt-1" style={{ color:"var(--c-txt)" }}>
              <CountUp to={lineData.reduce((a, b) => a + b, 0)} />
            </p>
            <p className="text-[11px] mb-3" style={{ color:"var(--c-sub)" }}>
              {lineData.reduce((a, b) => a + b, 0) > 0
                ? `${lineData.reduce((a, b) => a + b, 0)} logins this week`
                : "no logins this week"}
            </p>
            <LineChart data={lineData} />
          </div>

          {/* Activity table */}
          <div className={`${C} u d6 overflow-hidden`}>
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div>
                <p className="text-[13px] font-bold" style={{ color:"var(--c-txt)" }}>Recent Activity</p>
                <p className="text-[11px] mt-0.5" style={{ color:"var(--c-sub)" }}>{acts.length} total events</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="jb text-[10px]" style={{ color:"var(--c-dim)" }}>
                  {(txp-1)*TXN_SIZE+1}–{Math.min(txp*TXN_SIZE,acts.length)} / {acts.length}
                </span>
                {[{l:"←",d:txp===1,f:()=>setTxp(p=>p-1)},{l:"→",d:txp>=totalTxp,f:()=>setTxp(p=>p+1)}]
                  .map(b=>(
                    <button key={b.l} onClick={b.f} disabled={b.d}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] transition-colors"
                      style={{ background:"var(--c-bg)", border:"1px solid var(--c-b)",
                        color: b.d?"var(--c-dim)":"var(--c-sub)", cursor:b.d?"not-allowed":"pointer" }}
                    >{b.l}</button>
                  ))
                }
              </div>
            </div>

            {/* Table header */}
            <div className="grid px-4 py-1.5 text-[9.5px] font-bold uppercase tracking-widest jb"
              style={{ gridTemplateColumns:"1fr 100px 72px 64px",
                borderTop:"1px solid var(--c-b)", borderBottom:"1px solid var(--c-b)",
                color:"var(--c-dim)" }}>
              <span>Event</span><span>Source</span><span>When</span><span className="text-right">Status</span>
            </div>

            <div className="px-2 pb-3 pt-1">
              {paged.length === 0
                ? <p className="text-center py-8 text-[12px]" style={{color:"var(--c-dim)"}}>No activity yet</p>
                : paged.map((a, i) => {
                    const sc = dark ? (DARK[a.tag]??DARK.SYSTEM) : (LIGHT[a.tag]??LIGHT.SYSTEM);
                    return (
                      <div key={a.id} className="tr u grid items-center px-2 py-2"
                        style={{ gridTemplateColumns:"1fr 100px 72px 64px",
                          animationDelay:`${i*.04}s` }}>
                        {/* avatar + name */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-[8px] flex items-center justify-center jb text-[11px] font-bold flex-shrink-0"
                            style={{ background:sc.bg, color:sc.fg }}>
                            {a.user[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold truncate" style={{color:"var(--c-txt)"}}>
                              {a.action.slice(0,20)}
                            </p>
                            <p className="text-[10px] truncate" style={{color:"var(--c-sub)"}}>
                              {a.user.slice(0,18)}
                            </p>
                          </div>
                        </div>
                        <span className="jb text-[10px] truncate" style={{color:"var(--c-sub)"}}>
                          {a.source.slice(0,12)}
                        </span>
                        <span className="jb text-[10px]" style={{color:"var(--c-dim)"}}>
                          {formatTimeAgo(a.at)}
                        </span>
                        <div className="flex justify-end">
                          <Badge label={a.tag} />
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </div>

        {/* ╔══════════ COL 2 ══════════╗ */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* BRD Processing Chart */}
          <div className={`${C} u d3 p-4`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-bold" style={{color:"var(--c-txt)"}}>BRD Processing</p>
                <p className="text-[11px] mt-0.5" style={{color:"var(--c-sub)"}}>BRD count by status</p>
              </div>
              <button
                onClick={() => { refetch(); refetchBrds(); refetchLogs(); }}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full transition-opacity hover:opacity-75"
                style={{ background:"var(--c-alo)", color:"var(--c-a)", border:"1px solid var(--c-a)22" }}
              >↻ Refresh</button>
            </div>
            {brdStatuses.length === 0
              ? <p className="text-center text-[12px] py-4" style={{color:"var(--c-dim)"}}>No BRD data</p>
              : <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        { status: "Draft",     count: brdStatuses.find(s => s.status === "DRAFT")?.count     || 0, fill: "#38bdf8" },
                        { status: "Paused",    count: brdStatuses.find(s => s.status === "PAUSED")?.count    || 0, fill: "#fbbf24" },
                        { status: "Completed", count: brdStatuses.find(s => s.status === "COMPLETED")?.count || 0, fill: "#34d399" },
                        { status: "Approved",  count: brdStatuses.find(s => s.status === "APPROVED")?.count  || 0, fill: "#a78bfa" },
                        { status: "On Hold",   count: brdStatuses.find(s => s.status === "ON_HOLD")?.count   || 0, fill: "#f87171" },
                      ]}
                      margin={{ top: 4, right: 4, left: -22, bottom: 0 }}
                      barSize={22}
                    >
                      <CartesianGrid vertical={false} stroke={dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} />
                      <XAxis
                        dataKey="status"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 9, fill: dark ? "#637898" : "#96a8c8" }}
                        tickMargin={5}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 9, fill: dark ? "#637898" : "#96a8c8" }}
                        width={26}
                      />
                      <Tooltip
                        cursor={{ fill: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                        contentStyle={{
                          fontSize: 11,
                          borderRadius: 8,
                          background: dark ? "#0c1829" : "#fff",
                          border: `1px solid ${dark ? "#17253f" : "#e4eaf4"}`,
                          color: dark ? "#d8e4ff" : "#0d1b3e",
                          padding: "4px 10px",
                        }}
                        formatter={(value: number) => [value, "BRDs"]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {[
                          { status: "Draft",     fill: "#38bdf8" },
                          { status: "Paused",    fill: "#fbbf24" },
                          { status: "Completed", fill: "#34d399" },
                          { status: "Approved",  fill: "#a78bfa" },
                          { status: "On Hold",   fill: "#f87171" },
                        ].map((entry) => (
                          <Cell key={entry.status} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
            }
          </div>

          {/* Compare Analytics */}
          <div className="u d4">
            <CompareUsageChart />
          </div>

        </div>

        {/* ╔══════════ COL 3 — sidebar ══════════╗ */}
        <div className="db-col3 flex flex-col gap-4 min-w-0">

          {/* System Overview — concentric donut */}
          <div className={`${C} u d2 p-4`}>
            <p className="text-[13px] font-bold mb-4" style={{color:"var(--c-txt)"}}>System Overview</p>
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <Donut segs={ringSegs} size={110} />
              </div>
              <div className="flex flex-col gap-2.5 flex-1 min-w-0">
                {RING_C.map((r, i) => (
                  <div key={r.l} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:r.color}}/>
                      <span className="text-[11px]" style={{color:"var(--c-sub)"}}>{r.l}</span>
                    </div>
                    <span className="jb text-[11px] font-medium" style={{color:"var(--c-txt)"}}>
                      {sumOf4 > 0 ? Math.round(((ringSegs[i]?.raw ?? 0) / sumOf4) * 100) : 0}%
                    </span>
                  </div>
                ))}
                <p className="text-[10px] leading-relaxed mt-1 pt-2" style={{borderTop:"1px solid var(--c-b)", color:"var(--c-sub)"}}>
                  System utilisation across key resource categories.
                </p>
              </div>
            </div>
          </div>

          {/* ── Pipeline ── */}
          <div className={`${C} u d3 p-4`}>
            <p className="text-[13px] font-bold mb-1" style={{color:"var(--c-txt)"}}>Pipeline</p>
            <p className="text-[11px] mb-3" style={{color:"var(--c-sub)"}}>Feature activity · all time</p>
            {(() => {
              const features = [
                { label: "BRD Sources", short: "BRD",   count: totalBrds,  color: "#2563eb" },
                { label: "Users",       short: "Users", count: totalUsers, color: "#0f766e" },
              ];
              const maxVal = Math.max(...features.map(f => f.count), 1);
              const W = 280, H = 150;
              const positions = [{ cx: 90, cy: 75 }, { cx: 200, cy: 75 }];
              return (
                <>
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
                    <defs>
                      {features.map((f, i) => (
                        <radialGradient key={i} id={`bg${i}`} cx="35%" cy="35%" r="65%">
                          <stop offset="0%" stopColor={f.color} stopOpacity="0.55" />
                          <stop offset="100%" stopColor={f.color} stopOpacity="0.18" />
                        </radialGradient>
                      ))}
                    </defs>
                    {features.map((f, i) => {
                      const r = 28 + ((f.count / maxVal) * 34);
                      const p = positions[i];
                      return (
                        <g key={f.label} className={`bubble-${i}`}>
                          <circle cx={p.cx} cy={p.cy} r={r + 8} fill="none" stroke={f.color} strokeWidth="1" opacity="0.1" />
                          <circle cx={p.cx} cy={p.cy} r={r} fill={`url(#bg${i})`} stroke={f.color} strokeWidth="1.5" strokeOpacity="0.6" />
                          <text x={p.cx} y={p.cy - 3} textAnchor="middle" fontSize={r > 44 ? 18 : 14} fontWeight="700" fill={f.color} fontFamily="'JetBrains Mono',monospace" style={{ filter: "brightness(1.4)" }}>{f.count}</text>
                          <text x={p.cx} y={p.cy + (r > 44 ? 14 : 12)} textAnchor="middle" fontSize="9" fontWeight="600" fill={f.color} fontFamily="'Plus Jakarta Sans',sans-serif" opacity="0.9">{f.short}</text>
                        </g>
                      );
                    })}
                  </svg>
                  <div style={{ display: "flex", gap: "6px 14px", marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--c-b)" }}>
                    {features.map(f => (
                      <span key={f.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--c-sub)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: f.color, flexShrink: 0, display: "inline-block" }} />
                        {f.label}
                      </span>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          {/* Balance */}
          {(() => {
            const balanceTotalPages = Math.max(1, Math.ceil(brds.length / BALANCE_PAGE_SIZE));
            const safeBalancePage = Math.min(balancePage, balanceTotalPages);
            const pagedBrds = brds.slice((safeBalancePage - 1) * BALANCE_PAGE_SIZE, safeBalancePage * BALANCE_PAGE_SIZE);
            const STATUS_COLOR: Record<string,string> = {
              COMPLETED:"#4ade80", APPROVED:"#818cf8", DRAFT:"#93c5fd",
              PAUSED:"#fbbf24", ON_HOLD:"#f87171",
            };
            return (
              <div className={`${C} u d2 p-4`}>
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[13px] font-bold" style={{color:"var(--c-txt)"}}>Balance</p>
                  <span style={{color:"var(--c-dim)"}}>···</span>
                </div>
                <p className="text-[9.5px] font-bold uppercase tracking-widest mb-1" style={{color:"var(--c-sub)"}}>Total BRD Sources</p>
                <p className="jb text-[24px] font-bold mb-3" style={{color:"var(--c-txt)"}}>
                  <CountUp to={totalBrds} />
                </p>
                {/* Continent mini-breakdown */}
                {brdByContinent.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {brdByContinent.map(r => (
                      <span key={r.region} className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full jb"
                        style={{ background:"var(--c-acc-lo)", color:"var(--c-acc)" }}>
                        {r.region} · {r.count}
                      </span>
                    ))}
                  </div>
                )}
                {brds.length === 0
                  ? <p className="text-[11px] text-center py-3" style={{color:"var(--c-dim)"}}>No sources yet</p>
                  : <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {pagedBrds.map((b, i) => {
                          const rank = (safeBalancePage - 1) * BALANCE_PAGE_SIZE + i + 1;
                          return (
                            <div key={b.id} className="u rounded-[13px] p-3.5 flex-shrink-0"
                              style={{
                                background: dark ? "#101d34" : "#f8fafc",
                                border: `1px solid ${dark ? "#24344f" : "#e2e8f0"}`,
                                animationDelay:`${.08+i*.04}s`
                              }}>
                              {/* Top row: BRD badge + geography */}
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[8px] font-black tracking-[.12em] px-1.5 py-0.5 rounded-[4px]"
                                  style={{ background: dark ? "rgba(96,165,250,.14)" : "rgba(37,99,235,.08)", color: "var(--c-a)" }}>
                                  #{rank}
                                </span>
                                <span className="text-[10px]" style={{ color:"var(--c-sub)" }}>
                                  {b.geography || "—"}
                                </span>
                              </div>
                              {/* Real display title */}
                              <p className="text-[13px] font-bold leading-snug truncate" style={{ color:"var(--c-txt)" }}>
                                {brdDisplayTitle(b)}
                              </p>
                              {/* ID · real status (colored) */}
                              <div className="flex items-center justify-between mt-1.5">
                                <span className="jb text-[9px]" style={{ color:"var(--c-dim)" }}>
                                  {b.id} · {b.format?.toUpperCase()}
                                </span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                  style={{
                                    background: dark ? "rgba(15,23,42,.52)" : "rgba(15,23,42,.07)",
                                    color: STATUS_COLOR[b.status] ?? "var(--c-txt)"
                                  }}>
                                  {b.status}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Pagination controls */}
                      {balanceTotalPages > 1 && (
                        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop:"1px solid var(--c-b)" }}>
                          <span className="jb text-[10px]" style={{ color:"var(--c-dim)" }}>
                            {(safeBalancePage - 1) * BALANCE_PAGE_SIZE + 1}–{Math.min(safeBalancePage * BALANCE_PAGE_SIZE, brds.length)} / {brds.length}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setBalancePage(p => Math.max(1, p - 1))}
                              disabled={safeBalancePage === 1}
                              className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] transition-colors"
                              style={{ background:"var(--c-bg)", border:"1px solid var(--c-b)",
                                color: safeBalancePage === 1 ? "var(--c-dim)" : "var(--c-sub)",
                                cursor: safeBalancePage === 1 ? "not-allowed" : "pointer" }}
                            >←</button>
                            <span className="jb text-[10px]" style={{ color:"var(--c-sub)" }}>
                              {safeBalancePage} / {balanceTotalPages}
                            </span>
                            <button
                              onClick={() => setBalancePage(p => Math.min(balanceTotalPages, p + 1))}
                              disabled={safeBalancePage >= balanceTotalPages}
                              className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] transition-colors"
                              style={{ background:"var(--c-bg)", border:"1px solid var(--c-b)",
                                color: safeBalancePage >= balanceTotalPages ? "var(--c-dim)" : "var(--c-sub)",
                                cursor: safeBalancePage >= balanceTotalPages ? "not-allowed" : "pointer" }}
                            >→</button>
                          </div>
                        </div>
                      )}
                    </>
                }
              </div>
            );
          })()}



        </div>
      </div>
    </div>
  );
}