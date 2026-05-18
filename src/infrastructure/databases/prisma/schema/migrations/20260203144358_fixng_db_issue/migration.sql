/*
  Warnings:

  - The `orderType` column on the `buffer_tiers` table would be dropped and recreated.
*/

-- DropForeignKey (use the ACTUAL constraint name)
ALTER TABLE "buffer_tiers"
DROP CONSTRAINT IF EXISTS "buffer_tiers_cryptoid_fkey";

-- DropIndex
DROP INDEX IF EXISTS "buffer_tiers_cryptoId_idx";

-- DropIndex
DROP INDEX IF EXISTS "buffer_tiers_cryptoId_orderType_minAmount_key";

-- DropIndex
DROP INDEX IF EXISTS "buffer_tiers_orderType_idx";

-- AlterTable
ALTER TABLE "buffer_tiers"
  ALTER COLUMN "cryptoId" DROP NOT NULL,
  DROP COLUMN IF EXISTS "orderType",
  ADD COLUMN "orderType" TEXT,
  ALTER COLUMN "bufferPercent" DROP NOT NULL,
  ALTER COLUMN "createdat" SET DATA TYPE TIMESTAMP(6),
  ALTER COLUMN "updatedat" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedat" SET DATA TYPE TIMESTAMP(6);

-- AlterTable
ALTER TABLE "cryptocurrencies"
  ALTER COLUMN "defaultBufferPercent" SET DEFAULT 0,
  ALTER COLUMN "maxBufferPercent" SET DEFAULT 0;

-- AddForeignKey (MATCH schema map exactly)
ALTER TABLE "buffer_tiers"
ADD CONSTRAINT "buffer_tiers_cryptoid_fkey"
FOREIGN KEY ("cryptoId")
REFERENCES "cryptocurrencies"("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;
