import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax';
import { toBigInt, ConvertCurrency } from '../../../shared';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

@Injectable()
export class WeeklyBalanceSnapshotScheduler {
  private readonly logger = new Logger(WeeklyBalanceSnapshotScheduler.name);
  private readonly BATCH_SIZE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickerService: QuidaxTickerService,
  ) {}

  @Cron('45 23 * * 0')
  async createWeeklyBalanceSnapshots() {
    if (!isDedicatedSchedulerRuntime()) return;
    this.logger.log('Starting weekly balance snapshot creation...');

    const thisSunday = this.toLastSunday(new Date());

    let tickerData = await this.tickerService.getCachedTickers().then(t => t || {});
    if (Object.keys(tickerData).length === 0) {
      try {
        await this.tickerService.fetchAndCacheTickers();
        tickerData = await this.tickerService.getCachedTickers().then(t => t || {});
      } catch (err) {
        this.logger.warn('Failed to fetch live tickers for weekly snapshot', err);
      }
    }

    const usdtNgnRate = this.resolveUsdtNgnRate(tickerData);

    let processed = 0;
    let errors = 0;
    let offset = 0;

    while (true) {
      const users = await this.prisma.user.findMany({
        select: { id: true },
        skip: offset,
        take: this.BATCH_SIZE,
        orderBy: { id: 'asc' },
      });

      if (users.length === 0) break;

      for (const user of users) {
        try {
          await this.prisma.$transaction(async (tx) => {
            const wallets = await tx.wallet.findMany({
              where: { userId: user.id },
              select: {
                baseBalance: true,
                lockedAmount: true,
                loanCollateralAmount: true,
                stackedAmount: true,
                totalStackedInterest: true,
                totalLockedInterest: true,
                currency: true,
                isCrypto: true,
              },
            });

            const { totalBalanceNgn, ngnBalance, usdBalance, cryptoBalanceNgn, walletCount } =
              this.calculateUserBalance(wallets, tickerData, usdtNgnRate);

            await tx.dailyBalanceSnapshot.upsert({
              where: {
                userId_snapshotDate: {
                  userId: user.id,
                  snapshotDate: thisSunday,
                },
              },
              create: {
                userId: user.id,
                snapshotDate: thisSunday,
                totalBalanceNgn,
                ngnBalance,
                usdBalance,
                cryptoBalanceNgn,
                walletCount,
                tickerSnapshot: {
                  usdtNgnRate,
                  cachedAt: new Date().toISOString(),
                  pairCount: Object.keys(tickerData).length,
                },
              },
              update: {
                totalBalanceNgn,
                ngnBalance,
                usdBalance,
                cryptoBalanceNgn,
                walletCount,
                tickerSnapshot: {
                  usdtNgnRate,
                  cachedAt: new Date().toISOString(),
                  pairCount: Object.keys(tickerData).length,
                },
                updatedAt: new Date(),
              },
            });
          });

          processed++;
        } catch (error) {
          errors++;
          this.logger.error(
            `Failed to create weekly snapshot for user ${user.id}: ${error.message}`,
          );
        }
      }

      offset += this.BATCH_SIZE;
    }

    this.logger.log(
      `Weekly balance snapshot completed. Processed: ${processed}, Errors: ${errors}, Date: ${thisSunday.toISOString().split('T')[0]}`,
    );
  }

  private calculateUserBalance(
    wallets: any[],
    tickers: Record<string, any>,
    usdtNgnRate: number,
  ): {
    totalBalanceNgn: string;
    ngnBalance: string;
    usdBalance: string;
    cryptoBalanceNgn: string;
    walletCount: number;
  } {
    let totalBalanceNgn = 0;
    let ngnBalance = 0;
    let usdBalance = 0;
    let cryptoBalanceNgn = 0;
    let walletCount = 0;

    for (const wallet of wallets) {
      const balanceNum = Number(ConvertCurrency.fromBase(
        toBigInt(wallet.baseBalance),
        wallet.currency,
      ));

      const lockedNum = Number(ConvertCurrency.fromBase(
        toBigInt(wallet.lockedAmount || 0),
        wallet.currency,
      ));

      const loanCollateralNum = Number(ConvertCurrency.fromBase(
        toBigInt(wallet.loanCollateralAmount || 0),
        wallet.currency,
      ));

      const stackedNum = Number(ConvertCurrency.fromBase(
        toBigInt(wallet.stackedAmount || 0),
        wallet.currency,
      ));

      const stackedInterestNum = Number(ConvertCurrency.fromBase(
        toBigInt(wallet.totalStackedInterest || 0),
        wallet.currency,
      ));

      const lockedInterestNum = Number(ConvertCurrency.fromBase(
        toBigInt(wallet.totalLockedInterest || 0),
        wallet.currency,
      ));

      const totalWalletBalance =
        balanceNum + lockedNum + loanCollateralNum + stackedNum + stackedInterestNum + lockedInterestNum;

      const currencyLower = wallet.currency.toLowerCase();
      let walletNgnValue = 0;

      if (currencyLower === 'ngn') {
        walletNgnValue = totalWalletBalance;
        ngnBalance += walletNgnValue;
      } else if (currencyLower === 'usd') {
        walletNgnValue = totalWalletBalance * usdtNgnRate;
        usdBalance += totalWalletBalance;
      } else if (wallet.isCrypto) {
        const price = this.lookupCryptoPrice(tickers, wallet.currency, usdtNgnRate);
        walletNgnValue = totalWalletBalance * price;
        cryptoBalanceNgn += walletNgnValue;
      } else {
        walletNgnValue = 0;
      }

      totalBalanceNgn += walletNgnValue;
      walletCount++;
    }

    return {
      totalBalanceNgn: totalBalanceNgn.toFixed(2),
      ngnBalance: ngnBalance.toFixed(2),
      usdBalance: usdBalance.toFixed(2),
      cryptoBalanceNgn: cryptoBalanceNgn.toFixed(2),
      walletCount,
    };
  }

  private lookupCryptoPrice(
    tickers: Record<string, any>,
    currency: string,
    usdtNgnRate: number,
  ): number {
    const currUpper = currency.toUpperCase();
    const currLower = currency.toLowerCase();

    const directLower = `${currLower}ngn`;
    const directUpper = `${currUpper}NGN`;
    const direct = tickers[directLower]?.ticker?.last ||
                   tickers[directUpper]?.ticker?.last;
    if (direct) {
      const price = parseFloat(direct);
      if (price > 0) return price;
    }

    const usdtLower = `${currLower}usdt`;
    const usdtUpper = `${currUpper}USDT`;
    const usdtPrice = tickers[usdtLower]?.ticker?.last ||
                      tickers[usdtUpper]?.ticker?.last;
    if (usdtPrice && usdtNgnRate > 0) {
      const price = parseFloat(usdtPrice) * usdtNgnRate;
      if (price > 0) return price;
    }

    return 0;
  }

  private resolveUsdtNgnRate(tickers: Record<string, any>): number {
    const rate = tickers['usdtngn']?.ticker?.last ||
                 tickers['USDTNGN']?.ticker?.last;
    return rate ? parseFloat(rate) : 1463.7;
  }

  private toLastSunday(date: Date): Date {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = day === 0 ? 0 : day;
    d.setUTCDate(d.getUTCDate() - diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
