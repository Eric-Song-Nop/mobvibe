/**
 * Login command for CLI authentication.
 * Generates a master secret, authenticates via email/password,
 * and registers the device public key with the gateway.
 */

import os from "node:os";
import * as readline from "node:readline/promises";
import { Writable } from "node:stream";
import {
	deriveAuthKeyPair,
	generateMasterSecret,
	getSodium,
	initCrypto,
} from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import {
	type Credentials,
	deleteCredentials,
	getGatewayUrl,
	loadCredentials,
	saveCredentials,
} from "./credentials.js";

export interface LoginResult {
	success: boolean;
	error?: string;
}

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
	const sodium = getSodium();

	logger.info("login_prompt_start");
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

		const gatewayUrl = await getGatewayUrl();

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

		// Step 2: Generate master secret and derive public key
		const masterSecret = generateMasterSecret();
		const authKeyPair = deriveAuthKeyPair(masterSecret);
		const publicKeyBase64 = sodium.to_base64(
			authKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);

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
		const masterSecretBase64 = sodium.to_base64(
			masterSecret,
			sodium.base64_variants.ORIGINAL,
		);
		const credentials: Credentials = {
			masterSecret: masterSecretBase64,
			createdAt: Date.now(),
		};
		await saveCredentials(credentials);
		logger.info("login_credentials_saved");

		console.log("\nLogin successful!");
		console.log(
			"\nWARNING: The master secret below will appear in your terminal history.",
		);
		console.log(
			"  Clear your terminal after copying it, or use 'mobvibe e2ee show' later.",
		);
		console.log("\nYour master secret (for pairing WebUI/Tauri devices):");
		console.log(`  ${masterSecretBase64}`);
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
 * Logout - delete stored credentials.
 */
export async function logout(): Promise<void> {
	await deleteCredentials();
	logger.info("logout_complete");
	console.log("Logged out successfully. Credentials deleted.");
}

/**
 * Show current login status.
 */
export async function loginStatus(): Promise<void> {
	const credentials = await loadCredentials();
	if (credentials) {
		await initCrypto();
		const sodium = getSodium();
		const masterSecret = sodium.from_base64(
			credentials.masterSecret,
			sodium.base64_variants.ORIGINAL,
		);
		const authKeyPair = deriveAuthKeyPair(masterSecret);
		const pubKeyBase64 = sodium.to_base64(
			authKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);

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
