import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  UpdateUrgentLiquiditySettingsDto,
  CreateRepaymentRangeDto,
  UpdateRepaymentRangeDto,
  BulkRepaymentRangesDto,
} from '../../dto/urgent-liquidity-settings.dto';
import { isPrismaError } from '../../../../shared/utils/prisma-error.util';
import Decimal from 'decimal.js';
import { UrgentLiquiditySettingsCacheService } from '../../../../infrastructure/databases/redis/urgent-liquidity-cache.service';
import { BaseResponse, RepaymentRangeResponse, UrgentLiquidityDataResponse } from '../../types';


@Injectable()
export class UrgentLiquiditySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: UrgentLiquiditySettingsCacheService,
  ) {}

  async getSettings(): Promise<BaseResponse<UrgentLiquidityDataResponse>> {
    const cached = await this.cache.getSettings();
    if (!cached) {
      throw new NotFoundException(
        'Urgent liquidity settings not found. Please run the seed to initialize.',
      );
    }

    return {
      success: true,
      message: 'Urgent liquidity settings retrieved successfully',
      data: {
        settings: cached.settings,
        repaymentRanges: cached.repaymentRanges,
      },
    };
  }

  async getRepaymentRange(rangeId: string) {
    const range = await this.prisma.repaymentRange.findUnique({
      where: { id: rangeId },
    });

    if (!range) {
      throw new NotFoundException('Repayment range not found');
    }

    return {
      success: true,
      message: 'Repayment range retrieved successfully',
      data: {
        id: range.id,
        fromAmount: range.fromAmount.toString(),
        toAmount: range.toAmount.toString(),
        repaymentDurationDays: range.repaymentDurationDays,
        currency: range.currency,
        settingsId: range.settingsId,
        createdAt: range.createdAt,
        updatedAt: range.updatedAt,
      },
    };
  }

  async updateSettings(dto: UpdateUrgentLiquiditySettingsDto) {
    const settings = await this.prisma.urgentLiquiditySettings.findFirst();

    if (!settings) {
      throw new NotFoundException(
        'Urgent liquidity settings not found. Please run the seed to initialize.',
      );
    }

    const updateData: any = {};

    if (dto.maxLoanRequest !== undefined) {
      if (dto.maxLoanRequest < 0) {
        throw new BadRequestException('maxLoanRequest must be non-negative');
      }
      updateData.maxLoanRequest = new Decimal(dto.maxLoanRequest);
    }

    if (dto.loanFeePercent !== undefined) {
      if (dto.loanFeePercent < 0 || dto.loanFeePercent > 100) {
        throw new BadRequestException(
          'loanFeePercent must be between 0 and 100',
        );
      }
      updateData.loanFeePercent = new Decimal(
        dto.loanFeePercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    if (dto.settlementPercent !== undefined) {
      if (dto.settlementPercent < 0 || dto.settlementPercent > 100) {
        throw new BadRequestException(
          'settlementPercent must be between 0 and 100',
        );
      }
      updateData.settlementPercent = new Decimal(
        dto.settlementPercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    if (dto.collateralPercent !== undefined) {
      if (dto.collateralPercent < 0 || dto.collateralPercent > 100) {
        throw new BadRequestException(
          'collateralPercent must be between 0 and 100',
        );
      }
      updateData.collateralPercent = new Decimal(
        dto.collateralPercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    if (dto.liquidationDeadlineDays !== undefined) {
      if (dto.liquidationDeadlineDays < 1) {
        throw new BadRequestException(
          'liquidationDeadlineDays must be at least 1',
        );
      }
      updateData.liquidationDeadlineDays = dto.liquidationDeadlineDays;
    }

    if (dto.liquidationFeePercent !== undefined) {
      if (dto.liquidationFeePercent < 0 || dto.liquidationFeePercent > 100) {
        throw new BadRequestException(
          'liquidationFeePercent must be between 0 and 100',
        );
      }
      updateData.liquidationFeePercent = new Decimal(
        dto.liquidationFeePercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    const updated = await this.prisma.urgentLiquiditySettings.update({
      where: { id: settings.id },
      data: updateData,
    });

    await this.cache.refreshSettingsCache();

    return {
      success: true,
      message: 'Urgent liquidity settings updated successfully',
      data: {
        id: updated.id,
        maxLoanRequest: updated.maxLoanRequest.toString(),
        loanFeePercent: new Decimal(updated.loanFeePercent).toNumber(),
        settlementPercent: new Decimal(updated.settlementPercent).toNumber(),
        collateralPercent: new Decimal(updated.collateralPercent).toNumber(),
        liquidationDeadlineDays: updated.liquidationDeadlineDays,
        liquidationFeePercent: new Decimal(
          updated.liquidationFeePercent,
        ).toNumber(),
      },
    };
  }

  private async checkRangeOverlap(
    settingsId: string,
    fromAmount: Decimal,
    toAmount: Decimal,
    currency: string,
    excludeId?: string,
  ): Promise<void> {
    const ranges = await this.prisma.repaymentRange.findMany({
      where: {
        settingsId,
        currency,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    for (const range of ranges) {
      const existingFrom = new Decimal(range.fromAmount);
      const existingTo = new Decimal(range.toAmount);

      // Check if ranges overlap
      if (
        (fromAmount.gte(existingFrom) && fromAmount.lte(existingTo)) ||
        (toAmount.gte(existingFrom) && toAmount.lte(existingTo)) ||
        (fromAmount.lt(existingFrom) && toAmount.gt(existingTo))
      ) {
        throw new BadRequestException(
          `Repayment range overlaps with existing range (${existingFrom.toString()} - ${existingTo.toString()})`,
        );
      }
    }
  }

  private checkNewRangesOverlap(
    ranges: { fromDec: Decimal; toDec: Decimal; currency: string }[],
  ): void {
    const currencyGroups: Map<string, { fromDec: Decimal; toDec: Decimal }[]> =
      new Map();

    for (const range of ranges) {
      const existing = currencyGroups.get(range.currency) || [];
      existing.push({ fromDec: range.fromDec, toDec: range.toDec });
      currencyGroups.set(range.currency, existing);
    }

    for (const [, rangesList] of currencyGroups) {
      for (let i = 0; i < rangesList.length; i++) {
        for (let j = i + 1; j < rangesList.length; j++) {
          const a = rangesList[i];
          const b = rangesList[j];

          if (
            (a.fromDec.gte(b.fromDec) && a.fromDec.lte(b.toDec)) ||
            (a.toDec.gte(b.fromDec) && a.toDec.lte(b.toDec)) ||
            (a.fromDec.lt(b.fromDec) && a.toDec.gt(b.toDec))
          ) {
            throw new BadRequestException(
              `New repayment ranges have overlapping amounts: ${a.fromDec.toString()} - ${a.toDec.toString()} overlaps with ${b.fromDec.toString()} - ${b.toDec.toString()}`,
            );
          }
        }
      }
    }
  }

  async createRepaymentRange(dto: CreateRepaymentRangeDto): Promise<BaseResponse<RepaymentRangeResponse>> {
    const settings = await this.prisma.urgentLiquiditySettings.findFirst();

    if (!settings) {
      throw new NotFoundException(
        'Urgent liquidity settings not found. Please run the seed to initialize.',
      );
    }

    if (dto.fromAmount >= dto.toAmount) {
      throw new BadRequestException('from amount must be less than to amount');
    }

    const fromDec = new Decimal(dto.fromAmount);
    const toDec = new Decimal(dto.toAmount);
    const currency = dto.currency || 'NGN';

    await this.checkRangeOverlap(settings.id, fromDec, toDec, currency);

    try {
      const range = await this.prisma.repaymentRange.create({
        data: {
          settingsId: settings.id,
          fromAmount: fromDec,
          toAmount: toDec,
          repaymentDurationDays: dto.repaymentDurationDays,
          currency: currency.toUpperCase(),
        },
      });

      await this.cache.refreshRepaymentRangesCache();

      return {
        success: true,
        message: 'Repayment range created successfully',
        data: {
          id: range.id,
          fromAmount: range.fromAmount.toString(),
          toAmount: range.toAmount.toString(),
          repaymentDurationDays: range.repaymentDurationDays,
          currency: range.currency,
        },
      };
    } catch (err: any) {
      if (isPrismaError(err) && err.code === 'P2002') {
        throw new BadRequestException(
          `Repayment range already exists for currency ${currency.toUpperCase()} with this amount range`,
        );
      }
      throw err;
    }
  }

  async updateRepaymentRange(rangeId: string, dto: UpdateRepaymentRangeDto): Promise<BaseResponse<RepaymentRangeResponse>> {
    const existing = await this.prisma.repaymentRange.findUnique({
      where: { id: rangeId },
    });

    if (!existing) {
      throw new NotFoundException('Repayment range not found');
    }

    const fromDec =
      dto.fromAmount !== undefined
        ? new Decimal(dto.fromAmount)
        : new Decimal(existing.fromAmount);
    const toDec =
      dto.toAmount !== undefined
        ? new Decimal(dto.toAmount)
        : new Decimal(existing.toAmount);
    const currency = dto.currency?.toUpperCase() || existing.currency;

    if (
      dto.fromAmount !== undefined &&
      dto.toAmount !== undefined &&
      dto.fromAmount >= dto.toAmount
    ) {
      throw new BadRequestException('from amount must be less than to amount');
    }

    await this.checkRangeOverlap(
      existing.settingsId,
      fromDec,
      toDec,
      currency,
      rangeId,
    );

    const updateData: any = {};

    if (dto.fromAmount !== undefined) updateData.fromAmount = fromDec;
    if (dto.toAmount !== undefined) updateData.toAmount = toDec;
    if (dto.repaymentDurationDays !== undefined)
      updateData.repaymentDurationDays = dto.repaymentDurationDays;
    if (dto.currency !== undefined)
      updateData.currency = currency.toUpperCase();

    const updated = await this.prisma.repaymentRange.update({
      where: { id: rangeId },
      data: updateData,
    });

    await this.cache.refreshRepaymentRangesCache();

    return {
      success: true,
      message: 'Repayment range updated successfully',
      data: {
        id: updated.id,
        fromAmount: updated.fromAmount.toString(),
        toAmount: updated.toAmount.toString(),
        repaymentDurationDays: updated.repaymentDurationDays,
        currency: updated.currency,
      },
    };
  }

  async deleteRepaymentRange(rangeId: string): Promise<BaseResponse<{ id: string }>> {
    const existing = await this.prisma.repaymentRange.findUnique({
      where: { id: rangeId },
    });

    if (!existing) {
      throw new NotFoundException('Repayment range not found');
    }

    await this.prisma.repaymentRange.delete({
      where: { id: rangeId },
    });

    await this.cache.refreshRepaymentRangesCache();

    return {
      success: true,
      message: 'Repayment range deleted successfully',
      data: { id: rangeId },
    };
  }

  async bulkCreateRepaymentRanges(dto: BulkRepaymentRangesDto): Promise<BaseResponse<RepaymentRangeResponse[]>> {
    if (!dto.ranges?.length) {
      throw new BadRequestException('No ranges provided');
    }

    const settings = await this.prisma.urgentLiquiditySettings.findFirst();

    if (!settings) {
      throw new NotFoundException(
        'Urgent liquidity settings not found. Please run the seed to initialize.',
      );
    }

    // Validate all ranges first
    const validationErrors: {
      index: number;
      fromAmount: number;
      toAmount: number;
      error: string;
    }[] = [];
    const validatedRanges: {
      fromDec: Decimal;
      toDec: Decimal;
      currency: string;
      repaymentDurationDays: number;
    }[] = [];

    for (let i = 0; i < dto.ranges.length; i++) {
      const range = dto.ranges[i];

      if (range.fromAmount >= range.toAmount) {
        validationErrors.push({
          index: i,
          fromAmount: range.fromAmount,
          toAmount: range.toAmount,
          error: 'fromAmount must be less than toAmount',
        });
        continue;
      }

      const fromDec = new Decimal(range.fromAmount);
      const toDec = new Decimal(range.toAmount);
      const currency = (range.currency || 'NGN').toUpperCase();

      // Check for overlap with existing ranges
      try {
        await this.checkRangeOverlap(settings.id, fromDec, toDec, currency);
      } catch (err: any) {
        validationErrors.push({
          index: i,
          fromAmount: range.fromAmount,
          toAmount: range.toAmount,
          error: err.message,
        });
        continue;
      }

      validatedRanges.push({
        fromDec,
        toDec,
        currency,
        repaymentDurationDays: range.repaymentDurationDays,
      });
    }

    if (validationErrors.length > 0) {
      console.log(
        'Validation errors for bulk repayment ranges:',
        validationErrors,
      );
      throw new BadRequestException({
        message: `${validationErrors.length} range(s) failed validation. Please review the errors and try again.`,
        validationErrors,
      });
    }

    // Check for overlap among new ranges
    this.checkNewRangesOverlap(validatedRanges);

    // Use transaction for atomic bulk insert
    try {
      const created = await this.prisma.$transaction(
        validatedRanges.map((range) =>
          this.prisma.repaymentRange.create({
            data: {
              settingsId: settings.id,
              fromAmount: range.fromDec,
              toAmount: range.toDec,
              repaymentDurationDays: range.repaymentDurationDays,
              currency: range.currency,
            },
          }),
        ),
      );

      await this.cache.refreshRepaymentRangesCache();

      return {
        success: true,
        message: `${created.length} repayment ranges created successfully`,
        data: created.map((r) => ({
          id: r.id,
          fromAmount: r.fromAmount.toString(),
          toAmount: r.toAmount.toString(),
          repaymentDurationDays: r.repaymentDurationDays,
          currency: r.currency,
        })),
      };
    } catch (err: any) {
      if (isPrismaError(err) && err.code === 'P2002') {
        throw new BadRequestException(
          'One or more repayment ranges already exist. Please check for duplicates.',
        );
      }
      throw err;
    }
  }
}
