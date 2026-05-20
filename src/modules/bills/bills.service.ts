import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayService } from '../../infrastructure/providers/xpresspay/xpresspay.service';
import { BillPaymentConfirmDto, BillQuoteDto, ValidateBillDto } from './dto/bills.dto';
import { ConvertCurrency } from '../../shared/utils/currency-precision.util';
import { compareHash } from '../../shared/services/hash';
import { TransactionContext } from '../../infrastructure/databases/prisma';
import { BILL_CATEGORIES, BILL_QUOTE_KEY_PREFIX, BILL_QUOTE_TTL_SECONDS } from './constants';
import { TempStoreService } from '../../infrastructure/databases/redis';
import { PLATFORM_SPREAD } from '../transaction/constants';
import { QuidaxTickerService } from '../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpresspay: XpresspayService,
    private readonly tempStore: TempStoreService,
    private readonly ticker: QuidaxTickerService
  ) {}

  async categories() { return { success: true, data: BILL_CATEGORIES }; }

  async billers(categoryId: string) {
    const category = BILL_CATEGORIES.find((c) => c.id === categoryId);
    if (!category) throw new BadRequestException('Invalid bill category id');
    return { success: true, data: await this.xpresspay.getBillers(category.key) };
  }

  async validate(dto: ValidateBillDto) {
    const category = BILL_CATEGORIES.find((c) => c.id === dto.categoryId);
    if (!category) throw new BadRequestException('Invalid bill category id');
    const payload = { ...dto, category: category.key };
    return { success: true, data: await this.xpresspay.validateBill(payload as any) };
  }

  async quote(userId: string, dto: BillQuoteDto) {
    const category = BILL_CATEGORIES.find((c) => c.id === dto.categoryId);
    if (!category) throw new BadRequestException('Invalid bill category id');
    if (dto.walletCurrency.toUpperCase() !== 'USDT') throw new BadRequestException('Only USDT wallet is supported for bills');
    const wallet = await this.prisma.wallet.findFirst({ where: { userId, currency: 'USDT' } });
    if (!wallet) throw new NotFoundException('USDT wallet not found');

    const usdtNgn = await this.ticker.getPrice('usdtngn');
    if (!usdtNgn || Number(usdtNgn) <= 0) throw new BadRequestException('Unable to fetch USDT/NGN rate');
    const billAmountNgn = dto.amount;
    const cryptoAmount = billAmountNgn / Number(usdtNgn);
    const feeAmount = cryptoAmount * PLATFORM_SPREAD;
    const totalToPay = cryptoAmount + feeAmount;
    const totalMinor = ConvertCurrency.toBase(totalToPay, 'USDT');
    if (BigInt(wallet.baseBalance.toFixed(0)) < totalMinor) throw new BadRequestException('Insufficient balance');

    const providerValidation = await this.xpresspay.validateBill({ ...dto, category: category.key } as any);

    const quoteId = uuidv4();
    const quote = { quoteId, userId, walletId: wallet.id, categoryId: category.id, category: category.key, billerCode: dto.billerCode, customerReference: dto.customerReference, productCode: dto.productCode, billAmountNgn, usdtNgnRate: Number(usdtNgn), cryptoAmount, feeAmount, totalToPay, totalMinor: totalMinor.toString(), providerValidation, expiresAt: Date.now() + BILL_QUOTE_TTL_SECONDS * 1000 };
    await this.tempStore.set(`${BILL_QUOTE_KEY_PREFIX}${quoteId}`, JSON.stringify(quote), BILL_QUOTE_TTL_SECONDS);

    return { success: true, message: 'Bill quote created', data: { quoteId, categoryId: category.id, amountToReceive: billAmountNgn, rate: `1 USDT ≈ ${Number(usdtNgn).toFixed(2)} NGN`, transactionFee: feeAmount.toFixed(6), amountToPay: totalToPay.toFixed(6), walletCurrency: 'USDT', expiresIn: BILL_QUOTE_TTL_SECONDS } };
  }

  async confirm(userId: string, dto: BillPaymentConfirmDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { pin: true } });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin))) throw new BadRequestException('Invalid pin');

    const raw = await this.tempStore.get(`${BILL_QUOTE_KEY_PREFIX}${dto.quoteId}`);
    if (!raw) throw new NotFoundException('Bill quote not found or expired');
    const quote: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (quote.userId !== userId) throw new BadRequestException('Invalid quote owner');

    const totalMinor = BigInt(quote.totalMinor);
    const feeMinor = ConvertCurrency.toBase(quote.feeAmount, 'USDT');

    const { transaction, billPayment } = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: quote.walletId } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      const current = BigInt(wallet.baseBalance.toFixed(0));
      if (current < totalMinor) throw new BadRequestException('Insufficient balance');

      const transaction = await tx.transaction.create({ data: {
        userId, transactionUniqueId: `BILL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        currency: 'USDT', cryptoAmountBase: totalMinor.toString(), cryptoAmountOriginal: String(quote.totalToPay),
        platformFeeBase: feeMinor.toString(), platformFeeOriginal: String(quote.feeAmount),
        status: 'PENDING' as any, transactionType: 'DEBIT' as any, transactionContext: TransactionContext.BILL_PAYMENT, paymentType: 'CRYPTO_WALLET' as any, senderWalletId: wallet.id,
        description: `Bill payment: ${quote.category}`,
      }});

      const billPayment = await tx.billPayment.create({ data: {
        userId, walletId: wallet.id, transactionId: transaction.id, category: quote.category, billerCode: quote.billerCode,
        customerReference: quote.customerReference, productCode: quote.productCode, walletCurrency: 'USDT', amountBase: totalMinor.toString(), amountOriginal: String(quote.totalToPay),
        status: 'PENDING', provider: 'xpresspay', providerValidation: quote.providerValidation,
      }});

      return { transaction, billPayment };
    });

    try {
      await this.prisma.$transaction([
        this.prisma.transaction.update({ where: { id: transaction.id }, data: {
          paymentMetadata: {
            billingFlow: true,
            billingStatus: 'WAITING_SELL_WEBHOOK',
            quoteId: dto.quoteId,
            category: quote.category,
            billerCode: quote.billerCode,
            customerReference: quote.customerReference,
            productCode: quote.productCode,
            billAmountNgn: quote.billAmountNgn,
          }
        } }),
        this.prisma.billPayment.update({ where: { id: billPayment.id }, data: { status: 'WAITING_SELL_WEBHOOK' } }),
      ]);
      await this.tempStore.del(`${BILL_QUOTE_KEY_PREFIX}${dto.quoteId}`);
      return { success: true, message: 'Bill sell order submitted. Awaiting Quidax webhook to complete billing.', data: { reference: transaction.transactionUniqueId } };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' as any } });
        await tx.billPayment.update({ where: { id: billPayment.id }, data: { status: 'FAILED' } });
      });
      throw new BadRequestException(error?.response?.data || 'Bill payment failed');
    }
  }
}
