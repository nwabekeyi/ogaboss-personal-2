/*
  Warnings:

  - You are about to drop the column `balance` on the `wallets` table. All the data in the column will be lost.
  - Added the required column `originalBalance` to the `wallets` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."wallets_userId_balance_desc_idx";

-- AlterTable
ALTER TABLE "wallets" DROP COLUMN "balance",
ADD COLUMN     "baseBalance" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "originalBalance" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "wallets_userId_balance_desc_idx" ON "wallets"("userId", "originalBalance");
