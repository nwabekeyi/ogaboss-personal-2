/*
  Warnings:

  - You are about to drop the `crypto_rates` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `defaultBufferPercent` to the `cryptocurrencies` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxBufferPercent` to the `cryptocurrencies` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "crypto_rates" DROP CONSTRAINT "crypto_rates_cryptoId_fkey";

-- DropForeignKey
ALTER TABLE "crypto_rates" DROP CONSTRAINT "crypto_rates_fiatId_fkey";

-- AlterTable
ALTER TABLE "cryptocurrencies" ADD COLUMN     "defaultBufferPercent" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "maxBufferPercent" DECIMAL(65,30) NOT NULL;

-- DropTable
DROP TABLE "crypto_rates";

-- CreateTable
CREATE TABLE "buffer_tiers" (
    "id" TEXT NOT NULL,
    "cryptoId" TEXT NOT NULL,
    "orderType" "OrderType",
    "minAmount" DECIMAL(65,30),
    "maxAmount" DECIMAL(65,30),
    "bufferPercent" DECIMAL(65,30) NOT NULL,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedat" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buffer_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buffer_tiers_cryptoId_idx" ON "buffer_tiers"("cryptoId");

-- CreateIndex
CREATE INDEX "buffer_tiers_orderType_idx" ON "buffer_tiers"("orderType");

-- CreateIndex
CREATE UNIQUE INDEX "buffer_tiers_cryptoId_orderType_minAmount_key" ON "buffer_tiers"("cryptoId", "orderType", "minAmount");

-- AddForeignKey
ALTER TABLE "buffer_tiers" ADD CONSTRAINT "buffer_tiers_cryptoId_fkey" FOREIGN KEY ("cryptoId") REFERENCES "cryptocurrencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
