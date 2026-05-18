/*
  Warnings:

  - You are about to drop the column `verificationSelfie` on the `kyc_verifications` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('pending', 'processed', 'failed');

-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "failedReason" TEXT,
ADD COLUMN     "isProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isResolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolutionComment" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "status" "WebhookStatus" NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "buffer_tiers" ALTER COLUMN "minAmount" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "maxAmount" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "company_liquidity" ALTER COLUMN "totalBalance" SET DEFAULT 0,
ALTER COLUMN "totalBalance" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "reservedBalance" SET DEFAULT 0,
ALTER COLUMN "reservedBalance" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "company_withdrawals" ALTER COLUMN "amountBase" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "failed_company_liquidity_transactions" ALTER COLUMN "amountBase" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "fiatcurrencies" ALTER COLUMN "usdRate" SET DEFAULT '0',
ALTER COLUMN "usdRate" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "kyc_verifications" DROP COLUMN "verificationSelfie",
ADD COLUMN     "verificationSelfine" TEXT,
ALTER COLUMN "bvn" SET DATA TYPE TEXT,
ALTER COLUMN "nin" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "cryptoAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "fiatAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "paymentAmountBase" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "payment_addresses" ALTER COLUMN "totalPayments" SET DEFAULT 0,
ALTER COLUMN "totalPayments" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "cryptoAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "fiatAmountBase" SET DEFAULT 0,
ALTER COLUMN "fiatAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "platformFeeBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "networkFeeBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "totalAmountSentBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "bufferAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "executedCryptoAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "executedFiatAmountBase" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "executionPrice" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "amountSent" SET DEFAULT 0,
ALTER COLUMN "amountSent" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "amountReceived" SET DEFAULT 0,
ALTER COLUMN "amountReceived" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "amountBought" SET DEFAULT 0,
ALTER COLUMN "amountBought" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "amountSold" SET DEFAULT 0,
ALTER COLUMN "amountSold" SET DATA TYPE DECIMAL(78,0);

-- AlterTable
ALTER TABLE "wallets" ALTER COLUMN "baseBalance" SET DEFAULT 0,
ALTER COLUMN "baseBalance" SET DATA TYPE DECIMAL(78,0),
ALTER COLUMN "originalBalance" SET DEFAULT '0',
ALTER COLUMN "originalBalance" SET DATA TYPE TEXT,
ALTER COLUMN "reservedBalance" SET DEFAULT 0,
ALTER COLUMN "reservedBalance" SET DATA TYPE DECIMAL(78,0);

-- CreateIndex
CREATE INDEX "Webhook_isProcessed_createdAt_idx" ON "Webhook"("isProcessed", "createdAt");

-- CreateIndex
CREATE INDEX "Webhook_status_idx" ON "Webhook"("status");

-- CreateIndex
CREATE INDEX "Webhook_status_isResolved_idx" ON "Webhook"("status", "isResolved");
