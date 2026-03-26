import { tauri } from "@daveyplate/better-auth-tauri/plugin";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, genericOAuth, openAPI } from "better-auth/plugins";
import { getGatewayConfig, tauriOrigins } from "../config.js";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { sendEmail } from "./email.js";
import {
	passwordResetEmailTemplate,
	verificationEmailTemplate,
} from "./email-templates.js";
import { logger } from "./logger.js";

const config = getGatewayConfig();
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const appleClientId = process.env.APPLE_CLIENT_ID;
const appleClientSecret = process.env.APPLE_CLIENT_SECRET;
const appleAppBundleIdentifier = process.env.APPLE_APP_BUNDLE_IDENTIFIER;
const linuxDoClientId = process.env.LINUX_DO_CLIENT_ID;
const linuxDoClientSecret = process.env.LINUX_DO_CLIENT_SECRET;

const trustedOrigins = Array.from(
	new Set(
		(config.corsOrigins.includes("*")
			? ["*"]
			: [
					config.siteUrl,
					...config.corsOrigins,
					...tauriOrigins,
					...(appleClientId && appleClientSecret
						? ["https://appleid.apple.com"]
						: []),
				]
		).filter(Boolean) as string[],
	),
);

const isDevelopment = process.env.NODE_ENV === "development";
const { skipEmailVerification, isPreview } = config;

const socialProviders = {
	...(githubClientId && githubClientSecret
		? {
				github: {
					clientId: githubClientId,
					clientSecret: githubClientSecret,
				},
			}
		: {}),
	...(appleClientId && appleClientSecret
		? {
				apple: {
					clientId: appleClientId,
					clientSecret: appleClientSecret,
					...(appleAppBundleIdentifier
						? { appBundleIdentifier: appleAppBundleIdentifier }
						: {}),
				},
			}
		: {}),
};

const getLinuxDoString = (
	profile: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = profile[key];
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
};

const buildLinuxDoAvatarUrl = (profile: Record<string, unknown>) => {
	const avatarUrl = getLinuxDoString(profile, "avatar_url");
	if (avatarUrl) {
		return avatarUrl;
	}

	const avatarTemplate = getLinuxDoString(profile, "avatar_template");
	if (!avatarTemplate) {
		return undefined;
	}

	return new URL(
		avatarTemplate.replace("{size}", "256"),
		"https://linux.do",
	).toString();
};

const genericOAuthProviders =
	linuxDoClientId && linuxDoClientSecret
		? [
				{
					providerId: "linux-do",
					authorizationUrl: "https://connect.linux.do/oauth2/authorize",
					tokenUrl: "https://connect.linux.do/oauth2/token",
					userInfoUrl: "https://connect.linux.do/api/user",
					clientId: linuxDoClientId,
					clientSecret: linuxDoClientSecret,
					scopes: ["openid", "profile", "email"],
					overrideUserInfo: true,
					mapProfileToUser: (profile: Record<string, unknown>) => ({
						name:
							getLinuxDoString(profile, "name") ??
							getLinuxDoString(profile, "username"),
						image: buildLinuxDoAvatarUrl(profile),
						emailVerified: true,
					}),
				},
			]
		: [];

const enabledOAuthProviders = [
	...Object.keys(socialProviders),
	...genericOAuthProviders.map((provider) => provider.providerId),
];

if (skipEmailVerification) {
	logger.warn("Email verification is disabled (SKIP_EMAIL_VERIFICATION=true)");
}

logger.info(
	{
		trustedOrigins,
		siteUrl: config.siteUrl,
		corsOrigins: config.corsOrigins,
	},
	"better_auth_trusted_origins",
);

logger.info({ enabledOAuthProviders }, "better_auth_oauth_providers");

/**
 * Better Auth instance.
 */
export const auth = betterAuth({
	baseURL: config.siteUrl,
	trustedOrigins,
	socialProviders,
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
		sendOnSignUp: !skipEmailVerification,
		sendOnSignIn: !skipEmailVerification,
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: !skipEmailVerification,
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
		useSecureCookies: !isDevelopment && !isPreview,
		defaultCookieAttributes: {
			secure: !isDevelopment,
			sameSite: isPreview ? "none" : "lax",
		},
	},
	plugins: [
		...(genericOAuthProviders.length > 0
			? [
					genericOAuth({
						config: genericOAuthProviders,
					}),
				]
			: []),
		tauri({
			scheme: "mobvibe",
			callbackURL: "/",
		}),
		bearer(),
		openAPI(),
	],
});
