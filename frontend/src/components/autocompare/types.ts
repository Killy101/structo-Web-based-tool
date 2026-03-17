/**
 * types.ts — AutoCompare shared TypeScript types v2.
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
 * Review status tracked locally in the browser.
 *   pending  — not yet opened
 *   reviewed — user opened the chunk
 *   saved    — user saved an XML edit
 */
export type ReviewStatus = "pending" | "reviewed" | "saved";

/** Lightweight row shown in ChunkList */
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
  /** XML structural tag, e.g. "section" | "chapter" | "article" */
  section_tag?: string;
  source_file_index?: number;
  /** Locally tracked, never sent to backend */
  reviewStatus?: ReviewStatus;
}

// ── Diff types ────────────────────────────────────────────────────────────────

/**
 * Diff category — maps to a collapsible section in DiffPanel.
 *
 *   addition     — text in NEW but not OLD                  (emerald)
 *   removal      — text in OLD but not NEW                  (red)
 *   modification — text in both, content changed            (amber)
 *   emphasis     — bold / italic formatting changed         (fuchsia)
 *   mismatch     — structural / block-count mismatch        (orange)
 */
export type DiffCategory =
  | "addition"
  | "removal"
  | "modification"
  | "emphasis"
  | "mismatch";

/**
 * Operation sub-type badge shown on each diff line.
 *
 *   edit         — short word / phrase change
 *   textual      — full sentence or paragraph replacement
 *   innodreplace — structured XML element swap (innod-specific)
 *   emphasis     — formatting tag change
 */
export type DiffSubType = "edit" | "textual" | "innodreplace" | "emphasis";

/** A single word-level span for inline highlighting. Pre-computed by backend. */
export interface InlineSpan {
  text: string;
  changed: boolean;
}

/** A single diff line — word spans pre-computed by the backend. */
export interface DiffLine {
  type: "added" | "removed" | "modified";
  category: DiffCategory;
  sub_type: DiffSubType;
  text: string;
  old_text?: string;
  new_text?: string;
  line: number;
  old_page?: number | null;
  new_page?: number | null;
  /** Pre-computed by backend — zero LCS work in the browser */
  old_spans?: InlineSpan[];
  new_spans?: InlineSpan[];
  /** Only present on emphasis lines */
  emphasis_change?: "bold_added" | "bold_removed";
}

/** A grouped section for the DiffPanel — pre-grouped by the backend. */
export interface DiffGroup {
  category: DiffCategory;
  label: string;
  lines: DiffLine[];
}

/** Full chunk detail returned by /autocompare/compare/{chunk_id} */
export interface ChunkDetail extends ChunkRow {
  old_text: string;
  new_text: string;
  diff_lines: DiffLine[];
  /** Pre-grouped by backend — use directly, no client grouping needed */
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

export interface AutoGenerateResponse {
  success: boolean;
  session_id: string;
  chunk_id: string;
  suggested_xml: string;
  generation_scope?: "chunk" | "line";
}

export type ValidateStatus =
  | "no_changes"
  | "updated"
  | "saved_unchanged"
  | "needs_review"
  | "pending";

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