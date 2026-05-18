// src/infrastructure/providers/quidax/market/market.service.ts
import { Injectable } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';

@Injectable()
export class QuidaxMarketService extends BaseQuidaxService {
  async getMarketList(): Promise<t.QuidaxResponse<t.GetMarketListResponse>> {
    return this.request({ url: '/markets', method: 'GET' });
  }

  async getMarketTickers(): Promise<t.QuidaxResponse<t.GetMarketTickersResponse>> {
    return this.request({ url: '/markets/tickers', method: 'GET' });
  }

  async getSingleMarketTicker(currency: string): Promise<t.QuidaxResponse<t.GetMarketTickerResponse>> {
    return this.request({ url: `/markets/tickers/${currency}`, method: 'GET' });
  }

  async getOrderBookItemsForAMarket(
    options: t.GetOrderBookItemsForAMarketOptions,
  ): Promise<t.QuidaxResponse<t.GetOrderBookItemsForAMarketResponse>> {
    return this.request({
      url: `/markets/${options.currency}/order_book`,
      method: 'GET',
      params: { ask_limit: options.ask_limit, bids_limit: options.bids_limit },
    });
  }
}