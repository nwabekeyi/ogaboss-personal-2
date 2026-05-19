export const COMPANY_NGN_WALLET_ID = 'company_ngn';
export const COMPANY_PAYSTACK_NGN_WALLET_ID = 'company_paystack_ngn_balance';
export const COMPANY_WALLETS_KEY = 'quidax:company:wallets';
export const COMPANY_LIQUIDITY_KEY = 'company:liquidity';
export const COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY =
  'company:paystack:ngn:liquidity';

export enum LiquidityReservationStatus {
  RELEASED = 'released',
  RESERVED = 'reserved',
  INSUFFICIENT = 'insufficient',
  CONSUMED = 'consumed',
}
