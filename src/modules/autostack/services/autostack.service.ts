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

@Injectable()
export class AutoStackService {
  private getBufferPercentFromTiers(asset: any, amountMinor: bigint): number {
    const tiers = asset?.buffer_tiers || [];
    const matchingTier = tiers.find((tier: any) => {
      if (
        !tier?.minAmount ||
        !tier?.maxAmount ||
        tier?.bufferPercent === null ||
        tier?.bufferPercent === undefined
      )
        return false;
      const min = BigInt(tier.minAmount.toString());
      const max = BigInt(tier.maxAmount.toString());
      return amountMinor >= min && amountMinor <= max;
    });
    if (matchingTier) return Number(matchingTier.bufferPercent || 0);
    return Number(asset?.defaultBufferPercent || 0);
  }

  private toBaseUnits(amount: Decimal.Value, decimals: number): bigint {
    return BigInt(
      new Decimal(amount)
        .mul(new Decimal(10).pow(decimals))
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0),
    );
  }

  private toUsdtBase(amount: Decimal.Value): bigint {
    return this.toBaseUnits(amount, 6);
  }

  private toNgnBase(amount: Decimal.Value): bigint {
    return this.toBaseUnits(amount, 2);
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
    const assetSymbol = dto.asset.toUpperCase();
    const asset = await this.prisma.cryptoCurrency.findUnique({
      where: { symbol: assetSymbol },
      include: { rate: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');

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
        rates: { assetToUsdt: payload.rate },
        expiresIn: AUTOSTACK_QUOTE_TTL_SECONDS,
        amountInUsdt: amountInUsdt.toString(),
      },
    };
  }

  async paymentTypes(userId: string, dto: AutoStackPaymentTypesDto) {
    const quote = await this.tempStore.get(`autostack:${dto.quoteId}`);
    if (!quote) throw new NotFoundException('Quote not found or expired');
    const cards = await this.prisma.card.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        cardType: true,
        last4: true,
        expMonth: true,
        expYear: true,
      } as any,
    });
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      include: { cryptoCurrency: true },
    });
    return {
      success: true,
      data: {
        wallets: wallets.map((w) => {
          const totalAmount = Number(w.baseBalance || 0);
          const lockedAmount = Number(w.lockedAmount || 0);
          const stackedAmount = Number(w.stackedAmount || 0);
          const reservedAmount = Number(w.reservedBalance || 0);
          const availableAmount =
            totalAmount - lockedAmount - stackedAmount - reservedAmount;
          return {
            walletId: w.id,
            asset: w.cryptoCurrency.symbol,
            totalAmount,
            lockedAmount,
            stackedAmount,
            reservedAmount,
            availableAmount,
          };
        }),
        cards,
      },
    };
  }

  async preview(userId: string, dto: AutoStackPreviewDto) {
    void userId;
    const quoteKey = `autostack:${dto.quoteId}`;
    const quoteJson = await this.tempStore.get(quoteKey);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');
    const quote = JSON.parse(quoteJson);

    const amountInUsdt = new Decimal(quote.amountInUsdt || 0);
    const feeSetting = await this.prisma.autoStackingTransactionFee.findFirst({
      where: {
        currency: 'USDT',
        fromAmount: { lte: new Prisma.Decimal(amountInUsdt.toString()) },
        toAmount: { gte: new Prisma.Decimal(amountInUsdt.toString()) },
      },
    });
    const txFee = new Decimal(feeSetting?.feeAmount?.toString() || '0');
    const txFeePct = amountInUsdt.gt(0)
      ? txFee.div(amountInUsdt).mul(100).toNumber()
      : 0;

    const setting = await this.prisma.autoStackingSettings.findFirst();
    const dailyInterestRatePercent =
      setting?.dailyInterestRatePercent?.toNumber() || 0;
    const periods = AUTOSTACK_FREQUENCY_PERIOD_DAYS[dto.frequency];
    const interest = amountInUsdt
      .mul(dailyInterestRatePercent)
      .div(100)
      .mul(periods);
    const estimatedOut = amountInUsdt.minus(txFee).plus(interest);

    const quoteAsset = String(quote.asset || 'USDT').toUpperCase();
    const quoteAssetCurrency = await this.prisma.cryptoCurrency.findUnique({
      where: { symbol: quoteAsset },
      include: { buffer_tiers: true },
    });
    const amountMinor = this.toBaseUnits(quote.amount || 0, 8);
    const bufferPercent =
      dto.paymentType === PaymentType.CRYPTO_WALLET && quoteAsset === 'BTC'
        ? this.getBufferPercentFromTiers(quoteAssetCurrency, amountMinor)
        : 0;
    const quoteAmount = new Decimal(quote.amount || 0);
    const bufferAmount =
      bufferPercent > 0
        ? quoteAmount.mul(bufferPercent).div(100)
        : new Decimal(0);
    const totalChargeAmount = quoteAmount.plus(bufferAmount);

    const preview = {
      ...quote,
      frequency: dto.frequency,
      paymentType: dto.paymentType,
      paymentCardId: (dto as any).paymentCardId,
      transactionFee: txFee.toString(),
      transactionFeePercentage: txFeePct,
      interestRate: dailyInterestRatePercent,
      estimatedOut: estimatedOut.toString(),
      startDate: dto.startDate,
      timeOfDay: dto.timeOfDay,
      dayOfWeek: dto.dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
      bufferPercent,
      bufferAmount: bufferAmount.toString(),
      totalChargeAmount: totalChargeAmount.toString(),
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
        paymentType: dto.paymentType,
        planName: quote.planName,
        rate: quote.rate,
        transactionFee: txFee.toString(),
        interestRate: dailyInterestRatePercent,
        estimatedOut: estimatedOut.toString(),
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
    const preview = JSON.parse(quoteJson);

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
      sourceWallet = await this.prisma.wallet.findFirst({
        where: { userId, currency: sourceAsset },
      });
      if (!sourceWallet)
        throw new NotFoundException(`${sourceAsset} wallet not found`);
      sourceAmountOriginal = String(
        preview.totalChargeAmount || preview.amount || preview.amountInUsdt,
      );
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
            sourceAsset,
            targetAsset: 'USDT',
            principalUsdtAmount: principalUsdtOriginal,
            principalUsdtAmountBase: principalUsdtMinor.toString(),
            sourceAmount: sourceAmountOriginal,
            sourceAmountBase: sourceAmountMinor.toString(),
            bufferPercent: preview.bufferPercent || 0,
            bufferAmount: preview.bufferAmount || 0,
            totalChargeAmount: sourceAmountOriginal,
            autostackInitiationStatus: 'PENDING',
          } as any,
          description: `autostack_config:${createdAutoStack.id}`,
        } as any,
      });

      return createdAutoStack;
    });

    const now = new Date();
    if (nextExecutionAt <= now || this.isSameUtcDate(nextExecutionAt, now)) {
      await this.initiateAutoStack(autoStack.id, { force: true });
      return {
        success: true,
        message: 'Autostack created and initiated for today',
        data: autoStack,
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
        'Autostack created and will be initiated on the selected start date',
      data: autoStack,
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
    if (!options.force && stack.nextExecutionAt > now) return;
    if (stackStatus === 'ACTIVE' && stack.nextInterestAt <= now) return;

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
    const principalUsdtBase = String(
      configMeta.principalUsdtAmountBase || stack.amount.toFixed(0),
    );
    const principalUsdtOriginal = String(
      configMeta.principalUsdtAmount ||
        configTx.cryptoAmountOriginal ||
        ConvertCurrency.fromBase(BigInt(principalUsdtBase), 'USDT'),
    );
    const sourceAmountBase = String(
      configMeta.sourceAmountBase ||
        configTx.cryptoAmountBase ||
        principalUsdtBase,
    );
    const sourceAmountOriginal = String(
      configMeta.sourceAmount ||
        configMeta.totalChargeAmount ||
        configTx.cryptoAmountOriginal ||
        principalUsdtOriginal,
    );

    try {
      return await this.prisma.transaction.create({
        data: {
          userId: stack.userId,
          transactionUniqueId: executionReference,
          receiverWalletAddress: configTx.receiverWalletAddress ?? null,
          currency:
            paymentType === PaymentType.CRYPTO_WALLET
              ? String(configMeta.sourceAsset || configTx.currency || 'USDT')
              : 'USDT',
          cryptoAmountBase:
            paymentType === PaymentType.CRYPTO_WALLET
              ? sourceAmountBase
              : principalUsdtBase,
          cryptoAmountOriginal:
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
        ConvertCurrency.fromBase(principalUsdtBase, 'USDT'),
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
            const isInitialExecution = String(stack.status) === 'PENDING';
            await tx.autoStack.update({
              where: { id: stack.id },
              data: {
                amount: isInitialExecution
                  ? sourceAmountBase.toString()
                  : { increment: sourceAmountBase.toString() },
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
      const ngnAmount = new Decimal(principalUsdtOriginal).mul(usdtNgnRate);
      const ngnAmountBase = this.toNgnBase(ngnAmount);
      const ngnAmountOriginal = ConvertCurrency.fromBase(ngnAmountBase, 'NGN');
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
  async getHistory(userId: string, page = 1, limit = 10) {
    const safeLimit = Math.min(Math.max(limit || 10, 1), 20);
    const safePage = Math.max(page || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.prisma.autoStack.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        include: { cryptoCurrency: true },
      }),
      this.prisma.autoStack.count({ where: { userId } }),
    ]);

    let totalAmountNgn = 0;
    let totalInterestNgn = 0;
    const mapped = await Promise.all(
      items.map(async (item) => {
        const symbol = item.cryptoCurrency.symbol.toUpperCase();
        const ngnRate =
          symbol === 'NGN'
            ? '1'
            : (await this.tickerService.getPrice(
                `${symbol.toLowerCase()}ngn`,
              )) || '0';
        const rate = Number(ngnRate) || 0;
        const amountMajor = Number(item.amount.toString()) / 1_000_000;
        const interestMajor =
          Number(item.accruedInterest.toString()) / 1_000_000;
        const amountNgn = amountMajor * rate;
        const interestNgn = interestMajor * rate;
        totalAmountNgn += amountNgn;
        totalInterestNgn += interestNgn;
        return {
          ...item,
          amountNgn: amountNgn.toFixed(20),
          accruedInterestNgn: interestNgn.toFixed(20),
        };
      }),
    );

    return {
      success: true,
      data: {
        items: mapped,
        totals: {
          totalAmountNgn: totalAmountNgn.toFixed(20),
          totalInterestNgn: totalInterestNgn.toFixed(20),
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
    const rows = await this.prisma.autoStack.findMany({ where: { userId } });
    const totalAmountLocked = rows.reduce(
      (a, r) => a + BigInt(r.amount.toFixed(0)),
      0n,
    );
    const totalInterestGained = rows.reduce(
      (a, r) => a + BigInt(r.accruedInterest.toFixed(0)),
      0n,
    );
    return {
      success: true,
      data: {
        totalAmountLocked: totalAmountLocked.toString(),
        totalInterestGained: totalInterestGained.toString(),
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
    if (meta.autostackSwapId) {
      const swap = await this.quidaxSwapService.getSwapTransaction(
        { user_id: 'me', swap_transaction_id: String(meta.autostackSwapId) },
        { skipCircuitBreaker: true },
      );
      const status = String(swap?.data?.status || '').toLowerCase();
      if (['completed', 'done'].includes(status))
        throw new BadRequestException(
          'Autostack swap already processed and cannot be cancelled',
        );
      await axios.post(
        `${process.env.QUIDAX_API_URL}/users/me/swap_transactions/${meta.autostackSwapId}/cancel`,
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
        { user_id: 'me', order_id: String(meta.quidaxOrderId) },
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
    await this.prisma.autoStack.update({
      where: { id: stack.id },
      data: { status: AutoStackStatus.TERMINATED as any, endedAt: new Date() },
    });
    return {
      success: true,
      message: 'Pending autostack cancelled successfully',
    };
  }

  async unlock(userId: string, dto: EndAutoStackDto) {
    const stack = await this.prisma.autoStack.findFirst({
      where: { id: dto.autoStackId, userId, status: 'ACTIVE' as any },
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
      const wallet = await tx.wallet.findFirst({
        where: { userId, currency: 'USDT' },
      });
      if (!wallet) throw new NotFoundException('USDT wallet not found');
      await tx.$executeRaw`
        UPDATE "wallets"
        SET "baseBalance" = "baseBalance" + ${payout.toString()}::decimal,
            "stackedAmount" = GREATEST("stackedAmount" - ${principal.toString()}::decimal, 0),
            "totalStackedInterest" = GREATEST("totalStackedInterest" - ${accrued.toString()}::decimal, 0)
        WHERE "id" = ${wallet.id}
      `;
      await tx.autoStack.update({
        where: { id: stack.id },
        data: {
          status: AutoStackStatus.TERMINATED as any,
          endedAt: new Date(),
        },
      });
      await tx.$executeRaw`
        UPDATE "company_liquidity"
        SET "totalAmountStacked" = GREATEST("totalAmountStacked" - ${principal.toString()}::decimal, 0),
            "totalAccruedLockedInterest" = GREATEST("totalAccruedLockedInterest" - ${accrued.toString()}::decimal, 0),
            "totalLockedInterestPaid" = "totalLockedInterestPaid" + ${interestPaid.toString()}::decimal
        WHERE "currency" = 'USDT'
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
