// src/infrastructure/providers/quidax/deposit/deposit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';

@Injectable()
export class QuidaxDepositService extends BaseQuidaxService {
  async fetchDeposit(
    user_id: string,
    deposit_id: string,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.DepositDetailResponse>> {
    return this.request({
      url: `/users/${user_id}/deposits/${deposit_id}`,
      method: 'GET',
      ...opts,
    });
  }

  async fetchDeposits(
    user_id: string,
    options?: t.DepositListOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.DepositListResponse>> {
    return this.request({
      url: `/users/${user_id}/deposits`,
      method: 'GET',
      params: options,
      ...opts,
    });
  }

  async fetchSubuserDeposits(
    user_id: string,
    options?: t.SubuserDepositListOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.DepositListResponse>> {
    return this.request({
      url: `/users/${user_id}/deposits/subusers`,
      method: 'GET',
      params: options,
      ...opts,
    });
  }
}
