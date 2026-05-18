// src/infrastructure/databases/seeds/auto-stacking-settings.seed.ts

import { PrismaService } from '../prisma.service';
import Decimal from 'decimal.js';

const prisma = new PrismaService();

export async function autoStackingSettingsSeed() {
  const existing = await prisma.autoStackingSettings.findFirst();

  if (!existing) {
    await prisma.autoStackingSettings.create({
      data: {
        dailyInterestRatePercent: new Decimal(0),
        currency: 'NGN',
      },
    });

    console.log(
      'Auto stacking settings seeded with defaults (interest rate: 0%).',
    );
  } else {
    console.log('Auto stacking settings already exist, skipping seed.');
  }
}
