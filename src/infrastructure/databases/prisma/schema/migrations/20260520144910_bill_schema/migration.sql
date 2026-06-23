/*
  Warnings:

  - Made the column `transactionId` on table `failed_company_liquidity_transactions` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "TransactionContext" ADD VALUE 'BILL_PAYMENT';

-- DropForeignKey
ALTER TABLE "failed_company_liquidity_transactions" DROP CONSTRAINT "failed_company_liquidity_transactions_transactionId_fkey";

-- AlterTable
ALTER TABLE "failed_company_liquidity_transactions" ADD COLUMN     "amountOriginal" TEXT,
ADD COLUMN     "fromCurrency" TEXT,
ADD COLUMN     "toCurrency" TEXT,
ADD COLUMN     "transactionType" TEXT,
ALTER COLUMN "transactionId" SET NOT NULL;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "fromCurrency" TEXT,
ADD COLUMN     "toCurrency" TEXT;

-- CreateTable
CREATE TABLE "bill_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'xpresspay',
    "category" TEXT NOT NULL,
    "billerCode" TEXT NOT NULL,
    "customerReference" TEXT NOT NULL,
    "productCode" TEXT,
    "walletCurrency" TEXT NOT NULL,
    "amountBase" DECIMAL(78,0) NOT NULL,
    "amountOriginal" TEXT NOT NULL,
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerValidation" JSONB,
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_transactionId_key" ON "bill_payments"("transactionId");

-- CreateIndex
CREATE INDEX "bill_payments_userId_status_idx" ON "bill_payments"("userId", "status");

-- CreateIndex
CREATE INDEX "bill_payments_walletId_idx" ON "bill_payments"("walletId");

-- CreateIndex
CREATE INDEX "failed_company_liquidity_transactions_transactionType_idx" ON "failed_company_liquidity_transactions"("transactionType");

-- CreateIndex
CREATE INDEX "failed_company_liquidity_transactions_fromCurrency_idx" ON "failed_company_liquidity_transactions"("fromCurrency");

-- CreateIndex
CREATE INDEX "failed_company_liquidity_transactions_toCurrency_idx" ON "failed_company_liquidity_transactions"("toCurrency");

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failed_company_liquidity_transactions" ADD CONSTRAINT "failed_company_liquidity_transactions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
