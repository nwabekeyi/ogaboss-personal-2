import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import { Prisma, CryptoCurrencyCacheService } from '../../../../infrastructure';
import Decimal from 'decimal.js';
import {
  PatchCryptoDto,
  BulkPatchCryptoDto,
  CreateBufferTierDto,
} from '../../dto';
import {
  ConvertCurrency,
  CURRENCY_PRECISION,
  CryptoCurrency as CryptoCurrencyType,
  CryptoCurrency,
  CryptoNetwork,
} from '../../../../shared';

@Injectable()
export class CryptoBufferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoCache: CryptoCurrencyCacheService,
  ) {}

  private assertValidRange(
    min: Decimal | null,
    max: Decimal | null,
    context: string,
  ) {
    if (min && max && max.lessThan(min)) {
      throw new BadRequestException(
        `maxAmount cannot be lower than minAmount (${context})`,
      );
    }
  }

  private getFirstNetwork(currency: string): string {
    const networks =
      CURRENCY_PRECISION[currency.toLocaleLowerCase() as CryptoCurrencyType];
    if (!networks || networks.length === 0) {
      throw new BadRequestException(
        `No network defined for currency: ${currency}`,
      );
    }
    return networks[0].id;
  }

  async getCryptoBufferConfig(cryptoId: string) {
    const crypto = await this.cryptoCache.getById(cryptoId);

    if (!crypto) {
      throw new NotFoundException(`Cryptocurrency not found`);
    }

    const network = this.getFirstNetwork(crypto.symbol) as CryptoNetwork;

    return {
      success: true,
      message: 'Buffer configuration retrieved successfully',
      data: {
        cryptoId: crypto.id,
        symbol: crypto.symbol,
        name: crypto.name,
        logoUrl: crypto.logoUrl,
        description: crypto.description,
        defaultBufferPercent: crypto.defaultBufferPercent
          ? new Decimal(crypto.defaultBufferPercent).toNumber()
          : null,
        maxBufferPercent: crypto.maxBufferPercent
          ? new Decimal(crypto.maxBufferPercent).toNumber()
          : null,
        tiers: crypto.buffer_tiers.map((t) => ({
          id: t.id,
          orderType: t.orderType,
          minAmount: t.minAmount
            ? ConvertCurrency.fromBase(t.minAmount, crypto.symbol, network)
            : null,
          maxAmount: t.maxAmount
            ? ConvertCurrency.fromBase(t.maxAmount, crypto.symbol, network)
            : null,
          bufferPercent: new Decimal(t.bufferPercent).toNumber(),
        })),
      },
    };
  }

  async getAllCryptocurrencies(search?: string) {
    const cryptos = await this.cryptoCache.getAll();

    let filtered = cryptos;

    if (search) {
      const term = search.toLowerCase();
      filtered = cryptos.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.symbol.toLowerCase().includes(term),
      );
    }

    return {
      success: true,
      message: 'Cryptocurrencies retrieved successfully',
      data: filtered.map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        logoUrl: c.logoUrl,
        description: c.description,
        defaultBufferPercent: c.defaultBufferPercent,
        maxBufferPercent: c.maxBufferPercent,
      })),
    };
  }

  async createBufferTier(cryptoId: string, dto: CreateBufferTierDto) {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
    });
    if (!crypto) throw new NotFoundException(`Cryptocurrency not found`);

    if (
      dto.bufferPercent === undefined ||
      dto.bufferPercent < 0 ||
      dto.bufferPercent > 100
    ) {
      throw new BadRequestException('bufferPercent must be between 0 and 100');
    }

    const network = this.getFirstNetwork(crypto.symbol);

    const minAmount = ConvertCurrency.toBase(
      dto.minAmount,
      crypto.symbol,
      network as CryptoNetwork,
    );
    const maxAmount = ConvertCurrency.toBase(
      dto.maxAmount,
      crypto.symbol,
      network as CryptoNetwork,
    );

    this.assertValidRange(
      new Decimal(minAmount.toString()),
      new Decimal(maxAmount.toString()),
      'create buffer tier',
    );

    const existingTiers = await this.prisma.bufferTier.findMany({
      where: { cryptoId, orderType: dto.orderType ?? null },
    });
    for (const tier of existingTiers) {
      const tierMin = tier.minAmount
        ? new Decimal(tier.minAmount.toString())
        : null;
      const tierMax = tier.maxAmount
        ? new Decimal(tier.maxAmount.toString())
        : null;
      if (
        minAmount &&
        tierMax &&
        new Decimal(minAmount.toString()).lessThanOrEqualTo(tierMax) &&
        (!maxAmount ||
          new Decimal(maxAmount.toString()).greaterThanOrEqualTo(tierMin ?? 0))
      ) {
        throw new BadRequestException(
          'This buffer tier overlaps with an existing tier',
        );
      }
    }

    const bufferTier = await this.prisma.bufferTier.create({
      data: {
        cryptoId,
        orderType: dto.orderType ?? null,
        minAmount: minAmount.toString(),
        maxAmount: maxAmount.toString(),
        bufferPercent: new Decimal(dto.bufferPercent).toDecimalPlaces(
          2,
          Decimal.ROUND_UP,
        ),
      },
    });

    await this.cryptoCache.refreshCryptoCache(cryptoId);

    return {
      success: true,
      message: 'Buffer tier created successfully',
      data: {
        ...bufferTier,
        minAmount: bufferTier.minAmount
          ? ConvertCurrency.fromBase(
              bufferTier.minAmount,
              crypto.symbol,
              network as CryptoNetwork,
            )
          : null,
        maxAmount: bufferTier.maxAmount
          ? ConvertCurrency.fromBase(
              bufferTier.maxAmount,
              crypto.symbol,
              network as CryptoNetwork,
            )
          : null,
      },
    };
  }

  async patchCrypto(cryptoId: string, dto: PatchCryptoDto) {
    return this.prisma.$transaction(async (tx) => {
      const crypto = await tx.cryptoCurrency.findUnique({
        where: { id: cryptoId },
      });
      if (!crypto) throw new NotFoundException(`Cryptocurrency not found`);

      const cryptoUpdate: Prisma.CryptoCurrencyUpdateInput = {};

      if (dto.name !== undefined) cryptoUpdate.name = dto.name;

      if (dto.symbol !== undefined && dto.symbol !== crypto.symbol) {
        const existing = await tx.cryptoCurrency.findUnique({
          where: { symbol: dto.symbol },
        });
        if (existing)
          throw new ConflictException(`Symbol ${dto.symbol} already in use`);
        cryptoUpdate.symbol = dto.symbol;
      }

      if (dto.logoUrl !== undefined) cryptoUpdate.logoUrl = dto.logoUrl;
      if (dto.description !== undefined)
        cryptoUpdate.description = dto.description;

      if (dto.defaultBufferPercent !== undefined) {
        if (dto.defaultBufferPercent < 0 || dto.defaultBufferPercent > 50)
          throw new BadRequestException(
            'defaultBufferPercent must be between 0 and 50',
          );
        cryptoUpdate.defaultBufferPercent = new Decimal(
          dto.defaultBufferPercent,
        ).toDecimalPlaces(2, Decimal.ROUND_UP);
      }

      if (dto.maxBufferPercent !== undefined) {
        if (dto.maxBufferPercent < 0 || dto.maxBufferPercent > 100)
          throw new BadRequestException(
            'maxBufferPercent must be between 0 and 100',
          );
        cryptoUpdate.maxBufferPercent = new Decimal(
          dto.maxBufferPercent,
        ).toDecimalPlaces(2, Decimal.ROUND_UP);
      }

      const updatedCrypto =
        Object.keys(cryptoUpdate).length > 0
          ? await tx.cryptoCurrency.update({
              where: { id: cryptoId },
              data: cryptoUpdate,
            })
          : crypto;

      const updatedTiers: any[] = [];

      if (dto.tiers?.length) {
        const network = this.getFirstNetwork(crypto.symbol) as CryptoNetwork;

        for (const tierPatch of dto.tiers) {
          const { id, ...patch } = tierPatch;

          const existingTier = await tx.bufferTier.findUnique({
            where: { id },
          });
          if (!existingTier || existingTier.cryptoId !== cryptoId)
            throw new NotFoundException(
              `Buffer tier not found for this cryptocurrency`,
            );

          const resolvedMin = patch.minAmount
            ? ConvertCurrency.toBase(patch.minAmount, crypto.symbol, network)
            : existingTier.minAmount;

          const resolvedMax = patch.maxAmount
            ? ConvertCurrency.toBase(patch.maxAmount, crypto.symbol, network)
            : existingTier.maxAmount;

          this.assertValidRange(
            resolvedMin ? new Decimal(resolvedMin.toString()) : null,
            resolvedMax ? new Decimal(resolvedMax.toString()) : null,
            `patch tier ${id}`,
          );

          const tierUpdate: Prisma.BufferTierUpdateInput = {};

          if (patch.minAmount !== undefined)
            tierUpdate.minAmount = resolvedMin?.toString() ?? null;
          if (patch.maxAmount !== undefined)
            tierUpdate.maxAmount = resolvedMax?.toString() ?? null;

          if (patch.bufferPercent !== undefined) {
            if (patch.bufferPercent < 0 || patch.bufferPercent > 100)
              throw new BadRequestException(
                'bufferPercent must be between 0 and 100',
              );
            tierUpdate.bufferPercent = new Decimal(
              patch.bufferPercent,
            ).toDecimalPlaces(2, Decimal.ROUND_UP);
          }

          const updatedTier = await tx.bufferTier.update({
            where: { id },
            data: tierUpdate,
          });

          // Convert from BigInt to string for API response
          updatedTiers.push({
            ...updatedTier,
            minAmount: updatedTier.minAmount
              ? ConvertCurrency.fromBase(
                  updatedTier.minAmount,
                  crypto.symbol,
                  network,
                )
              : null,
            maxAmount: updatedTier.maxAmount
              ? ConvertCurrency.fromBase(
                  updatedTier.maxAmount,
                  crypto.symbol,
                  network,
                )
              : null,
          });
        }
      }

      await this.cryptoCache.refreshCryptoCache(cryptoId);

      return {
        success: true,
        message: 'Cryptocurrency updated successfully',
        data: {
          crypto: updatedCrypto,
          tiers: updatedTiers.length ? updatedTiers : undefined,
        },
      };
    });
  }

  async bulkPatchCryptos(dto: BulkPatchCryptoDto) {
    if (!dto.updates?.length) {
      throw new BadRequestException('No updates provided in bulk request');
    }

    const results: any[] = [];

    for (const item of dto.updates) {
      try {
        const result = await this.patchCrypto(item.cryptoId, item.patch);
        results.push({
          cryptoId: item.cryptoId,
          success: true,
          data: result.data,
        });
      } catch (err: any) {
        results.push({
          cryptoId: item.cryptoId,
          success: false,
          error: err.message || 'Unknown error during patch',
        });
      }
    }
    await this.cryptoCache.refreshAllCryptoCurrenciesCache();

    return {
      success: true,
      message: `Bulk patch processed (${results.length} items)`,
      data: results,
    };
  }

  async deleteBufferTier(cryptoId: string, tierId: string) {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
    });

    if (!crypto) {
      throw new NotFoundException(`Cryptocurrency not found`);
    }

    // Verify the tier exists and belongs to this crypto
    const tier = await this.prisma.bufferTier.findUnique({
      where: { id: tierId },
    });

    if (!tier || tier.cryptoId !== cryptoId) {
      throw new NotFoundException(
        `Buffer tier not found for this cryptocurrency`,
      );
    }

    // Delete the tier
    await this.prisma.bufferTier.delete({
      where: { id: tierId },
    });

    await this.cryptoCache.refreshCryptoCache(cryptoId);

    return {
      success: true,
      message: 'Buffer tier deleted successfully',
      data: { id: tierId },
    };
  }
}
