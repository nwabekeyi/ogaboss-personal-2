import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from './users/users.service';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AdminService } from './admin';
import { EmailService } from '../../infrastructure/email';
import { AuthGuard } from '../../core';
import { SharedModule } from '../../shared/shared.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { GeneralAuthController } from './controllers/general-auth.controller';
import { UserOnboardingController } from './controllers/user-onboarding.controller';
import { UserAuthController } from './controllers/user-auth.controller';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { CaptchaModule } from '../../infrastructure/captcha';
@Module({
  imports: [
    SharedModule,
    JwtModule,
    DashboardModule,
    CaptchaModule
  ],
  controllers: [
    UserOnboardingController,
    UserAuthController,
    AdminAuthController,
    GeneralAuthController,

  ],
  providers: [
    AuthService,
    UserService,
    PrismaService,
    JwtService,
    AdminService,
    EmailService,
    AuthGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    UserService,
  ],
})
export class AuthModule {}