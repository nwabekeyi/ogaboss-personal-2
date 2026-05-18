import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QuidaxTickerScheduler } from './schedulers/quidax-ticker.scheduler';
import { DashboardScheduler } from './schedulers/admin-dashboard.scheduler';
import { PaystackBanksScheduler } from './schedulers/paystack-banks.scheduler';
import { CompanyWalletScheduler } from './schedulers/company-wallet.scheduler';
import { CompanyPaystackScheduler } from './schedulers/paystack-balance.scheduler';
import { FailedCompanyLiquidityScheduler } from './schedulers/failed-company-liquidity.scheduler';
import { DailyLimitResetScheduler } from './schedulers/daily-limit-reset.scheduler';
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly quidaxTickerScheduler: QuidaxTickerScheduler,
    private readonly dashboardScheduler: DashboardScheduler,
    private readonly paystackBanksScheduler: PaystackBanksScheduler,
    private readonly companyNgnWalletScheduler: CompanyWalletScheduler,
    private readonly companyPaystackBalance: CompanyPaystackScheduler,
    private readonly failedCompanyLiquidityScheduler: FailedCompanyLiquidityScheduler,
    private readonly dailyLimitResetScheduler: DailyLimitResetScheduler,
  ) {}

  onModuleInit() {
    this.logger.log('Global Scheduler Service Started');
  }
}
