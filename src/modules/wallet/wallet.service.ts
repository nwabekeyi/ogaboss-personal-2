import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { QuidaxTickerService } from '../../infrastructure/providers/quidax';
import { TransformedWallet, WalletSummary } from './interface';
import {
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

  private fromStoredWalletBase(
    amount: unknown,
    currency: string,
    isCrypto: boolean,
    defaultNetwork?: string | null,
  ): number {
    const walletScale = isCrypto
      ? (defaultNetwork as CryptoNetwork | undefined)
      : undefined;

    return Number(ConvertCurrency.fromBase(toBigInt(amount as any), currency));
  }

  private lookupTickerPrice(
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

  async userWallets(userId: string): Promise<WalletSummary> {
    const wallets = await this.prisma.wallet.findMany({ where: { userId } });

    let tickers = await this.tickerService
      .getCachedTickers()
      .then((t) => t || {});
    
    if (Object.keys(tickers).length === 0) {
      try {
        await this.tickerService.fetchAndCacheTickers();
        tickers = await this.tickerService.getCachedTickers().then((t) => t || {});
      } catch (err) {
        this.logger.warn('Failed to fetch live tickers, using empty cache', err);
      }
    }

    const usdtNgnRate = tickers['usdtngn']?.ticker?.last ||
                        tickers['USDTNGN']?.ticker?.last
      ? parseFloat(
          tickers['usdtngn']?.ticker?.last || tickers['USDTNGN']?.ticker?.last,
        )
      : 1463.7;

    let totalNairaBalance = 0;
    let totalReservedNaira = 0;

    const processed: TransformedWallet[] = wallets.map((w) => {
      const balanceNum = this.fromStoredWalletBase(
        w.baseBalance,
        w.currency,
        w.isCrypto,
        w.defaultNetwork,
      );

      const reservedNum = this.fromStoredWalletBase(
        w.reservedBalance,
        w.currency,
        w.isCrypto,
        w.defaultNetwork,
      );

      const lockedNum = this.fromStoredWalletBase(
        w.lockedAmount || 0,
        w.currency,
        w.isCrypto,
        w.defaultNetwork,
      );

      const stackedNum = this.fromStoredWalletBase(
        w.stackedAmount || 0,
        w.currency,
        w.isCrypto,
        w.defaultNetwork,
      );

      const loanCollateralNum = this.fromStoredWalletBase(
        w.loanCollateralAmount || 0,
        w.currency,
        w.isCrypto,
        w.defaultNetwork,
      );

      const availableBalance = Math.max(
        0,
        balanceNum - reservedNum - loanCollateralNum,
      );
      const totalBalance = balanceNum + lockedNum + stackedNum + loanCollateralNum;
      const currencyLower = w.currency.toLowerCase();

      let ngnPrice: number;
      let ngnBalance: number;
      let loanCollateralNgn: number;
      let reservedNgn: number;

      if (currencyLower === 'ngn') {
        ngnPrice = 1;
        ngnBalance = availableBalance;
        loanCollateralNgn = loanCollateralNum;
        reservedNgn = reservedNum;
      } else if (currencyLower === 'usd') {
        ngnPrice = usdtNgnRate;
        ngnBalance = availableBalance * usdtNgnRate;
        loanCollateralNgn = loanCollateralNum * usdtNgnRate;
        reservedNgn = reservedNum * usdtNgnRate;
      } else if (w.isCrypto) {
        ngnPrice = this.lookupTickerPrice(tickers, w.currency, usdtNgnRate);
        ngnBalance = availableBalance * ngnPrice;
        loanCollateralNgn = loanCollateralNum * ngnPrice;
        reservedNgn = reservedNum * ngnPrice;
      } else {
        ngnPrice = 0;
        ngnBalance = 0;
        loanCollateralNgn = 0;
        reservedNgn = 0;
      }

      totalNairaBalance += ngnBalance + loanCollateralNgn;
      totalReservedNaira += reservedNgn + loanCollateralNgn;

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
        loanCollateralBalance: w.isCrypto
          ? loanCollateralNum.toFixed(8).replace(/\.?0+$/, '')
          : loanCollateralNum.toFixed(2),
        loanCollateralBalanceInNaira: Math.round(
          loanCollateralNgn * 100,
        ) / 100,
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

    processed.sort((a, b) => {
      const aPriority = this.PRIORITY_SET.has(a.currency) ? 0 : 1;
      const bPriority = this.PRIORITY_SET.has(b.currency) ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.ngnBalance - a.ngnBalance;
    });

    const weekly = await this._computeWeeklyChange(
      userId,
      totalNairaBalance,
    );

    return {
      totalBalanceInNaira: Math.round(totalNairaBalance * 100) / 100,
      totalReservedBalanceInNaira: Math.round(totalReservedNaira * 100) / 100,
      displayCurrency: 'NGN',
      currencySymbol: '₦',
      ...weekly,
      wallets: processed,
    };
  }

  private async _computeWeeklyChange(
    userId: string,
    currentTotalNgn: number,
  ): Promise<{ weeklyPercentChange: number; trend: WalletSummary['trend'] }> {
    const snapshot = await this.prisma.dailyBalanceSnapshot.findFirst({
      where: { userId },
      orderBy: { snapshotDate: 'desc' },
    });

    if (!snapshot) {
      return { weeklyPercentChange: 0, trend: '0' };
    }

    const lastWeekTotal = snapshot.totalBalanceNgn.toNumber();

    let percentChange = 0;
    if (lastWeekTotal > 0) {
      percentChange = ((currentTotalNgn - lastWeekTotal) / lastWeekTotal) * 100;
    } else if (currentTotalNgn > 0) {
      percentChange = parseFloat((currentTotalNgn / 10).toFixed(2));
    }

    const percent = Number(percentChange.toFixed(2));

    return {
      weeklyPercentChange: percent,
      trend: percent > 0 ? '1' : percent < 0 ? '2' : '0',
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

    // Filter out unsupported networks (arbitrum, lsk) that should not be exposed to frontend
    const EXCLUDED_NETWORKS = ['arbitrum', 'lsk'];
    return addresses.filter(
      (addr) => !EXCLUDED_NETWORKS.includes(addr.network?.toLowerCase() ?? ''),
    );
  }
}
