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
import { AutoStackingSettingsService } from '../services/auto-stacking-settings.service';
import {
  UpdateAutoStackingSettingsDto,
  CreateAutoStackingTransactionFeeDto,
  UpdateAutoStackingTransactionFeeDto,
  BulkAutoStackingTransactionFeesDto,
} from '../../dto/auto-stacking-settings.dto';
import { apiTags } from '../../../../shared';
import { RequirePermissions } from '../../../../core/decorators';
import { Permission } from '../../../../infrastructure';
import { AuditLog, AuditAction, AuditResource } from '../../../../core/audit';

@ApiTags('Admin - Auto Stacking Settings')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.autoStacking)
export class AutoStackingSettingsController {
  constructor(private readonly service: AutoStackingSettingsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get auto stacking settings' })
  @ApiResponse({
    status: 200,
    description: 'Settings retrieved successfully',
  })
  async getSettings() {
    return this.service.getSettings();
  }

  @Patch()
  @AuditLog({
    action: AuditAction.ADMIN_UPDATE_AUTO_STACKING_SETTINGS,
    resource: AuditResource.ADMIN_AUTO_STACKING,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Update auto stacking settings' })
  @ApiBody({ type: UpdateAutoStackingSettingsDto })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
  })
  async updateSettings(
    @Body() dto: UpdateAutoStackingSettingsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateSettings(dto);
  }

  @Post('transaction-fees')
  @AuditLog({
    action: AuditAction.ADMIN_CREATE_AUTO_STACKING_TRANSACTION_FEE,
    resource: AuditResource.ADMIN_AUTO_STACKING,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Create a transaction fee range' })
  @ApiBody({ type: CreateAutoStackingTransactionFeeDto })
  @ApiResponse({
    status: 201,
    description: 'Transaction fee created successfully',
  })
  async createTransactionFee(
    @Body() dto: CreateAutoStackingTransactionFeeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createTransactionFee(dto);
  }

  @Patch('transaction-fees/:feeId')
  @AuditLog({
    action: AuditAction.ADMIN_UPDATE_AUTO_STACKING_TRANSACTION_FEE,
    resource: AuditResource.ADMIN_AUTO_STACKING,
    resourceIdPath: 'params.feeId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Update a transaction fee range' })
  @ApiParam({ name: 'feeId', description: 'ID of the transaction fee' })
  @ApiBody({ type: UpdateAutoStackingTransactionFeeDto })
  @ApiResponse({
    status: 200,
    description: 'Transaction fee updated successfully',
  })
  async updateTransactionFee(
    @Param('feeId') feeId: string,
    @Body() dto: UpdateAutoStackingTransactionFeeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateTransactionFee(feeId, dto);
  }

  @Delete('transaction-fees/:feeId')
  @AuditLog({
    action: AuditAction.ADMIN_DELETE_AUTO_STACKING_TRANSACTION_FEE,
    resource: AuditResource.ADMIN_AUTO_STACKING,
    resourceIdPath: 'params.feeId',
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Delete a transaction fee range' })
  @ApiParam({ name: 'feeId', description: 'ID of the transaction fee' })
  @ApiResponse({
    status: 200,
    description: 'Transaction fee deleted successfully',
  })
  async deleteTransactionFee(@Param('feeId') feeId: string) {
    return this.service.deleteTransactionFee(feeId);
  }

  @Post('transaction-fees/bulk')
  @AuditLog({
    action: AuditAction.ADMIN_BULK_CREATE_AUTO_STACKING_TRANSACTION_FEES,
    resource: AuditResource.ADMIN_AUTO_STACKING,
  })
  @UseGuards(AuthGuard, AdminRolesGuard)
  @RequirePermissions(Permission.CURRENCY_MANAGEMENT)
  @ApiOperation({ summary: '[ADMIN] Bulk create transaction fee ranges' })
  @ApiBody({ type: BulkAutoStackingTransactionFeesDto })
  @ApiResponse({
    status: 201,
    description: 'Bulk create processed',
  })
  async bulkCreateTransactionFees(
    @Body() dto: BulkAutoStackingTransactionFeesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.bulkCreateTransactionFees(dto);
  }
}
