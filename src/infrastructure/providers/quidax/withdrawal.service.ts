import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import * as t from './types';
import { HttpService } from '../../httpService';
import { COMPANY_WALLETS_KEY, ErrorMessages, Providers, referenceData } from '../../../shared';
import { RedisService } from '../../../infrastructure/databases/redis';
import { QuidaxWalletService } from './wallet.service';
import { findCompanyWallet } from '../../../shared/utils';

@Injectable()
export class QuidaxWithdrawalService {
  private readonly logger = new Logger(QuidaxWithdrawalService.name);
  constructor(
    private readonly redisService: RedisService,
    private readonly walletService: QuidaxWalletService,
    private readonly httpService: HttpService,
  ) {}

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

  async createWithdrawerRequest(options: t.CreateWithdrawerRequestOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.CreateWithdrawerRequestResponse>>({ url: `/users/${options.user_id}/withdraws`, method: 'POST', data: options, ...opts }); }
  async cancelWithdrawerRequest(options: t.CancelWithdrawerRequestOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.CancelWithdrawerRequestResponse>>({ url: `/users/${options.user_id}/withdraws/${options.withdrawal_id}/cancel`, method: 'POST', data: options, ...opts }); }
  async getWithdrawerList(user_id: string, options: t.WithdrawalListOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.WithdrawalListResponse>>({ url: `/users/${user_id}/withdraws`, method: 'GET', params: options, ...opts }); }
  async getWithdrawerDetail(options: t.WithdrawerDetailOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.WithdrawerDetailResponse>>({ url: `/users/${options.user_id}/withdraws/${options.withdrawal_id}`, method: 'GET', ...opts }); }
  async getWithdrawerByReference(options: t.WithdrawerRecordByReferenceOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.WithdrawerRecordByReferenceResponse>>({ url: `/users/${options.user_id}/withdraws/reference/${options.reference}`, method: 'GET', ...opts }); }
  async getWithdrawerFees(options: t.WithdrawerFeesOptions, opts?: { skipCircuitBreaker?: boolean }) { return this.request<t.QuidaxResponse<t.WithdrawerFeesResponse>>({ url: `/fee`, method: 'GET', params: options, ...opts }); }

  async withdrawToCompanyAccount(user_id: string, currency: string, amount: string, reference: referenceData, narration: string, network?: string, opts?: { skipCircuitBreaker?: boolean }) {
    const lowerCurrency = currency.toLowerCase();
    const networkKey = network?.toLowerCase() || 'mainnet';
    const walletsRaw = await this.redisService.get(COMPANY_WALLETS_KEY);
    if (!walletsRaw) { this.logger.error('Company wallets not found in Redis'); throw new Error('Company wallets not found'); }
    const companyWallets = walletsRaw as unknown as Record<string, any>;

    let wallet = findCompanyWallet(companyWallets, lowerCurrency, networkKey);
    if (!wallet?.depositAddress) {
      this.logger.warn(`No company wallet found for ${currency} in Redis, fetching from Quidax`);
      const wallets = await this.walletService.getCompanyWallets({ skipCircuitBreaker: true });
      let fetchedWallet = wallets[lowerCurrency];
      if (!fetchedWallet?.deposit_address && fetchedWallet?.is_crypto) {
        const addressResponse = await this.walletService.createPaymentAddress({ user_id: 'me', currency: lowerCurrency, network: networkKey || lowerCurrency }, { skipCircuitBreaker: true });
        if (addressResponse?.data?.address) fetchedWallet = { ...fetchedWallet, deposit_address: addressResponse.data.address, destination_tag: addressResponse.data.destination_tag } as t.GetUserWalletResponse;
      }
      if (fetchedWallet?.deposit_address) wallet = { depositAddress: fetchedWallet.deposit_address, destinationTag: fetchedWallet.destination_tag || null };
    }
    if (!wallet?.depositAddress) throw new Error(`No company wallet configured for ${currency}`);

    const response = await this.createWithdrawerRequest({ user_id, currency: lowerCurrency, amount, fund_uid: wallet.depositAddress, fund_uid2: wallet.destinationTag || undefined, network, reference: `MainAccount-${reference.providerId}-${reference.type}`, transaction_note: 'Withdrawal to company wallet', narration }, opts);
    if (response.status !== 'success') throw new Error(`Withdrawal failed: ${response.message}`);
    return response;
  }
}
