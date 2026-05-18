import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { PaystackService } from '../../infrastructure/providers/paystack';
import { DojahService } from '../../infrastructure/providers/dojah/dojah.service';
import {
  OtpService,
  TokenService,
  TempStoreService,
} from '../../shared/services';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { UserModule } from '../user/user.module';
import { UserService } from '../auth/users/users.service';
import { DashboardStatsQueueService } from '../dashboard/dashboard-stats-queue';

@Module({
  imports: [
    HttpModule,
    QuidaxModule,
    UserModule
  ],
  controllers: [AccountController],
  providers: [
    TempStoreService,
    AccountService,
    OtpService,
    TokenService,
    PrismaService,
    JwtService,
    PaystackService,
    DojahService,
    EmailService,
    UserService,
    DashboardStatsQueueService
  ],
})
export class AccountModule { }