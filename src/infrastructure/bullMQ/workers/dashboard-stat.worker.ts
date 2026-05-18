// src/infrastructure/bullmq/workers/dashboard-stats.worker.ts

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  QueueName,
  DashboardStatsJobType,
  TransactionUpdatePayload,
  UserUpdatePayload,
} from '../types';
import { DashboardStatsService } from '../../../modules/dashboard/service/dashboard-stats.service';
import { Logger } from '@nestjs/common';

@Processor(QueueName.DASHBOARD_STATS, { concurrency: 5 })
export class DashboardStatsWorker extends WorkerHost {
  private readonly logger = new Logger(DashboardStatsWorker.name);

  constructor(private readonly dashboardStatsService: DashboardStatsService) {
    super();
  }

  async process(job: Job<any>): Promise<void> {
    switch (job.name) {
      case DashboardStatsJobType.UPDATE_FROM_TRANSACTION:
        await this.dashboardStatsService.handleTransactionUpdate(job.data as TransactionUpdatePayload);
        break;

      case DashboardStatsJobType.UPDATE_USERS:
        await this.dashboardStatsService.handleUserUpdate(job.data as UserUpdatePayload);
        break;

      case DashboardStatsJobType.REBUILD_FULL:
        await this.dashboardStatsService.computeAndCacheStats();
        break;

      default:
        throw new Error(`Unhandled job: ${job.name}`);
    }
  }
}