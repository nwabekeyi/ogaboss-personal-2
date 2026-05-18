import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';
import Decimal from 'decimal.js';
import { CachedCryptoCurrencyRate } from './type';

@Injectable()
export class CryptoCurrencyRateCacheService implements OnModuleInit {
  private readonly keyPrefix = 'cryptoRate:';
  private readonly allKey = 'cryptoRate:all';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.refreshAllCryptoRatesCache();
  }

  private async getWithFallback(
    cryptoId: string,
  ): Promise<CachedCryptoCurrencyRate | null> {
    const redisKey = `${this.keyPrefix}${cryptoId}`;

    const cached = await this.redisService.get<CachedCryptoCurrencyRate>(
      redisKey,
    );
    if (cached) return cached;

    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
      include: { rate: true },
    });

    if (!crypto) return null;

    const mapped: CachedCryptoCurrencyRate = {
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

    await this.redisService.set(redisKey, mapped);
    return mapped;
  }

  async getByCryptoId(cryptoId: string): Promise<CachedCryptoCurrencyRate | null> {
    return this.getWithFallback(cryptoId);
  }

  async getAll(): Promise<CachedCryptoCurrencyRate[]> {
    const cached = await this.redisService.get<CachedCryptoCurrencyRate[]>(
      this.allKey,
    );
    if (cached) return cached;

    const cryptos = await this.prisma.cryptoCurrency.findMany({
      include: { rate: true },
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

    await this.redisService.set(this.allKey, mapped);
    return mapped;
  }

  async refreshCryptoRateCache(cryptoId: string) {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
      include: { rate: true },
    });

    const redisKey = `${this.keyPrefix}${cryptoId}`;

    if (!crypto) {
      await this.redisService.del(redisKey);
      await this.refreshAllCryptoRatesCache();
      return;
    }

    const mapped: CachedCryptoCurrencyRate = {
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

    await this.redisService.set(redisKey, mapped);
    await this.refreshAllCryptoRatesCache();
  }

  async refreshAllCryptoRatesCache() {
    const cryptos = await this.prisma.cryptoCurrency.findMany({
      include: { rate: true },
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

    for (const rate of mapped) {
      await this.redisService.set(`${this.keyPrefix}${rate.cryptoId}`, rate);
    }

    await this.redisService.set(this.allKey, mapped);
  }

  async invalidateCryptoRateCache(cryptoId: string) {
    await this.redisService.del(`${this.keyPrefix}${cryptoId}`);
  }

  async invalidateAllCryptoRatesCache() {
    await this.redisService.del(this.allKey);
  }
}
