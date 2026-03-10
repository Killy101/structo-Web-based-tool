// routes/brd/crud.ts
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

const VALID_STATUSES = ["DRAFT", "PAUSED", "COMPLETED", "APPROVED", "ON_HOLD"];

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
      const meta = b.sections?.metadata as Record<string, unknown> | null;

      const geography     = (meta?.geography              as string) ?? "—";
      const categoryName  = (meta?.content_category_name  as string) ?? "";
      const documentTitle = (meta?.document_title         as string) ?? "";

      // Rebuild the specific title the same way upload.ts does, so the list
      // always shows the most descriptive name even if b.title is stale.
      let displayName = b.title;
      if (categoryName && documentTitle) {
        const catLower = categoryName.toLowerCase();
        const docLower = documentTitle.toLowerCase();
        const isRedundant =
          catLower === docLower ||
          catLower.includes(docLower) ||
          docLower.includes(catLower);

        displayName = isRedundant
          ? (categoryName.length >= documentTitle.length ? categoryName : documentTitle)
          : `${categoryName} - ${documentTitle}`;
      } else if (categoryName) {
        displayName = categoryName;
      } else if (documentTitle) {
        displayName = documentTitle;
      }

      // Capitalise first letter
      displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

      return {
        id:          b.brdId,
        title:       displayName,   // combined specific title shown in the list
        format:      b.format === "OLD" ? "old" : "new",
        status:      b.status,      // raw enum: DRAFT | PAUSED | COMPLETED | APPROVED | ON_HOLD
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
    return res.json({ nextId: `BRD-${String(count + 1).padStart(3, "0")}` });
  } catch (err) {
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

    const meta          = brd.sections?.metadata as Record<string, unknown> | null;
    const categoryName  = (meta?.content_category_name as string) ?? "";
    const documentTitle = (meta?.document_title        as string) ?? "";

    let displayName = brd.title;
    if (categoryName && documentTitle) {
      const catLower = categoryName.toLowerCase();
      const docLower = documentTitle.toLowerCase();
      const isRedundant =
        catLower === docLower ||
        catLower.includes(docLower) ||
        docLower.includes(catLower);

      displayName = isRedundant
        ? (categoryName.length >= documentTitle.length ? categoryName : documentTitle)
        : `${categoryName} - ${documentTitle}`;
    } else if (categoryName) {
      displayName = categoryName;
    } else if (documentTitle) {
      displayName = documentTitle;
    }

    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    return res.json({
      id:             brd.brdId,
      title:          displayName,
      format:         brd.format === "OLD" ? "old" : "new",
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

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status: "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const brd = await prisma.brd.update({
      where: { brdId: String(req.params.brdId) },
      data: {
        ...(title  && { title }),
        ...(status && { status: status as any }),
      },
    });
    return res.json({ success: true, brdId: brd.brdId });
  } catch {
    return res.status(404).json({ error: "BRD not found" });
  }
});

export default router;