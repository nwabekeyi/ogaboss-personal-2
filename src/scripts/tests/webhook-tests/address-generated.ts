import { runTest, seedUser, seedWallet, TEST_USER_ID, QUIDAX_ACCOUNT_ID } from './test-utils';
import { AddressGeneratedHandler } from '../../../modules/webhook/quidax/handlers/address-generated.handler';
import { QuidaxWalletService } from '../../../infrastructure/providers/quidax/wallet.service';

const CURRENCY = 'usdc';
const ADDRESS_ID = 'bc9d86d1-84be-43e5-a199-451309115b8d';
const BTC_ADDRESS = '0x6b0e37Ce4e33b008Df4bF991651FebD0Da87889e';

runTest(async ({ app, prisma, logger }) => {
// ── Seed ──
   logger.log('Seeding data for address-generated test...');
   await seedUser(prisma);
   const wallet = await seedWallet(prisma, {
     currency: CURRENCY,
     name: 'USDC',
     baseBalance: '100000',
     blockchainEnabled: false,
     defaultNetwork: 'bep20',
   });

// ── Fake QuidaxWalletService.getPaymentAddressById ──
   const walletService = app.get(QuidaxWalletService);
   (walletService as any).getPaymentAddressById = async () => ({
     status: 'success',
     data: {
       id: ADDRESS_ID,
       address: BTC_ADDRESS,
       network: 'bep20',
       destination_tag: null,
       total_payments: null,
       currency: CURRENCY,
       user: { id: "17331dda-12f6-49ef-91e4-d283af9a0dba" },
     },
   });

  // ── Build payload ──
  const payload = {
    event: 'wallet.address.generated',
    data: {
      id: ADDRESS_ID,
      reference: null,
      currency: CURRENCY,
      address: BTC_ADDRESS,
      network: 'bep20',
      destination_tag: null,
      total_payments: null,
      user: {
        id: "17331dda-12f6-49ef-91e4-d283af9a0dba",
        email: "amaremo2@mailinator.com",
        sn: "QDX2O5GO3QN",
        reference: null,
        first_name: "Amaremo",
        last_name: "Bunmi",
        display_name: null,
        created_at: "2026-06-18T09:00:22.000Z",
        updated_at: "2026-06-18T09:00:22.000Z",
      },
      created_at: "2026-06-18T09:00:27.000Z",
      updated_at: "2026-06-18T09:00:27.000Z",
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
