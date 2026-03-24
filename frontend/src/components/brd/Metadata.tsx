import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import React, { useEffect, useState, useRef } from "react";
import api from "@/app/lib/api";

type Format = "new" | "old";

interface Props {
  format: Format;
  brdId?: string;
  title?: string;
  onComplete?: () => void;
  initialData?: Record<string, unknown>;
  onDataChange?: (data: Record<string, unknown>) => void;
}

interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "url";
  placeholder?: string;
  icon: string;
}

interface CellImageMeta {
  id: number;
  tableIndex: number;
  rowIndex: number;
  colIndex: number;
  rid: string;
  mediaName: string;
  mimeType: string;
  cellText: string;
  section: string;
  fieldLabel: string;
}

const OLD_FIELDS: FieldConfig[] = [
  { key: "sourceName",           label: "Source Name",           type: "text", placeholder: "e.g., Federal Register",    icon: "◈" },
  { key: "authoritativeSource",  label: "Authoritative Source",  type: "text", placeholder: "e.g., Code of Federal Regulations", icon: "≡" },
  { key: "sourceType",           label: "Source Type",           type: "text", placeholder: "Type",                     icon: "⬡" },
  { key: "publicationDate",      label: "Publication Date",      type: "text", placeholder: "Publication date",         icon: "◎" },
  { key: "lastUpdatedDate",      label: "Last Updated Date",     type: "text", placeholder: "Last updated date",        icon: "◎" },
  { key: "processingDate",       label: "Processing Date",       type: "text", placeholder: "Processing date",          icon: "◎" },
  { key: "issuingAgency",        label: "Issuing Agency",        type: "text", placeholder: "e.g., EPA, FDA, OSHA",    icon: "≡" },
  { key: "contentUrl",           label: "Content URL",           type: "url",  placeholder: "https://",                icon: "↑" },
  { key: "geography",            label: "Geography",             type: "text", placeholder: "e.g., United States, EU", icon: "✦" },
  { key: "language",             label: "Language",              type: "text", placeholder: "Language",                icon: "≡" },
  { key: "payloadSubtype",       label: "Payload Subtype",       type: "text", placeholder: "Subtype",                 icon: "⬡" },
  { key: "status",               label: "Status",                type: "text", placeholder: "Status",                  icon: "◈" },
];

const NEW_FIELDS: FieldConfig[] = [
  { key: "contentCategoryName",     label: "Content Category Name",     type: "text", placeholder: "e.g., Environmental Compliance",    icon: "⬡" },
  { key: "publicationDate",         label: "Publication Date",          type: "text", placeholder: "Publication date",                  icon: "◎" },
  { key: "lastUpdatedDate",         label: "Last Updated Date",         type: "text", placeholder: "Last updated date",                 icon: "◎" },
  { key: "processingDate",          label: "Processing Date",           type: "text", placeholder: "ISO 8601 e.g. 2016-06-07T15:10:00Z",icon: "◎" },
  { key: "issuingAgency",           label: "Issuing Agency",            type: "text", placeholder: "e.g., EPA, FDA, OSHA",             icon: "≡" },
  { key: "relatedGovernmentAgency", label: "Related Government Agency", type: "text", placeholder: "e.g., Department of Energy",       icon: "≡" },
  { key: "contentUri",              label: "Content URI",               type: "url",  placeholder: "https://",                         icon: "↑" },
  { key: "geography",               label: "Geography",                 type: "text", placeholder: "e.g., China, Australia",           icon: "✦" },
  { key: "language",                label: "Language",                  type: "text", placeholder: "e.g., English, Chinese",           icon: "≡" },
];

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  const base =
    "w-full text-[12.5px] font-medium text-black dark:text-slate-200 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded-lg px-3 py-2 outline-none transition-all focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/10 placeholder:text-slate-500 dark:placeholder:text-slate-600";
  return (
    <input
      type={field.type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={base}
    />
  );
}

function metadataValuesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  for (const key of keys) {
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
}

