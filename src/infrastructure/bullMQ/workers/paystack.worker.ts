import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { QueueName } from '../types';
import { PaystackWebhookHandler } from '../../../modules/webhook/paystack';
import { WebhookIdempotencyService } from '../../../modules/webhook/service/webhook-idempotency.service';
import { CompensatedError } from '../../../modules/webhook/compensated-error';

@Processor(QueueName.PAYSTACK, { concurrency: 10 })
export class PaystackWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PaystackWorker.name);

  constructor(
    @InjectQueue(QueueName.PAYSTACK) private readonly queue: Queue,
    private readonly webhookHandler: PaystackWebhookHandler,
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
          this.logger.warn(
            `All ${job.opts.attempts} retries exhausted for Paystack webhook job ${job.id}`,
          );
          await this.webhookIdempotencyService
            .markFailed(webhookId, `Retries exhausted: ${err.message}`)
            .catch(() => undefined);
        }
      }
    });
  }

  async process(job: Job<any>) {
    switch (job.name) {
      case 'process-webhook-event':
        return this.handleWebhookEvent(job);
    }
  }

  private async handleWebhookEvent(job: Job<any>) {
    const { payload, webhookId } = job.data;

    try {
      await this.webhookHandler.handleWebhook(JSON.stringify(payload));

      if (webhookId) {
        await this.webhookIdempotencyService.markProcessed(webhookId);
      }

      this.logger.log(`Processed Paystack webhook: ${payload.data.id}`);
    } catch (error) {
      if (error instanceof CompensatedError) {
        this.logger.warn(`Paystack webhook compensated: ${error.message}`);
        if (webhookId) {
          await this.webhookIdempotencyService
            .markFailed(webhookId, error.message)
            .catch(() => undefined);
        }
      }

      this.logger.error(
        `Failed to process Paystack webhook ${payload.data.id}`,
        error,
      );
      throw error;
    }
  }
}
