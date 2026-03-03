import React, { useEffect, useState } from "react";

interface ScopeRow {
  id: string;
  title: string;
  referenceLink: string;
  contentUrl: string;
  issuingAuth: string;
  asrbId: string;
  smeComments: string;
  initialEvergreen: string;
  dateOfIngestion: string;
  isOutOfScope: boolean;
}

interface ScopeEntry {
  document_title?: string;
  regulator_url?: string;
  content_url?: string;
  issuing_authority?: string;
  issuing_authority_code?: string;
  geography?: string;
  asrb_id?: string;
  sme_comments?: string;
  initial_evergreen?: string;
  date_of_ingestion?: string;
  strikethrough?: boolean;
}

interface Props {
  initialData?: Record<string, unknown>;
}

function asScopeEntryArray(value: unknown): ScopeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== null && typeof item === "object") as ScopeEntry[];
}

function toRow(entry: ScopeEntry, id: string, isOutOfScope: boolean): ScopeRow {
  const authLabel = entry.issuing_authority
    ? `${entry.issuing_authority}${entry.issuing_authority_code ? ` (${entry.issuing_authority_code})` : ""}`
    : "";
  return {
    id,
    title:            entry.document_title    ?? "",
    referenceLink:    entry.regulator_url     ?? "",
    contentUrl:       entry.content_url       ?? "",
    issuingAuth:      authLabel,
    asrbId:           entry.asrb_id           ?? "",
    smeComments:      entry.sme_comments      ?? "",
    initialEvergreen: entry.initial_evergreen ?? "",
    dateOfIngestion:  entry.date_of_ingestion ?? "",
    isOutOfScope,
  };
}

function buildRowsFromScope(initialData?: Record<string, unknown>): ScopeRow[] {
  if (!initialData) return [];
  const now = Date.now().toString();
  const rows: ScopeRow[] = [];
  asScopeEntryArray(initialData.in_scope).forEach((e, i) =>
    rows.push(toRow(e, `${now}-in-${i}`, false))
  );
  asScopeEntryArray(initialData.out_of_scope).forEach((e, i) =>
    rows.push(toRow(e, `${now}-out-${i}`, true))
  );
  return rows;
}

function hasExtraCols(rows: ScopeRow[]) {
  return {
    evergreen: rows.some((r) => r.initialEvergreen),
    ingestion: rows.some((r) => r.dateOfIngestion),
  };
}

