// import 'dotenv/config';
// import Decimal from 'decimal.js';
// import { PrismaService } from '../infrastructure/databases/prisma/prisma.service';
// import { ConvertCurrency } from '../shared/utils/currency-precision.util';
// import { CryptoNetwork } from '../shared';

// const prisma = new PrismaService();

// type OrderType = 'BUY' | 'SELL';

// interface BufferTierInput {
//   orderType: OrderType;
//   minAmount: string; // major units
//   maxAmount: string; // major units
//   bufferPercent: number;
// }

// interface CurrencyBufferConfig {
//   symbol: 'BTC' | 'USDT';
//   defaultBufferPercent: number;
//   tiers: BufferTierInput[];
// }

// const CONFIGS: CurrencyBufferConfig[] = [
//   {
//     symbol: 'BTC',
//     defaultBufferPercent: 1.5,
//     tiers: [
//       {
//         orderType: 'BUY',
//         minAmount: '0',
//         maxAmount: '0.01',
//         bufferPercent: 2.0,
//       },
//       {
//         orderType: 'BUY',
//         minAmount: '0.01000001',
//         maxAmount: '0.1',
//         bufferPercent: 1.5,
//       },
//       {
//         orderType: 'BUY',
//         minAmount: '0.10000001',
//         maxAmount: '10',
//         bufferPercent: 1.0,
//       },
//       {
//         orderType: 'SELL',
//         minAmount: '0',
//         maxAmount: '0.01',
//         bufferPercent: 2.0,
//       },
//       {
//         orderType: 'SELL',
//         minAmount: '0.01000001',
//         maxAmount: '0.1',
//         bufferPercent: 1.5,
//       },
//       {
//         orderType: 'SELL',
//         minAmount: '0.10000001',
//         maxAmount: '10',
//         bufferPercent: 1.0,
//       },
//     ],
//   },
//   {
//     symbol: 'USDT',
//     defaultBufferPercent: 1.0,
//     tiers: [
//       {
//         orderType: 'BUY',
//         minAmount: '0',
//         maxAmount: '100',
//         bufferPercent: 2.0,
//       },
//       {
//         orderType: 'BUY',
//         minAmount: '100.000001',
//         maxAmount: '500',
//         bufferPercent: 1.5,
//       },
//       {
//         orderType: 'BUY',
//         minAmount: '500.000001',
//         maxAmount: '1000000',
//         bufferPercent: 1.0,
//       },
//       {
//         orderType: 'SELL',
//         minAmount: '0',
//         maxAmount: '100',
//         bufferPercent: 2.0,
//       },
//       {
//         orderType: 'SELL',
//         minAmount: '100.000001',
//         maxAmount: '500',
//         bufferPercent: 1.5,
//       },
//       {
//         orderType: 'SELL',
//         minAmount: '500.000001',
//         maxAmount: '1000000',
//         bufferPercent: 1.0,
//       },
//     ],
//   },
// ];

// function assertValidTier(
//   t: BufferTierInput,
//   idx: number,
//   symbol: string,
// ): void {
//   if (!t.minAmount || !t.maxAmount) {
//     throw new Error(
//       `[${symbol}] tier #${idx + 1}: minAmount and maxAmount are required`,
//     );
//   }

//   const min = new Decimal(t.minAmount);
//   const max = new Decimal(t.maxAmount);
//   if (!min.isFinite() || !max.isFinite() || min.lt(0) || max.lt(min)) {
//     throw new Error(
//       `[${symbol}] tier #${idx + 1}: invalid range min=${t.minAmount}, max=${t.maxAmount}`,
//     );
//   }
//   if (
//     !Number.isFinite(t.bufferPercent) ||
//     t.bufferPercent < 0 ||
//     t.bufferPercent > 100
//   ) {
//     throw new Error(
//       `[${symbol}] tier #${idx + 1}: bufferPercent must be between 0 and 100`,
//     );
//   }
// }

// async function configureCurrencyBuffer(config: CurrencyBufferConfig) {
//   const crypto = await prisma.cryptoCurrency.findUnique({
//     where: { symbol: config.symbol },
//     include: { buffer_tiers: true },
//   });

//   if (!crypto) {
//     throw new Error(
//       `${config.symbol} cryptocurrency not found. Run seed first.`,
//     );
//   }

//   const network = (crypto.networks?.[0] as CryptoNetwork) || 'erc20';

//   console.log(`\n=== Configuring ${config.symbol} buffer tiers ===`);
//   console.log(
//     `cryptoId: ${crypto.id} | existing tiers: ${crypto.buffer_tiers.length}`,
//   );

//   config.tiers.forEach((tier, i) => assertValidTier(tier, i, config.symbol));

//   await prisma.$transaction(async (tx) => {
//     await tx.cryptoCurrency.update({
//       where: { id: crypto.id },
//       data: {
//         defaultBufferPercent: new Decimal(
//           config.defaultBufferPercent,
//         ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
//       },
//     });

//     await tx.bufferTier.deleteMany({ where: { cryptoId: crypto.id } });

//     for (const tier of config.tiers) {
//       const minAmountBase = ConvertCurrency.toBase(
//         tier.minAmount,
//         config.symbol,
//       ).toString();
//       const maxAmountBase = ConvertCurrency.toBase(
//         tier.maxAmount,
//         config.symbol,
//       ).toString();

//       await tx.bufferTier.create({
//         data: {
//           cryptoId: crypto.id,
//           orderType: tier.orderType,
//           minAmount: minAmountBase,
//           maxAmount: maxAmountBase,
//           bufferPercent: new Decimal(tier.bufferPercent).toDecimalPlaces(
//             2,
//             Decimal.ROUND_HALF_UP,
//           ),
//         },
//       });
//     }
//   });

//   const updated = await prisma.bufferTier.findMany({
//     where: { cryptoId: crypto.id },
//     orderBy: [{ orderType: 'asc' }, { minAmount: 'asc' }],
//   });

//   console.log(`defaultBufferPercent: ${config.defaultBufferPercent}%`);
//   for (const tier of updated) {
//     const minMajor = ConvertCurrency.fromBase(
//       tier.minAmount.toString(),
//       config.symbol,
//     );
//     const maxMajor = ConvertCurrency.fromBase(
//       tier.maxAmount.toString(),
//       config.symbol,
//     );
//     console.log(
//       `  ${tier.orderType}: [${minMajor} - ${maxMajor}] => ${tier.bufferPercent}%`,
//     );
//   }
// }

// async function main() {
//   for (const config of CONFIGS) {
//     await configureCurrencyBuffer(config);
//   }
//   console.log('\nBuffer tier configuration completed successfully.');
// }

// main()
//   .catch((error) => {
//     console.error('Buffer tier configuration failed:', error);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });