import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/databases/prisma';
import { PaginationService } from '../../../shared/services/pagination.service';
import { FirebaseNotificationData } from '../../../infrastructure/providers/firebase/type';
import { PaginatedNotifications } from '../type';


@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async getNotifications(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedNotifications<FirebaseNotificationData>> {
    if (limit > 30) {
      limit = 30;
    }
    if (limit < 1) {
      limit = 10;
    }
    if (page < 1) {
      page = 1;
    }

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({
        where: { userId },
      }),
    ]);

    const data = notifications.map((n) => {
      const notificationData = n.data as Record<string, string> | undefined;
      return {
        id: n.id,
        title: n.title,
        body: n.body,
        imageUrl: n.imageUrl || undefined,
        data: notificationData
          ? { type: 'general', ...notificationData }
          : { type: 'general' },
        createdAt: n.createdAt.toISOString(),
        isRead: n.isRead,
      };
    });

    const pagination = PaginationService.getPagination(page, limit, total);

    return {
      data,
      meta: {
        ...pagination,
        hasNextPage: page < pagination.totalPage,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getNotificationById(
    userId: string,
    notificationId: string,
  ): Promise<FirebaseNotificationData> {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      imageUrl: notification.imageUrl || undefined,
      data: (notification.data as Record<string, string> | undefined)
        ? { type: 'general', ...(notification.data as Record<string, string>) }
        : { type: 'general' },
      createdAt: notification.createdAt.toISOString(),
      isRead: notification.isRead,
    };
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }
}
