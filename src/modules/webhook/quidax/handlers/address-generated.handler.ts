import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import { PaymentAddressStatus } from '../../../../infrastructure/databases/prisma/generated/prisma/client';
import { ConvertCurrency } from '../../../../shared';
import axios from 'axios';

@Injectable()
export class AddressGeneratedHandler {
  private readonly logger = new Logger(AddressGeneratedHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getPaymentAddressById(
    userId: string,
    currency: string,
    addressId: string,
  ) {
    const { data } = await axios.get(
      `${process.env.QUIDAX_API_URL}/users/${userId}/wallets/${currency}/addresses/${addressId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.QUIDAX_API_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return data;
  }

  async process(data: any): Promise<void> {
    const { id: addressId, currency: rawCurrency, user: quidaxUser } = data;

    if (!rawCurrency) {
      this.logger.warn('Address-generated webhook missing currency');
      return;
    }
    const currency = rawCurrency.toLowerCase();

    const localUser = await this.prisma.user.findUnique({
      where: { quidaxAccountId: quidaxUser.id },
      select: { id: true, email: true },
    });

    if (!localUser) {
      this.logger.debug(
        'Skipping address-generated webhook for unknown Quidax user',
      );
      return;
    }

    let wallet = await this.prisma.wallet.findFirst({
      where: {
        userId: localUser.id,
        currency: {
          equals: currency,
          mode: 'insensitive',
        },
      },
    });

    if (!wallet) {
      this.logger.log(
        `Creating wallet for ${currency.toUpperCase()} for user ${localUser.email}`,
      );
      wallet = await this.prisma.wallet.create({
        data: {
          userId: localUser.id,
          quidaxWalletId: `qw_${currency}_${Date.now()}`,
          currency,
          name: `${currency.charAt(0).toUpperCase() + currency.slice(1)} Wallet`,
          baseBalance: '0',
          reservedBalance: '0',
          originalBalance: '0',
          isCrypto: true,
          blockchainEnabled: false,
          defaultNetwork: data.network || 'mainnet',
        },
      });
    }

    // Re-query the confirmed payment address from Quidax
    const addressRes = await this.getPaymentAddressById(
      quidaxUser.id,
      currency,
      addressId,
    );

    if (addressRes.status !== 'success' || !addressRes.data) {
      this.logger.warn(
        `Failed to fetch confirmed payment address for ${currency} / ${addressId}`,
      );
      return;
    }

    const confirmed = addressRes.data;

    let totalPaymentsBigInt: bigint;
    if (confirmed.total_payments != null) {
      totalPaymentsBigInt = ConvertCurrency.toBase(
        confirmed.total_payments.toString(),
        currency,
      );
    } else {
      totalPaymentsBigInt = 0n;
    }

    await this.prisma.paymentAddress.upsert({
      where: {
        walletId_currency_network: {
          walletId: wallet.id,
          currency,
          network: confirmed.network || 'tagged',
        },
      },
      create: {
        quidaxAddressId: confirmed.id,
        walletId: wallet.id,
        currency,
        address: confirmed.address,
        network: confirmed.network || 'tagged',
        destinationTag: confirmed.destination_tag || null,
        status: PaymentAddressStatus.ACTIVE,
        totalPayments: totalPaymentsBigInt.toString(),
      },
      update: {
        quidaxAddressId: confirmed.id,
        address: confirmed.address,
        destinationTag: confirmed.destination_tag || null,
        status: PaymentAddressStatus.ACTIVE,
        totalPayments: totalPaymentsBigInt.toString(),
      },
    });

    if (!wallet.blockchainEnabled) {
      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { blockchainEnabled: true },
      });
    }
  }
}