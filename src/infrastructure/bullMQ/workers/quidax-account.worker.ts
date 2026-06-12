import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QuidaxWalletService } from '../../providers/quidax/wallet.service';
import { QuidaxAccountService } from '../../providers/quidax/account.service';
import { PrismaService } from '../../databases/prisma';
import { QueueName } from '../types';
import { Logger } from '@nestjs/common';
import {
  ALLOWED_CURRENCIES,
  ConvertCurrency,
  CryptoNetwork,
  SUPPORTED_CRYPTO_CURRENCIES,
} from '../../../shared';
import {
  PaymentAddressStatus,
  Prisma,
} from '../../databases/prisma/generated/prisma/client';

@Processor(QueueName.QUIDAX_ACCOUNT, { concurrency: 10 })
export class QuidaxAccountWorker extends WorkerHost {
  private readonly logger = new Logger('QuidaxAccountWorker');
  private readonly ADDRESS_STALE_THRESHOLD_MS = 3 * 60 * 1000;

  constructor(
    private readonly quidaxWalletService: QuidaxWalletService,
    private readonly quidaxAccountService: QuidaxAccountService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<any>) {
    switch (job.name) {
      case 'create-quidax-subaccount':
        return this.handleCreateSubaccount(job);
      default:
        this.logger.warn(`Unhandled job name: ${job.name}`);
        break;
    }
  }

  private async handleCreateSubaccount(job: Job<any>) {
    const { userId, email, firstName, lastName } = job.data;

    const accountRes = await this.quidaxAccountService.createSubAccount(
      {
        email,
        first_name: firstName,
        last_name: lastName,
      },
      { skipCircuitBreaker: true },
    );

    if (accountRes.status !== 'success')
      throw new Error('Account creation failed');

    const { id: quidaxUserId, sn: quidaxSnId } = accountRes.data;

    await this.prisma.user.update({
      where: { id: userId },
      data: { quidaxAccountId: quidaxUserId, quidaxSnId },
    });

    await this.handleWalletSync({ data: { userId, quidaxUserId } } as any);
  }

  private async handleWalletSync(job: Job<any>) {
    const { userId, quidaxUserId } = job.data;

    // Run wallet synchronization in a transaction
    await this.prisma.$transaction(async (tx) => {
      for (const currency of ALLOWED_CURRENCIES) {
        try {
          const res = await this.quidaxWalletService.getUserWallet(
            {
              user_id: quidaxUserId,
              currency,
            },
            { skipCircuitBreaker: true },
          );

          if (res.status !== 'success' || !res.data) continue;

          const w = res.data;
          const balanceStr = w.balance ?? '0';
          const baseBalance = ConvertCurrency.toBase(
            balanceStr,
            currency,
            w.default_network as CryptoNetwork,
          ).toString();

          // Find currency record (case-insensitive)
          const currencyRecord = await tx.cryptoCurrency.findFirst({
            where: {
              symbol: {
                equals: currency.toUpperCase(),
                mode: 'insensitive',
              },
            },
            select: { id: true },
          });

          const wallet = await tx.wallet.upsert({
            where: { quidaxWalletId: w.id },
            create: {
              quidaxWalletId: w.id,
              currency,
              name: w.name ?? currency.toUpperCase(),
              baseBalance,
              originalBalance: balanceStr,
              isCrypto: w.is_crypto ?? true,
              blockchainEnabled: w.blockchain_enabled ?? false,
              defaultNetwork: w.default_network ?? null,
              user: { connect: { id: userId } },
              // Set the relation instead of the foreign key directly
              ...(currencyRecord
                ? { cryptoCurrency: { connect: { id: currencyRecord.id } } }
                : {}),
            },
            update: {
              baseBalance,
              originalBalance: balanceStr,
              blockchainEnabled: w.blockchain_enabled ?? false,
              defaultNetwork: w.default_network ?? null,
            },
          });

          if (!wallet.blockchainEnabled) continue;

          if (!SUPPORTED_CRYPTO_CURRENCIES.includes(currency)) continue;

          // Create payment addresses for each network - Quidax will send webhook when ready
          for (const network of w.networks ?? []) {
            await this.ensurePaymentAddress(tx, {
              walletId: wallet.id,
              currency,
              network: network.id,
              networkName: network.name,
              quidaxUserId,
            });
          }
        } catch (err) {
          this.logger.debug(
            `Wallet ${currency} not available or failed for user ${userId}: ${err.message}`,
          );
        }
      }
    });
  }

