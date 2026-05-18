import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

export const accountLockedEmailTemplate = ({
  firstName = 'User',
  supportEmail,
}: {
  firstName?: string;
  supportEmail: string;
}) => {
  const bodyHtml = renderEmail('account-locked', {});

  return renderBaseEmailTemplate({
    title: 'Account Temporarily Locked',
    greeting: `Hello ${firstName},`,
    intro:
      'Your account is temporarily locked due to multiple failed PIN change attempts. It will be automatically unlocked in 30 minutes.',
    supportEmail,
    bodyHtml,
  });
};
