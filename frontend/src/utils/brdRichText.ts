const TOKEN_PREFIX = "__BRD_RICH_TEXT_";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeCommonEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function normalizeCssColor(value: string): string {
  const color = decodeCommonEntities(value).trim().replace(/^['"]|['"]$/g, "");
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s.,%]+\)$/i.test(color)) return color;
  if (/^[a-z]+$/i.test(color)) return color.toLowerCase();
  return "";
}

function sanitizeStyleAttr(style: string): string {
  const safeRules: string[] = [];

  const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  const color = colorMatch ? normalizeCssColor(colorMatch[1]) : "";
  if (color) safeRules.push(`color:${color}`);

  const fontWeightMatch = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i);
  const fontWeight = (fontWeightMatch?.[1] || "").trim().toLowerCase();
  if (fontWeight === "bold" || /^(?:[5-9]00)$/.test(fontWeight)) {
    safeRules.push("font-weight:700");
  }

  const fontStyleMatch = style.match(/(?:^|;)\s*font-style\s*:\s*([^;]+)/i);
  const fontStyle = (fontStyleMatch?.[1] || "").trim().toLowerCase();
  if (fontStyle === "italic") {
    safeRules.push("font-style:italic");
  }

  const decorationMatch = style.match(/(?:^|;)\s*text-decoration\s*:\s*([^;]+)/i);
  const decorationLineMatch = style.match(/(?:^|;)\s*text-decoration-line\s*:\s*([^;]+)/i);
  const decoration = `${decorationMatch?.[1] || ""} ${decorationLineMatch?.[1] || ""}`.toLowerCase();
  if (decoration.includes("underline")) safeRules.push("text-decoration:underline");
  if (decoration.includes("line-through")) safeRules.push("text-decoration:line-through");

  return safeRules.join(";");
}

function sanitizeUrl(value: string): string | null {
  const trimmed = decodeCommonEntities(value).trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;

  const normalizedFileUrl = trimmed.replace(/\\/g, "/");
  if (/^file:\/\/\/[^\s"'<>]+$/i.test(normalizedFileUrl)) {
    return normalizedFileUrl;
  }

  if (/^mailto:[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  return null;
}

function buildAnchorTag(href: string, label?: string, preserveSourceColor = false): string {
  const safeHref = sanitizeUrl(href);
  const text = escapeHtml(stripTags(decodeCommonEntities(label ?? href)).trim() || href.trim());
  if (!safeHref) return text;
  const anchorStyle = preserveSourceColor ? ' style="color:inherit;text-decoration:underline"' : "";
  const anchorClass = preserveSourceColor ? ' class="break-all"' : ' class="text-blue-600 hover:underline break-all"';
  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer"${anchorStyle}${anchorClass}>${text}</a>`;
}

export function sanitizeBrdRichTextHtml(value: string): string {
  if (!value) return "";

  let text = decodeCommonEntities(value.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  text = text.replace(/__BRD_RICH_TEXT_\d+__/g, " ");
  const preserved: Array<[string, string]> = [];
  let idx = 0;

  const keep = (pattern: RegExp, html: string | ((...args: string[]) => string)) => {
    text = text.replace(pattern, (...args) => {
      const match = args[0];
      const token = `${TOKEN_PREFIX}${idx++}__`;
      preserved.push([token, typeof html === "function" ? html(...(args.slice(0, -2) as string[])) : html]);
      return token || match;
    });
  };

  keep(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, label) => buildAnchorTag(href, label, true));
  keep(/<(?:span|font)\b[^>]*style=(['"])(.*?)\1[^>]*>/gi, (_match, _quote, style) => {
    const safeStyle = sanitizeStyleAttr(style);
    return safeStyle ? `<span style="${escapeHtml(safeStyle)}">` : "<span>";
  });
  keep(/<(?:span|font)\b[^>]*color=(['"])(.*?)\1[^>]*>/gi, (_match, _quote, color) => {
    const safeColor = normalizeCssColor(color);
    return safeColor ? `<span style="color:${escapeHtml(safeColor)}">` : "<span>";
  });
  keep(/<\/(?:span|font)>/gi, "</span>");
  keep(/<(?:p|div)\b[^>]*>/gi, "");
  keep(/<\/(?:p|div)>/gi, "<br/>");
  keep(/<(?:ul|ol)\b[^>]*>/gi, "");
  keep(/<\/(?:ul|ol)>/gi, "<br/>");
  keep(/<li\b[^>]*>/gi, "• ");
  keep(/<\/li>/gi, "<br/>");
  keep(/<br\s*\/?>/gi, "<br/>");
  keep(/<(?:em|i)\b[^>]*>/gi, "<em>");
  keep(/<\/(?:em|i)>/gi, "</em>");
  keep(/<(?:strong|b)\b[^>]*>/gi, "<strong>");
  keep(/<\/(?:strong|b)>/gi, "</strong>");
  keep(/<(?:s|strike|del)\b[^>]*>/gi, "<s>");
  keep(/<\/(?:s|strike|del)>/gi, "</s>");
  keep(/<u\b[^>]*>/gi, "<u>");
  keep(/<\/u>/gi, "</u>");
  keep(/(?:https?:\/\/|file:\/\/\/)[^\s<]+/gi, (match) => buildAnchorTag(match));

  text = escapeHtml(text).replace(/\n/g, "<br/>");
  for (const [token, html] of preserved) {
    text = text.replace(token, html);
  }

  return text;
}

export function hasBrdRichTextMarkup(value: string): boolean {
  return /<[^>]+>/.test(value || "");
}

export function hasBrdRichTextColor(value: string): boolean {
  return /(?:style\s*=\s*['"][^'"]*color\s*:|<font\b[^>]*color=)/i.test(value || "");
}

export function extractBrdRichTextHref(value: string): string {
  if (!value) return "";

  const decoded = decodeCommonEntities(value);
  const anchorMatch = decoded.match(/<a\b[^>]*href=(['"])(.*?)\1/i);
  if (anchorMatch) {
    return sanitizeUrl(anchorMatch[2]) ?? anchorMatch[2].trim();
  }

  const urlMatch = decoded.match(/(?:https?:\/\/|file:\/\/\/)[^\s"'<>]+/i);
  if (urlMatch) {
    return sanitizeUrl(urlMatch[0]) ?? urlMatch[0].trim();
  }

  return "";
}

export function brdRichTextToPlain(value: string): string {
  if (!value) return "";

  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/__BRD_RICH_TEXT_\d+__/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, "$3 ($2)")
    .replace(/<(?:li)\b[^>]*>/gi, "• ")
    .replace(/<\/(?:li|p|div|tr|table|ul|ol|tbody|thead)>/gi, "\n")
    .replace(/<(?:p|div|ul|ol|table|tbody|thead|tr)\b[^>]*>/gi, "");

  return decodeCommonEntities(stripTags(normalized))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripLeadingBrdLabel(value: string, label: string): string {
  if (!value || !label.trim()) return value;

  const trimmed = value.trim();
  const normalizedLabel = label.trim().toLowerCase();

  if (normalizedLabel === "sme checkpoint") {
    return trimmed
      .replace(/^(?:\s|<[^>]+>)*(?:sme)\s*check[-\s]*point(?:\s|<[^>]+>|:|-)+/i, "")
      .trim();
  }

  const escapedLabel = label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return trimmed.replace(new RegExp(`^(?:\\s|<[^>]+>)*${escapedLabel}\\s*:?\\s*`, "i"), "").trim();
}
