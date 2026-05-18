import 'dotenv/config';
import { PrismaService } from '../infrastructure/databases/prisma/prisma.service';

const prisma = new PrismaService();

interface BufferTierInput {
  orderType?: 'BUY' | 'SELL' | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  bufferPercent: number;
}

async function configureUsdtBufferTiers(tiers: BufferTierInput[]) {
  const crypto = await prisma.cryptoCurrency.findUnique({
    where: { symbol: 'BTC' },
    include: { buffer_tiers: true },
  });

  if (!crypto) {
    console.error('USDT cryptocurrency not found in database');
    console.log('Run the crypto currency seed first: npm run seed');
    process.exit(1);
  }

  console.log(`Found USDT crypto: ${crypto.id}`);
  console.log(`Existing buffer tiers: ${crypto.buffer_tiers.length}`);

  // Delete existing tiers for USDT
  if (crypto.buffer_tiers.length > 0) {
    console.log('Deleting existing buffer tiers...');
    await prisma.bufferTier.deleteMany({
      where: { cryptoId: crypto.id },
    });
  }

  for (const tier of tiers) {
    let minAmountString: string | null = null;
    let maxAmountString: string | null = null;

    if (tier.minAmount !== null && tier.minAmount !== undefined) {
      minAmountString = String(Math.floor(parseFloat(tier.minAmount) * 100));
    }
    if (tier.maxAmount !== null && tier.maxAmount !== undefined) {
      maxAmountString = String(Math.floor(parseFloat(tier.maxAmount) * 100));
    }

    const existingTier = await prisma.bufferTier.findFirst({
      where: {
        cryptoId: crypto.id,
        orderType: tier.orderType ?? null,
        minAmount: minAmountString,
        maxAmount: maxAmountString,
      },
    });

    if (existingTier) {
      console.log(
        `Updating existing tier: orderType=${tier.orderType}, minAmount=${tier.minAmount}, maxAmount=${tier.maxAmount}`,
      );
      await prisma.bufferTier.update({
        where: { id: existingTier.id },
        data: { bufferPercent: tier.bufferPercent },
      });
    } else {
      console.log(
        `Creating new tier: orderType=${tier.orderType}, minAmount=${tier.minAmount}, maxAmount=${tier.maxAmount}, bufferPercent=${tier.bufferPercent}`,
      );
      await prisma.bufferTier.create({
        data: {
          cryptoId: crypto.id,
          orderType: tier.orderType ?? null,
          minAmount: minAmountString,
          maxAmount: maxAmountString,
          bufferPercent: tier.bufferPercent,
        },
      });
    }
  }

  const updatedTiers = await prisma.bufferTier.findMany({
    where: { cryptoId: crypto.id },
    orderBy: { minAmount: 'asc' },
  });

  console.log('\n=== USDT Buffer Tiers ===');
  for (const tier of updatedTiers) {
    const min = tier.minAmount !== null ? Number(tier.minAmount) / 100 : 'null';
    const max = tier.maxAmount !== null ? Number(tier.maxAmount) / 100 : 'null';
    console.log(
      `  OrderType: ${tier.orderType || 'ALL'}, Min: ${min}, Max: ${max}, Buffer: ${tier.bufferPercent}%`,
    );
  }

  console.log('\nDone!');
}

const tiers: BufferTierInput[] = [
  { orderType: 'BUY', minAmount: '0', maxAmount: '100000', bufferPercent: 2.0 },
  {
    orderType: 'BUY',
    minAmount: '100000',
    maxAmount: '500000',
    bufferPercent: 1.5,
  },
  {
    orderType: 'BUY',
    minAmount: '500000',
    maxAmount: null,
    bufferPercent: 1.0,
  },
  {
    orderType: 'SELL',
    minAmount: '0',
    maxAmount: '100000',
    bufferPercent: 2.0,
  },
  {
    orderType: 'SELL',
    minAmount: '100000',
    maxAmount: '500000',
    bufferPercent: 1.5,
  },
  {
    orderType: 'SELL',
    minAmount: '500000',
    maxAmount: null,
    bufferPercent: 1.0,
  },
];

configureUsdtBufferTiers(tiers)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
