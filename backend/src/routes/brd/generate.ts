import { Router, Request, Response } from "express";
import { processingLimiter } from "../../middleware/rateLimits";

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

type PathTransformValue = {
  patterns?: unknown;
  case?: unknown;
};

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
    .filter((n) => !isNaN(n) && n >= 2)
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

function buildScopePathTransform(inScope: ScopeEntry[]): Record<string, unknown> {
  const seen = new Set<string>();
  const patterns: [string, string, number, string][] = [];

  for (const row of inScope) {
    if (row?.strikethrough) continue;
    const title = asString(row?.document_title).trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    patterns.push([title, title, 0, ""]);
  }

  if (!patterns.length) return {};
  return {
    "2": {
      patterns,
      case: "",
    },
  };
}

function buildCitationPathTransform(citationRefs: CitationReference[]): Record<string, unknown> {
  const out: Record<string, { patterns: [string, string, number, string][]; case: string }> = {};

  const add = (level: number, find: string, replace = "") => {
    const key = String(level);
    if (!out[key]) out[key] = { patterns: [], case: "" };
    const normalizedFind = asString(find).trim();
    const normalizedReplace = asString(replace).trim();
    if (!normalizedFind) return;
    const exists = out[key].patterns.some((p) => p[0] === normalizedFind && p[1] === normalizedReplace);
    if (!exists) out[key].patterns.push([normalizedFind, normalizedReplace, 0, ""]);
  };

  for (const ref of citationRefs) {
    const level = parseLevelNumber(ref.level);
    if (level === null || level < 2) continue;
    const raw = asString(ref.citationRules).trim();
    if (!raw) continue;

    // Regex lines from citation rules become transform find-patterns.
    const regexLines = extractRegexPatternsFromCitationRule(raw);
    for (const regexLine of regexLines) add(level, regexLine, "");
  }

  const normalized: Record<string, unknown> = {};
  Object.entries(out).forEach(([k, v]) => {
    if (v.patterns.length) normalized[k] = v;
  });
  return normalized;
}

function buildPathTransformFromLevelPatterns(levelPatterns: Record<string, string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [levelKey, patterns] of Object.entries(levelPatterns)) {
    const levelNum = parseLevelNumber(levelKey);
    if (levelNum === null || levelNum < 2) continue;
    if (!Array.isArray(patterns) || patterns.length === 0) continue;

    const rows: [string, string, number, string][] = patterns
      .map((p) => asString(p).trim())
      .filter((p) => !!p)
      .map((p) => [p, "", 0, ""]);

    if (rows.length) {
      out[String(levelNum)] = {
        patterns: rows,
        case: "",
      };
    }
  }

  return out;
}

function ensureNonEmptyPathTransform(
  pathTransform: Record<string, unknown>,
  levelPatterns: Record<string, string[]>,
  levelRange: [number, number]
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...pathTransform };
  const fromPatterns = buildPathTransformFromLevelPatterns(levelPatterns);
  for (const [key, value] of Object.entries(fromPatterns)) {
    if (!merged[key]) merged[key] = value;
  }

  const fromLevelRange = buildPathTransformFromLevelRange(levelRange);
  for (const [key, value] of Object.entries(fromLevelRange)) {
    if (!merged[key]) merged[key] = value;
  }

  if (Object.keys(merged).length) return merged;

  return buildPathTransformFromLevelRange(levelRange);
}

function fillMissingLevelPatterns(
  levelPatterns: Record<string, string[]>,
  language: string,
  levelRange: [number, number]
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...levelPatterns };
  const defaults = defaultLevelPatterns(language);

  for (let level = Math.max(2, levelRange[0]); level <= Math.max(2, levelRange[1]); level++) {
    const key = String(level);
    if (!Array.isArray(out[key]) || out[key].length === 0) {
      if (Array.isArray(defaults[key]) && defaults[key].length) {
        out[key] = [...defaults[key]];
      }
    }
  }

  // Level 2 is always title-level catch-all in this flow.
  out["2"] = ["^.*$"];

  // Trim any out-of-range spillover from upstream/default inputs.
  const trimmed: Record<string, string[]> = {};
  for (const [key, patterns] of Object.entries(out)) {
    const levelNum = parseLevelNumber(key);
    if (levelNum === null) continue;
    if (levelNum < Math.max(2, levelRange[0]) || levelNum > Math.max(2, levelRange[1])) continue;
    trimmed[String(levelNum)] = patterns;
  }
  if (!trimmed["2"]) trimmed["2"] = ["^.*$"];

  return trimmed;
}

