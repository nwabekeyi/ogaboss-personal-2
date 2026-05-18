-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerWithdrawalId" TEXT NOT NULL,
    "reference" TEXT,
    "txHash" TEXT,
    "currency" TEXT NOT NULL,
    "network" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "fee" DECIMAL(65,30),
    "total" DECIMAL(65,30),
    "recipientType" TEXT,
    "recipientAddress" TEXT,
    "destinationTag" TEXT,
    "recipientUserId" TEXT,
    "narration" TEXT,
    "transactionNote" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAtProvider" TIMESTAMP(3) NOT NULL,
    "completedAtProvider" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "withdrawals_userId_currency_idx" ON "withdrawals"("userId", "currency");

-- CreateIndex
CREATE INDEX "withdrawals_providerWithdrawalId_idx" ON "withdrawals"("providerWithdrawalId");

-- CreateIndex
CREATE INDEX "withdrawals_txHash_idx" ON "withdrawals"("txHash");

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
