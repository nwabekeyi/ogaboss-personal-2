import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueName, EmailJobType, EmailJobPayload } from '../types';
import { EmailService } from '../../email/email.service';
import { Logger, UnauthorizedException } from '@nestjs/common';

@Processor(QueueName.EMAIL, { concurrency: 25 })
export class EmailWorker extends WorkerHost {
  private readonly logger = new Logger(EmailWorker.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { type, payload } = job.data as {
      type: EmailJobType;
      payload: EmailJobPayload;
    };

    const meta = {
      jobId: job.id,
      emailType: type,
      createdAt: job.timestamp,
    };

    try {
      switch (type) {
        case 'signup-initiate':
          await this.emailService.sendInitiateUserEmail({
            email: payload.to,
            otp: payload.otp!,
            timeLeft: payload.timeLeft!,
            meta,
          });
          break;

        case 'signup-completed':
          await this.emailService.signupCompletedEmail(
            payload.to,
            payload.firstName || 'User',
            meta,
          );
          break;

        case 'reset-pin':
          await this.emailService.sendResetPinEmail({
            email: payload.to,
            firstName: payload.firstName || 'User',
            otp: payload.otp!,
            timeLeft: payload.timeLeft!,
            supportEmail: 'support@ogaboss.finance',
            meta,
          });
          break;

        case 'pin-change-otp':
          await this.emailService.sendPinChangeOtpEmail({
            email: payload.to,
            firstName: payload.firstName || 'User',
            otp: payload.otp!,
            timeLeft: payload.timeLeft!,
            meta,
          });
          break;

        case 'enable-2fa':
          await this.emailService.sendEnableTwoFactorEmail({
            email: payload.to,
            firstName: payload.firstName || 'User',
            otp: payload.otp!,
            timeLeft: payload.timeLeft!,
            meta,
          });
          break;

        case 'login-2fa':
          await this.emailService.sendLoginTwoFactorEmail({
            email: payload.to,
            firstName: payload.firstName || 'User',
            otp: payload.otp!,
            timeLeft: payload.timeLeft!,
            meta,
          });
          break;

        case 'admin-password-reset':
          if (!payload.resetLink) {
            throw new UnauthorizedException('resetLink is required');
          }
          await this.emailService.sendAdminPasswordResetEmail({
            to: payload.to,
            firstName: payload.firstName || 'Admin',
            resetLink: payload.resetLink,
            meta,
          });
          break;

        case 'account-locked':
          await this.emailService.sendAccountLockedEmail(
            payload.to,
            payload.firstName || 'User',
            meta,
          );
          break;

        case 'transaction-notification':
          await this.emailService.sendTransactionNotificationEmail({
            to: payload.to,
            firstName: payload.firstName || 'User',
            subject: payload.subject || 'Transaction Notification',
            message:
              payload.message || 'There is an update on your transaction.',
            transactionId: payload.transactionId,
            transactionContext: payload.transactionContext,
            transactionStatus: payload.transactionStatus,
            meta,
          });
          break;

        default:
          throw new Error(`Unhandled email type: ${type}`);
      }

      this.logger.debug(`Email job completed successfully`, {
        jobId: job.id,
        type,
        to: payload.to,
      });
    } catch (error) {
      this.logger.error(
        `Failed to process email job | type: ${type} | to: ${payload.to} | jobId: ${job.id}`,
        {
          jobId: job.id,
          jobType: type,
          recipient: payload.to,
          error: error.message,
          stack: error.stack,
          payload: JSON.stringify(payload).substring(0, 200),
        },
      );
      throw error;
    }
  }
}

