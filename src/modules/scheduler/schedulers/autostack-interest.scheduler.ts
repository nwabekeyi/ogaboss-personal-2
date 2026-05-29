import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import { AutoStackService } from '../../autostack/services/autostack.service';

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
    if (!stack || !['PENDING', 'ACTIVE'].includes(String(stack.status))) return;

    const now = new Date();
    if (stack.nextExecutionAt > now) return;

    const configTx = await this.prisma.transaction.findFirst({
      where: {
        userId: stack.userId,
        description: `autostack_config:${stack.id}`,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!configTx) return;
    if (stack.status === 'PENDING') {
      return this.autoStackService.initiateAutoStack(stack.id);
    }

    if (stack.status === 'PENDING') {
      return this.initiatePendingAutoStack(stack, configTx, meta, now);
    }

    const isDueDate = stack.nextInterestAt <= now;
    if (isDueDate) {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findFirst({
          where: { userId: stack.userId, currency: 'USDT' },
        });
        if (!wallet)
          throw new Error(`USDT wallet not found for autostack ${stack.id}`);

        const principal = BigInt(stack.amount.toFixed(0));
        const interestAccrued = BigInt(stack.accruedInterest.toFixed(0));
        const payout = principal + interestAccrued;

        await tx.$executeRaw`
          UPDATE "wallets"
          SET "baseBalance" = "baseBalance" + ${payout.toString()}::decimal,
              "stackedAmount" = GREATEST("stackedAmount" - ${principal.toString()}::decimal, 0),
              "totalStackedInterest" = GREATEST("totalStackedInterest" - ${interestAccrued.toString()}::decimal, 0)
          WHERE "id" = ${wallet.id}
        `;

        await tx.autoStack.update({
          where: { id: stack.id },
          data: { status: 'ENDED' as any, endedAt: now, lastExecutedAt: now },
        });

        await tx.$executeRaw`
          UPDATE "company_liquidity"
          SET "totalAmountStacked" = GREATEST("totalAmountStacked" - ${principal.toString()}::decimal, 0),
              "totalAccruedLockedInterest" = GREATEST("totalAccruedLockedInterest" - ${interestAccrued.toString()}::decimal, 0),
              "totalStackedInterestPaid" = "totalStackedInterestPaid" + ${interestAccrued.toString()}::decimal,
              "totalInterestPaid" = "totalInterestPaid" + ${interestAccrued.toString()}::decimal
          WHERE "currency" = 'USDT'
        `;
      });
      return;
    }

    const setting = await this.prisma.autoStackingSettings.findFirst();
    const dailyRate = setting?.dailyInterestRatePercent?.toNumber() || 0;
    const days =
      stack.frequency === 'DAILY' ? 1 : stack.frequency === 'WEEKLY' ? 7 : 30;
    const principal = Number(stack.amount.toFixed(0));
    const interest = Math.floor(principal * (dailyRate / 100) * days);

    await this.prisma.$transaction(async (tx) => {
      await tx.autoStack.update({
        where: { id: stack.id },
        data: {
          accruedInterest: { increment: interest },
          nextInterestAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      const wallet = await tx.wallet.findFirst({
        where: { userId: stack.userId, currency: 'USDT' },
      });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { totalStackedInterest: { increment: interest } },
        });
      }
      await tx.$executeRaw`
        UPDATE "company_liquidity"
        SET "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${interest}::decimal
        WHERE "currency" = 'USDT'
      `;
    });
  }
}
