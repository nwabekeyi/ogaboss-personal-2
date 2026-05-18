/*
  Warnings:

  - You are about to drop the column `cryptoAmount` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `fiatAmount` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `paymentAmount` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `executionPrice` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `fee` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `quotedCurrency` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `quotedPrice` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `receivedAmount` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `toAmount` on the `swaptransactions` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `nairaAmount` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `networkFee` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `platformFee` on the `transactions` table. All the data in the column will be lost.
  - Added the required column `cryptoAmountBase` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fiatAmountBase` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountBase` to the `swaptransactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountOriginal` to the `swaptransactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountBase` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nairaAmountBase` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "orders" DROP COLUMN "cryptoAmount",
DROP COLUMN "fiatAmount",
DROP COLUMN "paymentAmount",
ADD COLUMN     "cryptoAmountBase" BIGINT NOT NULL,
ADD COLUMN     "cryptoAmountOriginal" TEXT,
ADD COLUMN     "fiatAmountBase" BIGINT NOT NULL,
ADD COLUMN     "fiatAmountOriginal" TEXT,
ADD COLUMN     "paymentAmountBase" BIGINT,
ADD COLUMN     "paymentAmountOriginal" TEXT;

-- AlterTable
ALTER TABLE "swaptransactions" DROP COLUMN "amount",
DROP COLUMN "executionPrice",
DROP COLUMN "fee",
DROP COLUMN "quotedCurrency",
DROP COLUMN "quotedPrice",
DROP COLUMN "receivedAmount",
DROP COLUMN "toAmount",
ADD COLUMN     "amountBase" BIGINT NOT NULL,
ADD COLUMN     "amountOriginal" TEXT NOT NULL,
ADD COLUMN     "executionPriceBase" BIGINT,
ADD COLUMN     "executionPriceOriginal" TEXT,
ADD COLUMN     "feeBase" BIGINT,
ADD COLUMN     "feeOriginal" TEXT,
ADD COLUMN     "quotedPriceBase" BIGINT,
ADD COLUMN     "quotedPriceOriginal" TEXT,
ADD COLUMN     "receivedAmountBase" BIGINT,
ADD COLUMN     "receivedAmountOriginal" TEXT,
ADD COLUMN     "toAmountBase" BIGINT,
ADD COLUMN     "toAmountOriginal" TEXT;

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "amount",
DROP COLUMN "nairaAmount",
DROP COLUMN "networkFee",
DROP COLUMN "platformFee",
ADD COLUMN     "amountBase" BIGINT NOT NULL,
ADD COLUMN     "amountOriginal" TEXT,
ADD COLUMN     "nairaAmountBase" BIGINT NOT NULL,
ADD COLUMN     "nairaAmountOriginal" TEXT,
ADD COLUMN     "networkFeeBase" BIGINT,
ADD COLUMN     "networkFeeOriginal" TEXT,
ADD COLUMN     "platformFeeBase" BIGINT,
ADD COLUMN     "platformFeeOriginal" TEXT,
ADD COLUMN     "totalAmountSentOriginal" TEXT;
