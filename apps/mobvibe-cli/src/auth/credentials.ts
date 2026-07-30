/**
 * Credentials management for CLI authentication.
 * Stores API key in ~/.mobvibe/credentials.json
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Credentials {
	/** Base64-encoded master secret (32 bytes) — the single root credential */
	masterSecret: string;
	/** When the credentials were created */
	createdAt: number;
	/** Better Auth user ID this device secret was registered for. */
	accountId?: string;
	/** Normalized gateway origin this device secret was registered with. */
	gatewayIdentity?: string;
	/** Optional: custom gateway URL (user can manually set this) */
	gatewayUrl?: string;
	/** Present when authentication is cleared but WAL recovery material is kept. */
	loggedOutAt?: number;
}

export class CredentialsFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CredentialsFileError";
	}
}

export class AuthenticationStateFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthenticationStateFileError";
	}
}

export const getMobvibeHome = (): string =>
	process.env.MOBVIBE_HOME ?? path.join(os.homedir(), ".mobvibe");

export const getCredentialsFilePath = (): string =>
	path.join(getMobvibeHome(), "credentials.json");

/**
 * Logout is stored separately from the root credential so it also applies to
 * environment-only authentication and survives an unreadable credential file.
 */
export const getLogoutStateFilePath = (
	credentialsFile = getCredentialsFilePath(),
): string => path.join(path.dirname(credentialsFile), "auth-state.json");

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
	error instanceof Error && "code" in error;

const isFiniteTimestamp = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

const invalidAuthenticationStateMessage = (stateFile: string): string =>
	`The authentication state file is invalid (${stateFile}). Run 'mobvibe login' to recover. If login cannot clear it, keep the daemon stopped and repair or remove this file before trying again.`;

const unreadableAuthenticationStateMessage = (stateFile: string): string =>
	`Unable to read authentication state (${stateFile}). Run 'mobvibe login' to recover after fixing the file permissions; the daemon will remain logged out until then.`;

const parseAuthenticationState = (
	data: string,
	stateFile: string,
): { version: 1; loggedOutAt: number } => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw new AuthenticationStateFileError(
			invalidAuthenticationStateMessage(stateFile),
		);
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		(parsed as Record<string, unknown>).version !== 1 ||
		!isFiniteTimestamp((parsed as Record<string, unknown>).loggedOutAt)
	) {
		throw new AuthenticationStateFileError(
			invalidAuthenticationStateMessage(stateFile),
		);
	}
	return parsed as { version: 1; loggedOutAt: number };
};

export async function isAuthenticationLoggedOut(
	credentialsFile = getCredentialsFilePath(),
): Promise<boolean> {
	const stateFile = getLogoutStateFilePath(credentialsFile);
	let data: string;
	try {
		data = await fs.readFile(stateFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return false;
		throw new AuthenticationStateFileError(
			unreadableAuthenticationStateMessage(stateFile),
		);
	}
	parseAuthenticationState(data, stateFile);
	return true;
}

export async function markAuthenticationLoggedOut(
	credentialsFile = getCredentialsFilePath(),
	loggedOutAt = Date.now(),
): Promise<void> {
	const stateFile = getLogoutStateFilePath(credentialsFile);
	const temporaryFile = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.mkdir(path.dirname(stateFile), { recursive: true });
		await fs.writeFile(
			temporaryFile,
			JSON.stringify({ version: 1, loggedOutAt }, null, 2),
			{ mode: 0o600, flag: "wx" },
		);
		await fs.rename(temporaryFile, stateFile);
	} catch (error) {
		await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
		throw new AuthenticationStateFileError(
			`Unable to persist logout state (${stateFile}). Keep the daemon stopped, fix the file permissions, and run 'mobvibe logout' again before restarting it. ${error instanceof Error ? error.message : "Unknown filesystem error"}`,
		);
	}
}

export async function clearAuthenticationLogout(
	credentialsFile = getCredentialsFilePath(),
): Promise<void> {
	const stateFile = getLogoutStateFilePath(credentialsFile);
	try {
		await fs.unlink(stateFile);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return;
		throw new AuthenticationStateFileError(
			`Login credentials were saved, but logout state could not be cleared (${stateFile}). Fix the file permissions and run 'mobvibe login' again; the daemon will remain logged out.`,
		);
	}
}

export const isCanonicalMasterSecret = (value: unknown): value is string => {
	if (typeof value !== "string") return false;
	try {
		const decoded = Buffer.from(value, "base64");
		return decoded.byteLength === 32 && decoded.toString("base64") === value;
	} catch {
		return false;
	}
};

