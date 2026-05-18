/*
  Warnings:

  - You are about to drop the column `isActive` on the `payment_addresses` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentAddressStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAILED', 'PROCESSING');

-- AlterTable
ALTER TABLE "payment_addresses" DROP COLUMN "isActive",
ADD COLUMN     "name" TEXT,
ADD COLUMN     "status" "PaymentAddressStatus" NOT NULL DEFAULT 'PROCESSING',
ALTER COLUMN "quidaxAddressId" DROP NOT NULL,
ALTER COLUMN "address" DROP NOT NULL;
