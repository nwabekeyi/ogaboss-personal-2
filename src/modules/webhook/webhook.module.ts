// src/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhook.controller';
import { BullMqModule } from '../../infrastructure/bullMQ';
import { QuidaxModule } from '../../infrastructure/providers/quidax/quidax.module';
import { PaystackModule } from '../../infrastructure/providers/paystack';
import { WebhookIdempotencyService } from './service/webhook-idempotency.service';
import {
  AddressGeneratedHandler,
  DepositSuccessfulHandler,
  SwapTransactionHandler,
  WithdrawalWebhookHandler,
} from './quidax/handlers';
import { QuidaxWebhookService } from './quidax';
import { DashboardModule } from '../dashboard/dashboard.module';
import { PaystackWebhookHandler } from './paystack';
import { TransactionModule } from '../transaction/transaction.module';
import { OrderDoneHandler } from './quidax/handlers/order-done.handler';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [
    BullMqModule,
    QuidaxModule,
    PaystackModule,
    DashboardModule,
    TransactionModule,
    AuthModule,
  ],
  controllers: [WebhooksController],
  providers: [
    WebhookIdempotencyService,
    AddressGeneratedHandler,
    DepositSuccessfulHandler,
    SwapTransactionHandler,
    QuidaxWebhookService,
    WithdrawalWebhookHandler,
    PaystackWebhookHandler,
    OrderDoneHandler,
  ],
  exports: [
    QuidaxWebhookService,
    PaystackWebhookHandler,
    WebhookIdempotencyService,
    DepositSuccessfulHandler,
    SwapTransactionHandler,
    WithdrawalWebhookHandler,
    OrderDoneHandler,
  ],
})
export class WebhooksModule {}
