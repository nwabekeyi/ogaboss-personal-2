// src/infrastructure/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  resetPasswordTemplate,
  verifyEmailTemplate,
  initiateSignupEmailTemplate,
  resetPinTemplate,
  accountLockedEmailTemplate,
  pinChangeOtpEmailTemplate,
  adminPasswordResetTemplate,
  transactionNotificationTemplate,
  enableTwoFactorEmailTemplate,
  loginTwoFactorEmailTemplate,
  signupCompletedEmailTemplate,
} from './templates';
import { SendMailClient } from 'zeptomail';
import { config } from '../../config';

/** ZeptoMail expects Authorization value `Zoho-enczapikey <key>` (see SDK getHeader). */
function normalizeZeptoMailAuthorizationToken(token: string): string {
  const trimmed = token.trim();
  if (/^Zoho-enczapikey\s+/i.test(trimmed)) {
    return trimmed;
  }
  return `Zoho-enczapikey ${trimmed}`;
}

function formatZeptoSendError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function zeptoRequestIdFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const data = (result as { data?: Array<{ request_id?: string }> }).data;
  return data?.[0]?.request_id;
}

/** ZeptoMail SDK uses node-fetch without a timeout; outbound calls can hang indefinitely on some hosts. */
const ZEPTO_MAIL_SEND_TIMEOUT_MS = 25_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private client: SendMailClient;
  private readonly senderAddress: string;
  private readonly senderName: string;

  constructor(private readonly configService: ConfigService) {
    const zeptoConfig = config.client.mailClient.zeptoMail;

    this.senderAddress = zeptoConfig.sender.trim();
    this.senderName = 'Ogaboss Team';

    if (!zeptoConfig.token) {
      throw new Error('ZeptoMail token missing');
    }

    this.client = new SendMailClient({
      url: zeptoConfig.url || 'https://api.zeptomail.com/v1.1/email',
      token: normalizeZeptoMailAuthorizationToken(zeptoConfig.token),
    });
  }

  private async sendMail(
    to: string,
    subject: string,
    html: string,
    text?: string,
    meta?: Record<string, any>,
  ) {
    const jobId = meta?.jobId || 'unknown';
    const emailType = meta?.emailType || 'unknown';

    try {
      this.logger.log(
        `ZeptoMail sendMail start to=${to} subject="${subject}" htmlLength=${html?.length ?? 0}`,
      );

      const result = await withTimeout(
        this.client.sendMail({
          from: {
            address: this.senderAddress,
            name: this.senderName,
          },
          to: [
            {
              email_address: { address: to, name: to },
            },
          ],
          subject,
          textbody: text || subject,
          htmlbody: html,
          track_opens: true,
          track_clicks: true,
        }),
        ZEPTO_MAIL_SEND_TIMEOUT_MS,
        'ZeptoMail sendMail',
      );

      const requestId = zeptoRequestIdFromResult(result);
      this.logger.log(
        `Email sent successfully to ${to}${requestId ? ` request_id=${requestId}` : ''}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${to}: ${formatZeptoSendError(error)}`,
      );
      throw error;
    }
  }

  // ── Existing Methods (unchanged) ──────────────────────────────────
   async sendInitiateUserEmail({
     email,
     otp,
     timeLeft,
     meta,
   }: {
     email: string;
     otp: string;
     timeLeft: number;
     meta?: Record<string, any>;
   }) {
     try {
       this.logger.log(`Sending initiate user email to ${email}`);
       const supportEmail = this.configService.get('defaults.supportEmail');
       const html = initiateSignupEmailTemplate({ otp, timeLeft, supportEmail });
       this.logger.log(
         `ZeptoMail sendMail start to=${email} subject="Complete Your Signup" htmlLength=${html?.length ?? 0}`,
       );
       this.logger.log(`ZeptoMail sendMail body: ${html}`);
       const result = await this.sendMail(email, 'Complete Your Signup', html, `Code: ${otp}`, meta);
       this.logger.log(`ZeptoMail sendMail success to=${email} request_id=${result}`);
       return result;
     } catch (error) {
       this.logger.error(`Error sending initiate user email to ${email}`, error);
       throw error;
     }
   }

  async sendVerifyEmail({
    email,
    firstName,
    otp,
    timeLeft,
    meta,
  }: {
    email: string;
    firstName: string;
    otp: string;
    timeLeft: number;
    meta?: Record<string, any>;
  }) {
    const supportEmail = this.configService.get('defaults.supportEmail');
    const html = verifyEmailTemplate({
      firstName,
      otp,
      timeLeft,
      supportEmail,
    });
    return this.sendMail(
      email,
      'Verify Your Email',
      html,
      `Code: ${otp}`,
      meta,
    );
  }

  async sendPasswordResetEmail({
    email,
    firstName,
    otp,
    timeLeft,
    supportEmail,
    meta,
  }: any) {
    const html = resetPasswordTemplate({
      firstName,
      otp,
      timeLeft,
      supportEmail,
    });
    return this.sendMail(email, 'Password Reset', html, `Code: ${otp}`, meta);
  }

  async sendResetPinEmail({
    email,
    firstName,
    otp,
    timeLeft,
    supportEmail,
    meta,
  }: any) {
    const html = resetPinTemplate({ firstName, otp, timeLeft, supportEmail });
    return this.sendMail(email, 'PIN Reset', html, `Code: ${otp}`, meta);
  }

   // ── NEW: Account Locked Email ───────────────────────────────────
   async sendAccountLockedEmail(
     email: string,
     firstName?: string,
     meta?: Record<string, any>,
   ) {
     const supportEmail = this.configService.get('defaults.supportEmail');
     const subject = 'Account Locked – Too Many Attempts';
     const text =
       'Your account is locked for 30 minutes due to too many failed PIN change attempts.';
     const html = accountLockedEmailTemplate({ firstName, supportEmail });

     return this.sendMail(email, subject, html, text, meta);
   }

  // ── NEW: PIN Change OTP Email ───────────────────────────────────
  async sendPinChangeOtpEmail({
    email,
    firstName,
    otp,
    timeLeft,
    meta,
  }: {
    email: string;
    firstName?: string;
    otp: string;
    timeLeft: number;
    meta?: Record<string, any>;
  }) {
    const supportEmail = this.configService.get('defaults.supportEmail');
    const subject = 'Change Your PIN – Verification Code';
    const text = `Your PIN change code: ${otp}. Expires in ${timeLeft} minutes.`;
    const html = pinChangeOtpEmailTemplate({
      firstName,
      otp,
      timeLeft,
      supportEmail,
    });

    return this.sendMail(email, subject, text, html, meta);
  }

  async sendEnableTwoFactorEmail({
    email,
    firstName,
    otp,
    timeLeft,
    meta,
  }: {
    email: string;
    firstName?: string;
    otp: string;
    timeLeft: number;
    meta?: Record<string, any>;
  }) {
    const supportEmail = this.configService.get('defaults.supportEmail');
    const subject = 'Enable Two-Factor Authentication';
    const text = `Your 2FA verification code: ${otp}. Expires in ${timeLeft} minutes.`;
    const html = enableTwoFactorEmailTemplate({
      firstName,
      otp,
      timeLeft,
      supportEmail,
    });

    return this.sendMail(email, subject, text, html, meta);
  }

  async sendLoginTwoFactorEmail({
    email,
    firstName,
    otp,
    timeLeft,
    meta,
  }: {
    email: string;
    firstName?: string;
    otp: string;
    timeLeft: number;
    meta?: Record<string, any>;
  }) {
    const supportEmail = this.configService.get('defaults.supportEmail');
    const subject = 'Login Verification Code';
    const text = `Your login verification code: ${otp}. Expires in ${timeLeft} minutes.`;
    const html = loginTwoFactorEmailTemplate({
      firstName,
      otp,
      timeLeft,
      supportEmail,
    });

    return this.sendMail(email, subject, text, html, meta);
  }

  // ── Other Methods (signupCompletedEmail, etc.) ──────────────────
  async signupCompletedEmail(
    to: string,
    username: string,
    meta?: Record<string, any>,
  ) {
    const subject = 'Welcome to Ogaboss!';
    const html = signupCompletedEmailTemplate(username);
    return this.sendMail(to, subject, html, `Welcome!`, meta);
  }

  //admin password reset request
  async sendAdminPasswordResetEmail({
    to,
    firstName,
    resetLink,
    meta,
  }: {
    to: string;
    firstName: string;
    resetLink: string;
    meta?: Record<string, any>;
  }) {
    const supportEmail =
      this.configService.get('defaults.supportEmail') ||
      'support@ogaboss.finance';
    const subject = 'Admin Password Reset Request';

    const html = adminPasswordResetTemplate({
      firstName: firstName || 'Admin',
      resetLink,
      supportEmail,
    });
    return this.sendMail(
      to,
      subject,
      `Reset your admin password: ${resetLink}`,
      html,
      meta,
    );
  }

  async sendTransactionNotificationEmail({
    to,
    firstName,
    subject,
    message,
    transactionId,
    transactionContext,
    transactionStatus,
    meta,
  }: {
    to: string;
    firstName?: string;
    subject: string;
    message: string;
    transactionId?: string;
    transactionContext?: string;
    transactionStatus?: string;
    meta?: Record<string, any>;
  }) {
    const html = transactionNotificationTemplate({
      firstName,
      message,
      transactionId,
      transactionContext,
      transactionStatus,
    });

    return this.sendMail(to, subject, message, html, meta);
  }
}
