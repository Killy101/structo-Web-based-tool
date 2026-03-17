// routes/brd/upload.ts
import { Router, Request, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import prisma from "../../lib/prisma";
import { uploadLimiter, processingLimiter } from "../../middleware/rateLimits";
import { Prisma } from "@prisma/client"; 
import {
  makeStoragePointer,
  sanitizePathPart,
  uploadBinaryObject,
  uploadJsonObject,
} from "../../lib/supabase-storage";

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
  filename:         string;
  char_count:       number;
  detected_format?: string;   // "new" | "old" — auto-detected by Python
  scope:            Record<string, unknown>;
  metadata:         Record<string, unknown>;
  toc:              Record<string, unknown>;
  citations:        Record<string, unknown>;
  content_profile:  Record<string, unknown>;
  brd_config?:      Record<string, unknown>;
  brdConfig?:       Record<string, unknown>;
  image_metadata?:  ImageMeta[];
}

interface ImageMeta {
  tableIndex: number;
  rowIndex:   number;
  colIndex:   number;
  rid:        string;
  mediaName:  string;
  mimeType:   string;
  cellText:   string;
  imageData:  string; // base64 encoded
}

function sectionPath(brdId: string, name: string): string {
  return `brd/${brdId}/sections/${name}.json`;
}

function imagePath(brdId: string, image: ImageMeta, index: number): string {
  const safeMediaName = sanitizePathPart(image.mediaName || `image-${index}`);
  const safeRid = sanitizePathPart(image.rid || `rid-${index}`);
  return `brd/${brdId}/images/${String(image.tableIndex)}-${String(image.rowIndex)}-${String(image.colIndex)}-${safeRid}-${safeMediaName}`;
}

function stripQuotes(s: string): string {
  return s
    .trim()
    .replace(/^["\u201c\u201d\u2018\u2019]+|["\u201c\u201d\u2018\u2019]+$/g, "")
    .trim();
}

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

