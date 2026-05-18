import {
  Controller,
  Get,
  Patch,
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
import { AccountService } from './account.service';
import { UpdatePersonalInfoDto } from '../dto';
import { AuthGuard, AdminRolesGuard } from '../../../common';
import { Permission } from '../../../infrastructure';
import { AuthenticatedRequest } from '../../../common/types';
import { VersionedController } from '../../../core/decorators';
import { RequirePermissions } from '../../../core/decorators';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Admin - Account Management')
@ApiBearerAuth('Bearer')
@VersionedController('admin/accounts')
@UseGuards(AuthGuard, AdminRolesGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  // === GET USER ACCOUNT INFO ===
  @Get(':id')
  @ApiOperation({ summary: '[ADMIN] Get user account personal information' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User account info retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          userId: 'usr_123456',
          accountName: 'John Doe',
          email: 'john.doe@example.com',
          phoneNumber: '+2348012345678',
          country: 'Nigeria',
          residentialAddress: 'Lekki Phase 1, Lagos',
          joinedDate: '2024-08-15',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User not found',
        error: 'Not Found',
      },
    },
  })
  async getAccountInfo(@Param('id') id: string) {
    return this.accountService.getAccountInfo(id);
  }

  // === UPDATE USER PERSONAL INFO ===
  @Patch(':id/personal-info')
  @RequirePermissions(Permission.EDIT_USER_ACCOUNT)
  @AuditLog({
    action: AuditAction.ADMIN_UPDATE_PERSONAL_INFO,
    resource: AuditResource.ADMIN_USER_MANAGEMENT,
    resourceIdPath: 'params.id',
  })
  @ApiOperation({ summary: '[ADMIN] Update user personal information' })
  @ApiParam({ name: 'id', description: 'User ID to update' })
  @ApiBody({ type: UpdatePersonalInfoDto })
  @ApiResponse({
    status: 200,
    description: 'Personal info updated successfully',
  })
  async updatePersonalInfo(
    @Req() req: AuthenticatedRequest,
    @Param('id') userId: string,
    @Body() dto: UpdatePersonalInfoDto,
  ) {
    const adminId = req.user.id;
    return this.accountService.updatePersonalInfo(adminId, userId, dto);
  }
}
