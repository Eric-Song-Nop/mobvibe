import os from "node:os";
import {
	createSignedToken,
	deriveAuthKeyPair,
	deriveContentKeyPair,
	getSodium,
	initCrypto,
} from "@mobvibe/shared";
import { getGatewayUrl, loadCredentials } from "../auth/credentials.js";

type DeviceInfo = {
	id: string;
	deviceName: string | null;
	hasContentKey: boolean;
	createdAt: string;
	lastSeenAt: string | null;
};

type DeviceListResponse = {
	devices: DeviceInfo[];
};

type DeviceContentKey = {
	deviceId: string;
	contentPublicKey: string;
	deviceName: string | null;
};

type ContentKeysResponse = {
	keys: DeviceContentKey[];
};

async function fetchWithDeviceAuth<T>(
	endpoint: string,
	options: RequestInit = {},
): Promise<{ data: T | null; error: string | null }> {
	const gatewayUrl = await getGatewayUrl();
	const credentials = await loadCredentials();

	if (!credentials) {
		return { data: null, error: "Not logged in. Run 'mobvibe login' first." };
	}

	await initCrypto();
	const sodium = getSodium();
	const masterSecret = sodium.from_base64(
		credentials.masterSecret,
		sodium.base64_variants.ORIGINAL,
	);
	const authKeyPair = deriveAuthKeyPair(masterSecret);
	const signedToken = createSignedToken(authKeyPair);

	try {
		const response = await fetch(`${gatewayUrl}${endpoint}`, {
			...options,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${JSON.stringify(signedToken)}`,
				...options.headers,
			},
		});

		if (!response.ok) {
			const text = await response.text();
			return { data: null, error: `HTTP ${response.status}: ${text}` };
		}

		const data = (await response.json()) as T;
		return { data, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { data: null, error: message };
	}
}

export async function listDevices(): Promise<void> {
	const { data, error } =
		await fetchWithDeviceAuth<DeviceListResponse>("/auth/device/list");

	if (error) {
		console.error(`Error: ${error}`);
		return;
	}

	if (!data || data.devices.length === 0) {
		console.log("No devices registered.");
		return;
	}

	const credentials = await loadCredentials();
	let currentDeviceId: string | null = null;

	if (credentials) {
		await initCrypto();
		const sodium = getSodium();
		const masterSecret = sodium.from_base64(
			credentials.masterSecret,
			sodium.base64_variants.ORIGINAL,
		);
		const contentKeyPair = deriveContentKeyPair(masterSecret);
		const myContentPub = sodium.to_base64(
			contentKeyPair.publicKey,
			sodium.base64_variants.ORIGINAL,
		);

		const { data: keyData } = await fetchWithDeviceAuth<ContentKeysResponse>(
			"/auth/device/content-keys",
		);
		if (keyData) {
			for (const key of keyData.keys) {
				if (key.contentPublicKey === myContentPub) {
					currentDeviceId = key.deviceId;
					break;
				}
			}
		}
	}

	console.log("\nRegistered Devices:\n");
	console.log(
		"  ID                                    Name                    Created            Last Seen",
	);
	console.log(
		"  ────────────────────────────────────  ──────────────────────  ─────────────────  ─────────────────",
	);

	for (const device of data.devices) {
		const isCurrent = device.id === currentDeviceId ? " (current)" : "";
		const name = (device.deviceName || "Unknown").slice(0, 20).padEnd(22);
		const created = new Date(device.createdAt).toLocaleDateString();
		const lastSeen = device.lastSeenAt
			? new Date(device.lastSeenAt).toLocaleDateString()
			: "Never";
		console.log(
			`  ${device.id}  ${name}  ${created.padEnd(18)} ${lastSeen}${isCurrent}`,
		);
	}

	console.log(`\nTotal: ${data.devices.length} device(s)`);
}

export async function removeDevice(deviceId: string): Promise<void> {
	if (!deviceId) {
		console.error("Error: Device ID is required");
		return;
	}

	const credentials = await loadCredentials();
	if (!credentials) {
		console.error("Error: Not logged in");
		return;
	}

	await initCrypto();
	const sodium = getSodium();
	const masterSecret = sodium.from_base64(
		credentials.masterSecret,
		sodium.base64_variants.ORIGINAL,
	);
	const contentKeyPair = deriveContentKeyPair(masterSecret);
	const myContentPub = sodium.to_base64(
		contentKeyPair.publicKey,
		sodium.base64_variants.ORIGINAL,
	);

	const { data: keyData } = await fetchWithDeviceAuth<ContentKeysResponse>(
		"/auth/device/content-keys",
	);

	if (keyData) {
		for (const key of keyData.keys) {
			if (key.deviceId === deviceId && key.contentPublicKey === myContentPub) {
				console.error(
					"Error: Cannot remove the current device. Use 'mobvibe logout' instead.",
				);
				return;
			}
		}
	}

	console.log(`Removing device ${deviceId}...`);

	const { error } = await fetchWithDeviceAuth<{ success: boolean }>(
		`/auth/device/${deviceId}`,
		{ method: "DELETE" },
	);

	if (error) {
		console.error(`Error: ${error}`);
		return;
	}

	console.log("Device removed successfully.");
}

export async function renameDevice(
	deviceId: string,
	deviceName: string,
): Promise<void> {
	if (!deviceId || !deviceName) {
		console.error("Error: Device ID and name are required");
		return;
	}

	console.log(`Renaming device ${deviceId} to "${deviceName}"...`);

	const { error } = await fetchWithDeviceAuth<{ success: boolean }>(
		`/auth/device/${deviceId}`,
		{
			method: "PATCH",
			body: JSON.stringify({ deviceName }),
		},
	);

	if (error) {
		console.error(`Error: ${error}`);
		return;
	}

	console.log("Device renamed successfully.");
}

export async function registerDevice(): Promise<void> {
	const gatewayUrl = await getGatewayUrl();
	const credentials = await loadCredentials();

	if (!credentials) {
		console.error("Error: Not logged in. Run 'mobvibe login' first.");
		return;
	}

	await initCrypto();
	const sodium = getSodium();
	const masterSecret = sodium.from_base64(
		credentials.masterSecret,
		sodium.base64_variants.ORIGINAL,
	);
	const authKeyPair = deriveAuthKeyPair(masterSecret);
	const contentKeyPair = deriveContentKeyPair(masterSecret);

	const publicKeyBase64 = sodium.to_base64(
		authKeyPair.publicKey,
		sodium.base64_variants.ORIGINAL,
	);
	const contentPublicKeyBase64 = sodium.to_base64(
		contentKeyPair.publicKey,
		sodium.base64_variants.ORIGINAL,
	);

	const signedToken = createSignedToken(authKeyPair);

	console.log("Registering device with gateway...");

	try {
		const response = await fetch(`${gatewayUrl}/auth/device/register`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${JSON.stringify(signedToken)}`,
			},
			body: JSON.stringify({
				publicKey: publicKeyBase64,
				contentPublicKey: contentPublicKeyBase64,
				deviceName: os.hostname(),
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			console.error(`Registration failed: ${text}`);
			return;
		}

		const data = (await response.json()) as {
			success: boolean;
			deviceId: string;
		};
		if (data.success) {
			console.log(`Device registered successfully. ID: ${data.deviceId}`);
		} else {
			console.error("Registration failed: Unknown error");
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Registration failed: ${message}`);
	}
}
