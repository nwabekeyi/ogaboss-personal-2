import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

interface TwoFactorTemplateParams {
  firstName?: string;
  otp: string;
  timeLeft: number;
  supportEmail: string;
}

export const enableTwoFactorEmailTemplate = ({
  firstName = 'there',
  otp,
  timeLeft,
  supportEmail,
}: TwoFactorTemplateParams) => {
  const bodyHtml = renderEmail('otp-2fa', {
    otp,
    timeLeft,
    warning:
      "If you didn't request this, please ignore this email or contact support.",
  });

  return renderBaseEmailTemplate({
    title: 'Enable Two-Factor Authentication',
    greeting: `Hello ${firstName},`,
    intro:
      'You requested to enable Two-Factor Authentication (2FA) for your account. Use the code below to confirm.',
    supportEmail,
    bodyHtml,
  });
};

export const loginTwoFactorEmailTemplate = ({
  firstName = 'there',
  otp,
  timeLeft,
  supportEmail,
}: TwoFactorTemplateParams) => {
  const bodyHtml = renderEmail('otp-2fa', {
    otp,
    timeLeft,
    warning:
      'If you did not attempt to log in, please secure your account immediately.',
  });

  return renderBaseEmailTemplate({
    title: 'Login Verification Code',
    greeting: `Hello ${firstName},`,
    intro:
      'Your login attempt requires verification. Use the code below to complete your login.',
    supportEmail,
    bodyHtml,
  });
};
