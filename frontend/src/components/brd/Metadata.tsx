import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import React, { useEffect, useMemo, useState, useRef } from "react";
import api from "@/app/lib/api";
import { buildBrdImageBlobUrl } from "@/utils/brdImageUrl";

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

interface CustomMetadataRow {
  id: string;
  label: string;
  value: string;
  comment: string;
}

const OLD_FIELDS: FieldConfig[] = [
  { key: "sourceName",              label: "Source Name",                type: "text", placeholder: "e.g., Federal Register",                  icon: "◈" },
  { key: "authoritativeSource",     label: "Authoritative Source",       type: "text", placeholder: "e.g., Code of Federal Regulations",       icon: "≡" },
  { key: "sourceType",              label: "Source Type",                type: "text", placeholder: "Type",                                   icon: "⬡" },
  { key: "contentType",             label: "Content Type",               type: "text", placeholder: "e.g., Regulation, Guidance",             icon: "⬡" },
  { key: "publicationDate",         label: "Publication Date",           type: "text", placeholder: "Publication date",                       icon: "◎" },
  { key: "lastUpdatedDate",         label: "Last Updated Date",          type: "text", placeholder: "Last updated date",                      icon: "◎" },
  { key: "effectiveDate",           label: "Effective Date",             type: "text", placeholder: "Effective date",                         icon: "◎" },
  { key: "commentDueDate",          label: "Comment Due Date",           type: "text", placeholder: "Comment due date",                       icon: "◎" },
  { key: "complianceDate",          label: "Compliance Date",            type: "text", placeholder: "Compliance date",                        icon: "◎" },
  { key: "processingDate",          label: "Processing Date",            type: "text", placeholder: "Processing date",                        icon: "◎" },
  { key: "issuingAgency",           label: "Issuing Agency",             type: "text", placeholder: "e.g., EPA, FDA, OSHA",                  icon: "≡" },
  { key: "name",                    label: "Name",                       type: "text", placeholder: "Reference name",                         icon: "◈" },
  { key: "relatedGovernmentAgency", label: "Related Government Agency",  type: "text", placeholder: "Related agency",                         icon: "≡" },
  { key: "contentUrl",              label: "Content URL",                type: "url",  placeholder: "https://",                              icon: "↑" },
  { key: "impactedCitation",        label: "Impacted Citation",          type: "text", placeholder: "Affected citation",                      icon: "§" },
  { key: "payloadType",             label: "Payload Type",               type: "text", placeholder: "Payload type",                           icon: "⬡" },
  { key: "payloadSubtype",          label: "Payload Subtype",            type: "text", placeholder: "Subtype",                                icon: "⬡" },
  { key: "summary",                 label: "Summary",                    type: "text", placeholder: "Summary",                                icon: "✦" },
  { key: "smeComments",             label: "SME Comments",               type: "text", placeholder: "SME comments",                           icon: "✎" },
  { key: "geography",               label: "Geography",                  type: "text", placeholder: "e.g., United States, EU",               icon: "✦" },
  { key: "language",                label: "Language",                   type: "text", placeholder: "Language",                               icon: "≡" },
  { key: "status",                  label: "Status",                     type: "text", placeholder: "Status",                                 icon: "◈" },
];

