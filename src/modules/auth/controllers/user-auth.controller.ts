import {
  Post,
  Body,
  Delete,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserService } from '../users/users.service';
import {
  LoginDto,
  ForgotPinDTO,
  ResetPinDTO,
  InitiatePinChangeDto,
  ConfirmPinChangeDto,
  InitiateTwoFactorDto,
  LoginTwoFactorDto,
  VerifyTwoFactorDto,
  VerifyingOtpDTO,
} from '../users/dto';
import { AuthenticatedRequest } from '../../../common';
import { AuthGuard } from '../../../core';
import { VersionedController } from '../../../core/decorators';
import { HttpExceptionInterceptor } from '../../../core';
import { apiTags } from '../../../shared';
import { AuditLog, AuditAction, AuditResource } from '../../../core/audit';

@ApiTags('Auth - User')
@VersionedController(apiTags.auth)
@UseInterceptors(HttpExceptionInterceptor)
export class UserAuthController {
  constructor(private readonly userService: UserService) {}

  @Post('login-user')
  @AuditLog({
    action: AuditAction.USER_LOGIN,
    resource: AuditResource.AUTH_USER,
    resourceIdPath: 'body.email',
    maskFields: ['pin'],
  })
  @HttpCode(HttpStatus.OK)
  async loginUser(@Body() dto: LoginDto) {
    return this.userService.validateUser(dto);
  }

  @Post('/forgot-pin')
  @AuditLog({
    action: AuditAction.USER_FORGOT_PIN,
    resource: AuditResource.AUTH_PIN,
    resourceIdPath: 'body.email',
  })
  @HttpCode(HttpStatus.OK)
  async forgotPin(@Body() dto: ForgotPinDTO) {
    return this.userService.forgotPin(dto);
  }

  @Post('/reset-pin')
  @AuditLog({
    action: AuditAction.USER_RESET_PIN,
    resource: AuditResource.AUTH_PIN,
    resourceIdPath: 'body.email',
    maskFields: ['pinResetToken', 'newPin'],
  })
  @HttpCode(HttpStatus.OK)
  async resetPin(@Body() dto: ResetPinDTO) {
    return this.userService.resetPin(dto);
  }

  @Post('/verify-otp')
  @AuditLog({
    action: AuditAction.USER_VERIFY_OTP,
    resource: AuditResource.AUTH_OTP,
    resourceIdPath: 'body.email',
    maskFields: ['otp'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify OTP (signup or PIN reset)',
    description:
      'Server automatically detects whether the OTP belongs to onboarding or a PIN reset. Returns a registrationId for signup OTPs or a 2-minute pinResetToken for forgot-PIN OTPs. Does not require authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired OTP.',
  })
  async verifyOtp(@Body() dto: VerifyingOtpDTO) {
    return this.userService.verifyOtp(dto);
  }

  @Post('/change-pin/initiate')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.USER_PIN_CHANGE_INIT,
    resource: AuditResource.AUTH_PIN,
    maskFields: ['currentPin'],
  })
  async initiatePinChange(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiatePinChangeDto,
  ) {
    return this.userService.initiatePinChange(req.user.id, dto);
  }

  @Post('/change-pin/confirm')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.USER_PIN_CHANGE_CONFIRM,
    resource: AuditResource.AUTH_PIN,
    maskFields: ['otp', 'newPin'],
  })
  @HttpCode(HttpStatus.OK)
  async confirmPinChange(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmPinChangeDto,
  ) {
    return this.userService.confirmPinChange(req.user.id, dto);
  }

  @Post('/enable-2fa/initiate')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.USER_ENABLE_2FA_INIT,
    resource: AuditResource.AUTH_2FA,
    maskFields: ['currentPin'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({ summary: 'Initiate enabling 2FA - sends OTP to email' })
  @ApiResponse({ status: 200, description: 'OTP sent to email' })
  @ApiResponse({
    status: 400,
    description: 'Invalid PIN or 2FA already enabled',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async initiateTwoFactor(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiateTwoFactorDto,
  ) {
    return await this.userService.initiateTwoFactor(req.user.id, dto);
  }

  @Post('/enable-2fa/verify')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.USER_ENABLE_2FA_VERIFY,
    resource: AuditResource.AUTH_2FA,
    maskFields: ['otp'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({ summary: 'Verify OTP and enable 2FA' })
  @ApiResponse({ status: 200, description: '2FA enabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async verifyTwoFactor(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyTwoFactorDto,
  ) {
    return await this.userService.verifyTwoFactor(req.user.id, dto);
  }

  @Post('/disable-2fa')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @AuditLog({
    action: AuditAction.USER_DISABLE_2FA,
    resource: AuditResource.AUTH_2FA,
    maskFields: ['currentPin'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({ summary: 'Disable 2FA with PIN verification' })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid PIN or 2FA not enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async disableTwoFactor(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiateTwoFactorDto,
  ) {
    return await this.userService.disableTwoFactor(req.user.id, dto);
  }

  @Post('/login-2fa/verify')
  @AuditLog({
    action: AuditAction.USER_LOGIN_2FA_VERIFY,
    resource: AuditResource.AUTH_2FA,
    resourceIdPath: 'body.email',
    maskFields: ['otp'],
  })
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({ summary: 'Verify login with 2FA OTP' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async verifyLoginTwoFactor(@Body() dto: LoginTwoFactorDto) {
    return await this.userService.verifyLoginTwoFactor(dto);
  }

  @Delete('/delete-account')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('Bearer')
  @AuditLog({
    action: AuditAction.USER_DELETE_ACCOUNT,
    resource: AuditResource.USER_ACCOUNT,
  })
  async deleteAccount(@Req() req: AuthenticatedRequest) {
    return this.userService.userRequestToDeleteAccount(req.user.id);
  }
}
