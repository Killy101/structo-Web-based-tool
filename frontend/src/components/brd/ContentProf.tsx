import React, { useState } from "react";

interface LevelRow {
  id: string;
  levelNumber: string;
  description: string;
  redjayXmlTag: string;
  path: string;
  remarksNotes: string;
}

interface WhitespaceRow {
  id: string;
  tags: string;
  innodReplace: string;
}

const INITIAL_LEVELS: LevelRow[] = [];

const INITIAL_WHITESPACE: WhitespaceRow[] = [];

const LEVEL_COLUMNS = [
  { key: "levelNumber",  label: "Level Number",   width: "w-28",   icon: "⬡" },
  { key: "description",  label: "Description",    width: "flex-1", icon: "≡" },
  { key: "redjayXmlTag", label: "REDJAy XML Tag", width: "w-72",   icon: "◇" },
  { key: "path",         label: "Path",           width: "w-36",   icon: "↗" },
  { key: "remarksNotes", label: "Remarks / Notes",width: "w-48",   icon: "◈" },
];

const WS_COLUMNS = [
  { key: "tags",         label: "Tags",        width: "w-40",   icon: "⟨⟩" },
  { key: "innodReplace", label: "InnodReplace", width: "flex-1", icon: "↔" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-700/40 px-2 py-0.5 rounded" style={{ fontFamily: "'DM Mono', monospace" }}>
      {children}
    </span>
  );
}

function FieldRow({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="flex items-center border-b border-slate-100 dark:border-[#2a3147]">
      <div className="w-40 shrink-0 px-3 py-2 bg-slate-100 dark:bg-[#1e2235] border-r border-slate-200 dark:border-[#2a3147]">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>{label}</span>
      </div>
      <div className="flex-1 px-3 py-1.5">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`w-full bg-transparent text-[11.5px] text-slate-800 dark:text-slate-300 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600 ${mono ? "font-mono" : ""}`} />
      </div>
    </div>
  );
}

