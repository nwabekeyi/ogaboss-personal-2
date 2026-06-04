import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  TransactionStatus,
  TransactionContext,
  TransactionType,
  OrderStatus,
  PaymentStatus,
  AutoStackStatus,
  PaymentType,
} from '../../../../infrastructure/databases/prisma/generated/prisma/client';
import { DashboardStatsQueueService } from '../../../dashboard/dashboard-stats-queue';
import {
  BASE_CURRENCY,
  ConvertCurrency,
  CryptoNetwork,
  LiquidityReservationStatus,
  toBigInt,
  toDecimal,
  toCryptoNetwork,
  isTransientPrismaError,
} from '../../../../shared';
import { Prisma } from '../../../../infrastructure/databases/prisma/generated/prisma/browser';
import Decimal from 'decimal.js';
import {
  CompanyLiquidityService,
  TransactionService,
  TransactionNotificationService,
} from '../../../../modules/transaction/services';
import { PaystackService } from '../../../../infrastructure/providers/paystack';
import { CompensatedError } from '../../compensated-error';
import { XpresspayService } from '../../../../infrastructure/providers/xpresspay/xpresspay.service';

@Injectable()
export class OrderDoneHandler {
  private readonly logger = new Logger(OrderDoneHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardStatsQueueService: DashboardStatsQueueService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly paystackService: PaystackService,
    private readonly transactionService: TransactionService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly xpresspayService: XpresspayService,
  ) {}

  private frequencyDays(frequency?: string): number {
    if (frequency === 'WEEKLY') return 7;
    if (frequency === 'MONTHLY') return 30;
    return 1;
  }

