export type BrdStatus = "DRAFT" | "PAUSED" | "COMPLETED" | "APPROVED" | "ON_HOLD";
export type BrdFormat = "new" | "old";
export type ReuploadSectionKey = "scope" | "metadata" | "toc" | "citations" | "contentProfile";
export type SectionHealthStatus = "Extracted" | "Partially extracted" | "Needs review";

export interface BrdSectionSnapshot {
  title?: string | null;
  format?: BrdFormat;
  status?: BrdStatus;
  scope?: unknown;
  metadata?: unknown;
  toc?: unknown;
  citations?: unknown;
  contentProfile?: unknown;
}

export interface ReuploadSectionHealth {
  key: ReuploadSectionKey;
  label: string;
  status: SectionHealthStatus;
  changed: boolean;
  missingFields: string[];
  valueCount: number;
}

export interface ReuploadSummary {
  title: string;
  format: BrdFormat;
  status: BrdStatus;
  fileName: string;
  sections: ReuploadSectionHealth[];
  changedSections: string[];
  missingItems: string[];
  needsReviewCount: number;
}

const SECTION_LABELS: Record<ReuploadSectionKey, string> = {
  scope: "Scope",
  metadata: "Metadata",
  toc: "Document Structure",
  citations: "Citations",
  contentProfile: "Content Profile",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(isMeaningfulValue);
  if (isPlainObject(value)) return Object.values(value).some(isMeaningfulValue);
  return false;
}

function countMeaningfulValues(value: unknown): number {
  if (!isMeaningfulValue(value)) return 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countMeaningfulValues(item), 0);
  if (isPlainObject(value)) return Object.values(value).reduce((sum, item) => sum + countMeaningfulValues(item), 0);
  return 0;
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const next = normalized(value[key]);
        if (next !== undefined) acc[key] = next;
        return acc;
      }, {});
  }
  return value ?? null;
}

function hasAliasValue(value: unknown, aliases: string[]): boolean {
  if (!isPlainObject(value)) return false;

  const lowerAlias = aliases.map((alias) => alias.toLowerCase());

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (lowerAlias.includes(normalizedKey) && isMeaningfulValue(child)) return true;
    if (isPlainObject(child) && hasAliasValue(child, aliases)) return true;
  }

  return false;
}

function listLengthForAliases(value: unknown, aliases: string[]): number {
  if (!isPlainObject(value)) return 0;

  const lowerAlias = aliases.map((alias) => alias.toLowerCase());
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (lowerAlias.includes(normalizedKey)) {
      if (Array.isArray(child)) return child.filter(isMeaningfulValue).length;
      if (isMeaningfulValue(child)) return countMeaningfulValues(child);
    }
    if (isPlainObject(child)) {
      const nested = listLengthForAliases(child, aliases);
      if (nested > 0) return nested;
    }
  }

  return 0;
}

function compareChanged(before: unknown, after: unknown): boolean {
  return JSON.stringify(normalized(before)) !== JSON.stringify(normalized(after));
}

function evaluateSection(key: ReuploadSectionKey, before: unknown, after: unknown): ReuploadSectionHealth {
  const label = SECTION_LABELS[key];
  const valueCount = countMeaningfulValues(after);
  const missingFields: string[] = [];
  let status: SectionHealthStatus = "Needs review";

  if (key === "scope") {
    const checks = [
      ["In-scope items", ["in_scope", "inscope", "included"]],
      ["Out-of-scope items", ["out_of_scope", "outofscope", "excluded"]],
      ["Checkpoints", ["checkpoints", "milestones"]],
    ] as const;
    const present = checks.filter(([_, aliases]) => hasAliasValue(after, [...aliases])).length;
    checks.forEach(([field, aliases]) => {
      if (!hasAliasValue(after, [...aliases])) missingFields.push(field);
    });
    status = present >= 3 ? "Extracted" : present >= 1 ? "Partially extracted" : "Needs review";
  } else if (key === "metadata") {
    const checks = [
      ["Source or category", ["source_name", "sourcename", "content_category_name", "contentcategoryname"]],
      ["Jurisdiction", ["jurisdiction", "geography"]],
      ["Document title", ["document_title", "documenttitle", "title"]],
      ["Summary", ["summary", "overview"]],
      ["Content type", ["content_type", "contenttype"]],
    ] as const;
    const present = checks.filter(([_, aliases]) => hasAliasValue(after, [...aliases])).length;
    checks.forEach(([field, aliases]) => {
      if (!hasAliasValue(after, [...aliases])) missingFields.push(field);
    });
    status = present >= 4 ? "Extracted" : present >= 2 ? "Partially extracted" : "Needs review";
  } else if (key === "toc") {
    const entries = listLengthForAliases(after, ["document_structure", "sections", "table_of_contents", "toc"]);
    if (entries === 0) missingFields.push("Document structure");
    status = entries >= 3 ? "Extracted" : entries >= 1 ? "Partially extracted" : "Needs review";
  } else if (key === "citations") {
    const refs = listLengthForAliases(after, ["references", "citations", "citation_rules", "citation_levels"]);
    if (refs === 0) missingFields.push("References");
    status = refs >= 2 ? "Extracted" : refs >= 1 ? "Partially extracted" : "Needs review";
  } else if (key === "contentProfile") {
    const checks = [
      ["Content type", ["content_type", "contenttype"]],
      ["Target audience", ["target_audience", "targetaudience", "audience"]],
      ["Language", ["language", "languages"]],
      ["Region", ["region", "regions"]],
    ] as const;
    const present = checks.filter(([_, aliases]) => hasAliasValue(after, [...aliases])).length;
    checks.forEach(([field, aliases]) => {
      if (!hasAliasValue(after, [...aliases])) missingFields.push(field);
    });
    status = present >= 3 ? "Extracted" : present >= 1 ? "Partially extracted" : "Needs review";
  }

  if (valueCount === 0) status = "Needs review";

  return {
    key,
    label,
    status,
    changed: compareChanged(before, after),
    missingFields,
    valueCount,
  };
}

export function buildReuploadSummary(
  before: BrdSectionSnapshot | null | undefined,
  after: BrdSectionSnapshot | null | undefined,
  fileName: string,
): ReuploadSummary {
  const snapshot = after ?? {};
  const sections: ReuploadSectionHealth[] = (["scope", "metadata", "toc", "citations", "contentProfile"] as ReuploadSectionKey[])
    .map((key) => evaluateSection(key, before?.[key], snapshot[key]));

  return {
    title: String(snapshot.title ?? before?.title ?? "Updated BRD"),
    format: snapshot.format === "old" ? "old" : "new",
    status: (snapshot.status ?? before?.status ?? "DRAFT") as BrdStatus,
    fileName,
    sections,
    changedSections: sections.filter((section) => section.changed).map((section) => section.label),
    missingItems: sections.flatMap((section) => section.missingFields.map((field) => `${section.label}: ${field}`)),
    needsReviewCount: sections.filter((section) => section.status === "Needs review").length,
  };
}
