#!/usr/bin/env ts-node
import 'dotenv/config';
import { PrismaClient, TransactionStatus, TransactionType } from '../infrastructure/databases/prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConvertCurrency, toBigInt } from '../shared';
import axios from 'axios';

interface Summary {
  totalUsers: number;
  usersProcessed: number;
  snapshotsCreated: number;
  snapshotsDeleted: number;
  errors: string[];
}

interface Ticker {
  ticker: {
    last: string;
  };
}

function toLastSunday(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? 0 : day;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function fetchTickers(): Promise<Record<string, Ticker>> {
  const apiUrl = process.env.QUIDAX_API_URL?.trim();
  if (!apiUrl) {
    throw new Error('QUIDAX_API_URL is not set');
  }
  const response = await axios.get(`${apiUrl}/markets/tickers`);
  return response.data || {};
}

function resolveUsdtNgnRate(tickers: Record<string, Ticker>): number {
  const rate = tickers['usdtngn']?.ticker?.last || tickers['USDTNGN']?.ticker?.last;
  return rate ? parseFloat(rate) : 1463.7;
}

function lookupCryptoPrice(
  tickers: Record<string, Ticker>,
  currency: string,
  usdtNgnRate: number,
): number {
  const currUpper = currency.toUpperCase();
  const currLower = currency.toLowerCase();

  const directLower = `${currLower}ngn`;
  const directUpper = `${currUpper}NGN`;
  const direct = tickers[directLower]?.ticker?.last || tickers[directUpper]?.ticker?.last;
  if (direct) {
    const price = parseFloat(direct);
    if (price > 0) return price;
  }

  const usdtLower = `${currLower}usdt`;
  const usdtUpper = `${currUpper}USDT`;
  const usdtPrice = tickers[usdtLower]?.ticker?.last || tickers[usdtUpper]?.ticker?.last;
  if (usdtPrice && usdtNgnRate > 0) {
    const price = parseFloat(usdtPrice) * usdtNgnRate;
    if (price > 0) return price;
  }

  return 0;
}

async function populateWeeklySnapshots(): Promise<void> {
  console.log('=== Weekly Balance Snapshot Population Script ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('Reconstructing last Sunday balances from transaction history...\n');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['error', 'warn'],
    errorFormat: 'minimal',
  });

  const summary: Summary = {
    totalUsers: 0,
    usersProcessed: 0,
    snapshotsCreated: 0,
    snapshotsDeleted: 0,
    errors: [],
  };

  try {
    const users = await prisma.user.findMany({
      select: { id: true },
    });

    summary.totalUsers = users.length;
    console.log(`Found ${users.length} users`);

    console.log('Fetching live tickers from Quidax...');
    const tickers = await fetchTickers();
    const usdtNgnRate = resolveUsdtNgnRate(tickers);
    console.log(`USDT/NGN rate: ${usdtNgnRate}`);
    console.log(`Ticker pairs loaded: ${Object.keys(tickers).length}\n`);

    const lastSunday = toLastSunday(new Date());
    console.log(`Last Sunday date: ${lastSunday.toISOString().split('T')[0]}\n`);

    const deleteResult = await prisma.dailyBalanceSnapshot.deleteMany({});
    summary.snapshotsDeleted = deleteResult.count;
    console.log(`Deleted ${deleteResult.count} existing snapshots from DB\n`);

    for (const user of users) {
      try {
        const wallets = await prisma.wallet.findMany({
          where: { userId: user.id },
          select: {
            id: true,
            currency: true,
            baseBalance: true,
            lockedAmount: true,
            stackedAmount: true,
            totalStackedInterest: true,
            totalLockedInterest: true,
            isCrypto: true,
          },
        });

        const walletPositions = new Map<string, {
          currency: string;
          balanceNum: number;
          lockedNum: number;
          stackedNum: number;
          stackedInterestNum: number;
          lockedInterestNum: number;
          isCrypto: boolean;
        }>();

        for (const w of wallets) {
          walletPositions.set(w.id, {
            currency: w.currency,
            balanceNum: Number(ConvertCurrency.fromBase(toBigInt(w.baseBalance), w.currency)),
            lockedNum: Number(ConvertCurrency.fromBase(toBigInt(w.lockedAmount || 0), w.currency)),
            stackedNum: Number(ConvertCurrency.fromBase(toBigInt(w.stackedAmount || 0), w.currency)),
            stackedInterestNum: Number(ConvertCurrency.fromBase(toBigInt(w.totalStackedInterest || 0), w.currency)),
            lockedInterestNum: Number(ConvertCurrency.fromBase(toBigInt(w.totalLockedInterest || 0), w.currency)),
            isCrypto: w.isCrypto,
          });
        }

        const transactions = await prisma.transaction.findMany({
          where: {
            userId: user.id,
            status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SUCCESS, TransactionStatus.CONFIRM] },
            createdAt: { gt: lastSunday },
          },
          select: {
            id: true,
            transactionType: true,
            currency: true,
            fromCurrency: true,
            toCurrency: true,
            fiatAmountBase: true,
            cryptoAmountBase: true,
            senderWalletId: true,
            receiverWalletId: true,
            transactionContext: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const t of transactions) {
          await reverseTransaction(walletPositions, t);
        }

        const { totalBalanceNgn, ngnBalance, usdBalance, cryptoBalanceNgn, walletCount } =
          computeNgnValues(Array.from(walletPositions.values()), tickers, usdtNgnRate);

        await prisma.dailyBalanceSnapshot.create({
          data: {
            userId: user.id,
            snapshotDate: lastSunday,
            totalBalanceNgn: totalBalanceNgn.toFixed(2),
            ngnBalance: ngnBalance.toFixed(2),
            usdBalance: usdBalance.toFixed(2),
            cryptoBalanceNgn: cryptoBalanceNgn.toFixed(2),
            walletCount,
            tickerSnapshot: {
              method: 'transaction_reversal',
              usdtNgnRate,
              cachedAt: new Date().toISOString(),
              pairCount: Object.keys(tickers).length,
              transactionsReversed: transactions.length,
            },
          },
        });

        summary.snapshotsCreated++;
        summary.usersProcessed++;
      } catch (error: any) {
        const errorMsg = `Failed to populate snapshot for user ${user.id}: ${error.message}`;
        console.error(errorMsg);
        summary.errors.push(errorMsg);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total users: ${summary.totalUsers}`);
    console.log(`Users processed: ${summary.usersProcessed}`);
    console.log(`Snapshots created: ${summary.snapshotsCreated}`);
    console.log(`Snapshots deleted: ${summary.snapshotsDeleted}`);

    if (summary.errors.length > 0) {
      console.log('\n--- Errors (first 10) ---');
      for (const error of summary.errors.slice(0, 10)) {
        console.log(error);
      }
      if (summary.errors.length > 10) {
        console.log(`... and ${summary.errors.length - 10} more errors`);
      }
    }

    console.log(`\nCompleted at: ${new Date().toISOString()}`);
  } catch (error: any) {
    console.error('Fatal error during population:', error);
    summary.errors.push(`Fatal error: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function reverseTransaction(
  positions: Map<string, {
    currency: string;
    balanceNum: number;
    lockedNum: number;
    stackedNum: number;
    stackedInterestNum: number;
    lockedInterestNum: number;
    isCrypto: boolean;
  }>,
  tx: any,
): Promise<void> {
  const type = tx.transactionType as TransactionType;
  const context = tx.transactionContext;
  const currency = tx.currency?.toLowerCase();
  const fromCurrency = tx.fromCurrency?.toLowerCase();
  const toCurrency = tx.toCurrency?.toLowerCase();
  const fiatAmountBase = tx.fiatAmountBase ? Number(tx.fiatAmountBase) : 0;
  const cryptoAmountBase = tx.cryptoAmountBase ? Number(tx.cryptoAmountBase) : 0;

  const senderWalletId = tx.senderWalletId;
  const receiverWalletId = tx.receiverWalletId;

  if (type === TransactionType.CREDIT) {
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum = Math.max(0, pos.balanceNum - amount);
    }
  } else if (type === TransactionType.DEBIT) {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
    }
  } else if (type === TransactionType.REFUND) {
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum = Math.max(0, pos.balanceNum - amount);
    }
  } else if (type === TransactionType.CARD_VERIFICATION_DEBIT) {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
    }
  } else if (context === 'BUY') {
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      const amount = resolveAmount(pos, pos.currency, 0, cryptoAmountBase);
      pos.balanceNum = Math.max(0, pos.balanceNum - amount);
    }
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      pos.balanceNum += fiatAmountBase / 100;
    }
  } else if (context === 'SELL') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, pos.currency, 0, cryptoAmountBase);
      pos.balanceNum += amount;
    }
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      pos.balanceNum = Math.max(0, pos.balanceNum - fiatAmountBase / 100);
    }
  } else if (context === 'SWAP') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, fromCurrency || pos.currency, 0, cryptoAmountBase);
      pos.balanceNum += amount;
    }
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      const amount = resolveAmount(pos, toCurrency || pos.currency, 0, cryptoAmountBase);
      pos.balanceNum = Math.max(0, pos.balanceNum - amount);
    }
  } else if (context === 'DEPOSIT') {
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum = Math.max(0, pos.balanceNum - amount);
    }
  } else if (context === 'WITHDRAWAL') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
    }
  } else if (context === 'TRANSFER') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
    }
    if (receiverWalletId && positions.has(receiverWalletId)) {
      const pos = positions.get(receiverWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum = Math.max(0, pos.balanceNum - amount);
    }
  } else if (context === 'BILL_PAYMENT') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
    }
  } else if (context === 'AUTOSTACK') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
      pos.stackedNum = Math.max(0, pos.stackedNum - amount);
    }
  } else if (context === 'VAULT_SWAP') {
    if (senderWalletId && positions.has(senderWalletId)) {
      const pos = positions.get(senderWalletId)!;
      const amount = resolveAmount(pos, currency, fiatAmountBase, cryptoAmountBase);
      pos.balanceNum += amount;
    }
  }
}

