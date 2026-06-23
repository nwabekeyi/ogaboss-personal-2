import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/databases/prisma';
import { QuidaxWalletService } from '../infrastructure/providers/quidax/wallet.service';
import { PaymentAddressStatus } from '../infrastructure/databases/prisma/generated/prisma/client';

async function syncPaymentAddresses() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const quidaxWalletService = app.get(QuidaxWalletService);

  console.log('Starting payment addresses sync...');

  // Fetch all users with quidaxAccountId
  const users = await prisma.user.findMany({
    where: {
      quidaxAccountId: {
        not: null,
      },
    },
    select: {
      id: true,
      email: true,
      quidaxAccountId: true,
    },
  });

  console.log(`Found ${users.length} users with Quidax accounts`);

  let processed = 0;
  let failed = 0;

  for (const user of users) {
    try {
      // Get all wallets for this user
      const wallets = await prisma.wallet.findMany({
        where: { userId: user.id },
        select: { id: true, currency: true, quidaxWalletId: true },
      });

      if (wallets.length === 0) {
        console.log(`[${user.email}] No wallets found, skipping...`);
        continue;
      }

      for (const wallet of wallets) {
        try {
          // Fetch payment addresses from Quidax
          const addressesRes = await quidaxWalletService.getPaymentAddressList({
            user_id: user.quidaxAccountId!,
            currency: wallet.currency.toLowerCase(),
          });

          if (addressesRes.status !== 'success' || !addressesRes.data) {
            console.log(
              `[${user.email}] No addresses for wallet ${wallet.currency}`,
            );
            continue;
          }

// Upsert each address
           for (const addr of addressesRes.data) {
             const network = (addr.network || 'main').toLowerCase();

             // Skip unsupported networks (arbitrum, lsk) that should not be synced
             if (network === 'arbitrum' || network === 'lsk') {
               console.log(
                 `[${user.email}] Skipping unsupported network ${network} for ${wallet.currency}`,
               );
               continue;
             }

             await prisma.paymentAddress.upsert({
              where: { quidaxAddressId: addr.id },
              create: {
                quidaxAddressId: addr.id,
                walletId: wallet.id,
                currency: wallet.currency.toUpperCase(),
                network,
                address: addr.address || null,
                name: network,
                status: addr.address
                  ? PaymentAddressStatus.ACTIVE
                  : PaymentAddressStatus.PROCESSING,
              },
              update: {
                address: addr.address || undefined,
                network,
                status: addr.address
                  ? PaymentAddressStatus.ACTIVE
                  : PaymentAddressStatus.PROCESSING,
              },
            });
          }

          console.log(
            `[${user.email}] Synced ${addressesRes.data.length} addresses for ${wallet.currency}`,
          );
        } catch (err: any) {
          console.error(
            `[${user.email}] Error syncing wallet ${wallet.currency}: ${err.message}`,
          );
          failed++;
        }
      }

      processed++;
    } catch (err: any) {
      console.error(`[${user.email}] Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nSync complete!`);
  console.log(`Processed: ${processed} users`);
  console.log(`Failed: ${failed} users`);

  await app.close();
  process.exit(0);
}

syncPaymentAddresses().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
