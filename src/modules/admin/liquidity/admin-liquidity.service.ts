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

  async getFailedCompanyLiquidity(page = 1, limit = 20) {
    const safePage = page > 0 ? page : 1;
    const safeLimit = limit > 0 ? Math.min(limit, 100) : 20;

    const allRecords =
      await this.failedCompanyLiquidityService.getPending(1000);
    const total = allRecords.length;
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const start = (safePage - 1) * safeLimit;
    const data = allRecords.slice(start, start + safeLimit);

    return {
      success: true,
      data: data.map((item) => ({
        id: item.id,
        transactionId: item.transactionId,
        transactionUniqueId: item.Transaction?.transactionUniqueId,
        currency: item.currency,
        fromCurrency: item.fromCurrency,
        toCurrency: item.toCurrency,
        context: item.Transaction?.transactionContext,
        network: (item.Transaction as any)?.network || null,
        amount: this.fromBaseHuman(
          item.amountBase,
          item.currency,
          (item.Transaction as any)?.network,
        ),
        status: item.Transaction?.status,
        userId: item.Transaction?.userId,
        createdAt: item.createdAt,
      })),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
        hasNext: safePage < totalPages,
        hasPrev: safePage > 1,
      },
    };
  }

  async restartFailedCompanyLiquidity(id: string) {
    const result =
      await this.failedCompanyLiquidityService.activateAndProcess(id);

    return {
      success: result.activated,
      data: result,
      message: result.activated
        ? 'Failed company liquidity restarted successfully'
        : `Could not restart failed company liquidity: ${result.reason}`,
    };
  }

  private fromBaseHuman(
    amount: any,
    currency: string,
    network?: string | null,
  ): string {
    const code = currency.toLowerCase();

    return ConvertCurrency.fromBase(amount, code);
  }

  private formatLiquidity(liquidity: any) {
    const network = liquidity.network ?? null;
    return {
      ...liquidity,
      currency: liquidity.currency,
      totalBalance: this.fromBaseHuman(
        liquidity.totalBalance,
        liquidity.currency,
        network,
      ),
      reservedBalance: this.fromBaseHuman(
        liquidity.reservedBalance,
        liquidity.currency,
        network,
      ),
      internalBalance: this.fromBaseHuman(
        liquidity.internalBalance,
        liquidity.currency,
        network,
      ),
      totalLockedPrincipal: this.fromBaseHuman(
        liquidity.totalLockedPrincipal,
        liquidity.currency,
        network,
      ),
      totalAccruedLockedInterest: this.fromBaseHuman(
        liquidity.totalAccruedLockedInterest,
        liquidity.currency,
        network,
      ),
    };
  }
}
