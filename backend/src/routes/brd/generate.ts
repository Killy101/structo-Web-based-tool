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

interface CitationReference {
  level?: string | number;
  citationRules?: string;
}

interface MetaJsonOutput {
  name: string;
  files: Record<string, { name: string }>;
  rootPath: string;
  meta: Record<string, unknown>;
  levelRange: [number, number];
  headingRequired: number[];
  childLevelSameAsParent: boolean;
  childLevelLessThanParent: boolean;
  levelPatterns: Record<string, string[]>;
  whitespaceHandling: Record<"0" | "1" | "2", string[]>;
  headingAnnotation: string[];
  tagSet: {
    headingFromLevels: number[];
    appliedToLevels: number[];
  };
  parentalGuidance: [number, number];
  requiredLevels: number[];
  pathTransform: Record<string, unknown>;
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
function isLegacyBrd(metadata: Record<string, unknown>): boolean {
  const sourceType = asString(
    metadata.source_type || metadata.version || metadata["Source Type"]
  )
    .toLowerCase()
    .trim();

  const hasLegacyName = !!asString(metadata.source_name || metadata["Source Name"]);
  const hasNewName = !!asString(
    metadata["Content Category Name"] || metadata.content_category_name
  );

  if (sourceType.includes("legacy") || sourceType.includes("pre-2024") || sourceType.includes("free")) {
    return true;
  }

  return hasLegacyName && !hasNewName;
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
 * e.g. "United States" + "United States Code" -> "/us/usc"
 */
function deriveRootPath(
  metadata: Record<string, unknown>,
  nameSeed: string
): string {
  const geography = asString(metadata["Geography"] || metadata.geography);
  const geoCode = geography.toLowerCase().includes("united states")
    ? "us"
    : geography.toLowerCase().includes("united kingdom")
    ? "uk"
    : geography.toLowerCase().slice(0, 2).replace(/[^a-z]/g, "");

  const sourceName = asString(nameSeed);

  const abbreviation = sourceName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string) => w[0].toLowerCase())
    .join("")
    .slice(0, 6);

  return `/${geoCode || "xx"}/${abbreviation || "source"}`;
}

function resolveDocumentName(
  metadata: Record<string, unknown>,
  requestTitle?: string,
  legacy: boolean = false
): string {
  if (legacy) {
    return asString(
      metadata["Source Name"] ||
      metadata.source_name ||
      metadata.document_title ||
      requestTitle ||
      "Unknown Source"
    );
  }

  return asString(
    metadata["Content Category Name"] ||
    metadata.content_category_name ||
    metadata.document_title ||
    requestTitle ||
    "Unknown Source"
  );
}

/**
 * Derives the versioned filename.
 * e.g. "United States Code" + "2025-06-10" -> "usc01_VER06102025"
 * Pattern: <abbrev><fileIndex>_VER<MMDDYYYY>
 */
function deriveFilename(
  sourceName: string,
  publicationDate: string,
  fileIndex: number = 1,
  legacy: boolean = false
): string {
  const abbreviation = sourceName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string) => w[0].toLowerCase())
    .join("")
    .slice(0, 6);

  // Filename date format: MMDDYYYY
  const parsed = publicationDate ? new Date(publicationDate) : new Date();
  const d = !isNaN(parsed.getTime()) ? parsed : new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  const dateSlug = `${mm}${dd}${yyyy}`;

  const indexStr = String(fileIndex).padStart(2, "0");
  return `${abbreviation || "file"}${indexStr}_VER${dateSlug}`;
}

