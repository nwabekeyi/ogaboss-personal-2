import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { compareHash } from '../../../shared/services/hash';
import { AutoStackConfirmDto, AutoStackPaymentTypesDto, AutoStackPreviewDto, AutoStackQuoteDto } from '../dto/autostack.dto';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { PaymentType, Prisma, TransactionContext, TransactionStatus, TransactionType } from '../../../infrastructure/databases/prisma';
import { TempStoreService } from '../../../infrastructure/databases/redis';

const AUTOSTACK_QUOTE_TTL_SECONDS = 300;

@Injectable()
export class AutoStackService {
  constructor(private readonly prisma: PrismaService, private readonly queueService: QueueService, private readonly tempStore: TempStoreService) {}

  async quote(userId: string, dto: AutoStackQuoteDto) {
    void userId;
    const quoteId = crypto.randomUUID();
    const assetSymbol = dto.asset.toUpperCase();
    const asset = await this.prisma.cryptoCurrency.findUnique({ where: { symbol: assetSymbol }, include: { rate: true } });
    if (!asset) throw new NotFoundException('Asset not found');

    const usdt = await this.prisma.cryptoCurrency.findUnique({ where: { symbol: 'USDT' }, include: { rate: true } });
    if (!usdt) throw new NotFoundException('USDT currency not found');

    const assetDailyRatePercent = asset.rate?.dailyRatePercent?.toNumber() || 0;
    const usdtDailyRatePercent = usdt.rate?.dailyRatePercent?.toNumber() || 0;
    const conversionRate = assetSymbol === 'USDT' ? 1 : assetDailyRatePercent > 0 ? assetDailyRatePercent / 100 : usdtDailyRatePercent > 0 ? usdtDailyRatePercent / 100 : 1;
    const amountInUsdt = dto.amount * conversionRate;

    const payload = { quoteId, asset: assetSymbol, amount: dto.amount, amountInUsdt, rate: conversionRate, expiresAt: Date.now() + AUTOSTACK_QUOTE_TTL_SECONDS * 1000, planName: dto.planName || 'AutoStack Plan', targetAsset: assetSymbol };
    await this.tempStore.set(`autostack:${quoteId}`, JSON.stringify(payload), AUTOSTACK_QUOTE_TTL_SECONDS);
    return { success: true, data: { quoteId, rates: { assetToUsdt: payload.rate }, expiresIn: AUTOSTACK_QUOTE_TTL_SECONDS, amountInUsdt: amountInUsdt.toFixed(8) } };
  }

  async paymentTypes(userId: string, dto: AutoStackPaymentTypesDto) {
    const quote = await this.tempStore.get(`autostack:${dto.quoteId}`);
    if (!quote) throw new NotFoundException('Quote not found or expired');
    const cards = await this.prisma.card.findMany({ where: { userId, isActive: true }, select: { id: true, cardType: true, last4: true, expMonth: true, expYear: true } as any });
    const wallets = await this.prisma.wallet.findMany({ where: { userId }, include: { cryptoCurrency: true } });
    return { success: true, data: { wallets: wallets.map((w) => ({ walletId: w.id, asset: w.cryptoCurrency.symbol })), cards } };
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
    const periods = dto.frequency === 'DAILY' ? 1 : dto.frequency === 'WEEKLY' ? 7 : 30;
    const interest = amountInUsdt * (dailyInterestRatePercent / 100) * periods;
    const amountOut = amountInUsdt - txFee + interest;

    const preview = { ...quote, frequency: dto.frequency, paymentType: dto.paymentType, paymentCardId: (dto as any).paymentCardId, transactionFee: txFee, transactionFeePercentage: txFeePct, interestRate: dailyInterestRatePercent, amountOut, startDate: dto.startDate, timeOfDay: dto.timeOfDay, dayOfWeek: dto.dayOfWeek, dayOfMonth: dto.dayOfMonth };
    await this.tempStore.set(quoteKey, JSON.stringify(preview), Math.ceil((quote.expiresAt - Date.now()) / 1000));

    return { success: true, data: { amount: amountInUsdt, frequency: dto.frequency, paymentType: dto.paymentType, planName: quote.planName, rate: quote.rate, transactionFee: txFee, interestRate: dailyInterestRatePercent, amountOut, transactionFeePercentage: txFeePct } };
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
    const autoStack = await this.prisma.autoStack.create({ data: { userId, currencyId: usdt.id, planName: preview.planName, frequency: preview.frequency, amount: Math.floor(preview.amountInUsdt * 1_000_000).toString(), startDate: new Date(preview.startDate || new Date()), timeOfDay: preview.timeOfDay || '00:00', dayOfWeek: preview.dayOfWeek, dayOfMonth: preview.dayOfMonth, nextExecutionAt, nextInterestAt: nextExecutionAt, transactionFee: Math.floor((preview.transactionFee || 0) * 1_000_000).toString() } });

    await this.prisma.transaction.create({ data: { userId, transactionUniqueId: `autostack-config-${autoStack.id}`, currency: 'USDT', fiatAmountBase: '0', transactionType: TransactionType.DEBIT, transactionContext: TransactionContext.AUTOSTACK, status: TransactionStatus.PENDING, paymentType: (preview.paymentType === 'CARD' ? PaymentType.CARD : PaymentType.PAYSTACK), paymentMetadata: { autoStackId: autoStack.id, paymentType: preview.paymentType, paymentCardId: preview.paymentCardId || null, targetAsset: preview.targetAsset || preview.asset || 'USDT' } as any, description: `autostack_config:${autoStack.id}` } as any });

    await this.queueService.add(QueueName.CLEANUP, 'autostack.execute', { autoStackId: autoStack.id }, { jobId: `autostack:${autoStack.id}`, delay: Math.max(nextExecutionAt.getTime() - Date.now(), 0) });
    return { success: true, message: 'Autostack created', data: autoStack };
  }

  async getHistory(userId: string, page = 1, limit = 20) { const skip = (page - 1) * limit; const [items, total] = await Promise.all([this.prisma.autoStack.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { cryptoCurrency: true } }), this.prisma.autoStack.count({ where: { userId } })]); return { success: true, data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } }; }

  async overview(userId: string) {
    const rows = await this.prisma.autoStack.findMany({ where: { userId } });
    const totalAmountLocked = rows.reduce((a, r) => a + BigInt(r.amount.toFixed(0)), 0n);
    const totalInterestGained = rows.reduce((a, r) => a + BigInt(r.accruedInterest.toFixed(0)), 0n);
    return { success: true, data: { totalAmountLocked: totalAmountLocked.toString(), totalInterestGained: totalInterestGained.toString() } };
  }
}
