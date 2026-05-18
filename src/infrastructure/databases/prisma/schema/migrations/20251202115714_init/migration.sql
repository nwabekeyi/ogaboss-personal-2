-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INDIVIDUAL', 'CORPORATE', 'ADMIN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_VERIFIED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AddressVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentTypeInternal" AS ENUM ('INTERNATIONAL_PASSPORT', 'DRIVERS_LICENSE', 'NIN', 'VOTER_CARD', 'NATIONAL_IDENTITY_CARD');

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
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CARD', 'BANK_TRANSFER', 'PAYSTACK', 'CRYPTO_WALLET');

-- CreateEnum
CREATE TYPE "TransactionContext" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'BUY', 'SELL');

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
CREATE TABLE "bankaccounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bankaccounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "userGroup" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "status" "Status" NOT NULL DEFAULT 'PENDING',
    "avatar" TEXT DEFAULT 'https://ik.imagekit.io/o59kpgo8iz/Backbone/user%20images/default_user.jpg?updatedAt=1718689050953',
    "avatarPublicId" TEXT,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "isNewUser" BOOLEAN NOT NULL DEFAULT true,
    "isDeactivatedAccount" BOOLEAN NOT NULL DEFAULT false,
    "residentialAddress" TEXT,
    "country" TEXT,
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
    "sellRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cryptocurrencies_pkey" PRIMARY KEY ("id")
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
    "hasVerifiedDocument" BOOLEAN NOT NULL DEFAULT false,
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
    "cryptoAmount" DOUBLE PRECISION NOT NULL,
    "fiatAmount" DOUBLE PRECISION NOT NULL,
    "fiatCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "type" "OrderType" NOT NULL DEFAULT 'BUY',
    "referenceNo" TEXT,
    "nin" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paymentChannel" TEXT,
    "paymentAmount" DOUBLE PRECISION,
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
    "quidaxAddressId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT,
    "destinationTag" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totalPayments" INTEGER NOT NULL DEFAULT 0,
    "depositCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rate" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "buyRate" DOUBLE PRECISION NOT NULL,
    "sellRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swaptransactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quidaxAccountId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "quotedPrice" DOUBLE PRECISION,
    "quotedCurrency" TEXT,
    "executionPrice" DOUBLE PRECISION,
    "toAmount" DOUBLE PRECISION,
    "receivedAmount" DOUBLE PRECISION,
    "fee" DOUBLE PRECISION,
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
    "network" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "platformFee" DOUBLE PRECISION,
    "networkFee" DOUBLE PRECISION,
    "totalAmountSent" DOUBLE PRECISION NOT NULL,
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
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "quidaxWalletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isCrypto" BOOLEAN NOT NULL,
    "blockchainEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultNetwork" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TransactionToWallet" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TransactionToWallet_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "bankaccounts_userId_idx" ON "bankaccounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "userbankaccounts_userId_idx" ON "userbankaccounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cryptocurrencies_symbol_key" ON "cryptocurrencies"("symbol");

-- CreateIndex
CREATE INDEX "cryptocurrencies_symbol_idx" ON "cryptocurrencies"("symbol");

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
CREATE UNIQUE INDEX "Rate_currency_key" ON "Rate"("currency");

-- CreateIndex
CREATE INDEX "Rate_buyRate_idx" ON "Rate"("buyRate");

-- CreateIndex
CREATE INDEX "Rate_sellRate_idx" ON "Rate"("sellRate");

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
CREATE INDEX "wallets_userId_balance_desc_idx" ON "wallets"("userId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_currency_key" ON "wallets"("userId", "currency");

-- CreateIndex
CREATE INDEX "_TransactionToWallet_B_index" ON "_TransactionToWallet"("B");

-- AddForeignKey
ALTER TABLE "bankaccounts" ADD CONSTRAINT "bankaccounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "userbankaccounts" ADD CONSTRAINT "userbankaccounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "cryptocurrencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_addresses" ADD CONSTRAINT "payment_addresses_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TransactionToWallet" ADD CONSTRAINT "_TransactionToWallet_A_fkey" FOREIGN KEY ("A") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TransactionToWallet" ADD CONSTRAINT "_TransactionToWallet_B_fkey" FOREIGN KEY ("B") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
