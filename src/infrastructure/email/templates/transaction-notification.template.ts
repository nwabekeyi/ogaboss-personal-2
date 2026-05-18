import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

export const transactionNotificationTemplate = ({
  firstName,
  message,
  transactionId,
  transactionContext,
  transactionStatus,
}: {
  firstName?: string;
  message: string;
  transactionId?: string;
  transactionContext?: string;
  transactionStatus?: string;
}) => {
  const bodyHtml = renderEmail('transaction-notification', {
    transactionId: transactionId || '',
    transactionContext: transactionContext || '',
    transactionStatus: transactionStatus || '',
  });

  return renderBaseEmailTemplate({
    title: 'Transaction Update',
    greeting: `Hello ${firstName || 'User'},`,
    intro: message,
    bodyHtml,
  });
};
