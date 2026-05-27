import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { compareHash } from '../../../shared/services/hash';
import { AutoStackConfirmDto, AutoStackPaymentTypesDto, AutoStackPreviewDto, AutoStackQuoteDto } from '../dto/autostack.dto';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { QUIDAX_COMPANY_USERID } from '../../transaction/constants';
import { PaymentType, Prisma, TransactionContext, TransactionStatus, TransactionType } from '../../../infrastructure/databases/prisma';
import { TempStoreService } from '../../../infrastructure/databases/redis';

import { AUTOSTACK_DEFAULT_PLAN_NAME, AUTOSTACK_FREQUENCY_PERIOD_DAYS, AUTOSTACK_QUOTE_TTL_SECONDS } from '../constants/autostack.constants';

@Injectable()
export class AutoStackService {
  constructor(private readonly prisma: PrismaService, private readonly queueService: QueueService, private readonly tempStore: TempStoreService, private readonly tickerService: QuidaxTickerService, private readonly quidaxSwapService: QuidaxSwapService, private readonly paystackService: PaystackService) {}

  async quote(userId: string, dto: AutoStackQuoteDto) {
    void userId;
    const quoteId = crypto.randomUUID();
    const assetSymbol = dto.asset.toUpperCase();
    const asset = await this.prisma.cryptoCurrency.findUnique({ where: { symbol: assetSymbol }, include: { rate: true } });
    if (!asset) throw new NotFoundException('Asset not found');

    const pair = `${assetSymbol.toLowerCase()}usdt`;
    const tickerRate = assetSymbol === 'USDT' ? '1' : await this.tickerService.getPrice(pair);
    if (!tickerRate) throw new BadRequestException(`Unable to fetch conversion rate for ${assetSymbol}`);

    const conversionRate = Number(tickerRate);
    if (!Number.isFinite(conversionRate) || conversionRate <= 0) throw new BadRequestException(`Invalid conversion rate for ${assetSymbol}`);
    const amountInUsdt = dto.amount * conversionRate;

    const payload = { quoteId, asset: assetSymbol, amount: dto.amount, amountInUsdt, rate: conversionRate, expiresAt: Date.now() + AUTOSTACK_QUOTE_TTL_SECONDS * 1000, planName: dto.planName || AUTOSTACK_DEFAULT_PLAN_NAME, targetAsset: assetSymbol };
    await this.tempStore.set(`autostack:${quoteId}`, JSON.stringify(payload), AUTOSTACK_QUOTE_TTL_SECONDS);
    return { success: true, data: { quoteId, rates: { assetToUsdt: payload.rate }, expiresIn: AUTOSTACK_QUOTE_TTL_SECONDS, amountInUsdt: amountInUsdt.toFixed(8) } };
  }

  async paymentTypes(userId: string, dto: AutoStackPaymentTypesDto) {
    const quote = await this.tempStore.get(`autostack:${dto.quoteId}`);
    if (!quote) throw new NotFoundException('Quote not found or expired');
    const cards = await this.prisma.card.findMany({ where: { userId, isActive: true }, select: { id: true, cardType: true, last4: true, expMonth: true, expYear: true } as any });
    const wallets = await this.prisma.wallet.findMany({ where: { userId }, include: { cryptoCurrency: true } });
    return { success: true, data: { wallets: wallets.map((w) => { const totalAmount = Number(w.baseBalance || 0); const lockedAmount = Number(w.lockedAmount || 0); const stackedAmount = Number(w.stackedAmount || 0); const reservedAmount = Number(w.reservedBalance || 0); const availableAmount = totalAmount - lockedAmount - stackedAmount - reservedAmount; return ({ walletId: w.id, asset: w.cryptoCurrency.symbol, totalAmount, lockedAmount, stackedAmount, reservedAmount, availableAmount }); }), cards } };
  }

