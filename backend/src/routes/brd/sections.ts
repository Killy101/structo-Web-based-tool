// routes/brd/sections.ts
//
// Replaces the old individual route files:
//   scope.ts, metadata.ts, toc.ts, citation.ts, contentProfile.ts
//
// All sections are now JSON blobs on brd_sections.
// GET  /brd/:brdId/sections        — returns all blobs at once
// GET  /brd/:brdId/sections/:name  — returns one blob  (scope|metadata|toc|citations|contentProfile|brdConfig)
// PUT  /brd/:brdId/sections/:name  — replaces one blob
//
// Why a single generic endpoint instead of one file per section?
//   • Adding a new section = zero new route files
//   • The blob is opaque — the route doesn't care about its internal shape
//   • Frontend can evolve the blob schema without touching the backend

import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

type SectionName = "scope" | "metadata" | "toc" | "citations" | "contentProfile" | "brdConfig";

const VALID_SECTIONS: SectionName[] = [
  "scope",
  "metadata",
  "toc",
  "citations",
  "contentProfile",
  "brdConfig",
];

function isValidSection(name: string): name is SectionName {
  return VALID_SECTIONS.includes(name as SectionName);
}

// ── GET /brd/:brdId/sections — all blobs ──────────────────────────────────
router.get("/:brdId/sections", async (req: Request, res: Response) => {
  try {
    const row = await prisma.brdSections.findUnique({
      where: { brdId: String(req.params.brdId) },
    });

    if (!row) {
      // No sections saved yet — return nulls so frontend can handle gracefully
      return res.json({
        scope: null, metadata: null, toc: null,
        citations: null, contentProfile: null, brdConfig: null,
      });
    }

    return res.json({
      scope:          row.scope,
      metadata:       row.metadata,
      toc:            row.toc,
      citations:      row.citations,
      contentProfile: row.contentProfile,
      brdConfig:      row.brdConfig,
    });
  } catch (err) {
    console.error("[GET /brd/:brdId/sections]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/:brdId/sections/:name — single blob ──────────────────────────
router.get("/:brdId/sections/:name", async (req: Request, res: Response) => {
  const name = String(req.params.name);
  if (!isValidSection(name)) {
    return res.status(400).json({ error: `Unknown section: ${name}. Valid: ${VALID_SECTIONS.join(", ")}` });
  }

  try {
    const row = await prisma.brdSections.findUnique({
      where: { brdId: String(req.params.brdId) },
      select: { [name]: true },
    });

    return res.json({ [name]: row?.[name] ?? null });
  } catch (err) {
    console.error(`[GET /brd/:brdId/sections/${name}]`, err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /brd/:brdId/sections/:name — replace single blob ──────────────────
// Body: { data: <any json> }
// Upserts the brd_sections row if it doesn't exist yet.
router.put("/:brdId/sections/:name", async (req: Request, res: Response) => {
  const name   = String(req.params.name);
  const brdId  = String(req.params.brdId);

  if (!isValidSection(String(name))) {
    return res.status(400).json({ error: `Unknown section: ${name}` });
  }

  const { data } = req.body;
  if (data === undefined) {
    return res.status(400).json({ error: "Request body must contain { data: ... }" });
  }

  try {
    await prisma.brdSections.upsert({
      where:  { brdId },
      create: { brdId, [name]: data },
      update: { [name]: data },
    });

    return res.json({ success: true, brdId, section: name });
  } catch (err) {
    console.error(`[PUT /brd/:brdId/sections/${name}]`, err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;