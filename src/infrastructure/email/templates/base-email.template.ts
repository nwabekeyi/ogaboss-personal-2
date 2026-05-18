import { renderEmail } from './email-renderer';

interface BaseEmailTemplateOptions {
  title: string;
  greeting?: string;
  intro: string;
  bodyHtml: string;
  supportEmail?: string;
  footerNote?: string;
}

export const renderBaseEmailTemplate = ({
  title,
  greeting = 'Hello,',
  intro,
  bodyHtml,
  supportEmail,
  footerNote = 'This is an automated message. Please do not reply directly to this email.',
}: BaseEmailTemplateOptions): string => {
  return renderEmail('base', {
    title,
    greeting,
    intro,
    bodyHtml,
    supportEmail,
    footerNote,
    year: new Date().getFullYear(),
  });
};
