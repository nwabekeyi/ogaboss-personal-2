import {
  Post,
  Body,
  HttpStatus,
  HttpCode,
  UseGuards,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Request } from 'express';

import { UserService } from '../users/users.service';
import {
  InitiateSignupDTO,
  CompleteSignUpDTO,
  UserSetPinDTO,
  ResendOtpDto,
} from '../users/dto';
import { VersionedController } from '../../../core/decorators';
import { AuthenticatedRequest } from '../../../common';
import { AuthGuard } from '../../../core';
import { HttpExceptionInterceptor, RetryInterceptor } from '../../../core';
import { apiTags, getClientIp } from '../../../shared';

@ApiTags('Auth - User Onboarding')
@VersionedController(apiTags.auth)
@UseInterceptors(RetryInterceptor, HttpExceptionInterceptor)
export class UserOnboardingController {
  constructor(private readonly userService: UserService) {}

  @Post('/sign-up-user')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Initiate user signup',
    description:
      'Starts user registration and sends an OTP to the provided email address. Does not require authentication.',
  })
  @ApiResponse({
    status: 201,
    description: 'Signup initiated successfully. OTP sent.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request payload.',
  })
  async signUpUser(@Req() req: Request, @Body() dto: InitiateSignupDTO) {
    const ip = getClientIp(req);
    return this.userService.initiateClientSignUp(dto);
  }

  @Post('/set-pin')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('Bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set user transaction PIN',
    description:
      'Allows an authenticated user to set their transaction PIN after OTP verification.',
  })
  @ApiResponse({
    status: 200,
    description: 'PIN set successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Access token required.',
  })
  async setUserPin(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UserSetPinDTO,
  ) {
    return this.userService.setUserPin(req.user.id, dto);
  }

  @Post('/complete-signup-user')
  @ApiBearerAuth('Bearer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Complete user signup',
    description:
      'Completes the user registration process after OTP verification and PIN setup. Requires authentication.',
  })
  @ApiResponse({
    status: 201,
    description: 'User signup completed successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Access token required.',
  })
  async completeSignup(@Body() dto: CompleteSignUpDTO) {
    return this.userService.completeClientSignUp(dto.registrationId, dto);
  }

  @Post('/resend-otp-onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Resend onboarding OTP',
    description:
      'Resends OTP during onboarding. This endpoint does NOT require authentication but requires captcha validation.',
  })
  @ApiBody({
    type: ResendOtpDto,
  })
  @ApiResponse({
    status: 200,
    description: 'OTP resent successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or captcha verification failed.',
  })
  async resendOtp(@Body() dto: ResendOtpDto, @Req() req: Request) {
    const ip = getClientIp(req);
    return this.userService.resendOnboardingOtp(
      dto.email,
      dto.captchaToken,
      ip,
    );
  }
}
