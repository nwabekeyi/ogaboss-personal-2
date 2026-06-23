import { Module } from '@nestjs/common';
import { AdminTransactionController } from './transactions/admin.transactions.controller';
import { AdminTransactionService } from './transactions/admin-transactions.service';
import { PrismaService } from '../../infrastructure';
import { AdminUserController } from './users/admin-users.controller';
import { AdminUserService } from './users/admin-users.service';
import { JwtService } from '@nestjs/jwt';
import { InternalUserService } from './Internal-user/internal-user.service';
import { InternalUsersController } from './Internal-user/internal-user.controller';
import { InternalRolesController } from './Internal-user/internal-role.controller';
import { FiatCurrencyController } from './currencies/controllers/fiat-currency.controller';
import { FiatCurrencyService } from './currencies/services/fiat-currency.service';
import { CryptoBufferController } from './currencies/controllers/crypto-buffer.controller';
import { CryptoBufferService } from './currencies/services/crypto-buffer-rate.service';
import { CryptoCurrencyRateController } from './currencies/controllers/crypto-currency-rate.controller';
import { CryptoCurrencyRateService } from './currencies/services/crypto-currency-rate.service';
import { UrgentLiquiditySettingsController } from './currencies/controllers/urgent-liquidity-settings.controller';
import { UrgentLiquiditySettingsService } from './currencies/services/urgent-liquidity-settings.service';
import { AutoStackingSettingsController } from './currencies/controllers/auto-stacking-settings.controller';
import { AutoStackingSettingsService } from './currencies/services/auto-stacking-settings.service';
import { TransactionModule } from '../transaction/transaction.module';
import { WebhooksModule } from '../webhook/webhook.module';
import { AdminLiquidityController } from './liquidity/admin-liquidity.controller';
import { AdminLiquidityService } from './liquidity/admin-liquidity.service';

@Module({
  imports: [TransactionModule, WebhooksModule],
  controllers: [
    AdminTransactionController,
    AdminUserController,
    InternalUsersController,
    InternalRolesController,
    FiatCurrencyController,
    CryptoBufferController,
    CryptoCurrencyRateController,
    UrgentLiquiditySettingsController,
    AutoStackingSettingsController,
    AdminLiquidityController,
  ],
  providers: [
    AdminTransactionService,
    PrismaService,
    AdminUserService,
    JwtService,
    InternalUserService,
    FiatCurrencyService,
    CryptoBufferService,
    CryptoCurrencyRateService,
    UrgentLiquiditySettingsService,
    AutoStackingSettingsService,
    AdminLiquidityService,
  ],
})
export class AdminModule {}