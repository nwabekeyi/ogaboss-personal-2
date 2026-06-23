import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  COMPANY_LIQUIDITY_KEY,
  COMPANY_WALLETS_KEY,
  ConvertCurrency,
  CURRENCY_PRECISION,
  CryptoCurrency,
  CryptoNetwork,
  FIAT_DECIMALS,
  toCryptoNetwork,
} from '../../../shared';
import { RedisService } from './redis.service';

interface CachedCompanyLiquidityNetwork {
  network?: string | null;
}

interface CachedCompanyWalletNetwork {
  currency?: string | null;
  network?: string | null;
}

@Injectable()
export class CompanyWalletNetworkCacheService implements OnModuleInit {
  private readonly logger = new Logger(CompanyWalletNetworkCacheService.name);

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    ConvertCurrency.setDefaultNetworkResolver((currency) =>
      this.getDefaultNetwork(currency),
    );

    await this.primeDefaultNetworkCache();
  }

  async getDefaultNetwork(
    currency: string,
  ): Promise<CryptoNetwork | undefined> {
    const normalizedCurrency = currency.toLowerCase();

    if (normalizedCurrency in FIAT_DECIMALS) {
      return undefined;
    }

    const cachedLiquidityNetwork = await this.getLiquidityNetwork(
      normalizedCurrency,
    );
    if (cachedLiquidityNetwork) return cachedLiquidityNetwork;

    const cachedWalletNetwork = await this.getCompanyWalletNetwork(
      normalizedCurrency,
    );
    if (cachedWalletNetwork) return cachedWalletNetwork;

    return this.getStaticDefaultNetwork(normalizedCurrency);
  }

  private async primeDefaultNetworkCache(): Promise<void> {
    const wallets = await this.redisService.get<Record<string, CachedCompanyWalletNetwork>>(
      COMPANY_WALLETS_KEY,
    );

    for (const wallet of Object.values(wallets ?? {})) {
      if (wallet?.currency && wallet?.network) {
        ConvertCurrency.setCachedDefaultNetwork(wallet.currency, wallet.network);
      }
    }

    const liquidityRecords = await this.redisService.hGetAll<Record<string, string>>(
      COMPANY_LIQUIDITY_KEY,
    );

    for (const [currency, rawLiquidity] of Object.entries(
      liquidityRecords ?? {},
    )) {
      try {
        const liquidity = JSON.parse(rawLiquidity) as CachedCompanyLiquidityNetwork;
        ConvertCurrency.setCachedDefaultNetwork(currency, liquidity.network);
      } catch (error) {
        this.logger.warn(`Could not parse cached liquidity network for ${currency}`);
      }
    }
  }

  private async getLiquidityNetwork(
    currency: string,
  ): Promise<CryptoNetwork | undefined> {
    const liquidity = await this.redisService.hGet<CachedCompanyLiquidityNetwork>(
      COMPANY_LIQUIDITY_KEY,
      currency.toUpperCase(),
    );

    const network = this.normalizeNetwork(currency, liquidity?.network);
    ConvertCurrency.setCachedDefaultNetwork(currency, network);
    return network;
  }

  private async getCompanyWalletNetwork(
    currency: string,
  ): Promise<CryptoNetwork | undefined> {
    const wallets = await this.redisService.get<Record<string, CachedCompanyWalletNetwork>>(
      COMPANY_WALLETS_KEY,
    );
    if (!wallets) return undefined;

    const wallet = Object.values(wallets).find(
      (item) => item?.currency?.toLowerCase() === currency && item?.network,
    );

    const network = this.normalizeNetwork(currency, wallet?.network);
    ConvertCurrency.setCachedDefaultNetwork(currency, network);
    return network;
  }

  private getStaticDefaultNetwork(currency: string): CryptoNetwork | undefined {
    const network = CURRENCY_PRECISION[currency as CryptoCurrency]?.[0]
      ?.id as CryptoNetwork | undefined;
    ConvertCurrency.setCachedDefaultNetwork(currency, network);
    return network;
  }

  private normalizeNetwork(
    currency: string,
    network?: string | null,
  ): CryptoNetwork | undefined {
    if (!network) return undefined;

    try {
      return toCryptoNetwork(network);
    } catch (error) {
      this.logger.warn(
        `Ignoring invalid cached default network ${network} for ${currency}`,
      );
      return undefined;
    }
  }
}