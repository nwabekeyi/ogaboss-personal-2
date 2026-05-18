/*
  Warnings:

  - A unique constraint covering the columns `[transactionUniqueId]` on the table `transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "transactions_transactionUniqueId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transactionUniqueId_key" ON "transactions"("transactionUniqueId");
