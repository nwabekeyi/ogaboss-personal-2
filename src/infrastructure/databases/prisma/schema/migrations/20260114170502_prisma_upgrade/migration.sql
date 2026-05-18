-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INDIVIDUAL', 'CORPORATE', 'ADMIN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "PaymentAddressStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAILED', 'PROCESSING');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('DOWNLOAD_TRANSACTION_HISTORY', 'FLAG_USER', 'EDIT_PERMISSION', 'ACCESS_TRANSACTION_HISTORY', 'ADD_USER', 'USER_ACCOUNT_ACCESS', 'EDIT_USER_ACCOUNT');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_VERIFIED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AddressVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentTypeInternal" AS ENUM ('INTERNATIONAL_PASSPORT', 'DRIVERS_LICENSE', 'VOTER_CARD', 'NATIONAL_IDENTITY_CARD', 'NIN');

-- CreateEnum
CREATE TYPE "KycDocument" AS ENUM ('BVN', 'NIN', 'PASSPORT');

-- CreateEnum
CREATE TYPE "AccountTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'FLAGGED', 'PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('REFRESH', 'ACCESS', 'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'PASSWORD_CHANGE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'PENDING', 'FAILED', 'SUCCESS', 'CONFIRM');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'CARD_VERIFICATION_DEBIT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CARD', 'BANK_TRANSFER', 'PAYSTACK', 'CRYPTO_WALLET');

-- CreateEnum
CREATE TYPE "TransactionContext" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'BUY', 'SELL', 'CARD_VERIFICATION', 'CARD_REFUND');

