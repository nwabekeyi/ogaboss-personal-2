import 'dotenv/config';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { QuidaxWithdrawalService } from '../../infrastructure/providers/quidax/withdrawal.service';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { Logger } from '@nestjs/common';
import { Company_withdrawal_type } from '../../shared';

const USER_ID = 'ANY USER ID';
const CURRENCY = 'usdt';
const AMOUNT = '1';
const NETWORK = 'trc20';

async function main() {
  const logger = new Logger('TestWithdrawToCompanyAccount');

  logger.log(`Testing withdrawToCompanyAccount for user: ${USER_ID}`);
  logger.log(`Amount: ${AMOUNT} ${CURRENCY} (network: ${NETWORK})`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  await prisma.$connect();

  const withdrawalService = app.get(QuidaxWithdrawalService);

  const reference = {
    type: Company_withdrawal_type.Deposit,
    providerId: `test-${Date.now()}`,
  };

  const narration = 'Test withdrawal to company account';

  try {
    const result = await withdrawalService.withdrawToCompanyAccount(
      USER_ID,
      CURRENCY,
      AMOUNT,
      reference,
      narration,
      NETWORK,
    );

    logger.log('=== WITHDRAW RESULT ===');
    logger.log(JSON.stringify(result, null, 2));

    if (result.status === 'success') {
      logger.log(
        `✅ Withdrawal successful! Reference: ${result.data?.reference}`,
      );
    } else {
      logger.error(`❌ Withdrawal failed: ${result.message}`);
    }
  } catch (error) {
    logger.error('❌ Error calling withdrawToCompanyAccount:', error.message);
    logger.error(error.stack);
  } finally {
    await prisma.$disconnect();
    await app.close();
  }
}

main()
  .then(() => {
    console.log('\nScript completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nScript failed:', err);
    process.exit(1);
  });
