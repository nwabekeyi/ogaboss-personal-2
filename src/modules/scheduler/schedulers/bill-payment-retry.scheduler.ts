import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  Prisma,
  PrismaService,
  TransactionContext,
  TransactionStatus,
} from '../../../infrastructure/databases/prisma';
import { XpresspayService } from '../../../infrastructure/providers/xpresspay/xpresspay.service';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

@Injectable()
export class BillPaymentRetryScheduler {
  private readonly logger = new Logger(BillPaymentRetryScheduler.name);
  private readonly JOB_NAME = 'scheduler.bill-payment-retry';
  private readonly BATCH_SIZE = 25;
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpresspayService: XpresspayService,
    private readonly queueService: QueueService,
    private readonly schedulerState: SchedulerExecutionStateService,
  ) {}

  @Cron('*/15 * * * *')
  async retryBillPaymentsCron() {
    if (!isDedicatedSchedulerRuntime()) return;
    try {
      await this.queueService.add(
        QueueName.CLEANUP,
        this.JOB_NAME,
        {},
        {
          jobId: `${this.JOB_NAME}-${new Date().toISOString().slice(0, 16).replace(':', '-')}`,
        },
      );
      return;
    } catch {
      return this.execute();
    }
  }

  async execute() {
    const now = new Date();
    if (!(await this.schedulerState.isDue(this.JOB_NAME, now))) return;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "transactions"
      WHERE "transactionContext" = ${TransactionContext.BILL_PAYMENT}
        AND "status" = ${TransactionStatus.PENDING}
        AND (
          (
            "paymentMetadata"->>'billingStatus' = 'PROVIDER_SUBMIT_FAILED_RETRYABLE'
            AND COALESCE(("paymentMetadata"->>'billingNextRetryAt')::timestamptz, NOW()) <= NOW()
          )
          OR (
            "paymentMetadata"->>'billingStatus' = 'PAYING_RETRY'
            AND COALESCE(("paymentMetadata"->>'billingRetryLockedAt')::timestamptz, NOW() - INTERVAL '1 hour') <= NOW() - INTERVAL '15 minutes'
          )
        )
      ORDER BY "updatedAt" ASC
      LIMIT ${this.BATCH_SIZE}
    `;

    for (const row of rows) {
      await this.retryOne(row.id).catch((error) => {
        this.logger.error(
          `Bill payment retry failed for transaction ${row.id}: ${error?.message || error}`,
          error?.stack,
        );
      });
    }

    await this.schedulerState.markExecuted(
      this.JOB_NAME,
      now,
      new Date(now.getTime() + 15 * 60 * 1000),
    );
  }

  private async retryOne(transactionId: string): Promise<void> {
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "transactions"
        WHERE "id" = ${transactionId}
        FOR UPDATE
      `;

      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { billPayment: true },
      });
      if (!transaction?.billPayment) return null;

      const metadata = (transaction.paymentMetadata || {}) as Record<string, any>;
      const retryCount = Number(metadata.billingRetryCount || 0);
      const retryStatus = String(metadata.billingStatus || '').toUpperCase();
      if (
        transaction.status !== TransactionStatus.PENDING ||
        !['PROVIDER_SUBMIT_FAILED_RETRYABLE', 'PAYING_RETRY'].includes(retryStatus) ||
        retryCount >= this.MAX_ATTEMPTS
      ) {
        return null;
      }

      const nextMetadata = {
        ...metadata,
        billingStatus: 'PAYING_RETRY',
        billingRetryLockedAt: new Date().toISOString(),
        billingRequiresRetry: true,
      };

      await tx.transaction.update({
        where: { id: transaction.id },
        data: { paymentMetadata: nextMetadata as Prisma.InputJsonValue },
      });

      return {
        id: transaction.id,
        retryCount,
        metadata: nextMetadata,
      };
    });

    if (!claim) return;

    try {
      const providerResponse = await this.xpresspayService.payBill({
        amount: String(claim.metadata.billAmountNgn || 0),
        category: claim.metadata.category,
        billerCode: claim.metadata.billerCode,
        customerReference: claim.metadata.customerReference,
        productCode: claim.metadata.productCode,
        reference: claim.id,
      });

      await this.prisma.$transaction([
        this.prisma.transaction.update({
          where: { id: claim.id },
          data: {
            paymentMetadata: {
              ...claim.metadata,
              billingStatus: 'PROVIDER_SUBMITTED',
              billingRequiresRetry: false,
              billingRetriedAt: new Date().toISOString(),
              xpresspayResponse: providerResponse,
              xpresspaySubmittedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        }),
        this.prisma.billPayment.updateMany({
          where: { transactionId: claim.id },
          data: { status: 'PROCESSING', providerResponse },
        }),
      ]);
    } catch (error: any) {
      const nextAttempt = claim.retryCount + 1;
      const exhausted = nextAttempt >= this.MAX_ATTEMPTS;
      const delayMinutes = Math.min(60, 2 ** nextAttempt * 5);
      const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await this.prisma.transaction.update({
        where: { id: claim.id },
        data: {
          status: TransactionStatus.PENDING,
          isProcessed: false,
          paymentMetadata: {
            ...claim.metadata,
            billingStatus: exhausted
              ? 'PROVIDER_SUBMIT_RETRY_EXHAUSTED'
              : 'PROVIDER_SUBMIT_FAILED_RETRYABLE',
            billingRequiresRetry: !exhausted,
            billingManualReviewRequired: exhausted,
            billingRetryCount: nextAttempt,
            billingNextRetryAt: exhausted ? null : nextRetryAt.toISOString(),
            billingFailureAt: new Date().toISOString(),
            billingFailureReason: error?.message || 'unknown',
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}
