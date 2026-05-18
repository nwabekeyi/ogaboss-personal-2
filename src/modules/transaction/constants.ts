import { BASE_CURRENCY } from '../../shared';

export const PLATFORM_SPREAD: number = 0.005;
export const QUOTE_TTL_SECONDS: number = 60 * 5;
export const QUOTE_COOLDOWN_SECONDS = 10;
export const COOLDOWN_KEY_PREFIX = 'confirmation:cooldown:';
export const MIN_TRANSACTION_USDT = 2;

// Vault
export const VAULT_TRANSACTION_FEE: number =
  parseFloat(process.env.VAULT_TRANSACTION_FEE) || 100;
export const VAULT_QUOTE_TTL_SECONDS: number =
  parseInt(process.env.VAULT_QUOTE_TTL_SECONDS) || 300;

//payment bank detials
export const COMPANY_BANK_DETAILS = {
  bankName: 'Guaranty Trust Bank',
  accountName: 'Ogaboss',
  accountNumber: '0123456789',
  currency: BASE_CURRENCY.toUpperCase(),
} as const;




export const QUIDAX_COMPANY_USERID = 'me';
