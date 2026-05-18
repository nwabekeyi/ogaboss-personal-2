import { runTest, seedUser, seedWallet, TEST_USER_ID, QUIDAX_ACCOUNT_ID } from './test-utils';
import { AddressGeneratedHandler } from '../../../modules/webhook/quidax/handlers/address-generated.handler';
import { QuidaxWalletService } from '../../../infrastructure/providers/quidax/wallet.service';

const CURRENCY = 'btc';
const ADDRESS_ID = `addr_test_${Date.now()}`;
const BTC_ADDRESS = 'bc1qtest' + 'x'.repeat(50);

runTest(async ({ app, prisma, logger }) => {
  // ── Seed ──
  logger.log('Seeding data for address-generated test...');
  await seedUser(prisma);
  const wallet = await seedWallet(prisma, {
    currency: CURRENCY,
    name: 'Bitcoin',
    baseBalance: '100000',
    blockchainEnabled: false,
    defaultNetwork: 'btc',
  });

  // ── Fake QuidaxWalletService.getPaymentAddressById ──
  const walletService = app.get(QuidaxWalletService);
  (walletService as any).getPaymentAddressById = async () => ({
    status: 'success',
    data: {
      id: ADDRESS_ID,
      address: BTC_ADDRESS,
      network: 'btc',
      destination_tag: null,
      total_payments: 0,
      currency: CURRENCY,
      user: { id: QUIDAX_ACCOUNT_ID },
    },
  });

  // ── Build payload ──
  const ts = new Date().toISOString();
  const payload = {
    event: 'wallet.address.generated',
    data: {
      id: ADDRESS_ID,
      reference: null,
      currency: CURRENCY,
      address: BTC_ADDRESS,
      network: 'btc',
      destination_tag: null,
      total_payments: 0,
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
      created_at: ts,
      updated_at: ts,
    },
  };

  // ── Trigger handler ──
  logger.log('Triggering address-generated handler...');
  const handler = app.get(AddressGeneratedHandler);
  await handler.process(payload.data);

  // ── Verify ──
  const paymentAddress = await prisma.paymentAddress.findFirst({
    where: { quidaxAddressId: ADDRESS_ID },
  });
  const updatedWallet = await prisma.wallet.findUnique({
    where: { id: wallet.id },
  });

  logger.log('--- RESULTS ---');
  logger.log(`PaymentAddress created: ${!!paymentAddress}`);
  logger.log(`  address: ${paymentAddress?.address}`);
  logger.log(`  network: ${paymentAddress?.network}`);
  logger.log(`  status: ${paymentAddress?.status}`);
  logger.log(`Wallet blockchainEnabled: ${updatedWallet?.blockchainEnabled}`);

  if (paymentAddress && updatedWallet?.blockchainEnabled) {
    logger.log('✅ address-generated test PASSED');
  } else {
    logger.error('❌ address-generated test FAILED');
  }
});
