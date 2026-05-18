import { PrismaService } from '../prisma.service';

const prisma = new PrismaService();

export async function fiatCurrencySeed() {
  const fiats = [
    {
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
    },
    {
      code: 'NGN',
      name: 'Nigerian Naira',
      symbol: '₦',
    },
  ];

  for (const fiat of fiats) {
    await prisma.fiatCurrency.upsert({
      where: { code: fiat.code },
      update: {
        name: fiat.name,
        symbol: fiat.symbol,
      },
      create: {
        code: fiat.code,
        name: fiat.name,
        symbol: fiat.symbol,
      },
    });

    console.log(`${fiat.code} currency seeded successfully.`);
  }
}
