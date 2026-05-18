// src/modules/auth/auth.controller.ts
import {
  Post,
  Body,
  UseInterceptors,
  HttpStatus,
  HttpCode,
  UseGuards,
  Req,
  Delete,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';

import { HttpExceptionInterceptor } from '../../core';
import { SignInDTO, ForgotPasswordDto, ResetPasswordDto } from './admin';
import { apiTags, ErrorMessages, TokenService } from '../../shared';

import { AdminService } from './admin';
import { UserService } from './users/users.service';
import {
  InitiateSignupDTO,
  CompleteSignUpDTO,
  ForgotPinDTO,
  ResetPinDTO,
  VerifyingOtpDTO,
  UserSetPinDTO,
  LoginDto,
  RefreshTokenDTO,
  InitiatePinChangeDto,
  InitiateTwoFactorDto,
  VerifyTwoFactorDto,
  LoginTwoFactorDto,
} from './users/dto';
import { VersionedController } from '../../core/decorators';
import { AuthenticatedRequest } from '../../common';
import { AuthGuard } from '../../core';

@ApiTags('Auth')
@VersionedController(apiTags.auth)
@UseInterceptors(HttpExceptionInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminService: AdminService,
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
  ) {}

  // =====================================================
  // PUBLIC: USER SIGNUP INITIATE
  // =====================================================
  @Post('/sign-up-user')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Initiate user registration',
    description: `
## Overview
Starts the user registration process by sending an OTP (One-Time Password) 
to the user's email address.

## Required Fields
- **email**: Valid email address
- **firstName**: User's first name
- **lastName**: User's last name

## Response Details
- **message**: Success message
- **email**: Email where OTP was sent
- **expiresIn**: How long the OTP is valid

## Flow
1. User submits email and name
2. System creates pending registration
3. OTP sent to email
4. User verifies OTP at /verify-otp endpoint
5. User completes signup at /complete-signup-user

## Important Notes
- This just initiates registration - doesn't create account yet
- OTP is valid for a limited time (typically 10 minutes)
- Use the returned registration ID in subsequent steps
    `,
  })
  @ApiBody({ type: InitiateSignupDTO })
  @ApiResponse({
    status: 201,
    description: 'OTP sent to email - registration initiated',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async signUpUser(@Body() initiateSignupDTO: InitiateSignupDTO) {
    return await this.userService.initiateClientSignUp(initiateSignupDTO);
  }

  // =====================================================
  // PUBLIC: VERIFY OTP
  // =====================================================
  @Post('/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Verify OTP for signup or PIN reset',
    description: `
## Overview
Verifies the OTP sent to a user's email. The server inspects Redis to determine
if the OTP belongs to onboarding or a PIN reset request—no extra purpose field
is needed.

## Required Fields
- **email**: User's email address
- **otp**: The 6-digit code received in email

## Response Details
- **registrationId**: Returned when the OTP is for signup; required by /complete-signup-user
- **pinResetToken** & **expiresInSeconds**: Returned when the OTP belongs to a PIN reset request; token expires in 120 seconds

## Important Notes
- OTP must be entered within validity period
- PIN reset flow: call /forgot-pin → /verify-otp (response includes pinResetToken) → /reset-pin using the token
- pinResetToken replaces OTP inside the /reset-pin payload and cannot be reused once expired
- Tokens returned here do not authenticate a user
    `,
  })
  @ApiBody({ type: VerifyingOtpDTO })
  @ApiResponse({
    status: 200,
    description:
      'OTP verified. Returns registrationId (signup) or pinResetToken (forgot PIN).',
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiResponse({ status: 404, description: 'No pending registration found' })
  async verifyOtp(@Body() verifyingOtp: VerifyingOtpDTO) {
    return await this.userService.verifyOtp(verifyingOtp);
  }

  // =====================================================
  // PUBLIC: COMPLETE SIGNUP
  // =====================================================
  @Post('/complete-signup-user')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Complete user registration',
    description: `
## Overview
Completes the user registration process using the temporary token from OTP verification.

## Required Fields
- **registrationId**: From the initiate signup response
- **phoneNumber**: User's phone number
- **pin**: 6-digit PIN for account
- **dialCode**: Country dial code (e.g., +234)
- **deviceId**: Device identifier (optional)

## Response Details
- **user**: Created user details
- **tokens**: Access and refresh tokens for authentication
- **message**: Registration success message

## Important Notes
- PIN is used for transaction authorization
- Phone number format: country code + number (without leading zero)
    `,
  })
  @ApiBody({ type: CompleteSignUpDTO })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully, tokens issued',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async completeSignUpUser(
    @Body() completeSignUpDTO: CompleteSignUpDTO,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.userService.completeClientSignUp(
      completeSignUpDTO.registrationId,
      completeSignUpDTO,
    );
  }

  // =====================================================
  // PUBLIC: USER LOGIN
  // =====================================================
  @Post('login-user')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'User login with email and PIN',
    description: `
## Overview
Authenticates a user using their email and PIN.

## Required Fields
- **email**: Registered email address
- **pin**: 6-digit PIN

## Response Details
- **user**: User profile details
- **tokens**: Access and refresh tokens
- **requiresTwoFactor**: Whether 2FA is enabled (if yes, use /login-2fa endpoint)

## Important Notes
- PIN is the transaction PIN set during registration
- Access token expires - use refresh token to get new access token
- Check requiresTwoFactor flag to determine if 2FA is needed
    `,
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful, tokens issued' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async loginUser(@Body() loginDto: LoginDto) {
    return await this.userService.validateUser(loginDto);
  }

  // =====================================================
  // PUBLIC: FORGOT PIN
  // =====================================================
  @Post('/forgot-pin')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Initiate PIN reset process',
    description: `
## Overview
Starts the process of resetting a forgotten PIN by sending an OTP to the 
user's registered email.

## Required Fields
- **email**: User's registered email address

## Response Details
- **message**: Confirmation message
- **email**: Email where OTP was sent

## Important Notes
- OTP is valid for a limited time
- User must complete reset at /reset-pin endpoint
    `,
  })
  @ApiBody({ type: ForgotPinDTO })
  @ApiResponse({ status: 200, description: 'OTP sent to email' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async forgotPin(@Body() forgotPinDTO: ForgotPinDTO) {
    return this.userService.forgotPin(forgotPinDTO);
  }

  // =====================================================
  // PUBLIC: RESET PIN
  // =====================================================
  @Post('/reset-pin')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Reset PIN using pinResetToken',
    description: `
## Overview
Completes the PIN reset process by validating the short-lived pinResetToken issued immediately after /verify-otp confirms a forgot-PIN OTP.

## Required Fields
- **email**: User's registered email
- **pinResetToken**: Token returned from /verify-otp after validating the PIN reset OTP. Expires in 2 minutes.
- **newPin**: New 6-digit PIN to set

## Important Notes
- pinResetToken replaces the OTP inside this request body and can only be used once
- Token expires automatically in 120 seconds—request a new OTP and token if it times out
- New PIN cannot be the same as previous PIN
    `,
  })
  @ApiBody({ type: ResetPinDTO })
  @ApiResponse({ status: 200, description: 'PIN reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid OTP or PIN' })
  async resetPin(@Body() resetPinDTO: ResetPinDTO) {
    return this.userService.resetPin(resetPinDTO);
  }

  // =====================================================
  // PUBLIC: RESEND OTP
  // =====================================================
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Resend OTP to email',
    description: `
## Overview
Resends the OTP to the user's email. Used if the original OTP was not 
received or has expired.

## Required Fields
- **email**: User's email address

## Important Notes
- Rate limited to prevent abuse
- Original OTP becomes invalid when new one is sent
    `,
  })
  @ApiResponse({ status: 200, description: 'OTP resent successfully' })
  @ApiResponse({
    status: 400,
    description: 'Too many requests - try again later',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resendOtp(@Body('email') email: string) {
    return await this.userService.resendOtp(email);
  }

  // =====================================================
  // ADMIN: LOGIN
  // =====================================================
  @Post('/admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Admin login',
    description: `
## Overview
Authenticates an admin user using email and password.

## Required Fields
- **email**: Admin email address
- **password**: Admin password

## Response Details
- **admin**: Admin profile
- **tokens**: Access and refresh tokens with admin permissions

## Important Notes
- Different from user authentication
- Tokens contain admin role information
    `,
  })
  @ApiBody({ type: SignInDTO })
  @ApiResponse({ status: 200, description: 'Admin login successful' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async signInAdmin(@Body() credential: SignInDTO) {
    return await this.authService.validateAdmin(credential);
  }

  // =====================================================
  // ADMIN: FORGOT PASSWORD
  // =====================================================
  @Post('/admin/forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Admin - Request password reset',
    description: `
## Overview
Sends a password reset link to the admin's email.

## Required Fields
- **email**: Admin email address
    `,
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Reset link sent to email' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async adminForgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.adminForgotPassword(dto);
  }

  // =====================================================
  // ADMIN: RESET PASSWORD
  // =====================================================
  @Post('admin/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Admin - Reset password using token',
    description: `
## Overview
Completes admin password reset using the token from forgot-password email.

## Required Fields
- **token**: Reset token from email
- **newPassword**: New password to set
    `,
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid token or password' })
  async adminResetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.adminResetPassword(dto);
  }

  // =====================================================
  // PROTECTED: SET PIN
  // =====================================================
  @Post('/set-pin')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('Bearer')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Set user PIN (authenticated)',
    description: `
## Overview
Allows an authenticated user to set their transaction PIN.

## Required Fields
- **pin**: 6-digit PIN
- **confirmPin**: Confirm the PIN

## Important Notes
- User must be authenticated to call this endpoint
- PIN is used for authorizing transactions
    `,
  })
  @ApiBody({ type: UserSetPinDTO })
  @ApiResponse({ status: 200, description: 'PIN set successfully' })
  @ApiResponse({ status: 400, description: 'Invalid PIN format' })
  async setUserPin(
    @Body() userSetPinDTO: UserSetPinDTO,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.userService.setUserPin(req.user.id, userSetPinDTO);
  }

  // =====================================================
  // PROTECTED: CHANGE PIN
  // =====================================================
  @Post('/change-pin/initiate')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('Bearer')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Initiate PIN change with current PIN',
    description: `
## Overview
Starts the process of changing the user's PIN by verifying the current PIN
and sending an OTP to email.

## Required Fields
- **currentPin**: Current 6-digit PIN
    `,
  })
  @ApiBody({ type: InitiatePinChangeDto })
  @ApiResponse({
    status: 200,
    description: 'OTP sent to email for verification',
  })
  @ApiResponse({ status: 400, description: 'Invalid current PIN' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async initiatePinChange(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiatePinChangeDto,
  ) {
    return await this.userService.initiatePinChange(req.user.id, dto);
  }

  // =====================================================
  // PROTECTED: REFRESH TOKEN
  // =====================================================
  @Post('refresh-token')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Refresh access token',
    description: `
## Overview
Issues a new access token using a valid refresh token.

## Required Fields
- **refreshToken**: The refresh token from login response

## Important Notes
- Refresh tokens have a longer lifetime than access tokens
- When refresh token expires, user must log in again
    `,
  })
  @ApiBody({ type: RefreshTokenDTO })
  @ApiResponse({ status: 200, description: 'New access token issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refreshTokens(@Body() refreshTokenDTO: RefreshTokenDTO) {
    return await this.authService.refreshAccessToken(
      refreshTokenDTO.refreshToken,
    );
  }

  // =====================================================
  // PROTECTED: LOGOUT
  // =====================================================
  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Logout user',
    description: `
## Overview
Invalidates the refresh token, logging the user out.

## Required Fields
- **refreshToken**: The refresh token to invalidate

## Important Notes
- Access token remains valid until it expires
- User needs to login again to get new tokens
    `,
  })
  @ApiBody({ type: RefreshTokenDTO })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Body() refreshTokenDTO: RefreshTokenDTO) {
    return await this.authService.logout(refreshTokenDTO.refreshToken);
  }

  // =====================================================
  // PROTECTED: DELETE ACCOUNT
  // =====================================================
  @Delete('/delete-account')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request account deletion',
    description: `
## Overview
Initiates the process of deleting the user's account.

## Important Notes
- Account deletion is processed asynchronously
- All user data will be permanently removed
- This action cannot be undone
    `,
  })
  @ApiResponse({ status: 200, description: 'Account deletion requested' })
  async deleteAccount(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    return this.userService.userRequestToDeleteAccount(userId);
  }
}
