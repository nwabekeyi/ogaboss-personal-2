import { BadGatewayException, Injectable } from '@nestjs/common';
import * as t from './types';
import { HttpService } from '../../httpService';
import { ErrorMessages, Providers } from '../../../shared';

@Injectable()
export class QuidaxOrderService {
  constructor(private readonly httpService: HttpService) {}
  private async request<T = any>(config: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: any; params?: Record<string, any>; skipCircuitBreaker?: boolean; }): Promise<T> {
    try { return await this.httpService.request<T>(config.method, `${process.env.QUIDAX_API_URL}${config.url}`, config.data, { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}` }, { params: config.params }, config.skipCircuitBreaker ? undefined : Providers.QUIDAX); }
    catch (error: any) { const status = error.response?.status; if ([500, 502, 503].includes(status)) throw new BadGatewayException(`Quidax service unavailable (${status})`); throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE); }
  }
  async buyOrSellOrderRequest(user_id: string, options: t.SellOrBuyOrderRequestOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.SellOrBuyOrderRequestResponse>>({ url: `/users/${user_id}/orders`, method: 'POST', data: options, ...opts }); }
  async cancelBuyOrSellOrderRequest(options: t.CancelSellOrBuyOrderRequestOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.SellOrBuyOrderRequestResponse>>({ url: `/users/${options.user_id}/orders/${options.order_id}/cancel`, method: 'POST', ...opts }); }
  async getAllOrders(user_id: string, options: t.GetOrderListOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetOrderListResponse>>({ url: `/users/${user_id}/orders`, method: 'GET', params: options, ...opts }); }
  async getOrderRecord(options: t.GetOrderRecordOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetOrderRecordResponse>>({ url: `/users/${options.user_id}/orders/${options.order_id}`, method: 'GET', ...opts }); }
  async instantOrdersRequery(options: t.InstantOrdersRequeryOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.InstantOrderResponse>>({ url: `/users/${options.user_id}/instant_orders/${options.instant_order_id}`, method: 'GET', ...opts }); }
}
