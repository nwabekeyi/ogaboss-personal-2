// src/modules/transaction/types.ts
import { PaymentType } from '../../../infrastructure';

export interface SavedCard {
  id: string;
  cardType: string | null;
  last4: string | null;
}

export interface PaymentMethodResponse {
  value: PaymentType;
  name: string;
  cards?: SavedCard[];
}

export type GetPaymentTypesResponse = {
  paymentTypes: PaymentMethodResponse[];
};

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum TransactionContext {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER = 'TRANSFER',
  BUY = 'BUY',
  SELL = 'SELL',
  AUTOSTACK = 'AUTOSTACK',
}

// src/modules/transaction/types.ts
export interface BaseQuote {
  quoteId: string;
  userId: string;
  expiresAt: number;
  displayCurrency: 'NGN' | 'USD';
}

export interface BuyQuote extends BaseQuote {
  crypto: string;
  volume: number;
  buyPrice: number;
  transactionFee: number;
  total: number;
}

export interface SellQuote extends BaseQuote {
  crypto: string;
  amount: number;
  sellPrice: number;
  transactionFee: number;
  netReceive: number;
  bankAccountId: string;
}

export interface SwapQuote extends BaseQuote {
  from: string;
  to: string;
  amount: number;
  toAmount: number;
  transactionFee: number;
}

export enum paymentTypeName {
  DebitCard = 'Debit card',
  BankDeposit = 'Bank Deposit',
  Paystack = 'Paystack',
}

export interface TransactionWithUser {
  id: string;
  userId: string;
  transactionUniqueId: string;
  transactionContext: string | null;
  status: string;
  currency?: string;
  cryptoAmountOriginal?: string | null;
  fiatAmountOriginal?: string | null;
  platformFeeOriginal?: string | null;
  executedCryptoAmountBase?: any;
  executedFiatAmountBase?: any;
  executionPrice?: string | null;
  executedAt?: Date | null;
  User?: {
    email: string | null;
    firstName: string | null;
  } | null;
  paymentMetadata?: any;
}
