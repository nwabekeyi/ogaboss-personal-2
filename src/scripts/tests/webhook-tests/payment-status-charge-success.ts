import {
  runTest,
  seedUser,
  seedWallet,
  seedCompanyLiquidity,
  seedTransaction,
  TEST_USER_ID,
  captureMathSnapshot,
  logMathExpectations,
  postTestPaystackWebhook,
} from './test-utils';
import { PaystackService } from '../../../infrastructure/providers/paystack/paystack.service';
import { QuidaxOrderService } from '../../../infrastructure/providers/quidax/order.service';

const CURRENCY = 'btc';
const PAYSTACK_REF = `paystack_charge_${Date.now()}`;
const QUIDAX_ORDER_REF = `qorder_from_charge_${Date.now()}`;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for payment-status (charge.success) route test...');
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

  const transaction = await seedTransaction(prisma, {
    userId: TEST_USER_ID,
    transactionUniqueId: PAYSTACK_REF,
    currency: CURRENCY,
    transactionType: 'DEBIT',
    transactionContext: 'BUY',
    status: 'PENDING',
    cryptoAmountBase: '100000',
    cryptoAmountOriginal: '0.001',
    fiatAmountBase: '35000000',
    fiatAmountOriginal: '35000',
    platformFeeBase: '50000',
    bufferAmountBase: '10000',
    network: 'btc',
    paymentType: 'CRYPTO_WALLET',
    paymentMetadata: { liquidityReservationStatus: 'RESERVED' },
    isProcessed: false,
  });

  const paystackService = app.get(PaystackService);
  (paystackService as any).verifyTransaction = async () => ({
    status: true,
    data: {
      status: 'success',
      reference: PAYSTACK_REF,
      amount: 3500000,
      gateway_response: 'Successful',
      channel: 'card',
    },
  });

  const orderService = app.get(QuidaxOrderService);
  (orderService as any).buyOrSellOrderRequest = async () => ({
    status: 'success',
    data: { reference: QUIDAX_ORDER_REF, id: `qorder_${Date.now()}` },
  });

  const payload = {
    event: 'charge.success',
    data: {
      id: Date.now(),
      reference: PAYSTACK_REF,
      amount: 3500000,
      status: 'success',
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      channel: 'card',
      currency: 'NGN',
      customer: { email: 'test-webhook@example.com', phone: '+2348012345678' },
    },
  };

  logger.log(
    'Posting payment-status (charge.success) to Paystack test route...',
  );
  const before = await captureMathSnapshot(prisma, TEST_USER_ID);
  await postTestPaystackWebhook(app, payload);
  const after = await captureMathSnapshot(prisma, TEST_USER_ID);

  logMathExpectations(
    logger,
    'payment-status charge.success route',
    before,
    after,
    [
      {
        label: 'BTC wallet balance is not credited until Quidax order.done',
        scope: 'wallets',
        key: 'btc',
        field: 'baseBalance',
        expectedDelta: 0n,
      },
      {
        label:
          'NGN company liquidity total is unchanged until Quidax order.done',
        scope: 'liquidity',
        key: 'ngn',
        field: 'totalBalance',
        expectedDelta: 0n,
      },
      {
        label:
          'NGN company liquidity reserved is unchanged until Quidax order.done',
        scope: 'liquidity',
        key: 'ngn',
        field: 'reservedBalance',
        expectedDelta: 0n,
      },
    ],
  );

  const order = await prisma.order.findFirst({
    where: { referenceNo: QUIDAX_ORDER_REF },
  });
  const updatedTx = await prisma.transaction.findUnique({
    where: { id: transaction.id },
  });

  logger.log('--- RESULTS ---');
  logger.log(
    `Order created: ${!!order} (status: ${order?.status}, type: ${order?.type})`,
  );
  const meta = updatedTx?.paymentMetadata as any;
  logger.log(`Quidax order ref: ${meta?.quidaxOrderReference}`);

  if (order?.type === 'BUY' && meta?.quidaxOrderReference) {
    logger.log('✅ payment-status (charge.success) route test PASSED');
  } else {
    logger.error('❌ payment-status (charge.success) route test FAILED');
  }
});
