import { runTest, seedUser, seedWallet, seedCompanyLiquidity, seedTransaction, TEST_USER_ID, QUIDAX_ACCOUNT_ID } from './test-utils';
import { SwapTransactionHandler } from '../../../modules/webhook/quidax/handlers/swap-transaction.handler';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax/swap.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const FROM_CURRENCY = 'btc';
const TO_CURRENCY = 'usdt';
const SWAP_ID = `swap_test_${Date.now()}`;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for swap-transaction test...');
  await seedUser(prisma);
  const fromWallet = await seedWallet(prisma, { currency: FROM_CURRENCY, name: 'Bitcoin', baseBalance: '500000', reservedBalance: '100000', blockchainEnabled: true, defaultNetwork: 'btc' });
  await seedWallet(prisma, { currency: TO_CURRENCY, name: 'Tether', baseBalance: '0', reservedBalance: '0', blockchainEnabled: true, defaultNetwork: 'trc20' });
  await seedCompanyLiquidity(prisma, FROM_CURRENCY, '1000000000', '100000');
  await seedCompanyLiquidity(prisma, TO_CURRENCY, '50000000000', '0');
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '0');

  await prisma.swapTransaction.create({
    data: {
      userId: TEST_USER_ID, quidaxAccountId: QUIDAX_ACCOUNT_ID,
      fromCurrency: FROM_CURRENCY, toCurrency: TO_CURRENCY,
      amountOriginal: '0.001', quotedPriceOriginal: '35000000',
      toAmountOriginal: '35000', quoteId: `quote_${Date.now()}`,
      swapId: SWAP_ID, status: 'pending', description: 'Test swap',
    },
  });
  await seedTransaction(prisma, { transactionUniqueId: SWAP_ID, currency: FROM_CURRENCY, transactionType: 'DEBIT', transactionContext: 'SWAP', status: 'PENDING', cryptoAmountBase: '100000', platformFeeBase: '500' });

  const swapService = app.get(QuidaxSwapService);
  (swapService as any).getSwapTransaction = async () => ({
    status: 'success',
    data: { id: SWAP_ID, status: 'completed', from_amount: '0.001', received_amount: '35.00', execution_price: '35000000' },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '35000000000000';

  const ts = new Date().toISOString();
  const payload = {
    data: {
      id: SWAP_ID, from_currency: FROM_CURRENCY, to_currency: TO_CURRENCY,
      from_amount: '0.001', received_amount: '35.00', execution_price: '35000000',
      status: 'completed', created_at: ts, updated_at: ts,
      swap_quotation: {
        id: `quote_${Date.now()}`, from_currency: FROM_CURRENCY, to_currency: TO_CURRENCY,
        quoted_price: '35000000', quoted_currency: 'ngn', from_amount: '0.001', to_amount: '35.00',
        confirmed: true, expires_at: new Date(Date.now() + 60000).toISOString(),
        created_at: ts, updated_at: ts,
        user: { id: QUIDAX_ACCOUNT_ID, sn: 'sn_test_001', email: 'test-webhook@example.com', created_at: ts, updated_at: ts },
      },
      user: { id: QUIDAX_ACCOUNT_ID, sn: 'sn_test_001', email: 'test-webhook@example.com', created_at: ts, updated_at: ts },
    },
  };

  logger.log('Triggering swap-transaction handler...');
  const handler = app.get(SwapTransactionHandler);
  await handler.process(payload.data, 'swap_transaction.completed');

  const updatedSwap = await prisma.swapTransaction.findFirst({ where: { swapId: SWAP_ID } });
  const updatedFromWallet = await prisma.wallet.findUnique({ where: { id: fromWallet.id } });
  const updatedToWallet = await prisma.wallet.findFirst({ where: { userId: TEST_USER_ID, currency: TO_CURRENCY } });

  logger.log('--- RESULTS ---');
  logger.log(`Swap status: ${updatedSwap?.status}, confirmed: ${updatedSwap?.confirmed}`);
  logger.log(`FROM wallet balance: ${updatedFromWallet?.baseBalance}, reserved: ${updatedFromWallet?.reservedBalance}`);
  logger.log(`TO wallet balance: ${updatedToWallet?.baseBalance}`);

  if (updatedSwap?.status === 'COMPLETED' && updatedSwap?.confirmed) {
    logger.log('✅ swap-transaction test PASSED');
  } else {
    logger.error('❌ swap-transaction test FAILED');
  }
});
