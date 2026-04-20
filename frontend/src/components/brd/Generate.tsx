import React, { useMemo, useState, useEffect, useRef } from "react";
import api from "@/app/lib/api";
import { useAuth } from "@/context/AuthContext";
import SimpleMetajson from "@/components/brd/simplemetajson";
import InnodMetajson from "@/components/brd/innodmetajson";
import { buildBrdImageBlobUrl } from "@/utils/brdImageUrl";
import { brdRichTextToPlain, extractBrdRichTextHref, hasBrdRichTextColor, hasBrdRichTextMarkup, sanitizeBrdRichTextHtml, stripLeadingBrdLabel } from "@/utils/brdRichText";
import {
  normalizeBrdMetadataCommentKey as normalizeMetadataCommentKey,
  parseBrdMetadataComments as parseMetadataComments,
} from "@/utils/brdMetadataComments";
import { normalizeBrdCitationText } from "@/utils/brdCitationText";

// ── Cell image types ───────────────────────────────────────────────────────────
interface CellImageMeta {
  id:         number;
  tableIndex: number;
  rowIndex:   number;
  colIndex:   number;
  rid:        string;
  mediaName:  string;
  mimeType:   string;
  cellText:   string;
  blobUrl:    string | null;
  section:    string;
  fieldLabel: string;
}

// ── useCellImages hook ─────────────────────────────────────────────────────────
function useCellImages(brdId?: string, enabled = true, includeIds?: number[] | null) {
  const [images, setImages] = useState<CellImageMeta[]>([]);

  useEffect(() => {
    if (!enabled || !brdId) return;
    const includeIdsParam = Array.isArray(includeIds) && includeIds.length > 0
      ? `?includeIds=${includeIds.join(',')}`
      : "";
    api
      .get<{ images: CellImageMeta[] }>(`/brd/${brdId}/images${includeIdsParam}`, { timeout: 30000 })
      .then(r => {
        console.log(`[useCellImages] Fetched ${r.data.images?.length || 0} images for BRD ${brdId}`);
        setImages(r.data.images ?? []);
      })
      .catch((err) => {
        console.log("[useCellImages] Error fetching images:", err);
      });
  }, [brdId, enabled, includeIds]);

  return { images };
}

// ── InlineImageCell component for displaying images in table cells ────────────
function InlineImageCell({ brdId, image }: { brdId?: string; image: CellImageMeta }) {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  if (!brdId) return null;
  const imgSrc = image.blobUrl || buildBrdImageBlobUrl(brdId, image.id, API_BASE);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgSrc}
      alt={image.cellText || image.mediaName}
      data-brd-export-image="1"
      data-brd-image-id={String(image.id)}
      className="mt-1 max-w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f35]"
      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

interface Props {
  brdId?: string;
  title?: string;
  format?: "new" | "old";
  status?: string;
  initialData?: {
    scope?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    toc?: Record<string, unknown>;
    citations?: Record<string, unknown>;
    contentProfile?: Record<string, unknown>;
    brdConfig?: Record<string, unknown>;
  };
  onEdit?: (step: number) => void;
  onComplete?: () => void;
  canEdit?: boolean;
  showCellImages?: boolean;
  /** When set, only images whose id is in this list are displayed.
   *  Used by version history to avoid bleeding images added in later versions. */
  imageIds?: number[] | null;
}

type SaveStatus = "DRAFT" | "PAUSED" | "COMPLETED" | "APPROVED" | "ON_HOLD";

/** Keys that require APPROVED status before generation is allowed. */
const APPROVAL_RESTRICTED = new Set(["metajson", "innod", "content"]);

type Format = "new" | "old";
type StructuringVariant = "contentCategoryName" | "sourceName";

interface ScopeRow {
  id: string; stableKey: string; title: string; referenceLink: string; contentUrl: string; contentNote: string;
  issuingAuth: string; asrbId: string; smeComments: string;
  initialEvergreen: string; dateOfIngestion: string; isOutOfScope: boolean;
}
interface ScopeEntry {
  document_title?: string; regulator_url?: string; content_url?: string; content_note?: string;
  issuing_authority?: string; issuing_authority_code?: string;
  asrb_id?: string; sme_comments?: string;
  initial_evergreen?: string; date_of_ingestion?: string; strikethrough?: boolean;
  stable_key?: string; stableKey?: string;
}
interface TocRow {
  id: string; level: string; name: string;
  required: "true" | "false" | "Conditional" | "";
  definition: string; example: string; note: string;
  tocRequirements: string; smeComments: string;
  // Original values captured on first user edit — shown alongside current in the view
  _prevName?: string; _prevDefinition?: string; _prevExample?: string;
  _prevNote?: string; _prevTocRequirements?: string; _prevSmeComments?: string;
}
interface CitationStyleGuideRow {
  label: string;
  value: string;
}
interface CitationStyleGuideData {
  description: string;
  rows: CitationStyleGuideRow[];
}
interface CustomMetadataRow { id: string; label: string; value: string; comment: string; }
interface LevelRow { id: string; levelNumber: string; description: string; redjayXmlTag: string; path: string; remarksNotes: string; }
interface WhitespaceRow { id: string; tags: string; innodReplace: string; }

const EditIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}
function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((i): i is Record<string, unknown> => !!i && typeof i === "object") : [];
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function hasDocumentLocationValue(value: unknown): boolean {
  const normalized = asString(value).replace(/\u00a0/g, " ").trim();
  return normalized !== "" && normalized !== "—" && normalized !== "-";
}

const METADATA_DATE_KEYS = new Set([
  "publicationDate",
  "lastUpdatedDate",
  "effectiveDate",
  "commentDueDate",
  "complianceDate",
  "processingDate",
]);

function parseMetadataDateCandidate(rawValue: string): Date | null {
  const value = (rawValue ?? "").trim();
  if (!value || /^\{.+\}$/.test(value)) return null;

  if (/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  if (/^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}$/.test(value)) {
    const parsed = new Date(value.replace(/,/g, ""));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatMetadataDateValue(rawValue: string): string | null {
  const parsed = parseMetadataDateCandidate(rawValue);
  if (!parsed) return null;

  const includesTime = /[T\s]\d{2}:\d{2}/.test((rawValue ?? "").trim());
  if (includesTime) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(parsed).replace(",", "").concat(" UTC");
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function buildMetadataDocumentLocationText(
  fieldKey: string,
  rawValue: string,
  metadata?: Record<string, unknown>,
): string {
  const cleanValue = (rawValue ?? "").trim();
  if (!cleanValue) return "";

  if (fieldKey !== "contentUri" && fieldKey !== "contentUrl") {
    return cleanValue;
  }

  const explicitNote = [
    "content_uri_note",
    "contentUriNote",
    "content_url_note",
    "contentUrlNote",
    "Content URI Note",
    "Content URL Note",
  ]
    .map((key) => asString(metadata?.[key]).trim())
    .find(Boolean);

  const fallbackNote = /^https?:\/\//i.test(cleanValue)
    ? "URL of the specific Document (e.g.)"
    : "";

  const note = explicitNote || fallbackNote;
  if (!note) return cleanValue;

  const normalizedValue = cleanValue.replace(/\s+/g, " ");
  const normalizedNote = note.replace(/\s+/g, " ");
  if (normalizedValue.includes(normalizedNote)) return cleanValue;

  return `${note}\n${cleanValue}`;
}

function renderTextWithLinks(value: string): React.ReactNode {
  const trimmed = value.trim();
  if (!trimmed) return <Nil />;

  return (
    <span
      className="whitespace-pre-wrap break-words"
      dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(trimmed) }}
    />
  );
}

function renderScopeLink(value: string, outOfScope = false, sourceTone = false): React.ReactNode {
  const trimmed = value.trim();
  if (!trimmed) return <Nil />;

  const plainValue = brdRichTextToPlain(trimmed) || extractBrdRichTextHref(trimmed) || trimmed;
  if (hasBrdRichTextMarkup(trimmed)) {
    const toneClass = outOfScope
      ? "line-through text-red-600 dark:text-red-400"
      : sourceTone
        ? "text-red-700 dark:text-red-400"
        : "text-slate-700 dark:text-slate-300";

    return (
      <span
        className={`block text-[11px] break-words ${toneClass}`}
        title={plainValue}
        dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(trimmed) }}
      />
    );
  }

  const href = extractBrdRichTextHref(trimmed) || trimmed;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`hover:underline text-[11px] block truncate ${outOfScope ? "line-through text-red-600 dark:text-red-400" : sourceTone ? "text-red-700 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}`}
      title={plainValue}
    >
      {plainValue}
    </a>
  );
}

function normalizeMetadataImageLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getMetadataRowImagesForField(
  field: { label: string; key: string },
  index: number,
  images: CellImageMeta[],
): CellImageMeta[] {
  const labelKey = normalizeMetadataImageLookupKey(field.label);
  const fieldKey = normalizeMetadataImageLookupKey(field.key);

  const byFieldLabel = images.filter((img) => {
    const sectionKey = normalizeMetadataImageLookupKey(img.section || "");
    if (sectionKey && sectionKey !== "metadata" && sectionKey !== "unknown") return false;

    const fieldLabelKey = normalizeMetadataImageLookupKey(img.fieldLabel || "");
    return !!fieldLabelKey && (fieldLabelKey === labelKey || fieldLabelKey === fieldKey);
  });
  if (byFieldLabel.length > 0) return byFieldLabel;

  const expectedRowIndex = index + 1;
  return images.filter((img) => {
    const sectionKey = normalizeMetadataImageLookupKey(img.section || "");
    if (sectionKey && sectionKey !== "metadata" && sectionKey !== "unknown") return false;
    return img.rowIndex === expectedRowIndex && !normalizeMetadataImageLookupKey(img.fieldLabel || "");
  });
}

function deriveTitle(metadata: Record<string, unknown> | undefined, fallback: string | undefined): string {
  if (!metadata) return fallback || "Untitled BRD";
  const t = (k: string) => (typeof metadata[k] === "string" ? (metadata[k] as string).trim() : "");

  const catName  = t("content_category_name") || t("source_name");
  const docTitle = t("document_title");

  if (catName && docTitle) {
    const catL = catName.toLowerCase();
    const docL = docTitle.toLowerCase();
    // If one contains the other, use the longer (more specific) one
    const isRedundant = catL === docL || catL.includes(docL) || docL.includes(catL);
    if (isRedundant) {
      return catName.length >= docTitle.length ? catName : docTitle;
    }
    return `${catName} - ${docTitle}`;
  }

  return catName || docTitle || fallback || "Untitled BRD";
}

