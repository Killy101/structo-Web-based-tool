export interface ProcessingResultLike {
  scope?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  toc?: Record<string, unknown> | null;
  citations?: Record<string, unknown> | null;
  content_profile?: Record<string, unknown> | null;
  contentProfile?: Record<string, unknown> | null;
  brd_config?: Record<string, unknown> | null;
  brdConfig?: Record<string, unknown> | null;
}

function parseStoredJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && trimmed !== "—" && trimmed !== "-" && trimmed !== "{}" && trimmed !== "[]";
  }
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasMeaningfulValue);
  return true;
}

function mergeMeaningfulSection(extracted: unknown, existing: unknown): unknown {
  const next = parseStoredJsonValue(extracted);
  const prev = parseStoredJsonValue(existing);

  if (!hasMeaningfulValue(next)) {
    return hasMeaningfulValue(prev) ? prev : null;
  }

  if (Array.isArray(next)) return next;

  if (
    next &&
    prev &&
    typeof next === "object" &&
    typeof prev === "object" &&
    !Array.isArray(next) &&
    !Array.isArray(prev)
  ) {
    const merged: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
    Object.entries(next as Record<string, unknown>).forEach(([key, value]) => {
      merged[key] = mergeMeaningfulSection(value, merged[key]);
    });
    return merged;
  }

  return next;
}

export function sanitizeStoredBrdConfig(rawBrdConfig: unknown): Record<string, unknown> | null {
  if (!rawBrdConfig || typeof rawBrdConfig !== "object" || Array.isArray(rawBrdConfig)) {
    return null;
  }

  const { pathTransform, path_transform, levelPatterns, level_patterns, ...rest } = rawBrdConfig as Record<string, unknown>;
  void pathTransform;
  void path_transform;
  void levelPatterns;
  void level_patterns;
  return rest;
}

export function serializeBrdSectionsForStorage(
  extracted: ProcessingResultLike,
  existing?: Partial<ProcessingResultLike> | null,
) {
  const extractedContentProfile = mergeMeaningfulSection(
    extracted.content_profile ?? extracted.contentProfile ?? null,
    existing?.content_profile ?? existing?.contentProfile ?? null,
  );
  const cleanBrdConfig = sanitizeStoredBrdConfig(
    mergeMeaningfulSection(extracted.brd_config || extracted.brdConfig || null, existing?.brd_config || existing?.brdConfig || null),
  );

  return {
    scope: JSON.stringify(mergeMeaningfulSection(extracted.scope ?? null, existing?.scope ?? null)),
    metadata: JSON.stringify(mergeMeaningfulSection(extracted.metadata ?? null, existing?.metadata ?? null)),
    toc: JSON.stringify(mergeMeaningfulSection(extracted.toc ?? null, existing?.toc ?? null)),
    citations: JSON.stringify(mergeMeaningfulSection(extracted.citations ?? null, existing?.citations ?? null)),
    contentProfile: JSON.stringify(extractedContentProfile),
    brdConfig: JSON.stringify(cleanBrdConfig),
    extractedContentProfile,
    cleanBrdConfig,
  };
}
