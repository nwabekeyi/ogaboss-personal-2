import {
  runTest,
  seedUser,
  seedWallet,
  seedCompanyLiquidity,
  seedTransaction,
  seedOrder,
  TEST_USER_ID,
  captureMathSnapshot,
  logMathExpectations,
  postTestPaystackWebhook,
} from './test-utils';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'btc';
const TRANSFER_REF = `transfer_ref_${Date.now()}`;
const CRYPTO_AMOUNT_BASE = 100000n;
const FIAT_AMOUNT_BASE = 35000000n;

runTest(async ({ app, prisma, logger }) => {
  logger.log(
    'Seeding data for payment-status (transfer.success) route test...',
  );
  await seedUser(prisma);
  const wallet = await seedWallet(prisma, {
    currency: CURRENCY,
    name: 'Bitcoin',
    baseBalance: '200000',
    reservedBalance: CRYPTO_AMOUNT_BASE.toString(),
    blockchainEnabled: true,
    defaultNetwork: 'btc',
  });
  await seedCompanyLiquidity(
    prisma,
    'ngn',
    '5000000000000',
    FIAT_AMOUNT_BASE.toString(),
  );

  const transaction = await seedTransaction(prisma, {
    transactionUniqueId: `SELL_TX_${Date.now()}`,
    currency: CURRENCY,
    transactionType: 'DEBIT',
    transactionContext: 'SELL',
    status: 'PENDING',
    cryptoAmountBase: CRYPTO_AMOUNT_BASE.toString(),
    cryptoAmountOriginal: '0.001',
    fiatAmountBase: FIAT_AMOUNT_BASE.toString(),
    fiatAmountOriginal: '350000',
    platformFeeBase: '50000',
    totalAmountSentBase: CRYPTO_AMOUNT_BASE.toString(),
    network: 'btc',
    paymentType: 'CRYPTO_WALLET',
    senderWalletAddress: wallet.id,
    paymentMetadata: {
      sellOrderStatus: 'filled',
      payoutStatus: 'initiated',
      payoutReference: TRANSFER_REF,
      liquidityReservationStatus: 'RESERVED',
    },
  });

  await seedOrder(prisma, {
    transactionId: transaction.id,
    type: 'SELL',
    status: 'PROCESSING',
    paymentStatus: 'PENDING',
    paymentReference: TRANSFER_REF,
    cryptoAmountBase: CRYPTO_AMOUNT_BASE.toString(),
    fiatAmountBase: FIAT_AMOUNT_BASE.toString(),
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '350000000';

  const payload = {
    event: 'transfer.success',
    data: {
      id: Date.now(),
      reference: TRANSFER_REF,
      amount: Number(FIAT_AMOUNT_BASE),
      status: 'success',
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      channel: 'paystack_transfer',
      currency: 'NGN',
      customer: { email: 'test-webhook@example.com' },
    },
  };

  logger.log(
    'Posting payment-status (transfer.success) to Paystack test route...',
  );
  const before = await captureMathSnapshot(prisma, TEST_USER_ID);
  await postTestPaystackWebhook(app, payload);
  const after = await captureMathSnapshot(prisma, TEST_USER_ID);

  logMathExpectations(
    logger,
    'payment-status transfer.success route',
    before,
    after,
    [
      {
        label: 'BTC wallet base balance deducts sold crypto',
        scope: 'wallets',
        key: CURRENCY,
        field: 'baseBalance',
        expectedDelta: -CRYPTO_AMOUNT_BASE,
      },
      {
        label: 'BTC wallet reserved balance releases sold crypto',
        scope: 'wallets',
        key: CURRENCY,
        field: 'reservedBalance',
        expectedDelta: -CRYPTO_AMOUNT_BASE,
      },
      {
        label:
          'NGN company liquidity total remains unchanged when payout settles',
        scope: 'liquidity',
        key: 'ngn',
        field: 'totalBalance',
        expectedDelta: 0n,
      },
      {
        label: 'NGN company liquidity reserved releases payout amount',
        scope: 'liquidity',
        key: 'ngn',
        field: 'reservedBalance',
        expectedDelta: -FIAT_AMOUNT_BASE,
      },
      {
        label: 'User amountSold increases by sold crypto NGN equivalent',
        scope: 'user',
        key: 'amountSold',
        expectedDelta: FIAT_AMOUNT_BASE,
      },
    ],
  );

  const order = await prisma.order.findFirst({
    where: { paymentReference: TRANSFER_REF, type: 'SELL' },
  });
  const updatedTx = await prisma.transaction.findUnique({
    where: { id: transaction.id },
  });

  logger.log('--- RESULTS ---');
  logger.log(
    `Order status: ${order?.status}, paymentStatus: ${order?.paymentStatus}`,
  );
  logger.log(`Transaction status: ${updatedTx?.status}`);
  const meta = updatedTx?.paymentMetadata as any;
  logger.log(`Payout status: ${meta?.payoutStatus}`);

  if (order?.status === 'COMPLETED' && meta?.payoutStatus === 'success') {
    logger.log('✅ payment-status (transfer.success) route test PASSED');
  } else {
    logger.error('❌ payment-status (transfer.success) route test FAILED');
  }
});
