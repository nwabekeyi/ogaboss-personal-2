import {
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';

import { AuthService } from '../auth.service';
import { UserService } from '../users/users.service';
import { RefreshTokenDTO } from '../users/dto';
import { AuthGuard } from '../../../core';
import { VersionedController } from '../../../core/decorators';
import { HttpExceptionInterceptor } from '../../../core';
import { apiTags } from '../../../shared';

@ApiTags('Auth - General')
@VersionedController(apiTags.auth)
@UseInterceptors(HttpExceptionInterceptor)
export class GeneralAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  /**
   * Resend OTP
   *
   * ⚠️ This endpoint only works for authenticated users.
   * The user must provide a valid access token.
   */
  @Post('resend-otp')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Resend OTP',
    description:
      'Resends a new OTP to the authenticated user’s email address. Requires a valid access token.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          example: 'user@example.com',
        },
      },
      required: ['email'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'OTP successfully resent.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Access token is missing or invalid.',
  })
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body('email') email: string) {
    return this.userService.resendOtp(email);
  }

  /**
   * Refresh Access Token
   *
   * Requires authentication.
   */
  @Post('refresh-token')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Generates a new access token using a valid refresh token. Requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Access token refreshed successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Invalid or expired refresh token.',
  })
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDTO) {
    return this.authService.refreshAccessToken(dto.refreshToken);
  }

  /**
   * Logout User
   *
   * Invalidates the provided refresh token.
   */
  @Post('logout')
  @ApiBearerAuth('Bearer')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Logout user',
    description:
      'Logs out the authenticated user by invalidating the provided refresh token.',
  })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Access token is missing or invalid.',
  })
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDTO) {
    return this.authService.logout(dto.refreshToken);
  }
}
