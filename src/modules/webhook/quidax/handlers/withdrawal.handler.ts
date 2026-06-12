import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  TransactionContext,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
  Prisma,
} from '../../../../infrastructure/databases/prisma/generated/prisma/client';
import {
  ConvertCurrency,
  CryptoNetwork,
  toBigInt,
  toDecimal,
  isTransientPrismaError,
} from '../../../../shared';
import { DashboardStatsQueueService } from '../../../dashboard/dashboard-stats-queue';
import { QuidaxWithdrawalService } from '../../../../infrastructure/providers/quidax/withdrawal.service';
import { QuidaxWalletService } from '../../../../infrastructure/providers/quidax/wallet.service';
import {
  CompanyLiquidityService,
  TransactionService,
  TransactionNotificationService,
} from '../../../../modules/transaction/services';
import { QuidaxTickerService } from '../../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import Decimal from 'decimal.js';

@Injectable()
export class WithdrawalWebhookHandler {
  private readonly logger = new Logger(WithdrawalWebhookHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardStatsQueueService: DashboardStatsQueueService,
    private readonly quidaxWithdrawalService: QuidaxWithdrawalService,
    private readonly quidaxWalletService: QuidaxWalletService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly transactionService: TransactionService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly tickerService: QuidaxTickerService,
  ) {}

  async process(event: string, data: any): Promise<void> {
    this.logger.log(`Processing ${event} webhook`);
    const reference = data.reference;
    if (!reference) {
      this.logger.error('Missing reference in withdrawal webhook payload');
      return;
    }

    const isCompany =
      reference.startsWith('company-deposit') ||
      reference.startsWith('MainAccount-');

    if (isCompany) {
      const withdrawal = await this.prisma.companyWithdrawal.findUnique({
        where: { providerReference: reference },
        include: { Transaction: true },
      });

      if (!withdrawal) {
        this.logger.error(`Company withdrawal not found: ${reference}`);
        return;
      }

      await this.handleConfirmedWithdrawal(
        event,
        withdrawal.Transaction,
        withdrawal,
        true,
        reference,
      );
    } else {
      const withdrawal = await this.prisma.withdrawal.findFirst({
        where: { reference },
        include: {
          transaction: {
            include: {
              User: {
                select: { id: true, quidaxAccountId: true, amountSent: true },
              },
            },
          },
        },
      });

      if (!withdrawal || !withdrawal.transaction) {
        this.logger.error(
          `Withdrawal not found or missing transaction: ${reference}`,
        );
        return;
      }

      await this.handleConfirmedWithdrawal(
        event,
        withdrawal.transaction,
        withdrawal,
        false,
        reference,
      );
    }
  }

