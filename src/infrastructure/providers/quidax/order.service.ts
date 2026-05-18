// src/infrastructure/providers/quidax/order/order.service.ts
import { Injectable } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';

@Injectable()
export class QuidaxOrderService extends BaseQuidaxService {
  async buyOrSellOrderRequest(
    user_id: string,
    options: t.SellOrBuyOrderRequestOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.SellOrBuyOrderRequestResponse>> {
    return this.request({
      url: `/users/${user_id}/orders`,
      method: 'POST',
      data: options,
      ...opts,
    });
  }

  async cancelBuyOrSellOrderRequest(
    options: t.CancelSellOrBuyOrderRequestOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.SellOrBuyOrderRequestResponse>> {
    return this.request({
      url: `/users/${options.user_id}/orders/${options.order_id}/cancel`,
      method: 'POST',
      ...opts,
    });
  }

  async getAllOrders(
    user_id: string,
    options: t.GetOrderListOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetOrderListResponse>> {
    return this.request({
      url: `/users/${user_id}/orders`,
      method: 'GET',
      params: options,
      ...opts,
    });
  }

  async getOrderRecord(
    options: t.GetOrderRecordOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetOrderRecordResponse>> {
    return this.request({
      url: `/users/${options.user_id}/orders/${options.order_id}`,
      method: 'GET',
      ...opts,
    });
  }

  async instantOrdersRequery(
    options: t.InstantOrdersRequeryOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.InstantOrderResponse>> {
    return this.request({
      url: `/users/${options.user_id}/instant_orders/${options.instant_order_id}`,
      method: 'GET',
      ...opts,
    });
  }
}
