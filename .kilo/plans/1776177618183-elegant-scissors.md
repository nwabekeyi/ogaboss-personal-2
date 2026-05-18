# Plan: Vault Quote and Preview Flow

## Summary

Implement a quote-based vault creation flow similar to buy/sell:

1. User requests vault quote (quoteId)
2. User requests vault preview (using quoteId + amount + duration)
3. User confirms vault (using quoteId)

## Changes Required

### 1. Add Environment Variables (`src/config/env/schema/index.ts`)

```typescript
VAULT_TRANSACTION_FEE: Joi.number().required(),
VAULT_QUOTE_TTL_SECONDS: Joi.number().default(60 * 5),
```

### 2. Add Constants (`src/modules/transaction/constants.ts`)

```typescript
export const VAULT_TRANSACTION_FEE: number =
  parseFloat(process.env.VAULT_TRANSACTION_FEE) || 100;
export const VAULT_QUOTE_TTL_SECONDS: number =
  parseInt(process.env.VAULT_QUOTE_TTL_SECONDS) || 300;
```

### 3. Add Vault Quote Interface (`src/modules/transaction/services/types.ts`)

```typescript
export interface IVaultQuote extends IBaseQuote {
  quoteId: string;
  userId: string;
  side: 'vault';
  currencyId: string;
  currencySymbol: string;
  baseBalanceMinor: string;
  rateMinor: string; // unit price in NGN
  expiresAt: number;
  pinVerified: boolean;
}

export interface IVaultPreview extends IVaultQuote {
  amountMinor: string;
  durationDays: number;
  maturityDate: number;
  interestRatePerAnum: number;
  expectedInterestMinor: string;
  transactionFeeMinor: string;
  amountToReceiveMinor: string;
}
```

### 4. Update Vault Schema (`src/infrastructure/databases/prisma/schema/vault.prisma`)

- Rename `status` enum values: IN_PROGRESS → ACTIVE, COMPLETED → MATURED
- Add `quoteId` field
- Add `transactionFee` field
- Add `rate` field (unit price in NGN)
- Add `requestedAt` field
- Add `status` enum update

### 5. Create Vault Quote Service

- `getVaultQuote(userId, currencyId)` - returns quote with user balance, rate, expiration
- `getVaultPreview(userId, quoteId, amount, durationDays)` - returns preview with all details
- `confirmVault(userId, quoteId)` - executes the vault creation

### 6. Update Scheduler

- Filter for `ACTIVE` vaults instead of `IN_PROGRESS`

## Implementation Order

1. Add env variables
2. Add constants
3. Add vault types
4. Update vault prisma schema
5. Generate prisma client
6. Create vault quote service methods
7. Update vault service
8. Update scheduler
9. Build and test
