import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { VaultStatus } from '../../../infrastructure/databases/prisma';
import { ConvertCurrency, CryptoNetwork } from '../../../shared';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { TempStoreService } from '../../../infrastructure';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

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
    if (!isDedicatedSchedulerRuntime()) return;
    try {
      await this.queueService.add(
        QueueName.CLEANUP,
        'scheduler.vault-interest.dispatch',
        {},
        {
          jobId: `scheduler.vault-interest.dispatch-${new Date().toISOString().slice(0, 16)}`,
        },
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
        {
          jobId: `scheduler.vault-interest.shard-${now.toISOString().slice(0, 13)}-${shardIndex++}`,
        },
      );
    }
    await this.schedulerState.markExecuted(
      this.JOB_NAME,
      now,
      new Date(now.getTime() + 12 * 60 * 60 * 1000),
    );
  }

  async executeShard(ids: string[], asOfIso: string) {
    this.logger.log('Starting vault maturity/interest scheduler shard...');

    const asOf = new Date(asOfIso);
    const vaults = await this.prisma.vault.findMany({
      where: {
        id: { in: ids },
        status: VaultStatus.ACTIVE,
        maturityDate: { lte: asOf },
      },
      select: { id: true },
    });

    this.logger.log(`Found ${vaults.length} vaults to process`);
    if (vaults.length === 0) return;

    for (const { id } of vaults) {
      try {
        const notification = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "vaults"
            WHERE "id" = ${id}
            FOR UPDATE
          `;

          const vault = await tx.vault.findFirst({
            where: {
              id,
              status: VaultStatus.ACTIVE,
              maturityDate: { lte: asOf },
            },
          });
          if (!vault) return null;

          const cryptoRate = await tx.cryptoCurrencyRate.findFirst({
            where: { cryptoCurrencyId: vault.currencyId },
          });
          const wallet = await tx.wallet.findFirst({
            where: { userId: vault.userId, currencyId: vault.currencyId },
          });
          const crypto = await tx.cryptoCurrency.findUnique({
            where: { id: vault.currencyId },
          });

          if (!wallet) {
            this.logger.warn(`Wallet not found for vault: ${vault.id}`);
            return null;
          }

          const amountLocked = BigInt(vault.amountLocked.toFixed(0));
          const totalGain = BigInt(vault.totalGain.toFixed(0));
          const amountToReceive = BigInt(vault.amountToReceive.toFixed(0));
          const cryptoSymbol =
            crypto?.symbol?.toUpperCase() || vault.currencyId;
          const netInterestPaid =
            amountToReceive > amountLocked
              ? amountToReceive - amountLocked
              : 0n;

          const [walletUpdate] = await tx.$queryRaw<{ baseBalance: string }[]>`
            UPDATE "wallets"
            SET "baseBalance" = "baseBalance" + ${amountToReceive.toString()}::decimal,
                "lockedAmount" = GREATEST("lockedAmount" - ${amountLocked.toString()}::decimal, 0),
                "totalLockedInterest" = GREATEST("totalLockedInterest" - ${totalGain.toString()}::decimal, 0)
            WHERE "id" = ${wallet.id}
            RETURNING "baseBalance"
          `;

          const decimalsOrNetwork =
            cryptoSymbol === 'USDT' || cryptoSymbol === 'USDC'
              ? 6
              : (wallet.defaultNetwork as CryptoNetwork);
          const newOriginalBalance = ConvertCurrency.fromBase(
            BigInt(String(walletUpdate.baseBalance)),
            cryptoSymbol,
            decimalsOrNetwork,
          );
          await tx.$executeRaw`
            UPDATE "wallets"
            SET "originalBalance" = ${newOriginalBalance}
            WHERE "id" = ${wallet.id}
          `;

          await tx.vault.update({
            where: { id: vault.id },
            data: {
              totalGain: totalGain.toString(),
              interestRatePerAnum:
                cryptoRate?.lockedFundsRatePercent ?? vault.interestRatePerAnum,
              status: VaultStatus.MATURED,
            },
          });

          const companyCurrency =
            cryptoSymbol === 'BTC' ? 'USDT' : cryptoSymbol;
          if (companyCurrency === 'USDT' || companyCurrency === 'USDC') {
            await tx.$executeRaw`
              UPDATE "company_liquidity"
              SET "totalLockedPrincipal" = GREATEST("totalLockedPrincipal" - ${amountLocked.toString()}::decimal, 0),
                  "totalAccruedLockedInterest" = GREATEST("totalAccruedLockedInterest" - ${totalGain.toString()}::decimal, 0),
                  "totalLockedInterestPaid" = "totalLockedInterestPaid" + ${netInterestPaid.toString()}::decimal
              WHERE LOWER("currency") = LOWER(${companyCurrency})
            `;
          }

          return {
            userId: vault.userId,
            vaultId: vault.id,
            cryptoSymbol,
            amountToReceive: amountToReceive.toString(),
            amountToReceiveHuman: ConvertCurrency.fromBase(
              amountToReceive,
              cryptoSymbol,
              decimalsOrNetwork,
            ),
            totalAmount: amountToReceive,
            netInterestPaid: netInterestPaid.toString(),
            netInterestPaidHuman: ConvertCurrency.fromBase(
              netInterestPaid,
              cryptoSymbol,
              decimalsOrNetwork,
            ),
          };
        });

        if (notification) {
          await this.queueService
            .sendPushNotification({
              userId: notification.userId,
              title: 'Vault Matured',
              body: `Your ${notification.cryptoSymbol} vault has matured. Amount received: ${notification.amountToReceiveHuman} ${notification.cryptoSymbol}. Interest earned: ${notification.netInterestPaidHuman} ${notification.cryptoSymbol}.`,
              data: {
                type: 'vault_matured',
                vaultId: notification.vaultId,
                currency: notification.cryptoSymbol,
                amountReceived: notification.amountToReceive,
                interestEarned: notification.netInterestPaid,
              },
            })
            .catch((err) =>
              this.logger.warn(
                `Failed to send vault maturity FCM notification: ${err}`,
              ),
            );

          this.logger.log(
            `Vault ${notification.vaultId} matured. Added ${notification.amountToReceive} to wallet`,
          );
        }
      } catch (error) {
        this.logger.error(`Error maturing vault ${id}:`, error as any);
      }
    }

    this.logger.log('Vault maturity/interest scheduler shard completed');
  }
}
