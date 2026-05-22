import { BadGatewayException, Injectable } from '@nestjs/common';
import * as t from './types';
import { HttpService } from '../../httpService';
import { ErrorMessages, Providers } from '../../../shared';

@Injectable()
export class QuidaxMarketService {
  constructor(private readonly httpService: HttpService) {}
  private async request<T = any>(config: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: any; params?: Record<string, any>; skipCircuitBreaker?: boolean; }): Promise<T> {
    try { return await this.httpService.request<T>(config.method, `${process.env.QUIDAX_API_URL}${config.url}`, config.data, { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}` }, { params: config.params }, config.skipCircuitBreaker ? undefined : Providers.QUIDAX); }
    catch (error: any) { const status = error.response?.status; if ([500, 502, 503].includes(status)) throw new BadGatewayException(`Quidax service unavailable (${status})`); throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE); }
  }
  async getMarketList() { return this.request<t.QuidaxResponse<t.GetMarketListResponse>>({ url: '/markets', method: 'GET' }); }
  async getMarketTickers() { return this.request<t.QuidaxResponse<t.GetMarketTickersResponse>>({ url: '/markets/tickers', method: 'GET' }); }
  async getSingleMarketTicker(currency: string) { return this.request<t.QuidaxResponse<t.GetMarketTickerResponse>>({ url: `/markets/tickers/${currency}`, method: 'GET' }); }
  async getOrderBookItemsForAMarket(options: t.GetOrderBookItemsForAMarketOptions) { return this.request<t.QuidaxResponse<t.GetOrderBookItemsForAMarketResponse>>({ url: `/markets/${options.currency}/order_book`, method: 'GET', params: { ask_limit: options.ask_limit, bids_limit: options.bids_limit } }); }
}
