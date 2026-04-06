// ── Diff engine types ─────────────────────────────────────────────────────────

export type ChunkKind = "add" | "del" | "mod" | "emp";

export interface Chunk {
  id: number;
  kind: ChunkKind;
  block_a: number;
  block_b: number;
  text_a: string;
  text_b: string;
  confidence: number;
  reason: string;
  context_a?: string;
  context_b?: string;
  xml_context?: string;
  words_removed?: string;
  words_added?: string;
  words_before?: string;
  words_after?: string;
  section?: string;
  emp_detail?: string;
}

export interface FontCfg {
  family: string;
  size: number;
  style: string; // "" | "bold" | "italic" | "bold italic"
}

export interface TagConfig {
  background?: string;
  foreground?: string;
  font?: FontCfg;
  underline?: boolean;
  overstrike?: boolean;
}

/** Handle type for scrolling a DiffPane to a chunk */
export interface DiffPaneHandle {
  scrollToChunk: (chunkId: number, orderedIds?: number[], scrollFraction?: number) => void;
}

export interface PaneData {
  segments: [string, string][];          // [text, tagName]
  tag_cfgs: Record<string, TagConfig>;
  offsets: Record<string, number>;       // chunkId → char offset start
  offset_ends: Record<string, number>;   // chunkId → char offset end
}

export interface DiffStats {
  total: number;
  additions: number;
  deletions: number;
  modifications: number;
  emphasis: number;
}

export interface XmlSection {
  id: number;
  label: string;
  level: number;
  parent_id: number;
}

export interface DiffResult {
  success: boolean;
  chunks: Chunk[];
  pane_a: PaneData;
  pane_b: PaneData;
  stats: DiffStats;
  xml_sections?: XmlSection[];
  file_a: string;
  file_b: string;
}

export interface ApplyResult {
  success: boolean;
  changed: boolean;
  xml_text: string;
  message: string;
  span_start: number | null;
  span_end: number | null;
}

export interface LocateResult {
  success: boolean;
  span_start: number | null;
  span_end: number | null;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export interface KindMeta {
  label: string;
  pillClass: string;     // Tailwind classes for pill background
  ringClass: string;     // Tailwind border/ring for active item
  bgClass: string;       // subtle background for active item
  textClass: string;     // text colour
}

export const KIND_META: Record<ChunkKind, KindMeta> = {
  add: {
    label: "ADD",
    pillClass:  "bg-emerald-600 dark:bg-emerald-500",
    ringClass:  "border-emerald-500/40",
    bgClass:    "bg-emerald-500/8 dark:bg-emerald-500/10",
    textClass:  "text-emerald-400",
  },
  del: {
    label: "DEL",
    pillClass:  "bg-rose-600 dark:bg-rose-500",
    ringClass:  "border-rose-500/40",
    bgClass:    "bg-rose-500/8 dark:bg-rose-500/10",
    textClass:  "text-rose-400",
  },
  mod: {
    label: "MOD",
    pillClass:  "bg-amber-600 dark:bg-amber-500",
    ringClass:  "border-amber-500/40",
    bgClass:    "bg-amber-500/8 dark:bg-amber-500/10",
    textClass:  "text-amber-400",
  },
  emp: {
    label: "EMP",
    pillClass:  "bg-violet-600 dark:bg-violet-500",
    ringClass:  "border-violet-500/40",
    bgClass:    "bg-violet-500/8 dark:bg-violet-500/10",
    textClass:  "text-violet-400",
  },
};
