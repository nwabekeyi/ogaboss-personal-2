// src/infrastructure/databases/redis/temp-store.service.ts
import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

@Injectable()
export class TempStoreService {
  constructor(private readonly redisService: RedisService) {}

  /**
   * Set a key with optional expiration in seconds (default 600s)
   */
  async set(key: string, value: any, expirationTime = 600): Promise<void> {
    await this.redisService.set(key, value, expirationTime);
  }

  /**
   * Get a key, automatically JSON-parsed if possible
   */
  async get<T = string>(key: string): Promise<T | null> {
    return this.redisService.get<T>(key);
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<void> {
    await this.redisService.del(key);
  }

  async setNx(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    return this.redisService.setNx(key, value, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return await this.redisService.getClient().ttl(key);
  }

  /**
   * Flush all keys in Redis
   */
  async flushAll(): Promise<void> {
    await this.redisService.getClient().flushall();
  }
}
