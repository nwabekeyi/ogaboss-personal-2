import 'dotenv/config';
import * as crypto from 'crypto';

const WEBHOOK_SECRET = process.env.QUIDAX_WEBHOOK_SECRET || '1234567890';
const API_URL = process.env.API_URL || 'http://localhost:5000';
const ENDPOINT = `${API_URL}/api/v1/webhook/quidax`;

function generateSignature(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signaturePayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(signaturePayload)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

async function sendWebhook(event: string, data: Record<string, any>) {
  const payload = JSON.stringify({ event, data });
  const signature = generateSignature(payload);

  console.log(`\n=== Sending ${event} webhook ===`);
  console.log('Endpoint:', ENDPOINT);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'quidax-signature': signature,
      },
      body: payload,
    });

    const responseData = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(responseData, null, 2));

    if (response.ok) {
      console.log(`✅ ${event} webhook sent successfully`);
    } else {
      console.log(`❌ ${event} webhook failed with status ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Error sending ${event} webhook:`, error.message);
  }
}

// ── Payload builders ──

function buildSwapCompletedPayload() {
  const ts = new Date().toISOString();
  const id = `swap_${Date.now()}`;
  return {
    event: 'swap_transaction.completed',
    data: {
      id,
      from_currency: 'btc',
      to_currency: 'usdt',
      from_amount: '0.01',
      received_amount: '1000.00',
      execution_price: '100000.00',
      status: 'completed',
      created_at: ts,
      updated_at: ts,
      swap_quotation: {
        id: `quotation_${Date.now()}`,
        from_currency: 'btc',
        to_currency: 'usdt',
        quoted_price: '100000.00',
        quoted_currency: 'usdt',
        from_amount: '0.01',
        to_amount: '1000.00',
        confirmed: true,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        created_at: ts,
        updated_at: ts,
        user: {
          id: 'quidax_test_user_123',
          sn: 'sn_12345',
          email: 'test@example.com',
          created_at: ts,
          updated_at: ts,
        },
      },
      user: {
        id: 'quidax_test_user_123',
        sn: 'sn_12345',
        email: 'test@example.com',
        created_at: ts,
        updated_at: ts,
      },
    },
  };
}

