// src/infrastructure/scheduler/schedulers/dashboard.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DashboardStatsService } from '../../dashboard/service/dashboard-stats.service';
import { AdminRoleCacheService } from '../../../infrastructure/databases/redis/adminRoleCache.service';
import { RolesCacheService } from '../../../infrastructure/databases/redis/roleCache.service';
import { isDedicatedSchedulerRuntime } from '../scheduler-runtime.util';

@Injectable()
export class DashboardScheduler {
  private readonly logger = new Logger(DashboardScheduler.name);

  constructor(
    private readonly dashboardService: DashboardStatsService,
    private readonly adminRoleCacheService: AdminRoleCacheService,
    private readonly rolesCacheService: RolesCacheService,
  ) {}

  // Runs every day at 5 AM (staggered from midnight cluster)
  @Cron('0 5 * * *')
  async recomputeDashboardDaily() {
    if (!isDedicatedSchedulerRuntime()) return;
    await this.dashboardService.computeAndCacheStats();
    await this.adminRoleCacheService.cacheAllAdminRoles();
    await this.rolesCacheService.refreshAllRolesCache();
  }
}