  async preview(userId: string, dto: AutoStackPreviewDto) {
    void userId;
    const quoteKey = `autostack:${dto.quoteId}`;
    const quoteJson = await this.tempStore.get(quoteKey);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');
    const quote = JSON.parse(quoteJson);

    const amountInUsdt = Number(quote.amountInUsdt || 0);
    const feeSetting = await this.prisma.autoStackingTransactionFee.findFirst({ where: { currency: 'USDT', fromAmount: { lte: new Prisma.Decimal(amountInUsdt) }, toAmount: { gte: new Prisma.Decimal(amountInUsdt) } } });
    const txFee = feeSetting?.feeAmount?.toNumber() || 0;
    const txFeePct = amountInUsdt > 0 ? (txFee / amountInUsdt) * 100 : 0;

    const setting = await this.prisma.autoStackingSettings.findFirst();
    const dailyInterestRatePercent = setting?.dailyInterestRatePercent?.toNumber() || 0;
    const periods = AUTOSTACK_FREQUENCY_PERIOD_DAYS[dto.frequency];
    const interest = amountInUsdt * (dailyInterestRatePercent / 100) * periods;
    const estimatedOut = amountInUsdt - txFee + interest;

    const quoteAsset = String(quote.asset || 'USDT').toUpperCase();
    const quoteAssetCurrency = await this.prisma.cryptoCurrency.findUnique({ where: { symbol: quoteAsset }, include: { buffer_tiers: true } });
    const amountMinor = BigInt(Math.floor((quote.amount || 0) * 100000000).toString());
    const bufferPercent = dto.paymentType === 'CRYPTO_WALLET' && quoteAsset === 'BTC' ? this.getBufferPercentFromTiers(quoteAssetCurrency, amountMinor) : 0;
    const bufferAmount = bufferPercent > 0 ? quote.amount * (bufferPercent / 100) : 0;
    const totalChargeAmount = quote.amount + bufferAmount;

    const preview = { ...quote, frequency: dto.frequency, paymentType: dto.paymentType, paymentCardId: (dto as any).paymentCardId, transactionFee: txFee, transactionFeePercentage: txFeePct, interestRate: dailyInterestRatePercent, estimatedOut, startDate: dto.startDate, timeOfDay: dto.timeOfDay, dayOfWeek: dto.dayOfWeek, dayOfMonth: dto.dayOfMonth, bufferPercent, bufferAmount, totalChargeAmount };
    await this.tempStore.set(quoteKey, JSON.stringify(preview), Math.ceil((quote.expiresAt - Date.now()) / 1000));

    return { success: true, data: { amount: amountInUsdt, frequency: dto.frequency, paymentType: dto.paymentType, planName: quote.planName, rate: quote.rate, transactionFee: txFee, interestRate: dailyInterestRatePercent, estimatedOut, transactionFeePercentage: txFeePct } };
  }

