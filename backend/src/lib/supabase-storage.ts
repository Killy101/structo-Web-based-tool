import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BRD_STORAGE_BUCKET = process.env.SUPABASE_BRD_BUCKET || "brd-assets";

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured");
  }

  cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  return cachedClient;
}

export function getBrdStorageBucket(): string {
  return BRD_STORAGE_BUCKET;
}

export function sanitizePathPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "item";
}

export async function uploadJsonObject(path: string, data: unknown): Promise<string> {
  const body = Buffer.from(JSON.stringify(data ?? null), "utf8");
  const { error } = await getClient()
    .storage
    .from(BRD_STORAGE_BUCKET)
    .upload(path, body, {
      upsert: true,
      contentType: "application/json; charset=utf-8",
      cacheControl: "3600",
    });

  if (error) {
    throw new Error(`Supabase JSON upload failed for ${path}: ${error.message}`);
  }

  return path;
}

export async function uploadBinaryObject(path: string, bytes: Buffer, mimeType: string): Promise<string> {
  const { error } = await getClient()
    .storage
    .from(BRD_STORAGE_BUCKET)
    .upload(path, bytes, {
      upsert: true,
      contentType: mimeType || "application/octet-stream",
      cacheControl: "86400",
    });

  if (error) {
    throw new Error(`Supabase binary upload failed for ${path}: ${error.message}`);
  }

  return path;
}

export async function downloadJsonObject(path: string): Promise<unknown> {
  const { data, error } = await getClient()
    .storage
    .from(BRD_STORAGE_BUCKET)
    .download(path);

  if (error) {
    const msg = error.message ?? "";
    // Treat missing files as null rather than a hard error — handles stale
    // storage pointers (e.g. old records with a typo in the path).
    if (
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("object not found") ||
      msg.toLowerCase().includes("no such")
    ) {
      console.warn(`⚠️ Missing file in storage: ${path}`);
      return null;
    }
    throw new Error(`Supabase JSON download failed for ${path}: ${msg}`);
  }

  if (!data) return null;

  const text = await data.text();
  return text ? JSON.parse(text) : null;
}

export async function downloadBinaryObject(path: string): Promise<Buffer> {
  const { data, error } = await getClient()
    .storage
    .from(BRD_STORAGE_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error(`Supabase binary download failed for ${path}: ${error?.message || "missing data"}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function removeObjects(paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  if (list.length === 0) return;

  const { error } = await getClient()
    .storage
    .from(BRD_STORAGE_BUCKET)
    .remove(list);

  if (error) {
    throw new Error(`Supabase delete failed: ${error.message}`);
  }
}

export interface StoragePointer {
  storageProvider: "supabase";
  storageBucket: string;
  storagePath: string;
}

export function makeStoragePointer(storagePath: string): StoragePointer {
  return {
    storageProvider: "supabase",
    storageBucket: BRD_STORAGE_BUCKET,
    storagePath,
  };
}

export function extractStoragePath(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const maybePath = (value as { storagePath?: unknown }).storagePath;
  return typeof maybePath === "string" && maybePath.trim() ? maybePath : null;
}
