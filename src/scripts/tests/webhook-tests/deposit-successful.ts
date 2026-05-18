import { runTest, seedUser, seedWallet, seedCompanyLiquidity, TEST_USER_ID, QUIDAX_ACCOUNT_ID } from './test-utils';
import { DepositSuccessfulHandler } from '../../../modules/webhook/quidax/handlers/deposit-successful.handler';
import { QuidaxDepositService } from '../../../infrastructure/providers/quidax/deposit.service';
import { QuidaxWithdrawalService } from '../../../infrastructure/providers/quidax/withdrawal.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'btc';
const DEPOSIT_ID = `dep_test_${Date.now()}`;
const TX_HASH = `0xtxhash_${Date.now()}`;
const DEPOSIT_AMOUNT = '0.001';

runTest(async ({ app, prisma, logger }) => {
  // ── Seed ──
  logger.log('Seeding data for deposit-successful test...');
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

  // ── Fake provider calls ──
  const depositService = app.get(QuidaxDepositService);
  (depositService as any).fetchDeposit = async () => ({
    status: 'success',
    data: {
      id: DEPOSIT_ID,
      type: 'coin_address',
      currency: CURRENCY,
      amount: DEPOSIT_AMOUNT,
      fee: '0.00001',
      txid: TX_HASH,
      status: 'accepted',
      reason: null,
      created_at: new Date().toISOString(),
      done_at: new Date().toISOString(),
      wallet: {
        id: wallet.quidaxWalletId,
        name: 'Bitcoin',
        currency: CURRENCY,
        balance: '0.5',
        locked: '0.0',
        staked: '0.0',
        user: {
          id: QUIDAX_ACCOUNT_ID,
          sn: 'sn_test_001',
          email: 'test-webhook@example.com',
          reference: null,
          first_name: 'Test',
          last_name: 'WebhookUser',
          display_name: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        converted_balance: '17500000',
        reference_currency: 'ngn',
        is_crypto: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        blockchain_enabled: true,
        default_network: 'btc',
        networks: [{ id: 'btc', name: 'Bitcoin', deposits_enabled: true, withdraws_enabled: true }],
        deposit_address: 'bc1qtestdeposit123',
        destination_tag: null,
      },
      user: {
        id: QUIDAX_ACCOUNT_ID,
        sn: 'sn_test_001',
        email: 'test-webhook@example.com',
        reference: null,
        first_name: 'Test',
        last_name: 'WebhookUser',
        display_name: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      payment_transaction: { status: 'confirmed', confirmations: 6, required_confirmations: 3 },
      payment_address: {
        id: 'addr_existing_001',
        reference: null,
        currency: CURRENCY,
        address: 'bc1qtestdeposit123',
        network: 'btc',
        user: {
          id: QUIDAX_ACCOUNT_ID,
          sn: 'sn_test_001',
          email: 'test-webhook@example.com',
          reference: null,
          first_name: 'Test',
          last_name: 'WebhookUser',
          display_name: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        destination_tag: null,
        total_payments: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    },
  });

  const withdrawalService = app.get(QuidaxWithdrawalService);
  (withdrawalService as any).withdrawToCompanyAccount = async () => ({
    status: 'success',
    data: { reference: `sweep_ref_${Date.now()}` },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '35000000.00';

  // ── Build payload ──
  const ts = new Date().toISOString();
  const payload = {
    event: 'deposit.successful',
    data: {
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
      payment_transaction: { status: 'confirmed', confirmations: 6, required_confirmations: 3 },
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
    },
  };

  // ── Trigger handler ──
  logger.log('Triggering deposit-successful handler...');
  const handler = app.get(DepositSuccessfulHandler);
  await handler.process(payload.data);

  // ── Verify ──
  const deposit = await prisma.deposit.findFirst({ where: { providerDepositId: DEPOSIT_ID } });
  const transaction = await prisma.transaction.findFirst({
    where: { transactionUniqueId: DEPOSIT_ID },
  });
  const updatedWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });

  logger.log('--- RESULTS ---');
  logger.log(`Deposit created: ${!!deposit} (status: ${deposit?.status})`);
  logger.log(`Transaction created: ${!!transaction} (status: ${transaction?.status})`);
  logger.log(`Wallet balance before: 100000, after: ${updatedWallet?.baseBalance?.toString()}`);

  if (deposit && transaction?.status === 'COMPLETED') {
    logger.log('✅ deposit-successful test PASSED');
  } else {
    logger.error('❌ deposit-successful test FAILED');
  }
});
