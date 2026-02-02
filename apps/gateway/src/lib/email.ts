import { Resend } from "resend";
import { getGatewayConfig } from "../config.js";
import { logger } from "./logger.js";

const config = getGatewayConfig();

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export type SendEmailOptions = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

/**
 * Send an email using Resend if configured, otherwise log to console.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
	const { to, subject, text, html } = options;

	if (!resend) {
		logger.info(
			{ to, subject, text },
			"[DEV] Email would be sent (RESEND_API_KEY not configured)",
		);
		return;
	}

	try {
		const result = await resend.emails.send({
			from: config.emailFrom,
			to,
			subject,
			text,
			html,
		});

		if (result.error) {
			logger.error(
				{ error: result.error, to, subject },
				"Failed to send email",
			);
			return;
		}

		logger.info(
			{ to, subject, id: result.data?.id },
			"Email sent successfully",
		);
	} catch (error) {
		logger.error({ error, to, subject }, "Failed to send email");
	}
}
