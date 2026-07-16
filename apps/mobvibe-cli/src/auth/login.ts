/**
 * Login command for CLI authentication.
 * Generates a master secret, authenticates via email/password,
 * and registers the device public key with the gateway.
 */

import os from "node:os";
import * as readline from "node:readline/promises";
import { Writable } from "node:stream";
import {
	base64ToUint8,
	deriveAuthKeyPair,
	generateMasterSecret,
	initCrypto,
	uint8ToBase64,
} from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import {
	type Credentials,
	clearAuthenticationLogout,
	DEFAULT_GATEWAY_URL,
	getCredentialsFilePath,
	isAuthenticationLoggedOut,
	isLoggedIn,
	loadCredentials,
	markAuthenticationLoggedOut,
	saveCredentials,
} from "./credentials.js";
import {
	type LocalCredentialStateOptions,
	loadRecoverableCredentials,
} from "./local-state.js";

export interface LoginResult {
	success: boolean;
	error?: string;
}

/**
 * Re-login registers the existing device key again. Rotating this secret would
 * make every durable revision DEK unreadable, so credentials that are already
 * bound to another account or gateway must be kept in a separate MOBVIBE_HOME.
 */
export function resolveLoginMasterSecret(
	existing: Credentials | null,
	identity: { accountId: string; gatewayUrl: string },
): Uint8Array {
	if (!existing) {
		return generateMasterSecret();
	}
	const gatewayIdentity = normalizeGatewayIdentity(identity.gatewayUrl);
	const existingGatewayIdentity =
		existing.gatewayIdentity ??
		normalizeGatewayIdentity(existing.gatewayUrl ?? DEFAULT_GATEWAY_URL);
	const sameGateway = existingGatewayIdentity === gatewayIdentity;
	const sameAccount =
		existing.accountId === undefined ||
		existing.accountId === identity.accountId;
	if (!sameGateway || !sameAccount) {
		throw new Error(
			"Existing credentials belong to a different account or gateway; use a separate MOBVIBE_HOME",
		);
	}
	return base64ToUint8(existing.masterSecret);
}

const normalizeGatewayIdentity = (gatewayUrl: string): string =>
	new URL(gatewayUrl).origin.toLowerCase();

export function buildLoginCredentials(
	existing: Credentials | null,
	masterSecret: Uint8Array,
	identity: { accountId: string; gatewayUrl: string },
): Credentials {
	const masterSecretBase64 = uint8ToBase64(masterSecret);
	return {
		masterSecret: masterSecretBase64,
		createdAt:
			existing?.masterSecret === masterSecretBase64
				? existing.createdAt
				: Date.now(),
		accountId: identity.accountId,
		gatewayIdentity: normalizeGatewayIdentity(identity.gatewayUrl),
		gatewayUrl: identity.gatewayUrl,
	};
}

/**
 * Make a registered login active. Persisting credentials comes first so a
 * crash or write failure leaves the independent logout sentinel in place.
 */
export async function activateLoginCredentials(
	credentials: Credentials,
	credentialsFile = getCredentialsFilePath(),
): Promise<void> {
	await saveCredentials(credentials, credentialsFile);
	await clearAuthenticationLogout(credentialsFile);
}

const getSignedInAccountId = (payload: unknown): string | undefined => {
	if (!payload || typeof payload !== "object") return undefined;
	const user = (payload as { user?: unknown }).user;
	if (!user || typeof user !== "object") return undefined;
	const id = (user as { id?: unknown }).id;
	return typeof id === "string" && id.trim() ? id : undefined;
};

/**
 * Read a password from stdin without echoing characters.
 * Prints '*' for each character typed.
 */
