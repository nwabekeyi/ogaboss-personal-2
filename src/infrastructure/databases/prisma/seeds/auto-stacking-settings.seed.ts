// src/infrastructure/databases/seeds/auto-stacking-settings.seed.ts

import { PrismaService } from '../prisma.service';
import Decimal from 'decimal.js';

const prisma = new PrismaService();

export async function autoStackingSettingsSeed() {
  const settings = [
    { currency: 'USDT', dailyInterestRatePercent: new Decimal(0.5) },
    { currency: 'BTC', dailyInterestRatePercent: new Decimal(0.5) },
  ];

  for (const setting of settings) {
    const existing = await prisma.autoStackingSettings.findFirst({
      where: { currency: setting.currency },
    });

    if (!existing) {
      await prisma.autoStackingSettings.create({ data: setting });
      console.log(
        `Auto stacking setting seeded for ${setting.currency} (daily interest rate: ${setting.dailyInterestRatePercent.toString()}%).`,
      );
    } else {
      console.log(
        `Auto stacking setting for ${setting.currency} already exists, skipping seed.`,
      );
    }
  }

  const transactionFees = [
    {
      currency: 'USDT',
      fromAmount: new Decimal(0),
      toAmount: new Decimal(1000000000),
      feeAmount: new Decimal(1),
      feeCurrency: 'USDT',
    },
    {
      currency: 'BTC',
      fromAmount: new Decimal(0),
      toAmount: new Decimal(1000000000),
      feeAmount: new Decimal(1),
      feeCurrency: 'USDT',
    },
  ];

  for (const fee of transactionFees) {
    const existing = await prisma.autoStackingTransactionFee.findFirst({
      where: {
        currency: fee.currency,
        fromAmount: fee.fromAmount,
        toAmount: fee.toAmount,
      },
    });

    if (!existing) {
      await prisma.autoStackingTransactionFee.create({ data: fee });
      console.log(
        `Auto stacking transaction fee seeded for ${fee.currency} (${fee.fromAmount.toString()} - ${fee.toAmount.toString()}).`,
      );
    } else {
      console.log(
        `Auto stacking transaction fee for ${fee.currency} already exists, skipping seed.`,
      );
    }
  }
}