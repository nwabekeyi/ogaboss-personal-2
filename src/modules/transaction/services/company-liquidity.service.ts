import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma, PrismaService, RedisService } from '../../../infrastructure';
import {
  ALLOWED_CURRENCIES,
  COMPANY_LIQUIDITY_KEY,
  toBigInt,
  toDecimal,
} from '../../../shared';

type LiquidityAmount = bigint | Prisma.Decimal | string | number;

interface LiquidityCache {
  totalBalance: string;
  reservedBalance: string;
  internalBalance: string;
  totalLockedPrincipal: string;
  totalAccruedLockedInterest: string;
  updatedAt: string;
}

@Injectable()
export class CompanyLiquidityService {
  private readonly logger = new Logger(CompanyLiquidityService.name);
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private verifyCurrency(currency: string) {
    const lower = currency.toLowerCase();
    if (!ALLOWED_CURRENCIES.has(lower)) {
      throw new BadRequestException(`Currency ${currency} is not supported`);
    }
    return lower.toUpperCase();
  }

  private async getCache(currency: string): Promise<LiquidityCache | null> {
    return this.redisService.hGet<LiquidityCache>(
      COMPANY_LIQUIDITY_KEY,
      currency.toUpperCase(),
    );
  }

  private async setCache(currency: string, data: LiquidityCache): Promise<void> {
    try {
      await this.redisService.hSet(
        COMPANY_LIQUIDITY_KEY,
        currency.toUpperCase(),
        data,
      );
      await this.redisService
        .getClient()
        .expire(COMPANY_LIQUIDITY_KEY, this.CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Failed to set cache for ${currency}: ${error.message}`);
    }
  }

  async getInternalBalance(currency: string): Promise<bigint> {
    const normalizedCurrency = this.verifyCurrency(currency);

    const cached = await this.getCache(normalizedCurrency);
    if (cached) return toBigInt(cached.internalBalance);

    const liquidity = await this.prisma.companyLiquidity.findFirst({
      where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
      select: { internalBalance: true },
    });

    if (liquidity) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
    return liquidity ? toBigInt(liquidity.internalBalance) : 0n;
  }

  async syncCurrencyToCache(currency: string): Promise<void> {
    const normalizedCurrency = this.verifyCurrency(currency);
    const liquidity = await this.prisma.companyLiquidity.findFirst({
      where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
    });
    if (!liquidity) return;

    await this.setCache(liquidity.currency, {
      totalBalance: liquidity.totalBalance.toString(),
      reservedBalance: liquidity.reservedBalance.toString(),
      internalBalance: liquidity.internalBalance.toString(),
      totalLockedPrincipal: liquidity.totalLockedPrincipal.toString(),
      totalAccruedLockedInterest: liquidity.totalAccruedLockedInterest.toString(),
      updatedAt: liquidity.updatedAt.toISOString(),
    });
  }

  async syncAllToCache(): Promise<void> {
    const allLiquidity = await this.prisma.companyLiquidity.findMany();

    for (const item of allLiquidity) {
      await this.setCache(item.currency, {
        totalBalance: item.totalBalance.toString(),
        reservedBalance: item.reservedBalance.toString(),
        internalBalance: item.internalBalance.toString(),
        totalLockedPrincipal: item.totalLockedPrincipal.toString(),
        totalAccruedLockedInterest: item.totalAccruedLockedInterest.toString(),
        updatedAt: item.updatedAt.toISOString(),
      });
    }

    this.logger.log(`Synced ${allLiquidity.length} liquidity records to Redis cache`);
  }

  async syncInternalBalanceToCache(currency: string, amount: string, operation: 'add' | 'subtract'): Promise<void> {
    try {
      const normalizedCurrency = this.verifyCurrency(currency);
      let cached = await this.getCache(normalizedCurrency);

      if (!cached) {
        const liquidity = await this.prisma.companyLiquidity.findFirst({
          where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
        });

        if (!liquidity) {
          this.logger.warn(`Cannot sync internal balance to cache: liquidity not found for ${normalizedCurrency}`);
          return;
        }

        cached = {
          totalBalance: liquidity.totalBalance.toString(),
          reservedBalance: liquidity.reservedBalance.toString(),
          internalBalance: liquidity.internalBalance.toString(),
          totalLockedPrincipal: liquidity.totalLockedPrincipal.toString(),
          totalAccruedLockedInterest: liquidity.totalAccruedLockedInterest.toString(),
          updatedAt: liquidity.updatedAt.toISOString(),
        };
      }

      const current = BigInt(cached.internalBalance);
      const change = BigInt(amount);
      const newValue = operation === 'add' ? current + change : current - change;

      await this.setCache(normalizedCurrency, {
        ...cached,
        internalBalance: newValue.toString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Failed to sync internal balance to cache for ${currency}: ${error.message}`);
    }
  }

