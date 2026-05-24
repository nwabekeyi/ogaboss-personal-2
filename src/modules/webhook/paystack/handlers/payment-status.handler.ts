import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  PaymentStatus,
  Prisma,
  PrismaService,
} from '../../../../infrastructure';
import {
  PaymentType,
  TransactionContext,
  TransactionStatus,
  TransactionType,
} from '../../../../infrastructure/databases/prisma';
import { PaystackService } from '../../../../infrastructure/providers/paystack';
import { PaystackWebhookEvent } from '../../../../infrastructure/providers/paystack/type';
import { QuidaxOrderService } from '../../../../infrastructure/providers/quidax';
import { QuidaxTickerService } from '../../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import {
  CompanyLiquidityService,
  TransactionService,
  TransactionNotificationService,
} from '../../../transaction/services';
import { DashboardStatsQueueService } from '../../../dashboard/dashboard-stats-queue';
import { RefundStatus } from '../types';
import {
  BASE_CURRENCY,
  ConvertCurrency,
  LiquidityReservationStatus,
  Providers,
  toBigInt,
  toDecimal,
} from '../../../../shared';
import Decimal from 'decimal.js';
import axios from 'axios';

@Injectable()
export class PaystackWebhookHandler {
  private readonly logger = new Logger(PaystackWebhookHandler.name);
  private readonly baseCurrency = BASE_CURRENCY.toUpperCase();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackService: PaystackService,
    private readonly quidaxOrderService: QuidaxOrderService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly transactionService: TransactionService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly tickerService: QuidaxTickerService,
    private readonly dashboardStatsQueueService: DashboardStatsQueueService,
  ) {}

  async handleWebhook(rawBody: string): Promise<void> {
    const payload: PaystackWebhookEvent = JSON.parse(rawBody);

    const { data } = payload;

    if (payload.event === 'charge.success') {
      if (!data?.reference)
        throw new BadRequestException('Missing transaction reference');

      const reference = data.reference;

      const transaction = await this.prisma.transaction.findUnique({
        where: { transactionUniqueId: reference },
        include: { User: true, Wallet: true, CompanyWithdrawals: true },
      });

      if (!transaction)
        throw new NotFoundException(
          `Transaction not found for reference ${reference}`,
        );

      if (
        transaction.status === TransactionStatus.SUCCESS ||
        transaction.status === TransactionStatus.FAILED
      ) {
        this.logger.warn(`Transaction ${reference} already processed`);
        return true;
      }

      const verification = await this.paystackService.verifyTransaction(
        reference,
        { skipCircuitBreaker: true },
      );
      if (!verification.status || !verification.data) {
        throw new BadRequestException(
          `Verification failed: ${verification.message}`,
        );
      }

      const verifiedData = verification.data;

      if (verifiedData.status === 'success') {
        await this.handleSuccess(transaction, verifiedData);

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
      } else {
        await this.handleFailure(transaction.id, verifiedData);

        const failedTransaction = await this.prisma.transaction.findUnique({
          where: { id: transaction.id },
          select: {
            id: true,
            userId: true,
            transactionUniqueId: true,
            transactionContext: true,
            status: true,
            User: { select: { email: true, firstName: true } },
            paymentMetadata: true,
          },
        });

        if (failedTransaction) {
          this.transactionNotificationService.sendTransactionStatusNotification(
            failedTransaction,
          );
        }
      }
      return true;
    }

    if (payload.event === 'transfer.success') {
      await this.handleTransferSuccess(data?.reference, data);
      return true;
    }

    if (
      payload.event === 'transfer.failed' ||
      payload.event === 'transfer.reversed'
    ) {
      await this.handleTransferFailure(data?.reference, data, payload.event);
      return true;
    }

    // Unknown / unhandled event
    return;
  }

  private async handleSuccess(
    transaction: any,
    data: {
      reference: string;
      amount: number;
      gateway_response: string;
      channel: string;
    },
  ): Promise<void> {
    const companyUserId = 'me';
    const meta = (transaction.paymentMetadata || {}) as Record<string, any>;
    if (meta?.mode === 'AUTOSTACK_PERIODIC') {
      await this.prisma.transaction.update({ where: { id: transaction.id }, data: { paymentMetadata: { ...meta, ...data, autostackWebhookProcessedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
    }
    if (transaction.transactionContext === TransactionContext.AUTOSTACK) {
      const handled = await this.handleAutoStackSuccess(transaction, data, meta);
      if (handled) return;
    }

    const cryptoAmountOriginal = transaction.cryptoAmountOriginal ?? '0';
    const executedCryptoVolume = parseFloat(cryptoAmountOriginal);

    if (!Number.isFinite(executedCryptoVolume) || executedCryptoVolume <= 0) {
      throw new BadRequestException('Invalid crypto volume for buy order');
    }

    const market =
      `${transaction.currency.toLowerCase()}${this.baseCurrency.toLowerCase()}` as any;

    // Idempotency: acquire lock and check inside transaction to prevent
    // duplicate Quidax orders from concurrent webhooks.
    let shouldProceed = false;
    let currentMetadata: Record<string, any> = {};

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.transaction.findUnique({
        where: { id: transaction.id },
        select: { paymentMetadata: true, status: true },
      });

      currentMetadata = (fresh?.paymentMetadata || {}) as Record<string, any>;

      if (
        currentMetadata.liquidityReservationStatus ===
        LiquidityReservationStatus.RELEASED
      ) {
        this.logger.warn(
          `Liquidity already released for failed payment: ${transaction.id}`,
        );
        return true;
      }

      if (
        currentMetadata.quidaxOrderReference ||
        currentMetadata.quidaxOrderId ||
        currentMetadata.quidaxOrderProcessing
      ) {
        this.logger.warn(
          `Quidax order already submitted/processing for transaction ${transaction.id}`,
        );
        return true;
      }

      // Mark as processing to prevent concurrent webhooks from proceeding
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentMetadata: {
            ...currentMetadata,
            ...data,
            currency: transaction.currency,
            quidaxOrderProcessing: true,
          } as Prisma.InputJsonValue,
        },
      });

      shouldProceed = true;
    });

    if (!shouldProceed) return;

    const response = await this.quidaxOrderService.buyOrSellOrderRequest(
      companyUserId,
      {
        market,
        side: 'buy',
        ord_type: 'market',
        volume: executedCryptoVolume,
      },
      { skipCircuitBreaker: true },
    );

    if (response.status !== 'success') {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentMetadata: {
            ...currentMetadata,
            ...data,
            currency: transaction.currency,
            quidaxOrderStatus: 'failed',
            lastQuidaxError: response?.message ?? 'order placement failed',
            buyOrderStatus: 'failed_pending_resolution',
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.error(
        `Buy order failed for transaction ${transaction.id}: ${response?.message} — relying on queue-level retries.`,
      );

      throw new InternalServerErrorException(
        'Buy order placement failed. Queued retry will re-attempt.',
      );
    }

    const providerReference = response.data.reference || response.data.id;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.upsert({
        where: { transactionId: transaction.id },
        update: {
          status: OrderStatus.PENDING,
          type: OrderType.BUY,
          referenceNo: providerReference,
          paymentStatus: PaymentStatus.PAID,
          paymentReference: data.reference,
          paymentChannel: data.channel,
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify(response.data),
        },
        create: {
          transactionId: transaction.id,
          userId: transaction.userId,
          cryptoAmountBase: transaction.cryptoAmountBase,
          cryptoAmountOriginal: transaction.cryptoAmountOriginal,
          fiatAmountBase: transaction.fiatAmountBase,
          fiatAmountOriginal: transaction.fiatAmountOriginal,
          fiatCurrency: this.baseCurrency,
          status: OrderStatus.PENDING,
          type: OrderType.BUY,
          referenceNo: providerReference,
          paymentStatus: PaymentStatus.PAID,
          paymentReference: data.reference,
          paymentChannel: data.channel,
          paymentAmountBase: BigInt(data.amount ?? 0).toString(),
          paymentAmountOriginal: (Number(data.amount ?? 0) / 100).toString(),
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify(response.data),
        },
      });

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentMetadata: {
            ...currentMetadata,
            ...data,
            currency: transaction.currency,
            quidaxOrderReference: providerReference,
            quidaxOrderId: response.data.id,
            quidaxOrderProcessing: false,
          } as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.log(
      `Paystack payment confirmed & buy order submitted: ${providerReference}`,
    );
  }

  private async handleAutoStackSuccess(transaction: any, data: any, meta: Record<string, any>): Promise<boolean> {
    const targetAsset = String(meta.targetAsset || 'USDT').toUpperCase();
    const baseAsset = String(transaction.currency || 'USDT').toUpperCase();

    if (meta.paymentType === PaymentType.CRYPTO_WALLET || targetAsset !== baseAsset) {
      const quotationRes = await axios.post(`${process.env.QUIDAX_API_URL}/users/me/swap_quotation`, {
        from_currency: baseAsset.toLowerCase(),
        to_currency: targetAsset.toLowerCase(),
        from_amount: Number(transaction.cryptoAmountOriginal || 0),
      }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}` } }).then((r) => r.data);

      if (!quotationRes?.data?.id) throw new BadRequestException('Failed to create autostack swap quotation');

      const confirmRes = await axios.post(`${process.env.QUIDAX_API_URL}/users/me/swap_quotation/${quotationRes.data.id}/confirm`, {}, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}` } }).then((r) => r.data);

      await this.prisma.$transaction(async (tx) => {
        await tx.swapTransaction.create({ data: { userId: transaction.userId, quidaxAccountId: 'me', fromCurrency: baseAsset, toCurrency: targetAsset, amountOriginal: String(transaction.cryptoAmountOriginal || 0), quoteId: transaction.transactionUniqueId, swapId: confirmRes?.data?.id || quotationRes?.data?.id, status: 'pending', description: `Autostack swap ${baseAsset} -> ${targetAsset}` } });
        await tx.transaction.update({ where: { id: transaction.id }, data: { paymentMetadata: { ...(transaction.paymentMetadata || {}), ...data, autostackFlow: 'SWAP', autostackSwapQuotationId: quotationRes.data.id, autostackSwapId: confirmRes?.data?.id || null } as Prisma.InputJsonValue } });
      });

      return;
    }

    // card/usdt path => buy order; final autostack completion will happen in order_done webhook
    return false;
  }

  private async compensateFailedBuyOrder(
    transaction: any,
    data: {
      reference: string;
      amount: number;
      gateway_response: string;
      channel: string;
    },
    orderError: any,
  ): Promise<void> {
    const metadata = (transaction.paymentMetadata || {}) as Record<string, any>;
    const reservedAmount = toBigInt(transaction.fiatAmountBase);

    await this.prisma.$transaction(async (tx) => {
      if (
        metadata.liquidityReservationStatus ===
          LiquidityReservationStatus.RESERVED &&
        reservedAmount > 0n
      ) {
        await this.companyLiquidityService.releaseLiquidity(
          this.baseCurrency.toLowerCase(),
          reservedAmount,
          tx,
        );
      }

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.FAILED,
          isProcessed: true,
          paymentMetadata: {
            ...metadata,
            provider: Providers.PAYSTACK,
            paystackReference: data.reference,
            buyOrderStatus: 'failed',
            buyOrderFailedAt: new Date().toISOString(),
            buyOrderFailureResponse: orderError,
            liquidityReservationStatus:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? LiquidityReservationStatus.RELEASED
                : metadata.liquidityReservationStatus,
            liquidityReleasedAt:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? new Date().toISOString()
                : metadata.liquidityReleasedAt,
            liquidityReleaseReason:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? 'buy_order_placement_failed'
                : metadata.liquidityReleaseReason,
            refundStatus: metadata.refundStatus ?? RefundStatus.PROCESSING,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.order.upsert({
        where: { transactionId: transaction.id },
        update: {
          status: OrderStatus.FAILED,
          paymentStatus: PaymentStatus.PAID,
          paymentReference: data.reference,
          paymentChannel: data.channel,
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify(orderError),
        },
        create: {
          transactionId: transaction.id,
          userId: transaction.userId,
          cryptoAmountBase: transaction.cryptoAmountBase,
          cryptoAmountOriginal: transaction.cryptoAmountOriginal,
          fiatAmountBase: transaction.fiatAmountBase,
          fiatAmountOriginal: transaction.fiatAmountOriginal,
          fiatCurrency: this.baseCurrency,
          status: OrderStatus.FAILED,
          type: OrderType.BUY,
          paymentStatus: PaymentStatus.PAID,
          paymentReference: data.reference,
          paymentChannel: data.channel,
          paymentAmountBase: BigInt(data.amount ?? 0).toString(),
          paymentAmountOriginal: (Number(data.amount ?? 0) / 100).toString(),
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify(orderError),
        },
      });
    });

    if (metadata.refundStatus === RefundStatus.REFUNDED) {
      this.logger.warn(
        `Refund already completed for transaction ${transaction.id}`,
      );
      return true;
    }

    try {
      const refund = await this.paystackService.refundTransaction(
        { transaction: data.reference },
        { skipCircuitBreaker: true },
      );

      if (!refund?.status) {
        throw new Error(refund?.message || 'Refund request failed');
      }

      await this.prisma.$transaction(async (tx) => {
        const latest = await tx.transaction.findUnique({
          where: { id: transaction.id },
          select: { paymentMetadata: true, userId: true },
        });

        const latestMetadata = (latest?.paymentMetadata || {}) as Record<
          string,
          any
        >;

        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            paymentMetadata: {
              ...latestMetadata,
              refundStatus: RefundStatus.REFUNDED,
              refundReference: refund.data?.reference ?? data.reference,
              refundProcessedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        const refundTxRef = `${data.reference}-buy-refund`;
        const existingRefundTx = await tx.transaction.findUnique({
          where: { transactionUniqueId: refundTxRef },
          select: { id: true },
        });

        if (!existingRefundTx) {
          const refundAmount = BigInt(refund.data?.amount ?? data.amount ?? 0);
          await tx.transaction.create({
            data: {
              transactionUniqueId: refundTxRef,
              currency: this.baseCurrency,
              network: 'paystack',
              fiatAmountBase: toDecimal(refundAmount),
              fiatAmountOriginal: (
                Number(refund.data?.amount ?? data.amount ?? 0) / 100
              ).toFixed(2),
              totalAmountSentBase: toDecimal(refundAmount),
              totalAmountSentOriginal: (
                Number(refund.data?.amount ?? data.amount ?? 0) / 100
              ).toFixed(2),
              status: TransactionStatus.COMPLETED,
              transactionType: TransactionType.REFUND,
              transactionContext: TransactionContext.CARD_REFUND,
              paymentType: PaymentType.PAYSTACK,
              description: `Refund for failed buy order: ${data.reference}`,
              isProcessed: true,
              userId: latest?.userId ?? transaction.userId,
            },
          });
        }
      });
    } catch (error: any) {
      const latestTx = await this.prisma.transaction.findUnique({
        where: { id: transaction.id },
        select: { paymentMetadata: true },
      });

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentMetadata: {
            ...((latestTx?.paymentMetadata || {}) as Record<string, any>),
            refundStatus: RefundStatus.FAILED,
            refundError: error?.message ?? 'Unknown refund error',
            refundFailedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.error(
        `Refund failed for buy transaction ${transaction.id}: ${error?.message}`,
      );
    }
  }

  private async handleFailure(transactionId: string, data: any): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true,
          currency: true,
          fiatAmountBase: true,
          paymentMetadata: true,
          status: true,
          transactionContext: true,
        },
      });

      if (!transaction) {
        throw new NotFoundException(`Transaction not found: ${transactionId}`);
      }

      const metadata = (transaction.paymentMetadata || {}) as Record<
        string,
        any
      >;
      const isReleased =
        metadata.liquidityReservationStatus ===
        LiquidityReservationStatus.RELEASED;
      const reservedAmount = toBigInt(transaction.fiatAmountBase);

      // Only release liquidity for buy transactions that reserved it
      if (
        !isReleased &&
        reservedAmount > 0n &&
        metadata.liquidityReservationStatus ===
          LiquidityReservationStatus.RESERVED
      ) {
        await this.companyLiquidityService.releaseLiquidity(
          this.baseCurrency.toLowerCase(),
          reservedAmount,
          tx,
        );
      }

      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.FAILED,
          isProcessed: true,
          paymentMetadata: {
            ...metadata,
            provider: Providers.PAYSTACK,
            reference: data.reference,
            gateway_response: data.gateway_response,
            verifiedAmount: data.amount,
            processedAt: new Date(),
            liquidityReservationStatus: LiquidityReservationStatus.RELEASED,
            liquidityReleasedAt: isReleased
              ? metadata.liquidityReleasedAt
              : new Date().toISOString(),
            liquidityReleaseReason: isReleased
              ? metadata.liquidityReleaseReason
              : 'payment_failed',
          } as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.warn(
      `Paystack payment FAILED for transaction ${transactionId}`,
    );
  }

  private async handleTransferSuccess(
    reference: string | undefined,
    data: any,
  ): Promise<void> {
    if (!reference) return;

    const order = await this.prisma.order.findFirst({
      where: { paymentReference: reference, type: OrderType.SELL },
      include: { user: true },
    });

    if (!order) {
      this.logger.warn(
        `Sell payout order not found for transfer reference ${reference}`,
      );
      return true;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: order.transactionId },
      select: {
        id: true,
        userId: true,
        currency: true,
        cryptoAmountBase: true,
        fiatAmountBase: true,
        platformFeeBase: true,
        totalAmountSentBase: true,
        paymentMetadata: true,
        senderWalletAddress: true,
        receiverWalletAddress: true,
      },
    });

    if (!transaction) return;

    const metadata = (transaction.paymentMetadata || {}) as Record<string, any>;
    if (metadata.payoutStatus === 'success') return;

    // Use totalAmountSentBase (crypto + platform fee) if available,
    // otherwise fall back to cryptoAmountBase
    const totalSentBase = toBigInt(transaction.totalAmountSentBase);

    if (totalSentBase <= 0n) {
      this.logger.error(
        `Sell payout ${transaction.id}: no valid amount to deduct — cannot process`,
      );
      return true;
    }

    await this.prisma.$transaction(async (tx) => {
      const settled =
        await this.companyLiquidityService.consumeReservedLiquidity(
          this.baseCurrency.toLowerCase(),
          toBigInt(transaction.fiatAmountBase),
          tx,
        );

      if (!settled) {
        throw new BadRequestException(
          `Unable to consume liquidity for sell payout ${transaction.id}`,
        );
      }

      await this.transactionService.releaseBalance(
        tx,
        transaction.userId,
        transaction.currency,
        totalSentBase,
      );

      const totalSentDec = toDecimal(totalSentBase);
      const [{ baseBalance: newBaseStr }] = await tx.$queryRaw<
        { baseBalance: string }[]
      >`
        UPDATE "wallets"
        SET "baseBalance" = GREATEST("baseBalance" - ${totalSentDec}, 0)
        WHERE "userId" = ${transaction.userId}
          AND "currency" = ${transaction.currency}
        RETURNING "baseBalance"
      `;

      // amountSold stores NGN kobo - compute from current market price
      const sellNgnPrice = await this.tickerService.getPrice(
        `${transaction.currency.toLowerCase()}ngn`,
      );
      let sellNgnBaseDec = toDecimal(0n);
      if (sellNgnPrice && parseFloat(sellNgnPrice) > 0) {
        const cryptoAmountStr = transaction.cryptoAmountBase?.toString() || '0';
        const sellNgnValue = new Decimal(sellNgnPrice).mul(
          new Decimal(cryptoAmountStr),
        );
        const sellNgnBase = ConvertCurrency.toBase(
          sellNgnValue.toFixed(2),
          'ngn',
        );
        sellNgnBaseDec = toDecimal(sellNgnBase);
      }
      await tx.$executeRaw`
        UPDATE "users"
        SET "amountSold" = "amountSold" + ${sellNgnBaseDec}
        WHERE "id" = ${transaction.userId}
      `;

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.COMPLETED,
          paymentStatus: PaymentStatus.PAID,
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify(data),
        },
      });

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.COMPLETED,
          isProcessed: true,
          paymentMetadata: {
            ...metadata,
            payoutStatus: 'success',
            payoutSettledAt: new Date().toISOString(),
            liquidityReservationStatus: LiquidityReservationStatus.CONSUMED,
            liquidityConsumedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      // Update company internal balance (user wallet was debited)
      await this.companyLiquidityService.updateInternalBalance(
        transaction.currency,
        totalSentDec,
        'subtract',
        tx,
      );

      // Check if internal balance exceeds total balance
      if (
        await this.companyLiquidityService.isInternalBalanceExceeding(
          transaction.currency.toLowerCase(),
          tx,
        )
      ) {
        await tx.failedCompanyLiquidityTransaction.create({
          data: {
            transactionId: transaction.id,
            currency: transaction.currency.toLowerCase(),
            amountBase: totalSentBase.toString(),
            providerResponse: {
              reason:
                'Internal balance exceeds company wallet balance after sell payout completion',
              orderId: order.id,
              reference,
            },
          },
        });
      }
    });

    // Queue dashboard stats for sell — executed value + platform fee
    const grossNairaBase =
      toBigInt(transaction.fiatAmountBase) +
      toBigInt(transaction.platformFeeBase ?? 0n);
    try {
      await this.dashboardStatsQueueService.queueTransactionUpdate({
        id: transaction.id,
        userId: transaction.userId,
        currency: transaction.currency,
        nairaAmountBase: grossNairaBase.toString(),
        status: TransactionStatus.COMPLETED,
        createdAt: new Date().toISOString(),
        transactionType: TransactionType.DEBIT,
        transactionContext: TransactionContext.SELL,
        senderWalletAddress: transaction.senderWalletAddress,
        receiverWalletAddress: transaction.receiverWalletAddress,
        user: { firstName: null, lastName: null },
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to queue dashboard stats for sell payout ${transaction.id}: ${error?.message}`,
      );
    }

    await this.transactionService.syncCompanyLiquidityCache();
  }

  private async handleTransferFailure(
    reference: string | undefined,
    data: any,
    event: string,
  ): Promise<void> {
    if (!reference) return;

    const order = await this.prisma.order.findFirst({
      where: { paymentReference: reference },
      select: { id: true, transactionId: true, status: true },
    });

    if (!order) {
      this.logger.warn(
        `Sell payout order not found for transfer reference ${reference}`,
      );
      return true;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: order.transactionId },
      select: {
        id: true,
        userId: true,
        currency: true,
        cryptoAmountBase: true,
        fiatAmountBase: true,
        paymentMetadata: true,
      },
    });

    if (!transaction) return;

    const metadata = (transaction.paymentMetadata || {}) as Record<string, any>;
    if (metadata.payoutStatus === 'failed') return;

    await this.prisma.$transaction(async (tx) => {
      if (
        metadata.liquidityReservationStatus ===
        LiquidityReservationStatus.RESERVED
      ) {
        const reservedAmount = toBigInt(transaction.fiatAmountBase);
        await this.companyLiquidityService.releaseLiquidity(
          this.baseCurrency.toLowerCase(),
          reservedAmount,
          tx,
        );
      }

      await this.transactionService.releaseBalance(
        tx,
        transaction.userId,
        transaction.currency,
        toBigInt(transaction.cryptoAmountBase),
      );

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.FAILED,
          paymentStatus: PaymentStatus.FAILED,
          gatewayResponse: JSON.stringify(data),
        },
      });

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.FAILED,
          isProcessed: true,
          paymentMetadata: {
            ...metadata,
            payoutStatus: 'failed',
            payoutFailedAt: new Date().toISOString(),
            payoutFailureEvent: event,
            liquidityReservationStatus:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? LiquidityReservationStatus.RELEASED
                : metadata.liquidityReservationStatus,
            liquidityReleaseReason:
              metadata.liquidityReservationStatus ===
              LiquidityReservationStatus.RESERVED
                ? 'sell_payout_failed'
                : metadata.liquidityReleaseReason,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }
}
