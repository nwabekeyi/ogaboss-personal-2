import { Injectable, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { HttpService } from '../../../infrastructure/httpService/httpService.service';
import {
  PaystackTransactionResponse,
  PaystackRefundResponse,
  PaystackVerifyResponse,
  PaystackChargeSavedCardResponse,
  PaystackBalanceResponse,
  PaystackTransferRecipientResponse,
  PaystackTransferResponse,
} from './type';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { BASE_CURRENCY, decrypt } from '../../../shared';
import { Providers } from '../../../shared';

@Injectable()
export class PaystackService {
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;
  private readonly paystackLimit: number = 10000000;

  constructor(
    private readonly httpService: HttpService,
    private prisma: PrismaService,
  ) {
    this.secretKey =
      process.env.NODE_ENV === 'development'
        ? process.env.PAYSTACK_SECRET_KEY_TEST
        : process.env.PAYSTACK_SECRET_KEY_LIVE;

    if (!this.secretKey) {
      throw new Error(
        'Paystack secret key is not defined in environment variables',
      );
    }
  }
  private getHeaders() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  private cb(opts?: { skipCircuitBreaker?: boolean }): string | undefined {
    return opts?.skipCircuitBreaker ? undefined : Providers.PAYSTACK;
  }

  async initializePayment(
    data: {
      email: string;
      amount: number | string;
      reference: string;
      currency?: string;
      callback_url?: string;
      channels?: string[];
      metadata?: Record<string, any>;
    },
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<PaystackTransactionResponse> {
    return this.httpService.post<PaystackTransactionResponse>(
      `${this.baseUrl}/transaction/initialize`,
      { ...data, amount: data.amount },
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async verifyTransaction(
    reference: string,
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<PaystackVerifyResponse> {
    return this.httpService.get<PaystackVerifyResponse>(
      `${this.baseUrl}/transaction/verify/${reference}`,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  verifyWebhookSignature(signature: string, payload: string): boolean {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(payload)
      .digest('hex');
    return hash === signature;
  }

  async verifyBankAccount(
    data: { account_number: string; bank_code: string },
    opts?: { skipCircuitBreaker?: boolean },
  ) {
    return this.httpService.get(
      `${this.baseUrl}/bank/resolve?account_number=${data.account_number}&bank_code=${data.bank_code}`,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async createTransferRecipient(
    data: {
      type: 'nuban' | 'bvn';
      name: string;
      account_number: string;
      bank_code: string;
      currency: string;
      metadata?: Record<string, any>;
    },
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<PaystackTransferRecipientResponse> {
    return this.httpService.post<PaystackTransferRecipientResponse>(
      `${this.baseUrl}/transferrecipient`,
      data,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async initiateTransfer(
    data: {
      source: 'balance' | 'bank';
      amount: number | string;
      recipient: string;
      reason: string;
    },
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<PaystackTransferResponse> {
    return this.httpService.post<PaystackTransferResponse>(
      `${this.baseUrl}/transfer`,
      data,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async finalizeTransfer(
    reference: string,
    opts?: { skipCircuitBreaker?: boolean },
  ) {
    return this.httpService.post(
      `${this.baseUrl}/transfer/finalize_transfer`,
      { transfer_code: reference },
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  // Replace the existing chargeSavedCard method with this improved one

  async chargeSavedCard(
    {
      paymentCardId,
      amount,
      reference,
      metadata = {},
    }: {
      paymentCardId: string;
      amount: number | string;
      reference: string;
      metadata?: Record<string, any>;
    },
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<PaystackChargeSavedCardResponse> {
    const chargeAmount = new Decimal(amount.toString());
    if (chargeAmount.gt(this.paystackLimit)) {
      throw new BadRequestException('transactionn amount is too large');
    }

    const card = await this.prisma.paymentCard.findUnique({
      where: { id: paymentCardId },
      include: {
        user: { select: { email: true, displayCurrency: true } },
      },
    });

    if (!card) throw new BadRequestException('Saved card not found');
    if (!card.reusable)
      throw new BadRequestException(
        'This card is not reusable and cannot be charged',
      );

    const authorizationCode = decrypt({
      content: card.authorizationCode,
      iv: card.authorizationIv,
      tag: card.authorizationTag,
    });

    return this.httpService.post<PaystackChargeSavedCardResponse>(
      `${this.baseUrl}/transaction/charge_authorization`,
      {
        authorization_code: authorizationCode,
        email: card.user.email,
        amount,
        reference,
        currency: BASE_CURRENCY.toUpperCase(),
        metadata: {
          payment_card_id: card.id,
          card_last4: card.last4,
          user_id: card.userId,
          ...metadata,
        },
      },
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async refundTransaction(
    data: { transaction: string; amount?: number },
    opts?: { skipCircuitBreaker?: boolean },
  ): Promise<PaystackRefundResponse> {
    return this.httpService.post<PaystackRefundResponse>(
      `${this.baseUrl}/refund`,
      data,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async listBanks(opts?: { skipCircuitBreaker?: boolean }) {
    return this.httpService.get(
      `${this.baseUrl}/bank`,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async resolveBVN(bvn: string, opts?: { skipCircuitBreaker?: boolean }) {
    return this.httpService.get(
      `${this.baseUrl}/bvn/match/${bvn}`,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }

  async getBalance(opts?: {
    skipCircuitBreaker?: boolean;
  }): Promise<PaystackBalanceResponse> {
    return this.httpService.get<PaystackBalanceResponse>(
      `${this.baseUrl}/balance`,
      this.getHeaders(),
      undefined,
      this.cb(opts),
    );
  }
}