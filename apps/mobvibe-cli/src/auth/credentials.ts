/**
 * Credentials management for CLI authentication.
 * Stores API key in ~/.mobvibe/credentials.json
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Credentials {
	/** Base64-encoded master secret (32 bytes) — the single root credential */
	masterSecret: string;
	/** When the credentials were created */
	createdAt: number;
	/** Optional: custom gateway URL (user can manually set this) */
	gatewayUrl?: string;
}

const MOBVIBE_DIR =
	process.env.MOBVIBE_HOME ?? path.join(os.homedir(), ".mobvibe");
const CREDENTIALS_FILE = path.join(MOBVIBE_DIR, "credentials.json");

/**
 * Ensure the mobvibe directory exists.
 */
async function ensureMobvibeDir(): Promise<void> {
	await fs.mkdir(MOBVIBE_DIR, { recursive: true });
}

/**
 * Load credentials from the credentials file.
 * Returns null if no credentials exist.
 */
export async function loadCredentials(): Promise<Credentials | null> {
	try {
		const data = await fs.readFile(CREDENTIALS_FILE, "utf8");
		const credentials = JSON.parse(data) as Credentials;

		// Validate required fields
		if (!credentials.masterSecret) {
			return null;
		}

		return credentials;
	} catch {
		return null;
	}
}

/**
 * Save credentials to the credentials file.
 */
export async function saveCredentials(credentials: Credentials): Promise<void> {
	await ensureMobvibeDir();
	await fs.writeFile(
		CREDENTIALS_FILE,
		JSON.stringify(credentials, null, 2),
		{ mode: 0o600 }, // Read/write only for owner
	);
}

/**
 * Delete the credentials file.
 */
export async function deleteCredentials(): Promise<void> {
	try {
		await fs.unlink(CREDENTIALS_FILE);
	} catch {
		// Ignore if file doesn't exist
	}
}

/**
 * Check if credentials exist.
 */
export async function hasCredentials(): Promise<boolean> {
	const credentials = await loadCredentials();
	return credentials !== null;
}

/**
 * Get the master secret from credentials.
 * Also checks MOBVIBE_MASTER_SECRET env var as override.
 * Returns base64-encoded string.
 */
export async function getMasterSecret(): Promise<string | undefined> {
	// Environment variable takes precedence
	if (process.env.MOBVIBE_MASTER_SECRET) {
		return process.env.MOBVIBE_MASTER_SECRET;
	}

	const credentials = await loadCredentials();
	return credentials?.masterSecret;
}

/** Default production gateway URL */
const DEFAULT_GATEWAY_URL = "https://api.mobvibe.net";

/**
 * Get the gateway URL with the following priority:
 * 1. MOBVIBE_GATEWAY_URL env var
 * 2. gatewayUrl in credentials file
 * 3. Default production URL
 */
export async function getGatewayUrl(): Promise<string> {
	// Environment variable takes precedence
	if (process.env.MOBVIBE_GATEWAY_URL) {
		return process.env.MOBVIBE_GATEWAY_URL;
	}

	// Check credentials file for custom gateway URL
	const credentials = await loadCredentials();
	if (credentials?.gatewayUrl) {
		return credentials.gatewayUrl;
	}

	// Default to production
	return DEFAULT_GATEWAY_URL;
}
