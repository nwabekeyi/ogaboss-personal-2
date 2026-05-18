import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { Logger } from '@nestjs/common';

export async function bootstrap() {
  const logger = new Logger('WebhookTest');
  logger.log('Bootstrapping NestJS context...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  await prisma.$connect();

  logger.log('Context ready.');

  return { app, prisma, logger };
}

export async function cleanup(prisma: PrismaService, userId: string) {
  const logger = new Logger('Cleanup');
  logger.log(`Cleaning up test data for user ${userId}...`);

  await prisma.companyWithdrawal
    .deleteMany({ where: { Transaction: { userId } } })
    .catch(() => {});
  await prisma.withdrawal
    .deleteMany({ where: { userId } })
    .catch(() => {});
  await prisma.deposit.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.swapTransaction
    .deleteMany({ where: { userId } })
    .catch(() => {});
  await prisma.order.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.transaction
    .deleteMany({ where: { userId } })
    .catch(() => {});
  await prisma.paymentAddress
    .deleteMany({ where: { wallet: { userId } } })
    .catch(() => {});
  await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.userDeviceToken.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.webhook.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});

  logger.log('Cleanup done.');
}

const TEST_USER_ID = 'test_webhook_user_001';
const QUIDAX_ACCOUNT_ID = 'quidax_test_account_001';
const QUIDAX_SN = 'sn_test_001';

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
      firstName: 'Test',
      lastName: 'WebhookUser',
      email: 'test-webhook@example.com',
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
  const quidaxWalletId = opts.quidaxWalletId ?? `qw_${opts.currency}_${Date.now()}`;

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
  return prisma.companyLiquidity.upsert({
    where: { currency },
    create: { currency, totalBalance, reservedBalance },
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

export {
  TEST_USER_ID,
  QUIDAX_ACCOUNT_ID,
  QUIDAX_SN,
};

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
