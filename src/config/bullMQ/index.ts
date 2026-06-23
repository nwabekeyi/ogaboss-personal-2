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
    const redisUrl = this.config.getOrThrow<string>('REDIS_URL');

    return {
      connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    };
  }
}