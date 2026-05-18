/*
  Warnings:

  - Changed the type of `originalBalance` on the `wallets` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "executedCryptoAmountBase" BIGINT,
ADD COLUMN     "executedFiatAmountBase" BIGINT,
ADD COLUMN     "executionPrice" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "wallets" DROP COLUMN "originalBalance",
ADD COLUMN     "originalBalance" DECIMAL(65,30) NOT NULL;

-- CreateIndex
CREATE INDEX "wallets_userId_balance_desc_idx" ON "wallets"("userId", "originalBalance");
