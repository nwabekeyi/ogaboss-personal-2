// src/modules/user/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PrismaService,
  DevicePlatform,
} from '../../../infrastructure/databases/prisma';
import { uploadBase64Image, deleteImageOnImageKit } from '../../../infrastructure';
import { FirebaseCloudMessagingService } from '../../../infrastructure/providers/firebase/firebase-cloud-messaging.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmService: FirebaseCloudMessagingService,
  ) {}

  private async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        country: true,
        gender: true,
        hideAccountOnLogin: true,
        displayCurrency: true,
        residentialAddress: true,
        kycVerificationStatus: true,
        isEmailVerified: true,
        email: true,
        avatar: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ────── GET PROFILE (Minimal) ──────
  async getMyProfile(userId: string) {
    return this.getUser(userId);
  }

  // // ────── UPDATE PROFILE ──────
  // async updateProfile(userId: string, dto: UpdateUserProfileDto) {
  //   return this.prisma.user.update({
  //     where: { id: userId },
  //     data: dto,
  //     select: {
  //       firstName: true,
  //       lastName: true,
  //       dateOfBirth: true,
  //       country: true,
  //       gender: true,
  //       hideAccountOnLogin: true,
  //       displayCurrency: true,
  //     },
  //   });
  // }

  // ────── AVATAR ──────
  async uploadAvatar(userId: string, base64Image: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const folder = `users/${userId}`;
    const result = await uploadBase64Image(base64Image, folder);
    const newUrl = result.url;

    if (user.avatar && !user.avatar.includes('default_user')) {
      const oldFileId = this.extractFileId(user.avatar);
      if (oldFileId) await deleteImageOnImageKit(oldFileId).catch(() => {});
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: newUrl },
    });

    return {
      message: 'Avatar uploaded successfully',
      avatar: newUrl,
    };
  }

  private extractFileId(url: string): string | null {
    try {
      return url.split('/').pop()?.split('.')[0] || null;
    } catch {
      return null;
    }
  }

  // ────── DEVICE TOKEN MANAGEMENT ──────
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName?: string,
    deviceId?: string,
  ) {
    await this.fcmService.addDeviceToken(
      userId,
      token,
      platform,
      deviceName,
      deviceId,
    );
    return { message: 'Device token registered successfully' };
  }

  async removeDeviceToken(userId: string, token: string) {
    await this.fcmService.removeDeviceToken(userId, token);
    return { message: 'Device token removed successfully' };
  }
}
