-- CreateTable
CREATE TABLE "company_withdrawals" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amountBase" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "providerResponse" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_withdrawals_transactionId_key" ON "company_withdrawals"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "company_withdrawals_providerReference_key" ON "company_withdrawals"("providerReference");

-- AddForeignKey
ALTER TABLE "company_withdrawals" ADD CONSTRAINT "company_withdrawals_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
