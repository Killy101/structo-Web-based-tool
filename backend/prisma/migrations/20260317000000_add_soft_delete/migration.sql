-- Add soft delete support to Brd and TaskAssignment tables
ALTER TABLE "Brd" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "TaskAssignment" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index for efficient queries filtering out soft-deleted records
CREATE INDEX "Brd_deletedAt_idx" ON "Brd"("deletedAt");
CREATE INDEX "TaskAssignment_deletedAt_idx" ON "TaskAssignment"("deletedAt");
