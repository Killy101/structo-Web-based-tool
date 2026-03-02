import React, { useEffect, useState } from "react";

type Format = "new" | "old";

interface Props {
  format: Format;
  brdId?: string;
  title?: string;
  onComplete?: () => void;
}

interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "url";
  placeholder?: string;
  icon: string;
}

const OLD_FIELDS: FieldConfig[] = [
  { key: "sourceName",      label: "Source Name",       type: "text",   placeholder: "e.g., Federal Register",        icon: "◈" },
  { key: "sourceType",      label: "Source Type",       type: "text",   placeholder: "Type",                         icon: "⬡" },
  { key: "publicationDate", label: "Publication Date",  type: "text",   placeholder: "Publication date",             icon: "◎" },
  { key: "lastUpdatedDate", label: "Last Updated Date", type: "text",   placeholder: "Last updated date",             icon: "◎" },
  { key: "processingDate",  label: "Processing Date",   type: "text",   placeholder: "Processing date",               icon: "◎" },
  { key: "issuingAgency",   label: "Issuing Agency",    type: "text",   placeholder: "e.g., EPA, FDA, OSHA",          icon: "≡" },
  { key: "contentUrl",      label: "Content URL",       type: "url",    placeholder: "https://",                      icon: "↑" },
  { key: "geography",       label: "Geography",         type: "text",   placeholder: "e.g., United States, EU",       icon: "✦" },
  { key: "language",        label: "Language",          type: "text",   placeholder: "Language",                     icon: "≡" },
  { key: "payloadSubtype",  label: "Payload Subtype",   type: "text",   placeholder: "Subtype",                      icon: "⬡" },
  { key: "status",          label: "Status",            type: "text",   placeholder: "Status",                       icon: "◈" },
];

const NEW_FIELDS: FieldConfig[] = [
  { key: "contentCategoryName",    label: "Content Category Name",    type: "text",   placeholder: "e.g., Environmental Compliance", icon: "⬡" },
  { key: "publicationDate",        label: "Publication Date",         type: "text",   placeholder: "Publication date",                  icon: "◎" },
  { key: "lastUpdatedDate",        label: "Last Updated Date",        type: "text",   placeholder: "Last updated date",                 icon: "◎" },
  { key: "issuingAgency",          label: "Issuing Agency",           type: "text",   placeholder: "e.g., EPA, FDA, OSHA",           icon: "≡" },
  { key: "relatedGovernmentAgency",label: "Related Government Agency",type: "text",   placeholder: "e.g., Department of Energy",     icon: "≡" },
  { key: "contentUri",             label: "Content URI",              type: "url",    placeholder: "https://",                       icon: "↑" },
  { key: "geography",              label: "Geography",                type: "text",   placeholder: "e.g., United States, EU",        icon: "✦" },
  { key: "language",               label: "Language",                 type: "text",   placeholder: "Language",                        icon: "≡" },
];

function FieldInput({ field, value, onChange }: { field: FieldConfig; value: string; onChange: (v: string) => void }) {
  const base =
    "w-full text-[12.5px] font-medium text-black dark:text-slate-200 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded-lg px-3 py-2 outline-none transition-all focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/10 placeholder:text-slate-500 dark:placeholder:text-slate-600";
  return <input type={field.type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={base} />;
}

function ValidateButton() {
  return (
    <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-white dark:bg-[#1e2235] text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700/40 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      Validate
    </button>
  );
}

export default function Metadata({ format, brdId, title, onComplete }: Props) {
  const fields = format === "old" ? OLD_FIELDS : NEW_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValues({});
    setSaved(false);
  }, [format]);

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2000); }

  const filledCount = fields.filter((f) => values[f.key]?.trim()).length;
  const progress = Math.round((filledCount / fields.length) * 100);

  return (
    <div className="space-y-5">

      {/* Header: Format Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${format === "new" ? "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40" : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40"}`}>
            <span className="text-[9px]">{format === "new" ? "◉" : "◈"}</span>
            {format === "new" ? "New Format" : "Legacy Format"}
          </span>
          {format === "old" && <span className="text-[10px] text-slate-500 dark:text-slate-500 font-medium">Pre-2024 schema</span>}
          {format === "new" && <span className="text-[10px] text-slate-500 dark:text-slate-500 font-medium">2024+ schema</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 rounded-full bg-slate-200 dark:bg-[#252d45] overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 dark:bg-blue-400 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10.5px] text-slate-600 dark:text-slate-500 font-semibold tabular-nums">{filledCount}/{fields.length}</span>
        </div>
      </div>

      {/* Inherited from Upload */}
      {(brdId || title) && (
        <div className="grid grid-cols-2 gap-3">
          {brdId && (
            <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147]">
              <span className="text-slate-400 dark:text-slate-600 text-base mt-0.5 flex-shrink-0">◈</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-black dark:text-slate-300 mb-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>BRD ID</p>
                <p className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">{brdId}</p>
              </div>
              <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40 self-start">Auto</span>
            </div>
          )}
          {title && (
            <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147]">
              <span className="text-slate-400 dark:text-slate-600 text-base mt-0.5 flex-shrink-0">≡</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-black dark:text-slate-300 mb-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>Title</p>
                <p className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">{title}</p>
              </div>
              <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40 self-start">Auto</span>
            </div>
          )}
        </div>
      )}

      {/* Fields */}
      <div className="rounded-xl bg-slate-50 dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <div className="px-4 pt-3.5 pb-2 border-b border-slate-200 dark:border-[#2a3147]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            {format === "old" ? "Legacy Metadata Fields" : "Metadata Fields"}
          </p>
        </div>
        <div className="px-4 py-3 space-y-3">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-black dark:text-slate-400">{field.icon}</span>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>{field.label}</label>
                {values[field.key]?.trim() && (
                  <span className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/30">✓</span>
                )}
              </div>
              <FieldInput field={field} value={values[field.key] ?? ""} onChange={(v) => setValue(field.key, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ValidateButton />
          <button onClick={handleSave} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium border transition-all ${saved ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40" : "bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55]"}`}>
            {saved ? (<><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Saved</>) : (<><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save Metadata</>)}
          </button>
        </div>
        {onComplete && (
          <button onClick={onComplete} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500 shadow-lg shadow-blue-600/20 transition-all">
            Continue
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}