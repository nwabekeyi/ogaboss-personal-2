/*
  Warnings:

  - You are about to alter the column `buyRate` on the `Rate` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(5,2)`.
  - You are about to alter the column `sellRate` on the `Rate` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(5,2)`.
  - You are about to alter the column `sellRate` on the `cryptocurrencies` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - You are about to alter the column `buyRate` on the `cryptocurrencies` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - You are about to alter the column `cryptoAmount` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `fiatAmount` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `paymentAmount` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `amount` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `platformFee` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `networkFee` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `totalAmountSent` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `nairaAmount` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.
  - You are about to alter the column `balance` on the `wallets` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `BigInt`.

*/
-- AlterTable
ALTER TABLE "Rate" ALTER COLUMN "buyRate" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "sellRate" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "cryptocurrencies" ALTER COLUMN "sellRate" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "buyRate" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "cryptoAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "fiatAmount" SET DATA TYPE BIGINT,
ALTER COLUMN "paymentAmount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "amount" SET DATA TYPE BIGINT,
ALTER COLUMN "platformFee" SET DATA TYPE BIGINT,
ALTER COLUMN "networkFee" SET DATA TYPE BIGINT,
ALTER COLUMN "totalAmountSent" SET DATA TYPE BIGINT,
ALTER COLUMN "nairaAmount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "wallets" ALTER COLUMN "balance" SET DEFAULT 0,
ALTER COLUMN "balance" SET DATA TYPE BIGINT;
