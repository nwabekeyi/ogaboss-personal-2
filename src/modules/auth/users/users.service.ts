// src/modules/user/user.service.ts
import {
  ConflictException,
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure';
import {
  InitiateSignupDTO,
  CompleteSignUpDTO,
  ForgotPinDTO,
  ResetPinDTO,
  VerifyingOtpDTO,
  UserSetPinDTO,
  LoginDto,
  InitiatePinChangeDto,
  ConfirmPinChangeDto,
  InitiateTwoFactorDto,
  VerifyTwoFactorDto,
  LoginTwoFactorDto,
} from './dto';
import { ErrorMessages, OtpService, TokenService } from '../../../shared';
import { hash } from '../../../shared/services/hash';
import {
  UserType,
  Gender,
  AccountSignType,
  ModelNames,
  User,
  Status,
} from '../../../infrastructure';
import {
  Prisma,
  TokenType,
} from '../../../infrastructure/databases/prisma/generated/prisma/client';
import { EmailJobType } from '../../../infrastructure/bullMQ';
import { TempStoreService } from '../../../infrastructure';
import { DashboardStatsQueueService } from '../../..//modules/dashboard/dashboard-stats-queue';
import { QueueService } from '../../../infrastructure/bullMQ/bullmq.service';
import { CaptchaService } from '../../../infrastructure/captcha/captcha.service';
import { FirebaseCloudMessagingService } from '../../../infrastructure/providers/firebase/firebase-cloud-messaging.service';
import { v4 as uuidv4 } from 'uuid';

type Tx = Prisma.TransactionClient;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  private readonly REGISTRATION_TTL = 24 * 60 * 60; // 24 hours in seconds
  private readonly REG_KEY = (id: string) => `registration:${id}`;
  private readonly PIN_RESET_TOKEN_TTL_SECONDS = 5 * 60; // 2 minutes
  private readonly PIN_RESET_TOKEN_KEY = (email: string) =>
    `pin_reset_token:${email.trim().toLowerCase()}`;

  // Rate limiting for PIN change
  private readonly MAX_ATTEMPTS = 4;
  private readonly ATTEMPT_TTL_SECONDS = 30 * 60; // 30 mins
  private readonly PIN_CHANGE_ATTEMPT_KEY = (userId: string) =>
    `pin_change_attempts:${userId}`;
  // Login attempt tracking (5 attempts in 5 minutes)
  private readonly LOGIN_ATTEMPT_LIMIT = 5;
  private readonly LOGIN_ATTEMPT_TTL_SECONDS = 5 * 60;
  private readonly LOGIN_ATTEMPT_KEY = (userId: string) =>
    `login_attempts:${userId}`;
  private readonly RESEND_COOLDOWN_SECONDS = 60;
  private readonly RESEND_MAX_PER_HOUR = 5;
  private readonly RESEND_KEY_PREFIX = 'resend_otp_attempts:';

  constructor(
    private readonly captchaService: CaptchaService,
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly tempStoreService: TempStoreService,
    private readonly queueService: QueueService,
    private readonly dashboardStatsQueueService: DashboardStatsQueueService,
    private readonly fcmService: FirebaseCloudMessagingService,
  ) {}

  // ── Helper: Find User ─────────────────────────────────────────────
  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  private mergeMetaData(existing: any, patch: Record<string, any>) {
    return {
      ...existing,
      metaData: {
        ...(existing?.metaData ?? {}),
        ...patch,
      },
    };
  }

  async getUserById(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        userType: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { ...user, userType: user.userType };
  }

  // ── 1. Initiate Signup (Send OTP) ─────────────────────────────────
  async initiateClientSignUp(dto: InitiateSignupDTO, ip?: string) {
    const { email, captchaToken } = dto;

    // Verify CAPTCHA FIRST
    // await this.captchaService.verify(captchaToken, ip);

    await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser)
        throw new ConflictException('Account already exists for this email.');

      const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
        email,
        600,
        undefined,
        'signup',
      );

      // ASYNC EMAIL VIA BULLMQ — NEVER BLOCKS
      this.queueService.sendTransactionalEmail(EmailJobType.SIGNUP_INITIATE, {
        to: email,
        otp,
        timeLeft,
      });
    });

    return {
      success: true,
      message: 'Verification code sent',
      data: { email },
    };
  }

  // ── Resend OTP for unauthenticated onboarding users ───────────────────────
  async resendOnboardingOtp(email: string, captchaToken: string, ip?: string) {
    const normalizedEmail = email.trim().toLowerCase();

    await this.captchaService.verify(captchaToken, ip);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { isEmailVerified: true },
    });

    if (existingUser?.isEmailVerified) {
      throw new BadRequestException(
        'This email is already verified. Please log in.',
      );
    }

    const rateKey = this.RESEND_KEY_PREFIX + normalizedEmail;
    const attemptsRaw = await this.tempStoreService.get(rateKey);
    let attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;

    if (attempts >= this.RESEND_MAX_PER_HOUR) {
      throw new BadRequestException(
        'Too many resend requests. Please try again in 1 hour or contact support.',
      );
    }

    const lastResendKey = `last_resend:${normalizedEmail}`;
    const lastResend = await this.tempStoreService.get(lastResendKey);

    if (lastResend) {
      const lastTime = new Date(lastResend).getTime();
      const now = Date.now();
      const secondsLeft =
        this.RESEND_COOLDOWN_SECONDS - Math.floor((now - lastTime) / 1000);

      if (secondsLeft > 0) {
        return {
          success: false,
          message: `Please wait ${secondsLeft} seconds before requesting a new code.`,
          retryAfter: secondsLeft,
        };
      }
    }

    const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
      normalizedEmail,
      600,
      undefined,
      'signup',
    );

    attempts += 1;
    await this.tempStoreService.set(rateKey, attempts.toString(), 3600);
    await this.tempStoreService.set(
      lastResendKey,
      new Date().toISOString(),
      this.RESEND_COOLDOWN_SECONDS,
    );

    this.queueService.sendTransactionalEmail(EmailJobType.SIGNUP_INITIATE, {
      to: normalizedEmail,
      otp,
      timeLeft,
    });

    return {
      success: true,
      message: 'A new verification code has been sent to your email.',
      data: {
        email: normalizedEmail,
        retryAfter: this.RESEND_COOLDOWN_SECONDS,
      },
    };
  }

  async verifyOtp(dto: VerifyingOtpDTO) {
    const { email, otp } = dto;
    const normalizedEmail = email.trim().toLowerCase();
    const pinResetOtpKey = `otp:pin_reset:${normalizedEmail}`;
    const pinResetOtp = await this.tempStoreService.get(pinResetOtpKey);

    if (pinResetOtp) {
      const isPinResetValid = await this.otpService.verifyOtp({
        otp,
        email: normalizedEmail,
        purpose: 'pin_reset',
      });
      if (!isPinResetValid)
        throw new BadRequestException('Invalid or expired OTP');

      const pinResetToken = uuidv4();

      await this.tempStoreService.set(
        this.PIN_RESET_TOKEN_KEY(normalizedEmail),
        pinResetToken,
        this.PIN_RESET_TOKEN_TTL_SECONDS,
      );

      return {
        success: true,
        message:
          'OTP verified. Use the pinResetToken within 2 minutes to reset your PIN.',
        data: {
          pinResetToken,
          expiresInSeconds: this.PIN_RESET_TOKEN_TTL_SECONDS,
        },
      };
    }

    const isValid = await this.otpService.verifyOtp({
      otp,
      email: normalizedEmail,
      purpose: 'signup',
    });
    if (!isValid) throw new BadRequestException('Invalid or expired OTP');

    const emailLookupKey = `reg_lookup:${normalizedEmail}`;
    const existingRegId = await this.tempStoreService.get(emailLookupKey);

    if (existingRegId) {
      // Delete the old registration session to prevent multiple active links
      await this.tempStoreService.del(this.REG_KEY(existingRegId));
    }

    const registrationId = uuidv4();

    await this.tempStoreService.set(
      this.REG_KEY(registrationId),
      JSON.stringify({ email: normalizedEmail, verifiedAt: new Date() }),
      this.REGISTRATION_TTL,
    );

    return {
      success: true,
      message: 'OTP verified',
      data: { registrationId },
    };
  }

  // ── 3. Complete Signup (Profile) ──────────────────────────────────
  async completeClientSignUp(registrationId: string, dto: CompleteSignUpDTO) {
    const regDataRaw = await this.tempStoreService.get(
      this.REG_KEY(registrationId),
    );

    if (!regDataRaw) {
      throw new BadRequestException(
        'Registration session expired or invalid. Please restart signup.',
      );
    }

    const regData =
      typeof regDataRaw === 'string' ? JSON.parse(regDataRaw) : regDataRaw;

    const { email } = regData;

    const dateOfBirthStr = dto.dateOfBirth.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirthStr)) {
      throw new BadRequestException('Date of birth must be YYYY-MM-DD');
    }

    const dateOfBirth = new Date(dateOfBirthStr + 'T00:00:00.000Z');
    if (isNaN(dateOfBirth.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    const result = await this.prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new ConflictException('Account already exists');

      const newUser = await tx.user.create({
        data: {
          email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phoneNumber: dto.phoneNumber,
          country: dto.country,
          gender: dto.gender as Gender,
          dateOfBirth,
          residentialAddress: dto.residentialAddress,
          isEmailVerified: true,
        },
      });

      // Create Metadata in General table
      await tx.general.create({
        data: {
          tableID: newUser.id,
          tableName: ModelNames.USER,
          associatedData: {
            type: 'metaData',
            metaData: {
              signType: AccountSignType.DIRECT,
              lastLoginDate: new Date(),
              passwordChangedAt: [],
              onboardingCompletedAt: new Date(),
            },
          },
        },
      });

      // Generate Access and Refresh tokens
      const tokens = await this.tokenService.generateTokens({
        id: newUser.id,
        userType: UserType.INDIVIDUAL,
      });

      await tx.token.create({
        data: {
          userId: newUser.id,
          token: tokens.refreshToken,
          type: TokenType.REFRESH,
          userType: UserType.INDIVIDUAL,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 Days
        },
      });

      return { user: newUser, tokens };
    });

    //Cleanup: Delete registration data from Redis only after DB success
    await this.tempStoreService.del(this.REG_KEY(registrationId));

    return {
      success: true,
      message: 'Profile completed successfully. Proceed to set your PIN.',
      data: {
        email: result.user.email,
        ...result.tokens,
      },
    };
  }

  // ── 4. Set PIN ───────────────────────────────────────────────
  async setUserPin(userId: string, dto: UserSetPinDTO) {
    const { pin, deviceToken, devicePlatform, deviceName } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.pin) throw new BadRequestException('PIN already set');

    const hashedPin = await hash(pin.trim(), 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pin: hashedPin,
        status: Status.ACTIVE,
      },
    });

    if (deviceToken && devicePlatform) {
      await this.fcmService.addDeviceToken(
        userId,
        deviceToken,
        devicePlatform,
        deviceName,
      );
    }

    await this.prisma.userDailyPercentage.create({
      data: {
        userId: user.id,
        percentChangeYesterday: 0,
        previousTotal: 0,
        netChange: 0,
        calculatedAt: new Date(),
      },
    });

    const now = new Date();

    // Update passwordChangedAt metadata
    const meta = await this.prisma.general.findFirst({
      where: { tableID: user.id, tableName: ModelNames.USER },
    });

    if (meta?.associatedData) {
      const currentHistory =
        (meta.associatedData as any)?.metaData?.passwordChangedAt ?? [];
      const updatedAssociatedData = this.mergeMetaData(meta.associatedData, {
        passwordChangedAt: [...currentHistory, now],
      });

      await this.prisma.general.updateMany({
        where: { tableID: user.id, tableName: ModelNames.USER },
        data: { associatedData: updatedAssociatedData },
      });
    }

    await this.dashboardStatsQueueService.queueUserUpdate({
      added: true,
      createdAt: user.createdAt.toISOString(),
      status: Status.ACTIVE,
    });

    // Async side effects
    this.queueService.createQuidaxSubaccount({
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    this.queueService.sendTransactionalEmail(EmailJobType.SIGNUP_COMPLETED, {
      to: user.email,
      userId: user.id,
      firstName: user.firstName!,
    });

    await this.fcmService.sendNotification({
      userId: user.id,
      title: 'Welcome to Ogaboss!',
      body: 'Your account has been created successfully. Welcome aboard!',
      data: { type: 'signup_completed' },
    });

    return { message: 'PIN set successfully. Your account is now active!' };
  }

  // ── 5. Forgot PIN → Queue Reset OTP Email ─────────────────────────
  async forgotPin(dto: ForgotPinDTO) {
    const { email } = dto;
    const normalizedEmail = email.trim().toLowerCase();

    const rateKey = `forgot_pin_attempts:${normalizedEmail}`;
    const attemptsRaw = await this.tempStoreService.get(rateKey);
    let attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;

    if (attempts >= this.RESEND_MAX_PER_HOUR) {
      throw new BadRequestException(
        'Too many requests. Please try again in 1 hour or contact support.',
      );
    }

    const user = await this.findUserByEmail(normalizedEmail);
    if (!user) {
      return { message: 'If an account exists, a reset OTP will be sent' };
    }

    const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
      user.email,
      600,
      undefined,
      'pin_reset',
    );

    attempts += 1;
    await this.tempStoreService.set(rateKey, attempts.toString(), 3600);

    this.queueService.sendTransactionalEmail(EmailJobType.RESET_PIN, {
      to: user.email,
      userId: user.id,
      firstName: user.firstName || 'User',
      otp,
      timeLeft,
    });

    await this.fcmService.sendNotification({
      userId: user.id,
      title: 'PIN Reset Request',
      body: `Your PIN reset code is ${otp}. Valid for ${timeLeft} minutes.`,
      data: { type: 'pin_reset' },
    });

    return { message: 'Pin reset OTP sent' };
  }

  // ── 6. Reset PIN (after OTP) ─────────────────────────────────────
  async resetPin(dto: ResetPinDTO) {
    const { pinResetToken, newPin, email } = dto;
    const normalizedEmail = email.trim().toLowerCase();
    const pinResetTokenKey = this.PIN_RESET_TOKEN_KEY(normalizedEmail);

    await this.prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (!user) throw new NotFoundException(ErrorMessages.USER_NOT_FOUND);

      const storedToken = await this.tempStoreService.get(pinResetTokenKey);
      if (!storedToken || storedToken !== pinResetToken) {
        throw new BadRequestException('Invalid or expired PIN reset token');
      }

      const hashed = await hash(newPin, 10);
      await tx.user.update({
        where: { email: normalizedEmail },
        data: { pin: hashed },
      });

      // ── Update passwordChangedAt in metadata ──
      const meta = await tx.general.findFirst({
        where: { tableID: user.id, tableName: ModelNames.USER },
      });

      if (meta?.associatedData) {
        const currentHistory =
          (meta.associatedData as any)?.metaData?.passwordChangedAt ?? [];
        const updatedAssociatedData = this.mergeMetaData(meta.associatedData, {
          passwordChangedAt: [...currentHistory, new Date()],
        });

        await tx.general.updateMany({
          where: { tableID: user.id, tableName: ModelNames.USER },
          data: { associatedData: updatedAssociatedData },
        });
      }
    });

    await this.tempStoreService.del(pinResetTokenKey);

    return { message: 'PIN reset successfully' };
  }

  // ── 7. Login (Validate User) ─────────────────────────────────────
  async validateUser(dto: LoginDto) {
    const { email, pin, deviceToken, devicePlatform, deviceName } = dto;

    // 1. Find user and perform security checks
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email.trim(),
          mode: 'insensitive',
        },
      },
    });

    if (!user) throw new NotFoundException(ErrorMessages.INCORRECT_CREDENTIALS);
    if (!user.pin) throw new BadRequestException('Set PIN first');

    // Prevent login for deleted users
    if (user.status === Status.DELETED) {
      throw new ForbiddenException('This account does not exist.');
    }

    const valid = await this.tokenService.compareHash(pin, user.pin);
    if (!valid) {
      const attempts = await this.recordFailedLoginAttempt(user.id);

      if (attempts >= this.LOGIN_ATTEMPT_LIMIT) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            status: Status.FLAGGED,
            flaggedReason:
              'Account locked due to multiple failed login attempts',
          },
        });
      }

      throw new BadRequestException('Invalid credentials');
    }

    await this.clearLoginAttempts(user.id);

    if (user.isTwoFactorEnabled) {
      return await this.sendLoginTwoFactorOtp(user.id);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // ── Update last login metadata ──
      const meta = await tx.general.findFirst({
        where: {
          tableID: user.id,
          tableName: ModelNames.USER,
        },
      });

      if (meta) {
        const updatedAssociatedData = this.mergeMetaData(meta.associatedData, {
          lastLoginDate: new Date(),
        });

        await tx.general.update({
          where: { id: meta.id },
          data: { associatedData: updatedAssociatedData },
        });
      }

      // ── Generate new tokens ──
      const tokens = await this.tokenService.generateTokens({
        id: user.id,
        userType: user.userType,
      });

      // ── Upsert Refresh Token ──
      await tx.token.upsert({
        where: {
          userId_type: {
            userId: user.id,
            type: 'REFRESH' as any,
          },
        },
        create: {
          token: tokens.refreshToken,
          type: 'REFRESH' as any,
          userId: user.id,
          userType: user.userType,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
        update: {
          token: tokens.refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
      });

      return {
        success: true,
        message: 'Login successful',
        data: {
          user: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userType: user.userType,
            isVerified: user.isEmailVerified,
            isTwoFactorEnabled: user.isTwoFactorEnabled,
          },
          ...tokens,
        },
      };
    });

    if (deviceToken && devicePlatform) {
      await this.fcmService.addDeviceToken(
        user.id,
        deviceToken,
        devicePlatform,
        deviceName,
      );
    }

    return result;
  }

  // ── 8. Resend OTP ────────────────────────────────────────────────
  async resendOtp(email: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { isEmailVerified: true },
    });

    if (existingUser?.isEmailVerified) {
      throw new BadRequestException(
        'This email is already verified. Please log in.',
      );
    }

    const rateKey = this.RESEND_KEY_PREFIX + normalizedEmail;
    const attemptsRaw = await this.tempStoreService.get(rateKey);
    let attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;

    if (attempts >= this.RESEND_MAX_PER_HOUR) {
      throw new BadRequestException(
        'Too many resend requests. Please try again in 1 hour or contact support.',
      );
    }

    const lastResendKey = `last_resend:${normalizedEmail}`;
    const lastResend = await this.tempStoreService.get(lastResendKey);

    if (lastResend) {
      const lastTime = new Date(lastResend).getTime();
      const now = Date.now();
      const secondsLeft =
        this.RESEND_COOLDOWN_SECONDS - Math.floor((now - lastTime) / 1000);

      if (secondsLeft > 0) {
        return {
          success: false,
          message: `Please wait ${secondsLeft} seconds before requesting a new code.`,
          retryAfter: secondsLeft,
        };
      }
    }

    const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
      normalizedEmail,
      600,
      undefined,
      'signup',
    );

    attempts += 1;
    await this.tempStoreService.set(rateKey, attempts.toString(), 3600); // 1h
    await this.tempStoreService.set(
      lastResendKey,
      new Date().toISOString(),
      this.RESEND_COOLDOWN_SECONDS,
    );

    this.queueService.sendTransactionalEmail(EmailJobType.SIGNUP_INITIATE, {
      to: normalizedEmail,
      otp,
      timeLeft,
    });

    return {
      success: true,
      message: 'A new verification code has been sent to your email.',
      data: {
        email: normalizedEmail,
        retryAfter: this.RESEND_COOLDOWN_SECONDS,
      },
    };
  }

  // ── 9. Initiate PIN Change (with rate limiting) ──────────────────
  async initiatePinChange(userId: string, dto: InitiatePinChangeDto) {
    const { currentPin } = dto;
    const user = await this.getUserById(userId);
    if (!user.pin) throw new BadRequestException('No PIN set');
    if (user.status === Status.DELETED) {
      throw new ForbiddenException('This account has been deleted');
    }

    if (user.status === Status.FLAGGED) {
      throw new ForbiddenException('This account is flagged. Contact support.');
    }
    const isValid = await this.tokenService.compareHash(currentPin, user.pin);
    if (!isValid) {
      const attempts = await this.incrementPinChangeAttempts(userId);
      if (attempts >= this.MAX_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { status: Status.FLAGGED },
        });
        this.queueService.sendTransactionalEmail(EmailJobType.ACCOUNT_LOCKED, {
          to: user.email,
          userId: user.id,
          firstName: user.firstName || 'User',
        });

        await this.fcmService.sendNotification({
          userId: user.id,
          title: 'Account Locked',
          body: 'Your account has been locked due to too many failed PIN attempts. Please try again in 30 minutes.',
          data: { type: 'account_locked' },
        });
        throw new BadRequestException(
          'Too many attempts. Account locked for 30 minutes.',
        );
      }
      throw new BadRequestException(
        `${this.MAX_ATTEMPTS - attempts} attempts remaining`,
      );
    }

    const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
      user.email,
      600,
      undefined,
      'pin_change',
    );

    this.queueService.sendTransactionalEmail(EmailJobType.PIN_CHANGE_OTP, {
      to: user.email,
      userId: user.id,
      firstName: user.firstName || 'User',
      otp,
      timeLeft,
    });

    await this.fcmService.sendNotification({
      userId: user.id,
      title: 'PIN Change Request',
      body: `Your PIN change code is ${otp}. Valid for ${timeLeft} minutes.`,
      data: { type: 'pin_change' },
    });

    await this.tempStoreService.del(this.PIN_CHANGE_ATTEMPT_KEY(userId));
    return { success: true, message: 'OTP sent to your email', timeLeft };
  }

  // ── 9b. Confirm PIN Change (after OTP) ───────────────────────────────
  async confirmPinChange(userId: string, dto: ConfirmPinChangeDto) {
    const { otp, newPin } = dto;

    const user = await this.getUserById(userId);

    const isValid = await this.otpService.verifyOtp({
      otp,
      email: user.email,
      purpose: 'pin_change',
    });
    if (!isValid) throw new BadRequestException('Invalid OTP');

    const hashed = await hash(newPin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pin: hashed },
    });

    await this.tempStoreService.del(this.PIN_CHANGE_ATTEMPT_KEY(userId));

    return { success: true, message: 'PIN changed successfully' };
  }

  private async recordFailedLoginAttempt(userId: string): Promise<number> {
    const key = this.LOGIN_ATTEMPT_KEY(userId);
    const currentValue = await this.tempStoreService.get<string>(key);
    const attempts = (parseInt(currentValue || '0', 10) + 1).toString();

    await this.tempStoreService.set(
      key,
      attempts,
      this.LOGIN_ATTEMPT_TTL_SECONDS,
    );

    return parseInt(attempts, 10);
  }

  private async clearLoginAttempts(userId: string): Promise<void> {
    await this.tempStoreService.del(this.LOGIN_ATTEMPT_KEY(userId));
  }

  private async incrementPinChangeAttempts(userId: string): Promise<number> {
    const key = this.PIN_CHANGE_ATTEMPT_KEY(userId);
    const current = await this.tempStoreService.get(key);
    const attempts = (parseInt(current || '0') + 1).toString();
    await this.tempStoreService.set(key, attempts, this.ATTEMPT_TTL_SECONDS);
    return parseInt(attempts);
  }

  // ── 10. Request Account Deletion ─────────────────────────────────
  async userRequestToDeleteAccount(userId: string) {
    const user = await this.getUserById(userId);

    // Update cache regardless of current status
    await this.dashboardStatsQueueService.queueUserUpdate({
      added: false,
      createdAt: user.createdAt.toISOString(),
      status: Status.DELETED,
    });
    // Mark as DELETED in DB
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: Status.DELETED },
    });

    return {
      message: 'Deletion request processed. Your account is now deactivated.',
    };
  }

  // ── 11. Initiate 2FA (Send OTP to enable) ─────────────────────────
  async initiateTwoFactor(userId: string, dto: InitiateTwoFactorDto) {
    const { currentPin } = dto;
    const user = await this.getUserById(userId);

    if (user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    if (!user.pin) {
      throw new BadRequestException('Set PIN first before enabling 2FA');
    }

    const isValid = await this.tokenService.compareHash(currentPin, user.pin);
    if (!isValid) {
      throw new BadRequestException('Invalid PIN');
    }

    const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
      user.email,
      600,
      undefined,
      'enable_2fa',
    );

    this.queueService.sendTransactionalEmail(EmailJobType.ENABLE_2FA, {
      to: user.email,
      userId: user.id,
      firstName: user.firstName || 'User',
      otp,
      timeLeft,
    });

    await this.fcmService.sendNotification({
      userId: user.id,
      title: 'Enable 2FA',
      body: `Your 2FA verification code is ${otp}. Valid for ${timeLeft} minutes.`,
      data: { type: 'enable_2fa' },
    });

    return {
      success: true,
      message: 'Verification code sent to your email. Use it to enable 2FA.',
      timeLeft,
    };
  }

  // ── 12. Verify and Enable 2FA ─────────────────────────────────────
  async verifyTwoFactor(userId: string, dto: VerifyTwoFactorDto) {
    const { otp } = dto;
    const user = await this.getUserById(userId);

    if (user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    const isValid = await this.otpService.verifyOtp({
      otp,
      email: user.email,
      purpose: 'enable_2fa',
    });

    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isTwoFactorEnabled: true },
    });

    return {
      success: true,
      message: 'Two-Factor Authentication enabled successfully',
    };
  }

  // ── 13. Disable 2FA (Protected) ─────────────────────────────────
  async disableTwoFactor(userId: string, dto: InitiateTwoFactorDto) {
    const { currentPin } = dto;
    const user = await this.getUserById(userId);

    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    const isValid = await this.tokenService.compareHash(currentPin, user.pin);
    if (!isValid) {
      throw new BadRequestException('Invalid PIN');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isTwoFactorEnabled: false },
    });

    return {
      success: true,
      message: 'Two-Factor Authentication disabled successfully',
    };
  }

  // ── 14. Verify Login 2FA ──────────────────────────────────────────
  async verifyLoginTwoFactor(dto: LoginTwoFactorDto) {
    const { email, otp, deviceToken, devicePlatform, deviceName } = dto;

    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email.trim(),
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      throw new NotFoundException(ErrorMessages.USER_NOT_FOUND);
    }

    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled for this user');
    }

    const isValid = await this.otpService.verifyOtp({
      otp,
      email: user.email,
      purpose: 'login_2fa',
    });

    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const meta = await tx.general.findFirst({
        where: {
          tableID: user.id,
          tableName: ModelNames.USER,
        },
      });

      if (meta) {
        const updatedAssociatedData = this.mergeMetaData(
          meta.associatedData,
          {
            lastLoginDate: new Date(),
          },
        );

        await tx.general.update({
          where: { id: meta.id },
          data: { associatedData: updatedAssociatedData },
        });
      }

      const tokens = await this.tokenService.generateTokens({
        id: user.id,
        userType: user.userType,
      });

      await tx.token.upsert({
        where: {
          userId_type: {
            userId: user.id,
            type: 'REFRESH' as any,
          },
        },
        create: {
          token: tokens.refreshToken,
          type: 'REFRESH' as any,
          userId: user.id,
          userType: user.userType,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
        update: {
          token: tokens.refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
      });

      return {
        success: true,
        message: 'Login successful',
        data: {
          user: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userType: user.userType,
            isVerified: user.isEmailVerified,
            isTwoFactorEnabled: user.isTwoFactorEnabled,
          },
          ...tokens,
        },
      };
    });

    if (deviceToken && devicePlatform) {
      await this.fcmService.addDeviceToken(
        user.id,
        deviceToken,
        devicePlatform,
        deviceName,
      );
    }

    return result;
  }

  // ── 15. Send Login 2FA OTP (Internal - called from login) ────────
  async sendLoginTwoFactorOtp(userId: string) {
    const user = await this.getUserById(userId);

    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled for this user');
    }

    const { emailOtp: otp, timeLeft } = await this.otpService.issueOtp(
      user.email,
      300,
      undefined,
      'login_2fa',
    );

    this.queueService.sendTransactionalEmail(EmailJobType.LOGIN_2FA, {
      to: user.email,
      userId: user.id,
      firstName: user.firstName || 'User',
      otp,
      timeLeft,
    });

    await this.fcmService.sendNotification({
      userId: user.id,
      title: 'Login Verification',
      body: `Your login verification code is ${otp}. Valid for ${timeLeft} minutes.`,
      data: { type: 'login_2fa' },
    });

    return {
      requiresTwoFactor: true,
      message: 'Verification code sent to your email',
    };
  }
}
