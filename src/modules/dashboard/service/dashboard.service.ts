// src/modules/dashboard/dashboard.service.ts

import { Injectable } from '@nestjs/common';
import { DashboardStatsService } from './dashboard-stats.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly statsService: DashboardStatsService,
  ) {}

  async getDashboardStats() {
    return await this.statsService.getCachedStats();
  }
}