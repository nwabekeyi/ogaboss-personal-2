import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayService } from '../../infrastructure/providers/xpresspay/xpresspay.service';
import { BillCategoryDto, BillPaymentConfirmDto, BillPaymentPreviewDto, ValidateBillDto } from './dto/bills.dto';
import { ConvertCurrency } from '../../shared/utils/currency-precision.util';
import { compareHash } from '../../shared/services/hash';
import { TransactionContext } from '../../infrastructure/databases/prisma';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService, private readonly xpresspay: XpresspayService) {}

  async categories() { return { success: true, data: await this.xpresspay.getBillCategories() }; }
  async billers(category: BillCategoryDto) { return { success: true, data: await this.xpresspay.getBillers(category) }; }
  async validate(dto: ValidateBillDto) { return { success: true, data: await this.xpresspay.validateBill(dto as any) }; }

  async preview(userId: string, dto: BillPaymentPreviewDto) {
    const wallet = await this.prisma.wallet.findFirst({ where: { userId, currency: dto.walletCurrency.toUpperCase() } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const amountMinor = ConvertCurrency.toBase(dto.amount, dto.walletCurrency);
    const currentBalance = BigInt(wallet.baseBalance.toFixed(0));
    if (currentBalance < amountMinor) throw new BadRequestException('Insufficient balance');

    const providerValidation = await this.xpresspay.validateBill(dto as any);

    const billPayment = await this.prisma.billPayment.create({
      data: {
        userId,
        walletId: wallet.id,
        category: dto.category,
        billerCode: dto.billerCode,
        customerReference: dto.customerReference,
        amountBase: amountMinor.toString(),
        amountOriginal: dto.amount.toString(),
        walletCurrency: dto.walletCurrency.toUpperCase(),
        productCode: dto.productCode,
        status: 'PENDING',
        provider: 'xpresspay',
        providerValidation,
      },
    });

    return { success: true, message: 'Bill preview created', data: { previewId: billPayment.id, amount: dto.amount, walletCurrency: dto.walletCurrency.toUpperCase(), providerValidation } };
  }

  async confirm(userId: string, dto: BillPaymentConfirmDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { pin: true } });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin))) throw new BadRequestException('Invalid pin');

    const preview = await this.prisma.billPayment.findFirst({ where: { id: dto.previewId, userId, status: 'PENDING' } });
    if (!preview) throw new NotFoundException('Bill preview not found');

    const amountMinor = BigInt(preview.amountBase.toFixed(0));

    const { transaction } = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: preview.walletId } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      const currentBalance = BigInt(wallet.baseBalance.toFixed(0));
      if (currentBalance < amountMinor) throw new BadRequestException('Insufficient balance');

      await tx.wallet.update({ where: { id: wallet.id }, data: { baseBalance: (currentBalance - amountMinor).toString() } });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          transactionUniqueId: `BILL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          currency: preview.walletCurrency,
          cryptoAmountBase: amountMinor.toString(),
          cryptoAmountOriginal: preview.amountOriginal,
          status: 'PENDING' as any,
          transactionType: 'DEBIT' as any,
          transactionContext: TransactionContext.BILL_PAYMENT,
          paymentType: 'CRYPTO_WALLET' as any,
          senderWalletId: wallet.id,
          description: `Bill payment: ${preview.category}`,
        },
      });

      await tx.billPayment.update({ where: { id: preview.id }, data: { transactionId: transaction.id } });
      return { transaction };
    });

    try {
      const providerResponse = await this.xpresspay.payBill({
        amount: Number(preview.amountOriginal),
        category: preview.category,
        billerCode: preview.billerCode,
        customerReference: preview.customerReference,
        productCode: preview.productCode,
        reference: transaction.transactionUniqueId,
      });

      await this.prisma.$transaction([
        this.prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'COMPLETED' as any, paymentMetadata: { provider: 'xpresspay', providerResponse } } }),
        this.prisma.billPayment.update({ where: { id: preview.id }, data: { status: 'COMPLETED', providerResponse } }),
      ]);

      return { success: true, message: 'Bill payment successful', data: { reference: transaction.transactionUniqueId, providerResponse } };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { id: preview.walletId } });
        const balanceNow = BigInt(wallet?.baseBalance?.toFixed(0) || '0');
        await tx.wallet.update({ where: { id: preview.walletId }, data: { baseBalance: (balanceNow + amountMinor).toString() } });
        await tx.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' as any } });
        await tx.billPayment.update({ where: { id: preview.id }, data: { status: 'FAILED' } });
      });
      throw new BadRequestException(error?.response?.data || 'Bill payment failed');
    }
  }
}