function buildPathTransformFromLevelRange(levelRange: [number, number]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let level = Math.max(2, levelRange[0]); level <= Math.max(2, levelRange[1]); level++) {
    out[String(level)] = {
      patterns: [["^.*$", "", 0, ""]],
      case: "",
    };
  }
  return out;
}

function pickBrdPathTransform(rawConfig: unknown): Record<string, unknown> {
  const cfg = asRecord(rawConfig);
  const candidate = asRecord(cfg.pathTransform || cfg.path_transform);
  const out: Record<string, unknown> = {};

  const isTemplateNoise = (text: string): boolean => {
    const normalized = asString(text).trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === "level" || normalized === "example" || normalized === "definition") return true;
    if (normalized === "note" || normalized === "notes") return true;
    if (/^level\s*\d+$/.test(normalized)) return true;
    return false;
  };

  const sanitizeRows = (rows: unknown[]): [string, string, number, string][] => {
    const clean: [string, string, number, string][] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 4) continue;
      const find = asString(row[0]).trim();
      const replace = asString(row[1]);
      const flag = Number(row[2]);
      const extra = asString(row[3]);
      if (!find || isTemplateNoise(find)) continue;
      clean.push([find, replace, Number.isFinite(flag) ? flag : 0, extra]);
    }
    return clean;
  };

  const looksRegexLike = (text: string): boolean => /[\\[\](){}^$*+?.|]/.test(text);

  for (const [key, value] of Object.entries(candidate)) {
    const normalizedKey = (asString(key).match(/\d+/)?.[0] || asString(key)).trim();
    const levelNum = parseLevelNumber(normalizedKey);
    const obj = asRecord(value as PathTransformValue);
    let patterns = Array.isArray(obj.patterns) ? sanitizeRows(obj.patterns) : [];
    if (levelNum !== null && levelNum >= 3) {
      patterns = patterns.filter(([find, replace]) => {
        const f = asString(find).trim();
        const r = asString(replace).trim();
        if (!f) return false;
        if (r === f && !looksRegexLike(f)) return false;
        return true;
      });
    }
    if (!normalizedKey || !patterns.length) continue;
    out[normalizedKey] = {
      patterns,
      case: asString(obj.case),
    };
  }

  return out;
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

// Geography tokens that are expected for each non-English language.
// If the resolved geography matches none of a language's tokens, the language
// is considered a mis-assignment and falls back to English.
const LANGUAGE_GEOGRAPHY_TOKENS: Record<string, string[]> = {
  korean:     ["korea", "kr"],
  japanese:   ["japan", "jp"],
  chinese:    ["china", "taiwan", "hong kong", "zh", "tw", "hk"],
  spanish:    ["spain", "mexico", "colombia", "argentina", "chile", "peru",
               "venezuela", "ecuador", "bolivia", "paraguay", "uruguay",
               "honduras", "guatemala", "el salvador", "nicaragua", "costa rica",
               "panama", "cuba", "dominican", "puerto rico"],
  portuguese: ["brazil", "portugal", "brasil"],
};

/**
 * Validates language against geography and returns the corrected language string.
 *
 * The two main cases this handles:
 *   1. Language is blank/missing → infer from geography (e.g. "United States" → "English").
 *   2. Language is set but contradicts geography (e.g. "Korean" + "United States") →
 *      fall back to "English" so the correct patterns are generated.
 *
 * English is never second-guessed since it is the global default and is valid
 * for any geography that is not explicitly mapped to another language.
 */
