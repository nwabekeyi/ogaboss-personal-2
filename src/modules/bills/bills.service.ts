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
import { QuidaxOrderService } from '../../infrastructure/providers/quidax/order.service';
import { TransactionService, CompanyLiquidityService } from '../transaction/services';
import { BASE_CURRENCY, LiquidityReservationStatus } from '../../shared';
import { QUIDAX_COMPANY_USERID } from '../transaction/constants';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpresspay: XpresspayService,
    private readonly tempStore: TempStoreService,
    private readonly ticker: QuidaxTickerService,
    private readonly quidaxOrderService: QuidaxOrderService,
    private readonly transactionService: TransactionService,
    private readonly companyLiquidityService: CompanyLiquidityService,
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

      await this.transactionService.reserveBalance(tx, userId, 'USDT', totalMinor);
      const netFiatBase = ConvertCurrency.toBase(quote.billAmountNgn, 'NGN');
      const reserved = await this.companyLiquidityService.reserveLiquidity(BASE_CURRENCY, netFiatBase, tx);
      if (!reserved) throw new BadRequestException('Insufficient company NGN liquidity');

      const transaction = await tx.transaction.create({ data: {
        userId, transactionUniqueId: `BILL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        currency: 'USDT', cryptoAmountBase: totalMinor.toString(), cryptoAmountOriginal: String(quote.totalToPay),
        fiatAmountBase: netFiatBase.toString(),
        platformFeeBase: feeMinor.toString(), platformFeeOriginal: String(quote.feeAmount),
        status: 'PENDING' as any, transactionType: 'DEBIT' as any, transactionContext: TransactionContext.BILL_PAYMENT, paymentType: 'CRYPTO_WALLET' as any, senderWalletId: wallet.id,
        description: `Bill payment: ${quote.category}`,
        paymentMetadata: { liquidityReservationStatus: LiquidityReservationStatus.RESERVED },
      }});

      const billPayment = await tx.billPayment.create({ data: {
        userId, walletId: wallet.id, transactionId: transaction.id, category: quote.category, billerCode: quote.billerCode,
        customerReference: quote.customerReference, productCode: quote.productCode, walletCurrency: 'USDT', amountBase: totalMinor.toString(), amountOriginal: String(quote.totalToPay),
        status: 'PENDING', provider: 'xpresspay', providerValidation: quote.providerValidation,
      }});

      await tx.order.create({ data: {
        transactionId: transaction.id,
        userId,
        cryptoAmountBase: totalMinor.toString(),
        cryptoAmountOriginal: String(quote.totalToPay),
        fiatAmountBase: netFiatBase.toString(),
        fiatAmountOriginal: String(quote.billAmountNgn),
        fiatCurrency: 'NGN',
        status: 'PENDING' as any,
        type: 'SELL' as any,
        referenceNo: transaction.transactionUniqueId,
        paymentStatus: 'PENDING' as any,
        paymentAmountBase: netFiatBase.toString(),
        paymentAmountOriginal: String(quote.billAmountNgn),
      }});

      return { transaction, billPayment };
    });

    try {
      const orderResponse = await this.quidaxOrderService.buyOrSellOrderRequest(QUIDAX_COMPANY_USERID, { market: 'usdtngn', side: 'sell', ord_type: 'market', volume: Number(quote.cryptoAmount) } as any);
      if (orderResponse.status !== 'success') throw new BadRequestException('Something went wrong, try again later.');
      await this.prisma.$transaction([
        this.prisma.transaction.update({ where: { id: transaction.id }, data: {
          paymentMetadata: {
            billingFlow: true,
            billingStatus: 'PROCESSING',
            quoteId: dto.quoteId,
            category: quote.category,
            billerCode: quote.billerCode,
            customerReference: quote.customerReference,
            productCode: quote.productCode,
            billAmountNgn: quote.billAmountNgn,
            quidaxOrderReference: orderResponse.data.reference || orderResponse.data.id,
          }
        } }),
        this.prisma.billPayment.update({ where: { id: billPayment.id }, data: { status: 'PROCESSING' } }),
      ]);
      await this.tempStore.del(`${BILL_QUOTE_KEY_PREFIX}${dto.quoteId}`);
      return { success: true, message: 'Bill sell order submitted. Awaiting Quidax webhook to complete billing.', data: { reference: transaction.transactionUniqueId } };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await this.transactionService.releaseBalance(tx, userId, 'USDT', totalMinor);
        await this.companyLiquidityService.releaseLiquidity(BASE_CURRENCY, ConvertCurrency.toBase(quote.billAmountNgn, 'NGN'), tx);
        await tx.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' as any, paymentMetadata: { liquidityReservationStatus: LiquidityReservationStatus.RELEASED } as any } });
        await tx.billPayment.update({ where: { id: billPayment.id }, data: { status: 'FAILED' } });
      });
      throw new BadRequestException(error?.response?.data || 'Bill payment failed');
    }
  }
}
