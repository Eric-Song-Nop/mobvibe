/**
 * Login command for CLI authentication.
 * Opens browser for OAuth/email login, receives callback with machine token.
 */

import http from "node:http";
import os from "node:os";
import open from "open";
import {
	type Credentials,
	deleteCredentials,
	loadCredentials,
	saveCredentials,
} from "./credentials.js";

const DEFAULT_CALLBACK_PORT = 19823;
const CALLBACK_TIMEOUT = 300000; // 5 minutes

export interface LoginOptions {
	/** WebUI base URL */
	webuiUrl: string;
	/** Port for local callback server */
	callbackPort?: number;
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
 * Start the login flow.
 * Opens browser for authentication and waits for callback.
 */
export async function login(options: LoginOptions): Promise<LoginResult> {
	const callbackPort = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
	const machineName = options.machineName ?? os.hostname();
	const platform = os.platform();
	const hostname = os.hostname();

	console.log("Starting login flow...");

	// Create callback server
	const callbackPromise = createCallbackServer(callbackPort);

	// Build login URL with callback
	const loginUrl = buildLoginUrl(
		options.webuiUrl,
		callbackPort,
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

	// Wait for callback
	try {
		const result = await callbackPromise;

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

/**
 * Build the login URL with query parameters for the callback.
 */
function buildLoginUrl(
	webuiUrl: string,
	callbackPort: number,
	machineName: string,
	hostname: string,
	platform: string,
): string {
	const url = new URL("/auth/machine-callback", webuiUrl);
	url.searchParams.set("callbackPort", callbackPort.toString());
	url.searchParams.set("machineName", machineName);
	url.searchParams.set("hostname", hostname);
	url.searchParams.set("platform", platform);
	return url.toString();
}

/**
 * Create a temporary HTTP server to receive the callback.
 */
function createCallbackServer(port: number): Promise<LoginResult> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "/", `http://localhost:${port}`);

			if (url.pathname === "/callback") {
				const success = url.searchParams.get("success") === "true";
				const error = url.searchParams.get("error");
				const machineToken = url.searchParams.get("machineToken");
				const userId = url.searchParams.get("userId");
				const email = url.searchParams.get("email");

				// Send response to browser
				res.writeHead(200, { "Content-Type": "text/html" });
				if (success) {
					res.end(`
						<!DOCTYPE html>
						<html>
						<head><title>Login Successful</title></head>
						<body style="font-family: system-ui; padding: 40px; text-align: center;">
							<h1>Login Successful!</h1>
							<p>You can close this window and return to the terminal.</p>
							<script>window.close();</script>
						</body>
						</html>
					`);
				} else {
					res.end(`
						<!DOCTYPE html>
						<html>
						<head><title>Login Failed</title></head>
						<body style="font-family: system-ui; padding: 40px; text-align: center;">
							<h1>Login Failed</h1>
							<p>${error ?? "Unknown error"}</p>
							<p>Please try again.</p>
						</body>
						</html>
					`);
				}

				// Close server and resolve
				server.close();

				if (success && machineToken && userId) {
					resolve({
						success: true,
						machineToken,
						userId,
						email: email ?? undefined,
					});
				} else {
					resolve({
						success: false,
						error: error ?? "Missing machine token or user ID",
					});
				}
			} else {
				res.writeHead(404);
				res.end("Not found");
			}
		});

		// Handle server errors
		server.on("error", (err) => {
			reject(new Error(`Callback server error: ${err.message}`));
		});

		// Start server
		server.listen(port, "127.0.0.1", () => {
			console.log(`Waiting for authentication (timeout: 5 minutes)...`);
		});

		// Timeout
		setTimeout(() => {
			server.close();
			reject(new Error("Login timed out. Please try again."));
		}, CALLBACK_TIMEOUT);
	});
}
