import {
  runTest,
  seedUser,
  seedWallet,
  seedCompanyLiquidity,
  seedTransaction,
  TEST_USER_ID,
  QUIDAX_ACCOUNT_ID,
  postTestQuidaxWebhook,
} from './test-utils';
import { QuidaxSwapService } from '../../../infrastructure/providers/quidax/swap.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const FROM_CURRENCY = 'usdt';
const TO_CURRENCY = 'btc';
const SWAP_ID = `swap_test_${Date.now()}`;
const FROM_AMOUNT = '1.00';
const FROM_AMOUNT_BASE = 1000000n;
const TO_AMOUNT = '0.00001';
const TO_AMOUNT_BASE = 1000n;
const EXECUTION_PRICE = '0.00001';

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for swap-transaction route test...');
  await seedUser(prisma);
  const fromWallet = await seedWallet(prisma, {
    currency: FROM_CURRENCY,
    name: 'Tether',
    baseBalance: FROM_AMOUNT_BASE.toString(),
    reservedBalance: FROM_AMOUNT_BASE.toString(),
    blockchainEnabled: true,
    defaultNetwork: 'trc20',
  });
  await seedWallet(prisma, {
    currency: TO_CURRENCY,
    name: 'Bitcoin',
    baseBalance: '0',
    reservedBalance: '0',
    blockchainEnabled: true,
    defaultNetwork: 'btc',
  });
  await seedCompanyLiquidity(
    prisma,
    FROM_CURRENCY,
    '50000000000',
    FROM_AMOUNT_BASE.toString(),
  );
  await prisma.companyLiquidity.update({
    where: { currency: FROM_CURRENCY },
    data: { internalBalance: FROM_AMOUNT_BASE.toString() },
  });
  await seedCompanyLiquidity(prisma, TO_CURRENCY, '1000000000', '0');
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '0');

  await prisma.swapTransaction.create({
    data: {
      userId: TEST_USER_ID,
      quidaxAccountId: QUIDAX_ACCOUNT_ID,
      fromCurrency: FROM_CURRENCY,
      toCurrency: TO_CURRENCY,
      amountOriginal: FROM_AMOUNT,
      quotedPriceOriginal: EXECUTION_PRICE,
      toAmountOriginal: TO_AMOUNT,
      quoteId: `quote_${Date.now()}`,
      swapId: SWAP_ID,
      status: 'pending',
      description: 'Test 1 USDT swap',
    },
  });
  await seedTransaction(prisma, {
    transactionUniqueId: SWAP_ID,
    currency: FROM_CURRENCY,
    transactionType: 'DEBIT',
    transactionContext: 'SWAP',
    status: 'PENDING',
    cryptoAmountBase: FROM_AMOUNT_BASE.toString(),
    cryptoAmountOriginal: FROM_AMOUNT,
    platformFeeBase: '0',
    network: 'trc20',
  });

  const swapService = app.get(QuidaxSwapService);
  (swapService as any).getSwapTransaction = async () => ({
    status: 'success',
    data: {
      id: SWAP_ID,
      status: 'completed',
      from_amount: FROM_AMOUNT,
      received_amount: TO_AMOUNT,
      execution_price: EXECUTION_PRICE,
    },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '1500000000';

  const ts = new Date().toISOString();
  const payload = {
    id: SWAP_ID,
    from_currency: FROM_CURRENCY,
    to_currency: TO_CURRENCY,
    from_amount: FROM_AMOUNT,
    received_amount: TO_AMOUNT,
    execution_price: EXECUTION_PRICE,
    status: 'completed',
    created_at: ts,
    updated_at: ts,
    swap_quotation: {
      id: `quote_${Date.now()}`,
      from_currency: FROM_CURRENCY,
      to_currency: TO_CURRENCY,
      quoted_price: EXECUTION_PRICE,
      quoted_currency: TO_CURRENCY,
      from_amount: FROM_AMOUNT,
      to_amount: TO_AMOUNT,
      confirmed: true,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: ts,
      updated_at: ts,
      user: {
        id: QUIDAX_ACCOUNT_ID,
        sn: 'sn_test_001',
        email: 'test-webhook@example.com',
        created_at: ts,
        updated_at: ts,
      },
    },
    user: {
      id: QUIDAX_ACCOUNT_ID,
      sn: 'sn_test_001',
      email: 'test-webhook@example.com',
      created_at: ts,
      updated_at: ts,
    },
  };

  logger.log('Posting swap_transaction.completed to Quidax test route...');
  await postTestQuidaxWebhook(app, 'swap_transaction.completed', payload);

  const updatedSwap = await prisma.swapTransaction.findFirst({
    where: { swapId: SWAP_ID },
  });
  const updatedFromWallet = await prisma.wallet.findUnique({
    where: { id: fromWallet.id },
  });
  const updatedToWallet = await prisma.wallet.findFirst({
    where: { userId: TEST_USER_ID, currency: TO_CURRENCY },
  });

  logger.log('--- RESULTS ---');
  logger.log(
    `Swap status: ${updatedSwap?.status}, confirmed: ${updatedSwap?.confirmed}`,
  );
  logger.log(
    `FROM wallet balance: ${updatedFromWallet?.baseBalance}, reserved: ${updatedFromWallet?.reservedBalance}`,
  );
  logger.log(`TO wallet balance: ${updatedToWallet?.baseBalance}`);

  if (
    updatedSwap?.status === 'COMPLETED' &&
    updatedSwap?.confirmed &&
    updatedFromWallet?.baseBalance?.toString() === '0' &&
    updatedFromWallet?.reservedBalance?.toString() === '0' &&
    updatedToWallet?.baseBalance?.toString() === TO_AMOUNT_BASE.toString()
  ) {
    logger.log('✅ swap-transaction route test PASSED');
  } else {
    logger.error('❌ swap-transaction route test FAILED');
  }
});