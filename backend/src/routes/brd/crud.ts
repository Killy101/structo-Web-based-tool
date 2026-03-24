// routes/brd/crud.ts
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";
import { authenticate, AuthRequest } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { notifyMany } from "../../lib/notify";
import { downloadJsonObject, extractStoragePath, removeObjects } from "../../lib/supabase-storage";
import { repairBrdSectionStoragePaths } from "../../lib/brd-storage-repair";

const router = Router();

const VALID_STATUSES = ["DRAFT", "PAUSED", "COMPLETED", "APPROVED", "ON_HOLD"];
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["DRAFT", "COMPLETED", "ON_HOLD"],
  PAUSED: ["PAUSED", "DRAFT", "COMPLETED", "ON_HOLD"],
  COMPLETED: ["COMPLETED", "APPROVED", "ON_HOLD"],
  APPROVED: ["APPROVED", "ON_HOLD"],
  ON_HOLD: ["ON_HOLD", "DRAFT", "COMPLETED", "APPROVED"],
};

function normalizeBrdStatus(status: unknown): string {
  const upper = String(status ?? "").toUpperCase();
  // Backward compatibility: ONGOING should map to the persisted DRAFT status.
  return upper === "ONGOING" ? "DRAFT" : upper;
}

async function resolveMaybeStoredJson(raw: unknown): Promise<unknown> {
  const storagePath = extractStoragePath(raw);
  if (!storagePath) return raw ?? null;

  try {
    // downloadJsonObject returns null (not throws) for missing files, so check
    // the return value rather than relying on catch to trigger the fallback.
    const primary = await downloadJsonObject(storagePath);
    if (primary !== null) return primary;

    // Fallback: try the alternate spelling of the historic sectionns/sections typo
    const alternatePath = storagePath.includes("/sectionns/")
      ? storagePath.replace("/sectionns/", "/sections/")
      : storagePath.includes("/sections/")
      ? storagePath.replace("/sections/", "/sectionns/")
      : null;

    if (alternatePath) {
      const alternate = await downloadJsonObject(alternatePath);
      if (alternate !== null) return alternate;
    }

    console.warn(`⚠️ Missing file in storage: ${storagePath}`);
    return null;
  } catch (err) {
    // Degrade gracefully — storage auth/network errors must not 500 the whole endpoint
    console.error(`⚠️ Storage download error for ${storagePath}:`, err);
    return null;
  }
}

// ── Title normalisation helper ─────────────────────────────────────────────
function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple similarity: what fraction of the shorter title's words appear in
// the longer title?  Threshold ≥ 0.80 is treated as a duplicate.
function isSimilarTitle(a: string, b: string): boolean {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  if (smaller.size === 0) return false;
  let matches = 0;
  for (const w of smaller) if (larger.has(w)) matches++;
  return matches / smaller.size >= 0.80;
}

// ── Geography resolution ───────────────────────────────────────────────────
// Returns the geography string from metadata, with two fallback layers:
//   1. Empty string → infer from issuing_agency / content_category_name for
//      well-known US federal agencies and US state administrative codes.
//   2. Still nothing → "—"
function resolveGeography(meta: Record<string, unknown> | null): string {
  if (!meta) return "—";

  const geo = ((meta.geography as string) ?? "").trim();
  if (geo) return geo;

  // Infer for US documents when geography field is absent / blank
  const agency  = ((meta.issuing_agency       as string) ?? "").toLowerCase();
  const catName = ((meta.content_category_name as string) ?? "").toLowerCase();
  const auth    = ((meta.authoritative_source  as string) ?? "").toLowerCase();
  const combined = `${agency} ${catName} ${auth}`;

  // US federal document markers
  if (/\b(code of federal regulations|federal register|cfr|epa|fda|osha|irs|sec|dot|hhs|usda|dol|dod|hud|uscis|ftc|fcc|ferc|cftc|fdic|nlrb|nlr|occ|treasury|federal aviation|federal highway)\b/.test(combined)) {
    return "United States";
  }

  // US state administrative codes (e.g. "Alabama Administrative Code")
  const STATE_RE = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i;
  const stateMatch = combined.match(STATE_RE);
  if (stateMatch) {
    const state = stateMatch[0].replace(/\b\w/g, (c) => c.toUpperCase());
    return `${state}, United States`;
  }

  return "—";
}

