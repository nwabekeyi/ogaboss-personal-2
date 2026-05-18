/*
  Warnings:

  - Made the column `reference` on table `withdrawals` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "withdrawals" ALTER COLUMN "reference" SET NOT NULL;

-- CreateIndex
CREATE INDEX "withdrawals_reference_idx" ON "withdrawals"("reference");
