import {
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AuthService } from '../auth.service';
import {
  SignInDTO,
  ForgotPasswordDto,
  ResetPasswordDto,
  AdminService,
  CreateSuperAdminDTO,
} from '../admin';
import { VersionedController } from '../../../core/decorators';
import { HttpExceptionInterceptor } from '../../../core';
import { apiTags } from '../../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Auth - Admin')
@VersionedController(apiTags.auth)
@UseInterceptors(HttpExceptionInterceptor)
export class AdminAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminService: AdminService,
  ) {}

  @Post('/admin/super-admin')
  @AuditLog({
    action: AuditAction.ADMIN_CREATE_SUPER_ADMIN,
    resource: AuditResource.ADMIN_ACCOUNT,
    resourceIdPath: 'body.email',
    maskFields: ['password'],
  })
  @HttpCode(HttpStatus.CREATED)
  async createSuperAdmin(@Body() dto: CreateSuperAdminDTO) {
    return this.adminService.addSuperAdmin(dto);
  }

  @Post('/admin/login')
  @AuditLog({
    action: AuditAction.ADMIN_LOGIN,
    resource: AuditResource.ADMIN_AUTH,
    resourceIdPath: 'body.email',
    maskFields: ['password'],
  })
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() dto: SignInDTO) {
    return this.authService.validateAdmin(dto);
  }

  @Post('/admin/forgot-password')
  @AuditLog({
    action: AuditAction.ADMIN_FORGOT_PASSWORD,
    resource: AuditResource.ADMIN_AUTH,
    resourceIdPath: 'body.email',
  })
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.adminForgotPassword(dto);
  }

  @Post('/admin/reset-password')
  @AuditLog({
    action: AuditAction.ADMIN_RESET_PASSWORD,
    resource: AuditResource.ADMIN_AUTH,
    resourceIdPath: 'body.email',
    maskFields: ['password'],
  })
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.adminResetPassword(dto);
  }
}