function readPassword(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		process.stdout.write(prompt);
		const chars: string[] = [];

		if (!process.stdin.isTTY) {
			// Non-interactive: fall back to readline
			const rl = readline.createInterface({
				input: process.stdin,
				output: new Writable({ write: (_c, _e, cb) => cb() }),
			});
			rl.question("").then((answer) => {
				rl.close();
				process.stdout.write("\n");
				resolve(answer);
			}, reject);
			return;
		}

		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding("utf8");

		const onData = (key: string) => {
			for (const ch of key) {
				const code = ch.charCodeAt(0);
				if (ch === "\r" || ch === "\n") {
					// Enter
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdin.removeListener("data", onData);
					process.stdout.write("\n");
					resolve(chars.join(""));
					return;
				}
				if (code === 3) {
					// Ctrl-C
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdin.removeListener("data", onData);
					process.stdout.write("\n");
					reject(new Error("User cancelled"));
					return;
				}
				if (code === 127 || code === 8) {
					// Backspace
					if (chars.length > 0) {
						chars.pop();
						process.stdout.write("\b \b");
					}
				} else if (code >= 32) {
					chars.push(ch);
					process.stdout.write("*");
				}
			}
		};

		process.stdin.on("data", onData);
	});
}

export async function login(): Promise<LoginResult> {
	await initCrypto();
	let existingCredentials: Credentials | null;
	try {
		existingCredentials = await loadRecoverableCredentials();
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "Unable to safely load local credentials";
		logger.warn({ err: error }, "login_local_credentials_invalid");
		return { success: false, error: message };
	}

	console.log("Mobvibe E2EE Login\n");

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const email = await rl.question("Email: ");
		if (!email.trim()) {
			return { success: false, error: "No email provided" };
		}

		rl.close();
		const password = await readPassword("Password: ");
		if (!password.trim()) {
			return { success: false, error: "No password provided" };
		}

		const gatewayUrl =
			process.env.MOBVIBE_GATEWAY_URL ||
			existingCredentials?.gatewayUrl ||
			DEFAULT_GATEWAY_URL;

		// Step 1: Sign in via Better Auth
		console.log("\nSigning in...");
		const signInResponse = await fetch(`${gatewayUrl}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: email.trim(),
				password: password.trim(),
			}),
		});

		if (!signInResponse.ok) {
			const body = await signInResponse.text();
			logger.warn(
				{ status: signInResponse.status, body },
				"login_sign_in_failed",
			);
			return {
				success: false,
				error: `Sign-in failed (${signInResponse.status}): ${body}`,
			};
		}

		// Extract session cookie from response
		const setCookieHeaders = signInResponse.headers.getSetCookie?.() ?? [];
		const cookieHeader = setCookieHeaders
			.map((c: string) => c.split(";")[0])
			.join("; ");

		if (!cookieHeader) {
			return {
				success: false,
				error: "No session cookie received from sign-in",
			};
		}
		const signInPayload = (await signInResponse
			.json()
			.catch(() => null)) as unknown;
		const accountId = getSignedInAccountId(signInPayload);
		if (!accountId) {
			return {
				success: false,
				error: "No authenticated user identity received from sign-in",
			};
		}

		// Step 2: Reuse the durable device secret when re-authenticating.
		let masterSecret: Uint8Array;
		try {
			masterSecret = resolveLoginMasterSecret(existingCredentials, {
				accountId,
				gatewayUrl,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Credential identity mismatch";
			logger.warn({ err: error }, "login_credential_identity_mismatch");
			return { success: false, error: message };
		}
		const authKeyPair = deriveAuthKeyPair(masterSecret);
		const publicKeyBase64 = uint8ToBase64(authKeyPair.publicKey);

		// Step 3: Register device public key
		console.log("Registering device...");
		const registerResponse = await fetch(`${gatewayUrl}/auth/device/register`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookieHeader,
			},
			body: JSON.stringify({
				publicKey: publicKeyBase64,
				deviceName: os.hostname(),
			}),
		});

		if (!registerResponse.ok) {
			const body = await registerResponse.text();
			logger.warn(
				{ status: registerResponse.status, body },
				"login_device_register_failed",
			);
			return {
				success: false,
				error: `Device registration failed (${registerResponse.status}): ${body}`,
			};
		}

		// Step 4: Store master secret
		const credentials = buildLoginCredentials(
			existingCredentials,
			masterSecret,
			{ accountId, gatewayUrl },
		);
		await activateLoginCredentials(credentials);
		logger.info("login_credentials_saved");

		console.log("\nLogin successful!");
		console.log(
			"\nWARNING: The master secret below will appear in your terminal history.",
		);
		console.log(
			"  Clear your terminal after copying it, or use 'mobvibe e2ee show' later.",
		);
		console.log("\nYour master secret (for pairing WebUI/Tauri devices):");
		console.log(`  ${credentials.masterSecret}`);
		console.log(
			"\nKeep this secret safe. You can view it again with 'mobvibe e2ee show'.",
		);
		console.log("Run 'mobvibe start' to connect to the gateway.");

		return { success: true };
	} finally {
		rl.close();
	}
}

/**
 * Logout blocks new authentication before stopping the daemon. If stopping
 * fails, the newly-created block is rolled back so the existing authenticated
 * daemon remains consistent. The root secret is retained locally because
 * deleting it would make encrypted WAL data permanently unrecoverable.
 */
export async function logout(
	options: LocalCredentialStateOptions & {
		stopDaemon: () => Promise<void>;
	},
): Promise<void> {
	const credentialsFile = options.credentialsFile ?? getCredentialsFilePath();
	let preflightError: unknown;
	try {
		await loadRecoverableCredentials(options);
	} catch (error) {
		preflightError = error;
	}

	let authenticationWasAlreadyLoggedOut = false;
	let logoutStateError: unknown;
	try {
		authenticationWasAlreadyLoggedOut =
			await isAuthenticationLoggedOut(credentialsFile);
		if (!authenticationWasAlreadyLoggedOut) {
			await markAuthenticationLoggedOut(credentialsFile);
		}
	} catch (error) {
		logoutStateError = error;
	}

	if (logoutStateError) {
		let stopError: unknown;
		try {
			await options.stopDaemon();
		} catch (error) {
			stopError = error;
		}
		const errors = [preflightError, logoutStateError, stopError].filter(
			(error) => error !== undefined,
		);
		if (errors.length === 1) throw errors[0];
		throw new AggregateError(
			errors,
			"Logout could not update authentication state or stop the daemon safely",
		);
	}

	try {
		await options.stopDaemon();
	} catch (stopError) {
		let rollbackError: unknown;
		if (!authenticationWasAlreadyLoggedOut) {
			try {
				await clearAuthenticationLogout(credentialsFile);
			} catch (error) {
				rollbackError = error;
			}
		}
		const errors = [preflightError, stopError, rollbackError].filter(
			(error) => error !== undefined,
		);
		if (errors.length === 1) throw errors[0];
		throw new AggregateError(
			errors,
			rollbackError
				? "Logout could not stop the daemon or restore authentication state"
				: "Logout could not validate recovery material or stop the daemon",
		);
	}

	if (preflightError) throw preflightError;
	logger.info("logout_complete");
	console.log(
		"Logged out successfully. The daemon was stopped and the encryption key was retained locally for WAL recovery.",
	);
}

/**
 * Show current login status.
 */
export async function loginStatus(): Promise<void> {
	const loggedOut = await isAuthenticationLoggedOut();
	const credentials = loggedOut ? null : await loadCredentials();
	if (!loggedOut && isLoggedIn(credentials)) {
		await initCrypto();
		const masterSecret = base64ToUint8(credentials.masterSecret);
		const authKeyPair = deriveAuthKeyPair(masterSecret);
		const pubKeyBase64 = uint8ToBase64(authKeyPair.publicKey);

		logger.info("login_status_logged_in");
		console.log("Status: Logged in (E2EE)");
		console.log(`Auth public key: ${pubKeyBase64.slice(0, 16)}...`);
		console.log(`Saved: ${new Date(credentials.createdAt).toLocaleString()}`);
	} else {
		logger.info("login_status_logged_out");
		console.log("Status: Not logged in");
		console.log("Run 'mobvibe login' to authenticate.");
	}
}
