import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  PaymentStatus,
  PrismaService,
  TransactionStatus as TxStatus,
} from '../../../infrastructure/databases/prisma';
import { RedisService } from '../../../infrastructure';
import { QuotationService } from './quotation.service';
import { TradingPair } from '../../../infrastructure/providers/quidax';
import { PreviewSellDto } from '../dto';
import {
  TransactionType,
  TransactionContext,
  TransactionStatus,
} from '../../../infrastructure/databases/prisma';
import {
  BASE_CURRENCY,
  COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY,
  COMPANY_PAYSTACK_NGN_WALLET_ID,
  ConvertCurrency,
  CryptoNetwork,
  getCurrencyDecimals,
  LiquidityReservationStatus,
} from '../../../shared';
import { TransactionService } from './transaction.service';
import { CompanyLiquidityService } from './company-liquidity.service';
import { ISellQuote } from './types';
import { TransactionNotificationService } from './transaction-notification.service';
import { MIN_TRANSACTION_USDT, QUIDAX_COMPANY_USERID } from '../constants';
import axios from 'axios';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';

@Injectable()
export class SellService {
  private readonly logger = new Logger(SellService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotationService: QuotationService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly redisService: RedisService,
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

  // ===================================================================
  // PREVIEW SELL
  // ===================================================================
  async previewSell(userId: string, dto: PreviewSellDto) {
    const { quoteId, bankAccountId } = dto;

    const quote: ISellQuote = await this.quotationService.getQuote(quoteId);
    if (!quote) throw new NotFoundException('Sell quote not found or expired');

    if (quote.userId !== userId) {
      throw new UnauthorizedException('Quote does not belong to this user');
    }

    const bankAccount = await this.prisma.userBankAccount.findFirst({
      where: { id: bankAccountId, userId },
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    quote.bankAccountId = bankAccountId;
    await this.quotationService.updateQuote(quoteId, quote);

    return {
      status: 'success',
      data: {
        previewId: quoteId,
        side: 'sell',
        crypto: quote.crypto,
        network: quote.network,
        fiatCurrency: quote.fiatCurrency,
        cryptoAmount: ConvertCurrency.fromBase(
          quote.exactCryptoMinor,
          quote.crypto,
          quote.cryptoDecimals,
        ),
        grossFiat: ConvertCurrency.fromBase(
          quote.grossFiatMinor,
          quote.fiatCurrency,
        ),
        platformFee: ConvertCurrency.fromBase(
          quote.platformFeeMinor,
          quote.crypto,
          quote.cryptoDecimals,
        ),
        bufferSpread: ConvertCurrency.fromBase(
          quote.bufferSpreadMinor,
          quote.fiatCurrency,
        ),
        estimatedNgn: ConvertCurrency.fromBase(
          quote.netFiatMinor,
          quote.fiatCurrency,
        ),
        marketRate: ConvertCurrency.fromBase(
          quote.marketPriceMinor,
          quote.fiatCurrency,
        ),
        bufferedRate: ConvertCurrency.fromBase(
          quote.bufferedPriceMinor,
          quote.fiatCurrency,
        ),
        bufferPercent: quote.bufferPercent,
        expiresIn: Math.max(
          0,
          Math.floor((quote.expiresAt - Date.now()) / 1000),
        ),
        requiresPinVerification: true,
        bankDetails: {
          id: bankAccount.id,
          bankName: bankAccount.bankName,
          bankAccountName: bankAccount.bankAccountName,
          bankAccountNumber: bankAccount.bankAccountNumber,
          bankCode: bankAccount.bankCode,
        },
        message: 'NGN will be credited to your bank account upon completion',
      },
    };
  }

  // ===================================================================
  // CONFIRM SELL
  // ===================================================================
  async confirmSell(userId: string, previewId: string) {
    await this.transactionService.enforceConfirmationCooldown(userId);
    const quote: ISellQuote = await this.quotationService.getQuote(previewId);
    if (!quote) throw new NotFoundException('Sell quote not found or expired');
    if (quote.userId !== userId)
      throw new UnauthorizedException('Not your quote');
    if (!quote.pinVerified) throw new UnauthorizedException('PIN not verified');

    const normalizedCrypto = quote.crypto.toUpperCase();
    const quoteNetwork =
      quote.network && quote.network !== 'N/A'
        ? (quote.network as CryptoNetwork)
        : undefined;
    const cryptoDecimals =
      typeof quote.cryptoDecimals === 'number'
        ? quote.cryptoDecimals
        : getCurrencyDecimals(normalizedCrypto, quoteNetwork);

    if (normalizedCrypto === 'USDT') {
      const minUsdtBase = ConvertCurrency.toBase(
        MIN_TRANSACTION_USDT.toString(),
        normalizedCrypto,
        cryptoDecimals,
      );
      if (BigInt(quote.exactCryptoMinor) < minUsdtBase) {
        throw new BadRequestException(
          `Minimum transaction amount is ${MIN_TRANSACTION_USDT} USDT`,
        );
      }
    }

    // Slippage protection: check current price against quoted buffered price
    await this.transactionService.checkPriceSlippage(
      normalizedCrypto,
      quote.fiatCurrency,
      ConvertCurrency.fromBase(quote.bufferedPriceMinor, quote.fiatCurrency),
      false, // isBuy (false for sell)
    );

    const existingTransaction = await this.prisma.transaction.findFirst({
      where: { transactionUniqueId: previewId },
      select: { id: true, status: true },
    });
    if (existingTransaction) {
      return {
        success: true,
        message: 'Sell already submitted',
        data: {
          transactionId: existingTransaction.id,
          status: existingTransaction.status,
        },
      };
    }

    const cryptoAmountBase = BigInt(quote.exactCryptoMinor);
    const netFiatBase = BigInt(quote.netFiatMinor);
    const platformFeeBase = BigInt(quote.platformFeeMinor);
    const totalUserDebitBase = cryptoAmountBase + platformFeeBase;
    const bufferSpreadBase = BigInt(quote.bufferSpreadMinor);

    const cryptoOriginal = ConvertCurrency.fromBase(
      quote.exactCryptoMinor,
      normalizedCrypto,
      cryptoDecimals,
    );
    const estimatedNgn = ConvertCurrency.fromBase(
      quote.netFiatMinor,
      quote.fiatCurrency,
    );

    const userBankAccount = await this.prisma.userBankAccount.findFirst({
      where: {
        id: quote.bankAccountId,
        userId,
      },
    });

    if (!userBankAccount) {
      throw new BadRequestException('No bank account found for payout');
    }

    const userWallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        currency: { equals: normalizedCrypto, mode: 'insensitive' },
      },
      select: { quidaxWalletId: true },
    });

    if (!userWallet?.quidaxWalletId) {
      throw new BadRequestException(`Wallet not found for ${quote.crypto}`);
    }

    const marketPair =
      `${quote.crypto.toLowerCase()}${BASE_CURRENCY}` as TradingPair;

    const result = await this.prisma.$transaction(async (tx) => {
      // Idempotency guard: re-check inside transaction to prevent TOCTOU race
      const existingTx = await tx.transaction.findFirst({
        where: { transactionUniqueId: previewId },
        select: { id: true, status: true, paymentMetadata: true },
      });
      if (existingTx) {
        return {
          transaction: existingTx,
          order: { id: '' },
          queued: false,
          isDuplicate: true,
        };
      }

      await this.transactionService.reserveBalance(
        tx,
        userId,
        quote.crypto,
        totalUserDebitBase,
      );

      const availableLiquidity =
        await this.companyLiquidityService.getAvailableLiquidity(
          BASE_CURRENCY,
          tx,
        );
      const hasLiquidity = availableLiquidity >= netFiatBase;

      const transaction = await this.transactionService.createTransaction(tx, {
        userId,
        senderWalletAddress: userWallet.quidaxWalletId,
        receiverWalletAddress: null,
        transactionUniqueId: previewId,
        network: quote.network !== 'N/A' ? quote.network : null,
        currency: normalizedCrypto,
        cryptoAmountBase: cryptoAmountBase,
        fiatAmountBase: netFiatBase,
        cryptoAmountOriginal: cryptoOriginal,
        fiatAmountOriginal: estimatedNgn,
        platformFeeBase: platformFeeBase,
        platformFeeOriginal: ConvertCurrency.fromBase(
          quote.platformFeeMinor,
          normalizedCrypto,
          cryptoDecimals,
        ),
        bufferAmountBase: bufferSpreadBase,
        bufferAmountOriginal: ConvertCurrency.fromBase(
          quote.bufferSpreadMinor,
          quote.fiatCurrency,
        ),
        totalAmountSentBase: totalUserDebitBase,
        totalAmountSentOriginal: ConvertCurrency.fromBase(
          totalUserDebitBase,
          normalizedCrypto,
          cryptoDecimals,
        ),
        transactionType: TransactionType.DEBIT,
        transactionContext: TransactionContext.SELL,
        status: TransactionStatus.PENDING,
        paymentType: null,
        paymentMetadata: {
          quoteId: previewId,
          payoutBankAccountId: userBankAccount.id,
          payoutAccountNumber: userBankAccount.bankAccountNumber,
          payoutBankCode: userBankAccount.bankCode,
          payoutAccountName: userBankAccount.bankAccountName,
          liquidityReservationStatus: hasLiquidity
            ? LiquidityReservationStatus.RESERVED
            : LiquidityReservationStatus.INSUFFICIENT,
        },
      });

      const order = await tx.order.create({
        data: {
          transactionId: transaction.id,
          userId,
          cryptoAmountBase: cryptoAmountBase.toString(),
          cryptoAmountOriginal: cryptoOriginal.toString(),
          fiatAmountBase: netFiatBase.toString(),
          fiatAmountOriginal: estimatedNgn.toString(),
          fiatCurrency: quote.fiatCurrency || BASE_CURRENCY.toUpperCase(),
          status: hasLiquidity ? OrderStatus.PENDING : OrderStatus.FAILED,
          type: OrderType.SELL,
          referenceNo: previewId, // Temporary; updated to Quidax reference after order placement
          paymentStatus: PaymentStatus.PENDING,
          paymentAmountBase: netFiatBase.toString(),
          paymentAmountOriginal: estimatedNgn.toString(),
        },
      });

      if (!hasLiquidity) {
        await tx.failedCompanyLiquidityTransaction.create({
          data: {
            transactionId: transaction.id,
            currency: BASE_CURRENCY,
            amountBase: netFiatBase.toString(),
            providerResponse: {
              reason: 'Insufficient company NGN liquidity for sell payout',
            },
          },
        });
        await this.notifySuperAdminLiquidityInsufficient({
          context: 'SELL',
          transactionId: transaction.id,
          userId,
          currency: BASE_CURRENCY,
          amountBase: netFiatBase.toString(),
        });

        return { transaction, order, queued: true };
      }

      const reserved = await this.companyLiquidityService.reserveLiquidity(
        BASE_CURRENCY,
        netFiatBase,
        tx,
      );

      if (!reserved) {
        await tx.failedCompanyLiquidityTransaction.create({
          data: {
            transactionId: transaction.id,
            currency: BASE_CURRENCY,
            amountBase: netFiatBase.toString(),
            providerResponse: {
              reason: 'Failed to reserve company NGN liquidity for sell payout',
            },
          },
        });
        await this.notifySuperAdminLiquidityInsufficient({
          context: 'SELL',
          transactionId: transaction.id,
          userId,
          currency: BASE_CURRENCY,
          amountBase: netFiatBase.toString(),
        });

        return { transaction, order, queued: true };
      }

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentMetadata: {
            ...(transaction.paymentMetadata as Record<string, any>),
            liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
          },
        },
      });

