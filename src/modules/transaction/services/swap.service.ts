import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  PrismaService,
  TransactionContext,
  TransactionStatus,
  TransactionType,
} from '../../../infrastructure/databases/prisma';
import { PreviewSwapDto, ConfirmSwapDto } from '../dto';
import { ConvertCurrency, CryptoNetwork, toDecimal } from '../../../shared';
import Decimal from 'decimal.js';
import axios from 'axios';
import { TransactionService } from './transaction.service';
import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
import { ISwapQuote } from './types';

import { CompanyLiquidityService } from './company-liquidity.service';
import { TransactionNotificationService } from './transaction-notification.service';
import { MIN_TRANSACTION_USDT, QUIDAX_COMPANY_USERID } from '../constants';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly tempStore: TempStoreService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly queueService: QueueService,
  ) {}

  private async notifySuperAdminLiquidityInsufficient(
    payload: Record<string, any>,
  ) {
    const to = process.env.SUPERADMIN_EMAIL?.trim();
    if (!to) return;
    await this.queueService.add(QueueName.EMAIL, 'send-transactional-email', {
      to,
      subject: '[ALERT] Insufficient company liquidity',
      template: 'generic-notification',
      context: {
        title: 'Insufficient company liquidity detected',
        data: payload,
      },
    });
  }

  /**
   * Preview a swap using an existing quote ID.
   * Initializes pinVerified = false if not already present.
   */
  async previewSwap(userId: string, dto: PreviewSwapDto) {
    const { quoteId } = dto;

    const raw = await this.tempStore.get(`swap:${quoteId}`);
    if (!raw) throw new NotFoundException('Swap quote not found or expired');

    const quote: ISwapQuote = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (quote.userId !== userId) {
      throw new UnauthorizedException('Quote does not belong to this user');
    }

    if (Date.now() > quote.expiresAt) {
      await this.tempStore.del(`swap:${quoteId}`);
      throw new BadRequestException(
        'Swap quote has expired. Please request a new one.',
      );
    }

    const fromWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: quote.from, mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const toWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: quote.to, mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const fromNet = fromWallet?.defaultNetwork as CryptoNetwork;
    const toNet = toWallet?.defaultNetwork as CryptoNetwork;

    // All display values derived directly from ISwapQuote Minor fields —
    // these are the exact field names getSwapQuote() writes, no aliases
    return {
      message: 'Swap preview ready — please verify your PIN to confirm',
      data: {
        previewId: quoteId,
        from: quote.from,
        to: quote.to,
        fromNetwork: quote.fromNetwork,
        toNetwork: quote.toNetwork,
        amountIn: ConvertCurrency.fromBase(quote.exactFromMinor, quote.from),
        platformFee: ConvertCurrency.fromBase(
          quote.platformFeeMinor,
          quote.from,
        ),
        estimatedOut: ConvertCurrency.fromBase(
          quote.estimatedOutMinor,
          quote.to,
        ),
        marketRate: ConvertCurrency.fromBase(quote.marketRateMinor, quote.to),
        protectedRate: ConvertCurrency.fromBase(
          quote.protectedRateMinor,
          quote.to,
        ),
        bufferSpread: ConvertCurrency.fromBase(
          quote.bufferSpreadMinor,
          quote.to,
        ),
        bufferPercent: quote.bufferPercent,
        totalBufferPercent: quote.totalBufferPercent,
        expiresIn: `${Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000))}s`,
        requiresPinVerification: true,
        pinVerified: quote.pinVerified,
      },
    };
  }

  /**
   * Confirm swap using Quidax instant swap execution.
   * Strict order:
   * 1. Refresh quotation → validate quoted_price >= protectedRate
   * 2. Check company liquidity
   *    - If insufficient: create FailedCompanyLiquidityTransaction, return
   * 3. Reserve user + company balances (no DB records yet)
   * 4. Confirm swap on Quidax
   * 5. Create transaction + swapTransaction records (COMPLETED)
   * 6. If any step fails → release reserves
   */
  async confirmSwap(userId: string, dto: ConfirmSwapDto) {
    await this.transactionService.enforceConfirmationCooldown(userId);
    const { previewId: quoteId } = dto;

    const raw = await this.tempStore.get(`swap:${quoteId}`);
    if (!raw) throw new NotFoundException('Swap quote not found or expired');
    const q: ISwapQuote = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (q.userId !== userId) throw new UnauthorizedException('Not your quote');
    if (!q.pinVerified) throw new UnauthorizedException('PIN not verified');
    if (Date.now() > q.expiresAt) {
      await this.tempStore.del(`swap:${quoteId}`);
      throw new BadRequestException('Quote expired.');
    }

    const fromWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: q.from, mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    const toWallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: { equals: q.to, mode: 'insensitive' } },
      select: { defaultNetwork: true },
    });
    if (!fromWallet || !toWallet) {
      throw new NotFoundException('Swap wallet not found');
    }

    const minimumSwapAmount = new Decimal(MIN_TRANSACTION_USDT);
    if (q.from.toUpperCase() === 'USDT') {
      const fromAmount = new Decimal(
        ConvertCurrency.fromBase(q.exactFromMinor, q.from),
      );
      if (fromAmount.lt(minimumSwapAmount)) {
        throw new BadRequestException(
          `Minimum swap amount is ${MIN_TRANSACTION_USDT} USDT equivalent`,
        );
      }
    }

    // Duplicate check
    const existing = await this.prisma.swapTransaction.findFirst({
      where: { quoteId, userId },
      select: { id: true, status: true, swapId: true },
    });
    if (existing) {
      return {
        success: true,
        swapRecordId: existing.id,
        quidaxSwapId: existing.swapId,
        status: existing.status,
        message: 'Swap already submitted.',
      };
    }

    const fromNet = fromWallet.defaultNetwork as CryptoNetwork;
    const toNet = toWallet.defaultNetwork as CryptoNetwork;
    const quidaxAccountId =
      await this.transactionService.getQuidaxUserId(userId);

    const fromAmountHuman = ConvertCurrency.fromBase(q.exactFromMinor, q.from);

    const exactFromMinor = BigInt(q.exactFromMinor);
    const platformFeeMinor = BigInt(q.platformFeeMinor);
    const reservedAmount = exactFromMinor + platformFeeMinor;

    // ============================================
    // STEP 1: REFRESH QUOTATION + RATE GUARD
    // ============================================
    let refreshedQuotationId: string;
    try {
      const refreshResponse = await axios
        .post(
          `${process.env.QUIDAX_API_URL}/users/${QUIDAX_COMPANY_USERID}/swap_quotation/${q.quotationId}/refresh`,
          {
            from_currency: q.from.toLowerCase(),
            to_currency: q.to.toLowerCase(),
            from_amount: fromAmountHuman,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
            },
          },
        )
        .then((res) => res.data);

      const refreshedData = refreshResponse?.data;
      if (!refreshedData?.id)
        throw new BadRequestException(
          'Cannot complete swap at the moment. Try again later.',
        );

      this.logger.debug(
        `Quidax refresh quote response received: quotationId=${refreshedData.id}, confirmed=${refreshedData.confirmed}`,
      );
      refreshedQuotationId = refreshedData.id;

      const quotedPriceDec = new Decimal(refreshedData.quoted_price);
      const protectedRateDec = new Decimal(
        ConvertCurrency.fromBase(q.protectedRateMinor, q.to),
      );
      if (quotedPriceDec.lt(protectedRateDec)) {
        throw new BadRequestException(
          `Swap rate slipped. Quoted: ${quotedPriceDec.toFixed(q.toDecimals)} < Protected: ${protectedRateDec.toFixed(q.toDecimals)}.`,
        );
      }
    } catch (error: any) {
      throw error;
    }

    // ============================================
    // STEP 2: CREATE TRANSACTION + RESERVE BALANCES (atomic)
    // ============================================
    let pendingTransaction: any;
    let companyLiquidityReserved = false;

    try {
      await this.prisma.$transaction(async (tx) => {
        pendingTransaction = await this.transactionService.createTransaction(
          tx,
          {
            userId,
            transactionUniqueId: quoteId,
            network: fromNet || null,
            currency: q.from.toUpperCase(),
            cryptoAmountBase: exactFromMinor,
            cryptoAmountOriginal: fromAmountHuman,
            platformFeeBase: platformFeeMinor,
            platformFeeOriginal: ConvertCurrency.fromBase(
              q.platformFeeMinor,
              q.from,
            ),
            totalAmountSentBase: reservedAmount,
            totalAmountSentOriginal: ConvertCurrency.fromBase(
              reservedAmount,
              q.from,
            ),
            fiatAmountBase: 0n,
            fiatAmountOriginal: '0',
            transactionType: TransactionType.DEBIT,
            transactionContext: TransactionContext.SWAP,
            status: TransactionStatus.PENDING,
          },
        );

        await this.transactionService.reserveBalance(
          tx,
          userId,
          q.from,
          reservedAmount,
          fromWallet.defaultNetwork,
        );
        companyLiquidityReserved =
          await this.companyLiquidityService.reserveLiquidity(
            q.from,
            exactFromMinor,
            tx,
          );

        if (!companyLiquidityReserved) {
          await tx.failedCompanyLiquidityTransaction.create({
            data: {
              transactionId: pendingTransaction.id,
              transactionType: 'SWAP',
              fromCurrency: q.from.toUpperCase(),
              toCurrency: q.to.toUpperCase(),
              amountOriginal: fromAmountHuman,
              currency: q.from.toUpperCase(),
              amountBase: exactFromMinor.toString(),
              providerResponse: { reason: 'Insufficient company liquidity' },
            },
          });
          await this.notifySuperAdminLiquidityInsufficient({
            context: 'SWAP',
            transactionId: pendingTransaction.id,
            userId,
            currency: q.from.toUpperCase(),
            amountBase: exactFromMinor.toString(),
            fromCurrency: q.from.toUpperCase(),
            toCurrency: q.to.toUpperCase(),
          });
        }
      });
    } catch (error: any) {
      this.logger.error(
        `Balance/liquidity reservation failed: ${error.message}`,
        error.stack,
      );
      if (
        error instanceof BadRequestException &&
        error.message?.toLowerCase().includes('insufficient')
      ) {
        throw error;
      }
      throw new BadRequestException(
        'Cannot confrim swap at the moment. Please try again later',
      );
    }

    if (!companyLiquidityReserved) {
      await this.tempStore.del(`swap:${quoteId}`);
      return {
        success: true,
        message: 'Swap request successful. Awaiting confirmation',
      };
    }

    // ============================================
    // STEP 4: CONFIRM SWAP ON QUIDAX
    // ============================================
    let confirmedSwap: any;
    try {
      const confirmRes = await axios
        .post(
          `${process.env.QUIDAX_API_URL}/users/me/swap_quotation/${refreshedQuotationId}/confirm`,
          {},
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
            },
          },
        )
        .then((res) => res.data);

      confirmedSwap = confirmRes?.data;
      this.logger.debug(
        `Quidax confirm swap response received: id=${confirmedSwap?.id}, status=${confirmedSwap?.status}, execution_price=${confirmedSwap?.execution_price}`,
      );

      // Guard against accidental quotation-shaped response; confirm must return swap-transaction shape
      if (
        !confirmedSwap?.id ||
        !confirmedSwap?.execution_price ||
        !confirmedSwap?.status ||
        !confirmedSwap?.received_amount ||
        !confirmedSwap?.swap_quotation?.id
      ) {
        this.logger.error('Unexpected Quidax confirm swap payload shape', {
          quotationId: refreshedQuotationId,
          payload: confirmRes,
        });
        throw new BadRequestException(
          'Unexpected confirm response from swap provider.',
        );
      }
    } catch (error: any) {
      // Release reserves and mark transaction as FAILED on failure
      await this.prisma.$transaction(async (tx) => {
        await this.transactionService.releaseBalance(
          tx,
          userId,
          q.from,
          reservedAmount,
          fromWallet.defaultNetwork,
        );
        await this.companyLiquidityService.releaseLiquidity(
          q.from,
          exactFromMinor,
          tx,
        );
        await tx.transaction.update({
          where: { id: pendingTransaction.id },
          data: {
            status: TransactionStatus.FAILED,
            isProcessed: true,
            paymentMetadata: {
              ...(pendingTransaction.paymentMetadata as Record<string, any>),
              swapOrderStatus: 'failed',
              swapOrderFailureResponse: error?.message || 'Unknown error',
            } as Record<string, any>,
          },
        });
      });
      await this.tempStore.del(`swap:${quoteId}`);
      throw new BadRequestException(error?.message || 'Swap failed.');
    }

    // ============================================
    // STEP 5: CREATE DB RECORDS (COMPLETED)
    // ============================================
    let transactionRecord: any;
    let swapTxRecord: any;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.update({
          where: { id: pendingTransaction.id },
          data: {
            transactionUniqueId: confirmedSwap.id,
            cryptoAmountOriginal: confirmedSwap.from_amount,
            platformFeeOriginal: ConvertCurrency.fromBase(
              q.platformFeeMinor,
              q.from,
            ),
            totalAmountSentOriginal: new Decimal(confirmedSwap.from_amount)
              .add(ConvertCurrency.fromBase(q.platformFeeMinor, q.from))
              .toString(),
            executedCryptoAmountBase: toDecimal(exactFromMinor),
            executionPrice: confirmedSwap.execution_price,
            executedAt: confirmedSwap.updated_at
              ? new Date(confirmedSwap.updated_at)
              : new Date(),
          },
        });

        const swapTx = await tx.swapTransaction.create({
          data: {
            userId,
            quidaxAccountId,
            fromCurrency: q.from.toUpperCase(),
            toCurrency: q.to.toUpperCase(),
            amountOriginal: confirmedSwap.from_amount,
            quotedPriceOriginal: ConvertCurrency.fromBase(
              q.protectedRateMinor,
              q.to,
            ),
            toAmountOriginal: confirmedSwap.received_amount,
            feeOriginal: ConvertCurrency.fromBase(q.platformFeeMinor, q.from),
            quoteId,
            swapId: confirmedSwap.id,
            executionPriceOriginal: confirmedSwap.execution_price,
            confirmed: false,
            status: TransactionStatus.PENDING,
            description: `Swap ${q.from} → ${q.to}`,
          },
        });

        return { transaction, swapTx };
      });

      transactionRecord = result.transaction;
      swapTxRecord = result.swapTx;
    } catch (error: any) {
      this.logger.error(
        `DB record creation failed: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        'Swap failed during finalization. Please contact support.',
      );
    }

    // Cleanup & notify
    await this.tempStore.del(`swap:${quoteId}`);

    try {
      const txWithUser = await this.prisma.transaction.findUnique({
        where: { id: transactionRecord.id },
        select: {
          id: true,
          userId: true,
          transactionUniqueId: true,
          transactionContext: true,
          status: true,
          currency: true,
          cryptoAmountOriginal: true,
          fiatAmountOriginal: true,
          platformFeeOriginal: true,
          executionPrice: true,
          executedAt: true,
          User: { select: { email: true, firstName: true } },
          paymentMetadata: true,
        },
      });
      if (txWithUser)
        this.transactionNotificationService.sendTransactionInitiatedNotification(
          txWithUser,
        );
    } catch (error) {
      this.logger.error(`Notification failed: ${error.message}`, error.stack);
    }

    return {
      success: true,
      swapRecordId: swapTxRecord.id,
      quidaxSwapId: confirmedSwap.id,
      message: 'Swap request successful. Awaaiting confirmation',
    };
  }
}