export default function Metadata({ format, brdId, title, onComplete, initialData, onDataChange }: Props) {
  const fields = format === "old" ? OLD_FIELDS : NEW_FIELDS;
  const [values, setValues]               = useState<Record<string, string>>({});
  const [saved, setSaved]                 = useState(false);
  const [images, setImages]               = useState<CellImageMeta[]>([]);
  const isInitializing = useRef(false);
  const valuesRef = useRef<Record<string, string>>({});
  const lastAppliedSignatureRef = useRef<string>("");
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  function getFieldImgsUploaded(key: string): UploadedCellImage[] { return cellImages[key] ?? []; }
  function onFieldUploaded(key: string, img: UploadedCellImage) { setCellImages(prev => ({ ...prev, [key]: [...(prev[key] ?? []), img] })); }
  function onFieldDeleted(key: string, id: number) { setCellImages(prev => ({ ...prev, [key]: (prev[key] ?? []).filter(i => i.id !== id) })); }

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  // ── FIX: only reset values when initialData or format genuinely changes ──
  useEffect(() => {
    const nextValues = buildMetadataValues(format, initialData);
    const signature = `${format}:${JSON.stringify(nextValues)}`;
    if (lastAppliedSignatureRef.current === signature && metadataValuesEqual(valuesRef.current, nextValues)) return;

    isInitializing.current = true;
    setValues(nextValues);
    lastAppliedSignatureRef.current = signature;
    setSaved(false);
  }, [format, initialData]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    if (!onDataChange) return;
    // Skip firing during initialData resets to avoid infinite loop
    if (isInitializing.current) {
      isInitializing.current = false;
      return;
    }
    // Map display values back to snake_case keys for upstream
    const out: Record<string, string> = format === "old" ? {
      content_category_name: values.sourceName ?? "",
      authoritative_source:  values.authoritativeSource ?? "",
      source_type:           values.sourceType ?? "",
      publication_date:      values.publicationDate ?? "",
      last_updated_date:     values.lastUpdatedDate ?? "",
      processing_date:       values.processingDate ?? "",
      issuing_agency:        values.issuingAgency ?? "",
      content_uri:           values.contentUrl ?? "",
      geography:             values.geography ?? "",
      language:              values.language ?? "",
      payload_subtype:       values.payloadSubtype ?? "",
      status:                values.status ?? "",
    } : {
      content_category_name:     values.contentCategoryName ?? "",
      publication_date:          values.publicationDate ?? "",
      last_updated_date:         values.lastUpdatedDate ?? "",
      processing_date:           values.processingDate ?? "",
      issuing_agency:            values.issuingAgency ?? "",
      related_government_agency: values.relatedGovernmentAgency ?? "",
      content_uri:               values.contentUri ?? "",
      geography:                 values.geography ?? "",
      language:                  values.language ?? "",
    };
    onDataChange(out);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  useEffect(() => {
    if (!brdId) return;
    const fetchImages = async () => {
      try {
        const response = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images`);
        const all: CellImageMeta[] = response.data.images ?? [];
        // section="metadata" for new records; tableIndex=5 fallback for stale DB records
        setImages(all.filter(img =>
          img.section === "metadata" ||
          img.section === "unknown" && img.tableIndex === 5 ||
          !img.section && img.tableIndex === 5
        ));
        // Restore manually uploaded images keyed by fieldLabel (= field.key)
        const manualImgs = all.filter(img => img.section === "metadata" && img.rid?.startsWith("manual-"));
        const restored: Record<string, UploadedCellImage[]> = {};
        manualImgs.forEach(img => {
          const key = img.fieldLabel ?? "";
          if (!key) return;
          if (!restored[key]) restored[key] = [];
          restored[key].push({ id: img.id, mediaName: img.mediaName, mimeType: img.mimeType, cellText: img.cellText, section: img.section, fieldLabel: img.fieldLabel });
        });
        setCellImages(restored);
      } catch (err) {
        console.error("[Metadata] Error fetching images:", err);
      }
    };
    fetchImages();
  }, [brdId]);

  // Returns images for a specific field row.
  // Primary: fieldLabel match (e.g. "Last Updated Date") — new DB records.
  // Fallback: rowIndex match (1-based, row 0 = header) — stale DB records.
  function getFieldImages(field: FieldConfig, fieldArrayIndex: number): CellImageMeta[] {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const labelNorm = norm(field.label);

    const byLabel = images.filter(img => {
      const fl = norm(img.fieldLabel || "");
      return fl && (fl === labelNorm || fl.includes(labelNorm) || labelNorm.includes(fl));
    });
    if (byLabel.length > 0) return byLabel;

    // Fallback: metadata header = row 0, data starts at row 1
    return images.filter(img =>
      img.rowIndex === fieldArrayIndex + 1 && (!img.fieldLabel || img.fieldLabel.trim() === "")
    );
  }

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-700/40">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-800 dark:text-violet-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            Metadata
          </p>
          <div className="flex items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${format === "new" ? "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40" : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40"}`}>
              <span className="text-[9px]">{format === "new" ? "◉" : "◈"}</span>
              {format === "new" ? "New Format" : "Legacy Format"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
              saved
                ? "bg-emerald-500 text-white"
                : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"
            }`}
          >
            {saved ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Saved!
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Save
              </>
            )}
          </button>
        </div>
      </div>

      {/* Auto-filled chips */}
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
          {fields.map((field, fieldIdx) => {
            const fieldImgs = brdId ? getFieldImages(field, fieldIdx) : [];
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-black dark:text-slate-400">{field.icon}</span>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-black dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>
                    {field.label}
                  </label>
                  <div className="ml-auto flex items-center gap-1.5">
                    {brdId && (
                      <CellImageUploader
                        brdId={brdId}
                        section="metadata"
                        fieldLabel={field.key}
                        existingImages={getFieldImgsUploaded(field.key)}
                        onUploaded={img => onFieldUploaded(field.key, img)}
                        onDeleted={id => onFieldDeleted(field.key, id)}
                      />
                    )}
                    {values[field.key]?.trim() && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/30">✓</span>
                    )}
                  </div>
                </div>
                <FieldInput
                  field={field}
                  value={values[field.key] ?? ""}
                  onChange={(v) => setValue(field.key, v)}
                />
                {/* DB-extracted images */}
                {fieldImgs.map(img => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={img.id} src={`${API_BASE}/brd/${brdId}/images/${img.id}/blob`} alt={img.cellText || img.mediaName} className="max-w-full rounded border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1a1f35]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                ))}
                {/* Manually uploaded images */}
                {getFieldImgsUploaded(field.key).map(img => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`m-${img.id}`} src={`${API_BASE}/brd/${brdId}/images/${img.id}/blob`} alt={img.cellText || img.mediaName} className="max-w-full rounded border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1a1f35]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end">
        {onComplete && (
          <button
            onClick={onComplete}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500 shadow-lg shadow-blue-600/20 transition-all"
          >
            Continue
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripQuotes(value: string): string {
  // ── FIX: only strip leading/trailing quote characters, do NOT trim internal whitespace ──
  return value.replace(/^["']+|["']+$/g, "");
}

function buildMetadataValues(
  format: Format,
  initialData?: Record<string, unknown>
): Record<string, string> {
  if (!initialData) return {};

  const t = (key: string): string =>
    typeof initialData[key] === "string" ? stripQuotes(initialData[key] as string) : "";
  const p = (...keys: string[]): string => keys.map(t).find(Boolean) ?? "";

  if (format === "old") {
    return {
      // "Source Name" in legacy doc → stored as content_category_name by extractor
      sourceName:           p("content_category_name", "contentCategoryName", "source_name", "sourceName", "Source Name", "document_title", "documentTitle", "title", "name"),
      // "Authoritative Source" → stored directly as authoritative_source
      authoritativeSource:  p("authoritative_source", "authoritativeSource", "Authoritative Source", "issuing_agency", "issuingAgency", "Issuing Agency"),
      sourceType:           p("source_type", "sourceType", "Source Type"),
      publicationDate:      p("publication_date", "publicationDate", "Publication Date"),
      lastUpdatedDate:      p("last_updated_date", "lastUpdatedDate", "Last Updated Date"),
      processingDate:       p("processing_date", "processingDate", "Processing Date"),
      issuingAgency:        p("issuing_agency", "issuingAgency", "Issuing Agency"),
      contentUrl:           p("content_uri", "contentUri", "content_url", "contentUrl", "Content URI", "Content URL"),
      geography:            p("geography", "Geography"),
      language:             p("language", "Language"),
      payloadSubtype:       p("payload_subtype", "payloadSubtype", "Payload Subtype"),
      status:               p("status", "Status"),
    };
  }

  return {
    contentCategoryName:     p("content_category_name", "contentCategoryName", "Content Category Name", "document_title", "documentTitle", "title", "name"),
    publicationDate:         p("publication_date", "publicationDate", "Publication Date"),
    lastUpdatedDate:         p("last_updated_date", "lastUpdatedDate", "Last Updated Date"),
    processingDate:          p("processing_date", "processingDate", "Processing Date"),
    issuingAgency:           p("issuing_agency", "issuingAgency", "Issuing Agency"),
    relatedGovernmentAgency: p("related_government_agency", "relatedGovernmentAgency", "Related Government Agency"),
    contentUri:              p("content_uri", "contentUri", "content_url", "contentUrl", "Content URI", "Content URL"),
    geography:               p("geography", "Geography"),
    language:                p("language", "Language"),
  };
}