import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron} from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma/prisma.service';
import { ALLOWED_CURRENCIES } from '../../../shared';
import { CompanyLiquidityService } from '../../transaction/services/company-liquidity.service';

@Injectable()
export class InternalBalanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(InternalBalanceScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyLiquidityService: CompanyLiquidityService,
  ) {}

  async onModuleInit() {
    await this.calculateInternalBalances();
  }

  @Cron('30 0 * * *') // Staggered: 00:30
  async calculateInternalBalances() {
    this.logger.log('Starting internal balance calculation...');

    for (const currency of ALLOWED_CURRENCIES) {
      const result = await this.prisma.wallet.aggregate({
        where: { currency: currency.toLowerCase() },
        _sum: { baseBalance: true },
      });

      const totalInternalBalance = result._sum.baseBalance ?? '0';

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
