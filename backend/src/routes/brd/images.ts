// routes/brd/images.ts
// Serves cell images directly from PostgreSQL BYTEA

import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

// ── GET /brd/:brdId/images ─────────────────────────────────────────────────
// Returns image metadata (no binary data)
router.get("/:brdId/images", async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);

    const images = await prisma.brdCellImage.findMany({
      where: { brdId },
      select: {
        id:         true,
        tableIndex: true,
        rowIndex:   true,
        colIndex:   true,
        rid:        true,
        mediaName:  true,
        mimeType:   true,
        cellText:   true,
        section:    true,
        fieldLabel: true,
        // imageData is NOT selected here
      },
      orderBy: [
        { tableIndex: "asc" },
        { rowIndex:   "asc" },
        { colIndex:   "asc" },
      ],
    });

    return res.json({ images });
  } catch (err) {
    console.error("[GET /brd/:brdId/images]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/:brdId/images/:imageId/blob ──────────────────────────────────
// Serves the raw image bytes from PostgreSQL
router.get("/:brdId/images/:imageId/blob", async (req: Request, res: Response) => {
  try {
    const imageId = Number(req.params.imageId);
    if (isNaN(imageId)) {
      return res.status(400).json({ error: "Invalid imageId" });
    }

    const img = await prisma.brdCellImage.findUnique({
      where:  { id: imageId },
      select: { imageData: true, mimeType: true, brdId: true },
    });

    if (!img) {
      return res.status(404).json({ error: "Image not found" });
    }

    // Security: make sure the image belongs to the requested BRD
    if (img.brdId !== String(req.params.brdId)) {
      return res.status(404).json({ error: "Image not found" });
    }

    if (!img.imageData) {
      return res.status(404).json({ error: "No image data stored" });
    }

    // Serve the image directly from database
    res.set("Content-Type", img.mimeType || "image/png");
    res.set("Cache-Control", "public, max-age=86400"); // 24 hour cache
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(img.imageData);

  } catch (err) {
    console.error("[GET /brd/:brdId/images/:imageId/blob]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /brd/:brdId/images ───────────────────────────────────────────────────
// Called by the BRD processing pipeline after extraction.
// Deletes all existing images for this BRD and inserts fresh records,
// ensuring section / fieldLabel are always up-to-date.
router.post("/:brdId/images", async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);
    const records: Array<{
      tableIndex: number;
      rowIndex:   number;
      colIndex:   number;
      rid:        string;
      mediaName:  string;
      mimeType:   string;
      cellText:   string;
      section:    string;
      fieldLabel: string;
      imageData:  string; // base64
    }> = req.body.images;

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: "images must be an array" });
    }

    // Delete stale records, then insert fresh ones in a transaction
    await prisma.$transaction([
      prisma.brdCellImage.deleteMany({ where: { brdId } }),
      prisma.brdCellImage.createMany({
        data: records.map(r => ({
          brdId,
          tableIndex: r.tableIndex,
          rowIndex:   r.rowIndex,
          colIndex:   r.colIndex,
          rid:        r.rid,
          mediaName:  r.mediaName,
          mimeType:   r.mimeType,
          cellText:   r.cellText    ?? "",
          section:    r.section     ?? "unknown",
          fieldLabel: r.fieldLabel  ?? "",
          imageData:  Buffer.from(r.imageData, "base64"),
        })),
      }),
    ]);

    return res.json({ saved: records.length });
  } catch (err) {
    console.error("[POST /brd/:brdId/images]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /brd/:brdId/images/upload ───────────────────────────────────────────
// Non-destructive single-image insert used by the manual "Add Image" UI.
// Does NOT delete existing images unlike POST /brd/:brdId/images.
router.post("/:brdId/images/upload", async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);
    const { imageData, mimeType, mediaName, section, fieldLabel, cellText } = req.body;

    if (!imageData || !mimeType) {
      return res.status(400).json({ error: "imageData and mimeType are required" });
    }

    // Use a high tableIndex so manual images don't collide with extracted ones
    const existing = await prisma.brdCellImage.findMany({
      where:   { brdId },
      select:  { tableIndex: true },
      orderBy: { tableIndex: "desc" },
      take:    1,
    });
    const nextTableIndex = (existing[0]?.tableIndex ?? -1) + 1;

    const record = await prisma.brdCellImage.create({
      data: {
        brdId,
        tableIndex: nextTableIndex,
        rowIndex:   0,
        colIndex:   0,
        rid:        `manual-${Date.now()}`,
        mediaName:  mediaName  ?? "image",
        mimeType:   mimeType,
        cellText:   cellText   ?? "",
        section:    section    ?? "unknown",
        fieldLabel: fieldLabel ?? "",
        imageData:  Buffer.from(imageData, "base64"),
      },
      select: { id: true, mediaName: true, mimeType: true, section: true, fieldLabel: true, cellText: true },
    });

    return res.json({ success: true, image: record });
  } catch (err) {
    console.error("[POST /brd/:brdId/images/upload]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /brd/:brdId/images/:imageId ───────────────────────────────────────
// Removes a single manually-uploaded image.
// Verifies the image belongs to the specified BRD before deleting.
router.delete("/:brdId/images/:imageId", async (req: Request, res: Response) => {
  try {
    const brdId   = String(req.params.brdId);
    const imageId = Number(req.params.imageId);

    if (isNaN(imageId)) {
      return res.status(400).json({ error: "Invalid imageId" });
    }

    const img = await prisma.brdCellImage.findUnique({
      where:  { id: imageId },
      select: { brdId: true },
    });

    if (!img || img.brdId !== brdId) {
      return res.status(404).json({ error: "Image not found" });
    }

    await prisma.brdCellImage.delete({ where: { id: imageId } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /brd/:brdId/images/:imageId]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;