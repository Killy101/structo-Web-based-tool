// routes/brd/crud.ts
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

const VALID_STATUSES = ["DRAFT", "PAUSED", "COMPLETED", "APPROVED", "ON_HOLD"];

// ── Title normalisation helper ─────────────────────────────────────────────
function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // punctuation → space
    .replace(/\s+/g, " ")          // collapse runs
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

// ── GET /brd — list all BRDs (excludes soft-deleted) ──────────────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const brds = await prisma.brd.findMany({
      where:   { deletedAt: null },
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
      },
    });

    const data = brds.map((b) => {
      const meta = b.sections?.metadata as Record<string, unknown> | null;

      const geography     = ((meta?.Geography || meta?.geography) as string) ?? "—";

      const storedFormat  = (meta?._format        as string) ?? "";
      const hasLegacyKeys = !!(meta?.payload_subtype || meta?.source_type || meta?.authoritative_source);
      const derivedFormat: "old" | "new" =
        storedFormat === "old" ? "old" :
        storedFormat === "new" ? "new" :
        hasLegacyKeys           ? "old" :
        b.format === "OLD"      ? "old" : "new";

      const displayName = b.title.charAt(0).toUpperCase() + b.title.slice(1);

      return {
        id:          b.brdId,
        title:       displayName,
        format:      derivedFormat,
        status:      b.status,
        version:     "v1.0",
        lastUpdated: b.updatedAt.toISOString().split("T")[0],
        geography,
      };
    });

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
      where:   { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id:        true,
        brdId:     true,
        title:     true,
        format:    true,
        status:    true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        sections: {
          select: { metadata: true },
        },
      },
    });

    const data = brds.map((b) => {
      const meta = b.sections?.metadata as Record<string, unknown> | null;
      const geography = ((meta?.Geography || meta?.geography) as string) ?? "—";
      const storedFormat = (meta?._format as string) ?? "";
      const hasLegacyKeys = !!(meta?.payload_subtype || meta?.source_type || meta?.authoritative_source);
      const derivedFormat: "old" | "new" =
        storedFormat === "old" ? "old" :
        storedFormat === "new" ? "new" :
        hasLegacyKeys           ? "old" :
        b.format === "OLD"      ? "old" : "new";

      return {
        id:          b.brdId,
        title:       b.title.charAt(0).toUpperCase() + b.title.slice(1),
        format:      derivedFormat,
        status:      b.status,
        version:     "v1.0",
        lastUpdated: b.updatedAt.toISOString().split("T")[0],
        deletedAt:   b.deletedAt!.toISOString().split("T")[0],
        geography,
      };
    });

    return res.json(data);
  } catch (err) {
    console.error("[GET /brd/deleted]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/next-id ───────────────────────────────────────────────────────
router.get("/next-id", async (_req: Request, res: Response) => {
  try {
    // Include soft-deleted BRDs to prevent ID reuse
    const allBrdIds = await prisma.brd.findMany({ select: { brdId: true } });
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

    // Only check non-deleted BRDs for duplicates
    const allBrds = await prisma.brd.findMany({
      where:  { deletedAt: null },
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

    // Only check non-deleted BRDs for duplicates
    const allBrds = await prisma.brd.findMany({
      where:  { deletedAt: null },
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

// ── GET /brd/:brdId — single BRD with all section blobs ───────────────────
router.get("/:brdId", async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where:   { brdId: String(req.params.brdId) },
      include: { sections: true },
    });
    if (!brd) return res.status(404).json({ error: "BRD not found" });
    if (brd.deletedAt) return res.status(410).json({ error: "BRD has been deleted" });

    const meta          = brd.sections?.metadata as Record<string, unknown> | null;

    const storedFormat2  = (meta?._format        as string) ?? "";
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
      version:        "v1.0",
      lastUpdated:    brd.updatedAt.toISOString().split("T")[0],
      scope:          brd.sections?.scope          ?? null,
      metadata:       brd.sections?.metadata       ?? null,
      toc:            brd.sections?.toc            ?? null,
      citations:      brd.sections?.citations      ?? null,
      contentProfile: brd.sections?.contentProfile ?? null,
      brdConfig:      brd.sections?.brdConfig      ?? null,
    });
  } catch (err) {
    console.error("[GET /brd/:brdId]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /brd/:brdId — soft delete ──────────────────────────────────────
router.delete("/:brdId", async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where: { brdId: String(req.params.brdId) },
    });
    if (!brd) return res.status(404).json({ error: "BRD not found" });
    if (brd.deletedAt) return res.status(410).json({ error: "BRD is already deleted" });

    await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data:  { deletedAt: new Date() },
    });
    return res.json({ success: true, softDeleted: true });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── POST /brd/:brdId/restore — restore a soft-deleted BRD ─────────────────
router.post("/:brdId/restore", async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where: { brdId: String(req.params.brdId) },
    });
    if (!brd) return res.status(404).json({ error: "BRD not found" });
    if (!brd.deletedAt) return res.status(400).json({ error: "BRD is not deleted" });

    await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data:  { deletedAt: null },
    });
    return res.json({ success: true, restored: true });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── PATCH /brd/:brdId — update status, title, or format ──────────────────
router.patch("/:brdId", async (req: Request, res: Response) => {
  try {
    const { status, title, format } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status: "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const dbFormat = format ? String(format).toUpperCase() : undefined;
    if (dbFormat && dbFormat !== "NEW" && dbFormat !== "OLD") {
      return res.status(400).json({ error: `Invalid format: "${format}". Must be new or old.` });
    }

    const brd = await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data: {
        ...(title     && { title }),
        ...(status    && { status: status as any }),
        ...(dbFormat  && { format: dbFormat as any }),
      },
    });
    return res.json({ success: true, brdId: brd.brdId });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── POST /brd/fix-formats — backfill format for existing records ──────────
router.post("/fix-formats", async (_req: Request, res: Response) => {
  try {
    const brds = await prisma.brd.findMany({
      where:  { deletedAt: null },
      select: { brdId: true, format: true, sections: { select: { metadata: true } } },
    });

    let fixed = 0;
    for (const b of brds) {
      const meta = b.sections?.metadata as Record<string, unknown> | null;
      if (!meta) continue;

      const storedFmt   = (meta._format        as string) ?? "";
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
