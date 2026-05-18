import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getNotificationSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountActivityAlert: true,
        transactionAlert: true,
        appUpdates: true,
        maintenanceAlert: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateNotificationSettings(
    userId: string,
    dto: UpdateNotificationSettingsDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        accountActivityAlert: true,
        transactionAlert: true,
        appUpdates: true,
        maintenanceAlert: true,
      },
    });

    return updatedUser;
  }

  async getSecuritySettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isTwoFactorEnabled: true,
        loginWithPin: true,
        loginWithBiometric: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateSecuritySettings(userId: string, dto: UpdateSecuritySettingsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        loginWithPin: true,
        loginWithBiometric: true,
      },
    });

    return updatedUser;
  }
}
