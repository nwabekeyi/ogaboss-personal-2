import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import {
  AutoStackStatus,
  PrismaService,
} from '../../../infrastructure/databases/prisma';
import { compareHash } from '../../../shared/services/hash';
import { ConvertCurrency, LiquidityReservationStatus } from '../../../shared';
import {
  AutoStackConfirmDto,
  AutoStackFrequencyDto,
  AutoStackPaymentTypesDto,
  AutoStackPreviewDto,
  AutoStackQuoteDto,
  EndAutoStackDto,
} from '../dto/autostack.dto';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { QUIDAX_COMPANY_USERID } from '../../transaction/constants';
import {
  PaymentType,
  Prisma,
  TransactionContext,
  TransactionStatus,
  TransactionType,
} from '../../../infrastructure/databases/prisma';
import { TempStoreService } from '../../../infrastructure/databases/redis';
import axios from 'axios';
import { QuidaxOrderService } from '../../../infrastructure/providers/quidax/order.service';
import Decimal from 'decimal.js';
import {
  CompanyLiquidityService,
  TransactionService,
} from '../../transaction/services';

import {
  AUTOSTACK_DEFAULT_PLAN_NAME,
  AUTOSTACK_FREQUENCY_PERIOD_DAYS,
  AUTOSTACK_QUOTE_TTL_SECONDS,
} from '../constants/autostack.constants';

type AutoStackPaymentSource =
  | typeof PaymentType.CARD
  | typeof PaymentType.CRYPTO_WALLET;

@Injectable()
export class AutoStackService {
  private toUsdtBase(amount: Decimal.Value): bigint {
    return ConvertCurrency.toBase(new Decimal(amount).toString(), 'USDT', 6);
  }

  private toNgnBase(amount: Decimal.Value): bigint {
    return ConvertCurrency.toBase(new Decimal(amount).toString(), 'NGN', 2);
  }

  private toBaseString(amount: unknown): string {
    if (typeof amount === 'bigint') return amount.toString();
    if (amount instanceof Prisma.Decimal) return amount.toFixed(0);
    if (amount && typeof (amount as any).toFixed === 'function') {
      return (amount as any).toFixed(0);
    }
    return String(amount || '0');
  }

  private fromUsdtBase(amount: unknown): string {
    return ConvertCurrency.fromBase(this.toBaseString(amount), 'USDT', 6);
  }

  private fromWalletBase(
    amount: unknown,
    currency: string,
    network?: string | null,
  ): string {
    return ConvertCurrency.fromBase(
      this.toBaseString(amount),
      currency,
      network as any,
    );
  }

  private fromAutoStackAmountBase(
    amount: unknown,
    currency: string,
    network?: string | null,
  ): string {
    const baseAmount = BigInt(this.toBaseString(amount));
    const defaultConverted = new Decimal(
      ConvertCurrency.fromBase(baseAmount, currency, 6),
    );

    if (
      currency.toUpperCase() === 'USDT' &&
      network &&
      defaultConverted.gte(1_000_000)
    ) {
      return ConvertCurrency.fromBase(baseAmount, currency, network as any);
    }

    return defaultConverted.toString();
  }

  private formatAutoStackRecord<T extends Record<string, any>>(
    autoStack: T,
    network?: string | null,
  ): T {
    const symbol = String(
      autoStack.cryptoCurrency?.symbol || 'USDT',
    ).toUpperCase();
    return {
      ...autoStack,
      amount: this.fromAutoStackAmountBase(autoStack.amount, symbol, network),
      transactionFee: this.fromUsdtBase(autoStack.transactionFee),
      accruedInterest: this.fromAutoStackAmountBase(
        autoStack.accruedInterest,
        symbol,
        network,
      ),
    };
  }