function ValidateButton() {
  return (
    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white dark:bg-[#1e2235] text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700/40 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      Validate
    </button>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
    </button>
  );
}

export default function ContentProfile() {
  const [rcFilename, setRcFilename] = useState("");
  const [hardcodedPath, setHardcodedPath] = useState("");
  const [headingAnnotation, setHeadingAnnotation] = useState("Level 2");

  const [levels, setLevels] = useState<LevelRow[]>(INITIAL_LEVELS);
  const [levelEditing, setLevelEditing] = useState<{ rowId: string; col: string } | null>(null);

  const [whitespace, setWhitespace] = useState<WhitespaceRow[]>(INITIAL_WHITESPACE);
  const [wsEditing, setWsEditing] = useState<{ rowId: string; col: string } | null>(null);

  const [saved, setSaved] = useState(false);

  function updateLevel(id: string, col: string, value: string) { setLevels((prev) => prev.map((r) => (r.id === id ? { ...r, [col]: value } : r))); }
  function addLevel() {
    const next = levels.length;
    const newRow: LevelRow = { id: Date.now().toString(), levelNumber: `Level ${next}`, description: "", redjayXmlTag: "", path: "", remarksNotes: "" };
    setLevels((prev) => [...prev, newRow]);
    setLevelEditing({ rowId: newRow.id, col: "description" });
  }
  function deleteLevel(id: string) { setLevels((prev) => prev.filter((r) => r.id !== id)); if (levelEditing?.rowId === id) setLevelEditing(null); }

  function updateWs(id: string, col: string, value: string) { setWhitespace((prev) => prev.map((r) => (r.id === id ? { ...r, [col]: value } : r))); }
  function addWs() {
    const newRow: WhitespaceRow = { id: Date.now().toString(), tags: "", innodReplace: "" };
    setWhitespace((prev) => [...prev, newRow]);
    setWsEditing({ rowId: newRow.id, col: "tags" });
  }
  function deleteWs(id: string) { setWhitespace((prev) => prev.filter((r) => r.id !== id)); if (wsEditing?.rowId === id) setWsEditing(null); }

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2000); }

  function renderLevelCell(row: LevelRow, col: string) {
    const isEditing = levelEditing?.rowId === row.id && levelEditing?.col === col;
    const value = row[col as keyof LevelRow] as string;
    if (isEditing) return <textarea autoFocus value={value} rows={1} onChange={(e) => updateLevel(row.id, col, e.target.value)} onBlur={() => setLevelEditing(null)} className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-none text-slate-700 dark:text-slate-200 leading-snug font-mono" />;
    const isMono = col === "redjayXmlTag" || col === "path";
    const isHardcoded = col === "redjayXmlTag" && value === "Hardcoded";
    return <div onClick={() => setLevelEditing({ rowId: row.id, col })} className={`cursor-pointer min-h-[24px] text-[11.5px] leading-snug line-clamp-2 hover:text-slate-900 dark:hover:text-slate-100 transition-colors ${isMono ? "font-mono" : ""} ${isHardcoded ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-slate-700 dark:text-slate-300"}`} title={value}>{value || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</div>;
  }

  function renderWsCell(row: WhitespaceRow, col: string) {
    const isEditing = wsEditing?.rowId === row.id && wsEditing?.col === col;
    const value = row[col as keyof WhitespaceRow] as string;
    if (isEditing) return <textarea autoFocus value={value} rows={1} onChange={(e) => updateWs(row.id, col, e.target.value)} onBlur={() => setWsEditing(null)} className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-blue-400 dark:border-blue-500 rounded px-2 py-1 outline-none resize-none text-slate-700 dark:text-slate-200 leading-snug font-mono" />;
    const isMono = col === "tags";
    return <div onClick={() => setWsEditing({ rowId: row.id, col })} className={`cursor-pointer min-h-[24px] text-[11.5px] leading-snug line-clamp-2 hover:text-slate-900 dark:hover:text-slate-100 transition-colors ${isMono ? "font-mono text-violet-700 dark:text-violet-400" : "text-slate-700 dark:text-slate-300"}`} title={value}>{value || <span className="text-slate-400 dark:text-slate-600 italic font-sans">—</span>}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>Content Profile</p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-500 mt-0.5">XML structure, heading levels &amp; whitespace rules</p>
        </div>
        <div className="flex items-center gap-2">
          <ValidateButton />
          <button onClick={handleSave} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${saved ? "bg-emerald-500 text-white" : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"}`}>
            {saved ? (<><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved!</>) : (<><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>)}
          </button>
        </div>
      </div>

      {/* RC Filename & Hardcoded Path */}
      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <FieldRow label="RC Filename" value={rcFilename} onChange={setRcFilename} placeholder="Enter filename…" mono />
        <FieldRow label="Hardcoded Path" value={hardcodedPath} onChange={setHardcodedPath} placeholder="Enter path…" mono />
      </div>

      {/* Level Number Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Level Numbers</SectionLabel>
          <button onClick={addLevel} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add Level
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: "800px" }}>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                  {LEVEL_COLUMNS.map((col) => (
                    <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-black dark:text-slate-400">{col.icon}</span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>{col.label}</span>
                      </div>
                    </th>
                  ))}
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
                {levels.map((row, idx) => (
                  <tr key={row.id} className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}>
                    {LEVEL_COLUMNS.map((col) => (
                      <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>{renderLevelCell(row, col.key)}</td>
                    ))}
                    <td className="w-8 px-2 py-2 align-top"><DeleteBtn onClick={() => deleteLevel(row.id)} /></td>
                  </tr>
                ))}
                {levels.length === 0 && (
                  <tr><td colSpan={LEVEL_COLUMNS.length + 1} className="py-10 text-center"><p className="text-[12px] text-slate-500 dark:text-slate-500">No levels defined</p><button onClick={addLevel} className="mt-2 text-[11.5px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first level</button></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Heading Annotation */}
      <div className="space-y-2">
        <SectionLabel>Heading Annotation</SectionLabel>
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <FieldRow label="Heading Annotation" value={headingAnnotation} onChange={setHeadingAnnotation} placeholder="e.g. Level 2" />
        </div>
      </div>

      {/* Whitespace Handling */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Whitespace Handling</SectionLabel>
          <button onClick={addWs} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add Rule
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: "500px" }}>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                  {WS_COLUMNS.map((col) => (
                    <th key={col.key} className={`${col.width} text-left px-3 py-2.5 border-r border-slate-200 dark:border-[#2a3147] last:border-r-0`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-black dark:text-slate-400">{col.icon}</span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-black dark:text-slate-300 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>{col.label}</span>
                      </div>
                    </th>
                  ))}
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
                {whitespace.map((row, idx) => (
                  <tr key={row.id} className={`group transition-colors ${idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} hover:bg-blue-50/30 dark:hover:bg-blue-500/5`}>
                    {WS_COLUMNS.map((col) => (
                      <td key={col.key} className={`${col.width} px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0`}>{renderWsCell(row, col.key)}</td>
                    ))}
                    <td className="w-8 px-2 py-2 align-top"><DeleteBtn onClick={() => deleteWs(row.id)} /></td>
                  </tr>
                ))}
                {whitespace.length === 0 && (
                  <tr><td colSpan={WS_COLUMNS.length + 1} className="py-10 text-center"><p className="text-[12px] text-slate-500 dark:text-slate-500">No whitespace rules</p><button onClick={addWs} className="mt-2 text-[11.5px] text-blue-600 dark:text-blue-400 hover:underline">+ Add first rule</button></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}