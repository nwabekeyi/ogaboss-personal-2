import { BadGatewayException, Injectable } from '@nestjs/common';
import * as t from './types';
import { HttpService } from '../../httpService';
import { ErrorMessages, Providers } from '../../../shared';

@Injectable()
export class QuidaxDepositService {
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
      if (status === 500 || status === 502 || status === 503) throw new BadGatewayException(`Quidax service unavailable (${status})`);
      throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE);
    }
  }

  async fetchDeposit(user_id: string, deposit_id: string, opts?: { skipCircuitBreaker?: boolean }): Promise<t.QuidaxResponse<t.DepositDetailResponse>> {
    return this.request({ url: `/users/${user_id}/deposits/${deposit_id}`, method: 'GET', ...opts });
  }
  async fetchDeposits(user_id: string, options?: t.DepositListOptions, opts?: { skipCircuitBreaker?: boolean }): Promise<t.QuidaxResponse<t.DepositListResponse>> {
    return this.request({ url: `/users/${user_id}/deposits`, method: 'GET', params: options, ...opts });
  }
  async fetchSubuserDeposits(user_id: string, options?: t.SubuserDepositListOptions, opts?: { skipCircuitBreaker?: boolean }): Promise<t.QuidaxResponse<t.DepositListResponse>> {
    return this.request({ url: `/users/${user_id}/deposits/subusers`, method: 'GET', params: options, ...opts });
  }
}
