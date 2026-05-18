/*
  Warnings:

  - Made the column `nairaAmount` on table `transactions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "totalAmountSent" DROP NOT NULL,
ALTER COLUMN "nairaAmount" SET NOT NULL;
