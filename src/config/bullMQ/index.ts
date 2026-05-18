// src/config/bullMQ.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import IORedis from 'ioredis';

@Injectable()
export class BullConfigService implements SharedBullConfigurationFactory {
  constructor(private config: ConfigService) {}

  // REQUIRED METHOD
  createSharedConfiguration(): BullRootModuleOptions {
    const redisUrl = this.config.get<string>('REDIS_URL');

    return {
      connection: redisUrl
        ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
        : {
            host: this.config.get('REDIS_HOST', 'localhost'),
            port: this.config.get('REDIS_PORT', 6379),
          },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    };
  }
}
