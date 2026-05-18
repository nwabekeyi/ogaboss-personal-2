/*
  Warnings:

  - You are about to drop the column `amountBase` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `executionPriceBase` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `feeBase` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `quotedPriceBase` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `receivedAmountBase` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `toAmountBase` on the `swaptransactions` table. All the data in the column will be lost.
  - Changed the type of `provider` on the `company_withdrawals` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Providers" AS ENUM ('QUDIAX', 'PAYSTACK');

-- AlterTable
ALTER TABLE "company_withdrawals" DROP COLUMN "provider",
ADD COLUMN     "provider" "Providers" NOT NULL;

-- AlterTable
ALTER TABLE "swaptransactions" DROP COLUMN "amountBase",
DROP COLUMN "executionPriceBase",
DROP COLUMN "feeBase",
DROP COLUMN "quotedPriceBase",
DROP COLUMN "receivedAmountBase",
DROP COLUMN "toAmountBase";

-- CreateIndex
CREATE INDEX "company_withdrawals_provider_idx" ON "company_withdrawals"("provider");

-- CreateIndex
CREATE INDEX "company_withdrawals_provider_status_idx" ON "company_withdrawals"("provider", "status");

-- CreateIndex
CREATE INDEX "company_withdrawals_providerReference_provider_idx" ON "company_withdrawals"("providerReference", "provider");

-- CreateIndex
CREATE INDEX "swaptransactions_swapId_idx" ON "swaptransactions"("swapId");

-- CreateIndex
CREATE INDEX "swaptransactions_quoteId_idx" ON "swaptransactions"("quoteId");

-- CreateIndex
CREATE INDEX "swaptransactions_status_idx" ON "swaptransactions"("status");

-- CreateIndex
CREATE INDEX "swaptransactions_fromCurrency_toCurrency_idx" ON "swaptransactions"("fromCurrency", "toCurrency");
