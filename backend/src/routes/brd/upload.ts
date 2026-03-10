// routes/brd/upload.ts
import { Router, Request, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import prisma from "../../lib/prisma";

const router = Router();

const PROCESSING_URL = process.env.PROCESSING_URL ?? "http://localhost:8000";

const upload = multer({
  dest: path.join(process.cwd(), "tmp", "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    const allowed = [".pdf", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only PDF, DOC, DOCX files are allowed"));
  },
});

interface ProcessingResult {
  filename:        string;
  char_count:      number;
  scope:           Record<string, unknown>;
  metadata:        Record<string, unknown>;
  toc:             Record<string, unknown>;
  citations:       Record<string, unknown>;
  content_profile: Record<string, unknown>;
  brd_config?:     Record<string, unknown>;
  brdConfig?:      Record<string, unknown>;
}

router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const file   = req.file;
    const format = typeof req.body?.format === "string" && req.body.format.length > 0
      ? req.body.format
      : "new";

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    try {
      // ── 1. Forward to Python processor ───────────────────────────
      const form = new FormData();
      form.append("file", fs.createReadStream(file.path), {
        filename:    file.originalname,
        contentType: file.mimetype,
      });

      const pyRes = await fetch(`${PROCESSING_URL}/process`, {
        method:  "POST",
        body:    form,
        headers: form.getHeaders(),
      });

      if (!pyRes.ok) {
        const errText = await pyRes.text();
        throw new Error(`Processing service error [${pyRes.status}]: ${errText}`);
      }

      const extracted = (await pyRes.json()) as ProcessingResult;

      // ── 2. Generate BRD ID (lightweight — just a count query) ─────
      const count = await prisma.brd.count();
      const brdId = `BRD-${String(count + 1).padStart(3, "0")}`;

      const rawTitle =
        (extracted.metadata?.document_title as string) ||
        file.originalname.replace(/\.(pdf|doc|docx)$/i, "").replace(/[-_]/g, " ");
      const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

      // ── 3. NO DB WRITE HERE ───────────────────────────────────────
      // We only return the extracted data + generated brdId to the frontend.
      // The actual DB save happens when the user clicks "Save BRD" in Generate.tsx
      // via POST /brd/save — this avoids double-writing and removes the
      // pgBouncer timeout risk entirely. Upload is now pure Python → response.

      return res.json({
        brdId,
        title,
        format,
        filename:       extracted.filename,
        scope:          extracted.scope,
        metadata:       extracted.metadata,
        toc:            extracted.toc,
        citations:      extracted.citations,
        contentProfile: extracted.content_profile,
        brdConfig:      extracted.brd_config || extracted.brdConfig || null,
      });

    } catch (err) {
      console.error("[brd/upload] error:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Upload processing failed",
      });
    } finally {
      if (file?.path) fs.unlink(file.path, () => {});
    }
  }
);

export default router;