const isCredentialsRecord = (
	value: Record<string, unknown>,
): value is Record<string, unknown> & Credentials =>
	isCanonicalMasterSecret(value.masterSecret) &&
	isFiniteTimestamp(value.createdAt) &&
	(value.accountId === undefined ||
		(typeof value.accountId === "string" && value.accountId.length > 0)) &&
	(value.gatewayIdentity === undefined ||
		typeof value.gatewayIdentity === "string") &&
	(value.gatewayUrl === undefined || typeof value.gatewayUrl === "string") &&
	(value.loggedOutAt === undefined || isFiniteTimestamp(value.loggedOutAt));

const parseCredentials = (
	data: string,
	credentialsFile: string,
): Credentials => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw new CredentialsFileError(
			`The credentials file is invalid (${credentialsFile}). Restore it from backup instead of logging in with a new key.`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new CredentialsFileError(
			`The credentials file is invalid (${credentialsFile}). Restore it from backup instead of logging in with a new key.`,
		);
	}
	const value = parsed as Record<string, unknown>;
	if (!isCredentialsRecord(value)) {
		throw new CredentialsFileError(
			`The credentials file is invalid (${credentialsFile}). Restore it from backup instead of logging in with a new key.`,
		);
	}
	return value;
};

/**
 * Ensure the mobvibe directory exists.
 */
async function ensureMobvibeDir(credentialsFile: string): Promise<void> {
	await fs.mkdir(path.dirname(credentialsFile), { recursive: true });
}

/**
 * Load credentials from the credentials file.
 * Returns null if no credentials exist.
 */

export async function loadCredentials(
	credentialsFile = getCredentialsFilePath(),
): Promise<Credentials | null> {
	let data: string;
	try {
		data = await fs.readFile(credentialsFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return null;
		throw new CredentialsFileError(
			`Unable to read credentials (${credentialsFile}). Fix its permissions or restore it before continuing.`,
		);
	}
	return parseCredentials(data, credentialsFile);
}

/**
 * Save credentials to the credentials file.
 */
export async function saveCredentials(
	credentials: Credentials,
	credentialsFile = getCredentialsFilePath(),
): Promise<void> {
	await ensureMobvibeDir(credentialsFile);
	const temporaryFile = `${credentialsFile}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryFile, JSON.stringify(credentials, null, 2), {
			mode: 0o600,
			flag: "wx",
		});
		await fs.rename(temporaryFile, credentialsFile);
	} catch (error) {
		await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
		throw error;
	}
}

/**
 * Delete the credentials file.
 */
export async function deleteCredentials(
	credentialsFile = getCredentialsFilePath(),
): Promise<void> {
	try {
		await fs.unlink(credentialsFile);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return;
		throw error;
	}
}

export const isLoggedIn = (
	credentials: Credentials | null,
): credentials is Credentials =>
	credentials !== null && credentials.loggedOutAt === undefined;

/** Check both the legacy credential marker and the independent logout state. */
export async function isAuthenticationActive(
	credentials: Credentials | null,
	credentialsFile = getCredentialsFilePath(),
): Promise<boolean> {
	return (
		isLoggedIn(credentials) &&
		!(await isAuthenticationLoggedOut(credentialsFile))
	);
}

/**
 * Check if credentials exist.
 */
export async function hasCredentials(
	credentialsFile = getCredentialsFilePath(),
): Promise<boolean> {
	if (await isAuthenticationLoggedOut(credentialsFile)) return false;
	const credentials = await loadCredentials(credentialsFile);
	return isLoggedIn(credentials);
}

/**
 * Get the master secret from credentials.
 * Also checks MOBVIBE_MASTER_SECRET env var as override.
 * Returns base64-encoded string.
 */
export async function getMasterSecret(
	credentialsFile = getCredentialsFilePath(),
): Promise<string | undefined> {
	if (await isAuthenticationLoggedOut(credentialsFile)) return undefined;
	const credentials = await loadCredentials(credentialsFile);
	// Legacy credentials may contain the pre-sentinel logout marker. It must be
	// checked before the environment override so logout cannot be bypassed.
	if (credentials?.loggedOutAt !== undefined) return undefined;
	if (process.env.MOBVIBE_MASTER_SECRET) {
		return process.env.MOBVIBE_MASTER_SECRET;
	}
	return credentials?.masterSecret;
}

/** Default production gateway URL */
export const DEFAULT_GATEWAY_URL = "https://api.mobvibe.net";

/**
 * Get the gateway URL with the following priority:
 * 1. MOBVIBE_GATEWAY_URL env var
 * 2. gatewayUrl in credentials file
 * 3. Default production URL
 */
export async function getGatewayUrl(
	credentialsFile = getCredentialsFilePath(),
): Promise<string> {
	// Environment variable takes precedence
	if (process.env.MOBVIBE_GATEWAY_URL) {
		return process.env.MOBVIBE_GATEWAY_URL;
	}

	// Check credentials file for custom gateway URL
	const credentials = await loadCredentials(credentialsFile);
	if (credentials?.gatewayUrl) {
		return credentials.gatewayUrl;
	}

	// Default to production
	return DEFAULT_GATEWAY_URL;
}
