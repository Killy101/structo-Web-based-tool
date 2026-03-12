/**
 * Shared TypeScript types for the AutoCompare module.
 *
 * These mirror the Pydantic models and service layer in autocompare_service.py
 * so the frontend and backend stay in sync.
 */

// ── Session ──────────────────────────────────────────────────────────────────

export type SessionStatus = "idle" | "uploaded" | "processing" | "done" | "error";

export interface SessionSummary {
  total: number;
  changed: number;
  unchanged: number;
  old_pages: number;
  new_pages: number;
  source_name: string;
}

export interface SessionInfo {
  session_id: string;
  source_name: string;
  status: SessionStatus;
  progress: number;        // 0–100
  summary: SessionSummary | null;
  error: string | null;
  old_pages: number;
  new_pages: number;
  xml_size: number;
}

// ── Chunk ─────────────────────────────────────────────────────────────────────

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

/** Lightweight row in the chunk list panel */
export interface ChunkRow {
  index: number;
  label: string;
  filename: string;
  has_changes: boolean;
  change_type: ChangeType;
  similarity: number;    // 0.0 – 1.0
  xml_size: number;
  page_start: number;
  page_end: number;
}

/** A single diff line for the DiffPanel */
export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
  line: number;
}

/** Full chunk detail (returned by /compare/{chunk_id}) */
export interface ChunkDetail extends ChunkRow {
  old_text: string;
  new_text: string;
  diff_lines: DiffLine[];
  xml_content: string;         // original XML for this chunk
  xml_suggested: string;       // AI-generated suggestion
  xml_saved: string | null;    // user's saved edit (null = not yet edited)
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface UploadResponse {
  success: boolean;
  session_id: string;
  source_name: string;
  old_pages: number;
  new_pages: number;
  xml_size: number;
  status: string;
  message: string;
}

export interface ChunksResponse {
  success: boolean;
  session_id: string;
  source_name: string;
  status: string;
  progress: number;
  summary: SessionSummary | null;
  chunks: ChunkRow[];
}

export interface CompareChunkResponse {
  success: boolean;
  session_id: string;
  chunk_id: string;
  source_name: string;
  chunk: ChunkDetail;
}

export interface SaveResponse {
  success: boolean;
  session_id: string;
  chunk_id: string;
  message: string;
  valid: boolean;
  errors: string[];
}

export interface AutoGenerateResponse {
  success: boolean;
  session_id: string;
  chunk_id: string;
  suggested_xml: string;
}

export interface MergeResponse {
  success: boolean;
  session_id: string;
  source_name: string;
  merged_xml: string;
  filename: string;
}
