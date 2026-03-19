import prisma from "./prisma";
import {
  downloadJsonObject,
  extractStoragePath,
  makeStoragePointer,
} from "./supabase-storage";

type SectionField =
  | "scope"
  | "metadata"
  | "toc"
  | "citations"
  | "contentProfile"
  | "brdConfig"
  | "innodMetajson"
  | "simpleMetajson";

const SECTION_FIELDS: SectionField[] = [
  "scope",
  "metadata",
  "toc",
  "citations",
  "contentProfile",
  "brdConfig",
  "innodMetajson",
  "simpleMetajson",
];

export interface BrdSectionPathRepairEntry {
  brdId: string;
  field: SectionField;
  from: string;
  to: string;
}

export interface BrdSectionPathRepairSummary {
  dryRun: boolean;
  targetBrdId: string | null;
  rowsScanned: number;
  rowsUpdated: number;
  pointersScanned: number;
  pointersUpdated: number;
  pointersUnresolved: number;
  repairs: BrdSectionPathRepairEntry[];
}

export interface BrdSectionPathRepairOptions {
  dryRun?: boolean;
  brdId?: string;
  log?: (line: string) => void;
}

function canonicalPath(brdId: string, field: SectionField): string {
  return `brd/${brdId}/sections/${field}.json`;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\+/g, "/").replace(/^\/+/, "");
}

function candidatePaths(path: string, brdId: string, field: SectionField): string[] {
  const base = normalizePath(path);
  const candidates = new Set<string>();

  const add = (value: string) => {
    const normalized = normalizePath(value);
    if (normalized) candidates.add(normalized);
  };

  add(base);
  add(base.replace("/sectionns/", "/sections/"));
  add(base.replace("/sections/", "/sectionns/"));

  if (base.startsWith("sections/brd/")) {
    add(base.replace(/^sections\/brd\//, "brd/"));
  }
  if (base.startsWith("brd/") && !base.startsWith("sections/brd/")) {
    add(`sections/${base}`);
  }

  // Preferred final form for all current writes.
  add(canonicalPath(brdId, field));

  return Array.from(candidates);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const result = await downloadJsonObject(path);
    return result !== null;
  } catch {
    return false;
  }
}

export async function repairBrdSectionStoragePaths(
  options: BrdSectionPathRepairOptions = {},
): Promise<BrdSectionPathRepairSummary> {
  const dryRun = options.dryRun !== false;
  const targetBrdId = options.brdId?.trim() || null;
  const log = options.log;

  const rows = await prisma.brdSections.findMany({
    where: targetBrdId ? { brdId: targetBrdId } : undefined,
    select: {
      brdId: true,
      scope: true,
      metadata: true,
      toc: true,
      citations: true,
      contentProfile: true,
      brdConfig: true,
      innodMetajson: true,
      simpleMetajson: true,
    },
  });

  let rowsUpdated = 0;
  let pointersUpdated = 0;
  let pointersScanned = 0;
  let pointersUnresolved = 0;
  const repairs: BrdSectionPathRepairEntry[] = [];

  for (const row of rows) {
    const updateData: Record<string, unknown> = {};

    for (const field of SECTION_FIELDS) {
      const raw = row[field];
      const currentPath = extractStoragePath(raw);
      if (!currentPath) continue;

      pointersScanned += 1;

      const candidates = candidatePaths(currentPath, row.brdId, field);
      let resolvedPath: string | null = null;

      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }

      if (!resolvedPath) {
        pointersUnresolved += 1;
        continue;
      }

      const normalizedCurrent = normalizePath(currentPath);
      if (resolvedPath !== normalizedCurrent) {
        updateData[field] = makeStoragePointer(resolvedPath);
        pointersUpdated += 1;
        repairs.push({
          brdId: row.brdId,
          field,
          from: normalizedCurrent,
          to: resolvedPath,
        });
        if (log) {
          log(`Repair ${row.brdId}.${field}: ${normalizedCurrent} -> ${resolvedPath}`);
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      if (!dryRun) {
        await prisma.brdSections.update({
          where: { brdId: row.brdId },
          data: updateData,
        });
      }
      rowsUpdated += 1;
    }
  }

  return {
    dryRun,
    targetBrdId,
    rowsScanned: rows.length,
    rowsUpdated,
    pointersScanned,
    pointersUpdated,
    pointersUnresolved,
    repairs,
  };
}
