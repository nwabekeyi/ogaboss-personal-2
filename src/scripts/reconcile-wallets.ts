import 'dotenv/config';
import { PrismaClient, Status } from '../infrastructure/databases/prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import axios from 'axios';
import { ALLOWED_CURRENCIES, ConvertCurrency, CryptoNetwork } from '../shared';

interface QuidaxWallet {
  id: string;
  name: string;
  currency: string;
  balance: string;
  locked: string;
  staked: string;
  converted_balance: string;
  reference_currency: string;
  is_crypto: boolean;
  created_at: string;
  updated_at: string;
  blockchain_enabled: boolean;
  default_network: string;
}

interface Summary {
  totalUsers: number;
  usersProcessed: number;
  walletsProcessed: number;
  upserted: number;
  skipped: number;
  errors: string[];
}

class QuidaxApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.QUIDAX_API_URL || 'https://api.quidax.com/api/v1';
    this.apiKey = process.env.QUIDAX_API_SECRET_KEY || '';
  }

  async getUserWallet(userId: string, currency: string): Promise<QuidaxWallet | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/users/${userId}/wallets/${currency}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.data?.data || null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch wallet ${currency} for user ${userId}: ${error.message}`);
    }
  }
}

async function reconcileWallets(): Promise<void> {
  console.log('=== Wallet Reconciliation Script ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Reconciling currencies: ${[...ALLOWED_CURRENCIES].join(', ')}`);
  console.log('');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['error', 'warn'],
    errorFormat: 'minimal',
  });

  const quidaxClient = new QuidaxApiClient();
  const currencies = [...ALLOWED_CURRENCIES];

  const summary: Summary = {
    totalUsers: 0,
    usersProcessed: 0,
    walletsProcessed: 0,
    upserted: 0,
    skipped: 0,
    errors: [],
  };

   try {
     const users = await prisma.user.findMany({
       where: {
         status: { not: Status.DELETED },
         quidaxAccountId: { not: null },
       },
       select: {
         id: true,
         email: true,
         quidaxAccountId: true,
       },
     });

    summary.totalUsers = users.length;
    console.log(`Found ${users.length} users with Quidax accounts`);

    for (const user of users) {
      summary.usersProcessed++;

      if (!user.quidaxAccountId) {
        summary.skipped++;
        continue;
      }

      for (const currency of currencies) {
        summary.walletsProcessed++;

        try {
          const quidaxWallet = await quidaxClient.getUserWallet(
            user.quidaxAccountId,
            currency
          );

          if (!quidaxWallet) {
            console.log(`Skipping ${currency} for user ${user.email} - wallet not found in Quidax`);
            summary.skipped++;
            continue;
          }

          const balanceStr = quidaxWallet.balance ?? '0';
          const baseBalance = ConvertCurrency.toBase(
            balanceStr,
            currency,
            (quidaxWallet.default_network || currency) as CryptoNetwork
          );

          await prisma.wallet.upsert({
            where: {
              quidaxWalletId: quidaxWallet.id,
            },
            create: {
              quidaxWalletId: quidaxWallet.id,
              currency: currency.toUpperCase(),
              name: quidaxWallet.name ?? currency.toUpperCase(),
              baseBalance: baseBalance.toString(),
              originalBalance: balanceStr,
              isCrypto: quidaxWallet.is_crypto ?? true,
              blockchainEnabled: quidaxWallet.blockchain_enabled ?? false,
              defaultNetwork: quidaxWallet.default_network ?? null,
              user: { connect: { id: user.id } },
            },
            update: {
              baseBalance: baseBalance.toString(),
              originalBalance: balanceStr,
              blockchainEnabled: quidaxWallet.blockchain_enabled ?? false,
              defaultNetwork: quidaxWallet.default_network ?? null,
            },
          });

          summary.upserted++;
          console.log(`Upserted wallet ${currency} for user ${user.email} (balance: ${balanceStr})`);
        } catch (error: any) {
          const errorMsg = `Failed to reconcile ${currency} for user ${user.email}: ${error.message}`;
          console.error(errorMsg);
          summary.errors.push(errorMsg);
        }
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total users: ${summary.totalUsers}`);
    console.log(`Users processed: ${summary.usersProcessed}`);
    console.log(`Wallets processed: ${summary.walletsProcessed}`);
    console.log(`Wallets upserted: ${summary.upserted}`);
    console.log(`Wallets skipped: ${summary.skipped}`);

    if (summary.errors.length > 0) {
      console.log('\n--- Errors (first 10) ---');
      for (const error of summary.errors.slice(0, 10)) {
        console.log(error);
      }
      if (summary.errors.length > 10) {
        console.log(`... and ${summary.errors.length - 10} more errors`);
      }
    }

    console.log(`\nCompleted at: ${new Date().toISOString()}`);

  } catch (error: any) {
    console.error('Fatal error during reconciliation:', error);
    summary.errors.push(`Fatal error: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

reconcileWallets()
  .then(() => {
    console.log('\nReconciliation completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Reconciliation failed:', error);
    process.exit(1);
  });