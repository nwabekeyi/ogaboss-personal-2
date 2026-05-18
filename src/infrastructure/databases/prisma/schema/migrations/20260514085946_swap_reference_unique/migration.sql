/*
  Warnings:

  - You are about to drop the `auto_staking_settings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `auto_staking_transaction_fees` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[reference]` on the table `withdrawals` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AutoStackFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AutoStackStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterEnum
ALTER TYPE "TransactionContext" ADD VALUE 'VAULT_SWAP';

-- AlterEnum
ALTER TYPE "VaultStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "company_liquidity" ADD COLUMN     "totalAccruedLockedInterest" DECIMAL(78,0) NOT NULL DEFAULT 0,
ADD COLUMN     "totalAmountStacked" DECIMAL(78,0) NOT NULL DEFAULT 0,
ADD COLUMN     "totalInterestPaid" DECIMAL(78,0) NOT NULL DEFAULT 0,
ADD COLUMN     "totalLockedPrincipal" DECIMAL(78,0) NOT NULL DEFAULT 0,
ADD COLUMN     "totalStackedInterestPaid" DECIMAL(78,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vaults" ADD COLUMN     "bufferAmount" DECIMAL(78,0) NOT NULL DEFAULT 0,
ADD COLUMN     "bufferPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "stackedAmount" DECIMAL(78,0) NOT NULL DEFAULT 0,
ADD COLUMN     "totalStackedInterest" DECIMAL(78,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "withdrawals" ALTER COLUMN "providerWithdrawalId" DROP NOT NULL;

-- DropTable
DROP TABLE "auto_staking_settings";

-- DropTable
DROP TABLE "auto_staking_transaction_fees";

-- CreateTable
CREATE TABLE "auto_stacks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "frequency" "AutoStackFrequency" NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "dayOfWeek" TEXT,
    "dayOfMonth" INTEGER,
    "transactionFee" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "accruedInterest" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "status" "AutoStackStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastExecutedAt" TIMESTAMP(3),
    "nextExecutionAt" TIMESTAMP(3) NOT NULL,
    "nextInterestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_stacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_stacking_settings" (
    "id" TEXT NOT NULL,
    "dailyInterestRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_stacking_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_stacking_transaction_fees" (
    "id" TEXT NOT NULL,
    "fromAmount" DECIMAL(78,0) NOT NULL,
    "toAmount" DECIMAL(78,0) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "feeAmount" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "feeCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_stacking_transaction_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_job_states" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "lastExecutedAt" TIMESTAMP(3),
    "nextExecutionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_job_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auto_stacks_userId_status_idx" ON "auto_stacks"("userId", "status");

-- CreateIndex
CREATE INDEX "auto_stacks_nextExecutionAt_status_idx" ON "auto_stacks"("nextExecutionAt", "status");

-- CreateIndex
CREATE INDEX "auto_stacks_status_nextInterestAt_idx" ON "auto_stacks"("status", "nextInterestAt");

-- CreateIndex
CREATE INDEX "auto_stacking_transaction_fees_currency_idx" ON "auto_stacking_transaction_fees"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "auto_stacking_transaction_fees_currency_fromAmount_toAmount_key" ON "auto_stacking_transaction_fees"("currency", "fromAmount", "toAmount");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_job_states_jobName_key" ON "scheduler_job_states"("jobName");

-- CreateIndex
CREATE INDEX "scheduler_job_states_jobName_nextExecutionAt_idx" ON "scheduler_job_states"("jobName", "nextExecutionAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_reference_key" ON "withdrawals"("reference");

-- AddForeignKey
ALTER TABLE "auto_stacks" ADD CONSTRAINT "auto_stacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_stacks" ADD CONSTRAINT "auto_stacks_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "cryptocurrencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
