import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

export const adminPasswordResetTemplate = ({
  firstName,
  resetLink,
  supportEmail,
}: {
  firstName: string;
  resetLink: string;
  supportEmail: string;
}) => {
  const bodyHtml = renderEmail('admin-reset-password', { resetLink });

  return renderBaseEmailTemplate({
    title: 'Reset Your Admin Password',
    greeting: `Hello ${firstName},`,
    intro: 'We received a request to reset your admin account password.',
    supportEmail,
    bodyHtml,
  });
};
