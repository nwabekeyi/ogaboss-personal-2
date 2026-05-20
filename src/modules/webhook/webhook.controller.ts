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
import { UserService } from '../auth/users/users.service';
import { apiTags } from '../../shared';
import { VersionedController } from '../../core/decorators';
import { PaystackService } from '../../infrastructure/providers/paystack';
import { PaystackWebhookEvent } from '../../infrastructure/providers/paystack/type';
import { BaseQuidaxService } from '../../infrastructure/providers/quidax/base-quidax.service';
import { QueueService } from '../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../infrastructure/bullMQ';
import { PrismaService } from '../../infrastructure';
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
    private readonly usersService: UserService,
    private readonly prismaService: PrismaService,
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

  /**
   * Resolves the local user ID from a Quidax webhook payload.
   * Uses the same quidaxAccountId extraction logic as the handlers
   * (data.wallet?.user?.id || data.user?.id).
   */
  private async resolveQuidaxUserId(payload: any): Promise<string | undefined> {
    const quidaxAccountId =
      payload.data?.wallet?.user?.id || payload.data?.user?.id;
    if (!quidaxAccountId) return undefined;
    const user = await this.prismaService.user.findFirst({
      where: { quidaxAccountId },
      select: { id: true },
    });
    return user?.id;
  }

  private getUserIdFromPaystackPayload(
    payload: PaystackWebhookEvent,
  ): string | undefined {
    return payload.data.customer?.email;
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
    if (!signature) return { received: true };

    // Verify signature using raw body when available
    const rawBody = req?.rawBody
      ? req.rawBody.toString()
      : JSON.stringify(payload);

    try {
      this.baseQuidaxService.verifyWebhookSignature(rawBody, signature);
    } catch (error) {
      // Invalid signature - return 200 to stop retries but log the error
      this.logger.error(
        `Quidax signature verification failed: ${error.message}`,
      );
      return { received: true };
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
    const data = payload.data;

    // Resolve user early for events that need user validation or userId.
    // This is the single user lookup — used for both app-transaction filtering
    // and webhook idempotency, eliminating a duplicate DB query.
    let userId: string | undefined;
    if (event.startsWith('deposit.') || event === 'wallet.address.generated') {
      userId = await this.resolveQuidaxUserId(payload);
      if (!userId) {
        this.logger.debug(`Skipping webhook: no local user for event ${event}`);
        return { received: true };
      }
    }

    // Non-user events: check if the referenced record exists in our DB.
    // External transactions on the company main account should not be saved.
    if (event === 'order.done') {
      const order = await this.prismaService.order.findFirst({
        where: { referenceNo: data.reference },
        select: { id: true },
      });
      if (!order) {
        this.logger.debug(
          `Skipping external webhook: ${event} (no matching order)`,
        );
        return { received: true };
      }
    } else if (event.startsWith('swap_transaction.')) {
      const swap = await this.prismaService.swapTransaction.findFirst({
        where: { swapId: data.id },
        select: { id: true },
      });
      if (!swap) {
        this.logger.debug(
          `Skipping external webhook: ${event} (no matching swap)`,
        );
        return { received: true };
      }
    } else if (event.startsWith('withdraw.')) {
      const withdrawal = await this.prismaService.withdrawal.findFirst({
        where: { reference: data.reference },
        select: { id: true },
      });
      if (!withdrawal) {
        const companyWithdrawal =
          await this.prismaService.companyWithdrawal.findUnique({
            where: { providerReference: data.reference },
            select: { id: true },
          });
        if (!companyWithdrawal) {
          this.logger.debug(
            `Skipping external webhook: ${event} (no matching withdrawal)`,
          );
          return { received: true };
        }
      }
    }

    this.logger.debug(
      `Resolved userId for event ${eventId}: ${userId || 'not found'}`,
    );

    // Reusable idempotency check
    const { isNew, webhookId } = await this.idempotencyService.ensureUnique(
      eventId,
      Providers.QUIDAX,
      payload.event,
      payload,
      userId,
    );
    this.logger.debug(`Idempotency check for ${eventId}: isNew=${isNew}`);
    if (!isNew) return { received: true };
    this.logger.debug(`Resolved queue for event ${payload.event}: testing`);

    const queue = this.resolveQuidaxQueue(payload.event);
    this.logger.debug(`Resolved queue for event ${payload.event}: ${queue}`);
    if (!queue) {
      this.logger.warn(`No queue found for event: ${payload.event}`);
      return { received: true };
    }

    // Queue webhook for async processing
    this.logger.debug(`Adding job to queue ${queue} with eventId: ${eventId}`);
    await this.queueService.add(
      queue,
      'process-webhook-event',
      { payload, webhookId },
      {
        jobId: `webhook-${eventId}`,
        attempts: backoff_retries,
        backoff: { type: BackoffTypes.EXPONENTIAL as BackoffType, delay: 60000 },
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

    const userEmail = this.getUserIdFromPaystackPayload(payload);
    let userId: string | undefined;
    if (userEmail) {
      const user = await this.usersService.findUserByEmail(userEmail);
      userId = user?.id;
    }

    // === IDEMPOTENCY ===
    const { isNew, webhookId } = await this.idempotencyService.ensureUnique(
      eventId,
      Providers.PAYSTACK,
      payload.event,
      payload,
      userId,
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
        backoff: { type: BackoffTypes.EXPONENTIAL as BackoffType, delay: 60000 },
      },
    );

    return { received: true };
  }
}


  @Post('xpresspay')
  @HttpCode(200)
  async handleXpresspayWebhook(@Body() payload: any) {
    const merchantId = Number(this.configService.get<string>('XPRESSPAY_MERCHANT_ID', '0'));
    if (!payload || Number(payload.Merchant) !== merchantId) return { received: true };
    const eventId = `xpresspay_${payload.TransactionId || payload.TransactionReference || payload.Id}`;
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
      { jobId: `xpresspay-webhook-${eventId}`, attempts: backoff_retries, backoff: { type: BackoffTypes.EXPONENTIAL as BackoffType, delay: 60000 } },
    );
    return { received: true };
  }
