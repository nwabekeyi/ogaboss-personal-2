import 'dotenv/config';
import * as crypto from 'crypto';
import request from 'supertest';
import { INestApplication, Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QueueName } from '../../../infrastructure/bullMQ';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { QuidaxOrderService } from '../../../infrastructure/providers/quidax';
import { QuidaxDepositService } from '../../../infrastructure/providers/quidax/deposit.service';
import { QuidaxWithdrawalService } from '../../../infrastructure/providers/quidax/withdrawal.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';
import { QuidaxWebhookService } from '../../../modules/webhook/quidax';
import { PaystackWebhookHandler } from '../../../modules/webhook/paystack';
import { TransactionNotificationService } from '../../../modules/transaction/services/transaction-notification.service';

process.env.PAYSTACK_SECRET_KEY_TEST ||= 'test_paystack_secret';
process.env.PAYSTACK_SECRET_KEY_LIVE ||= process.env.PAYSTACK_SECRET_KEY_TEST;
process.env.QUIDAX_WEBHOOK_SECRET ||= 'test_quidax_webhook_secret';
process.env.NODE_ENV ||= 'development';

const TEST_EMAIL = process.env.WEBHOOK_TEST_EMAIL || 'workch4@outlook.com';
const QUIDAX_WEBHOOK_PATH = '/api/v1/webhook/quidax';
const PAYSTACK_WEBHOOK_PATH = '/api/v1/webhook/paystack';
const RUN_ID = `route_wh_${Date.now()}`;
const BUY_PAYMENT_REFERENCE = `${RUN_ID}_buy_payment`;
const BUY_ORDER_REFERENCE = `${RUN_ID}_buy_order`;
const SELL_ORDER_REFERENCE = `${RUN_ID}_sell_order`;
const SEND_REFERENCE = `${RUN_ID}_send`;
const RECEIVE_PROVIDER_ID = `${RUN_ID}_receive`;

const EXPECTED_BUY_ORDER_CRYPTO_DELTA = 100000n;
const EXPECTED_BUY_ORDER_NGN_LIQUIDITY_DELTA = -35000000n;
const EXPECTED_RECEIVE_CRYPTO_DELTA = 500000n;
const EXPECTED_RECEIVE_INTERNAL_LIQUIDITY_DELTA = 500000n;
const EXPECTED_RECEIVE_AMOUNT_RECEIVED_DELTA = 17500000n;
const EXPECTED_SELL_NGN_LIQUIDITY_DELTA = 35000000n;
const EXPECTED_SEND_WALLET_DELTA = -5010000n;
const EXPECTED_SEND_LIQUIDITY_TOTAL_DELTA = -5000000n;
const EXPECTED_SEND_LIQUIDITY_RESERVED_DELTA = -5010000n;
const EXPECTED_SEND_INTERNAL_LIQUIDITY_DELTA = -5000000n;

type BalanceFields = Record<string, bigint>;

