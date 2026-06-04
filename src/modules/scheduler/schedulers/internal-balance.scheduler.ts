import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma/prisma.service';
import { ALLOWED_CURRENCIES } from '../../../shared';
import { CompanyLiquidityService } from '../../transaction/services/company-liquidity.service';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

@Injectable()
export class InternalBalanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(InternalBalanceScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyLiquidityService: CompanyLiquidityService,
  ) {}

  async onModuleInit() {
    if (!isDedicatedSchedulerRuntime()) return;
    await this.calculateInternalBalances();
  }

  @Cron('0 */2 * * *')
  async calculateInternalBalances() {
    if (!isDedicatedSchedulerRuntime()) return;
    this.logger.log('Starting internal balance calculation...');

    for (const currency of ALLOWED_CURRENCIES) {
      const result = await this.prisma.wallet.aggregate({
        where: { currency: currency.toLowerCase() },
        _sum: {
          baseBalance: true,
          lockedAmount: true,
          stackedAmount: true,
          totalStackedInterest: true,
          totalLockedInterest: true,
        },
      });

      const totalInternalBalance = [
        result._sum.baseBalance,
        result._sum.lockedAmount,
        result._sum.stackedAmount,
        result._sum.totalStackedInterest,
        result._sum.totalLockedInterest,
      ].reduce(
        (total, value) => total + BigInt(value?.toFixed(0) || '0'),
        0n,
      );

      await this.prisma.companyLiquidity.upsert({
        where: { currency: currency.toLowerCase() },
        update: { internalBalance: totalInternalBalance.toString() },
        create: {
          currency: currency.toLowerCase(),
          totalBalance: '0',
          reservedBalance: '0',
          internalBalance: totalInternalBalance.toString(),
        },
      });
    }

    await this.companyLiquidityService.syncAllToCache();
    this.logger.log(
      'Internal balance calculation completed and synced to Redis',
    );
  }
}
