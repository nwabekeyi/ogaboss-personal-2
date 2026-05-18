/*
  Warnings:

  - You are about to drop the column `rateToUSD` on the `fiatcurrencies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "fiatcurrencies" DROP COLUMN "rateToUSD";
