// src/modules/user/user.controller.ts
import {
  Get,
  Patch,
  Post,
  Body,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from '../service/user.service';
import {
  UpdateUserProfileDto,
  UploadAvatarFileDto,
  RegisterDeviceTokenDto,
} from '../dto';
import { AuthGuard } from '../../../common';
import { apiTags } from '../../../shared';
import { VersionedController } from '../../../core/decorators';
import { AuthenticatedRequest } from '../../../common';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('User')
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.users)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ────── GET PROFILE ──────
  @Get('profile')
  @ApiOperation({
    summary: 'Get authenticated user profile',
    description: `
## Overview
Retrieves the profile information of the currently authenticated user.

## Response Details
- **id**: Unique user identifier
- **email**: User's email address
- **firstName**: User's first name
- **lastName**: User's last name
- **phoneNumber**: User's phone number
- **avatar**: Profile picture URL (if set)
- **isVerified**: Whether email is verified
- **createdAt**: Account creation timestamp

## Use Cases
- Display user info on profile page
- Check if user has completed onboarding
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    schema: {
      example: {
        id: 'user_123abc',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '+2348012345678',
        avatar: 'https://cdn.example.com/avatars/user123.jpg',
        isVerified: true,
        createdAt: '2024-01-15T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    return this.userService.getMyProfile(userId);
  }

  // ────── UPLOAD AVATAR ──────
  @Post('avatar')
  @AuditLog({
    action: AuditAction.USER_UPLOAD_AVATAR,
    resource: AuditResource.USER_PROFILE,
  })
  @ApiOperation({
    summary: 'Upload user avatar/profile picture',
    description: `
## Overview
Uploads and sets a profile picture for the authenticated user.

## Content-Type
- Use multipart/form-data
- Field name: 'file'

## Supported Formats
- JPEG, PNG, GIF, WebP
- Maximum file size: 5MB

## Response Details
- **avatar**: URL of the uploaded avatar
- **message**: Success message

## Important Notes
- Previous avatar is replaced automatically
- Image is resized and optimized for display
- File must be sent as binary in the 'file' field
    `,
  })
  @ApiBearerAuth('Bearer')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Multipart form with image file (max 5MB)',
    type: UploadAvatarFileDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Avatar uploaded successfully',
    schema: {
      example: {
        message: 'Avatar uploaded successfully',
        avatar: 'https://cdn.example.com/avatars/user123_1705310400000.jpg',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatarFile(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = req.user?.id;

    if (!file) {
      throw new Error('No file uploaded');
    }

    const base64Image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

    return this.userService.uploadAvatar(userId, base64Image);
  }

  // ────── REGISTER DEVICE TOKEN ──────
  @Post('device-token')
  @AuditLog({
    action: AuditAction.USER_REGISTER_DEVICE_TOKEN,
    resource: AuditResource.USER_DEVICE,
    maskFields: ['token'],
  })
  @ApiOperation({
    summary: 'Register device token for push notifications',
    description: `
## Overview
Registers a Firebase Cloud Messaging device token for push notifications.

## Use Cases
- Enable push notifications on mobile app
- Token is stored and used for sending notifications
    `,
  })
  @ApiBody({
    description: 'Device token registration data',
    type: RegisterDeviceTokenDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered successfully',
    schema: { example: { message: 'Device token registered successfully' } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDeviceToken(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    const userId = req.user?.id;
    return this.userService.registerDeviceToken(
      userId,
      dto.token,
      dto.platform,
      dto.deviceName,
      dto.deviceId,
    );
  }

  // ────── REMOVE DEVICE TOKEN ──────
  @Delete('device-token')
  @AuditLog({
    action: AuditAction.USER_REMOVE_DEVICE_TOKEN,
    resource: AuditResource.USER_DEVICE,
    maskFields: ['token'],
  })
  @ApiOperation({
    summary: 'Remove device token for push notifications',
    description: `
## Overview
Removes a device token to stop receiving push notifications.
    `,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Device token to remove' },
      },
      required: ['token'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Device token removed successfully',
    schema: { example: { message: 'Device token removed successfully' } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async removeDeviceToken(
    @Req() req: AuthenticatedRequest,
    @Body() body: { token: string },
  ) {
    const userId = req.user?.id;
    return this.userService.removeDeviceToken(userId, body.token);
  }
}
