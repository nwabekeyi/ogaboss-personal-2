-- CreateEnum
CREATE TYPE "VaultStatus" AS ENUM ('ACTIVE', 'MATURED', 'TERMINATED');

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "currencyId" TEXT,
ADD COLUMN     "lockedAmount" DECIMAL(78,0) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "auto_staking_settings" (
    "id" TEXT NOT NULL,
    "dailyInterestRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_staking_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_staking_transaction_fees" (
    "id" TEXT NOT NULL,
    "fromAmount" DECIMAL(78,0) NOT NULL,
    "toAmount" DECIMAL(78,0) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "feeAmount" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "feeCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_staking_transaction_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_currency_rates" (
    "id" TEXT NOT NULL,
    "cryptoCurrencyId" TEXT NOT NULL,
    "dailyRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lockedFundsRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_currency_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urgent_liquidity_settings" (
    "id" TEXT NOT NULL,
    "maxLoanRequest" DECIMAL(78,0) NOT NULL DEFAULT 100000,
    "loanFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "settlementPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "collateralPercent" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "liquidationDeadlineDays" INTEGER NOT NULL DEFAULT 7,
    "liquidationFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "urgent_liquidity_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repayment_ranges" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "fromAmount" DECIMAL(78,0) NOT NULL,
    "toAmount" DECIMAL(78,0) NOT NULL,
    "repaymentDurationDays" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repayment_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "quoteId" TEXT,
    "amountLocked" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "totalGain" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "interestRatePerAnum" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "transactionFee" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "rate" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "amountToReceive" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "VaultStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auto_staking_transaction_fees_currency_idx" ON "auto_staking_transaction_fees"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "auto_staking_transaction_fees_currency_fromAmount_toAmount_key" ON "auto_staking_transaction_fees"("currency", "fromAmount", "toAmount");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_currency_rates_cryptoCurrencyId_key" ON "crypto_currency_rates"("cryptoCurrencyId");

-- CreateIndex
CREATE INDEX "crypto_currency_rates_cryptoCurrencyId_idx" ON "crypto_currency_rates"("cryptoCurrencyId");

-- CreateIndex
CREATE INDEX "repayment_ranges_settingsId_idx" ON "repayment_ranges"("settingsId");

-- CreateIndex
CREATE INDEX "repayment_ranges_currency_idx" ON "repayment_ranges"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_ranges_settingsId_currency_fromAmount_toAmount_key" ON "repayment_ranges"("settingsId", "currency", "fromAmount", "toAmount");

-- CreateIndex
CREATE UNIQUE INDEX "vaults_quoteId_key" ON "vaults"("quoteId");

-- CreateIndex
CREATE INDEX "vaults_userId_idx" ON "vaults"("userId");

-- CreateIndex
CREATE INDEX "vaults_currencyId_idx" ON "vaults"("currencyId");

-- CreateIndex
CREATE INDEX "vaults_status_idx" ON "vaults"("status");

-- CreateIndex
CREATE INDEX "vaults_quoteId_idx" ON "vaults"("quoteId");

-- AddForeignKey
ALTER TABLE "crypto_currency_rates" ADD CONSTRAINT "crypto_currency_rates_cryptocurrencyid_fkey" FOREIGN KEY ("cryptoCurrencyId") REFERENCES "cryptocurrencies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "repayment_ranges" ADD CONSTRAINT "repayment_range_settings_fkey" FOREIGN KEY ("settingsId") REFERENCES "urgent_liquidity_settings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "cryptocurrencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "cryptocurrencies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
