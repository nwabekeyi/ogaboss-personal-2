import { Injectable } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';
import { RedisService } from '../../../infrastructure/databases/redis';
import { COMPANY_WALLETS_KEY, referenceData } from '../../../shared';
import { HttpService } from '../../../infrastructure/httpService';
import { QuidaxWalletService } from './wallet.service';
import { findCompanyWallet, getCompanyWalletKey } from '../../../shared/utils';

@Injectable()
export class QuidaxWithdrawalService extends BaseQuidaxService {
  constructor(
    private readonly redisService: RedisService,
    private readonly walletService: QuidaxWalletService,
    httpService: HttpService,
  ) {
    super(httpService);
  }

  async createWithdrawerRequest(
    options: t.CreateWithdrawerRequestOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.CreateWithdrawerRequestResponse> {
    return this.request({
      url: `/users/${options.user_id}/withdraws`,
      method: 'POST',
      data: options,
      ...opts,
    });
  }

  async cancelWithdrawerRequest(
    options: t.CancelWithdrawerRequestOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.CancelWithdrawerRequestResponse>> {
    return this.request({
      url: `/users/${options.user_id}/withdraws/${options.withdrawal_id}/cancel`,
      method: 'POST',
      data: options,
      ...opts,
    });
  }

  async getWithdrawerList(
    user_id: string,
    options: t.WithdrawalListOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.WithdrawalListResponse>> {
    return this.request({
      url: `/users/${user_id}/withdraws`,
      method: 'GET',
      params: options,
      ...opts,
    });
  }

  async getWithdrawerDetail(
    options: t.WithdrawerDetailOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.WithdrawerDetailResponse>> {
    return this.request({
      url: `/users/${options.user_id}/withdraws/${options.withdrawal_id}`,
      method: 'GET',
      ...opts,
    });
  }

  async getWithdrawerByReference(
    options: t.WithdrawerRecordByReferenceOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.WithdrawerRecordByReferenceResponse>> {
    return this.request({
      url: `/users/${options.user_id}/withdraws/reference/${options.reference}`,
      method: 'GET',
      ...opts,
    });
  }

  async getWithdrawerFees(
    options: t.WithdrawerFeesOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.WithdrawerFeesResponse>> {
    const response = this.request({
      url: `/fee`,
      method: 'GET',
      params: options,
      ...opts,
    });
    return response;
  }

  async withdrawToCompanyAccount(
    user_id: string,
    currency: string,
    amount: string,
    reference: referenceData,
    narration: string,
    network?: string,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.CreateWithdrawerRequestResponse> {
    const lowerCurrency = currency.toLowerCase();
    const networkKey = network?.toLowerCase() || 'mainnet';
    const walletKey = getCompanyWalletKey(lowerCurrency, networkKey);

    const walletsRaw = await this.redisService.get(COMPANY_WALLETS_KEY);
    if (!walletsRaw) {
      this.logger.error('Company wallets not found in Redis');
      throw new Error('Company wallets not found');
    }

    const companyWallets: Record<string, any> = walletsRaw as unknown as Record<
      string,
      any
    >;

    let wallet = findCompanyWallet(companyWallets, lowerCurrency, networkKey);
    if (!wallet?.depositAddress) {
      this.logger.warn(
        `No company wallet found for ${currency} in Redis, fetching from Quidax`,
      );
      const wallets = await this.walletService.getCompanyWallets({
        skipCircuitBreaker: true,
      });
      let fetchedWallet = wallets[lowerCurrency];
      if (!fetchedWallet?.deposit_address && fetchedWallet?.is_crypto) {
        const network = networkKey || lowerCurrency;
        const addressResponse = await this.walletService.createPaymentAddress(
          { user_id: 'me', currency: lowerCurrency, network },
          { skipCircuitBreaker: true },
        );
        if (addressResponse?.data?.address) {
          fetchedWallet = {
            ...fetchedWallet,
            deposit_address: addressResponse.data.address,
            destination_tag: addressResponse.data.destination_tag,
          } as t.GetUserWalletResponse;
        }
      }
      if (fetchedWallet?.deposit_address) {
        wallet = {
          depositAddress: fetchedWallet.deposit_address,
          destinationTag: fetchedWallet.destination_tag || null,
        };
      }
    }
    if (!wallet?.depositAddress) {
      this.logger.error(`No company wallet found for ${currency}`);
      throw new Error(`No company wallet configured for ${currency}`);
    }

    const fund_uid = wallet.depositAddress;
    const destination_tag = wallet.destinationTag || undefined;

    const companyReference = `MainAccount-${reference.providerId}-${reference.type}`;

    const options: t.CreateWithdrawerRequestOptions = {
      user_id,
      currency: lowerCurrency,
      amount,
      fund_uid,
      fund_uid2: destination_tag,
      network,
      reference: companyReference,
      transaction_note: 'Withdrawal to company wallet',
      narration,
    };

    const response = await this.createWithdrawerRequest(options, opts);

    if (response.status !== 'success') {
      this.logger.error(
        `Withdrawal to company wallet failed. Full response: ${JSON.stringify(response)}`,
      );
      throw new Error(`Withdrawal failed: ${response.message}`);
    }
    return response;
  }
}
