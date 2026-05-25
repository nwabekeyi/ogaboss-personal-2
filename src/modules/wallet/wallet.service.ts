import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { QuidaxTickerService } from '../../infrastructure/providers/quidax';
import { TransformedWallet, WalletSummary } from './interface';
import {
  BASE_CURRENCY,
  ConvertCurrency,
  CryptoNetwork,
  toBigInt,
} from '../../shared';
import { PaymentAddressStatus } from '../../infrastructure';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly PRIORITY_COINS = [
    'BTC',
    'USDC',
    'USDT',
    'ETH',
    'BNB',
  ] as const;
  private readonly PRIORITY_SET = new Set<string>([
    'BTC',
    'USDC',
    'USDT',
    'ETH',
    'BNB',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickerService: QuidaxTickerService,
  ) {}

  private getUsdPrice(tickers: Record<string, any>, currency: string): number {
    const curr = currency.toLowerCase();

    if (curr === 'usdt' || curr === 'usdc') {
      return tickers['usdtusd']?.ticker?.last
        ? parseFloat(tickers['usdtusd'].ticker.last)
        : 1.0;
    }

    const usdtPair = `${curr}usdt`;
    if (tickers[usdtPair]?.ticker?.last) {
      return parseFloat(tickers[usdtPair].ticker.last);
    }

    const ngnPair = `${curr}${BASE_CURRENCY}`;
    const usdtNgnRate = this.getUsdtNgnRate(tickers);

    if (tickers[ngnPair]?.ticker?.last && usdtNgnRate > 0) {
      return parseFloat(tickers[ngnPair].ticker.last) / usdtNgnRate;
    }

    return 0;
  }

  private getUsdtNgnRate(tickers: Record<string, any>): number {
    return tickers['usdtngn']?.ticker?.last
      ? parseFloat(tickers['usdtngn'].ticker.last)
      : 1463.7;
  }

  private getNgnPrice(tickers: Record<string, any>, currency: string): number {
    const curr = currency.toLowerCase();

    const usdtNgnRate = tickers['usdtngn']?.ticker?.last
      ? parseFloat(tickers['usdtngn'].ticker.last)
      : 0;

    if (curr === 'usdt' || curr === 'usdc') {
      return usdtNgnRate;
    }

    const directNgnPair = `${curr}ngn`;
    if (tickers[directNgnPair]?.ticker?.last) {
      const price = parseFloat(tickers[directNgnPair].ticker.last);
      if (price > 0) return price;
    }

    const usdtPair = `${curr}usdt`;
    if (tickers[usdtPair]?.ticker?.last && usdtNgnRate > 0) {
      return parseFloat(tickers[usdtPair].ticker.last) * usdtNgnRate;
    }

    return 0;
  }

  async userWallets(userId: string): Promise<WalletSummary> {
    const t0 = Date.now();

    const wallets = await this.prisma.wallet.findMany({ where: { userId } });

    const tickers = await this.tickerService
      .getCachedTickers()
      .then((t) => t || {});

    const dailyCache = await this.prisma.userDailyPercentage.findFirst({
      where: {
        userId,
        calculatedAt: {
          gte: new Date(new Date().toISOString().split('T')[0]),
          lt: new Date(
            new Date(new Date().toISOString().split('T')[0]).getTime() +
              24 * 60 * 60 * 1000,
          ),
        },
      },
      orderBy: { calculatedAt: 'desc' },
    });

    const usdtNgnRate = this.getUsdtNgnRate(tickers);
    const usdtNgnRateSafe = usdtNgnRate > 0 ? usdtNgnRate : 1463.7;

    const priceMap = this.buildPriceMap(tickers, usdtNgnRate);

    let totalNairaBalance = 0;
    let totalReservedNaira = 0;

    const processed: TransformedWallet[] = wallets.map((w) => {
      const balanceNum = Number(
        ConvertCurrency.fromBase(
          toBigInt(w.baseBalance),
          w.currency,
          w.isCrypto
            ? (w.defaultNetwork as CryptoNetwork) || undefined
            : undefined,
        ),
      );

      const reservedNum = Number(
        ConvertCurrency.fromBase(
          toBigInt(w.reservedBalance),
          w.currency,
          w.isCrypto
            ? (w.defaultNetwork as CryptoNetwork) || undefined
            : undefined,
        ),
      );

      const lockedNum = Number(
        ConvertCurrency.fromBase(
          toBigInt(w.lockedAmount || 0),
          w.currency,
          w.isCrypto
            ? (w.defaultNetwork as CryptoNetwork) || undefined
            : undefined,
        ),
      );

      const stackedNum = Number(
        ConvertCurrency.fromBase(
          toBigInt(w.stackedAmount || 0),
          w.currency,
          w.isCrypto
            ? (w.defaultNetwork as CryptoNetwork) || undefined
            : undefined,
        ),
      );

      const availableBalance = balanceNum - reservedNum - lockedNum;
      const totalBalance = balanceNum + lockedNum + stackedNum;
      const currencyLower = w.currency.toLowerCase();

      let ngnPrice: number;
      let ngnBalance: number;
      let reservedNgn: number;

      if (w.isCrypto) {
        const prices = priceMap.get(currencyLower) || { ngn: 0, usd: 0 };
        ngnPrice = prices.ngn;
        ngnBalance = availableBalance * ngnPrice;
        reservedNgn = reservedNum * ngnPrice;
      } else {
        if (currencyLower === 'ngn') {
          ngnPrice = 1;
          ngnBalance = availableBalance;
          reservedNgn = reservedNum;
        } else if (currencyLower === 'usd') {
          ngnPrice = usdtNgnRateSafe;
          ngnBalance = availableBalance * usdtNgnRateSafe;
          reservedNgn = reservedNum * usdtNgnRateSafe;
        } else {
          ngnPrice = 0;
          ngnBalance = 0;
          reservedNgn = 0;
        }
      }

      totalNairaBalance += ngnBalance;
      totalReservedNaira += reservedNgn;

      return {
        id: w.id,
        name: w.name,
        currency: w.currency.toUpperCase(),
        balance: w.isCrypto
          ? availableBalance.toFixed(8).replace(/\.?0+$/, '')
          : availableBalance.toFixed(2),
        reservedBalance: w.isCrypto
          ? reservedNum.toFixed(8).replace(/\.?0+$/, '')
          : reservedNum.toFixed(2),
        totalBalance: w.isCrypto
          ? totalBalance.toFixed(8).replace(/\.?0+$/, '')
          : totalBalance.toFixed(2),
        ngnPrice: Math.round(ngnPrice * 100) / 100,
        ngnBalance: Math.round(ngnBalance * 100) / 100,
        isCrypto: w.isCrypto,
        blockchainEnabled: w.blockchainEnabled,
        defaultNetwork: w.defaultNetwork || null,
      };
    });

    processed.sort((a, b) => b.ngnBalance - a.ngnBalance);

    const daily = this._computeDailyChange(
      dailyCache,
      totalNairaBalance,
      usdtNgnRate,
    );

    return {
      totalBalanceInNaira: Math.round(totalNairaBalance * 100) / 100,
      totalReservedBalanceInNaira: Math.round(totalReservedNaira * 100) / 100,
      displayCurrency: 'NGN',
      currencySymbol: '₦',
      ...daily,
      wallets: processed,
    };
  }

  private buildPriceMap(
    tickers: Record<string, any>,
    usdtNgnRate: number,
  ): Map<string, { ngn: number; usd: number }> {
    const priceMap = new Map<string, { ngn: number; usd: number }>();
    const currencies = [
      'btc',
      'eth',
      'bnb',
      'usdt',
      'usdc',
      'trx',
      'xrp',
      'doge',
      'sol',
      'dot',
    ];

    for (const curr of currencies) {
      const ngnPrice = this.getNgnPrice(tickers, curr);
      const usdPrice = this.getUsdPrice(tickers, curr);
      priceMap.set(curr, { ngn: ngnPrice, usd: usdPrice });
    }

    return priceMap;
  }

  private _computeDailyChange(
    cached: any,
    currentTotalNgn: number,
    usdtNgnRate: number,
  ) {
    if (!cached) {
      return { percentChangeSinceYesterday: 0, trend: 'no_change' as const };
    }

    const previousTotalNgn = Number(cached.previousTotal || 0);
    const previousNetChangeNgn = Number(cached.netChange || 0);

    const currentTotalInNgn = currentTotalNgn;
    const previousTotalInNgn = previousTotalNgn + previousNetChangeNgn;

    let percentChange = 0;
    if (previousTotalInNgn > 0) {
      percentChange =
        ((currentTotalInNgn - previousTotalInNgn) / previousTotalInNgn) * 100;
    } else if (currentTotalInNgn > 0) {
      percentChange = 100;
    }

    const percent = Number(percentChange.toFixed(2));
    return {
      percentChangeSinceYesterday: percent,
      trend:
        percent > 0
          ? ('up' as const)
          : percent < 0
            ? ('down' as const)
            : ('no_change' as const),
    };
  }

  async getWalletPaymentAddresses(userId: string, walletId: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: { id: true },
    });

    if (!wallet) {
      throw new NotFoundException(
        'Wallet not found or does not belong to user',
      );
    }

    const addresses = await this.prisma.paymentAddress.findMany({
      where: { walletId: wallet.id, status: PaymentAddressStatus.ACTIVE },
      select: {
        id: true,
        walletId: true,
        currency: true,
        address: true,
        network: true,
        destinationTag: true,
      },
    });

    return addresses;
  }
}
