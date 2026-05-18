// quidax.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '../../../infrastructure/httpService';
import {
  QuidaxAccountService,
  QuidaxWalletService,
  QuidaxSwapService,
  QuidaxOrderService,
  QuidaxOnboardingService,
  QuidaxMarketService,
  QuidaxTickerService,
  QuidaxWithdrawalService,
  QuidaxDepositService
} from './index';
import { BaseQuidaxService } from './base-quidax.service';
import { DashboardModule } from '../../../modules/dashboard/dashboard.module';

@Module({
  imports: [HttpModule, DashboardModule],
  providers: [
    QuidaxAccountService,
    QuidaxWalletService,
    QuidaxSwapService,
    QuidaxOrderService,
    QuidaxOnboardingService,
    QuidaxTickerService,
    QuidaxMarketService,
    BaseQuidaxService,
    QuidaxWithdrawalService,
    QuidaxDepositService
  ],
  exports: [
    QuidaxAccountService,
    QuidaxWalletService,
    QuidaxSwapService,
    QuidaxOrderService,
    QuidaxOnboardingService,
    QuidaxTickerService,
    QuidaxMarketService,
    BaseQuidaxService,
    QuidaxWithdrawalService,
    QuidaxDepositService
  ],
})
export class QuidaxModule {}