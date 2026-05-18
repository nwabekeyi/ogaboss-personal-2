/*
  Warnings:

  - A unique constraint covering the columns `[transactionId]` on the table `failed_company_liquidity_transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "failed_company_liquidity_transactions" DROP CONSTRAINT "failed_company_liquidity_transactions_transactionId_fkey";

-- DropIndex
DROP INDEX "failed_company_liquidity_transactions_transactionId_idx";

-- AlterTable
ALTER TABLE "failed_company_liquidity_transactions" ALTER COLUMN "transactionId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "failed_company_liquidity_transactions_transactionId_key" ON "failed_company_liquidity_transactions"("transactionId");

-- AddForeignKey
ALTER TABLE "failed_company_liquidity_transactions" ADD CONSTRAINT "failed_company_liquidity_transactions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
