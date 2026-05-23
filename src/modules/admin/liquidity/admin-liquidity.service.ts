import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';
import { FailedCompanyLiquidityService } from '../../transaction/services';
import { ConvertCurrency } from '../../../shared';

@Injectable()
export class AdminLiquidityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly failedCompanyLiquidityService: FailedCompanyLiquidityService,
  ) {}

  async getCompanyLiquidityByCurrency(currency: string) {
    const normalizedCurrency = currency.toUpperCase();

    const liquidity = await this.prisma.companyLiquidity.findFirst({
      where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
    });

    if (!liquidity) {
      return {
        success: true,
        data: null,
        message: `No company liquidity found for ${normalizedCurrency}`,
      };
    }

    return {
      success: true,
      data: this.formatLiquidity(liquidity),
    };
  }

  async getAllCompanyLiquidity() {
    const records = await this.prisma.companyLiquidity.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return {
      success: true,
      data: records.map((record) => this.formatLiquidity(record)),
      count: records.length,
    };
  }

  async getFailedCompanyLiquidity(limit = 100) {
    const records = await this.failedCompanyLiquidityService.getPending(limit);

    return {
      success: true,
      data: records.map((item) => ({
        id: item.id,
        transactionId: item.transactionId,
        transactionUniqueId: item.Transaction?.transactionUniqueId,
        currency: item.currency,
        fromCurrency: item.fromCurrency,
        toCurrency: item.toCurrency,
        context: item.Transaction?.transactionContext,
        amount: ConvertCurrency.fromBase(item.amountBase, item.currency),
        status: item.Transaction?.status,
        userId: item.Transaction?.userId,
        createdAt: item.createdAt,
      })),
      count: records.length,
    };
  }

  async restartFailedCompanyLiquidity(id: string) {
    const result = await this.failedCompanyLiquidityService.activateAndProcess(id);

    return {
      success: result.activated,
      data: result,
      message: result.activated
        ? 'Failed company liquidity restarted successfully'
        : `Could not restart failed company liquidity: ${result.reason}`,
    };
  }

  private formatLiquidity(liquidity: any) {
    return {
      ...liquidity,
      currency: liquidity.currency,
      totalBalance: ConvertCurrency.fromBase(liquidity.totalBalance, liquidity.currency),
      reservedBalance: ConvertCurrency.fromBase(liquidity.reservedBalance, liquidity.currency),
      internalBalance: ConvertCurrency.fromBase(liquidity.internalBalance, liquidity.currency),
      totalLockedPrincipal: ConvertCurrency.fromBase(
        liquidity.totalLockedPrincipal,
        liquidity.currency,
      ),
      totalAccruedLockedInterest: ConvertCurrency.fromBase(
        liquidity.totalAccruedLockedInterest,
        liquidity.currency,
      ),
    };
  }
}
