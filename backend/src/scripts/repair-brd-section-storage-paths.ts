import prisma from "../lib/prisma";
import { repairBrdSectionStoragePaths } from "../lib/brd-storage-repair";

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");
const targetBrdIdArg = process.argv.slice(2).find((arg) => arg.startsWith("--brdId="));
const targetBrdId = targetBrdIdArg ? targetBrdIdArg.split("=")[1]?.trim() : undefined;

async function main() {
  console.log("=".repeat(72));
  console.log("BRD Section Storage Path Repair");
  console.log(`Mode: ${isDryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("=".repeat(72));

  const summary = await repairBrdSectionStoragePaths({
    dryRun: isDryRun,
    brdId: targetBrdId,
    log: (line) => console.log(line),
  });

  console.log("\nRepair summary");
  console.log("-".repeat(72));
  console.log(`Rows scanned: ${summary.rowsScanned}`);
  console.log(`Rows updated: ${summary.rowsUpdated}`);
  console.log(`Pointers scanned: ${summary.pointersScanned}`);
  console.log(`Pointers updated: ${summary.pointersUpdated}`);
  console.log(`Pointers unresolved: ${summary.pointersUnresolved}`);
  if (summary.targetBrdId) {
    console.log(`Target BRD: ${summary.targetBrdId}`);
  }
  console.log("=".repeat(72));
}

main()
  .catch((err) => {
    console.error("Repair failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
