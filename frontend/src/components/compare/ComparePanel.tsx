"use client";
import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from "react";
import type { PdfChunk } from "./ChunkPanel";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JobState   { job_id: string; status?: string }
export interface ChangeSummary { addition: number; removal: number; modification: number; emphasis: number }

export interface DetectedChange {
  id: string;
  type: "addition" | "removal" | "modification" | "emphasis" | "mismatch";
  text: string;
  old_text: string | null;
  new_text: string | null;
  page: number;
  old_page?: number | null;
  new_page?: number | null;
  bbox?: number[] | null;
  old_bbox?: number[] | null;
  new_bbox?: number[] | null;
  old_formatting?: Record<string, unknown> | null;
  new_formatting?: Record<string, unknown> | null;
  emphasis?: string[];
  suggested_xml?: string | null;
  word_diff?: WordDiffResult | null;
  baseline?: string;
}

export interface WordDiffToken  { text: string; type: "equal" | "insert" | "delete" }
export interface WordDiffResult {
  tokens: WordDiffToken[]; has_changes: boolean; change_ratio: number;
  summary: { addition: number; removal: number; modification: number };
  old_word_count: number; new_word_count: number;
}
export interface DetectSummary {
  addition: number; removal: number; modification: number; emphasis: number; mismatch?: number;
}

