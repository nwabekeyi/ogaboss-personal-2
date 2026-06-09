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
import { QuidaxDepositService } from '../../../infrastructure/providers/quidax/deposit.service';
import { QuidaxWithdrawalService } from '../../../infrastructure/providers/quidax/withdrawal.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'btc';
const DEPOSIT_ID = `dep_test_${Date.now()}`;
const TX_HASH = `0xtxhash_${Date.now()}`;
const DEPOSIT_AMOUNT = '0.001';
const DEPOSIT_AMOUNT_BASE = 100000n;
const DEPOSIT_NGN_BASE = 3500000n;

runTest(async ({ app, prisma, logger }) => {
  // ── Seed ──
  logger.log('Seeding data for deposit-successful route test...');
  await seedUser(prisma);
  const wallet = await seedWallet(prisma, {
    currency: CURRENCY,
    name: 'Bitcoin',
    baseBalance: '100000',
    blockchainEnabled: true,
    defaultNetwork: 'btc',
  });
  await seedCompanyLiquidity(prisma, CURRENCY, '1000000000', '0');
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '0');

  await seedTransaction(prisma, {
    transactionUniqueId: DEPOSIT_ID,
    currency: CURRENCY,
    transactionType: 'CREDIT',
    transactionContext: 'DEPOSIT',
    status: 'PENDING',
    cryptoAmountBase: DEPOSIT_AMOUNT_BASE.toString(),
    cryptoAmountOriginal: DEPOSIT_AMOUNT,
    fiatAmountBase: '0',
    fiatAmountOriginal: '0',
    network: 'btc',
    paymentMetadata: {
      quidaxEventId: DEPOSIT_ID,
      depositAddress: 'bc1qtestdeposit123',
    },
    isProcessed: false,
  });

  await prisma.paymentAddress.create({
    data: {
      quidaxAddressId: 'addr_existing_001',
      walletId: wallet.id,
      currency: CURRENCY,
      address: 'bc1qtestdeposit123',
      network: 'btc',
      status: 'ACTIVE' as any,
      totalPayments: '0',
      depositCount: 0,
    },
  });

  const ts = new Date().toISOString();
  const payload = {
    id: DEPOSIT_ID,
    type: 'coin',
    currency: CURRENCY,
    amount: DEPOSIT_AMOUNT,
    fee: '0.00001',
    txid: TX_HASH,
    status: 'accepted',
    reason: null,
    created_at: ts,
    done_at: ts,
    wallet: {
      id: wallet.quidaxWalletId,
      name: 'Bitcoin',
      currency: CURRENCY,
      balance: '0.5',
      locked: '0',
      staked: '0',
      user: {
        id: QUIDAX_ACCOUNT_ID,
        email: 'test-webhook@example.com',
        sn: 'sn_test_001',
        reference: null,
        first_name: 'Test',
        last_name: 'WebhookUser',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
      converted_balance: '35000',
      reference_currency: 'ngn',
      is_crypto: true,
      default_network: 'btc',
      networks: [],
      deposit_address: 'bc1qtestdeposit123',
      destination_tag: null,
      created_at: ts,
      updated_at: ts,
    },
    user: {
      id: QUIDAX_ACCOUNT_ID,
      email: 'test-webhook@example.com',
      sn: 'sn_test_001',
      reference: null,
      first_name: 'Test',
      last_name: 'WebhookUser',
      display_name: null,
      created_at: ts,
      updated_at: ts,
    },
    sender: 'bc1qsender123',
    payment_transaction: {
      status: 'confirmed',
      confirmations: 6,
      required_confirmations: 3,
    },
    payment_address: {
      id: 'addr_existing_001',
      reference: null,
      currency: CURRENCY,
      address: 'bc1qtestdeposit123',
      network: 'btc',
      user: {
        id: QUIDAX_ACCOUNT_ID,
        email: 'test-webhook@example.com',
        sn: 'sn_test_001',
        reference: null,
        first_name: 'Test',
        last_name: 'WebhookUser',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
      destination_tag: null,
      total_payments: 0,
      created_at: ts,
      updated_at: ts,
    },
  };

  // ── Fake provider calls ──
  const depositService = app.get(QuidaxDepositService);
  (depositService as any).fetchDeposit = async () => ({
    status: 'success',
    data: payload,
  });

  const withdrawalService = app.get(QuidaxWithdrawalService);
  (withdrawalService as any).withdrawToCompanyAccount = async () => ({
    status: 'success',
    data: { reference: `sweep_ref_${Date.now()}` },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '35000000.00';

  // ── Trigger test route ──
  logger.log('Posting deposit.successful to Quidax test route...');
  const before = await captureMathSnapshot(prisma, TEST_USER_ID);
  await postTestQuidaxWebhook(app, 'deposit.successful', payload);
  const after = await captureMathSnapshot(prisma, TEST_USER_ID);

  logMathExpectations(logger, 'deposit.successful route', before, after, [
    {
      label: 'BTC wallet base balance receives deposit amount',
      scope: 'wallets',
      key: CURRENCY,
      field: 'baseBalance',
      expectedDelta: DEPOSIT_AMOUNT_BASE,
    },
    {
      label: 'BTC wallet reserved balance remains unchanged',
      scope: 'wallets',
      key: CURRENCY,
      field: 'reservedBalance',
      expectedDelta: 0n,
    },
    {
      label: 'BTC company liquidity internal balance tracks deposit credit',
      scope: 'liquidity',
      key: CURRENCY,
      field: 'internalBalance',
      expectedDelta: DEPOSIT_AMOUNT_BASE,
    },
    {
      label: 'BTC company liquidity total balance remains unchanged',
      scope: 'liquidity',
      key: CURRENCY,
      field: 'totalBalance',
      expectedDelta: 0n,
    },
    {
      label: 'BTC company liquidity reserved balance remains unchanged',
      scope: 'liquidity',
      key: CURRENCY,
      field: 'reservedBalance',
      expectedDelta: 0n,
    },
    {
      label: 'User amountReceived increases by NGN equivalent',
      scope: 'user',
      key: 'amountReceived',
      expectedDelta: DEPOSIT_NGN_BASE,
    },
  ]);

  // ── Verify ──
  const deposit = await prisma.deposit.findFirst({
    where: { providerDepositId: DEPOSIT_ID },
  });
  const transaction = await prisma.transaction.findFirst({
    where: { transactionUniqueId: DEPOSIT_ID },
  });
  const updatedWallet = await prisma.wallet.findUnique({
    where: { id: wallet.id },
  });

  logger.log('--- RESULTS ---');
  logger.log(`Deposit created: ${!!deposit} (status: ${deposit?.status})`);
  logger.log(
    `Transaction created: ${!!transaction} (status: ${transaction?.status})`,
  );
  logger.log(
    `Wallet balance before: 100000, after: ${updatedWallet?.baseBalance?.toString()}`,
  );

  if (deposit && transaction?.status === 'COMPLETED') {
    logger.log('✅ deposit-successful route test PASSED');
  } else {
    logger.error('❌ deposit-successful route test FAILED');
  }
});
