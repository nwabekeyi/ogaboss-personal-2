import { runTest, seedUser, seedWallet, seedCompanyLiquidity, seedTransaction, seedOrder, TEST_USER_ID, QUIDAX_ACCOUNT_ID } from './test-utils';
import { PaystackWebhookHandler } from '../../../modules/webhook/paystack';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'btc';
const TRANSFER_REF = `transfer_ref_${Date.now()}`;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for payment-status (transfer.success) test...');
  await seedUser(prisma);
  const wallet = await seedWallet(prisma, { currency: CURRENCY, name: 'Bitcoin', baseBalance: '200000', reservedBalance: '100000', blockchainEnabled: true, defaultNetwork: 'btc' });
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '35000000');

  const transaction = await seedTransaction(prisma, {
    transactionUniqueId: `SELL_TX_${Date.now()}`,
    currency: CURRENCY, transactionType: 'DEBIT', transactionContext: 'SELL', status: 'PENDING',
    cryptoAmountBase: '100000', cryptoAmountOriginal: '0.001', fiatAmountBase: '35000000',
    platformFeeBase: '50000', totalAmountSentBase: '100000', network: 'btc',
    paymentType: 'CRYPTO_WALLET', senderWalletAddress: wallet.id,
    paymentMetadata: { sellOrderStatus: 'filled', payoutStatus: 'initiated', payoutReference: TRANSFER_REF, liquidityReservationStatus: 'RESERVED' },
  });

  await seedOrder(prisma, {
    transactionId: transaction.id, type: 'SELL', status: 'PROCESSING',
    paymentStatus: 'PENDING', paymentReference: TRANSFER_REF,
    cryptoAmountBase: '100000', fiatAmountBase: '35000000',
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '35000000000000';

  const payload = {
    event: 'transfer.success',
    data: {
      id: Date.now(), reference: TRANSFER_REF, amount: 35000000, status: 'success',
      gateway_response: 'Successful', paid_at: new Date().toISOString(),
      channel: 'paystack_transfer', currency: 'NGN',
      customer: { email: 'test-webhook@example.com' },
    },
  };

  logger.log('Triggering payment-status (transfer.success) handler...');
  const handler = app.get(PaystackWebhookHandler);
  await handler.handleWebhook(JSON.stringify(payload));

  const order = await prisma.order.findFirst({ where: { paymentReference: TRANSFER_REF, type: 'SELL' } });
  const updatedTx = await prisma.transaction.findUnique({ where: { id: transaction.id } });

  logger.log('--- RESULTS ---');
  logger.log(`Order status: ${order?.status}, paymentStatus: ${order?.paymentStatus}`);
  logger.log(`Transaction status: ${updatedTx?.status}`);
  const meta = updatedTx?.paymentMetadata as any;
  logger.log(`Payout status: ${meta?.payoutStatus}`);

  if (order?.status === 'COMPLETED' && meta?.payoutStatus === 'success') {
    logger.log('✅ payment-status (transfer.success) test PASSED');
  } else {
    logger.error('❌ payment-status (transfer.success) test FAILED');
  }
});
