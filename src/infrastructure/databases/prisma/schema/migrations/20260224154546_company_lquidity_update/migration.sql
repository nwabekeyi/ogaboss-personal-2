/*
  Warnings:

  - You are about to drop the `CompanyLiquidity` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `description` to the `company_withdrawals` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "company_withdrawals" ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "failedReason" TEXT,
ADD COLUMN     "fee" TEXT,
ADD COLUMN     "total" TEXT,
ADD COLUMN     "txHash" TEXT;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "reservedBalance" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "transactionId" TEXT;

-- DropTable
DROP TABLE "CompanyLiquidity";

-- CreateTable
CREATE TABLE "company_liquidity" (
    "id" TEXT NOT NULL,
    "totalBalance" BIGINT NOT NULL DEFAULT 0,
    "reservedBalance" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_liquidity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_company_liquidity_transactions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountBase" BIGINT NOT NULL,
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "failed_company_liquidity_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_liquidity_currency_key" ON "company_liquidity"("currency");

-- CreateIndex
CREATE INDEX "company_liquidity_currency_idx" ON "company_liquidity"("currency");

-- CreateIndex
CREATE INDEX "failed_company_liquidity_transactions_transactionId_idx" ON "failed_company_liquidity_transactions"("transactionId");

-- CreateIndex
CREATE INDEX "failed_company_liquidity_transactions_currency_idx" ON "failed_company_liquidity_transactions"("currency");

-- CreateIndex
CREATE INDEX "failed_company_liquidity_transactions_createdAt_idx" ON "failed_company_liquidity_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "company_withdrawals_status_idx" ON "company_withdrawals"("status");

-- CreateIndex
CREATE INDEX "company_withdrawals_currency_idx" ON "company_withdrawals"("currency");

-- CreateIndex
CREATE INDEX "company_withdrawals_provider_idx" ON "company_withdrawals"("provider");

-- CreateIndex
CREATE INDEX "company_withdrawals_createdAt_idx" ON "company_withdrawals"("createdAt");

-- CreateIndex
CREATE INDEX "company_withdrawals_provider_status_idx" ON "company_withdrawals"("provider", "status");

-- CreateIndex
CREATE INDEX "company_withdrawals_currency_status_idx" ON "company_withdrawals"("currency", "status");

-- CreateIndex
CREATE INDEX "company_withdrawals_providerReference_provider_idx" ON "company_withdrawals"("providerReference", "provider");

-- AddForeignKey
ALTER TABLE "failed_company_liquidity_transactions" ADD CONSTRAINT "failed_company_liquidity_transactions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
