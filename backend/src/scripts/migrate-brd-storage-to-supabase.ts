import prisma from "../lib/prisma";
import {
  extractStoragePath,
  makeStoragePointer,
  sanitizePathPart,
  uploadBinaryObject,
  uploadJsonObject,
} from "../lib/supabase-storage";

type SectionField =
  | "scope"
  | "metadata"
  | "toc"
  | "citations"
  | "contentProfile"
  | "brdConfig"
  | "innodMetajson"
  | "simpleMetajson";

const SECTION_FIELDS: SectionField[] = [
  "scope",
  "metadata",
  "toc",
  "citations",
  "contentProfile",
  "brdConfig",
  "innodMetajson",
  "simpleMetajson",
];

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");

function sectionStoragePath(brdId: string, name: SectionField): string {
  return `brd/${brdId}/sections/${name}.json`;
}

function imageStoragePath(
  brdId: string,
  image: {
    id: number;
    tableIndex: number;
    rowIndex: number;
    colIndex: number;
    rid: string;
    mediaName: string;
  },
): string {
  const safeMediaName = sanitizePathPart(image.mediaName || `image-${image.id}`);
  const safeRid = sanitizePathPart(image.rid || `rid-${image.id}`);
  return `brd/${brdId}/images/${String(image.tableIndex)}-${String(image.rowIndex)}-${String(image.colIndex)}-${safeRid}-${safeMediaName}-${String(image.id)}`;
}

async function migrateSections() {
  const rows = await prisma.brdSections.findMany({
    select: {
      brdId: true,
      scope: true,
      metadata: true,
      toc: true,
      citations: true,
      contentProfile: true,
      brdConfig: true,
      innodMetajson: true,
      simpleMetajson: true,
    },
  });

  let sectionRowsUpdated = 0;
  let sectionBlobsUploaded = 0;

  for (const row of rows) {
    const updateData: Record<string, unknown> = {};

    for (const field of SECTION_FIELDS) {
      const currentValue = row[field];

      if (currentValue === null || currentValue === undefined) continue;
      if (extractStoragePath(currentValue)) continue;

      const storagePath = sectionStoragePath(row.brdId, field);

      if (!isDryRun) {
        await uploadJsonObject(storagePath, currentValue);
      }

      updateData[field] = makeStoragePointer(storagePath);
      sectionBlobsUploaded += 1;
    }

    if (Object.keys(updateData).length > 0) {
      if (!isDryRun) {
        await prisma.brdSections.update({
          where: { brdId: row.brdId },
          data: updateData,
        });
      }
      sectionRowsUpdated += 1;
    }
  }

  return { sectionRowsUpdated, sectionBlobsUploaded };
}

async function migrateImages() {
  const images = await prisma.brdCellImage.findMany({
    where: {
      OR: [
        { blobUrl: null },
        { blobUrl: "" },
      ],
    },
    select: {
      id: true,
      brdId: true,
      tableIndex: true,
      rowIndex: true,
      colIndex: true,
      rid: true,
      mediaName: true,
      mimeType: true,
      imageData: true,
      blobUrl: true,
    },
  });

  let imageRowsUpdated = 0;
  let imageBlobsUploaded = 0;
  let imagesSkippedNoData = 0;

  for (const image of images) {
    if (image.blobUrl && image.blobUrl.trim()) continue;

    if (!image.imageData) {
      imagesSkippedNoData += 1;
      continue;
    }

    const storagePath = imageStoragePath(image.brdId, image);

    if (!isDryRun) {
      await uploadBinaryObject(
        storagePath,
        Buffer.from(image.imageData),
        image.mimeType || "application/octet-stream",
      );

      await prisma.brdCellImage.update({
        where: { id: image.id },
        data: {
          blobUrl: storagePath,
          imageData: null,
        },
      });
    }

    imageRowsUpdated += 1;
    imageBlobsUploaded += 1;
  }

  return { imageRowsUpdated, imageBlobsUploaded, imagesSkippedNoData };
}

async function main() {
  console.log("=".repeat(72));
  console.log("BRD Storage Migration -> Supabase Storage");
  console.log(`Mode: ${isDryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("=".repeat(72));

  const sectionStats = await migrateSections();
  const imageStats = await migrateImages();

  console.log("\nMigration summary");
  console.log("-".repeat(72));
  console.log(`Section rows updated: ${sectionStats.sectionRowsUpdated}`);
  console.log(`Section blobs uploaded: ${sectionStats.sectionBlobsUploaded}`);
  console.log(`Image rows updated: ${imageStats.imageRowsUpdated}`);
  console.log(`Image blobs uploaded: ${imageStats.imageBlobsUploaded}`);
  console.log(`Images skipped (no imageData): ${imageStats.imagesSkippedNoData}`);
  console.log("=".repeat(72));
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
