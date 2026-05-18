import {
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard, AdminRolesGuard } from '../../../../common';
import { VersionedController } from '../../../../core/decorators';
import { AuthenticatedRequest } from '../../../../common/types';
import { UrgentLiquiditySettingsService } from '../services/urgent-liquidity-settings.service';
import {
  UpdateUrgentLiquiditySettingsDto,
  CreateRepaymentRangeDto,
  UpdateRepaymentRangeDto,
  BulkRepaymentRangesDto,
} from '../../dto/urgent-liquidity-settings.dto';
import { apiTags } from '../../../../shared';
import { RequirePermissions } from '../../../../core/decorators';
import { Permission } from '../../../../infrastructure';
import { AuditLog, AuditAction, AuditResource } from '../../../../core/audit';

@ApiTags('Admin - Urgent Liquidity Settings')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.urgentLiquidity)
export class UrgentLiquiditySettingsController {
  constructor(private readonly service: UrgentLiquiditySettingsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get urgent liquidity settings' })
  @ApiResponse({
    status: 200,
    description: 'Settings retrieved successfully',
  })
  async getSettings() {
    return this.service.getSettings();
  }

  @Patch()
  @AuditLog({
    action: AuditAction.ADMIN_UPDATE_URGENT_LIQUIDITY_SETTINGS,
    resource: AuditResource.ADMIN_URGENT_LIQUIDITY,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Update urgent liquidity settings' })
  @ApiBody({ type: UpdateUrgentLiquiditySettingsDto })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
  })
  async updateSettings(
    @Body() dto: UpdateUrgentLiquiditySettingsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateSettings(dto);
  }

  @Post('repayment-ranges')
  @AuditLog({
    action: AuditAction.ADMIN_CREATE_REPAYMENT_RANGE,
    resource: AuditResource.ADMIN_URGENT_LIQUIDITY,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Create a repayment range' })
  @ApiBody({ type: CreateRepaymentRangeDto })
  @ApiResponse({
    status: 201,
    description: 'Repayment range created successfully',
  })
  async createRepaymentRange(
    @Body() dto: CreateRepaymentRangeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createRepaymentRange(dto);
  }

  @Get('repayment-ranges/:rangeId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '[ADMIN] Get a repayment range by ID' })
  @ApiParam({ name: 'rangeId', description: 'ID of the repayment range' })
  @ApiResponse({
    status: 200,
    description: 'Repayment range retrieved successfully',
  })
  async getRepaymentRange(@Param('rangeId') rangeId: string) {
    return this.service.getRepaymentRange(rangeId);
  }

  @Patch('repayment-ranges/:rangeId')
  @AuditLog({
    action: AuditAction.ADMIN_UPDATE_REPAYMENT_RANGE,
    resource: AuditResource.ADMIN_URGENT_LIQUIDITY,
    resourceIdPath: 'params.rangeId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Update a repayment range' })
  @ApiParam({ name: 'rangeId', description: 'ID of the repayment range' })
  @ApiBody({ type: UpdateRepaymentRangeDto })
  @ApiResponse({
    status: 200,
    description: 'Repayment range updated successfully',
  })
  async updateRepaymentRange(
    @Param('rangeId') rangeId: string,
    @Body() dto: UpdateRepaymentRangeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateRepaymentRange(rangeId, dto);
  }

  @Post('repayment-ranges/bulk')
  @AuditLog({
    action: AuditAction.ADMIN_BULK_CREATE_REPAYMENT_RANGES,
    resource: AuditResource.ADMIN_URGENT_LIQUIDITY,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Bulk create repayment ranges' })
  @ApiBody({ type: BulkRepaymentRangesDto })
  @ApiResponse({
    status: 201,
    description: 'Bulk create processed',
  })
  async bulkCreateRepaymentRanges(
    @Body() dto: BulkRepaymentRangesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.bulkCreateRepaymentRanges(dto);
  }

  @Delete('repayment-ranges/:rangeId')
  @AuditLog({
    action: AuditAction.ADMIN_DELETE_REPAYMENT_RANGE,
    resource: AuditResource.ADMIN_URGENT_LIQUIDITY,
    resourceIdPath: 'params.rangeId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Delete a repayment range' })
  @ApiParam({ name: 'rangeId', description: 'ID of the repayment range' })
  @ApiResponse({
    status: 200,
    description: 'Repayment range deleted successfully',
  })
  async deleteRepaymentRange(
    @Param('rangeId') rangeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.deleteRepaymentRange(rangeId);
  }
}