  private async ensurePaymentAddress(
    tx: Prisma.TransactionClient,
    params: {
      walletId: string;
      currency: string;
      network: string;
      networkName: string;
      quidaxUserId: string;
    },
  ): Promise<void> {
    const { walletId, currency, network, networkName, quidaxUserId } = params;

    let addressRecord: {
      id: string;
      quidaxAddressId: string | null;
      status: PaymentAddressStatus;
      updatedAt: Date;
    } | null = null;
    let claimedSlot = false;

    try {
      addressRecord = await tx.paymentAddress.create({
        data: {
          quidaxAddressId: null,
          walletId,
          currency,
          network,
          name: networkName,
          status: PaymentAddressStatus.PROCESSING,
        },
        select: {
          id: true,
          quidaxAddressId: true,
          status: true,
          updatedAt: true,
        },
      });
      claimedSlot = true;
    } catch (err: any) {
      if (err?.code !== 'P2002') {
        throw err;
      }
      addressRecord = await tx.paymentAddress.findFirst({
        where: { walletId, currency, network },
        select: {
          id: true,
          quidaxAddressId: true,
          status: true,
          updatedAt: true,
        },
      });
    }

    if (!addressRecord) return;

    if (
      addressRecord.status === PaymentAddressStatus.ACTIVE &&
      addressRecord.quidaxAddressId
    )
      return;
    if (addressRecord.status === PaymentAddressStatus.FAILED) return;
    if (
      addressRecord.status === PaymentAddressStatus.PROCESSING &&
      addressRecord.quidaxAddressId
    )
      return;

    if (
      addressRecord.status === PaymentAddressStatus.PROCESSING &&
      !addressRecord.quidaxAddressId &&
      !claimedSlot
    ) {
      const ageMs = Date.now() - new Date(addressRecord.updatedAt).getTime();
      if (ageMs < this.ADDRESS_STALE_THRESHOLD_MS) return;

      const claimed = await tx.paymentAddress.updateMany({
        where: {
          id: addressRecord.id,
          updatedAt: addressRecord.updatedAt,
          status: PaymentAddressStatus.PROCESSING,
          quidaxAddressId: null,
        },
        data: { updatedAt: new Date() },
      });

      if (claimed.count === 0) return;
    }
    try {
      const apiRes = await this.quidaxWalletService.createPaymentAddress(
        {
          user_id: quidaxUserId,
          currency,
          network,
        },
        { skipCircuitBreaker: true },
      );
      const returnedAddress: string | null = apiRes?.data?.address ?? null;
      const returnedAddressId: string | null = apiRes?.data?.id ?? null;

      if (returnedAddressId) {
        // Address returned synchronously — mark ACTIVE immediately
        await tx.paymentAddress.update({
          where: { id: addressRecord.id },
          data: {
            quidaxAddressId: returnedAddressId,
            address: returnedAddress,
            status: PaymentAddressStatus.ACTIVE,
          },
        });
      } else {
        await tx.paymentAddress.update({
          where: { id: addressRecord.id },
          data: {
            updatedAt: new Date(),
          },
        });
      }
    } catch (apiErr: any) {
      await tx.paymentAddress
        .update({
          where: { id: addressRecord.id },
          data: {
            status: PaymentAddressStatus.FAILED,
          },
        })
        .catch(() => undefined);
    }
  }
}
