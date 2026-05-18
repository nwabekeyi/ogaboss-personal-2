import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';
import { CachedCryptoCurrency } from './type';

@Injectable()
export class CryptoCurrencyCacheService implements OnModuleInit {
  private readonly keyPrefix = 'cryptoCurrency:';
  private readonly allKey = 'cryptoCurrency:all';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /* ================= INIT ================= */

  async onModuleInit() {
    await this.refreshAllCryptoCurrenciesCache();
  }

  /* ================= CORE GETTER WITH FALLBACK ================= */

  private async getWithFallback(
    symbol: string,
  ): Promise<CachedCryptoCurrency | null> {
    const redisKey = `${this.keyPrefix}${symbol.toUpperCase()}`;

    const cached = await this.redisService.get<CachedCryptoCurrency>(redisKey);
    if (cached) return cached;

    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { symbol: symbol.toUpperCase() },
      include: { buffer_tiers: true },
    });

    if (!crypto) return null;

    const mapped: CachedCryptoCurrency = {
      id: crypto.id,
      name: crypto.name,
      symbol: crypto.symbol,
      logoUrl: crypto.logoUrl,
      description: crypto.description,
      defaultBufferPercent: crypto.defaultBufferPercent,
      maxBufferPercent: crypto.maxBufferPercent,
      buffer_tiers: crypto.buffer_tiers.map((bt) => ({
        ...bt,
        minAmount: bt.minAmount?.toString() ?? null,
        maxAmount: bt.maxAmount?.toString() ?? null,
      })),
    };

    await this.redisService.set(redisKey, mapped);

    return mapped;
  }

  /* ================= PUBLIC GETTERS ================= */

  async getBySymbol(symbol: string): Promise<CachedCryptoCurrency | null> {
    return this.getWithFallback(symbol);
  }

  async getAll(): Promise<CachedCryptoCurrency[]> {
    const cached = await this.redisService.get<CachedCryptoCurrency[]>(
      this.allKey,
    );
    if (cached) return cached;

    const cryptos = await this.prisma.cryptoCurrency.findMany({
      include: { buffer_tiers: true },
    });

    // Map to string for BigInt fields
    const mappedCryptos = cryptos.map((c) => ({
      ...c,
      buffer_tiers: c.buffer_tiers.map((bt) => ({
        ...bt,
        minAmount: bt.minAmount?.toString() ?? null,
        maxAmount: bt.maxAmount?.toString() ?? null,
      })),
    }));

    await this.redisService.set(this.allKey, mappedCryptos);

    return mappedCryptos;
  }

  async getById(id: string): Promise<CachedCryptoCurrency | null> {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id },
    });

    if (!crypto) return null;

    return this.getBySymbol(crypto.symbol);
  }

  async refreshCryptoCache(cryptoId: string) {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { id: cryptoId },
      include: { buffer_tiers: true },
    });

    const redisKey = `${this.keyPrefix}${cryptoId}`;

    if (!crypto) {
      await this.redisService.del(redisKey);
      await this.refreshAllCryptoCurrenciesCache();
      return;
    }

    const mapped = this.mapToCache(crypto);

    await this.redisService.set(redisKey, mapped);

    await this.refreshAllCryptoCurrenciesCache();
  }

  private mapToCache(crypto: any): CachedCryptoCurrency {
    return {
      id: crypto.id,
      name: crypto.name,
      symbol: crypto.symbol,
      logoUrl: crypto.logoUrl,
      description: crypto.description,
      defaultBufferPercent: crypto.defaultBufferPercent,
      maxBufferPercent: crypto.maxBufferPercent,
      buffer_tiers: crypto.buffer_tiers.map((tier) => ({
        id: tier.id,
        cryptoId: tier.cryptoId,
        orderType: tier.orderType,
        minAmount: tier.minAmount,
        maxAmount: tier.maxAmount,
        bufferPercent: tier.bufferPercent,
      })),
    };
  }

  /* ================= CACHE MUTATIONS ================= */

  async refreshCryptoCurrencyCache(symbol: string) {
    const crypto = await this.prisma.cryptoCurrency.findUnique({
      where: { symbol: symbol.toUpperCase() },
      include: { buffer_tiers: true },
    });

    const redisKey = `${this.keyPrefix}${symbol.toUpperCase()}`;

    if (!crypto) {
      await this.redisService.del(redisKey);
      return;
    }

    await this.redisService.set(redisKey, crypto);
  }

  async refreshAllCryptoCurrenciesCache() {
    const cryptos = await this.prisma.cryptoCurrency.findMany({
      include: { buffer_tiers: true },
    });

    for (const crypto of cryptos) {
      await this.redisService.set(`${this.keyPrefix}${crypto.symbol}`, crypto);
    }

    await this.redisService.set(this.allKey, cryptos);
  }

  async deleteCryptoCurrencyCache(symbol: string) {
    await this.redisService.del(`${this.keyPrefix}${symbol.toUpperCase()}`);
  }
}
