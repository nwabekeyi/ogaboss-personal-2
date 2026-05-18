import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  AccountStatus,
  AdminRole,
  PrismaService,
} from '../../../infrastructure';
import {
  SignInDTO,
  ForgotPasswordDto,
  ResetPasswordDto,
  CreateSuperAdminDTO,
} from './dto';
import { hash, TokenService } from '../../../shared';
import { QueueService } from '../../../infrastructure/bullMQ';
import { UserType } from '../../../infrastructure';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly queueService: QueueService,
  ) {}

  async findAdminByEmail(email: string) {
    return await this.prisma.admin.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
  }

  async findAdminById(id: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        internalRoleId: true,
        accountStatus: true,
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return { ...admin, userType: UserType.ADMIN };
  }

  async validateAdminLogin(credentials: SignInDTO) {
    const { email, password } = credentials;

    const admin = await this.findAdminByEmail(email);
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { password: _, ...adminWithoutPassword } = admin;
    return adminWithoutPassword;
  }

  //create super admin
  async addSuperAdmin(dto: CreateSuperAdminDTO) {
    const { email, password, firstName, lastName, superAdminKey } = dto;

    // Check env key
    if (superAdminKey !== process.env.SUPER_ADMIN_KEY) {
      throw new UnauthorizedException('Invalid key to create Super Admin');
    }

    // Check existing admin
    const existing = await this.prisma.admin.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Admin already exists');

    // MASTER role
    const masterRole = await this.prisma.role.findUnique({
      where: { title: 'MASTER' },
    });
    if (!masterRole) throw new BadRequestException('MASTER role not found');

    // Hash password
    const hashedPassword = await hash(password, 12);

    // Create super admin
    const superAdmin = await this.prisma.admin.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        role: AdminRole.SUPER_ADMIN,
        internalRoleId: masterRole.id,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    return {
      success: true,
      message: 'Super Admin created successfully',
      data: { id: superAdmin.id, email: superAdmin.email },
    };
  }

  // ADMIN FORGOT PASSWORD
  async forgotPassword(dto: ForgotPasswordDto) {
    const admin = await this.findAdminByEmail(dto.email);

    if (!admin) {
      return {
        message:
          'If an account exists with this email, a password reset link will be sent',
        success: true,
      };
    }

    const token = await this.tokenService.generateResetPasswordToken({
      id: admin.id,
      email: admin.email,
      userType: UserType.ADMIN,
    });

    const isProd = process.env.NODE_ENV === 'production';
    const baseUrl = isProd
      ? process.env.ADMIN_FRONTEND_URL_PROD
      : process.env.ADMIN_FRONTEND_URL_DEV;

    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await this.queueService.sendAdminPasswordResetEmail({
      to: admin.email,
      firstName: admin.fullName.trim(),
      resetLink: resetUrl,
    });

    return {
      message:
        'If an account exists with this email, a password reset link will be sent',
      success: true,
    };
  }

  async resetPassword(token: string, dto: ResetPasswordDto) {
    const tokenData = await this.tokenService.verifyPasswordResetToken(token);

    if (!tokenData.id) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const adminId = tokenData.id;

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { accountStatus: true },
    });

    if (!admin) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (admin.accountStatus !== AccountStatus.ACTIVE) {
      throw new BadRequestException(
        'Cannot reset password. Account is not active.',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.admin.update({
      where: { id: adminId },
      data: { password: hashedPassword },
    });

    await this.tokenService.revokePasswordResetToken(token);

    return {
      message: 'Password reset successfully',
      success: true,
    };
  }
}
