import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Prisma, PrismaService, DevicePlatform } from '../../databases/prisma';
import {
  BroadcastNotificationParams,
  FirebaseNotificationData,
  FIREBASE_ERRORS,
  NotificationPayload,
  SendNotificationParams,
} from './type';

@Injectable()
export class FirebaseCloudMessagingService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseCloudMessagingService.name);
  private messaging: admin.messaging.Messaging;
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.initializeFirebase();
  }

  private async initializeFirebase() {
    if (admin.apps.length > 0) {
      this.messaging = admin.messaging();
      this.initialized = true;
      this.logger.log('Firebase Cloud Messaging already initialized');
      return;
    }

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID')!;
    const clientEmail = this.configService.get<string>(
      'FIREBASE_CLIENT_EMAIL',
    )!;
    let privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY')!;

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const serviceAccount = {
      project_id: projectId,
      private_key: privateKey,
      client_email: clientEmail,
    } as admin.ServiceAccount;

    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.messaging = admin.messaging();
      this.initialized = true;
      this.logger.log('Firebase Cloud Messaging initialized');
    } catch (error) {
      this.logger.error(
        `Firebase initialization failed: ${error.message}`,
        error.stack,
      );
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private buildFirebaseData(
    payload: NotificationPayload,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private async persistNotification(
    userId: string,
    title: string,
    body: string,
    data?: NotificationPayload,
    imageUrl?: string,
  ): Promise<string> {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: data as Prisma.InputJsonValue | undefined,
        imageUrl,
      },
    });
    return notification.id;
  }

  private async persistNotifications(
    userIds: string[],
    title: string,
    body: string,
    data?: NotificationPayload,
    imageUrl?: string,
  ): Promise<void> {
    const notifications = userIds.map((userId) => ({
      userId,
      title,
      body,
      data: data as Prisma.InputJsonValue | undefined,
      imageUrl,
    }));

    await this.prisma.notification.createMany({
      data: notifications,
    });
  }

  async sendNotification(
    params: SendNotificationParams,
  ): Promise<FirebaseNotificationData | null> {
    const { userId, title, body, data, imageUrl } = params;

    const notificationId = await this.persistNotification(
      userId,
      title,
      body,
      data,
      imageUrl,
    );

    try {
      const tokens = await this.getActiveDeviceTokens(userId);

      if (tokens.length === 0) {
        this.logger.warn(`No device tokens found for user ${userId}`);
        return this.buildNotificationResponse(
          notificationId,
          title,
          body,
          data,
          imageUrl,
          false,
        );
      }

      const firebaseData = this.buildFirebaseData(data || { type: 'general' });
      firebaseData.id = notificationId;

      await this.sendToSpecificTokens(
        tokens,
        title,
        body,
        firebaseData,
        imageUrl,
      );

      return this.buildNotificationResponse(
        notificationId,
        title,
        body,
        data,
        imageUrl,
        false,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send notification to user ${userId}: ${error?.message || error}`,
        error?.stack,
      );
      if (error?.response) {
        this.logger.error(`FCM response: ${JSON.stringify(error.response)}`);
      }
      return this.buildNotificationResponse(
        notificationId,
        title,
        body,
        data,
        imageUrl,
        false,
      );
    }
  }

  private buildNotificationResponse(
    id: string,
    title: string,
    body: string,
    data?: NotificationPayload,
    imageUrl?: string,
    isRead: boolean = false,
  ): FirebaseNotificationData {
    return {
      id,
      title,
      body,
      imageUrl,
      data: data || { type: 'general' },
      createdAt: new Date().toISOString(),
      isRead,
    };
  }

  async sendNotificationToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    imageUrl?: string,
  ): Promise<boolean> {
    if (tokens.length === 0) {
      return false;
    }

    const uniqueTokens = Array.from(new Set(tokens));

    try {
      return await this.sendToSpecificTokens(
        uniqueTokens,
        title,
        body,
        data,
        imageUrl,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send notifications to tokens: ${error?.message || error}`,
        error?.stack,
      );
      if (error?.response) {
        this.logger.error(`FCM response: ${JSON.stringify(error.response)}`);
      }
      return false;
    }
  }

  async broadcastNotification(
    params: BroadcastNotificationParams,
  ): Promise<{ success: number; failed: number }> {
    const { userIds, title, body, data, imageUrl } = params;

    await this.persistNotifications(userIds, title, body, data, imageUrl);

    const allTokens = await this.prisma.userDeviceToken.findMany({
      where: { userId: { in: userIds }, isActive: true },
      select: { token: true },
    });

    if (allTokens.length === 0) {
      this.logger.warn('No device tokens found for broadcast');
      return { success: 0, failed: 0 };
    }

    const tokens: string[] = Array.from(
      new Set(allTokens.map((dt): string => dt.token)),
    );
    return await this.sendBatchToTokens(tokens, title, body, data, imageUrl);
  }

  private async sendToSpecificTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    imageUrl?: string,
  ): Promise<boolean> {
    if (!this.initialized) {
      this.logger.warn(
        'Firebase messaging not initialized. Skipping notification.',
      );
      return false;
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: { title, body },
        data: data || {},
        android: imageUrl
          ? {
              notification: {
                imageUrl,
              },
            }
          : undefined,
        apns: imageUrl
          ? {
              payload: {
                aps: {
                  'mutable-content': 1,
                },
              },
              fcmOptions: {
                imageUrl,
              },
            }
          : undefined,
      };

      const response = await this.messaging.sendEachForMulticast(message);
      this.logger.log(
        `Sent notifications: ${response.successCount} success, ${response.failureCount} failed`,
      );

      if (response.failureCount > 0) {
        const failedDetails = response.responses
          .filter((r) => !r.success)
          .map((r, idx) => {
            const token = tokens[idx];
            const errorMsg = r.error?.message || 'Unknown error';
            const errorCode = r.error?.code || 'N/A';
            return `token: ${token.slice(0, 20)}... error: ${errorMsg} (code: ${errorCode})`;
          })
          .join('; ');
        this.logger.warn(`FCM send failures: ${failedDetails}`);
      }

      await this.handleSendResponse(tokens, response);

      return response.successCount > 0;
    } catch (error) {
      this.logger.error(
        `Failed to send notifications: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  private async sendBatchToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    imageUrl?: string,
  ): Promise<{ success: number; failed: number }> {
    if (!this.initialized) {
      this.logger.warn(
        'Firebase messaging not initialized. Skipping broadcast.',
      );
      return { success: 0, failed: tokens.length };
    }

    const batchSize = 500;
    const batchTokens = tokens.slice(0, batchSize);
    const remainingTokens = tokens.slice(batchSize);

    let successCount = 0;
    let failedCount = 0;

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens: batchTokens,
        notification: { title, body },
        data: data || {},
        android: imageUrl
          ? {
              notification: {
                imageUrl,
              },
            }
          : undefined,
        apns: imageUrl
          ? {
              payload: {
                aps: {
                  'mutable-content': 1,
                },
              },
              fcmOptions: {
                imageUrl,
              },
            }
          : undefined,
      };

      const response = await this.messaging.sendEachForMulticast(message);
      successCount += response.successCount;
      failedCount += response.failureCount;

      if (response.failureCount > 0) {
        const failedDetails = response.responses
          .filter((r) => !r.success)
          .map((r, idx) => {
            const token = batchTokens[idx];
            const errorMsg = r.error?.message || 'Unknown error';
            const errorCode = r.error?.code || 'N/A';
            return `token: ${token.slice(0, 20)}... error: ${errorMsg} (code: ${errorCode})`;
          })
          .join('; ');
        this.logger.warn(`FCM broadcast failures: ${failedDetails}`);
      }

      await this.handleSendResponse(batchTokens, response);

      if (remainingTokens.length > 0) {
        const remainingResult = await this.sendBatchToTokens(
          remainingTokens,
          title,
          body,
          data,
        );
        successCount += remainingResult.success;
        failedCount += remainingResult.failed;
      }

      return { success: successCount, failed: failedCount };
    } catch (error: any) {
      this.logger.error(
        `Failed to broadcast notifications: ${error?.message || error}`,
        error?.stack,
      );
      if (error?.response) {
        this.logger.error(
          `FCM broadcast response: ${JSON.stringify(error.response)}`,
        );
      }
      return {
        success: successCount,
        failed: failedCount + remainingTokens.length + batchTokens.length,
      };
    }
  }

  private async handleSendResponse(
    tokens: string[],
    response: admin.messaging.BatchResponse,
  ): Promise<void> {
    const invalidTokens: string[] = [];

    for (let i = 0; i < response.responses.length; i++) {
      const result = response.responses[i];
      if (!result.success) {
        const errorCode = result.error?.code;
        const token = tokens[i];

        if (
          errorCode === FIREBASE_ERRORS.NOT_FOUND ||
          errorCode === FIREBASE_ERRORS.INVALID_ARGUMENT ||
          result.error?.message?.includes('invalid registration token')
        ) {
          invalidTokens.push(token);
        }
      }
    }

    if (invalidTokens.length > 0) {
      this.logger.warn(`Deleting ${invalidTokens.length} invalid tokens`);
      await this.prisma.userDeviceToken.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    }
  }

  async addDeviceToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName?: string,
    deviceId?: string,
  ): Promise<void> {
    const existing = await this.prisma.userDeviceToken.findFirst({
      where: { userId, token },
    });

    if (existing) {
      await this.prisma.userDeviceToken.update({
        where: { id: existing.id },
        data: { isActive: true, lastUsedAt: new Date() },
      });
    } else {
      await this.prisma.userDeviceToken.create({
        data: { userId, token, platform, deviceName, deviceId },
      });
    }

    this.logger.log(`Device token added for user ${userId}`);
  }

  async removeDeviceToken(userId: string, token: string): Promise<void> {
    await this.prisma.userDeviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
    this.logger.log(`Device token removed for user ${userId}`);
  }

  async getActiveDeviceTokens(userId: string): Promise<string[]> {
    const tokens = await this.prisma.userDeviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });
    return tokens.map((t) => t.token);
  }
}
