/*
  Warnings:

  - You are about to drop the column `verificationStatus` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "verificationStatus",
ADD COLUMN     "kycVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED';
