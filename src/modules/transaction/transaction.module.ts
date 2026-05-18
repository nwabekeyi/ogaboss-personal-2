import { Module } from '@nestjs/common';
import {
  BuyService,
  FailedCompanyLiquidityService,
  SellService,
  SwapService,
  TransactionNotificationService,
  TransactionQueryService,
  TransactionService,
} from './services';
import { PrismaService } from '../../infrastructure/databases/prisma';
import { RedisService } from '../../infrastructure/databases/redis/redis.service';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { JwtService } from '@nestjs/jwt';
import { PaystackModule } from '../../infrastructure/providers/paystack';
import { DashboardModule } from '../dashboard/dashboard.module';
import { QuotationService } from './services';
import { QuotesController, TransactionQueryController } from './controllers';
import { SwapController } from './controllers/swap.controller';
import { WithdrawalController } from './controllers/withdrawal.controller';
import { WithdrawalService } from './services/withdrawal.service';
import { BuyController } from './controllers/buy.controller';
import { SellController } from './controllers/sell.controller';
import { CompanyLiquidityService } from './services/company-liquidity.service';
import { TransactionLimitInterceptor } from './interceptors/transaction-limit.interceptor';
import { TierLimitService } from '../../shared/services/tier-limit.service';
@Module({
  imports: [QuidaxModule, PaystackModule, DashboardModule],
  controllers: [
    TransactionQueryController,
    QuotesController,
    BuyController,
    SellController,
    SwapController,
    WithdrawalController,
  ],
  providers: [
    TransactionService,
    JwtService,
    QuotationService,
    PrismaService,
    RedisService,
    BuyService,
    TransactionQueryService,
    SwapService,
    WithdrawalService,
    SellService,
    CompanyLiquidityService,
    FailedCompanyLiquidityService,
    TransactionNotificationService,
    TransactionLimitInterceptor,
    TierLimitService,
  ],
  exports: [
    TransactionService,
    QuotationService,
    BuyService,
    CompanyLiquidityService,
    FailedCompanyLiquidityService,
    TransactionNotificationService,
    TransactionLimitInterceptor,
  ],
})
export class TransactionModule {}
