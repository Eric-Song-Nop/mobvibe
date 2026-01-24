/**
 * Login command for CLI authentication.
 * Opens browser for OAuth/email login, waits for Gateway to push credentials via Socket.io.
 */

import crypto from "node:crypto";
import os from "node:os";
import type {
	RegistrationCompletePayload,
	RegistrationErrorPayload,
} from "@mobvibe/shared";
import open from "open";
import { io, type Socket } from "socket.io-client";
import {
	type Credentials,
	deleteCredentials,
	loadCredentials,
	saveCredentials,
} from "./credentials.js";

const REGISTRATION_TIMEOUT = 300000; // 5 minutes

export interface LoginOptions {
	/** Gateway base URL */
	gatewayUrl: string;
	/** WebUI base URL */
	webuiUrl: string;
	/** Machine name (defaults to hostname) */
	machineName?: string;
}

export interface LoginResult {
	success: boolean;
	userId?: string;
	email?: string;
	machineToken?: string;
	error?: string;
}

/**
 * Generate a unique registration code.
 */
function generateRegistrationCode(): string {
	return `reg_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Build the login URL with query parameters for registration.
 */
function buildLoginUrl(
	webuiUrl: string,
	registrationCode: string,
	machineName: string,
	hostname: string,
	platform: string,
): string {
	const url = new URL("/auth/machine-callback", webuiUrl);
	url.searchParams.set("registrationCode", registrationCode);
	url.searchParams.set("machineName", machineName);
	url.searchParams.set("hostname", hostname);
	url.searchParams.set("platform", platform);
	return url.toString();
}

/**
 * Wait for registration credentials via Socket.io.
 * Connects to Gateway and waits for the registration:complete event.
 */
function waitForRegistration(
	gatewayUrl: string,
	registrationCode: string,
): Promise<LoginResult> {
	return new Promise((resolve, reject) => {
		let socket: Socket | null = null;
		let timeoutId: NodeJS.Timeout | null = null;

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			if (socket) {
				socket.disconnect();
				socket = null;
			}
		};

		// Connect to Gateway CLI namespace
		socket = io(`${gatewayUrl}/cli`, {
			transports: ["websocket"],
			reconnection: false,
		});

		socket.on("connect", () => {
			console.log("Connected to Gateway, waiting for authentication...");
			// Send registration request
			socket?.emit("registration:request", { registrationCode });
		});

		socket.on("connect_error", (error) => {
			cleanup();
			reject(new Error(`Failed to connect to Gateway: ${error.message}`));
		});

		socket.on(
			"registration:complete",
			(payload: RegistrationCompletePayload) => {
				cleanup();
				resolve({
					success: true,
					machineToken: payload.machineToken,
					userId: payload.userId,
					email: payload.email,
				});
			},
		);

		socket.on("registration:error", (payload: RegistrationErrorPayload) => {
			cleanup();
			resolve({
				success: false,
				error: payload.error,
			});
		});

		// Set timeout
		timeoutId = setTimeout(() => {
			cleanup();
			reject(new Error("Login timed out. Please try again."));
		}, REGISTRATION_TIMEOUT);
	});
}

/**
 * Start the login flow.
 * Opens browser for authentication and waits for Gateway to push credentials.
 */
export async function login(options: LoginOptions): Promise<LoginResult> {
	const machineName = options.machineName ?? os.hostname();
	const hostname = os.hostname();
	const platform = os.platform();

	console.log("Starting login flow...");

	// Generate a unique registration code
	const registrationCode = generateRegistrationCode();

	// Start waiting for registration (connects to Gateway)
	const registrationPromise = waitForRegistration(
		options.gatewayUrl,
		registrationCode,
	);

	// Build login URL with registration code
	const loginUrl = buildLoginUrl(
		options.webuiUrl,
		registrationCode,
		machineName,
		hostname,
		platform,
	);

	console.log(`Opening browser for login: ${loginUrl}`);
	console.log(
		"If the browser doesn't open automatically, please visit the URL above.",
	);

	// Open browser
	try {
		await open(loginUrl);
	} catch {
		console.log("Could not open browser automatically.");
	}

	// Wait for registration via Socket.io
	try {
		const result = await registrationPromise;

		if (result.success && result.machineToken && result.userId) {
			// Save credentials
			const credentials: Credentials = {
				machineToken: result.machineToken,
				userId: result.userId,
				email: result.email,
				createdAt: Date.now(),
			};
			await saveCredentials(credentials);
			console.log(`\nLogin successful! Machine registered as "${machineName}"`);
			console.log(`User: ${result.email ?? result.userId}`);
		}

		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: message };
	}
}

/**
 * Logout - delete stored credentials.
 */
export async function logout(): Promise<void> {
	await deleteCredentials();
	console.log("Logged out successfully. Credentials deleted.");
}

/**
 * Show current login status.
 */
export async function loginStatus(): Promise<void> {
	const credentials = await loadCredentials();
	if (credentials) {
		console.log("Status: Logged in");
		console.log(`User: ${credentials.email ?? credentials.userId}`);
		console.log(`Machine token: ${credentials.machineToken.slice(0, 8)}...`);
		console.log(
			`Registered: ${new Date(credentials.createdAt).toLocaleString()}`,
		);
	} else {
		console.log("Status: Not logged in");
		console.log("Run 'mobvibe login' to authenticate.");
	}
}
