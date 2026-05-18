/*
  Warnings:

  - A unique constraint covering the columns `[userId,type]` on the table `tokens` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[adminId,type]` on the table `tokens` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "tokens_userId_type_key" ON "tokens"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_adminId_type_key" ON "tokens"("adminId", "type");
