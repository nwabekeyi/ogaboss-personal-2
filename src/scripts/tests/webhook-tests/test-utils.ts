import 'dotenv/config';
import * as crypto from 'crypto';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { INestApplication, Logger, VersioningType } from '@nestjs/common';
import { QueueName } from '../../../infrastructure/bullMQ';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QuidaxWebhookService } from '../../../modules/webhook/quidax';
import { PaystackWebhookHandler } from '../../../modules/webhook/paystack';

process.env.PAYSTACK_SECRET_KEY_TEST ||= 'test_paystack_secret';
process.env.PAYSTACK_SECRET_KEY_LIVE ||= process.env.PAYSTACK_SECRET_KEY_TEST;
process.env.QUIDAX_WEBHOOK_SECRET ||= 'test_quidax_webhook_secret';
process.env.NODE_ENV ||= 'development';

const QUIDAX_WEBHOOK_PATH = '/api/v1/webhook/quidax';
const PAYSTACK_WEBHOOK_PATH = '/api/v1/webhook/paystack';

export async function bootstrap() {
  const logger = new Logger('WebhookTest');
  logger.log('Bootstrapping NestJS test app...');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
    rawBody: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  await app.init();

  patchWebhookQueues(app);

  const prisma = app.get(PrismaService);
  await prisma.$connect();

  logger.log('Test app ready.');

  return { app, prisma, logger };
}

function patchWebhookQueues(app: INestApplication) {
  const quidaxWebhookService = app.get(QuidaxWebhookService);
  const paystackWebhookHandler = app.get(PaystackWebhookHandler);

  // Patch the prototype instead of a single injected instance because QueueService
  // is provided by more than one module in this app. The webhook controller may
  // receive a different QueueService instance than app.get(QueueService), so an
  // instance-only patch can still enqueue to BullMQ and leave the test waiting on
  // async workers.
  (QueueService.prototype as any).add = async (
    queue: QueueName,
    name: string,
    job: { payload?: any; webhookId?: string },
  ) => {
    if (name !== 'process-webhook-event' || !job?.payload) {
      return { id: `test-skipped-${queue}-${Date.now()}` };
    }

    if (queue === QueueName.PAYSTACK) {
      await paystackWebhookHandler.handleWebhook(JSON.stringify(job.payload));
      return {
        id: `test-paystack-${job.payload.event}-${job.payload.data?.id}`,
      };
    }

    await quidaxWebhookService.processWebhookEvent(job.payload, job.webhookId);
    return { id: `test-quidax-${job.payload.event}-${job.payload.data?.id}` };
  };
}

function quidaxSignature(rawBody: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', process.env.QUIDAX_WEBHOOK_SECRET as string)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

function paystackSignature(rawBody: string): string {
  return crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST as string)
    .update(rawBody)
    .digest('hex');
}

