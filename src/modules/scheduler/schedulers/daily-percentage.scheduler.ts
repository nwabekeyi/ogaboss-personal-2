import { Injectable, Logger } from '@nestjs/common';
import { Cron} from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { BASE_CURRENCY, ConvertCurrency, toBigInt } from '../../../shared';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';

@Injectable()
export class DailyPercentageScheduler {
  private readonly logger = new Logger(DailyPercentageScheduler.name);
  private readonly BATCH_SIZE = 100;
  private readonly JOB_NAME = 'scheduler.daily-percentage';

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly schedulerState: SchedulerExecutionStateService,
  ) {}

  @Cron('20 0 * * *') // Staggered: 00:20
  async calculateDailyPercentages() {
    try {
      await this.queueService.add(
        QueueName.CLEANUP,
        'scheduler.daily-percentage',
        {},
        { jobId: `scheduler.daily-percentage-${new Date().toISOString().slice(0, 10)}` },
      );
      return;
    } catch {
      // fallback to local execution
    }
    return this.execute();
  }

  async execute() {
    const now = new Date();
    if (!(await this.schedulerState.isDue(this.JOB_NAME, now))) return;
    this.logger.log('Starting daily percentage calculation for all users');

    let processed = 0;
    let offset = 0;

    while (true) {
      const users = await this.prisma.user.findMany({
        select: { id: true },
        skip: offset,
        take: this.BATCH_SIZE,
      });

      if (users.length === 0) break;

      for (const user of users) {
        try {
          await this.calculateForUser(user.id);
          processed++;
        } catch (error) {
          this.logger.error(
            `Failed to calculate daily percentage for user ${user.id}: ${error.message}`,
          );
        }
      }

      offset += this.BATCH_SIZE;
    }
    await this.schedulerState.markExecuted(
      this.JOB_NAME,
      now,
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    );
  }

  private async calculateForUser(userId: string): Promise<void> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        updatedAt: { gte: twoDaysAgo, lt: yesterday },
        status: { in: ['COMPLETED', 'SUCCESS'] },
      },
      select: {
        transactionType: true,
        fiatAmountBase: true,
      },
    });

    const currentTotal = await this.getCurrentTotal(userId);
    let netChange = 0n;

    for (const tx of transactions) {
      const amountNgn = tx.fiatAmountBase ? toBigInt(tx.fiatAmountBase) : 0n;
      if (tx.transactionType === 'CREDIT') {
        netChange += amountNgn;
      } else if (tx.transactionType === 'DEBIT') {
        netChange -= amountNgn;
      }
    }

    const netChangeNumber = Number(netChange) / Math.pow(10, 2);
    const previousTotal = currentTotal - netChangeNumber;

    let percentChange = 0;
    if (previousTotal > 0) {
      percentChange = (netChangeNumber / previousTotal) * 100;
    } else if (currentTotal > 0) {
      percentChange = 100;
    }

    await this.prisma.userDailyPercentage.upsert({
      where: {
        id: `temp_${userId}_${yesterday.toISOString().split('T')[0]}`,
      },
      create: {
        userId,
        percentChangeYesterday: Number(percentChange.toFixed(2)),
        previousTotal: Number(previousTotal.toFixed(2)),
        netChange: netChangeNumber,
        calculatedAt: yesterday,
      },
      update: {
        percentChangeYesterday: Number(percentChange.toFixed(2)),
        previousTotal: Number(previousTotal.toFixed(2)),
        netChange: netChangeNumber,
        calculatedAt: yesterday,
      },
    });
  }

  private async getCurrentTotal(userId: string): Promise<number> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { baseBalance: true, currency: true },
    });

    let totalNaira = 0;

    for (const wallet of wallets) {
      if (wallet.baseBalance && toBigInt(wallet.baseBalance) > 0n) {
        const amountNgn = Number(
          ConvertCurrency.fromBase(toBigInt(wallet.baseBalance), BASE_CURRENCY),
        );
        totalNaira += amountNgn;
      }
    }

    return totalNaira;
  }
}
