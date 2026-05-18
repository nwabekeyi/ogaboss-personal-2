/*
  Warnings:

  - You are about to alter the column `minAmount` on the `buffer_tiers` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `BigInt`.
  - You are about to alter the column `maxAmount` on the `buffer_tiers` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `BigInt`.
  - You are about to alter the column `bufferPercent` on the `buffer_tiers` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(5,2)`.
  - You are about to alter the column `defaultBufferPercent` on the `cryptocurrencies` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(5,2)`.
  - You are about to alter the column `maxBufferPercent` on the `cryptocurrencies` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(5,2)`.

*/
-- AlterTable
ALTER TABLE "buffer_tiers" ALTER COLUMN "minAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "maxAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "bufferPercent" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "cryptocurrencies" ALTER COLUMN "defaultBufferPercent" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "maxBufferPercent" SET DATA TYPE DECIMAL(5,2);
