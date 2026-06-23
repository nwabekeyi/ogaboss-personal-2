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
import { CompanyWalletNetworkCacheService } from './company-wallet-network-cache.service';

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
     CompanyWalletNetworkCacheService,
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
     CryptoCurrencyRateCacheService,
     CompanyWalletNetworkCacheService
   ],
})
export class RedisModule {}