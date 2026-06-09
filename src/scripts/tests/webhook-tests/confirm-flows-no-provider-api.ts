import axios from 'axios';
import {
  runTest,
  seedUser,
  seedWallet,
  seedCompanyLiquidity,
  TEST_USER_ID,
} from './test-utils';
import {
  BuyService,
  SellService,
  SwapService,
  TransactionNotificationService,
  TransactionService,
  WithdrawalService,
} from '../../../modules/transaction/services';
import { TempStoreService } from '../../../infrastructure';
import { PaystackService } from '../../../infrastructure/providers/paystack';
import { RedisService } from '../../../infrastructure/databases/redis';
import {
  COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY,
  COMPANY_PAYSTACK_NGN_WALLET_ID,
} from '../../../shared';

const now = Date.now();
const expiresAt = now + 10 * 60 * 1000;

const BUY_PREVIEW_ID = `confirm_buy_no_api_${now}`;
const SELL_PREVIEW_ID = `confirm_sell_no_api_${now}`;
const SWAP_PREVIEW_ID = `confirm_swap_no_api_${now}`;
const SEND_PREVIEW_ID = `confirm_send_no_api_${now}`;

const BTC_BASE_BALANCE = '1000000';
const USDT_BASE_BALANCE = '10000000';
const BUY_CRYPTO_BASE = '100000';
const BUY_TOTAL_FIAT_BASE = '35000000';
const BUY_PLATFORM_FEE_BASE = '100000';
const SELL_CRYPTO_BASE = '100000';
const SELL_PLATFORM_FEE_BASE = '1000';
const SELL_NET_FIAT_BASE = '35000000';
const SWAP_FROM_BASE = '1000000';
const SWAP_PLATFORM_FEE_BASE = '10000';
const WITHDRAW_AMOUNT_BASE = '1000000';
const WITHDRAW_NETWORK_FEE_BASE = '10000';
const WITHDRAW_PLATFORM_FEE_BASE = '10000';
const WITHDRAW_TOTAL_DEDUCTION_BASE = '1020000';
const RECIPIENT_ADDRESS = '0xno_api_withdraw_receiver';

function installNoProviderApiMocks() {
  const originalPost = axios.post;
  const calls: string[] = [];

  (axios as any).post = async (url: string, body?: any) => {
    calls.push(url);

    if (url.includes('/orders')) {
      return {
        data: {
          status: 'success',
          data: {
            id: `no_api_order_${Date.now()}`,
            reference: body?.reference ?? `no_api_order_ref_${Date.now()}`,
          },
        },
      };
    }

    if (url.includes('/swap_quotation/') && url.includes('/refresh')) {
      return {
        data: {
          status: 'success',
          data: {
            id: `no_api_refreshed_quote_${Date.now()}`,
            quoted_price: '0.00001',
            confirmed: false,
          },
        },
      };
    }

    if (url.includes('/swap_quotation/') && url.includes('/confirm')) {
      return {
        data: {
          status: 'success',
          data: {
            id: `no_api_swap_${Date.now()}`,
            from_currency: 'usdt',
            to_currency: 'btc',
            from_amount: '1.00',
            received_amount: '0.00001',
            execution_price: '0.00001',
            status: 'completed',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            swap_quotation: {
              id: `no_api_refreshed_quote_${Date.now()}`,
            },
          },
        },
      };
    }

    if (url.includes('/withdraws')) {
      return {
        data: {
          status: 'success',
          data: {
            id: `no_api_withdraw_${Date.now()}`,
            reference: body?.reference,
            status: 'Processing',
            amount: body?.amount,
            recipient: {
              details: {
                address: body?.fund_uid,
                destination_tag: body?.fund_uid2 ?? null,
              },
            },
          },
        },
      };
    }

    throw new Error(`Unexpected provider API call in no-provider test: ${url}`);
  };

  return {
    calls,
    restore: () => {
      (axios as any).post = originalPost;
    },
  };
}

