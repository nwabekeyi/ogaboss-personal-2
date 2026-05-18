import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../../shared';
import { AdminService } from './admin/admin.service';
import { ForgotPasswordDto, ResetPasswordDto, SignInDTO } from './admin/dto';
import { UserType, TokenType } from '../../infrastructure';
import { PrismaService } from '../../infrastructure';

@Injectable()
export class AuthService {
  constructor(
    private readonly adminService: AdminService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async validateAdmin(signInDto: SignInDTO) {
    const admin = await this.adminService.validateAdminLogin(signInDto);

    const tokens = await this.tokenService.generateTokens({
      id: admin.id,
      userType: UserType.ADMIN,
      role: admin.role,
      internalRoleId: admin.internalRoleId ?? null,
      accountStatus: admin.accountStatus,
    });

    // Store refresh token in Token table for tracking (upsert)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.token.upsert({
      where: {
        adminId_type: {
          adminId: admin.id,
          type: TokenType.REFRESH,
        },
      },
      create: {
        token: tokens.refreshToken,
        type: TokenType.REFRESH,
        userType: UserType.ADMIN,
        adminId: admin.id,
        expiresAt,
      },
      update: {
        token: tokens.refreshToken,
        expiresAt,
        isRevoked: false,
      },
    });

    return {
      message: 'Admin signed in successfully',
      data: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        ...tokens,
      },
    };
  }

  // Public endpoints
  async adminForgotPassword(dto: ForgotPasswordDto) {
    return this.adminService.forgotPassword(dto);
  }

  // Now accepts full DTO (token + newPassword)
  async adminResetPassword(dto: ResetPasswordDto) {
    return this.adminService.resetPassword(dto.token, dto);
  }

  // -----------------------------
  // Logout (revoke refresh token)
  // -----------------------------
  async logout(refreshToken: string) {
    // Verify the refresh token
    const user = await this.tokenService.verifyRefreshToken(refreshToken);

    // Revoke the refresh token by setting it to null in DB and marking as revoked in Token table
    if (user.userType === UserType.ADMIN) {
      await this.prisma.admin.update({
        where: { id: user.id },
        data: { refreshToken: null },
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: null },
      });
    }

    // Also revoke in Token table for consistency
    await this.tokenService.revokeToken(refreshToken);

    return {
      message: `${user.userType} logged out successfully`,
      success: true,
    };
  }

  // -----------------------------
  // Refresh access token: no revoke, only generate new access token
  // -----------------------------
  async refreshAccessToken(refreshToken: string) {
    const decoded: any =
      await this.tokenService.verifyRefreshToken(refreshToken);

    if (decoded.type !== 'REFRESH') {
      throw new UnauthorizedException('Invalid token type');
    }

    const storedToken = await this.prisma.token.findFirst({
      where: {
        token: refreshToken,
        type: 'REFRESH',
        isRevoked: false,
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token revoked or invalid');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (decoded.userType === UserType.ADMIN) {
      const admin = await this.prisma.admin.findUnique({
        where: { id: decoded.id },
      });

      if (!admin) {
        throw new UnauthorizedException('Admin not found');
      }

      const accessToken = await this.tokenService.generateAccessToken({
        id: admin.id,
        userType: UserType.ADMIN,
        role: admin.role,
        internalRoleId: admin.internalRoleId ?? null,
        accountStatus: admin.accountStatus,
      });

      return {
        message: 'Access token refreshed successfully',
        accessToken,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const accessToken = await this.tokenService.generateAccessToken({
      id: user.id,
      userType: user.userType,
    });

    return {
      message: 'Access token refreshed successfully',
      accessToken,
    };
  }
}
