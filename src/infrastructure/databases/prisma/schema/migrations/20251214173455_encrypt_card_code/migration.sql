/*
  Warnings:

  - The values [NIN] on the enum `DocumentTypeInternal` will be removed. If these variants are still used in the database, this will fail.
  - Added the required column `authorizationIv` to the `payment_cards` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authorizationTag` to the `payment_cards` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "DocumentTypeInternal_new" AS ENUM ('INTERNATIONAL_PASSPORT', 'DRIVERS_LICENSE', 'VOTER_CARD', 'NATIONAL_IDENTITY_CARD');
ALTER TABLE "kyc_verifications" ALTER COLUMN "documentTypeInternal" TYPE "DocumentTypeInternal_new" USING ("documentTypeInternal"::text::"DocumentTypeInternal_new");
ALTER TYPE "DocumentTypeInternal" RENAME TO "DocumentTypeInternal_old";
ALTER TYPE "DocumentTypeInternal_new" RENAME TO "DocumentTypeInternal";
DROP TYPE "public"."DocumentTypeInternal_old";
COMMIT;

-- AlterTable
ALTER TABLE "payment_cards" ADD COLUMN     "authorizationIv" TEXT NOT NULL,
ADD COLUMN     "authorizationTag" TEXT NOT NULL;
