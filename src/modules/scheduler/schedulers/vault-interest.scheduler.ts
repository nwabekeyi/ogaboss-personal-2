import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { VaultStatus } from '../../../infrastructure/databases/prisma';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';

@Injectable()
export class VaultInterestScheduler {
  private readonly logger = new Logger(VaultInterestScheduler.name);
  private readonly BATCH_SIZE = 200;
  private readonly JOB_NAME = 'scheduler.vault-interest';

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly tempStore: TempStoreService,
    private readonly schedulerState: SchedulerExecutionStateService,
  ) {}

@Cron('35 */12 * * *') // Staggered: every 12h at :35
    async calculateVaultInterests() {
      try {
        await this.queueService.add(
          QueueName.CLEANUP,
          'scheduler.vault-interest.dispatch',
          {},
          { jobId: `scheduler.vault-interest.dispatch-${new Date().toISOString().slice(0,16)}` },
        );
        return;
      } catch {
        // fallback to local execution
      }
      return this.execute();
    }

   async execute() {
    const now = new Date();
    if (!(await this.schedulerState.isDue(this.JOB_NAME, now))) return;
    return this.dispatchDueMaturityShards();
   }

   async dispatchDueMaturityShards() {
    const now = new Date();
    const runKey = `lock:scheduler:vault-interest:dispatch:${now.toISOString().slice(0, 13)}`;
    const lockAcquired = await this.tempStore.setNx(runKey, '1', 60 * 20);
    if (!lockAcquired) return;

    let cursor: string | undefined;
    let shardIndex = 0;
    while (true) {
      const page = await this.prisma.vault.findMany({
        where: { status: VaultStatus.ACTIVE, maturityDate: { lte: now } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: this.BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      const ids = page.map((p) => p.id);
      cursor = ids[ids.length - 1];
        await this.queueService.add(
          QueueName.CLEANUP,
          'scheduler.vault-interest.shard',
          { ids, asOf: now.toISOString() },
          { jobId: `scheduler.vault-interest.shard-${now.toISOString().slice(0, 13)}-${shardIndex++}` },
        );
    }
    await this.schedulerState.markExecuted(
      this.JOB_NAME,
      now,
      new Date(now.getTime() + 12 * 60 * 60 * 1000),
    );
   }

   async executeShard(ids: string[], asOfIso: string) {
    this.logger.log('Starting vault maturity/interest scheduler...');

    const today = new Date(asOfIso);
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    try {
      await this.prisma.$transaction(async (tx) => {
        const vaults = await tx.vault.findMany({
          where: { id: { in: ids }, status: VaultStatus.ACTIVE, maturityDate: { lte: today } },
        });

        this.logger.log(`Found ${vaults.length} vaults to process`);

        if (vaults.length === 0) {
          this.logger.log('No active vaults to process');
          return;
        }

        const uniqueCurrencyIds = Array.from(new Set(vaults.map((v) => v.currencyId)));
        const cryptoRates = await tx.cryptoCurrencyRate.findMany({
          where: { cryptoCurrencyId: { in: uniqueCurrencyIds } },
        });
        const cryptoRateMap = new Map<string, any>();
        for (const rate of cryptoRates) {
          cryptoRateMap.set(rate.cryptoCurrencyId, rate);
        }

        const uniqueUserCurrencyPairs = Array.from(
          new Set(vaults.map((v) => `${v.userId}:${v.currencyId}`)),
        ).map((pair) => {
          const [userId, currencyId] = pair.split(':');
          return { userId, currencyId };
        });
        const wallets = await tx.wallet.findMany({
          where: {
            userId: { in: uniqueUserCurrencyPairs.map((p) => p.userId) },
            currencyId: { in: uniqueUserCurrencyPairs.map((p) => p.currencyId) },
          },
        });
        const walletMap = new Map<string, any>();
        for (const wallet of wallets) {
          walletMap.set(`${wallet.userId}:${wallet.currencyId}`, wallet);
        }

        const cryptos = await tx.cryptoCurrency.findMany({
          where: { id: { in: uniqueCurrencyIds } },
        });
        const cryptoMap = new Map<string, any>();
        for (const crypto of cryptos) {
          cryptoMap.set(crypto.id, crypto);
        }

        for (const vault of vaults) {
          const maturityDate = new Date(vault.maturityDate);
          maturityDate.setHours(0, 0, 0, 0);
          const maturityTimestamp = maturityDate.getTime();
          const isMaturityDay = todayTimestamp === maturityTimestamp;
          const isMatured = todayTimestamp > maturityTimestamp;

          const cryptoRate = cryptoRateMap.get(vault.currencyId);

          if (!cryptoRate || cryptoRate.lockedFundsRatePercent.isZero()) {
            this.logger.warn(`No interest rate configured for currency: ${vault.currencyId}`);
            continue;
          }

          const amountLocked = BigInt(vault.amountLocked.toFixed(0));
          const totalGain = BigInt(vault.totalGain.toFixed(0));
          const amountToReceive = BigInt(vault.amountToReceive.toFixed(0));

          if (isMaturityDay || isMatured) {
            const wallet = walletMap.get(`${vault.userId}:${vault.currencyId}`);

            if (!wallet) {
              this.logger.warn(`Wallet not found for vault: ${vault.id}`);
              continue;
            }

            const totalAmount = amountToReceive;
            const newBaseBalance = BigInt(wallet.baseBalance.toFixed(0)) + totalAmount;
            const newLockedAmount = BigInt(wallet.lockedAmount?.toFixed(0) || 0) - amountLocked;

            await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                baseBalance: newBaseBalance.toString(),
                lockedAmount: newLockedAmount.toString(),
              },
            });

            await tx.vault.update({
              where: { id: vault.id },
              data: {
                totalGain: totalGain.toString(),
                interestRatePerAnum: cryptoRate.lockedFundsRatePercent,
                status: VaultStatus.MATURED,
              },
            });

            const crypto = cryptoMap.get(vault.currencyId);
            const companyCurrency = crypto?.symbol?.toUpperCase() === 'BTC' ? 'USDT' : crypto?.symbol?.toUpperCase();
            if (companyCurrency === 'USDT' || companyCurrency === 'USDC') {
              await tx.$executeRaw`
                UPDATE "company_liquidity"
                SET "totalLockedPrincipal" = "totalLockedPrincipal" - ${amountLocked.toString()}::decimal,
                    "totalAccruedLockedInterest" = "totalAccruedLockedInterest" - ${totalGain.toString()}::decimal,
                    "totalInterestPaid" = "totalInterestPaid" + ${totalGain.toString()}::decimal
                WHERE "currency" = ${companyCurrency}
              `;
            }

            try {
              const cryptoSymbol = crypto?.symbol?.toUpperCase() || vault.currencyId;
              await this.queueService.sendPushNotification({
                userId: vault.userId,
                title: 'Vault Matured',
                body: `Your ${cryptoSymbol} vault has matured. Amount received: ${(totalAmount / BigInt(10 ** 8)).toString()} ${cryptoSymbol}. Interest earned: ${(totalGain / BigInt(10 ** 8)).toString()} ${cryptoSymbol}.`,
                data: {
                  type: 'vault_matured',
                  vaultId: vault.id,
                  currency: cryptoSymbol,
                  amountReceived: vault.amountToReceive.toFixed(0),
                  interestEarned: vault.totalGain.toFixed(0),
                },
              });
            } catch (err) {
              this.logger.warn(`Failed to send vault maturity FCM notification: ${err}`);
            }

            this.logger.log(`Vault ${vault.id} matured (${isMatured ? 'past maturity' : 'today'}). Added ${totalAmount} to wallet`);
          } else {
            await tx.vault.update({
              where: { id: vault.id },
              data: {
                totalGain: totalGain.toString(),
                interestRatePerAnum: cryptoRate.lockedFundsRatePercent,
              },
            });
          }
        }
      });

      this.logger.log('Vault maturity/interest scheduler completed');
    } catch (error) {
      this.logger.error('Error calculating vault interests:', error);
    }
  }
}
