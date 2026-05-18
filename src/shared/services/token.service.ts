import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/databases/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UserType, TokenType, AdminRole } from '../../infrastructure';
import * as bcrypt from 'bcrypt';

interface BankVerificationPayload {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  type: 'BANK_VERIFY';
  iat?: number;
  exp?: number;
}

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async generateTokens(user: {
    id: string;
    userType: UserType;
    role?: AdminRole;
    internalRoleId?: string;
    accountStatus?: string;
  }) {
    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(
      user.id,
      user.userType,
    );

    return { accessToken, refreshToken };
  }

  async generateAccessToken(user: {
    id: string;
    userType: UserType;
    role?: AdminRole;
    internalRoleId?: string;
    accountStatus?: string;
  }) {
    const payload: Record<string, any> = {
      id: user.id,
      userType: user.userType,
    };

    if (user.role) payload.role = user.role;
    if (user.internalRoleId) payload.internalRoleId = user.internalRoleId;
    if (user.accountStatus) payload.accountStatus = user.accountStatus;

    return this.jwtService.sign(payload, {
      expiresIn: this.config.get('JWT_ACCESS_EXPIRATION'),
      secret: this.config.get('JWT_ACCESS_SECRET'),
    });
  }

  private async generateRefreshToken(
    userId: string,
    userType: UserType,
  ): Promise<string> {
    const refreshToken = this.jwtService.sign(
      {
        id: userId,
        userType,
        type: TokenType.REFRESH,
      },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRATION'),
      },
    );

    // Note: Token record creation is handled by the caller within their transaction
    // to avoid foreign key constraint issues when user doesn't exist yet

    return refreshToken;
  }

  async verifyRefreshToken(refreshToken: string) {
    let decoded: any;

    try {
      decoded = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (decoded.type !== TokenType.REFRESH) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    const token = await this.prisma.token.findFirst({
      where: {
        token: refreshToken,
        type: TokenType.REFRESH,
        isRevoked: false,
      },
    });

    if (!token) {
      throw new UnauthorizedException('Refresh token revoked or invalid');
    }

    if (decoded.userType === UserType.ADMIN) {
      const admin = await this.prisma.admin.findUnique({
        where: { id: token.adminId || decoded.id },
      });

      if (!admin) {
        throw new UnauthorizedException('Admin not found');
      }

      return {
        id: admin.id,
        userType: UserType.ADMIN,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: token.userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      userType: user.userType,
    };
  }

  async generateEmailVerificationToken(user: {
    email: string;
    id: string;
    userType: UserType;
  }) {
    return this.generateToken(user, TokenType.EMAIL_VERIFICATION, '24h');
  }

  async generateResetPasswordToken(user: {
    email: string;
    id: string;
    userType: UserType;
  }) {
    return this.generateToken(user, TokenType.PASSWORD_RESET, '15m');
  }

  private async generateToken(
    user: { id: string; email?: string; userType: UserType },
    type: TokenType,
    expiresIn: string | number,
  ) {
    const payload: Record<string, any> = { id: user.id, type };
    const secret = this.getSecretForTokenType(type);

    const token = this.jwtService.sign(payload, {
      expiresIn: expiresIn as any,
      secret,
    } as any);

    const expiresAt = new Date(Date.now() + this.parseExpiresIn(expiresIn));

    const tokenCreateData = {
      token,
      type,
      expiresAt,
      userType: user.userType,
      ...(user.userType === UserType.ADMIN
        ? { adminId: user.id }
        : { userId: user.id }),
    };

    await this.prisma.token.create({
      data: tokenCreateData as any,
    });

    return token;
  }

  private getSecretForTokenType(type: TokenType): string {
    switch (type) {
      case TokenType.REFRESH:
        return this.config.get('JWT_REFRESH_SECRET');
      case TokenType.EMAIL_VERIFICATION:
        return this.config.get('JWT_EMAIL_VERIFICATION_SECRET');
      case TokenType.PASSWORD_RESET:
        return this.config.get('JWT_PASSWORD_RESET_SECRET');
      case TokenType.PASSWORD_CHANGE:
        return this.config.get('JWT_PASSWORD_CHANGE_SECRET');
      default:
        throw new Error('Invalid token type');
    }
  }

  private parseExpiresIn(expiresIn: string | number): number {
    if (typeof expiresIn === 'number') return expiresIn * 1000;
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error('Invalid expiresIn format');

    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        throw new Error('Invalid time unit');
    }
  }

  // -----------------------------
  // Verify email / single-use tokens
  // -----------------------------
  async verifyEmailToken(token: string) {
    const tokenData = await this.verifyToken(
      token,
      TokenType.EMAIL_VERIFICATION,
    );
    if (tokenData.user.isEmailVerified)
      throw new UnauthorizedException('Email already verified');

    await this.prisma.user.update({
      where: { id: tokenData.user.id },
      data: { isEmailVerified: true },
    });

    await this.prisma.token.update({
      where: { token },
      data: { isRevoked: true },
    });

    return tokenData.user;
  }

  // -----------------------------
  // Verify password reset token - returns token data without auto-revoking
  // -----------------------------
  async verifyPasswordResetToken(token: string) {
    const tokenRecord = await this.verifyToken(token, TokenType.PASSWORD_RESET);

    let userId: string | undefined;
    if (tokenRecord.admin) {
      userId = tokenRecord.adminId || undefined;
    } else if (tokenRecord.user) {
      userId = tokenRecord.userId;
    }

    return {
      id: tokenRecord.admin?.id || tokenRecord.user?.id,
      userType: tokenRecord.userType,
      userId,
    };
  }

  // -----------------------------
  // Revoke password reset token after successful use
  // -----------------------------
  async revokePasswordResetToken(token: string) {
    await this.prisma.token.update({
      where: { token },
      data: { isRevoked: true },
    });
  }

  private async verifyToken(token: string, type: TokenType) {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.getSecretForTokenType(type),
    });

    if (payload.type !== type)
      throw new UnauthorizedException('Invalid token type');

    const tokenRecord = await this.prisma.token.findUnique({
      where: { token },
      include: { user: true, admin: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Token invalid or expired');
    }

    return tokenRecord;
  }

  async revokeToken(token: string) {
    await this.prisma.token.update({
      where: { token },
      data: { isRevoked: true },
    });
  }

  async revokeAllUserTokens(userId: string, type?: TokenType) {
    const whereClause: any = { userId };
    if (type && type !== TokenType.REFRESH) {
      whereClause.type = type;
    }

    await this.prisma.token.updateMany({
      where: whereClause,
      data: { isRevoked: true },
    });
  }

  async compareHash(data: string, hash: string): Promise<boolean> {
    return bcrypt.compare(data, hash);
  }

  async hash(data: string, saltRounds: number): Promise<string> {
    return bcrypt.hash(data, saltRounds);
  }

  async generateBankVerificationToken(payload: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  }): Promise<string> {
    const secret = this.config.get('JWT_BANK_VERIFY_SECRET');
    const tokenPayload: BankVerificationPayload = {
      ...payload,
      type: 'BANK_VERIFY',
    };

    return this.jwtService.sign(tokenPayload, {
      secret,
      expiresIn: '15m',
    });
  }

  async verifyBankVerificationToken(
    token: string,
  ): Promise<BankVerificationPayload> {
    try {
      const secret = this.config.get('JWT_BANK_VERIFY_SECRET');
      const payload = this.jwtService.verify(token, {
        secret,
      }) as BankVerificationPayload;

      if (payload.type !== 'BANK_VERIFY') {
        throw new UnauthorizedException('Invalid token type');
      }

      return payload;
    } catch (error) {
      throw new UnauthorizedException(
        'Invalid or expired bank verification token',
      );
    }
  }
}