  private async handleConfirmedWithdrawal(
    event: string,
    transaction: any,
    withdrawal: any,
    isCompany: boolean,
    reference: string,
  ) {
    const userId = transaction.User?.id;
    const currency = withdrawal.currency;
    const network = withdrawal.network;

    // Idempotency: skip if already in terminal status
    const terminalStatuses = new Set([
      WithdrawalStatus.SUCCESS,
      WithdrawalStatus.FAILED,
    ]);
    if (withdrawal.status && terminalStatuses.has(withdrawal.status)) {
      this.logger.warn(
        `${isCompany ? 'Company withdrawal' : 'Withdrawal'} ${reference} already in terminal status ${withdrawal.status} — skipping`,
      );
      return;
    }

    // totalAmountSentBase = totalDeductionBase (requested + networkFee + platformFee)
    // This is what was reserved from the user's balance at confirmSend time.
    if (!isCompany && transaction.totalAmountSentBase == null) {
      this.logger.error(
        `Withdrawal ${reference}: totalAmountSentBase is null on transaction — cannot process`,
      );
      return;
    }
    const totalAmountSentBase = toBigInt(transaction.totalAmountSentBase);
    const platformFeeBase: bigint = toBigInt(transaction.platformFeeBase ?? 0n);

    let confirmation;
    try {
      confirmation =
        await this.quidaxWithdrawalService.getWithdrawerByReference(
          {
            user_id: 'me',
            reference,
          },
          { skipCircuitBreaker: true },
        );
    } catch (error) {
      this.logger.error(
        `Error fetching Quidax withdrawal for ${reference}: ${error}`,
      );
      return;
    }

    if (confirmation.status !== 'success' || !confirmation.data) {
      this.logger.error(
        `Failed to confirm withdrawal from Quidax for ${reference}`,
      );
      return;
    }

    const confirmed = confirmation.data;

    if (confirmed.status !== 'Done') {
      this.logger.warn(`Withdrawal ${reference} not marked Done on Quidax`);
      return;
    }

    const walletForScale = !isCompany
      ? await this.prisma.wallet.findFirst({
          where: {
            userId,
            currency: { equals: currency, mode: 'insensitive' },
          },
          select: { defaultNetwork: true },
        })
      : null;
    const canonicalNetwork = (walletForScale?.defaultNetwork ??
      network) as CryptoNetwork;

    // Convert amounts using the wallet's stored defaultNetwork as canonical scale.
    const amountBase = ConvertCurrency.toBase(
      confirmed.amount,
      currency,
      canonicalNetwork,
    );
    const feeBase = confirmed.fee
      ? ConvertCurrency.toBase(confirmed.fee, currency, canonicalNetwork)
      : 0n;

    const confirmedPayload = confirmed as any;
    const confirmedRecipientAddress =
      confirmedPayload.recipient?.details?.address ??
      confirmedPayload.recipient?.address ??
      confirmedPayload.recipient_address ??
      confirmedPayload.address ??
      withdrawal.recipientAddress ??
      transaction.receiverWalletAddress ??
      null;
    const confirmedDestinationTag =
      confirmedPayload.recipient?.details?.destination_tag ??
      confirmedPayload.destination_tag ??
      withdrawal.destinationTag ??
      null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (isCompany) {
          // Company withdrawal (sweep): crypto moved from subaccount to main account.
          // On success, add the swept amount to company liquidity so it's available
          // for future user withdrawals.
          if (event === 'withdraw.successful') {
            await this.companyLiquidityService.addLiquidity(
              currency,
              amountBase,
              tx,
            );
          }

          await tx.companyWithdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status:
                event === 'withdraw.successful'
                  ? WithdrawalStatus.SUCCESS
                  : WithdrawalStatus.FAILED,
              amountBase: amountBase.toString(),
              fee: confirmed.fee ?? undefined,
              total: confirmed.total ?? undefined,
              txHash: confirmed.txid ?? undefined,
              providerResponse: confirmed as unknown as Prisma.JsonObject,
              processedAt: new Date(),
            },
          });
        } else {
          // User withdrawal
          const wallet = await tx.wallet.findFirst({
            where: {
              userId,
              currency: { equals: currency, mode: 'insensitive' },
            },
          });
          if (!wallet)
            throw new NotFoundException(
              `Wallet not found for user ${userId} - ${currency}`,
            );

          // Update withdrawal record
          await tx.withdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status:
                event === 'withdraw.successful'
                  ? WithdrawalStatus.SUCCESS
                  : WithdrawalStatus.FAILED,
              amount: confirmed.amount,
              fee: confirmed.fee,
              total: confirmed.total,
              txHash: confirmed.txid ?? undefined,
              rawPayload: confirmed as unknown as Prisma.JsonObject,
              completedAtProvider: confirmed.done_at ?? new Date(),
              network,
              currency,
              transactionNote:
                confirmed.transaction_note ?? withdrawal.transactionNote,
              narration: confirmed.narration ?? withdrawal.narration,
              recipientAddress: confirmedRecipientAddress ?? undefined,
              destinationTag: confirmedDestinationTag ?? undefined,
            },
          });

          if (event === 'withdraw.successful') {
            // SUCCESS: deduct totalAmountSentBase from baseBalance
            // (includes requested + networkFee + platformFee — user pays all)
            // and release the same amount from reservedBalance.
            const deductionDec = toDecimal(totalAmountSentBase);

            // Atomic baseBalance deduction with underflow protection
            const walletUpdates = await tx.$queryRaw<{ baseBalance: string }[]>`
              UPDATE "wallets"
              SET "baseBalance" = "baseBalance" - ${deductionDec},
                  "reservedBalance" = "reservedBalance" - ${deductionDec}
              WHERE "id" = ${wallet.id}
                AND "baseBalance" >= ${deductionDec}
                AND "reservedBalance" >= ${deductionDec}
              RETURNING "baseBalance"
            `;
            if (walletUpdates.length === 0) {
              throw new Error(
                `Withdrawal ${reference}: insufficient reserved ${currency} balance to finalize`,
              );
            }
            const [{ baseBalance: newBaseStr }] = walletUpdates;

            // Update originalBalance from the actual post-update baseBalance
            const newOriginalBalance = ConvertCurrency.fromBase(
              BigInt(String(newBaseStr)),
              currency,
              wallet.defaultNetwork as CryptoNetwork,
            );
            await tx.$executeRaw`
              UPDATE "wallets"
              SET "originalBalance" = ${newOriginalBalance}
              WHERE "id" = ${wallet.id}
            `;

            // Update company internal balance (user wallet was debited)
            // Only subtract amount sent to provider (excluding platform fee which is company revenue)
            const amountSentToProvider = totalAmountSentBase - platformFeeBase;
            const amountSentToProviderDec = toDecimal(amountSentToProvider);
            await this.companyLiquidityService.updateInternalBalance(
              currency.toLowerCase(),
              amountSentToProviderDec,
              'subtract',
              tx,
            );

            // Company liquidity: only the amount that actually left the company
            // (requested + networkFee) should be consumed from totalBalance.
            // The platform fee stays as company revenue — it was already in
            // totalBalance, so we just release it from reservedBalance.

            const consumed =
              await this.companyLiquidityService.consumeReservedLiquidity(
                currency,
                amountSentToProvider,
                tx,
              );
            if (!consumed) {
              this.logger.error(
                `Withdrawal ${reference}: consumeReservedLiquidity failed — reserved or total balance insufficient for ${currency}`,
              );
              throw new Error(
                `Company liquidity consumption failed for ${reference}`,
              );
            }

            // Release platform fee from reserved (stays in totalBalance as revenue)
            if (platformFeeBase > 0n) {
              await this.companyLiquidityService.releaseLiquidity(
                currency,
                platformFeeBase,
                tx,
              );
            }
          } else {
            // REJECTED: release the reserved balance back to available
            await this.transactionService.releaseBalance(
              tx,
              userId,
              currency,
              totalAmountSentBase,
            );

            // Release company liquidity reservation
            await this.companyLiquidityService.releaseLiquidity(
              currency,
              totalAmountSentBase,
              tx,
            );
          }

          // Update transaction with Quidax-confirmed values
          // Keep totalAmountSentBase as-is (it includes platformFee, set at creation)
          if (transaction.id) {
            await tx.transaction.update({
              where: { id: transaction.id },
              data: {
                status:
                  event === 'withdraw.successful'
                    ? TransactionStatus.COMPLETED
                    : TransactionStatus.FAILED,
                isProcessed: true,
                networkFeeBase: toDecimal(feeBase),
                networkFeeOriginal: confirmed.fee,
                executedCryptoAmountBase: toDecimal(amountBase),
                receiverWalletAddress: confirmedRecipientAddress ?? undefined,
                executionPrice: confirmed.amount,
                executedAt: confirmed.done_at
                  ? new Date(confirmed.done_at)
                  : new Date(),
              },
            });
          }

          // Track user's total amount sent (NGN equivalent)
          if (toBigInt(transaction.fiatAmountBase) > 0n) {
            const fiatAmountDec = toDecimal(
              toBigInt(transaction.fiatAmountBase),
            );
            await tx.$executeRaw`
              UPDATE "users"
              SET "amountSent" = "amountSent" + ${fiatAmountDec}
              WHERE "id" = ${userId}
            `;
          }
        }
      });

      if (transaction.id) {
        try {
          const updatedTransaction = await this.prisma.transaction.findUnique({
            where: { id: transaction.id },
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

          if (updatedTransaction) {
            this.transactionNotificationService.sendTransactionStatusNotification(
              updatedTransaction,
            );
          }
        } catch (notifyErr: any) {
          this.logger.error(
            `Failed to send notification for withdrawal ${reference}: ${notifyErr?.message}`,
          );
        }
      }
      if (event === 'withdraw.successful') {
        await this.transactionService.syncCompanyLiquidityCache();
      }
    } catch (error: any) {
      if (isTransientPrismaError(error)) {
        this.logger.error(
          `Transient DB error processing withdrawal ${reference}: ${error?.message}`,
        );
        throw error; // Let BullMQ retry
      }

      this.logger.error(
        `Failed to process withdrawal ${reference}: ${error?.message}`,
      );
      if (isCompany) {
        const failedReason =
          typeof error?.message === 'string'
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error?.message ?? error ?? 'Unknown error');
        const providerResponse = error?.response
          ? JSON.stringify(error.response)
          : null;
        try {
          await this.prisma.companyWithdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: WithdrawalStatus.FAILED,
              failedReason,
              providerResponse: providerResponse as Prisma.InputJsonValue,
              processedAt: new Date(),
            },
          });
        } catch (updateErr: any) {
          this.logger.error(
            `Failed to update company withdrawal ${reference} to FAILED: ${updateErr?.message}`,
          );
        }
      } else {
        try {
          await this.prisma.withdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: WithdrawalStatus.FAILED,
              reason: error?.message ?? 'Unknown error',
              completedAtProvider: new Date(),
            },
          });
        } catch (updateErr: any) {
          this.logger.error(
            `Failed to update withdrawal ${reference} to FAILED: ${updateErr?.message}`,
          );
        }
      }
      return;
    }

    // Queue dashboard update only for user withdrawals
    if (!isCompany) {
      // Compute NGN equivalent for dashboard
      // Use totalAmountSentBase (requested + networkFee + platformFee) — this is
      // what the user actually paid, not confirmed.amount which excludes fees.
      let ngnAmountBase = 0n;
      try {
        const cryptoNgnPrice = await this.tickerService.getPrice(
          `${currency.toLowerCase()}ngn`,
        );
        if (cryptoNgnPrice && parseFloat(cryptoNgnPrice) > 0) {
          const totalDeductedHuman = ConvertCurrency.fromBase(
            totalAmountSentBase,
            currency,
            canonicalNetwork,
          );
          const ngnValue = new Decimal(cryptoNgnPrice).mul(
            new Decimal(totalDeductedHuman),
          );
          ngnAmountBase = ConvertCurrency.toBase(
            ngnValue.toFixed(2),
            'ngn',
            undefined,
          );
        }
      } catch (priceErr: any) {
        this.logger.warn(
          `Failed to compute NGN equivalent for withdrawal ${reference}: ${priceErr?.message}`,
        );
      }

      try {
        await this.dashboardStatsQueueService.queueTransactionUpdate({
          id: reference,
          userId,
          currency,
          nairaAmountBase: ngnAmountBase.toString(),
          status:
            event === 'withdraw.successful'
              ? TransactionStatus.COMPLETED
              : TransactionStatus.FAILED,
          createdAt: withdrawal.completedAtProvider ?? new Date().toISOString(),
          transactionType: TransactionType.DEBIT,
          transactionContext: TransactionContext.WITHDRAWAL,
          senderWalletAddress: null,
          receiverWalletAddress: confirmedRecipientAddress,
          network,
        });
      } catch (error: any) {
        this.logger.error(
          `Failed to queue dashboard stats for withdrawal ${reference}: ${error?.message}`,
        );
      }
    }

    this.logger.log(
      `${event === 'withdraw.successful' ? 'Successful' : 'Rejected'} withdrawal processed for reference: ${reference}`,
    );
  }
}
