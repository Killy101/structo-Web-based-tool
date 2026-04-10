const COMMENT_LABEL_ALIASES: Record<string, string[]> = {
  "content url": ["content url", "content uri"],
  "content uri": ["content uri", "content url"],
  "source name": ["source name", "content category name"],
  "content category name": ["content category name", "source name"],
  "authoritative source": ["authoritative source", "issuing agency"],
  "issuing agency": ["issuing agency", "authoritative source"],
};

export function normalizeBrdMetadataCommentKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getLabelAliases(label: string): string[] {
  const normalized = normalizeBrdMetadataCommentKey(label);
  const aliases = COMMENT_LABEL_ALIASES[normalized] ?? [normalized];
  return Array.from(new Set([normalized, ...aliases].filter(Boolean)));
}

export function parseBrdMetadataComments(raw?: string, labels: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const source = (raw ?? "").replace(/\u00a0/g, " ").trim();
  if (!source) return out;

  const labelLookup = new Map<string, string>();
  labels.forEach((label) => {
    const canonical = normalizeBrdMetadataCommentKey(label);
    if (!canonical) return;
    getLabelAliases(canonical).forEach((alias) => labelLookup.set(alias, canonical));
  });

  const parseLabeledText = (text: string): boolean => {
    const labelKeys = Array.from(labelLookup.keys());
    if (labelKeys.length === 0) return false;

    const escapedLabels = [...labelKeys]
      .sort((a, b) => b.length - a.length)
      .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    const pattern = new RegExp(`(${escapedLabels.join("|")}):\\s*`, "gi");
    const matches = Array.from(text.matchAll(pattern));
    if (matches.length === 0) return false;

    matches.forEach((match, index) => {
      const matchedLabel = normalizeBrdMetadataCommentKey(match[1] ?? "");
      const key = labelLookup.get(matchedLabel) ?? matchedLabel;
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
      const comment = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (key && comment) out[key] = comment;
    });

    return Object.keys(out).length > 0;
  };

  if (!parseLabeledText(source)) {
    parseLabeledText(source.replace(/\r?\n+/g, " "));
  }

  if (Object.keys(out).length > 0) return out;

  for (const line of source.split(/\r?\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;

    const rawLabel = normalizeBrdMetadataCommentKey(trimmed.slice(0, idx));
    const key = labelLookup.get(rawLabel) ?? rawLabel;
    const comment = trimmed.slice(idx + 1).trim();
    if (key && comment) out[key] = comment;
  }

  return out;
}
