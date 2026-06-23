// src/infrastructure/providers/quidax/account/account.service.ts
import { Injectable, BadGatewayException, Logger } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';

@Injectable()
export class QuidaxAccountService extends BaseQuidaxService {
  async createSubAccount(
    options: t.CreateSubAccountOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.CreateSubAccountResponse>> {
    const response = await this.request<
      t.QuidaxResponse<t.CreateSubAccountResponse>
    >({
      url: '/users',
      method: 'POST',
      data: options,
      ...opts,
    });

    if (response.status !== 'success') {
      this.logger.error('Quidax account creation failed', response);
    }

    if (!response.data?.id) {
      this.logger.warn(
        'Quidax account created but no ID returned',
        response.data,
      );
    }

    return response;
  }

  async getAccountDetail(
    options: t.GetAccountDetailOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetAccountDetailResponse>> {
    const response = await this.request<
      t.QuidaxResponse<t.GetAccountDetailResponse>
    >({
      url: `/users/${options.user_id}`,
      method: 'GET',
      ...opts,
    });

    if (response.status !== 'success') {
      this.logger.error('Failed to fetch Quidax account', response);
    }

    return response;
  }

  extractUserId(
    response: t.QuidaxResponse<t.CreateSubAccountResponse>,
  ): string {
    if (response.status !== 'success' || !response.data?.id) {
      this.logger.error('Invalid Quidax account response: missing id');
      throw new BadGatewayException('Something went wrong, try again later');
    }
    return response.data.id;
  }
}
