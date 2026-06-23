import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { TempStoreService } from '../../../infrastructure/databases/redis';
import { UrgentLiquiditySettingsCacheService } from '../../../infrastructure/databases/redis/urgent-liquidity-cache.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxOrderService, QuidaxSwapService } from '../../../infrastructure/providers/quidax';
import { compareHash } from '../../../shared/services/hash';
import Decimal from 'decimal.js';
import { ConvertCurrency, CryptoNetwork } from '../../../shared';
import {
  UrgentLiquidityQuoteDto,
  UrgentLiquidityPreviewDto,
  UrgentLiquidityConfirmDto,
} from '../dto/urgent-liquidity.dto';
import {
  CryptoCurrency,
  UrgentLiquidityLoanStatus,
} from '../../../infrastructure/databases/prisma';
import { CompanyLiquidityService } from '../../../modules/transaction/services/company-liquidity.service';
import { QUIDAX_COMPANY_USERID } from '../../../modules/transaction/constants';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';

const URGENT_LIQUIDITY_QUOTE_TTL = 600;

@Injectable()
export class UrgentLiquidityService {
  private readonly logger = new Logger(UrgentLiquidityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tempStore: TempStoreService,
    private readonly cache: UrgentLiquiditySettingsCacheService,
    private readonly tickerService: QuidaxTickerService,
    private readonly quidaxOrderService: QuidaxOrderService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly queueService: QueueService,
  ) {}

  private toBase(amount: Decimal.Value, currency: string): bigint {
    return ConvertCurrency.toBase(new Decimal(amount).toString(), currency);
  }

  private fromBase(amount: unknown, currency: string): string {
    if (typeof amount === 'bigint') return ConvertCurrency.fromBase(amount, currency);
    if (amount && typeof (amount as any).toFixed === 'function') {
      return ConvertCurrency.fromBase(
        BigInt((amount as any).toFixed(0)),
        currency,
      );
    }
    return ConvertCurrency.fromBase(BigInt(String(amount || '0')), currency);
  }

  private userFacingStatus(
    status: UrgentLiquidityLoanStatus | string,
  ): UrgentLiquidityLoanStatus | string {
    if (
      status === UrgentLiquidityLoanStatus.QUIDAX_COMPLETED ||
      status === UrgentLiquidityLoanStatus.PAYSTACK_COMPLETED
    ) {
      return UrgentLiquidityLoanStatus.PENDING;
    }

    return status;
  }

