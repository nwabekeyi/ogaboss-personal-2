import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService, RedisService } from '../../../infrastructure';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { ConvertCurrency } from '../../../shared';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';
import {
  BASE_CURRENCY,
  COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY,
  COMPANY_PAYSTACK_NGN_WALLET_ID,
} from '../../../shared/constants';

@Injectable()
export class CompanyPaystackScheduler implements OnModuleInit {
  private readonly logger = new Logger(CompanyPaystackScheduler.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /** Run once at startup */
  async onModuleInit() {
    if (!isDedicatedSchedulerRuntime()) return;
    await this.syncPaystackLiquidity();
  }

  /** Run every minute */
  @Cron('* * * * *')
  async syncPaystackLiquidityCron() {
    if (!isDedicatedSchedulerRuntime()) return;
    await this.syncPaystackLiquidity();
  }

  private async syncPaystackLiquidity() {
    try {
      const response = await this.paystackService.getBalance({
        skipCircuitBreaker: true,
      });
      if (!response.status) {
        this.logger.warn('Failed to fetch Paystack balance');
        return;
      }

      const ngnWallet = response.data.find(
        (item) => item.currency === BASE_CURRENCY.toUpperCase(),
      );

      if (!ngnWallet) {
        this.logger.warn('No NGN wallet found in Paystack balance');
        return;
      }

      const balanceInKobo = ngnWallet.balance;
      const balanceInNaira = balanceInKobo / 100;

      const totalBalanceBase = ConvertCurrency.toBase(
        balanceInNaira.toString(),
        BASE_CURRENCY,
        undefined,
      ).toString();

      const paystackLiquidity = await this.prisma.companyLiquidity.upsert({
        where: { id: COMPANY_PAYSTACK_NGN_WALLET_ID },
        update: {
          network: null,
          totalBalance: totalBalanceBase,
          updatedAt: new Date(),
        },
        create: {
          id: COMPANY_PAYSTACK_NGN_WALLET_ID,
          totalBalance: totalBalanceBase,
          reservedBalance: '0',
          currency: BASE_CURRENCY,
          network: null,
        },
      });

      await this.redisService.set(COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY, {
        id: COMPANY_PAYSTACK_NGN_WALLET_ID,
        currency: BASE_CURRENCY,
        totalBalance: paystackLiquidity.totalBalance.toString(),
        reservedBalance: paystackLiquidity.reservedBalance.toString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed syncing Paystack liquidity', error);
    }
  }
}
