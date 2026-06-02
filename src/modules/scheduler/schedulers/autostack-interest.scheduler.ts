import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import { AutoStackService } from '../../autostack/services/autostack.service';
import Decimal from 'decimal.js';

@Injectable()
export class AutoStackInterestScheduler {
  private readonly logger = new Logger(AutoStackInterestScheduler.name);
  private readonly BATCH_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly tempStore: TempStoreService,
    private readonly autoStackService: AutoStackService,
  ) {}

  @Cron('*/10 * * * *')
  async accrueDailyInterest() {
    try {
      await this.queueService.add(
        QueueName.CLEANUP,
        'scheduler.autostack-interest.dispatch',
        {},
        {
          jobId: `scheduler.autostack-interest.dispatch-${new Date().toISOString().slice(0, 16).replace(':', '-')}`,
        },
      );
      return;
    } catch (error) {
      this.logger.error(
        'Failed to enqueue autostack dispatch job',
        error as any,
      );
      throw error;
    }
  }

  async execute() {
    return this.dispatchDueInterestShards();
  }

  async dispatchDueInterestShards() {
    const runKey = `lock:scheduler:autostack-interest:dispatch:${new Date().toISOString().slice(0, 10)}`;
    const lockAcquired = await this.tempStore.setNx(runKey, '1', 60 * 20);
    if (!lockAcquired) return;

    const now = new Date();
    const dueStacks = await this.prisma.autoStack.findMany({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] as any },
        nextExecutionAt: { lte: now },
      },
      take: this.BATCH_SIZE,
    });
    for (const stack of dueStacks) {
      await this.queueService.add(
        QueueName.CLEANUP,
        'scheduler.autostack.charge',
        { autoStackId: stack.id },
        {
          jobId: `scheduler.autostack.charge-${stack.id}-${now.toISOString().replace(/:/g, '-')}`,
        },
      );
    }
  }

  async executeShard(ids: string[], asOfIso: string) {
    void ids;
    void asOfIso;
    return;
  }

  async executeCharge(autoStackId: string) {
    const stack = await this.prisma.autoStack.findUnique({
      where: { id: autoStackId },
    });
    const stackStatus = String(stack?.status || '');
    if (!stack || !['PENDING', 'ACTIVE'].includes(stackStatus)) return;

    const now = new Date();
    if (!this.autoStackService.isExecutionDue(stack.nextExecutionAt, now))
      return;

    if (stackStatus === 'PENDING') {
      return this.autoStackService.initiateAutoStack(stack.id);
    }

    const setting = await this.prisma.autoStackingSettings.findFirst();
    const dailyRate = new Decimal(
      setting?.dailyInterestRatePercent?.toString() || '0',
    );
    const days =
      stack.frequency === 'DAILY' ? 1 : stack.frequency === 'WEEKLY' ? 7 : 30;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "auto_stacks"
        WHERE "id" = ${stack.id}
        FOR UPDATE
      `;
      const freshStack = await tx.autoStack.findUnique({
        where: { id: stack.id },
        select: { amount: true, nextInterestAt: true },
      });
      if (!freshStack || freshStack.nextInterestAt > now) return;

      const principal = new Decimal(freshStack.amount.toFixed(0));
      const interest = BigInt(
        principal
          .mul(dailyRate)
          .div(100)
          .mul(days)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );
      const nextInterestAt = new Date(now);
      nextInterestAt.setUTCDate(nextInterestAt.getUTCDate() + days);

      await tx.autoStack.update({
        where: { id: stack.id },
        data: {
          accruedInterest: { increment: interest.toString() },
          nextInterestAt,
        },
      });
      const wallet = await tx.wallet.findFirst({
        where: { userId: stack.userId, currency: 'USDT' },
      });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { totalStackedInterest: { increment: interest.toString() } },
        });
      }
      await tx.$executeRaw`
        UPDATE "company_liquidity"
        SET "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${interest.toString()}::decimal
        WHERE "currency" = 'USDT'
      `;
    });

    await this.autoStackService.initiateAutoStack(stack.id, { force: true });
  }
}
