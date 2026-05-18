import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../../infrastructure/bullMQ/bullmq.service';
import {
  QueueName,
  DashboardStatsJobType,
  TransactionUpdatePayload,
  UserUpdatePayload,
} from '../../infrastructure/bullMQ';
import { TransactionStatus } from '../../infrastructure';

@Injectable()
export class DashboardStatsQueueService {
  private readonly logger = new Logger(DashboardStatsQueueService.name);

  constructor(private readonly queueService: QueueService) {}

  /**
   * Queue a transaction update when it becomes COMPLETED
   */
  async queueTransactionUpdate(payload: TransactionUpdatePayload) {
    if (payload.status !== TransactionStatus.COMPLETED) {
      return;
    }

    try {
      await this.queueService.add(
        QueueName.DASHBOARD_STATS,
        DashboardStatsJobType.UPDATE_FROM_TRANSACTION,
        payload,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (err) {
      this.logger.error('Failed to queue transaction update', err);
    }
  }

  /**
   * Queue a user count update (create, activate, deactivate)
   */
  async queueUserUpdate(payload: UserUpdatePayload) {
    try {
      await this.queueService.add(
        QueueName.DASHBOARD_STATS,
        DashboardStatsJobType.UPDATE_USERS,
        payload,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.debug(`Queued user update: added=${payload.added}`);
    } catch (err) {
      this.logger.error('Failed to queue user update', err);
    }
  }

  /**
   * Manually trigger full dashboard rebuild
   */
  async queueFullRebuild() {
    try {
      await this.queueService.add(
        QueueName.DASHBOARD_STATS,
        DashboardStatsJobType.REBUILD_FULL,
        {},
        {
          jobId: 'dashboard-full-rebuild',
          attempts: 10,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log('Queued full dashboard stats rebuild');
    } catch (err) {
      this.logger.error('Failed to queue full rebuild', err);
    }
  }
}