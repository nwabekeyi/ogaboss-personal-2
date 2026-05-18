import {
  TransactionType,
  PaymentType,
  TransactionStatus,
  TransactionContext,
} from '../../../infrastructure';
import { CryptoNetwork } from '../../../shared';
import { Prisma } from '../../../infrastructure/databases/prisma';

// ===================================================================
// Base Quote Interface
// ===================================================================
export interface IBaseQuote {
  quoteId: string;
  userId: string;
  side: 'buy' | 'sell' | 'swap' | 'vault';
  expiresAt: number;
  pinVerified?: boolean;
  pinVerifiedAt?: number;

  [key: string]: any;
}

// ===================================================================
// BUY QUOTE
// ===================================================================
export interface IBuyQuote extends IBaseQuote {
  side: 'buy';
  crypto: string;
  network: CryptoNetwork | string;
  fiatCurrency: string;
  fiatDecimals: number;
  cryptoDecimals: number;
  volumeCryptoMinor: string;
  marketPriceMinor: string;
  bufferedPriceMinor: string;
  bufferSpreadMinor?: string;
  platformFeeMinor?: string;
  totalFiatMinor?: string;
  bufferPercent: string;
}

// ===================================================================
// SELL QUOTE
// ===================================================================
export interface ISellQuote extends IBaseQuote {
  side: 'sell';
  crypto: string;
  network: CryptoNetwork | string;
  fiatCurrency: string;
  fiatDecimals: number;
  cryptoDecimals: number;
  exactCryptoMinor: string;
  marketPriceMinor: string;
  bufferedPriceMinor: string;
  bufferSpreadMinor?: string;
  grossFiatMinor?: string;
  platformFeeMinor?: string;
  netFiatMinor?: string;
  bufferPercent: string;
  bankAccountId?: string;
}

// ===================================================================
// SWAP QUOTE
// ===================================================================
export interface ISwapQuote extends IBaseQuote {
  side: 'swap';
  from: string;
  to: string;
  fromNetwork: CryptoNetwork | string;
  toNetwork: CryptoNetwork | string;
  fromDecimals: number;
  toDecimals: number;
  exactFromMinor: string;
  estimatedOutMinor: string;
  marketRateMinor: string;
  protectedRateMinor: string;
  bufferSpreadMinor: string;
  bufferPercent: string;
  totalBufferPercent: string;
  pinVerified: boolean;
  expiresAt: number;
  quotationId?: string;
}

export interface TransactionDataInterface {
  id: string;
  cryptoAmountBase: string;
  fiatAmountBase: string;
  cryptoAmountOriginal: string;
  fiatAmountOriginal: string;
  currency: string;
  bufferAmountBase: string;
  totalAmountSentBase: string;
  transactionType: string;
  userId: string;
  quidaxUserId: string;
  network?: string;
}

export interface CreateTransactionParams {
  userId: string;
  fromCurrency?: string | null;  // source crypto for swap
  toCurrency?: string | null;    // target crypto for swap

  // Blockchain / wallet info
  receiverWalletAddress?: string | null;
  senderWalletAddress?: string | null;
  platformWalletAddress?: string | null;
  network?: string | null;

  // Payment info
  paymentType?: PaymentType | null;
  paymentMetadata?: Prisma.JsonValue | null;

  // Identifiers
  transactionUniqueId: string;
  currency: string;

  // Amounts (base = minor units, e.g. kobo, satoshi)
  cryptoAmountBase?: bigint | string | null;
  fiatAmountBase: bigint | string;

  cryptoAmountOriginal?: string | null;
  fiatAmountOriginal?: string | null;

  // Fees
  platformFeeOriginal?: string | null;
  platformFeeBase?: bigint | string | null;

  bufferAmountOriginal?: string | null;
  bufferAmountBase?: bigint | string | null;

  // Total sent (crypto + platform fee)
  totalAmountSentBase?: bigint | string | null;
  totalAmountSentOriginal?: string | null;

  // Classification
  transactionType: TransactionType;
  transactionContext: TransactionContext;

  // Lifecycle
  status?: TransactionStatus;
}

export type CreatedTransaction = {
  id: string;
  userId: string;
  receiverWalletAddress: string | null;
  senderWalletAddress: string | null;
  paymentType: PaymentType | null;
  paymentMetadata: Prisma.JsonValue | null;
  platformWalletAddress: string | null;
  transactionUniqueId: string;
  network: string | null;
  currency: string;
  cryptoAmountBase: Prisma.Decimal | null;
  fiatAmountBase: Prisma.Decimal;
  cryptoAmountOriginal: string | null;
  fiatAmountOriginal: string | null;
  platformFeeBase?: Prisma.Decimal | null;
  bufferAmountBase?: Prisma.Decimal | null;
  platformFeeOriginal?: string | null;
  bufferAmountOriginal?: string | null;
  transactionType: TransactionType;
  transactionContext: TransactionContext;
  status: TransactionStatus;
  createdAt: Date;
  updatedAt: Date;
};
// ===================================================================
// Union type for all quotes (optional)
// ===================================================================
export type IQuote = IBuyQuote | ISellQuote | ISwapQuote;

// ===================================================================
// VAULT QUOTE
// ===================================================================
export interface IVaultQuote extends IBaseQuote {
  side: 'vault';
  currencyId: string;
  currencySymbol: string;
  network: CryptoNetwork;
  baseBalanceMinor: string;
  rateMinor: string;
  expiresAt: number;
  pinVerified: boolean;
  amountMinor?: string;
  durationDays?: number;
  maturityDate?: number;
  bufferAmountMinor: string;
  totalChargeMinor: string;
}

// ===================================================================
// VAULT PREVIEW
// ===================================================================
export interface IVaultPreview extends IVaultQuote {
  amountMinor: string;
  durationDays: number;
  maturityDate: number;
  interestRatePerAnum: string;
  expectedInterestMinor: string;
  transactionFeeMinor: string;
  amountToReceiveMinor: string;
}
