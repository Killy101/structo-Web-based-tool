// ─────────────────────────────────────────────────────────────────────────────
// types.ts  — Shared type definitions for the Compare feature
// ─────────────────────────────────────────────────────────────────────────────

// ── Workflow mode ─────────────────────────────────────────────────────────────

/**
 * wf2 = Chunk & Compare  (4-panel, XML read-only, no Apply/Save)
 * wf3 = Compare & Apply  (4-panel, XML editable, Apply/Save enabled)
 */
export type WorkflowMode = "wf2" | "wf3";

// ── Diff engine ───────────────────────────────────────────────────────────────

export type ChunkKind = "add" | "del" | "mod" | "emp";

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

export interface DiffPaneHandle {
  scrollToChunk(chunkId: number, orderedIds?: number[], scrollFraction?: number): void;
  scrollToFraction(scrollFraction: number): void;
}

export interface PaneData {
  segments:    [string, string][];        // [text, tagName]
  tag_cfgs:    Record<string, TagConfig>;
  offsets:     Record<string, number>;    // chunkId → char offset start
  offset_ends: Record<string, number>;    // chunkId → char offset end
}

export interface DiffStats {
  total:         number;
  additions:     number;
  deletions:     number;
  modifications: number;
  emphasis:      number;
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

export interface ApplyResult {
  success:    boolean;
  changed:    boolean;
  xml_text:   string;
  message:    string;
  span_start: number | null;
  span_end:   number | null;
}

export interface LocateResult {
  success:    boolean;
  span_start: number | null;
  span_end:   number | null;
}

// ── Emphasis types ────────────────────────────────────────────────────────────

/**
 * All 6 emphasis variants detected from XML tags.
 *
 *  <b>       → bold            (all 5 documents)
 *  <i>       → italic          (UK, French AMF, Colombian SFC)
 *  <u>       → underline       (UK, OSFI, Colombian SFC)
 *  <s>       → strikethrough   (future-proof; not in any current document)
 *  <b><i>    → bold-italic     (Colombian SFC: 80 cases)
 *  <b><u>    → bold-underline  (UK: 1, OSFI: 2, Colombian SFC: 40)
 *
 * Detection rules:
 *  - Walk the full child tree recursively (any nesting depth)
 *  - <u><b>  → treat as bold-underline (reverse nesting)
 *  - <b><b>  → treat as plain bold  (UK: 6 edge cases)
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
  pillClass:       string;   // Tailwind classes for the kind pill
  ringClass:       string;   // Tailwind border/ring for the active list item
  bgClass:         string;   // Subtle bg for the active list item
  textClass:       string;   // Text colour
  /** HTML explanation-file colours: greenyellow / hotpink / yellow */
  highlightBg:     string;   // CSS colour for inline text highlight
  highlightBorder: string;   // CSS colour for paragraph border/outline
}

export const KIND_META: Record<ChunkKind, KindMeta> = {
  add: {
    label:           "ADD",
    pillClass:       "bg-emerald-600 dark:bg-emerald-500",
    ringClass:       "border-emerald-500/40",
    bgClass:         "bg-emerald-500/8 dark:bg-emerald-500/10",
    textClass:       "text-emerald-400",
    highlightBg:     "rgba(173,255,47,0.18)",   // greenyellow
    highlightBorder: "rgba(173,255,47,0.70)",
  },
  del: {
    label:           "DEL",
    pillClass:       "bg-rose-600 dark:bg-rose-500",
    ringClass:       "border-rose-500/40",
    bgClass:         "bg-rose-500/8 dark:bg-rose-500/10",
    textClass:       "text-rose-400",
    highlightBg:     "rgba(255,105,180,0.18)",  // hotpink
    highlightBorder: "rgba(255,105,180,0.70)",
  },
  mod: {
    label:           "MOD",
    pillClass:       "bg-amber-600 dark:bg-amber-500",
    ringClass:       "border-amber-500/40",
    bgClass:         "bg-amber-500/8 dark:bg-amber-500/10",
    textClass:       "text-amber-400",
    highlightBg:     "rgba(255,255,0,0.18)",    // yellow
    highlightBorder: "rgba(255,255,0,0.70)",
  },
  emp: {
    label:           "EMP",
    pillClass:       "bg-violet-600 dark:bg-violet-500",
    ringClass:       "border-violet-500/40",
    bgClass:         "bg-violet-500/8 dark:bg-violet-500/10",
    textClass:       "text-violet-400",
    highlightBg:     "rgba(139,92,246,0.15)",
    highlightBorder: "rgba(139,92,246,0.60)",
  },
};