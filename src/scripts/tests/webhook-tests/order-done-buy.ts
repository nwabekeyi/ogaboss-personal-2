import {
  runTest,
  seedUser,
  seedWallet,
  seedCompanyLiquidity,
  seedTransaction,
  seedOrder,
  QUIDAX_ACCOUNT_ID,
  TEST_USER_ID,
  captureMathSnapshot,
  logMathExpectations,
  postTestQuidaxWebhook,
} from './test-utils';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'btc';
const QUIDAX_ORDER_REF = `order_ref_buy_${Date.now()}`;
const QUIDAX_ORDER_ID = `qorder_buy_${Date.now()}`;
const EXECUTED_CRYPTO_BASE = 100000n;
const EXECUTED_FIAT_BASE = 35000000n;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for order-done (buy) route test...');
  await seedUser(prisma);
  await seedWallet(prisma, {
    currency: CURRENCY,
    name: 'Bitcoin',
    baseBalance: '0',
    reservedBalance: '0',
    blockchainEnabled: true,
    defaultNetwork: 'btc',
  });
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '35000000');
  await seedCompanyLiquidity(prisma, CURRENCY, '1000000000', '100000');

  const transaction = await seedTransaction(prisma, {
    transactionUniqueId: `BUY_${Date.now()}`,
    currency: CURRENCY,
    transactionType: 'DEBIT',
    transactionContext: 'BUY',
    status: 'PENDING',
    cryptoAmountBase: EXECUTED_CRYPTO_BASE.toString(),
    cryptoAmountOriginal: '0.001',
    fiatAmountBase: EXECUTED_FIAT_BASE.toString(),
    fiatAmountOriginal: '350000',
    platformFeeBase: '50000',
    bufferAmountBase: '10000',
    network: 'btc',
    paymentType: 'CRYPTO_WALLET',
    paymentMetadata: { liquidityReservationStatus: 'reserved' },
  });
  await seedOrder(prisma, {
    transactionId: transaction.id,
    type: 'BUY',
    referenceNo: QUIDAX_ORDER_REF,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    cryptoAmountBase: EXECUTED_CRYPTO_BASE.toString(),
    fiatAmountBase: EXECUTED_FIAT_BASE.toString(),
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '350000000';

  const ts = new Date().toISOString();
  const payload = {
    id: QUIDAX_ORDER_ID,
    reference: QUIDAX_ORDER_REF,
    market: { id: `${CURRENCY}ngn`, base_unit: CURRENCY, quote_unit: 'ngn' },
    side: 'buy',
    order_type: 'market',
    price: { unit: 'ngn', amount: '350000000' },
    avg_price: { unit: 'ngn', amount: '350000000' },
    volume: { unit: CURRENCY, amount: '0.001' },
    origin_volume: { unit: CURRENCY, amount: '0.001' },
    executed_volume: { unit: CURRENCY, amount: '0.001' },
    status: 'done',
    trades_count: 1,
    created_at: ts,
    updated_at: ts,
    done_at: ts,
    user: {
      id: QUIDAX_ACCOUNT_ID,
      sn: 'sn_test_001',
      email: 'test-webhook@example.com',
      first_name: 'Test',
      last_name: 'WebhookUser',
    },
    trades: [
      {
        id: `trade_${Date.now()}`,
        market: {
          id: `${CURRENCY}ngn`,
          base_unit: CURRENCY,
          quote_unit: 'ngn',
        },
        price: { unit: 'ngn', amount: '350000000' },
        volume: { unit: CURRENCY, amount: '0.001' },
        total: { unit: 'ngn', amount: '350000' },
        created_at: ts,
        updated_at: ts,
      },
    ],
  };

  logger.log('Posting order.done (buy) to Quidax test route...');
  const before = await captureMathSnapshot(prisma, TEST_USER_ID);
  await postTestQuidaxWebhook(app, 'order.done', payload);
  const after = await captureMathSnapshot(prisma, TEST_USER_ID);

  logMathExpectations(logger, 'order.done buy route', before, after, [
    {
      label: 'BTC wallet base balance is credited with executed crypto',
      scope: 'wallets',
      key: CURRENCY,
      field: 'baseBalance',
      expectedDelta: EXECUTED_CRYPTO_BASE,
    },
    {
      label: 'BTC wallet reserved balance remains unchanged',
      scope: 'wallets',
      key: CURRENCY,
      field: 'reservedBalance',
      expectedDelta: 0n,
    },
    {
      label: 'NGN company liquidity total consumes reserved buy amount',
      scope: 'liquidity',
      key: 'ngn',
      field: 'totalBalance',
      expectedDelta: -EXECUTED_FIAT_BASE,
    },
    {
      label: 'NGN company liquidity reserved consumes reserved buy amount',
      scope: 'liquidity',
      key: 'ngn',
      field: 'reservedBalance',
      expectedDelta: -EXECUTED_FIAT_BASE,
    },
    {
      label: 'User amountBought increases by executed fiat base',
      scope: 'user',
      key: 'amountBought',
      expectedDelta: EXECUTED_FIAT_BASE,
    },
  ]);

  const order = await prisma.order.findFirst({
    where: { referenceNo: QUIDAX_ORDER_REF },
  });
  const updatedTx = await prisma.transaction.findUnique({
    where: { id: transaction.id },
  });

  logger.log('--- RESULTS ---');
  logger.log(`Order status: ${order?.status}`);
  logger.log(`Transaction status: ${updatedTx?.status}`);

  if (order?.status === 'COMPLETED' && updatedTx?.status === 'COMPLETED') {
    logger.log('✅ order-done (buy) route test PASSED');
  } else {
    logger.error('❌ order-done (buy) route test FAILED');
  }
});