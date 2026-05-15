export type CompareType = "wf2" | "wf3" | "direct" | "chunk" | "browse" | "edit";
export type CanonicalCompareType = "wf2" | "wf3";

export interface CompareEvent {
  type: CompareType;
  userId: string;
  timestamp: string;
}

const STORAGE_KEY = "structo_compare_analytics";

function normalizeCompareType(type: CompareType): CanonicalCompareType {
  if (type === "chunk" || type === "browse") return "wf2";
  if (type === "direct" || type === "edit")  return "wf3";
  return type as CanonicalCompareType;
}

export function trackCompareUsage(type: CompareType, userId: string): void {
  if (typeof window === "undefined") return;
  const events = getCompareEvents();
  events.push({ type, userId, timestamp: new Date().toISOString() });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // localStorage quota exceeded — skip silently
  }
}

export function getCompareEvents(): CompareEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CompareEvent[]) : [];
  } catch {
    return [];
  }
}

/** Returns counts per day for the active compare workflows. */
export function getCompareUsageByDay(days = 7): {
  dates: Date[];
  workflow1Counts: number[];
  workflow2Counts: number[];
} {
  const events = getCompareEvents();
  const now = new Date();
  const DAY = 86400000;

  const dates: Date[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (days - 1 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const workflow1Counts = Array(days).fill(0) as number[];
  const workflow2Counts = Array(days).fill(0) as number[];

  events.forEach((event) => {
    const ts = new Date(event.timestamp).getTime();
    const daysAgo = Math.floor((Date.now() - ts) / DAY);
    const idx = days - 1 - daysAgo;
    if (idx < 0 || idx >= days) return;

    const canonicalType = normalizeCompareType(event.type);
    if (canonicalType === "wf2") workflow1Counts[idx] += 1;
    if (canonicalType === "wf3") workflow2Counts[idx] += 1;
  });

  return { dates, workflow1Counts, workflow2Counts };
}

/** Total usage counts split by workflow. */
export function getCompareUsageTotals(): {
  workflow1: number;
  workflow2: number;
  total: number;
  workflow1Unique: number;
  workflow2Unique: number;
  totalUnique: number;
} {
  const events = getCompareEvents().map((event) => ({
    ...event,
    type: normalizeCompareType(event.type),
  }));
  const workflow1 = events.filter((event) => event.type === "wf2");
  const workflow2 = events.filter((event) => event.type === "wf3");
  const workflow1Unique = new Set(workflow1.map((event) => event.userId)).size;
  const workflow2Unique = new Set(workflow2.map((event) => event.userId)).size;
  const totalUnique = new Set(events.map((event) => event.userId)).size;
  return {
    workflow1: workflow1.length,
    workflow2: workflow2.length,
    total: events.length,
    workflow1Unique,
    workflow2Unique,
    totalUnique,
  };
}
