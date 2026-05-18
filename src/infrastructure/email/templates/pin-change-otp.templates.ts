import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

interface PinChangeOtpTemplateParams {
  firstName?: string;
  otp: string;
  timeLeft: number;
  supportEmail: string;
}

export const pinChangeOtpEmailTemplate = ({
  firstName = 'there',
  otp,
  timeLeft,
  supportEmail,
}: PinChangeOtpTemplateParams) => {
  const bodyHtml = renderEmail('otp-pin-change', { otp, timeLeft });

  return renderBaseEmailTemplate({
    title: 'PIN Change Verification',
    greeting: `Hello ${firstName},`,
    intro: 'Use this code to authorize your PIN change request.',
    supportEmail,
    bodyHtml,
  });
};