function EmptyIcon() {
  return (
    <svg className="w-5 h-5 text-slate-400 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

const TH = "px-3 py-2 text-left font-bold text-[10px] uppercase tracking-[0.1em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147]";
const MONO = { fontFamily: "'DM Mono', monospace" } as const;
const CELL = "px-3 py-2 border-r border-slate-100 dark:border-[#2a3147] align-top";

function EditInput({ value, field, rowId, placeholder, onChange }: {
  value: string; field: string; rowId: string; placeholder: string;
  onChange: (id: string, field: string, val: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(rowId, field, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="w-full bg-white dark:bg-[#1e2235] border border-blue-300 dark:border-blue-600 rounded-md px-2 py-1 text-[12px] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
      placeholder={placeholder}
    />
  );
}

function Cell({ isEditing, value, field, rowId, placeholder, onChange, href }: {
  isEditing: boolean; value: string; field: string; rowId: string;
  placeholder: string; onChange: (id: string, field: string, val: string) => void;
  href?: boolean;
}) {
  if (isEditing) return <EditInput value={value} field={field} rowId={rowId} placeholder={placeholder} onChange={onChange} />;
  if (!value) return <span className="text-slate-400 dark:text-slate-600 italic">—</span>;
  if (href) return <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 dark:text-blue-400 hover:underline block whitespace-normal break-all">{value}</a>;
  return <span className="text-slate-700 dark:text-slate-400 text-[11.5px]">{value}</span>;
}

export default function Scope({ initialData }: Props) {
  const [rows, setRows] = useState<ScopeRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows(buildRowsFromScope(initialData));
    setEditingId(null);
    setSaved(false);
  }, [initialData]);

  const extra = hasExtraCols(rows);
  const colCount = 6 + (extra.evergreen ? 1 : 0) + (extra.ingestion ? 1 : 0) + 1;

  function addRow() {
    const r: ScopeRow = {
      id: Date.now().toString(), title: "", referenceLink: "", contentUrl: "",
      issuingAuth: "", asrbId: "", smeComments: "", initialEvergreen: "",
      dateOfIngestion: "", isOutOfScope: false,
    };
    setRows((p) => [...p, r]);
    setEditingId(r.id);
  }

  function updateRow(id: string, field: string, value: string) {
    setRows((p) => p.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }

  function removeRow(id: string) {
    setRows((p) => p.filter((r) => r.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2000); }

  return (
    <div>
      <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/30 p-4">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base text-slate-500 dark:text-slate-500">≡</span>
            <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-300 tracking-tight">Scope Documents</h3>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-[#1e2235] text-slate-600 dark:text-slate-500 border border-slate-300 dark:border-[#2a3147]" style={MONO}>{rows.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white dark:bg-[#1e2235] text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700/40 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
              Validate
            </button>
            <button onClick={handleSave} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${saved ? "bg-emerald-500 text-white" : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"}`}>
              {saved
                ? <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved!</>
                : <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save</>}
            </button>
            <button onClick={addRow} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-all">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>Add Row
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]" style={{ minWidth: 900 }}>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235]">
                  <th rowSpan={2} className={`${TH} w-[180px]`} style={MONO}>Document Title</th>
                  <th rowSpan={2} className={`${TH} w-[120px]`} style={MONO}>Reference Link</th>
                  <th rowSpan={2} className={`${TH} w-[160px]`} style={MONO}>Content URL</th>
                  <th colSpan={2} className={`${TH} text-center bg-slate-200/60 dark:bg-[#252d45]`} style={MONO}>Issuing Agency</th>
                  <th rowSpan={2} className={`${TH} w-[130px]`} style={MONO}>SME Comments</th>
                  {extra.evergreen && <th rowSpan={2} className={`${TH} w-[90px]`} style={MONO}>Initial / Evergreen</th>}
                  {extra.ingestion && <th rowSpan={2} className={`${TH} w-[110px]`} style={MONO}>Date of Ingestion</th>}
                  <th rowSpan={2} className="px-3 py-2 text-center font-bold text-[10px] uppercase tracking-[0.1em] text-black dark:text-slate-300 border-b border-slate-200 dark:border-[#2a3147] w-[50px]" style={MONO}>···</th>
                </tr>
                <tr className="bg-slate-100 dark:bg-[#1e2235]">
                  <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-[0.08em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147] w-[140px] bg-slate-200/60 dark:bg-[#252d45]/70" style={MONO}>Issuing Authority</th>
                  <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-[0.08em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147] w-[100px] bg-slate-200/60 dark:bg-[#252d45]/70" style={MONO}>ASRB ID</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]" style={{ fontWeight: 400 }}>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <EmptyIcon />
                        <p className="text-[12px] text-slate-500 dark:text-slate-500">No documents added yet</p>
                        <button onClick={addRow} className="text-[11.5px] text-blue-600 dark:text-blue-400 hover:underline font-medium">+ Add first row</button>
                      </div>
                    </td>
                  </tr>
                ) : rows.map((row, idx) => {
                  const isEditing = editingId === row.id;
                  const rowCls = [
                    "transition-colors cursor-pointer",
                    isEditing ? "bg-blue-50/40 dark:bg-blue-500/5"
                      : idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]"
                      : "bg-slate-50/60 dark:bg-[#1a1f35]",
                    "hover:bg-blue-50/30 dark:hover:bg-[#1e2235]/50",
                    row.isOutOfScope ? "opacity-55" : "",
                  ].join(" ");

                  return (
                    <tr key={row.id} className={rowCls} onClick={() => setEditingId(row.id)}>

                      {/* Document Title */}
                      <td className={CELL}>
                        {isEditing
                          ? <EditInput value={row.title} field="title" rowId={row.id} placeholder="Document title…" onChange={updateRow} />
                          : <span className={`font-medium text-slate-800 dark:text-slate-300 ${row.isOutOfScope ? "line-through text-slate-400 dark:text-slate-600" : ""}`}>
                              {row.title || <span className="text-slate-400 dark:text-slate-600 italic" style={{ textDecoration: "none" }}>—</span>}
                            </span>}
                      </td>

                      {/* Reference Link */}
                      <td className={CELL}>
                        <Cell isEditing={isEditing} value={row.referenceLink} field="referenceLink" rowId={row.id} placeholder="https://…" onChange={updateRow} href />
                      </td>

                      {/* Content URL */}
                      <td className={CELL}>
                        <Cell isEditing={isEditing} value={row.contentUrl} field="contentUrl" rowId={row.id} placeholder="https://…" onChange={updateRow} href />
                      </td>

                      {/* Issuing Authority */}
                      <td className={CELL}>
                        <Cell isEditing={isEditing} value={row.issuingAuth} field="issuingAuth" rowId={row.id} placeholder="Authority…" onChange={updateRow} />
                      </td>

                      {/* ASRB ID */}
                      <td className={CELL}>
                        {isEditing
                          ? <EditInput value={row.asrbId} field="asrbId" rowId={row.id} placeholder="ASRB…" onChange={updateRow} />
                          : row.asrbId
                            ? <span className="font-mono text-[11px] text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] px-2 py-0.5 rounded">{row.asrbId}</span>
                            : <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
                      </td>

                      {/* SME Comments */}
                      <td className={CELL}>
                        <Cell isEditing={isEditing} value={row.smeComments} field="smeComments" rowId={row.id} placeholder="Comments…" onChange={updateRow} />
                      </td>

                      {/* Initial / Evergreen (dynamic) */}
                      {extra.evergreen && (
                        <td className={CELL}>
                          <Cell isEditing={isEditing} value={row.initialEvergreen} field="initialEvergreen" rowId={row.id} placeholder="Initial / Evergreen…" onChange={updateRow} />
                        </td>
                      )}

                      {/* Date of Ingestion (dynamic) */}
                      {extra.ingestion && (
                        <td className={CELL}>
                          <Cell isEditing={isEditing} value={row.dateOfIngestion} field="dateOfIngestion" rowId={row.id} placeholder="Date…" onChange={updateRow} />
                        </td>
                      )}

                      {/* Delete */}
                      <td className="px-3 py-2 text-center align-top">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeRow(row.id); }}
                          className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-all mx-auto"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
              <p className="text-[10.5px] text-slate-500 dark:text-slate-600" style={MONO}>
                Click any row to edit · {rows.length} {rows.length === 1 ? "document" : "documents"} in scope
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}