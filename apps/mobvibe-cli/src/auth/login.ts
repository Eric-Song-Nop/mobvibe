/**
 * Login command for CLI authentication.
 * Prompts user to paste an API key generated from the WebUI.
 */

import * as readline from "node:readline/promises";
import { logger } from "../lib/logger.js";
import {
	type Credentials,
	deleteCredentials,
	loadCredentials,
	saveCredentials,
} from "./credentials.js";

export interface LoginResult {
	success: boolean;
	error?: string;
}

/**
 * Start the login flow.
 * Prompts user to paste an API key from the WebUI.
 */
export async function login(): Promise<LoginResult> {
	logger.info("login_prompt_start");
	console.log("To get an API key:");
	console.log("  1. Open the Mobvibe WebUI in your browser");
	console.log("  2. Go to Settings (gear icon) -> API Keys");
	console.log("  3. Click 'Create API Key' and copy it");
	console.log("  4. Paste the API key below\n");

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const apiKey = await rl.question("Paste your API key: ");

		if (!apiKey.trim()) {
			logger.warn("login_missing_api_key");
			return { success: false, error: "No API key provided" };
		}

		// Basic format check
		if (!apiKey.trim().startsWith("mbk_")) {
			logger.warn("login_invalid_api_key_format");
			return {
				success: false,
				error: "Invalid API key format (should start with mbk_)",
			};
		}

		// Store credentials - gateway validates on connection
		const credentials: Credentials = {
			apiKey: apiKey.trim(),
			createdAt: Date.now(),
		};
		await saveCredentials(credentials);
		logger.info("login_credentials_saved");

		console.log("\nAPI key saved!");
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
		logger.info("login_status_logged_in");
		console.log("Status: Logged in");
		console.log(`API key: ${credentials.apiKey.slice(0, 12)}...`);
		console.log(`Saved: ${new Date(credentials.createdAt).toLocaleString()}`);
	} else {
		logger.info("login_status_logged_out");
		console.log("Status: Not logged in");
		console.log("Run 'mobvibe login' to authenticate.");
	}
}
