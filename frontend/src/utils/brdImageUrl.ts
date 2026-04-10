const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const TRANSPARENT_GIF_DATA_URI = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function buildBrdImageBlobUrl(
  brdId: string | undefined,
  imageId: number | string,
  apiBase = DEFAULT_API_BASE,
): string {
  if (!brdId || imageId === null || imageId === undefined) return "";

  const base = apiBase.replace(/\/+$/, "");
  const path = `/brd/${encodeURIComponent(String(brdId))}/images/${encodeURIComponent(String(imageId))}/blob`;

  if (typeof window === "undefined") return TRANSPARENT_GIF_DATA_URI;

  const token = localStorage.getItem("token");
  if (!token) return TRANSPARENT_GIF_DATA_URI;

  return `${base}${path}?token=${encodeURIComponent(token)}`;
}