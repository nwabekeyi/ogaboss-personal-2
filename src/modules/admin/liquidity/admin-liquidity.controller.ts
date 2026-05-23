import { Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../common';
import { VersionedController, RequirePermissions } from '../../../core/decorators';
import { AdminRolesGuard } from '../../../core/guards';
import { Permission } from '../../../infrastructure';
import { apiTags } from '../../../shared';
import { AdminLiquidityService } from './admin-liquidity.service';

@ApiTags('Admin - Liquidity')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.adminLiquidity)
@UseGuards(AuthGuard, AdminRolesGuard)
export class AdminLiquidityController {
  constructor(private readonly adminLiquidityService: AdminLiquidityService) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] Get all company liquidity' })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async getAllCompanyLiquidity() {
    return this.adminLiquidityService.getAllCompanyLiquidity();
  }

  @Get('failed/list')
  @ApiOperation({ summary: '[ADMIN] Get failed company liquidity records' })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async getFailedCompanyLiquidity(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.adminLiquidityService.getFailedCompanyLiquidity(limit ?? 100);
  }

  @Post('failed/:id/restart')
  @ApiOperation({ summary: '[ADMIN] Restart failed company liquidity record' })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async restartFailedCompanyLiquidity(@Param('id') id: string) {
    return this.adminLiquidityService.restartFailedCompanyLiquidity(id);
  }

  @Get(':currency')
  @ApiOperation({ summary: '[ADMIN] Get company liquidity by currency' })
  @RequirePermissions(Permission.ACCESS_TRANSACTION_HISTORY)
  async getCompanyLiquidityByCurrency(@Param('currency') currency: string) {
    return this.adminLiquidityService.getCompanyLiquidityByCurrency(currency);
  }
}
