import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import * as t from './types';
import { HttpService } from '../../httpService';
import { ErrorMessages, Providers } from '../../../shared';

@Injectable()
export class QuidaxAccountService {
  private readonly logger = new Logger(QuidaxAccountService.name);
  constructor(private readonly httpService: HttpService) {}

  private async request<T = any>(config: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: any; params?: Record<string, any>; skipCircuitBreaker?: boolean; }): Promise<T> {
    try {
      return await this.httpService.request<T>(config.method, `${process.env.QUIDAX_API_URL}${config.url}`, config.data, {
        'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
      }, { params: config.params }, config.skipCircuitBreaker ? undefined : Providers.QUIDAX);
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 500 || status === 502 || status === 503) throw new BadGatewayException(`Quidax service unavailable (${status})`);
      throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE);
    }
  }

  async createSubAccount(options: t.CreateSubAccountOptions, opts?: { skipCircuitBreaker?: boolean }): Promise<t.QuidaxResponse<t.CreateSubAccountResponse>> {
    const response = await this.request<t.QuidaxResponse<t.CreateSubAccountResponse>>({ url: '/users', method: 'POST', data: options, ...opts });
    if (response.status !== 'success') this.logger.error('Quidax account creation failed', response);
    if (!response.data?.id) this.logger.warn('Quidax account created but no ID returned', response.data);
    return response;
  }

  async getAccountDetail(options: t.GetAccountDetailOptions, opts?: { skipCircuitBreaker?: boolean }): Promise<t.QuidaxResponse<t.GetAccountDetailResponse>> {
    const response = await this.request<t.QuidaxResponse<t.GetAccountDetailResponse>>({ url: `/users/${options.user_id}`, method: 'GET', ...opts });
    if (response.status !== 'success') this.logger.error('Failed to fetch Quidax account', response);
    return response;
  }

  extractUserId(response: t.QuidaxResponse<t.CreateSubAccountResponse>): string {
    if (response.status !== 'success' || !response.data?.id) {
      this.logger.error('Invalid Quidax account response: missing id');
      throw new BadGatewayException('Something went wrong, try again later');
    }
    return response.data.id;
  }
}
