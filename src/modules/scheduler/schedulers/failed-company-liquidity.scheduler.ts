import { Injectable, Logger } from '@nestjs/common';
import { Cron} from '@nestjs/schedule';
import { FailedCompanyLiquidityService } from '../../transaction/services';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

@Injectable()
export class FailedCompanyLiquidityScheduler {
  private readonly logger = new Logger(FailedCompanyLiquidityScheduler.name);
  private readonly JOB_NAME = 'scheduler.failed-company-liquidity';

  constructor(
    private readonly failedCompanyLiquidityService: FailedCompanyLiquidityService,
    private readonly queueService: QueueService,
    private readonly schedulerState: SchedulerExecutionStateService,
  ) {}

  @Cron('45 * * * *') // Staggered: every hour at :45
  async retryFailedCompanyTransactions() {
    if (!isDedicatedSchedulerRuntime()) return;
    try {
      await this.queueService.add(QueueName.CLEANUP, 'scheduler.failed-company-liquidity', {}, { jobId: `scheduler.failed-company-liquidity-${new Date().toISOString().slice(0,13)}` });
      return;
    } catch {
      return this.execute();
    }
  }

  async execute() {
    const now = new Date();
    if (!(await this.schedulerState.isDue(this.JOB_NAME, now))) return;
    const result = await this.failedCompanyLiquidityService.autoProcessEligible(25);
    if (result.processed > 0) {
      this.logger.log(`Auto-processed ${result.processed} failed company-liquidity transactions (scanned ${result.scanned})`);
    }
    await this.schedulerState.markExecuted(
      this.JOB_NAME,
      now,
      new Date(now.getTime() + 60 * 60 * 1000),
    );
  }
}
