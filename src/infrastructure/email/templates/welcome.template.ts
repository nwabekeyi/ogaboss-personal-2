import { renderBaseEmailTemplate } from './base-email.template';
import { renderEmail } from './email-renderer';

export const signupCompletedEmailTemplate = (username: string) => {
  const bodyHtml = renderEmail('welcome', {});

  return renderBaseEmailTemplate({
    title: `Welcome to Ogaboss, ${username}!`,
    greeting: `Hello ${username},`,
    intro:
      "We're thrilled to have you on board. Your account has been successfully created and is ready to use.",
    bodyHtml,
  });
};
