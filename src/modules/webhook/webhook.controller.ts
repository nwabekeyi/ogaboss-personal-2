// src/webhooks/webhooks.controller.ts
import {
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Headers,
  Req,
  Logger,
} from '@nestjs/common';
import { WebhookIdempotencyService } from './service/webhook-idempotency.service';
import { apiTags } from '../../shared';
import { VersionedController } from '../../core/decorators';
import { PaystackService } from '../../infrastructure/providers/paystack';
import { PaystackWebhookEvent } from '../../infrastructure/providers/paystack/type';
import { BaseQuidaxService } from '../../infrastructure/providers/quidax/base-quidax.service';
import { QueueService } from '../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../infrastructure/bullMQ';
import { Providers } from '../../shared';
import { backoff_retries, BackoffType, BackoffTypes } from './constant';
import { ConfigService } from '@nestjs/config';

@VersionedController(apiTags.webhook)
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(
    private readonly paystackService: PaystackService,
    private readonly queueService: QueueService,
    private readonly baseQuidaxService: BaseQuidaxService,
    private readonly idempotencyService: WebhookIdempotencyService,
    private readonly configService: ConfigService,
  ) {}

  private resolveQuidaxQueue(event: string): QueueName {
    if (event.startsWith('swap_transaction.')) return QueueName.SWAP;
    if (event === 'order.done') return QueueName.ORDERS;
    if (event.startsWith('withdraw.')) return QueueName.SEND;
    if (event === 'wallet.address.generated') return QueueName.QUIDAX_WALLET;
    if (event.startsWith('deposit.')) return QueueName.RECEIVE;

    return null;
  }

  @Post('quidax')
  @HttpCode(HttpStatus.OK)
  async handleQuidaxWebhook(
    @Req() req: any,
    @Body() payload: any,
    @Headers('quidax-signature') signature: string,
  ) {
    console.log(payload);
    this.logger.debug(
      `Received quidax webhook, event: ${payload.event}, data.id: ${payload.data?.id}`,
    );
    if (!signature) throw new BadRequestException('Missing Quidax signature');

    // Verify signature using raw body when available
    const rawBody = req?.rawBody
      ? req.rawBody.toString()
      : JSON.stringify(payload);

    try {
      this.baseQuidaxService.verifyWebhookSignature(rawBody, signature);
    } catch (error) {
      this.logger.error(
        `Quidax signature verification failed: ${error.message}`,
      );
      throw new BadRequestException('Invalid Quidax signature');
    }

    // Parse after verification
    const eventId = payload.data?.id
      ? `${payload.event}_${payload.data.id}`
      : null;
    if (!eventId) {
      this.logger.warn(`No eventId in payload, skipping: ${payload.event}`);
      return { received: true };
    }

    const event = payload.event;
    const queue = this.resolveQuidaxQueue(event);
    this.logger.debug(`Resolved queue for event ${event}: ${queue}`);
    if (!queue) {
      this.logger.warn(`No queue found for event: ${event}`);
      return { received: true };
    }

    // Keep provider webhook ingestion async after signature/idempotency.
    // Record existence checks are handled by workers so the provider request path
    // stays fast and does not couple provider bursts directly to DB lookup latency.

    // Reusable idempotency check
    const { isNew, webhookId } = await this.idempotencyService.ensureUnique(
      eventId,
      Providers.QUIDAX,
      payload.event,
      payload,
      undefined,
    );
    this.logger.debug(`Idempotency check for ${eventId}: isNew=${isNew}`);
    if (!isNew) return { received: true };
    // Queue webhook for async processing
    this.logger.debug(`Adding job to queue ${queue} with eventId: ${eventId}`);
    await this.queueService.add(
      queue,
      'process-webhook-event',
      { payload, webhookId },
      {
        jobId: `webhook-${eventId}`,
        attempts: backoff_retries,
        backoff: {
          type: BackoffTypes.EXPONENTIAL as BackoffType,
          delay: 60000,
        },
      },
    );
    this.logger.log(`Successfully queued webhook event: ${eventId}`);

    return { received: true };
  }

  @Post('paystack')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Body() payload: PaystackWebhookEvent,
    @Req() req: any,
  ) {
    if (!signature) return { received: true };

    // Verify signature using raw body when available
    const rawBody = req?.rawBody
      ? req.rawBody.toString()
      : JSON.stringify(payload);

    // Verify Paystack signature
    const isValid = this.paystackService.verifyWebhookSignature(
      signature,
      rawBody,
    );
    if (!isValid) {
      throw new BadRequestException('Invalid Paystack signature');
    }

    const eventId = `${payload.event}_${payload.data.id}`;

    // === IDEMPOTENCY ===
    // Keep provider webhook request handling async after signature validation;
    // workers perform any domain lookups needed to apply the event.
    const { isNew, webhookId } = await this.idempotencyService.ensureUnique(
      eventId,
      Providers.PAYSTACK,
      payload.event,
      payload,
      undefined,
    );
    if (!isNew) return { received: true };

    // === QUEUE WEBHOOK ===
    await this.queueService.add(
      QueueName.PAYSTACK,
      'process-webhook-event',
      { payload, webhookId },
      {
        jobId: `paystack-webhook-${eventId}`,
        attempts: backoff_retries,
        backoff: {
          type: BackoffTypes.EXPONENTIAL as BackoffType,
          delay: 60000,
        },
      },
    );

    return { received: true };
  }

  @Post('xpresspay')
  @HttpCode(200)
  async handleXpresspayWebhook(@Body() payload: any) {
    const merchantId = Number(
      this.configService.get<string>('XPRESSPAY_MERCHANT_ID', '0'),
    );
    if (!payload || Number(payload.Merchant) !== merchantId)
      return { received: true };
    const providerReference =
      payload.TransactionId || payload.TransactionReference || payload.Id;
    if (!providerReference) return { received: true };
    const providerStatus = payload.Status || 'unknown';
    const providerOutcome =
      payload.IsSuccessful === true ? 'success' : 'not_success';
    const eventId = `xpresspay_${providerReference}_${providerStatus}_${providerOutcome}`;
    const { isNew, webhookId } = await this.idempotencyService.ensureUnique(
      eventId,
      Providers.XPRESSPAY,
      'xpresspay.webhook',
      payload,
      undefined,
    );
    if (!isNew) return { received: true };

    await this.queueService.add(
      QueueName.XPRESSPAY,
      'process-webhook-event',
      { payload, webhookId },
      {
        jobId: `xpresspay-webhook-${eventId}`,
        attempts: backoff_retries,
        backoff: {
          type: BackoffTypes.EXPONENTIAL as BackoffType,
          delay: 60000,
        },
      },
    );
    return { received: true };
  }
}
