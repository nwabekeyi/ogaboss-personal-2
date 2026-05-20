import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { QueueName } from '../types';
import { XpresspayWebhookHandler } from '../../../modules/webhook/xpresspay/xpresspay-webhook.handler';
import { WebhookIdempotencyService } from '../../../modules/webhook/service/webhook-idempotency.service';
import { CompensatedError } from '../../../modules/webhook/compensated-error';

@Processor(QueueName.XPRESSPAY, { concurrency: 10 })
export class XpresspayWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(XpresspayWorker.name);

  constructor(
    @InjectQueue(QueueName.XPRESSPAY) private readonly queue: Queue,
    private readonly webhookHandler: XpresspayWebhookHandler,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {
    super();
  }

  onModuleInit() {
    (this.queue as any).on('failed', async (job: Job, err: Error) => {
      if (
        job.opts.attempts &&
        job.attemptsMade >= job.opts.attempts &&
        !(err instanceof CompensatedError)
      ) {
        const { webhookId } = job.data;
        if (webhookId) {
          await this.webhookIdempotencyService
            .markFailed(webhookId, `Retries exhausted: ${err.message}`)
            .catch(() => undefined);
        }
      }
    });
  }

  async process(job: Job<any>) {
    if (job.name === 'process-webhook-event') return this.handleWebhookEvent(job);
  }

  private async handleWebhookEvent(job: Job<any>) {
    const { payload, webhookId } = job.data;
    try {
      await this.webhookHandler.process(payload);
      if (webhookId) await this.webhookIdempotencyService.markProcessed(webhookId);
    } catch (error) {
      if (error instanceof CompensatedError && webhookId) {
        await this.webhookIdempotencyService.markFailed(webhookId, error.message).catch(() => undefined);
      }
      this.logger.error('Failed to process Xpresspay webhook', error as any);
      throw error;
    }
  }
}
