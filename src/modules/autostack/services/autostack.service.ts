import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import {
  AutoStackStatus,
  PrismaService,
} from '../../../infrastructure/databases/prisma';
import { compareHash } from '../../../shared/services/hash';
import { ConvertCurrency } from '../../../shared';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly tempStore: TempStoreService,
    private readonly tickerService: QuidaxTickerService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly quidaxOrderService: QuidaxOrderService,
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

    const conversionRate = Number(tickerRate);
    if (!Number.isFinite(conversionRate) || conversionRate <= 0)
      throw new BadRequestException(
        `Invalid conversion rate for ${assetSymbol}`,
      );
    const amountInUsdt = dto.amount * conversionRate;

    const payload = {
      quoteId,
      asset: assetSymbol,
      amount: dto.amount,
      amountInUsdt,
      rate: conversionRate,
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
        amountInUsdt: amountInUsdt.toFixed(8),
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

    const amountInUsdt = Number(quote.amountInUsdt || 0);
    const feeSetting = await this.prisma.autoStackingTransactionFee.findFirst({
      where: {
        currency: 'USDT',
        fromAmount: { lte: new Prisma.Decimal(amountInUsdt) },
        toAmount: { gte: new Prisma.Decimal(amountInUsdt) },
      },
    });
    const txFee = feeSetting?.feeAmount?.toNumber() || 0;
    const txFeePct = amountInUsdt > 0 ? (txFee / amountInUsdt) * 100 : 0;

    const setting = await this.prisma.autoStackingSettings.findFirst();
    const dailyInterestRatePercent =
      setting?.dailyInterestRatePercent?.toNumber() || 0;
    const periods = AUTOSTACK_FREQUENCY_PERIOD_DAYS[dto.frequency];
    const interest = amountInUsdt * (dailyInterestRatePercent / 100) * periods;
    const estimatedOut = amountInUsdt - txFee + interest;

    const quoteAsset = String(quote.asset || 'USDT').toUpperCase();
    const quoteAssetCurrency = await this.prisma.cryptoCurrency.findUnique({
      where: { symbol: quoteAsset },
      include: { buffer_tiers: true },
    });
    const amountMinor = BigInt(
      Math.floor((quote.amount || 0) * 100000000).toString(),
    );
    const bufferPercent =
      dto.paymentType === PaymentType.CRYPTO_WALLET && quoteAsset === 'BTC'
        ? this.getBufferPercentFromTiers(quoteAssetCurrency, amountMinor)
        : 0;
    const bufferAmount =
      bufferPercent > 0 ? quote.amount * (bufferPercent / 100) : 0;
    const totalChargeAmount = quote.amount + bufferAmount;

    const preview = {
      ...quote,
      frequency: dto.frequency,
      paymentType: dto.paymentType,
      paymentCardId: (dto as any).paymentCardId,
      transactionFee: txFee,
      transactionFeePercentage: txFeePct,
      interestRate: dailyInterestRatePercent,
      estimatedOut,
      startDate: dto.startDate,
      timeOfDay: dto.timeOfDay,
      dayOfWeek: dto.dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
      bufferPercent,
      bufferAmount,
      totalChargeAmount,
    };
    await this.tempStore.set(
      quoteKey,
      JSON.stringify(preview),
      Math.ceil((quote.expiresAt - Date.now()) / 1000),
    );

    return {
      success: true,
      data: {
        amount: amountInUsdt,
        frequency: dto.frequency,
        paymentType: dto.paymentType,
        planName: quote.planName,
        rate: quote.rate,
        transactionFee: txFee,
        interestRate: dailyInterestRatePercent,
        estimatedOut,
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
    const principalUsdtMinor = BigInt(
      Math.floor(Number(preview.amountInUsdt || 0) * 1_000_000).toString(),
    );
    const principalUsdtOriginal = Number(preview.amountInUsdt || 0).toString();
    const transactionFeeMinor = BigInt(
      Math.floor(Number(preview.transactionFee || 0) * 1_000_000).toString(),
    );

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
          ? BigInt(
              Math.floor(Number(sourceAmountOriginal) * 1_000_000).toString(),
            )
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

    await this.queueService.add(
      QueueName.CLEANUP,
      'scheduler.autostack.charge',
      { autoStackId: autoStack.id },
      {
        jobId: `scheduler.autostack.charge-${autoStack.id}-${nextExecutionAt.toISOString().replace(/:/g, '-')}`,
        delay: Math.max(nextExecutionAt.getTime() - Date.now(), 0),
      },
    );
    return {
      success: true,
      message:
        'Autostack created and will be initiated on the selected start date',
      data: autoStack,
    };
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
