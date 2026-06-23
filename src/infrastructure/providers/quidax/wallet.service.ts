// src/infrastructure/providers/quidax/wallet/wallet.service.ts
import { Injectable } from '@nestjs/common';
import { BaseQuidaxService } from './base-quidax.service';
import * as t from './types';
import { ALLOWED_CURRENCIES } from '../../../shared';

@Injectable()
export class QuidaxWalletService extends BaseQuidaxService {
  async getUserWalletList(
    options: t.GetUserWalletListOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetUserWalletListResponse>> {
    return this.request({
      url: `/users/${options.user_id}/wallets`,
      method: 'GET',
      ...opts,
    });
  }

  async getUserWallet(
    options: t.GetUserWalletOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetUserWalletResponse>> {
    return this.request({
      url: `/users/${options.user_id}/wallets/${options.currency}`,
      method: 'GET',
      ...opts,
    });
  }

  async getPaymentAddress(
    options: t.GetPaymentAddressOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetUserWalletResponse>> {
    return this.request({
      url: `/users/${options.user_id}/wallets/${options.currency}/addresses/${options.address_id}`,
      method: 'GET',
      ...opts,
    });
  }

  async getPaymentAddressList(
    options: t.GetPaymentAddressListOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetPaymentAddressListResponse>> {
    return this.request({
      url: `/users/${options.user_id}/wallets/${options.currency}/addresses`,
      method: 'GET',
      ...opts,
    });
  }

  async getPaymentAddressById(
    options: t.GetPaymentAddressByIdOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.GetPaymentAddressByIdResponse>> {
    return this.request({
      url: `/users/${options.user_id}/wallets/${options.currency}/addresses/${options.address_id}`,
      method: 'GET',
      ...opts,
    });
  }

  async createPaymentAddress(
    options: t.CreatePaymentAddressOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.CreatePaymentAddressResponse>> {
    return this.request({
      url: `/users/${options.user_id}/wallets/${options.currency}/addresses`,
      method: 'POST',
      data: options,
      ...opts,
    });
  }

  async verifyAddress(
    options: t.VerifyAddressOptions,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<t.QuidaxResponse<t.VerifyAddressResponse>> {
    return this.request({
      url: `/${options.currency}/${options.address}/validate_address`,
      method: 'GET',
      ...opts,
    });
  }

  async getCompanyWallets(opts?: {
    skipCircuitBreaker?: boolean;
  }): Promise<Record<string, t.GetUserWalletResponse>> {
    const wallets: Record<string, t.GetUserWalletResponse> = {};
    try {
      const response = await this.request({
        url: `/users/me/wallets`,
        method: 'GET',
        ...opts,
      });

      const allWallets: t.GetUserWalletResponse[] = response?.data || [];

      for (const wallet of allWallets) {
        const currency = wallet.currency.toLowerCase();
        if (ALLOWED_CURRENCIES.has(currency)) {
          wallets[currency] = wallet;
        }
      }
    } catch (error) {
      console.warn('Failed to fetch company wallets:', error.message || error);
    }
    return wallets;
  }
}