  private parseStoredAutoStackQuote(value: unknown): Record<string, any> {
    if (value && typeof value === 'object') return value as Record<string, any>;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        throw new BadRequestException(
          'Invalid quote data. Please request a new quote.',
        );
      }
    }
    throw new NotFoundException('Quote not found or expired');
  }

  private normalizeFrequency(
    frequency: AutoStackFrequencyDto,
  ): 'DAILY' | 'WEEKLY' | 'MONTHLY' {
    if (frequency === AutoStackFrequencyDto.DAILY) return 'DAILY';
    if (frequency === AutoStackFrequencyDto.WEEKLY) return 'WEEKLY';
    if (frequency === AutoStackFrequencyDto.MONTHLY) return 'MONTHLY';
    throw new BadRequestException(
      'Frequency must be 1 (daily), 2 (weekly), or 3 (monthly)',
    );
  }

  private normalizeDayOfWeek(
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    dayOfWeek?: number,
  ): string | undefined {
    if (frequency === 'DAILY') return undefined;
    if (!dayOfWeek) {
      if (frequency === 'WEEKLY') {
        throw new BadRequestException(
          'dayOfWeek is required for weekly autostacks. Use 1-7 for Monday-Sunday.',
        );
      }
      return undefined;
    }
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      throw new BadRequestException(
        'dayOfWeek must be between 1 and 7, where 1 = Monday and 7 = Sunday.',
      );
    }
    return String(dayOfWeek);
  }

  private normalizePaymentType(value: string): AutoStackPaymentSource {
    const paymentType = String(value || '').toUpperCase();
    if (paymentType === PaymentType.CARD) return PaymentType.CARD;
    if (paymentType === PaymentType.CRYPTO_WALLET) {
      return PaymentType.CRYPTO_WALLET;
    }
    throw new BadRequestException('paymentType must be CARD or CRYPTO_WALLET');
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly tempStore: TempStoreService,
    private readonly tickerService: QuidaxTickerService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly quidaxOrderService: QuidaxOrderService,
    private readonly paystackService: PaystackService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
  ) {}

  async quote(userId: string, dto: AutoStackQuoteDto) {
    void userId;
    const quoteId = crypto.randomUUID();
    const asset = await this.prisma.cryptoCurrency.findUnique({
      where: { id: dto.assetId },
      include: { rate: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    const assetSymbol = asset.symbol.toUpperCase();
    const pair = `${assetSymbol.toLowerCase()}usdt`;
    const tickerRate =
      assetSymbol === 'USDT' ? '1' : await this.tickerService.getPrice(pair);
    if (!tickerRate)
      throw new BadRequestException(
        `Unable to fetch conversion rate for ${assetSymbol}`,
      );

    const conversionRate = new Decimal(tickerRate);
    if (!conversionRate.isFinite() || conversionRate.lte(0))
      throw new BadRequestException(
        `Invalid conversion rate for ${assetSymbol}`,
      );
    const amountInUsdt = new Decimal(dto.amount).mul(conversionRate);

    const payload = {
      quoteId,
      assetId: asset.id,
      currencyId: asset.id,
      asset: assetSymbol,
      amount: dto.amount,
      amountInUsdt: amountInUsdt.toString(),
      amountInUsdtBase: this.toUsdtBase(amountInUsdt).toString(),
      rate: conversionRate.toString(),
      expiresAt: Date.now() + AUTOSTACK_QUOTE_TTL_SECONDS * 1000,
      planName: dto.planName || AUTOSTACK_DEFAULT_PLAN_NAME,
      targetAsset: assetSymbol,
    };
    await this.tempStore.set(
      `autostack:${quoteId}`,
      JSON.stringify(payload),
      AUTOSTACK_QUOTE_TTL_SECONDS,
    );
    return {
      success: true,
      data: {
        quoteId,
        assetId: asset.id,
        asset: assetSymbol,
        rates: { assetToUsdt: payload.rate },
        expiresIn: AUTOSTACK_QUOTE_TTL_SECONDS,
        amountInUsdt: amountInUsdt.toString(),
      },
    };
  }

  async paymentTypes(userId: string, dto: AutoStackPaymentTypesDto) {
    const quoteValue = await this.tempStore.get(`autostack:${dto.quoteId}`);
    if (!quoteValue) throw new NotFoundException('Quote not found or expired');
    const quote = this.parseStoredAutoStackQuote(quoteValue);
    const assetId = String(quote.assetId || quote.currencyId || '');
    if (!assetId) {
      throw new BadRequestException(
        'Quote asset is missing. Please request a new quote.',
      );
    }

    const cards = await this.prisma.paymentCard.findMany({
      where: { userId },
      select: {
        id: true,
        cardType: true,
        last4: true,
        expMonth: true,
        expYear: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, isCrypto: true, currencyId: assetId },
      include: { cryptoCurrency: true },
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found for selected asset');
    }
    const hasSavedCards = cards.length > 0;
    const totalAmountBase = new Decimal(wallet.baseBalance?.toString() || '0');
    const lockedAmountBase = new Decimal(
      wallet.lockedAmount?.toString() || '0',
    );
    const stackedAmountBase = new Decimal(
      wallet.stackedAmount?.toString() || '0',
    );
    const reservedAmountBase = new Decimal(
      wallet.reservedBalance?.toString() || '0',
    );
    const availableAmountBase = totalAmountBase.minus(reservedAmountBase);
    const walletCurrency = String(
      wallet.cryptoCurrency?.symbol || wallet.currency,
    ).toUpperCase();

    return {
      success: true,
      message: hasSavedCards
        ? 'Payment types retrieved successfully'
        : 'No saved cards found. Please add a card before using card payments for autostack.',
      data: {
        requiresCardSetup: !hasSavedCards,
        cardSetupMessage: hasSavedCards
          ? null
          : 'Add a payment card to use card payments for autostack.',
        wallets: [
          {
            walletId: wallet.id,
            assetId,
            asset: wallet.cryptoCurrency?.symbol || wallet.currency,
            paymentType: PaymentType.CRYPTO_WALLET,
            totalAmount: this.fromWalletBase(
              totalAmountBase.toFixed(0),
              walletCurrency,
              wallet.defaultNetwork,
            ),
            lockedAmount: this.fromWalletBase(
              lockedAmountBase.toFixed(0),
              walletCurrency,
              wallet.defaultNetwork,
            ),
            stackedAmount: this.fromWalletBase(
              stackedAmountBase.toFixed(0),
              walletCurrency,
              wallet.defaultNetwork,
            ),
            reservedAmount: this.fromWalletBase(
              reservedAmountBase.toFixed(0),
              walletCurrency,
              wallet.defaultNetwork,
            ),
            availableAmount: this.fromWalletBase(
              availableAmountBase.toFixed(0),
              walletCurrency,
              wallet.defaultNetwork,
            ),
          },
        ],
        cards: cards.map((card) => ({
          ...card,
          paymentType: PaymentType.CARD,
        })),
      },
    };
  }

  async preview(userId: string, dto: AutoStackPreviewDto) {
    const quoteKey = `autostack:${dto.quoteId}`;
    const quoteJson = await this.tempStore.get(quoteKey);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');
    const quote = this.parseStoredAutoStackQuote(quoteJson);

    const amountInUsdt = new Decimal(quote.amountInUsdt || 0);
    const paymentType = this.normalizePaymentType(dto.paymentType);
    if (paymentType === PaymentType.CARD) {
      if (!dto.paymentCardId) {
        throw new BadRequestException(
          'Payment card is required for card autostack',
        );
      }
      const card = await this.prisma.paymentCard.findFirst({
        where: { id: dto.paymentCardId, userId },
        select: { id: true },
      });
      if (!card) throw new NotFoundException('Payment card not found');
    }
    const frequency = this.normalizeFrequency(dto.frequency);
    const dayOfWeek = this.normalizeDayOfWeek(frequency, dto.dayOfWeek);
    const feeSetting = await this.prisma.autoStackingTransactionFee.findFirst({
      where: {
        currency: 'USDT',
        fromAmount: { lte: new Prisma.Decimal(amountInUsdt.toString()) },
        toAmount: { gte: new Prisma.Decimal(amountInUsdt.toString()) },
      },
    });
    const txFee = new Decimal(feeSetting?.feeAmount?.toString() || '0');
    const txFeePct = amountInUsdt.gt(0)
      ? txFee.div(amountInUsdt).mul(100).toString()
      : '0';

    const setting = await this.prisma.autoStackingSettings.findFirst({
      where: { currency: { equals: 'USDT', mode: 'insensitive' } },
    });
    const dailyInterestRatePercent = new Decimal(
      setting?.dailyInterestRatePercent?.toString() || '0',
    );
    const periods = AUTOSTACK_FREQUENCY_PERIOD_DAYS[dto.frequency];
    const expectedInterest = amountInUsdt
      .mul(dailyInterestRatePercent)
      .div(100)
      .mul(periods);
    const expectedAmountAtEnd = amountInUsdt.plus(expectedInterest);

    const preview = {
      ...quote,
      frequency,
      frequencyValue: dto.frequency,
      paymentType,
      paymentCardId:
        paymentType === PaymentType.CARD ? dto.paymentCardId : null,
      transactionFee: txFee.toString(),
      transactionFeePercentage: txFeePct,
      interestRate: dailyInterestRatePercent.toString(),
      expectedInterest: expectedInterest.toString(),
      expectedAmountAtEnd: expectedAmountAtEnd.toString(),
      estimatedOut: expectedAmountAtEnd.toString(),
      startDate: dto.startDate,
      timeOfDay: dto.timeOfDay,
      dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
    };
    await this.tempStore.set(
      quoteKey,
      JSON.stringify(preview),
      Math.ceil((quote.expiresAt - Date.now()) / 1000),
    );

    return {
      success: true,
      data: {
        amount: amountInUsdt.toString(),
        frequency: dto.frequency,
        frequencyLabel: frequency,
        paymentType,
        planName: quote.planName,
        rate: quote.rate,
        transactionFee: txFee.toString(),
        interestRate: dailyInterestRatePercent.toString(),
        expectedInterest: expectedInterest.toString(),
        expectedAmountAtEnd: expectedAmountAtEnd.toString(),
        estimatedOut: expectedAmountAtEnd.toString(),
        transactionFeePercentage: txFeePct,
      },
    };
  }

  async confirm(userId: string, dto: AutoStackConfirmDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin)))
      throw new BadRequestException('Invalid pin');
    const quoteJson = await this.tempStore.get(`autostack:${dto.quoteId}`);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');
    const preview = this.parseStoredAutoStackQuote(quoteJson);

    const usdt = await this.prisma.cryptoCurrency.findFirst({
      where: { symbol: 'USDT' },
    });
    if (!usdt) throw new NotFoundException('USDT currency not found');

    const sourceAsset = String(preview.asset || 'USDT').toUpperCase();
    const nextExecutionAt = new Date(preview.startDate || new Date());
    const reference = `autostack-confirm-${crypto.randomUUID()}`;
    const paymentType =
      preview.paymentType === PaymentType.CRYPTO_WALLET
        ? PaymentType.CRYPTO_WALLET
        : PaymentType.CARD;
    const principalUsdtOriginal = new Decimal(
      preview.amountInUsdt || 0,
    ).toString();
    const principalUsdtMinor = preview.amountInUsdtBase
      ? BigInt(String(preview.amountInUsdtBase))
      : this.toUsdtBase(principalUsdtOriginal);
    const transactionFeeMinor = this.toUsdtBase(preview.transactionFee || 0);

    let sourceWallet: any = null;
    let sourceAmountMinor = principalUsdtMinor;
    let sourceAmountOriginal = principalUsdtOriginal;

    if (paymentType === PaymentType.CRYPTO_WALLET) {
      const sourceAssetId = String(preview.assetId || preview.currencyId || '');
      if (!sourceAssetId) {
        throw new BadRequestException(
          'Quote asset is missing. Please request a new quote.',
        );
      }
      sourceWallet = await this.prisma.wallet.findFirst({
        where: { userId, currencyId: sourceAssetId },
      });
      if (!sourceWallet)
        throw new NotFoundException(`${sourceAsset} wallet not found`);
      sourceAmountOriginal = String(preview.amount || preview.amountInUsdt);
      sourceAmountMinor =
        sourceAsset === 'USDT' && !sourceWallet.defaultNetwork
          ? this.toUsdtBase(sourceAmountOriginal)
          : ConvertCurrency.toBase(
              sourceAmountOriginal,
              sourceAsset,
              sourceWallet.defaultNetwork as any,
            );
    } else if (!preview.paymentCardId) {
      throw new BadRequestException(
        'Payment card is required for card autostack',
      );
    }

    const autoStack = await this.prisma.$transaction(async (tx) => {
      const createdAutoStack = await tx.autoStack.create({
        data: {
          userId,
          currencyId: usdt.id,
          planName: preview.planName,
          frequency: preview.frequency,
          amount: principalUsdtMinor.toString(),
          startDate: new Date(preview.startDate || new Date()),
          timeOfDay: preview.timeOfDay || '00:00',
          dayOfWeek: preview.dayOfWeek,
          dayOfMonth: preview.dayOfMonth,
          nextExecutionAt,
          nextInterestAt: nextExecutionAt,
          status: AutoStackStatus.PENDING as any,
          transactionFee: transactionFeeMinor.toString(),
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          transactionUniqueId: reference,
          receiverWalletAddress: sourceWallet?.quidaxWalletId ?? null,
          currency:
            paymentType === PaymentType.CRYPTO_WALLET ? sourceAsset : 'USDT',
          cryptoAmountBase:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountMinor.toString()
              : principalUsdtMinor.toString(),
          cryptoAmountOriginal:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountOriginal
              : principalUsdtOriginal,
          totalAmountSentBase:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountMinor.toString()
              : principalUsdtMinor.toString(),
          totalAmountSentOriginal:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountOriginal
              : principalUsdtOriginal,
          fiatAmountBase: '0',
          fiatAmountOriginal: '0',
          transactionType: TransactionType.DEBIT,
          transactionContext: TransactionContext.AUTOSTACK,
          status: TransactionStatus.PENDING,
          paymentType,
          paymentMetadata: {
            autoStackId: createdAutoStack.id,
            paymentType,
            paymentCardId: preview.paymentCardId || null,
            sourceAsset:
              paymentType === PaymentType.CRYPTO_WALLET ? sourceAsset : 'USDT',
            targetAsset: 'USDT',
            principalUsdtAmount: principalUsdtOriginal,
            principalUsdtAmountBase: principalUsdtMinor.toString(),
            transactionFeeBase: transactionFeeMinor.toString(),
            transactionFee: ConvertCurrency.fromBase(
              transactionFeeMinor,
              'USDT',
              6,
            ),
            sourceAmount: sourceAmountOriginal,
            sourceAmountBase: sourceAmountMinor.toString(),
            autostackInitiationStatus: 'PENDING',
          } as any,
          description: `autostack_config:${createdAutoStack.id}`,
        } as any,
      });

      return createdAutoStack;
    });

    const now = new Date();
    if (
      this.isExecutionDue(nextExecutionAt, now, { includeSameUtcDate: true })
    ) {
      await this.initiateAutoStack(autoStack.id, { force: true });
      return {
        success: true,
        message:
          'Autostack created and initiated for today. Execution price may differ from the quoted price.',
        data: this.formatAutoStackRecord(autoStack),
      };
    }

    await this.queueService.add(
      QueueName.CLEANUP,
      'scheduler.autostack.charge',
      { autoStackId: autoStack.id },
      {
        jobId: `scheduler.autostack.charge-${autoStack.id}-${nextExecutionAt.toISOString().replace(/:/g, '-')}`,
        delay: Math.max(nextExecutionAt.getTime() - now.getTime(), 0),
      },
    );
    return {
      success: true,
      message:
        'Autostack created and will be initiated on the selected start date. Execution price may differ from the quoted price.',
      data: this.formatAutoStackRecord(autoStack),
    };
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

  private isSameUtcDate(left: Date, right: Date): boolean {
    return (
      left.getUTCFullYear() === right.getUTCFullYear() &&
      left.getUTCMonth() === right.getUTCMonth() &&
      left.getUTCDate() === right.getUTCDate()
    );
  }

  isExecutionDue(
    nextExecutionAt: Date,
    now: Date = new Date(),
    options: { includeSameUtcDate?: boolean } = {},
  ): boolean {
    if (nextExecutionAt <= now) return true;
    return Boolean(
      options.includeSameUtcDate && this.isSameUtcDate(nextExecutionAt, now),
    );
  }

  async initiateAutoStack(
    autoStackId: string,
    options: { force?: boolean } = {},
  ) {
    const stack = await this.prisma.autoStack.findUnique({
      where: { id: autoStackId },
    });
    const stackStatus = String(stack?.status || '');
    if (!stack || !['PENDING', 'ACTIVE'].includes(stackStatus)) return;

    const now = new Date();
    if (!options.force && !this.isExecutionDue(stack.nextExecutionAt, now))
      return;

    const configTx = await this.prisma.transaction.findFirst({
      where: {
        userId: stack.userId,
        description: `autostack_config:${stack.id}`,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!configTx) return;

    const configMeta = (configTx.paymentMetadata || {}) as Record<string, any>;
    const executionTx =
      stackStatus === 'PENDING'
        ? configTx
        : await this.getOrCreateAutoStackExecutionTransaction(
            stack,
            configTx,
            configMeta,
          );

    if (!executionTx) return;

    return this.initiatePendingAutoStack(
      stack,
      executionTx,
      (executionTx.paymentMetadata || {}) as Record<string, any>,
      now,
    );
  }

  private async getOrCreateAutoStackExecutionTransaction(
    stack: any,
    configTx: any,
    configMeta: Record<string, any>,
  ) {
    const executionReference = `autostack-charge-${stack.id}-${stack.nextExecutionAt.toISOString()}`;
    const existing = await this.prisma.transaction.findUnique({
      where: { transactionUniqueId: executionReference },
    });
    if (existing) return existing;

    const paymentType =
      configMeta.paymentType === PaymentType.CRYPTO_WALLET
        ? PaymentType.CRYPTO_WALLET
        : PaymentType.CARD;
    const sourceAsset = String(
      paymentType === PaymentType.CRYPTO_WALLET
        ? configMeta.sourceAsset || configTx.currency || 'USDT'
        : 'USDT',
    ).toUpperCase();
    const principalUsdtBase = String(
      configMeta.principalUsdtAmountBase ||
        configTx.cryptoAmountBase?.toFixed?.(0) ||
        stack.amount.toFixed(0),
    );
    const principalUsdtOriginal = String(
      configMeta.principalUsdtAmount ||
        configTx.cryptoAmountOriginal ||
        ConvertCurrency.fromBase(BigInt(principalUsdtBase), 'USDT', 6),
    );
    let sourceAmountOriginal = principalUsdtOriginal;
    let sourceAmountBase = principalUsdtBase;

    if (paymentType === PaymentType.CRYPTO_WALLET && sourceAsset !== 'USDT') {
      const currentRate = await this.tickerService.getPrice(
        `${sourceAsset.toLowerCase()}usdt`,
      );
      if (!currentRate) {
        throw new Error(
          `Unable to fetch ${sourceAsset}/USDT rate for autostack`,
        );
      }
      const sourceAmount = new Decimal(principalUsdtOriginal).div(currentRate);
      sourceAmountOriginal = sourceAmount.toString();
      const sourceWallet = await this.prisma.wallet.findFirst({
        where: { userId: stack.userId, currency: sourceAsset },
        select: { defaultNetwork: true },
      });
      sourceAmountBase = ConvertCurrency.toBase(
        sourceAmountOriginal,
        sourceAsset,
        sourceWallet?.defaultNetwork as any,
      ).toString();
    }

    try {
      return await this.prisma.transaction.create({
        data: {
          userId: stack.userId,
          transactionUniqueId: executionReference,
          receiverWalletAddress: configTx.receiverWalletAddress ?? null,
          currency:
            paymentType === PaymentType.CRYPTO_WALLET ? sourceAsset : 'USDT',
          cryptoAmountBase:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountBase
              : principalUsdtBase,
          cryptoAmountOriginal:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountOriginal
              : principalUsdtOriginal,
          totalAmountSentBase:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountBase
              : principalUsdtBase,
          totalAmountSentOriginal:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountOriginal
              : principalUsdtOriginal,
          fiatAmountBase: '0',
          fiatAmountOriginal: '0',
          transactionType: TransactionType.DEBIT,
          transactionContext: TransactionContext.AUTOSTACK,
          status: TransactionStatus.PENDING,
          paymentType,
          paymentMetadata: {
            ...configMeta,
            autoStackId: stack.id,
            paymentType,
            sourceAsset: String(
              configMeta.sourceAsset || configTx.currency || 'USDT',
            ).toUpperCase(),
            targetAsset: 'USDT',
            principalUsdtAmount: principalUsdtOriginal,
            principalUsdtAmountBase: principalUsdtBase,
            sourceAmount: sourceAmountOriginal,
            sourceAmountBase,
            autostackInitiationStatus: 'PENDING',
            autostackExecutionType: 'PERIODIC',
            scheduledFor: stack.nextExecutionAt.toISOString(),
          } as any,
          description: `autostack_charge:${stack.id}`,
        } as any,
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      return this.prisma.transaction.findUnique({
        where: { transactionUniqueId: executionReference },
      });
    }
  }

  private async initiatePendingAutoStack(
    stack: any,
    configTx: any,
    meta: Record<string, any>,
    now: Date,
  ) {
    const processingLock = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "transactions"
        WHERE "id" = ${configTx.id}
        FOR UPDATE
      `;
      const fresh = await tx.transaction.findUnique({
        where: { id: configTx.id },
        select: { paymentMetadata: true },
      });
      const freshMeta = (fresh?.paymentMetadata || meta || {}) as Record<
        string,
        any
      >;
      const initiationStatus = String(
        freshMeta.autostackInitiationStatus || '',
      ).toUpperCase();

      if (['SUBMITTED', 'COMPLETED'].includes(initiationStatus)) {
        return { shouldProceed: false, metadata: freshMeta };
      }

      if (initiationStatus === 'PROCESSING') {
        const initiatedAt = freshMeta.autostackInitiatedAt
          ? new Date(String(freshMeta.autostackInitiatedAt))
          : null;
        const isFreshProcessing =
          initiatedAt && now.getTime() - initiatedAt.getTime() < 15 * 60 * 1000;
        if (isFreshProcessing) {
          return { shouldProceed: false, metadata: freshMeta };
        }
      }

      const processingMetadata = {
        ...freshMeta,
        autostackInitiationStatus: 'PROCESSING',
        autostackInitiatedAt: now.toISOString(),
      };
      await tx.transaction.update({
        where: { id: configTx.id },
        data: {
          paymentMetadata: processingMetadata as Prisma.InputJsonValue,
        },
      });

      return { shouldProceed: true, metadata: processingMetadata };
    });

    if (!processingLock.shouldProceed) return;
    meta = processingLock.metadata;

    const paymentType =
      meta.paymentType === PaymentType.CRYPTO_WALLET
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
        ConvertCurrency.fromBase(principalUsdtBase, 'USDT', 6),
    );
    const transactionFeeBase = BigInt(String(meta.transactionFeeBase || 0));
    const sourceAmountBase = BigInt(
      String(
        meta.sourceAmountBase || configTx.cryptoAmountBase || principalUsdtBase,
      ),
    );
    const sourceAmountOriginal = String(
      meta.sourceAmount ||
        configTx.cryptoAmountOriginal ||
        principalUsdtOriginal,
    );
    const sourceFeeBase =
      paymentType === PaymentType.CRYPTO_WALLET && principalUsdtBase > 0n
        ? (sourceAmountBase * transactionFeeBase + principalUsdtBase - 1n) /
          principalUsdtBase
        : 0n;
    const totalSourceWalletDeductionBase = sourceAmountBase + sourceFeeBase;
    const processingMetadata = meta;

    try {
      if (paymentType === PaymentType.CRYPTO_WALLET) {
        if (sourceAsset !== 'USDT') {
          await this.prisma.$transaction(async (tx) => {
            const alreadyReserved =
              meta.liquidityReservationStatus ===
                LiquidityReservationStatus.RESERVED &&
              meta.liquidityReservationCurrency === sourceAsset &&
              String(meta.liquidityReservationAmount || '') ===
                sourceAmountBase.toString();
            if (!alreadyReserved) {
              await this.transactionService.reserveBalance(
                tx as any,
                stack.userId,
                sourceAsset,
                totalSourceWalletDeductionBase,
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
            }
            await tx.transaction.update({
              where: { id: configTx.id },
              data: {
                cryptoAmountBase: sourceAmountBase.toString(),
                cryptoAmountOriginal: sourceAmountOriginal,
                platformFeeBase: sourceFeeBase.toString(),
                platformFeeOriginal: ConvertCurrency.fromBase(
                  sourceFeeBase,
                  sourceAsset,
                  undefined,
                ),
                totalAmountSentBase: totalSourceWalletDeductionBase.toString(),
                totalAmountSentOriginal: ConvertCurrency.fromBase(
                  totalSourceWalletDeductionBase,
                  sourceAsset,
                  undefined,
                ),
                fiatAmountBase: principalUsdtBase.toString(),
                fiatAmountOriginal: principalUsdtOriginal,
                paymentMetadata: {
                  ...processingMetadata,
                  liquidityReservationStatus:
                    LiquidityReservationStatus.RESERVED,
                  liquidityReservationCurrency: sourceAsset,
                  liquidityReservationAmount: sourceAmountBase.toString(),
                  sourceFeeAmountBase: sourceFeeBase.toString(),
                  totalSourceWalletDeductionBase:
                    totalSourceWalletDeductionBase.toString(),
                } as Prisma.InputJsonValue,
              },
            });
          });
        }

        if (sourceAsset === 'USDT') {
          await this.prisma.$transaction(async (tx) => {
            const usdt = await tx.cryptoCurrency.findFirst({
              where: { symbol: 'USDT' },
            });
            if (!usdt) throw new Error('USDT currency not found');
            const usdtWallet = await tx.wallet.findFirst({
              where: {
                userId: stack.userId,
                OR: [{ currencyId: usdt.id }, { currency: 'USDT' }],
              },
            });
            if (!usdtWallet)
              throw new Error(
                `USDT wallet not found for autostack ${stack.id}`,
              );
            const totalWalletDeductionBase =
              sourceAmountBase + transactionFeeBase;
            const walletUpdateResult = await tx.$queryRaw<
              { baseBalance: string }[]
            >`
                UPDATE "wallets"
                SET "baseBalance" = "baseBalance" - ${totalWalletDeductionBase.toString()}::decimal,
                    "stackedAmount" = "stackedAmount" + ${sourceAmountBase.toString()}::decimal
                WHERE "id" = ${usdtWallet.id}
                  AND ("baseBalance" - "reservedBalance") >= ${totalWalletDeductionBase.toString()}::decimal
                RETURNING "baseBalance"
              `;
            if (walletUpdateResult.length === 0) {
              throw new Error('Insufficient USDT balance for autostack');
            }
            const newOriginalBalance = ConvertCurrency.fromBase(
              BigInt(String(walletUpdateResult[0].baseBalance)),
              'USDT',
              6,
            );
            await tx.$executeRaw`
              UPDATE "wallets"
              SET "originalBalance" = ${newOriginalBalance}
              WHERE "id" = ${usdtWallet.id}
            `;
            await tx.$executeRaw`
              UPDATE "company_liquidity"
              SET "totalAmountStacked" = "totalAmountStacked" + ${sourceAmountBase.toString()}::decimal
              WHERE LOWER("currency") = LOWER('USDT')
            `;
            const isInitialExecution = String(stack.status) === 'PENDING';
            await tx.autoStack.update({
              where: { id: stack.id },
              data: {
                amount: isInitialExecution
                  ? sourceAmountBase.toString()
                  : { increment: sourceAmountBase.toString() },
                status: AutoStackStatus.ACTIVE as any,
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
                platformFeeBase: transactionFeeBase.toString(),
                platformFeeOriginal: ConvertCurrency.fromBase(
                  transactionFeeBase,
                  'USDT',
                  6,
                ),
                totalAmountSentBase: totalWalletDeductionBase.toString(),
                totalAmountSentOriginal: ConvertCurrency.fromBase(
                  totalWalletDeductionBase,
                  'USDT',
                  6,
                ),
                paymentMetadata: {
                  ...processingMetadata,
                  actualReceivedAmountBase: sourceAmountBase.toString(),
                  actualReceivedAmountOriginal: ConvertCurrency.fromBase(
                    sourceAmountBase,
                    'USDT',
                    6,
                  ),
                  principalUsdtAmountBase: sourceAmountBase.toString(),
                  principalUsdtAmount: ConvertCurrency.fromBase(
                    sourceAmountBase,
                    'USDT',
                    6,
                  ),
                  sourceFeeAmountBase: transactionFeeBase.toString(),
                  totalSourceWalletDeductionBase:
                    totalWalletDeductionBase.toString(),
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
        const quotationId = swapQuote?.data?.id || swapQuote?.data?.id;
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
      const totalUsdtChargeOriginal = new Decimal(principalUsdtOriginal).add(
        ConvertCurrency.fromBase(transactionFeeBase, 'USDT', 6),
      );
      const principalNgnAmount = new Decimal(principalUsdtOriginal).mul(
        usdtNgnRate,
      );
      const ngnAmount = totalUsdtChargeOriginal.mul(usdtNgnRate);
      const companyLiquidityAmountBase = this.toNgnBase(principalNgnAmount);
      const ngnAmountBase = this.toNgnBase(ngnAmount);
      const ngnAmountOriginal = ConvertCurrency.fromBase(
        ngnAmountBase,
        'NGN',
        undefined,
      );
      const chargeReference = configTx.transactionUniqueId;

      await this.prisma.$transaction(async (tx) => {
        const alreadyReserved =
          meta.liquidityReservationStatus ===
            LiquidityReservationStatus.RESERVED &&
          meta.liquidityReservationCurrency === 'NGN' &&
          String(meta.liquidityReservationAmount || '') ===
            companyLiquidityAmountBase.toString();
        if (!alreadyReserved) {
          const reservedLiquidity =
            await this.companyLiquidityService.reserveLiquidity(
              'NGN',
              companyLiquidityAmountBase,
              tx as any,
            );
          if (!reservedLiquidity)
            throw new Error(
              'Insufficient company NGN liquidity for autostack card charge',
            );
        }
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
              liquidityReservationAmount: companyLiquidityAmountBase.toString(),
              chargedAmountBase: ngnAmountBase.toString(),
              usdtNgnRate,
              totalUsdtCharge: totalUsdtChargeOriginal.toString(),
            } as Prisma.InputJsonValue,
          },
        });
      });

      await this.paystackService.chargeSavedCard(
        {
          paymentCardId: meta.paymentCardId,
          amount: ngnAmountBase.toString(),
          reference: chargeReference,
          metadata: {
            autoStackId: stack.id,
            mode:
              String(stack.status) === 'PENDING'
                ? 'AUTOSTACK_CONFIRM'
                : 'AUTOSTACK_PERIODIC',
          },
        },
        { skipCircuitBreaker: true },
      );
      await this.prisma.transaction.update({
        where: { id: configTx.id },
        data: {
          paymentMetadata: {
            ...processingMetadata,
            paymentType,
            sourceAsset: 'USDT',
            targetAsset: 'USDT',
            autostackFlow: 'PAYSTACK_CARD_TO_BUY_ORDER',
            autostackInitiationStatus: 'SUBMITTED',
            liquidityReservationStatus: LiquidityReservationStatus.RESERVED,
            liquidityReservationCurrency: 'NGN',
            liquidityReservationAmount: companyLiquidityAmountBase.toString(),
            chargedAmountBase: ngnAmountBase.toString(),
            usdtNgnRate,
            totalUsdtCharge: totalUsdtChargeOriginal.toString(),
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
              totalSourceWalletDeductionBase,
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
  async getHistory(userId: string, page = 1, limit = 10) {
    return this.getAutoStacksByStatus(userId, page, limit);
  }

  async getActiveAutoStacks(userId: string, page = 1, limit = 10) {
    return this.getAutoStacksByStatus(userId, page, limit, [
      AutoStackStatus.ACTIVE,
    ]);
  }

  private async getAutoStacksByStatus(
    userId: string,
    page = 1,
    limit = 10,
    statuses?: AutoStackStatus[],
  ) {
    const safeLimit = Math.min(Math.max(limit || 10, 1), 20);
    const safePage = Math.max(page || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    const where: any = statuses?.length
      ? { userId, status: { in: statuses } }
      : { userId };
    const [items, total] = await Promise.all([
      this.prisma.autoStack.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        include: { cryptoCurrency: true },
      }),
      this.prisma.autoStack.count({ where }),
    ]);

    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId,
        currencyId: { in: [...new Set(items.map((item) => item.currencyId))] },
      },
      select: { currencyId: true, defaultNetwork: true },
    });
    const walletNetworkByCurrencyId = new Map(
      wallets.map((wallet) => [wallet.currencyId, wallet.defaultNetwork]),
    );

    let totalAmountNgn = new Decimal(0);
    let totalInterestNgn = new Decimal(0);
    const mapped = await Promise.all(
      items.map(async (item) => {
        const symbol = item.cryptoCurrency.symbol.toUpperCase();
        const ngnRate =
          symbol === 'NGN'
            ? '1'
            : (await this.tickerService.getPrice(
                `${symbol.toLowerCase()}ngn`,
              )) || '0';
        const rate = new Decimal(ngnRate || '0');
        const network = walletNetworkByCurrencyId.get(item.currencyId);
        const amountMajor = new Decimal(
          this.fromAutoStackAmountBase(item.amount, symbol, network),
        );
        const interestMajor = new Decimal(
          this.fromAutoStackAmountBase(item.accruedInterest, symbol, network),
        );
        const amountNgn = amountMajor.mul(rate);
        const interestNgn = interestMajor.mul(rate);
        totalAmountNgn = totalAmountNgn.plus(amountNgn);
        totalInterestNgn = totalInterestNgn.plus(interestNgn);
        return {
          ...this.formatAutoStackRecord(item, network),
          amountNgn: amountNgn.toFixed(2),
          accruedInterestNgn: interestNgn.toFixed(2),
        };
      }),
    );

    return {
      success: true,
      data: {
        items: mapped,
        totals: {
          totalAmountNgn: totalAmountNgn.toFixed(2),
          totalInterestNgn: totalInterestNgn.toFixed(2),
        },
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      },
    };
  }

  async overview(userId: string) {
    const rows = await this.prisma.autoStack.findMany({
      where: { userId, status: AutoStackStatus.ACTIVE },
      include: { cryptoCurrency: true },
    });
    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId,
        currencyId: { in: [...new Set(rows.map((row) => row.currencyId))] },
      },
      select: { currencyId: true, defaultNetwork: true },
    });
    const walletNetworkByCurrencyId = new Map(
      wallets.map((wallet) => [wallet.currencyId, wallet.defaultNetwork]),
    );
    let totalAmountLockedNgn = new Decimal(0);
    let totalInterestGainedNgn = new Decimal(0);

    for (const row of rows) {
      const symbol = row.cryptoCurrency.symbol.toUpperCase();
      const ngnRate =
        symbol === 'NGN'
          ? '1'
          : (await this.tickerService.getPrice(`${symbol.toLowerCase()}ngn`)) ||
            '0';
      const rate = new Decimal(ngnRate || '0');
      const network = walletNetworkByCurrencyId.get(row.currencyId);
      const amountMajor = new Decimal(
        this.fromAutoStackAmountBase(row.amount, symbol, network),
      );
      const interestMajor = new Decimal(
        this.fromAutoStackAmountBase(row.accruedInterest, symbol, network),
      );
      totalAmountLockedNgn = totalAmountLockedNgn.plus(amountMajor.mul(rate));
      totalInterestGainedNgn = totalInterestGainedNgn.plus(
        interestMajor.mul(rate),
      );
    }

    return {
      success: true,
      data: {
        totalAmountLocked: totalAmountLockedNgn.toFixed(2),
        totalInterestGained: totalInterestGainedNgn.toFixed(2),
        currency: 'NGN',
      },
    };
  }

  async cancelPending(userId: string, autoStackId: string) {
    const stack = await this.prisma.autoStack.findFirst({
      where: {
        id: autoStackId,
        userId,
        status: AutoStackStatus.PENDING as any,
      },
    });
    if (!stack) throw new NotFoundException('Pending autostack not found');
    const configTx = await this.prisma.transaction.findFirst({
      where: { userId, description: `autostack_config:${stack.id}` },
      orderBy: { createdAt: 'desc' },
    });
    const meta = (configTx?.paymentMetadata || {}) as any;
    const paymentType =
      meta.paymentType === PaymentType.CRYPTO_WALLET
        ? PaymentType.CRYPTO_WALLET
        : PaymentType.CARD;
    const initiationStatus = String(
      meta.autostackInitiationStatus || '',
    ).toUpperCase();

    if (
      paymentType !== PaymentType.CRYPTO_WALLET &&
      (['PROCESSING', 'SUBMITTED', 'COMPLETED'].includes(initiationStatus) ||
        meta.quidaxOrderId ||
        meta.quidaxOrderReference ||
        meta.autostackBuyOrderSubmittedAt)
    ) {
      throw new BadRequestException(
        'Autostack card payment is already in progress and cannot be cancelled',
      );
    }

    if (meta.autostackSwapId) {
      const swap = await this.quidaxSwapService.getSwapTransaction(
        {
          user_id: QUIDAX_COMPANY_USERID,
          swap_transaction_id: String(meta.autostackSwapId),
        },
        { skipCircuitBreaker: true },
      );
      const status = String(swap?.data?.status || '').toLowerCase();
      if (['completed', 'done'].includes(status))
        throw new BadRequestException(
          'Autostack swap already processed and cannot be cancelled',
        );
      await axios.post(
        `${process.env.QUIDAX_API_URL}/users/${QUIDAX_COMPANY_USERID}/swap_transactions/${meta.autostackSwapId}/cancel`,
        {},
        {
          headers: {
            Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
          },
        },
      );
    }
    if (meta.quidaxOrderId) {
      const order = await this.quidaxOrderService.getOrderRecord(
        {
          user_id: QUIDAX_COMPANY_USERID,
          order_id: String(meta.quidaxOrderId),
        },
        { skipCircuitBreaker: true },
      );
      const state = String(
        (order as any)?.data?.state || (order as any)?.data?.status || '',
      ).toLowerCase();
      if (['done', 'completed'].includes(state))
        throw new BadRequestException(
          'Autostack order already processed and cannot be cancelled',
        );
      await this.quidaxOrderService.cancelBuyOrSellOrderRequest(
        {
          user_id: QUIDAX_COMPANY_USERID,
          order_id: String(meta.quidaxOrderId),
        },
        { skipCircuitBreaker: true },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      if (
        meta.liquidityReservationStatus ===
          LiquidityReservationStatus.RESERVED &&
        meta.liquidityReservationCurrency &&
        meta.liquidityReservationAmount
      ) {
        await this.companyLiquidityService.releaseLiquidity(
          String(meta.liquidityReservationCurrency),
          BigInt(String(meta.liquidityReservationAmount)),
          tx as any,
        );
      }

      if (
        meta.paymentType === PaymentType.CRYPTO_WALLET &&
        meta.liquidityReservationStatus ===
          LiquidityReservationStatus.RESERVED &&
        meta.sourceAsset &&
        meta.sourceAmountBase
      ) {
        await this.transactionService.releaseBalance(
          tx as any,
          userId,
          String(meta.sourceAsset),
          BigInt(String(meta.sourceAmountBase)),
        );
      }

      if (configTx) {
        await tx.transaction.update({
          where: { id: configTx.id },
          data: {
            paymentMetadata: {
              ...meta,
              liquidityReservationStatus:
                meta.liquidityReservationStatus ===
                LiquidityReservationStatus.RESERVED
                  ? LiquidityReservationStatus.RELEASED
                  : meta.liquidityReservationStatus,
              liquidityReleasedAt:
                meta.liquidityReservationStatus ===
                LiquidityReservationStatus.RESERVED
                  ? new Date().toISOString()
                  : meta.liquidityReleasedAt,
              liquidityReleaseReason:
                meta.liquidityReservationStatus ===
                LiquidityReservationStatus.RESERVED
                  ? 'autostack_cancelled'
                  : meta.liquidityReleaseReason,
              autostackInitiationStatus: 'CANCELLED',
            } as Prisma.InputJsonValue,
          },
        });
      }

      await tx.autoStack.update({
        where: { id: stack.id },
        data: {
          status: AutoStackStatus.ENDED as any,
          endedAt: new Date(),
        },
      });
    });
    return {
      success: true,
      message: 'Pending autostack cancelled successfully',
    };
  }

  async unlock(userId: string, dto: EndAutoStackDto) {
    const stack = await this.prisma.autoStack.findFirst({
      where: {
        id: dto.autoStackId,
        userId,
        status: AutoStackStatus.ACTIVE as any,
      },
    });
    if (!stack) throw new NotFoundException('Active autostack not found');
    if (!dto.pin) throw new BadRequestException('PIN is required');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin)))
      throw new BadRequestException('Invalid pin');

    const isEarly = new Date() < stack.nextInterestAt;
    const principal = BigInt(stack.amount.toFixed(0));
    const accrued = BigInt(stack.accruedInterest.toFixed(0));
    const penalty = isEarly ? (principal * 5n) / 100n : 0n;
    const payout = isEarly ? principal - penalty : principal + accrued;
    const interestPaid = isEarly ? 0n : accrued;

    await this.prisma.$transaction(async (tx) => {
      const usdt = await tx.cryptoCurrency.findFirst({
        where: { symbol: 'USDT' },
      });
      if (!usdt) throw new NotFoundException('USDT currency not found');
      const wallet = await tx.wallet.findFirst({
        where: { userId, OR: [{ currencyId: usdt.id }, { currency: 'USDT' }] },
      });
      if (!wallet) throw new NotFoundException('USDT wallet not found');
      const [{ baseBalance: newBaseBalance }] = await tx.$queryRaw<
        { baseBalance: string }[]
      >`
        UPDATE "wallets"
        SET "baseBalance" = "baseBalance" + ${payout.toString()}::decimal,
            "stackedAmount" = GREATEST("stackedAmount" - ${principal.toString()}::decimal, 0),
            "totalStackedInterest" = GREATEST("totalStackedInterest" - ${accrued.toString()}::decimal, 0)
        WHERE "id" = ${wallet.id}
        RETURNING "baseBalance"
      `;
      const newOriginalBalance = ConvertCurrency.fromBase(
        BigInt(String(newBaseBalance)),
        'USDT',
        6,
      );
      await tx.$executeRaw`
        UPDATE "wallets"
        SET "originalBalance" = ${newOriginalBalance}
        WHERE "id" = ${wallet.id}
      `;
      await tx.autoStack.update({
        where: { id: stack.id },
        data: {
          status: AutoStackStatus.ENDED as any,
          endedAt: new Date(),
        },
      });
      await tx.$executeRaw`
        UPDATE "company_liquidity"
        SET "totalAmountStacked" = GREATEST("totalAmountStacked" - ${principal.toString()}::decimal, 0),
            "totalAccruedLockedInterest" = GREATEST("totalAccruedLockedInterest" - ${accrued.toString()}::decimal, 0),
            "totalLockedInterestPaid" = "totalLockedInterestPaid" + ${interestPaid.toString()}::decimal
        WHERE LOWER("currency") = LOWER('USDT')
      `;
    });

    return {
      success: true,
      message: isEarly
        ? 'Autostack unlocked early with penalty and no interest'
        : 'Autostack unlocked successfully',
    };
  }
}
