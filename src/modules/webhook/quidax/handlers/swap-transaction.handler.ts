import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  TransactionContext,
  TransactionStatus,
  TransactionType,
  VaultStatus,
  AutoStackStatus,
  PaymentType,
} from '../../../../infrastructure/databases/prisma/generated/prisma/client';
import {
  ConvertCurrency,
  CryptoNetwork,
  toBigInt,
  toDecimal,
  LiquidityReservationStatus,
} from '../../../../shared';
import { DashboardStatsQueueService } from '../../../dashboard/dashboard-stats-queue';
import { CompanyLiquidityService } from '../../../../modules/transaction/services/company-liquidity.service';
import { TransactionService } from '../../../../modules/transaction/services/transaction.service';
import { QuidaxSwapService } from '../../../../infrastructure/providers/quidax';
import { QuidaxTickerService } from '../../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import Decimal from 'decimal.js';
import { SwapWebhookDataDto } from '../dtos/swap-webhook.dto';
import { TransactionNotificationService } from '../../../../modules/transaction/services/transaction-notification.service';
import { Prisma } from '../../../../infrastructure/databases/prisma/generated/prisma/browser';
import { QUIDAX_COMPANY_USERID } from '../../../transaction/constants';
import { VAULT_TRANSACTION_FEE } from '../../../transaction/constants';

