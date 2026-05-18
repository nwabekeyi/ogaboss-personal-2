/*
  Warnings:

  - You are about to drop the column `hasVerifiedDocument` on the `kyc_verifications` table. All the data in the column will be lost.
  - You are about to drop the column `isVerified` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "kyc_verifications" DROP COLUMN "hasVerifiedDocument";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "isVerified",
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED';
