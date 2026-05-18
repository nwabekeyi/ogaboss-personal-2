import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

export const resetPasswordTemplate = ({
  firstName,
  otp,
  timeLeft,
  supportEmail,
}: {
  firstName: string;
  otp: string;
  timeLeft: number;
  supportEmail: string;
}) => {
  const bodyHtml = renderEmail('otp-reset-password', { otp, timeLeft });

  return renderBaseEmailTemplate({
    title: 'Password Reset',
    greeting: `Hello ${firstName},`,
    intro:
      'You requested to reset your password. Use the code below to continue.',
    supportEmail,
    bodyHtml,
  });
};
