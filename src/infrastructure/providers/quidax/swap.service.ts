// src/infrastructure/providers/quidax/swap/swap.service.ts
import { BadGatewayException, Injectable } from '@nestjs/common';
import { HttpService } from '../../httpService';
import { ErrorMessages, Providers } from '../../../shared';
import * as t from './types';

@Injectable()
export class QuidaxSwapService {
  constructor(private readonly httpService: HttpService) {}

  private async request<T = any>(config: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: any;
    params?: Record<string, any>;
    skipCircuitBreaker?: boolean;
  }): Promise<T> {
    try {
      return await this.httpService.request<T>(
        config.method,
        `${process.env.QUIDAX_API_URL}${config.url}`,
        config.data,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
        },
        { params: config.params },
        config.skipCircuitBreaker ? undefined : Providers.QUIDAX,
      );
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 500 || status === 502 || status === 503) {
        throw new BadGatewayException(`Quidax service unavailable (${status})`);
      }
      throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE);
    }
  }
  async createInstantSwapRequest(
    user_id: string,
    options: t.CreateInstantSwapRequestOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.CreateInstantSwapRequestResponse>> {
    return this.request({
      url: `/users/${user_id}/swap_quotation`,
      method: 'POST',
      data: options,
      ...opts,
    });
  }

  async confirmInstantSwap(
    options: t.ConfirmInstantSwapOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.ConfirmInstantSwapRequestResponse>> {
    return this.request({
      url: `/users/${options.user_id}/swap_quotation/${options.quotation_id}/confirm`,
      method: 'POST',
      data: {},
      ...opts,
    });
  }

  async refreshInstantSwapQuote(
    user_id: string,
    quotation_id: string,
    options: t.RefreshInstantSwapOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.RefreshInstantSwapResponse>> {
    return this.request({
      url: `/users/${user_id}/swap_quotation/${quotation_id}/refresh`,
      method: 'POST',
      data: options,
      ...opts,
    });
  }

  async getSwapTransaction(
    options: t.GetSwapTransactionOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetSwapTransactionResponse>> {
    return this.request({
      url: `/users/${options.user_id}/swap_transactions/${options.swap_transaction_id}`,
      method: 'GET',
      ...opts,
    });
  }

  async getSwapTransactionList(
    user_id: string,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetSwapTransactionListResponse>> {
    return this.request({
      url: `/users/${user_id}/swap_transactions`,
      method: 'GET',
      ...opts,
    });
  }
}
