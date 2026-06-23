import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../infrastructure/databases/prisma';
import { VersioningType } from '@nestjs/common';
import { QueueService } from '../infrastructure/bullMQ/bullmq.service';
import { QuidaxWebhookService } from '../modules/webhook/quidax';
import { QueueName } from '../infrastructure/bullMQ';
import { QuidaxDepositService } from '../infrastructure/providers/quidax/deposit.service';
import { QuidaxTickerService } from '../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const TARGET_USER_ID = 'cmmtb6ehx01m01ypjdkovdrbk';
const CURRENCY = 'usdt';
const NETWORK = 'bep20';
const DEPOSIT_AMOUNT = '3';
const DEPOSIT_ID = `manual_dep_${Date.now()}`;
const TX_HASH = `0x${Date.now().toString(16)}`;

function patchWebhookQueues(app: any) {
  const quidaxWebhookService = app.get(QuidaxWebhookService);

  (QueueService.prototype as any).add = async (
    queue: QueueName,
    name: string,
    job: { payload?: any; webhookId?: string },
  ) => {
    if (name !== 'process-webhook-event' || !job?.payload) {
      return { id: `test-skipped-${queue}-${Date.now()}` };
    }

    await quidaxWebhookService.processWebhookEvent(job.payload, job.webhookId);
    return { id: `test-quidax-${job.payload.event}-${job.payload.data?.id}` };
  };
}

function buildDepositPayload(quidaxAccountId: string, depositAddress: string) {
  const ts = new Date().toISOString();
  return {
    id: DEPOSIT_ID,
    type: 'coin',
    currency: CURRENCY,
    amount: DEPOSIT_AMOUNT,
    fee: '0.00000000',
    txid: TX_HASH,
    status: 'accepted',
    reason: null,
    created_at: ts,
    done_at: ts,
    wallet: {
      id: `qw_${Date.now()}`,
      name: 'Tether',
      currency: CURRENCY,
      balance: '0',
      locked: '0',
      staked: '0',
      user: {
        id: quidaxAccountId,
        email: 'test@example.com',
        sn: 'sn_test',
        reference: null,
        first_name: 'Test',
        last_name: 'User',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
      converted_balance: '0',
      reference_currency: 'usdt',
      is_crypto: true,
      default_network: NETWORK,
      networks: [
        {
          id: NETWORK,
          name: 'Binance Smart Chain',
          deposits_enabled: true,
          withdraws_enabled: true,
        },
      ],
      deposit_address: depositAddress,
      destination_tag: null,
      created_at: ts,
      updated_at: ts,
    },
    user: {
      id: quidaxAccountId,
      email: 'test@example.com',
      sn: 'sn_test',
      reference: null,
      first_name: 'Test',
      last_name: 'User',
      display_name: null,
      created_at: ts,
      updated_at: ts,
    },
    sender: '0xsender123456',
    payment_transaction: {
      status: 'confirmed',
      confirmations: 6,
      required_confirmations: 3,
    },
    payment_address: {
      id: `addr_${Date.now()}`,
      reference: null,
      currency: CURRENCY,
      address: depositAddress,
      network: NETWORK,
      user: {
        id: quidaxAccountId,
        email: 'test@example.com',
        sn: 'sn_test',
        reference: null,
        first_name: 'Test',
        last_name: 'User',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
      destination_tag: null,
      total_payments: 0,
      created_at: ts,
      updated_at: ts,
    },
  };
}

async function main() {
  const logger = new Logger('TriggerDepositWebhook');
  logger.log(`Triggering deposit webhook for user ${TARGET_USER_ID}`);

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  await app.init();

  patchWebhookQueues(app);

  const prisma = app.get(PrismaService);
  await prisma.$connect();

  const user = await prisma.user.findUnique({
    where: { id: TARGET_USER_ID },
    select: {
      id: true,
      quidaxAccountId: true,
      email: true,
      Wallet: {
        where: { currency: CURRENCY.toLowerCase() },
        select: {
          id: true,
          baseBalance: true,
          defaultNetwork: true,
          quidaxWalletId: true,
        },
      },
    },
  });

  if (!user) {
    logger.error(`User not found with ID: ${TARGET_USER_ID}`);
    await app.close();
    process.exit(1);
  }

  if (!user.quidaxAccountId) {
    logger.error(`User ${TARGET_USER_ID} has no quidaxAccountId`);
    await app.close();
    process.exit(1);
  }

  const wallet = user.Wallet[0];
  if (!wallet) {
    logger.error(`No ${CURRENCY.toUpperCase()} wallet found for user ${TARGET_USER_ID}`);
    await app.close();
    process.exit(1);
  }

  const depositAddress = wallet.quidaxWalletId
    ? `0x${Date.now().toString(16)}`
    : '0xdepositaddress123';

  const depositService = app.get(QuidaxDepositService);
  (depositService as any).fetchDeposit = async () => ({
    status: 'success',
    data: buildDepositPayload(user.quidaxAccountId!, depositAddress),
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '1500.00';

  const payload = buildDepositPayload(user.quidaxAccountId, depositAddress);

  logger.log(`Sending deposit.successful webhook for ${CURRENCY.toUpperCase()} on ${NETWORK}`);
  logger.log(`Amount: ${DEPOSIT_AMOUNT}, User: ${user.id}`);

  const quidaxWebhookService = app.get(QuidaxWebhookService);
  await quidaxWebhookService.processWebhookEvent(
    { event: 'deposit.successful', data: payload },
    undefined,
  );

  logger.log('Deposit webhook processed');

  const updatedWallet = await prisma.wallet.findUnique({
    where: { id: wallet.id },
    select: { baseBalance: true, originalBalance: true },
  });

  logger.log(`--- RESULTS ---`);
  logger.log(`Wallet baseBalance before: ${wallet.baseBalance.toString()}`);
  logger.log(`Wallet baseBalance after: ${updatedWallet?.baseBalance?.toString()}`);

  const deposit = await prisma.deposit.findFirst({
    where: { providerDepositId: DEPOSIT_ID },
  });

  const transaction = await prisma.transaction.findFirst({
    where: { transactionUniqueId: DEPOSIT_ID },
  });

  logger.log(`Deposit record created: ${!!deposit}`);
  logger.log(`Transaction record created: ${!!transaction}`);

  if (deposit && transaction) {
    logger.log('✅ Deposit webhook triggered successfully');
  } else {
    logger.error('❌ Deposit webhook failed - check logs above');
  }

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});