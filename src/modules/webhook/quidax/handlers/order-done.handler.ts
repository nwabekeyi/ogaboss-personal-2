import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  TransactionStatus,
  TransactionContext,
  TransactionType,
  OrderStatus,
  PaymentStatus,
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
import { backoff_retries } from '../../constant';

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

  /**
   * Handles order.done webhook from Quidax
   */
  async process(data: any): Promise<void> {
    this.logger.log('Processing order.done webhook');
    const quidaxReference = data.reference;

    if (!quidaxReference) {
      this.logger.error('Missing reference in order.done payload');
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
        platformFeeBase: true,
        bufferAmountBase: true,
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
            return;
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

    const executionPrice = Number(avgPriceStr);
    const executedAt = new Date(data.done_at ?? data.updated_at ?? Date.now());

    // ────────────────────────────────────────────────
    // BUY FLOW
    // ────────────────────────────────────────────────
    if (isBuy) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Re-check status inside transaction to prevent TOCTOU race
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
            return;
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

          // Update company internal balance (user wallet was credited)
          await this.companyLiquidityService.updateInternalBalance(
            crypto,
            cryptoDec,
            'add',
            tx,
          );
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
        return;
      }
    }

    // ────────────────────────────────────────────────
    // SELL FLOW
    // ────────────────────────────────────────────────
    else {
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
            amount: parseInt(String(transaction.fiatAmountBase ?? '0'), 10),
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
                ...paymentMetadata,
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
        const retryCount = (paymentMetadata.payoutRetryCount || 0) + 1;
        const MAX_RETRIES = backoff_retries;

        await this.prisma.transaction
          .update({
            where: { id: transaction.id },
            data: {
              paymentMetadata: {
                ...paymentMetadata,
                payoutRetryCount: retryCount,
                lastPayoutError: payoutError?.message ?? 'unknown',
                sellOrderStatus: 'filled',
                payoutStatus: 'retrying',
              } as Prisma.InputJsonValue,
            },
          })
          .catch(() => undefined);

        if (retryCount < MAX_RETRIES) {
          this.logger.warn(
            `Payout attempt ${retryCount}/${MAX_RETRIES} failed for sell order ${order.id}: ${payoutError?.message} — will retry`,
          );
          throw payoutError;
        }

        this.logger.error(
          `Payout failed after ${MAX_RETRIES} attempts for sell order ${order.id}: ${payoutError?.message} — Quidax succeeded, Paystack failed.`,
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
                ...paymentMetadata,
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

        throw new CompensatedError(
          `Sell payout failed after ${MAX_RETRIES} attempts for order ${order.id}: ${payoutError?.message}`,
        );
      }
    }

    // ────────────────────────────────────────────────
    // Common final step — notification + dashboard stats
    // ────────────────────────────────────────────────


    // Billing hook: if this SELL belongs to bills flow, trigger xpress payment here
    const billingMeta = (transaction.paymentMetadata || {}) as Record<string, any>;
    if (billingMeta.billingFlow === true && billingMeta.billingStatus === 'WAITING_SELL_WEBHOOK') {
      try {
        const providerResponse = await this.xpresspayService.payBill({
          amount: Number(billingMeta.billAmountNgn),
          category: billingMeta.category,
          billerCode: billingMeta.billerCode,
          customerReference: billingMeta.customerReference,
          productCode: billingMeta.productCode,
          reference: transaction.id,
        });

        await this.prisma.$transaction([
          this.prisma.transaction.update({ where: { id: transaction.id }, data: {
            paymentMetadata: { ...billingMeta, billingStatus: 'WAITING_PROVIDER_WEBHOOK', xpresspayResponse: providerResponse } as any,
          } }),
          this.prisma.billPayment.updateMany({ where: { transactionId: transaction.id }, data: { status: 'WAITING_PROVIDER_WEBHOOK', providerResponse } }),
        ]);
      } catch (billingErr) {
        await this.prisma.$transaction([
          this.prisma.transaction.update({ where: { id: transaction.id }, data: {
            paymentMetadata: { ...billingMeta, billingStatus: 'FAILED' } as any,
            status: TransactionStatus.FAILED,
          } }),
          this.prisma.billPayment.updateMany({ where: { transactionId: transaction.id }, data: { status: 'FAILED' } }),
        ]);
      }
    }

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

    if (isBuy) {
      await this.transactionService.syncCompanyLiquidityCache();
    }
  }
}
