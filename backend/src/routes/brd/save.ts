// routes/brd/save.ts
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

const VALID_STATUSES = ["DRAFT", "PAUSED", "COMPLETED", "APPROVED", "ON_HOLD"];
const VALID_FORMATS  = ["NEW", "OLD"];

// ── POST /brd/save ─────────────────────────────────────────────────────────
router.post("/save", async (req: Request, res: Response) => {
  try {
    const {
      brdId,
      title,
      format        = "NEW",
      status        = "DRAFT",
      scope,
      metadata,
      toc,
      citations,
      contentProfile,
      brdConfig,
    } = req.body;

    if (!brdId || !title) {
      return res.status(400).json({ error: "brdId and title are required" });
    }

    const dbFormat = String(format).toUpperCase();
    const dbStatus = String(status).toUpperCase();

    if (!VALID_FORMATS.includes(dbFormat)) {
      return res.status(400).json({ error: `Invalid format: "${format}". Must be NEW or OLD.` });
    }
    if (!VALID_STATUSES.includes(dbStatus)) {
      return res.status(400).json({
        error: `Invalid status: "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    // Resolve createdById — find first existing user
    let createdById = 1;
    try {
      const firstUser = await prisma.user.findFirst({ select: { id: true } });
      if (firstUser) createdById = firstUser.id;
    } catch { /* ignore */ }

    // Use raw SQL to bypass Prisma client enum validation entirely.
    // The DB already has the correct enum values — the client just doesn't know yet.
    // Once npx prisma generate is run, this can be replaced with prisma.brd.upsert().
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Brd" ("brdId", "title", "format", "status", "createdById", "createdAt", "updatedAt")
      VALUES ($1, $2, $3::"BrdFormat", $4::"BrdStatus", $5, NOW(), NOW())
      ON CONFLICT ("brdId") DO UPDATE SET
        "title"     = EXCLUDED."title",
        "format"    = EXCLUDED."format",
        "status"    = EXCLUDED."status",
        "updatedAt" = NOW()
    `, brdId, title, dbFormat, dbStatus, createdById);

    // Upsert sections blob (no enum fields — safe to use Prisma client)
    await prisma.brdSections.upsert({
      where:  { brdId },
      create: {
        brdId,
        scope:          scope          ?? null,
        metadata:       metadata       ?? null,
        toc:            toc            ?? null,
        citations:      citations      ?? null,
        contentProfile: contentProfile ?? null,
        brdConfig:      brdConfig      ?? null,
      },
      update: {
        ...(scope          !== undefined && { scope }),
        ...(metadata       !== undefined && { metadata }),
        ...(toc            !== undefined && { toc }),
        ...(citations      !== undefined && { citations }),
        ...(contentProfile !== undefined && { contentProfile }),
        ...(brdConfig      !== undefined && { brdConfig }),
      },
    });

    return res.json({ success: true, brdId, status: dbStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /brd/save]", message);
    return res.status(500).json({ error: message });
  }
});

export default router;