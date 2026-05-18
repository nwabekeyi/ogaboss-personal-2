import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CryptoCurrency, CryptoCurrencyCacheService } from '../../infrastructure';
import { ErrorMessages } from '../../shared';

@Injectable()
export class CurrencyService {
  constructor(
    private readonly cryptoCurrencyCacheService: CryptoCurrencyCacheService,
  ) {}

  async findOne(id: string): Promise<{
    message: string;
    currency: CryptoCurrency;
  }> {
    let currency = await this.cryptoCurrencyCacheService.getById(id);
    if (!currency) {
      await this.cryptoCurrencyCacheService.refreshAllCryptoCurrenciesCache();
      currency = await this.cryptoCurrencyCacheService.getById(id);
    }
    if (!currency) {
      throw new NotFoundException(ErrorMessages.CURRENCY_NOT_FOUND);
    }
    return { message: 'Currency retrieved successfully', currency: currency as unknown as CryptoCurrency };
  }

  async findBySymbol(symbol: string) {
    let currency = await this.cryptoCurrencyCacheService.getBySymbol(symbol);
    if (!currency) {
      await this.cryptoCurrencyCacheService.refreshCryptoCurrencyCache(symbol);
      currency = await this.cryptoCurrencyCacheService.getBySymbol(symbol);
    }
    if (!currency) {
      throw new NotFoundException(ErrorMessages.CURRENCY_NOT_FOUND);
    }
    return { message: 'Currency retrieved successfully', currency };
  }

  async getAllCurrencies() {
    let currencies = await this.cryptoCurrencyCacheService.getAll();
    if (!currencies?.length) {
      await this.cryptoCurrencyCacheService.refreshAllCryptoCurrenciesCache();
      currencies = await this.cryptoCurrencyCacheService.getAll();
    }

    return {
      message: 'Currencies retrieved successfully',
      currencies: currencies.map((currency) => ({
        id: currency.id,
        name: currency.name,
        symbol: currency.symbol,
        createdAt: (currency as any).createdAt,
        updatedAt: (currency as any).updatedAt,
      })),
    };
  }
}