export async function postTestQuidaxWebhook(
  app: INestApplication,
  event: string,
  data: Record<string, any>,
) {
  const rawBody = JSON.stringify({ event, data });
  const response = await request(app.getHttpServer())
    .post(QUIDAX_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set('quidax-signature', quidaxSignature(rawBody))
    .send(rawBody);

  if (response.status >= 300) {
    throw new Error(
      `Quidax test route failed for ${event}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return response.body;
}

export async function postTestPaystackWebhook(
  app: INestApplication,
  payload: Record<string, any>,
) {
  const rawBody = JSON.stringify(payload);
  const response = await request(app.getHttpServer())
    .post(PAYSTACK_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set('x-paystack-signature', paystackSignature(rawBody))
    .send(rawBody);

  if (response.status >= 300) {
    throw new Error(
      `Paystack test route failed for ${payload.event}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return response.body;
}

export type BalanceFields = Record<string, bigint>;

export type MathSnapshot = {
  wallets: Record<string, BalanceFields>;
  liquidity: Record<string, BalanceFields>;
  user: BalanceFields;
};

function toBaseUnit(value: unknown): bigint {
  if (value == null) return 0n;

  const normalized = String(value);
  const [whole] = normalized.split('.');
  return BigInt(whole || '0');
}

export async function captureMathSnapshot(
  prisma: PrismaService,
  userId: string,
): Promise<MathSnapshot> {
  const [wallets, liquidity, user] = await Promise.all([
    prisma.wallet.findMany({
      where: { userId },
      select: {
        currency: true,
        baseBalance: true,
        reservedBalance: true,
        lockedAmount: true,
        stackedAmount: true,
      },
    }),
    prisma.companyLiquidity.findMany({
      select: {
        currency: true,
        totalBalance: true,
        reservedBalance: true,
        internalBalance: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        amountBought: true,
        amountReceived: true,
        amountSold: true,
        amountSent: true,
      },
    }),
  ]);

  return {
    wallets: Object.fromEntries(
      wallets.map((wallet) => [
        wallet.currency.toLowerCase(),
        {
          baseBalance: toBaseUnit(wallet.baseBalance),
          reservedBalance: toBaseUnit(wallet.reservedBalance),
          lockedAmount: toBaseUnit(wallet.lockedAmount),
          stackedAmount: toBaseUnit(wallet.stackedAmount),
        },
      ]),
    ),
    liquidity: liquidity.reduce<Record<string, BalanceFields>>((acc, item) => {
      const key = item.currency.toLowerCase();
      const values = {
        totalBalance: toBaseUnit(item.totalBalance),
        reservedBalance: toBaseUnit(item.reservedBalance),
        internalBalance: toBaseUnit(item.internalBalance),
      };

      // Some local databases have historical case variants such as "NGN" and
      // "ngn". The webhook scripts seed lower-case currencies, so prefer the
      // exact lower-case test row when duplicates exist; otherwise use whichever
      // row is available.
      if (!acc[key] || item.currency === key) acc[key] = values;

      return acc;
    }, {}),
    user: {
      amountBought: toBaseUnit(user?.amountBought),
      amountReceived: toBaseUnit(user?.amountReceived),
      amountSold: toBaseUnit(user?.amountSold),
      amountSent: toBaseUnit(user?.amountSent),
    },
  };
}

function snapshotValue(
  snapshot: MathSnapshot,
  scope: 'wallets' | 'liquidity' | 'user',
  key: string,
  field?: string,
): bigint {
  if (scope === 'user') return snapshot.user[key] ?? 0n;
  return snapshot[scope][key]?.[field as string] ?? 0n;
}

export function logMathExpectations(
  logger: Logger,
  scenario: string,
  before: MathSnapshot,
  after: MathSnapshot,
  expectations: Array<{
    label: string;
    scope: 'wallets' | 'liquidity' | 'user';
    key: string;
    field?: string;
    expectedDelta: bigint;
  }>,
) {
  logger.log(`--- ${scenario} math checks ---`);

  for (const expectation of expectations) {
    const start = snapshotValue(
      before,
      expectation.scope,
      expectation.key,
      expectation.field,
    );
    const end = snapshotValue(
      after,
      expectation.scope,
      expectation.key,
      expectation.field,
    );
    const actualDelta = end - start;
    const matches = actualDelta === expectation.expectedDelta;
    const message = `${matches ? '✅' : '❌'} ${expectation.label}: start=${start.toString()}, end=${end.toString()}, actualDelta=${actualDelta.toString()}, expectedDelta=${expectation.expectedDelta.toString()}`;

    if (matches) logger.log(message);
    else logger.error(message);
  }
}

export function logMathObservations(
  logger: Logger,
  scenario: string,
  before: MathSnapshot,
  after: MathSnapshot,
  observations: Array<{
    label: string;
    scope: 'wallets' | 'liquidity' | 'user';
    key: string;
    field?: string;
  }>,
) {
  logger.log(`--- ${scenario} observed values ---`);

  for (const observation of observations) {
    const start = snapshotValue(
      before,
      observation.scope,
      observation.key,
      observation.field,
    );
    const end = snapshotValue(
      after,
      observation.scope,
      observation.key,
      observation.field,
    );
    const actualDelta = end - start;

    logger.log(
      `ℹ️ ${observation.label}: start=${start.toString()}, end=${end.toString()}, actualDelta=${actualDelta.toString()}`,
    );
  }
}

export async function cleanup(prisma: PrismaService, userId: string) {
  const logger = new Logger('Cleanup');
  logger.log(`Cleaning up test data for user ${userId}...`);

  await prisma.companyWithdrawal
    .deleteMany({ where: { Transaction: { userId } } })
    .catch(() => {});
  await prisma.withdrawal.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.userBankAccount
    .deleteMany({ where: { userId } })
    .catch(() => {});
  await prisma.deposit.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.swapTransaction
    .deleteMany({ where: { userId } })
    .catch(() => {});
  await prisma.order.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.transaction.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.paymentAddress
    .deleteMany({ where: { wallet: { userId } } })
    .catch(() => {});
  await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.userDeviceToken
    .deleteMany({ where: { userId } })
    .catch(() => {});
  await prisma.webhook.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.webhook
    .deleteMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: 'charge.success_paystack_charge_' } },
          { idempotencyKey: { startsWith: 'transfer.success_transfer_ref_' } },
          { idempotencyKey: { startsWith: 'order.done_qorder_' } },
          { idempotencyKey: { startsWith: 'deposit.successful_dep_test_' } },
          { idempotencyKey: { startsWith: 'withdraw.successful_pwdr_' } },
        ],
      },
    })
    .catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});

  logger.log('Cleanup done.');
}

