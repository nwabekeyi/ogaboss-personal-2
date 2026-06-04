import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { AutoStackInterestScheduler } from './autostack-interest.scheduler';
import { FailedCompanyLiquidityScheduler } from './failed-company-liquidity.scheduler';
import { VaultInterestScheduler } from './vault-interest.scheduler';
import { DailyPercentageScheduler } from './daily-percentage.scheduler';
import { DailyLimitResetScheduler } from './daily-limit-reset.scheduler';
import { CompanyWithdrawalRetryScheduler } from './company-withdrawal-retry.scheduler';
import { BillPaymentRetryScheduler } from './bill-payment-retry.scheduler';

@Injectable()
@Processor(QueueName.CLEANUP, { concurrency: 10 })
export class SchedulerJobsWorker extends WorkerHost {
  private readonly logger = new Logger(SchedulerJobsWorker.name);

  constructor(
    private readonly autoStackScheduler: AutoStackInterestScheduler,
    private readonly failedCompanyLiquidityScheduler: FailedCompanyLiquidityScheduler,
    private readonly vaultInterestScheduler: VaultInterestScheduler,
    private readonly dailyPercentageScheduler: DailyPercentageScheduler,
    private readonly dailyLimitResetScheduler: DailyLimitResetScheduler,
    private readonly companyWithdrawalRetryScheduler: CompanyWithdrawalRetryScheduler,
    private readonly billPaymentRetryScheduler: BillPaymentRetryScheduler,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    switch (job.name) {
      case 'scheduler.autostack-interest':
      case 'scheduler.autostack-interest.dispatch':
        return this.autoStackScheduler.execute();
      case 'scheduler.autostack-interest.shard':
        return this.autoStackScheduler.executeShard(job.data?.ids ?? [], job.data?.asOf);
      case 'scheduler.autostack.charge':
        return this.autoStackScheduler.executeCharge(job.data?.autoStackId);
      case 'scheduler.failed-company-liquidity':
        return this.failedCompanyLiquidityScheduler.execute();
      case 'scheduler.vault-interest':
      case 'scheduler.vault-interest.dispatch':
        return this.vaultInterestScheduler.execute();
      case 'scheduler.vault-interest.shard':
        return this.vaultInterestScheduler.executeShard(job.data?.ids ?? [], job.data?.asOf);
      case 'scheduler.daily-percentage':
        return this.dailyPercentageScheduler.execute();
      case 'scheduler.daily-limit-reset':
        return this.dailyLimitResetScheduler.execute();
      case 'scheduler.company-withdrawal-retry':
        return this.companyWithdrawalRetryScheduler.execute();
      case 'scheduler.bill-payment-retry':
        return this.billPaymentRetryScheduler.execute();
      default:
        this.logger.debug(`Skipping unknown scheduler cleanup job: ${job.name}`);
        return null;
    }
  }
}