runTest(async ({ app, prisma, logger }) => {
  const axiosMock = installNoProviderApiMocks();

  try {
    logger.log('Seeding data for no-provider confirm-flow test...');
    await seedUser(prisma);

    const btcWallet = await seedWallet(prisma, {
      currency: 'btc',
      name: 'Bitcoin',
      baseBalance: BTC_BASE_BALANCE,
      blockchainEnabled: true,
      defaultNetwork: 'btc',
      quidaxWalletId: `qw_btc_no_api_${now}`,
    });
    const usdtWallet = await seedWallet(prisma, {
      currency: 'usdt',
      name: 'Tether',
      baseBalance: USDT_BASE_BALANCE,
      blockchainEnabled: true,
      defaultNetwork: 'bep20',
      quidaxWalletId: `qw_usdt_no_api_${now}`,
    });

    await prisma.paymentAddress.createMany({
      data: [
        {
          walletId: btcWallet.id,
          currency: 'btc',
          network: 'btc',
          address: 'bc1qnoapitestbtc',
        },
        {
          walletId: usdtWallet.id,
          currency: 'usdt',
          network: 'bep20',
          address: '0xnoapitestusdt',
        },
      ],
    });

    const bankAccount = await prisma.userBankAccount.create({
      data: {
        userId: TEST_USER_ID,
        bankAccountName: 'Webhook No Api Test',
        bankAccountNumber: '0123456789',
        bankName: 'No Api Test Bank',
        bankCode: '999999',
      },
    });

    await seedCompanyLiquidity(prisma, 'ngn', '5000000000000', '0');
    await seedCompanyLiquidity(prisma, 'btc', '1000000000', '0');
    await seedCompanyLiquidity(prisma, 'usdt', '100000000000', '0');

    const redisService = app.get(RedisService);
    await redisService.set(COMPANY_PAYSTACK_LIQUIDITY_CACHE_KEY, {
      id: COMPANY_PAYSTACK_NGN_WALLET_ID,
      totalBalance: '5000000000000',
      reservedBalance: '0',
    });

    const transactionService = app.get(TransactionService);
    (transactionService as any).enforceConfirmationCooldown = async () => {};
    (transactionService as any).checkPriceSlippage = async () => {};

    const notificationService = app.get(TransactionNotificationService);
    (notificationService as any).sendTransactionInitiatedNotification =
      () => {};
    (notificationService as any).sendTransactionStatusNotification = () => {};

    const paystackService = app.get(PaystackService);
    (paystackService as any).initializePayment = async (data: any) => ({
      status: true,
      message: 'No-provider payment initialized',
      data: {
        reference: data.reference,
        authorization_url: 'https://example.test/paystack/no-api',
        access_code: `access_${data.reference}`,
      },
    });
    (paystackService as any).chargeSavedCard = async (data: any) => ({
      status: true,
      message: 'No-provider card charged',
      data: { reference: data.reference },
    });
    (paystackService as any).createTransferRecipient = async () => ({
      status: true,
      message: 'No-provider recipient created',
      data: { recipient_code: `RCP_no_api_${Date.now()}` },
    });
    (paystackService as any).initiateTransfer = async (data: any) => ({
      status: true,
      message: 'No-provider transfer initiated',
      data: { transfer_code: `TRF_no_api_${Date.now()}`, amount: data.amount },
    });

    const tempStore = app.get(TempStoreService);
    await tempStore.set(
      `buy:${BUY_PREVIEW_ID}`,
      JSON.stringify({
        quoteId: BUY_PREVIEW_ID,
        userId: TEST_USER_ID,
        side: 'buy',
        crypto: 'BTC',
        network: 'btc',
        fiatCurrency: 'ngn',
        fiatDecimals: 2,
        cryptoDecimals: 8,
        volumeCryptoMinor: BUY_CRYPTO_BASE,
        marketPriceMinor: '35000000000',
        bufferedPriceMinor: '35000000000',
        bufferSpreadMinor: '0',
        platformFeeMinor: BUY_PLATFORM_FEE_BASE,
        totalFiatMinor: BUY_TOTAL_FIAT_BASE,
        bufferPercent: '0',
        paymentMethodId: '3646737378364',
        pinVerified: true,
        expiresAt,
      }),
      600,
    );

    await tempStore.set(
      `sell:${SELL_PREVIEW_ID}`,
      JSON.stringify({
        quoteId: SELL_PREVIEW_ID,
        userId: TEST_USER_ID,
        side: 'sell',
        crypto: 'BTC',
        network: 'btc',
        fiatCurrency: 'ngn',
        fiatDecimals: 2,
        cryptoDecimals: 8,
        exactCryptoMinor: SELL_CRYPTO_BASE,
        marketPriceMinor: '35000000000',
        bufferedPriceMinor: '35000000000',
        bufferSpreadMinor: '0',
        grossFiatMinor: SELL_NET_FIAT_BASE,
        platformFeeMinor: SELL_PLATFORM_FEE_BASE,
        netFiatMinor: SELL_NET_FIAT_BASE,
        bufferPercent: '0',
        bankAccountId: bankAccount.id,
        pinVerified: true,
        expiresAt,
      }),
      600,
    );

    await tempStore.set(
      `swap:${SWAP_PREVIEW_ID}`,
      JSON.stringify({
        quoteId: SWAP_PREVIEW_ID,
        userId: TEST_USER_ID,
        side: 'swap',
        from: 'USDT',
        to: 'BTC',
        fromNetwork: 'bep20',
        toNetwork: 'btc',
        fromDecimals: 6,
        toDecimals: 8,
        exactFromMinor: SWAP_FROM_BASE,
        platformFeeMinor: SWAP_PLATFORM_FEE_BASE,
        estimatedOutMinor: '1000',
        marketRateMinor: '1000',
        protectedRateMinor: '1000',
        bufferSpreadMinor: '0',
        bufferPercent: '0',
        totalBufferPercent: '0',
        quotationId: `no_api_quote_${now}`,
        pinVerified: true,
        expiresAt,
      }),
      600,
    );

    await tempStore.set(
      `send:${SEND_PREVIEW_ID}`,
      JSON.stringify({
        previewId: SEND_PREVIEW_ID,
        userId: TEST_USER_ID,
        currency: 'USDT',
        network: 'BEP20',
        toAddress: RECIPIENT_ADDRESS,
        destinationTag: null,
        side: 'send',
        requestedAmount: '1.00',
        requestedAmountBase: WITHDRAW_AMOUNT_BASE,
        networkFee: '0.01',
        networkFeeBase: WITHDRAW_NETWORK_FEE_BASE,
        platformFee: '0.01',
        platformFeeBase: WITHDRAW_PLATFORM_FEE_BASE,
        totalDeduction: '1.02',
        totalDeductionBase: WITHDRAW_TOTAL_DEDUCTION_BASE,
        pinVerified: true,
        createdAt: now,
        expiresAt,
      }),
      600,
    );

    const buyService = app.get(BuyService);
    const sellService = app.get(SellService);
    const swapService = app.get(SwapService);
    const withdrawalService = app.get(WithdrawalService);

    logger.log('Confirming buy without real Paystack calls...');
    const buyResult = await buyService.confirmBuy(TEST_USER_ID, BUY_PREVIEW_ID);
    const buyTx = await prisma.transaction.findFirst({
      where: { transactionUniqueId: BUY_PREVIEW_ID },
    });

    logger.log('Confirming sell without real Quidax/Paystack calls...');
    const sellResult = await sellService.confirmSell(
      TEST_USER_ID,
      SELL_PREVIEW_ID,
    );
    const sellOrder = await prisma.order.findFirst({
      where: { referenceNo: { startsWith: 'no_api_order' } },
      include: { transaction: true },
    });

    logger.log('Confirming swap without real Quidax calls...');
    const swapResult = await swapService.confirmSwap(TEST_USER_ID, {
      previewId: SWAP_PREVIEW_ID,
    });
    const swapRecord = await prisma.swapTransaction.findFirst({
      where: { quoteId: SWAP_PREVIEW_ID },
      include: { transaction: true },
    });

    logger.log('Confirming withdrawal without real Quidax calls...');
    const withdrawResult = await withdrawalService.confirmSend(TEST_USER_ID, {
      previewId: SEND_PREVIEW_ID,
    });
    const withdrawalRecord = await prisma.withdrawal.findFirst({
      where: { reference: SEND_PREVIEW_ID },
      include: { transaction: true },
    });

    logger.log('--- RESULTS ---');
    logger.log(`Buy transaction: ${buyTx?.id} (${buyTx?.status})`);
    logger.log(
      `Sell order: ${sellOrder?.id} (${sellOrder?.status}) providerRef=${sellOrder?.referenceNo}`,
    );
    logger.log(
      `Swap record: ${swapRecord?.id} (${swapRecord?.status}) providerSwap=${swapRecord?.swapId}`,
    );
    logger.log(
      `Withdrawal: ${withdrawalRecord?.id} (${withdrawalRecord?.status}) providerWithdrawal=${withdrawalRecord?.providerWithdrawalId}`,
    );
    logger.log(`Mocked provider calls: ${axiosMock.calls.join(', ')}`);

    const passed =
      buyResult?.data?.transactionId === buyTx?.id &&
      buyTx?.transactionContext === 'BUY' &&
      buyTx?.paymentMetadata &&
      sellResult?.success === true &&
      sellOrder?.transaction?.transactionUniqueId === SELL_PREVIEW_ID &&
      sellOrder?.referenceNo?.startsWith('no_api_order') &&
      swapResult?.swapRecordId === swapRecord?.id &&
      swapRecord?.swapId?.startsWith('no_api_swap') &&
      withdrawResult?.withdrawalId === withdrawalRecord?.id &&
      withdrawalRecord?.providerWithdrawalId?.startsWith('no_api_withdraw') &&
      withdrawalRecord?.transaction?.receiverWalletAddress ===
        RECIPIENT_ADDRESS;

    if (passed) {
      logger.log('✅ no-provider confirm-flow test PASSED');
    } else {
      logger.error('❌ no-provider confirm-flow test FAILED');
      throw new Error('no-provider confirm-flow test failed');
    }
  } finally {
    axiosMock.restore();
  }
});