interface ComparePanelProps {
  initialChunk?:      PdfChunk | null;
  initialOldPdf?:     File | null;
  initialNewPdf?:     File | null;
  initialXmlFile?:    File | null;
  allChunks?:         PdfChunk[];
  onChunkDone?:       (chunk: PdfChunk) => void;
  onNavigateToChunk?: (chunk: PdfChunk) => void;
  activeJob?:         JobState | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME — injected CSS, adaptive dark/light via custom properties
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
/* ── DARK (default) ── */
.cp-wrap {
  --bg:       #0d1117;
  --bg2:      #161b22;
  --bg3:      #1c2330;
  --bg4:      #21262d;
  --bd:       #30363d;
  --fg:       #e6edf3;
  --fg2:      #8b949e;
  --fg3:      #484f58;
  --ac:       #58a6ff;
  --ac2:      #1f6feb;
  --red:      #f85149;
  --grn:      #3fb950;
  --yel:      #e3b341;
  --vio:      #a371f7;
  /* change row highlight backgrounds */
  --add-bg:   rgba(63,185,80,.18);
  --del-bg:   rgba(248,81,73,.18);
  --mod-bg:   rgba(227,179,65,.14);
  --emp-bg:   rgba(163,113,247,.14);
  /* word-diff pastels */
  --add-hi:   #ccffd8; --add-fg: #1a4d2e;
  --del-hi:   #ffd7d5; --del-fg: #6e1c1a;
  --mod-hi:   #fff3b0; --mod-fg: #5a3e00;
  --emp-hi:   #ead8ff; --emp-fg: #3d007a;
  /* sidebar pill (selected row bg) */
  --pill-add: #1a5c1a;
  --pill-del: #7a1010;
  --pill-mod: #7a5000;
  --pill-emp: #4a007a;
  /* text pane */
  --pane-bg:  #ffffff;
  --pane-fg:  #111111;
  /* XML */
  --xml-bg:   #0f141a;
  --xml-ln:   #484f58;
  --xml-fg:   #dce3ea;
  --xml-hl:   rgba(88,166,255,.2);
  --xml-hbd:  #58a6ff;
  /* status */
  --stat-bg:  #1f6feb;
  --scr:      #30363d;
}
/* ── LIGHT ── */
@media (prefers-color-scheme:light){ .cp-wrap {
  --bg:       #f6f8fa;
  --bg2:      #ffffff;
  --bg3:      #eaeef2;
  --bg4:      #d0d7de;
  --bd:       #d0d7de;
  --fg:       #1f2328;
  --fg2:      #57606a;
  --fg3:      #8c959f;
  --ac:       #0969da;
  --ac2:      #ddf4ff;
  --red:      #cf222e;
  --grn:      #1a7f37;
  --yel:      #9a6700;
  --vio:      #8250df;
  --add-bg:   rgba(26,127,55,.12);
  --del-bg:   rgba(207,34,46,.12);
  --mod-bg:   rgba(154,103,0,.10);
  --emp-bg:   rgba(130,80,223,.10);
  --add-hi:   #dafbe1; --add-fg: #1a7f37;
  --del-hi:   #ffd7d5; --del-fg: #cf222e;
  --mod-hi:   #fff8c5; --mod-fg: #9a6700;
  --emp-hi:   #fbefff; --emp-fg: #8250df;
  --pill-add: #1a7f37;
  --pill-del: #cf222e;
  --pill-mod: #9a6700;
  --pill-emp: #8250df;
  --pane-bg:  #ffffff;
  --pane-fg:  #111111;
  --xml-bg:   #ffffff;
  --xml-ln:   #8c959f;
  --xml-fg:   #1f2328;
  --xml-hl:   rgba(9,105,218,.12);
  --xml-hbd:  #0969da;
  --stat-bg:  #0969da;
  --scr:      #c8d1da;
}}
/* ── .dark class ── */
.dark .cp-wrap {
  --bg:#0d1117;--bg2:#161b22;--bg3:#1c2330;--bg4:#21262d;
  --bd:#30363d;--fg:#e6edf3;--fg2:#8b949e;--fg3:#484f58;
  --ac:#58a6ff;--ac2:#1f6feb;--red:#f85149;--grn:#3fb950;--yel:#e3b341;--vio:#a371f7;
  --add-bg:rgba(63,185,80,.18);--del-bg:rgba(248,81,73,.18);--mod-bg:rgba(227,179,65,.14);--emp-bg:rgba(163,113,247,.14);
  --add-hi:#ccffd8;--add-fg:#1a4d2e;--del-hi:#ffd7d5;--del-fg:#6e1c1a;
  --mod-hi:#fff3b0;--mod-fg:#5a3e00;--emp-hi:#ead8ff;--emp-fg:#3d007a;
  --pill-add:#1a5c1a;--pill-del:#7a1010;--pill-mod:#7a5000;--pill-emp:#4a007a;
  --pane-bg:#ffffff;--pane-fg:#111111;
  --xml-bg:#0f141a;--xml-ln:#484f58;--xml-fg:#dce3ea;
  --xml-hl:rgba(88,166,255,.2);--xml-hbd:#58a6ff;
  --stat-bg:#1f6feb;--scr:#30363d;
}

/* scrollbars */
.cp-wrap ::-webkit-scrollbar            { width:7px;height:7px }
.cp-wrap ::-webkit-scrollbar-track     { background:transparent }
.cp-wrap ::-webkit-scrollbar-thumb     { background:var(--scr);border-radius:4px }
.cp-wrap ::-webkit-scrollbar-thumb:hover{ background:var(--fg3) }

/* interactive */
.cp-row          { transition:background .07s;cursor:pointer;user-select:none }
.cp-row:hover    { background:var(--bg3) !important }
.cp-hsash        { height:5px;flex-shrink:0;cursor:row-resize;background:var(--bd);display:flex;align-items:center;justify-content:center }
.cp-hsash:hover  { background:var(--ac2) }
.cp-vsash        { width:1px;flex-shrink:0;cursor:col-resize;background:var(--bd) }
.cp-btn          { cursor:pointer;border:none;font-family:Consolas,monospace;font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;transition:all .1s }
.cp-btn-pri      { background:var(--ac2);color:var(--fg) }
.cp-btn-pri:hover{ background:var(--ac) }
.cp-btn-sec      { background:var(--bg4);color:var(--fg2) }
.cp-btn-sec:hover{ background:var(--bg3);color:var(--fg) }
.cp-tab          { cursor:pointer;border:none;font-family:Consolas,monospace;font-size:10px;font-weight:700;padding:3px 11px;border-radius:3px;transition:all .1s }
.cp-tab-on       { background:var(--ac2);color:var(--fg) }
.cp-tab-off      { background:transparent;color:var(--fg3) }
.cp-tab-off:hover{ background:var(--bg4);color:var(--fg2) }

/* XML syntax */
.xg{ color:#7ee787 } .xa{ color:#79c0ff } .xs{ color:#a5d6ff } .xc{ color:#8b949e;font-style:italic } .xt{ color:var(--xml-fg) }
@media (prefers-color-scheme:light){ .xg{color:#116329} .xa{color:#0550ae} .xs{color:#0a3069} .xc{color:#6e7781} }
.dark .xg{color:#7ee787} .dark .xa{color:#79c0ff} .dark .xs{color:#a5d6ff} .dark .xc{color:#8b949e}
`;

const API = process.env.NEXT_PUBLIC_PROCESSING_URL ?? "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE META
// ─────────────────────────────────────────────────────────────────────────────

type CT = "addition"|"removal"|"modification"|"emphasis"|"mismatch";
const CM: Record<CT,{pfx:string;fg:string;bg:string;pill:string;hiBg:string;hiFg:string;lbl:string}> = {
  addition:     {pfx:"+ ",fg:"var(--grn)",bg:"var(--add-bg)",pill:"var(--pill-add)",hiBg:"var(--add-hi)",hiFg:"var(--add-fg)",lbl:"Add"},
  removal:      {pfx:"- ",fg:"var(--red)",bg:"var(--del-bg)",pill:"var(--pill-del)",hiBg:"var(--del-hi)",hiFg:"var(--del-fg)",lbl:"Del"},
  modification: {pfx:"~ ",fg:"var(--yel)",bg:"var(--mod-bg)",pill:"var(--pill-mod)",hiBg:"var(--mod-hi)",hiFg:"var(--mod-fg)",lbl:"Mod"},
  emphasis:     {pfx:"o ",fg:"var(--vio)",bg:"var(--emp-bg)",pill:"var(--pill-emp)",hiBg:"var(--emp-hi)",hiFg:"var(--emp-fg)",lbl:"Emp"},
  mismatch:     {pfx:"≠ ",fg:"var(--yel)",bg:"var(--mod-bg)",pill:"var(--pill-mod)",hiBg:"var(--mod-hi)",hiFg:"var(--mod-fg)",lbl:"Mis"},
};

// ─────────────────────────────────────────────────────────────────────────────
// TEXT PANE  — renders extracted PDF text like extractor.py's tk.Text widget.
// Lines that match a DetectedChange are highlighted with the right colour.
// Clicking a highlighted line fires onLineClick so the sidebar can jump.
// ─────────────────────────────────────────────────────────────────────────────

interface TextPaneProps {
  text:        string;
  label:       string;
  filename?:   string;
  side:        "a" | "b";
  changes:     DetectedChange[];
  selChange:   DetectedChange | null;
  navText?:    string;   // text to scroll-into-view (the selected change probe)
  onLineClick: (change: DetectedChange) => void;
}

function TextPane({ text, label, filename, side, changes, selChange, navText, onLineClick }: TextPaneProps) {
  const isA       = side === "a";
  const labelClr  = isA ? "var(--ac)" : "var(--grn)";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlRef        = useRef<HTMLDivElement | null>(null);

  // Scroll to nav target when selChange changes
  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [navText]);

  // Build a map: normalised probe text → change (for highlighting)
  const probeMap = useMemo(() => {
    const m = new Map<string, DetectedChange>();
    for (const ch of changes) {
      const probe = (side === "a"
        ? (ch.old_text || ch.text)
        : (ch.new_text || ch.old_text || ch.text)
      )?.trim().toLowerCase().slice(0, 120);
      if (probe) m.set(probe, ch);
    }
    return m;
  }, [changes, side]);

  const lines = useMemo(() => text ? text.split("\n") : [], [text]);

  // nav probe (normalised)
  const navProbe = navText?.trim().toLowerCase().slice(0, 120) ?? "";

  if (!text) {
    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0, background:"var(--bg)" }}>
        <PaneHeader label={label} filename={filename} labelClr={labelClr} />
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--fg3)", fontFamily:"Consolas,monospace", fontSize:12 }}>
          No text extracted
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0, background:"var(--bg)" }}>
      <PaneHeader label={label} filename={filename} labelClr={labelClr} />

      {/* Scrollable text body — white page background like extractor.py PAGE_BG */}
      <div ref={containerRef} style={{ flex:1, overflowY:"auto", background:"var(--pane-bg)" }}>
        <div style={{ padding:"8px 12px", fontFamily:"Consolas,monospace", fontSize:11, lineHeight:"18px" }}>
          {lines.map((line, i) => {
            if (!line.trim()) {
              return <div key={i} style={{ height:4 }} />;
            }
            // Match this line to a change
            const normLine = line.trim().toLowerCase().slice(0, 120);
            let matchedCh: DetectedChange | null = null;
            for (const [probe, ch] of probeMap.entries()) {
              if (normLine.includes(probe) || probe.includes(normLine)) {
                matchedCh = ch;
                break;
              }
            }

            // Is this the selected / nav line?
            const isNav = navProbe.length > 4 && (normLine.includes(navProbe.slice(0,60)) || navProbe.includes(normLine.slice(0,60)));
            const isSel = matchedCh && selChange && matchedCh.id === selChange.id;

            const m = matchedCh ? CM[matchedCh.type] : null;

            return (
              <div
                key={i}
                ref={isNav ? ((el: HTMLDivElement | null) => { hlRef.current = el; }) : undefined}
                onClick={() => matchedCh && onLineClick(matchedCh)}
                style={{
                  padding: "1px 4px",
                  borderRadius: 2,
                  background: isSel
                    ? (m?.pill ?? "transparent")
                    : m
                      ? m.bg
                      : "transparent",
                  color: isSel
                    ? "#ffffff"
                    : m
                      ? "var(--pane-fg)"
                      : "var(--pane-fg)",
                  cursor: matchedCh ? "pointer" : "default",
                  borderLeft: m ? `3px solid ${m.fg}` : "3px solid transparent",
                  marginBottom: 1,
                  transition: "background .08s",
                }}
              >
                {m && (
                  <span style={{ color: m.fg, fontWeight:700, fontSize:10, marginRight:4 }}>
                    {m.pfx.trim()}
                  </span>
                )}
                {line}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PaneHeader({ label, filename, labelClr }: { label:string; filename?:string; labelClr:string }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"3px 10px", background:"var(--bg3)", flexShrink:0,
      borderBottom:"1px solid var(--bd)",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0, overflow:"hidden" }}>
        <span style={{ color:labelClr, fontFamily:"Consolas,monospace", fontSize:11, fontWeight:700, flexShrink:0 }}>
          {label}
        </span>
        {filename && (
          <span style={{ color:"var(--fg3)", fontFamily:"Consolas,monospace", fontSize:10, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {filename}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// XML VIEWER  — code-editor style with syntax highlight + line numbers
// ─────────────────────────────────────────────────────────────────────────────

function XmlLine({ line }: { line: string }) {
  const out: React.ReactNode[] = [];
  let rest = line; let k = 0;
  while (rest.length > 0) {
    if (rest.startsWith("<!--")) {
      const e = rest.indexOf("-->")+3;
      out.push(<span key={k++} className="xc">{rest.slice(0, e<3?rest.length:e)}</span>);
      rest = e<3?"":rest.slice(e);
    } else if (rest[0]==="<") {
      const gi = rest.indexOf(">");
      if (gi===-1){out.push(<span key={k++} className="xg">{rest}</span>);break;}
      const tag = rest.slice(0,gi+1);
      const m = tag.match(/^(<\/?)([\w:.-]*)([\s\S]*)(\/?>\s*)$/);
      if (m){
        out.push(<span key={k++} className="xt">{m[1]}</span>);
        out.push(<span key={k++} className="xg">{m[2]}</span>);
        const as=m[3]; const ar=/([^\s=]+)(=)("([^"]*)")/g; let lA=0; let am:RegExpExecArray|null;
        while((am=ar.exec(as))!==null){
          if(am.index>lA)out.push(<span key={k++} className="xt">{as.slice(lA,am.index)}</span>);
          out.push(<span key={k++} className="xa">{am[1]}</span>);
          out.push(<span key={k++} className="xt">{am[2]}</span>);
          out.push(<span key={k++} className="xs">{am[3]}</span>);
          lA=ar.lastIndex;
        }
        if(lA<as.length)out.push(<span key={k++} className="xt">{as.slice(lA)}</span>);
        out.push(<span key={k++} className="xt">{m[4]}</span>);
      }else out.push(<span key={k++} className="xg">{tag}</span>);
      rest=rest.slice(gi+1);
    }else{
      const ni=rest.indexOf("<"); const t=ni===-1?rest:rest.slice(0,ni);
      out.push(<span key={k++} className="xt">{t}</span>);
      rest=ni===-1?"":rest.slice(ni);
    }
  }
  return <>{out}</>;
}

function XmlViewer({ content, hlText }: { content:string; hlText?:string }) {
  const hlRef = useRef<HTMLTableRowElement|null>(null);
  const hl = (hlText??"").trim().toLowerCase();
  useEffect(()=>{ hlRef.current?.scrollIntoView({block:"center",behavior:"smooth"}); },[hlText]);

  if(!content) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--fg3)",fontFamily:"Consolas,monospace",fontSize:12}}>
      No XML loaded
    </div>
  );
  const lines = content.split("\n");
  const firstHighlightedIndex = hl.length > 2
    ? lines.findIndex((line) => line.toLowerCase().includes(hl))
    : -1;
  return (
    <div style={{flex:1,overflow:"auto",background:"var(--xml-bg)"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"Consolas,monospace",fontSize:12,lineHeight:"20px"}}>
        <tbody>
          {lines.map((line,i)=>{
            const isHl=hl.length>2&&line.toLowerCase().includes(hl);
            const isFirst=isHl&&firstHighlightedIndex===i;
            return (
              <tr key={i}
                ref={isFirst ? ((el: HTMLTableRowElement | null) => { hlRef.current = el; }) : undefined}
                style={{background:isHl?"var(--xml-hl)":"transparent",borderLeft:isHl?"3px solid var(--xml-hbd)":"3px solid transparent"}}
              >
                <td style={{width:46,paddingRight:10,paddingLeft:8,textAlign:"right",color:"var(--xml-ln)",userSelect:"none",borderRight:"1px solid var(--bd)",verticalAlign:"top"}}>
                  {i+1}
                </td>
                <td style={{paddingLeft:14,paddingRight:8,whiteSpace:"pre",verticalAlign:"top"}}>
                  <XmlLine line={line}/>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE SIDEBAR ROW
// ─────────────────────────────────────────────────────────────────────────────

function ChangeRow({ch,sel,onClick}:{ch:DetectedChange;sel:boolean;onClick:()=>void}) {
  const m = CM[ch.type]??CM.modification;
  const snippet=((ch.new_text||ch.old_text||ch.text)??"").replace(/\s+/g," ").trim().slice(0,58);
  const pg=ch.old_page||ch.new_page;
  return (
    <div className="cp-row" onClick={onClick} style={{
      padding:"4px 10px",
      background:sel?m.pill:"transparent",
      borderLeft:sel?`3px solid ${m.fg}`:"3px solid transparent",
    }}>
      <span style={{color:m.fg,fontFamily:"Consolas,monospace",fontSize:12,fontWeight:700}}>{m.pfx}</span>
      <span style={{color:sel?"#fff":"var(--fg)",fontFamily:"Consolas,monospace",fontSize:11}}>
        {snippet}{snippet.length>=58?"…":""}
      </span>
      {pg&&<span style={{color:sel?"#ccc":"var(--fg3)",fontFamily:"Consolas,monospace",fontSize:10}}> p.{pg}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE DETAIL (bottom panel)
// ─────────────────────────────────────────────────────────────────────────────

function WDiff({result,side}:{result:WordDiffResult;side:"old"|"new"}) {
  return (
    <span style={{fontFamily:"Consolas,monospace",fontSize:12,lineHeight:1.7,wordBreak:"break-word"}}>
      {result.tokens.map((tok,i)=>{
        if(tok.type==="equal") return <span key={i} style={{color:"var(--fg2)"}}>{tok.text} </span>;
        if(side==="old"&&tok.type==="delete")
          return <span key={i} style={{background:"var(--del-hi)",color:"var(--del-fg)",borderRadius:3,padding:"0 3px",textDecoration:"line-through"}}>{tok.text} </span>;
        if(side==="new"&&tok.type==="insert")
          return <span key={i} style={{background:"var(--add-hi)",color:"var(--add-fg)",borderRadius:3,padding:"0 3px"}}>{tok.text} </span>;
        return null;
      })}
    </span>
  );
}

function DBlock({label,fg,bg,children}:{label:string;fg:string;bg:string;children:React.ReactNode}) {
  return (
    <div style={{background:bg,border:`1px solid ${fg}`,borderRadius:4,padding:"7px 10px",marginBottom:6}}>
      <div style={{color:fg,fontFamily:"Consolas,monospace",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:4}}>{label}</div>
      {children}
    </div>
  );
}

function ChangeDetail({ch}:{ch:DetectedChange}) {
  const m=CM[ch.type]??CM.modification;
  const wd=(ch.word_diff?.tokens?.length??0)>0;
  return (
    <div style={{padding:"10px 14px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap",fontFamily:"Consolas,monospace"}}>
        <span style={{background:m.pill,color:"#fff",fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:3}}>
          {m.pfx.trim()} {m.lbl.toUpperCase()}
        </span>
        {ch.old_page&&<span style={{color:"var(--red)",fontSize:10}}>Old p.{ch.old_page}</span>}
        {ch.new_page&&<span style={{color:"var(--grn)",fontSize:10}}>New p.{ch.new_page}</span>}
        {ch.emphasis?.map(e=>(
          <span key={e} style={{background:"var(--pill-emp)",color:"#fff",fontSize:9,padding:"1px 6px",borderRadius:3}}>{e}</span>
        ))}
      </div>
      {wd?(
        <>
          {ch.old_text&&<DBlock label="BEFORE" fg="var(--red)" bg="var(--del-bg)"><WDiff result={ch.word_diff!} side="old"/></DBlock>}
          {ch.new_text&&<DBlock label="AFTER"  fg="var(--grn)" bg="var(--add-bg)"><WDiff result={ch.word_diff!} side="new"/></DBlock>}
        </>
      ):(
        <>
          {(ch.old_text||ch.type==="removal")&&(
            <DBlock label="BEFORE" fg="var(--red)" bg="var(--del-bg)">
              <span style={{color:"var(--fg)",fontFamily:"Consolas,monospace",fontSize:12,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{ch.old_text??ch.text}</span>
            </DBlock>
          )}
          {(ch.new_text||ch.type==="addition")&&(
            <DBlock label="AFTER" fg="var(--grn)" bg="var(--add-bg)">
              <span style={{color:"var(--fg)",fontFamily:"Consolas,monospace",fontSize:12,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{ch.new_text??ch.text}</span>
            </DBlock>
          )}
          {ch.type==="emphasis"&&(
            <DBlock label="TEXT" fg="var(--vio)" bg="var(--emp-bg)">
              <span style={{color:"var(--fg)",fontFamily:"Consolas,monospace",fontSize:12,whiteSpace:"pre-wrap"}}>{ch.text}</span>
            </DBlock>
          )}
        </>
      )}
      {ch.suggested_xml&&(
        <DBlock label="SUGGESTED XML" fg="var(--fg3)" bg="var(--bg3)">
          <span style={{color:"var(--ac)",fontFamily:"Consolas,monospace",fontSize:12,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{ch.suggested_xml}</span>
        </DBlock>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

export default function ComparePanel({
  initialChunk,
  initialOldPdf: _op,
  initialNewPdf: _np,
  allChunks = [],
  onChunkDone,
  activeJob,
}: ComparePanelProps) {

  // Old/new PDF files kept for filename display only — no iframe rendering
  const [oldFilename] = useState<string|null>((_op as File|null)?.name ?? null);
  const [newFilename] = useState<string|null>((_np as File|null)?.name ?? null);

  const [chunks,  setChunks]   = useState<PdfChunk[]>(allChunks);
  const [jobId,   setJobId]    = useState<string|null>(activeJob?.job_id ?? null);
  const [selChunk,setSelChunk] = useState<PdfChunk|null>(initialChunk??null);
  const [changes, setChanges]  = useState<DetectedChange[]>([]);
  const [xmlContent,setXmlContent] = useState("");
  const [oldText, setOldText]  = useState("");   // extracted plain text for Doc A pane
  const [newText, setNewText]  = useState("");   // extracted plain text for Doc B pane
  const [loading, setLoading]  = useState(false);
  const [selIdx,  setSelIdx]   = useState<number|null>(null);
  const [error,   setError]    = useState<string|null>(null);
  const [filter,  setFilter]   = useState("all");
  const [sideOpen,setSideOpen] = useState(true);
  const [botTab,  setBotTab]   = useState<"detail"|"xml">("detail");

  // Resizable split between text panes and bottom panel
  const [pdfH, setPdfH] = useState(440);
  const onSashDown = useCallback((e:React.MouseEvent)=>{
    e.preventDefault(); let last=e.clientY;
    const move=(ev:MouseEvent)=>{setPdfH(h=>Math.max(120,Math.min(780,h+ev.clientY-last)));last=ev.clientY;};
    const up=()=>{document.body.style.cursor="";document.body.style.userSelect="";window.removeEventListener("mousemove",move);window.removeEventListener("mouseup",up);};
    document.body.style.cursor="row-resize"; document.body.style.userSelect="none";
    window.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
  },[]);

  // sync props
  useEffect(()=>{if(initialChunk)setSelChunk(initialChunk);},[initialChunk]);
  useEffect(()=>{if(allChunks.length)setChunks(allChunks);},[allChunks]);
  useEffect(()=>{if(activeJob?.job_id)setJobId(activeJob.job_id);},[activeJob]);
  useEffect(()=>{
    if(initialChunk&&(initialChunk.detected_changes?.length||jobId))openChunk(initialChunk);
  },[]); // eslint-disable-line

  async function openChunk(chunk:PdfChunk) {
    setSelChunk(chunk); setSelIdx(null); setChanges([]); setError(null);
    setOldText(""); setNewText("");

    // Prefill text from chunk if available
    if(chunk.old_text) setOldText(chunk.old_text);
    if(chunk.new_text) setNewText(chunk.new_text);

    if(chunk.detected_changes?.length){
      setChanges(chunk.detected_changes as DetectedChange[]);
      if(chunk.xml_content)setXmlContent(chunk.xml_content);
      return;
    }
    if(!jobId||!chunk.has_changes){
      if(!chunk.has_changes)setChanges([]);
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API}/compare/detect-chunk`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({job_id:jobId,chunk_index:chunk.index}),
      });
      const data = await res.json();
      if(!res.ok)throw new Error(data.detail??"Detection failed");
      setChanges(data.changes??[]);
      if(data.xml_content)setXmlContent(data.xml_content);
      // Use returned full texts if present (the backend sends them)
      if(data.old_full_text)setOldText(data.old_full_text);
      if(data.new_full_text)setNewText(data.new_full_text);
      const up:PdfChunk={...chunk,detected_changes:data.changes??[],detect_summary:data.summary,has_changes:(data.changes??[]).length>0};
      setChunks(prev=>prev.map(c=>c.index===chunk.index?up:c));
      onChunkDone?.(up);
    } catch(e:unknown){
      setError(e instanceof Error?e.message:"Detection failed");
    } finally {
      setLoading(false);
    }
  }

