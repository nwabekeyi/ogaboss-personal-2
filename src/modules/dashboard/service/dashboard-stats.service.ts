import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/databases/redis/redis.service';
import { PrismaService } from '../../../infrastructure/databases/prisma/prisma.service';
import { Status, TransactionStatus } from '../../../infrastructure';
import { randomUUID } from 'crypto';
import {
  TransactionFormatter,
  ConvertCurrency,
  CryptoNetwork,
  BASE_CURRENCY,
} from '../../../shared';

const META_KEY = 'dashboard:stats:meta';
const RECENT_KEY = 'dashboard:stats:recent';
const LOCK_KEY = 'dashboard:stats:lock';

@Injectable()
export class DashboardStatsService implements OnModuleInit {
  private readonly logger = new Logger(DashboardStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.computeAndCacheStats();
  }

  // ======================================================
  // DISTRIBUTED LOCK
  // ======================================================
  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const redis = this.redis.getClient();
    const lockId = randomUUID();
    const lockExpire = 5000;

    const acquired = await redis.set(LOCK_KEY, lockId, 'PX', lockExpire, 'NX');
    if (!acquired) return null;

    try {
      return await fn();
    } finally {
      const current = await redis.get(LOCK_KEY);
      if (current === lockId) {
        await redis.del(LOCK_KEY);
      }
    }
  }

  // ======================================================
  // HANDLERS (called only by worker)
  // ======================================================
  async handleTransactionUpdate(transaction: any) {
    const redis = this.redis.getClient();

    try {
      const amountKobo: bigint = transaction.nairaAmountBase ?? 0n;

      const now = new Date();
      const txnDate = new Date(transaction.createdAt);
      const isToday =
        txnDate.getFullYear() === now.getFullYear() &&
        txnDate.getMonth() === now.getMonth() &&
        txnDate.getDate() === now.getDate();

      await this.withLock(async () => {
        const meta = await redis.hgetall(META_KEY);

        // Convert stored Naira string back to kobo bigint
        let totalValueKobo = 0n;
        if (meta.totalValue && typeof meta.totalValue === 'string') {
          try {
            totalValueKobo = ConvertCurrency.toBase(
              meta.totalValue,
              BASE_CURRENCY,
            );
          } catch (e) {
            this.logger.error(
              `Failed to parse totalValue from Redis: ${meta.totalValue}`,
              e,
            );
            totalValueKobo = 0n;
          }
        }

        let dailyValueKobo = 0n;
        if (meta.dailyValue && typeof meta.dailyValue === 'string') {
          try {
            dailyValueKobo = ConvertCurrency.toBase(
              meta.dailyValue,
              BASE_CURRENCY,
            );
          } catch (e) {
            this.logger.error(
              `Failed to parse dailyValue from Redis: ${meta.dailyValue}`,
              e,
            );
            dailyValueKobo = 0n;
          }
        }
        const totalVolume = Number(meta.totalVolume ?? 0);
        const dailyVolume = Number(meta.dailyVolume ?? 0);

        // Add transaction in kobo
        const newTotalValueKobo = totalValueKobo + amountKobo;
        const newDailyValueKobo = isToday
          ? dailyValueKobo + amountKobo
          : dailyValueKobo;
        const newTotalVolume = totalVolume + 1;
        const newDailyVolume = isToday ? dailyVolume + 1 : dailyVolume;

        // Convert back to Naira string for Redis display
        const newTotalValue = ConvertCurrency.fromBase(
          BigInt(newTotalValueKobo),
          BASE_CURRENCY,
        );
        const newDailyValue = ConvertCurrency.fromBase(
          BigInt(newDailyValueKobo),
          BASE_CURRENCY,
        );

        await redis.hset(META_KEY, {
          totalValue: newTotalValue,
          dailyValue: newDailyValue,
          totalVolume: newTotalVolume.toString(),
          dailyVolume: newDailyVolume.toString(),
          updatedAt: new Date().toISOString(),
        });

        // Recent transactions (display only)
        const formatted = TransactionFormatter.format({
          ...transaction,
          user: transaction.user,
        });

        await redis.lpush(RECENT_KEY, JSON.stringify(formatted));
        await redis.ltrim(RECENT_KEY, 0, 4);
      });
    } catch (err) {
      this.logger.error('Failed to update dashboard from transaction job', err);
      throw err;
    }
  }

  async handleUserUpdate(payload: {
    added: boolean;
    createdAt?: string;
    status?: Status;
  }) {
    await this.withLock(async () => {
      try {
        const redis = this.redis.getClient();
        const meta = await redis.hgetall(META_KEY);

        if (Object.keys(meta).length === 0) {
          await this.computeAndCacheStats();
          return;
        }

        let totalUsers = Number(meta.totalUsers || 0);
        let usersThisMonth = Number(meta.usersThisMonth || 0);

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const userCreatedAt = payload.createdAt
          ? new Date(payload.createdAt)
          : null;
        const isThisMonth = userCreatedAt
          ? userCreatedAt >= startOfMonth
          : false;
        const isActive = payload.status === Status.ACTIVE;

        if (payload.added) {
          if (isActive) {
            totalUsers += 1;
            if (isThisMonth) usersThisMonth += 1;
          }
        } else {
          if (isActive || payload.status == null) {
            totalUsers -= 1;
            if (isThisMonth) usersThisMonth -= 1;
          }
        }

        totalUsers = Math.max(0, totalUsers);
        usersThisMonth = Math.max(0, usersThisMonth);

        await redis.hset(META_KEY, {
          totalUsers,
          usersThisMonth,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.error('Failed to update user stats', err);
        throw err;
      }
    });
  }

  // ======================================================
  // FULL REBUILD (SAFE + LOCKED)
  // ======================================================
  async computeAndCacheStats() {
    await this.withLock(async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [
          totalAgg,
          dailyAgg,
          dailyCount,
          totalVolume,
          recentTransactions,
          totalUsers,
          usersThisMonth,
        ] = await Promise.all([
          this.prisma.$queryRaw<[{ total: string }]>`
            SELECT COALESCE(CAST(SUM(CAST("fiatAmountBase" AS numeric)) AS VARCHAR), '0') as total 
            FROM "transactions" 
            WHERE "status" = 'COMPLETED'
          `,
          this.prisma.$queryRaw<[{ total: string }]>`
            SELECT COALESCE(CAST(SUM(CAST("fiatAmountBase" AS numeric)) AS VARCHAR), '0') as total 
            FROM "transactions" 
            WHERE "status" = 'COMPLETED' AND "createdAt" >= ${today}
          `,
          this.prisma.transaction.count({
            where: {
              status: TransactionStatus.COMPLETED,
              createdAt: { gte: today },
            },
          }),
          this.prisma.transaction.count({
            where: { status: TransactionStatus.COMPLETED },
          }),
          this.prisma.transaction.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            where: { status: TransactionStatus.COMPLETED },
            include: { User: { select: { firstName: true, lastName: true } } },
          }),
          this.prisma.user.count({ where: { status: Status.ACTIVE } }),
          this.prisma.user.count({
            where: { createdAt: { gte: startOfMonth }, status: Status.ACTIVE },
          }),
        ]);

        const redis = this.redis.getClient();
        const pipeline = redis.multi();

        pipeline.del(META_KEY);
        pipeline.del(RECENT_KEY);

        const totalValueKobo = totalAgg[0]?.total
          ? BigInt(totalAgg[0].total)
          : 0n;
        const dailyValueKobo = dailyAgg[0]?.total
          ? BigInt(dailyAgg[0].total)
          : 0n;

        pipeline.hset(META_KEY, {
          totalValue: ConvertCurrency.fromBase(totalValueKobo, BASE_CURRENCY),
          dailyValue: ConvertCurrency.fromBase(dailyValueKobo, BASE_CURRENCY),
          totalVolume: totalVolume.toString(),
          dailyVolume: dailyCount.toString(),
          totalUsers,
          usersThisMonth,
          updatedAt: new Date().toISOString(),
        });

        for (const t of recentTransactions) {
          pipeline.rpush(
            RECENT_KEY,
            JSON.stringify({
              id: t.id,
              accountName:
                `${t.User?.firstName || ''} ${t.User?.lastName || ''}`.trim(),
              date: t.createdAt,
              status: t.status,
              cryptoAmount: t.cryptoAmountBase
                ? ConvertCurrency.fromBase(
                    t.cryptoAmountBase,
                    t.currency,
                    t.network as CryptoNetwork,
                  )
                : 'N/A',
              fiatAmount: t.fiatAmountBase
                ? ConvertCurrency.fromBase(t.fiatAmountBase, BASE_CURRENCY)
                : '0',
              cryptocurrency: t.currency,
              walletAddress: t.senderWalletAddress || t.receiverWalletAddress,
            }),
          );
        }

        await pipeline.exec();
      } catch (err) {
        this.logger.error('Failed to rebuild dashboard stats', err);
      }
    });
  }

  // ======================================================
  // READ API (FAST)
  // ======================================================
  async getCachedStats() {
    const redis = this.redis.getClient();

    const [meta, recent] = await Promise.all([
      redis.hgetall(META_KEY),
      redis.lrange(RECENT_KEY, 0, 4),
    ]);

    if (!meta || Object.keys(meta).length === 0) {
      await this.computeAndCacheStats();
      return this.getCachedStats();
    }

    return {
      totalTransactionValue: {
        amount: Number(meta.totalValue || 0),
        dailyCount: Number(meta.dailyValue || 0),
      },
      totalTransactionVolume: {
        count: Number(meta.totalVolume || 0),
        dailyCount: Number(meta.dailyVolume || 0),
      },
      totalUsers: {
        count: Number(meta.totalUsers || 0),
        currentMonth: Number(meta.usersThisMonth || 0),
      },
      recentTransactions: recent.map((r) => JSON.parse(r)),
      updatedAt: meta.updatedAt,
    };
  }
}
