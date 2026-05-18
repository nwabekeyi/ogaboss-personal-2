import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { QueueName } from '../types';
import { QuidaxWebhookService } from '../../../modules/webhook/quidax';
import { WebhookIdempotencyService } from '../../../modules/webhook/service/webhook-idempotency.service';
import { CompensatedError } from '../../../modules/webhook/compensated-error';

function registerFailedListener(
  queue: Queue,
  logger: Logger,
  webhookIdempotencyService: WebhookIdempotencyService,
) {
  (queue as any).on('failed', async (job: Job, err: Error) => {
    if (
      job.opts.attempts &&
      job.attemptsMade >= job.opts.attempts &&
      !(err instanceof CompensatedError)
    ) {
      const { webhookId } = job.data;
      if (webhookId) {
        logger.warn(
          `All ${job.opts.attempts} retries exhausted for webhook job ${job.id}`,
        );
        await webhookIdempotencyService
          .markFailed(webhookId, `Retries exhausted: ${err.message}`)
          .catch(() => undefined);
      }
    }
  });
}

@Processor(QueueName.SWAP, { concurrency: 10 })
export class QuidaxSwapTradesWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(QuidaxSwapTradesWorker.name);

  constructor(
    @InjectQueue(QueueName.SWAP) private readonly queue: Queue,
    private readonly quidaxWebhookService: QuidaxWebhookService,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {
    super();
  }

  onModuleInit() {
    registerFailedListener(
      this.queue,
      this.logger,
      this.webhookIdempotencyService,
    );
  }

  async process(job: Job<any>) {
    this.logger.debug(`Received job: ${job.name} with id: ${job.id}`);
    if (job.name !== 'process-webhook-event') {
      this.logger.warn(`Unhandled trade job name: ${job.name}`);
      return;
    }

    try {
      await this.quidaxWebhookService.processWebhookEvent(
        job.data.payload,
        job.data.webhookId,
      );
      this.logger.log(`Successfully processed webhook event`);
    } catch (error) {
      this.logger.error(
        `Error in processWebhookEvent: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}

@Processor(QueueName.ORDERS, { concurrency: 10 })
export class QuidaxOrdersTradesWorker
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(QuidaxOrdersTradesWorker.name);

  constructor(
    @InjectQueue(QueueName.ORDERS) private readonly queue: Queue,
    private readonly quidaxWebhookService: QuidaxWebhookService,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {
    super();
  }

  onModuleInit() {
    registerFailedListener(
      this.queue,
      this.logger,
      this.webhookIdempotencyService,
    );
  }

  async process(job: Job<any>) {
    this.logger.debug(`Received job: ${job.name} with id: ${job.id}`);
    if (job.name !== 'process-webhook-event') {
      this.logger.warn(`Unhandled trade job name: ${job.name}`);
      return;
    }

    try {
      await this.quidaxWebhookService.processWebhookEvent(
        job.data.payload,
        job.data.webhookId,
      );
      this.logger.log(`Successfully processed webhook event`);
    } catch (error) {
      this.logger.error(
        `Error in processWebhookEvent: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}

@Processor(QueueName.SEND, { concurrency: 10 })
export class QuidaxSendTradesWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(QuidaxSendTradesWorker.name);

  constructor(
    @InjectQueue(QueueName.SEND) private readonly queue: Queue,
    private readonly quidaxWebhookService: QuidaxWebhookService,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {
    super();
  }

  onModuleInit() {
    registerFailedListener(
      this.queue,
      this.logger,
      this.webhookIdempotencyService,
    );
  }

  async process(job: Job<any>) {
    this.logger.debug(`Received job: ${job.name} with id: ${job.id}`);
    if (job.name !== 'process-webhook-event') {
      this.logger.warn(`Unhandled trade job name: ${job.name}`);
      return;
    }

    try {
      await this.quidaxWebhookService.processWebhookEvent(
        job.data.payload,
        job.data.webhookId,
      );
      this.logger.log(`Successfully processed webhook event`);
    } catch (error) {
      this.logger.error(
        `Error in processWebhookEvent: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}

@Processor(QueueName.RECEIVE, { concurrency: 10 })
export class QuidaxReceiveTradesWorker
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(QuidaxReceiveTradesWorker.name);

  constructor(
    @InjectQueue(QueueName.RECEIVE) private readonly queue: Queue,
    private readonly quidaxWebhookService: QuidaxWebhookService,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {
    super();
  }

  onModuleInit() {
    registerFailedListener(
      this.queue,
      this.logger,
      this.webhookIdempotencyService,
    );
  }

  async process(job: Job<any>) {
    this.logger.debug(`Received job: ${job.name} with id: ${job.id}`);
    if (job.name !== 'process-webhook-event') {
      this.logger.warn(`Unhandled trade job name: ${job.name}`);
      return;
    }

    try {
      await this.quidaxWebhookService.processWebhookEvent(
        job.data.payload,
        job.data.webhookId,
      );
      this.logger.log(`Successfully processed webhook event`);
    } catch (error) {
      this.logger.error(
        `Error in processWebhookEvent: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}

@Processor(QueueName.QUIDAX_WALLET, { concurrency: 10 })
export class QuidaxWalletAddressWorker
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(QuidaxWalletAddressWorker.name);

  constructor(
    @InjectQueue(QueueName.QUIDAX_WALLET) private readonly queue: Queue,
    private readonly quidaxWebhookService: QuidaxWebhookService,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
  ) {
    super();
  }

  onModuleInit() {
    registerFailedListener(
      this.queue,
      this.logger,
      this.webhookIdempotencyService,
    );
  }

  async process(job: Job<any>) {
    this.logger.log(
      `[QUIDAX_WALLET] Processing job ${job.id}, name: ${job.name}`,
    );
    this.logger.debug(`Received job: ${job.name} with id: ${job.id}`);
    if (job.name !== 'process-webhook-event') {
      this.logger.warn(`Unhandled trade job name: ${job.name}`);
      return;
    }

    try {
      await this.quidaxWebhookService.processWebhookEvent(
        job.data.payload,
        job.data.webhookId,
      );
      this.logger.log(`Successfully processed webhook event`);
    } catch (error) {
      this.logger.error(
        `Error in processWebhookEvent: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
