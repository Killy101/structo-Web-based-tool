const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function buildBrdImageBlobUrl(
  brdId: string | undefined,
  imageId: number | string,
  apiBase = DEFAULT_API_BASE,
): string {
  if (!brdId || imageId === null || imageId === undefined) return "";

  const base = apiBase.replace(/\/+$/, "");
  const path = `/brd/${encodeURIComponent(String(brdId))}/images/${encodeURIComponent(String(imageId))}/blob`;
  const baseUrl = `${base}${path}`;

  if (typeof window === "undefined") return baseUrl;

  const token = localStorage.getItem("token");
  return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
}