const TEST_USER_ID = 'test_webhook_user_001';
const QUIDAX_ACCOUNT_ID = "17331dda-12f6-49ef-91e4-d283af9a0dba";
const QUIDAX_SN = "QDX2O5GO3QN";

export async function seedUser(prisma: PrismaService) {
  const logger = new Logger('Seed');

  const existing = await prisma.user.findUnique({
    where: { id: TEST_USER_ID },
  });
  if (existing) {
    logger.log('Test user already exists, skipping seed.');
    return existing;
  }

  const user = await prisma.user.create({
    data: {
      id: TEST_USER_ID,
      firstName: 'Amaremo',
      lastName: 'Bunmi',
      email: 'amaremo2@mailinator.com',
      quidaxAccountId: QUIDAX_ACCOUNT_ID,
      quidaxSnId: QUIDAX_SN,
      isEmailVerified: true,
      status: 'ACTIVE' as any,
      pin: '1234',
    },
  });

  // Seed a mock FCM device token so notification service doesn't fail
  await prisma.userDeviceToken.create({
    data: {
      userId: user.id,
      token: `test_fcm_token_${Date.now()}`,
      platform: 'ANDROID' as any,
      deviceName: 'Test Device',
      deviceId: 'test_device_001',
      isActive: true,
    },
  });

  logger.log(`Seeded user: ${user.id} (with device token)`);
  return user;
}

export async function seedWallet(
  prisma: PrismaService,
  opts: {
    userId?: string;
    currency: string;
    name: string;
    baseBalance?: string;
    reservedBalance?: string;
    blockchainEnabled?: boolean;
    defaultNetwork?: string;
    isCrypto?: boolean;
    quidaxWalletId?: string;
  },
) {
  const userId = opts.userId ?? TEST_USER_ID;
  const quidaxWalletId =
    opts.quidaxWalletId ?? `qw_${opts.currency}_${Date.now()}`;

  const wallet = await prisma.wallet.create({
    data: {
      quidaxWalletId,
      userId,
      name: opts.name,
      currency: opts.currency.toLowerCase(),
      baseBalance: opts.baseBalance ?? '0',
      reservedBalance: opts.reservedBalance ?? '0',
      originalBalance: opts.baseBalance ?? '0',
      isCrypto: opts.isCrypto ?? true,
      blockchainEnabled: opts.blockchainEnabled ?? false,
      defaultNetwork: opts.defaultNetwork,
    },
  });

  return wallet;
}

