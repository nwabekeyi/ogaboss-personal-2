import { Injectable, Logger } from '@nestjs/common';
import { Cron} from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

@Injectable()
export class DailyLimitResetScheduler {
  private readonly logger = new Logger(DailyLimitResetScheduler.name);
  private readonly JOB_NAME = 'scheduler.daily-limit-reset';

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerState: SchedulerExecutionStateService,
    private readonly queueService: QueueService,
  ) {}

  @Cron('0 12 * * *')
  async resetDailyLimits() {
    if (!isDedicatedSchedulerRuntime()) return;
    try {
      await this.queueService.add(QueueName.CLEANUP, this.JOB_NAME, {}, { jobId: `${this.JOB_NAME}-${new Date().toISOString().slice(0,16)}` });
      return;
    } catch {}
    return this.execute();
  }

  async execute() {
    const now = new Date();
    if (!(await this.schedulerState.isDue(this.JOB_NAME, now))) return;
    this.logger.log('Starting daily limit reset for all users');

    const result = await this.prisma.userDailyTransaction.deleteMany({
      where: {
        date: {
          lt: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    });

    this.logger.log(`Reset daily limits: deleted ${result.count} old records`);
    await this.schedulerState.markExecuted(
      this.JOB_NAME,
      now,
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    );
  }
}
