import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import {
  PaymentType,
  Prisma,
  TransactionStatus,
} from '../../../infrastructure/databases/prisma';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import {
  TransactionService,
  CompanyLiquidityService,
} from '../../transaction/services';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import { QUIDAX_COMPANY_USERID } from '../../transaction/constants';
import { ConvertCurrency, LiquidityReservationStatus } from '../../../shared';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

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
    private readonly tickerService: QuidaxTickerService,
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

  private getNextExecutionAt(stack: any, from: Date): Date {
    const next = new Date(from);
    if (stack.frequency === 'DAILY') next.setUTCDate(next.getUTCDate() + 1);
    if (stack.frequency === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
    if (stack.frequency === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private getInterestDate(stack: any, from: Date): Date {
    const next = new Date(from);
    const days =
      stack.frequency === 'DAILY' ? 1 : stack.frequency === 'WEEKLY' ? 7 : 30;
    next.setUTCDate(next.getUTCDate() + days);
    return next;
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
    const meta = (configTx.paymentMetadata || {}) as any;

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

  private async initiatePendingAutoStack(
    stack: any,
    configTx: any,
    meta: Record<string, any>,
    now: Date,
  ) {
    if (
      ['PROCESSING', 'SUBMITTED', 'COMPLETED'].includes(
        String(meta.autostackInitiationStatus || '').toUpperCase(),
      )
    )
      return;

    const paymentType =
      meta.paymentType === 'CRYPTO_WALLET'
        ? PaymentType.CRYPTO_WALLET
        : PaymentType.CARD;
    const sourceAsset = String(
      meta.sourceAsset ||
        (paymentType === PaymentType.CRYPTO_WALLET
          ? configTx.currency
          : 'USDT'),
    ).toUpperCase();
    const principalUsdtBase = BigInt(
      String(meta.principalUsdtAmountBase || stack.amount.toFixed(0)),
    );
    const principalUsdtOriginal = String(
      meta.principalUsdtAmount ||
        configTx.cryptoAmountOriginal ||
        Number(principalUsdtBase) / 1_000_000,
    );
    const sourceAmountBase = BigInt(
      String(
        meta.sourceAmountBase || configTx.cryptoAmountBase || principalUsdtBase,
      ),
    );
    const sourceAmountOriginal = String(
      meta.sourceAmount ||
        meta.totalChargeAmount ||
        configTx.cryptoAmountOriginal ||
        principalUsdtOriginal,
    );
    const processingMetadata = {
      ...meta,
      autostackInitiationStatus: 'PROCESSING',
      autostackInitiatedAt: now.toISOString(),
    };

    await this.prisma.transaction.update({
      where: { id: configTx.id },
      data: { paymentMetadata: processingMetadata as Prisma.InputJsonValue },
    });

    try {
      if (paymentType === PaymentType.CRYPTO_WALLET) {
        await this.prisma.$transaction(async (tx) => {
          await this.transactionService.reserveBalance(
            tx as any,
            stack.userId,
            sourceAsset,
            sourceAmountBase,
          );
          const reservedLiquidity =
            await this.companyLiquidityService.reserveLiquidity(
              sourceAsset,
              sourceAmountBase,
              tx as any,
            );
          if (!reservedLiquidity)
            throw new Error(
              `Insufficient company ${sourceAsset} liquidity for autostack`,
            );
          await tx.transaction.update({
            where: { id: configTx.id },
            data: {
              cryptoAmountBase: sourceAmountBase.toString(),
              cryptoAmountOriginal: sourceAmountOriginal,
              fiatAmountBase: principalUsdtBase.toString(),
              fiatAmountOriginal: principalUsdtOriginal,
              paymentMetadata: {
                ...processingMetadata,
                liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
                liquidityReservationCurrency: sourceAsset,
                liquidityReservationAmount: sourceAmountBase.toString(),
              } as Prisma.InputJsonValue,
            },
          });
        });

        if (sourceAsset === 'USDT') {
          await this.prisma.$transaction(async (tx) => {
            const usdtWallet = await tx.wallet.findFirst({
              where: { userId: stack.userId, currency: 'USDT' },
            });
            if (!usdtWallet)
              throw new Error(
                `USDT wallet not found for autostack ${stack.id}`,
              );
            await tx.$executeRaw`
              UPDATE "wallets"
              SET "reservedBalance" = GREATEST("reservedBalance" - ${sourceAmountBase.toString()}::decimal, 0),
                  "stackedAmount" = "stackedAmount" + ${sourceAmountBase.toString()}::decimal
              WHERE "id" = ${usdtWallet.id}
            `;
            await this.companyLiquidityService.releaseLiquidity(
              'USDT',
              sourceAmountBase,
              tx as any,
            );
            await tx.$executeRaw`
              UPDATE "company_liquidity"
              SET "totalAmountStacked" = "totalAmountStacked" + ${sourceAmountBase.toString()}::decimal
              WHERE LOWER("currency") = LOWER('USDT')
            `;
            await tx.autoStack.update({
              where: { id: stack.id },
              data: {
                amount: sourceAmountBase.toString(),
                status: 'ACTIVE' as any,
                lastExecutedAt: now,
                nextExecutionAt: this.getNextExecutionAt(stack, now),
                nextInterestAt: this.getInterestDate(stack, now),
              },
            });
            await tx.transaction.update({
              where: { id: configTx.id },
              data: {
                status: TransactionStatus.COMPLETED,
                isProcessed: true,
                executedAt: now,
                paymentMetadata: {
                  ...processingMetadata,
                  liquidityReservationStatus:
                    LiquidityReservationStatus.RELEASED,
                  liquidityReservationCurrency: 'USDT',
                  liquidityReservationAmount: sourceAmountBase.toString(),
                  liquidityReleasedAt: now.toISOString(),
                  liquidityReleaseReason: 'autostack_usdt_wallet_settled',
                  autostackInitiationStatus: 'COMPLETED',
                  autostackSettlement: 'wallet_completed',
                } as Prisma.InputJsonValue,
              },
            });
          });
          return;
        }

        const swapQuote = await this.quidaxSwapService.createInstantSwapRequest(
          QUIDAX_COMPANY_USERID,
          {
            from_currency: sourceAsset.toLowerCase(),
            to_currency: 'usdt',
            from_amount: sourceAmountOriginal,
          },
          { skipCircuitBreaker: true },
        );
        const quotationId =
          swapQuote?.data?.id || swapQuote?.data?.swap_quotation?.id;
        if (!quotationId)
          throw new Error('Unable to create autostack swap quotation');
        const confirmedSwap = await this.quidaxSwapService.confirmInstantSwap(
          { user_id: QUIDAX_COMPANY_USERID, quotation_id: quotationId },
          { skipCircuitBreaker: true },
        );
        const swapId = confirmedSwap?.data?.id || quotationId;
        await this.prisma.$transaction(async (tx) => {
          const fresh = await tx.transaction.findUnique({
            where: { id: configTx.id },
            select: { paymentMetadata: true },
          });
          await tx.swapTransaction.create({
            data: {
              userId: stack.userId,
              quidaxAccountId: QUIDAX_COMPANY_USERID,
              fromCurrency: sourceAsset,
              toCurrency: 'USDT',
              amountOriginal: sourceAmountOriginal,
              quoteId: configTx.transactionUniqueId,
              swapId,
              status: TransactionStatus.PENDING,
              description: `Autostack swap ${sourceAsset} → USDT`,
            },
          });
          await tx.transaction.update({
            where: { id: configTx.id },
            data: {
              paymentMetadata: {
                ...((fresh?.paymentMetadata || {}) as any),
                autostackInitiationStatus: 'SUBMITTED',
                autostackSwapQuotationId: quotationId,
                autostackSwapId: swapId,
              } as Prisma.InputJsonValue,
            },
          });
        });
        return;
      }

      if (!meta.paymentCardId)
        throw new Error('Payment card is required for card autostack');
      const usdtNgnRate = await this.tickerService.getPrice('usdtngn');
      if (!usdtNgnRate)
        throw new Error('Unable to fetch USDT/NGN rate for autostack');
      const ngnAmountOriginal = (
        Number(principalUsdtOriginal) * Number(usdtNgnRate)
      ).toFixed(2);
      const ngnAmountBase = ConvertCurrency.toBase(ngnAmountOriginal, 'NGN');
      const chargeReference = configTx.transactionUniqueId;

      await this.prisma.$transaction(async (tx) => {
        const reservedLiquidity =
          await this.companyLiquidityService.reserveLiquidity(
            'NGN',
            ngnAmountBase,
            tx as any,
          );
        if (!reservedLiquidity)
          throw new Error(
            'Insufficient company NGN liquidity for autostack card charge',
          );
        await tx.transaction.update({
          where: { id: configTx.id },
          data: {
            currency: 'USDT',
            cryptoAmountBase: principalUsdtBase.toString(),
            cryptoAmountOriginal: principalUsdtOriginal,
            fiatAmountBase: ngnAmountBase.toString(),
            fiatAmountOriginal: ngnAmountOriginal,
            paymentMetadata: {
              ...processingMetadata,
              paymentType,
              sourceAsset,
              targetAsset: 'USDT',
              autostackFlow: 'PAYSTACK_CARD_TO_BUY_ORDER',
              liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
              liquidityReservationCurrency: 'NGN',
              liquidityReservationAmount: ngnAmountBase.toString(),
              usdtNgnRate,
            } as Prisma.InputJsonValue,
          },
        });
      });

      await this.paystackService.chargeSavedCard(
        {
          paymentCardId: meta.paymentCardId,
          amount: Number(ngnAmountBase),
          reference: chargeReference,
          metadata: { autoStackId: stack.id, mode: 'AUTOSTACK_CONFIRM' },
        },
        { skipCircuitBreaker: true },
      );
      await this.prisma.transaction.update({
        where: { id: configTx.id },
        data: {
          paymentMetadata: {
            ...processingMetadata,
            paymentType,
            sourceAsset,
            targetAsset: 'USDT',
            autostackFlow: 'PAYSTACK_CARD_TO_BUY_ORDER',
            autostackInitiationStatus: 'SUBMITTED',
            liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
            liquidityReservationCurrency: 'NGN',
            liquidityReservationAmount: ngnAmountBase.toString(),
            usdtNgnRate,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const failedTx = await tx.transaction.findUnique({
          where: { id: configTx.id },
        });
        const failedMeta = (failedTx?.paymentMetadata || {}) as any;
        if (
          failedMeta.liquidityReservationStatus ===
            LiquidityReservationStatus.RESERVED &&
          failedMeta.liquidityReservationAmount &&
          failedMeta.liquidityReservationCurrency
        ) {
          await this.companyLiquidityService
            .releaseLiquidity(
              String(failedMeta.liquidityReservationCurrency),
              BigInt(String(failedMeta.liquidityReservationAmount)),
              tx as any,
            )
            .catch(() => undefined);
        }
        if (
          paymentType === PaymentType.CRYPTO_WALLET &&
          failedMeta.liquidityReservationStatus ===
            LiquidityReservationStatus.RESERVED
        ) {
          await this.transactionService
            .releaseBalance(
              tx as any,
              stack.userId,
              sourceAsset,
              sourceAmountBase,
            )
            .catch(() => undefined);
        }
        await tx.transaction.update({
          where: { id: configTx.id },
          data: {
            paymentMetadata: {
              ...failedMeta,
              autostackInitiationStatus: 'FAILED',
              autostackInitiationFailedAt: new Date().toISOString(),
              autostackInitiationFailure:
                (error as any)?.message || 'Autostack initiation failed',
              liquidityReservationStatus:
                failedMeta.liquidityReservationStatus ===
                LiquidityReservationStatus.RESERVED
                  ? LiquidityReservationStatus.RELEASED
                  : failedMeta.liquidityReservationStatus,
            } as Prisma.InputJsonValue,
          },
        });
      });
      throw error;
    }
  }
}