// ── GET /brd — list all BRDs ───────────────────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const brds = await (prisma as any).brd.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id:        true,
        brdId:     true,
        title:     true,
        format:    true,
        status:    true,
        createdAt: true,
        updatedAt: true,
        sections: {
          select: { metadata: true },
        },
        versions: {
          orderBy: { versionNum: "desc" },
          take:    1,
          select:  { versionNum: true, label: true },
        },
      },
    });

    const data = await Promise.all(brds.map(async (b: any) => {
      // Use only inline metadata for the list view — avoid downloading from
      // Supabase Storage (one request per BRD) which causes timeouts.
      const rawMeta = b.sections?.metadata ?? null;
      const meta = await resolveMaybeStoredJson(rawMeta) as Record<string, unknown> | null;

      const geography =
        (meta?.geography as string)
        || (meta?.Geography as string)
        || "—";

      const storedFormat  = (meta?._format as string) ?? "";
      const hasLegacyKeys = !!(meta?.payload_subtype || meta?.source_type || meta?.authoritative_source);
      const derivedFormat: "old" | "new" =
        storedFormat === "old" ? "old" :
        storedFormat === "new" ? "new" :
        hasLegacyKeys           ? "old" :
        b.format === "OLD"      ? "old" : "new";

      const displayName = b.title.charAt(0).toUpperCase() + b.title.slice(1);

      const latestVersionLabel = b.versions?.[0]?.label;
      const latestVersionNum = b.versions?.[0]?.versionNum;
      const latestVersion =
        (typeof latestVersionLabel === "string" && latestVersionLabel.trim())
        || (typeof latestVersionNum === "number" ? `v${latestVersionNum}.0` : "—");

      return {
        id:          b.brdId,
        title:       displayName,
        format:      derivedFormat,
        status:      b.status,
        version:     latestVersion,
        lastUpdated: b.updatedAt.toISOString().split("T")[0],
        geography,
      };
    }));

    return res.json(data);
  } catch (err) {
    console.error("[GET /brd]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/deleted — list soft-deleted BRDs ─────────────────────────────
router.get("/deleted", async (_req: Request, res: Response) => {
  try {
    const brds = await prisma.brd.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id:        true,
        brdId:     true,
        title:     true,
        format:    true,
        status:    true,
        deletedAt: true,
        sections: { select: { metadata: true } },
      },
    });

    const data = await Promise.all(brds.map(async (b) => {
      const meta = await resolveMaybeStoredJson(b.sections?.metadata ?? null) as Record<string, unknown> | null;
      const geography = (meta?.geography as string) ?? "—";
      const storedFormat = (meta?._format as string) ?? "";
      const hasLegacyKeys = !!(meta?.payload_subtype || meta?.source_type || meta?.authoritative_source);
      const derivedFormat: "old" | "new" =
        storedFormat === "old" ? "old" :
        storedFormat === "new" ? "new" :
        hasLegacyKeys           ? "old" :
        b.format === "OLD"      ? "old" : "new";

      return {
        id:        b.brdId,
        title:     b.title.charAt(0).toUpperCase() + b.title.slice(1),
        format:    derivedFormat,
        status:    b.status,
        geography,
        deletedAt: b.deletedAt!.toISOString().split("T")[0],
      };
    }));

    return res.json(data);
  } catch (err) {
    console.error("[GET /brd/deleted]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/next-id ───────────────────────────────────────────────────────
router.get("/next-id", async (_req: Request, res: Response) => {
  try {
    const allBrdIds = await prisma.brd.findMany({ where: { deletedAt: null }, select: { brdId: true } });
    const maxNum = allBrdIds.reduce((max, { brdId }) => {
      const n = parseInt(brdId.replace("BRD-", ""), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return res.json({ nextId: `BRD-${String(maxNum + 1).padStart(3, "0")}` });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/check-duplicate?filename=xxx ─────────────────────────────────
router.get("/check-duplicate", async (req: Request, res: Response) => {
  try {
    const raw      = String(req.query.filename ?? "");
    const filename = decodeURIComponent(raw.replace(/\+/g, " ")).trim();

    if (!filename) {
      return res.status(400).json({ error: "filename query param is required" });
    }

    const candidateTitle = filename
      .replace(/\.(pdf|doc|docx)$/i, "")
      .replace(/_{2,}/g, " ")
      .replace(/_/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const normalised = normalizeTitle(candidateTitle);

    const allBrds = await prisma.brd.findMany({
      where: { deletedAt: null },
      select: { brdId: true, title: true, status: true },
    });

    const exact = allBrds.find(b => normalizeTitle(b.title) === normalised);
    if (exact) {
      return res.json({
        exists:    true,
        brdId:     exact.brdId,
        title:     exact.title,
        status:    exact.status,
        matchType: "exact" as const,
      });
    }

    const fuzzy = allBrds.find(b => isSimilarTitle(b.title, candidateTitle));
    if (fuzzy) {
      return res.json({
        exists:    true,
        brdId:     fuzzy.brdId,
        title:     fuzzy.title,
        status:    fuzzy.status,
        matchType: "fuzzy" as const,
      });
    }

    return res.json({ exists: false });
  } catch (err) {
    console.error("[GET /brd/check-duplicate]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/check-duplicate-title?title=xxx ──────────────────────────────
router.get("/check-duplicate-title", async (req: Request, res: Response) => {
  try {
    const raw   = String(req.query.title ?? "").trim();
    const title = decodeURIComponent(raw.replace(/\+/g, " ")).trim();

    if (!title) {
      return res.status(400).json({ error: "title query param is required" });
    }

    const excludeId = req.query.excludeId ? String(req.query.excludeId).trim() : null;
    const normalised = normalizeTitle(title);

    const allBrds = await prisma.brd.findMany({
      where: { deletedAt: null },
      select: { brdId: true, title: true, status: true },
    });

    const candidates = excludeId ? allBrds.filter(b => b.brdId !== excludeId) : allBrds;

    const exact = candidates.find(b => normalizeTitle(b.title) === normalised);
    if (exact) {
      return res.json({
        exists:    true,
        brdId:     exact.brdId,
        title:     exact.title,
        status:    exact.status,
        matchType: "exact" as const,
      });
    }

    const fuzzy = candidates.find(b => isSimilarTitle(b.title, title));
    if (fuzzy) {
      return res.json({
        exists:    true,
        brdId:     fuzzy.brdId,
        title:     fuzzy.title,
        status:    fuzzy.status,
        matchType: "fuzzy" as const,
      });
    }

    return res.json({ exists: false });
  } catch (err) {
    console.error("[GET /brd/check-duplicate-title]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /brd/admin/repair-section-paths — repair legacy storage pointers ──
router.post(
  "/admin/repair-section-paths",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const modeRaw = String(req.body?.mode ?? req.query.mode ?? "dry-run").toLowerCase();
      const dryRun = modeRaw !== "live";
      const targetBrdIdRaw = req.body?.brdId ?? req.query.brdId;
      const targetBrdId = targetBrdIdRaw ? String(targetBrdIdRaw).trim() : undefined;

      const summary = await repairBrdSectionStoragePaths({
        dryRun,
        brdId: targetBrdId,
        log: (line) => console.log(`[POST /brd/admin/repair-section-paths] ${line}`),
      });

      const maxEntries = 250;
      const repairs = summary.repairs.slice(0, maxEntries);

      return res.json({
        success: true,
        mode: summary.dryRun ? "dry-run" : "live",
        targetBrdId: summary.targetBrdId,
        rowsScanned: summary.rowsScanned,
        rowsUpdated: summary.rowsUpdated,
        pointersScanned: summary.pointersScanned,
        pointersUpdated: summary.pointersUpdated,
        pointersUnresolved: summary.pointersUnresolved,
        repairs,
        repairsTruncated: summary.repairs.length > repairs.length,
        totalRepairs: summary.repairs.length,
      });
    } catch (err) {
      console.error("[POST /brd/admin/repair-section-paths]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /brd/:brdId — single BRD with all section blobs ───────────────────
router.get("/:brdId", async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where:   { brdId: String(req.params.brdId) },
      include: { sections: true },
    });
    if (!brd || brd.deletedAt !== null) return res.status(404).json({ error: "BRD not found" });

    const [scope, metadata, toc, citations, contentProfile, brdConfig] = await Promise.all([
      resolveMaybeStoredJson(brd.sections?.scope          ?? null),
      resolveMaybeStoredJson(brd.sections?.metadata       ?? null),
      resolveMaybeStoredJson(brd.sections?.toc            ?? null),
      resolveMaybeStoredJson(brd.sections?.citations      ?? null),
      resolveMaybeStoredJson(brd.sections?.contentProfile ?? null),
      resolveMaybeStoredJson(brd.sections?.brdConfig      ?? null),
    ]);

    const meta = metadata as Record<string, unknown> | null;

    const storedFormat2  = (meta?._format as string) ?? "";
    const hasLegacyKeys2 = !!(meta?.payload_subtype || meta?.source_type || meta?.authoritative_source);
    const derivedFormat2: "old" | "new" =
      storedFormat2 === "old" ? "old" :
      storedFormat2 === "new" ? "new" :
      hasLegacyKeys2           ? "old" :
      brd.format === "OLD"     ? "old" : "new";

    const displayName = brd.title.charAt(0).toUpperCase() + brd.title.slice(1);

    return res.json({
      id:             brd.brdId,
      title:          displayName,
      format:         derivedFormat2,
      status:         brd.status,
      lastUpdated:    brd.updatedAt.toISOString().split("T")[0],
      scope,
      metadata,
      toc,
      citations,
      contentProfile,
      brdConfig,
    });
  } catch (err) {
    console.error("[GET /brd/:brdId]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /brd/:brdId/query — send a BRD query to Pre-Production ───────────
router.post("/:brdId/query", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const brdId = String(req.params.brdId);
    const body = String(req.body?.body ?? "").trim();

    if (!body) {
      return res.status(400).json({ error: "Query body is required" });
    }

    const [brd, actor, recipients] = await Promise.all([
      prisma.brd.findUnique({
        where: { brdId },
        select: { brdId: true, title: true, status: true },
      }),
      prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, userId: true, firstName: true, lastName: true },
      }),
      prisma.user.findMany({
        where: {
          status: "ACTIVE",
          team: { slug: "pre-production" },
        },
        select: { id: true },
      }),
    ]);

    if (!brd) {
      return res.status(404).json({ error: "BRD not found" });
    }

    if (recipients.length === 0) {
      return res.status(404).json({ error: "No active pre-production users found" });
    }

    const actorName = actor
      ? [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() || actor.userId
      : "A user";

    await notifyMany(
      recipients.map((user) => user.id),
      "BRD_STATUS",
      `BRD Query: ${brd.title}`,
      `${actorName} submitted a query for ${brd.brdId}: ${body}`,
      { brdId: brd.brdId, status: brd.status, query: body, submittedBy: req.user!.userId },
    );

    await prisma.userLog.create({
      data: {
        userId: req.user!.userId,
        action: "BRD_QUERY_SUBMITTED",
        details: `Submitted query for ${brd.brdId}: ${body}`,
      },
    });

    return res.status(201).json({
      message: "Query sent to Pre-Production",
      recipients: recipients.length,
    });
  } catch (err) {
    console.error("[POST /brd/:brdId/query]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /brd/:brdId — soft delete ──────────────────────────────────────
router.delete("/:brdId", authenticate, async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where: { brdId: String(req.params.brdId) },
      select: { deletedAt: true },
    });
    if (!brd || brd.deletedAt !== null) {
      return res.status(404).json({ error: "BRD not found" });
    }
    await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data:  { deletedAt: new Date() },
    });
    return res.json({ success: true });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── POST /brd/:brdId/restore — restore a soft-deleted BRD ─────────────────
router.post("/:brdId/restore", authenticate, authorize(["SUPER_ADMIN", "ADMIN"]), async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where: { brdId: String(req.params.brdId) },
      select: { deletedAt: true },
    });
    if (!brd) return res.status(404).json({ error: "BRD not found" });
    if (brd.deletedAt === null) {
      return res.status(400).json({ error: "BRD is not deleted" });
    }
    await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data:  { deletedAt: null },
    });
    return res.json({ success: true });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── DELETE /brd/:brdId/permanent — hard delete (trash only) ───────────────
router.delete("/:brdId/permanent", authenticate, authorize(["SUPER_ADMIN", "ADMIN"]), async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);

    const brd = await prisma.brd.findUnique({
      where: { brdId },
      select: {
        deletedAt: true,
        sections: {
          select: {
            scope: true,
            metadata: true,
            toc: true,
            citations: true,
            contentProfile: true,
            brdConfig: true,
            innodMetajson: true,
            simpleMetajson: true,
            cellImages: {
              select: { blobUrl: true },
            },
          },
        },
      },
    });

    if (!brd) {
      return res.status(404).json({ error: "BRD not found" });
    }

    if (brd.deletedAt === null) {
      return res.status(400).json({ error: "BRD must be soft-deleted before permanent delete" });
    }

    const sectionPaths = [
      extractStoragePath(brd.sections?.scope),
      extractStoragePath(brd.sections?.metadata),
      extractStoragePath(brd.sections?.toc),
      extractStoragePath(brd.sections?.citations),
      extractStoragePath(brd.sections?.contentProfile),
      extractStoragePath(brd.sections?.brdConfig),
      extractStoragePath(brd.sections?.innodMetajson),
      extractStoragePath(brd.sections?.simpleMetajson),
    ].filter((path): path is string => !!path);

    const imagePaths = (brd.sections?.cellImages ?? [])
      .map((image) => image.blobUrl)
      .filter((path): path is string => !!path);

    await prisma.brd.delete({ where: { brdId } });

    try {
      await removeObjects([...sectionPaths, ...imagePaths]);
    } catch (storageErr) {
      console.warn(`[DELETE /brd/${brdId}/permanent] Storage cleanup failed:`, storageErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /brd/:brdId/permanent]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /brd/:brdId — update status, title, or format ──────────────────
router.patch("/:brdId", authenticate, async (req: Request, res: Response) => {
  try {
    const { status, title, format } = req.body;
    const normalizedStatus = status ? normalizeBrdStatus(status) : undefined;

    const existing = await prisma.brd.findUnique({
      where: { brdId: String(req.params.brdId) },
      select: { deletedAt: true, status: true },
    });
    if (!existing || existing.deletedAt !== null) {
      return res.status(404).json({ error: "BRD not found" });
    }

    if (normalizedStatus && !VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        error: `Invalid status: "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    if (normalizedStatus) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [existing.status];
      if (!allowed.includes(normalizedStatus)) {
        return res.status(400).json({
          error: `Invalid status transition: ${existing.status} -> ${normalizedStatus}. Allowed: ${allowed.join(", ")}`,
        });
      }
    }

    const dbFormat = format ? String(format).toUpperCase() : undefined;
    if (dbFormat && dbFormat !== "NEW" && dbFormat !== "OLD") {
      return res.status(400).json({ error: `Invalid format: "${format}". Must be new or old.` });
    }

    const brd = await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data: {
        ...(title     && { title }),
        ...(normalizedStatus && { status: normalizedStatus as any }),
        ...(dbFormat  && { format: dbFormat as any }),
      },
    });
    return res.json({ success: true, brdId: brd.brdId });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── POST /brd/fix-formats — backfill format for existing records ──────────
router.post("/fix-formats", authenticate, authorize(["SUPER_ADMIN", "ADMIN"]), async (_req: Request, res: Response) => {
  try {
    const brds = await prisma.brd.findMany({
      where: { deletedAt: null },
      select: { brdId: true, format: true, sections: { select: { metadata: true } } },
    });

    let fixed = 0;
    for (const b of brds) {
      const meta = await resolveMaybeStoredJson(b.sections?.metadata ?? null) as Record<string, unknown> | null;
      if (!meta) continue;

      const storedFmt   = (meta._format as string) ?? "";
      const hasLegacy   = !!(meta.payload_subtype || meta.source_type || meta.authoritative_source);
      const shouldBeOld = storedFmt === "old" || (hasLegacy && storedFmt !== "new");

      if (shouldBeOld && b.format !== "OLD") {
        await prisma.brd.update({
          where: { brdId: b.brdId },
          data:  { format: "OLD" },
        });
        fixed++;
      }
    }

    return res.json({ success: true, fixed, total: brds.length });
  } catch (err) {
    console.error("[POST /brd/fix-formats]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;