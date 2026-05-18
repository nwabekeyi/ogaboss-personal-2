import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  UpdateCryptoCurrencyRateDto,
  BulkUpdateCryptoCurrencyRateDto,
} from '../../dto/update-crypto-currency-rate.dto';
import { isPrismaError } from '../../../../shared/utils/prisma-error.util';
import Decimal from 'decimal.js';
import { CryptoCurrencyRateCacheService } from '../../../../infrastructure/databases/redis/crypto-currency-rate-cache.service';
import { BaseResponse, CryptoCurrencyRateResponse } from '../../types';


@Injectable()
export class CryptoCurrencyRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CryptoCurrencyRateCacheService,
  ) {}

  async getAllCryptoCurrencyRates(): Promise<BaseResponse<CryptoCurrencyRateResponse[]>> {
    const cached = await this.cache.getAll();
    if (cached) {
      return {
        success: true,
        message: 'Crypto interest rates retrieved successfully',
        data: cached,
      };
    }

    const cryptos = await this.prisma.cryptoCurrency.findMany({
      include: {
        rate: true,
      },
      orderBy: { symbol: 'asc' },
    });

    const mapped = cryptos.map((crypto) => ({
      cryptoId: crypto.id,
      symbol: crypto.symbol,
      name: crypto.name,
      interestRatePercent: crypto.rate?.dailyRatePercent
        ? new Decimal(crypto.rate.dailyRatePercent).toNumber()
        : 0,
      lockedFundsInterestRatePercent: crypto.rate?.lockedFundsRatePercent
        ? new Decimal(crypto.rate.lockedFundsRatePercent).toNumber()
        : 0,
    }));

    await this.cache.refreshAllCryptoRatesCache();

    return {
      success: true,
      message: 'Crypto interest rates retrieved successfully',
      data: mapped,
    };
  }

  async getCryptoCurrencyRate(cryptoId: string): Promise<BaseResponse<CryptoCurrencyRateResponse>> {
    const cached = await this.cache.getByCryptoId(cryptoId);
    if (cached) {
      return {
        success: true,
        message: 'Crypto interest rate retrieved successfully',
        data: cached,
      };
    }

    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
      include: {
        rate: true,
      },
    });

    if (!crypto) {
      throw new NotFoundException('Cryptocurrency not found');
    }

    const result = {
      cryptoId: crypto.id,
      symbol: crypto.symbol,
      name: crypto.name,
      interestRatePercent: crypto.rate?.dailyRatePercent
        ? new Decimal(crypto.rate.dailyRatePercent).toNumber()
        : 0,
      lockedFundsInterestRatePercent: crypto.rate?.lockedFundsRatePercent
        ? new Decimal(crypto.rate.lockedFundsRatePercent).toNumber()
        : 0,
    };

    await this.cache.refreshCryptoRateCache(cryptoId);

    return {
      success: true,
      message: 'Crypto interest rate retrieved successfully',
      data: result,
    };
  }

  async updateCryptoCurrencyRate(
    cryptoId: string,
    dto: UpdateCryptoCurrencyRateDto,
  ): Promise<BaseResponse<CryptoCurrencyRateResponse>> {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
    });

    if (!crypto) {
      throw new NotFoundException('Cryptocurrency not found');
    }

    const updateData: any = {};

    if (dto.interestRatePercent !== undefined) {
      if (dto.interestRatePercent < 0 || dto.interestRatePercent > 100) {
        throw new BadRequestException(
          'interestRatePercent must be between 0 and 100',
        );
      }
      updateData.dailyRatePercent = new Decimal(
        dto.interestRatePercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    if (dto.lockedFundsInterestRatePercent !== undefined) {
      if (
        dto.lockedFundsInterestRatePercent < 0 ||
        dto.lockedFundsInterestRatePercent > 100
      ) {
        throw new BadRequestException(
          'lockedFundsInterestRatePercent must be between 0 and 100',
        );
      }
      updateData.lockedFundsRatePercent = new Decimal(
        dto.lockedFundsInterestRatePercent,
      ).toDecimalPlaces(2, Decimal.ROUND_UP);
    }

    const existingRate = await this.prisma.cryptoCurrencyRate.findUnique({
      where: { cryptoCurrencyId: cryptoId },
    });

    let updatedRate;
    if (existingRate) {
      updatedRate = await this.prisma.cryptoCurrencyRate.update({
        where: { cryptoCurrencyId: cryptoId },
        data: updateData,
      });
    } else {
      updatedRate = await this.prisma.cryptoCurrencyRate.create({
        data: {
          cryptoCurrencyId: cryptoId,
          dailyRatePercent: updateData.dailyRatePercent ?? new Decimal(0),
          lockedFundsRatePercent:
            updateData.lockedFundsRatePercent ?? new Decimal(0),
        },
      });
    }

    await this.cache.refreshCryptoRateCache(cryptoId);

    return {
      success: true,
      message: 'Crypto interest rate updated successfully',
      data: {
        cryptoId: crypto.id,
        symbol: crypto.symbol,
        name: crypto.name,
        interestRatePercent: new Decimal(
          updatedRate.dailyRatePercent,
        ).toNumber(),
        lockedFundsInterestRatePercent: new Decimal(
          updatedRate.lockedFundsRatePercent,
        ).toNumber(),
      },
    };
  }

  async bulkUpdateCryptoCurrencyRates(dto: BulkUpdateCryptoCurrencyRateDto): Promise<BaseResponse<CryptoCurrencyRateResponse[]>> {
    if (!dto.updates?.length) {
      throw new BadRequestException('No updates provided in bulk request');
    }

    // Validate all updates first and collect errors
    const validationErrors: { cryptoId: string; error: string }[] = [];
    const validUpdates: {
      cryptoId: string;
      symbol: string;
      name: string;
      dailyRatePercent?: Decimal;
      lockedFundsRatePercent?: Decimal;
    }[] = [];

    for (const item of dto.updates) {
      const crypto = await this.prisma.cryptoCurrency.findUnique({
        where: { id: item.cryptoId },
      });

      if (!crypto) {
        validationErrors.push({
          cryptoId: item.cryptoId,
          error: 'Cryptocurrency not found',
        });
        continue;
      }

      const updateData: any = {};

      if (item.interestRatePercent !== undefined) {
        if (item.interestRatePercent < 0 || item.interestRatePercent > 100) {
          validationErrors.push({
            cryptoId: item.cryptoId,
            error: 'interestRatePercent must be between 0 and 100',
          });
          continue;
        }
        updateData.dailyRatePercent = new Decimal(
          item.interestRatePercent,
        ).toDecimalPlaces(2, Decimal.ROUND_UP);
      }

      if (item.lockedFundsInterestRatePercent !== undefined) {
        if (
          item.lockedFundsInterestRatePercent < 0 ||
          item.lockedFundsInterestRatePercent > 100
        ) {
          validationErrors.push({
            cryptoId: item.cryptoId,
            error: 'lockedFundsInterestRatePercent must be between 0 and 100',
          });
          continue;
        }
        updateData.lockedFundsRatePercent = new Decimal(
          item.lockedFundsInterestRatePercent,
        ).toDecimalPlaces(2, Decimal.ROUND_UP);
      }

      validUpdates.push({
        cryptoId: item.cryptoId,
        symbol: crypto.symbol,
        name: crypto.name,
        ...updateData,
      });
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed for some updates',
        validationErrors,
      });
    }

    // Use transaction for atomic bulk upsert
    try {
      const results = await this.prisma.$transaction(
        validUpdates.map((update) =>
          this.prisma.cryptoCurrencyRate.upsert({
            where: { cryptoCurrencyId: update.cryptoId },
            create: {
              cryptoCurrencyId: update.cryptoId,
              dailyRatePercent: update.dailyRatePercent ?? new Decimal(0),
              lockedFundsRatePercent:
                update.lockedFundsRatePercent ?? new Decimal(0),
            },
            update: {
              dailyRatePercent: update.dailyRatePercent,
              lockedFundsRatePercent: update.lockedFundsRatePercent,
            },
          }),
        ),
      );

      // Invalidate cache for all updated crypto IDs
      for (const update of validUpdates) {
        await this.cache.invalidateCryptoRateCache(update.cryptoId);
      }
      await this.cache.invalidateAllCryptoRatesCache();

      return {
        success: true,
        message: `${results.length} crypto interest rates updated successfully`,
        data: results.map((r, i) => ({
          cryptoId: validUpdates[i].cryptoId,
          symbol: validUpdates[i].symbol,
          name: validUpdates[i].name,
          interestRatePercent: new Decimal(r.dailyRatePercent).toNumber(),
          lockedFundsInterestRatePercent: new Decimal(
            r.lockedFundsRatePercent,
          ).toNumber(),
        })),
      };
    } catch (err: any) {
      if (isPrismaError(err)) {
        throw new BadRequestException(
          'Failed to update crypto interest rates. Please check for conflicts.',
        );
      }
      throw err;
    }
  }

  async initializeMissingRates() {
    const cryptos = await this.prisma.cryptoCurrency.findMany({
      include: {
        rate: true,
      },
    });

    const toCreate: { cryptoCurrencyId: string; symbol: string }[] = [];

    for (const crypto of cryptos) {
      if (!crypto.rate) {
        toCreate.push({
          cryptoCurrencyId: crypto.id,
          symbol: crypto.symbol,
        });
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.cryptoCurrencyRate.createMany({
        data: toCreate.map((item) => ({
          cryptoCurrencyId: item.cryptoCurrencyId,
          dailyRatePercent: new Decimal(0),
          lockedFundsRatePercent: new Decimal(0),
        })),
      });
    }

    await this.cache.refreshAllCryptoRatesCache();

    return {
      success: true,
      message: `Initialized ${toCreate.length} missing crypto interest rates`,
      data: {
        initialized: toCreate.length,
        symbols: toCreate.map((t) => t.symbol),
      },
    };
  }
}
