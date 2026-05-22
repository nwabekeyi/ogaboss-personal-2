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
  updatedAt: string;
}

@Injectable()
export class CompanyLiquidityService {
  private readonly logger = new Logger(CompanyLiquidityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private verifyCurrency(currency: string) {
    const lower = currency.toLowerCase();
    if (!ALLOWED_CURRENCIES.has(lower)) {
      throw new BadRequestException(`Currency ${currency} is not supported`);
    }
    return lower;
  }

  private async getCache(currency: string): Promise<LiquidityCache | null> {
    return this.redisService.hGet<LiquidityCache>(
      COMPANY_LIQUIDITY_KEY,
      currency,
    );
  }

  private async setCache(
    currency: string,
    data: LiquidityCache,
  ): Promise<void> {
    try {
      await this.redisService.hSet(COMPANY_LIQUIDITY_KEY, currency, data);
    } catch (error) {
      this.logger.error(
        `Failed to set cache for ${currency}: ${error.message}`,
      );
    }
  }

  async getInternalBalance(currency: string): Promise<bigint> {
    const lower = this.verifyCurrency(currency);

    const cached = await this.getCache(lower);
    if (cached) {
      return toBigInt(cached.internalBalance);
    }

    const liquidity = await this.prisma.companyLiquidity.findUnique({
      where: { currency: lower },
      select: { internalBalance: true },
    });

    return liquidity ? toBigInt(liquidity.internalBalance) : 0n;
  }

  async syncAllToCache(): Promise<void> {
    const allLiquidity = await this.prisma.companyLiquidity.findMany();

    for (const item of allLiquidity) {
      const cacheData: LiquidityCache = {
        totalBalance: item.totalBalance.toString(),
        reservedBalance: item.reservedBalance.toString(),
        internalBalance: item.internalBalance.toString(),
        updatedAt: item.updatedAt.toISOString(),
      };
      await this.setCache(item.currency, cacheData);
    }

    this.logger.log(
      `Synced ${allLiquidity.length} liquidity records to Redis cache`,
    );
  }

  async syncInternalBalanceToCache(
    currency: string,
    amount: string,
    operation: 'add' | 'subtract',
  ): Promise<void> {
    try {
      let cached = await this.getCache(currency);

      if (!cached) {
        const liquidity = await this.prisma.companyLiquidity.findUnique({
          where: { currency },
        });

        if (liquidity) {
          cached = {
            totalBalance: liquidity.totalBalance.toString(),
            reservedBalance: liquidity.reservedBalance.toString(),
            internalBalance: liquidity.internalBalance.toString(),
            updatedAt: liquidity.updatedAt.toISOString(),
          };
        } else {
          this.logger.warn(
            `Cannot sync internal balance to cache: liquidity not found for ${currency}`,
          );
          return;
        }
      }

      const current = BigInt(cached.internalBalance);
      const change = BigInt(amount);
      const newValue =
        operation === 'add' ? current + change : current - change;

      await this.setCache(currency, {
        ...cached,
        internalBalance: newValue.toString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to sync internal balance to cache for ${currency}: ${error.message}`,
      );
    }
  }

  async reserveLiquidity(
    currency: string,
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx || this.prisma;
    const lower = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "reservedBalance" = "reservedBalance" + ${dec}
      WHERE currency = ${lower}
      AND ("totalBalance" - "reservedBalance") >= ${dec}
    `;

    const reserved = Number(result) > 0;
    if (!reserved) {
      this.logger.warn(`Insufficient company liquidity to reserve ${amount.toString()} ${lower}`);
    }

    return reserved;
  }

  async releaseLiquidity(
    currency: string,
    amount: LiquidityAmount,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    const lower = this.verifyCurrency(currency);
    const amountBigInt = toBigInt(amount);
    if (amountBigInt <= 0n) {
      this.logger.warn(
        `releaseLiquidity called with non-positive amount ${amountBigInt} for ${currency} — skipping`,
      );
      return;
    }
    const dec = toDecimal(amountBigInt);

    await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "reservedBalance" = "reservedBalance" - ${dec}
      WHERE currency = ${lower}
      AND "reservedBalance" >= ${dec}
    `;
  }

  async getAvailableLiquidity(
    currency: string,
    tx?: Prisma.TransactionClient,
  ): Promise<bigint> {
    const lower = this.verifyCurrency(currency);
    const client = tx || this.prisma;

    const liquidity = await client.companyLiquidity.findUnique({
      where: { currency: lower },
      select: {
        totalBalance: true,
        reservedBalance: true,
        totalLockedPrincipal: true,
        totalAccruedLockedInterest: true,
      },
    });

    if (!liquidity) {
      return 0n;
    }

    return (
      toBigInt(liquidity.totalBalance) -
      toBigInt(liquidity.reservedBalance) -
      toBigInt(liquidity.totalLockedPrincipal) -
      toBigInt(liquidity.totalAccruedLockedInterest || 0)
    );
  }

  async getTotalBalance(
    currency: string,
    tx?: Prisma.TransactionClient,
  ): Promise<bigint> {
    const lower = this.verifyCurrency(currency);
    const client = tx || this.prisma;

    const liquidity = await client.companyLiquidity.findUnique({
      where: { currency: lower },
      select: { totalBalance: true },
    });

    return liquidity ? toBigInt(liquidity.totalBalance) : 0n;
  }

  async isInternalBalanceExceeding(
    currency: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const lower = this.verifyCurrency(currency);
    const client = tx || this.prisma;

    const liquidity = await client.companyLiquidity.findUnique({
      where: { currency: lower },
      select: { totalBalance: true, internalBalance: true },
    });

    if (!liquidity) {
      return false;
    }

    return (
      toBigInt(liquidity.internalBalance) > toBigInt(liquidity.totalBalance)
    );
  }

  async addLiquidity(
    currency: string,
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    const lower = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    await client.$executeRaw`
      INSERT INTO "company_liquidity" (currency, "totalBalance", "reservedBalance", "createdAt", "updatedAt")
      VALUES (${lower}, ${dec}, 0, NOW(), NOW())
      ON CONFLICT (currency) DO UPDATE SET
        "totalBalance" = "company_liquidity"."totalBalance" + ${dec},
        "updatedAt" = NOW()
    `;
  }

  async reduceLiquidity(
    currency: string,
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx || this.prisma;
    const lower = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET "totalBalance" = "totalBalance" - ${dec}
      WHERE currency = ${lower}
      AND ("totalBalance" - "reservedBalance") >= ${dec}
    `;
    return Number(result) > 0;
  }

  async consumeReservedLiquidity(
    currency: string,
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx || this.prisma;
    const lower = this.verifyCurrency(currency);
    const dec = toDecimal(amount);

    const result = await client.$executeRaw`
      UPDATE "company_liquidity"
      SET
        "reservedBalance" = "reservedBalance" - ${dec},
        "totalBalance" = "totalBalance" - ${dec}
      WHERE currency = ${lower}
      AND "reservedBalance" >= ${dec}
      AND "totalBalance" >= ${dec}
    `;

    return Number(result) > 0;
  }

  async updateInternalBalance(
    currency: string,
    amount: Prisma.Decimal,
    operation: 'add' | 'subtract',
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    const lower = this.verifyCurrency(currency);

    if (operation === 'add') {
      await client.$executeRaw`
        UPDATE "company_liquidity"
        SET "internalBalance" = "internalBalance" + ${amount}, "updatedAt" = NOW()
        WHERE currency = ${lower}
      `;
    } else {
      await client.$executeRaw`
        UPDATE "company_liquidity"
        SET "internalBalance" = "internalBalance" - ${amount}, "updatedAt" = NOW()
        WHERE currency = ${lower}
        AND "internalBalance" >= ${amount}
      `;
    }

    await this.syncInternalBalanceToCache(lower, amount.toString(), operation);
  }
}