-- CreateEnum
CREATE TYPE "TransactionProcess" AS ENUM ('PROCESSING');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'PROCESSING');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ModelNames" AS ENUM ('GENERAL', 'USER', 'TOKEN', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountSignType" AS ENUM ('GOOGLE', 'FACEBOOK', 'DIRECT');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BANNED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('NGN', 'USD');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT 'admin',
    "firstName" TEXT NOT NULL DEFAULT 'admin',
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "gender" "Gender",
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "internalRoleId" TEXT,
    "avatar" TEXT DEFAULT 'https://ik.imagekit.io/o59kpgo8iz/Backbone/user%20images/default_user.jpg?updatedAt=1718689050953',
    "avatarPublicId" TEXT,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "residentialAddress" TEXT,
    "country" TEXT,
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "userbankaccounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountName" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "userbankaccounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cryptocurrencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cryptocurrencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_rates" (
    "id" TEXT NOT NULL,
    "cryptoSymbol" TEXT NOT NULL,
    "buyRateBase" BIGINT NOT NULL,
    "sellRateBase" BIGINT NOT NULL,
    "originalBuyRate" TEXT NOT NULL,
    "originalSellRate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fiatId" TEXT NOT NULL,
    "cryptoId" TEXT NOT NULL,

    CONSTRAINT "crypto_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiatcurrencies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "rateToUSD" BIGINT NOT NULL DEFAULT 0,
    "decimals" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiatcurrencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generals" (
    "id" TEXT NOT NULL,
    "tableName" "ModelNames" NOT NULL,
    "tableID" TEXT NOT NULL,
    "associatedData" JSONB,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "signType" "AccountSignType" NOT NULL,
    "status" "AccountStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bvn" BIGINT,
    "verificationSelfie" TEXT,
    "hasVerifiedBvn" BOOLEAN NOT NULL DEFAULT false,
    "nin" BIGINT,
    "hasVerifiedNin" BOOLEAN NOT NULL DEFAULT false,
    "hasVerifiedLivenessCheck" BOOLEAN NOT NULL DEFAULT false,
    "hasVerifiedAddress" BOOLEAN NOT NULL DEFAULT false,
    "addressVerificationStatus" "AddressVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "addressVerificationRef" TEXT,
    "hasUpdatedNextOfKin" BOOLEAN NOT NULL DEFAULT false,
    "ninFirstName" TEXT,
    "ninLastName" TEXT,
    "ninPhoneNumber" TEXT,
    "ninDateOfBirth" TIMESTAMP(3),
    "ninImageUrl" TEXT,
    "bvnFirstName" TEXT,
    "bvnLastName" TEXT,
    "bvnPhoneNumber" TEXT,
    "bvnDateOfBirth" TIMESTAMP(3),
    "bvnImageUrl" TEXT,
    "nextOfKinFullName" TEXT,
    "nextOfKinRelationship" TEXT,
    "nextOfKinPhoneNumber" TEXT,
    "nextOfKinGender" "Gender",
    "nextOfKinDob" TEXT,
    "nextOfKinResidentialAddress" TEXT,
    "countryOfResidence" TEXT,
    "zipCode" TEXT,
    "streetName" TEXT,
    "streetNumber" TEXT,
    "state" TEXT,
    "city" TEXT,
    "lga" TEXT,
    "landmark" TEXT,
    "documentTypeInternal" "DocumentTypeInternal",
    "documentType" TEXT,
    "documentNumber" TEXT,
    "documentIssuedCountryCode" TEXT,
    "documentIssuedby" TEXT,
    "documentIssueDate" TIMESTAMP(3),
    "documentExpirationDate" TIMESTAMP(3),
    "documentFrontPageUrl" TEXT,
    "documentBackPageUrl" TEXT,
    "sourceOfIncome" TEXT,
    "occupation" TEXT,
    "incomeBand" TEXT,
    "employmentStatus" TEXT,
    "accountDesignation" TEXT,
    "taxCountry" TEXT,
    "taxnumber" TEXT,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedat" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "cryptoAmountBase" BIGINT NOT NULL,
    "cryptoAmountOriginal" TEXT,
    "fiatAmountBase" BIGINT NOT NULL,
    "fiatAmountOriginal" TEXT,
    "fiatCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "type" "OrderType" NOT NULL DEFAULT 'BUY',
    "referenceNo" TEXT,
    "nin" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paymentChannel" TEXT,
    "paymentAmountBase" BIGINT,
    "paymentAmountOriginal" TEXT,
    "paymentDate" TIMESTAMP(3),
    "gatewayResponse" TEXT,
    "currencyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_addresses" (
    "id" TEXT NOT NULL,
    "quidaxAddressId" TEXT,
    "walletId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "address" TEXT,
    "name" TEXT,
    "network" TEXT,
    "destinationTag" TEXT,
    "status" "PaymentAddressStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalPayments" BIGINT NOT NULL DEFAULT 0,
    "depositCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorizationCode" TEXT NOT NULL,
    "authorizationIv" TEXT NOT NULL,
    "authorizationTag" TEXT NOT NULL,
    "cardType" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "reusable" BOOLEAN,
    "bank" TEXT,
    "channel" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swaptransactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quidaxAccountId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "amountBase" BIGINT NOT NULL,
    "quotedPriceBase" BIGINT,
    "executionPriceBase" BIGINT,
    "toAmountBase" BIGINT,
    "receivedAmountBase" BIGINT,
    "feeBase" BIGINT,
    "amountOriginal" TEXT NOT NULL,
    "quotedPriceOriginal" TEXT,
    "executionPriceOriginal" TEXT,
    "toAmountOriginal" TEXT,
    "receivedAmountOriginal" TEXT,
    "feeOriginal" TEXT,
    "quoteId" TEXT,
    "confirmed" BOOLEAN DEFAULT false,
    "swapId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swaptransactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_stores" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "expirationTime" INTEGER,
    "beginTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temp_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "userType" "UserType" NOT NULL,
    "userId" TEXT,
    "adminId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiverWalletAddress" TEXT,
    "receiverWalletId" TEXT,
    "senderWalletAddress" TEXT,
    "senderWalletId" TEXT,
    "paymentType" "PaymentType",
    "paymentMetadata" JSONB,
    "platformWalletAddress" TEXT,
    "transactionUniqueId" TEXT NOT NULL,
    "network" TEXT,
    "currency" TEXT NOT NULL,
    "cryptoAmountBase" BIGINT,
    "fiatAmountBase" BIGINT NOT NULL,
    "description" TEXT,
    "platformFeeBase" BIGINT,
    "networkFeeBase" BIGINT,
    "totalAmountSentBase" BIGINT,
    "cryptoAmountOriginal" TEXT,
    "fiatAmountOriginal" TEXT,
    "platformFeeOriginal" TEXT,
    "networkFeeOriginal" TEXT,
    "totalAmountSentOriginal" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "transactionType" "TransactionType" NOT NULL,
    "transactionContext" "TransactionContext" NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "userType" "UserType" NOT NULL DEFAULT 'INDIVIDUAL',
    "pin" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "kycVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "avatar" TEXT DEFAULT 'https://ik.imagekit.io/o59kpgo8iz/Backbone/user%20images/default_user.jpg?updatedAt=1718689050953',
    "country" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "phoneNumber" TEXT,
    "residentialAddress" TEXT,
    "quidaxAccountId" TEXT,
    "quidaxSnId" TEXT,
    "tier" "AccountTier" DEFAULT 'TIER_1',
    "isTwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "loginWithPin" BOOLEAN NOT NULL DEFAULT true,
    "loginWithBiometric" BOOLEAN NOT NULL DEFAULT false,
    "hideAccountOnLogin" BOOLEAN NOT NULL DEFAULT false,
    "displayCurrency" "Currency" NOT NULL DEFAULT 'NGN',
    "accountActivityAlert" BOOLEAN NOT NULL DEFAULT false,
    "transactionAlert" BOOLEAN NOT NULL DEFAULT false,
    "appUpdates" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceAlert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "status" "Status" DEFAULT 'PENDING',
    "flaggedReason" TEXT,
    "refreshToken" TEXT,
    "amountSent" BIGINT NOT NULL DEFAULT 0,
    "amountReceived" BIGINT NOT NULL DEFAULT 0,
    "amountBought" BIGINT NOT NULL DEFAULT 0,
    "amountSold" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "quidaxWalletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "baseBalance" BIGINT NOT NULL DEFAULT 0,
    "originalBalance" TEXT NOT NULL,
    "isCrypto" BOOLEAN NOT NULL,
    "blockchainEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultNetwork" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookIdempotencyKey" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RolePermissions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RolePermissions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TransactionToWallet" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TransactionToWallet_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_title_key" ON "roles"("title");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "userbankaccounts_userId_idx" ON "userbankaccounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cryptocurrencies_symbol_key" ON "cryptocurrencies"("symbol");

-- CreateIndex
CREATE INDEX "cryptocurrencies_symbol_idx" ON "cryptocurrencies"("symbol");

-- CreateIndex
CREATE INDEX "crypto_rates_fiatId_idx" ON "crypto_rates"("fiatId");

-- CreateIndex
CREATE INDEX "crypto_rates_cryptoId_idx" ON "crypto_rates"("cryptoId");

-- CreateIndex
CREATE INDEX "crypto_rates_cryptoSymbol_idx" ON "crypto_rates"("cryptoSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_rates_fiatId_cryptoId_key" ON "crypto_rates"("fiatId", "cryptoId");

-- CreateIndex
CREATE UNIQUE INDEX "fiatcurrencies_code_key" ON "fiatcurrencies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verifications_user_id_key" ON "kyc_verifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_transactionId_key" ON "orders"("transactionId");

-- CreateIndex
CREATE INDEX "orders_walletAddress_email_phoneNumber_status_idx" ON "orders"("walletAddress", "email", "phoneNumber", "status");

-- CreateIndex
CREATE INDEX "orders_transactionId_idx" ON "orders"("transactionId");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_currencyId_idx" ON "orders"("currencyId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_addresses_quidaxAddressId_key" ON "payment_addresses"("quidaxAddressId");

-- CreateIndex
CREATE INDEX "payment_addresses_currency_idx" ON "payment_addresses"("currency");

-- CreateIndex
CREATE INDEX "payment_addresses_network_idx" ON "payment_addresses"("network");

-- CreateIndex
CREATE INDEX "payment_addresses_quidaxAddressId_idx" ON "payment_addresses"("quidaxAddressId");

-- CreateIndex
CREATE INDEX "payment_addresses_address_idx" ON "payment_addresses"("address");

-- CreateIndex
CREATE UNIQUE INDEX "payment_addresses_walletId_currency_network_key" ON "payment_addresses"("walletId", "currency", "network");

-- CreateIndex
CREATE INDEX "payment_cards_userId_idx" ON "payment_cards"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "swaptransactions_userId_idx" ON "swaptransactions"("userId");

-- CreateIndex
CREATE INDEX "swaptransactions_quidaxAccountId_idx" ON "swaptransactions"("quidaxAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "temp_stores_key_key" ON "temp_stores"("key");

-- CreateIndex
CREATE INDEX "temp_stores_key_idx" ON "temp_stores"("key");

-- CreateIndex
CREATE INDEX "temp_stores_value_idx" ON "temp_stores"("value");

-- CreateIndex
CREATE INDEX "temp_stores_expirationTime_idx" ON "temp_stores"("expirationTime");

-- CreateIndex
CREATE INDEX "temp_stores_beginTime_idx" ON "temp_stores"("beginTime");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_token_key" ON "tokens"("token");

-- CreateIndex
CREATE INDEX "tokens_adminId_idx" ON "tokens"("adminId");

-- CreateIndex
CREATE INDEX "tokens_userId_idx" ON "tokens"("userId");

-- CreateIndex
CREATE INDEX "tokens_type_idx" ON "tokens"("type");

-- CreateIndex
CREATE INDEX "tokens_expiresAt_idx" ON "tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "transactions_senderWalletAddress_idx" ON "transactions"("senderWalletAddress");

-- CreateIndex
CREATE INDEX "transactions_receiverWalletAddress_idx" ON "transactions"("receiverWalletAddress");

-- CreateIndex
CREATE INDEX "transactions_platformWalletAddress_idx" ON "transactions"("platformWalletAddress");

-- CreateIndex
CREATE INDEX "transactions_userId_idx" ON "transactions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_quidaxAccountId_key" ON "users"("quidaxAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "users_quidaxSnId_key" ON "users"("quidaxSnId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_quidaxAccountId_idx" ON "users"("quidaxAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_quidaxWalletId_key" ON "wallets"("quidaxWalletId");

-- CreateIndex
CREATE INDEX "wallets_quidaxWalletId_idx" ON "wallets"("quidaxWalletId");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallets_userId_currency_idx" ON "wallets"("userId", "currency");

-- CreateIndex
CREATE INDEX "wallets_userId_balance_desc_idx" ON "wallets"("userId", "originalBalance");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_currency_key" ON "wallets"("userId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookIdempotencyKey_idempotencyKey_key" ON "WebhookIdempotencyKey"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WebhookIdempotencyKey_provider_eventType_idx" ON "WebhookIdempotencyKey"("provider", "eventType");

-- CreateIndex
CREATE INDEX "_RolePermissions_B_index" ON "_RolePermissions"("B");

-- CreateIndex
CREATE INDEX "_TransactionToWallet_B_index" ON "_TransactionToWallet"("B");

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_internalRoleId_fkey" FOREIGN KEY ("internalRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "userbankaccounts" ADD CONSTRAINT "userbankaccounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_rates" ADD CONSTRAINT "crypto_rates_fiatId_fkey" FOREIGN KEY ("fiatId") REFERENCES "fiatcurrencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_rates" ADD CONSTRAINT "crypto_rates_cryptoId_fkey" FOREIGN KEY ("cryptoId") REFERENCES "cryptocurrencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "cryptocurrencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_addresses" ADD CONSTRAINT "payment_addresses_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cards" ADD CONSTRAINT "payment_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_A_fkey" FOREIGN KEY ("A") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_B_fkey" FOREIGN KEY ("B") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TransactionToWallet" ADD CONSTRAINT "_TransactionToWallet_A_fkey" FOREIGN KEY ("A") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TransactionToWallet" ADD CONSTRAINT "_TransactionToWallet_B_fkey" FOREIGN KEY ("B") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
