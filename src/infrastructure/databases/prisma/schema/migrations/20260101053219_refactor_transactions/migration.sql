/*
  Warnings:

  - You are about to drop the column `amountBase` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `amountOriginal` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `nairaAmountBase` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `nairaAmountOriginal` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `totalAmountSent` on the `transactions` table. All the data in the column will be lost.
  - Added the required column `fiatAmountBase` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "amountBase",
DROP COLUMN "amountOriginal",
DROP COLUMN "nairaAmountBase",
DROP COLUMN "nairaAmountOriginal",
DROP COLUMN "totalAmountSent",
ADD COLUMN     "cryptoAmountBase" BIGINT,
ADD COLUMN     "cryptoAmountOriginal" TEXT,
ADD COLUMN     "fiatAmountBase" BIGINT NOT NULL,
ADD COLUMN     "fiatAmountOriginal" TEXT,
ADD COLUMN     "totalAmountSentBase" BIGINT;