  async reserveLiquidity(currency: string, amount: bigint, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx || this.prisma;
    const normalizedCurrency = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "reservedBalance" = "reservedBalance" + ${dec}
      WHERE LOWER(currency) = LOWER(${normalizedCurrency})
      AND ("totalBalance" - "reservedBalance") >= ${dec}
    `;

    const reserved = Number(result) > 0;
    if (!reserved) {
      this.logger.warn(`Insufficient company liquidity to reserve ${amount.toString()} ${normalizedCurrency}`);
    }

    if (reserved && !tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
    return reserved;
  }

  async releaseLiquidity(currency: string, amount: LiquidityAmount, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx || this.prisma;
    const normalizedCurrency = this.verifyCurrency(currency);
    const amountBigInt = toBigInt(amount);
    if (amountBigInt <= 0n) {
      this.logger.warn(`releaseLiquidity called with non-positive amount ${amountBigInt} for ${normalizedCurrency} — skipping`);
      return;
    }
    const dec = toDecimal(amountBigInt);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "reservedBalance" = "reservedBalance" - ${dec}
      WHERE LOWER(currency) = LOWER(${normalizedCurrency})
      AND "reservedBalance" >= ${dec}
    `;
    if (Number(result) === 0) {
      throw new BadRequestException('Reserved company liquidity inconsistency');
    }
    if (!tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
  }

  async getAvailableLiquidity(currency: string, tx?: Prisma.TransactionClient): Promise<bigint> {
    const normalizedCurrency = this.verifyCurrency(currency);
    if (!tx) {
      const cached = await this.getCache(normalizedCurrency);
      if (cached) {
        return (
          toBigInt(cached.totalBalance) -
          toBigInt(cached.reservedBalance) -
          toBigInt(cached.totalLockedPrincipal || 0) -
          toBigInt(cached.totalAccruedLockedInterest || 0)
        );
      }
    }

    const client = tx || this.prisma;

    const liquidity = await client.companyLiquidity.findFirst({
      where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
      select: {
        totalBalance: true,
        reservedBalance: true,
        totalLockedPrincipal: true,
        totalAccruedLockedInterest: true,
      },
    });

    if (!liquidity) return 0n;
    if (!tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);

    return (
      toBigInt(liquidity.totalBalance) -
      toBigInt(liquidity.reservedBalance) -
      toBigInt(liquidity.totalLockedPrincipal) -
      toBigInt(liquidity.totalAccruedLockedInterest || 0)
    );
  }

  async getTotalBalance(currency: string, tx?: Prisma.TransactionClient): Promise<bigint> {
    const normalizedCurrency = this.verifyCurrency(currency);
    if (!tx) {
      const cached = await this.getCache(normalizedCurrency);
      if (cached) return toBigInt(cached.totalBalance);
    }
    const client = tx || this.prisma;

    const liquidity = await client.companyLiquidity.findFirst({
      where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
      select: { totalBalance: true },
    });

    if (liquidity && !tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
    return liquidity ? toBigInt(liquidity.totalBalance) : 0n;
  }

  async isInternalBalanceExceeding(currency: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const normalizedCurrency = this.verifyCurrency(currency);
    const client = tx || this.prisma;

    const liquidity = await client.companyLiquidity.findFirst({
      where: { currency: { equals: normalizedCurrency, mode: 'insensitive' } },
      select: { totalBalance: true, internalBalance: true },
    });

    if (!liquidity) return false;

    return toBigInt(liquidity.internalBalance) > toBigInt(liquidity.totalBalance);
  }

  async addLiquidity(currency: string, amount: bigint, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx || this.prisma;
    const normalizedCurrency = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    await client.$executeRaw`
      INSERT INTO "company_liquidity" (currency, "totalBalance", "reservedBalance", "createdAt", "updatedAt")
      VALUES (${normalizedCurrency}, ${dec}, 0, NOW(), NOW())
      ON CONFLICT (currency) DO UPDATE SET
        "totalBalance" = "company_liquidity"."totalBalance" + ${dec},
        "updatedAt" = NOW()
    `;
    if (!tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
  }

  async reduceLiquidity(currency: string, amount: bigint, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx || this.prisma;
    const normalizedCurrency = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "totalBalance" = "totalBalance" - ${dec}
      WHERE LOWER(currency) = LOWER(${normalizedCurrency})
      AND ("totalBalance" - "reservedBalance") >= ${dec}
    `;

    const reduced = Number(result) > 0;
    if (reduced && !tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
    return reduced;
  }

  async consumeReservedLiquidity(currency: string, amount: bigint, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx || this.prisma;
    const normalizedCurrency = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "reservedBalance" = "reservedBalance" - ${dec},
          "totalBalance" = "totalBalance" - ${dec}
      WHERE LOWER(currency) = LOWER(${normalizedCurrency})
      AND "reservedBalance" >= ${dec}
      AND "totalBalance" >= ${dec}
    `;

    const consumed = Number(result) > 0;
    if (consumed && !tx) await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
    return consumed;
  }

  async updateInternalBalance(
    currency: string,
    amount: Prisma.Decimal,
    operation: 'add' | 'subtract',
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    const normalizedCurrency = this.verifyCurrency(currency);

    if (operation === 'add') {
      await client.$executeRaw`
        UPDATE "company_liquidity"
        SET "internalBalance" = "internalBalance" + ${amount}, "updatedAt" = NOW()
        WHERE LOWER(currency) = LOWER(${normalizedCurrency})
      `;
    } else {
      await client.$executeRaw`
        UPDATE "company_liquidity"
        SET "internalBalance" = "internalBalance" - ${amount}, "updatedAt" = NOW()
        WHERE LOWER(currency) = LOWER(${normalizedCurrency})
        AND "internalBalance" >= ${amount}
      `;
    }

    if (!tx) {
      await this.syncCurrencyToCache(normalizedCurrency).catch(() => undefined);
    }
  }
}
