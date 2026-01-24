/**
 * Credentials management for CLI authentication.
 * Stores API key in ~/.mobvibe/credentials.json
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Credentials {
	/** API key for gateway authentication */
	apiKey: string;
	/** When the credentials were created */
	createdAt: number;
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
		if (!credentials.apiKey) {
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
 * Get the API key from credentials.
 * Also checks MOBVIBE_API_KEY env var as override.
 */
export async function getApiKey(): Promise<string | undefined> {
	// Environment variable takes precedence
	if (process.env.MOBVIBE_API_KEY) {
		return process.env.MOBVIBE_API_KEY;
	}

	const credentials = await loadCredentials();
	return credentials?.apiKey;
}
