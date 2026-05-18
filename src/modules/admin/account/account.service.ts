import {
    Injectable,
    NotFoundException,
    ForbiddenException,
  } from '@nestjs/common';
  import { PrismaService } from '../../../infrastructure';
  import { UpdatePersonalInfoDto } from '../dto';
  import { AdminRole } from '../../../infrastructure';
import { ErrorMessages } from '../../../shared';

  @Injectable()
  export class AccountService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Get user account personal information
     */
    async getAccountInfo(userId: string) {
      const user = await this.prisma.admin.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          country: true,
          residentialAddress: true,
          // dateOfBirth: true,
          gender: true,
          createdAt: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return {
        success: true,
        data: {
          userId: user.id,
          accountName: user.fullName.trim() || 'N/A',
          email: user.email,
          phoneNumber: user.phoneNumber || 'N/A',
          country: user.country || 'N/A',
          residentialAddress: user.residentialAddress || 'N/A',
          // dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().split('T')[0] : 'N/A',
          // gender: user.gender || 'N/A',
          joinedDate: user.createdAt.toISOString().split('T')[0],
        },
      };
    }

    /**
     * Update user personal info — ONLY Super Admin allowed
     */
    async updatePersonalInfo(
      superAdminId: string,
      userId: string,
      dto: UpdatePersonalInfoDto,
    ) {
      // Verify that the requester is a Super Admin
      const superAdmin = await this.prisma.admin.findUnique({
        where: { id: superAdminId },
        select: { role: true },
      });

      if (!superAdmin || superAdmin.role !== AdminRole.SUPER_ADMIN) {
        throw new ForbiddenException(ErrorMessages.USER_NOT_AUTHORIZE);
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          country: dto.country,
          residentialAddress: dto.residentialAddress,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNumber: true,
          country: true,
          residentialAddress: true,
          dateOfBirth: true,
          gender: true,
          createdAt: true,
        },
      });
  
      return {
        success: true,
        message: 'User personal information updated successfully',
        data: {
          userId: updatedUser.id,
          accountName: `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() || 'N/A',
          email: updatedUser.email,
          phoneNumber: updatedUser.phoneNumber || 'N/A',
          country: updatedUser.country || 'N/A',
          residentialAddress: updatedUser.residentialAddress || 'N/A',
          dateOfBirth: updatedUser.dateOfBirth ? updatedUser.dateOfBirth.toISOString().split('T')[0] : 'N/A',
          gender: updatedUser.gender || 'N/A',
          joinedDate: updatedUser.createdAt.toISOString().split('T')[0],
        },
      };
    }
  }