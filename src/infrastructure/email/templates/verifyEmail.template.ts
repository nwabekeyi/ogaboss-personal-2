import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

interface VerifyEmailTemplateParams {
  firstName?: string;
  otp: string;
  timeLeft: number;
  supportEmail: string;
}

export const verifyEmailTemplate = ({
  firstName,
  otp,
  timeLeft,
  supportEmail,
}: VerifyEmailTemplateParams) => {
  const bodyHtml = renderEmail('otp-verify', { otp, timeLeft });

  return renderBaseEmailTemplate({
    title: 'Verify Your Email',
    greeting: `Hello ${firstName || 'there'},`,
    intro:
      'Use the verification code below to verify your email address and activate your account.',
    supportEmail,
    bodyHtml,
  });
};

export const initiateSignupEmailTemplate = ({
  otp,
  timeLeft,
  supportEmail,
}: VerifyEmailTemplateParams) => {
  const bodyHtml = renderEmail('otp-verify', { otp, timeLeft });

  return renderBaseEmailTemplate({
    title: 'Complete Your Signup',
    greeting: 'Hello,',
    intro:
      'Use the verification code below to complete your account registration.',
    supportEmail,
    bodyHtml,
  });
};
