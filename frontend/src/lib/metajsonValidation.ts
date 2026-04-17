export interface MetajsonValidationResult {
  valid: boolean;
  schema: "new" | "legacy" | null;
  errors: string[];
}

interface ValidateOptions {
  requireTransforms?: boolean;
}

const PRESERVED_SIMPLE_KEYS = ["levelPatterns", "pathTransform", "custom_toc"] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNumberArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasAtLeastOneFileEntry(files: unknown): boolean {
  if (!isRecord(files)) return false;
  return Object.values(files).some((entry) => isRecord(entry) && typeof entry.name === "string");
}

function hasTagSetShape(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.requiredLevels)
    && Array.isArray(value.allowedLevels);
}

function pushMissing(errors: string[], obj: JsonRecord, fields: string[], label: string): void {
  for (const field of fields) {
    if (!(field in obj)) errors.push(`Missing ${label} field: ${field}`);
  }
}

export function validateMetajsonSchema(
  json: Record<string, unknown>,
  options: ValidateOptions = {},
): MetajsonValidationResult {
  const errors: string[] = [];
  const requireTransforms = options.requireTransforms ?? false;

  if (!isRecord(json)) {
    return { valid: false, schema: null, errors: ["Root value must be a JSON object"] };
  }

  if (typeof json.name !== "string" || !json.name.trim()) {
    errors.push("Missing or invalid top-level field: name");
  }

  if (!hasAtLeastOneFileEntry(json.files)) {
    errors.push("Missing or invalid top-level field: files");
  }

  if (typeof json.rootPath !== "string" || !json.rootPath.trim()) {
    errors.push("Missing or invalid top-level field: rootPath");
  }

  const meta = isRecord(json.meta) ? json.meta : null;
  if (!meta) {
    errors.push("Missing or invalid top-level field: meta");
  }

  if (!Array.isArray(json.levelRange) || json.levelRange.length !== 2 || !isNumberArray(json.levelRange)) {
    errors.push("Missing or invalid top-level field: levelRange");
  }

  if (!isNumberArray(json.headingRequired)) {
    errors.push("Missing or invalid top-level field: headingRequired");
  }

  if (typeof json.childLevelSameAsParent !== "boolean") {
    errors.push("Missing or invalid top-level field: childLevelSameAsParent");
  }

  if (typeof json.childLevelLessThanParent !== "boolean") {
    errors.push("Missing or invalid top-level field: childLevelLessThanParent");
  }

  if (!isRecord(json.whitespaceHandling)) {
    errors.push("Missing or invalid top-level field: whitespaceHandling");
  }

  if (!isStringArray(json.headingAnnotation)) {
    errors.push("Missing or invalid top-level field: headingAnnotation");
  }

  if (!isRecord(json.tagSet)) {
    errors.push("Missing or invalid top-level field: tagSet");
  }

  if (!Array.isArray(json.parentalGuidance) || json.parentalGuidance.length !== 2 || !isNumberArray(json.parentalGuidance)) {
    errors.push("Missing or invalid top-level field: parentalGuidance");
  }

  if (!isNumberArray(json.requiredLevels)) {
    errors.push("Missing or invalid top-level field: requiredLevels");
  }

  if (requireTransforms) {
    if (!isRecord(json.levelPatterns)) {
      errors.push("Missing or invalid top-level field: levelPatterns");
    }
    if (!isRecord(json.pathTransform)) {
      errors.push("Missing or invalid top-level field: pathTransform");
    }
  }

  let schema: "new" | "legacy" | null = null;

  if (meta) {
    const hasNewSchemaField = typeof meta["Content Category Name"] === "string";
    const hasLegacySchemaField = typeof meta["Source Name"] === "string";

    if (hasNewSchemaField) {
      schema = "new";
      pushMissing(errors, meta, [
        "Content Category Name",
        "Publication Date",
        "Last Updated Date",
        "Processing Date",
        "Issuing Agency",
        "Content URI",
        "Geography",
        "Language",
        "Delivery Type",
        "Unique File Id",
        "Tag Set",
      ], "meta");
    } else if (hasLegacySchemaField) {
      schema = "legacy";
      pushMissing(errors, meta, [
        "Source Name",
        "Source Type",
        "Publication Date",
        "Last Updated Date",
        "Processing Date",
        "Issuing Agency",
        "Content URI",
        "Geography",
        "Language",
        "Payload Subtype",
        "Status",
        "Delivery Type",
        "Unique File Id",
        "Tag Set",
      ], "meta");
    } else {
      errors.push("meta must contain either Content Category Name or Source Name");
    }

    if ("Tag Set" in meta && !hasTagSetShape(meta["Tag Set"])) {
      errors.push("meta.Tag Set must contain requiredLevels and allowedLevels arrays");
    }
  }

  return {
    valid: errors.length === 0,
    schema,
    errors,
  };
}

export function mergeWithPreservedSections(
  edited: Record<string, unknown>,
  original: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!original) return { ...edited };

  const merged: Record<string, unknown> = { ...edited };
  for (const key of PRESERVED_SIMPLE_KEYS) {
    if (!(key in merged) && key in original) {
      merged[key] = original[key];
    }
  }
  return merged;
}
