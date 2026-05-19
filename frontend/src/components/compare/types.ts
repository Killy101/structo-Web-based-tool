// ─────────────────────────────────────────────────────────────────────────────
// types.ts  — Shared type definitions for the Compare feature
// ─────────────────────────────────────────────────────────────────────────────

// ── Workflow mode ─────────────────────────────────────────────────────────────

/**
 * browse = Workflow 1 · Chunk & Compare  (4-panel, XML read-only, no Apply/Save)
 * edit   = Workflow 2 · Compare & Apply  (4-panel, XML editable, Apply/Save enabled)
 *
 * NOTE: internal identifiers were previously "wf2" / "wf3". They are now
 * "browse" / "edit" to match the user-facing workflow names. All sessionStorage
 * keys that used the old names are cleared on mount to avoid stale data.
 */
export type WorkflowMode = "browse" | "edit";

// ── Diff engine ───────────────────────────────────────────────────────────────

/**
 * "strike" = intentional legislative strikethrough (distinct from emphasis changes).
 * Visually rendered in DEL-pink with line-through, so users recognise it as
 * content that was deleted / struck-through in the source document.
 */
export type ChunkKind = "add" | "del" | "mod" | "emp" | "strike";

export interface SentenceAlignmentRow {
  old: string;
  new: string;
  similarity: number;
}

export interface Chunk {
  id:           number;
  kind:         ChunkKind;
  block_a:      number;
  block_b:      number;
  text_a:       string;
  text_b:       string;
  confidence:   number;
  reason:       string;
  context_a?:   string;
  context_b?:   string;
  xml_context?: string;
  words_removed?: string;
  words_added?:   string;
  words_before?:  string;
  words_after?:   string;
  section?:       string;
  emp_detail?:    string;
  sentence_alignment?: SentenceAlignmentRow[];
  page_start?: number;
  page_end?: number;
}

export interface FontCfg {
  family: string;
  size:   number;
  /** "" | "bold" | "italic" | "bold italic" */
  style:  string;
}

export interface TagConfig {
  background?: string;
  foreground?: string;
  font?:       FontCfg;
  underline?:  boolean;
  overstrike?: boolean;
}

/** Handle type for imperative DiffPane control */
export interface DiffPaneHandle {
  scrollToChunk: (chunkId: number, orderedIds?: number[], scrollFraction?: number) => void;
  /** Programmatically scroll to a proportional position (0–1) without triggering onScrollFraction */
  scrollToFraction: (fraction: number) => void;
}

export interface PaneData {
  segments:    [string, string][];        // [text, tagName]
  tag_cfgs:    Record<string, TagConfig>;
  offsets:     Record<string, number>;    // chunkId → char offset start
  offset_ends: Record<string, number>;    // chunkId → char offset end
  /** Server-emitted line numbers (precompute v2). Optional for backwards-compat. */
  line_offsets?:     Record<string, number>;   // chunkId → first line index
  line_offset_ends?: Record<string, number>;   // chunkId → last line index
}

export interface DiffStats {
  total:         number;
  additions:     number;
  deletions:     number;
  modifications: number;
  emphasis:      number;
  strike?:       number;   // intentional legislative strikethrough chunks
}

export interface XmlSection {
  id:        number;
  label:     string;
  level:     number;
  parent_id: number;
}

export interface DiffResult {
  success:       boolean;
  chunks:        Chunk[];
  pane_a:        PaneData;
  pane_b:        PaneData;
  stats:         DiffStats;
  xml_sections?: XmlSection[];
  file_a:        string;
  file_b:        string;
}

// ── XML scroll-sync abstraction ───────────────────────────────────────────────
/**
 * Common interface for the XML panel scroll target.  Implemented by:
 *   - HTMLDivElement      (WF1 read-only viewer — structurally compatible)
 *   - XmlEditorHandle     (WF2 Monaco editor — exposed via useImperativeHandle)
 */
export interface XmlScrollTarget {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  scrollTop: number;
  readonly tagName: string;
}

export interface ApplyResult {
  success:    boolean;
  changed:    boolean;
  xml_text:   string;
  message:    string;
  span_start: number | null;
  span_end:   number | null;
  session_id?: string | null;
}

export interface LocateResult {
  success:    boolean;
  span_start: number | null;
  span_end:   number | null;
}

// ── Chunk-locate result (XML → PDF navigation) ────────────────────────────────
export interface ChunkLocateResult {
  success:   boolean;
  chunk_id:  number | null;
  score:     number;
  message?:  string;
}

// ── Emphasis types ────────────────────────────────────────────────────────────

/**
 * All 6 emphasis variants detected from XML tags.
 */
export type EmphasisType =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "bold-italic"
  | "bold-underline";

export interface EmphasisSpan {
  type:  EmphasisType;
  text:  string;
  start: number;  // char offset within parent paragraph
  end:   number;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export interface KindMeta {
  label:           string;
  pillClass:       string;
  ringClass:       string;
  bgClass:         string;
  textClass:       string;
  highlightBg:     string;
  highlightBorder: string;
}

export const KIND_META: Record<ChunkKind, KindMeta> = {
  add: {
    label:           "ADD",
    pillClass:       "bg-green-700 dark:bg-green-600",
    ringClass:       "border-green-500/40",
    bgClass:         "bg-green-500/10 dark:bg-green-500/12",
    textClass:       "text-green-500",
    highlightBg:     "rgba(34,197,94,0.18)",
    highlightBorder: "rgba(34,197,94,0.70)",
  },
  del: {
    label:           "DEL",
    pillClass:       "bg-rose-600 dark:bg-rose-500",
    ringClass:       "border-rose-500/40",
    bgClass:         "bg-rose-500/10 dark:bg-rose-500/12",  
    textClass:       "text-rose-400",
    highlightBg:     "rgba(244,63,94,0.18)",
    highlightBorder: "rgba(244,63,94,0.70)",
  },
  mod: {
    label:           "MOD",
    pillClass:       "bg-orange-600 dark:bg-orange-500",
    ringClass:       "border-orange-500/40",
    bgClass:         "bg-orange-500/10 dark:bg-orange-500/12",
    textClass:       "text-orange-400",
    highlightBg:     "rgba(249,115,22,0.18)",
    highlightBorder: "rgba(249,115,22,0.70)",
  },
  emp: {
    label:           "EMP",
    pillClass:       "bg-blue-600 dark:bg-blue-500",
    ringClass:       "border-blue-500/40",
    bgClass:         "bg-blue-500/10 dark:bg-blue-500/12",
    textClass:       "text-blue-400",
    highlightBg:     "rgba(96,165,250,0.20)",
    highlightBorder: "rgba(96,165,250,0.70)",
  },
  strike: {
    label:           "STK",
    pillClass:       "bg-rose-800 dark:bg-rose-700",
    ringClass:       "border-rose-700/40",
    bgClass:         "bg-rose-700/10 dark:bg-rose-700/12",
    textClass:       "text-rose-300",
    highlightBg:     "rgba(190,24,93,0.18)",
    highlightBorder: "rgba(190,24,93,0.70)",
  },
};