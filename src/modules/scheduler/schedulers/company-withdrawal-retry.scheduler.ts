import { Injectable, Logger } from '@nestjs/common';
import { Cron} from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { QuidaxWithdrawalService } from '../../../infrastructure/providers/quidax/withdrawal.service';
import { WithdrawalWebhookHandler } from '../../webhook/quidax/handlers/withdrawal.handler';
import { WebhookIdempotencyService } from '../../webhook/service/webhook-idempotency.service';
import { TempStoreService } from '../../../infrastructure';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { QueueName } from '../../../infrastructure/bullMQ/types';
import { SchedulerExecutionStateService } from '../scheduler-execution-state.service';

const COMPANY_WITHDRAWAL_RETRY_LOCK_KEY =
  'lock:company-withdrawal-retry-scheduler';
const COMPANY_WITHDRAWAL_RETRY_LOCK_TTL = 600; // 10 minutes

@Injectable()
export class CompanyWithdrawalRetryScheduler {
  private readonly logger = new Logger(CompanyWithdrawalRetryScheduler.name);
  private readonly JOB_NAME = 'scheduler.company-withdrawal-retry';

  constructor(
    private readonly prisma: PrismaService,
    private readonly quidaxWithdrawalService: QuidaxWithdrawalService,
    private readonly withdrawalHandler: WithdrawalWebhookHandler,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
    private readonly tempStore: TempStoreService,
    private readonly queueService: QueueService,
    private readonly schedulerState: SchedulerExecutionStateService,
  ) {}

  @Cron('45 1 * * *') // Staggered: 01:45
  async retryFailedCompanyWithdrawals() {
    try {
      await this.queueService.add(QueueName.CLEANUP, this.JOB_NAME, {}, { jobId: `${this.JOB_NAME}-${new Date().toISOString().slice(0,13)}` });
      return;
    } catch {}
    return this.execute();
  }

  async execute() {
    const now = new Date();
    if (!(await this.schedulerState.isDue(this.JOB_NAME, now))) return;
    // Acquire distributed lock to prevent overlapping runs
    const lockAcquired = await this.tempStore.setNx(
      COMPANY_WITHDRAWAL_RETRY_LOCK_KEY,
      'locked',
      COMPANY_WITHDRAWAL_RETRY_LOCK_TTL,
    );
    if (!lockAcquired) {
      this.logger.debug(
        'Company withdrawal retry already running in another instance — skipping',
      );
      return;
    }

    try {
      // Get unprocessed webhooks from the webhook table (isProcessed = false)
      const unprocessedWebhooks =
        await this.webhookIdempotencyService.getUnprocessedWebhooks();

      // Filter for withdrawal events only
      const withdrawalWebhooks = unprocessedWebhooks.filter(
        (w) =>
          w.eventType === 'withdraw.successful' ||
          w.eventType === 'withdraw.rejected',
      );

      if (withdrawalWebhooks.length === 0) return;

      this.logger.log(
        `Found ${withdrawalWebhooks.length} unprocessed withdrawal webhooks to check`,
      );

      let retried = 0;
      let skipped = 0;

      for (const webhook of withdrawalWebhooks) {
        const reference = webhook.payload?.data?.reference;
        if (!reference) {
          this.logger.warn(
            `Webhook ${webhook.id} has no reference, marking processed`,
          );
          await this.webhookIdempotencyService.markProcessed(webhook.id);
          skipped++;
          continue;
        }

        // Check if this reference belongs to a company withdrawal (in-app transaction)
        const companyWithdrawal =
          await this.prisma.companyWithdrawal.findUnique({
            where: { providerReference: reference },
          });

        if (!companyWithdrawal) {
          // Not a company withdrawal — could be external or a user withdrawal.
          // User withdrawal webhooks are handled by the regular retry scheduler.
          // Skip it here.
          skipped++;
          continue;
        }

        // This is an in-app company withdrawal (sweep). Check Quidax status.
        try {
          const confirmation =
            await this.quidaxWithdrawalService.getWithdrawerByReference(
              {
                user_id: 'me',
                reference,
              },
              { skipCircuitBreaker: true },
            );

          if (confirmation?.data?.status === 'Done') {
            await this.withdrawalHandler.process(
              webhook.eventType,
              webhook.payload.data,
            );
            retried++;
            this.logger.log(
              `Successfully retried company withdrawal for reference: ${reference}`,
            );
          } else {
            this.logger.debug(
              `Company withdrawal ${reference} not yet Done on Quidax (status: ${confirmation?.data?.status}), skipping`,
            );
            skipped++;
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to retry company withdrawal ${reference}: ${error?.message}`,
          );
        }

        // Mark as processed regardless of outcome to prevent infinite retries
        await this.webhookIdempotencyService.markProcessed(webhook.id);
      }

      if (retried > 0 || skipped > 0) {
        this.logger.log(
          `Company withdrawal retry complete: ${retried} succeeded, ${skipped} skipped`,
        );
      }
      await this.schedulerState.markExecuted(
        this.JOB_NAME,
        now,
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
      );
    } finally {
      await this.tempStore.del(COMPANY_WITHDRAWAL_RETRY_LOCK_KEY);
    }
  }
}
