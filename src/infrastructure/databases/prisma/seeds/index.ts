import { seedSuperAdmin } from './admin.seed';
import { cryptoCurrencySeed } from './crypto-currency.seed';
import {user} from './user.seed'
import { fiatCurrencySeed } from './fiat-currency.seed';
import { PrismaService } from '../prisma.service';
import { seedMasterRole } from './role.seed';
import { urgentLiquiditySettingsSeed } from './urgent-liquidity-settings.seed';
import { autoStackingSettingsSeed } from './auto-stacking-settings.seed';
const prisma = new PrismaService();

async function main() {
  await cryptoCurrencySeed();
  await fiatCurrencySeed();
  await seedMasterRole();
  await urgentLiquiditySettingsSeed();
  await autoStackingSettingsSeed()
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
