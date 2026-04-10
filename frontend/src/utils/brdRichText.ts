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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function sanitizeBrdRichTextHtml(value: string): string {
  if (!value) return "";

  let text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const preserved: Array<[string, string]> = [];
  let idx = 0;

  const keep = (pattern: RegExp, html: string | ((match: string) => string)) => {
    text = text.replace(pattern, (match) => {
      const token = `${TOKEN_PREFIX}${idx++}__`;
      preserved.push([token, typeof html === "function" ? html(match) : html]);
      return token;
    });
  };

  keep(/<br\s*\/?>/gi, "<br/>");
  keep(/<(?:em|i)>/gi, "<em>");
  keep(/<\/(?:em|i)>/gi, "</em>");
  keep(/<(?:strong|b)>/gi, "<strong>");
  keep(/<\/(?:strong|b)>/gi, "</strong>");
  keep(/<(?:s|strike|del)>/gi, "<s>");
  keep(/<\/(?:s|strike|del)>/gi, "</s>");
  keep(/<u>/gi, "<u>");
  keep(/<\/u>/gi, "</u>");

  text = escapeHtml(text).replace(/\n/g, "<br/>");
  for (const [token, html] of preserved) {
    text = text.replace(token, html);
  }

  return text;
}

export function brdRichTextToPlain(value: string): string {
  if (!value) return "";
  return decodeCommonEntities(
    value
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:em|i|strong|b|s|strike|del|u)>/gi, "")
  ).trim();
}
