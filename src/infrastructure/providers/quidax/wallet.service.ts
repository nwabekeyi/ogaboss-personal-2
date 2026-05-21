import { BadGatewayException, Injectable } from '@nestjs/common';
import * as t from './types';
import { HttpService } from '../../httpService';
import { ALLOWED_CURRENCIES, ErrorMessages, Providers } from '../../../shared';

@Injectable()
export class QuidaxWalletService {
  constructor(private readonly httpService: HttpService) {}
  private async request<T = any>(config: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: any; params?: Record<string, any>; skipCircuitBreaker?: boolean; }): Promise<T> {
    try { return await this.httpService.request<T>(config.method, `${process.env.QUIDAX_API_URL}${config.url}`, config.data, { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}` }, { params: config.params }, config.skipCircuitBreaker ? undefined : Providers.QUIDAX); }
    catch (error: any) { const status = error.response?.status; if ([500, 502, 503].includes(status)) throw new BadGatewayException(`Quidax service unavailable (${status})`); throw new BadGatewayException(ErrorMessages.SERVICE_UNAVAILABLE); }
  }
  async getUserWalletList(options: t.GetUserWalletListOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetUserWalletListResponse>>({ url: `/users/${options.user_id}/wallets`, method: 'GET', ...opts }); }
  async getUserWallet(options: t.GetUserWalletOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetUserWalletResponse>>({ url: `/users/${options.user_id}/wallets/${options.currency}`, method: 'GET', ...opts }); }
  async getPaymentAddress(options: t.GetPaymentAddressOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetUserWalletResponse>>({ url: `/users/${options.user_id}/wallets/${options.currency}/addresses/${options.address_id}`, method: 'GET', ...opts }); }
  async getPaymentAddressList(options: t.GetPaymentAddressListOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetPaymentAddressListResponse>>({ url: `/users/${options.user_id}/wallets/${options.currency}/addresses`, method: 'GET', ...opts }); }
  async getPaymentAddressById(options: t.GetPaymentAddressByIdOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.GetPaymentAddressByIdResponse>>({ url: `/users/${options.user_id}/wallets/${options.currency}/addresses/${options.address_id}`, method: 'GET', ...opts }); }
  async createPaymentAddress(options: t.CreatePaymentAddressOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.CreatePaymentAddressResponse>>({ url: `/users/${options.user_id}/wallets/${options.currency}/addresses`, method: 'POST', data: options, ...opts }); }
  async verifyAddress(options: t.VerifyAddressOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.VerifyAddressResponse>>({ url: `/${options.currency}/${options.address}/validate_address`, method: 'GET', ...opts }); }
  async getCompanyWallets(opts?: { skipCircuitBreaker?: boolean }): Promise<Record<string, t.GetUserWalletResponse>> {
    const wallets: Record<string, t.GetUserWalletResponse> = {};
    const response = await this.request<t.QuidaxResponse<t.GetUserWalletResponse[]>>({ url: '/users/me/wallets', method: 'GET', ...opts });
    for (const wallet of response?.data || []) if (ALLOWED_CURRENCIES.has(wallet.currency.toLowerCase())) wallets[wallet.currency.toLowerCase()] = wallet;
    return wallets;
  }
}
