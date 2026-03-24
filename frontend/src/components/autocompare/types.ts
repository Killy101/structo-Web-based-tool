/**
 * Shared TypeScript types for the AutoCompare module.
 */

export type SessionStatus = "idle" | "uploaded" | "processing" | "done" | "error";

export interface SessionSummary {
  total: number;
  changed: number;
  unchanged: number;
  old_pages: number;
  new_pages: number;
  source_name: string;
}

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

/**
 * Review status for a chunk — tracked locally in the browser.
 *   pending   — not yet opened
 *   reviewed  — user has opened and inspected the chunk
 *   saved     — user has saved an XML edit for this chunk
 */
export type ReviewStatus = "pending" | "reviewed" | "saved";

/** Lightweight row in the chunk list panel */
export interface ChunkRow {
  index: number;
  label: string;
  filename: string;
  original_filename: string;
  has_changes: boolean;
  change_type: ChangeType;
  similarity: number;
  xml_size: number;
  page_start: number;
  page_end: number;
  reviewStatus?: ReviewStatus;
  /** True when the backend pre-flagged this chunk as not needing review (unchanged). */
  auto_reviewed?: boolean;
}

// ── Diff line typing ───────────────────────────────────────────────────────────

/**
 * The five Modify sub-sections shown in the DiffPanel.
 *
 *   addition     — text present in NEW but not OLD            (green)
 *   removal      — text present in OLD but not NEW            (red)
 *   modification — text present in both, content changed      (amber)
 *   mismatch     — structural / line-count mismatch           (orange)
 *   emphasis     — line contains emphasis/formatting XML tags  (fuchsia)
 */
export type DiffCategory = "addition" | "removal" | "modification" | "mismatch" | "emphasis";

/**
 * XML operation sub-type tag shown as a badge on every diff line.
 *
 *   edit          — short word/phrase edit
 *   textual       — full sentence or paragraph replacement
 *   innodreplace  — structured XML element swap (innod-specific)
 *   emphasis      — emphasis/formatting tag change
 */
export type DiffSubType = "edit" | "textual" | "innodreplace" | "emphasis";

/** A single diff line enriched with category and sub_type */
export interface DiffLine {
  /** Legacy field kept for backwards compat with existing DiffPanel usage */
  type: "added" | "removed" | "modified";
  /** Richer Modify-section category */
  category: DiffCategory;
  /** XML operation sub-type */
  sub_type: DiffSubType;
  text: string;
  /** For modification lines: original old-side text (before " -> ") */
  old_text?: string;
  /** For modification lines: new-side text (after " -> ") */
  new_text?: string;
  line: number;
  old_page?: number | null;
  new_page?: number | null;
}

/**
 * A grouped section inside the Modify panel.
 * One DiffGroup per DiffCategory that has at least one line.
 */
export interface DiffGroup {
  category: DiffCategory;
  label: string;        // human-readable section heading
  lines: DiffLine[];
}

/** Full chunk detail (returned by /compare/{chunk_id}) */
export interface ChunkDetail extends ChunkRow {
  old_text: string;
  new_text: string;
  diff_lines: DiffLine[];
  /** Pre-grouped view — one entry per non-empty DiffCategory */
  diff_groups: DiffGroup[];
  xml_content: string;
  xml_suggested: string;
  xml_saved: string | null;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface UploadResponse {
  success: boolean;
  session_id: string;
  source_name: string;
  old_pages: number;
  new_pages: number;
  xml_file_count: number;
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

export type ValidateStatus = "no_changes" | "updated" | "saved_unchanged" | "needs_review" | "pending";

export interface ValidateResponse {
  success: boolean;
  session_id: string;
  chunk_id: string;
  status: ValidateStatus;
  message: string;
  xml_valid: boolean;
  xml_errors: string[];
  is_updated: boolean;
  is_modified: boolean;
  has_pdf_changes: boolean;
  needs_further_changes: boolean;
  change_details: string[];
}

export interface ValidateAllChunkResult {
  chunk_id: string;
  index: number;
  label: string;
  filename: string;
  status: ValidateStatus;
  message: string;
  xml_valid: boolean;
  xml_errors: string[];
  is_updated: boolean;
  is_modified: boolean;
  has_pdf_changes: boolean;
  needs_further_changes: boolean;
  change_details: string[];
}

export interface ValidateAllResponse {
  success: boolean;
  session_id: string;
  total: number;
  needs_action_count: number;
  summary: {
    updated: number;
    no_changes: number;
    saved_unchanged: number;
    needs_review: number;
    pending: number;
    invalid_xml: number;
  };
  results: ValidateAllChunkResult[];
}

export interface ReuploadResponse {
  success: boolean;
  session_id: string;
  xml_file_count: number;
  status: string;
  message: string;
}