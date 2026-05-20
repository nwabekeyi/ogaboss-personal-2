// src/infrastructure/bullmq/bullmq.module.ts
import { forwardRef, Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullConfigService } from '../../config/bullMQ';
import { QueueService } from './bullmq.service';
import { EmailWorker } from './workers/email.worker';
import { PushWorker } from './workers/push.worker';
import { QuidaxAccountWorker } from './workers/quidax-account.worker';
import { QueueName } from './types';
import { QuidaxModule } from '../providers/quidax/quidax.module';
import { EmailModule } from '../email';
import { DashboardStatsWorker } from './workers/dashboard-stat.worker';
import { DashboardModule } from '../../modules/dashboard/dashboard.module';
import { PaystackWorker } from './workers/paystack.worker';
import {
  QuidaxOrdersTradesWorker,
  QuidaxReceiveTradesWorker,
  QuidaxSendTradesWorker,
  QuidaxSwapTradesWorker,
  QuidaxWalletAddressWorker,
} from './workers/quidax-trades.worker';
import { WebhooksModule } from '../../modules';
import { XpresspayWorker } from './workers/xpresspay.worker';
import { FirebaseModule } from '../providers/firebase/firebase.module';

@Global()
@Module({
  imports: [
    QuidaxModule,
    DashboardModule,
    EmailModule,
    FirebaseModule,
    forwardRef(() => WebhooksModule),
    BullModule.forRootAsync({
      useClass: BullConfigService,
    }),

    // 2. Register all queues
    BullModule.registerQueue(
      { name: QueueName.EMAIL },
      { name: QueueName.PUSH },
      { name: QueueName.QUIDAX_ACCOUNT },
      { name: QueueName.SWAP },
      { name: QueueName.ORDERS },
      { name: QueueName.SEND },
      { name: QueueName.RECEIVE },
      { name: QueueName.REPORT },
      { name: QueueName.CLEANUP },
      { name: QueueName.DASHBOARD_STATS },
      { name: QueueName.PAYSTACK },
      { name: QueueName.QUIDAX_WALLET },
      { name: QueueName.XPRESSPAY },
    ),
  ],
  providers: [
    QueueService,
    EmailWorker,
    PushWorker,
    QuidaxAccountWorker,
    DashboardStatsWorker,
    PaystackWorker,
    QuidaxSwapTradesWorker,
    QuidaxOrdersTradesWorker,
    QuidaxSendTradesWorker,
    QuidaxReceiveTradesWorker,
    QuidaxWalletAddressWorker,
    XpresspayWorker,
  ],
  exports: [QueueService, BullModule],
})
export class BullMqModule {}
