import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  TransactionContext,
  TransactionStatus,
  TransactionType,
  DepositStatus,
  WithdrawalStatus,
  Providers,
} from '../../../../infrastructure/databases/prisma/generated/prisma/client';
import {
  ConvertCurrency,
  CryptoNetwork,
  referenceData,
  toBigInt,
  toDecimal,
  toCryptoNetwork,
  isTransientPrismaError,
} from '../../../../shared';
import { DashboardStatsQueueService } from '../../../dashboard/dashboard-stats-queue';
import {
  QuidaxDepositService,
  QuidaxWithdrawalService,
} from '../../../../infrastructure/providers/quidax';
import { Prisma } from '../../../../infrastructure/databases/prisma/generated/prisma/browser';
import Decimal from 'decimal.js';
import { Company_withdrawal_type } from '../../../../shared';
import { TransactionNotificationService } from '../../../../modules/transaction/services';
import { TransactionService } from '../../../../modules/transaction/services/transaction.service';
import { QuidaxTickerService } from '../../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { CompanyLiquidityService } from '../../../../modules/transaction/services/company-liquidity.service';

@Injectable()
export class DepositSuccessfulHandler {
  private readonly logger = new Logger(DepositSuccessfulHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardStatsQueueService: DashboardStatsQueueService,
    private readonly quidaxDepositService: QuidaxDepositService,
    private readonly quidaxWithdrawalService: QuidaxWithdrawalService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly tickerService: QuidaxTickerService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly transactionService: TransactionService,
  ) {}

