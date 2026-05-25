import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import { PaymentType, TransactionContext, TransactionStatus, TransactionType } from '../../../infrastructure/databases/prisma';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { TransactionService, CompanyLiquidityService } from '../../transaction/services';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import { QUIDAX_COMPANY_USERID } from '../../transaction/constants';

@Injectable()
export class AutoStackInterestScheduler {
  private readonly logger = new Logger(AutoStackInterestScheduler.name);
  private readonly BATCH_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly tempStore: TempStoreService,
    private readonly paystackService: PaystackService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly quidaxSwapService: QuidaxSwapService,
  ) {}

  @Cron('*/10 * * * *')
  async accrueDailyInterest() {
    try {
      await this.queueService.add(QueueName.CLEANUP, 'scheduler.autostack-interest.dispatch', {}, { jobId: `scheduler.autostack-interest.dispatch:${new Date().toISOString().slice(0, 16)}` });
      return;
    } catch (error) {
      this.logger.error('Failed to enqueue autostack dispatch job', error as any);
      throw error;
    }
  }

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

    const now = new Date();
    if (stack.nextExecutionAt > now) return;

    const configTx = await this.prisma.transaction.findFirst({ where: { userId: stack.userId, description: `autostack_config:${stack.id}` }, orderBy: { createdAt: 'desc' } });
    if (!configTx) return;
    const meta = (configTx.paymentMetadata || {}) as any;

    const isDueDate = stack.nextInterestAt <= now;
    if (isDueDate) {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findFirst({ where: { userId: stack.userId, currency: 'USDT' } });
        if (!wallet) throw new Error(`USDT wallet not found for autostack ${stack.id}`);

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

        await tx.autoStack.update({ where: { id: stack.id }, data: { status: 'ENDED' as any, endedAt: now, lastExecutedAt: now } });

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
    const days = stack.frequency === 'DAILY' ? 1 : stack.frequency === 'WEEKLY' ? 7 : 30;
    const principal = Number(stack.amount.toFixed(0));
    const interest = Math.floor(principal * (dailyRate / 100) * days);

    await this.prisma.$transaction(async (tx) => {
      await tx.autoStack.update({ where: { id: stack.id }, data: { accruedInterest: { increment: interest }, nextInterestAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } });
      const wallet = await tx.wallet.findFirst({ where: { userId: stack.userId, currency: 'USDT' } });
      if (wallet) {
        await tx.wallet.update({ where: { id: wallet.id }, data: { totalStackedInterest: { increment: interest } } });
      }
      await tx.$executeRaw`
        UPDATE "company_liquidity"
        SET "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${interest}::decimal
        WHERE "currency" = 'USDT'
      `;
    });

    await this.prisma.$transaction(async (tx) => {
      await this.transactionService.reserveBalance(tx as any, stack.userId, 'USDT', BigInt(principal));
      const reservedLiquidity = await this.companyLiquidityService.reserveLiquidity('NGN', BigInt(principal), tx as any);
      if (!reservedLiquidity) throw new Error('Insufficient company NGN liquidity for autostack charge');
    });

    const chargeReference = `autostack-charge-${stack.id}-${Date.now()}`;
    const paymentType = meta.paymentType === 'CRYPTO_WALLET' ? PaymentType.CRYPTO_WALLET : PaymentType.CARD;
    await this.prisma.transaction.create({ data: { userId: stack.userId, transactionUniqueId: chargeReference, currency: 'USDT', fiatAmountBase: stack.amount.toFixed(0), transactionType: TransactionType.DEBIT, transactionContext: TransactionContext.AUTOSTACK, status: TransactionStatus.PENDING, paymentType, paymentMetadata: { autoStackId: stack.id, mode: 'AUTOSTACK_PERIODIC', targetAsset: meta.targetAsset || 'USDT', liquidityReservationStatus: 'RESERVED' } as any, description: `autostack_charge:${stack.id}` } as any });

    await this.prisma.$executeRaw`
      UPDATE "company_liquidity"
      SET "totalAmountStacked" = "totalAmountStacked" + ${stack.amount.toFixed(0)}::decimal
      WHERE "currency" = 'USDT'
    `;

    if (meta.paymentType === 'CRYPTO_WALLET') {
      const swapQuote = await this.quidaxSwapService.createInstantSwapRequest(QUIDAX_COMPANY_USERID, { from_currency: String(meta.targetAsset || 'usdt').toLowerCase(), to_currency: 'usdt', from_amount: String(principal) }, { skipCircuitBreaker: true });
      const quotationId = swapQuote?.data?.swap_quotation?.id;
      if (!quotationId) throw new Error('Unable to create periodic autostack swap quotation');
      await this.quidaxSwapService.confirmInstantSwap({ user_id: QUIDAX_COMPANY_USERID, quotation_id: quotationId }, { skipCircuitBreaker: true });
    } else {
      if (!meta.paymentCardId) return;
      await this.paystackService.chargeSavedCard({ paymentCardId: meta.paymentCardId, amount: Number(stack.amount.toFixed(0)), reference: chargeReference, metadata: { autoStackId: stack.id, mode: 'AUTOSTACK_PERIODIC' } });
    }

    const next = new Date(stack.nextExecutionAt);
    if (stack.frequency === 'DAILY') next.setUTCDate(next.getUTCDate() + 1);
    if (stack.frequency === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
    if (stack.frequency === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + 1);
    await this.prisma.autoStack.update({ where: { id: stack.id }, data: { lastExecutedAt: now, nextExecutionAt: next } });
  }

}