type MathSnapshot = {
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

async function captureMathSnapshot(
  prisma: PrismaService,
  userId: string,
): Promise<MathSnapshot> {
  const [wallets, liquidity, user] = await Promise.all([
    prisma.wallet.findMany({
      where: { userId, currency: { in: ['btc', 'usdt'] } },
      select: {
        currency: true,
        baseBalance: true,
        reservedBalance: true,
        lockedAmount: true,
        stackedAmount: true,
      },
    }),
    prisma.companyLiquidity.findMany({
      where: { currency: { in: ['btc', 'usdt', 'ngn'] } },
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
    liquidity: Object.fromEntries(
      liquidity.map((item) => [
        item.currency.toLowerCase(),
        {
          totalBalance: toBaseUnit(item.totalBalance),
          reservedBalance: toBaseUnit(item.reservedBalance),
          internalBalance: toBaseUnit(item.internalBalance),
        },
      ]),
    ),
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

function logMathExpectations(
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

async function postQuidaxWebhook(app: INestApplication, payload: any) {
  const rawBody = JSON.stringify(payload);
  const response = await request(app.getHttpServer())
    .post(QUIDAX_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set('quidax-signature', quidaxSignature(rawBody))
    .send(rawBody);

  if (response.status >= 300) {
    throw new Error(
      `Quidax route failed for ${payload.event}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return response.body;
}

async function postPaystackWebhook(app: INestApplication, payload: any) {
  const rawBody = JSON.stringify(payload);
  const response = await request(app.getHttpServer())
    .post(PAYSTACK_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set('x-paystack-signature', paystackSignature(rawBody))
    .send(rawBody);

  if (response.status >= 300) {
    throw new Error(
      `Paystack route failed for ${payload.event}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return response.body;
}

async function upsertWallet(
  prisma: PrismaService,
  userId: string,
  currency: string,
  data: {
    name: string;
    baseBalance: string;
    reservedBalance?: string;
    blockchainEnabled?: boolean;
    defaultNetwork?: string;
    isCrypto?: boolean;
  },
) {
  return prisma.wallet.upsert({
    where: { userId_currency: { userId, currency: currency.toLowerCase() } },
    create: {
      userId,
      quidaxWalletId: `${RUN_ID}_${currency.toLowerCase()}_wallet`,
      currency: currency.toLowerCase(),
      name: data.name,
      baseBalance: data.baseBalance,
      reservedBalance: data.reservedBalance ?? '0',
      originalBalance: data.baseBalance,
      blockchainEnabled: data.blockchainEnabled ?? true,
      defaultNetwork: data.defaultNetwork,
      isCrypto: data.isCrypto ?? true,
    },
    update: {
      baseBalance: data.baseBalance,
      reservedBalance: data.reservedBalance ?? '0',
      originalBalance: data.baseBalance,
      blockchainEnabled: data.blockchainEnabled ?? true,
      defaultNetwork: data.defaultNetwork,
      isCrypto: data.isCrypto ?? true,
    },
  });
}

async function seedCompanyLiquidity(
  prisma: PrismaService,
  currency: string,
  totalBalance: string,
  reservedBalance = '0',
) {
  return prisma.companyLiquidity.upsert({
    where: { currency: currency.toLowerCase() },
    create: {
      currency: currency.toLowerCase(),
      totalBalance,
      reservedBalance,
    },
    update: {
      totalBalance,
      reservedBalance,
    },
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
    rawBody: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  const quidaxWebhookService = app.get(QuidaxWebhookService);
  const paystackWebhookHandler = app.get(PaystackWebhookHandler);
  const queueService = app.get(QueueService);

  (queueService as any).add = async (
    queue: QueueName,
    _name: string,
    job: any,
  ) => {
    if (queue === QueueName.PAYSTACK) {
      await paystackWebhookHandler.handleWebhook(JSON.stringify(job.payload));
      return { id: `inline-${job.payload.event}-${job.payload.data.id}` };
    }

    await quidaxWebhookService.processWebhookEvent(job.payload, job.webhookId);
    return { id: `inline-${job.payload.event}-${job.payload.data.id}` };
  };

  const notifications = app.get(TransactionNotificationService);
  (notifications as any).sendTransactionStatusNotification = async () =>
    undefined;

  await app.init();
  return app;
}

async function seedRecords(prisma: PrismaService, user: any) {
  const userQuidaxId = user.quidaxAccountId || `${RUN_ID}_quidax_user`;
  if (!user.quidaxAccountId) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        quidaxAccountId: userQuidaxId,
        quidaxSnId: user.quidaxSnId || `${RUN_ID}_sn`,
      },
    });
  }

  const btcWallet = await upsertWallet(prisma, user.id, 'btc', {
    name: 'Bitcoin',
    baseBalance: '200000',
    reservedBalance: '100000',
    defaultNetwork: 'btc',
  });
  const usdtWallet = await upsertWallet(prisma, user.id, 'usdt', {
    name: 'Tether',
    baseBalance: '5000000',
    reservedBalance: '5010000',
    defaultNetwork: 'trc20',
  });

  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '70000000');
  await seedCompanyLiquidity(prisma, 'btc', '1000000000', '100000');
  await seedCompanyLiquidity(prisma, 'usdt', '100000000000', '5010000');

  const buyPaymentTx = await prisma.transaction.create({
    data: {
      userId: user.id,
      transactionUniqueId: BUY_PAYMENT_REFERENCE,
      currency: 'btc',
      transactionType: 'DEBIT' as any,
      transactionContext: 'BUY' as any,
      status: 'PENDING' as any,
      cryptoAmountBase: '100000',
      cryptoAmountOriginal: '0.001',
      fiatAmountBase: '35000000',
      fiatAmountOriginal: '350000',
      platformFeeBase: '50000',
      bufferAmountBase: '10000',
      network: 'btc',
      paymentType: 'CARD' as any,
      paymentMetadata: {
        liquidityReservationStatus: 'RESERVED',
        liquidityReservationAmount: '35000000',
      },
    },
  });

  const buyOrderTx = await prisma.transaction.create({
    data: {
      userId: user.id,
      transactionUniqueId: `${RUN_ID}_buy_order_tx`,
      currency: 'btc',
      transactionType: 'DEBIT' as any,
      transactionContext: 'BUY' as any,
      status: 'PENDING' as any,
      cryptoAmountBase: '100000',
      cryptoAmountOriginal: '0.001',
      fiatAmountBase: '35000000',
      fiatAmountOriginal: '350000',
      platformFeeBase: '50000',
      bufferAmountBase: '10000',
      network: 'btc',
      paymentType: 'CRYPTO_WALLET' as any,
      paymentMetadata: {
        liquidityReservationStatus: 'RESERVED',
        liquidityReservationAmount: '35000000',
      },
    },
  });
  await prisma.order.create({
    data: {
      userId: user.id,
      transactionId: buyOrderTx.id,
      type: 'BUY' as any,
      referenceNo: BUY_ORDER_REFERENCE,
      status: 'PENDING' as any,
      paymentStatus: 'PENDING' as any,
      cryptoAmountBase: '100000',
      fiatAmountBase: '35000000',
    },
  });

  const sellTx = await prisma.transaction.create({
    data: {
      userId: user.id,
      transactionUniqueId: `${RUN_ID}_sell_tx`,
      currency: 'btc',
      transactionType: 'DEBIT' as any,
      transactionContext: 'SELL' as any,
      status: 'PENDING' as any,
      cryptoAmountBase: '100000',
      cryptoAmountOriginal: '0.001',
      fiatAmountBase: '35000000',
      fiatAmountOriginal: '350000',
      platformFeeBase: '50000',
      bufferAmountBase: '10000',
      totalAmountSentBase: '100000',
      network: 'btc',
      paymentType: 'CRYPTO_WALLET' as any,
      senderWalletAddress: btcWallet.id,
      paymentMetadata: {
        liquidityReservationStatus: 'RESERVED',
        liquidityReservationAmount: '35000000',
        payoutAccountNumber: '1234567890',
        payoutBankCode: '058',
        payoutAccountName: 'Webhook Test',
      },
    },
  });
  await prisma.order.create({
    data: {
      userId: user.id,
      transactionId: sellTx.id,
      type: 'SELL' as any,
      referenceNo: SELL_ORDER_REFERENCE,
      status: 'PENDING' as any,
      paymentStatus: 'PENDING' as any,
      cryptoAmountBase: '100000',
      fiatAmountBase: '35000000',
    },
  });

  const sendTx = await prisma.transaction.create({
    data: {
      userId: user.id,
      transactionUniqueId: `${RUN_ID}_send_tx`,
      currency: 'usdt',
      transactionType: 'DEBIT' as any,
      transactionContext: 'WITHDRAWAL' as any,
      status: 'PENDING' as any,
      cryptoAmountBase: '5000000',
      fiatAmountBase: '5000000000',
      platformFeeBase: '10000',
      networkFeeBase: '5000',
      totalAmountSentBase: '5010000',
      network: 'trc20',
      paymentType: 'CRYPTO_WALLET' as any,
      senderWalletAddress: usdtWallet.id,
    },
  });
  await prisma.withdrawal.create({
    data: {
      userId: user.id,
      providerWithdrawalId: `${RUN_ID}_provider_withdrawal`,
      reference: SEND_REFERENCE,
      currency: 'usdt',
      network: 'trc20',
      amount: '5000000',
      status: 'PENDING' as any,
      transactionId: sendTx.id,
      createdAtProvider: new Date(),
      rawPayload: {},
    },
  });

  return {
    userQuidaxId,
    btcWallet,
    usdtWallet,
    buyPaymentTx,
    buyOrderTx,
    sellTx,
    sendTx,
  };
}

function orderDonePayload(reference: string, side: 'buy' | 'sell', user: any) {
  const ts = new Date().toISOString();
  return {
    event: 'order.done',
    data: {
      id: `${reference}_provider`,
      reference,
      market: { id: 'btcngn', base_unit: 'btc', quote_unit: 'ngn' },
      side,
      order_type: 'market',
      price: { unit: 'ngn', amount: '350000000' },
      avg_price: { unit: 'ngn', amount: '350000000' },
      volume: { unit: 'btc', amount: '0.001' },
      origin_volume: { unit: 'btc', amount: '0.001' },
      executed_volume: { unit: 'btc', amount: '0.001' },
      status: 'done',
      trades_count: 1,
      created_at: ts,
      updated_at: ts,
      done_at: ts,
      user: {
        id: user.quidaxAccountId,
        sn: user.quidaxSnId,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
      },
      trades: [
        {
          id: `${reference}_trade`,
          market: { id: 'btcngn', base_unit: 'btc', quote_unit: 'ngn' },
          price: { unit: 'ngn', amount: '350000000' },
          volume: { unit: 'btc', amount: '0.001' },
          total: { unit: 'ngn', amount: '35000000' },
          created_at: ts,
          updated_at: ts,
        },
      ],
    },
  };
}

function receivePayload(user: any, wallet: any) {
  const ts = new Date().toISOString();
  return {
    event: 'deposit.successful',
    data: {
      id: RECEIVE_PROVIDER_ID,
      type: 'coin',
      currency: 'btc',
      amount: '0.005',
      fee: '0.0001',
      txid: `${RUN_ID}_tx_hash`,
      status: 'accepted',
      reason: null,
      created_at: ts,
      done_at: ts,
      wallet: {
        id: wallet.quidaxWalletId,
        name: 'Bitcoin',
        currency: 'btc',
        balance: '0.01',
        locked: '0',
        staked: '0',
        user: {
          id: user.quidaxAccountId,
          email: user.email,
          sn: user.quidaxSnId,
        },
        converted_balance: '500.00',
        reference_currency: 'ngn',
        is_crypto: true,
        default_network: 'btc',
        deposit_address: `${RUN_ID}_btc_address`,
        destination_tag: null,
        created_at: ts,
        updated_at: ts,
      },
      user: {
        id: user.quidaxAccountId,
        email: user.email,
        sn: user.quidaxSnId,
      },
      sender: `${RUN_ID}_sender`,
      payment_transaction: {
        status: 'confirmed',
        confirmations: 6,
        required_confirmations: 3,
      },
      payment_address: {
        id: `${RUN_ID}_payment_address`,
        reference: null,
        currency: 'btc',
        address: `${RUN_ID}_btc_address`,
        network: 'btc',
        user: {
          id: user.quidaxAccountId,
          email: user.email,
          sn: user.quidaxSnId,
        },
        destination_tag: null,
        total_payments: 1,
        created_at: ts,
        updated_at: ts,
      },
    },
  };
}

function sendPayload(user: any, wallet: any) {
  const ts = new Date().toISOString();
  return {
    event: 'withdraw.successful',
    data: {
      id: `${RUN_ID}_provider_withdrawal`,
      reference: SEND_REFERENCE,
      type: 'coin_address',
      currency: 'usdt',
      amount: '5.00',
      fee: '0.01',
      total: '5.01',
      txid: `${RUN_ID}_withdrawal_hash`,
      transaction_note: 'Route webhook send test',
      narration: 'Withdrawal to test wallet',
      status: 'Done',
      reason: null,
      created_at: ts,
      done_at: ts,
      recipient: {
        type: 'coin_address',
        details: {
          address: `${RUN_ID}_recipient`,
          destination_tag: null,
          name: null,
        },
      },
      wallet: {
        id: wallet.quidaxWalletId,
        currency: 'usdt',
        balance: '500',
        locked: '0',
        staked: '0',
        converted_balance: '750000',
        reference_currency: 'ngn',
        is_crypto: true,
        created_at: ts,
        updated_at: ts,
        deposit_address: `${RUN_ID}_usdt_address`,
        destination_tag: null,
      },
      user: {
        id: user.quidaxAccountId,
        sn: user.quidaxSnId,
        email: user.email,
      },
    },
  };
}

function paystackChargeSuccessPayload() {
  return {
    event: 'charge.success',
    data: {
      id: Date.now(),
      reference: BUY_PAYMENT_REFERENCE,
      amount: 35000000,
      gateway_response: 'Successful',
      status: 'success',
      channel: 'card',
      currency: 'NGN',
      paid_at: new Date().toISOString(),
    },
  };
}

async function patchExternalProviders(app: INestApplication) {
  const paystackService = app.get(PaystackService);
  (paystackService as any).verifyTransaction = async (reference: string) => ({
    status: true,
    data: {
      reference,
      amount: 35000000,
      gateway_response: 'Successful',
      status: 'success',
      channel: 'card',
    },
  });
  (paystackService as any).createTransferRecipient = async () => ({
    status: true,
    data: { recipient_code: `${RUN_ID}_recipient_code` },
  });
  (paystackService as any).initiateTransfer = async () => ({
    status: true,
    data: {
      reference: `${RUN_ID}_transfer`,
      transfer_code: `${RUN_ID}_transfer_code`,
    },
  });

  const quidaxOrderService = app.get(QuidaxOrderService);
  (quidaxOrderService as any).buyOrSellOrderRequest = async () => ({
    status: 'success',
    data: {
      id: `${RUN_ID}_quidax_buy_order`,
      reference: `${RUN_ID}_quidax_buy_order_ref`,
    },
  });

  const quidaxDepositService = app.get(QuidaxDepositService);
  (quidaxDepositService as any).fetchDeposit = async (
    _quidaxUserId: string,
    providerDepositId: string,
  ) => ({
    status: 'success',
    data: receivePayload(
      {
        quidaxAccountId: _quidaxUserId,
        email: TEST_EMAIL,
        quidaxSnId: `${RUN_ID}_sn`,
      },
      { quidaxWalletId: `${RUN_ID}_btc_wallet` },
    ).data,
  });

  const quidaxWithdrawalService = app.get(QuidaxWithdrawalService);
  (quidaxWithdrawalService as any).withdrawToCompanyAccount = async (
    _quidaxUserId: string,
    _currency: string,
    _amount: string,
    reference: { providerId?: string },
  ) => ({
    status: 'success',
    data: { reference: `${RUN_ID}_company_sweep_${reference.providerId}` },
  });
  (quidaxWithdrawalService as any).getWithdrawerByReference = async () => ({
    status: 'success',
    data: {
      status: 'Done',
      amount: '5.00',
      fee: '0.01',
      total: '5.01',
      txid: `${RUN_ID}_withdrawal_hash`,
      done_at: new Date().toISOString(),
      transaction_note: 'Route webhook send test',
      narration: 'Withdrawal to test wallet',
    },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '35000000';
}

async function printResults(prisma: PrismaService) {
  const [
    buyPaymentTx,
    buyPaymentOrder,
    buyOrder,
    sellOrder,
    receiveTx,
    withdrawal,
  ] = await Promise.all([
    prisma.transaction.findUnique({
      where: { transactionUniqueId: BUY_PAYMENT_REFERENCE },
    }),
    prisma.order.findFirst({
      where: { paymentReference: BUY_PAYMENT_REFERENCE },
    }),
    prisma.order.findFirst({
      where: { referenceNo: BUY_ORDER_REFERENCE },
      include: { user: true },
    }),
    prisma.order.findFirst({
      where: { referenceNo: SELL_ORDER_REFERENCE },
      include: { user: true },
    }),
    prisma.transaction.findUnique({
      where: { transactionUniqueId: RECEIVE_PROVIDER_ID },
    }),
    prisma.withdrawal.findUnique({ where: { reference: SEND_REFERENCE } }),
  ]);

  console.log('\n=== Route webhook test records ===');
  console.log(`Run id: ${RUN_ID}`);
  console.log(
    `Buy payment transaction: ${buyPaymentTx?.status}, order ref: ${buyPaymentOrder?.referenceNo}`,
  );
  console.log(
    `Buy order webhook order: ${buyOrder?.status}, payment: ${buyOrder?.paymentStatus}`,
  );
  console.log(
    `Sell order webhook order: ${sellOrder?.status}, payment: ${sellOrder?.paymentStatus}`,
  );
  console.log(`Receive transaction: ${receiveTx?.status}`);
  console.log(`Send withdrawal: ${withdrawal?.status}`);
}

async function main() {
  const logger = new Logger('RouteWebhookTest');
  const app = await bootstrap();
  const prisma = app.get(PrismaService);

  try {
    await patchExternalProviders(app);

    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (!user) {
      throw new Error(`User with email ${TEST_EMAIL} was not found`);
    }

    const seeded = await seedRecords(prisma, user);
    const freshUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    logger.log('Calling Paystack buy payment webhook route...');
    let before = await captureMathSnapshot(prisma, user.id);
    await postPaystackWebhook(app, paystackChargeSuccessPayload());
    let after = await captureMathSnapshot(prisma, user.id);
    logMathExpectations(logger, 'Paystack buy payment webhook', before, after, [
      {
        label:
          'BTC wallet base balance stays unchanged while buy order is submitted',
        scope: 'wallets',
        key: 'btc',
        field: 'baseBalance',
        expectedDelta: 0n,
      },
      {
        label: 'NGN company liquidity total stays unchanged until order.done',
        scope: 'liquidity',
        key: 'ngn',
        field: 'totalBalance',
        expectedDelta: 0n,
      },
      {
        label:
          'NGN company liquidity reserved stays unchanged until order.done',
        scope: 'liquidity',
        key: 'ngn',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
    ]);

    logger.log('Calling Quidax buy order webhook route...');
    before = await captureMathSnapshot(prisma, user.id);
    await postQuidaxWebhook(
      app,
      orderDonePayload(BUY_ORDER_REFERENCE, 'buy', freshUser),
    );
    after = await captureMathSnapshot(prisma, user.id);
    logMathExpectations(logger, 'Quidax buy order webhook', before, after, [
      {
        label: 'BTC wallet base balance receives bought crypto',
        scope: 'wallets',
        key: 'btc',
        field: 'baseBalance',
        expectedDelta: EXPECTED_BUY_ORDER_CRYPTO_DELTA,
      },
      {
        label: 'BTC wallet reserved balance stays unchanged for buy completion',
        scope: 'wallets',
        key: 'btc',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
      {
        label: 'NGN company liquidity total consumes reserved buy fiat',
        scope: 'liquidity',
        key: 'ngn',
        field: 'totalBalance',
        expectedDelta: EXPECTED_BUY_ORDER_NGN_LIQUIDITY_DELTA,
      },
      {
        label: 'NGN company liquidity reserved consumes reserved buy fiat',
        scope: 'liquidity',
        key: 'ngn',
        field: 'reservedBalance',
        expectedDelta: EXPECTED_BUY_ORDER_NGN_LIQUIDITY_DELTA,
      },
      {
        label: 'User amountBought increases by executed fiat base amount',
        scope: 'user',
        key: 'amountBought',
        expectedDelta: 35000000n,
      },
    ]);

    logger.log('Calling Quidax receive webhook route...');
    before = await captureMathSnapshot(prisma, user.id);
    await postQuidaxWebhook(app, receivePayload(freshUser, seeded.btcWallet));
    after = await captureMathSnapshot(prisma, user.id);
    logMathExpectations(logger, 'Quidax receive webhook', before, after, [
      {
        label: 'BTC wallet base balance receives deposit amount',
        scope: 'wallets',
        key: 'btc',
        field: 'baseBalance',
        expectedDelta: EXPECTED_RECEIVE_CRYPTO_DELTA,
      },
      {
        label: 'BTC wallet reserved balance stays unchanged for deposit',
        scope: 'wallets',
        key: 'btc',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
      {
        label: 'BTC company liquidity internal balance tracks credited deposit',
        scope: 'liquidity',
        key: 'btc',
        field: 'internalBalance',
        expectedDelta: EXPECTED_RECEIVE_INTERNAL_LIQUIDITY_DELTA,
      },
      {
        label:
          'BTC company liquidity total balance stays unchanged for user deposit',
        scope: 'liquidity',
        key: 'btc',
        field: 'totalBalance',
        expectedDelta: 0n,
      },
      {
        label:
          'BTC company liquidity reserved balance stays unchanged for user deposit',
        scope: 'liquidity',
        key: 'btc',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
      {
        label: 'User amountReceived increases by deposit NGN equivalent',
        scope: 'user',
        key: 'amountReceived',
        expectedDelta: EXPECTED_RECEIVE_AMOUNT_RECEIVED_DELTA,
      },
    ]);

    logger.log('Calling Quidax sell order webhook route...');
    before = await captureMathSnapshot(prisma, user.id);
    await postQuidaxWebhook(
      app,
      orderDonePayload(SELL_ORDER_REFERENCE, 'sell', freshUser),
    );
    after = await captureMathSnapshot(prisma, user.id);
    logMathExpectations(logger, 'Quidax sell order webhook', before, after, [
      {
        label:
          'BTC wallet base balance stays unchanged during sell payout initiation',
        scope: 'wallets',
        key: 'btc',
        field: 'baseBalance',
        expectedDelta: 0n,
      },
      {
        label:
          'BTC wallet reserved balance stays unchanged during sell payout initiation',
        scope: 'wallets',
        key: 'btc',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
      {
        label: 'NGN company liquidity total receives sell proceeds',
        scope: 'liquidity',
        key: 'ngn',
        field: 'totalBalance',
        expectedDelta: EXPECTED_SELL_NGN_LIQUIDITY_DELTA,
      },
      {
        label:
          'NGN company liquidity reserved stays unchanged until payout settles',
        scope: 'liquidity',
        key: 'ngn',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
    ]);

    logger.log('Calling Quidax send webhook route...');
    before = await captureMathSnapshot(prisma, user.id);
    await postQuidaxWebhook(app, sendPayload(freshUser, seeded.usdtWallet));
    after = await captureMathSnapshot(prisma, user.id);
    logMathExpectations(logger, 'Quidax send webhook', before, after, [
      {
        label: 'USDT wallet base balance deducts sent total',
        scope: 'wallets',
        key: 'usdt',
        field: 'baseBalance',
        expectedDelta: EXPECTED_SEND_WALLET_DELTA,
      },
      {
        label: 'USDT wallet reserved balance releases sent total',
        scope: 'wallets',
        key: 'usdt',
        field: 'reservedBalance',
        expectedDelta: EXPECTED_SEND_WALLET_DELTA,
      },
      {
        label: 'USDT company liquidity total consumes provider amount only',
        scope: 'liquidity',
        key: 'usdt',
        field: 'totalBalance',
        expectedDelta: EXPECTED_SEND_LIQUIDITY_TOTAL_DELTA,
      },
      {
        label:
          'USDT company liquidity reserved releases provider amount plus platform fee',
        scope: 'liquidity',
        key: 'usdt',
        field: 'reservedBalance',
        expectedDelta: EXPECTED_SEND_LIQUIDITY_RESERVED_DELTA,
      },
      {
        label:
          'USDT company liquidity internal balance deducts provider amount',
        scope: 'liquidity',
        key: 'usdt',
        field: 'internalBalance',
        expectedDelta: EXPECTED_SEND_INTERNAL_LIQUIDITY_DELTA,
      },
    ]);

    await printResults(prisma);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
