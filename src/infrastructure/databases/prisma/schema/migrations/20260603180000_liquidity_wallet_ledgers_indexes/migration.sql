-- Ledger tables for auditable liquidity and wallet aggregate changes.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "company_liquidity_movements" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "currency" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "transactionId" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "idempotencyKey" TEXT,
  "providerReference" TEXT,
  "amount" DECIMAL(78,0) NOT NULL,
  "totalBalanceBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "totalBalanceAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "reservedBalanceBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "reservedBalanceAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "internalBalanceBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "internalBalanceAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "totalLockedPrincipalBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "totalLockedPrincipalAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_liquidity_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wallet_movements" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "walletId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "transactionId" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "idempotencyKey" TEXT,
  "providerReference" TEXT,
  "baseBalanceBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "baseBalanceAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "reservedBalanceBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "reservedBalanceAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "lockedAmountBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "lockedAmountAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "stackedAmountBefore" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "stackedAmountAfter" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "amount" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_movements_pkey" PRIMARY KEY ("id")
);


ALTER TABLE "company_liquidity_movements" ADD COLUMN IF NOT EXISTS "transactionId" TEXT;
ALTER TABLE "company_liquidity_movements" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "company_liquidity_movements" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "company_liquidity_movements" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "company_liquidity_movements" ADD COLUMN IF NOT EXISTS "providerReference" TEXT;
ALTER TABLE "wallet_movements" ADD COLUMN IF NOT EXISTS "transactionId" TEXT;
ALTER TABLE "wallet_movements" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "wallet_movements" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "wallet_movements" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "wallet_movements" ADD COLUMN IF NOT EXISTS "providerReference" TEXT;

CREATE INDEX IF NOT EXISTS "company_liquidity_movements_currency_createdAt_idx" ON "company_liquidity_movements"("currency", "createdAt");
CREATE INDEX IF NOT EXISTS "company_liquidity_movements_operation_createdAt_idx" ON "company_liquidity_movements"("operation", "createdAt");
CREATE INDEX IF NOT EXISTS "wallet_movements_walletId_createdAt_idx" ON "wallet_movements"("walletId", "createdAt");
CREATE INDEX IF NOT EXISTS "wallet_movements_userId_currency_createdAt_idx" ON "wallet_movements"("userId", "currency", "createdAt");
CREATE INDEX IF NOT EXISTS "wallet_movements_operation_createdAt_idx" ON "wallet_movements"("operation", "createdAt");
CREATE INDEX IF NOT EXISTS "company_liquidity_movements_transactionId_idx" ON "company_liquidity_movements"("transactionId");
CREATE INDEX IF NOT EXISTS "company_liquidity_movements_sourceType_sourceId_idx" ON "company_liquidity_movements"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "company_liquidity_movements_idempotencyKey_idx" ON "company_liquidity_movements"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "wallet_movements_transactionId_idx" ON "wallet_movements"("transactionId");
CREATE INDEX IF NOT EXISTS "wallet_movements_sourceType_sourceId_idx" ON "wallet_movements"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "wallet_movements_idempotencyKey_idx" ON "wallet_movements"("idempotencyKey");

DO $$ BEGIN
  ALTER TABLE "wallet_movements" ADD CONSTRAINT "wallet_movements_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wallet_movements" ADD CONSTRAINT "wallet_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "orders_referenceNo_idx" ON "orders"("referenceNo");
