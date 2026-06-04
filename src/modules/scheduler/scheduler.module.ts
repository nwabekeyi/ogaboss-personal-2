import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { QuidaxTickerScheduler } from './schedulers/quidax-ticker.scheduler';
import { DashboardScheduler } from './schedulers/admin-dashboard.scheduler';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { DashboardStatsService } from '../dashboard/service/dashboard-stats.service';
import { PaystackBanksScheduler } from './schedulers/paystack-banks.scheduler';
import { PaystackModule } from '../../infrastructure/providers/paystack';
import { CompanyWalletScheduler } from './schedulers/company-wallet.scheduler';
import { CompanyPaystackScheduler } from './schedulers/paystack-balance.scheduler';
import { FailedCompanyLiquidityScheduler } from './schedulers/failed-company-liquidity.scheduler';
import { TransactionModule } from '../transaction/transaction.module';
import { DailyPercentageScheduler } from './schedulers/daily-percentage.scheduler';
import { DailyLimitResetScheduler } from './schedulers/daily-limit-reset.scheduler';
import { WebhooksModule } from '../webhook/webhook.module';
import { CompanyWithdrawalRetryScheduler } from './schedulers/company-withdrawal-retry.scheduler';
import { InternalBalanceScheduler } from './schedulers/internal-balance.scheduler';
import { VaultInterestScheduler } from './schedulers/vault-interest.scheduler';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from '../../infrastructure/bullMQ/bullmq.service';
import { AutoStackInterestScheduler } from './schedulers/autostack-interest.scheduler';
import { SchedulerJobsWorker } from './schedulers/scheduler-jobs.worker';
import { SchedulerExecutionStateService } from './scheduler-execution-state.service';
import { AutoStackModule } from '../autostack/autostack.module';
import { isDedicatedSchedulerRuntime } from './scheduler-runtime.util';
import { XpresspayModule } from '../../infrastructure/providers/xpresspay/xpresspay.module';
import { BillPaymentRetryScheduler } from './schedulers/bill-payment-retry.scheduler';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    QuidaxModule,
    PaystackModule,
    TransactionModule,
    WebhooksModule,
    AutoStackModule,
    XpresspayModule,
    BullModule,
  ],
  providers: [
    SchedulerService,
    QuidaxTickerScheduler,
    DashboardScheduler,
    DashboardStatsService,
    PaystackBanksScheduler,
    CompanyWalletScheduler,
    CompanyPaystackScheduler,
    FailedCompanyLiquidityScheduler,
    DailyPercentageScheduler,
    DailyLimitResetScheduler,
    CompanyWithdrawalRetryScheduler,
    InternalBalanceScheduler,
    VaultInterestScheduler,
    BillPaymentRetryScheduler,
    QueueService,
    AutoStackInterestScheduler,
    ...(isDedicatedSchedulerRuntime() ? [SchedulerJobsWorker] : []),
    SchedulerExecutionStateService,
  ],
  exports: [SchedulerService, QueueService],
})
export class SchedulerModule {}
