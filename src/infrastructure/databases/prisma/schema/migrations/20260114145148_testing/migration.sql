/*
  Warnings:

  - You are about to drop the `WebhookIdempotencyKey` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_RolePermissions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_TransactionToWallet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `admins` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `crypto_rates` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cryptocurrencies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `fiatcurrencies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `generals` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `kyc_verifications` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `orders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `payment_addresses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `payment_cards` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `permissions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `roles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `swaptransactions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `temp_stores` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tokens` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `transactions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `userbankaccounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `wallets` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_RolePermissions" DROP CONSTRAINT "_RolePermissions_A_fkey";

-- DropForeignKey
ALTER TABLE "_RolePermissions" DROP CONSTRAINT "_RolePermissions_B_fkey";

-- DropForeignKey
ALTER TABLE "_TransactionToWallet" DROP CONSTRAINT "_TransactionToWallet_A_fkey";

-- DropForeignKey
ALTER TABLE "_TransactionToWallet" DROP CONSTRAINT "_TransactionToWallet_B_fkey";

-- DropForeignKey
ALTER TABLE "admins" DROP CONSTRAINT "admins_internalRoleId_fkey";

-- DropForeignKey
ALTER TABLE "crypto_rates" DROP CONSTRAINT "crypto_rates_cryptoId_fkey";

-- DropForeignKey
ALTER TABLE "crypto_rates" DROP CONSTRAINT "crypto_rates_fiatId_fkey";

-- DropForeignKey
ALTER TABLE "kyc_verifications" DROP CONSTRAINT "kyc_verifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_currencyId_fkey";

-- DropForeignKey
ALTER TABLE "payment_addresses" DROP CONSTRAINT "payment_addresses_walletId_fkey";

-- DropForeignKey
ALTER TABLE "payment_cards" DROP CONSTRAINT "payment_cards_userId_fkey";

-- DropForeignKey
ALTER TABLE "tokens" DROP CONSTRAINT "tokens_adminId_fkey";

-- DropForeignKey
ALTER TABLE "tokens" DROP CONSTRAINT "tokens_userId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_userId_fkey";

-- DropForeignKey
ALTER TABLE "userbankaccounts" DROP CONSTRAINT "userbankaccounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_userId_fkey";

-- DropTable
DROP TABLE "WebhookIdempotencyKey";

-- DropTable
DROP TABLE "_RolePermissions";

-- DropTable
DROP TABLE "_TransactionToWallet";

-- DropTable
DROP TABLE "accounts";

-- DropTable
DROP TABLE "admins";

-- DropTable
DROP TABLE "crypto_rates";

-- DropTable
DROP TABLE "cryptocurrencies";

-- DropTable
DROP TABLE "fiatcurrencies";

-- DropTable
DROP TABLE "generals";

-- DropTable
DROP TABLE "kyc_verifications";

-- DropTable
DROP TABLE "orders";

-- DropTable
DROP TABLE "payment_addresses";

-- DropTable
DROP TABLE "payment_cards";

-- DropTable
DROP TABLE "permissions";

-- DropTable
DROP TABLE "roles";

-- DropTable
DROP TABLE "swaptransactions";

-- DropTable
DROP TABLE "temp_stores";

-- DropTable
DROP TABLE "tokens";

-- DropTable
DROP TABLE "transactions";

-- DropTable
DROP TABLE "userbankaccounts";

-- DropTable
DROP TABLE "users";

-- DropTable
DROP TABLE "wallets";

-- DropEnum
DROP TYPE "AccountSignType";

-- DropEnum
DROP TYPE "AccountStatus";

-- DropEnum
DROP TYPE "AccountTier";

-- DropEnum
DROP TYPE "AddressVerificationStatus";

-- DropEnum
DROP TYPE "AdminRole";

-- DropEnum
DROP TYPE "Currency";

-- DropEnum
DROP TYPE "DocumentTypeInternal";

-- DropEnum
DROP TYPE "Gender";

-- DropEnum
DROP TYPE "KycDocument";

-- DropEnum
DROP TYPE "ModelNames";

-- DropEnum
DROP TYPE "OrderStatus";

-- DropEnum
DROP TYPE "OrderType";

-- DropEnum
DROP TYPE "PaymentAddressStatus";

-- DropEnum
DROP TYPE "PaymentStatus";

-- DropEnum
DROP TYPE "PaymentType";

-- DropEnum
DROP TYPE "Permission";

-- DropEnum
DROP TYPE "Status";

-- DropEnum
DROP TYPE "TokenType";

-- DropEnum
DROP TYPE "TransactionContext";

-- DropEnum
DROP TYPE "TransactionProcess";

-- DropEnum
DROP TYPE "TransactionStatus";

-- DropEnum
DROP TYPE "TransactionType";

-- DropEnum
DROP TYPE "UserRole";

-- DropEnum
DROP TYPE "UserType";

-- DropEnum
DROP TYPE "VerificationStatus";
