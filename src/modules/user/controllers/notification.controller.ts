import { Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import {
  NotificationService,
} from '../service/notification.service';
import { AuthGuard } from '../../../common';
import { apiTags } from '../../../shared';
import { VersionedController } from '../../../core/decorators';
import { AuthenticatedRequest } from '../../../common';
import { FirebaseNotificationData } from '../../../infrastructure/providers/firebase/type';
import { PaginatedNotifications } from '../type';

@ApiTags('Notifications')
@ApiBearerAuth('Bearer')
@UseGuards(AuthGuard)
@VersionedController(apiTags.notifications)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'Get user notifications with pagination',
    description: `
## Overview
Retrieves paginated notifications for the authenticated user.

## Pagination
- Default page: 1
- Default limit: 10
- Maximum limit: 30
- Results are sorted by creation date (newest first)

## Response Details
Returns notifications with read/unread status
    `,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 30)',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications retrieved successfully',
    schema: {
      example: {
        data: [
          {
            id: 'notif_123',
            title: 'Transaction Successful',
            body: 'Your deposit of ₦10,000 has been confirmed',
            imageUrl: 'https://example.com/image.jpg',
            data: { type: 'deposit', referenceId: 'dep_123' },
            createdAt: '2024-01-15T10:30:00.000Z',
            isRead: false,
          },
        ],
        meta: {
          total: 50,
          page: 1,
          limit: 10,
          totalPages: 5,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<PaginatedNotifications<FirebaseNotificationData>> {
    const userId = req.user?.id;
    return this.notificationService.getNotifications(
      userId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 10,
    );
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notifications count',
    description: `
## Overview
Returns the count of unread notifications for the user.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Unread count retrieved',
    schema: { example: { unreadCount: 5 } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUnreadCount(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    const count = await this.notificationService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single notification by ID',
    description: `
## Overview
Retrieves a specific notification by its ID.

## Response Details
Returns the notification details including read status
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification retrieved successfully',
    schema: {
      example: {
        id: 'notif_123',
        title: 'Transaction Successful',
        body: 'Your deposit of ₦10,000 has been confirmed',
        imageUrl: 'https://example.com/image.jpg',
        data: { type: 'deposit', referenceId: 'dep_123' },
        createdAt: '2024-01-15T10:30:00.000Z',
        isRead: false,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async getNotificationById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<FirebaseNotificationData> {
    const userId = req.user?.id;
    return this.notificationService.getNotificationById(userId, id);
  }

  @Post(':id/read')
  @ApiOperation({
    summary: 'Mark a notification as read',
    description: `
## Overview
Marks a specific notification as read.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read',
    schema: { example: { message: 'Notification marked as read' } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = req.user?.id;
    await this.notificationService.markAsRead(userId, id);
    return { message: 'Notification marked as read' };
  }

  @Post('read-all')
  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: `
## Overview
Marks all user notifications as read.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'All notifications marked as read',
    schema: { example: { message: 'All notifications marked as read' } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markAllAsRead(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    await this.notificationService.markAllAsRead(userId);
    return { message: 'All notifications marked as read' };
  }
}
