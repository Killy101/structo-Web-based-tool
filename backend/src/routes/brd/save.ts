// routes/brd/save.ts
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";
import { BrdFormat, BrdStatus, Prisma } from "@prisma/client";

const router = Router();

const VALID_STATUSES = ["DRAFT", "PAUSED", "COMPLETED", "APPROVED", "ON_HOLD"];
const VALID_FORMATS  = ["NEW", "OLD"];

/**
 * Sanitize brdConfig before storing it.
 *
 * Problem: pathTransform.patterns arrays can contain thousands of entries
 * generated from scope documents — easily pushing the JSON body past 100 KB
 * and triggering a 413 "Request Entity Too Large" from Express's body-parser.
 *
 * Fix: cap each level's patterns array to MAX_PATTERNS_PER_LEVEL entries.
 * The full patterns are re-derived at generate time anyway, so storing a
 * truncated copy is fine for the registry / re-open flow.
 */
const MAX_PATTERNS_PER_LEVEL = 100;

function sanitizeBrdConfig(config: unknown): unknown {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;

  const c = config as Record<string, unknown>;

  if (!c.pathTransform || typeof c.pathTransform !== "object") return c;

  const pt = c.pathTransform as Record<string, unknown>;
  const capped: Record<string, unknown> = {};

  for (const [levelKey, levelVal] of Object.entries(pt)) {
    if (
      levelVal &&
      typeof levelVal === "object" &&
      !Array.isArray(levelVal) &&
      Array.isArray((levelVal as Record<string, unknown>).patterns)
    ) {
      const lv = levelVal as Record<string, unknown>;
      capped[levelKey] = {
        ...lv,
        patterns: (lv.patterns as unknown[]).slice(0, MAX_PATTERNS_PER_LEVEL),
      };
    } else {
      capped[levelKey] = levelVal;
    }
  }

  return { ...c, pathTransform: capped };
}

/**
 * Convert a JSON section value to the correct Prisma InputJsonValue.
 *
 * Prisma's Json? fields do NOT accept plain JS `null` — you must pass
 * `Prisma.JsonNull` to explicitly store a SQL NULL in a nullable Json column.
 * This helper centralises that conversion so every field is handled the same way.
 */
function toJsonValue(val: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (val === null || val === undefined) return Prisma.JsonNull;
  return val as Prisma.InputJsonValue;
}

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

    // Upsert the BRD record
    await prisma.brd.upsert({
      where: { brdId },
      create: {
        brdId,
        title,
        format:      dbFormat as BrdFormat,
        status:      dbStatus as BrdStatus,
        createdById,
      },
      update: {
        title,
        format: dbFormat as BrdFormat,
        status: dbStatus as BrdStatus,
      },
    });

    // Sanitize brdConfig to prevent 413 on re-saves
    const sanitizedBrdConfig = sanitizeBrdConfig(brdConfig);

    // Upsert sections blob.
    //
    // KEY RULE: Prisma Json? columns require Prisma.JsonNull (not plain `null`)
    // to store a SQL NULL.  Using toJsonValue() handles this conversion for
    // every section field — both in create and in update.
    //
    // In the update block we only touch fields that were actually sent in the
    // request body (i.e. !== undefined), so partial saves work correctly.
    await prisma.brdSections.upsert({
      where:  { brdId },
      create: {
        brdId,
        scope:          toJsonValue(scope),
        metadata:       toJsonValue(metadata),
        toc:            toJsonValue(toc),
        citations:      toJsonValue(citations),
        contentProfile: toJsonValue(contentProfile),
        brdConfig:      toJsonValue(sanitizedBrdConfig),
      },
      update: {
        ...(scope          !== undefined && { scope:          toJsonValue(scope)          }),
        ...(metadata       !== undefined && { metadata:       toJsonValue(metadata)       }),
        ...(toc            !== undefined && { toc:            toJsonValue(toc)            }),
        ...(citations      !== undefined && { citations:      toJsonValue(citations)      }),
        ...(contentProfile !== undefined && { contentProfile: toJsonValue(contentProfile) }),
        ...(brdConfig      !== undefined && { brdConfig:      toJsonValue(sanitizedBrdConfig) }),
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