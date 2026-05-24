import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import { PaymentType, TransactionContext, TransactionStatus, TransactionType } from '../../../infrastructure/databases/prisma';
import { PaystackService } from '../../../infrastructure/providers/paystack';

@Injectable()
export class AutoStackInterestScheduler {
  private readonly logger = new Logger(AutoStackInterestScheduler.name);
  private readonly BATCH_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly tempStore: TempStoreService,
    private readonly paystackService: PaystackService,
  ) {}

  @Cron('*/10 * * * *')
  async accrueDailyInterest() { try { await this.queueService.add(QueueName.CLEANUP, 'scheduler.autostack-interest.dispatch', {}, { jobId: `scheduler.autostack-interest.dispatch:${new Date().toISOString().slice(0, 16)}` }); return; } catch { return this.execute(); } }

  async execute() { return this.dispatchDueInterestShards(); }

  async dispatchDueInterestShards() {
    const runKey = `lock:scheduler:autostack-interest:dispatch:${new Date().toISOString().slice(0, 10)}`;
    const lockAcquired = await this.tempStore.setNx(runKey, '1', 60 * 20);
    if (!lockAcquired) return;

    const now = new Date();
    const dueStacks = await this.prisma.autoStack.findMany({ where: { status: 'ACTIVE' as any, nextExecutionAt: { lte: now } }, take: this.BATCH_SIZE });
    for (const stack of dueStacks) {
      await this.queueService.add(QueueName.CLEANUP, 'scheduler.autostack.charge', { autoStackId: stack.id }, { jobId: `scheduler.autostack.charge:${stack.id}:${now.toISOString()}` });
    }
  }

  async executeShard(ids: string[], asOfIso: string) { void ids; void asOfIso; return; }

  async executeCharge(autoStackId: string) {
    const stack = await this.prisma.autoStack.findUnique({ where: { id: autoStackId } });
    if (!stack || stack.status !== 'ACTIVE') return;
    const configTx = await this.prisma.transaction.findFirst({ where: { userId: stack.userId, description: `autostack_config:${stack.id}` }, orderBy: { createdAt: 'desc' } });
    if (!configTx) return;
    const meta = (configTx.paymentMetadata || {}) as any;
    if (meta.paymentType !== 'CARD' || !meta.paymentCardId) return;

    const chargeReference = `autostack-charge-${stack.id}-${Date.now()}`;
    await this.prisma.transaction.create({ data: { userId: stack.userId, transactionUniqueId: chargeReference, currency: 'USDT', fiatAmountBase: stack.amount.toFixed(0), transactionType: TransactionType.DEBIT, transactionContext: TransactionContext.BUY, status: TransactionStatus.PENDING, paymentType: PaymentType.CARD, paymentMetadata: { autoStackId: stack.id, mode: 'AUTOSTACK_PERIODIC' } as any, description: `autostack_charge:${stack.id}` } as any });

    await this.paystackService.chargeSavedCard({ paymentCardId: meta.paymentCardId, amount: Number(stack.amount.toFixed(0)), reference: chargeReference, metadata: { autoStackId: stack.id, mode: 'AUTOSTACK_PERIODIC' } });

    const next = new Date(stack.nextExecutionAt);
    if (stack.frequency === 'DAILY') next.setUTCDate(next.getUTCDate() + 1);
    if (stack.frequency === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
    if (stack.frequency === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + 1);
    await this.prisma.autoStack.update({ where: { id: stack.id }, data: { lastExecutedAt: new Date(), nextExecutionAt: next } });
  }
}
