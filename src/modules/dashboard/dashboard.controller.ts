import {
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { DashboardService } from './service/dashboard.service';
import {
  ApiBearerAuth,
  ApiResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { apiTags } from '../../shared';
import { HttpExceptionInterceptor } from '../../core';
import { AuthGuard } from '../../core/guards/auth.guard';
import { VersionedController } from '../../core/decorators';
import { AdminRolesGuard } from '../../core/guards/admin.role.guard';

@ApiTags("Admin Dashboard Home")
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.dashboard)
@UseInterceptors(HttpExceptionInterceptor)
@UseGuards(AuthGuard, AdminRolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('/admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get real-time admin dashboard stats (cached)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Precomputed dashboard stats from Redis',
    schema: {
      example: {
        totalTransactionValue: {
          amount: 0,
          dailyCount: 0
        },
        totalTransactionVolume: {
          count: 0,
          dailyCount: 0
        },
        totalUsers: {
          count: 0,
          currentMonth: 0
        },
        recentTransactions: [
          {
            id: 'txn_123abc',
            accountName: 'John Doe',
            date: '2026-01-03T07:50:00.000Z',
            status: 'COMPLETED',
            cryptoAmount: '0.005',
            fiatAmount: '2000',
            cryptocurrency: 'BTC',
            walletAddress: '1FfmbHfnpaZjKFvyi1okTjJJusN455paPH'
          }
        ],
        updatedAt: new Date().toISOString()
      }
    }
  })
  async getDashboardStats() {
    return this.dashboardService.getDashboardStats();
  }
}