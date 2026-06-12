import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { PreviewBuyDto } from '../dto';
import {
  PaymentType,
  TransactionType,
  TransactionContext,
  TransactionStatus,
  OrderStatus,
  OrderType,
  PaymentStatus,
} from '../../../infrastructure/databases/prisma';
import {
  BASE_CURRENCY,
  ConvertCurrency,
  LiquidityReservationStatus,
  toDecimal,
} from '../../../shared';
import { MIN_TRANSACTION_USDT } from '../constants';
import { TransactionService } from './transaction.service';
import { TempStoreService } from '../../../infrastructure';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { CompanyLiquidityService } from './company-liquidity.service';
import { IBuyQuote } from './types';
import { TransactionNotificationService } from './transaction-notification.service';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';

@Injectable()
export class BuyService {
  private readonly logger = new Logger(BuyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly tempStore: TempStoreService,
    private readonly paystackService: PaystackService,
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

  private async sendCompletedTransactionNotification(transactionId: string) {
    try {
      const transactionWithUser = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
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

      if (transactionWithUser) {
        await this.transactionNotificationService.sendTransactionStatusNotification(
          transactionWithUser,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send completed notification for buy transaction ${transactionId}: ${error.message}`,
        error.stack,
      );
    }
  }

  getPaymentMethods() {
    return [
      {
        id: '1083464737464',
        type: PaymentType.CARD,
        description: 'Pay using a saved debit or credit card',
      },
      {
        id: '3646737378364',
        type: PaymentType.PAYSTACK,
        description: 'Pay using Paystack (new card or bank)',
      },
    ];
  }

  private async completeNonProductionBuyConfirm({
    transactionId,
    transactionPaymentMetadata,
    userId,
    normalizedCrypto,
    cryptoDecimals,
    quote,
    previewId,
    volumeCryptoMinor,
    totalFiatMinor,
    cryptoOriginal,
    fiatOriginal,
  }: {
    transactionId: string;
    transactionPaymentMetadata?: Record<string, any> | null;
    userId: string;
    normalizedCrypto: string;
    cryptoDecimals: number;
    quote: IBuyQuote;
    previewId: string;
    volumeCryptoMinor: bigint;
    totalFiatMinor: bigint;
    cryptoOriginal: string;
    fiatOriginal: string;
  }) {
    await this.prisma.$transaction(async (tx) => {
      const existingCompletedOrder = await tx.order.findUnique({
        where: { transactionId },
        select: { status: true },
      });

      if (existingCompletedOrder?.status !== OrderStatus.COMPLETED) {
        const creditAmount = toDecimal(volumeCryptoMinor);
        const updatedWallet = await tx.$queryRaw<
          { baseBalance: string; defaultNetwork: string | null }[]
        >`
          UPDATE "wallets"
          SET "baseBalance" = "baseBalance" + ${creditAmount}
          WHERE "userId" = ${userId}
            AND LOWER("currency") = LOWER(${normalizedCrypto})
          RETURNING "baseBalance", "defaultNetwork"
        `;

        if (updatedWallet.length === 0) {
          throw new NotFoundException(
            `Wallet not found for ${normalizedCrypto}`,
          );
        }

        const newOriginalBalance = ConvertCurrency.fromBase(
          BigInt(String(updatedWallet[0].baseBalance)),
          normalizedCrypto,
        );

        await tx.wallet.updateMany({
          where: {
            userId,
            currency: { equals: normalizedCrypto, mode: 'insensitive' },
          },
          data: { originalBalance: newOriginalBalance },
        });
      }

      await tx.order.upsert({
        where: { transactionId },
        update: {
          status: OrderStatus.COMPLETED,
          type: OrderType.BUY,
          referenceNo: previewId,
          paymentStatus: PaymentStatus.PAID,
          paymentReference: previewId,
          paymentChannel: 'non_production_bypass',
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify({ providerBypass: true }),
        },
        create: {
          transactionId,
          userId,
          cryptoAmountBase: volumeCryptoMinor.toString(),
          cryptoAmountOriginal: cryptoOriginal,
          fiatAmountBase: totalFiatMinor.toString(),
          fiatAmountOriginal: fiatOriginal,
          fiatCurrency: quote.fiatCurrency,
          status: OrderStatus.COMPLETED,
          type: OrderType.BUY,
          referenceNo: previewId,
          paymentStatus: PaymentStatus.PAID,
          paymentReference: previewId,
          paymentChannel: 'non_production_bypass',
          paymentAmountBase: totalFiatMinor.toString(),
          paymentAmountOriginal: fiatOriginal,
          paymentDate: new Date(),
          gatewayResponse: JSON.stringify({ providerBypass: true }),
        },
      });

      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.COMPLETED,
          isProcessed: true,
          executedCryptoAmountBase: toDecimal(volumeCryptoMinor),
          executedFiatAmountBase: toDecimal(totalFiatMinor),
          executionPrice: ConvertCurrency.fromBase(
            quote.bufferedPriceMinor,
            quote.fiatCurrency,
          ),
          executedAt: new Date(),
          paymentMetadata: {
            ...(transactionPaymentMetadata || {}),
            providerBypass: true,
            providerBypassReason: 'non_production_buy_confirm',
            paystackReference: previewId,
            quidaxOrderReference: previewId,
            buyOrderStatus: 'completed_without_provider',
          },
        },
      });
    });
  }

  // ===================================================================
  // PREVIEW BUY
  // ===================================================================
  async previewBuy(userId: string, dto: PreviewBuyDto) {
    const { quoteId, paymentMethodId, cardId } = dto;

    const quoteKey = `buy:${quoteId}`;
    const quoteRaw = await this.tempStore.get(quoteKey);
    if (!quoteRaw)
      throw new NotFoundException('Buy quote not found or expired');

    const quote: IBuyQuote =
      typeof quoteRaw === 'string' ? JSON.parse(quoteRaw) : quoteRaw;

    if (quote.userId !== userId) {
      throw new UnauthorizedException('Quote does not belong to this user');
    }

    if (Date.now() > quote.expiresAt) {
      await this.tempStore.del(quoteKey);
      throw new BadRequestException(
        'Buy quote has expired. Please request a new one.',
      );
    }

    const paymentMethod = this.getPaymentMethods().find(
      (m) => m.id === paymentMethodId,
    );
    if (!paymentMethod)
      throw new BadRequestException('Invalid payment method ID');

    let cardDetails: { cardType: string | null; last4: string } | null = null;

    if (paymentMethod.type === PaymentType.CARD) {
      if (!cardId)
        throw new BadRequestException(
          'cardId is required when paymentType is CARD',
        );

      cardDetails = await this.prisma.paymentCard.findFirst({
        where: { id: cardId, userId, reusable: true },
        select: { cardType: true, last4: true },
      });
      if (!cardDetails)
        throw new BadRequestException('Invalid or unauthorized card');

      quote.paymentMethodId = paymentMethodId;
      quote.cardId = cardId;
    } else if (paymentMethod.type === PaymentType.PAYSTACK) {
      quote.paymentMethodId = paymentMethodId;
    }

    const ttlSeconds = Math.max(
      1,
      Math.floor((quote.expiresAt - Date.now()) / 1000),
    );
    await this.tempStore.set(quoteKey, JSON.stringify(quote), ttlSeconds);

    let paymentDetails: any = null;
    if (paymentMethod.type === PaymentType.CARD) {
      paymentDetails = {
        method: 'CARD',
        last4: cardDetails?.last4,
        cardType: cardDetails?.cardType || 'Debit Card',
      };
    } else if (paymentMethod.type === PaymentType.PAYSTACK) {
      paymentDetails = {
        method: PaymentType.PAYSTACK,
        description: 'Pay with Paystack (new card or bank)',
      };
    }

    return {
      message: 'Buy preview retrieval success',
      data: {
        previewId: quoteId,
        side: 'buy',
        crypto: quote.crypto,
        network: quote.network,
        fiatCurrency: quote.fiatCurrency,
        fiatAmount: ConvertCurrency.fromBase(
          quote.totalFiatMinor,
          quote.fiatCurrency,
        ),
        estimatedCrypto: ConvertCurrency.fromBase(
          quote.volumeCryptoMinor,
          quote.crypto,
        ),
        platformFee: ConvertCurrency.fromBase(
          quote.platformFeeMinor,
          quote.fiatCurrency,
        ),
        bufferSpread: ConvertCurrency.fromBase(
          quote.bufferSpreadMinor,
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
        paymentType: paymentMethod.type,
        paymentDetails,
        requiresPinVerification: true,
      },
    };
  }

  async confirmBuy(userId: string, previewId: string) {
    await this.transactionService.enforceConfirmationCooldown(userId);
    const quoteKey = `buy:${previewId}`;
    const quoteRaw = await this.tempStore.get(quoteKey);
    if (!quoteRaw)
      throw new NotFoundException('Buy quote not found or expired');

    const quote: IBuyQuote =
      typeof quoteRaw === 'string' ? JSON.parse(quoteRaw) : quoteRaw;

    if (quote.userId !== userId)
      throw new UnauthorizedException('Not your quote');
    if (!quote.pinVerified) throw new UnauthorizedException('PIN not verified');
    if (Date.now() > quote.expiresAt) {
      await this.tempStore.del(quoteKey);
      throw new BadRequestException('Quote expired. Please request a new one.');
    }

    const normalizedCrypto = quote.crypto.toUpperCase();
    const userCryptoWallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        currency: { equals: normalizedCrypto, mode: 'insensitive' },
      },
      select: { quidaxWalletId: true, defaultNetwork: true },
    });

    if (!userCryptoWallet?.quidaxWalletId) {
      throw new NotFoundException(`Wallet not found for ${quote.crypto}`);
    }
    const cryptoDecimals =
      typeof quote.cryptoDecimals === 'number'
        ? quote.cryptoDecimals
        : ConvertCurrency.getDecimals(normalizedCrypto);

    if (normalizedCrypto === 'USDT') {
      const minUsdtBase = ConvertCurrency.toBase(
        MIN_TRANSACTION_USDT.toString(),
        normalizedCrypto,
      );
      if (BigInt(quote.volumeCryptoMinor) < minUsdtBase) {
        throw new BadRequestException(
          `Minimum transaction amount is ${MIN_TRANSACTION_USDT} USDT`,
        );
      }
    }

    const bypassProviders = process.env.NODE_ENV !== 'production';

    // Slippage protection uses provider tickers; skip it in non-production
    // confirmations so local/dev flows do not call Quidax.
    if (!bypassProviders) {
      await this.transactionService.checkPriceSlippage(
        normalizedCrypto,
        quote.fiatCurrency,
        ConvertCurrency.fromBase(quote.bufferedPriceMinor, quote.fiatCurrency),
        true, // isBuy
      );
    }

    const paymentMethod = this.getPaymentMethods().find(
      (m) => m.id === quote.paymentMethodId,
    );
    if (!paymentMethod)
      throw new BadRequestException('Payment method not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const totalFiatMinor = BigInt(quote.totalFiatMinor);
    const platformFeeMinor = BigInt(quote.platformFeeMinor);
    const bufferSpreadMinor = BigInt(quote.bufferSpreadMinor);
    const volumeCryptoMinor = BigInt(quote.volumeCryptoMinor);
    const companyLiquidityAmount = totalFiatMinor - platformFeeMinor;

    const fiatOriginal = ConvertCurrency.fromBase(
      quote.totalFiatMinor,
      quote.fiatCurrency,
    );
    const cryptoOriginal = ConvertCurrency.fromBase(
      quote.volumeCryptoMinor,
      normalizedCrypto,
    );
    const companyDepositReference = `company-deposit-${previewId}`;

    const existingTransaction = await this.prisma.transaction.findFirst({
      where: { transactionUniqueId: previewId },
      select: { id: true, status: true, paymentMetadata: true },
    });
    if (existingTransaction) {
      if (
        bypassProviders &&
        existingTransaction.status !== TransactionStatus.COMPLETED
      ) {
        await this.completeNonProductionBuyConfirm({
          transactionId: existingTransaction.id,
          transactionPaymentMetadata:
            existingTransaction.paymentMetadata as Record<string, any> | null,
          userId,
          normalizedCrypto,
          cryptoDecimals,
          quote,
          previewId,
          volumeCryptoMinor,
          totalFiatMinor,
          cryptoOriginal,
          fiatOriginal,
        });
        await this.tempStore.del(quoteKey);
        await this.sendCompletedTransactionNotification(existingTransaction.id);
      }

      return {
        message: 'Buy already submitted',
        data: {
          transactionId: existingTransaction.id,
          status: bypassProviders
            ? TransactionStatus.COMPLETED
            : existingTransaction.status,
        },
      };
    }

    let transactionRecord: any;
    let queuedForLiquidity = false;
    let isDuplicate = false;

    const totalFiatMinorAsNumber = Number(totalFiatMinor);

    await this.prisma.$transaction(async (tx) => {
      const existingTransaction = await tx.transaction.findFirst({
        where: { transactionUniqueId: previewId },
        select: { id: true, status: true },
      });
      if (existingTransaction) {
        transactionRecord = existingTransaction;
        isDuplicate = true;
        return;
      }

      const reserved = bypassProviders
        ? true
        : await this.companyLiquidityService.reserveLiquidity(
            BASE_CURRENCY,
            companyLiquidityAmount,
            tx,
          );

      const liquidityReservationStatus = reserved
        ? LiquidityReservationStatus.RESERVED
        : LiquidityReservationStatus.INSUFFICIENT;

      transactionRecord = await this.transactionService.createTransaction(tx, {
        userId,
        receiverWalletAddress: userCryptoWallet.quidaxWalletId,
        senderWalletAddress: null,
        paymentType: paymentMethod.type,
        paymentMetadata: {
          companyDepositReference,
          liquidityReservationStatus,
          liquidityReservationAmount: companyLiquidityAmount.toString(),
          liquidityReservationCurrency: BASE_CURRENCY,
          paymentMethodId: quote.paymentMethodId,
          cardId: quote.cardId ?? null,
        },
        platformWalletAddress: null,
        transactionUniqueId: previewId,
        network: quote.network,
        currency: normalizedCrypto,
        cryptoAmountBase: volumeCryptoMinor,
        fiatAmountBase: totalFiatMinor,
        cryptoAmountOriginal: cryptoOriginal,
        fiatAmountOriginal: fiatOriginal,
        transactionType: TransactionType.CREDIT,
        transactionContext: TransactionContext.BUY,
        bufferAmountBase: bufferSpreadMinor,
        bufferAmountOriginal: ConvertCurrency.fromBase(
          quote.bufferSpreadMinor,
          quote.fiatCurrency,
        ),
        platformFeeBase: platformFeeMinor,
        platformFeeOriginal: ConvertCurrency.fromBase(
          quote.platformFeeMinor,
          quote.fiatCurrency,
        ),
        status: TransactionStatus.PENDING,
      });

      if (!reserved) {
        queuedForLiquidity = true;
        await tx.failedCompanyLiquidityTransaction.create({
          data: {
            transactionId: transactionRecord.id,
            currency: BASE_CURRENCY,
            amountBase: companyLiquidityAmount.toString(),
            providerResponse: {
              reason: 'Insufficient company NGN liquidity for buy processing',
              paymentType: paymentMethod.type,
            },
          },
        });
        await this.notifySuperAdminLiquidityInsufficient({
          context: 'BUY',
          transactionId: transactionRecord.id,
          userId,
          currency: BASE_CURRENCY,
          amountBase: companyLiquidityAmount.toString(),
        });
      }
    });

    // Delete quote only for duplicates — otherwise delete after payment succeeds
    if (isDuplicate) {
      await this.tempStore.del(quoteKey);
      return {
        message: 'Buy already submitted',
        data: {
          transactionId: transactionRecord.id,
          status: transactionRecord.status,
        },
      };
    }

    if (!bypassProviders) {
      const transactionWithUser = await this.prisma.transaction.findUnique({
        where: { id: transactionRecord.id },
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
            `Failed to send notification for buy transaction ${transactionRecord.id}: ${error.message}`,
            error.stack,
          );
        }
      }
    }

    if (queuedForLiquidity) {
      await this.tempStore.del(quoteKey);
      return {
        message: 'Buy transaction queued. You will be notified.',
        data: {
          transactionId: transactionRecord.id,
        },
      };
    }

    if (bypassProviders) {
      await this.prisma.$transaction(async (tx) => {
        const creditAmount = toDecimal(volumeCryptoMinor);
        const updatedWallet = await tx.$queryRaw<{ baseBalance: string }[]>`
          UPDATE "wallets"
          SET "baseBalance" = "baseBalance" + ${creditAmount}
          WHERE "userId" = ${userId}
            AND LOWER("currency") = LOWER(${normalizedCrypto})
          RETURNING "baseBalance"
        `;

        if (updatedWallet.length === 0) {
          throw new NotFoundException(
            `Wallet not found for ${normalizedCrypto}`,
          );
        }

        const newOriginalBalance = ConvertCurrency.fromBase(
          BigInt(String(updatedWallet[0].baseBalance)),
          normalizedCrypto,
        );

        await tx.wallet.updateMany({
          where: {
            userId,
            currency: { equals: normalizedCrypto, mode: 'insensitive' },
          },
          data: { originalBalance: newOriginalBalance },
        });

        await tx.order.upsert({
          where: { transactionId: transactionRecord.id },
          update: {
            status: OrderStatus.COMPLETED,
            type: OrderType.BUY,
            referenceNo: previewId,
            paymentStatus: PaymentStatus.PAID,
            paymentReference: previewId,
            paymentChannel: 'non_production_bypass',
            paymentDate: new Date(),
            gatewayResponse: JSON.stringify({ providerBypass: true }),
          },
          create: {
            transactionId: transactionRecord.id,
            userId,
            cryptoAmountBase: volumeCryptoMinor.toString(),
            cryptoAmountOriginal: cryptoOriginal,
            fiatAmountBase: totalFiatMinor.toString(),
            fiatAmountOriginal: fiatOriginal,
            fiatCurrency: quote.fiatCurrency,
            status: OrderStatus.COMPLETED,
            type: OrderType.BUY,
            referenceNo: previewId,
            paymentStatus: PaymentStatus.PAID,
            paymentReference: previewId,
            paymentChannel: 'non_production_bypass',
            paymentAmountBase: totalFiatMinor.toString(),
            paymentAmountOriginal: fiatOriginal,
            paymentDate: new Date(),
            gatewayResponse: JSON.stringify({ providerBypass: true }),
          },
        });

        await tx.transaction.update({
          where: { id: transactionRecord.id },
          data: {
            status: TransactionStatus.COMPLETED,
            isProcessed: true,
            executedCryptoAmountBase: toDecimal(volumeCryptoMinor),
            executedFiatAmountBase: toDecimal(totalFiatMinor),
            executionPrice: ConvertCurrency.fromBase(
              quote.bufferedPriceMinor,
              quote.fiatCurrency,
            ),
            executedAt: new Date(),
            paymentMetadata: {
              ...((transactionRecord.paymentMetadata as Record<string, any>) ||
                {}),
              providerBypass: true,
              providerBypassReason: 'non_production_buy_confirm',
              paystackReference: previewId,
              quidaxOrderReference: previewId,
              buyOrderStatus: 'completed_without_provider',
            },
          },
        });

        return newOriginalBalance;
      });

      await this.tempStore.del(quoteKey);
      await this.sendCompletedTransactionNotification(transactionRecord.id);

      if (paymentMethod.type === PaymentType.CARD) {
        return {
          message:
            'Card payment successful. Your transaction is being processed.',
          data: {
            transactionId: transactionRecord.id,
            status: TransactionStatus.COMPLETED,
          },
        };
      }

      if (paymentMethod.type === PaymentType.PAYSTACK) {
        return {
          message: 'Payment initialization successful',
          data: {
            transactionId: transactionRecord.id,
            paymentType: PaymentType.PAYSTACK,
            reference: previewId,
            authorizationUrl: `https://checkout.paystack.com/mock-${previewId}`,
            quoteId: previewId,
            status: TransactionStatus.COMPLETED,
          },
        };
      }

      throw new BadRequestException('Unsupported payment type');
    }

    if (paymentMethod.type === PaymentType.CARD) {
      if (!quote.cardId)
        throw new BadRequestException('Card not found in quote');

      const chargeResponse = await this.paystackService.chargeSavedCard({
        paymentCardId: quote.cardId,
        amount: totalFiatMinorAsNumber,
        reference: previewId,
        metadata: {
          userId,
          quoteId: previewId,
          companyDepositReference,
        },
      });

      if (!chargeResponse?.status) {
        await this.companyLiquidityService.releaseLiquidity(
          BASE_CURRENCY,
          companyLiquidityAmount,
        );
        await this.prisma.transaction.update({
          where: { id: transactionRecord.id },
          data: { status: TransactionStatus.FAILED },
        });
        throw new InternalServerErrorException('Card charge failed');
      }

      await this.prisma.transaction.update({
        where: { id: transactionRecord.id },
        data: {
          paymentMetadata: {
            ...transactionRecord.paymentMetadata,
            paystackReference: chargeResponse.data.reference,
            cardId: quote.cardId,
          },
        },
      });

      await this.tempStore.del(quoteKey);

      return {
        message:
          'Card payment successful. Your transaction is being processed.',
        data: {
          transactionId: transactionRecord.id,
          status: TransactionStatus.PENDING,
        },
      };
    }

    if (paymentMethod.type === PaymentType.PAYSTACK) {
      const channels = ['bank_transfer'];

      const initializeResponse = await this.paystackService.initializePayment({
        email: user.email,
        amount: totalFiatMinorAsNumber,
        reference: previewId,
        currency: quote.fiatCurrency,
        channels,
        metadata: {
          userId,
          quoteId: previewId,
          companyDepositReference,
        },
      });

      if (!initializeResponse?.status) {
        await this.companyLiquidityService.releaseLiquidity(
          BASE_CURRENCY,
          companyLiquidityAmount,
        );
        await this.prisma.transaction.update({
          where: { id: transactionRecord.id },
          data: { status: TransactionStatus.FAILED },
        });
        throw new InternalServerErrorException('Payment initialization failed');
      }

      await this.prisma.transaction.update({
        where: { id: transactionRecord.id },
        data: {
          paymentMetadata: {
            ...transactionRecord.paymentMetadata,
            paystackReference: initializeResponse.data.reference,
            channels,
          },
        },
      });

      await this.tempStore.del(quoteKey);

      return {
        message: 'Payment initialization successful',
        data: {
          transactionId: transactionRecord.id,
          paymentType: PaymentType.PAYSTACK,
          reference: initializeResponse.data.reference,
          authorizationUrl: initializeResponse.data.authorization_url,
          quoteId: previewId,
          status: TransactionStatus.PENDING,
        },
      };
    }

    throw new BadRequestException('Unsupported payment type');
  }
}