@Injectable()
export class SwapTransactionHandler {
  private readonly logger = new Logger(SwapTransactionHandler.name);
  private readonly terminalSwapStatuses = new Set<string>([
    TransactionStatus.COMPLETED,
    TransactionStatus.FAILED,
    'completed',
    'failed',
    'reversed',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quidaxSwapService: QuidaxSwapService,
    private readonly companyLiquidityService: CompanyLiquidityService,
    private readonly dashboardStatsQueueService: DashboardStatsQueueService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly tickerService: QuidaxTickerService,
    private readonly transactionService: TransactionService,
  ) {}

  async process(data: SwapWebhookDataDto, event: string): Promise<void> {
    const swapId = data.id;
    this.logger.log(`Swap webhook received: ${event} | swapId: ${swapId}`);

    // Initial read (non-transactional) – fast path for already-terminal swaps
    let swapRecord = await this.prisma.swapTransaction.findFirst({
      where: { swapId },
      select: {
        id: true,
        status: true,
        userId: true,
        fromCurrency: true,
        toCurrency: true,
        toAmountOriginal: true,
        quoteId: true,
        description: true,
      },
    });

    if (!swapRecord) {
      this.logger.error(`No SwapTransaction found for swapId: ${swapId}`);
      return;
    }

    if (this.terminalSwapStatuses.has(String(swapRecord.status))) {
      this.logger.warn(
        `Swap ${swapRecord.id} already terminal (${swapRecord.status}) — skipping`,
      );
      return;
    }

    const userId = swapRecord.userId;

    // === VAULT SWAP PATH ===
    if (swapRecord.description?.startsWith('vault_swap:')) {
      return this.processVaultSwapCompletion(swapRecord!, data, event);
    }

    // === REGULAR SWAP PATH ===
    return this.processRegularSwap(swapRecord!, data, event);
  }

  private async processVaultSwapFailure(
    swapRecord: any,
    data: SwapWebhookDataDto,
    event: string,
    vaultId: string,
  ): Promise<void> {
    const failureEvents = new Set([
      'swap_transaction.failed',
      'swap_transaction.reversed',
      'swap_transaction.cancelled',
      'swap_transaction.canceled',
    ]);
    if (!failureEvents.has(event)) {
      this.logger.log(`Ignoring non-terminal vault swap event ${event}`);
      return;
    }

    const isReversal = event === 'swap_transaction.reversed';
    await this.prisma.$transaction(
      async (tx) => {
        const vault = await tx.vault.findUnique({
          where: { id: vaultId },
          select: { id: true, amountLocked: true, status: true },
        });
        if (!vault || vault.status === VaultStatus.TERMINATED) return;

        const linkedTx = await tx.transaction.findFirst({
          where: {
            transactionUniqueId: data.id,
            transactionContext: TransactionContext.VAULT_SWAP,
            userId: swapRecord.userId,
          },
          select: { id: true, totalAmountSentBase: true, status: true },
        });

        if (linkedTx?.status !== TransactionStatus.FAILED) {
          const reservedBtc = linkedTx?.totalAmountSentBase
            ? BigInt(linkedTx.totalAmountSentBase.toFixed(0))
            : 0n;
          if (reservedBtc > 0n) {
            await this.transactionService.releaseBalance(
              tx,
              swapRecord.userId,
              'BTC',
              reservedBtc,
            );
          }

          if (linkedTx) {
            await tx.transaction.update({
              where: { id: linkedTx.id },
              data: {
                status: TransactionStatus.FAILED,
                isProcessed: true,
                description: isReversal
                  ? 'Vault BTC swap reversed before funding vault'
                  : 'Vault BTC swap failed before funding vault',
              },
            });
          }
        }

        const expectedUsdtMinor = swapRecord.toAmountOriginal
          ? ConvertCurrency.toBase(String(swapRecord.toAmountOriginal), 'USDT')
          : BigInt(vault.amountLocked.toFixed(0));
        if (expectedUsdtMinor > 0n) {
          const usdtLiquidity = await tx.companyLiquidity.findFirst({
            where: { currency: { equals: 'USDT', mode: 'insensitive' } },
            select: { reservedBalance: true },
          });
          const reservedUsdt = usdtLiquidity
            ? toBigInt(usdtLiquidity.reservedBalance)
            : 0n;
          if (reservedUsdt >= expectedUsdtMinor) {
            await this.companyLiquidityService.releaseLiquidity(
              'USDT',
              expectedUsdtMinor,
              tx,
            );
          }
        }

        await tx.vault.update({
          where: { id: vaultId },
          data: { status: VaultStatus.TERMINATED },
        });
        await tx.swapTransaction.update({
          where: { id: swapRecord.id },
          data: {
            status: isReversal ? 'reversed' : TransactionStatus.FAILED,
            receivedAmountOriginal: data.received_amount,
            confirmed: false,
            updatedAt: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Vault-specific completion (BTC → USDT for vault activation) */
  private async processVaultSwapCompletion(
    swapRecord: any,
    data: SwapWebhookDataDto,
    event: string,
  ): Promise<void> {
    const swapId = data.id;
    const vaultId = swapRecord.description.replace('vault_swap:', '');

    if (event !== 'swap_transaction.completed') {
      await this.processVaultSwapFailure(swapRecord, data, event, vaultId);
      return;
    }

    await this.prisma.$transaction(
      async (tx) => {
        // Idempotency check: if vault is already MATURED/COMPLETED, skip
        const existingVault = await tx.vault.findUnique({
          where: { id: vaultId },
          select: { status: true },
        });
        if (
          existingVault?.status &&
          existingVault.status !== VaultStatus.ACTIVE &&
          existingVault.status !== VaultStatus.PENDING
        ) {
          this.logger.warn(
            `Vault ${vaultId} already ${existingVault.status} — skipping idempotently`,
          );
          return;
        }

        // Fetch linked vault transaction (the original BTC debit)
        const linkedTx = await tx.transaction.findFirst({
          where: {
            transactionUniqueId: swapId,
            transactionContext: TransactionContext.VAULT_SWAP,
            userId: swapRecord.userId,
          },
        });

        // If linked transaction already completed, skip
        if (linkedTx?.status === TransactionStatus.COMPLETED) {
          this.logger.warn(
            `Linked transaction ${linkedTx.id} already COMPLETED — skipping idempotently`,
          );
          return;
        }

        // Lock vault and linked transaction early
        const vault = await tx.vault.findUnique({
          where: { id: vaultId },
          select: {
            id: true,
            amountLocked: true,
            totalGain: true,
            maturityDate: true,
            requestedAt: true,
            interestRatePerAnum: true,
            currencyId: true,
            cryptoCurrency: { select: { symbol: true } },
          },
        });

        if (!vault) {
          this.logger.error(`Vault ${vaultId} not found`);
          throw new Error(`Vault ${vaultId} not found`);
        }

        const expectedUsdtMinor = swapRecord.toAmountOriginal
          ? ConvertCurrency.toBase(String(swapRecord.toAmountOriginal), 'USDT')
          : BigInt(vault.amountLocked.toFixed(0));
        const receivedUsdtMinor = ConvertCurrency.toBase(
          data.received_amount,
          'USDT',
        );
        const differenceMinor = receivedUsdtMinor - expectedUsdtMinor;

        if (receivedUsdtMinor < expectedUsdtMinor) {
          await tx.vault.update({
            where: { id: vaultId },
            data: { status: 'TERMINATED' as any },
          });

          const usdtLiquidity = await tx.companyLiquidity.findFirst({
            where: { currency: { equals: 'USDT', mode: 'insensitive' } },
            select: { reservedBalance: true },
          });
          const reservedUsdt = usdtLiquidity
            ? toBigInt(usdtLiquidity.reservedBalance)
            : 0n;

          if (reservedUsdt >= expectedUsdtMinor) {
            await this.companyLiquidityService.releaseLiquidity(
              'USDT',
              expectedUsdtMinor,
              tx,
            );
          } else {
            this.logger.warn(
              `Skipping vault ${vaultId} USDT liquidity release: reserved ${reservedUsdt} < expected ${expectedUsdtMinor}`,
            );
          }

          if (linkedTx) {
            await this.transactionService.releaseBalance(
              tx,
              swapRecord.userId,
              'BTC',
              BigInt(linkedTx.totalAmountSentBase.toFixed(0)),
            );
            await tx.transaction.update({
              where: { id: linkedTx.id },
              data: {
                status: TransactionStatus.FAILED,
                description: 'Swap received below principal threshold',
              },
            });
          }
          await tx.swapTransaction.update({
            where: { id: swapRecord.id },
            data: {
              status: TransactionStatus.FAILED,
              receivedAmountOriginal: data.received_amount,
              confirmed: false,
              updatedAt: new Date(),
            },
          });
          this.logger.warn(
            `Terminated vault ${vaultId}: received ${receivedUsdtMinor} < required ${expectedUsdtMinor}`,
          );
          return;
        }

        // Lock wallets
        const [userUsdtWallet, btcWallet] = await Promise.all([
          tx.wallet.findFirst({
            where: {
              userId: swapRecord.userId,
              currency: { equals: 'USDT', mode: 'insensitive' },
            },
          }),
          tx.wallet.findFirst({
            where: {
              userId: swapRecord.userId,
              currency: { equals: 'BTC', mode: 'insensitive' },
            },
          }),
        ]);

        if (!userUsdtWallet || !btcWallet) {
          throw new Error('Required wallets missing for vault swap');
        }

        const totalBtcChargeMinor = linkedTx
          ? BigInt(linkedTx.totalAmountSentBase.toFixed(0))
          : 0n;

        // === BTC Wallet: final deduction with atomic RETURNING update ===
        const btcWalletUpdates = await tx.$queryRaw<{ baseBalance: string }[]>`
          UPDATE "wallets"
          SET
            "baseBalance" = "baseBalance" - ${toDecimal(totalBtcChargeMinor)},
            "reservedBalance" = "reservedBalance" - ${toDecimal(totalBtcChargeMinor)}
          WHERE "id" = ${btcWallet.id}
            AND "baseBalance" >= ${toDecimal(totalBtcChargeMinor)}
            AND "reservedBalance" >= ${toDecimal(totalBtcChargeMinor)}
          RETURNING "baseBalance"
        `;
        if (btcWalletUpdates.length === 0) {
          throw new Error(
            `Vault swap ${swapId}: insufficient reserved BTC balance to finalize`,
          );
        }
        const [{ baseBalance: newBtcBaseStr }] = btcWalletUpdates;
        const newBtcOriginalBalance = ConvertCurrency.fromBase(
          BigInt(String(newBtcBaseStr)),
          'BTC',
        );
        await tx.$executeRaw`
          UPDATE "wallets"
          SET "originalBalance" = ${newBtcOriginalBalance}
          WHERE "id" = ${btcWallet.id}
        `;

        await this.companyLiquidityService.updateInternalBalance(
          'BTC',
          toDecimal(totalBtcChargeMinor),
          'subtract',
          tx,
        );

        // USDT: credit surplus to base, principal to locked atomically
        const durationDays = Math.max(
          1,
          Math.ceil(
            (new Date(vault.maturityDate).getTime() -
              new Date(vault.requestedAt).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );
        const totalGainMinor = BigInt(
          new Decimal(expectedUsdtMinor.toString())
            .mul(new Decimal(vault.interestRatePerAnum.toString()))
            .mul(durationDays)
            .div(36500)
            .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
            .toFixed(0),
        );
        const totalPayoutBeforeFee = expectedUsdtMinor + totalGainMinor;
        const transactionFeeMinor =
          (totalPayoutBeforeFee *
            BigInt(Math.floor(VAULT_TRANSACTION_FEE * 10000))) /
          1000000n;
        const amountToReceiveMinor = totalPayoutBeforeFee - transactionFeeMinor;

        const [{ baseBalance: newUsdtBaseStr }] = await tx.$queryRaw<
          { baseBalance: string }[]
        >`
          UPDATE "wallets"
          SET "baseBalance" = "baseBalance" + ${toDecimal(differenceMinor)},
              "lockedAmount" = "lockedAmount" + ${toDecimal(expectedUsdtMinor)},
              "totalLockedInterest" = "totalLockedInterest" + ${toDecimal(totalGainMinor)}
          WHERE "id" = ${userUsdtWallet.id}
          RETURNING "baseBalance"
        `;
        const newUsdtOriginalBalance = ConvertCurrency.fromBase(
          BigInt(String(newUsdtBaseStr)),
          'USDT',
        );
        await tx.$executeRaw`
          UPDATE "wallets"
          SET "originalBalance" = ${newUsdtOriginalBalance}
          WHERE "id" = ${userUsdtWallet.id}
        `;

        await this.companyLiquidityService.updateInternalBalance(
          'USDT',
          toDecimal(receivedUsdtMinor),
          'add',
          tx,
        );

        const usdtLiquidity = await tx.companyLiquidity.findFirst({
          where: { currency: { equals: 'USDT', mode: 'insensitive' } },
          select: { reservedBalance: true },
        });
        const reservedUsdt = usdtLiquidity
          ? toBigInt(usdtLiquidity.reservedBalance)
          : 0n;

        if (reservedUsdt >= expectedUsdtMinor) {
          await this.companyLiquidityService.releaseLiquidity(
            'USDT',
            expectedUsdtMinor,
            tx,
          );
        } else {
          this.logger.warn(
            `Skipping vault ${vaultId} USDT liquidity release: reserved ${reservedUsdt} < expected ${expectedUsdtMinor}`,
          );
        }

        // Update company liquidity: USDT vault principal + interest are now locked
        await tx.$executeRaw`
          UPDATE "company_liquidity"
          SET "totalLockedPrincipal" = "totalLockedPrincipal" + ${expectedUsdtMinor.toString()}::decimal,
              "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${totalGainMinor.toString()}::decimal
          WHERE LOWER("currency") = LOWER('USDT')
        `;

        const usdtCrypto = await tx.cryptoCurrency.findUnique({
          where: { symbol: 'USDT' },
          select: { id: true },
        });

        // Get execution price from the swap transaction (BTC/USDT rate)
        const executionPrice = data.execution_price;
        const rateDecimal = executionPrice ? new Decimal(executionPrice) : null;

        await tx.vault.update({
          where: { id: vaultId },
          data: {
            status: VaultStatus.ACTIVE,
            currencyId: usdtCrypto?.id,
            amountLocked: toDecimal(expectedUsdtMinor),
            totalGain: toDecimal(totalGainMinor),
            transactionFee: toDecimal(transactionFeeMinor),
            amountToReceive: toDecimal(amountToReceiveMinor),
            ...(rateDecimal && { rate: rateDecimal }),
          },
        });

        if (linkedTx) {
          await tx.transaction.update({
            where: { id: linkedTx.id },
            data: {
              status: TransactionStatus.COMPLETED,
              isProcessed: true,
              executedAt: new Date(),
              description: `Vault funded via BTC swap: ${data.from_amount} BTC → ${data.received_amount} USDT`,
            },
          });
        }
        await tx.swapTransaction.update({
          where: { id: swapRecord.id },
          data: {
            status: TransactionStatus.COMPLETED,
            receivedAmountOriginal: data.received_amount,
            confirmed: true,
            updatedAt: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.queueDashboard(
      swapId,
      swapRecord.userId,
      'USDT',
      event,
      data.updated_at,
    );

    this.logger.log(`Activated vault ${vaultId} for swap ${swapId}`);
  }

  /** Regular user-initiated swap (any → any) */

  private frequencyDays(frequency?: string): number {
    if (frequency === 'WEEKLY') return 7;
    if (frequency === 'MONTHLY') return 30;
    return 1;
  }

  private async processRegularSwap(
    swapRecord: any,
    data: SwapWebhookDataDto,
    event: string,
  ): Promise<void> {
    const swapId = data.id;
    const userId = swapRecord.userId;
    const fromCurrency = swapRecord.fromCurrency.toUpperCase();
    const toCurrency = swapRecord.toCurrency.toUpperCase();

    const [fromWallet, toWallet] = await Promise.all([
      this.prisma.wallet.findFirst({
        where: {
          userId,
          currency: { equals: fromCurrency, mode: 'insensitive' },
        },
        select: { id: true, defaultNetwork: true },
      }),
      this.prisma.wallet.findFirst({
        where: {
          userId,
          currency: { equals: toCurrency, mode: 'insensitive' },
        },
        select: { id: true, defaultNetwork: true },
      }),
    ]);

    if (!fromWallet || !toWallet) {
      this.logger.error(`Missing wallet(s) for swap ${swapId}`);
      return;
    }

    const fromNet = fromWallet.defaultNetwork as CryptoNetwork | undefined;
    const toNet = toWallet.defaultNetwork as CryptoNetwork | undefined;

    let linkedTx = await this.prisma.transaction.findFirst({
      where: {
        transactionUniqueId: swapId,
        transactionContext: TransactionContext.SWAP,
        transactionType: TransactionType.DEBIT,
        userId,
      },
      select: {
        id: true,
        cryptoAmountBase: true,
        platformFeeBase: true,
        paymentMetadata: true,
        transactionContext: true,
      },
    });

    if (!linkedTx) {
      linkedTx = await this.prisma.transaction.findFirst({
        where: {
          transactionContext: TransactionContext.AUTOSTACK,
          transactionType: TransactionType.DEBIT,
          transactionUniqueId: swapRecord.quoteId || undefined,
          userId,
        },
        select: {
          id: true,
          cryptoAmountBase: true,
          platformFeeBase: true,
          paymentMetadata: true,
          transactionContext: true,
        },
      });
    }

    const exactFromMinorBooked = linkedTx
      ? toBigInt(linkedTx.cryptoAmountBase)
      : ConvertCurrency.toBase(data.from_amount, fromCurrency);

    const txFeeBase = linkedTx ? toBigInt(linkedTx.platformFeeBase ?? 0) : 0n;

    const reservedAmount = linkedTx
      ? toBigInt(linkedTx.cryptoAmountBase) + txFeeBase
      : exactFromMinorBooked;

    if (
      event === 'swap_transaction.reversed' ||
      event === 'swap_transaction.failed'
    ) {
      await this.handleFailureOrReversal(
        event,
        swapId,
        swapRecord.id,
        userId,
        fromCurrency,
        toCurrency,
        fromWallet.id,
        linkedTx?.id ?? null,
        reservedAmount,
        exactFromMinorBooked,
        data.from_amount,
      );

      await this.queueDashboard(
        swapId,
        userId,
        toCurrency,
        event,
        data.updated_at,
      );
      return;
    }

    // === SUCCESS PATH: Confirm with Quidax first (outside tx) ===
    let confirmedFromAmount: string;
    let confirmedToAmount: string;
    let confirmedExecutionPrice: string;

    try {
      const quidaxRes = await this.quidaxSwapService.getSwapTransaction(
        { user_id: QUIDAX_COMPANY_USERID, swap_transaction_id: swapId },
        { skipCircuitBreaker: true },
      );

      const confirmed = quidaxRes?.data;
      if (!confirmed?.id || confirmed.status !== 'completed') {
        this.logger.warn(`Swap ${swapId} not yet completed on Quidax`);
        return;
      }

      confirmedFromAmount = confirmed.from_amount;
      confirmedToAmount = confirmed.received_amount;
      confirmedExecutionPrice = confirmed.execution_price;
    } catch (err: any) {
      this.logger.error(`Failed to confirm swap ${swapId} with Quidax`, err);
      throw err;
    }

    const confirmedFromBase = ConvertCurrency.toBase(
      confirmedFromAmount,
      fromCurrency,
    );
    const confirmedToBase = ConvertCurrency.toBase(
      confirmedToAmount,
      toCurrency,
    );

    // === Atomic Ledger Update ===
    const processed = await this.prisma.$transaction(
      async (tx) => {
        const [freshSwap] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"
          FROM "swaptransactions"
          WHERE "id" = ${swapRecord.id}
          FOR UPDATE
        `;

        if (!freshSwap) {
          this.logger.warn(
            `Swap ${swapRecord.id} disappeared during processing`,
          );
          return false;
        }

        if (this.terminalSwapStatuses.has(String(freshSwap.status))) {
          this.logger.warn(
            `Swap ${swapRecord.id} already terminal (${freshSwap.status}) during locked processing — skipping`,
          );
          return false;
        }

        if (linkedTx) {
          const [freshLinkedTx] = await tx.$queryRaw<
            { status: TransactionStatus }[]
          >`
            SELECT "status"
            FROM "transactions"
            WHERE "id" = ${linkedTx.id}
            FOR UPDATE
          `;

          if (
            freshLinkedTx?.status === TransactionStatus.COMPLETED ||
            freshLinkedTx?.status === TransactionStatus.FAILED
          ) {
            this.logger.warn(
              `Linked transaction ${linkedTx.id} already ${freshLinkedTx.status} during locked swap processing — skipping`,
            );
            return false;
          }
        }

        const fromDec = toDecimal(confirmedFromBase);
        const reservedDec = toDecimal(reservedAmount);
        const toDec = toDecimal(confirmedToBase);
        const linkedMeta = (linkedTx?.paymentMetadata || {}) as Record<
          string,
          any
        >;
        const isAutoStackSwap =
          linkedTx?.transactionContext === TransactionContext.AUTOSTACK &&
          String(linkedMeta.paymentType || '').toUpperCase() ===
            PaymentType.CRYPTO_WALLET &&
          linkedMeta.autoStackId;

        if (
          isAutoStackSwap &&
          (linkedMeta.autostackWebhookProcessedAt ||
            linkedMeta.autostackSettlement === 'swap_completed' ||
            linkedMeta.liquidityReservationStatus ===
              LiquidityReservationStatus.RELEASED)
        ) {
          this.logger.warn(
            `Autostack swap ${swapRecord.id} already settled for stack ${linkedMeta.autoStackId} — skipping`,
          );
          return false;
        }

        // FROM wallet: deduct full reserved amount and reconcile originalBalance
        const fromWalletUpdates = await tx.$queryRaw<{ baseBalance: string }[]>`
          UPDATE "wallets"
          SET "baseBalance" = "baseBalance" - ${reservedDec},
              "reservedBalance" = "reservedBalance" - ${reservedDec}
          WHERE "id" = ${fromWallet.id}
            AND "baseBalance" >= ${reservedDec}
            AND "reservedBalance" >= ${reservedDec}
          RETURNING "baseBalance"
        `;
        if (fromWalletUpdates.length === 0) {
          throw new Error(
            `Swap ${swapId}: insufficient reserved ${fromCurrency} balance to finalize`,
          );
        }
        const [{ baseBalance: newFromBaseStr }] = fromWalletUpdates;
        const newFromOriginalBalance = ConvertCurrency.fromBase(
          BigInt(String(newFromBaseStr)),
          fromCurrency,
        );
        await tx.$executeRaw`
          UPDATE "wallets"
          SET "originalBalance" = ${newFromOriginalBalance}
          WHERE "id" = ${fromWallet.id}
        `;

        await this.companyLiquidityService.updateInternalBalance(
          fromCurrency.toLowerCase(),
          fromDec,
          'subtract',
          tx,
        );

        if (!isAutoStackSwap) {
          const [{ baseBalance: newToBaseStr }] = await tx.$queryRaw<
            { baseBalance: string }[]
          >`
            UPDATE "wallets"
            SET "baseBalance" = "baseBalance" + ${toDec}
            WHERE "id" = ${toWallet.id}
            RETURNING "baseBalance"
          `;

          const newToOriginalBalance = ConvertCurrency.fromBase(
            BigInt(String(newToBaseStr)),
            toCurrency,
          );

          await tx.$executeRaw`
            UPDATE "wallets"
            SET "originalBalance" = ${newToOriginalBalance}
            WHERE "id" = ${toWallet.id}
          `;

          await this.companyLiquidityService.updateInternalBalance(
            toCurrency.toLowerCase(),
            toDec,
            'add',
            tx,
          );
        }

        if (linkedTx) {
          await tx.transaction.update({
            where: { id: linkedTx.id },
            data: {
              status: TransactionStatus.COMPLETED,
              isProcessed: true,
              fromCurrency,
              toCurrency,
              cryptoAmountBase: fromDec,
              cryptoAmountOriginal: confirmedFromAmount,
              executedCryptoAmountBase: fromDec,
              executionPrice: confirmedExecutionPrice,
              executedAt: data.updated_at
                ? new Date(data.updated_at)
                : new Date(),
              description: `Swap completed: ${confirmedFromAmount} ${fromCurrency} → ${confirmedToAmount} ${toCurrency}`,
            },
          });

          const meta = (linkedTx.paymentMetadata || {}) as Record<string, any>;
          if (
            linkedTx.transactionContext === TransactionContext.AUTOSTACK &&
            String(meta.paymentType || '').toUpperCase() ===
              PaymentType.CRYPTO_WALLET &&
            meta.autoStackId
          ) {
            const autoStack = await tx.autoStack.findUnique({
              where: { id: String(meta.autoStackId) },
            });
            const usdtWallet = await tx.wallet.findFirst({
              where: { userId, currency: 'USDT' },
            });
            if (autoStack && usdtWallet) {
              const settledAt = data.updated_at
                ? new Date(data.updated_at)
                : new Date();
              const principal = toDecimal(confirmedToBase);
              const nextExecutionAt = new Date(settledAt);
              if (autoStack.frequency === 'DAILY')
                nextExecutionAt.setUTCDate(nextExecutionAt.getUTCDate() + 1);
              if (autoStack.frequency === 'WEEKLY')
                nextExecutionAt.setUTCDate(nextExecutionAt.getUTCDate() + 7);
              if (autoStack.frequency === 'MONTHLY')
                nextExecutionAt.setUTCMonth(nextExecutionAt.getUTCMonth() + 1);
              const nextInterestAt = new Date(settledAt);
              nextInterestAt.setUTCDate(
                nextInterestAt.getUTCDate() +
                  this.frequencyDays(String(autoStack.frequency)),
              );
              await tx.wallet.update({
                where: { id: usdtWallet.id },
                data: { stackedAmount: { increment: principal } },
              });
              await tx.autoStack.update({
                where: { id: autoStack.id },
                data: {
                  amount:
                    String(autoStack.status) === AutoStackStatus.PENDING
                      ? principal
                      : { increment: principal },
                  lastExecutedAt: settledAt,
                  nextExecutionAt,
                  nextInterestAt,
                  status: AutoStackStatus.ACTIVE,
                },
              });
              await this.companyLiquidityService.updateInternalBalance(
                toCurrency,
                principal,
                'add',
                tx,
              );
              await tx.$executeRaw`
                UPDATE "company_liquidity"
                SET "totalAmountStacked" = "totalAmountStacked" + ${principal}
                WHERE LOWER("currency") = LOWER(${toCurrency})
              `;
              const consumedSourceLiquidity =
                await this.companyLiquidityService.consumeReservedLiquidity(
                  fromCurrency,
                  exactFromMinorBooked,
                  tx,
                );
              if (!consumedSourceLiquidity) {
                throw new Error(
                  `Autostack swap ${swapRecord.id}: unable to consume reserved ${fromCurrency} liquidity`,
                );
              }
              await tx.transaction.update({
                where: { id: linkedTx.id },
                data: {
                  paymentMetadata: {
                    ...meta,
                    liquidityReservationStatus:
                      LiquidityReservationStatus.CONSUMED,
                    liquidityConsumedAt: new Date().toISOString(),
                    liquidityConsumedReason: 'autostack_swap_completed',
                    actualReceivedAmountBase: confirmedToBase.toString(),
                    actualReceivedAmountOriginal: confirmedToAmount,
                    principalUsdtAmountBase: confirmedToBase.toString(),
                    principalUsdtAmount: confirmedToAmount,
                    autostackWebhookProcessedAt: new Date().toISOString(),
                    autostackInitiationStatus: 'COMPLETED',
                    autostackSettlement: 'swap_completed',
                  } as Prisma.InputJsonValue,
                },
              });
            }
          }
        }

        await tx.swapTransaction.update({
          where: { id: swapRecord.id },
          data: {
            status: TransactionStatus.COMPLETED,
            confirmed: true,
            executionPriceOriginal: confirmedExecutionPrice,
            receivedAmountOriginal: confirmedToAmount,
            amountOriginal: confirmedFromAmount,
            updatedAt: new Date(),
          },
        });

        // Credit side transaction (idempotent)
        const creditTxId = `${swapId}-credit`;
        const existingCredit = await tx.transaction.findUnique({
          where: { transactionUniqueId: creditTxId },
        });

        if (!isAutoStackSwap && !existingCredit) {
          await tx.transaction.create({
            data: {
              userId,
              receiverWalletId: toWallet.id,
              transactionUniqueId: creditTxId,
              currency: toCurrency,
              network: toNet || null,
              transactionType: TransactionType.CREDIT,
              transactionContext: TransactionContext.SWAP,
              fromCurrency,
              toCurrency,
              cryptoAmountBase: toDec,
              cryptoAmountOriginal: confirmedToAmount,
              executedCryptoAmountBase: toDec,
              executionPrice: confirmedExecutionPrice,
              executedAt: data.updated_at
                ? new Date(data.updated_at)
                : new Date(),
              fiatAmountBase: toDecimal(0n),
              fiatAmountOriginal: '0',
              description: `Swap received: ${confirmedToAmount} ${toCurrency}`,
              status: TransactionStatus.COMPLETED,
              isProcessed: true,
            },
          });
        }
        // Release from-currency reservation after successful provider swap.
        // Autostack swaps release above when the stack is activated, so avoid
        // releasing the same reservation twice.
        if (!isAutoStackSwap) {
          await this.companyLiquidityService.releaseLiquidity(
            fromCurrency,
            exactFromMinorBooked,
            tx,
          );
        }

        // Update user's amountSent (NGN equivalent)
        const swapNgnPrice = await this.tickerService.getPrice(
          `${fromCurrency.toLowerCase()}ngn`,
        );
        let swapNgnDec = toDecimal(0n);
        if (swapNgnPrice && new Decimal(swapNgnPrice).gt(0)) {
          const swapNgnValue = new Decimal(swapNgnPrice).mul(
            new Decimal(confirmedFromAmount),
          );
          const swapNgnBase = ConvertCurrency.toBase(
            swapNgnValue.toFixed(2),
            'ngn',
          );
          swapNgnDec = toDecimal(swapNgnBase);
        }

        await tx.$executeRaw`
         UPDATE "users"
         SET "amountSent" = "amountSent" + ${swapNgnDec}
         WHERE "id" = ${userId}
       `;

        return true;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );

    if (!processed) {
      return;
    }

    this.logger.log(
      `Swap ${swapId} completed: ${confirmedFromAmount} ${fromCurrency} → ${confirmedToAmount} ${toCurrency}`,
    );

    // Notification (outside transaction)
    if (linkedTx) {
      try {
        const completedTx = await this.prisma.transaction.findUnique({
          where: { id: linkedTx.id },
          select: {
            id: true,
            userId: true,
            transactionUniqueId: true,
            transactionContext: true,
            status: true,
            currency: true,
            network: true,
            cryptoAmountOriginal: true,
            fiatAmountOriginal: true,
            executedCryptoAmountBase: true,
            executedFiatAmountBase: true,
            executionPrice: true,
            executedAt: true,
            User: { select: { email: true, firstName: true } },
            paymentMetadata: true,
          },
        });

        if (completedTx) {
          this.transactionNotificationService.sendTransactionStatusNotification(
            completedTx,
          );
        }
      } catch (e) {
        this.logger.error(`Notification failed for swap ${swapId}`, e);
      }
    }

    await this.queueDashboard(
      swapId,
      userId,
      toCurrency,
      event,
      data.updated_at,
    );
  }

  // handleFailureOrReversal remains mostly the same but wrapped with Serializable
  private async handleFailureOrReversal(
    event: string,
    swapId: string,
    swapRecordId: string,
    userId: string,
    fromCurrency: string,
    toCurrency: string,
    fromWalletId: string,
    linkedTxId: string | null,
    reservedAmount: bigint,
    exactFromMinorBooked: bigint,
    fromAmountStr: string,
  ): Promise<void> {
    const isReversal = event === 'swap_transaction.reversed';

    await this.prisma.$transaction(
      async (tx) => {
        await this.transactionService.releaseBalance(
          tx,
          userId,
          fromCurrency,
          reservedAmount,
        );

        await tx.swapTransaction.update({
          where: { id: swapRecordId },
          data: {
            status: isReversal ? 'reversed' : TransactionStatus.FAILED,
            confirmed: false,
            updatedAt: new Date(),
          },
        });

        if (linkedTxId) {
          const failedLinkedTx = await tx.transaction.findUnique({
            where: { id: linkedTxId },
            select: { paymentMetadata: true, transactionContext: true },
          });
          const failedMeta = (failedLinkedTx?.paymentMetadata || {}) as Record<
            string,
            any
          >;
          const isAutoStackFailure =
            failedLinkedTx?.transactionContext === TransactionContext.AUTOSTACK;

          await tx.transaction.update({
            where: { id: linkedTxId },
            data: {
              status: TransactionStatus.FAILED,
              isProcessed: true,
              executedAt: new Date(),
              description: isReversal
                ? `Swap reversed: ${fromAmountStr} ${fromCurrency} refunded`
                : `Swap failed: ${fromAmountStr} ${fromCurrency} → ${toCurrency}`,
              paymentMetadata: {
                ...failedMeta,
                ...(isAutoStackFailure
                  ? {
                      liquidityReservationStatus:
                        LiquidityReservationStatus.RELEASED,
                      liquidityReleasedAt: new Date().toISOString(),
                      liquidityReleaseReason: isReversal
                        ? 'autostack_swap_reversed'
                        : 'autostack_swap_failed',
                      autostackInitiationStatus: 'FAILED',
                      autostackSettlement: isReversal
                        ? 'swap_reversed'
                        : 'swap_failed',
                    }
                  : {}),
              } as Prisma.InputJsonValue,
            },
          });
        }

        await this.companyLiquidityService.releaseLiquidity(
          fromCurrency,
          exactFromMinorBooked,
          tx,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.logger.warn(
      `Swap ${swapId} ${isReversal ? 'reversed' : 'failed'} — reservation released`,
    );
  }

  private async queueDashboard(
    swapId: string,
    userId: string,
    toCurrency: string,
    event: string,
    updatedAt?: string,
  ): Promise<void> {
    const statusMap: Record<string, TransactionStatus> = {
      'swap_transaction.completed': TransactionStatus.COMPLETED,
      'swap_transaction.reversed': TransactionStatus.FAILED,
      'swap_transaction.failed': TransactionStatus.FAILED,
    };

    try {
      await this.dashboardStatsQueueService.queueTransactionUpdate({
        id: swapId,
        userId,
        currency: toCurrency,
        nairaAmountBase: '0',
        status: statusMap[event] ?? TransactionStatus.PENDING,
        createdAt: updatedAt || new Date().toISOString(),
        transactionType:
          event === 'swap_transaction.completed'
            ? TransactionType.CREDIT
            : TransactionType.DEBIT,
        transactionContext: TransactionContext.SWAP,
        senderWalletAddress: null,
        receiverWalletAddress: null,
        user: { firstName: null, lastName: null },
      });
    } catch (err: any) {
      this.logger.error(
        `Dashboard queue failed for swap ${swapId}: ${err.message}`,
      );
    }

    if (event === 'swap_transaction.completed') {
      await this.transactionService.syncCompanyLiquidityCache();
    }
  }
}