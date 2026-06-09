import {
  runTest,
  seedUser,
  seedWallet,
  seedCompanyLiquidity,
  seedTransaction,
  TEST_USER_ID,
  QUIDAX_ACCOUNT_ID,
  captureMathSnapshot,
  logMathExpectations,
  postTestQuidaxWebhook,
} from './test-utils';
import { QuidaxWithdrawalService } from '../../../infrastructure/providers/quidax/withdrawal.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'usdt';
const WITHDRAWAL_REF = `wdr_test_${Date.now()}`;
const PROVIDER_WITHDRAWAL_ID = `pwdr_${Date.now()}`;
const TOTAL_SENT_BASE = 5010000n;
const PROVIDER_SENT_BASE = 5000000n;
const FIAT_AMOUNT_BASE = 5000000000n;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for withdrawal route test...');
  await seedUser(prisma);
  const wallet = await seedWallet(prisma, {
    currency: CURRENCY,
    name: 'Tether',
    baseBalance: '5000000',
    reservedBalance: TOTAL_SENT_BASE.toString(),
    blockchainEnabled: true,
    defaultNetwork: 'trc20',
  });
  await seedCompanyLiquidity(
    prisma,
    CURRENCY,
    '100000000000',
    TOTAL_SENT_BASE.toString(),
  );
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '0');

  const transaction = await seedTransaction(prisma, {
    transactionUniqueId: `WDR_${Date.now()}`,
    currency: CURRENCY,
    transactionType: 'DEBIT',
    transactionContext: 'WITHDRAWAL',
    status: 'PENDING',
    cryptoAmountBase: PROVIDER_SENT_BASE.toString(),
    fiatAmountBase: FIAT_AMOUNT_BASE.toString(),
    platformFeeBase: '10000',
    networkFeeBase: '5000',
    totalAmountSentBase: TOTAL_SENT_BASE.toString(),
    network: 'trc20',
    paymentType: 'CRYPTO_WALLET',
    senderWalletAddress: wallet.id,
  });

  await prisma.withdrawal.create({
    data: {
      userId: TEST_USER_ID,
      providerWithdrawalId: PROVIDER_WITHDRAWAL_ID,
      reference: WITHDRAWAL_REF,
      currency: CURRENCY,
      network: 'trc20',
      amount: PROVIDER_SENT_BASE.toString() as any,
      status: 'PENDING' as any,
      transactionId: transaction.id,
      createdAtProvider: new Date(),
      rawPayload: {},
    },
  });

  const withdrawalService = app.get(QuidaxWithdrawalService);
  (withdrawalService as any).getWithdrawerByReference = async () => ({
    status: 'success',
    data: {
      status: 'Done',
      amount: '5.00',
      fee: '0.01',
      total: '5.01',
      txid: `0xtxhash_${Date.now()}`,
      done_at: new Date().toISOString(),
      transaction_note: 'User withdrawal',
      narration: 'Withdrawal to external wallet',
    },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '1500.00';

  const ts = new Date().toISOString();
  const payload = {
    id: PROVIDER_WITHDRAWAL_ID,
    reference: WITHDRAWAL_REF,
    type: 'coin_address',
    currency: CURRENCY,
    amount: '5.00',
    fee: '0.01',
    total: '5.01',
    txid: `0xtxhash_${Date.now()}`,
    transaction_note: 'User withdrawal',
    narration: 'Withdrawal to external wallet',
    status: 'Done',
    reason: null,
    created_at: ts,
    done_at: ts,
    recipient: {
      type: 'coin_address',
      details: {
        address: '0xrecipient123456',
        destination_tag: null,
        name: null,
      },
    },
    wallet: {
      id: wallet.quidaxWalletId,
      currency: CURRENCY,
      balance: '500',
      locked: '0',
      staked: '0',
      converted_balance: '750000',
      reference_currency: 'ngn',
      is_crypto: true,
      created_at: ts,
      updated_at: ts,
      deposit_address: '0xwallet123456',
      destination_tag: null,
    },
    user: {
      id: QUIDAX_ACCOUNT_ID,
      sn: 'sn_test_001',
      email: 'test-webhook@example.com',
      first_name: 'Test',
      last_name: 'WebhookUser',
      created_at: ts,
      updated_at: ts,
    },
  };

  logger.log('Posting withdraw.successful to Quidax test route...');
  const before = await captureMathSnapshot(prisma, TEST_USER_ID);
  await postTestQuidaxWebhook(app, 'withdraw.successful', payload);
  const after = await captureMathSnapshot(prisma, TEST_USER_ID);

  logMathExpectations(logger, 'withdraw.successful route', before, after, [
    {
      label: 'USDT wallet base balance deducts requested + fees total',
      scope: 'wallets',
      key: CURRENCY,
      field: 'baseBalance',
      expectedDelta: -TOTAL_SENT_BASE,
    },
    {
      label: 'USDT wallet reserved balance releases requested + fees total',
      scope: 'wallets',
      key: CURRENCY,
      field: 'reservedBalance',
      expectedDelta: -TOTAL_SENT_BASE,
    },
    {
      label: 'USDT company liquidity total consumes provider amount only',
      scope: 'liquidity',
      key: CURRENCY,
      field: 'totalBalance',
      expectedDelta: -PROVIDER_SENT_BASE,
    },
    {
      label:
        'USDT company liquidity reserved releases provider amount plus platform fee',
      scope: 'liquidity',
      key: CURRENCY,
      field: 'reservedBalance',
      expectedDelta: -TOTAL_SENT_BASE,
    },
    {
      label: 'USDT company liquidity internal balance deducts provider amount',
      scope: 'liquidity',
      key: CURRENCY,
      field: 'internalBalance',
      expectedDelta: -PROVIDER_SENT_BASE,
    },
    {
      label: 'User amountSent increases by withdrawal fiat amount',
      scope: 'user',
      key: 'amountSent',
      expectedDelta: FIAT_AMOUNT_BASE,
    },
  ]);

  const withdrawal = await prisma.withdrawal.findFirst({
    where: { reference: WITHDRAWAL_REF },
  });
  const updatedTx = await prisma.transaction.findUnique({
    where: { id: transaction.id },
  });
  const updatedWallet = await prisma.wallet.findUnique({
    where: { id: wallet.id },
  });

  logger.log('--- RESULTS ---');
  logger.log(`Withdrawal status: ${withdrawal?.status}`);
  logger.log(`Transaction status: ${updatedTx?.status}`);
  logger.log(
    `Wallet balance: ${updatedWallet?.baseBalance}, reserved: ${updatedWallet?.reservedBalance}`,
  );

  if (withdrawal?.status === 'SUCCESS' && updatedTx?.status === 'COMPLETED') {
    logger.log('✅ withdrawal route test PASSED');
  } else {
    logger.error('❌ withdrawal route test FAILED');
  }
});