  async quote(userId: string, dto: UrgentLiquidityQuoteDto) {
    const asset = await this.prisma.cryptoCurrency.findUnique({
      where: { id: dto.collateralAssetId },
      include: { rate: true },
    });
    if (!asset) throw new NotFoundException('Collateral asset not found');

    const symbol = asset.symbol.toUpperCase();
    const pair = `${symbol.toLowerCase()}ngn`;
    const tickerRate = symbol === 'NGN' ? '1' : await this.tickerService.getPrice(pair);
    if (!tickerRate) {
      throw new BadRequestException(`Unable to fetch ${symbol}/NGN conversion rate`);
    }

    const conversionRate = new Decimal(tickerRate);
    if (!conversionRate.isFinite() || conversionRate.lte(0)) {
      throw new BadRequestException(`Invalid conversion rate for ${symbol}`);
    }

    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currencyId: asset.id },
    });
    if (!wallet) throw new NotFoundException(`Wallet not found for ${symbol}`);

    const walletBalanceBase = BigInt(
      (wallet.baseBalance?.toFixed?.() ?? wallet.baseBalance?.toString?.() ?? '0'),
    );
    const walletBalanceOriginal = this.fromBase(walletBalanceBase, symbol);
    const walletValueNgn = new Decimal(walletBalanceOriginal).mul(conversionRate);
    const maxLoanNgn = walletValueNgn.mul(0.5);
    const hasSufficient = new Decimal(dto.loanAmount).lte(maxLoanNgn);

    if (!hasSufficient) {
      return {
        success: true,
        data: {
          quoteId: null,
          asset: symbol,
          assetId: asset.id,
          balance: walletBalanceOriginal,
          balanceValueNgn: walletValueNgn.toFixed(2),
          maxLoan: maxLoanNgn.toFixed(2),
          hasSufficientBalance: false,
          message: `Max loan allowed is ${maxLoanNgn.toFixed(2)} NGN (50% of ${symbol} value)`,
        },
      };
    }

    const quoteId = `urgent-liquidity:${crypto.randomUUID()}`;
    const collateralAmountOriginal = new Decimal(dto.loanAmount)
      .div(conversionRate)
      .toString();

    const quotePayload = {
      quoteId,
      userId,
      assetId: asset.id,
      asset: symbol,
      walletBalanceBase: walletBalanceBase.toString(),
      walletBalanceOriginal,
      loanAmount: dto.loanAmount,
      loanAmountBase: this.toBase(dto.loanAmount, 'NGN').toString(),
      maxLoan: maxLoanNgn.toFixed(2),
      hasSufficientBalance: true,
      collateralAmountOriginal,
      collateralAmountBase: this.toBase(collateralAmountOriginal, symbol).toString(),
      tickerRate: conversionRate.toString(),
      createdAt: Date.now(),
    };

    await this.tempStore.set(
      quoteId,
      JSON.stringify(quotePayload),
      URGENT_LIQUIDITY_QUOTE_TTL,
    );

    return {
      success: true,
      data: {
        quoteId,
        asset: symbol,
        assetId: asset.id,
        balance: walletBalanceOriginal,
        balanceValueNgn: walletValueNgn.toFixed(2),
        maxLoan: maxLoanNgn.toFixed(2),
        hasSufficientBalance: true,
      },
    };
  }

  async preview(userId: string, dto: UrgentLiquidityPreviewDto) {
    const quoteJson = await this.tempStore.get<Record<string, any>>(dto.quoteId);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');

    const quote = typeof quoteJson === 'string' ? JSON.parse(quoteJson) : quoteJson;
    if (quote.userId !== userId) {
      throw new BadRequestException('Quote does not belong to authenticated user');
    }

    const bankAccount = await this.prisma.userBankAccount.findFirst({
      where: { id: dto.bankAccountId, userId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');

    const settings = await this.cache.getSettings();
    if (!settings) {
      throw new NotFoundException(
        'Urgent liquidity settings not configured. Please contact support.',
      );
    }

    const loanAmount = new Decimal(quote.loanAmount);
    const loanFeePercent = new Decimal(settings.settings.loanFeePercent);
    const interestAmount = loanAmount.mul(loanFeePercent).div(100);
    const totalRepayable = loanAmount.plus(interestAmount);

    const repaymentRange = this.findRepaymentRange(
      settings.repaymentRanges,
      loanAmount.toNumber(),
    );
    const repaymentDurationDays = repaymentRange?.repaymentDurationDays ?? 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + repaymentDurationDays);

    const updatedQuote = {
      ...quote,
      bankAccountId: bankAccount.id,
      bankAccountName: bankAccount.bankAccountName,
      bankAccountNumber: bankAccount.bankAccountNumber,
      bankName: bankAccount.bankName,
      bankCode: bankAccount.bankCode,
      loanFeePercent: settings.settings.loanFeePercent,
      repaymentDurationDays,
      dueDate: dueDate.toISOString(),
    };

    await this.tempStore.set(
      dto.quoteId,
      JSON.stringify(updatedQuote),
      URGENT_LIQUIDITY_QUOTE_TTL,
    );

    return {
      success: true,
      data: {
        quoteId: quote.quoteId,
        asset: quote.asset,
        assetId: quote.assetId,
        balance: quote.walletBalanceOriginal,
        balanceValueNgn: new Decimal(quote.walletBalanceOriginal)
          .mul(new Decimal(quote.tickerRate))
          .toFixed(2),
        loanAmount: loanAmount.toFixed(2),
        interestRate: settings.settings.loanFeePercent,
        interestAmount: interestAmount.toFixed(2),
        totalRepayable: totalRepayable.toFixed(2),
        repaymentDurationDays,
        dueDate: dueDate.toISOString(),
        settlementPercent: settings.settings.settlementPercent,
        collateralPercent: settings.settings.collateralPercent,
        collateralAmountAsset: quote.collateralAmountOriginal,
        collateralAmountNgn: new Decimal(quote.collateralAmountOriginal)
          .mul(new Decimal(quote.tickerRate))
          .toFixed(2),
        depositAccount: {
          bankAccountId: bankAccount.id,
          bankName: bankAccount.bankName,
          accountName: bankAccount.bankAccountName,
          accountNumber: bankAccount.bankAccountNumber,
          bankCode: bankAccount.bankCode,
        },
      },
    };
  }

  async confirm(userId: string, dto: UrgentLiquidityConfirmDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pin: true },
    });
    if (!user?.pin || !(await compareHash(dto.pin, user.pin))) {
      throw new BadRequestException('Invalid PIN');
    }

    const quoteJson = await this.tempStore.get<Record<string, any>>(dto.quoteId);
    if (!quoteJson) throw new NotFoundException('Quote not found or expired');

    const quote = typeof quoteJson === 'string' ? JSON.parse(quoteJson) : quoteJson;
    if (quote.userId !== userId) {
      throw new BadRequestException('Quote does not belong to authenticated user');
    }

    const settings = await this.cache.getSettings();
    if (!settings) {
      throw new NotFoundException(
        'Urgent liquidity settings not configured. Please contact support.',
      );
    }

    const loanAmount = new Decimal(quote.loanAmount);
    const loanFeePercent = new Decimal(settings.settings.loanFeePercent);
    const interestAmount = loanAmount.mul(loanFeePercent).div(100);
    const totalRepayable = loanAmount.plus(interestAmount);

    const repaymentRange = this.findRepaymentRange(
      settings.repaymentRanges,
      loanAmount.toNumber(),
    );
    const repaymentDurationDays = repaymentRange?.repaymentDurationDays ?? 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + repaymentDurationDays);

    const bankAccount = await this.prisma.userBankAccount.findFirst({
      where: { id: quote.bankAccountId, userId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');

    const loan = await this.prisma.urgentLiquidityLoan.create({
      data: {
        userId,
        quoteId: quote.quoteId,
        collateralAssetId: quote.assetId,
        collateralAssetSymbol: quote.asset,
        walletBalance: quote.walletBalanceBase,
        walletBalanceOriginal: quote.walletBalanceOriginal,
        loanAmount: quote.loanAmountBase,
        loanAmountOriginal: quote.loanAmount,
        interestRate: loanFeePercent.toDecimalPlaces(2).toNumber(),
        interestAmount: this.toBase(interestAmount, 'NGN').toString(),
        interestAmountOriginal: interestAmount.toFixed(2),
        totalRepayable: this.toBase(totalRepayable, 'NGN').toString(),
        totalRepayableOriginal: totalRepayable.toFixed(2),
        repaymentDurationDays,
        dueDate,
        status: UrgentLiquidityLoanStatus.PENDING,
        settlementPercent: new Decimal(settings.settings.settlementPercent).toDecimalPlaces(2).toNumber(),
        collateralPercent: new Decimal(settings.settings.collateralPercent).toDecimalPlaces(2).toNumber(),
        collateralAmountAsset: quote.collateralAmountBase,
        collateralAmountOriginal: quote.collateralAmountOriginal,
        bankAccountId: bankAccount?.id ?? '',
        bankAccountName: bankAccount?.bankAccountName ?? '',
        bankAccountNumber: bankAccount?.bankAccountNumber ?? '',
        bankName: bankAccount?.bankName ?? '',
        bankCode: bankAccount?.bankCode ?? '',
        liquidityValue: this.toBase(
          new Decimal(quote.collateralAmountOriginal).mul(new Decimal(quote.tickerRate)),
          'NGN',
        ).toString(),
        liquidityValueOriginal: new Decimal(quote.collateralAmountOriginal)
          .mul(new Decimal(quote.tickerRate))
          .toFixed(2),
      },
    });

    try {
      const sellOrderResponse =
        await this.quidaxOrderService.buyOrSellOrderRequest(
          QUIDAX_COMPANY_USERID,
          {
            market: `${quote.asset.toLowerCase()}ngn` as any,
            side: 'sell',
            ord_type: 'market',
            volume: quote.collateralAmountOriginal,
          },
          { skipCircuitBreaker: true },
        );

      if (
        sellOrderResponse.status !== 'success' ||
        !sellOrderResponse.data?.id
      ) {
        throw new Error(
          sellOrderResponse.message || 'Quidax sell order placement failed',
        );
      }

      const loanReference = `urgent-liquidity-${crypto.randomUUID()}`;

      await this.prisma.urgentLiquidityLoan.update({
        where: { id: loan.id },
        data: {
          quidaxSwapId: sellOrderResponse.data.id,
          reference: loanReference,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Quidax sell order failed for loan ${loan.id}: ${error?.message}`,
      );
      await this.prisma.urgentLiquidityLoan.update({
        where: { id: loan.id },
        data: {
          status: UrgentLiquidityLoanStatus.FAILED,
          failureReason: `Collateral sell failed: ${error?.message}`,
        },
      });
      throw new BadRequestException(
        `Loan creation failed: collateral sell error — ${error?.message}`,
      );
    }

    await this.tempStore.del(dto.quoteId);

    return {
      success: true,
      message: 'Loan request submitted successfully',
      data: {
        id: loan.id,
        quoteId: loan.quoteId,
        status: this.userFacingStatus(loan.status),
        loanAmount: loan.loanAmountOriginal,
        interestRate: loan.interestRate,
        totalRepayable: loan.totalRepayableOriginal,
        dueDate: loan.dueDate,
        createdAt: loan.createdAt,
      },
    };
  }

  async overview(userId: string) {
    const result = await this.prisma.urgentLiquidityLoan.aggregate({
      where: { userId },
      _sum: { loanAmount: true },
    });

    return {
      success: true,
      data: {
        totalLoanRequests: this.fromBase(result._sum.loanAmount ?? 0n, 'NGN'),
        currency: 'NGN',
      },
    };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit || 20, 1), 50);
    const safePage = Math.max(page || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.prisma.urgentLiquidityLoan.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.urgentLiquidityLoan.count({ where: { userId } }),
    ]);

    return {
      success: true,
      data: {
        items: items.map((loan) => ({
          id: loan.id,
          loanAmount: loan.loanAmountOriginal,
          collateralAsset: loan.collateralAssetSymbol,
          collateralAmount: loan.collateralAmountOriginal,
          requestedOn: loan.createdAt,
          dueDate: loan.dueDate,
          status: this.userFacingStatus(loan.status),
          interestRate: loan.interestRate,
          totalRepayable: loan.totalRepayableOriginal,
          bankName: loan.bankName,
          accountNumber: loan.bankAccountNumber,
        })),
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      },
    };
  }

  private findRepaymentRange(
    ranges: { fromAmount: string; toAmount: string; repaymentDurationDays: number }[],
    amount: number,
  ) {
    for (const range of ranges) {
      const from = new Decimal(range.fromAmount);
      const to = new Decimal(range.toAmount);
      const amt = new Decimal(amount);
      if (amt.gte(from) && amt.lte(to)) {
        return range;
      }
    }
    return null;
  }
}
