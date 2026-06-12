// src/infrastructure/scheduler/schedulers/company-wallets.scheduler.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QuidaxWalletService } from '../../../infrastructure/providers/quidax';
import { PrismaService, RedisService } from '../../../infrastructure';
import { Prisma } from '../../../infrastructure/databases/prisma/generated/prisma/client';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';
import {
  COMPANY_WALLETS_KEY,
  ConvertCurrency,
  CryptoNetwork,
} from '../../../shared';

@Injectable()
export class CompanyWalletScheduler implements OnModuleInit {
  private readonly logger = new Logger(CompanyWalletScheduler.name);

  constructor(
    private readonly quidaxWalletService: QuidaxWalletService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (!isDedicatedSchedulerRuntime()) return;
    await this.syncCompanyWallets();
  }

  @Cron('* * * * *') // Run every minute
  async syncCompanyWalletsCron() {
    if (!isDedicatedSchedulerRuntime()) return;
    await this.syncCompanyWallets();
  }

  private async syncCompanyWallets(): Promise<void> {
    try {
      const wallets = await this.quidaxWalletService.getCompanyWallets({
        skipCircuitBreaker: true,
      });

      if (!wallets || Object.keys(wallets).length === 0) {
        this.logger.warn('No wallets returned from Quidax');
        return;
      }

      const payload: Record<string, any> = {};

      for (const [currencyKey, wallet] of Object.entries(wallets)) {
        const currency =
          wallet?.currency?.toLowerCase() ?? currencyKey.toLowerCase();

        const network = wallet?.default_network ?? currency;

        let depositAddress = wallet?.deposit_address ?? null;
        let destinationTag = wallet?.destination_tag ?? null;
        // Create deposit address for crypto wallets if missing
        if (
          wallet?.is_crypto &&
          wallet?.blockchain_enabled &&
          !depositAddress
        ) {
          try {
            const addressResponse =
              await this.quidaxWalletService.createPaymentAddress(
                {
                  user_id: 'me',
                  currency,
                  network,
                },
                { skipCircuitBreaker: true },
              );

            if (addressResponse?.data?.address) {
              depositAddress = addressResponse.data.address;
              destinationTag = addressResponse.data.destination_tag ?? null;
            }
          } catch (error) {
            this.logger.warn(
              `Failed creating deposit address for ${currency}`,
              error,
            );
          }
        }

        const balance = wallet?.balance ?? '0';
        const locked = Number(wallet?.locked ?? 0);
        const availableBalance = Number(balance) - locked;

        await this.syncCompanyLiquidity(currency, network, balance);
        // Save wallet info to Redis
        payload[`${currency}-${network}`] = {
          balance: Number(balance),
          locked,
          availableBalance,
          currency,
          network,
          isCrypto: wallet?.is_crypto ?? false,
          depositAddress,
          destinationTag,
          updatedAt: new Date().toISOString(),
        };
      }

      // Save all wallet states to Redis
      await this.redisService.set(COMPANY_WALLETS_KEY, payload);
    } catch (error) {
      this.logger.error('Failed syncing company wallets', error);
    }
  }

  private async syncCompanyLiquidity(
    currency: string,
    network: string,
    balance: string,
  ): Promise<void> {
    try {
      const normalizedCurrency = currency.toLowerCase();
      const totalBalanceBase = ConvertCurrency.toBase(
        balance,
        normalizedCurrency,
        network as CryptoNetwork,
      );

      // Convert BigInt to string for SQL, then cast back in the query
      const totalBalanceStr = totalBalanceBase.toString();

      // Use unsafe raw to bypass Prisma's BigInt serialization
      // Use gen_random_uuid() for PostgreSQL to generate the id
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "company_liquidity" (id, currency, network, "totalBalance", "reservedBalance", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $3, $2, '0', NOW(), NOW())
         ON CONFLICT (currency) DO UPDATE SET
           "network" = COALESCE("company_liquidity"."network", $3),
           "totalBalance" = $2,
           "updatedAt" = NOW()`,
        normalizedCurrency,
        totalBalanceStr,
        network,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        try {
          await this.prisma.companyLiquidity.update({
            where: { currency: currency.toLowerCase() },
            data: {
              network: network,
              totalBalance: ConvertCurrency.toBase(
                balance,
                currency.toLowerCase(),
                network as CryptoNetwork,
              ).toString(),
              updatedAt: new Date(),
            },
          });
          return;
        } catch (updateError) {
          this.logger.warn(
            `Failed updating liquidity after race for ${currency} (${network})`,
            updateError,
          );
          return;
        }
      }

      this.logger.warn(
        `Failed syncing liquidity for ${currency} (${network})`,
        error,
      );
    }
  }
}
