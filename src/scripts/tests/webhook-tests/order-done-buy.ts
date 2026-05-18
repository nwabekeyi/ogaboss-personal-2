import { runTest, seedUser, seedWallet, seedCompanyLiquidity, seedTransaction, seedOrder, QUIDAX_ACCOUNT_ID } from './test-utils';
import { OrderDoneHandler } from '../../../modules/webhook/quidax/handlers/order-done.handler';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'btc';
const QUIDAX_ORDER_REF = `order_ref_buy_${Date.now()}`;
const QUIDAX_ORDER_ID = `qorder_buy_${Date.now()}`;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for order-done (buy) test...');
  await seedUser(prisma);
  await seedWallet(prisma, { currency: CURRENCY, name: 'Bitcoin', baseBalance: '0', reservedBalance: '0', blockchainEnabled: true, defaultNetwork: 'btc' });
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '35000000');
  await seedCompanyLiquidity(prisma, CURRENCY, '1000000000', '100000');

  const transaction = await seedTransaction(prisma, {
    transactionUniqueId: `BUY_${Date.now()}`,
    currency: CURRENCY, transactionType: 'DEBIT', transactionContext: 'BUY', status: 'PENDING',
    cryptoAmountBase: '100000', cryptoAmountOriginal: '0.001', fiatAmountBase: '35000000',
    fiatAmountOriginal: '35000', platformFeeBase: '50000', bufferAmountBase: '10000',
    network: 'btc', paymentType: 'CRYPTO_WALLET',
    paymentMetadata: { liquidityReservationStatus: 'RESERVED' },
  });
  await seedOrder(prisma, { transactionId: transaction.id, type: 'BUY', referenceNo: QUIDAX_ORDER_REF, status: 'PENDING', paymentStatus: 'PENDING', cryptoAmountBase: '100000', fiatAmountBase: '35000000' });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '35000000000000';

  const ts = new Date().toISOString();
  const payload = {
    id: QUIDAX_ORDER_ID, reference: QUIDAX_ORDER_REF,
    market: { id: `${CURRENCY}ngn`, base_unit: CURRENCY, quote_unit: 'ngn' },
    side: 'buy', order_type: 'market',
    price: { unit: 'ngn', amount: '35000000000000' },
    avg_price: { unit: 'ngn', amount: '34950000000000' },
    volume: { unit: CURRENCY, amount: '0.001' },
    origin_volume: { unit: CURRENCY, amount: '0.001' },
    executed_volume: { unit: CURRENCY, amount: '0.001' },
    status: 'done', trades_count: 1, created_at: ts, updated_at: ts, done_at: ts,
    user: { id: QUIDAX_ACCOUNT_ID, sn: 'sn_test_001', email: 'test-webhook@example.com', first_name: 'Test', last_name: 'WebhookUser' },
    trades: [{ id: `trade_${Date.now()}`, market: { id: `${CURRENCY}ngn`, base_unit: CURRENCY, quote_unit: 'ngn' }, price: { unit: 'ngn', amount: '34950000000000' }, volume: { unit: CURRENCY, amount: '0.001' }, total: { unit: 'ngn', amount: '34950000000' }, created_at: ts, updated_at: ts }],
  };

  logger.log('Triggering order-done (buy) handler...');
  const handler = app.get(OrderDoneHandler);
  await handler.process(payload);

  const order = await prisma.order.findFirst({ where: { referenceNo: QUIDAX_ORDER_REF } });
  const updatedTx = await prisma.transaction.findUnique({ where: { id: transaction.id } });

  logger.log('--- RESULTS ---');
  logger.log(`Order status: ${order?.status}`);
  logger.log(`Transaction status: ${updatedTx?.status}`);

  if (order?.status === 'COMPLETED' && updatedTx?.status === 'COMPLETED') {
    logger.log('✅ order-done (buy) test PASSED');
  } else {
    logger.error('❌ order-done (buy) test FAILED');
  }
});
