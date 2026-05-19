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
 import { TransactionService } from './transaction.service';
  import { TempStoreService } from '../../../infrastructure/databases/redis/temp-store.service';
  import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
  import { ISwapQuote } from './types';

 import { CompanyLiquidityService } from './company-liquidity.service';
 import { TransactionNotificationService } from './transaction-notification.service';
 import { QUIDAX_COMPANY_USERID } from '../constants';

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly transactionService: TransactionService,
    private readonly tempStore: TempStoreService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly transactionNotificationService: TransactionNotificationService,
  ) {}

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
  
      const fromNet = quote.fromNetwork as CryptoNetwork;
      const toNet = quote.toNetwork as CryptoNetwork;
  
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
          amountIn: ConvertCurrency.fromBase(
            quote.exactFromMinor,
            quote.from,
            fromNet,
          ),
          platformFee: ConvertCurrency.fromBase(
            quote.platformFeeMinor,
            quote.from,
            fromNet,
          ),
          estimatedOut: ConvertCurrency.fromBase(
            quote.estimatedOutMinor,
            quote.to,
            toNet,
          ),
          marketRate: ConvertCurrency.fromBase(
            quote.marketRateMinor,
            quote.to,
            toNet,
          ),
          protectedRate: ConvertCurrency.fromBase(
            quote.protectedRateMinor,
            quote.to,
            toNet,
          ),
          bufferSpread: ConvertCurrency.fromBase(
            quote.bufferSpreadMinor,
            quote.to,
            toNet,
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

    const fromNet = q.fromNetwork as CryptoNetwork;
    const toNet = q.toNetwork as CryptoNetwork;
    const quidaxAccountId = await this.transactionService.getQuidaxUserId(userId);

    const fromAmountHuman = ConvertCurrency.fromBase(q.exactFromMinor, q.from, fromNet);
    const toAmountHuman = ConvertCurrency.fromBase(q.estimatedOutMinor, q.to, toNet);

    const exactFromMinor = BigInt(q.exactFromMinor);
    const estimatedToMinor = BigInt(q.estimatedOutMinor);
    const platformFeeMinor = BigInt(q.platformFeeMinor);
    const reservedAmount = exactFromMinor + platformFeeMinor;

    // ============================================
    // STEP 1: REFRESH QUOTATION + RATE GUARD
    // ============================================
    let refreshedQuotationId: string;
    try {
      const refreshResponse = await this.quidaxSwapService.refreshInstantSwapQuote(QUIDAX_COMPANY_USERID, q.quotationId, {
        from_currency: q.from.toLowerCase(),
        to_currency: q.to.toLowerCase(),
        from_amount: fromAmountHuman,
        to_amount: toAmountHuman,
      });

      const refreshedData = refreshResponse?.data;
      if (!refreshedData?.id) throw new BadRequestException('Cannot complete swap at the moment. Try again later.');
      refreshedQuotationId = refreshedData.id;

      const quotedPriceDec = new Decimal(refreshedData.quoted_price);
      const protectedRateDec = new Decimal(ConvertCurrency.fromBase(q.protectedRateMinor, q.to, toNet));
      if (quotedPriceDec.lt(protectedRateDec)) {
        throw new BadRequestException(
          `Swap rate slipped. Quoted: ${quotedPriceDec.toFixed(q.toDecimals)} < Protected: ${protectedRateDec.toFixed(q.toDecimals)}.`
        );
      }
    } catch (error: any) {
      throw error;
    }

    // ============================================
    // STEP 2: CREATE TRANSACTION ROW + CHECK COMPANY LIQUIDITY
    // ============================================
    const pendingTransaction = await this.prisma.transaction.create({
      data: {
        userId,
        fromCurrency: q.from,
        toCurrency: q.to,
        currency: q.from,
        network: fromNet || null,
        transactionContext: TransactionContext.SWAP,
        transactionType: TransactionType.DEBIT,
        transactionUniqueId: quoteId,
        cryptoAmountBase: toDecimal(exactFromMinor),
        cryptoAmountOriginal: fromAmountHuman,
        platformFeeBase: toDecimal(platformFeeMinor),
        platformFeeOriginal: ConvertCurrency.fromBase(q.platformFeeMinor, q.from, fromNet),
        totalAmountSentBase: toDecimal(reservedAmount),
        totalAmountSentOriginal: ConvertCurrency.fromBase(reservedAmount, q.from, fromNet),
        fiatAmountBase: toDecimal(0n),
        fiatAmountOriginal: '0',
        status: TransactionStatus.PENDING,
        isProcessed: false,
        description: `Swap: ${q.from} → ${q.to}`,
      },
    });

    const availableLiquidity = await this.companyLiquidityService.getAvailableLiquidity(q.from);
    const hasSufficientLiquidity = availableLiquidity >= exactFromMinor;

    if (!hasSufficientLiquidity) {
      await this.prisma.failedCompanyLiquidityTransaction.create({
        data: {
          transactionId: pendingTransaction.id,
          transactionType: 'SWAP',
          fromCurrency: q.from,
          toCurrency: q.to,
          amountOriginal: fromAmountHuman,
          currency: q.from,
          amountBase: exactFromMinor.toString(),
          providerResponse: { reason: 'Insufficient company liquidity' },
        },
      });
      await this.tempStore.del(`swap:${quoteId}`);
      return {
        success: true,
        message: 'Swap request successful. Awaiting confirmation',
      };
    }

    // ============================================
    // STEP 3: RESERVE BALANCES (both user and company)
    // ============================================
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.transactionService.reserveBalance(tx, userId, q.from, reservedAmount);
        // Company liquidity reservation works on the from-currency pool and
        // uses the exact user input amount — not the estimated output.
        await this.companyLiquidityService.reserveLiquidity(q.from, exactFromMinor, tx);
      });
    } catch (error: any) {
      this.logger.error(`Balance reservation failed: ${error.message}`, error.stack);
      throw new BadRequestException('Cannot confrim swap at the moment. Please try again later');
    }

    // ============================================
    // STEP 4: CONFIRM SWAP ON QUIDAX
    // ============================================
    let confirmedSwap: any;
    try {
      const confirmRes = await this.quidaxSwapService.confirmInstantSwap({
        user_id: 'me',
        quotation_id: refreshedQuotationId,
      });
      confirmedSwap = confirmRes?.data;
      if (!confirmedSwap?.id) throw new BadRequestException('Provider confirmation failed');
    } catch (error: any) {
      // Release reserves on failure
      await this.prisma.$transaction(async (tx) => {
        await this.transactionService.releaseBalance(tx, userId, q.from, reservedAmount);
        // Release matches reserve — from-currency, exact user input amount.
        await this.companyLiquidityService.releaseLiquidity(q.from, exactFromMinor, tx);
      });
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
            executionPrice: confirmedSwap.execution_price,
          },
        });

        const swapTx = await tx.swapTransaction.create({
          data: {
            userId,
            quidaxAccountId,
            fromCurrency: q.from,
            toCurrency: q.to,
            amountOriginal: confirmedSwap.from_amount,
            quotedPriceOriginal: ConvertCurrency.fromBase(q.protectedRateMinor, q.to, toNet),
            toAmountOriginal: confirmedSwap.received_amount,
            feeOriginal: ConvertCurrency.fromBase(q.platformFeeMinor, q.from, fromNet),
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
      this.logger.error(`DB record creation failed: ${error.message}`, error.stack);
      throw new BadRequestException('Swap failed during finalization. Please contact support.');
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
      if (txWithUser) this.transactionNotificationService.sendTransactionInitiatedNotification(txWithUser);
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
