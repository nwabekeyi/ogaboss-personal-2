import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QueueName, PushJobPayload } from '../types';
import { FirebaseCloudMessagingService } from '../../providers/firebase/firebase-cloud-messaging.service';

@Processor(QueueName.PUSH, { concurrency: 25 })
export class PushWorker extends WorkerHost {
  private readonly logger = new Logger(PushWorker.name);

  constructor(private readonly fcmService: FirebaseCloudMessagingService) {
    super();
  }

  async process(job: Job<PushJobPayload>): Promise<void> {
    const { userId, title, body, data } = job.data;

    const result = await this.fcmService.sendNotification({
      userId,
      title,
      body,
      data: data
        ? { ...data, type: data.type || 'general' }
        : { type: 'general' },
    });

    if (!result) {
      throw new Error(`Push notification failed for user ${userId}`);
    }

    this.logger.log(`Push notification sent to user ${userId}`);
  }
}
