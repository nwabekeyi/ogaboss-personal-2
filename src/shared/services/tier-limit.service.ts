import { Injectable } from '@nestjs/common';

export interface TierLimits {
  dailyTransferLimit: number;
  isUnlimited: boolean;
}

@Injectable()
export class TierLimitService {
  private readonly tierLimits: Record<string, TierLimits> = {
    TIER_1: this.parseLimit(process.env.TIER_1_DAILY_TRANSFER_LIMIT, '100000'),
    TIER_2: this.parseLimit(process.env.TIER_2_DAILY_TRANSFER_LIMIT, '500000'),
    TIER_3: this.parseLimit(
      process.env.TIER_3_DAILY_TRANSFER_LIMIT,
      '25000000',
    ),
  };

  private parseLimit(
    envValue: string | undefined,
    defaultValue: string,
  ): TierLimits {
    const value = envValue?.toLowerCase() || defaultValue;
    if (value === 'unlimited') {
      return { dailyTransferLimit: Number.MAX_SAFE_INTEGER, isUnlimited: true };
    }
    return {
      dailyTransferLimit: parseInt(value, 10),
      isUnlimited: false,
    };
  }

  getLimitForTier(tier: string): TierLimits {
    return this.tierLimits[tier] || this.tierLimits.TIER_1;
  }
}
