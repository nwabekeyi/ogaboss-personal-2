import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job, JobsOptions } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import {
  QueueName,
  EmailJobPayload,
  EmailJobType,
  PushJobPayload,
} from './types';


@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QueueName.EMAIL) private emailQueue: Queue,
    @InjectQueue(QueueName.PUSH) private pushQueue: Queue,
    @InjectQueue(QueueName.QUIDAX_ACCOUNT) private quidaxQueue: Queue,
    @InjectQueue(QueueName.SWAP) private swapQueue: Queue,
    @InjectQueue(QueueName.ORDERS) private ordersQueue: Queue,
    @InjectQueue(QueueName.SEND) private sendQueue: Queue,
    @InjectQueue(QueueName.RECEIVE) private receiveQueue: Queue,
    @InjectQueue(QueueName.REPORT) private reportQueue: Queue,
    @InjectQueue(QueueName.CLEANUP) private cleanupQueue: Queue,
    @InjectQueue(QueueName.DASHBOARD_STATS) private dashboardStatsQueue: Queue,
    @InjectQueue(QueueName.PAYSTACK) private paystackQueue: Queue,
    @InjectQueue(QueueName.QUIDAX_WALLET) private walletAddressQueue: Queue,
  ) {}

  private readonly defaultJobOptions: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000, jitter:0.5 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  };


  private sanitizeJobId(jobId: string): string {
    if (!jobId.includes(':')) return jobId;

    const sanitized = jobId.replace(/:/g, '-');
    this.logger.warn(`Sanitized BullMQ jobId to remove invalid ":" characters | original: ${jobId} | sanitized: ${sanitized}`);
    return sanitized;
  }

  private getQueue(name: QueueName): Queue {
    switch (name) {
      case QueueName.EMAIL:
        return this.emailQueue;
      case QueueName.PUSH:
        return this.pushQueue;
      case QueueName.QUIDAX_ACCOUNT:
        return this.quidaxQueue;
      case QueueName.QUIDAX_WALLET:
        return this.walletAddressQueue;
      case QueueName.SWAP:
        return this.swapQueue;
      case QueueName.ORDERS:
        return this.ordersQueue;
      case QueueName.SEND:
        return this.sendQueue;
      case QueueName.RECEIVE:
        return this.receiveQueue;
      case QueueName.REPORT:
        return this.reportQueue;
      case QueueName.CLEANUP:
        return this.cleanupQueue;
      case QueueName.DASHBOARD_STATS:
        return this.dashboardStatsQueue;
      case QueueName.PAYSTACK:
        return this.paystackQueue;
      default:
        this.logger.error(`Unknown queue: ${name}`);
        throw new Error(`Unknown queue`);
    }
  }

  async add<T = any>(
    queueName: QueueName,
    jobName: string,
    data: T,
    opts: JobsOptions = {},
  ): Promise<Job<T>> {
    try {

      const queue = this.getQueue(queueName);
      const jobId = this.sanitizeJobId(String(opts.jobId ?? uuidv4()));
      
      const jobOptions: JobsOptions = {
        ...this.defaultJobOptions,
        ...opts,
        jobId,
      };
      
      const job = await queue.add(jobName, data, jobOptions);
      this.logger.log(`Added job to ${queueName} queue`, job.id);
      return job;
    } catch (error) {
      this.logger.error(`Error adding job to ${queueName} queue`, error);
      throw error;
    }
  }

  async addBatch(
    queueName: QueueName,
    jobs: Array<{ name: string; data: any; opts?: JobsOptions }>,
  ): Promise<Job[]> {
    try {

      const queue = this.getQueue(queueName);
      const addedJobs: Job[] = [];
      
      for (const job of jobs) {
        const jobId = this.sanitizeJobId(String(job.opts?.jobId ?? uuidv4()));
        const jobOptions: JobsOptions = {
          ...this.defaultJobOptions,
          ...job.opts,
          jobId,
        };
        const added = await queue.add(job.name, job.data, jobOptions);
        addedJobs.push(added);
      }
      
      this.logger.log(`Added ${addedJobs.length} jobs to ${queueName} queue`);
      return addedJobs;
    } catch (error) {
      this.logger.error(`Error adding batch to ${queueName} queue`, error);
      throw error;
    }
  }

  // EMAIL
  async sendTransactionalEmail(type: EmailJobType, payload: EmailJobPayload) {
    await this.add(
      QueueName.EMAIL,
      'send-transactional-email',
      { type, payload },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  // PUSH NOTIFICATIONS
  async sendPushNotification(payload: PushJobPayload): Promise<boolean> {
    if (!payload.userId) {
      this.logger.warn('Cannot send push notification: userId is required');
      return false;
    }

    await this.add(QueueName.PUSH, 'send-push-notification', payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return true;
  }

  async sendPushNotificationBatch(payloads: PushJobPayload[]): Promise<{
    success: number;
    failed: number;
  }> {
    let successCount = 0;
    let failedCount = 0;

    for (const payload of payloads) {
      try {
        await this.sendPushNotification(payload);
        successCount++;
      } catch {
        failedCount++;
      }
    }

    return { success: successCount, failed: failedCount };
  }

  async sendAdminPasswordResetEmail(payload: {
    to: string;
    firstName?: string;
    resetLink: string;
  }) {
    await this.sendTransactionalEmail(
      EmailJobType.ADMIN_PASSWORD_RESET,
      payload,
    );
  }

  // QUIDAX ONBOARDING
  async createQuidaxSubaccount(
    data: {
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
    },
    opts?: JobsOptions,
  ) {
    return this.add(
      QueueName.QUIDAX_ACCOUNT,
      'create-quidax-subaccount',
      data,
      {
        attempts: 10,
        backoff: { type: 'exponential', delay: 7000 },
        removeOnComplete: true,
        removeOnFail: 100,
        jobId: `quidax-onboarding-${data.userId}`,
        ...opts,
      },
    );
  }
}