const NEW_FIELDS: FieldConfig[] = [
  { key: "contentCategoryName",     label: "Content Category Name",      type: "text", placeholder: "e.g., Environmental Compliance",        icon: "⬡" },
  { key: "authoritativeSource",     label: "Authoritative Source",       type: "text", placeholder: "Authoritative source",                  icon: "≡" },
  { key: "sourceType",              label: "Source Type",                type: "text", placeholder: "Source type",                           icon: "⬡" },
  { key: "contentType",             label: "Content Type",               type: "text", placeholder: "e.g., Regulation, Guidance",             icon: "⬡" },
  { key: "publicationDate",         label: "Publication Date",           type: "text", placeholder: "Publication date",                       icon: "◎" },
  { key: "lastUpdatedDate",         label: "Last Updated Date",          type: "text", placeholder: "Last updated date",                      icon: "◎" },
  { key: "effectiveDate",           label: "Effective Date",             type: "text", placeholder: "Effective date",                         icon: "◎" },
  { key: "commentDueDate",          label: "Comment Due Date",           type: "text", placeholder: "Comment due date",                       icon: "◎" },
  { key: "complianceDate",          label: "Compliance Date",            type: "text", placeholder: "Compliance date",                        icon: "◎" },
  { key: "processingDate",          label: "Processing Date",            type: "text", placeholder: "ISO 8601 e.g. 2016-06-07T15:10:00Z",    icon: "◎" },
  { key: "issuingAgency",           label: "Issuing Agency",             type: "text", placeholder: "e.g., EPA, FDA, OSHA",                  icon: "≡" },
  { key: "name",                    label: "Name",                       type: "text", placeholder: "Reference name",                         icon: "◈" },
  { key: "relatedGovernmentAgency", label: "Related Government Agency",  type: "text", placeholder: "e.g., Department of Energy",             icon: "≡" },
  { key: "contentUri",              label: "Content URI",                type: "url",  placeholder: "https://",                              icon: "↑" },
  { key: "impactedCitation",        label: "Impacted Citation",          type: "text", placeholder: "Affected citation",                      icon: "§" },
  { key: "payloadType",             label: "Payload Type",               type: "text", placeholder: "Payload type",                           icon: "⬡" },
  { key: "payloadSubtype",          label: "Payload Subtype",            type: "text", placeholder: "Subtype",                                icon: "⬡" },
  { key: "summary",                 label: "Summary",                    type: "text", placeholder: "Summary",                                icon: "✦" },
  { key: "smeComments",             label: "SME Comments",               type: "text", placeholder: "SME comments",                           icon: "✎" },
  { key: "geography",               label: "Geography",                  type: "text", placeholder: "e.g., China, Australia",                 icon: "✦" },
  { key: "language",                label: "Language",                   type: "text", placeholder: "e.g., English, Chinese",                 icon: "≡" },
  { key: "status",                  label: "Status",                     type: "text", placeholder: "Status",                                 icon: "◈" },
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

function normalizeMetadataCommentKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseMetadataComments(raw: string, fields: FieldConfig[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const normalized = raw.replace(/\r?\n+/g, " ").trim();
  if (!normalized) return out;

  if (fields.length > 0) {
    const escapedLabels = fields
      .map((field) => field.label)
      .sort((a, b) => b.length - a.length)
      .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${escapedLabels.join("|")}):\\s*`, "gi");
    const matches = Array.from(normalized.matchAll(pattern));
    if (matches.length > 0) {
      matches.forEach((match, index) => {
        const label = match[1] ?? "";
        const start = (match.index ?? 0) + match[0].length;
        const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
        const comment = normalized.slice(start, end).trim();
        if (label && comment) out[normalizeMetadataCommentKey(label)] = comment;
      });
      return out;
    }
  }

  for (const line of raw.split(/\r?\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const label = normalizeMetadataCommentKey(trimmed.slice(0, idx));
    const comment = trimmed.slice(idx + 1).trim();
    if (label && comment) out[label] = comment;
  }
  return out;
}

function serializeMetadataComments(
  fields: FieldConfig[],
  comments: Record<string, string>,
  customRows: CustomMetadataRow[] = []
): string {
  return [
    ...fields.map((field) => {
      const key = normalizeMetadataCommentKey(field.label);
      const comment = (comments[key] ?? "").trim();
      return comment ? `${field.label}: ${comment}` : "";
    }),
    ...customRows.map((row) => {
      const label = row.label.trim();
      const comment = row.comment.trim();
      return label && comment ? `${label}: ${comment}` : "";
    }),
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeCustomMetadataRows(rows: CustomMetadataRow[]): CustomMetadataRow[] {
  return rows
    .map((row, index) => ({
      id: row.id?.trim() || `custom-${index}`,
      label: row.label?.trim() ?? "",
      value: row.value ?? "",
      comment: row.comment ?? "",
    }))
    .filter((row) => row.label || row.value || row.comment);
}

function extractCustomMetadataRows(initialData?: Record<string, unknown>): CustomMetadataRow[] {
  const raw = initialData?.custom_rows ?? initialData?.customRows ?? initialData?.metadata_custom_rows;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const entry = row as Record<string, unknown>;
      return {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `custom-${index}`,
        label: typeof entry.label === "string" ? entry.label : "",
        value: typeof entry.value === "string" ? entry.value : "",
        comment: typeof entry.comment === "string" ? entry.comment : "",
      };
    })
    .filter((row): row is CustomMetadataRow => !!row)
    .filter((row) => row.label || row.value || row.comment);
}

function buildOutgoingMetadata(
  format: Format,
  values: Record<string, string>,
  comments: Record<string, string>,
  fields: FieldConfig[],
  customRows: CustomMetadataRow[]
): Record<string, unknown> {
  const normalizedCustomRows = sanitizeCustomMetadataRows(customRows);
  const smeComments = serializeMetadataComments(fields, comments, normalizedCustomRows);

  return format === "old" ? {
    source_name:               values.sourceName ?? "",
    authoritative_source:      values.authoritativeSource ?? "",
    source_type:               values.sourceType ?? "",
    content_type:              values.contentType ?? "",
    publication_date:          values.publicationDate ?? "",
    last_updated_date:         values.lastUpdatedDate ?? "",
    effective_date:            values.effectiveDate ?? "",
    comment_due_date:          values.commentDueDate ?? "",
    compliance_date:           values.complianceDate ?? "",
    processing_date:           values.processingDate ?? "",
    issuing_agency:            values.issuingAgency ?? "",
    name:                      values.name ?? "",
    related_government_agency: values.relatedGovernmentAgency ?? "",
    content_uri:               values.contentUrl ?? "",
    impacted_citation:         values.impactedCitation ?? "",
    payload_type:              values.payloadType ?? "",
    payload_subtype:           values.payloadSubtype ?? "",
    summary:                   values.summary ?? "",
    sme_comments:              smeComments,
    geography:                 values.geography ?? "",
    language:                  values.language ?? "",
    status:                    values.status ?? "",
    custom_rows:               normalizedCustomRows,
  } : {
    content_category_name:     values.contentCategoryName ?? "",
    authoritative_source:      values.authoritativeSource ?? "",
    source_type:               values.sourceType ?? "",
    content_type:              values.contentType ?? "",
    publication_date:          values.publicationDate ?? "",
    last_updated_date:         values.lastUpdatedDate ?? "",
    effective_date:            values.effectiveDate ?? "",
    comment_due_date:          values.commentDueDate ?? "",
    compliance_date:           values.complianceDate ?? "",
    processing_date:           values.processingDate ?? "",
    issuing_agency:            values.issuingAgency ?? "",
    name:                      values.name ?? "",
    related_government_agency: values.relatedGovernmentAgency ?? "",
    content_uri:               values.contentUri ?? "",
    impacted_citation:         values.impactedCitation ?? "",
    payload_type:              values.payloadType ?? "",
    payload_subtype:           values.payloadSubtype ?? "",
    summary:                   values.summary ?? "",
    sme_comments:              smeComments,
    geography:                 values.geography ?? "",
    language:                  values.language ?? "",
    status:                    values.status ?? "",
    custom_rows:               normalizedCustomRows,
  };
}

export default function Metadata({ format, brdId, title, onComplete, initialData, onDataChange }: Props) {
  const fields = useMemo(
    () => (format === "old" ? OLD_FIELDS : NEW_FIELDS).filter((field) => field.key !== "smeComments"),
    [format]
  );
  const [values, setValues]               = useState<Record<string, string>>({});
  const [commentValues, setCommentValues] = useState<Record<string, string>>({});
  const [customRows, setCustomRows]       = useState<CustomMetadataRow[]>([]);
  const [saved, setSaved]                 = useState(false);
  const [images, setImages]               = useState<CellImageMeta[]>([]);
  const isInitializing = useRef(false);
  const valuesRef = useRef<Record<string, string>>({});
  const commentValuesRef = useRef<Record<string, string>>({});
  const lastAppliedSignatureRef = useRef<string>("");
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  function getFieldImgsUploaded(key: string): UploadedCellImage[] { return cellImages[key] ?? []; }
  function onFieldUploaded(key: string, img: UploadedCellImage) { setCellImages(prev => ({ ...prev, [key]: [...(prev[key] ?? []), img] })); }
  function onFieldDeleted(key: string, id: number) { setCellImages(prev => ({ ...prev, [key]: (prev[key] ?? []).filter(i => i.id !== id) })); }

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  // ── FIX: only reset values when initialData or format genuinely changes ──
  useEffect(() => {
    const nextValues = buildMetadataValues(format, initialData);
    const nextCustomRows = extractCustomMetadataRows(initialData);
    const signature = `${format}:${JSON.stringify(nextValues)}:${JSON.stringify(nextCustomRows)}`;
    if (lastAppliedSignatureRef.current === signature && metadataValuesEqual(valuesRef.current, nextValues)) return;

    isInitializing.current = true;
    setValues(nextValues);
    setCommentValues(parseMetadataComments(nextValues.smeComments ?? "", fields));
    setCustomRows(nextCustomRows);
    lastAppliedSignatureRef.current = signature;
    setSaved(false);
  }, [format, initialData, fields]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    commentValuesRef.current = commentValues;
  }, [commentValues]);

  useEffect(() => {
    if (!onDataChange) return;
    if (isInitializing.current) {
      isInitializing.current = false;
      return;
    }
    onDataChange(buildOutgoingMetadata(format, values, commentValues, fields, customRows));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, commentValues, customRows]);

  useEffect(() => {
    if (!brdId) return;
    const fetchImages = async () => {
      try {
        const response = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images?section=metadata`, { timeout: 30000 });
        let all: CellImageMeta[] = response.data.images ?? [];
        if (all.length === 0) {
          const fallback = await api.get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images`, { timeout: 30000 });
          all = fallback.data.images ?? [];
        }
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

  function setComment(label: string, val: string) {
    const key = normalizeMetadataCommentKey(label);
    setCommentValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function addRow() {
    setCustomRows((prev) => [
      ...prev,
      { id: `custom-${Date.now()}-${prev.length}`, label: "", value: "", comment: "" },
    ]);
    setSaved(false);
  }

  function updateCustomRow(id: string, key: keyof Omit<CustomMetadataRow, "id">, value: string) {
    setCustomRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    setSaved(false);
  }

  function deleteCustomRow(id: string) {
    setCustomRows((prev) => prev.filter((row) => row.id !== id));
    setSaved(false);
  }

  async function handleSave() {
    if (!brdId) return;
    try {
      await api.put(`/brd/${brdId}/sections/metadata`, {
        data: buildOutgoingMetadata(format, values, commentValues, fields, customRows),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[Metadata] Save failed:", err);
    }
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
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Row
          </button>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-slate-100 dark:bg-[#181d30] border-b border-slate-200 dark:border-[#2a3147]">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400" style={{ fontFamily: "'DM Mono', monospace" }}>Metadata Element</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400" style={{ fontFamily: "'DM Mono', monospace" }}>Document Location</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400" style={{ fontFamily: "'DM Mono', monospace" }}>SME Comments</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, fieldIdx) => {
                const fieldImgs = brdId ? getFieldImages(field, fieldIdx) : [];
                const commentKey = normalizeMetadataCommentKey(field.label);
                return (
                  <tr key={field.key} className={fieldIdx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}>
                    <td className="px-3 py-2 align-top border-t border-slate-100 dark:border-[#2a3147] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>
                      <div className="flex items-center gap-1.5">
                        <span>{field.icon}</span>
                        <span>{field.label}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top border-t border-slate-100 dark:border-[#2a3147]">
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1">
                            <FieldInput
                              field={field}
                              value={values[field.key] ?? ""}
                              onChange={(v) => setValue(field.key, v)}
                            />
                          </div>
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
                        {fieldImgs.map(img => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE)} alt={img.cellText || img.mediaName} className="max-w-full rounded border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1a1f35]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                        ))}
                        {getFieldImgsUploaded(field.key).map(img => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={`m-${img.id}`} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE)} alt={img.cellText || img.mediaName} className="max-w-full rounded border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1a1f35]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top border-t border-slate-100 dark:border-[#2a3147]">
                      <textarea
                        rows={2}
                        value={commentValues[commentKey] ?? ""}
                        onChange={(e) => setComment(field.label, e.target.value)}
                        placeholder="SME comment for this field"
                        className="w-full text-[12px] font-medium text-black dark:text-slate-200 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded-lg px-3 py-2 outline-none transition-all focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/10 placeholder:text-slate-500 dark:placeholder:text-slate-600 resize-y min-h-[44px]"
                      />
                    </td>
                  </tr>
                );
              })}
              {customRows.map((row, rowIdx) => {
                const tableIdx = fields.length + rowIdx;
                return (
                  <tr key={row.id} className={tableIdx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/40 dark:bg-[#1a1f35]"}>
                    <td className="px-3 py-2 align-top border-t border-slate-100 dark:border-[#2a3147]">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-1">
                          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-violet-600 dark:text-violet-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                            Custom Row
                          </span>
                          <input
                            type="text"
                            value={row.label}
                            onChange={(e) => updateCustomRow(row.id, "label", e.target.value)}
                            placeholder="Custom metadata element"
                            className="w-full text-[12px] font-medium text-black dark:text-slate-200 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded-lg px-3 py-2 outline-none transition-all focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/10 placeholder:text-slate-500 dark:placeholder:text-slate-600"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteCustomRow(row.id)}
                          className="mt-5 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all"
                          aria-label="Delete custom metadata row"
                          title="Delete row"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5h6v2m-7 3v7m4-7v7m4-7v7M7 7l1 12h8l1-12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top border-t border-slate-100 dark:border-[#2a3147]">
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => updateCustomRow(row.id, "value", e.target.value)}
                        placeholder="Document location"
                        className="w-full text-[12px] font-medium text-black dark:text-slate-200 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded-lg px-3 py-2 outline-none transition-all focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/10 placeholder:text-slate-500 dark:placeholder:text-slate-600"
                      />
                    </td>
                    <td className="px-3 py-2 align-top border-t border-slate-100 dark:border-[#2a3147]">
                      <textarea
                        rows={2}
                        value={row.comment}
                        onChange={(e) => updateCustomRow(row.id, "comment", e.target.value)}
                        placeholder="SME comment for this row"
                        className="w-full text-[12px] font-medium text-black dark:text-slate-200 bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded-lg px-3 py-2 outline-none transition-all focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/10 placeholder:text-slate-500 dark:placeholder:text-slate-600 resize-y min-h-[44px]"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
      sourceName:              p("content_category_name", "contentCategoryName", "source_name", "sourceName", "Source Name", "document_title", "documentTitle", "title", "name"),
      authoritativeSource:     p("authoritative_source", "authoritativeSource", "Authoritative Source", "issuing_agency", "issuingAgency", "Issuing Agency"),
      sourceType:              p("source_type", "sourceType", "Source Type"),
      contentType:             p("content_type", "contentType", "Content Type"),
      publicationDate:         p("publication_date", "publicationDate", "Publication Date"),
      lastUpdatedDate:         p("last_updated_date", "lastUpdatedDate", "Last Updated Date"),
      effectiveDate:           p("effective_date", "effectiveDate", "Effective Date"),
      commentDueDate:          p("comment_due_date", "commentDueDate", "Comment Due Date"),
      complianceDate:          p("compliance_date", "complianceDate", "Compliance Date"),
      processingDate:          p("processing_date", "processingDate", "Processing Date"),
      issuingAgency:           p("issuing_agency", "issuingAgency", "Issuing Agency"),
      name:                    p("name", "Name", "document_title", "documentTitle", "title"),
      relatedGovernmentAgency: p("related_government_agency", "relatedGovernmentAgency", "Related Government Agency"),
      contentUrl:              p("content_uri", "contentUri", "content_url", "contentUrl", "Content URI", "Content URL"),
      impactedCitation:        p("impacted_citation", "impactedCitation", "Impacted Citation"),
      payloadType:             p("payload_type", "payloadType", "Payload Type"),
      payloadSubtype:          p("payload_subtype", "payloadSubtype", "Payload Subtype"),
      summary:                 p("summary", "Summary"),
      smeComments:             p("sme_comments", "smeComments", "SME Comments"),
      geography:               p("geography", "Geography"),
      language:                p("language", "Language"),
      status:                  p("status", "Status"),
    };
  }

  return {
    contentCategoryName:     p("content_category_name", "contentCategoryName", "Content Category Name", "document_title", "documentTitle", "title", "name"),
    authoritativeSource:     p("authoritative_source", "authoritativeSource", "Authoritative Source", "issuing_agency", "issuingAgency", "Issuing Agency"),
    sourceType:              p("source_type", "sourceType", "Source Type"),
    contentType:             p("content_type", "contentType", "Content Type"),
    publicationDate:         p("publication_date", "publicationDate", "Publication Date"),
    lastUpdatedDate:         p("last_updated_date", "lastUpdatedDate", "Last Updated Date"),
    effectiveDate:           p("effective_date", "effectiveDate", "Effective Date"),
    commentDueDate:          p("comment_due_date", "commentDueDate", "Comment Due Date"),
    complianceDate:          p("compliance_date", "complianceDate", "Compliance Date"),
    processingDate:          p("processing_date", "processingDate", "Processing Date"),
    issuingAgency:           p("issuing_agency", "issuingAgency", "Issuing Agency"),
    name:                    p("name", "Name", "document_title", "documentTitle", "title"),
    relatedGovernmentAgency: p("related_government_agency", "relatedGovernmentAgency", "Related Government Agency"),
    contentUri:              p("content_uri", "contentUri", "content_url", "contentUrl", "Content URI", "Content URL"),
    impactedCitation:        p("impacted_citation", "impactedCitation", "Impacted Citation"),
    payloadType:             p("payload_type", "payloadType", "Payload Type"),
    payloadSubtype:          p("payload_subtype", "payloadSubtype", "Payload Subtype"),
    summary:                 p("summary", "Summary"),
    smeComments:             p("sme_comments", "smeComments", "SME Comments"),
    geography:               p("geography", "Geography"),
    language:                p("language", "Language"),
    status:                  p("status", "Status"),
  };
}