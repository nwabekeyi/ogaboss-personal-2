// src/infrastructure/providers/quidax/swap/swap.service.ts
import { Injectable } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';

@Injectable()
export class QuidaxSwapService extends BaseQuidaxService {
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
