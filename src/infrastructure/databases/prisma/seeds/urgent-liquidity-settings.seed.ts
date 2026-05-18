// src/infrastructure/databases/seeds/urgent-liquidity-settings.seed.ts

import { PrismaService } from '../prisma.service';
import Decimal from 'decimal.js';

const prisma = new PrismaService();

export async function urgentLiquiditySettingsSeed() {
  const existing = await prisma.urgentLiquiditySettings.findFirst();

  if (!existing) {
    await prisma.urgentLiquiditySettings.create({
      data: {
        maxLoanRequest: new Decimal(0),
        loanFeePercent: new Decimal(0),
        settlementPercent: new Decimal(0),
        collateralPercent: new Decimal(0),
        liquidationDeadlineDays: 0,
        liquidationFeePercent: new Decimal(0),
      },
    });

    console.log('Urgent liquidity settings seeded with defaults.');
  } else {
    console.log('Urgent liquidity settings already exist, skipping seed.');
  }
}
