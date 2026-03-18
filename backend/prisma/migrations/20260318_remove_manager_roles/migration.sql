-- Safely remove MANAGER_QA and MANAGER_QC from the Role enum.
-- This migration is PostgreSQL-specific and idempotent for role data remap.

BEGIN;

-- 1) Remap any existing users with manager roles to USER first.
UPDATE "User"
SET "role" = 'USER'::"Role"
WHERE "role" IN ('MANAGER_QA'::"Role", 'MANAGER_QC'::"Role");

-- 2) Create a new enum without manager values.
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- 3) Rebind User.role to the new enum.
ALTER TABLE "User"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");

-- 4) Replace old enum with new enum.
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- 5) Restore default.
ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'USER'::"Role";

COMMIT;