function extractExample(description: string): string {
  const match = asString(description).match(/^Example:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractDefinition(description: string): string {
  const match = asString(description).match(/^Definition:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function isPlaceholderLevelToken(value: string): boolean {
  const cleaned = asString(value)
    .trim()
    .replace(/^\/+/, "")
    .replace(/[_\-]+/g, " ")
    .toLowerCase();
  return /^level\s*\d+$/.test(cleaned);
}

function pickHardcodedToken(raw: string): string {
  const text = asString(raw).trim();
  if (!text) return "";

  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "na" || normalized === "n/a" || normalized === "none" || normalized === "null") {
    return "{string}";
  }

  const slashMatch = text.match(/\/[A-Za-z][A-Za-z0-9-]*/);
  if (slashMatch?.[0]) return slashMatch[0];

  const tokenMatch = text.match(/[A-Za-z][A-Za-z0-9-]*/);
  if (!tokenMatch?.[0]) return "";

  const token = tokenMatch[0];
  if (isPlaceholderLevelToken(token)) return "";
  return token;
}

function deriveRootPathFromContentProfile(
  cpLevels: LevelRow[]
): string {
  let level0 = "";
  let level1 = "";

  for (const row of cpLevels) {
    const level = asString(row.levelNumber).replace(/[^0-9]/g, "");
    const pathVal = asString(row.path).trim();
    const definitionVal = extractDefinition(asString(row.description)).trim();
    const exampleVal = extractExample(asString(row.description)).trim();
    const token =
      pickHardcodedToken(pathVal) ||
      pickHardcodedToken(definitionVal) ||
      pickHardcodedToken(exampleVal);
    if (!token) continue;

    if (level === "0") level0 = token;
    if (level === "1") level1 = token;
  }

  if (level0 === "{string}" || level1 === "{string}") return "{string}";

  if (level0 || level1) {
    const joined = `${level0.replace(/\/$/, "")}/${level1.replace(/^\//, "")}`.replace(/\/+?/g, "/");
    if (joined && joined !== "/") return joined.startsWith("/") ? joined : `/${joined}`;
  }

  const firstPath = cpLevels
    .map((row) => asString(row.path).trim())
    .find((pathVal) => !!pathVal);
  if (firstPath) {
    const normalizedPathToken = firstPath.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedPathToken === "na" || normalizedPathToken === "none" || normalizedPathToken === "null") {
      return "{string}";
    }

    const normalized = firstPath.replace(/\\/g, "/").replace(/\/+?/g, "/");
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  return "{string}";
}

function extractContentProfileLevelNumbers(cpLevels: LevelRow[]): number[] {
  const nums = cpLevels
    .map((l) => {
      const m = asString(l.levelNumber || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    })
    .filter((n) => !isNaN(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function getLastTocLevel(tocSections: TocSection[]): number {
  const nums = tocSections
    .map((s) => {
      const m = asString(s.level || s.id || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    })
    .filter((n) => !isNaN(n));

  return nums.length ? Math.max(...nums) : 2;
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

function buildWhitespaceHandling(levelRange: [number, number]): Record<"0" | "1" | "2", string[]> {
  const mode0: string[] = [];
  const mode1: string[] = [];

  for (let level = levelRange[0]; level <= levelRange[1]; level++) {
    if (level === 8) {
      mode1.push(String(level));
      continue;
    }
    mode0.push(String(level));
  }

  return {
    "0": mode0,
    "1": mode1,
    "2": [],
  };
}

function parseCitationReferences(citations: Record<string, unknown>): CitationReference[] {
  return asArray(citations.references)
    .filter((item) => item && typeof item === "object")
    .map((item) => item as CitationReference);
}

function parseLevelNumber(value: unknown): number | null {
  const match = asString(value).match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return Number.isNaN(num) ? null : num;
}

function normalizeLanguage(language: string): "spanish" | "portuguese" | "chinese" | "japanese" | "korean" | "english" {
  const key = asString(language).toLowerCase().trim();
  if (/(spanish|espa[nñ]ol|castellano|es\b|es-)/.test(key)) return "spanish";
  if (/(portuguese|portugu[eê]s|pt\b|pt-)/.test(key)) return "portuguese";
  if (/(chinese|mandarin|cantonese|zh\b|zh-)/.test(key)) return "chinese";
  if (/(japanese|ja\b|ja-)/.test(key)) return "japanese";
  if (/(korean|ko\b|ko-)/.test(key)) return "korean";
  return "english";
}

function defaultLevelPatterns(language: string): Record<string, string[]> {
  const generic: Record<string, string[]> = {
    "2": ["^.*$"],
    "3": ["[0-9]+$"],
    "4": ["[0-9]+$"],
    "5": ["[IVXL]+$"],
    "6": ["[IVXL]+$"],
    "7": ["^.*$"],
    "8": ["[0-9]+$"],
    "9": ["[0-9]+$", "[0-9]+[a-z]+$"],
    "10": ["[0-9]+\\.[0-9]+$"],
    "11": ["[a-z]+$", "[ivxl]+$", "[0-9]+\\.[0-9]+\\.[0-9]+$"],
    "12": ["[ivxl]+$", "[a-z]+$", "[IVXL]+$", "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$"],
    "13": ["[a-z]+$"],
    "14": ["[IVXL]+$", "[ivxl]+$", "[A-Z]+$"],
    "15": ["[a-z]+$", "[IVXL]+$"],
    "16": ["[ivxl]+$", "[0-9]+$"],
    "17": ["[ivxl]+$", "[0-9]+$"],
    "18": ["[a-z]+$"],
    "19": ["^.*$"],
    "20": ["^.*$"],
  };

  const normalized = normalizeLanguage(language);
  if (normalized === "spanish") {
    return {
      ...generic,
      "9": ["[0-9]+$", "[0-9]+[a-z]+$"],
      "10": [
        "[0-9]+\\.[0-9]+$",
        "[0-9]+\\.[0-9]+ (Bis|Ter|Quáter|Quinquies)$",
      ],
      "11": [
        "[a-z]+$",
        "[ivxl]+$",
        "[0-9]+\\.[0-9]+$",
        "[0-9]+\\.[0-9]+\\.[0-9]+$",
      ],
      "14": ["[IVXL]+$", "[ivxl]+$", "[A-Z]+$", "[IVXL]+ (Bis|Ter|Quáter|Quinquies)$"],
    };
  }

  if (normalized === "portuguese") {
    return {
      ...generic,
      "5": ["CAP[IÍ]TULO\\s+[IVXL]+$", "[IVXL]+$"],
      "9": ["Art\\.?\\s*[0-9]+$", "[0-9]+$"],
    };
  }

  if (normalized === "chinese") {
    return {
      ...generic,
      "2": ["^.*$"],
      "3": ["^第[\\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\\s　]*章$"],
      "4": ["^第[\\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\\s　]*[节節]$"],
      "5": ["^第[\\s　]*(?:[一二三四五六七八九十百千零两〇]+|[0-9]+)[\\s　]*[条條](?:之(?:[一二三四五六七八九十百千零两〇]+|[0-9]+))?$"],
      "6": ["^[（(][一二三四五六七八九十百千零两〇]+[）)]$"],
    };
  }

  if (normalized === "japanese") {
    return {
      ...generic,
      "2": ["^.*$"],
      "3": ["^第[\\s　]*(?:[一二三四五六七八九十百千〇零]+|[0-9０-９]+)[\\s　]*章$"],
      "4": ["^第[\\s　]*(?:[一二三四五六七八九十百千〇零]+|[0-9０-９]+)[\\s　]*節$"],
      "5": ["^[0-9０-９]+[\\.．]$", "^第[\\s　]*(?:[一二三四五六七八九十百千〇零]+|[0-9０-９]+)[\\s　]*条$"],
      "6": ["^[0-9０-９]+$"],
      "7": ["^[（(][0-9０-９]+[）)]$"],
      "8": ["^[イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][\\.．、]?$"],
      "9": ["^[（(][イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][）)]$"],
      "10": ["^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$"],
      "11": ["^[（(][ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻivxlcdmIVXLCDM]+[）)]$"],
      "12": ["^[イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス][\\.．、]?$"],
      "13": ["^附\\s*則(?:.*)$"],
    };
  }

  if (normalized === "korean") {
    return {
      ...generic,
      "2": ["^.*$"],
      "3": ["^제\\s*(?:[0-9]+|[0-9０-９]+|[일이삼사오육칠팔구십백천]+)(?:의[0-9０-９]+)?\\s*편(?:\\s+.*)?$"],
      "4": ["^제\\s*(?:[0-9]+|[0-9０-９]+|[일이삼사오육칠팔구십백천]+)(?:의[0-9０-９]+)?\\s*장(?:\\s+.*)?$"],
      "5": ["^제\\s*(?:[0-9]+|[0-9０-９]+|[일이삼사오육칠팔구십백천]+)(?:의[0-9０-９]+)?\\s*절(?:\\s+.*)?$"],
      "6": ["^제\\s*(?:[0-9]+|[0-9０-９]+|[일이삼사오육칠팔구십백천]+)(?:의[0-9０-９]+)?\\s*관(?:\\s+.*)?$"],
      "7": ["^제\\s*(?:[0-9]+|[0-9０-９]+|[일이삼사오육칠팔구십백천]+)(?:의[0-9０-９]+)?\\s*조(?:\\s+.*)?$"],
      "8": ["^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]$"],
      "9": ["^[0-9０-９]+(?:의[0-9０-９]+)?\\.$"],
      "10": ["^[가-힣]\\.$"],
      "11": ["^[0-9０-９]+\\)$"],
      "12": ["^[가-힣]\\)$"],
      "13": ["^\\[별표(?:\\s*[0-9０-９]+(?:의[0-9０-９]+)?)?\\]$"],
      "14": ["^부칙$"],
      "15": ["^<\\s*제[0-9０-９]{4}-[0-9０-９]+호\\s*,\\s*[0-9０-９]{4}\\.\\s*[0-9０-９]{1,2}\\.\\s*[0-9０-９]{1,2}\\s*>$"],
    };
  }

  return generic;
}

function extractRegexPatternsFromCitationRule(rule: string): string[] {
  if (!rule.trim()) return [];

  const looksRegexPattern = (text: string) => {
    const lowered = text.toLowerCase();
    if (lowered.includes("<level") || lowered.includes("example:")) return false;
    if (/\+\s*"/.test(text)) return false;

    return (
      /(\^|\$|\\[dDsSwWbBAZz]|\\\\.)/.test(text) ||
      /\[[^\]]+\](?:\{\d+(?:,\d*)?\}|[+*?])?/.test(text) ||
      /\([^)]*\|[^)]*\)/.test(text) ||
      /(?:\)|\]|\.|[A-Za-z0-9])[+*?]/.test(text)
    );
  };

  const candidates = rule
    .replace(/\r/g, "\n")
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^<\s*level\s*\d+\s*>\s*/i, "").trim())
    .map((line) => line.replace(/^level\s*\d+\s*[:\-]?\s*/i, "").trim())
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .map((line) => line.replace(/^(pattern|regex|rule|example|examples|notes?)\s*:\s*/i, "").trim())
    .map((line) => line.replace(/\bexample\s*:.*$/i, "").trim())
    .map((line) => line.replace(/\*\s*note\s*:.*$/i, "").trim())
    .map((line) => line.replace(/^['"`]+|['"`,]+$/g, "").trim())
    .filter((line) => !!line && looksRegexPattern(line));

  const extracted: string[] = [];

  for (const line of candidates) {
    const slashWrapped = line.match(/^\/(.+)\/[gimsuy]*$/);
    if (slashWrapped?.[1]) {
      extracted.push(slashWrapped[1]);
      continue;
    }

    extracted.push(line);
  }

  return [...new Set(extracted)];
}

function extractTitlesFromRedjayXmlTag(tag: string): string[] {
  const text = asString(tag).trim();
  if (!text) return [];
  if (text.toLowerCase().includes("hardcoded")) return [];

  const titles = [...text.matchAll(/<title>(.*?)<\/title>/gis)]
    .map((m) => asString(m[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return [...new Set(titles)];
}

function keywordPatternFromTitle(title: string): string[] {
  const t = asString(title).trim();
  const lower = t.toLowerCase();
  const numberTail = "[0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*";

  if (lower.includes("subdivision")) return [`^(SUBDIVISION|Subdivision) ?${numberTail}$`];
  if (lower.includes("division")) return [`^(DIVISION|Division) ?${numberTail}$`];
  if (lower.includes("chapter")) return [`^(CHAPTER|Chapter) ?${numberTail}$`];
  if (lower.includes("part")) return [`^(PART|Part) ?${numberTail}$`];
  if (lower.includes("section")) return [`^(SECTION|Section) ?${numberTail}$`, `^${numberTail}$`];
  if (lower.includes("article") || /\bart\.?\b/i.test(lower)) {
    return [`^(ARTICLE|Article|Art\\.?) ?${numberTail}$`, `^${numberTail}$`];
  }
  if (lower.includes("schedule")) return [`^(SCHEDULE|Schedule) ?${numberTail}$`];
  if (lower.includes("endnote")) return ["^(ENDNOTE|Endnote|ENDNOTES|Endnotes) ?[0-9A-Za-z]*$"];
  if (/\bs\.?\s*[0-9A-Za-z]/i.test(t)) return [`^(?:s\\.?\\s*)?${numberTail}$`];

  const token = t.match(/^([A-Za-z]+)/)?.[1];
  if (token) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [`^(${esc.toUpperCase()}|${esc[0].toUpperCase()}${esc.slice(1).toLowerCase()}) ?${numberTail}$`];
  }

  if (/^[0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*$/.test(t)) return [`^${numberTail}$`];
  return [];
}

function buildLevelPatternsFromContentProfile(cpLevels: LevelRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of cpLevels) {
    const level = parseLevelNumber(row.levelNumber);
    if (level === null) continue;

    const titles = extractTitlesFromRedjayXmlTag(asString(row.redjayXmlTag));
    if (!titles.length) continue;

    const patterns = titles.flatMap((title) => keywordPatternFromTitle(title));
    if (patterns.length) out[String(level)] = [...new Set(patterns)];
  }
  return out;
}

function buildLevelPatternsFromCitations(
  citations: CitationReference[],
  language: string,
  levelRange: [number, number],
  cpLevels: LevelRow[]
): Record<string, string[]> {
  const defaults = defaultLevelPatterns(language);
  const result: Record<string, string[]> = {};

  for (let level = levelRange[0]; level <= levelRange[1]; level++) {
    const key = String(level);
    result[key] = defaults[key] ? [...defaults[key]] : ["^.*$"];
  }

  for (const citation of citations) {
    const level = parseLevelNumber(citation.level);
    if (level === null) continue;
    const key = String(level);
    const parsed = extractRegexPatternsFromCitationRule(asString(citation.citationRules));
    if (parsed.length > 0) result[key] = parsed;
  }

  const fromContentProfile = buildLevelPatternsFromContentProfile(cpLevels);
  Object.entries(fromContentProfile).forEach(([key, vals]) => {
    if (vals.length) result[key] = vals;
  });

  return result;
}

/**
 * levelRange always starts at 2, ends at the highest level found.
 */
function buildLevelRange(
  tocSections: TocSection[],
  cpLevels: LevelRow[],
  legacy: boolean = false
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
  if (!nums.length) return [2, 6];
  const maxLevel = Math.max(...nums);
  return [2, Math.max(2, maxLevel)];
}

async function buildLevelPatternsViaPython(
  citations: CitationReference[],
  language: string,
  levelRange: [number, number],
  cpLevels: LevelRow[]
): Promise<Record<string, string[]>> {
  const serviceUrl = (process.env.PROCESSING_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

  const response = await fetch(`${serviceUrl}/patterns/level-patterns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language,
      levelRange,
      citations: citations.map((c) => ({
        level: c.level,
        citationRules: c.citationRules,
      })),
      contentProfileLevels: cpLevels.map((row) => ({
        levelNumber: row.levelNumber,
        redjayXmlTag: row.redjayXmlTag,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Processing service error: ${response.status}`);
  }

  const data = (await response.json()) as { levelPatterns?: Record<string, unknown> };
  const raw = data.levelPatterns || {};
  const parsed: Record<string, string[]> = {};

  Object.entries(raw).forEach(([key, val]) => {
    if (!Array.isArray(val)) return;
    const keyMatch = key.match(/\d+/);
    const normalizedKey = keyMatch ? keyMatch[0] : key;
    parsed[normalizedKey] = val.map((item) => asString(item)).filter((item) => item.trim().length > 0);
  });

  return parsed;
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
      title?: string;
      format?: "new" | "old" | "legacy";
      scope?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      toc?: Record<string, unknown>;
      citations?: Record<string, unknown>;
      contentProfile?: Record<string, unknown>;
      brdConfig?: Record<string, unknown>;
    };

    // Prefer Python processing output because it preserves BRD-driven fields
    // like pathTransform/custom_toc/whitespaceHandling from the uploaded BRD.
    const processingUrl = (process.env.PROCESSING_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    try {
      const upstream = await fetch(`${processingUrl}/generate/metajson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (upstream.ok) {
        const data = await upstream.json();
        return res.json(data);
      }

      const upstreamText = await upstream.text();
      console.warn("[generate/metajson] processing service returned non-200, falling back to local generator:", upstream.status, upstreamText);
    } catch (proxyErr) {
      console.warn("[generate/metajson] processing service unreachable, falling back to local generator:", proxyErr);
    }

    const scope          = asRecord(body.scope);
    const metadata       = asRecord(body.metadata);
    const toc            = asRecord(body.toc);
    const citations      = asRecord(body.citations);
    const contentProfile = asRecord(body.contentProfile);

    const inScope: ScopeEntry[]     = asArray(scope.in_scope) as ScopeEntry[];
    const tocSections: TocSection[] = asArray(toc.sections) as TocSection[];
    const citationRefs: CitationReference[] = parseCitationReferences(citations);
    const cpLevels: LevelRow[]      = asArray(asRecord(contentProfile).levels) as LevelRow[];

    const requestedFormat = asString(body.format).toLowerCase().trim();
    const legacy = requestedFormat
      ? requestedFormat === "old" || requestedFormat === "legacy"
      : isLegacyBrd(metadata);

    // ── Derive core values ──────────────────────────────────────────────────
    // Use extractor-level metadata/title for the file name; never use scope row content.
    const sourceName = resolveDocumentName(metadata, asString(body.title), legacy);
    const sourceType = asString(metadata.source_type || metadata.version || "Free");
    const issuingAgency = asString(
      metadata["Issuing Agency"]    ||
      metadata.issuing_agency       ||
      inScope[0]?.issuing_authority || ""
    );
    const relatedGovAgency = asString(
      metadata["Related Government Agency"] ||
      metadata.related_government_agency    || ""
    );
    const geography = asString(metadata["Geography"] || metadata.geography || "");
    const language  = asString(metadata["Language"]  || metadata.language  || "English");
    const payloadType  = asString(metadata.payload_type || metadata.payload_subtype || "Law");
    const status       = asString(metadata.status || "Effective");
    const deliveryType = asString(metadata.delivery_type || "{string}");
    const contentUri = "{string}";

    const publicationDate = "{iso-date}";
    const lastUpdatedDate = "{iso-date}";
    const processingDate  = legacy ? "{iso-date}" : new Date().toISOString().split("T")[0];

    const filenameDateBase = new Date().toISOString().split("T")[0];
    const filename = deriveFilename(sourceName, filenameDateBase, 1, legacy);
    const rootPath = deriveRootPathFromContentProfile(cpLevels);
    const levelRange = legacy
      ? ([2, Math.max(2, getLastTocLevel(tocSections))] as [number, number])
      : buildLevelRange(tocSections, cpLevels, legacy);

    let levelPatterns: Record<string, string[]>;
    try {
      levelPatterns = await buildLevelPatternsViaPython(citationRefs, language, levelRange, cpLevels);
    } catch (e) {
      console.warn("[generate/metajson] Python levelPatterns unavailable, using TS fallback:", e);
      levelPatterns = buildLevelPatternsFromCitations(citationRefs, language, levelRange, cpLevels);
    }

    // Level 2 in this BRD flow is the document title.
    if (levelPatterns["2"]) {
      levelPatterns["2"] = ["^.*$"];
    }

    // ── Build the metajson ──────────────────────────────────────────────────
    const metajson: MetaJsonOutput = {
      name: sourceName,
      files: {
        file00001: { name: filename },
      },
      rootPath,
      meta: legacy
        ? {
            "Source Name":       sourceName,
            "Source Type":       sourceType || "Free",
            "Publication Date":  publicationDate,
            "Last Updated Date": lastUpdatedDate,
            "Processing Date":   processingDate,
            "Issuing Agency":    issuingAgency,
            "Content URI":       contentUri,
            Geography:             geography,
            Language:              language,
            "Payload Subtype":   payloadType,
            Status:                status,
            "Delivery Type":     deliveryType,
            "Unique File Id":    generateUniqueFileId(sourceName),
            "Tag Set": {
              requiredLevels: [],
              allowedLevels:  [],
            },
          }
        : {
            "Content Category Name":   sourceName,
            "Publication Date":        publicationDate,
            "Last Updated Date":       lastUpdatedDate,
            "Processing Date":         processingDate,
            "Issuing Agency":          issuingAgency,
            "Related Government Agency": relatedGovAgency,
            "Content URI":             contentUri,
            Geography:                  geography,
            Language:                   language,
            "Tag Set": {
              requiredLevels: [],
              allowedLevels:  [],
            },
          },
      levelRange,
      headingRequired:          legacy ? [2] : extractHeadingRequired(tocSections),
      childLevelSameAsParent:   false,
      childLevelLessThanParent: false,
      levelPatterns,
      whitespaceHandling:       buildWhitespaceHandling(levelRange),
      headingAnnotation:        ["2"],
      tagSet: {
        headingFromLevels: [],
        appliedToLevels: [],
      },
      parentalGuidance: [0, 0],
      requiredLevels: extractRequiredLevels(tocSections).length
        ? extractRequiredLevels(tocSections)
        : [2],
      pathTransform: {},
    };

    res.json({ success: true, metajson, filename: `${filename}.json` });
  } catch (err) {
    console.error("[generate/metajson] error:", err);
    res.status(500).json({ success: false, error: "Failed to generate metajson" });
  }
});

export default router;