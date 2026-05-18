// src/infrastructure/scheduler/schedulers/paystack-banks.scheduler.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron} from '@nestjs/schedule';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { RedisService } from '../../../infrastructure/databases/redis';

@Injectable()
export class PaystackBanksScheduler implements OnModuleInit {
  private readonly logger = new Logger(PaystackBanksScheduler.name);
  private readonly CACHE_KEY = 'paystack:banks';

  constructor(
    private readonly paystackService: PaystackService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Runs immediately when the module starts
   */
  async onModuleInit() {
    await this.cacheBanks(); // call shared method
  }

   /**
     * Runs every 7 days at midnight (staggered from midnight cluster)
     */
    @Cron('0 0 */7 * *')
    async cacheBanksDaily() {
    this.logger.log('Running daily Paystack bank cache refresh...');
    await this.cacheBanks();
  }

  /**
   * Shared method used by both onModuleInit and Cron
   */
  private async cacheBanks() {
    try {
      const response = (await this.paystackService.listBanks({
        skipCircuitBreaker: true,
      })) as any;

      // Only cache the actual banks array
      const banks = response.data || [];

      const redis = this.redisService.getClient();
      await redis.set(
        this.CACHE_KEY,
        JSON.stringify(banks),
        'EX',
        60 * 60 * 24, // 24 hours
      );
    } catch (error) {
      this.logger.error('Failed to cache Paystack banks', error);
    }
  }
}
