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
import {
  BASE_CURRENCY,
  LiquidityReservationStatus,
  toBigInt,
} from '../../../shared';
import {
  CompanyLiquidityService,
  TransactionService,
} from '../../transaction/services';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

type RetryCandidate = {
  id: string;
  paymentMetadata: Record<string, any> | null;
};

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
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
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

    const rows = await this.prisma.$queryRaw<RetryCandidate[]>`
      SELECT "id", "paymentMetadata"
      FROM "transactions"
      WHERE "transactionContext" = ${TransactionContext.BILL_PAYMENT}
        AND "status" = ${TransactionStatus.PENDING}
        AND "paymentMetadata"->>'billingStatus' IN (
          'ORDER_REFERENCE_PERSIST_FAILED',
          'PROVIDER_SUBMIT_FAILED_RETRYABLE',
          'PAYING_RETRY'
        )
      ORDER BY "updatedAt" ASC
      LIMIT ${this.BATCH_SIZE * 4}
    `;

    const dueRows = rows
      .filter((row) => this.isDue(row, now))
      .slice(0, this.BATCH_SIZE);

    for (const row of dueRows) {
      const metadata = (row.paymentMetadata || {}) as Record<string, any>;
      const billingStatus = String(metadata.billingStatus || '').toUpperCase();
      const action =
        billingStatus === 'ORDER_REFERENCE_PERSIST_FAILED'
          ? this.reconcileAcceptedOrder(row.id)
          : this.retryOne(row.id);

      await action.catch((error) => {
        this.logger.error(
          `Bill payment repair failed for transaction ${row.id}: ${error?.message || error}`,
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

  private isDue(row: RetryCandidate, now: Date): boolean {
    const metadata = (row.paymentMetadata || {}) as Record<string, any>;
    const billingStatus = String(metadata.billingStatus || '').toUpperCase();

    if (billingStatus === 'ORDER_REFERENCE_PERSIST_FAILED') {
      return metadata.billingRequiresReconciliation !== false;
    }

    if (billingStatus === 'PROVIDER_SUBMIT_FAILED_RETRYABLE') {
      return this.safeDateDue(metadata.billingNextRetryAt, now, true);
    }

    if (billingStatus === 'PAYING_RETRY') {
      const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
      return this.safeDateDue(metadata.billingRetryLockedAt, staleBefore, true);
    }

    return false;
  }

  private safeDateDue(
    value: unknown,
    dueAt: Date,
    missingIsDue: boolean,
  ): boolean {
    if (!value) return missingIsDue;
    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) return true;
    return timestamp <= dueAt.getTime();
  }

  private async reconcileAcceptedOrder(transactionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "transactions"
        WHERE "id" = ${transactionId}
        FOR UPDATE
      `;

      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { billPayment: true },
      });
      if (!transaction?.billPayment) return;

      const metadata = (transaction.paymentMetadata || {}) as Record<
        string,
        any
      >;
      const billingStatus = String(metadata.billingStatus || '').toUpperCase();
      if (
        transaction.status !== TransactionStatus.PENDING ||
        (billingStatus !== 'ORDER_REFERENCE_PERSIST_FAILED' &&
          metadata.billingRequiresReconciliation !== true)
      ) {
        return;
      }

      const providerReference = String(
        metadata.quidaxOrderReference || metadata.quidaxOrderId || '',
      ).trim();

      if (!providerReference) {
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            paymentMetadata: {
              ...metadata,
              billingStatus: 'ORDER_REFERENCE_RECONCILIATION_FAILED',
              billingManualReviewRequired: true,
              billingRequiresReconciliation: true,
              billingReconciliationReason: 'missing_quidax_order_reference',
              billingReconciliationAttemptedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return;
      }

      const reconciledAt = new Date().toISOString();
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentMetadata: {
            ...metadata,
            billingStatus: 'PROCESSING',
            billingRequiresReconciliation: false,
            billingManualReviewRequired: false,
            billingReconciledAt: reconciledAt,
            quidaxOrderReference: providerReference,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.updateMany({
        where: { transactionId: transaction.id },
        data: {
          referenceNo: providerReference,
          status: 'PROCESSING' as any,
          paymentStatus: 'PENDING' as any,
        },
      });

      await tx.billPayment.update({
        where: { id: transaction.billPayment.id },
        data: { status: 'PROCESSING' as any },
      });
    });
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

      const metadata = (transaction.paymentMetadata || {}) as Record<
        string,
        any
      >;
      const retryCount = Number(metadata.billingRetryCount || 0);
      const retryStatus = String(metadata.billingStatus || '').toUpperCase();
      if (
        transaction.status !== TransactionStatus.PENDING ||
        !['PROVIDER_SUBMIT_FAILED_RETRYABLE', 'PAYING_RETRY'].includes(
          retryStatus,
        ) ||
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
        userId: transaction.userId,
        currency: transaction.currency,
        totalAmountSentBase: transaction.totalAmountSentBase,
        cryptoAmountBase: transaction.cryptoAmountBase,
        fiatAmountBase: transaction.fiatAmountBase,
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
      await this.prisma.$transaction(async (tx) => {
        const failureMetadata = {
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
        } as Record<string, any>;
        let releaseFailed = false;

        if (exhausted) {
          const userReservationAmount = toBigInt(
            claim.metadata.totalSellAmountBase ||
              claim.totalAmountSentBase ||
              claim.cryptoAmountBase ||
              0,
          );
          const liquidityReservationAmount = toBigInt(
            claim.metadata.liquidityReservationAmount ||
              claim.fiatAmountBase ||
              0,
          );

          if (
            userReservationAmount > 0n &&
            failureMetadata.userBalanceReservationStatus !==
              LiquidityReservationStatus.RELEASED
          ) {
            try {
              await this.transactionService.releaseBalance(
                tx,
                claim.userId,
                claim.currency,
                userReservationAmount,
              );
              failureMetadata.userBalanceReservationStatus =
                LiquidityReservationStatus.RELEASED;
              failureMetadata.userBalanceReleasedAt = new Date().toISOString();
              failureMetadata.userBalanceReleaseReason =
                'bill_payment_provider_retry_exhausted';
            } catch (releaseErr: any) {
              failureMetadata.billingManualReviewRequired = true;
              releaseFailed = true;
              failureMetadata.userBalanceReleaseError =
                releaseErr?.message || 'reserved balance release failed';
            }
          }

          if (
            liquidityReservationAmount > 0n &&
            failureMetadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
          ) {
            try {
              await this.companyLiquidityService.releaseLiquidity(
                BASE_CURRENCY,
                liquidityReservationAmount,
                tx,
              );
              failureMetadata.liquidityReservationStatus =
                LiquidityReservationStatus.RELEASED;
              failureMetadata.liquidityReleasedAt = new Date().toISOString();
              failureMetadata.liquidityReleaseReason =
                'bill_payment_provider_retry_exhausted';
            } catch (releaseErr: any) {
              failureMetadata.billingManualReviewRequired = true;
              releaseFailed = true;
              failureMetadata.liquidityReleaseError =
                releaseErr?.message || 'company liquidity release failed';
            }
          }
        }

        await tx.transaction.update({
          where: { id: claim.id },
          data: {
            status:
              exhausted && !releaseFailed
                ? TransactionStatus.FAILED
                : TransactionStatus.PENDING,
            isProcessed: exhausted && !releaseFailed,
            paymentMetadata: failureMetadata as Prisma.InputJsonValue,
          },
        });

        if (exhausted) {
          await tx.billPayment.updateMany({
            where: { transactionId: claim.id },
            data: {
              status: 'FAILED' as any,
              providerResponse: {
                retryExhausted: true,
                error: error?.message || 'unknown',
              },
            },
          });
          await tx.order.updateMany({
            where: { transactionId: claim.id },
            data: {
              status: 'FAILED' as any,
              paymentStatus: 'FAILED' as any,
              gatewayResponse: JSON.stringify({
                retryExhausted: true,
                error: error?.message || 'unknown',
              }),
            },
          });
        }
      });
    }
  }
}
