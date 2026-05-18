/*
  Warnings:

  - You are about to drop the column `isDeleted` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[nin]` on the table `kyc_verifications` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "isDeleted";

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verifications_nin_key" ON "kyc_verifications"("nin");
