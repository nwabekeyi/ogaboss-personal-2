import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { RedisService } from './redis.service';
import Decimal from 'decimal.js';
import { CachedAutoStackingData, CachedAutoStackingSettings } from './type';



@Injectable()
export class AutoStackingSettingsCacheService implements OnModuleInit {
  private readonly keyPrefix = 'autoStacking:';
  private readonly settingsKey = 'autoStacking:settings';
  private readonly allKey = 'autoStacking:all';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.refreshAutoStackingCache();
  }

  private async getWithFallback(): Promise<CachedAutoStackingData | null> {
    const cached = await this.redisService.get<CachedAutoStackingData>(
      this.allKey,
    );
    if (cached) return cached;

    const settings = await this.prisma.autoStackingSettings.findFirst();
    if (!settings) return null;

    const fees = await this.prisma.autoStackingTransactionFee.findMany({
      orderBy: { fromAmount: 'asc' },
    });

    const mapped: CachedAutoStackingData = {
      settings: {
        id: settings.id,
        dailyInterestRatePercent: new Decimal(
          settings.dailyInterestRatePercent,
        ).toNumber(),
        currency: settings.currency,
      },
      transactionFees: fees.map((f) => ({
        id: f.id,
        fromAmount: f.fromAmount.toString(),
        toAmount: f.toAmount.toString(),
        currency: f.currency,
        feeAmount: f.feeAmount.toString(),
        feeCurrency: f.feeCurrency,
      })),
    };

    await this.redisService.set(this.allKey, mapped);
    return mapped;
  }

  async getSettings(): Promise<CachedAutoStackingData | null> {
    return this.getWithFallback();
  }

  async getSettingsOnly(): Promise<CachedAutoStackingSettings | null> {
    const cached = await this.redisService.get<CachedAutoStackingSettings>(
      this.settingsKey,
    );
    if (cached) return cached;

    const settings = await this.prisma.autoStackingSettings.findFirst();
    if (!settings) return null;

    const mapped: CachedAutoStackingSettings = {
      id: settings.id,
      dailyInterestRatePercent: new Decimal(
        settings.dailyInterestRatePercent,
      ).toNumber(),
      currency: settings.currency,
    };

    await this.redisService.set(this.settingsKey, mapped);
    return mapped;
  }

  async refreshAutoStackingCache() {
    const settings = await this.prisma.autoStackingSettings.findFirst();
    if (!settings) return;

    const fees = await this.prisma.autoStackingTransactionFee.findMany({
      orderBy: { fromAmount: 'asc' },
    });

    const mapped: CachedAutoStackingData = {
      settings: {
        id: settings.id,
        dailyInterestRatePercent: new Decimal(
          settings.dailyInterestRatePercent,
        ).toNumber(),
        currency: settings.currency,
      },
      transactionFees: fees.map((f) => ({
        id: f.id,
        fromAmount: f.fromAmount.toString(),
        toAmount: f.toAmount.toString(),
        currency: f.currency,
        feeAmount: f.feeAmount.toString(),
        feeCurrency: f.feeCurrency,
      })),
    };

    await this.redisService.set(this.allKey, mapped);
    await this.redisService.set(this.settingsKey, mapped.settings);
  }

  async refreshSettingsCache() {
    const settings = await this.prisma.autoStackingSettings.findFirst();
    if (!settings) {
      await this.redisService.del(this.settingsKey);
      return;
    }

    const mapped: CachedAutoStackingSettings = {
      id: settings.id,
      dailyInterestRatePercent: new Decimal(
        settings.dailyInterestRatePercent,
      ).toNumber(),
      currency: settings.currency,
    };

    await this.redisService.set(this.settingsKey, mapped);
  }

  async refreshTransactionFeesCache() {
    const fees = await this.prisma.autoStackingTransactionFee.findMany({
      orderBy: { fromAmount: 'asc' },
    });

    const mappedFees = fees.map((f) => ({
      id: f.id,
      fromAmount: f.fromAmount.toString(),
      toAmount: f.toAmount.toString(),
      currency: f.currency,
      feeAmount: f.feeAmount.toString(),
      feeCurrency: f.feeCurrency,
    }));

    const current = await this.redisService.get<CachedAutoStackingData>(
      this.allKey,
    );
    if (current) {
      const updated = { ...current, transactionFees: mappedFees };
      await this.redisService.set(this.allKey, updated);
    } else {
      await this.refreshAutoStackingCache();
    }
  }

  async invalidateAutoStackingCache() {
    await this.redisService.del(this.allKey);
    await this.redisService.del(this.settingsKey);
  }
}