function buildDepositSuccessfulPayload() {
  const ts = new Date().toISOString();
  return {
    event: 'deposit.successful',
    data: {
      id: `deposit_${Date.now()}`,
      type: 'coin',
      currency: 'btc',
      amount: '0.005',
      fee: '0.0001',
      txid: 'a1b2c3d4e5f6',
      status: 'accepted',
      reason: null,
      created_at: ts,
      done_at: ts,
      wallet: {
        id: 'wallet_test_001',
        name: 'Bitcoin',
        currency: 'btc',
        balance: '0.01',
        locked: '0.0',
        staked: '0.0',
        user: {
          id: 'quidax_test_user_123',
          email: 'test@example.com',
          sn: 'sn_12345',
          reference: null,
          first_name: 'Test',
          last_name: 'User',
          display_name: null,
          created_at: ts,
          updated_at: ts,
        },
        converted_balance: '500.00',
        reference_currency: 'usdt',
        is_crypto: true,
        default_network: 'bitcoin',
        networks: [
          {
            id: 'bitcoin',
            name: 'Bitcoin',
            deposits_enabled: true,
            withdraws_enabled: true,
          },
        ],
        deposit_address: 'bc1qtest123456789',
        destination_tag: null,
        created_at: ts,
        updated_at: ts,
      },
      user: {
        id: 'quidax_test_user_123',
        email: 'test@example.com',
        sn: 'sn_12345',
        reference: null,
        first_name: 'Test',
        last_name: 'User',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
      sender: 'bc1qsender123456',
      payment_transaction: {
        status: 'confirmed',
        confirmations: 6,
        required_confirmations: 3,
      },
      payment_address: {
        id: 'addr_test_001',
        reference: null,
        currency: 'btc',
        address: 'bc1qtest123456789',
        network: 'bitcoin',
        user: {
          id: 'quidax_test_user_123',
          email: 'test@example.com',
          sn: 'sn_12345',
          reference: null,
          first_name: 'Test',
          last_name: 'User',
          display_name: null,
          created_at: ts,
          updated_at: ts,
        },
        destination_tag: null,
        total_payments: 1,
        created_at: ts,
        updated_at: ts,
      },
    },
  };
}

function buildOrderDonePayload() {
  const ts = new Date().toISOString();
  return {
    event: 'order.done',
    data: {
      id: `order_${Date.now()}`,
      reference: 'REF-TEST-001',
      market: {
        id: 'btcusdt',
        base_unit: 'btc',
        quote_unit: 'usdt',
      },
      side: 'buy',
      order_type: 'limit',
      price: { unit: 'usdt', amount: '100000.00' },
      avg_price: { unit: 'usdt', amount: '100000.00' },
      volume: { unit: 'btc', amount: '0.01' },
      origin_volume: { unit: 'btc', amount: '0.01' },
      executed_volume: { unit: 'btc', amount: '0.01' },
      status: 'done',
      trades_count: 1,
      created_at: ts,
      updated_at: ts,
      done_at: ts,
      user: {
        id: 'quidax_test_user_123',
        sn: 'sn_12345',
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
      },
      trades: [
        {
          id: `trade_${Date.now()}`,
          market: { id: 'btcusdt', base_unit: 'btc', quote_unit: 'usdt' },
          price: { unit: 'usdt', amount: '100000.00' },
          volume: { unit: 'btc', amount: '0.01' },
          total: { unit: 'usdt', amount: '1000.00' },
          created_at: ts,
          updated_at: ts,
        },
      ],
    },
  };
}

function buildWithdrawSuccessfulPayload() {
  const ts = new Date().toISOString();
  return {
    event: 'withdraw.successful',
    data: {
      id: `withdraw_${Date.now()}`,
      reference: 'WDR-TEST-001',
      type: 'coin_address',
      currency: 'usdt',
      amount: '500.00',
      fee: '1.00',
      total: '501.00',
      txid: '0xtxhash123456789',
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
        id: 'wallet_test_001',
        currency: 'usdt',
        balance: '5000.00',
        locked: '0.0',
        staked: '0.0',
        converted_balance: '5000.00',
        reference_currency: 'usdt',
        is_crypto: true,
        created_at: ts,
        updated_at: ts,
        deposit_address: '0xwallet123456',
        destination_tag: null,
      },
      user: {
        id: 'quidax_test_user_123',
        sn: 'sn_12345',
        email: 'test@example.com',
        reference: null,
        first_name: 'Test',
        last_name: 'User',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
    },
  };
}

function buildWalletAddressGeneratedPayload() {
  const ts = new Date().toISOString();
  return {
    event: 'wallet.address.generated',
    data: {
      id: `addr_${Date.now()}`,
      reference: null,
      currency: 'btc',
      address: 'bc1qgenerated123456',
      network: 'bitcoin',
      destination_tag: null,
      total_payments: 0,
      user: {
        id: 'quidax_test_user_123',
        email: 'test@example.com',
        sn: 'sn_12345',
        reference: null,
        first_name: 'Test',
        last_name: 'User',
        display_name: null,
        created_at: ts,
        updated_at: ts,
      },
      created_at: ts,
      updated_at: ts,
    },
  };
}

// ── Event registry ──

const EVENTS: Record<string, () => { event: string; data: Record<string, any> }> = {
  'swap_transaction.completed': buildSwapCompletedPayload,
  'deposit.successful': buildDepositSuccessfulPayload,
  'order.done': buildOrderDonePayload,
  'withdraw.successful': buildWithdrawSuccessfulPayload,
  'wallet.address.generated': buildWalletAddressGeneratedPayload,
};

// ── CLI entrypoint ──

async function main() {
  const arg = process.argv[2];

  if (!arg || arg === 'all') {
    console.log('Sending all webhook event types...\n');
    for (const [name, builder] of Object.entries(EVENTS)) {
      const { event, data } = builder();
      await sendWebhook(event, data);
    }
  } else if (EVENTS[arg]) {
    const { event, data } = EVENTS[arg]();
    await sendWebhook(event, data);
  } else {
    console.error(`Unknown event: "${arg}"`);
    console.log('Available events:');
    Object.keys(EVENTS).forEach((k) => console.log(`  - ${k}`));
    console.log('\nUsage: npx tsx src/scripts/test-quidax-webhook.ts [event|all]');
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
