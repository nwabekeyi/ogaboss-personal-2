// src/modules/dashboard/dashboard.module.ts

import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './service/dashboard.service';
import { DashboardStatsService } from './service/dashboard-stats.service';
import { JwtService } from '@nestjs/jwt';
import { DashboardStatsQueueService } from './dashboard-stats-queue';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DashboardStatsService,
    DashboardStatsQueueService ,
    JwtService
  ],
  exports: [
    DashboardService,
    DashboardStatsService,
    DashboardStatsQueueService
  ],
})
export class DashboardModule {}