function resolveAmount(
  pos: { isCrypto: boolean; currency: string },
  currency: string | undefined,
  fiatAmountBase: number,
  cryptoAmountBase: number,
): number {
  if (pos.isCrypto && cryptoAmountBase > 0) {
    return Number(ConvertCurrency.fromBase(toBigInt(cryptoAmountBase), pos.currency));
  }
  if (fiatAmountBase > 0) {
    return Number(ConvertCurrency.fromBase(toBigInt(fiatAmountBase), pos.currency));
  }
  return 0;
}

function computeNgnValues(
  positions: {
    currency: string;
    balanceNum: number;
    lockedNum: number;
    stackedNum: number;
    stackedInterestNum: number;
    lockedInterestNum: number;
    isCrypto: boolean;
  }[],
  tickers: Record<string, Ticker>,
  usdtNgnRate: number,
): {
  totalBalanceNgn: number;
  ngnBalance: number;
  usdBalance: number;
  cryptoBalanceNgn: number;
  walletCount: number;
} {
  let totalBalanceNgn = 0;
  let ngnBalance = 0;
  let usdBalance = 0;
  let cryptoBalanceNgn = 0;
  let walletCount = 0;

  for (const pos of positions) {
    const totalWalletBalance =
      pos.balanceNum + pos.lockedNum + pos.stackedNum + pos.stackedInterestNum + pos.lockedInterestNum;
    const currencyLower = pos.currency.toLowerCase();
    let walletNgnValue = 0;

    if (currencyLower === 'ngn') {
      walletNgnValue = totalWalletBalance;
      ngnBalance += walletNgnValue;
    } else if (currencyLower === 'usd') {
      walletNgnValue = totalWalletBalance * usdtNgnRate;
      usdBalance += totalWalletBalance;
    } else if (pos.isCrypto) {
      const price = lookupCryptoPrice(tickers, pos.currency, usdtNgnRate);
      walletNgnValue = totalWalletBalance * price;
      cryptoBalanceNgn += walletNgnValue;
    }

    totalBalanceNgn += walletNgnValue;
    walletCount++;
  }

  return {
    totalBalanceNgn,
    ngnBalance,
    usdBalance,
    cryptoBalanceNgn,
    walletCount,
  };
}

populateWeeklySnapshots()
  .then(() => {
    console.log('\nScript completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