      return { transaction, order, queued: false };
    });

    // Delete quote for duplicates immediately
    if (result.isDuplicate) {
      await this.quotationService.deleteQuote(previewId);
      return {
        success: true,
        message: 'Sell already submitted',
        data: {
          transactionId: result.transaction.id,
          status: result.transaction.status,
        },
      };
    }

    if (result.queued) {
      await this.quotationService.deleteQuote(previewId);
      return {
        success: true,
        message: 'Sell order is queued for processing',
        data: {
          previewId,
          sold: cryptoOriginal.toString(),
          currency: quote.crypto,
          estimatedNgnCredit: estimatedNgn.toString(),
          ngnCurrency: quote.fiatCurrency || BASE_CURRENCY.toUpperCase(),
        },
      };
    }

    // Confirm Paystack liquidity from scheduler-synced company_liquidity record
    // dedicated to paystack balance, reading from Redis cache first.
    const paystackLiquidityCache = await this.redisService.get<{
      id: string;
      totalBalance: string;
      reservedBalance?: string;
    }>(COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY);

    const totalPaystackLiquidityBase =
      paystackLiquidityCache?.id === COMPANY_PAYSTACK_NGN_WALLET_ID
        ? BigInt(paystackLiquidityCache.totalBalance || '0')
        : 0n;
    const paystackReservedLiquidityBase = BigInt(
      paystackLiquidityCache?.reservedBalance || '0',
    );

    const availablePaystackLiquidityBase =
      totalPaystackLiquidityBase - paystackReservedLiquidityBase;
    if (availablePaystackLiquidityBase < netFiatBase) {
      await this.prisma.$transaction(async (tx) => {
        await this.companyLiquidityService.releaseLiquidity(
          BASE_CURRENCY,
          netFiatBase,
          tx,
        );

        await tx.failedCompanyLiquidityTransaction.upsert({
          where: { transactionId: result.transaction.id },
          update: {
            transactionType: TransactionContext.SELL,
            fromCurrency: quote.crypto,
            toCurrency: quote.fiatCurrency || BASE_CURRENCY.toUpperCase(),
            amountOriginal: estimatedNgn.toString(),
            currency: BASE_CURRENCY,
            amountBase: netFiatBase.toString(),
            providerResponse: {
              reason: 'Insufficient Paystack liquidity for sell payout',
              availablePaystackLiquidityBase:
                availablePaystackLiquidityBase.toString(),
              requiredAmountBase: netFiatBase.toString(),
            },
          },
          create: {
            transactionId: result.transaction.id,
            transactionType: TransactionContext.SELL,
            fromCurrency: quote.crypto,
            toCurrency: quote.fiatCurrency || BASE_CURRENCY.toUpperCase(),
            amountOriginal: estimatedNgn.toString(),
            currency: BASE_CURRENCY,
            amountBase: netFiatBase.toString(),
            providerResponse: {
              reason: 'Insufficient Paystack liquidity for sell payout',
              availablePaystackLiquidityBase:
                availablePaystackLiquidityBase.toString(),
              requiredAmountBase: netFiatBase.toString(),
            },
          },
        });

        await tx.transaction.update({
          where: { id: result.transaction.id },
          data: {
            paymentMetadata: {
              ...((result.transaction.paymentMetadata as Record<string, any>) ||
                {}),
              liquidityReservationStatus:
                LiquidityReservationStatus.INSUFFICIENT,
              providerLiquiditySource: 'paystack',
            },
          },
        });
      });

      await this.quotationService.deleteQuote(previewId);
      return {
        success: true,
        message: 'Sell order is queued for processing',
        data: {
          previewId,
          sold: cryptoOriginal.toString(),
          currency: quote.crypto,
          estimatedNgnCredit: estimatedNgn.toString(),
          ngnCurrency: quote.fiatCurrency || BASE_CURRENCY.toUpperCase(),
        },
      };
    }

    // Place Quidax order immediately to minimize race condition window
    const orderResponse = await axios
      .post(
        `${process.env.QUIDAX_API_URL}/users/${QUIDAX_COMPANY_USERID}/orders`,
        {
          market: marketPair,
          side: 'sell',
          ord_type: 'market',
          volume: Number(cryptoOriginal.toString()),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
          },
        },
      )
      .then((res) => res.data);

    if (orderResponse.status !== 'success') {
      await this.prisma.$transaction(async (tx) => {
        await this.transactionService.releaseBalance(
          tx,
          userId,
          quote.crypto,
          totalUserDebitBase,
        );
        await this.companyLiquidityService.releaseLiquidity(
          BASE_CURRENCY,
          netFiatBase,
          tx,
        );

        await tx.transaction.update({
          where: { id: result.transaction.id },
          data: {
            status: TxStatus.FAILED,
            isProcessed: true,
            paymentMetadata: {
              ...((result.transaction.paymentMetadata as Record<string, any>) ||
                {}),
              sellOrderStatus: 'failed',
              sellOrderFailureResponse: orderResponse,
              liquidityReservationStatus: LiquidityReservationStatus.RELEASED,
              liquidityReleaseReason: 'sell_order_placement_failed',
            } as unknown as Record<string, any>,
          },
        });

        await tx.order.update({
          where: { id: result.order.id },
          data: {
            status: OrderStatus.FAILED,
            paymentStatus: PaymentStatus.FAILED,
            gatewayResponse: JSON.stringify(orderResponse),
          },
        });
      });

      throw new BadGatewayException('Failed to place sell order');
    }

    const providerReference =
      orderResponse.data.reference || orderResponse.data.id;

    // Update order referenceNo to Quidax reference immediately
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: result.order.id },
        data: {
          referenceNo: providerReference,
          gatewayResponse: JSON.stringify(orderResponse.data),
        },
      });

      await tx.transaction.update({
        where: { id: result.transaction.id },
        data: {
          paymentMetadata: {
            ...((result.transaction.paymentMetadata as Record<string, any>) ||
              {}),
            quidaxOrderReference: providerReference,
            quidaxOrderId: orderResponse.data.id,
            sellOrderStatus: 'submitted',
          },
        },
      });
    });

    // Delete quote only after Quidax order is confirmed
    await this.quotationService.deleteQuote(previewId);

    // Send notification after reference is set (non-blocking)
    const transactionWithUser = await this.prisma.transaction.findUnique({
      where: { id: result.transaction.id },
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

    if (transactionWithUser) {
      try {
        await this.transactionNotificationService.sendTransactionInitiatedNotification(
          transactionWithUser,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send notification for sell transaction ${result.transaction.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    return {
      success: true,
      message: 'Sell order placed successfully.',
      data: {
        previewId,
        sold: cryptoOriginal.toString(),
        currency: quote.crypto,
        estimatedNgnCredit: estimatedNgn.toString(),
        ngnCurrency: quote.fiatCurrency || BASE_CURRENCY.toUpperCase(),
        status: 'PROCESSING',
      },
    };
  }
}
