// src/modules/settings/settings.controller.ts
import { Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';
import { AuthenticatedRequest } from '../../common/types/authenticatedRequest';
import { VersionedController } from '../../core/decorators';
import { AuthGuard } from '../../common';
import { apiTags } from '../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../core/audit';

@ApiTags('User-Settings')
@ApiBearerAuth('Bearer')
@VersionedController(apiTags.settings)
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // =====================================================
  // GET NOTIFICATION SETTINGS
  // =====================================================
  @Get('notifications')
  @ApiOperation({
    summary: 'Get notification settings',
    description: `
## Overview
Retrieves the current user's notification preferences.

## Available Settings
- **accountActivityAlert**: Alerts for login, password changes, etc.
- **transactionAlert**: Alerts for deposits, withdrawals, swaps
- **appUpdates**: Notifications about app updates and new features
- **maintenanceAlert**: Notifications about scheduled maintenance

## Default Values
All settings default to their current configured state (typically enabled for transaction alerts).
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification settings retrieved successfully',
    schema: {
      example: {
        accountActivityAlert: true,
        transactionAlert: true,
        appUpdates: false,
        maintenanceAlert: false,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getNotificationSettings(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getNotificationSettings(req.user.id);
  }

  // =====================================================
  // UPDATE NOTIFICATION SETTINGS
  // =====================================================
  @Patch('notifications')
  @AuditLog({
    action: AuditAction.USER_UPDATE_NOTIFICATION_SETTINGS,
    resource: AuditResource.USER_SETTINGS,
  })
  @ApiOperation({
    summary: 'Update notification settings',
    description: `
## Overview
Updates the current user's notification preferences.

## Available Settings
| Setting | Type | Description |
|---------|------|-------------|
| accountActivityAlert | boolean | Receive alerts for account activity (login, password changes) |
| transactionAlert | boolean | Receive alerts for all transactions (deposits, withdrawals, swaps) |
| appUpdates | boolean | Receive notifications about app updates and new features |
| maintenanceAlert | boolean | Receive notifications about scheduled maintenance |

## Important Notes
- Only provided fields are updated - others remain unchanged
- Transaction alerts are recommended to stay enabled for security
- Settings take effect immediately
    `,
  })
  @ApiBody({ type: UpdateNotificationSettingsDto })
  @ApiResponse({
    status: 200,
    description: 'Notification settings updated successfully',
    schema: {
      example: {
        message: 'Settings updated successfully',
        accountActivityAlert: true,
        transactionAlert: true,
        appUpdates: true,
        maintenanceAlert: false,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateNotificationSettings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.settingsService.updateNotificationSettings(req.user.id, dto);
  }

  // =====================================================
  // GET SECURITY SETTINGS
  // =====================================================
  @Get('security')
  @ApiOperation({
    summary: 'Get security settings',
    description: `
## Overview
Retrieves the current user security configuration.

## Available Settings
- **loginWithPin**: Whether PIN can be used for login
- **loginWithBiometric**: Whether biometric (fingerprint/face) login is enabled
- **isTwoFactorEnabled**: Whether two-factor authentication is active

## Note
Two-factor authentication status is view-only and cannot be changed via this endpoint.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Security settings retrieved successfully',
    schema: {
      example: {
        loginWithPin: true,
        loginWithBiometric: false,
        isTwoFactorEnabled: true,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getSecuritySettings(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getSecuritySettings(req.user.id);
  }

  // =====================================================
  // UPDATE SECURITY SETTINGS
  // =====================================================
  @Patch('security')
  @AuditLog({
    action: AuditAction.USER_UPDATE_SECURITY_SETTINGS,
    resource: AuditResource.USER_SECURITY,
  })
  @ApiOperation({
    summary: 'Update security settings',
    description: `
## Overview
Updates the current user security preferences.

## Available Settings
| Setting | Type | Description |
|---------|------|-------------|
| loginWithPin | boolean | Enable/disable PIN login |
| loginWithBiometric | boolean | Enable/disable biometric login |

## Important Notes
- Two-factor authentication (2FA) cannot be managed here - use dedicated 2FA setup flow
- Disabling PIN login will require using password or other methods
- Biometric requires the device to support and have biometrics enrolled
    `,
  })
  @ApiBody({ type: UpdateSecuritySettingsDto })
  @ApiResponse({
    status: 200,
    description: 'Security settings updated successfully',
    schema: {
      example: {
        message: 'Security settings updated',
        loginWithPin: true,
        loginWithBiometric: true,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateSecuritySettings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSecuritySettingsDto,
  ) {
    return this.settingsService.updateSecuritySettings(req.user.id, dto);
  }
}
