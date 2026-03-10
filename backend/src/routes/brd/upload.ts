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

/** Strip surrounding curly/straight quotes that the Python extractor sometimes
 *  leaves on values it reads from the Word doc (e.g. `"United States"`). */
function stripQuotes(s: string): string {
  return s
    .trim()
    .replace(/^["\u201c\u201d\u2018\u2019]+|["\u201c\u201d\u2018\u2019]+$/g, "")
    .trim();
}

/**
 * Boilerplate H1 headings that should never be used as a document title.
 * These are generic section names that appear in BRD templates.
 */
const BOILERPLATE_TITLES = new Set([
  "structuring requirements",
  "content structure",
  "formatting requirements",
  "document structure",
  "template instructions",
  "instructions",
  "overview",
  "introduction",
  "background",
  "purpose",
  "scope",
  "document history",
  "glossary",
  "file delivery",
  "system display",
  "citation visualization",
  "legal",
  "copyright",
]);

function isBoilerplate(title: string): boolean {
  const t = title.trim().toLowerCase();
  return BOILERPLATE_TITLES.has(t) || [...BOILERPLATE_TITLES].some(b => t.includes(b));
}

/**
 * Build the best human-readable title from extracted metadata + filename.
 *
 * Rules:
 *   1. If both content_category_name and document_title exist, document_title
 *      is not boilerplate, and it adds specificity beyond content_category_name,
 *      combine them: "{content_category_name} - {document_title}"
 *      e.g. "Code of Federal Regulations" + "Title 12: Banks and Banking"
 *           → "Code of Federal Regulations - Title 12: Banks and Banking"
 *
 *   2. If document_title is boilerplate or redundant, just use content_category_name.
 *
 *   3. If only content_category_name exists, use it.
 *
 *   4. If neither exists, fall back to issuing_agency.
 *
 *   5. Last resort: clean up the filename.
 */
function buildTitle(
  meta: Record<string, string>,
  originalName: string
): string {
  const categoryName  = stripQuotes(meta.content_category_name ?? "");
  const documentTitle = stripQuotes(meta.document_title        ?? "");
  const issuingAgency = stripQuotes(meta.issuing_agency        ?? "");

  let rawTitle = "";

  if (categoryName && documentTitle && !isBoilerplate(documentTitle)) {
    // Check if document_title adds specificity beyond content_category_name
    const catLower = categoryName.toLowerCase();
    const docLower = documentTitle.toLowerCase();

    const isRedundant =
      catLower === docLower ||
      catLower.includes(docLower) ||
      docLower.includes(catLower);

    if (isRedundant) {
      // They overlap — just use the longer/more specific one
      rawTitle = categoryName.length >= documentTitle.length
        ? categoryName
        : documentTitle;
    } else {
      // document_title adds new info — combine them
      rawTitle = `${categoryName} - ${documentTitle}`;
    }
  } else if (categoryName) {
    rawTitle = categoryName;
  } else if (documentTitle) {
    rawTitle = documentTitle;
  } else if (issuingAgency) {
    rawTitle = issuingAgency;
  } else {
    // Filename fallback: "Code_of_Federal_Regulations_-_Title_12__Banks_and_Banking.docx"
    // → "Code of Federal Regulations - Title 12 Banks and Banking"
    rawTitle = originalName
      .replace(/\.(pdf|doc|docx)$/i, "")
      .replace(/_{2,}/g, " ")        // double underscores → space
      .replace(/_/g, " ")            // remaining underscores → space
      .replace(/\s{2,}/g, " ")       // collapse multiple spaces
      .trim();
  }

  return rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
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
      // ── 1. Forward to Python processor ───────────────────────────────────
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

      // ── 2. Generate BRD ID (lightweight — just a count query) ────────────
      const count = await prisma.brd.count();
      const brdId = `BRD-${String(count + 1).padStart(3, "0")}`;

      // ── 3. Derive a human-readable title ─────────────────────────────────
      const meta  = (extracted.metadata ?? {}) as Record<string, string>;
      const title = buildTitle(meta, file.originalname);

      // ── 4. NO DB WRITE HERE ───────────────────────────────────────────────
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