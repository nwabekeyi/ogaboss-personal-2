import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { XpresspayService } from '../../infrastructure/providers/xpresspay/xpresspay.service';
import { PayBillDto, ValidateBillDto } from './dto/bills.dto';
import { ConvertCurrency } from '../../shared/utils/currency-precision.util';

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpresspay: XpresspayService,
  ) {}

  async categories() {
    return { success: true, data: await this.xpresspay.getBillCategories() };
  }

  async billers(category: string) {
    return { success: true, data: await this.xpresspay.getBillers(category) };
  }

  async validate(dto: ValidateBillDto) {
    return { success: true, data: await this.xpresspay.validateBill(dto as any) };
  }

  async pay(userId: string, dto: PayBillDto) {
    const wallet = await this.prisma.wallet.findFirst({ where: { userId, currency: dto.walletCurrency.toUpperCase() } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const amountMinor = ConvertCurrency.toBase(dto.amount, dto.walletCurrency);

    const { transaction } = await this.prisma.$transaction(async (tx) => {
      const currentBalance = BigInt(wallet.baseBalance.toFixed(0));
      if (currentBalance < amountMinor) throw new BadRequestException('Insufficient balance');

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { baseBalance: (currentBalance - amountMinor).toString() },
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          transactionUniqueId: `BILL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          currency: dto.walletCurrency.toUpperCase(),
          cryptoAmountBase: amountMinor.toString(),
          cryptoAmountOriginal: dto.amount.toString(),
          status: 'PENDING' as any,
          transactionType: 'DEBIT' as any,
          transactionContext: 'TRANSFER' as any,
          paymentType: 'CRYPTO_WALLET' as any,
          senderWalletId: updatedWallet.id,
          description: `Bill payment: ${dto.category}`,
          paymentMetadata: {
            provider: 'xpresspay',
            billerCode: dto.billerCode,
            customerReference: dto.customerReference,
            productCode: dto.productCode,
          },
        },
      });

      return { transaction };
    });

    try {
      const providerResponse = await this.xpresspay.payBill({
        amount: dto.amount,
        category: dto.category,
        billerCode: dto.billerCode,
        customerReference: dto.customerReference,
        productCode: dto.productCode,
        reference: transaction.transactionUniqueId,
      });

      await this.prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'COMPLETED' as any, paymentMetadata: { ...(transaction.paymentMetadata as any), providerResponse } } });

      return { success: true, message: 'Bill payment successful', data: { reference: transaction.transactionUniqueId, providerResponse } };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const freshWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
        const balanceNow = BigInt(freshWallet?.baseBalance?.toFixed(0) || '0');
        await tx.wallet.update({ where: { id: wallet.id }, data: { baseBalance: (balanceNow + amountMinor).toString() } });
        await tx.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' as any } });
      });
      throw new BadRequestException(error?.response?.data || 'Bill payment failed');
    }
  }
}