export async function seedCompanyLiquidity(
  prisma: PrismaService,
  currency: string,
  totalBalance: string,
  reservedBalance: string = '0',
) {
  const normalizedCurrency = currency.toLowerCase();

  return prisma.companyLiquidity.upsert({
    where: { currency: normalizedCurrency },
    create: {
      currency: normalizedCurrency,
      totalBalance,
      reservedBalance,
    },
    update: { totalBalance, reservedBalance },
  });
}

export async function seedTransaction(
  prisma: PrismaService,
  data: {
    userId?: string;
    transactionUniqueId: string;
    currency: string;
    transactionType: string;
    transactionContext: string;
    status?: string;
    cryptoAmountBase?: string;
    cryptoAmountOriginal?: string;
    fiatAmountBase?: string;
    fiatAmountOriginal?: string;
    platformFeeBase?: string;
    networkFeeBase?: string;
    bufferAmountBase?: string;
    totalAmountSentBase?: string;
    network?: string;
    paymentType?: string;
    paymentMetadata?: any;
    senderWalletAddress?: string;
    receiverWalletAddress?: string;
    isProcessed?: boolean;
  },
) {
  const userId = data.userId ?? TEST_USER_ID;

  return prisma.transaction.create({
    data: {
      userId,
      transactionUniqueId: data.transactionUniqueId,
      currency: data.currency,
      transactionType: data.transactionType as any,
      transactionContext: data.transactionContext as any,
      status: (data.status ?? 'PENDING') as any,
      cryptoAmountBase: data.cryptoAmountBase,
      cryptoAmountOriginal: data.cryptoAmountOriginal,
      fiatAmountBase: data.fiatAmountBase ?? '0',
      fiatAmountOriginal: data.fiatAmountOriginal,
      platformFeeBase: data.platformFeeBase,
      networkFeeBase: data.networkFeeBase,
      bufferAmountBase: data.bufferAmountBase,
      totalAmountSentBase: data.totalAmountSentBase,
      network: data.network,
      paymentType: data.paymentType as any,
      paymentMetadata: data.paymentMetadata,
      senderWalletAddress: data.senderWalletAddress,
      receiverWalletAddress: data.receiverWalletAddress,
      isProcessed: data.isProcessed ?? false,
    },
  });
}

export async function seedOrder(
  prisma: PrismaService,
  data: {
    userId?: string;
    transactionId: string;
    type: string;
    referenceNo?: string;
    status?: string;
    paymentStatus?: string;
    cryptoAmountBase?: string;
    fiatAmountBase?: string;
    paymentReference?: string;
  },
) {
  return prisma.order.create({
    data: {
      userId: data.userId ?? TEST_USER_ID,
      transactionId: data.transactionId,
      type: data.type as any,
      referenceNo: data.referenceNo,
      status: (data.status ?? 'PENDING') as any,
      paymentStatus: (data.paymentStatus ?? 'PENDING') as any,
      cryptoAmountBase: data.cryptoAmountBase,
      fiatAmountBase: data.fiatAmountBase ?? '0',
      paymentReference: data.paymentReference,
    },
  });
}

export { TEST_USER_ID, QUIDAX_ACCOUNT_ID, QUIDAX_SN };

type TestFn = (ctx: {
  app: Awaited<ReturnType<typeof bootstrap>>['app'];
  prisma: PrismaService;
  logger: Logger;
}) => Promise<void>;

export async function runTest(fn: TestFn) {
  const { app, prisma, logger } = await bootstrap();

  try {
    await fn({ app, prisma, logger });
  } catch (err) {
    logger.error('Test failed with error:', err);
  } finally {
    await cleanup(prisma, TEST_USER_ID);
    await app.close();
  }
}