function buildTemplateMetadataValues(format: Format, metadata?: Record<string, unknown>): Record<string, string> {
  if (!metadata) return {};
  const t = (key: string): string => (typeof metadata[key] === "string" ? String(metadata[key]).trim() : "");
  const p = (...keys: string[]): string => keys.map(t).find(Boolean) ?? "";
  if (format === "old") {
    return {
      sourceName:              p("content_category_name", "contentCategoryName", "source_name", "sourceName", "Source Name", "document_title", "documentTitle", "title", "name"),
      contentCategoryName:     p("content_category_name", "contentCategoryName", "source_name", "sourceName", "Source Name", "document_title", "documentTitle", "title", "name"),
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
      contentUrlNote:          p("content_uri_note", "contentUriNote", "contentUrlNote", "Content URI Note", "content_url_note", "Content URL Note"),
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
    sourceName:              p("source_name", "sourceName", "Source Name", "content_category_name", "contentCategoryName", "Content Category Name", "document_title", "documentTitle", "title", "name"),
    contentCategoryName:     p("content_category_name", "contentCategoryName", "Content Category Name", "source_name", "sourceName", "Source Name", "document_title", "documentTitle", "title", "name"),
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
    contentUriNote:          p("content_uri_note", "contentUriNote", "contentUrlNote", "Content URI Note", "content_url_note", "Content URL Note"),
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
function extractCustomMetadataRows(metadata?: Record<string, unknown>): CustomMetadataRow[] {
  if (!metadata) return [];
  const raw = metadata.custom_rows ?? metadata.customRows ?? metadata.metadata_custom_rows;
  return asRecordArray(raw)
    .map((row, index) => ({
      id: asString(row.id) || `custom-${index}`,
      label: asString(row.label),
      value: asString(row.value),
      comment: asString(row.comment),
    }))
    .filter((row) => row.label || row.value || row.comment);
}

function detectStructuringVariant(format: Format, metadata?: Record<string, unknown>): StructuringVariant {
  const metadataKeys = Object.keys(metadata ?? {}).map((key) => key.toLowerCase());
  if (
    metadataKeys.includes("source name") ||
    metadataKeys.includes("source_name") ||
    metadataKeys.includes("sourcename")
  ) {
    return "sourceName";
  }
  return format === "old" ? "sourceName" : "contentCategoryName";
}

function StructuringRequirementsTable({
  values,
  metadata,
  variant,
}: {
  values: Record<string, string>;
  metadata?: Record<string, unknown>;
  variant: StructuringVariant;
}) {
  const selectedField = variant === "sourceName"
    ? { label: "Source Name", key: "sourceName" as const }
    : { label: "Content Category Name", key: "contentCategoryName" as const };
  const fallbackKey = selectedField.key === "sourceName" ? "contentCategoryName" : "sourceName";
  const rawValue = (values[selectedField.key] || values[fallbackKey] || values.name || "").trim();
  const rowComment = (
    asString(metadata?.[variant === "sourceName" ? "source_name_sme_checkpoint" : "content_category_name_sme_checkpoint"]).trim() ||
    asString(metadata?.structuring_sme_checkpoint).trim() ||
    ""
  ).trim();
  const displayValue = buildMetadataDocumentLocationText(selectedField.key, rawValue, metadata).trim();

  if (!hasDocumentLocationValue(displayValue) && !hasDocumentLocationValue(rowComment)) {
    return <Empty />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50/70 dark:bg-emerald-500/10 px-4 py-3">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-300" style={MONO}>Detected from uploaded BRD</p>
          <p className="text-[12px] text-slate-700 dark:text-slate-200">
            This section follows the uploaded source automatically and shows the correct BRD-native field and SME checkpoint text.
          </p>
        </div>
      </div>

      <div className={TBL_WRAP}>
        <table className="w-full text-[11.5px]" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <BrdHeaderCell title="Structuring Element" greenNote="First item in the BRD flow" className="w-56" />
              <BrdHeaderCell title="Document Location" greenNote="Source-aligned value kept for export" />
              <BrdHeaderCell title="SME Checkpoint" checkpoint="Validation" blueNote="Confirm before continuing to the next section" className="w-72" />
            </tr>
          </thead>
          <tbody>
            <tr className="bg-white dark:bg-[#161b2e]">
              <td className="px-3 py-2 border-r border-slate-100 dark:border-[#2a3147] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 align-middle whitespace-nowrap" style={MONO}>
                {selectedField.label}
              </td>
              <td className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 align-top whitespace-pre-wrap break-words">
                {displayValue ? renderTextWithLinks(displayValue) : <Nil />}
              </td>
              <td className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 align-top whitespace-pre-wrap break-words">
                {rowComment ? renderTextWithLinks(rowComment) : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
function asScopeEntryArray(v: unknown): ScopeEntry[] {
  return Array.isArray(v) ? v.filter(i => i !== null && typeof i === "object") as ScopeEntry[] : [];
}
function normalizeAsrbAndSme(asrbRaw?: string, smeRaw?: string) {
  const pattern = /\bASRB[- ]?\d+\b/gi;
  const normalizeId = (value: string) => value.toUpperCase().replace(/[-\s]+/g, "");
  const unique = (values: string[]) => Array.from(new Set(values.map(normalizeId).filter(Boolean))).join(", ");

  let asrbId = unique(asrbRaw?.match(pattern) ?? []);
  let smeComments = (smeRaw ?? "").trim();

  const embedded = unique(smeComments.match(pattern) ?? []);
  if (embedded) {
    asrbId = asrbId || embedded;
    smeComments = smeComments.replace(pattern, "");
    smeComments = smeComments.replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "").replace(/\s{2,}/g, " ").trim();
  }

  return { asrbId, smeComments };
}
function repairSplitUrl(url?: string, note?: string): { url: string; note: string } {
  const cleanUrl = (url ?? "").trim();
  const cleanNote = (note ?? "").trim();
  if (!cleanUrl || !cleanNote) return { url: cleanUrl, note: cleanNote };

  const looksLikeRemainder = /^[)\].,:;?&#=%A-Za-z0-9_/-]+$/.test(cleanNote) && !/\s/.test(cleanNote);
  const openParens = (cleanUrl.match(/\(/g) ?? []).length;
  const closeParens = (cleanUrl.match(/\)/g) ?? []).length;
  const looksLikeSuffix = cleanNote.startsWith(").") || /^\.[A-Za-z0-9]{2,8}$/.test(cleanNote) || /\.[A-Za-z0-9]{2,8}$/.test(cleanNote);

  if (looksLikeRemainder && (openParens > closeParens || looksLikeSuffix)) {
    return { url: `${cleanUrl}${cleanNote}`, note: "" };
  }

  return { url: cleanUrl, note: cleanNote };
}

function toScopeRow(e: ScopeEntry, id: string, oos: boolean, stableKey: string): ScopeRow {
  const auth = e.issuing_authority ? `${e.issuing_authority}${e.issuing_authority_code ? ` (${e.issuing_authority_code})` : ""}` : "";
  const { asrbId, smeComments } = normalizeAsrbAndSme(e.asrb_id, e.sme_comments);
  const { url: contentUrl, note: contentNote } = repairSplitUrl(e.content_url, e.content_note);
  const safeStableKey = stableKey.trim() || id;
  return {
    id,
    stableKey: safeStableKey,
    isOutOfScope: oos || !!e.strikethrough,
    title: e.document_title ?? "",
    referenceLink: e.regulator_url ?? "",
    contentUrl,
    contentNote,
    issuingAuth: auth,
    asrbId,
    smeComments,
    initialEvergreen: e.initial_evergreen ?? "",
    dateOfIngestion: e.date_of_ingestion ?? "",
  };
}
function buildScopeRows(d?: Record<string, unknown>): ScopeRow[] {
  if (!d) return [];
  const now = Date.now().toString(); const rows: ScopeRow[] = [];
  const resolveStableKey = (entry: ScopeEntry, fallback: string) => {
    const raw = typeof entry.stable_key === "string"
      ? entry.stable_key
      : typeof entry.stableKey === "string"
        ? entry.stableKey
        : "";
    const trimmed = raw.trim();
    return trimmed || fallback;
  };
  asScopeEntryArray(d.in_scope).forEach((e, i) => rows.push(toScopeRow(e, `${now}-in-${i}`, false, resolveStableKey(e, `in-${i}`))));
  asScopeEntryArray(d.out_of_scope).forEach((e, i) => rows.push(toScopeRow(e, `${now}-out-${i}`, true, resolveStableKey(e, `out-${i}`))));
  return rows;
}
function hasExtraCols(rows: ScopeRow[]) {
  return { evergreen: rows.some(r => r.initialEvergreen), ingestion: rows.some(r => r.dateOfIngestion) };
}
function mapRequiredValue(val?: string): TocRow["required"] {
  if (!val) return "";
  const lower = val.toLowerCase().trim();
  if (lower === "true" || lower === "yes" || lower === "y") return "true";
  if (lower === "false" || lower === "no" || lower === "n") return "false";
  if (lower.includes("conditional") || lower.includes("cond")) return "Conditional";
  if (val === "true" || val === "false" || val === "Conditional") return val as TocRow["required"];
  return "";
}
function buildTocRows(d?: Record<string, unknown>): TocRow[] {
  if (!d) return [];
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const ts = Date.now();
  return (sections as Record<string, unknown>[])
    .filter(s => !!s && typeof s === "object")
    .map((s, i) => {
      let level = String(asString(s.level) || asString(s.id) || i + 1);
      const m = level.match(/\*\*?(\d+)\*\*?|\b(\d+)\b/);
      if (m) level = m[1] || m[2] || level;
      return {
        id: `${ts}-${i}`,
        level: level.trim(),
        name: asString(s.name),
        required: mapRequiredValue(asString(s.required)),
        definition: asString(s.definition),
        example: asString(s.example),
        note: asString(s.note),
        tocRequirements: asString(s.tocRequirements),
        smeComments: asString(s.smeComments),
        // Restore previously captured originals
        _prevName:            s._prevName            ? asString(s._prevName)            : undefined,
        _prevDefinition:      s._prevDefinition      ? asString(s._prevDefinition)      : undefined,
        _prevExample:         s._prevExample         ? asString(s._prevExample)         : undefined,
        _prevNote:            s._prevNote            ? asString(s._prevNote)            : undefined,
        _prevTocRequirements: s._prevTocRequirements ? asString(s._prevTocRequirements) : undefined,
        _prevSmeComments:     s._prevSmeComments     ? asString(s._prevSmeComments)     : undefined,
      };
    })
    .sort((a, b) => (parseInt(a.level) || 0) - (parseInt(b.level) || 0));
}

function hasMeaningfulRichText(value: string): boolean {
  return brdRichTextToPlain(value).trim().length > 0;
}

function normalizeMeaningfulRichText(value: unknown): string {
  const raw = asString(value).trim();
  return raw && hasMeaningfulRichText(raw) ? raw : "";
}

function parseCitationStyleGuide(tocData?: Record<string, unknown>): CitationStyleGuideData | null {
  const raw = asRecord(tocData?.citationStyleGuide);
  if (!raw) return null;

  const description = stripLeadingBrdLabel(normalizeMeaningfulRichText(raw.description), "SME Checkpoint");
  const rows = asRecordArray(raw.rows)
    .map((row) => ({ label: asString(row.label).trim(), value: normalizeMeaningfulRichText(row.value) }))
    .filter((row) => row.value || (row.label && hasMeaningfulRichText(row.label)));

  if (!description && rows.length === 0) return null;
  return { description, rows };
}

function extractExample(desc: string): string { const m = desc.match(/^Example:\s*(.+)$/m); return m ? m[1].trim() : ""; }
function extractDefinition(desc: string): string { const m = desc.match(/^Definition:\s*(.+)$/m); return m ? m[1].trim() : ""; }
function isPlaceholderLevelToken(v: string): boolean { return /^level\s*\d+$/.test(v.trim().replace(/^\/+/, "").replace(/[_\-]+/g, " ").toLowerCase()); }
function pickHardcodedToken(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const slashMatch = text.match(/\/[A-Za-z0-9][A-Za-z0-9._/-]*/);
  if (slashMatch?.[0]) return slashMatch[0].replace(/[),.;]+$/, "");

  const tokenMatches = text.match(/[A-Za-z][A-Za-z0-9._-]*/g) ?? [];
  const ignored = new Set(["hardcoded", "path", "level", "definition"]);
  for (let i = tokenMatches.length - 1; i >= 0; i -= 1) {
    const token = tokenMatches[i];
    if (!token || ignored.has(token.toLowerCase()) || isPlaceholderLevelToken(token)) continue;
    return token.replace(/[),.;]+$/, "");
  }
  return "";
}
function deriveHardcodedPath(levels: LevelRow[]): string {
  let l0 = "", l1 = "";
  for (const row of levels) {
    const n = row.levelNumber.replace(/[^0-9]/g, "").trim();
    const picked = pickHardcodedToken(row.path.trim()) || pickHardcodedToken(extractDefinition(row.description).trim()) || pickHardcodedToken(extractExample(row.description).trim());
    if (n === "0") l0 = picked;
    if (n === "1") l1 = picked;
  }
  if (!l0 && !l1) return "";
  return (l0.replace(/\/$/, "") + "/" + l1.replace(/^\//, "")).replace(/\/+/g, "/");
}
function asExtractedLevels(d?: Record<string, unknown>): LevelRow[] {
  return asRecordArray(d?.levels).map((row, i) => ({ id: `lvl-${i}`, levelNumber: String(row.levelNumber ?? ""), description: String(row.description ?? ""), redjayXmlTag: String(row.redjayXmlTag ?? ""), path: String(row.path ?? ""), remarksNotes: "" }));
}
function asExtractedWhitespace(d?: Record<string, unknown>): WhitespaceRow[] {
  return asRecordArray(d?.whitespace).map((row, i) => ({ id: `ws-${i}`, tags: String(row.tags ?? ""), innodReplace: String(row.innodReplace ?? "") }));
}

const DEFAULT_WHITESPACE_ROWS: WhitespaceRow[] = [
  { id: "ws-def-0", tags: "</title>",         innodReplace: "2 hard returns after title with heading." },
  { id: "ws-def-1", tags: "</title>",         innodReplace: "1 space after title with identifier (levels 4 to 6)." },
  { id: "ws-def-2", tags: "</paragraph>",     innodReplace: "2 hard returns after closing para and before opening para" },
  { id: "ws-def-3", tags: "</ul>",            innodReplace: "1 hard return after" },
  { id: "ws-def-4", tags: "</li>",            innodReplace: "1 hard return after" },
  { id: "ws-def-5", tags: "<p> within <li>",  innodReplace: `InnodReplace text="&#10;&#10;"` },
  { id: "ws-def-6", tags: "table",            innodReplace: `one hard return in every end of </p> tag inside <th> and <td>. Replicate set-up of "(KR.FSS) Decree" for table` },
  { id: "ws-def-7", tags: "<td>",             innodReplace: "" },
  { id: "ws-def-8", tags: "<th>",             innodReplace: "" },
];

const MONO  = { fontFamily: "'DM Mono', monospace" } as const;
const SERIF = { fontFamily: "'Georgia', 'Times New Roman', serif" } as const;

const SECTION_META = [
  { num: "I",   label: "Structuring Requirements",    step: 1, color: "#0f766e" },
  { num: "II",  label: "Scope",                       step: 2, color: "#1e40af" },
  { num: "III", label: "Document Structure",          step: 3, color: "#312e81" },
  { num: "IV",  label: "Citation Format Requirements",step: 4, color: "#92400e" },
  { num: "V",   label: "Metadata",                    step: 1, color: "#5b21b6" },
  { num: "VI",  label: "Citation Style Guide Link",   step: 5, color: "#0f766e" },
  { num: "VII", label: "Content Profile",             step: 6, color: "#065f46" },
];

const NAV_ITEMS = [
  { id: "section-structuring-requirements", label: "Structuring Requirements",     icon: "I",   step: 1,    color: "emerald" },
  { id: "section-scope",                    label: "Scope",                        icon: "II",  step: 2,    color: "blue"    },
  { id: "section-toc",                      label: "Document Structure",           icon: "III", step: 3,    color: "indigo"  },
  { id: "section-citations",                label: "Citation Format Requirements", icon: "IV",  step: 4,    color: "amber"   },
  { id: "section-metadata",                 label: "Metadata",                     icon: "V",   step: 1,    color: "violet"  },
  { id: "section-citation-guide",           label: "Citation Style Guide Link",    icon: "VI",  step: 5,    color: "emerald" },
  { id: "section-content-profile",          label: "Content Profile",              icon: "VII", step: 6,    color: "emerald" },
  { id: "section-generate",                 label: "Generate",                     icon: "▶",   step: null, color: "slate"   },
];

type ExportOutlineItem = {
  id: string;
  label: string;
  children?: ExportOutlineItem[];
};

export function buildReviewSectionOrder(showCitationGuide = true) {
  return NAV_ITEMS.filter((item) => showCitationGuide || item.id !== "section-citation-guide");
}

function normalizeExportOutlineLabel(value: unknown): string {
  return brdRichTextToPlain(asString(value)).replace(/\s+/g, " ").trim();
}

export function buildExportDocumentOutline({
  format,
  metadata,
  tocData,
  contentProfileData,
  showCitationGuide = true,
}: {
  format: Format;
  metadata?: Record<string, unknown>;
  tocData?: Record<string, unknown>;
  contentProfileData?: Record<string, unknown>;
  showCitationGuide?: boolean;
}): ExportOutlineItem[] {
  const structuringVariant = detectStructuringVariant(format, metadata);
  const structuringLabel = structuringVariant === "sourceName" ? "Source Name" : "Content Category Name";
  const tocRows = buildTocRows(tocData);
  const documentStructureItems = Array.from(
    new Set(
      tocRows
        .map((row) => normalizeExportOutlineLabel(row.name))
        .filter(Boolean),
    ),
  ).slice(0, 10);
  const hasFileDelivery = [
    contentProfileData?.file_separation,
    contentProfileData?.rc_naming_convention,
    contentProfileData?.rc_naming_example,
    contentProfileData?.zip_naming_convention,
    contentProfileData?.zip_naming_example,
  ].some((value) => asString(value).trim());

  return [
    {
      id: "section-structuring-requirements",
      label: "Structuring Requirements",
      children: [
        { id: "section-structuring-field", label: structuringLabel },
        { id: "section-scope", label: "Scope" },
        ...(normalizeMeaningfulRichText(tocData?.tocSortingOrder)
          ? [{ id: "section-toc-sorting-order", label: "ToC - Sorting Order" }]
          : []),
      ],
    },
    {
      id: "section-toc",
      label: "Document Structure",
      children: documentStructureItems.length > 0
        ? documentStructureItems.map((label, index) => ({
            id: index === 0 ? "section-toc-levels" : "section-toc",
            label,
          }))
        : [{ id: "section-toc-levels", label: "Levels" }],
    },
    {
      id: "section-citations",
      label: "Citation Format Requirements",
      children: [
        { id: "section-citable-levels", label: "Citable Levels" },
        { id: "section-citation-standardization-rules", label: "Citation Standardization Rules" },
      ],
    },
    { id: "section-metadata", label: "Metadata" },
    ...(hasFileDelivery
      ? [{
          id: "section-file-delivery",
          label: "File Delivery Requirements",
          children: [
            { id: "section-file-separation", label: "File Separation" },
            { id: "section-rc-file-naming", label: "RC File Naming Conventions" },
            { id: "section-zip-file-naming", label: "Zip File Naming Conventions" },
          ],
        }]
      : []),
    ...(showCitationGuide ? [{ id: "section-citation-guide", label: "Citation Style Guide Link" }] : []),
    { id: "section-content-profile", label: "Content Profile" },
  ];
}

const GenBtnIcons: Record<string, React.ReactNode> = {
  brd: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="2" width="14" height="16" rx="2" /><path d="M7 7h6M7 10h6M7 13h4" strokeLinecap="round" /></svg>),
  metajson: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><path d="M5 4C5 4 3 5 3 10s2 6 2 6M15 4s2 1 2 6-2 6-2 6M8 7l-2 3 2 3M12 7l2 3-2 3" strokeLinecap="round" strokeLinejoin="round" /></svg>),
  innod: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><path d="M10 3v14M6 6l4-3 4 3M6 14l4 3 4-3" strokeLinecap="round" strokeLinejoin="round" /><rect x="7" y="8" width="6" height="4" rx="1" /></svg>),
  content: (<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M6 8h8M6 11h5" strokeLinecap="round" /><circle cx="14" cy="13" r="2.5" /><path d="M16 15l1.5 1.5" strokeLinecap="round" /></svg>),
};

// ── Helper: find the app's actual scroll container ──────────────────────────
function getScrollContainer(): HTMLElement {
  const explicit = document.querySelector<HTMLElement>("[data-scroll-container]");
  if (explicit) return explicit;

  const overflowScrollable = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    const overflow = style.overflow + style.overflowY;
    return /(auto|scroll)/.test(overflow) && el.scrollHeight > el.clientHeight + 1;
  };

  for (const sel of ["main", "article", "#__next > div", "#root > div", "body > div"]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && overflowScrollable(el)) return el;
  }

  const allDivs = Array.from(document.querySelectorAll<HTMLElement>("div"));
  for (const el of allDivs) {
    if (overflowScrollable(el)) return el;
  }

  return document.scrollingElement as HTMLElement || document.documentElement;
}

