import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../infrastructure/databases/prisma';
import {
  CURRENCY_PRECISION,
  CryptoNetwork,
  CryptoCurrency,
  NetworkInfo,
} from '../constants/currency-precision.constant';
import {
  ALLOWED_CURRENCIES,
  CRYPTO_DECIMALS,
  FIAT_DECIMALS,
} from '../constants/allowed-currencies';
import Decimal from 'decimal.js';

export function getCurrencyDecimals(
  currency: string,
  networkOrDecimals?: CryptoNetwork | number,
): number {
  currency = currency.toLowerCase();

  if (!ALLOWED_CURRENCIES.has(currency)) {
    throw new BadRequestException(`Unsupported currency: ${currency}`);
  }

  // Fiat case: if second arg is a number, treat it as decimals override
  if (typeof networkOrDecimals === 'number') {
    return networkOrDecimals;
  }

  // Fiat without override
  if (currency in FIAT_DECIMALS) {
    return FIAT_DECIMALS[currency];
  }

  // Crypto case
  const crypto = currency as CryptoCurrency;
  const networks: NetworkInfo[] = CURRENCY_PRECISION[crypto];

  if (!networks || networks.length === 0) {
    // fallback to CRYPTO_DECIMALS if defined
    if (currency in CRYPTO_DECIMALS) return CRYPTO_DECIMALS[currency];
    throw new BadRequestException(
      `Decimals not defined for currency: ${currency}`,
    );
  }

  if (!networkOrDecimals || typeof networkOrDecimals !== 'string') {
    throw new BadRequestException(
      `${currency.toUpperCase()} requires a network to determine decimals`,
    );
  }

  const network = networks.find(
    (n) => n.id.toLowerCase() === networkOrDecimals?.toLowerCase(),
  );
  if (!network) {
    throw new BadRequestException(
      `${currency.toUpperCase()} not supported on network ${networkOrDecimals}`,
    );
  }

  return network.decimals;
}

export class ConvertCurrency {
  static toBase(
    amount: string,
    currency: string,
    decimalsOrNetwork?: number | CryptoNetwork,
  ): bigint {
    currency = currency.toLowerCase();

    let decimals: number;

    if (typeof decimalsOrNetwork === 'number') {
      decimals = decimalsOrNetwork;
    } else {
      decimals = getCurrencyDecimals(currency, decimalsOrNetwork);
    }

    // Normalize scientific notation and trim
    let normalized = amount.trim();

    if (/[eE][+-]?\d+$/.test(normalized)) {
      try {
        const num = new Decimal(normalized);
        normalized = num.toFixed(decimals + 10).replace(/\.?0+$/, '');
        if (normalized === '' || normalized === '-') normalized = '0';
      } catch {
        throw new BadRequestException(
          `Invalid scientific notation format: ${amount}`,
        );
      }
    }

    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
      throw new BadRequestException(`Invalid amount format: ${amount}`);
    }

    let sign = 1n;
    if (normalized.startsWith('-')) {
      sign = -1n;
      normalized = normalized.slice(1);
    }

    let [whole = '0', fraction = ''] = normalized.split('.');

    if (fraction.length > decimals) {
      console.error(
        `currency conversion failed: ${currency.toUpperCase()} supports at most ${decimals} decimal places`,
      );
      throw new BadRequestException(
        `${currency.toUpperCase()} supports at most ${decimals} decimal places`,
      );
    }

    fraction = fraction.padEnd(decimals, '0');

    let value =
      BigInt(whole) * 10n ** BigInt(decimals) +
      (fraction ? BigInt(fraction) : 0n);

    return sign * value;
  }

  static fromBase(
    amount: any,
    currency: string,
    decimalsOrNetwork?: number | CryptoNetwork,
  ): string {
    currency = currency.toLowerCase();

    let safeAmount: bigint;
    if (typeof amount === 'bigint') {
      safeAmount = amount;
    } else if (typeof amount === 'number') {
      safeAmount = BigInt(amount);
    } else if (typeof amount === 'string') {
      safeAmount = BigInt(amount);
    } else if (amount instanceof Prisma.Decimal) {
      safeAmount = BigInt(amount.toFixed(0));
    } else {
      console.warn(
        `fromBase received invalid amount type: ${typeof amount}, defaulting to 0n`,
      );
      safeAmount = 0n;
    }

    let decimals: number;

    if (typeof decimalsOrNetwork === 'number') {
      decimals = decimalsOrNetwork;
    } else {
      decimals = getCurrencyDecimals(currency, decimalsOrNetwork);
    }

    const factor = 10n ** BigInt(decimals);
    const absAmount = safeAmount < 0n ? -safeAmount : safeAmount;
    const whole = absAmount / factor;
    const fraction = absAmount % factor;

    let result = whole.toString();

    let fractionStr = fraction.toString().padStart(decimals, '0');

    if (currency in FIAT_DECIMALS) {
      fractionStr = fractionStr.slice(0, 2).padEnd(2, '0');
      result += '.' + fractionStr;
    } else {
      fractionStr = fractionStr.replace(/0+$/, '');
      if (fractionStr.length === 0) fractionStr = '0';
      if (fractionStr !== '0') {
        result += '.' + fractionStr;
      }
    }

    return safeAmount < 0n ? '-' + result : result;
  }

  static formatCryptoForQuote(
    amount: any,
    currency: string,
    decimalsOrNetwork?: number | CryptoNetwork,
  ): string {
    currency = currency.toLowerCase();

    let safeAmount: bigint;
    if (typeof amount === 'bigint') {
      safeAmount = amount;
    } else if (typeof amount === 'number') {
      safeAmount = BigInt(amount);
    } else if (typeof amount === 'string') {
      if (amount.includes('.')) {
        const dec = new Decimal(amount);
        const multiplier = new Decimal(10).pow(decimalsOrNetwork as number);
        const scaled = dec.mul(multiplier).floor();
        safeAmount = BigInt(scaled.toFixed(0));
      } else {
        safeAmount = BigInt(amount);
      }
    } else if (amount instanceof Prisma.Decimal) {
      safeAmount = BigInt(amount.toFixed(0));
    } else {
      safeAmount = 0n;
    }

    let decimals: number;

    if (typeof decimalsOrNetwork === 'number') {
      decimals = decimalsOrNetwork;
    } else {
      decimals = getCurrencyDecimals(currency, decimalsOrNetwork);
    }

    const factor = 10n ** BigInt(decimals);
    const absAmount = safeAmount < 0n ? -safeAmount : safeAmount;
    const whole = absAmount / factor;
    const fraction = absAmount % factor;

    let result = whole.toString();

     if (whole === 0n) {
       let fractionStr = fraction.toString().padStart(decimals, '0');
       fractionStr = fractionStr.replace(/0+$/, '');
       if (fractionStr.length === 0) {
         result = '0.00';
       } else {
         result = '0.' + fractionStr;
       }
     } else {
       let fractionStr = fraction.toString().padStart(decimals, '0');
       fractionStr = fractionStr.replace(/0+$/, '');
       if (fractionStr.length === 0) fractionStr = '0';
       if (fractionStr !== '0') {
         result += '.' + fractionStr;
       }
     }
    return safeAmount < 0n ? '-' + result : result;
  }
}
