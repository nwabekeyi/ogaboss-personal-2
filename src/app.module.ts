import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './infrastructure/databases/prisma/prisma.module';
import { PrismaService } from './infrastructure/databases/prisma/prisma.service';
import {
  AuthModule,
  CurrencyModule,
  WalletModule,
  TransactionModule,
  DashboardModule,
  AccountModule,
  WebhooksModule,
  UserModule,
  KycModule,
  SchedulerModule,
  CardModule,
  SettingsModule,
  VaultModule,
  // AutoStackModule,
} from './modules';
import { RedisModule } from './infrastructure/databases/redis';
import { QuidaxModule } from './infrastructure/providers/quidax/quidax.module';
import { HttpModule } from './infrastructure/httpService';
import { HealthModule } from './health/health.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { config } from './config';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AdminModule } from './modules/admin/admin.module';
import { FirebaseModule } from './infrastructure/providers/firebase/firebase.module';
import { AuditLogModule, AuditLogInterceptor } from './core/audit';

@Module({
  imports: [
    SentryModule.forRoot(),
    // Global Config
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),

    // Global EventEmitter
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),

    //  Global JWT
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('credentials.jwt.accessSecret'),
        signOptions: {
          expiresIn: config.get<string | number>(
            'credentials.jwt.accessExpirationInterval',
          ) as any,
        },
      }),
    }),

    //rate limiter
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: config.defaults.rateLimiter.duration,
          limit: config.defaults.rateLimiter.points,
        },
      ],
    }),

    // Other modules
    HealthModule,
    PrismaModule,
    AuthModule,
    AdminModule,
    UserModule,
    WalletModule,
    KycModule,
    CurrencyModule,
    TransactionModule,
    DashboardModule,
    AccountModule,
    CardModule,
    SettingsModule,
    VaultModule,
    // AutoStackModule,
    RedisModule,
    QuidaxModule,
    BullModule,
    SchedulerModule,
    HttpModule,
    FirebaseModule,
    AuditLogModule,
    WebhooksModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
