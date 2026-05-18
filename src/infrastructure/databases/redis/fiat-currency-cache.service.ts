import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';

interface CachedFiatCurrency {
  id: string;
  code: string;
  name: string;
  symbol?: string | null;
  usdRate: string;
}

@Injectable()
export class FiatCurrencyCacheService implements OnModuleInit {
  private readonly keyPrefix = 'fiatCurrency:';
  private readonly allKey = 'fiatCurrency:all';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /* ================= INIT ================= */

  async onModuleInit() {
    await this.refreshAllFiatCurrenciesCache();
  }

  /* ================= CORE GETTER WITH FALLBACK ================= */

  private async getWithFallback(
    code: string,
  ): Promise<CachedFiatCurrency | null> {
    const redisKey = `${this.keyPrefix}${code.toUpperCase()}`;

    const cached = await this.redisService.get<CachedFiatCurrency>(redisKey);
    if (cached) return cached;

    const fiat = await this.prisma.fiatCurrency.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!fiat) return null;

    const mapped: CachedFiatCurrency = {
      id: fiat.id,
      code: fiat.code,
      name: fiat.name,
      symbol: fiat.symbol,
      usdRate: fiat.usdRate,
    };

    await this.redisService.set(redisKey, mapped);

    return mapped;
  }

  /* ================= PUBLIC GETTERS ================= */

  async getByCode(code: string): Promise<CachedFiatCurrency | null> {
    return this.getWithFallback(code);
  }

  async getAll(): Promise<CachedFiatCurrency[]> {
    const cached = await this.redisService.get<CachedFiatCurrency[]>(
      this.allKey,
    );
    if (cached) return cached;

    const fiats = await this.prisma.fiatCurrency.findMany();

    const mapped = fiats.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      symbol: f.symbol,
      usdRate: f.usdRate,
    }));

    await this.redisService.set(this.allKey, mapped);

    return mapped;
  }

  /* ================= CACHE MUTATIONS ================= */

  async refreshFiatCurrencyCache(code: string) {
    const fiat = await this.prisma.fiatCurrency.findUnique({
      where: { code: code.toUpperCase() },
    });

    const redisKey = `${this.keyPrefix}${code.toUpperCase()}`;

    if (!fiat) {
      await this.redisService.del(redisKey);
      return;
    }

    const mapped: CachedFiatCurrency = {
      id: fiat.id,
      code: fiat.code,
      name: fiat.name,
      symbol: fiat.symbol,
      usdRate: fiat.usdRate,
    };

    await this.redisService.set(redisKey, mapped);
  }

  async refreshAllFiatCurrenciesCache() {
    const fiats = await this.prisma.fiatCurrency.findMany();

    const mapped = fiats.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      symbol: f.symbol,
      usdRate: f.usdRate,
    }));

    for (const fiat of mapped) {
      await this.redisService.set(`${this.keyPrefix}${fiat.code}`, fiat);
    }

    await this.redisService.set(this.allKey, mapped);
  }

  async deleteFiatCurrencyCache(code: string) {
    await this.redisService.del(`${this.keyPrefix}${code.toUpperCase()}`);
  }
}