  async process(data: any): Promise<void> {
    const quidaxUserId = data.wallet?.user?.id || data.user?.id;
    const providerDepositId = data.id;

    this.logger.log(
      `Processing deposit ${providerDepositId} for user ${quidaxUserId}`,
    );

    if (!quidaxUserId) {
      this.logger.error('Missing Quidax user ID in deposit payload');
      return;
    }

    let depositResponse;
    try {
      depositResponse = await this.quidaxDepositService.fetchDeposit(
        quidaxUserId,
        providerDepositId,
        { skipCircuitBreaker: true },
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch deposit ${providerDepositId} from Quidax: ${error?.message}`,
      );
      throw error; // Let BullMQ retry on transient failures
    }

    this.logger.debug(
      `fetchDeposit response: ${JSON.stringify(depositResponse)}`,
    );

    const confirmedDeposit = depositResponse?.data;

    if (!confirmedDeposit) {
      this.logger.error(
        `Unable to fetch deposit ${providerDepositId} from Quidax`,
      );
      return;
    }

    this.logger.debug(`Deposit status from Quidax: ${confirmedDeposit.status}`);

    const isAccptedStatus =
      confirmedDeposit.status.toLowerCase() === 'accepted';

    if (!isAccptedStatus) {
      this.logger.warn(
        `Deposit ${providerDepositId} not confirmed. Status: ${confirmedDeposit.status}`,
      );
      return;
    }

    this.logger.log(
      `Deposit ${providerDepositId} confirmed, proceeding with processing`,
    );

    const txHash = confirmedDeposit.txid ?? null;
    const currency =
      confirmedDeposit.wallet.currency?.toUpperCase() ||
      confirmedDeposit.currency?.toUpperCase();

    const network = data.wallet.default_network ?? data.network;

    const amountStr = confirmedDeposit.amount;

    // ---- Idempotency
    const existingTx = await this.prisma.transaction.findFirst({
      where: {
        transactionUniqueId: providerDepositId,
        transactionContext: TransactionContext.DEPOSIT,
        status: TransactionStatus.COMPLETED,
      },
    });

    if (existingTx) {
      this.logger.warn(`Deposit already processed: ${providerDepositId}`);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { quidaxAccountId: quidaxUserId },
      select: { id: true },
    });

    if (!user) {
      this.logger.error(`No local user for Quidax ID: ${quidaxUserId}`);
      return;
    }

    const wallet = await this.prisma.wallet.findFirst({
      where: {
        userId: user.id,
        currency: {
          equals: currency,
          mode: 'insensitive',
        },
      },
    });

    if (!wallet) {
      this.logger.error(`Wallet not found for user ${user.id} (${currency})`);
      return;
    }

    const amountBase = ConvertCurrency.toBase(
      amountStr,
      currency,
      toCryptoNetwork(network),
    );

    let createdTransactionId: string;
    let withdrawalCompanyReference: string;
    let ngnAmountBase = 0n;
    let processedNewDeposit = false;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.deposit.upsert({
          where: { providerDepositId },
          create: {
            userId: user.id,
            providerDepositId,
            txHash,
            currency,
            network,
            amount: amountStr,
            fee: data.fee != null ? String(data.fee) : null,
            depositAddress: data.wallet.deposit_address,
            destinationTag: data.payment_address?.destination_tag ?? null,
            confirmations: data.payment_transaction?.confirmations ?? null,
            requiredConfirmations:
              data.payment_transaction?.required_confirmations ?? null,
            status: DepositStatus.CONFIRMED,
            rawPayload: data as Prisma.InputJsonValue,
            detectedAt: new Date(
              data.detected_at ?? data.created_at ?? Date.now(),
            ),
            confirmedAt: new Date(data.done_at ?? Date.now()),
          },
          update: {
            txHash,
            confirmations: data.payment_transaction?.confirmations ?? undefined,
            status: DepositStatus.CONFIRMED,
            confirmedAt: new Date(data.done_at ?? Date.now()),
            rawPayload: data as Prisma.InputJsonValue,
          },
        });

        const amountDec = toDecimal(amountBase);

        const depositTx = await tx.transaction.upsert({
          where: { transactionUniqueId: providerDepositId },
          create: {
            userId: user.id,
            receiverWalletId: wallet.id,
            transactionUniqueId: providerDepositId,
            network,
            currency,
            cryptoAmountBase: amountDec,
            cryptoAmountOriginal: amountStr,
            fiatAmountBase: toDecimal(0n),
            fiatAmountOriginal: '0',
            description: `Deposit received: ${amountStr} ${currency}`,
            status: TransactionStatus.COMPLETED,
            transactionType: TransactionType.CREDIT,
            transactionContext: TransactionContext.DEPOSIT,
            paymentMetadata: {
              txid: txHash,
              quidaxEventId: providerDepositId,
              confirmations: data.payment_transaction?.confirmations,
              depositAddress: data.wallet.deposit_address,
              destinationTag: data.payment_address?.destination_tag,
            },
            isProcessed: true,
          },
          update: {
            userId: user.id,
            receiverWalletId: wallet.id,
            network,
            currency,
            cryptoAmountBase: amountDec,
            cryptoAmountOriginal: amountStr,
            fiatAmountBase: toDecimal(0n),
            fiatAmountOriginal: '0',
            description: `Deposit received: ${amountStr} ${currency}`,
            status: TransactionStatus.COMPLETED,
            transactionType: TransactionType.CREDIT,
            transactionContext: TransactionContext.DEPOSIT,
            paymentMetadata: {
              txid: txHash,
              quidaxEventId: providerDepositId,
              confirmations: data.payment_transaction?.confirmations,
              depositAddress: data.wallet.deposit_address,
              destinationTag: data.payment_address?.destination_tag,
            },
            isProcessed: true,
          },
        });

        createdTransactionId = depositTx.id;
        processedNewDeposit = true;

        // Atomic wallet balance update — no stale read
        const [{ baseBalance: newBaseStr }] = await tx.$queryRaw<
          { baseBalance: string }[]
        >`
          UPDATE "wallets"
          SET "baseBalance" = "baseBalance" + ${amountDec}
          WHERE "id" = ${wallet.id}
          RETURNING "baseBalance"
        `;

        // Compute originalBalance from the actual post-update baseBalance
        // (not from a pre-transaction read, which would be stale under concurrency)
        const newOriginalBalance = ConvertCurrency.fromBase(
          BigInt(newBaseStr),
          currency,
          toCryptoNetwork(network),
        );

        await tx.$executeRaw`
          UPDATE "wallets"
          SET "originalBalance" = ${newOriginalBalance}
          WHERE "id" = ${wallet.id}
        `;

        // Update company internal balance (user wallet was credited)
        await this.companyLiquidityService.updateInternalBalance(
          currency,
          amountDec,
          'add',
          tx,
        );

        // Convert crypto amount to NGN kobo for amountReceived
        const cryptoNgnPrice = await this.tickerService.getPrice(
          `${currency.toLowerCase()}ngn`,
        );
        if (cryptoNgnPrice && parseFloat(cryptoNgnPrice) > 0) {
          const ngnValue = new Decimal(cryptoNgnPrice).mul(
            new Decimal(amountStr),
          );
          ngnAmountBase = ConvertCurrency.toBase(ngnValue.toFixed(2), 'ngn');
        }
        const ngnDec = toDecimal(ngnAmountBase);
        await tx.$executeRaw`
          UPDATE "users"
          SET "amountReceived" = "amountReceived" + ${ngnDec}
          WHERE "id" = ${user.id}
        `;

        // Update payment address counters
        if (data.payment_address?.address) {
          await tx.paymentAddress.updateMany({
            where: {
              walletId: wallet.id,
              address: data.payment_address.address,
            },
            data: {
              totalPayments: { increment: amountBase.toString() },
              depositCount: { increment: 1 },
            },
          });
        }
      });
    } catch (error: any) {
      if (isTransientPrismaError(error)) {
        this.logger.error(
          `Transient DB error processing deposit ${providerDepositId}: ${error.message}`,
        );
        throw error; // Let BullMQ retry
      }
      this.logger.error(
        `Failed to process deposit ${providerDepositId}: ${error?.message}`,
        error?.stack,
      );
      throw error; // Mark webhook as failed, not silently swallowed
    }

    if (!processedNewDeposit || !createdTransactionId) {
      this.logger.warn(`Deposit already processed: ${providerDepositId}`);
      return;
    }

    const completedTransaction = await this.prisma.transaction.findUnique({
      where: { id: createdTransactionId },
      select: {
        id: true,
        userId: true,
        transactionUniqueId: true,
        transactionContext: true,
        status: true,
        User: { select: { email: true, firstName: true } },
        paymentMetadata: true,
      },
    });

    if (completedTransaction) {
      try {
        await this.transactionNotificationService.sendTransactionStatusNotification(
          completedTransaction,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to send notification for deposit ${providerDepositId}: ${error?.message}`,
        );
      }
    }

