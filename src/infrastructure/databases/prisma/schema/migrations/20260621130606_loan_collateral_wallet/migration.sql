-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "loanCollateralAmount" DECIMAL(78,0) NOT NULL DEFAULT 0;

-- CreateEnum
DO $$ BEGIN
 CREATE TYPE "UrgentLiquidityLoanStatus" AS ENUM ('PENDING', 'QUIDAX_COMPLETED', 'PAYSTACK_COMPLETED', 'DISBURSED', 'FAILED', 'REPAID', 'DEADLINE_EXCEEDED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "urgent_liquidity_loans" ALTER COLUMN "status" TYPE "UrgentLiquidityLoanStatus" USING "status"::text::"UrgentLiquidityLoanStatus";
