import { Router, Request, Response } from "express";

const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────────
interface ScopeEntry {
  document_title?: string;
  regulator_url?: string;
  content_url?: string;
  issuing_authority?: string;
  issuing_authority_code?: string;
  asrb_id?: string;
  sme_comments?: string;
  initial_evergreen?: string;
  date_of_ingestion?: string;
  strikethrough?: boolean;
}

interface TocSection {
  id?: string;
  level?: string | number;
  name?: string;
  required?: string;
  definition?: string;
  example?: string;
  note?: string;
  tocRequirements?: string;
  smeComments?: string;
}

interface LevelRow {
  levelNumber?: string | number;
  description?: string;
  redjayXmlTag?: string;
  path?: string;
}

interface MetaJsonOutput {
  name: string;
  files: Record<string, { name: string }>;
  rootPath: string;
  meta: {
    "Source Name": string;
    "Source Type": string;
    "Publication Date": string;
    "Last Updated Date": string;
    "Processing Date": string;
    "Issuing Agency": string;
    "Content URI": string;
    Geography: string;
    Language: string;
    "Payload Subtype": string;
    Status: string;
    "Delivery Type": string;
    "Unique File Id": string;
    "Tag Set": {
      requiredLevels: number[];
      allowedLevels: number[];
    };
  };
  levelRange: [number, number];
  headingRequired: number[];
  childLevelSameAsParent: boolean;
  childLevelLessThanParent: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function toIsoDate(val: string): string {
  if (!val) return new Date().toISOString().split("T")[0];
  const d = new Date(val);
  return !isNaN(d.getTime()) ? d.toISOString().split("T")[0] : val;
}
function generateUniqueFileId(sourceName: string): string {
  const slug = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 20);
  return `${slug}_${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Derives rootPath from geography + source name abbreviation.
 * e.g. "United States" + "United States Code" → "/us/usc"
 */
function deriveRootPath(
  scope: Record<string, unknown>,
  metadata: Record<string, unknown>
): string {
  const geography = asString(metadata.geography || metadata.Geography);
  const geoCode = geography.toLowerCase().includes("united states")
    ? "us"
    : geography.toLowerCase().includes("united kingdom")
    ? "uk"
    : geography.toLowerCase().slice(0, 2).replace(/[^a-z]/g, "");

  const inScope = asArray(scope.in_scope) as ScopeEntry[];
  const sourceName = asString(
    metadata.source_name || inScope[0]?.document_title || ""
  );

  // Build abbreviation: take first letter of each significant word, max 6 chars
  const abbreviation = sourceName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string) => w[0].toLowerCase())
    .join("")
    .slice(0, 6);

  return `/${geoCode || "xx"}/${abbreviation || "source"}`;
}

/**
 * Derives the versioned filename.
 * e.g. "United States Code" + "2025-06-10" → "usc11_VER20250610"
 * Pattern: <abbrev><fileIndex>_VER<YYYYMMDD>
 */
function deriveFilename(
  sourceName: string,
  publicationDate: string,
  fileIndex: number = 1
): string {
  const abbreviation = sourceName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string) => w[0].toLowerCase())
    .join("")
    .slice(0, 6);

  const dateSlug = publicationDate
    ? publicationDate.replace(/-/g, "").slice(0, 8)
    : new Date().toISOString().replace(/-/g, "").slice(0, 8);

  const indexStr = String(fileIndex).padStart(2, "0");
  return `${abbreviation || "file"}${indexStr}_VER${dateSlug}`;
}

function extractLevelNumbers(tocSections: TocSection[]): number[] {
  const nums = tocSections
    .map((s) => {
      const m = asString(s.level || s.id || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    })
    .filter((n) => !isNaN(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function extractRequiredLevels(tocSections: TocSection[]): number[] {
  return tocSections
    .filter((s) => {
      const r = asString(s.required).toLowerCase().trim();
      return r === "true" || r === "yes" || r === "y";
    })
    .map((s) => {
      const m = asString(s.level || s.id || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    })
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
}

function extractHeadingRequired(tocSections: TocSection[]): number[] {
  return tocSections
    .filter((s) => {
      const r = asString(s.required).toLowerCase().trim();
      return (r === "true" || r === "yes") && asString(s.name).trim();
    })
    .map((s) => {
      const m = asString(s.level || s.id || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    })
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
}

function buildLevelRange(
  tocSections: TocSection[],
  cpLevels: LevelRow[]
): [number, number] {
  const nums: number[] = [];
  for (const s of tocSections) {
    const m = asString(s.level || s.id || "").match(/\d+/);
    if (m) nums.push(parseInt(m[0], 10));
  }
  for (const l of cpLevels) {
    const m = asString(l.levelNumber || "").match(/\d+/);
    if (m) nums.push(parseInt(m[0], 10));
  }
  if (!nums.length) return [1, 6];
  return [Math.min(...nums), Math.max(...nums)];
}

// ── POST /generate ─────────────────────────────────────────────────────────────
router.post("/generate", async (_req: Request, res: Response) => {
  // TODO: send file to Python processor, save result to DB via Prisma
  res.json({ success: true });
});

// ── POST /generate/metajson ────────────────────────────────────────────────────
router.post("/generate/metajson", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      brdId?: string;
      scope?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      toc?: Record<string, unknown>;
      citations?: Record<string, unknown>;
      contentProfile?: Record<string, unknown>;
    };

    const scope          = asRecord(body.scope);
    const metadata       = asRecord(body.metadata);
    const toc            = asRecord(body.toc);
    const contentProfile = asRecord(body.contentProfile);

    const inScope: ScopeEntry[]     = asArray(scope.in_scope) as ScopeEntry[];
    const tocSections: TocSection[] = asArray(toc.sections) as TocSection[];
    const cpLevels: LevelRow[]      = asArray(asRecord(contentProfile).levels) as LevelRow[];

    // ── Derive core values ──────────────────────────────────────────────────
    const sourceName = asString(
      metadata.source_name ||
      metadata.issuing_agency ||
      inScope[0]?.document_title ||
      "Unknown Source"
    );
    const sourceType    = asString(metadata.source_type || metadata.version || "Free");
    const issuingAgency = asString(metadata.issuing_agency || inScope[0]?.issuing_authority || "");
    const geography     = asString(metadata.geography || "");
    const language      = asString(metadata.language || "English");
    const payloadType   = asString(metadata.payload_type || metadata.payload_subtype || "Law");
    const status        = asString(metadata.status || "Effective");
    const deliveryType  = asString(metadata.delivery_type || "{string}");
    const contentUri    = asString(
      metadata.content_uri ||
      metadata.content_url ||
      inScope[0]?.content_url ||
      "{string}"
    );

    const publicationDate = toIsoDate(asString(metadata.publication_date));
    const lastUpdatedDate = toIsoDate(asString(metadata.last_updated_date));
    const processingDate  = new Date().toISOString().split("T")[0];

    const filename = deriveFilename(sourceName, publicationDate, 1);
    const rootPath = deriveRootPath(scope, metadata);

    // ── Build the metajson ──────────────────────────────────────────────────
    const metajson: MetaJsonOutput = {
      name: sourceName,
      files: {
        file00001: { name: filename },
      },
      rootPath,
      meta: {
        "Source Name":       sourceName,
        "Source Type":       sourceType,
        "Publication Date":  publicationDate,
        "Last Updated Date": lastUpdatedDate,
        "Processing Date":   processingDate,
        "Issuing Agency":    issuingAgency,
        "Content URI":       contentUri,
        Geography:           geography,
        Language:            language,
        "Payload Subtype":   payloadType,
        Status:              status,
        "Delivery Type":     deliveryType,
        "Unique File Id":    generateUniqueFileId(sourceName),
        "Tag Set": {
          requiredLevels: extractRequiredLevels(tocSections),
          allowedLevels:  extractLevelNumbers(tocSections),
        },
      },
      levelRange:               buildLevelRange(tocSections, cpLevels),
      headingRequired:          extractHeadingRequired(tocSections),
      childLevelSameAsParent:   false,
      childLevelLessThanParent: false,
    };

    res.json({ success: true, metajson, filename: `${filename}.json` });
  } catch (err) {
    console.error("[generate/metajson] error:", err);
    res.status(500).json({ success: false, error: "Failed to generate metajson" });
  }
});

export default router;