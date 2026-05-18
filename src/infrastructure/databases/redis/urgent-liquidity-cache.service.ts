import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';
import Decimal from 'decimal.js';
import { CachedUrgentLiquidityData, CachedUrgentLiquiditySettings } from './type';


@Injectable()
export class UrgentLiquiditySettingsCacheService implements OnModuleInit {
  private readonly keyPrefix = 'urgentLiquidity:';
  private readonly settingsKey = 'urgentLiquidity:settings';
  private readonly allKey = 'urgentLiquidity:all';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.refreshUrgentLiquidityCache();
  }

  private async getWithFallback(): Promise<CachedUrgentLiquidityData | null> {
    const cached = await this.redisService.get<CachedUrgentLiquidityData>(
      this.allKey,
    );
    if (cached) return cached;

    const settings = await this.prisma.urgentLiquiditySettings.findFirst();
    if (!settings) return null;

    const ranges = await this.prisma.repaymentRange.findMany({
      where: { settingsId: settings.id },
      orderBy: { fromAmount: 'asc' },
    });

    const mapped: CachedUrgentLiquidityData = {
      settings: {
        id: settings.id,
        maxLoanRequest: settings.maxLoanRequest.toString(),
        loanFeePercent: new Decimal(settings.loanFeePercent).toNumber(),
        settlementPercent: new Decimal(settings.settlementPercent).toNumber(),
        collateralPercent: new Decimal(settings.collateralPercent).toNumber(),
        liquidationDeadlineDays: settings.liquidationDeadlineDays,
        liquidationFeePercent: new Decimal(
          settings.liquidationFeePercent,
        ).toNumber(),
      },
      repaymentRanges: ranges.map((r) => ({
        id: r.id,
        fromAmount: r.fromAmount.toString(),
        toAmount: r.toAmount.toString(),
        repaymentDurationDays: r.repaymentDurationDays,
        currency: r.currency,
      })),
    };

    await this.redisService.set(this.allKey, mapped);
    return mapped;
  }

  async getSettings(): Promise<CachedUrgentLiquidityData | null> {
    return this.getWithFallback();
  }

  async getSettingsOnly(): Promise<CachedUrgentLiquiditySettings | null> {
    const cached = await this.redisService.get<CachedUrgentLiquiditySettings>(
      this.settingsKey,
    );
    if (cached) return cached;

    const settings = await this.prisma.urgentLiquiditySettings.findFirst();
    if (!settings) return null;

    const mapped: CachedUrgentLiquiditySettings = {
      id: settings.id,
      maxLoanRequest: settings.maxLoanRequest.toString(),
      loanFeePercent: new Decimal(settings.loanFeePercent).toNumber(),
      settlementPercent: new Decimal(settings.settlementPercent).toNumber(),
      collateralPercent: new Decimal(settings.collateralPercent).toNumber(),
      liquidationDeadlineDays: settings.liquidationDeadlineDays,
      liquidationFeePercent: new Decimal(
        settings.liquidationFeePercent,
      ).toNumber(),
    };

    await this.redisService.set(this.settingsKey, mapped);
    return mapped;
  }

  async refreshUrgentLiquidityCache() {
    const settings = await this.prisma.urgentLiquiditySettings.findFirst();
    if (!settings) return;

    const ranges = await this.prisma.repaymentRange.findMany({
      where: { settingsId: settings.id },
      orderBy: { fromAmount: 'asc' },
    });

    const mapped: CachedUrgentLiquidityData = {
      settings: {
        id: settings.id,
        maxLoanRequest: settings.maxLoanRequest.toString(),
        loanFeePercent: new Decimal(settings.loanFeePercent).toNumber(),
        settlementPercent: new Decimal(settings.settlementPercent).toNumber(),
        collateralPercent: new Decimal(settings.collateralPercent).toNumber(),
        liquidationDeadlineDays: settings.liquidationDeadlineDays,
        liquidationFeePercent: new Decimal(
          settings.liquidationFeePercent,
        ).toNumber(),
      },
      repaymentRanges: ranges.map((r) => ({
        id: r.id,
        fromAmount: r.fromAmount.toString(),
        toAmount: r.toAmount.toString(),
        repaymentDurationDays: r.repaymentDurationDays,
        currency: r.currency,
      })),
    };

    await this.redisService.set(this.allKey, mapped);
    await this.redisService.set(this.settingsKey, mapped.settings);
  }

  async refreshSettingsCache() {
    const settings = await this.prisma.urgentLiquiditySettings.findFirst();
    if (!settings) {
      await this.redisService.del(this.settingsKey);
      return;
    }

    const mapped: CachedUrgentLiquiditySettings = {
      id: settings.id,
      maxLoanRequest: settings.maxLoanRequest.toString(),
      loanFeePercent: new Decimal(settings.loanFeePercent).toNumber(),
      settlementPercent: new Decimal(settings.settlementPercent).toNumber(),
      collateralPercent: new Decimal(settings.collateralPercent).toNumber(),
      liquidationDeadlineDays: settings.liquidationDeadlineDays,
      liquidationFeePercent: new Decimal(
        settings.liquidationFeePercent,
      ).toNumber(),
    };

    await this.redisService.set(this.settingsKey, mapped);
  }

  async refreshRepaymentRangesCache() {
    const ranges = await this.prisma.repaymentRange.findMany({
      orderBy: { fromAmount: 'asc' },
    });

    const mappedRanges = ranges.map((r) => ({
      id: r.id,
      fromAmount: r.fromAmount.toString(),
      toAmount: r.toAmount.toString(),
      repaymentDurationDays: r.repaymentDurationDays,
      currency: r.currency,
    }));

    const current = await this.redisService.get<CachedUrgentLiquidityData>(
      this.allKey,
    );
    if (current) {
      const updated = { ...current, repaymentRanges: mappedRanges };
      await this.redisService.set(this.allKey, updated);
    } else {
      await this.refreshUrgentLiquidityCache();
    }
  }

  async invalidateUrgentLiquidityCache() {
    await this.redisService.del(this.allKey);
    await this.redisService.del(this.settingsKey);
  }
}