function resolveLanguage(rawLanguage: string, geography: string): string {
  const geo = geography.toLowerCase().trim();
  const normalized = normalizeLanguage(rawLanguage);

  // If no language was declared, infer from geography.
  if (!rawLanguage.trim()) {
    for (const [lang, tokens] of Object.entries(LANGUAGE_GEOGRAPHY_TOKENS)) {
      if (tokens.some((t) => geo.includes(t))) return lang;
    }
    return "English";
  }

  // English is always valid — no geography check needed.
  if (normalized === "english") return rawLanguage;

  // Non-English: verify geography is consistent.
  const expectedTokens = LANGUAGE_GEOGRAPHY_TOKENS[normalized] ?? [];
  if (expectedTokens.length > 0 && !expectedTokens.some((t) => geo.includes(t))) {
    console.warn(
      `[generate/metajson] Language "${rawLanguage}" is inconsistent with geography "${geography}". Falling back to "English".`
    );
    return "English";
  }

  return rawLanguage;
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

  const inferHeadingRegex = (raw: string): string | null => {
    const candidate = asString(raw)
      .replace(/\s+/g, " ")
      .replace(/^['"`]+|['"`]+$/g, "")
      .trim();
    if (!candidate) return null;

    const cleaned = candidate
      .replace(/^level\s*\d+\s*/i, "")
      .replace(/^[\s:-]+/, "")
      .replace(/^(example|examples|pattern|regex|rule)\s*:\s*/i, "")
      .trim();
    if (!cleaned) return null;

    const match = cleaned.match(
      /^(chapter|part|division|subdivision|section|article|rule|title|subtitle|subpart|subchapter|appendix|schedule|exhibit|attachment|form)\s+([0-9]+(?:[A-Z])?(?:[-.][0-9A-Z]+)*)$/i
    );
    if (!match) return null;

    const keyword = match[1];
    const kw = keyword.toLowerCase() === "article"
      ? "(ARTICLE|Article|Art\\.?)"
      : `(${keyword.toUpperCase()}|${keyword[0].toUpperCase()}${keyword.slice(1).toLowerCase()})`;

    return `^${kw} ?[0-9]+[A-Z]?(?:[-.][0-9A-Z]+)*$`;
  };

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

  const plainCandidates: string[] = [];

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
    .map((line) => {
      if (line) plainCandidates.push(line);
      return line;
    })
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

  for (const candidate of plainCandidates) {
    const inferred = inferHeadingRegex(candidate);
    if (inferred) extracted.push(inferred);
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
router.post("/generate/metajson", processingLimiter, async (req: Request, res: Response) => {
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
      brd_config?: Record<string, unknown>;
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
    const brdConfig      = asRecord(body.brdConfig || body.brd_config);

    const inScope: ScopeEntry[]     = asArray(scope.in_scope || scope.inScope) as ScopeEntry[];
    const tocSections: TocSection[] = asArray(toc.sections) as TocSection[];
    const citationRefs: CitationReference[] = parseCitationReferences(citations);
    const cpLevels: LevelRow[]      = asArray(asRecord(contentProfile).levels) as LevelRow[];
    const pathTransform = {
      ...buildScopePathTransform(inScope),
      ...buildCitationPathTransform(citationRefs),
      ...pickBrdPathTransform(brdConfig),
    };

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
    const language  = resolveLanguage(
      asString(metadata["Language"] || metadata.language || ""),
      geography,
    );
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

    levelPatterns = fillMissingLevelPatterns(levelPatterns, language, levelRange);
    const finalPathTransform = ensureNonEmptyPathTransform(pathTransform, levelPatterns, levelRange);

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
      pathTransform: finalPathTransform,
    };

    res.json({ success: true, metajson, filename: `${filename}.json` });
  } catch (err) {
    console.error("[generate/metajson] error:", err);
    res.status(500).json({ success: false, error: "Failed to generate metajson" });
  }
});

export default router;