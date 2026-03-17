-- AlterTable: Add soft-delete timestamp to Brd
ALTER TABLE "Brd" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable: Add soft-delete timestamp to TaskAssignment
ALTER TABLE "TaskAssignment" ADD COLUMN "deletedAt" TIMESTAMP(3);
