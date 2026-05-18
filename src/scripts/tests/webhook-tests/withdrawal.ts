import { runTest, seedUser, seedWallet, seedCompanyLiquidity, seedTransaction, TEST_USER_ID, QUIDAX_ACCOUNT_ID } from './test-utils';
import { WithdrawalWebhookHandler } from '../../../modules/webhook/quidax/handlers';
import { QuidaxWithdrawalService } from '../../../infrastructure/providers/quidax/withdrawal.service';
import { QuidaxTickerService } from '../../../infrastructure/providers/quidax/jobs/quidax-ticker.service';

const CURRENCY = 'usdt';
const WITHDRAWAL_REF = `wdr_test_${Date.now()}`;
const PROVIDER_WITHDRAWAL_ID = `pwdr_${Date.now()}`;

runTest(async ({ app, prisma, logger }) => {
  logger.log('Seeding data for withdrawal test...');
  await seedUser(prisma);
  const wallet = await seedWallet(prisma, { currency: CURRENCY, name: 'Tether', baseBalance: '5000000', reservedBalance: '5010000', blockchainEnabled: true, defaultNetwork: 'trc20' });
  await seedCompanyLiquidity(prisma, CURRENCY, '100000000000', '5010000');
  await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '0');

  const transaction = await seedTransaction(prisma, {
    transactionUniqueId: `WDR_${Date.now()}`,
    currency: CURRENCY, transactionType: 'DEBIT', transactionContext: 'WITHDRAWAL', status: 'PENDING',
    cryptoAmountBase: '5000000', fiatAmountBase: '5000000000', platformFeeBase: '10000',
    networkFeeBase: '5000', totalAmountSentBase: '5010000', network: 'trc20',
    paymentType: 'CRYPTO_WALLET', senderWalletAddress: wallet.id,
  });

  await prisma.withdrawal.create({
    data: {
      userId: TEST_USER_ID, providerWithdrawalId: PROVIDER_WITHDRAWAL_ID,
      reference: WITHDRAWAL_REF, currency: CURRENCY, network: 'trc20',
      amount: 5000000 as any, status: 'PENDING' as any,
      transactionId: transaction.id, createdAtProvider: new Date(), rawPayload: {},
    },
  });

  const withdrawalService = app.get(QuidaxWithdrawalService);
  (withdrawalService as any).getWithdrawerByReference = async () => ({
    status: 'success',
    data: { status: 'Done', amount: '5.00', fee: '0.01', total: '5.01', txid: `0xtxhash_${Date.now()}`, done_at: new Date().toISOString(), transaction_note: 'User withdrawal', narration: 'Withdrawal to external wallet' },
  });

  const tickerService = app.get(QuidaxTickerService);
  (tickerService as any).getPrice = async () => '1500.00';

  const ts = new Date().toISOString();
  const payload = {
    event: 'withdraw.successful',
    data: {
      id: PROVIDER_WITHDRAWAL_ID, reference: WITHDRAWAL_REF, type: 'coin_address',
      currency: CURRENCY, amount: '5.00', fee: '0.01', total: '5.01',
      txid: `0xtxhash_${Date.now()}`, transaction_note: 'User withdrawal',
      narration: 'Withdrawal to external wallet', status: 'Done', reason: null,
      created_at: ts, done_at: ts,
      recipient: { type: 'coin_address', details: { address: '0xrecipient123456', destination_tag: null, name: null } },
      wallet: { id: wallet.quidaxWalletId, currency: CURRENCY, balance: '500', locked: '0', staked: '0', converted_balance: '750000', reference_currency: 'ngn', is_crypto: true, created_at: ts, updated_at: ts, deposit_address: '0xwallet123456', destination_tag: null },
      user: { id: QUIDAX_ACCOUNT_ID, sn: 'sn_test_001', email: 'test-webhook@example.com', first_name: 'Test', last_name: 'WebhookUser', created_at: ts, updated_at: ts },
    },
  };

  logger.log('Triggering withdrawal handler...');
  const handler = app.get(WithdrawalWebhookHandler);
  await handler.process(payload.event, payload.data);

  const withdrawal = await prisma.withdrawal.findFirst({ where: { reference: WITHDRAWAL_REF } });
  const updatedTx = await prisma.transaction.findUnique({ where: { id: transaction.id } });
  const updatedWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });

  logger.log('--- RESULTS ---');
  logger.log(`Withdrawal status: ${withdrawal?.status}`);
  logger.log(`Transaction status: ${updatedTx?.status}`);
  logger.log(`Wallet balance: ${updatedWallet?.baseBalance}, reserved: ${updatedWallet?.reservedBalance}`);

  if (withdrawal?.status === 'SUCCESS' && updatedTx?.status === 'COMPLETED') {
    logger.log('✅ withdrawal test PASSED');
  } else {
    logger.error('❌ withdrawal test FAILED');
  }
});
