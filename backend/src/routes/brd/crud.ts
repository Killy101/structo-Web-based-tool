// routes/brd/crud.ts
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

// ── GET /brd — list all BRDs ───────────────────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  try {
    const brds = await prisma.brd.findMany({
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
      // geography lives inside the metadata JSON blob
      const meta = b.sections?.metadata as Record<string, unknown> | null;
      const geography = (meta?.geography as string) ?? "—";

      return {
        id:          b.brdId,
        title:       b.title,
        format:      b.format === "OLD" ? "old" : "new",
        status:      mapStatus(b.status),
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

// ── GET /brd/next-id ───────────────────────────────────────────────────────
router.get("/next-id", async (_req: Request, res: Response) => {
  try {
    const count = await prisma.brd.count();
    const next  = String(count + 1).padStart(3, "0");
    return res.json({ nextId: `BRD-${next}` });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/:brdId — single BRD with all section blobs ───────────────────
// Used by View/Edit flow to load existing BRD data into the form steps
router.get("/:brdId", async (req: Request, res: Response) => {
  try {
    const brd = await prisma.brd.findUnique({
      where:   { brdId: String(req.params.brdId) },
      include: { sections: true },
    });
    if (!brd) return res.status(404).json({ error: "BRD not found" });

    return res.json({
      id:             brd.brdId,
      title:          brd.title,
      format:         brd.format === "OLD" ? "old" : "new",
      status:         mapStatus(brd.status),
      version:        "v1.0",
      lastUpdated:    brd.updatedAt.toISOString().split("T")[0],
      // All section blobs returned as-is — frontend uses them directly
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

// ── DELETE /brd/:brdId ─────────────────────────────────────────────────────
router.delete("/:brdId", async (req: Request, res: Response) => {
  try {
    await prisma.brd.delete({ where: { brdId: String(req.params.brdId) } });
    return res.json({ success: true });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── PATCH /brd/:brdId — update status or title ────────────────────────────
router.patch("/:brdId", async (req: Request, res: Response) => {
  try {
    const { status, title } = req.body;
    const brd = await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data: {
        ...(title  && { title }),
        ...(status && { status }),
      },
    });
    return res.json({ success: true, brdId: brd.brdId });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

// ── Helper ─────────────────────────────────────────────────────────────────
function mapStatus(s: string): string {
  switch (s) {
    case "APPROVED":  return "Reviewed";
    case "IN_REVIEW": return "Ready";
    case "DRAFT":     return "Processing";
    case "ARCHIVED":  return "Draft";
    default:          return "Draft";
  }
}

export default router;