    const withdrawalReference: referenceData = {
      type: Company_withdrawal_type.Deposit,
      providerId: providerDepositId,
    };

    try {
      const withdrawalResponse =
        await this.quidaxWithdrawalService.withdrawToCompanyAccount(
          quidaxUserId,
          currency,
          amountStr,
          withdrawalReference,
          `Auto sweep for deposit ${providerDepositId}`,
          network,
          { skipCircuitBreaker: true },
        );
      withdrawalCompanyReference = withdrawalResponse.data.reference;

      await this.prisma.companyWithdrawal.create({
        data: {
          transactionId: createdTransactionId,
          providerReference: withdrawalCompanyReference,
          provider: Providers.QUDIAX,
          description: `Auto sweep for deposit initiated`,
          amountBase: toDecimal(amountBase),
          currency,
          status: WithdrawalStatus.PENDING,
          providerResponse:
            withdrawalResponse as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error: any) {
      const errorMessage =
        typeof error?.message === 'string'
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error?.message ?? error ?? 'Unknown error');

      const providerResponse = error?.response
        ? JSON.stringify(error.response)
        : null;

      await this.prisma.companyWithdrawal.create({
        data: {
          transactionId: createdTransactionId,
          providerReference:
            withdrawalCompanyReference ?? `failed-sweep-${providerDepositId}`,
          provider: Providers.QUDIAX,
          description: `Auto sweep FAILED`,
          amountBase: toDecimal(amountBase),
          currency,
          status: WithdrawalStatus.FAILED,
          failedReason: errorMessage,
          providerResponse: providerResponse as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });

      this.logger.error(
        `Deposit sweep failed for ${providerDepositId}. Admin will handle manually.`,
      );
    }

    try {
      await this.dashboardStatsQueueService.queueTransactionUpdate({
        id: providerDepositId,
        userId: user.id,
        currency,
        nairaAmountBase: ngnAmountBase.toString(),
        status: TransactionStatus.COMPLETED,
        createdAt: data.done_at ?? new Date().toISOString(),
        transactionType: TransactionType.CREDIT,
        transactionContext: TransactionContext.DEPOSIT,
        senderWalletAddress: data.payment_address?.address ?? null,
        receiverWalletAddress: data.wallet.deposit_address,
        user: { firstName: null, lastName: null },
        network,
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to queue dashboard stats for deposit ${providerDepositId}: ${error?.message}`,
      );
    }

    await this.transactionService.syncCompanyLiquidityCache();
  }
}
