import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  UpdateAutoStackingSettingsDto,
  CreateAutoStackingTransactionFeeDto,
  UpdateAutoStackingTransactionFeeDto,
  BulkAutoStackingTransactionFeesDto,
} from '../../dto/auto-stacking-settings.dto';
import { isPrismaError } from '../../../../shared/utils/prisma-error.util';
import Decimal from 'decimal.js';
import { AutoStackingSettingsCacheService } from '../../../../infrastructure/databases/redis/auto-stacking-cache.service';
import { AutoStackingSettingsDataResponse, AutoStackingSettingsResponse, AutoStackingTransactionFeeResponse, BaseResponse } from '../../types';


@Injectable()
export class AutoStackingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AutoStackingSettingsCacheService,
  ) {}

  async getSettings(): Promise<{ success: boolean; message: string; data: AutoStackingSettingsDataResponse }> {
    const cached = await this.cache.getSettings();
    if (!cached) {
      throw new NotFoundException(
        'Auto stacking settings not found. Please run the seed to initialize.',
      );
    }

    return {
      success: true,
      message: 'Auto stacking settings retrieved successfully',
      data: {
        settings: cached.settings,
        transactionFees: cached.transactionFees,
      },
    };
  }

  async updateSettings(dto: UpdateAutoStackingSettingsDto): Promise<{ success: boolean; message: string; data: AutoStackingSettingsResponse }> {
    const settings = await this.prisma.autoStackingSettings.findFirst();

    if (!settings) {
      throw new NotFoundException(
        'Auto stacking settings not found. Please run the seed to initialize.',
      );
    }

    const updateData: any = {};

    if (dto.dailyInterestRatePercent !== undefined) {
      if (
        dto.dailyInterestRatePercent < 0 ||
        dto.dailyInterestRatePercent > 100
      ) {
        throw new BadRequestException(
          'dailyInterestRatePercent must be between 0 and 100',
        );
      }
      updateData.dailyInterestRatePercent = new Decimal(
        dto.dailyInterestRatePercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    if (dto.currency !== undefined) {
      updateData.currency = dto.currency.toUpperCase();
    }

    const updated = await this.prisma.autoStackingSettings.update({
      where: { id: settings.id },
      data: updateData,
    });

    // Invalidate cache
    await this.cache.refreshSettingsCache();

    return {
      success: true,
      message: 'Auto stacking settings updated successfully',
      data: {
        id: updated.id,
        dailyInterestRatePercent: new Decimal(
          updated.dailyInterestRatePercent,
        ).toNumber(),
        currency: updated.currency,
      },
    };
  }

  private async checkFeeOverlap(
    fromAmount: Decimal,
    toAmount: Decimal,
    currency: string,
    excludeId?: string,
  ): Promise<void> {
    const fees = await this.prisma.autoStackingTransactionFee.findMany({
      where: {
        currency,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    for (const fee of fees) {
      const existingFrom = new Decimal(fee.fromAmount);
      const existingTo = new Decimal(fee.toAmount);

      if (
        (fromAmount.gte(existingFrom) && fromAmount.lte(existingTo)) ||
        (toAmount.gte(existingFrom) && toAmount.lte(existingTo)) ||
        (fromAmount.lt(existingFrom) && toAmount.gt(existingTo))
      ) {
        throw new BadRequestException(
          `Transaction fee range overlaps with existing range (${existingFrom.toString()} - ${existingTo.toString()})`,
        );
      }
    }
  }

  private checkNewFeesOverlap(
    fees: { fromDec: Decimal; toDec: Decimal; currency: string }[],
  ): void {
    const currencyGroups: Map<string, { fromDec: Decimal; toDec: Decimal }[]> =
      new Map();

    for (const fee of fees) {
      const existing = currencyGroups.get(fee.currency) || [];
      existing.push({ fromDec: fee.fromDec, toDec: fee.toDec });
      currencyGroups.set(fee.currency, existing);
    }

    for (const [, feesList] of currencyGroups) {
      for (let i = 0; i < feesList.length; i++) {
        for (let j = i + 1; j < feesList.length; j++) {
          const a = feesList[i];
          const b = feesList[j];

          if (
            (a.fromDec.gte(b.fromDec) && a.fromDec.lte(b.toDec)) ||
            (a.toDec.gte(b.fromDec) && a.toDec.lte(b.toDec)) ||
            (a.fromDec.lt(b.fromDec) && a.toDec.gt(b.toDec))
          ) {
            throw new BadRequestException(
              `New transaction fee ranges have overlapping amounts: ${a.fromDec.toString()} - ${a.toDec.toString()} overlaps with ${b.fromDec.toString()} - ${b.toDec.toString()}`,
            );
          }
        }
      }
    }
  }

  async createTransactionFee(dto: CreateAutoStackingTransactionFeeDto): Promise<BaseResponse<AutoStackingTransactionFeeResponse>> {
    if (dto.fromAmount >= dto.toAmount) {
      throw new BadRequestException('fromAmount must be less than toAmount');
    }

    const fromDec = new Decimal(dto.fromAmount);
    const toDec = new Decimal(dto.toAmount);
    const currency = (dto.currency || 'NGN').toUpperCase();
    const feeAmount = new Decimal(dto.feeAmount);
    const feeCurrency = (dto.feeCurrency || 'NGN').toUpperCase();

    await this.checkFeeOverlap(fromDec, toDec, currency);

    try {
      const fee = await this.prisma.autoStackingTransactionFee.create({
        data: {
          fromAmount: fromDec,
          toAmount: toDec,
          currency,
          feeAmount,
          feeCurrency,
        },
      });

      await this.cache.refreshTransactionFeesCache();

      return {
        success: true,
        message: 'Transaction fee created successfully',
        data: {
          id: fee.id,
          fromAmount: fee.fromAmount.toString(),
          toAmount: fee.toAmount.toString(),
          currency: fee.currency,
          feeAmount: fee.feeAmount.toString(),
          feeCurrency: fee.feeCurrency,
        },
      };
    } catch (err: any) {
      if (isPrismaError(err) && err.code === 'P2002') {
        throw new BadRequestException(
          `Transaction fee already exists for currency ${currency} with this amount range`,
        );
      }
      throw err;
    }
  }

  async updateTransactionFee(
    feeId: string,
    dto: UpdateAutoStackingTransactionFeeDto,
  ): Promise<BaseResponse<AutoStackingTransactionFeeResponse>> {
    const existing = await this.prisma.autoStackingTransactionFee.findUnique({
      where: { id: feeId },
    });

    if (!existing) {
      throw new NotFoundException('Transaction fee not found');
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
      throw new BadRequestException('fromAmount must be less than toAmount');
    }

    await this.checkFeeOverlap(fromDec, toDec, currency, feeId);

    const updateData: any = {};

    if (dto.fromAmount !== undefined) updateData.fromAmount = fromDec;
    if (dto.toAmount !== undefined) updateData.toAmount = toDec;
    if (dto.currency !== undefined) updateData.currency = currency;
    if (dto.feeAmount !== undefined)
      updateData.feeAmount = new Decimal(dto.feeAmount);
    if (dto.feeCurrency !== undefined)
      updateData.feeCurrency = dto.feeCurrency.toUpperCase();

    const updated = await this.prisma.autoStackingTransactionFee.update({
      where: { id: feeId },
      data: updateData,
    });

    await this.cache.refreshTransactionFeesCache();

    return {
      success: true,
      message: 'Transaction fee updated successfully',
      data: {
        id: updated.id,
        fromAmount: updated.fromAmount.toString(),
        toAmount: updated.toAmount.toString(),
        currency: updated.currency,
        feeAmount: updated.feeAmount.toString(),
        feeCurrency: updated.feeCurrency,
      },
    };
  }

  async deleteTransactionFee(feeId: string): Promise<BaseResponse<{ id: string }>> {
    const existing = await this.prisma.autoStackingTransactionFee.findUnique({
      where: { id: feeId },
    });

    if (!existing) {
      throw new NotFoundException('Transaction fee not found');
    }

    await this.prisma.autoStackingTransactionFee.delete({
      where: { id: feeId },
    });

    await this.cache.refreshTransactionFeesCache();

    return {
      success: true,
      message: 'Transaction fee deleted successfully',
      data: { id: feeId },
    };
  }

  async bulkCreateTransactionFees(dto: BulkAutoStackingTransactionFeesDto): Promise<BaseResponse<AutoStackingTransactionFeeResponse[]>> {
    if (!dto.fees?.length) {
      throw new BadRequestException('No fees provided');
    }

    const validationErrors: {
      index: number;
      fromAmount: number;
      toAmount: number;
      error: string;
    }[] = [];
    const validFees: {
      fromDec: Decimal;
      toDec: Decimal;
      currency: string;
      feeAmount: Decimal;
      feeCurrency: string;
    }[] = [];

    for (let i = 0; i < dto.fees.length; i++) {
      const fee = dto.fees[i];

      if (fee.fromAmount >= fee.toAmount) {
        validationErrors.push({
          index: i,
          fromAmount: fee.fromAmount,
          toAmount: fee.toAmount,
          error: 'fromAmount must be less than toAmount',
        });
        continue;
      }

      const fromDec = new Decimal(fee.fromAmount);
      const toDec = new Decimal(fee.toAmount);
      const currency = (fee.currency || 'NGN').toUpperCase();

      try {
        await this.checkFeeOverlap(fromDec, toDec, currency);
      } catch (err: any) {
        validationErrors.push({
          index: i,
          fromAmount: fee.fromAmount,
          toAmount: fee.toAmount,
          error: err.message,
        });
        continue;
      }

      validFees.push({
        fromDec,
        toDec,
        currency,
        feeAmount: new Decimal(fee.feeAmount),
        feeCurrency: (fee.feeCurrency || 'NGN').toUpperCase(),
      });
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed for some fees',
        validationErrors,
      });
    }

    this.checkNewFeesOverlap(validFees);

    try {
      const created = await this.prisma.$transaction(
        validFees.map((fee) =>
          this.prisma.autoStackingTransactionFee.create({
            data: {
              fromAmount: fee.fromDec,
              toAmount: fee.toDec,
              currency: fee.currency,
              feeAmount: fee.feeAmount,
              feeCurrency: fee.feeCurrency,
            },
          }),
        ),
      );

      await this.cache.refreshTransactionFeesCache();

      return {
        success: true,
        message: `${created.length} transaction fees created successfully`,
        data: created.map((f) => ({
          id: f.id,
          fromAmount: f.fromAmount.toString(),
          toAmount: f.toAmount.toString(),
          currency: f.currency,
          feeAmount: f.feeAmount.toString(),
          feeCurrency: f.feeCurrency,
        })),
      };
    } catch (err: any) {
      if (isPrismaError(err) && err.code === 'P2002') {
        throw new BadRequestException(
          'One or more transaction fees already exist. Please check for duplicates.',
        );
      }
      throw err;
    }
  }
}
