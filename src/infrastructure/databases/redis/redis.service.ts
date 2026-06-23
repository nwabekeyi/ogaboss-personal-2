import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(redisUrl);

    this.client.on('connect', () =>
      this.logger.log('Redis connected successfully'),
    );
    this.client.on('error', (err) =>
      this.logger.error('Redis connection error', err),
    );
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Safe get with optional JSON parsing.
   * Returns defaultValue if key not found or parsing fails.
   */
  async get<T = string>(
    key: string,
    defaultValue: T | null = null,
  ): Promise<T | null> {
    try {
      const val = await this.client.get(key);
      if (!val) return defaultValue;

      try {
        return JSON.parse(val) as T;
      } catch {
        return val as unknown as T;
      }
    } catch (err) {
      this.logger.error(`Redis GET failed for key: ${key}`, err);
      return defaultValue;
    }
  }

  /**
   * Set key with optional TTL in seconds
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const val =
        typeof value === 'string'
          ? value
          : JSON.stringify(value, this.replacer);
      if (ttlSeconds) {
        await this.client.set(key, val, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, val);
      }
    } catch (err) {
      this.logger.error(`Redis SET failed for key: ${key}`, err);
    }
  }

  private replacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error(`Redis DEL failed for key: ${key}`, err);
    }
  }

  async setNx(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      const val =
        typeof value === 'string'
          ? value
          : JSON.stringify(value, this.replacer);
      if (ttlSeconds) {
        const result = await this.client.set(key, val, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } else {
        const result = await this.client.set(key, val, 'NX');
        return result === 'OK';
      }
    } catch (err) {
      this.logger.error(`Redis SETNX failed for key: ${key}`, err);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.client.exists(key)) > 0;
    } catch (err) {
      this.logger.error(`Redis EXISTS failed for key: ${key}`, err);
      return false;
    }
  }

  async hSet(key: string, field: string, value: any): Promise<void> {
    try {
      const val =
        typeof value === 'string'
          ? value
          : JSON.stringify(value, this.replacer);
      await this.client.hset(key, field, val);
    } catch (err) {
      this.logger.error(
        `Redis HSET failed for key: ${key}, field: ${field}`,
        err,
      );
    }
  }

  async hGet<T = string>(key: string, field: string): Promise<T | null> {
    try {
      const val = await this.client.hget(key, field);
      if (!val) return null;

      try {
        return JSON.parse(val) as T;
      } catch {
        return val as unknown as T;
      }
    } catch (err) {
      this.logger.error(
        `Redis HGET failed for key: ${key}, field: ${field}`,
        err,
      );
      return null;
    }
  }

  async hDel(key: string, ...fields: string[]): Promise<void> {
    try {
      await this.client.hdel(key, ...fields);
    } catch (err) {
      this.logger.error(`Redis HDEL failed for key: ${key}`, err);
    }
  }

  async hGetAll<T = Record<string, any>>(key: string): Promise<T | null> {
    try {
      const val = await this.client.hgetall(key);
      if (!val) return null;
      return val as T;
    } catch (err) {
      this.logger.error(`Redis HGETALL failed for key: ${key}`, err);
      return null;
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}