/*
  Warnings:

  - You are about to alter the column `sellRate` on the `cryptocurrencies` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `BigInt`.
  - You are about to alter the column `buyRate` on the `cryptocurrencies` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `BigInt`.

*/
-- AlterTable
ALTER TABLE "cryptocurrencies" ALTER COLUMN "sellRate" SET DEFAULT 0,
ALTER COLUMN "sellRate" SET DATA TYPE BIGINT,
ALTER COLUMN "buyRate" SET DEFAULT 0,
ALTER COLUMN "buyRate" SET DATA TYPE BIGINT;
