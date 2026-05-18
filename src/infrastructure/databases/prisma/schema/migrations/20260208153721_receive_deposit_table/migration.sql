-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CREDITED', 'FAILED');

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerDepositId" TEXT NOT NULL,
    "txHash" TEXT,
    "currency" TEXT NOT NULL,
    "network" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "fee" DECIMAL(65,30),
    "depositAddress" TEXT,
    "destinationTag" TEXT,
    "confirmations" INTEGER,
    "requiredConfirmations" INTEGER,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deposits_providerDepositId_key" ON "deposits"("providerDepositId");

-- CreateIndex
CREATE INDEX "deposits_userId_currency_idx" ON "deposits"("userId", "currency");

-- CreateIndex
CREATE INDEX "deposits_providerDepositId_idx" ON "deposits"("providerDepositId");

-- CreateIndex
CREATE INDEX "deposits_depositAddress_idx" ON "deposits"("depositAddress");

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
