import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, openAPI } from "better-auth/plugins";
import { getGatewayConfig } from "../config.js";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { sendEmail } from "./email.js";
import {
	passwordResetEmailTemplate,
	verificationEmailTemplate,
} from "./email-templates.js";
import { logger } from "./logger.js";

const config = getGatewayConfig();

const tauriOrigins = [
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
	"mobvibe://",
];

const trustedOrigins = [
	config.siteUrl,
	...config.corsOrigins,
	...tauriOrigins,
].filter(Boolean) as string[];

const isDevelopment = process.env.NODE_ENV === "development";

logger.info(
	{
		trustedOrigins,
		siteUrl: config.siteUrl,
		corsOrigins: config.corsOrigins,
	},
	"better_auth_trusted_origins",
);

/**
 * Better Auth instance.
 */
export const auth = betterAuth({
	baseURL: config.siteUrl,
	trustedOrigins,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			const template = verificationEmailTemplate({
				userName: user.name,
				url,
			});
			void sendEmail({
				to: user.email,
				subject: template.subject,
				text: template.text,
				html: template.html,
			});
		},
		sendOnSignUp: true,
		sendOnSignIn: true,
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		sendResetPassword: async ({ user, url }) => {
			const template = passwordResetEmailTemplate({
				userName: user.name,
				url,
			});
			void sendEmail({
				to: user.email,
				subject: template.subject,
				text: template.text,
				html: template.html,
			});
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes cache
		},
	},
	advanced: {
		useSecureCookies: !isDevelopment,
		defaultCookieAttributes: {
			secure: !isDevelopment,
			sameSite: isDevelopment ? "lax" : "none",
		},
	},
	plugins: [
		tauri({
			scheme: "mobvibe",
			callbackURL: "/",
		}),
		bearer(),
		openAPI(),
	],
});
