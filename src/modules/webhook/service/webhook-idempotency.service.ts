// src/infrastructure/webhooks/webhook-idempotency.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';
import { WebhookStatus } from '../../../infrastructure/databases/prisma/generated/prisma/client';

@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureUnique(
    eventId: string,
    provider: string,
    eventType: string,
    payload: Record<string, any>,
    userId?: string,
  ): Promise<{ isNew: boolean; webhookId?: string }> {
    // Pre-check: if idempotency key already exists, return early (non-blocking read)
    const existing = await this.prisma.webhook.findUnique({
      where: { idempotencyKey: eventId },
      select: { id: true },
    });

    if (existing) {
      this.logger.warn(
        `[${provider}] Duplicate webhook detected (pre-check): ${eventId}`,
      );
      return { isNew: false };
    }

    try {
      const webhook = await this.prisma.webhook.create({
        data: {
          idempotencyKey: eventId,
          provider,
          eventType,
          payload,
          userId,
          processedAt: new Date(),
        },
        select: { id: true },
      });
      this.logger.debug(
        `[${provider}] Idempotency record created for: ${eventId}`,
      );
      return { isNew: true, webhookId: webhook.id };
    } catch (error: any) {
      // Fallback: handle race condition if another process created it first
      if (error.code === 'P2002') {
        this.logger.warn(
          `[${provider}] Duplicate webhook (race condition): ${eventId}`,
        );
        return { isNew: false };
      }
      this.logger.error(
        `[${provider}] Failed to process webhook ${eventId}: ${error?.message || 'Unknown error'}`,
        error.stack,
      );
      return { isNew: false };
    }
  }

  async markProcessed(webhookId: string): Promise<void> {
    await this.prisma.webhook.update({
      where: { id: webhookId },
      data: { isProcessed: true, status: WebhookStatus.processed },
    });
  }

  async markFailed(webhookId: string, reason: string): Promise<void> {
    await this.prisma.webhook.update({
      where: { id: webhookId },
      data: {
        isProcessed: false,
        status: WebhookStatus.failed,
        failedReason: reason,
      },
    });
  }

  async getUnprocessedWebhooks(
    olderThanHours: number = 1,
    maxAgeDays: number = 7,
  ): Promise<
    Array<{
      id: string;
      provider: string;
      eventType: string;
      payload: any;
    }>
  > {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const maxAge = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    return this.prisma.webhook.findMany({
      where: {
        isProcessed: false,
        createdAt: {
          lt: cutoff,
          gte: maxAge,
        },
      },
      select: {
        id: true,
        provider: true,
        eventType: true,
        payload: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  }

  async getFailedWebhooks(options?: {
    provider?: string;
    eventType?: string;
    page?: number;
    limit?: number;
  }) {
    const { provider, eventType, page = 1, limit = 20 } = options ?? {};
    const skip = (page - 1) * limit;

    const where: any = { status: WebhookStatus.failed, isResolved: false };
    if (provider) where.provider = provider;
    if (eventType) where.eventType = eventType;

    const [webhooks, total] = await Promise.all([
      this.prisma.webhook.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.webhook.count({ where }),
    ]);

    return {
      success: true,
      data: webhooks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  async resolveWebhook(webhookId: string, resolutionComment: string) {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new Error(`Webhook ${webhookId} not found`);
    }

    if (webhook.status !== WebhookStatus.failed) {
      throw new Error(`Webhook ${webhookId} is not in failed status`);
    }

    if (webhook.isResolved) {
      throw new Error(`Webhook ${webhookId} is already resolved`);
    }

    return this.prisma.webhook.update({
      where: { id: webhookId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolutionComment,
      },
    });
  }
}
