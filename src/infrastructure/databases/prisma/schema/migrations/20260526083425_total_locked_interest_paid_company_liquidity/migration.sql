-- AlterEnum
ALTER TYPE "TransactionContext" ADD VALUE 'AUTOSTACK';

-- AlterTable
ALTER TABLE "company_liquidity" ADD COLUMN     "totalLockedInterestPaid" DECIMAL(78,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "totalLockedInterest" DECIMAL(78,0) NOT NULL DEFAULT 0;
