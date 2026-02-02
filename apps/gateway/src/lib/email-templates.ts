/**
 * Email templates for Mobvibe authentication emails.
 * These templates are designed to be compatible with most email clients.
 */

const baseStyles = `
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5; }
  .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
  .card { background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); padding: 40px; }
  .logo { text-align: center; margin-bottom: 32px; }
  .logo-text { font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px; }
  .heading { font-size: 24px; font-weight: 600; color: #18181b; margin: 0 0 16px 0; text-align: center; }
  .text { font-size: 16px; line-height: 24px; color: #52525b; margin: 0 0 24px 0; text-align: center; }
  .button-container { text-align: center; margin: 32px 0; }
  .button { display: inline-block; background-color: #18181b; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; }
  .button:hover { background-color: #27272a; }
  .divider { height: 1px; background-color: #e4e4e7; margin: 32px 0; }
  .footer { text-align: center; }
  .footer-text { font-size: 14px; color: #a1a1aa; margin: 0 0 8px 0; }
  .link { color: #18181b; text-decoration: underline; word-break: break-all; }
  .expire-text { font-size: 14px; color: #71717a; text-align: center; margin-top: 16px; }
`;

const wrapTemplate = (content: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Mobvibe</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <span class="logo-text">Mobvibe</span>
      </div>
      ${content}
    </div>
  </div>
</body>
</html>
`;

export type EmailTemplateParams = {
	userName?: string;
	url: string;
};

/**
 * Email verification template
 */
export function verificationEmailTemplate({
	userName,
	url,
}: EmailTemplateParams): { subject: string; text: string; html: string } {
	const greeting = userName ? `Hi ${userName},` : "Hi,";

	const html = wrapTemplate(`
      <h1 class="heading">Verify your email address</h1>
      <p class="text">${greeting}</p>
      <p class="text">
        Thanks for signing up for Mobvibe! Please verify your email address by clicking the button below.
      </p>
      <div class="button-container">
        <a href="${url}" class="button">Verify Email Address</a>
      </div>
      <p class="expire-text">This link will expire in 24 hours.</p>
      <div class="divider"></div>
      <div class="footer">
        <p class="footer-text">If the button doesn't work, copy and paste this link into your browser:</p>
        <p class="footer-text"><a href="${url}" class="link">${url}</a></p>
        <p class="footer-text" style="margin-top: 24px;">If you didn't create an account, you can safely ignore this email.</p>
      </div>
    `);

	const text = `
${greeting}

Thanks for signing up for Mobvibe! Please verify your email address by clicking the link below:

${url}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.

- The Mobvibe Team
`.trim();

	return {
		subject: "Verify your email address - Mobvibe",
		text,
		html,
	};
}

/**
 * Password reset template
 */
export function passwordResetEmailTemplate({
	userName,
	url,
}: EmailTemplateParams): { subject: string; text: string; html: string } {
	const greeting = userName ? `Hi ${userName},` : "Hi,";

	const html = wrapTemplate(`
      <h1 class="heading">Reset your password</h1>
      <p class="text">${greeting}</p>
      <p class="text">
        We received a request to reset your password. Click the button below to choose a new password.
      </p>
      <div class="button-container">
        <a href="${url}" class="button">Reset Password</a>
      </div>
      <p class="expire-text">This link will expire in 1 hour.</p>
      <div class="divider"></div>
      <div class="footer">
        <p class="footer-text">If the button doesn't work, copy and paste this link into your browser:</p>
        <p class="footer-text"><a href="${url}" class="link">${url}</a></p>
        <p class="footer-text" style="margin-top: 24px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
      </div>
    `);

	const text = `
${greeting}

We received a request to reset your password. Click the link below to choose a new password:

${url}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

- The Mobvibe Team
`.trim();

	return {
		subject: "Reset your password - Mobvibe",
		text,
		html,
	};
}
