// src/infrastructure/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { TempStoreService } from './temp-store.service';
import { RolesCacheService } from './roleCache.service';
import { AdminRoleCacheService } from './adminRoleCache.service';
import { CryptoCurrencyCacheService } from './crypto-currency-cache.service';
import { FiatCurrencyCacheService } from './fiat-currency-cache.service';
import { AutoStackingSettingsCacheService } from './auto-stacking-cache.service';
import { UrgentLiquiditySettingsCacheService } from './urgent-liquidity-cache.service';
import { CryptoCurrencyRateCacheService } from './crypto-currency-rate-cache.service';

@Global()
@Module({
   providers: [
     RedisService,
     TempStoreService,
     RolesCacheService,
     AdminRoleCacheService,
     CryptoCurrencyCacheService,
     FiatCurrencyCacheService,
     AutoStackingSettingsCacheService,
     UrgentLiquiditySettingsCacheService,
     CryptoCurrencyRateCacheService,
   ],
   exports: [
     RedisService,
     TempStoreService,
     RolesCacheService,
     AdminRoleCacheService,
     FiatCurrencyCacheService,
     CryptoCurrencyCacheService,
     AutoStackingSettingsCacheService,
     UrgentLiquiditySettingsCacheService,
     CryptoCurrencyRateCacheService
   ],
})
export class RedisModule {}
