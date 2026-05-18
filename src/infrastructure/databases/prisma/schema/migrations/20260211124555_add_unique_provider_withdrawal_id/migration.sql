/*
  Warnings:

  - A unique constraint covering the columns `[providerWithdrawalId]` on the table `withdrawals` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_providerWithdrawalId_key" ON "withdrawals"("providerWithdrawalId");
