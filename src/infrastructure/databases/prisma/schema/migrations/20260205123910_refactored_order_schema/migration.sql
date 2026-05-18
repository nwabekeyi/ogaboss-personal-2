/*
  Warnings:

  - You are about to drop the column `email` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `fullName` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `nin` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `walletAddress` on the `orders` table. All the data in the column will be lost.
  - Added the required column `userId` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_currencyId_fkey";

-- DropIndex
DROP INDEX "orders_walletAddress_email_phoneNumber_status_idx";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "email",
DROP COLUMN "fullName",
DROP COLUMN "nin",
DROP COLUMN "phoneNumber",
DROP COLUMN "walletAddress",
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "currencyId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "cryptocurrencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
