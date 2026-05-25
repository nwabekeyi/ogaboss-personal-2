import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/databases/prisma';
import {
  TransactionContext,
  TransactionStatus,
  TransactionType,
  VaultStatus,
} from '../../../../infrastructure/databases/prisma/generated/prisma/client';
import {
 ConvertCurrency,
 CryptoNetwork,
 toBigInt,
 toDecimal,
 isTransientPrismaError,
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

@Injectable()
export class SwapTransactionHandler {
 private readonly logger = new Logger(SwapTransactionHandler.name);

 constructor(
   private readonly prisma: PrismaService,
   private readonly quidaxSwapService: QuidaxSwapService,
   private readonly companyLiquidityService: CompanyLiquidityService,
   private readonly dashboardStatsQueueService: DashboardStatsQueueService,
   private readonly transactionNotificationService: TransactionNotificationService,
   private readonly tickerService: QuidaxTickerService,
   private readonly transactionService: TransactionService,
 ) {}

 private async withRetry<T>(
   operation: () => Promise<T>,
   maxRetries = 3,
 ): Promise<T> {
   for (let attempt = 1; attempt <= maxRetries; attempt++) {
     try {
       return await operation();
     } catch (err: any) {
       if (
         isTransientPrismaError(err) ||
         err.code === 'P2034' || // Serialization failure
         (err.message && err.message.includes('serialization'))
       ) {
         if (attempt === maxRetries) throw err;
         const delay = 50 * attempt * (Math.random() + 0.5);
         await new Promise((r) => setTimeout(r, delay));
         continue;
       }
       throw err;
     }
   }
   throw new Error('Max retries exceeded');
 }

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
       description: true,
     },
   });

   if (!swapRecord) {
     this.logger.error(`No SwapTransaction found for swapId: ${swapId}`);
     return;
   }

   const TERMINAL = new Set([
     TransactionStatus.COMPLETED,
     TransactionStatus.FAILED,
     'completed',
     'failed',
     'reversed',
   ]);

   if (TERMINAL.has(swapRecord.status as any)) {
     this.logger.warn(
       `Swap ${swapRecord.id} already terminal (${swapRecord.status}) — skipping`,
     );
     return;
   }

   const userId = swapRecord.userId;

   // === VAULT SWAP PATH ===
   if (
     swapRecord.description?.startsWith('vault_swap:') &&
     event === 'swap_transaction.completed'
   ) {
     return this.withRetry(() =>
       this.processVaultSwapCompletion(swapRecord!, data, event),
     );
   }

   // === REGULAR SWAP PATH ===
   return this.withRetry(() =>
     this.processRegularSwap(swapRecord!, data, event),
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

    await this.prisma.$transaction(
      async (tx) => {
        // Idempotency check: if vault is already MATURED/COMPLETED, skip
        const existingVault = await tx.vault.findUnique({
          where: { id: vaultId },
          select: { status: true },
        });
        if (existingVault?.status && existingVault.status !== VaultStatus.ACTIVE && existingVault.status !== VaultStatus.PENDING) {
          this.logger.warn(`Vault ${vaultId} already ${existingVault.status} — skipping idempotently`);
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
          this.logger.warn(`Linked transaction ${linkedTx.id} already COMPLETED — skipping idempotently`);
          return;
        }

        // Lock vault and linked transaction early
        const vault = await tx.vault.findUnique({
          where: { id: vaultId },
          select: {
            id: true,
            amountLocked: true,
            totalGain: true,
            currencyId: true,
            cryptoCurrency: { select: { symbol: true } },
          },
        });

        if (!vault) {
          this.logger.error(`Vault ${vaultId} not found`);
          throw new Error(`Vault ${vaultId} not found`);
        }

        const expectedUsdtMinor = BigInt(vault.amountLocked.toFixed(0));
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

         if (linkedTx) {
           await tx.transaction.update({
             where: { id: linkedTx.id },
             data: {
               status: TransactionStatus.FAILED,
               description: 'Swap received below principal threshold',
             },
           });
         }
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

      // === BTC Wallet: Final deduction + update originalBalance ===
       const newBtcBaseBalance = BigInt(btcWallet.baseBalance.toFixed(0)) - totalBtcChargeMinor;
       const newBtcOriginalBalance = newBtcBaseBalance < 0n ? '0' : newBtcBaseBalance.toString();

       await tx.$executeRaw`
         UPDATE "wallets"
         SET
           "baseBalance" = GREATEST("baseBalance" - ${toDecimal(totalBtcChargeMinor)}, 0),
           "reservedBalance" = GREATEST("reservedBalance" - ${toDecimal(totalBtcChargeMinor)}, 0),
           "originalBalance" = ${newBtcOriginalBalance}
         WHERE "id" = ${btcWallet.id}
       `;

        // USDT: credit surplus to base, principal to locked
        const newUsdtBase =
          BigInt(userUsdtWallet.baseBalance.toFixed(0)) + differenceMinor;
        const newUsdtLocked =
          BigInt(userUsdtWallet.lockedAmount?.toFixed(0) || '0') +
          expectedUsdtMinor;

        await tx.wallet.update({
          where: { id: userUsdtWallet.id },
          data: {
            baseBalance: toDecimal(newUsdtBase),
            lockedAmount: toDecimal(newUsdtLocked),
            originalBalance: newUsdtBase.toString(),
          },
        });

        // Update company liquidity: USDT vault principal + interest are now locked
        const totalGainMinor = BigInt(vault.totalGain.toFixed(0));
        await tx.$executeRaw`
          UPDATE "company_liquidity"
          SET "totalLockedPrincipal" = "totalLockedPrincipal" + ${expectedUsdtMinor.toString()}::decimal,
              "totalAccruedLockedInterest" = "totalAccruedLockedInterest" + ${totalGainMinor.toString()}::decimal
          WHERE "currency" = 'usdt'
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
           status: 'ACTIVE' as any,
           currencyId: usdtCrypto?.id,
           amountLocked: toDecimal(expectedUsdtMinor),
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



         const meta = (linkedTx.paymentMetadata || {}) as Record<string, any>;
         if (linkedTx.transactionContext === TransactionContext.AUTOSTACK && String(meta.paymentType || '').toUpperCase() === 'CRYPTO_WALLET' && meta.autoStackId) {
           await tx.autoStack.update({ where: { id: String(meta.autoStackId) }, data: { lastExecutedAt: new Date(), status: 'ACTIVE' as any } });
         }       await tx.swapTransaction.update({
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
       where: { userId, currency: { equals: fromCurrency, mode: 'insensitive' } },
       select: { id: true, defaultNetwork: true },
     }),
     this.prisma.wallet.findFirst({
       where: { userId, currency: { equals: toCurrency, mode: 'insensitive' } },
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
     select: { id: true, cryptoAmountBase: true, platformFeeBase: true, paymentMetadata: true, transactionContext: true },
   });

   if (!linkedTx) {
     linkedTx = await this.prisma.transaction.findFirst({
       where: {
         transactionContext: TransactionContext.AUTOSTACK,
         transactionType: TransactionType.DEBIT,
         transactionUniqueId: swapRecord.quoteId || undefined,
         userId,
       },
       select: { id: true, cryptoAmountBase: true, platformFeeBase: true, paymentMetadata: true, transactionContext: true },
     });
   }

   const exactFromMinorBooked = linkedTx
     ? toBigInt(linkedTx.cryptoAmountBase)
     : ConvertCurrency.toBase(data.from_amount, fromCurrency, fromNet);

   const reservedAmount = linkedTx
     ? toBigInt(linkedTx.cryptoAmountBase) +
       toBigInt(linkedTx.platformFeeBase ?? 0)
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

     await this.queueDashboard(swapId, userId, toCurrency, event, data.updated_at);
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
     fromNet,
   );
   const confirmedToBase = ConvertCurrency.toBase(
     confirmedToAmount,
     toCurrency,
     toNet,
   );

   // === Atomic Ledger Update ===
   await this.prisma.$transaction(
     async (tx) => {
       const fromDec = toDecimal(confirmedFromBase);
       const reservedDec = toDecimal(reservedAmount);
       const liquidityReservedDec = toDecimal(exactFromMinorBooked);
       const toDec = toDecimal(confirmedToBase);

       // FROM wallet: deduct full reserved amount
       await tx.$executeRaw`
         UPDATE "wallets"
         SET "baseBalance" = GREATEST("baseBalance" - ${reservedDec}, 0),
             "reservedBalance" = GREATEST("reservedBalance" - ${reservedDec}, 0)
         WHERE "id" = ${fromWallet.id}
       `;

       // TO wallet: credit received amount
       await tx.$executeRaw`
         UPDATE "wallets"
         SET "baseBalance" = "baseBalance" + ${toDec}
         WHERE "id" = ${toWallet.id}
       `;

       // Company liquidity
       await this.companyLiquidityService.updateInternalBalance(
         fromCurrency.toLowerCase(),
         liquidityReservedDec,
         'subtract',
         tx,
       );
       await this.companyLiquidityService.updateInternalBalance(
         toCurrency.toLowerCase(),
         toDec,
         'add',
         tx,
       );

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
         if (linkedTx.transactionContext === TransactionContext.AUTOSTACK && String(meta.paymentType || '').toUpperCase() === 'CRYPTO_WALLET' && meta.autoStackId) {
           const autoStack = await tx.autoStack.findUnique({ where: { id: String(meta.autoStackId) } });
           const usdtWallet = await tx.wallet.findFirst({ where: { userId, currency: 'USDT' } });
           if (autoStack && usdtWallet) {
             const principal = toDecimal(confirmedToBase);
             const dailyRate = (await tx.autoStackingSettings.findFirst())?.dailyInterestRatePercent || new Prisma.Decimal(0);
             const days = this.frequencyDays(String(autoStack.frequency));
             const interest = principal.mul(dailyRate).mul(days).div(100);
             await tx.wallet.update({ where: { id: usdtWallet.id }, data: { baseBalance: { increment: principal }, stackedAmount: { increment: principal }, totalStackedInterest: { increment: interest } } });
             await tx.autoStack.update({ where: { id: autoStack.id }, data: { amount: { increment: principal }, accruedInterest: { increment: interest }, lastExecutedAt: new Date(), nextInterestAt: new Date() } });
             await tx.transaction.update({ where: { id: linkedTx.id }, data: { paymentMetadata: { ...meta, autostackWebhookProcessedAt: new Date().toISOString(), autostackSettlement: 'swap_completed' } as Prisma.InputJsonValue } });
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

       if (!existingCredit) {
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

       // Company total/reserved liquidity adjustments
       await tx.$executeRaw`
         UPDATE "company_liquidity"
         SET "totalBalance" = "totalBalance" + ${liquidityReservedDec}
         WHERE "currency" = ${fromCurrency.toLowerCase()}
       `;

       await tx.$executeRaw`
         UPDATE "company_liquidity"
         SET "reservedBalance" = GREATEST("reservedBalance" - ${liquidityReservedDec}, 0)
         WHERE "currency" = ${fromCurrency.toLowerCase()}
       `;

       await tx.$executeRaw`
         UPDATE "company_liquidity"
         SET "totalBalance" = "totalBalance" - ${toDec}
         WHERE "currency" = ${toCurrency.toLowerCase()}
       `;

       // Update user's amountSent (NGN equivalent)
       const swapNgnPrice = await this.tickerService.getPrice(
         `${fromCurrency.toLowerCase()}ngn`,
       );
       let swapNgnDec = toDecimal(0n);
       if (swapNgnPrice && parseFloat(swapNgnPrice) > 0) {
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
     },
     {
       isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
       maxWait: 5000,
       timeout: 15000,
     },
   );

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
       const reservedDec = toDecimal(reservedAmount);

       await tx.$executeRaw`
         UPDATE "wallets"
         SET "reservedBalance" = GREATEST("reservedBalance" - ${reservedDec}, 0)
         WHERE "id" = ${fromWalletId}
       `;

       await tx.swapTransaction.update({
         where: { id: swapRecordId },
         data: {
           status: isReversal ? 'reversed' : TransactionStatus.FAILED,
           confirmed: false,
           updatedAt: new Date(),
         },
       });

       if (linkedTxId) {
         await tx.transaction.update({
           where: { id: linkedTxId },
           data: {
             status: TransactionStatus.FAILED,
             isProcessed: true,
             executedAt: new Date(),
             description: isReversal
               ? `Swap reversed: ${fromAmountStr} ${fromCurrency} refunded`
               : `Swap failed: ${fromAmountStr} ${fromCurrency} → ${toCurrency}`,
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
