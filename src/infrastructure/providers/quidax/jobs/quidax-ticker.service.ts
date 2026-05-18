// src/infrastructure/providers/quidax/ticker/ticker.service.ts
import { Injectable, BadGatewayException, Logger } from '@nestjs/common';
import { HttpService } from '../../../../infrastructure/httpService';
import { RedisService } from '../../../../infrastructure/databases/redis';

@Injectable()
export class QuidaxTickerService {
  private readonly REDIS_KEY = 'quidax:markets:tickers';
  private readonly TTL = 3600;
  private readonly logger = new Logger(QuidaxTickerService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly redis: RedisService,
  ) {}

  async fetchAndCacheTickers(): Promise<void> {
    const apiUrl = process.env.QUIDAX_API_URL?.trim();

    if (!apiUrl) {
      throw new BadGatewayException('Quidax API URL or API key is missing');
    }

    const response = await this.httpService.get<any>(
      `${apiUrl}/markets/tickers`,
    );

    const allTickers = response?.data;
    if (!allTickers || typeof allTickers !== 'object') {
      this.logger.warn('No valid ticker data received from Quidax');
    }

    // Cache tickers
    await this.redis
      .getClient()
      .set(this.REDIS_KEY, JSON.stringify(allTickers), 'EX', this.TTL);
  }

  async getCachedTickers(): Promise<Record<string, any> | null> {
    const raw = await this.redis.getClient().get(this.REDIS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

    async getPrice(pair: string): Promise<string | null> {
      if (!pair) return null;

      // Helper function to try getting price from tickers
      const tryGetPriceFromTickers = async (tickers: Record<string, any> | null): Promise<string | null> => {
        if (!tickers) return null;

        const lower = pair.toLowerCase();
        const foundKey = Object.keys(tickers).find(
          (k) => k.toLowerCase() === lower,
        );

        if (foundKey) {
          const priceStr = tickers[foundKey]?.ticker?.last;
          if (priceStr && parseFloat(priceStr) > 0) {
            return priceStr;
          }
        }

        return null;
      };

     // Step 1: Try with cached tickers
     let tickers = await this.getCachedTickers();
     let price = await tryGetPriceFromTickers(tickers);
     if (price !== null) {
       return price;
     }

     // Step 2: Fetch all tickers (refresh cache)
     try {
       await this.fetchAndCacheTickers();
       tickers = await this.getCachedTickers();
       price = await tryGetPriceFromTickers(tickers);
       if (price !== null) {
         return price;
       }
     } catch (err) {
       this.logger.error('Failed to fetch and cache tickers', err);
       // Continue to try USDT bridge with whatever tickers we have
     }

     // Step 3: Try USDT bridge again with potentially fresh tickers
     price = await tryGetPriceFromTickers(tickers);
     if (price !== null) {
       return price;
     }

     // Step 4: If all else fails, throw error
     this.logger.error(`Failed to get price for pair: ${pair} after all attempts`);
     return null;
   }

  public async fetchSingleTicker(pair: string): Promise<string | null> {
    const apiUrl = process.env.QUIDAX_API_URL?.trim();
    if (!apiUrl) {
      return null;
    }

    try {
      const response = await this.httpService.get<any>(
        `${apiUrl}/markets/tickers/${pair}`,
      );
      const ticker = response?.data?.ticker;
      return ticker?.last || null;
    } catch (err) {
      this.logger.error(`Failed to fetch ticker for pair: ${pair}`, err);
      return null;
    }
  }
}
