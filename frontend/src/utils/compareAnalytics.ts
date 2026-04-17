export type CompareType = "wf2" | "wf3" | "direct" | "chunk";

export interface CompareEvent {
  type: CompareType;
  userId: string;
  timestamp: string;
}

const STORAGE_KEY = "structo_compare_analytics";

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

/** Returns counts per day (last N days) for each comparison type. */
export function getCompareUsageByDay(days = 7): {
  dates: Date[];
  directCounts: number[];
  chunkCounts: number[];
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

  const directCounts = Array(days).fill(0) as number[];
  const chunkCounts = Array(days).fill(0) as number[];

  events.forEach((e) => {
    const ts = new Date(e.timestamp).getTime();
    const daysAgo = Math.floor((Date.now() - ts) / DAY);
    const idx = days - 1 - daysAgo;
    if (idx >= 0 && idx < days) {
      if (e.type === "direct") directCounts[idx]++;
      else chunkCounts[idx]++;
    }
  });

  return { dates, directCounts, chunkCounts };
}

/** Total usage counts split by type. */
export function getCompareUsageTotals(): {
  direct: number;
  chunk: number;
  total: number;
  directUnique: number;
  chunkUnique: number;
} {
  const events = getCompareEvents();
  const direct = events.filter((e) => e.type === "direct");
  const chunk = events.filter((e) => e.type === "chunk");
  const directUnique = new Set(direct.map((e) => e.userId)).size;
  const chunkUnique = new Set(chunk.map((e) => e.userId)).size;
  return {
    direct: direct.length,
    chunk: chunk.length,
    total: events.length,
    directUnique,
    chunkUnique,
  };
}
