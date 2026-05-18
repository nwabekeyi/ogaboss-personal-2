/*
  Warnings:

  - You are about to drop the column `buyRate` on the `cryptocurrencies` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `cryptocurrencies` table. All the data in the column will be lost.
  - You are about to drop the column `originalBuy` on the `cryptocurrencies` table. All the data in the column will be lost.
  - You are about to drop the column `originalSell` on the `cryptocurrencies` table. All the data in the column will be lost.
  - You are about to drop the column `sellRate` on the `cryptocurrencies` table. All the data in the column will be lost.
  - You are about to drop the `Rate` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `decimals` to the `cryptocurrencies` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "cryptocurrencies" DROP COLUMN "buyRate",
DROP COLUMN "currency",
DROP COLUMN "originalBuy",
DROP COLUMN "originalSell",
DROP COLUMN "sellRate",
ADD COLUMN     "decimals" INTEGER NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "logoUrl" TEXT;

-- DropTable
DROP TABLE "public"."Rate";

-- CreateTable
CREATE TABLE "crypto_rates" (
    "id" TEXT NOT NULL,
    "cryptoSymbol" TEXT NOT NULL,
    "buyRateBase" BIGINT NOT NULL,
    "sellRateBase" BIGINT NOT NULL,
    "originalBuyRate" TEXT NOT NULL,
    "originalSellRate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fiatId" TEXT NOT NULL,
    "cryptoId" TEXT NOT NULL,

    CONSTRAINT "crypto_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiatcurrencies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimals" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiatcurrencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crypto_rates_fiatId_idx" ON "crypto_rates"("fiatId");

-- CreateIndex
CREATE INDEX "crypto_rates_cryptoId_idx" ON "crypto_rates"("cryptoId");

-- CreateIndex
CREATE INDEX "crypto_rates_cryptoSymbol_idx" ON "crypto_rates"("cryptoSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_rates_fiatId_cryptoId_key" ON "crypto_rates"("fiatId", "cryptoId");

-- CreateIndex
CREATE UNIQUE INDEX "fiatcurrencies_code_key" ON "fiatcurrencies"("code");

-- AddForeignKey
ALTER TABLE "crypto_rates" ADD CONSTRAINT "crypto_rates_fiatId_fkey" FOREIGN KEY ("fiatId") REFERENCES "fiatcurrencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_rates" ADD CONSTRAINT "crypto_rates_cryptoId_fkey" FOREIGN KEY ("cryptoId") REFERENCES "cryptocurrencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