function buildTitle(
  meta: Record<string, string>,
  originalName: string
): string {
  const categoryName  = stripQuotes(meta.content_category_name ?? "");
  const documentTitle = stripQuotes(meta.document_title        ?? "");
  const issuingAgency = stripQuotes(meta.issuing_agency        ?? "");

  let rawTitle = "";

  if (categoryName && documentTitle && !isBoilerplate(documentTitle)) {
    const catLower = categoryName.toLowerCase();
    const docLower = documentTitle.toLowerCase();

    const isRedundant =
      catLower === docLower ||
      catLower.includes(docLower) ||
      docLower.includes(catLower);

    if (isRedundant) {
      rawTitle = categoryName.length >= documentTitle.length
        ? categoryName
        : documentTitle;
    } else {
      rawTitle = `${categoryName} - ${documentTitle}`;
    }
  } else if (categoryName) {
    rawTitle = categoryName;
  } else if (documentTitle) {
    rawTitle = documentTitle;
  } else if (issuingAgency) {
    rawTitle = issuingAgency;
  } else {
    rawTitle = originalName
      .replace(/\.(pdf|doc|docx)$/i, "")
      .replace(/_{2,}/g, " ")
      .replace(/_/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
}

// routes/brd/upload.ts - CORRECTED VERSION

router.post(
  "/upload",
  uploadLimiter,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      // ── 1. Generate BRD ID FIRST (before calling Python) ─────────────────
      // IMPORTANT: Must use MAX numeric suffix, NOT count().
      // count() produces collisions when any BRD has ever been deleted —
      // e.g. 9 rows exist but the highest id is BRD-010, so count+1 = BRD-010
      // which already exists and the upsert silently overwrites it.
      const allBrdIds = await prisma.brd.findMany({ select: { brdId: true } });
      const maxNum = allBrdIds.reduce((max, { brdId }) => {
        const n = parseInt(brdId.replace("BRD-", ""), 10);
        return isNaN(n) ? max : Math.max(max, n);
      }, 0);
      const brdId = `BRD-${String(maxNum + 1).padStart(3, "0")}`;
      
      console.log("\n" + "=".repeat(80));
      console.log("🚀 UPLOAD PROCESS STARTED");
      console.log("=".repeat(80));
      console.log(`📄 File: ${file.originalname}`);
      console.log(`🆔 Generated BRD ID: ${brdId}`);
      console.log(`🎯 Format: auto-detecting…`);
      console.log(`🔗 Processing URL: ${PROCESSING_URL}`);

      // ── 2. Forward to Python processor WITH brd_id query param ───────────
      const form = new FormData();
      form.append("file", fs.createReadStream(file.path), {
        filename: file.originalname,
        contentType: file.mimetype,
      });

      const processUrl = `${PROCESSING_URL}/process?brd_id=${encodeURIComponent(brdId)}`;
      console.log(`📡 URL: ${processUrl}`);

      const pyRes = await fetch(processUrl, {
        method: "POST",
        body: form,
        headers: form.getHeaders(),
      });

      console.log(`📡 Response status: ${pyRes.status} ${pyRes.statusText}`);

      if (!pyRes.ok) {
        const errText = await pyRes.text();
        console.error(`❌ Processing service error:`, errText);
        throw new Error(`Processing service error [${pyRes.status}]: ${errText}`);
      }

      const extracted = (await pyRes.json()) as ProcessingResult;
      
      console.log(`\n✅ Processing successful!`);
      console.log(`   📊 Images extracted: ${extracted.image_metadata?.length || 0}`);

      // ── 3. Persist heavy payloads to Supabase Storage ───────────────────
      const meta = (extracted.metadata ?? {}) as Record<string, string>;
      const title = buildTitle(meta, file.originalname);

      // Use format auto-detected by Python; fall back to "new"
      const detectedFormat = extracted.detected_format === "old" ? "old" : "new";

      const storageSectionPaths = {
        scope: await uploadJsonObject(sectionPath(brdId, "scope"), extracted.scope ?? null),
        metadata: await uploadJsonObject(sectionPath(brdId, "metadata"), extracted.metadata ?? null),
        toc: await uploadJsonObject(sectionPath(brdId, "toc"), extracted.toc ?? null),
        citations: await uploadJsonObject(sectionPath(brdId, "citations"), extracted.citations ?? null),
        contentProfile: await uploadJsonObject(sectionPath(brdId, "contentProfile"), extracted.content_profile ?? null),
        brdConfig: await uploadJsonObject(sectionPath(brdId, "brdConfig"), extracted.brd_config || extracted.brdConfig || null),
      };

      const imageRecords = await Promise.all((extracted.image_metadata ?? []).map(async (img, index) => {
        const storagePath = imagePath(brdId, img, index);
        const bytes = Buffer.from(img.imageData, "base64");
        await uploadBinaryObject(storagePath, bytes, img.mimeType || "image/png");

        return {
          brdId,
          tableIndex: img.tableIndex,
          rowIndex: img.rowIndex,
          colIndex: img.colIndex,
          rid: img.rid,
          mediaName: img.mediaName,
          mimeType: img.mimeType,
          cellText: img.cellText || "",
          blobUrl: storagePath,
        };
      }));

      console.log(`   📝 Creating BRD record: ${brdId} (format: ${detectedFormat})`);
      
      // Create BRD record in a transaction
      await prisma.$transaction(async (tx) => {
        // Create the BRD record
        const brd = await tx.brd.upsert({
          where: { brdId: brdId },
          create: {
            brdId: brdId,
            title: title,
            format: detectedFormat === "old" ? "OLD" : "NEW",
            status: "DRAFT",
            createdById: 1,
          },
          update: {
            title: title,
            format: detectedFormat === "old" ? "OLD" : "NEW",
          }
        });
        console.log(`   ✅ BRD record created/updated: ${brd.brdId}`);

        // ── 4. Store pointers for BRD sections (payload is in Supabase) ────
        const brdSections = await tx.brdSections.upsert({
          where: { brdId: brdId },
          create: {
            brdId: brdId,
            scope: (makeStoragePointer(storageSectionPaths.scope) as any) || Prisma.JsonNull,
            metadata: (makeStoragePointer(storageSectionPaths.metadata) as any) || Prisma.JsonNull,
            toc: (makeStoragePointer(storageSectionPaths.toc) as any) || Prisma.JsonNull,
            citations: (makeStoragePointer(storageSectionPaths.citations) as any) || Prisma.JsonNull,
            contentProfile: (makeStoragePointer(storageSectionPaths.contentProfile) as any) || Prisma.JsonNull,
            brdConfig: (makeStoragePointer(storageSectionPaths.brdConfig) as any) || Prisma.JsonNull,
          },
          update: {
            scope: (makeStoragePointer(storageSectionPaths.scope) as any) || Prisma.JsonNull,
            metadata: (makeStoragePointer(storageSectionPaths.metadata) as any) || Prisma.JsonNull,
            toc: (makeStoragePointer(storageSectionPaths.toc) as any) || Prisma.JsonNull,
            citations: (makeStoragePointer(storageSectionPaths.citations) as any) || Prisma.JsonNull,
            contentProfile: (makeStoragePointer(storageSectionPaths.contentProfile) as any) || Prisma.JsonNull,
            brdConfig: (makeStoragePointer(storageSectionPaths.brdConfig) as any) || Prisma.JsonNull,
          }
        });
        console.log(`   ✅ BrdSections record created/verified: ${brdSections.brdId}`);

        // ── 5. Save image metadata + storage paths (no BYTEA in DB) ────────
        if (imageRecords.length > 0) {
          console.log(`   🔍 First image metadata:`, {
            tableIndex: imageRecords[0].tableIndex,
            rowIndex: imageRecords[0].rowIndex,
            colIndex: imageRecords[0].colIndex,
            mediaName: imageRecords[0].mediaName,
            mimeType: imageRecords[0].mimeType,
          });

          console.log(`   💾 Attempting to save ${imageRecords.length} image pointers to PostgreSQL...`);

          // Delete any existing images for this BRD
          const deleteResult = await tx.brdCellImage.deleteMany({
            where: { brdId: brdId }
          });
          console.log(`      Deleted ${deleteResult.count} existing images`);

          // Save new images
          if (imageRecords.length > 0) {
            console.log(`      Creating ${imageRecords.length} new images...`);
            
            const saved = await tx.brdCellImage.createMany({
              data: imageRecords
            });
            console.log(`   ✅ SUCCESS: Saved ${saved.count} image rows with Supabase paths`);
            
            // Verify count
            const verifyCount = await tx.brdCellImage.count({
              where: { brdId: brdId }
            });
            console.log(`      Verified: ${verifyCount} images in database for ${brdId}`);
          }
        } else {
          console.log("   ℹ️ No images to save");
        }
      });

      console.log("=".repeat(80) + "\n");

      // ── 6. Return the extracted data + image metadata to the frontend ────
      const responseImageMetadata = extracted.image_metadata?.map(({ imageData, ...rest }) => rest) || [];
      
      return res.json({
        brdId,
        title,
        format: detectedFormat,
        filename: extracted.filename,
        scope: extracted.scope,
        metadata: extracted.metadata,
        toc: extracted.toc,
        citations: extracted.citations,
        contentProfile: extracted.content_profile,
        brdConfig: extracted.brd_config || extracted.brdConfig || null,
        imageMetadata: responseImageMetadata,
      });

    } catch (err) {
      console.error("\n❌ Upload error:", err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Upload processing failed",
      });
    } finally {
      // Clean up temp file
      if (file?.path) {
        fs.unlink(file.path, () => {});
        console.log(`🧹 Cleaned up temp file: ${file.path}`);
      }
    }
  }
);
export default router;