  function pickChange(i:number){
    const ch=filtered[i]; if(!ch)return;
    setSelIdx(i===selIdx?null:i);
    setBotTab("detail");
  }

  const filtered = useMemo(()=>filter==="all"?changes:changes.filter(c=>c.type===filter),[changes,filter]);

  const adds=changes.filter(c=>c.type==="addition").length;
  const dels=changes.filter(c=>c.type==="removal").length;
  const mods=changes.filter(c=>c.type==="modification").length;
  const emps=changes.filter(c=>c.type==="emphasis").length;
  const total=changes.length;

  const selChange=selIdx!==null?filtered[selIdx]:null;
  const navText=selChange?(selChange.new_text||selChange.old_text||selChange.text||""):"";
  const xmlHl=navText;

  // ── Keyboard nav (↑/↓ changes) ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = selIdx === null ? 0 : Math.min(filtered.length - 1, selIdx + 1);
        setSelIdx(next); setBotTab("detail");
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = selIdx === null ? 0 : Math.max(0, selIdx - 1);
        setSelIdx(prev); setBotTab("detail");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered.length, selIdx]);

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="cp-wrap" style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0,background:"var(--bg)",overflow:"hidden",fontFamily:"Consolas,monospace"}}>

        {/* ══ TOPBAR ══════════════════════════════════════════════════════ */}
        <div style={{display:"flex",alignItems:"center",gap:10,height:44,padding:"0 14px",flexShrink:0,background:"var(--bg2)",borderBottom:"1px solid var(--bd)"}}>
          <span style={{color:"var(--ac)",fontSize:13,fontWeight:700,letterSpacing:1.5,whiteSpace:"nowrap"}}>
            PDF DIFF INSPECTOR
          </span>
          <div style={{width:1,height:22,background:"var(--bd)",flexShrink:0}}/>
          <span style={{color:"var(--fg2)",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>
            {oldFilename?`Doc A: ${oldFilename}`:"Doc A: —"}
          </span>
          <span style={{color:"var(--fg3)",fontSize:14,flexShrink:0}}>⟷</span>
          <span style={{color:"var(--fg2)",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}>
            {newFilename?`Doc B: ${newFilename}`:"Doc B: —"}
          </span>
          <div style={{flex:1}}/>
          {chunks.length>0&&(
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{color:"var(--fg3)",fontSize:11,whiteSpace:"nowrap"}}>Chunk:</span>
              <select
                value={selChunk?.index??""}
                onChange={e=>{const c=chunks.find(c=>c.index===Number(e.target.value));if(c)openChunk(c);}}
                style={{background:"var(--bg4)",color:"var(--fg)",border:"1px solid var(--bd)",fontFamily:"Consolas,monospace",fontSize:11,padding:"3px 8px",borderRadius:4,cursor:"pointer",maxWidth:270}}
              >
                {!selChunk&&<option value="">— select chunk —</option>}
                {chunks.map(c=>(
                  <option key={c.index} value={c.index}>
                    {`#${String(c.index).padStart(2,"0")} ${c.has_changes?"Δ":"✓"} ${(c.old_heading_raw||c.old_heading||c.label).slice(0,46)}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {total>0&&(
            <span style={{color:"var(--fg3)",fontSize:11,whiteSpace:"nowrap"}}>
              {total} changes&nbsp;*&nbsp;+{adds}&nbsp;−{dels}&nbsp;~{mods}&nbsp;◎{emps}
            </span>
          )}
        </div>

        {error&&(
          <div style={{padding:"3px 14px",background:"#3d0f0f",borderBottom:"1px solid var(--bd)",color:"var(--red)",fontSize:11,flexShrink:0}}>
            ⚠ {error}
          </div>
        )}

        {/* ══ BODY ════════════════════════════════════════════════════════ */}
        <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>

          {/* ── CHANGES SIDEBAR ─────────────────────────────────────── */}
          {sideOpen?(
            <div style={{width:260,flexShrink:0,display:"flex",flexDirection:"column",background:"var(--bg2)",borderRight:"1px solid var(--bd)"}}>
              <div style={{padding:"8px 10px 5px",borderBottom:"1px solid var(--bd)",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{color:"var(--fg3)",fontSize:9,fontWeight:700,letterSpacing:1.5}}>CHANGES</span>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <span style={{color:"var(--fg3)",fontSize:11}}>{filtered.length}</span>
                    <button className="cp-btn cp-btn-sec" style={{padding:"1px 6px",fontSize:11}} onClick={()=>setSideOpen(false)}>‹</button>
                  </div>
                </div>
                <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                  {(["all","addition","removal","modification","emphasis"] as const).map(ft=>{
                    const cnt=ft==="all"?total:changes.filter(c=>c.type===ft).length;
                    if(ft!=="all"&&cnt===0)return null;
                    const m=ft==="all"?null:CM[ft]; const act=filter===ft;
                    return (
                      <button key={ft} onClick={()=>setFilter(ft)} style={{
                        padding:"1px 7px",borderRadius:3,border:"none",cursor:"pointer",
                        fontFamily:"Consolas,monospace",fontSize:9,fontWeight:700,
                        background:act?(m?.pill??"var(--ac2)"):"var(--bg4)",
                        color:act?"#fff":"var(--fg3)",transition:"all .1s",
                      }}>
                        {ft==="all"?`All ${cnt}`:`${m!.pfx.trim()} ${cnt}`}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{flex:1,overflowY:"auto"}}>
                {loading&&<div style={{padding:"10px 12px",color:"var(--ac)",fontSize:11}}>⟳ Detecting changes…</div>}
                {!loading&&filtered.length===0&&(
                  <div style={{padding:"18px 12px",color:"var(--fg3)",fontSize:11,textAlign:"center"}}>
                    {selChunk?(selChunk.has_changes?"No changes in filter":"✓ No changes detected"):"Select a chunk above"}
                  </div>
                )}
                {filtered.map((ch,i)=>(
                  <ChangeRow key={ch.id} ch={ch} sel={selIdx===i} onClick={()=>pickChange(i)}/>
                ))}
              </div>
              <div style={{padding:"7px 9px",borderTop:"1px solid var(--bd)",flexShrink:0,display:"flex",flexDirection:"column",gap:5}}>
                <button className="cp-btn cp-btn-pri" onClick={()=>setBotTab("xml")}>Apply → XML</button>
                <button className="cp-btn cp-btn-sec">Save Target XML…</button>
              </div>
            </div>
          ):(
            <div style={{width:22,flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",paddingTop:8,gap:6,background:"var(--bg2)",borderRight:"1px solid var(--bd)"}}>
              <button className="cp-btn cp-btn-sec" style={{padding:"1px 6px",fontSize:11}} onClick={()=>setSideOpen(true)}>›</button>
              {total>0&&<span style={{writingMode:"vertical-rl",color:"var(--fg3)",fontSize:9,fontWeight:700,letterSpacing:1}}>{total} CHG</span>}
            </div>
          )}

          {/* ── MAIN COLUMN ─────────────────────────────────────────── */}
          <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,minHeight:0}}>

            {/* Chunk info strip */}
            <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0,padding:"3px 12px",background:"var(--bg3)",borderBottom:"1px solid var(--bd)"}}>
              {selChunk?(
                <>
                  <span style={{color:"var(--fg3)",fontSize:10}}>#{String(selChunk.index).padStart(2,"00")}</span>
                  <span style={{color:"var(--fg)",fontSize:11,fontWeight:700,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {selChunk.old_heading_raw||selChunk.old_heading||selChunk.label}
                  </span>
                  {selChunk.has_changes
                    ?<span style={{background:"var(--pill-mod)",color:"#fff",fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:3,flexShrink:0}}>Changed</span>
                    :<span style={{color:"var(--grn)",fontSize:10,fontWeight:700,flexShrink:0}}>✓ No changes</span>
                  }
                </>
              ):(
                <span style={{color:"var(--fg3)",fontSize:11}}>No chunk selected — choose from the dropdown above</span>
              )}
            </div>

            {/* ── TEXT PANES (the main content area, NOT iframes!) ── */}
            <div style={{display:"flex",flexShrink:0,height:pdfH,borderBottom:"1px solid var(--bd)"}}>
              <TextPane
                text={oldText}
                label="Doc A  (original)"
                filename={oldFilename??undefined}
                side="a"
                changes={changes}
                selChange={selChange}
                navText={navText}
                onLineClick={ch=>{ const i=filtered.indexOf(ch); if(i>=0)pickChange(i); }}
              />
              <div className="cp-vsash"/>
              <TextPane
                text={newText}
                label="Doc B  (revised)"
                filename={newFilename??undefined}
                side="b"
                changes={changes}
                selChange={selChange}
                navText={navText}
                onLineClick={ch=>{ const i=filtered.indexOf(ch); if(i>=0)pickChange(i); }}
              />
            </div>

            {/* Resize sash */}
            <div className="cp-hsash" onMouseDown={onSashDown}>
              <div style={{width:36,height:2,borderRadius:1,background:"var(--fg3)"}}/>
            </div>

            {/* ── BOTTOM PANEL ─────────────────────────────────────── */}
            <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,height:30,padding:"0 12px",flexShrink:0,background:"var(--bg3)",borderBottom:"1px solid var(--bd)"}}>
                <span style={{color:"var(--ac)",fontSize:10,fontWeight:700,letterSpacing:0.5}}>XML Viewer / Apply Target</span>
                <span style={{color:"var(--fg3)",fontSize:10}}>{xmlContent?`${xmlContent.split("\n").length} lines`:"No XML loaded"}</span>
                <div style={{flex:1}}/>
                <button className={`cp-tab ${botTab==="detail"?"cp-tab-on":"cp-tab-off"}`} onClick={()=>setBotTab("detail")}>
                  Changes {total>0?`(${total})`:""}
                </button>
                <button className={`cp-tab ${botTab==="xml"?"cp-tab-on":"cp-tab-off"}`} onClick={()=>setBotTab("xml")}>
                  XML
                </button>
              </div>
              <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
                {botTab==="xml"?(
                  <XmlViewer content={xmlContent} hlText={xmlHl}/>
                ):(
                  <div style={{flex:1,overflowY:"auto"}}>
                    {selChange?(
                      <ChangeDetail ch={selChange}/>
                    ):(
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--fg3)",fontSize:12}}>
                        {loading?"⟳ Detecting changes…":"← Click a change in the sidebar to inspect"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ══ STATUS BAR ══════════════════════════════════════════════════ */}
        <div style={{height:22,flexShrink:0,display:"flex",alignItems:"center",paddingLeft:12,background:"var(--stat-bg)"}}>
          <span style={{color:"var(--fg)",fontSize:10}}>
            {selChunk
              ?`${oldFilename??"—"}  ↔  ${newFilename??"—"}  *  ${total} changes  *  click a change to jump`
              :"Load two PDFs to begin"}
          </span>
        </div>

      </div>
    </>
  );
}