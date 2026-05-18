// src/infrastructure/databases/seeds/crypto-currency.seed.ts

import { PrismaService } from '../prisma.service';
import { SUPPORTED_CRYPTO_CURRENCIES } from '../../../../shared';
import Decimal from 'decimal.js';

const prisma = new PrismaService();

const CRYPTO_NAMES: Record<string, string> = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  usdt: 'Tether USD',
  usdc: 'USD Coin',
  bnb: 'BNB',
  doge: 'Dogecoin',
  xrp: 'XRP',
  sol: 'Solana',
  link: 'Chainlink',
  trx: 'TRON',
};
const DEFAULT_LOCKED_FUNDS_RATE: Record<string, Decimal> = {
  btc: new Decimal(5),
  usdt: new Decimal(8),
  usdc: new Decimal(8),
};

export async function cryptoCurrencySeed() {
  for (const symbol of SUPPORTED_CRYPTO_CURRENCIES) {
    const crypto = await prisma.cryptoCurrency.upsert({
      where: { symbol: symbol.toUpperCase() },
      update: {
        name: CRYPTO_NAMES[symbol],
        defaultBufferPercent: 0,
        maxBufferPercent: 0,
      },
      create: {
        symbol: symbol.toUpperCase(),
        name: CRYPTO_NAMES[symbol],
        defaultBufferPercent: 0,
        maxBufferPercent: 0,
      },
    });

    const existingRate = await prisma.cryptoCurrencyRate.findUnique({
      where: { cryptoCurrencyId: crypto.id },
    });

    if (!existingRate) {
      await prisma.cryptoCurrencyRate.create({
        data: {
          cryptoCurrencyId: crypto.id,
          dailyRatePercent: new Decimal(0),
          lockedFundsRatePercent:
            DEFAULT_LOCKED_FUNDS_RATE[symbol] ?? new Decimal(0),
        },
      });
    } else if (DEFAULT_LOCKED_FUNDS_RATE[symbol]) {
      await prisma.cryptoCurrencyRate.update({
        where: { cryptoCurrencyId: crypto.id },
        data: { lockedFundsRatePercent: DEFAULT_LOCKED_FUNDS_RATE[symbol] },
      });
    }
  }

  console.log('Supported crypto currencies seeded successfully.');
  console.log('Crypto currency rates initialized (default: 0%).');
}
