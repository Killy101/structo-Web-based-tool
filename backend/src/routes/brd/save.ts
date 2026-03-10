// routes/brd/save.ts
//
// POST /brd/save
// Saves all section blobs for a BRD in a single transaction.
// Idempotent — safe to call multiple times (re-save).

import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

router.post("/save", async (req: Request, res: Response) => {
  const {
    brdId, title, format,
    scope, metadata, toc, citations, contentProfile, brdConfig,
  } = req.body;

  if (!brdId) {
    return res.status(400).json({ error: "brdId is required" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Upsert the Brd header row
      await tx.brd.upsert({
        where:  { brdId },
        create: {
          brdId,
          title:       title  ?? "Untitled BRD",
          format:      format === "old" ? "OLD" : "NEW",
          status:      "IN_REVIEW",
          createdById: 1, // TODO: replace with req.user.id once auth is wired
        },
        update: {
          ...(title  && { title }),
          ...(format && { format: format === "old" ? "OLD" : "NEW" }),
          status: "IN_REVIEW",
        },
      });

      // 2. Upsert the flat sections blob row — one row per BRD, all JSON
      //    Only update fields that were actually sent (undefined = don't touch)
      await tx.brdSections.upsert({
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
    });

    return res.json({ success: true, brdId, status: "IN_REVIEW" });
  } catch (err) {
    console.error("[POST /brd/save]", err);
    return res.status(500).json({ error: "Failed to save BRD" });
  }
});

export default router;