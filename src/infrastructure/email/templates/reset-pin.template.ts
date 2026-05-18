import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

export const resetPinTemplate = ({
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
  const bodyHtml = renderEmail('otp-reset-pin', { otp, timeLeft });

  return renderBaseEmailTemplate({
    title: 'PIN Reset',
    greeting: `Hello ${firstName},`,
    intro:
      'You requested to reset your PIN. Use the one-time code below to continue.',
    supportEmail,
    bodyHtml,
  });
};
