const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function buildBrdImageBlobUrl(
  brdId: string | undefined,
  imageId: number | string,
  apiBase = DEFAULT_API_BASE,
): string {
  if (!brdId || imageId === null || imageId === undefined) return "";

  const base = apiBase.replace(/\/+$/, "");
  const path = `/brd/${encodeURIComponent(String(brdId))}/images/${encodeURIComponent(String(imageId))}/blob`;

  if (typeof window === "undefined") return `${base}${path}`;

  const token = localStorage.getItem("token");
  if (!token) return `${base}${path}`;

  return `${base}${path}?token=${encodeURIComponent(token)}`;
}