  async confirm(userId: string, dto: AutoStackConfirmDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { pin: true } });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin))) throw new BadRequestException('Invalid pin');
    const quoteJson = await this.tempStore.get(`autostack:${dto.quoteId}`);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');
    const preview = JSON.parse(quoteJson);

    const usdt = await this.prisma.cryptoCurrency.findFirst({ where: { symbol: 'USDT' } });
    if (!usdt) throw new NotFoundException('USDT currency not found');
    const nextExecutionAt = new Date(preview.startDate || new Date());
    const autoStack = await this.prisma.autoStack.create({ data: { userId, currencyId: usdt.id, planName: preview.planName, frequency: preview.frequency, amount: Math.floor(preview.amountInUsdt * 1_000_000).toString(), startDate: new Date(preview.startDate || new Date()), timeOfDay: preview.timeOfDay || '00:00', dayOfWeek: preview.dayOfWeek, dayOfMonth: preview.dayOfMonth, nextExecutionAt, nextInterestAt: nextExecutionAt, status: 'ACTIVE', transactionFee: Math.floor((preview.transactionFee || 0) * 1_000_000).toString() } });

    const reference = `autostack-confirm-${autoStack.id}-${Date.now()}`;
    const paymentType = preview.paymentType === 'CRYPTO_WALLET' ? PaymentType.CRYPTO_WALLET : PaymentType.CARD;

    await this.prisma.transaction.create({ data: { userId, transactionUniqueId: reference, currency: 'USDT', fiatAmountBase: Math.floor(preview.amountInUsdt * 1_000_000).toString(), transactionType: TransactionType.DEBIT, transactionContext: TransactionContext.AUTOSTACK, status: TransactionStatus.PENDING, paymentType, paymentMetadata: { autoStackId: autoStack.id, paymentType: preview.paymentType, paymentCardId: preview.paymentCardId || null, targetAsset: preview.targetAsset || preview.asset || 'USDT', bufferPercent: preview.bufferPercent || 0, bufferAmount: preview.bufferAmount || 0, totalChargeAmount: preview.totalChargeAmount || preview.amount } as any, description: `autostack_config:${autoStack.id}` } as any });

    if (preview.paymentType === 'CRYPTO_WALLET') {
      const swapQuote = await this.quidaxSwapService.createInstantSwapRequest(QUIDAX_COMPANY_USERID, { from_currency: (preview.asset || 'USDT').toLowerCase(), to_currency: 'usdt', from_amount: String(preview.totalChargeAmount || preview.amount || preview.amountInUsdt) }, { skipCircuitBreaker: true });
      const quotationId = swapQuote?.data?.swap_quotation?.id;
      if (!quotationId) throw new BadRequestException('Unable to create swap quotation');
      await this.quidaxSwapService.confirmInstantSwap({ user_id: QUIDAX_COMPANY_USERID, quotation_id: quotationId }, { skipCircuitBreaker: true });
    } else {
      if (!preview.paymentCardId) throw new BadRequestException('Payment card is required for card autostack');
      await this.paystackService.chargeSavedCard({ paymentCardId: preview.paymentCardId, amount: Number(preview.amountInUsdt), reference, metadata: { autoStackId: autoStack.id, mode: 'AUTOSTACK_PERIODIC' } }, { skipCircuitBreaker: true });
    }

    await this.queueService.add(QueueName.CLEANUP, 'autostack.execute', { autoStackId: autoStack.id }, { jobId: `autostack:${autoStack.id}`, delay: Math.max(nextExecutionAt.getTime() - Date.now(), 0) });
    return { success: true, message: 'Autostack created and awaiting webhook completion', data: autoStack };
  }

  async getHistory(userId: string, page = 1, limit = 20) { const skip = (page - 1) * limit; const [items, total] = await Promise.all([this.prisma.autoStack.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { cryptoCurrency: true } }), this.prisma.autoStack.count({ where: { userId } })]); return { success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } }; }

  async overview(userId: string) {
    const rows = await this.prisma.autoStack.findMany({ where: { userId } });
    const totalAmountLocked = rows.reduce((a, r) => a + BigInt(r.amount.toFixed(0)), 0n);
    const totalInterestGained = rows.reduce((a, r) => a + BigInt(r.accruedInterest.toFixed(0)), 0n);
    return { success: true, data: { totalAmountLocked: totalAmountLocked.toString(), totalInterestGained: totalInterestGained.toString() } };
  }
}
  private getBufferPercentFromTiers(asset: any, amountMinor: bigint): number {
    const tiers = asset?.buffer_tiers || [];
    const matchingTier = tiers.find((tier: any) => {
      if (!tier?.minAmount || !tier?.maxAmount || tier?.bufferPercent === null || tier?.bufferPercent === undefined) return false;
      const min = BigInt(tier.minAmount.toString());
      const max = BigInt(tier.maxAmount.toString());
      return amountMinor >= min && amountMinor <= max;
    });
    if (matchingTier) return Number(matchingTier.bufferPercent || 0);
    return Number(asset?.defaultBufferPercent || 0);
  }
