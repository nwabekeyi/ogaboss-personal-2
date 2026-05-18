-- CreateTable
CREATE TABLE "user_daily_percentages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percentChangeYesterday" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "previousTotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "netChange" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_daily_percentages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_daily_percentages_userId_idx" ON "user_daily_percentages"("userId");

-- CreateIndex
CREATE INDEX "user_daily_percentages_calculatedAt_idx" ON "user_daily_percentages"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_daily_percentages_userId_calculatedAt_key" ON "user_daily_percentages"("userId", "calculatedAt");

-- CreateIndex
CREATE INDEX "transactions_createdAt_status_idx" ON "transactions"("createdAt", "status");

-- CreateIndex
CREATE INDEX "transactions_userId_status_idx" ON "transactions"("userId", "status");