  /**
   * Handles order.done webhook from Quidax
   */
  async process(data: any): Promise<void> {
    this.logger.log('Processing order.done webhook');
    const quidaxReference = data.reference || data.id;

    if (!quidaxReference) {
      this.logger.error('Missing reference/id in order.done payload');
      return;
    }

    const isBuy = data.side === 'buy';
    const crypto = data.market.base_unit.toUpperCase();
    const fiat = data.market.quote_unit.toUpperCase();

    // --- Find order first ---
    const order = await this.prisma.order.findFirst({
      where: { referenceNo: quidaxReference },
      select: {
        id: true,
        transactionId: true,
        userId: true,
        status: true,
      },
    });

    if (!order) {
      this.logger.error(
        `Order not found for Quidax reference: ${quidaxReference}`,
      );
      return;
    }

    // --- Find the transaction linked to this order ---
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: order.transactionId },
      select: {
        id: true,
        userId: true,
        status: true,
        network: true,
        senderWalletAddress: true,
        receiverWalletAddress: true,
        paymentType: true,
        paymentMetadata: true,
        cryptoAmountBase: true,
        fiatAmountBase: true,
        totalAmountSentBase: true,
        platformFeeBase: true,
        transactionContext: true,
      },
    });

    if (!transaction) {
      this.logger.error(`Transaction not found for order ${order.id}`);
      return;
    }

    const reservedLiquidityAmount = toBigInt(transaction.fiatAmountBase);
    const paymentMetadata = (transaction.paymentMetadata || {}) as Record<
      string,
      any
    >;
    const liquidityReservationStatus =
      paymentMetadata.liquidityReservationStatus ||
      LiquidityReservationStatus.RESERVED;

    const status = data.status?.toLowerCase();
    const isFailure = ['cancelled', 'rejected', 'failed'].includes(status);

    if (isFailure) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Re-check status inside transaction to prevent TOCTOU race
          await tx.$queryRaw`
            SELECT "id" FROM "transactions"
            WHERE "id" = ${transaction.id}
            FOR UPDATE
          `;
          const freshTx = await tx.transaction.findUnique({
            where: { id: transaction.id },
            select: { status: true },
          });
          if (
            freshTx?.status === TransactionStatus.COMPLETED ||
            freshTx?.status === TransactionStatus.FAILED
          ) {
            this.logger.warn(
              `Transaction ${transaction.id} already processed (race guard)`,
            );
            return false;
          }

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: TransactionStatus.FAILED,
              isProcessed: true,
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.FAILED,
              paymentStatus: PaymentStatus.FAILED,
              gatewayResponse: JSON.stringify(data),
            },
          });

          if (!isBuy && transaction.cryptoAmountBase != null) {
            const totalSent =
              toBigInt(transaction.cryptoAmountBase) +
              toBigInt(transaction.platformFeeBase ?? 0n);
            await this.transactionService
              .releaseBalance(tx, transaction.userId, crypto, totalSent)
              .catch(() => undefined);
          }

          if (
            reservedLiquidityAmount > 0n &&
            liquidityReservationStatus === LiquidityReservationStatus.RESERVED
          ) {
            await this.companyLiquidityService.releaseLiquidity(
              fiat,
              reservedLiquidityAmount,
              tx,
            );

            await tx.transaction.update({
              where: { id: transaction.id },
              data: {
                paymentMetadata: {
                  ...paymentMetadata,
                  liquidityReservationStatus:
                    LiquidityReservationStatus.RELEASED,
                  liquidityReleasedAt: new Date().toISOString(),
                  liquidityReleaseReason: 'quidax_order_failed',
                } as Prisma.InputJsonValue,
              },
            });
          }
        });
      } catch (error: any) {
        if (isTransientPrismaError(error)) {
          this.logger.error(
            `Transient DB error processing failed order ${order.id}: ${error.message}`,
          );
          throw error;
        }
        this.logger.error(
          `Failed to process order failure ${order.id}: ${error?.message}`,
          error?.stack,
        );
        return;
      }

      this.logger.warn(`Order marked FAILED for order ${order.id}`);
      return;
    }

    if (
      transaction.status === TransactionStatus.COMPLETED ||
      transaction.status === TransactionStatus.FAILED
    ) {
      this.logger.warn(`Transaction already completed for order: ${order.id}`);
      return;
    }

    const network = transaction.network ?? undefined;

    // --- Convert executed amounts from webhook ---
    const executedVolumeStr = data.executed_volume?.amount || '0';
    const avgPriceStr = data.avg_price?.amount || '0';

    const executedCryptoAmountBase = ConvertCurrency.toBase(
      executedVolumeStr,
      crypto,
      toCryptoNetwork(network),
    );

    const executedFiatAmountBase = ConvertCurrency.toBase(
      new Decimal(executedVolumeStr).mul(new Decimal(avgPriceStr)).toString(),
      fiat,
    );

    const executionPrice = new Decimal(avgPriceStr);
    const executedAt = new Date(data.done_at ?? data.updated_at ?? Date.now());

    // ────────────────────────────────────────────────
    // BUY FLOW
    // ────────────────────────────────────────────────
    if (isBuy) {
      let buyProcessed = false;
      try {
        buyProcessed = await this.prisma.$transaction(async (tx) => {
          // Re-check status inside transaction to prevent TOCTOU race
          await tx.$queryRaw`
            SELECT "id" FROM "transactions"
            WHERE "id" = ${transaction.id}
            FOR UPDATE
          `;
          const freshTx = await tx.transaction.findUnique({
            where: { id: transaction.id },
            select: { status: true },
          });
          if (
            freshTx?.status === TransactionStatus.COMPLETED ||
            freshTx?.status === TransactionStatus.FAILED
          ) {
            this.logger.warn(
              `Transaction ${transaction.id} already processed (race guard)`,
            );
            return false;
          }

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: TransactionStatus.COMPLETED,
              executedCryptoAmountBase: toDecimal(executedCryptoAmountBase),
              executedFiatAmountBase: toDecimal(executedFiatAmountBase),
              executionPrice: executionPrice.toString(),
              executedAt,
              isProcessed: true,
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.COMPLETED,
              paymentStatus: PaymentStatus.PAID,
              paymentReference: quidaxReference,
              paymentChannel: transaction.paymentType,
              paymentDate: executedAt,
              gatewayResponse: JSON.stringify(data),
            },
          });

          // amountBought stores NGN kobo — atomic increment
          const executedFiatDec = toDecimal(executedFiatAmountBase);
          await tx.$executeRaw`
            UPDATE "users"
            SET "amountBought" = "amountBought" + ${executedFiatDec}
            WHERE "id" = ${transaction.userId}
          `;

          if (
            reservedLiquidityAmount > 0n &&
            liquidityReservationStatus === LiquidityReservationStatus.RESERVED
          ) {
            const isAutoStackCardBuy =
              transaction.transactionContext === TransactionContext.AUTOSTACK &&
              String(
                paymentMetadata.paymentType || transaction.paymentType || '',
              ).toUpperCase() !== PaymentType.CRYPTO_WALLET;

            if (isAutoStackCardBuy) {
              // Autostack card buys still spend company NGN on Quidax. Consume
              // the reserved NGN immediately; the scheduler will later reconcile
              // the authoritative Quidax NGN balance.
              const consumed =
                await this.companyLiquidityService.consumeReservedLiquidity(
                  fiat,
                  reservedLiquidityAmount,
                  tx,
                );
              if (!consumed) {
                this.logger.error(
                  `Autostack buy order ${order.id}: consumeReservedLiquidity failed for ${fiat} — reserved or total balance insufficient`,
                );
                throw new Error(
                  `Autostack company liquidity consumption failed for order ${order.id}`,
                );
              }

              await tx.transaction.update({
                where: { id: transaction.id },
                data: {
                  paymentMetadata: {
                    ...paymentMetadata,
                    liquidityReservationStatus:
                      LiquidityReservationStatus.CONSUMED,
                    liquidityConsumedAt: new Date().toISOString(),
                    liquidityConsumedReason: 'autostack_order_done_buy',
                    actualReceivedAmountBase:
                      executedCryptoAmountBase.toString(),
                    actualReceivedAmountOriginal: executedVolumeStr,
                    principalUsdtAmountBase:
                      executedCryptoAmountBase.toString(),
                    principalUsdtAmount: executedVolumeStr,
                    autostackInitiationStatus: 'COMPLETED',
                    autostackSettlement: 'buy_order_completed',
                  } as Prisma.InputJsonValue,
                },
              });
            } else {
              // Company spent NGN on Quidax — consume from both reserved and total
              const consumed =
                await this.companyLiquidityService.consumeReservedLiquidity(
                  fiat,
                  reservedLiquidityAmount,
                  tx,
                );
              if (!consumed) {
                this.logger.error(
                  `Order ${order.id}: consumeReservedLiquidity failed for ${fiat} — reserved or total balance insufficient`,
                );
                throw new Error(
                  `Company liquidity consumption failed for order ${order.id}`,
                );
              }

              await tx.transaction.update({
                where: { id: transaction.id },
                data: {
                  paymentMetadata: {
                    ...paymentMetadata,
                    liquidityReservationStatus:
                      LiquidityReservationStatus.CONSUMED,
                    liquidityConsumedAt: new Date().toISOString(),
                    liquidityConsumedReason: 'quidax_order_done_buy',
                  } as Prisma.InputJsonValue,
                },
              });
            }
          }

          let wallet = null;
          if (transaction.receiverWalletAddress) {
            wallet = await tx.wallet.findUnique({
              where: { quidaxWalletId: transaction.receiverWalletAddress },
            });
          } else {
            wallet = await tx.wallet.findFirst({
              where: {
                userId: transaction.userId,
                currency: crypto,
              },
            });
          }

          if (!wallet) {
            throw new Error(
              `Buy order ${order.id}: wallet not found for user ${transaction.userId} ${crypto} — cannot credit`,
            );
          }

          const cryptoDec = toDecimal(executedCryptoAmountBase);

          if (transaction.transactionContext === TransactionContext.AUTOSTACK) {
            await tx.$executeRaw`
              UPDATE "wallets"
              SET "stackedAmount" = "stackedAmount" + ${cryptoDec}
              WHERE "id" = ${wallet.id}
            `;

            if (paymentMetadata.autoStackId) {
              const autoStack = await tx.autoStack.findUnique({
                where: { id: String(paymentMetadata.autoStackId) },
              });
              if (autoStack) {
                const nextExecutionAt = new Date(executedAt);
                if (autoStack.frequency === 'DAILY')
                  nextExecutionAt.setUTCDate(nextExecutionAt.getUTCDate() + 1);
                if (autoStack.frequency === 'WEEKLY')
                  nextExecutionAt.setUTCDate(nextExecutionAt.getUTCDate() + 7);
                if (autoStack.frequency === 'MONTHLY')
                  nextExecutionAt.setUTCMonth(
                    nextExecutionAt.getUTCMonth() + 1,
                  );
                const nextInterestAt = new Date(executedAt);
                nextInterestAt.setUTCDate(
                  nextInterestAt.getUTCDate() +
                    this.frequencyDays(String(autoStack.frequency)),
                );
                await tx.autoStack.update({
                  where: { id: autoStack.id },
                  data: {
                    amount:
                      String(autoStack.status) === AutoStackStatus.PENDING
                        ? cryptoDec
                        : { increment: cryptoDec },
                    status: AutoStackStatus.ACTIVE,
                    lastExecutedAt: executedAt,
                    nextExecutionAt,
                    nextInterestAt,
                  },
                });
              }
            }

            await this.companyLiquidityService.updateInternalBalance(
              crypto,
              cryptoDec,
              'add',
              tx,
            );
            await tx.$executeRaw`
              UPDATE "company_liquidity"
              SET "totalAmountStacked" = "totalAmountStacked" + ${cryptoDec}
              WHERE LOWER("currency") = LOWER(${crypto})
            `;
          } else {
            // Atomic baseBalance credit
            const [{ baseBalance: newBaseStr }] = await tx.$queryRaw<
              { baseBalance: string }[]
            >`
              UPDATE "wallets"
              SET "baseBalance" = "baseBalance" + ${cryptoDec}
              WHERE "id" = ${wallet.id}
              RETURNING "baseBalance"
            `;

            // Update originalBalance from the actual post-update baseBalance
            const newOriginalBalance = ConvertCurrency.fromBase(
              BigInt(String(newBaseStr)),
              crypto,
              toCryptoNetwork(network),
            );
            await tx.$executeRaw`
              UPDATE "wallets"
              SET "originalBalance" = ${newOriginalBalance}
              WHERE "id" = ${wallet.id}
            `;
          }

          if (transaction.transactionContext !== TransactionContext.AUTOSTACK) {
            await this.companyLiquidityService.updateInternalBalance(
              crypto,
              cryptoDec,
              'add',
              tx,
            );
          }

          return true;
        });
      } catch (error: any) {
        if (isTransientPrismaError(error)) {
          this.logger.error(
            `Transient DB error processing buy order ${order.id}: ${error.message}`,
          );
          throw error;
        }
        this.logger.error(
          `Failed to process buy order ${order.id}: ${error?.message}`,
          error?.stack,
        );

        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.FAILED,
              paymentStatus: PaymentStatus.FAILED,
              gatewayResponse: JSON.stringify({ error: error?.message, data }),
            },
          });
          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: TransactionStatus.FAILED,
              isProcessed: true,
              paymentMetadata: {
                ...paymentMetadata,
                orderDoneFailure:
                  error?.message || 'order.done processing failed',
                orderDoneFailedAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
          if (
            reservedLiquidityAmount > 0n &&
            liquidityReservationStatus === LiquidityReservationStatus.RESERVED
          ) {
            await this.companyLiquidityService.releaseLiquidity(
              fiat,
              reservedLiquidityAmount,
              tx,
            );
          }
        });
        return;
      }

      if (!buyProcessed) return;
    }

    // ────────────────────────────────────────────────
    // SELL FLOW
    // ────────────────────────────────────────────────
    else {
      if (
        transaction.transactionContext === TransactionContext.BILL_PAYMENT &&
        paymentMetadata.billingFlow === true
      ) {
        let billingMeta = paymentMetadata;
        try {
          billingMeta = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
              SELECT "id" FROM "transactions"
              WHERE "id" = ${transaction.id}
              FOR UPDATE
            `;
            const currentTx = await tx.transaction.findUnique({
              where: { id: transaction.id },
              select: { paymentMetadata: true },
            });
            const currentMeta = (currentTx?.paymentMetadata || {}) as Record<
              string,
              any
            >;

            if (
              ['PROVIDER_SUBMITTED', 'COMPLETED'].includes(
                String(currentMeta.billingStatus || '').toUpperCase(),
              )
            ) {
              return currentMeta;
            }

            if (currentMeta.sellProceedsLiquidityStatus !== 'ADDED') {
              await this.companyLiquidityService.addLiquidity(
                fiat,
                executedFiatAmountBase,
                tx,
              );
            }

            const updatedMeta = {
              ...currentMeta,
              sellOrderStatus: 'filled',
              sellProceedsLiquidityStatus: 'ADDED',
              sellProceedsLiquidityAddedAt:
                currentMeta.sellProceedsLiquidityAddedAt ||
                new Date().toISOString(),
              sellProceedsLiquidityAmountBase:
                currentMeta.sellProceedsLiquidityAmountBase ||
                executedFiatAmountBase.toString(),
              billingStatus: 'PAYING',
              billingPayRequestedAt: new Date().toISOString(),
            };

            await tx.transaction.update({
              where: { id: transaction.id },
              data: {
                executedCryptoAmountBase: toDecimal(executedCryptoAmountBase),
                executedFiatAmountBase: toDecimal(executedFiatAmountBase),
                executionPrice: executionPrice.toString(),
                executedAt,
                isProcessed: false,
                paymentMetadata: updatedMeta as Prisma.InputJsonValue,
              },
            });

            await tx.order.update({
              where: { id: order.id },
              data: {
                status: OrderStatus.PROCESSING,
                paymentStatus: PaymentStatus.PAID,
                paymentReference: quidaxReference,
                paymentChannel: transaction.paymentType,
                paymentDate: executedAt,
                gatewayResponse: JSON.stringify({ quidax: data }),
              },
            });

            return updatedMeta;
          });

          if (
            ['PROVIDER_SUBMITTED', 'COMPLETED'].includes(
              String(billingMeta.billingStatus || '').toUpperCase(),
            )
          ) {
            return;
          }

          const providerResponse = await this.xpresspayService.payBill({
            amount: new Decimal(billingMeta.billAmountNgn || 0).toString(),
            category: billingMeta.category,
            billerCode: billingMeta.billerCode,
            customerReference: billingMeta.customerReference,
            productCode: billingMeta.productCode,
            reference: transaction.id,
          });

          await this.prisma.$transaction([
            this.prisma.transaction.update({
              where: { id: transaction.id },
              data: {
                paymentMetadata: {
                  ...billingMeta,
                  billingStatus: 'PROVIDER_SUBMITTED',
                  xpresspayResponse: providerResponse,
                  xpresspaySubmittedAt: new Date().toISOString(),
                } as Prisma.InputJsonValue,
              },
            }),
            this.prisma.billPayment.updateMany({
              where: { transactionId: transaction.id },
              data: { status: 'PROCESSING', providerResponse },
            }),
          ]);
        } catch (billingErr: any) {
          await this.prisma.$transaction(async (tx) => {
            const retryMeta = {
              ...billingMeta,
              billingStatus: 'PROVIDER_SUBMIT_FAILED_RETRYABLE',
              billingFailureReason: billingErr?.message || 'unknown',
              billingFailureAt: new Date().toISOString(),
              billingRequiresRetry: true,
            };

            await tx.transaction.update({
              where: { id: transaction.id },
              data: {
                status: TransactionStatus.PENDING,
                isProcessed: false,
                paymentMetadata: retryMeta as Prisma.InputJsonValue,
              },
            });
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: OrderStatus.PROCESSING,
                paymentStatus: PaymentStatus.PAID,
                gatewayResponse: JSON.stringify({
                  quidax: data,
                  billingError: billingErr?.message || 'unknown',
                  retryable: true,
                }),
              },
            });
            await tx.billPayment.updateMany({
              where: { transactionId: transaction.id },
              data: { status: 'PROCESSING' },
            });
          });
        }
        return;
      }

      const payoutAccountNumber = paymentMetadata.payoutAccountNumber as
        | string
        | undefined;
      const payoutBankCode = paymentMetadata.payoutBankCode as
        | string
        | undefined;
      const payoutAccountName = paymentMetadata.payoutAccountName as
        | string
        | undefined;

      if (!payoutAccountNumber || !payoutBankCode || !payoutAccountName) {
        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.FAILED,
              paymentStatus: PaymentStatus.FAILED,
              gatewayResponse: JSON.stringify({
                error: 'Missing payout bank details',
                data,
              }),
            },
          });

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: TransactionStatus.FAILED,
              isProcessed: true,
            },
          });

          if (
            reservedLiquidityAmount > 0n &&
            liquidityReservationStatus === LiquidityReservationStatus.RESERVED
          ) {
            await this.companyLiquidityService.releaseLiquidity(
              fiat,
              reservedLiquidityAmount,
              tx,
            );
          }

          if (transaction.cryptoAmountBase != null) {
            await this.transactionService
              .releaseBalance(
                tx,
                transaction.userId,
                crypto,
                transaction.cryptoAmountBase,
              )
              .catch(() => undefined);
          }
        });

        this.logger.error(
          `Missing payout bank details for sell transaction ${transaction.id}`,
        );
        return;
      }

      let sellPaymentMetadata = paymentMetadata;

      try {
        // Re-fetch payment metadata to get latest bank details (prevents TOCTOU
        // if user updates bank account between order.done webhook and this call)
        const freshTx = await this.prisma.transaction.findUnique({
          where: { id: transaction.id },
          select: { paymentMetadata: true },
        });
        const freshMeta = (freshTx?.paymentMetadata || {}) as Record<
          string,
          any
        >;

        const freshAccountNumber = freshMeta.payoutAccountNumber as
          | string
          | undefined;
        const freshBankCode = freshMeta.payoutBankCode as string | undefined;
        const freshAccountName = freshMeta.payoutAccountName as
          | string
          | undefined;

        if (!freshAccountNumber || !freshBankCode || !freshAccountName) {
          throw new Error(
            'Missing payout bank details in transaction metadata',
          );
        }

        sellPaymentMetadata = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "transactions"
            WHERE "id" = ${transaction.id}
            FOR UPDATE
          `;

          const currentTx = await tx.transaction.findUnique({
            where: { id: transaction.id },
            select: { paymentMetadata: true },
          });
          const currentMeta = (currentTx?.paymentMetadata || {}) as Record<
            string,
            any
          >;

          if (currentMeta.sellProceedsLiquidityStatus === 'ADDED') {
            return currentMeta;
          }

          // Company received NGN from the completed Quidax sell order. Reflect
          // that immediately in totalBalance until the Quidax balance scheduler
          // later reconciles the authoritative wallet balance.
          await this.companyLiquidityService.addLiquidity(
            fiat,
            executedFiatAmountBase,
            tx,
          );

          const updatedMeta = {
            ...currentMeta,
            sellOrderStatus: 'filled',
            sellProceedsLiquidityStatus: 'ADDED',
            sellProceedsLiquidityAddedAt: new Date().toISOString(),
            sellProceedsLiquidityAmountBase: executedFiatAmountBase.toString(),
            sellProceedsLiquidityReason: 'quidax_order_done_sell',
          };

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              executedCryptoAmountBase: toDecimal(executedCryptoAmountBase),
              executedFiatAmountBase: toDecimal(executedFiatAmountBase),
              executionPrice: executionPrice.toString(),
              executedAt,
              paymentMetadata: updatedMeta as Prisma.InputJsonValue,
            },
          });

          return updatedMeta;
        });

        const recipient = await this.paystackService.createTransferRecipient(
          {
            type: 'nuban',
            name: freshAccountName,
            account_number: freshAccountNumber,
            bank_code: freshBankCode,
            currency: BASE_CURRENCY.toUpperCase(),
            metadata: { transactionId: transaction.id, orderId: order.id },
          },
          { skipCircuitBreaker: true },
        );

        if (!recipient?.status || !recipient?.data?.recipient_code) {
          throw new Error(
            `Failed creating transfer recipient for sell order ${order.id}`,
          );
        }

        const transfer = await this.paystackService.initiateTransfer(
          {
            source: 'balance',
            amount: String(transaction.fiatAmountBase ?? '0'),
            recipient: recipient.data.recipient_code,
            reason: `Sell payout ${transaction.id}`,
          },
          { skipCircuitBreaker: true },
        );

        if (!transfer?.status || !transfer?.data?.reference) {
          throw new Error(
            `Failed initiating transfer for sell order ${order.id}`,
          );
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              // Keep PENDING — confirmed only when Paystack transfer succeeds
              executedCryptoAmountBase: toDecimal(executedCryptoAmountBase),
              executedFiatAmountBase: toDecimal(executedFiatAmountBase),
              executionPrice: executionPrice.toString(),
              executedAt,
              isProcessed: false,
              paymentMetadata: {
                ...sellPaymentMetadata,
                sellOrderStatus: 'filled',
                payoutStatus: 'initiated',
                payoutReference: transfer.data.reference,
                payoutTransferCode: transfer.data.transfer_code,
              } as Prisma.InputJsonValue,
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PROCESSING,
              paymentStatus: PaymentStatus.PENDING,
              paymentReference: transfer.data.reference,
              paymentChannel: 'paystack_transfer',
              gatewayResponse: JSON.stringify({
                quidax: data,
                paystackTransfer: transfer.data,
              }),
            },
          });
        });
      } catch (payoutError: any) {
        const retryCount = (sellPaymentMetadata.payoutRetryCount || 0) + 1;
        this.logger.error(
          `Payout failed for sell order ${order.id}: ${payoutError?.message}. Queue retry will handle retries.`,
        );

        await this.prisma.$transaction(async (tx) => {
          // Release reserved balance (un-locks the crypto amount)
          if (transaction.cryptoAmountBase != null) {
            const totalSent =
              toBigInt(transaction.cryptoAmountBase) +
              toBigInt(transaction.platformFeeBase ?? 0n);
            await this.transactionService.releaseBalance(
              tx,
              transaction.userId,
              crypto,
              totalSent,
            );
          }

          // Release company liquidity reservation
          if (
            reservedLiquidityAmount > 0n &&
            liquidityReservationStatus === LiquidityReservationStatus.RESERVED
          ) {
            await this.companyLiquidityService.releaseLiquidity(
              fiat,
              reservedLiquidityAmount,
              tx,
            );
          }

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.FAILED,
              paymentStatus: PaymentStatus.FAILED,
              gatewayResponse: JSON.stringify({
                quidax: data,
                payoutError: payoutError?.message ?? 'unknown',
              }),
            },
          });

          await tx.transaction.update({
            where: { id: transaction.id },
            data: {
              status: TransactionStatus.FAILED,
              isProcessed: true,
              paymentMetadata: {
                ...sellPaymentMetadata,
                sellOrderStatus: 'filled',
                payoutStatus: 'failed',
                payoutFailureReason: payoutError?.message ?? 'unknown',
                payoutRetryCount: retryCount,
                liquidityReservationStatus: LiquidityReservationStatus.RELEASED,
                liquidityReleasedAt: new Date().toISOString(),
                liquidityReleaseReason: 'sell_payout_retries_exhausted',
                partialSuccessNote:
                  'Quidax sell order succeeded but Paystack payout failed after retries',
              } as Prisma.InputJsonValue,
            },
          });
        });

        await this.transactionService.syncCompanyLiquidityCache();
        throw payoutError;
      }
    }

    // ────────────────────────────────────────────────
    // Common final step — notification + dashboard stats
    // ────────────────────────────────────────────────

    // Send notification (buy is completed, sell is still PENDING)
    try {
      const updatedTransaction = await this.prisma.transaction.findUnique({
        where: { id: transaction.id },
        select: {
          id: true,
          userId: true,
          transactionUniqueId: true,
          transactionContext: true,
          status: true,
          currency: true,
          network: true,
          cryptoAmountOriginal: true,
          fiatAmountOriginal: true,
          executedCryptoAmountBase: true,
          executedFiatAmountBase: true,
          executionPrice: true,
          executedAt: true,
          User: { select: { email: true, firstName: true } },
          paymentMetadata: true,
        },
      });

      if (updatedTransaction) {
        this.transactionNotificationService.sendTransactionStatusNotification(
          updatedTransaction,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to send notification for order ${order.id}: ${error?.message}`,
      );
    }

    // Only queue dashboard stats for buy (completed immediately).
    // Sell stats are queued in handleTransferSuccess when NGN is sent.
    if (isBuy) {
      // Gross = what actually moved (executed at market) + platform fee
      const grossNairaBase =
        toBigInt(executedFiatAmountBase) +
        toBigInt(transaction.platformFeeBase ?? 0n);

      try {
        await this.dashboardStatsQueueService.queueTransactionUpdate({
          id: transaction.id,
          userId: transaction.userId,
          currency: crypto,
          nairaAmountBase: grossNairaBase.toString(),
          status: TransactionStatus.COMPLETED,
          createdAt: executedAt.toISOString(),
          transactionType: TransactionType.CREDIT,
          transactionContext: TransactionContext.BUY,
          senderWalletAddress: transaction.senderWalletAddress,
          receiverWalletAddress: transaction.receiverWalletAddress,
          user: { firstName: null, lastName: null },
        });
      } catch (error: any) {
        this.logger.error(
          `Failed to queue dashboard stats for order ${order.id}: ${error?.message}`,
        );
      }
    }

    this.logger.log(
      `${isBuy ? 'Buy' : 'Sell'} order executed for user ${transaction.userId}, order ID: ${order.id}`,
    );

    await this.transactionService.syncCompanyLiquidityCache();
  }
}