CREATE INDEX IF NOT EXISTS "orders_referenceNo_status_idx" ON "orders"("referenceNo", "status");
CREATE INDEX IF NOT EXISTS "orders_paymentReference_idx" ON "orders"("paymentReference");
CREATE INDEX IF NOT EXISTS "transactions_context_status_createdAt_idx" ON "transactions"("transactionContext", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "transactions_currency_status_createdAt_idx" ON "transactions"("currency", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "bill_payments_transactionId_status_idx" ON "bill_payments"("transactionId", "status");
CREATE INDEX IF NOT EXISTS "vaults_status_maturityDate_id_idx" ON "vaults"("status", "maturityDate", "id");
CREATE INDEX IF NOT EXISTS "auto_stacks_status_nextExecutionAt_id_idx" ON "auto_stacks"("status", "nextExecutionAt", "id");
CREATE INDEX IF NOT EXISTS "auto_stacks_status_nextInterestAt_id_idx" ON "auto_stacks"("status", "nextInterestAt", "id");
CREATE INDEX IF NOT EXISTS "webhooks_provider_eventType_createdAt_idx" ON "Webhook"("provider", "eventType", "createdAt");

CREATE OR REPLACE FUNCTION record_company_liquidity_movement()
RETURNS trigger AS $$
DECLARE
  op TEXT := 'NOOP';
  amount DECIMAL(78,0) := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    op := 'CREATE';
    amount := NEW."totalBalance";
    INSERT INTO "company_liquidity_movements" (
      "currency", "operation", "amount",
      "totalBalanceBefore", "totalBalanceAfter",
      "reservedBalanceBefore", "reservedBalanceAfter",
      "internalBalanceBefore", "internalBalanceAfter",
      "totalLockedPrincipalBefore", "totalLockedPrincipalAfter"
    ) VALUES (
      NEW."currency", op, amount,
      0, NEW."totalBalance",
      0, NEW."reservedBalance",
      0, NEW."internalBalance",
      0, NEW."totalLockedPrincipal"
    );
    RETURN NEW;
  END IF;

  IF NEW."reservedBalance" > OLD."reservedBalance" AND NEW."totalBalance" = OLD."totalBalance" THEN
    op := 'RESERVE'; amount := NEW."reservedBalance" - OLD."reservedBalance";
  ELSIF NEW."reservedBalance" < OLD."reservedBalance" AND NEW."totalBalance" = OLD."totalBalance" THEN
    op := 'RELEASE'; amount := OLD."reservedBalance" - NEW."reservedBalance";
  ELSIF NEW."reservedBalance" < OLD."reservedBalance" AND NEW."totalBalance" < OLD."totalBalance" THEN
    op := 'CONSUME_RESERVED'; amount := OLD."reservedBalance" - NEW."reservedBalance";
  ELSIF NEW."totalBalance" > OLD."totalBalance" THEN
    op := 'ADD_LIQUIDITY'; amount := NEW."totalBalance" - OLD."totalBalance";
  ELSIF NEW."totalBalance" < OLD."totalBalance" THEN
    op := 'REDUCE_LIQUIDITY'; amount := OLD."totalBalance" - NEW."totalBalance";
  ELSIF NEW."internalBalance" <> OLD."internalBalance" THEN
    op := CASE WHEN NEW."internalBalance" > OLD."internalBalance" THEN 'INTERNAL_ADD' ELSE 'INTERNAL_SUBTRACT' END;
    amount := abs(NEW."internalBalance" - OLD."internalBalance");
  ELSIF NEW."totalLockedPrincipal" <> OLD."totalLockedPrincipal" OR NEW."totalAccruedLockedInterest" <> OLD."totalAccruedLockedInterest" THEN
    op := 'LOCKED_LIQUIDITY_UPDATE';
    amount := abs(NEW."totalLockedPrincipal" - OLD."totalLockedPrincipal") + abs(NEW."totalAccruedLockedInterest" - OLD."totalAccruedLockedInterest");
  END IF;

  IF op <> 'NOOP' THEN
    INSERT INTO "company_liquidity_movements" (
      "currency", "operation", "amount",
      "totalBalanceBefore", "totalBalanceAfter",
      "reservedBalanceBefore", "reservedBalanceAfter",
      "internalBalanceBefore", "internalBalanceAfter",
      "totalLockedPrincipalBefore", "totalLockedPrincipalAfter"
    ) VALUES (
      NEW."currency", op, amount,
      OLD."totalBalance", NEW."totalBalance",
      OLD."reservedBalance", NEW."reservedBalance",
      OLD."internalBalance", NEW."internalBalance",
      OLD."totalLockedPrincipal", NEW."totalLockedPrincipal"
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_liquidity_movements ON "company_liquidity";
CREATE TRIGGER trg_company_liquidity_movements
AFTER INSERT OR UPDATE ON "company_liquidity"
FOR EACH ROW EXECUTE FUNCTION record_company_liquidity_movement();

CREATE OR REPLACE FUNCTION record_wallet_movement()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."baseBalance" <> 0 THEN
      INSERT INTO "wallet_movements" (
        "walletId", "userId", "currency", "operation", "amount",
        "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
        "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
      ) VALUES (
        NEW."id", NEW."userId", NEW."currency", 'CREATE_CREDIT', NEW."baseBalance",
        0, NEW."baseBalance", 0, NEW."reservedBalance", 0, NEW."lockedAmount", 0, NEW."stackedAmount"
      );
    END IF;
    IF NEW."reservedBalance" <> 0 THEN
      INSERT INTO "wallet_movements" (
        "walletId", "userId", "currency", "operation", "amount",
        "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
        "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
      ) VALUES (
        NEW."id", NEW."userId", NEW."currency", 'CREATE_RESERVED', NEW."reservedBalance",
        0, NEW."baseBalance", 0, NEW."reservedBalance", 0, NEW."lockedAmount", 0, NEW."stackedAmount"
      );
    END IF;
    IF NEW."lockedAmount" <> 0 THEN
      INSERT INTO "wallet_movements" (
        "walletId", "userId", "currency", "operation", "amount",
        "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
        "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
      ) VALUES (
        NEW."id", NEW."userId", NEW."currency", 'CREATE_LOCKED', NEW."lockedAmount",
        0, NEW."baseBalance", 0, NEW."reservedBalance", 0, NEW."lockedAmount", 0, NEW."stackedAmount"
      );
    END IF;
    IF NEW."stackedAmount" <> 0 THEN
      INSERT INTO "wallet_movements" (
        "walletId", "userId", "currency", "operation", "amount",
        "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
        "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
      ) VALUES (
        NEW."id", NEW."userId", NEW."currency", 'CREATE_STACKED', NEW."stackedAmount",
        0, NEW."baseBalance", 0, NEW."reservedBalance", 0, NEW."lockedAmount", 0, NEW."stackedAmount"
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."reservedBalance" > OLD."reservedBalance" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'RESERVE', NEW."reservedBalance" - OLD."reservedBalance",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  ELSIF NEW."reservedBalance" < OLD."reservedBalance" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'RELEASE_RESERVED', OLD."reservedBalance" - NEW."reservedBalance",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  END IF;

  IF NEW."baseBalance" > OLD."baseBalance" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'CREDIT', NEW."baseBalance" - OLD."baseBalance",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  ELSIF NEW."baseBalance" < OLD."baseBalance" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'DEBIT', OLD."baseBalance" - NEW."baseBalance",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  END IF;

  IF NEW."lockedAmount" > OLD."lockedAmount" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'LOCK', NEW."lockedAmount" - OLD."lockedAmount",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  ELSIF NEW."lockedAmount" < OLD."lockedAmount" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'UNLOCK', OLD."lockedAmount" - NEW."lockedAmount",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  END IF;

  IF NEW."stackedAmount" > OLD."stackedAmount" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'STACK', NEW."stackedAmount" - OLD."stackedAmount",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  ELSIF NEW."stackedAmount" < OLD."stackedAmount" THEN
    INSERT INTO "wallet_movements" (
      "walletId", "userId", "currency", "operation", "amount",
      "baseBalanceBefore", "baseBalanceAfter", "reservedBalanceBefore", "reservedBalanceAfter",
      "lockedAmountBefore", "lockedAmountAfter", "stackedAmountBefore", "stackedAmountAfter"
    ) VALUES (
      NEW."id", NEW."userId", NEW."currency", 'UNSTACK', OLD."stackedAmount" - NEW."stackedAmount",
      OLD."baseBalance", NEW."baseBalance", OLD."reservedBalance", NEW."reservedBalance",
      OLD."lockedAmount", NEW."lockedAmount", OLD."stackedAmount", NEW."stackedAmount"
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_movements ON "wallets";
CREATE TRIGGER trg_wallet_movements
AFTER INSERT OR UPDATE ON "wallets"
FOR EACH ROW EXECUTE FUNCTION record_wallet_movement();