function renderExportOutline(items: ExportOutlineItem[], depth = 0): React.ReactNode {
  if (items.length === 0) return null;

  const listStyleType = depth === 0 ? "disc" : depth === 1 ? "circle" : "square";
  return (
    <ul style={{ margin: 0, paddingLeft: depth === 0 ? 22 : 20, listStyleType }}>
      {items.map((item) => (
        <li key={`${item.id}-${item.label}`} style={{ margin: depth === 0 ? "6px 0" : "4px 0" }}>
          <a href={`#${item.id}`} style={{ color: "#1d4ed8", textDecoration: "underline", fontSize: 12.5 }}>
            {item.label}
          </a>
          {item.children?.length ? renderExportOutline(item.children, depth + 1) : null}
        </li>
      ))}
    </ul>
  );
}

function ExportDocumentToc({
  format,
  metadata,
  tocData,
  contentProfileData,
  showCitationGuide = true,
}: {
  format: Format;
  metadata?: Record<string, unknown>;
  tocData?: Record<string, unknown>;
  contentProfileData?: Record<string, unknown>;
  showCitationGuide?: boolean;
}) {
  const items = useMemo(
    () => buildExportDocumentOutline({ format, metadata, tocData, contentProfileData, showCitationGuide }),
    [format, metadata, tocData, contentProfileData, showCitationGuide],
  );

  return (
    <div className="mb-6 rounded-xl border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] px-5 py-4">
      <h2 style={{ ...SERIF, fontSize: 20, fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a" }}>Table of Contents</h2>
      <div>{renderExportOutline(items)}</div>
    </div>
  );
}

function AssistiveTouch({ showCitationGuide = true }: { showCitationGuide?: boolean }) {
  const navItems = useMemo(() => buildReviewSectionOrder(showCitationGuide), [showCitationGuide]);
  const [open, setOpen]             = useState(false);
  const [activeId, setActiveId]     = useState<string>("");
  const [pos, setPos]               = useState(() => ({ x: Math.max(12, window.innerWidth - 72), y: Math.max(12, window.innerHeight / 2) }));
  const [dragging, setDragging]     = useState(false);
  const [didDrag, setDidDrag]       = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const btnRef    = useRef<HTMLDivElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollEl = getScrollContainer();
    function onScroll() {
      setShowScrollTop(scrollEl.scrollTop > 200);
    }
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      const SZ = 52;
      setPos(p => { const maxY = window.innerHeight - SZ - 12; const cx = p.x + SZ / 2; const snapX = cx < window.innerWidth / 2 ? 12 : Math.max(12, window.innerWidth - SZ - 12); return { x: snapX, y: Math.min(Math.max(12, p.y), maxY) }; });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const ids = navItems.map(n => n.id);
    const visibleMap: Record<string, number> = {};
    const scrollEl = getScrollContainer();
    const root = scrollEl === document.documentElement || scrollEl === document.body
      ? null
      : scrollEl;
    const observers = ids.map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(([entry]) => {
        visibleMap[id] = entry.intersectionRatio;
        const best = Object.entries(visibleMap).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActiveId(best[0]);
      }, { root, threshold: [0, 0.1, 0.5, 1] });
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, [navItems]);

  function onPointerDown(e: React.PointerEvent) { if (open) return; e.currentTarget.setPointerCapture(e.pointerId); dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }; setDragging(true); setDidDrag(false); }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx; const dy = e.clientY - dragStart.current.my;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setDidDrag(true);
    const SZ = 52;
    setPos({ x: Math.max(0, Math.min(window.innerWidth - SZ, dragStart.current.px + dx)), y: Math.max(0, Math.min(window.innerHeight - SZ, dragStart.current.py + dy)) });
  }
  function onPointerUp() {
    if (!dragStart.current) return; dragStart.current = null; setDragging(false);
    const SZ = 52; const cx = pos.x + SZ / 2;
    setPos(p => ({ ...p, x: cx < window.innerWidth / 2 ? 12 : window.innerWidth - SZ - 12 }));
    if (!didDrag) setOpen(o => !o);
  }
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) { if (menuRef.current?.contains(e.target as Node)) return; if (btnRef.current?.contains(e.target as Node)) return; setOpen(false); }
    setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function scrollTo(id: string) {
    const scrollEl = getScrollContainer();
    const target = document.getElementById(id);
    if (target) {
      const containerRect = scrollEl === document.documentElement
        ? { top: 0 }
        : scrollEl.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset = scrollEl.scrollTop + (targetRect.top - containerRect.top) - 80;
      scrollEl.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
    }
    setActiveId(id);
    setOpen(false);
  }

  function scrollToTop() {
    const scrollEl = getScrollContainer();
    scrollEl.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    setShowScrollTop(false);
    setOpen(false);
  }

  const SZ = 52; const onRight = pos.x + SZ / 2 > window.innerWidth / 2;
  const menuX = onRight ? Math.max(8, pos.x - 216 - 8) : Math.min(pos.x + SZ + 8, window.innerWidth - 216 - 8);
  const menuTop = Math.min(Math.max(8, pos.y), window.innerHeight - 440);
  const colorMap: Record<string, { dot: string; bg: string; text: string; hover: string }> = {
    blue:    { dot: "bg-blue-500",    bg: "bg-blue-50 dark:bg-blue-500/10",      text: "text-blue-700 dark:text-blue-300",    hover: "hover:bg-blue-50 dark:hover:bg-blue-500/10"    },
    violet:  { dot: "bg-violet-500",  bg: "bg-violet-50 dark:bg-violet-500/10",  text: "text-violet-700 dark:text-violet-300", hover: "hover:bg-violet-50 dark:hover:bg-violet-500/10" },
    indigo:  { dot: "bg-indigo-500",  bg: "bg-indigo-50 dark:bg-indigo-500/10",  text: "text-indigo-700 dark:text-indigo-300", hover: "hover:bg-indigo-50 dark:hover:bg-indigo-500/10" },
    amber:   { dot: "bg-amber-500",   bg: "bg-amber-50 dark:bg-amber-500/10",    text: "text-amber-700 dark:text-amber-300",   hover: "hover:bg-amber-50 dark:hover:bg-amber-500/10"   },
    emerald: { dot: "bg-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10",text: "text-emerald-700 dark:text-emerald-300",hover: "hover:bg-emerald-50 dark:hover:bg-emerald-500/10"},
    slate:   { dot: "bg-slate-500",   bg: "bg-slate-100 dark:bg-[#252d45]",      text: "text-slate-700 dark:text-slate-300",   hover: "hover:bg-slate-100 dark:hover:bg-[#252d45]"    },
  };

  return (
    <>
      <style>{`@keyframes at-pop{0%{transform:scale(0.7) rotate(-10deg);opacity:0}60%{transform:scale(1.08) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}@keyframes at-menu-in{from{opacity:0;transform:scale(0.94) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes at-item-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}.at-btn-ring{box-shadow:0 0 0 3px rgba(100,116,139,.15),0 8px 32px rgba(0,0,0,.18)}.at-btn-ring-open{box-shadow:0 0 0 4px rgba(99,102,241,.25),0 8px 32px rgba(0,0,0,.22)}`}</style>
      <div ref={btnRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        style={{ position:"fixed", left:pos.x, top:pos.y, width:SZ, height:SZ, zIndex:9999, cursor:dragging?"grabbing":"grab", transition:dragging?"none":"left 0.3s cubic-bezier(0.34,1.56,0.64,1),top 0.15s ease", userSelect:"none", touchAction:"none" }}>
        <div className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-200 select-none ${open?"at-btn-ring-open":"at-btn-ring"}`}
          style={{ animation:"at-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both", background:open?"#1e293b":"rgba(255,255,255,0.95)" }}>
          {open ? <svg className="w-5 h-5" fill="none" stroke="#ffffff" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
            : <div className="flex flex-col items-center justify-center gap-[4px]"><span className="block w-[17px] h-[2px] rounded-full" style={{background:"#334155"}}/><span className="block w-[17px] h-[2px] rounded-full" style={{background:"#334155"}}/><span className="block w-[11px] h-[2px] rounded-full" style={{background:"#334155"}}/></div>}
        </div>
        {!open && activeId && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white dark:border-[#1e2235]"/>}
      </div>
      {open && (
        <div ref={menuRef} style={{ position:"fixed", left:menuX, top:menuTop, width:216, zIndex:9998, animation:"at-menu-in 0.2s cubic-bezier(0.16,1,0.3,1) both" }}>
          <div className="rounded-2xl bg-white dark:bg-[#1e2235] border border-slate-200 dark:border-[#2a3147] shadow-2xl overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#181d30] border-b border-slate-100 dark:border-[#2a3147] flex items-center justify-between">
              <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"/><span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Navigation</span></div>
              <span className="text-[8.5px] text-slate-300 dark:text-slate-600 italic" style={MONO}>drag to move</span>
            </div>
            <button onClick={scrollToTop} className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left group transition-all border-b border-slate-100 dark:border-[#2a3147] ${showScrollTop?"bg-slate-800 dark:bg-slate-100":"hover:bg-slate-50 dark:hover:bg-[#252d45]/60"}`} style={{animation:"at-item-in 0.15s ease both"}}>
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${showScrollTop?"bg-white/20":"bg-slate-100 dark:bg-[#252d45]"}`}><svg className={`w-3.5 h-3.5 ${showScrollTop?"text-white dark:text-slate-900":"text-slate-600 dark:text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg></span>
              <span className="text-[11px] font-semibold flex-1" style={{...MONO,color:showScrollTop?"#ffffff":"#475569"}}>Back to Top</span>
            </button>
            <div className="py-1">
              {navItems.map((item, idx) => {
                const isActive = activeId === item.id; const isGen = item.id === "section-generate"; const c = colorMap[item.color ?? "slate"];
                return (
                  <React.Fragment key={item.id}>
                    {isGen && <div className="mx-3 my-1 h-px bg-slate-100 dark:bg-[#2a3147]"/>}
                    <button onClick={() => scrollTo(item.id)} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left group transition-all relative ${isActive?c.bg:c.hover}`} style={{animation:`at-item-in 0.15s ${0.04*idx}s ease both`}}>
                      {isActive && <span className={`absolute left-0 inset-y-0 w-[3px] rounded-r-full ${c.dot}`}/>}
                      <span className={`w-5 text-center text-[11px] font-bold flex-shrink-0 ${isActive?"scale-110":"group-hover:scale-105"}`} style={{...MONO,color:isActive?undefined:"#475569"}}>{item.icon}</span>
                      <span className={`text-[11px] flex-1 leading-tight ${isActive?`font-semibold ${c.text}`:"font-medium"}`} style={{...MONO,color:isActive?undefined:"#475569"}}>{item.label}</span>
                      {item.step && <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isActive?`${c.dot} text-white`:""}`} style={isActive?undefined:{color:"#94a3b8"}}>{item.step}</span>}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RequiredBadge({ val }: { val: string }) {
  if (val === "true") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">true</span>;
  if (val === "false") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-[#2a3147]">false</span>;
  if (val === "Conditional") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40">Cond.</span>;
  return <span className="text-slate-300 dark:text-slate-600 text-[11px]">—</span>;
}
function LevelBadge({ val }: { val: string }) {
  const colors: Record<string, string> = {"0":"bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200","1":"bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200","2":"bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200","3":"bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200","4":"bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200","5":"bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200","6":"bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200"};
  const cls = colors[val] ?? "bg-slate-100 dark:bg-[#252d45] text-slate-600 dark:text-slate-400 border-slate-200";
  return <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-[11px] font-bold border ${cls}`} style={MONO}>{val}</span>;
}

function DocSectionHeader({ idx, onEdit, canEdit = true }: { idx: number; onEdit: (step: number) => void; canEdit?: boolean }) {
  const s = SECTION_META[idx];
  return (
    <div className="flex items-center justify-between mb-4 pb-3" style={{ borderBottom: `2px solid ${s.color}22` }}>
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ ...MONO, color: s.color, opacity: 0.7 }}>Section {s.num}</span>
        <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100 tracking-tight" style={SERIF}>{s.label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-semibold" style={{ ...MONO, color: s.color, borderColor: `${s.color}44`, backgroundColor: `${s.color}0d` }}>Step {s.step}</span>
      </div>
      {canEdit && (
        <button onClick={() => onEdit(s.step)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-[#3a4460] bg-white dark:bg-[#1e2235] hover:bg-slate-50 dark:hover:bg-[#252d45] hover:text-slate-700 dark:hover:text-slate-200 transition-all">
          <EditIcon /> Edit
        </button>
      )}
    </div>
  );
}

function DocBlock({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6" style={{ background:"var(--doc-bg, #fff)", border:"1px solid #e2e2dc", borderRadius:3, boxShadow:"0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04), 2px 2px 0 #f0ede8", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:28, right:28, height:1, background:"linear-gradient(90deg, transparent, #d6d0c8 20%, #d6d0c8 80%, transparent)" }}/>
      <div style={{ padding:"28px 32px 24px" }}>{children}</div>
    </div>
  );
}

function Empty() { return <p className="text-[12px] text-slate-400 dark:text-slate-600 italic py-4 text-center">No data defined</p>; }
function Nil()   { return <span className="text-slate-300 dark:text-slate-600 italic">—</span>; }

const TBL_WRAP = "tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]";
const TH = "px-3 py-2 text-left border-b border-r border-slate-200 dark:border-[#2a3147] last:border-r-0 bg-slate-50 dark:bg-[#1e2235] align-top whitespace-normal";
const TD = "px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147] last:border-r-0 text-[11.5px] text-slate-700 dark:text-slate-300";

function BrdHeaderCell({
  title,
  greenNote,
  checkpoint,
  blueNote,
  className = "",
}: {
  title: string;
  greenNote?: string | string[];
  checkpoint?: string | string[];
  blueNote?: string | string[];
  className?: string;
}) {
  const toLines = (value?: string | string[]) =>
    Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];

  const greenLines = toLines(greenNote);
  const checkpointLines = toLines(checkpoint);
  const blueLines = toLines(blueNote);

  return (
    <th className={`${TH} ${className}`.trim()}>
      <div className="space-y-1 leading-snug">
        <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100" style={SERIF}>{title}</div>
        {greenLines.map((line) => (
          <div key={`g-${line}`} className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            {line}
          </div>
        ))}
        {checkpointLines.map((line) => (
          <div key={`c-${line}`} className="text-[10px] font-semibold text-slate-800 dark:text-slate-200" style={MONO}>
            {line}
          </div>
        ))}
        {blueLines.map((line) => (
          <div key={`b-${line}`} className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
            {line}
          </div>
        ))}
      </div>
    </th>
  );
}

function CitationGuideTable({ tocData }: { tocData?: Record<string, unknown> }) {
  const citationGuide = parseCitationStyleGuide(tocData);
  if (!citationGuide) return <Empty />;

  return (
    <div className="space-y-3">
      {citationGuide.description && (
        <div className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-blue-50 dark:bg-blue-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800 dark:text-blue-300" style={MONO}>Citation Guide · SME Checkpoint</p>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(citationGuide.description) }} />
          </div>
        </div>
      )}

      {citationGuide.rows.length > 0 && (
        <div className={TBL_WRAP}>
          <table className="w-full text-[11.5px]" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <BrdHeaderCell title="Citation Style Guide Link" checkpoint="SME Checkpoint" blueNote="Reference details captured from the BRD source" className="w-1/3" />
                <BrdHeaderCell title="Value" checkpoint="SME Checkpoint" blueNote="Source-aligned values used by the delivery team" className="w-2/3" />
              </tr>
            </thead>
            <tbody>
              {citationGuide.rows.map((row, index) => (
                <tr key={`${row.label}-${index}`} className={index % 2 === 0 ? "bg-slate-50/40 dark:bg-[#1a1f35]" : "bg-white dark:bg-[#161b2e]"}>
                  <td className={`${TD} font-semibold`}>{row.label || "—"}</td>
                  <td className={`${TD} whitespace-pre-wrap break-words`}>
                    {row.value ? <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.value) }} /> : <Nil />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScopeTable({ scopeData, brdId, images }: { scopeData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const rows = buildScopeRows(scopeData); const extra = hasExtraCols(rows);
  const scopeSmeCheckpoint = stripLeadingBrdLabel(
    normalizeMeaningfulRichText(scopeData?.smeCheckpoint ?? scopeData?.scopeSmeCheckpoint ?? scopeData?.scope_sme_checkpoint),
    "SME Checkpoint",
  );

  const normalizeScopeImageKey = (value: string) =>
    value.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^a-z0-9]+/g, "");

  const isScopeImage = (img: CellImageMeta) => {
    if (img.section === "scope") return true;
    const section = (img.section || "").toLowerCase();
    const labelKey = normalizeScopeImageKey(img.fieldLabel || "");
    const textKey = normalizeScopeImageKey(img.cellText || "");
    return (!section || section === "unknown") && (
      img.tableIndex === 3 ||
      labelKey.includes("smecheckpoint") ||
      textKey.includes("smecheckpoint")
    );
  };

  const imagesByLabel = new Map<string, CellImageMeta[]>();
  const imagesByCellText = new Map<string, CellImageMeta[]>();
  const pushImage = (map: Map<string, CellImageMeta[]>, key: string, image: CellImageMeta) => {
    if (!key) return;
    const current = map.get(key) ?? [];
    current.push(image);
    map.set(key, current);
  };

  // Include semantic scope images first, plus legacy/unknown records that still
  // clearly belong to the Scope section or its SME checkpoint.
  images.filter(isScopeImage).forEach(img => {
    pushImage(imagesByLabel, normalizeScopeImageKey(img.fieldLabel || ""), img);
    pushImage(imagesByCellText, normalizeScopeImageKey(img.cellText || ""), img);
  });

  const scopeFieldColumnIndex = {
    title: 0,
    referenceLink: 1,
    contentUrl: 2,
    issuingAuth: 3,
    asrbId: 4,
    smeComments: 5,
  } as const;

  const getScopeImgs = (
    row: ScopeRow,
    rowIndex: number,
    field: "title" | "referenceLink" | "contentUrl" | "issuingAuth" | "asrbId" | "smeComments",
    fallbackText = "",
  ) => {
    const result: CellImageMeta[] = [];
    const seen = new Set<number>();
    const expectedRowIndex = rowIndex + 1;
    const expectedColIndex = scopeFieldColumnIndex[field];
    const stableKey = normalizeScopeImageKey(`${row.stableKey}-${field}`);
    const fallbackKey = normalizeScopeImageKey(fallbackText);
    const fieldAliases = {
      title: [field, "document title"],
      referenceLink: [field, "reference link", "reference url"],
      contentUrl: [field, "content url"],
      issuingAuth: [field, "issuing authority"],
      asrbId: [field, "asrb id"],
      smeComments: [field, "sme comments"],
    }[field].map(normalizeScopeImageKey);
    const genericColLabels = [
      normalizeScopeImageKey(field),
      normalizeScopeImageKey(field.replace(/([A-Z])/g, " $1")),
      normalizeScopeImageKey(`scope-${field}`),
      normalizeScopeImageKey(`scope row ${field}`),
      normalizeScopeImageKey(`-${field}`),
    ].filter(Boolean);

    images.filter(isScopeImage).forEach((image) => {
      if (seen.has(image.id)) return;

      const labelKey = normalizeScopeImageKey(image.fieldLabel || "");
      const cellTextKey = normalizeScopeImageKey(image.cellText || "");
      const sameCell = image.rowIndex === expectedRowIndex && image.colIndex === expectedColIndex;
      const exactStableMatch = !!labelKey && labelKey === stableKey;
      const exactCellTextMatch = !!fallbackKey && cellTextKey === fallbackKey && sameCell;
      const exactAliasMatch = !!labelKey && fieldAliases.includes(labelKey) && sameCell;
      const genericColMatch = !!labelKey && (genericColLabels.includes(labelKey) || genericColLabels.some((label) => label && labelKey.endsWith(label))) && sameCell;
      const legacyCellMatch = sameCell && !labelKey;

      if (exactStableMatch || exactCellTextMatch || exactAliasMatch || genericColMatch || legacyCellMatch) {
        seen.add(image.id);
        result.push(image);
      }
    });

    return result.sort((a, b) => (a.rowIndex - b.rowIndex) || (a.colIndex - b.colIndex) || (a.id - b.id));
  };

  const checkpointImages = (() => {
    const result: CellImageMeta[] = [];
    const seen = new Set<number>();
    const scopeSpecificAliases = [
      "Scope SME Checkpoint",
      "Scope Checkpoint",
      "scope-smeCheckpoint",
      "scope-sme checkpoint",
      "scope-smecheckpoint",
    ].map(normalizeScopeImageKey);
    const genericAliases = ["SME Checkpoint", "SME Check-point"].map(normalizeScopeImageKey);
    const textAliases = [scopeSmeCheckpoint, brdRichTextToPlain(scopeSmeCheckpoint)]
      .map((value) => normalizeScopeImageKey(value || ""))
      .filter(Boolean);

    images.filter(isScopeImage).forEach((image) => {
      if (seen.has(image.id)) return;

      const labelKey = normalizeScopeImageKey(image.fieldLabel || "");
      const textKey = normalizeScopeImageKey(image.cellText || "");
      const sectionKey = normalizeScopeImageKey(image.section || "");
      const isCheckpointSource = image.tableIndex < 0 || image.rowIndex <= 0 || image.rid?.startsWith("manual-");
      if (!isCheckpointSource) return;

      const matchesText = !!textKey && textAliases.includes(textKey);
      const matchesLabel = !!labelKey && (
        scopeSpecificAliases.includes(labelKey) ||
        (genericAliases.includes(labelKey) && (sectionKey === "scope" || matchesText))
      );

      if (matchesLabel || matchesText) {
        seen.add(image.id);
        result.push(image);
      }
    });

    return result.sort((a, b) => (a.rowIndex - b.rowIndex) || (a.colIndex - b.colIndex) || (a.id - b.id));
  })();

  if (rows.length === 0 && !scopeSmeCheckpoint && checkpointImages.length === 0) return <Empty />;

  return (
    <div className="space-y-3">
      {(scopeSmeCheckpoint || checkpointImages.length > 0) && (
        <div className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-blue-50 dark:bg-blue-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800 dark:text-blue-300" style={MONO}>Scope · SME Checkpoint</p>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words space-y-2">
            {scopeSmeCheckpoint && (
              <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(scopeSmeCheckpoint) }} />
            )}
            {checkpointImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className={TBL_WRAP}>
          <table className="w-full text-[11.5px]" style={{ minWidth: 860, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 200 }} />
              {extra.evergreen && <col style={{ width: 80 }} />}
              {extra.ingestion && <col style={{ width: 100 }} />}
            </colgroup>
            <thead><tr>
              <BrdHeaderCell title="Document Title" greenNote="Innodata only - Document Title as appearing on regulator weblink" />
              <BrdHeaderCell title="Reference URL" greenNote="Parent URL for the source" />
              <BrdHeaderCell title="Content URL" greenNote="URL for the title under the source" />
              <BrdHeaderCell title="Issuing Authority" greenNote="Authority/source bucket" />
              <BrdHeaderCell title="ASRB ID" greenNote="Tracking identifier" />
              <BrdHeaderCell title="SME Comments" checkpoint="SME Checkpoint" blueNote="If anything needs be changed, please specify" />
              {extra.evergreen && <BrdHeaderCell title="Initial / Evergreen" greenNote="Scope ingestion mode" />}
              {extra.ingestion && <BrdHeaderCell title="Date of Ingestion" greenNote="Recorded ingestion date" />}
            </tr></thead>
            <tbody>
              {rows.map((row, i) => {
                const oos = row.isOutOfScope;
                const rowHasSourceTone = [
                  row.title,
                  row.referenceLink,
                  row.contentUrl,
                  row.contentNote,
                  row.issuingAuth,
                  row.smeComments,
                  row.initialEvergreen,
                  row.dateOfIngestion,
                ].some(hasBrdRichTextColor);
                const titleImages = getScopeImgs(row, i, "title", row.title);
                const referenceImages = getScopeImgs(row, i, "referenceLink", row.referenceLink);
                const contentImages = getScopeImgs(row, i, "contentUrl", row.contentUrl);
                const authorityImages = getScopeImgs(row, i, "issuingAuth", row.issuingAuth);
                const asrbImages = getScopeImgs(row, i, "asrbId", row.asrbId);
                const smeImages = getScopeImgs(row, i, "smeComments", row.smeComments);

                return (
                  <tr key={row.id} className={oos ? "bg-red-50/70 dark:bg-red-500/10" : i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                    <td className={TD} style={{wordBreak:"break-word"}}>
                      {oos && (
                        <div className="mb-1">
                          <span className="inline-flex items-center rounded-full border border-red-200 dark:border-red-800/40 bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">
                            Excluded
                          </span>
                        </div>
                      )}
                      {row.title
                        ? <span
                            className={oos ? "line-through text-red-600 dark:text-red-400" : ""}
                            title={brdRichTextToPlain(row.title)}
                            dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.title) }}
                          />
                        : <Nil/>}
                      {titleImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={TD}>
                      {renderScopeLink(row.referenceLink, oos, rowHasSourceTone)}
                      {referenceImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={TD} style={{wordBreak:"break-word", whiteSpace:"pre-wrap"}}>
                      {renderScopeLink(row.contentUrl, oos, rowHasSourceTone)}
                      {row.contentNote && (
                        <div className={`mt-1 text-[10.5px] leading-relaxed ${oos ? "line-through text-red-500 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
                          <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.contentNote) }} />
                        </div>
                      )}
                      {contentImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={TD} style={{wordBreak:"break-word"}}>
                      {row.issuingAuth
                        ? <span
                            className={oos ? "line-through text-red-600 dark:text-red-400" : ""}
                            title={brdRichTextToPlain(row.issuingAuth)}
                            dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.issuingAuth) }}
                          />
                        : <Nil/>}
                      {authorityImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={TD} style={{wordBreak:"break-word", whiteSpace:"pre-wrap"}}>
                      {row.asrbId
                        ? <span className="font-mono text-[10.5px] bg-slate-100 dark:bg-[#1e2235] px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#2a3147]">{row.asrbId}</span>
                        : <Nil/>}
                      {asrbImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={TD} style={{wordBreak:"break-word", whiteSpace:"pre-wrap"}}>
                      {row.smeComments
                        ? <span
                            className={oos ? "line-through text-red-600 dark:text-red-400" : ""}
                            title={brdRichTextToPlain(row.smeComments)}
                            dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.smeComments) }}
                          />
                        : <Nil/>}
                      {smeImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    {extra.evergreen && (
                      <td className={TD}>
                        {row.initialEvergreen
                          ? <span
                              className={oos ? "line-through text-red-600 dark:text-red-400" : rowHasSourceTone ? "text-red-700 dark:text-red-400" : ""}
                              dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.initialEvergreen) }}
                            />
                          : "—"}
                      </td>
                    )}
                    {extra.ingestion && (
                      <td className={TD}>
                        {row.dateOfIngestion
                          ? <span
                              className={oos ? "line-through text-red-600 dark:text-red-400" : rowHasSourceTone ? "text-red-700 dark:text-red-400" : ""}
                              dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(row.dateOfIngestion) }}
                            />
                          : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-8 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147] flex justify-between items-center">
            <span className="text-[10px] text-slate-400" style={MONO}>{rows.length} document{rows.length!==1?"s":""}{rows.filter(r=>r.isOutOfScope).length>0&&` · ${rows.filter(r=>r.isOutOfScope).length} excluded`}</span>
            {rows.filter(r=>r.isOutOfScope).length>0&&<span className="text-[9.5px] italic text-slate-400" style={MONO}>Red / struck rows are archived from active scope</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaGrid({ values, format, metadata, brdId, images }: { values: Record<string, string>; format: Format; metadata?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const fields = format === "old"
    ? [
        {label:"Source Name",key:"sourceName"},
        {label:"Authoritative Source",key:"authoritativeSource"},
        {label:"Source Type",key:"sourceType"},
        {label:"Content Type",key:"contentType"},
        {label:"Publication Date",key:"publicationDate"},
        {label:"Last Updated Date",key:"lastUpdatedDate"},
        {label:"Effective Date",key:"effectiveDate"},
        {label:"Comment Due Date",key:"commentDueDate"},
        {label:"Compliance Date",key:"complianceDate"},
        {label:"Processing Date",key:"processingDate"},
        {label:"Issuing Agency",key:"issuingAgency"},
        {label:"Name",key:"name"},
        {label:"Related Government Agency",key:"relatedGovernmentAgency"},
        {label:"Content URL",key:"contentUrl"},
        {label:"Impacted Citation",key:"impactedCitation"},
        {label:"Payload Type",key:"payloadType"},
        {label:"Payload Subtype",key:"payloadSubtype"},
        {label:"Summary",key:"summary"},
        {label:"Geography",key:"geography"},
        {label:"Language",key:"language"},
        {label:"Status",key:"status"},
      ]
    : [
        {label:"Content Category Name",key:"contentCategoryName"},
        {label:"Authoritative Source",key:"authoritativeSource"},
        {label:"Source Type",key:"sourceType"},
        {label:"Content Type",key:"contentType"},
        {label:"Publication Date",key:"publicationDate"},
        {label:"Last Updated Date",key:"lastUpdatedDate"},
        {label:"Effective Date",key:"effectiveDate"},
        {label:"Comment Due Date",key:"commentDueDate"},
        {label:"Compliance Date",key:"complianceDate"},
        {label:"Processing Date",key:"processingDate"},
        {label:"Issuing Agency",key:"issuingAgency"},
        {label:"Name",key:"name"},
        {label:"Related Government Agency",key:"relatedGovernmentAgency"},
        {label:"Content URI",key:"contentUri"},
        {label:"Impacted Citation",key:"impactedCitation"},
        {label:"Payload Type",key:"payloadType"},
        {label:"Payload Subtype",key:"payloadSubtype"},
        {label:"Summary",key:"summary"},
        {label:"Geography",key:"geography"},
        {label:"Language",key:"language"},
        {label:"Status",key:"status"},
      ];
  const commentMap = parseMetadataComments(values.smeComments, fields.map((field) => field.label));
  const customRows = extractCustomMetadataRows(metadata);
  const metadataFieldKeys = new Set(
    fields.flatMap((field) => [
      normalizeMetadataImageLookupKey(field.label),
      normalizeMetadataImageLookupKey(field.key),
    ]),
  );

  // tableIndex=5 is the legacy metadata table fallback, but some uploads persist
  // metadata images with a different table index and only a usable fieldLabel.
  const metaImgs = images.filter((img) => {
    const section = normalizeMetadataImageLookupKey(img.section || "");
    const fieldLabel = normalizeMetadataImageLookupKey(img.fieldLabel || "");

    return section === "metadata"
      || ((!section || section === "unknown") && (img.tableIndex === 5 || metadataFieldKeys.has(fieldLabel)));
  });

  const getRowImages = (field: { label: string; key: string }, index: number): CellImageMeta[] =>
    getMetadataRowImagesForField(field, index, metaImgs);

  const visibleFields = fields
    .map((field, index) => {
      const rawValue = values[field.key] ?? "";
      return {
        field,
        rawValue,
        displayValue: buildMetadataDocumentLocationText(field.key, rawValue, metadata),
        rowImages: getRowImages(field, index),
        rowComment: commentMap[normalizeMetadataCommentKey(field.label)] || "",
      };
    })
    .filter(({ displayValue, rowImages, rowComment }) =>
      hasDocumentLocationValue(displayValue) ||
      hasDocumentLocationValue(rowComment) ||
      rowImages.length > 0
    );

  const visibleCustomRows = customRows.filter(
    (row) => hasDocumentLocationValue(row.value) || hasDocumentLocationValue(row.comment)
  );

  if (visibleFields.length === 0 && visibleCustomRows.length === 0) return <Empty />;

  return (
    <div className="tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]">
      <table className="w-full text-[11.5px]" style={{ minWidth: 980 }}>
        <thead>
          <tr>
            <BrdHeaderCell title="Metadata Element" greenNote="Innodata only - field name from the BRD template" className="w-44" />
            <BrdHeaderCell title="Document Location" greenNote="Source text, date, image, or URL captured from the BRD" />
            <BrdHeaderCell title="SME Comments" checkpoint="SME Checkpoint" blueNote="If anything needs be changed, please specify" className="w-72" />
          </tr>
        </thead>
        <tbody>
        {visibleFields.map(({ field, rawValue, displayValue, rowImages, rowComment }, i) => (
          <tr key={field.key} data-meta-row="1" className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
            <td className="px-3 py-2 w-44 border-r border-slate-100 dark:border-[#2a3147] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 align-middle whitespace-nowrap" style={MONO}>{field.label}</td>
            <td data-doc-location="1" className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 align-top whitespace-pre-wrap break-words">
              {(() => {
                const trimmedValue = rawValue.trim();
                if (!trimmedValue && !displayValue.trim()) {
                  return <span className="text-slate-300 dark:text-slate-600 italic">—</span>;
                }

                const formattedDate = METADATA_DATE_KEYS.has(field.key)
                  ? formatMetadataDateValue(trimmedValue)
                  : null;
                if (formattedDate) {
                  return (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-500/10 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300" style={MONO}>
                      {formattedDate}
                    </span>
                  );
                }

                return renderTextWithLinks(displayValue || rawValue);
              })()}
              {rowImages.map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
            </td>
            <td className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 align-top whitespace-pre-wrap break-words">
              {rowComment ? renderTextWithLinks(rowComment) : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
            </td>
          </tr>
        ))}
        {visibleCustomRows.map((row, index) => {
          const stripeIndex = visibleFields.length + index;
          return (
            <tr key={row.id} data-meta-row="1" className={stripeIndex%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
              <td className="px-3 py-2 w-44 border-r border-slate-100 dark:border-[#2a3147] text-[10px] font-bold uppercase tracking-[0.1em] text-violet-600 dark:text-violet-400 align-middle whitespace-pre-wrap break-words" style={MONO}>
                {row.label || "Custom Row"}
              </td>
              <td data-doc-location="1" className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 align-top whitespace-pre-wrap break-words">
                {row.value ? renderTextWithLinks(row.value) : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
              </td>
              <td className="px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 align-top whitespace-pre-wrap break-words">
                {row.comment ? renderTextWithLinks(row.comment) : <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

/**
 * Shows a cell's current value alongside the original (pre-edit) value.
 * When the user edits a TOC field for the first time, the original is stored
 * in _prev*. This component renders both so neither is lost.
 *
 * Layout:
 *   prev  "original value"        ← muted amber label + strikethrough
 *   latest "user's edit"          ← normal weight, current value
 */
function RichTextInline({ value, className, dataAttr }: { value: string; className: string; dataAttr?: "prev" | "current" }) {
  if (!value) return <Nil />;
  const attr = dataAttr === "prev" ? { "data-prev-value": "1" } : dataAttr === "current" ? { "data-current-value": "1" } : {};
  return (
    <span
      {...attr}
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(value) }}
    />
  );
}

function DraftAndCurrent({ current, prev }: { current: string; prev?: string }) {
  if (!prev) return <>{current ? <RichTextInline value={current} className="whitespace-pre-wrap break-words" dataAttr="current" /> : <Nil />}</>;
  return (
    <div className="space-y-1" data-draft-current="1">
      <div className="flex items-baseline gap-1.5" data-export-part="prev">
        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 shrink-0" style={MONO}>prev</span>
        <RichTextInline value={prev} className="text-[11px] text-slate-400 dark:text-slate-500 line-through whitespace-pre-wrap break-words" dataAttr="prev" />
      </div>
      <div className="flex items-baseline gap-1.5" data-export-part="current">
        <span className="text-[9px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 shrink-0" style={MONO}>latest</span>
        {current ? <RichTextInline value={current} className="text-[11.5px] text-slate-700 dark:text-slate-200 font-medium whitespace-pre-wrap break-words" dataAttr="current" /> : <Nil />}
      </div>
    </div>
  );
}

function TocTable({ tocData, brdId, images, showRestrictedFields = true }: { tocData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[]; showRestrictedFields?: boolean }) {
  const rows = buildTocRows(tocData);
  const tocSortingOrder = stripLeadingBrdLabel(normalizeMeaningfulRichText(tocData?.tocSortingOrder), "SME Checkpoint");
  const tocHidingLevels = normalizeMeaningfulRichText(tocData?.tocHidingLevels);
  if (rows.length === 0 && (!showRestrictedFields || (!tocSortingOrder && !tocHidingLevels))) return <Empty />;
  
  const TOC_COL_MAP: Record<number,string> = {0:"level",1:"name",2:"required",3:"definition",4:"example",5:"note",6:"tocRequirements",7:"smeComments"};
  const extractTocImageLevel = (fieldLabel: string) => {
    const raw = (fieldLabel || "").trim();
    const match = raw.match(/^level\s*(\d+)$/i) || raw.match(/^(\d+)$/);
    return match?.[1] ?? "";
  };
  // Include section="toc" (new records) OR legacy/engineering unknown records that still carry a TOC row level.
  const tocImgs = images.filter(img => {
    const section = (img.section || "").trim().toLowerCase();
    return section === "toc" || ((!section || section === "unknown") && (img.tableIndex === 2 || !!extractTocImageLevel(img.fieldLabel || "")));
  });
  // Build lookup: "levelStr__colKey" → images[]  (fieldLabel match for new records)
  const imagesByLevelCol = new Map<string, CellImageMeta[]>();
  tocImgs.forEach(img => {
    const colKey = TOC_COL_MAP[img.colIndex] ?? "note";
    const normalizedLevel = extractTocImageLevel(img.fieldLabel || "");
    const key = normalizedLevel ? `${normalizedLevel}__${colKey}` : `__row_${img.rowIndex}__${colKey}`;
    const arr = imagesByLevelCol.get(key) || [];
    arr.push(img);
    imagesByLevelCol.set(key, arr);
  });
  
  return (
    <div className="space-y-3">
      {showRestrictedFields && tocSortingOrder && (
        <div id="section-toc-sorting-order" className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-slate-100 dark:bg-[#1e2235]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300" style={MONO}>ToC – Sorting Order</p>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(tocSortingOrder) }} />
          </div>
        </div>
      )}

      {showRestrictedFields && tocHidingLevels && (
        <div className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-slate-100 dark:bg-[#1e2235]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300" style={MONO}>Hiding Level</p>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(tocHidingLevels) }} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div id="section-toc-levels" className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-indigo-50 dark:bg-indigo-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-800 dark:text-indigo-300" style={MONO}>Document Structure Levels</p>
          </div>
          <table className="w-full border-collapse" style={{ minWidth: 1080 }}>
            <thead><tr>
              <BrdHeaderCell title="Level" greenNote="Innodata only - From regulator website" className="w-16" />
              <BrdHeaderCell title="Name" greenNote="Innodata only - Identifies Level" className="w-36" />
              <BrdHeaderCell title="Required" greenNote="True levels must appear / False may or may not appear" className="w-24" />
              <BrdHeaderCell title="Definition" greenNote="Innodata only - Level value as on regulator weblink" className="w-52" />
              <BrdHeaderCell title="Example" greenNote="Innodata only - Sample values of respective Levels" className="w-44" />
              <BrdHeaderCell title="Note" greenNote="Innodata only - Specific instructions for Tech during source configuration" className="w-40" />
              <BrdHeaderCell title="TOC Requirements" checkpoint="SME Checkpoint" blueNote="For SMEs - To specify on how they want ToC to appear in ELA" className="w-48" />
              <BrdHeaderCell title="SME Comments" checkpoint="SME Checkpoint" blueNote="If anything needs be changed, please specify" className="w-44" />
            </tr></thead>
            <tbody>
              {rows.map((row, i) => {
                const lvl = (row.level||"").trim();
                const getImgs = (col: string) => {
                  const byLabel = imagesByLevelCol.get(`${lvl}__${col}`) || [];
                  if (byLabel.length > 0) return byLabel;
                  return imagesByLevelCol.get(`__row_${i + 1}__${col}`) || [];
                };
                return (
                  <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                    <td className={TD}><LevelBadge val={row.level}/></td>
                    <td className={TD}>
                      <DraftAndCurrent current={row.name} prev={row._prevName} />
                    </td>
                    <td className={TD}><RequiredBadge val={row.required}/></td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>
                      <DraftAndCurrent current={row.definition} prev={row._prevDefinition} />
                    </td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>
                      <DraftAndCurrent current={row.example} prev={row._prevExample} />
                      {getImgs("example").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>
                      <DraftAndCurrent current={row.note} prev={row._prevNote} />
                      {getImgs("note").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>
                      <DraftAndCurrent current={row.tocRequirements} prev={row._prevTocRequirements} />
                      {getImgs("tocRequirements").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>
                      <DraftAndCurrent current={row.smeComments} prev={row._prevSmeComments} />
                      {getImgs("smeComments").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-8 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
            <span className="text-[10px] text-slate-400" style={MONO}>{rows.length} level{rows.length!==1?"s":""}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeCitableDisplayValue(value: unknown): "Y" | "N" | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (["Y", "YES", "TRUE", "1"].includes(raw)) return "Y";
  if (["N", "NO", "FALSE", "0"].includes(raw)) return "N";
  return "";
}

function CitableBadge({ val }: { val: string }) {
  const normalized = normalizeCitableDisplayValue(val);
  if (normalized === "Y") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">Y</span>;
  if (normalized === "N") return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#252d45] text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-[#2a3147]">N</span>;
  return <span className="text-slate-300 dark:text-slate-600 text-[11px]">—</span>;
}

function formatDisplay(value: string) {
  const normalized = normalizeBrdCitationText(value);
  if (!normalized) return null;

  return (
    <span
      className="whitespace-pre-wrap break-words"
      dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(normalized) }}
    />
  );
}

function toPlainCheckpointText(value: string): string {
  return brdRichTextToPlain(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^SME\s+Check-?point[:\s-]*/i, "")
    .trim();
}

function extractCitationFormatNotes(checkpoint: string, fallbackStyle = "") {
  const plain = toPlainCheckpointText(checkpoint || fallbackStyle);
  if (!plain) return { citationRulesNote: "", sourceOfLawNote: "" };

  const normalized = plain.replace(/\s*·\s*/g, " · ");
  const match = normalized.match(/([\s\S]*?)(?:[•·]\s*)?Source of Law\s*:?\s*([\s\S]*)/i);
  if (!match) return { citationRulesNote: normalized, sourceOfLawNote: "" };

  return {
    citationRulesNote: match[1].trim(),
    sourceOfLawNote: match[2].trim() ? `Source of Law: ${match[2].trim()}` : "",
  };
}

function CitationTable({ citationsData, brdId, images }: { citationsData?: Record<string, unknown>; brdId?: string; images: CellImageMeta[] }) {
  const citations = asRecordArray(citationsData?.references);
  const citationLevelSmeCheckpoint = stripLeadingBrdLabel(
    normalizeMeaningfulRichText(citationsData?.citationLevelSmeCheckpoint ?? citationsData?.citableLevelsSmeCheckpoint),
    "SME Checkpoint",
  );
  const citationRulesGuidance = normalizeMeaningfulRichText(
    citationsData?.citationRulesSmeCheckpoint ?? citationsData?.citation_style,
  );
  const citationRulesSmeCheckpoint = stripLeadingBrdLabel(citationRulesGuidance, "SME Checkpoint");
  const citableLevelsNote = toPlainCheckpointText(citationLevelSmeCheckpoint);
  const { citationRulesNote, sourceOfLawNote } = extractCitationFormatNotes(
    citationRulesGuidance,
    normalizeMeaningfulRichText(citationsData?.citation_style),
  );
  if (citations.length === 0 && !citationLevelSmeCheckpoint && !citationRulesSmeCheckpoint) return <Empty />;
  
  const CIT_COL_MAP: Record<number,string> = {0:"level",1:"citationRules",2:"sourceOfLaw",3:"smeComments"};
  // tableIndex=4 is the citation rules table (col1=citationRules, col3=smeComments)
  const citImgs = images.filter(img =>
    img.section === "citations" ||
    ((!img.section || img.section === "unknown") && img.tableIndex === 4)
  );
  const imagesByLevelCol = new Map<string, CellImageMeta[]>();
  citImgs.forEach(img => {
    const colKey = CIT_COL_MAP[img.colIndex] ?? "smeComments";
    const fl = (img.fieldLabel || "").trim();
    const key = fl ? `${fl}__${colKey}` : `__row_${img.rowIndex}__${colKey}`;
    const arr = imagesByLevelCol.get(key) || [];
    arr.push(img);
    imagesByLevelCol.set(key, arr);
  });
  
  return (
    <div className="space-y-3">
      <div id="section-citable-levels" />
      {citationLevelSmeCheckpoint && (
        <div className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-blue-50 dark:bg-blue-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800 dark:text-blue-300" style={MONO}>Citable Levels · SME Checkpoint</p>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(citationLevelSmeCheckpoint) }} />
          </div>
        </div>
      )}

      <div id="section-citation-standardization-rules" />
      {citationRulesSmeCheckpoint && (
        <div className={TBL_WRAP}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-blue-50 dark:bg-blue-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-800 dark:text-blue-300" style={MONO}>Citation Standardization Rules · SME Checkpoint</p>
          </div>
          <div className="px-4 py-3 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(citationRulesSmeCheckpoint) }} />
          </div>
        </div>
      )}

      {citations.length > 0 && (
        <div className="space-y-3">
          <div className={TBL_WRAP}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-amber-50 dark:bg-amber-500/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300" style={MONO}>Citable Levels</p>
            </div>
            <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: 420 }}>
              <thead><tr>
                <BrdHeaderCell title="Level" greenNote="Citation level" />
                <BrdHeaderCell title="Citable Levels" checkpoint="SME Checkpoint" blueNote={citableLevelsNote || "Indicate which levels are citable."} />
              </tr></thead>
              <tbody>
                {citations.map((row, i) => (
                  <tr key={`citable-${i}`} className={i%2===0?"bg-white dark:bg-transparent":"bg-slate-50/40 dark:bg-[#1a1f35]/40"}>
                    <td className={`w-14 ${TD}`}><LevelBadge val={asString(row.level)}/></td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>
                      <CitableBadge val={asString(row.isCitable)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={TBL_WRAP}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#2a3147] bg-amber-50 dark:bg-amber-500/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300" style={MONO}>Citation Standardization Rules</p>
            </div>
            <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: 720 }}>
              <thead><tr>
                <BrdHeaderCell title="Level" greenNote="Citation level" />
                <BrdHeaderCell title="Citation Standardization Rules" checkpoint="SME Checkpoint" blueNote={citationRulesNote || "This should include the levels that form the citation and the punctuations or symbols between the Levels."} />
                <BrdHeaderCell title="Source of Law" checkpoint="SME Checkpoint" blueNote={sourceOfLawNote || "SME to indicate which Level should be Source of Law."} />
                <BrdHeaderCell title="SME Comments" checkpoint="SME Checkpoint" blueNote="If anything needs be changed, please specify here" />
              </tr></thead>
              <tbody>
                {citations.map((row, i) => {
                  const lvl = `Level ${asString(row.level)}`;
                  const getImgs = (col: string) => {
                    const byLabel = imagesByLevelCol.get(`${lvl}__${col}`) || [];
                    if (byLabel.length > 0) return byLabel;
                    return imagesByLevelCol.get(`__row_${i + 1}__${col}`) || [];
                  };
                  return (
                    <tr key={`rules-${i}`} className={i%2===0?"bg-white dark:bg-transparent":"bg-slate-50/40 dark:bg-[#1a1f35]/40"}>
                      <td className={`w-14 ${TD}`}><LevelBadge val={asString(row.level)}/></td>
                      <td className={`${TD} whitespace-pre-wrap break-words`}>
                        {formatDisplay(asString(row.citationRules)) || "—"}
                        {getImgs("citationRules").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                      </td>
                      <td className={`${TD} whitespace-pre-wrap break-words`}>
                        {formatDisplay(asString(row.sourceOfLaw)) || "—"}
                      </td>
                      <td className={`${TD} whitespace-pre-wrap break-words`}>
                        {formatDisplay(asString(row.smeComments)) || "—"}
                        {getImgs("smeComments").map(img => <InlineImageCell key={img.id} brdId={brdId} image={img} />)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ContentProfileFileDelivery({ cpData }: { cpData?: Record<string, unknown> }) {
  const fileSeparation = String(cpData?.file_separation ?? "").trim();
  const rcNamingConvention = String(cpData?.rc_naming_convention ?? cpData?.rc_filename ?? "").trim();
  const rcNamingExample = String(cpData?.rc_naming_example ?? "").trim();
  const zipNamingConvention = String(cpData?.zip_naming_convention ?? "").trim();
  const zipNamingExample = String(cpData?.zip_naming_example ?? "").trim();

  if (!fileSeparation && !rcNamingConvention && !rcNamingExample && !zipNamingConvention && !zipNamingExample) {
    return null;
  }

  return (
    <div id="section-file-delivery" className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400 mb-2" style={MONO}>File Delivery Requirements</p>
        <ul className="list-disc pl-5 text-[11.5px] text-slate-700 dark:text-slate-300 space-y-1">
          <li>Innodata and Tech will use this information for delivery tracking.</li>
        </ul>
      </div>

      {fileSeparation && (
        <div id="section-file-separation" className="rounded-xl border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300 mb-2" style={MONO}>File Separation</p>
          <div className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            {renderTextWithLinks(fileSeparation)}
          </div>
        </div>
      )}

      {(rcNamingConvention || rcNamingExample) && (
        <div id="section-rc-file-naming" className="rounded-xl border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300" style={MONO}>RC File Naming Conventions</p>
          {rcNamingConvention && <div className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{renderTextWithLinks(rcNamingConvention)}</div>}
          {rcNamingExample && <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words"><strong>Example:</strong> {renderTextWithLinks(rcNamingExample)}</div>}
        </div>
      )}

      {(zipNamingConvention || zipNamingExample) && (
        <div id="section-zip-file-naming" className="rounded-xl border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300" style={MONO}>Zip File Naming Conventions</p>
          {zipNamingConvention && <div className="text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{renderTextWithLinks(zipNamingConvention)}</div>}
          {zipNamingExample && <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words"><strong>Example:</strong> {renderTextWithLinks(zipNamingExample)}</div>}
        </div>
      )}
    </div>
  );
}

function ContentProfile({ cpData }: { cpData?: Record<string, unknown> }) {
  const levels = useMemo(() => asExtractedLevels(cpData), [cpData]);
  const hardcodedPathFromData = String(cpData?.hardcoded_path ?? cpData?.hardcodedPath ?? "").trim();
  const derivedHardcodedPath = useMemo(() => deriveHardcodedPath(levels), [levels]);
  const hardcodedPath = hardcodedPathFromData || derivedHardcodedPath;
  const rcFilename = String(cpData?.rc_filename ?? "");
  const headingAnnotation = String(cpData?.heading_annotation ?? "");
  const wsRows = useMemo(() => { const e = asExtractedWhitespace(cpData); return e.length > 0 ? e : DEFAULT_WHITESPACE_ROWS; }, [cpData]);
  
  return (
    <div className="space-y-5">
      <ContentProfileFileDelivery cpData={cpData} />
      <div className="tbl-scroll -mx-8 border-t border-b border-slate-200 dark:border-[#2a3147]">
        {[["RC Filename",rcFilename,true],["Hardcoded Path",hardcodedPath,true],["Heading Annotation",headingAnnotation,false]].map(([label,value,mono],i)=>(
          <div key={label as string} className={`flex items-center border-b border-slate-100 dark:border-[#2a3147] last:border-0 ${i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}`}>
            <div className="w-40 shrink-0 px-3 py-2 border-r border-slate-100 dark:border-[#2a3147]"><span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400" style={MONO}>{label as string}</span></div>
            <div className="flex-1 px-3 py-1.5"><span className={`text-[11.5px] ${mono?"font-mono":""} ${value?"text-sky-700 dark:text-sky-400 font-semibold":"text-slate-400 dark:text-slate-600 italic"}`}>{(value as string)||"—"}</span></div>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-2" style={MONO}>Level Numbers</p>
        <div className={TBL_WRAP}>
          <table className="w-full border-collapse" style={{ minWidth: 860 }}>
            <thead><tr>
              <th className={`w-20 ${TH}`}>Level #</th><th className={`w-64 ${TH}`}>Description</th>
              <th className={TH}>REDJAy XML Tag <span className="text-sky-500 ml-1 normal-case">⚡ auto</span></th>
              <th className={`w-48 ${TH}`}>Path</th><th className={`w-44 ${TH}`}>Remarks / Notes</th>
            </tr></thead>
            <tbody>
              {levels.length===0
                ?<tr><td colSpan={5} className="py-6 text-center text-[12px] text-slate-400 italic">No levels defined</td></tr>
                :levels.map((row,i)=>(
                    <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                      <td className={TD}><span className="font-mono text-[11px]">{row.levelNumber||"—"}</span></td>
                      <td className={`${TD} whitespace-pre-line`}>{row.description||<Nil/>}</td>
                      <td className={TD}>
                        <span className={`text-[11px] font-mono whitespace-pre-line select-all ${row.redjayXmlTag==="Hardcoded"?"text-amber-700 dark:text-amber-400 font-semibold":"text-sky-700 dark:text-sky-400"}`}>{row.redjayXmlTag||<Nil/>}</span>
                      </td>
                      <td className={TD}><span className="font-mono text-[11px]">{row.path||<Nil/>}</span></td>
                      <td className={TD}>{row.remarksNotes||<Nil/>}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-2" style={MONO}>Whitespace Handling</p>
        <div className={TBL_WRAP}>
          <table className="w-full border-collapse" style={{ minWidth: 480 }}>
            <thead><tr><th className={`w-44 ${TH}`}>Tags</th><th className={TH}>InnodReplace</th></tr></thead>
            <tbody>
              {wsRows.map((row,i)=>(
                <tr key={row.id} className={i%2===0?"bg-white dark:bg-[#161b2e]":"bg-slate-50/40 dark:bg-[#1a1f35]"}>
                  <td className={`${TD} font-mono text-violet-700 dark:text-violet-400`}>{row.tags||<Nil/>}</td>
                  <td className={TD}>{row.innodReplace||<Nil/>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147]">
            <span className="text-[10px] text-slate-400" style={MONO}>{wsRows.length} rule{wsRows.length!==1?"s":""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function sanitizeFilePart(v: string) { return v.replace(/[^a-zA-Z0-9._-]/g, "_"); }

function escapeXml(v: unknown) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildExcelHtml(html: string, t: string) {
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><title>${t}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111827}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px;vertical-align:top;white-space:normal!important;word-break:break-word}.tbl-scroll{overflow:visible!important}.dark *{color:#111827!important;background:#ffffff!important}</style></head><body>${html}</body></html>`;
}

function buildWordHtml(html: string, t: string) {
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><title>${escapeXml(t)}</title><style>@page WordSection1{size:8.5in 11in;margin:0.65in 0.7in 0.7in 0.7in;}body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111827;line-height:1.45;}table{border-collapse:collapse;width:100%;margin:10px 0;}th,td{border:1px solid #cbd5e1;padding:4px 6px;vertical-align:top;white-space:normal!important;word-break:break-word;}h1,h2,h3,h4,h5,h6{font-family:Georgia,"Times New Roman",serif;color:#0f172a;margin:14px 0 8px;page-break-after:avoid;}a{color:#1d4ed8;text-decoration:underline;}img{display:block;max-width:100%;height:auto;margin:6px 0;page-break-inside:avoid;border:1px solid #cbd5e1;}.tbl-scroll{overflow:visible!important;}.dark *{color:#111827!important;background:#ffffff!important;}</style></head><body><div class="WordSection1">${html}</div></body></html>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to convert export image to a data URL."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read export image blob."));
    reader.readAsDataURL(blob);
  });
}

async function inlineExportImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (img) => {
    const src = img.getAttribute("src")?.trim();
    if (!src) {
      img.remove();
      return;
    }

    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.removeAttribute("loading");
    img.removeAttribute("decoding");
    img.style.maxWidth = img.style.maxWidth || "100%";
    img.style.maxHeight = img.style.maxHeight || "128px";
    img.style.height = img.style.height || "auto";
    img.style.objectFit = img.style.objectFit || "contain";
    img.style.display = img.style.display || "block";
    img.style.margin = img.style.margin || "6px 0";
    img.style.pageBreakInside = img.style.pageBreakInside || "avoid";

    if (src.startsWith("data:")) return;

    try {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) throw new Error(`Image request failed with status ${response.status}`);
      const blob = await response.blob();
      img.setAttribute("src", await blobToDataUrl(blob));
    } catch (error) {
      console.warn("[prepareBrdExportElement] Failed to inline BRD image for export", { src, error });
    }
  }));
}

function buildStoredZip(files: Record<string, string>, mimeType: string): Blob {
  function toBytes(str: string): Uint8Array {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    const utf8 = unescape(encodeURIComponent(str));
    return Uint8Array.from(utf8, ch => ch.charCodeAt(0));
  }
  function u32le(n: number): number[] { return [n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff]; }
  function u16le(n: number): number[] { return [n&0xff,(n>>8)&0xff]; }
  function joinParts(parts: Array<number[] | Uint8Array>): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
      const bytes = part instanceof Uint8Array ? part : Uint8Array.from(part);
      out.set(bytes, cursor);
      cursor += bytes.length;
    }
    return out;
  }
  function toBlobPart(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
  }
  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    const crc32Fn = crc32 as unknown as { _t?: Uint32Array };
    const table = crc32Fn._t ?? (() => {
      const lookup = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        lookup[i] = c;
      }
      return (crc32Fn._t = lookup);
    })();
    for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const [path, content] of Object.entries(files)) {
    const nameBytes = toBytes(path);
    const dataBytes = toBytes(content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const local = joinParts([
      [0x50,0x4b,0x03,0x04],
      u16le(20), u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(crc), u32le(size), u32le(size), u16le(nameBytes.length), u16le(0),
      nameBytes, dataBytes,
    ]);
    const central = joinParts([
      [0x50,0x4b,0x01,0x02],
      u16le(20), u16le(20), u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(crc), u32le(size), u32le(size), u16le(nameBytes.length), u16le(0), u16le(0), u16le(0), u16le(0), u32le(0), u32le(offset),
      nameBytes,
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
    centralSize += central.length;
  }

  const numFiles = Object.keys(files).length;
  const eocd = Uint8Array.from([0x50,0x4b,0x05,0x06,...u16le(0),...u16le(0),...u16le(numFiles),...u16le(numFiles),...u32le(centralSize),...u32le(offset),...u16le(0)]);
  const blobParts: BlobPart[] = [
    ...localParts.map(toBlobPart),
    ...centralParts.map(toBlobPart),
    toBlobPart(eocd),
  ];
  return new Blob(blobParts, { type: mimeType });
}

export function buildBrdExportFilename(title?: string, brdId?: string): string {
  const safeTitle = sanitizeFilePart((title || "BRD").trim()).replace(/^_+|_+$/g, "") || "BRD";
  const safeId = sanitizeFilePart((brdId || "NO_ID").trim()).replace(/^_+|_+$/g, "") || "NO_ID";
  return `${safeTitle}-${safeId}.docx`;
}

export async function prepareBrdExportElement(sourceEl: HTMLElement): Promise<HTMLElement> {
  const clone = sourceEl.cloneNode(true) as HTMLElement;

  clone.querySelectorAll("[data-export-only='1']").forEach((node) => {
    const element = node as HTMLElement;
    element.style.display = "block";
    element.hidden = false;
  });

  clone.querySelector("#section-generate")?.closest("[style*='paddingTop']")?.remove();
  clone.querySelector("#section-generate")?.remove();

  clone.querySelectorAll("[data-draft-current='1']").forEach((node) => {
    const current = node.querySelector("[data-current-value='1']")?.textContent?.trim();
    const prev = node.querySelector("[data-prev-value='1']")?.textContent?.trim();
    const replacement = document.createElement("span");
    replacement.textContent = current || prev || "—";
    replacement.style.whiteSpace = "pre-wrap";
    replacement.style.wordBreak = "break-word";
    node.replaceWith(replacement);
  });

  clone.querySelectorAll("button, svg, canvas, iframe, object, embed").forEach(el => el.remove());
  clone.querySelectorAll("a").forEach(link => {
    link.removeAttribute("target");
    link.removeAttribute("rel");
    const text = link.textContent?.trim();
    const href = link.getAttribute("href")?.trim();
    if (!text && href) link.textContent = href;
  });
  clone.querySelectorAll("tr[data-meta-row='1']").forEach((row) => {
    const docLocation = row.querySelector("[data-doc-location='1']")?.textContent;
    if (!hasDocumentLocationValue(docLocation)) {
      row.remove();
    }
  });

  clone.querySelectorAll("div").forEach(div => {
    const style = div.getAttribute("style") ?? "";
    if ((style.includes("borderBottom") || style.includes("border-bottom")) && div.querySelector("span")) {
      const labelEl = Array.from(div.querySelectorAll("span")).find(s =>
        (s.getAttribute("style") ?? "").includes("serif") || (s.getAttribute("style") ?? "").includes("Georgia")
      );
      const label = labelEl?.textContent?.trim();
      if (label) {
        const replacement = document.createElement("div");
        replacement.style.cssText = "font-weight:700;font-size:13pt;padding-bottom:6px;margin-bottom:10px;border-bottom:2px solid #1e293b;font-family:Georgia,serif;letter-spacing:-0.01em;";
        replacement.textContent = label;
        div.replaceWith(replacement);
      }
    }
  });

  clone.querySelectorAll("div").forEach(div => {
    if (/^\s*\d+\s+(document|section|rule)/i.test(div.textContent ?? "") && div.children.length <= 3) {
      div.remove();
    }
  });

  clone.querySelectorAll("[style*='linear-gradient']").forEach(d => d.remove());
  await inlineExportImages(clone);
  return clone;
}

export function buildWordDocxBlob(html: string, t: string): Blob {
  const now = new Date().toISOString();
  const wrappedHtml = buildWordHtml(html, t);
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="html" ContentType="text/html"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Structo</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Sections</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>BRD Export</vt:lpstr></vt:vector></TitlesOfParts>
  <Company>Structo</Company>
</Properties>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(t)}</dc:title>
  <dc:creator>Structo</dc:creator>
  <cp:lastModifiedBy>Structo</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">
  <w:body>
    <w:altChunk r:id="rId1"/>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="936" w:right="1008" w:bottom="936" w:left="1008" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.html"/>
</Relationships>`,
    "word/afchunk.html": wrappedHtml,
  };

  return buildStoredZip(files, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

const GEN_BTN_CONFIG: Record<string, { label:string; sublabel:string; description:string; iconKey:keyof typeof GenBtnIcons; accentLight:string; accentDark:string; iconColorLight:string; iconColorDark:string; btnBg:string; btnHover:string; badgeLabel:string }> = {
  brd:      { label:"BRD Document",    sublabel:"Export",    description:"Full BRD content as Word document",        iconKey:"brd",      accentLight:"#f1f5f9", accentDark:"#252d45", iconColorLight:"#475569", iconColorDark:"#94a3b8", btnBg:"#1e293b", btnHover:"#334155", badgeLabel:".docx" },
  metajson: { label:"Metajson",         sublabel:"Generate", description:"Structured metadata as JSON schema",        iconKey:"metajson", accentLight:"#eff6ff", accentDark:"#1e2d4d", iconColorLight:"#1d4ed8", iconColorDark:"#60a5fa", btnBg:"#1d4ed8", btnHover:"#1e40af", badgeLabel:".json" },
  innod:    { label:"Innod Metajson",   sublabel:"Generate", description:"Innod.Xml-compatible metadata output",      iconKey:"innod",    accentLight:"#eef2ff", accentDark:"#1e1f4d", iconColorLight:"#4338ca", iconColorDark:"#818cf8", btnBg:"#4338ca", btnHover:"#3730a3", badgeLabel:".json" },
  content:  { label:"Content Profile",  sublabel:"Export",   description:"Levels & whitespace rules as Excel",        iconKey:"content",  accentLight:"#f5f3ff", accentDark:"#2a1f45", iconColorLight:"#7c3aed", iconColorDark:"#a78bfa", btnBg:"#7c3aed", btnHover:"#6d28d9", badgeLabel:".xls"  },
};

export default function Generate({ brdId, title, format, status, initialData, onEdit, onComplete, canEdit = true, showCellImages = true, imageIds }: Props) {
  const { user } = useAuth();
  const teamSlug = String(user?.team?.slug ?? "").toLowerCase();
  const isPrivilegedUser = user?.role === "SUPER_ADMIN" || (teamSlug === "pre-production" && user?.role === "ADMIN");
  const canViewRestrictedFields = !["APPROVED", "ON_HOLD"].includes(String(status ?? "").toUpperCase()) || isPrivilegedUser;
  const isApproved = status === "APPROVED";
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [done, setDone]             = useState<Record<string, boolean>>({});
  const [completed, setCompleted]   = useState<Record<string, boolean>>({});
  const [saving,    setSaving]      = useState(false);
  const [savedToDB, setSavedToDB]   = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [savedVersionLabel, setSavedVersionLabel] = useState<string | null>(null);
  const generateUnlocked            = !canEdit || savedToDB;
  const [metajsonModal, setMetajsonModal] = useState<{open:boolean;data:Record<string,unknown>|null;filename:string}>({open:false,data:null,filename:"meta.json"});
  const [innodModal,    setInnodModal]    = useState<{open:boolean;data:Record<string,unknown>|null;filename:string}>({open:false,data:null,filename:"innodMeta.json"});
  const doneResetTimers   = useRef<Record<string, number>>({});
  const docPageRef        = useRef<HTMLDivElement>(null);
  const contentProfileRef = useRef<HTMLDivElement>(null);
  
  const { images: allImages } = useCellImages(brdId, showCellImages, imageIds);
  // Filter to only images that existed at the time this version was saved.
  // If imageIds is null/undefined (e.g. current edit view), show all images.
  const allowedIds = imageIds != null ? new Set(imageIds) : null;
  const images = allowedIds ? allImages.filter(img => allowedIds.has(img.id)) : allImages;

  useEffect(() => {
    const timers = doneResetTimers.current;
    return () => {
      Object.values(timers).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const scopeData          = asRecord(initialData?.scope);
  const metadataData       = asRecord(initialData?.metadata);
  const tocData            = asRecord(initialData?.toc);
  const citationsData      = asRecord(initialData?.citations);
  const contentProfileData = asRecord(initialData?.contentProfile);
  const brdConfigData      = asRecord(initialData?.brdConfig);

  const activeFormat: Format   = format === "old" ? "old" : "new";
  const metadataValues         = buildTemplateMetadataValues(activeFormat, metadataData);
  const structuringVariant = useMemo(
    () => detectStructuringVariant(activeFormat, metadataData),
    [activeFormat, metadataData],
  );
  const visibleSectionCount = buildReviewSectionOrder(canViewRestrictedFields)
    .filter((item) => item.id !== "section-generate")
    .length;
  const autoTitle              = deriveTitle(metadataData, title);
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const derivedTitle           = customTitle ?? autoTitle;
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(derivedTitle);
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  useEffect(() => {
    if (!titleEditing) setTitleDraft(derivedTitle);
  }, [derivedTitle, titleEditing]);
  const displayTitle           = (titleEditing ? titleDraft : derivedTitle) || derivedTitle;
  const resolvedTitle          = displayTitle.trim() || derivedTitle;
  const resolvedSaveStatus: SaveStatus =
    status === "PAUSED" || status === "COMPLETED" || status === "APPROVED" || status === "ON_HOLD"
      ? status
      : "DRAFT";
  const saveStatusLabel =
    resolvedSaveStatus === "COMPLETED"
      ? "Complete"
      : resolvedSaveStatus === "ON_HOLD"
      ? "On Hold"
      : resolvedSaveStatus.charAt(0) + resolvedSaveStatus.slice(1).toLowerCase();

  function markDone(key: string, ms = 1600) {
    if (doneResetTimers.current[key]) window.clearTimeout(doneResetTimers.current[key]);
    setDone(p => ({ ...p, [key]: true }));
    doneResetTimers.current[key] = window.setTimeout(() => { setDone(p => ({ ...p, [key]: false })); delete doneResetTimers.current[key]; }, ms);
  }

  function downloadExcelFile(base: string, t: string, el: HTMLElement) {
    const blob = new Blob(["\ufeff", buildExcelHtml(el.outerHTML, t)], {type:"application/vnd.ms-excel;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${sanitizeFilePart(base)}.xls`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function downloadDocxFile(base: string, t: string, el: HTMLElement) {
    const blob = buildWordDocxBlob(el.outerHTML, t);
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${sanitizeFilePart(base)}.docx`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function syncGeneratedJsonOutputs() {
    if (!brdId) return;

    const generated = await api.post<{ success: boolean; metajson: Record<string, unknown> }>(
      "/brd/generate/metajson",
      {
        brdId,
        title: resolvedTitle,
        format,
        scope: scopeData,
        metadata: metadataData,
        toc: tocData,
        citations: citationsData,
        contentProfile: contentProfileData,
        brdConfig: brdConfigData,
      },
    );

    await Promise.all([
      api.put(`/brd/${brdId}/sections/simpleMetajson`, { data: generated.data.metajson }),
      api.put(`/brd/${brdId}/sections/innodMetajson`, { data: generated.data.metajson }),
    ]);
  }

  async function handleSaveBrd() {
    if (!brdId) return; setSaving(true); setSaveError(null); setSavedVersionLabel(null);
    try {
      let saveWarning: string | null = null;

      await api.post("/brd/save", { brdId, title: resolvedTitle, format, status: resolvedSaveStatus, scope: scopeData, metadata: metadataData, toc: tocData, citations: citationsData, contentProfile: contentProfileData, brdConfig: brdConfigData });

      try {
        await syncGeneratedJsonOutputs();
      } catch (syncErr) {
        console.warn("[handleSaveBrd] Failed to refresh Metajson/Innod outputs after save:", syncErr);
        saveWarning = saveWarning ?? "BRD saved, but failed to refresh Metajson and Innod outputs.";
      }

      try {
        const versionResponse = await api.post<{ versionNum: number; label?: string }>(`/brd/${brdId}/versions`, {
          scope: scopeData,
          metadata: metadataData,
          toc: tocData,
          citations: citationsData,
          contentProfile: contentProfileData,
          brdConfig: brdConfigData,
        });
        setSavedVersionLabel(
          versionResponse.data.label?.trim() ||
            `v${versionResponse.data.versionNum}.0`,
        );
      } catch (versionErr: unknown) {
        const versionError = versionErr as { response?: { data?: { error?: string } }; message?: string };
        setSaveError(
          saveWarning ??
          versionError?.response?.data?.error ??
            versionError?.message ??
            "BRD saved, but failed to create a new version snapshot.",
        );
      }

      if (saveWarning) {
        setSaveError(saveWarning);
      }
      setSavedToDB(true);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setSaveError(error?.response?.data?.error ?? error?.message ?? "Save failed.");
    }
    finally { setSaving(false); }
  }

  async function handleTitleSave() {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleError("Title cannot be empty.");
      return;
    }

    setTitleSaving(true);
    setTitleError(null);
    try {
      if (brdId) {
        await api.patch(`/brd/${brdId}`, { title: nextTitle });
      }
      setCustomTitle(nextTitle);
      setTitleDraft(nextTitle);
      setTitleEditing(false);
      setSavedToDB(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setTitleError(error?.response?.data?.error ?? error?.message ?? "Failed to update title.");
    } finally {
      setTitleSaving(false);
    }
  }

  async function runGenerateBrdDocx() {
    setGenerating(p=>({...p,brd:true}));
    try {
      const page = docPageRef.current; if (!page) throw new Error("BRD content not found");
      const clone = await prepareBrdExportElement(page);
      const exportName = buildBrdExportFilename(resolvedTitle, brdId);
      downloadDocxFile(exportName.replace(/\.docx$/i, ""), `${resolvedTitle || brdId || "BRD"} - BRD`, clone);
      setCompleted(p=>({...p,brd:true})); markDone("brd");
    } catch (error) { console.log("[runGenerateBrdDocx]", error); window.alert("Failed to generate BRD Word document."); setDone(p=>({...p,brd:false})); setCompleted(p=>({...p,brd:false})); }
    finally { setGenerating(p=>({...p,brd:false})); }
  }

  async function runGenerateContentProfileExcel() {
    setGenerating(p=>({...p,content:true}));
    try {
      const s = contentProfileRef.current; if (!s) throw new Error("Section not found");
      downloadExcelFile(`${brdId||"BRD"}_ContentProfile`, `${brdId||"BRD"} - Content Profile`, s.cloneNode(true) as HTMLElement);
      setCompleted(p=>({...p,content:true})); markDone("content");
    } catch { window.alert("Failed to generate Content Profile Excel."); setDone(p=>({...p,content:false})); setCompleted(p=>({...p,content:false})); }
    finally { setGenerating(p=>({...p,content:false})); }
  }

  async function runGenerateMetajson() {
    setGenerating(p=>({...p,metajson:true}));
    try {
      const r = await api.post<{success:boolean;metajson:Record<string,unknown>;filename?:string}>("/brd/generate/metajson",{brdId,title:resolvedTitle,format,scope:scopeData,metadata:metadataData,toc:tocData,citations:citationsData,contentProfile:contentProfileData,brdConfig:brdConfigData});
      // Load any previously saved version and merge — saved takes priority as initial value
      let initialData = r.data.metajson;
      if (brdId) {
        try {
          const saved = await api.get<{simpleMetajson: Record<string,unknown>|null}>(`/brd/${brdId}/sections/simpleMetajson`);
          if (saved.data.simpleMetajson) initialData = saved.data.simpleMetajson;
        } catch { /* no saved version yet, use generated */ }
      }
      setMetajsonModal({open:true,data:initialData,filename:"meta.json"});
      setCompleted(p=>({...p,metajson:true})); markDone("metajson");
    } catch { window.alert("Failed to generate Metajson."); setDone(p=>({...p,metajson:false})); setCompleted(p=>({...p,metajson:false})); }
    finally { setGenerating(p=>({...p,metajson:false})); }
  }

  async function handleSaveSimpleMetajson(json: Record<string, unknown>) {
    if (!brdId) return;
    try {
      await api.put(`/brd/${brdId}/sections/simpleMetajson`, { data: json });
    } catch (err) {
      console.log("[handleSaveSimpleMetajson]", err);
      window.alert("Failed to save Metajson to database.");
    }
  }

  async function runGenerateInnod() {
    setGenerating(p=>({...p,innod:true}));
    try {
      const r = await api.post<{success:boolean;metajson:Record<string,unknown>;filename?:string}>("/brd/generate/metajson",{brdId,title:resolvedTitle,format,scope:scopeData,metadata:metadataData,toc:tocData,citations:citationsData,contentProfile:contentProfileData,brdConfig:brdConfigData});
      // Load any previously saved version — saved takes priority as initial value
      let initialData = r.data.metajson;
      if (brdId) {
        try {
          const saved = await api.get<{innodMetajson: Record<string,unknown>|null}>(`/brd/${brdId}/sections/innodMetajson`);
          if (saved.data.innodMetajson) initialData = saved.data.innodMetajson;
        } catch { /* no saved version yet, use generated */ }
      }
      setInnodModal({open:true,data:initialData,filename:"innodMeta.json"});
      setCompleted(p=>({...p,innod:true})); markDone("innod");
    } catch { window.alert("Failed to generate Innod Metajson."); setDone(p=>({...p,innod:false})); setCompleted(p=>({...p,innod:false})); }
    finally { setGenerating(p=>({...p,innod:false})); }
  }

  async function handleSaveInnodMetajson(json: Record<string, unknown>) {
    if (!brdId) return;
    try {
      await api.put(`/brd/${brdId}/sections/innodMetajson`, { data: json });
    } catch (err) {
      console.log("[handleSaveInnodMetajson]", err);
      window.alert("Failed to save Innod Metajson to database.");
    }
  }

  const allDone = completed["brd"] && completed["metajson"] && completed["innod"] && completed["content"];
  const noop = () => {};

  return (
    <>
      <style>{`:root{--doc-bg:#fefefe}.dark{--doc-bg:#1a1f31}.tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,0.4) transparent}.tbl-scroll::-webkit-scrollbar{height:5px}.tbl-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(148,163,184,0.45)}.doc-page{max-width:100%;margin:0 auto}:root{--brd-title-color:#1e293b}.dark{--brd-title-color:#f1f5f9}.dark .gen-btn-card{background:#1e2235!important;border-color:#2a3147!important}.dark .gen-btn-card.gen-btn-done{background:#0d2318!important;border-color:#166534!important}.dark .gen-btn-icon-wrap{background:#252d45!important;color:#94a3b8!important}.dark .gen-btn-icon-wrap.icon-metajson{background:#1e2d4d!important;color:#60a5fa!important}.dark .gen-btn-icon-wrap.icon-innod{background:#1e1f4d!important;color:#818cf8!important}.dark .gen-btn-icon-wrap.icon-content{background:#2a1f45!important;color:#a78bfa!important}.dark .gen-btn-icon-wrap.icon-done{background:#14532d!important;color:#4ade80!important}.dark .gen-btn-title{color:#e2e8f0!important}.dark .gen-btn-title.done{color:#4ade80!important}`}</style>
      <AssistiveTouch showCitationGuide={canViewRestrictedFields} />
      <div ref={docPageRef} className="doc-page px-4 py-6 space-y-1">

        {/* Document Header */}
        <div style={{textAlign:"center",marginBottom:36,paddingBottom:28,borderBottom:"1.5px solid #ddd8d0"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap" as const,marginBottom:14}}>
            {titleEditing ? (
              <>
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleTitleSave();
                    }
                    if (e.key === "Escape") {
                      setTitleDraft(derivedTitle);
                      setTitleEditing(false);
                      setTitleError(null);
                    }
                  }}
                  autoFocus
                  style={{fontFamily:"'Georgia','Times New Roman',serif",fontSize:24,fontWeight:700,color:"var(--brd-title-color,#1e293b)",letterSpacing:"-0.02em",lineHeight:1.25,margin:0,padding:"6px 10px",border:"1px solid #cbd5e1",borderRadius:8,minWidth:280,maxWidth:"100%"}}
                />
                <button
                  onClick={() => void handleTitleSave()}
                  disabled={titleSaving}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {titleSaving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setTitleDraft(derivedTitle);
                    setTitleEditing(false);
                    setTitleError(null);
                  }}
                  disabled={titleSaving}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <h1 style={{fontFamily:"'Georgia','Times New Roman',serif",fontSize:26,fontWeight:700,color:"var(--brd-title-color,#1e293b)",letterSpacing:"-0.02em",lineHeight:1.25,margin:0}}>
                  {displayTitle}
                </h1>
                {canEdit && (
                  <button
                    onClick={() => {
                      setTitleDraft(derivedTitle);
                      setTitleEditing(true);
                      setTitleError(null);
                    }}
                    title="Edit title"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-700 transition-colors"
                  >
                    <EditIcon />
                    Edit title
                  </button>
                )}
              </>
            )}
          </div>
          {titleError && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mb-3">{titleError}</p>
          )}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap" as const}}>
            {brdId && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#64748b",background:"#f1f5f9",border:"1px solid #e2e8f0",padding:"3px 10px",borderRadius:4}}>{brdId}</span>}
            <span style={{color:"#cbd5e1",fontSize:13}}>·</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#94a3b8"}}>{`${visibleSectionCount} Sections`}</span>
          </div>
        </div>

        <div data-export-only="1" style={{ display: "none" }}>
          <ExportDocumentToc
            format={activeFormat}
            metadata={metadataData}
            tocData={tocData}
            contentProfileData={contentProfileData}
            showCitationGuide={canViewRestrictedFields}
          />
        </div>

        <DocBlock id="section-structuring-requirements">
          <DocSectionHeader idx={0} onEdit={onEdit??noop} canEdit={canEdit}/>
          <StructuringRequirementsTable
            values={metadataValues}
            metadata={metadataData}
            variant={structuringVariant}
          />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>

        <DocBlock id="section-scope">
          <DocSectionHeader idx={1} onEdit={onEdit??noop} canEdit={canEdit}/>
          <ScopeTable scopeData={scopeData} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>

        <DocBlock id="section-toc">
          <DocSectionHeader idx={2} onEdit={onEdit??noop} canEdit={canEdit}/>
          <TocTable tocData={tocData} brdId={brdId} images={images} showRestrictedFields={canViewRestrictedFields} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>

        <DocBlock id="section-citations">
          <DocSectionHeader idx={3} onEdit={onEdit??noop} canEdit={canEdit}/>
          <CitationTable citationsData={citationsData} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>

        <DocBlock id="section-metadata">
          <DocSectionHeader idx={4} onEdit={onEdit??noop} canEdit={canEdit}/>
          <MetaGrid values={metadataValues} format={activeFormat} metadata={metadataData} brdId={brdId} images={images} />
        </DocBlock>
        <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>

        {canViewRestrictedFields && (
          <>
            <DocBlock id="section-citation-guide">
              <DocSectionHeader idx={5} onEdit={onEdit??noop} canEdit={canEdit}/>
              <CitationGuideTable tocData={tocData} />
            </DocBlock>
            <div style={{height:2,background:"linear-gradient(90deg, transparent, #e2e2dc 30%, #e2e2dc 70%, transparent)",margin:"4px 0"}}/>
          </>
        )}

        <div ref={contentProfileRef}>
          <DocBlock id="section-content-profile">
            <DocSectionHeader idx={6} onEdit={onEdit??noop} canEdit={canEdit}/>
            <ContentProfile cpData={contentProfileData} />
          </DocBlock>
        </div>

        {/* Generate Outputs */}
        <div id="section-generate" className="scroll-mt-6" style={{paddingTop:28}}>
          <div style={{borderTop:"2px solid #e2e2dc",paddingTop:24}}>

            {canEdit && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div style={{width:3,height:16,borderRadius:99,background:"#64748b"}}/>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Save BRD</p>
                  <div style={{flex:1,height:1,background:"linear-gradient(90deg, #e2e8f0, transparent)"}}/>
                </div>
                {!savedToDB ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5 rounded-lg border border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#1e2235]">
                    <div className="flex-1">
                      <p className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">Save all sections to database</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Review the data above, then save before generating outputs.</p>
                      {saveError && <p className="text-[11px] text-red-500 mt-1 font-medium">{saveError}</p>}
                    </div>
                    <button onClick={handleSaveBrd} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                      {saving?(<><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>Saving…</>)
                        :(<><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>Save BRD</>)}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-500/10">
                    <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <p className="text-[12px] font-medium text-emerald-800 dark:text-emerald-400">Saved — <span className="font-bold">{brdId}</span> is now visible in the registry as <span className="font-bold">{saveStatusLabel}</span>{savedVersionLabel ? <> and snapshot <span className="font-bold">{savedVersionLabel}</span> was created</> : null}</p>
                    <button onClick={()=>{ setSavedToDB(false); setSavedVersionLabel(null); }} className="ml-auto text-[11px] text-emerald-600 dark:text-emerald-400 underline hover:no-underline">Re-save</button>
                  </div>
                )}
              </div>
            )}

            <div className={!generateUnlocked?"opacity-40 pointer-events-none select-none":""}>
              {!generateUnlocked&&<p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3 text-center italic">Save the BRD first to unlock generate options</p>}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2"><div style={{width:3,height:16,borderRadius:99,background:"#64748b"}}/><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400" style={MONO}>Generate Outputs</p></div>
                <div style={{flex:1,height:1,background:"linear-gradient(90deg, #e2e8f0, transparent)"}}/>
                <span className="text-[10px] text-slate-300 dark:text-slate-600" style={MONO}>4 outputs</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:12,alignItems:"stretch"}}>
                {(["brd","metajson","innod","content"] as const).map(key=>{
                  const locked = APPROVAL_RESTRICTED.has(key) && !isApproved;
                  return (
                    <div key={key} className={`gen-btn-card flex flex-col${done[key]?" gen-btn-done":""}${locked?" opacity-60":""}`}
                      style={{border:done[key]?"1.5px solid #bbf7d0":locked?"1.5px solid #e2e8f0":"1.5px solid #e2e8f0",borderRadius:8,background:done[key]?"#f0fdf4":locked?"#f8fafc":"#ffffff",boxShadow:"0 1px 4px rgba(0,0,0,0.05)",overflow:"hidden",transition:"border-color 0.2s, background 0.2s",position:"relative"}}>
                      {locked && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 rounded-lg" style={{background:"rgba(248,250,252,0.92)"}}>
                          <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                          <p className="text-[11px] font-semibold text-slate-500 text-center px-3">Requires <span className="text-violet-600 dark:text-violet-400">Approved</span> status</p>
                        </div>
                      )}
                      <div className="flex items-start gap-3 p-4 pb-2.5" style={{flex:1}}>
                        <div className={`gen-btn-icon-wrap icon-${key}${done[key]?" icon-done":""} flex-shrink-0 flex items-center justify-center rounded-lg`}
                          style={{width:38,height:38,background:done[key]?"#dcfce7":GEN_BTN_CONFIG[key].accentLight,color:done[key]?"#16a34a":GEN_BTN_CONFIG[key].iconColorLight,transition:"background 0.2s, color 0.2s"}}>
                          {done[key]?<svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2"><path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/></svg>:GenBtnIcons[GEN_BTN_CONFIG[key].iconKey]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`gen-btn-sublabel${done[key]?" done":""} text-[10px] font-bold uppercase tracking-[0.14em]`} style={{...MONO,color:done[key]?"#15803d":"#94a3b8"}}>{done[key]?"Done":GEN_BTN_CONFIG[key].sublabel}</span>
                            <span className={`gen-btn-badge${done[key]?" done":""} text-[9px] font-semibold px-1.5 py-0.5 rounded`} style={{...MONO,background:done[key]?"#bbf7d0":"#f1f5f9",color:done[key]?"#15803d":"#64748b"}}>{GEN_BTN_CONFIG[key].badgeLabel}</span>
                          </div>
                          <p className={`gen-btn-title${done[key]?" done":""} text-[13px] font-semibold leading-snug`} style={{color:done[key]?"#15803d":"#1e293b"}}>{GEN_BTN_CONFIG[key].label}</p>
                          <p className="gen-btn-desc text-[11px] text-slate-400 mt-0.5 leading-snug">{GEN_BTN_CONFIG[key].description}</p>
                        </div>
                      </div>
                      <div className="px-4 pb-4 pt-1">
                        <button
                          onClick={key==="brd"?runGenerateBrdDocx:key==="metajson"?runGenerateMetajson:key==="innod"?runGenerateInnod:runGenerateContentProfileExcel}
                          disabled={!!generating[key]||!!done[key]||locked}
                          className="w-full py-2 rounded-md text-[12px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{background:done[key]?"#16a34a":GEN_BTN_CONFIG[key].btnBg,transition:"background 0.15s"}}
                          onMouseEnter={e=>{if(!done[key]&&!generating[key]&&!locked)(e.currentTarget as HTMLButtonElement).style.background=GEN_BTN_CONFIG[key].btnHover;}}
                          onMouseLeave={e=>{if(!done[key]&&!generating[key]&&!locked)(e.currentTarget as HTMLButtonElement).style.background=GEN_BTN_CONFIG[key].btnBg;}}>
                          {generating[key]?(<><svg className="animate-spin w-3.5 h-3.5 text-white/80" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/></svg>Generating…</>)
                            :done[key]?(<><svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth="2.5"><path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/></svg>Generated</>)
                            :(<><svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth="2"><path d="M10 3v11M5 9l5 5 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>{GEN_BTN_CONFIG[key].sublabel} {GEN_BTN_CONFIG[key].label}</>)}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {allDone&&(
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 mt-4 rounded border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-500/10">
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <p className="text-[12.5px] font-medium text-emerald-800 dark:text-emerald-400">All outputs generated — <span className="font-bold">{brdId??"BRD"}</span> is ready</p>
                </div>
                <button onClick={onComplete} className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2 rounded text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all">
                  Back to Registry<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <SimpleMetajson open={metajsonModal.open} onClose={()=>setMetajsonModal(p=>({...p,open:false}))} metajson={metajsonModal.data} filename={metajsonModal.filename} onSave={handleSaveSimpleMetajson}/>
      <InnodMetajson open={innodModal.open} onClose={()=>setInnodModal(p=>({...p,open:false}))} metajson={innodModal.data} filename={innodModal.filename} onSave={handleSaveInnodMetajson}/>
    </>
  );
}