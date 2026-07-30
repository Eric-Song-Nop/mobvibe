import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initCrypto, uint8ToBase64 } from "@mobvibe/shared";
import { CliCryptoService } from "../../e2ee/crypto-service.js";
import { WalStore } from "../../wal/wal-store.js";
import {
	getMasterSecret,
	isAuthenticationLoggedOut,
	loadCredentials,
	markAuthenticationLoggedOut,
} from "../credentials.js";
import { loadRecoverableCredentials } from "../local-state.js";
import {
	activateLoginCredentials,
	buildLoginCredentials,
	logout,
	resolveLoginMasterSecret,
} from "../login.js";

beforeAll(async () => {
	await initCrypto();
});

describe("resolveLoginMasterSecret", () => {
	test("reuses the registered device secret on repeated login", () => {
		const existingSecret = new Uint8Array(32).fill(7);

		expect(
			resolveLoginMasterSecret(
				{
					masterSecret: uint8ToBase64(existingSecret),
					createdAt: 1,
					accountId: "user-1",
					gatewayIdentity: "https://api.mobvibe.net",
				},
				{
					accountId: "user-1",
					gatewayUrl: "https://api.mobvibe.net/path",
				},
			),
		).toEqual(existingSecret);
	});

	test("refuses to rotate credentials for another gateway or account", () => {
		const existingSecret = new Uint8Array(32).fill(7);
		const existing = {
			masterSecret: uint8ToBase64(existingSecret),
			createdAt: 1,
			accountId: "user-1",
			gatewayIdentity: "https://api.mobvibe.net",
		};

		expect(() =>
			resolveLoginMasterSecret(existing, {
				accountId: "user-1",
				gatewayUrl: "https://self-hosted.example",
			}),
		).toThrow("different account or gateway");
		expect(() =>
			resolveLoginMasterSecret(existing, {
				accountId: "user-2",
				gatewayUrl: "https://api.mobvibe.net",
			}),
		).toThrow("different account or gateway");
	});

	test("binds legacy credentials without gateway metadata to the selected custom gateway", () => {
		const existingSecret = new Uint8Array(32).fill(9);
		const existing = {
			masterSecret: uint8ToBase64(existingSecret),
			createdAt: 1,
		};

		expect(
			resolveLoginMasterSecret(existing, {
				accountId: "user-1",
				gatewayUrl: "https://self-hosted.example/api",
			}),
		).toEqual(existingSecret);
	});

	test("generates a secret for the first login", () => {
		const generated = resolveLoginMasterSecret(null, {
			accountId: "user-1",
			gatewayUrl: "https://api.mobvibe.net",
		});

		expect(generated).toBeInstanceOf(Uint8Array);
		expect(generated).toHaveLength(32);
	});

	test("successful re-login clears the logged-out marker", () => {
		const secret = new Uint8Array(32).fill(7);
		const credentials = buildLoginCredentials(
			{
				masterSecret: uint8ToBase64(secret),
				createdAt: 1,
				accountId: "user-1",
				gatewayUrl: "https://api.mobvibe.net",
				loggedOutAt: 2,
			},
			secret,
			{
				accountId: "user-1",
				gatewayUrl: "https://api.mobvibe.net",
			},
		);

		expect(credentials.createdAt).toBe(1);
		expect(credentials.loggedOutAt).toBeUndefined();
	});
});

describe("local credential recovery", () => {
	let tempDir: string;
	let credentialsFile: string;
	let walDbPath: string;
	let originalMasterSecret: string | undefined;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-login-"));
		credentialsFile = path.join(tempDir, "credentials.json");
		walDbPath = path.join(tempDir, "events.db");
		originalMasterSecret = process.env.MOBVIBE_MASTER_SECRET;
		delete process.env.MOBVIBE_MASTER_SECRET;
	});

	afterEach(async () => {
		if (originalMasterSecret === undefined) {
			delete process.env.MOBVIBE_MASTER_SECRET;
		} else {
			process.env.MOBVIBE_MASTER_SECRET = originalMasterSecret;
		}
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("login preflight fails closed on corrupt credentials without overwriting them", async () => {
		const corrupt = "not json";
		await fs.writeFile(credentialsFile, corrupt);

		await expect(
			loadRecoverableCredentials({ credentialsFile, walDbPath }),
		).rejects.toThrow("credentials file is invalid");
		expect(await fs.readFile(credentialsFile, "utf8")).toBe(corrupt);
	});

	test("missing credentials cannot rotate the key for an already-bound WAL", async () => {
		const walStore = new WalStore(walDbPath);
		walStore.bindEncryptionIdentity("existing-device-key");
		walStore.close();

		await expect(
			loadRecoverableCredentials({ credentialsFile, walDbPath }),
		).rejects.toThrow("Restore credentials.json");
	});

	test("missing credentials cannot claim legacy durable data", async () => {
		const walStore = new WalStore(walDbPath);
		walStore.ensureSession({
			sessionId: "legacy-session",
			machineId: "machine-1",
			backendId: "backend-1",
		});
		walStore.close();

		await expect(
			loadRecoverableCredentials({ credentialsFile, walDbPath }),
		).rejects.toThrow("move events.db aside");
	});

	test("a genuinely fresh login has no existing recovery material", async () => {
		await expect(
			loadRecoverableCredentials({ credentialsFile, walDbPath }),
		).resolves.toBeNull();
	});

	test("an empty migrated WAL still permits a genuine first login", async () => {
		const walStore = new WalStore(walDbPath);
		walStore.close();

		await expect(
			loadRecoverableCredentials({ credentialsFile, walDbPath }),
		).resolves.toBeNull();
	});

	test("logout blocks new authentication before stopping the daemon without rewriting recovery material", async () => {
		const secret = uint8ToBase64(new Uint8Array(32).fill(9));
		const originalCredentials = JSON.stringify(
			{
				masterSecret: secret,
				createdAt: 1,
				accountId: "user-1",
				gatewayIdentity: "https://api.mobvibe.net",
			},
			null,
			2,
		);
		await fs.writeFile(credentialsFile, originalCredentials);
		const walStore = new WalStore(walDbPath);
		walStore.bindEncryptionIdentity("existing-device-key");
		walStore.close();
		let stopped = false;

		await logout({
			credentialsFile,
			walDbPath,
			stopDaemon: async () => {
				const beforeStop = await loadCredentials(credentialsFile);
				expect(beforeStop?.loggedOutAt).toBeUndefined();
				await expect(
					isAuthenticationLoggedOut(credentialsFile),
				).resolves.toBeTrue();
				await expect(getMasterSecret(credentialsFile)).resolves.toBeUndefined();
				stopped = true;
			},
		});

		expect(stopped).toBeTrue();
		const retained = await loadCredentials(credentialsFile);
		expect(retained?.masterSecret).toBe(secret);
		expect(await fs.readFile(credentialsFile, "utf8")).toBe(
			originalCredentials,
		);
		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
	});

	test("env-only identity-bound WAL can complete logout and login recovery", async () => {
		const secret = uint8ToBase64(new Uint8Array(32).fill(6));
		process.env.MOBVIBE_MASTER_SECRET = secret;
		const walStore = new WalStore(walDbPath);
		const recoveryCrypto = new CliCryptoService(new Uint8Array(32).fill(6));
		walStore.bindEncryptionIdentity(recoveryCrypto.getKeyIdentity());
		walStore.ensureSession({
			sessionId: "env-session",
			machineId: "machine-1",
			backendId: "backend-1",
		});
		walStore.close();

		await logout({
			credentialsFile,
			walDbPath,
			stopDaemon: async () => undefined,
		});

		const recoveryCredentials = await loadRecoverableCredentials({
			credentialsFile,
			walDbPath,
		});
		expect(recoveryCredentials?.masterSecret).toBe(secret);
		const recoveredSecret = resolveLoginMasterSecret(recoveryCredentials, {
			accountId: "user-1",
			gatewayUrl: "https://api.mobvibe.net",
		});
		await activateLoginCredentials(
			buildLoginCredentials(recoveryCredentials, recoveredSecret, {
				accountId: "user-1",
				gatewayUrl: "https://api.mobvibe.net",
			}),
			credentialsFile,
		);

		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeFalse();
		await expect(loadCredentials(credentialsFile)).resolves.toMatchObject({
			masterSecret: secret,
			accountId: "user-1",
		});
	});

	test("env-only recovery rejects a secret that does not match the WAL identity", async () => {
		const originalSecret = new Uint8Array(32).fill(6);
		process.env.MOBVIBE_MASTER_SECRET = uint8ToBase64(
			new Uint8Array(32).fill(7),
		);
		const walStore = new WalStore(walDbPath);
		walStore.bindEncryptionIdentity(
			new CliCryptoService(originalSecret).getKeyIdentity(),
		);
		walStore.close();

		await expect(
			loadRecoverableCredentials({ credentialsFile, walDbPath }),
		).rejects.toThrow("does not match the encryption identity");
	});

	test("failed logout preflight still stops, records logout, and preserves credentials byte-for-byte", async () => {
		const corrupt = "{broken";
		await fs.writeFile(credentialsFile, corrupt);
		let stopped = false;

		await expect(
			logout({
				credentialsFile,
				walDbPath,
				stopDaemon: async () => {
					stopped = true;
				},
			}),
		).rejects.toThrow("credentials file is invalid");

		expect(stopped).toBeTrue();
		expect(await fs.readFile(credentialsFile, "utf8")).toBe(corrupt);
		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
	});

	test("failed recovery preflight still stops a live daemon", async () => {
		const walStore = new WalStore(walDbPath);
		walStore.bindEncryptionIdentity("existing-device-key");
		walStore.close();
		let stopped = false;

		await expect(
			logout({
				credentialsFile,
				walDbPath,
				stopDaemon: async () => {
					stopped = true;
				},
			}),
		).rejects.toThrow("Restore credentials.json");

		expect(stopped).toBeTrue();
		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
	});

	test("logout records an env-only authentication state with no credentials", async () => {
		process.env.MOBVIBE_MASTER_SECRET = uint8ToBase64(
			new Uint8Array(32).fill(4),
		);

		await logout({
			credentialsFile,
			walDbPath,
			stopDaemon: async () => undefined,
		});

		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
		await expect(getMasterSecret(credentialsFile)).resolves.toBeUndefined();
	});

	test("a daemon stop failure leaves authentication active", async () => {
		const secret = uint8ToBase64(new Uint8Array(32).fill(8));
		await fs.writeFile(
			credentialsFile,
			JSON.stringify({ masterSecret: secret, createdAt: 1 }),
		);

		await expect(
			logout({
				credentialsFile,
				walDbPath,
				stopDaemon: async () => {
					throw new Error("daemon would not stop");
				},
			}),
		).rejects.toThrow("daemon would not stop");

		const retained = await loadCredentials(credentialsFile);
		expect(retained?.masterSecret).toBe(secret);
		expect(retained?.loggedOutAt).toBeUndefined();
		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeFalse();
	});

	test("a repeated logout never clears an existing authentication block when stop fails", async () => {
		await markAuthenticationLoggedOut(credentialsFile, 123);

		await expect(
			logout({
				credentialsFile,
				walDbPath,
				stopDaemon: async () => {
					throw new Error("daemon would not stop");
				},
			}),
		).rejects.toThrow("daemon would not stop");

		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
	});

	test("login activation clears logout only after atomic credential persistence", async () => {
		const credentials = {
			masterSecret: uint8ToBase64(new Uint8Array(32).fill(3)),
			createdAt: 1,
		};
		await markAuthenticationLoggedOut(credentialsFile, 123);

		await activateLoginCredentials(credentials, credentialsFile);

		await expect(loadCredentials(credentialsFile)).resolves.toEqual(
			credentials,
		);
		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeFalse();
	});

	test("failed credential persistence leaves the logout sentinel in place", async () => {
		const credentials = {
			masterSecret: uint8ToBase64(new Uint8Array(32).fill(3)),
			createdAt: 1,
		};
		await markAuthenticationLoggedOut(credentialsFile, 123);
		await fs.mkdir(credentialsFile);

		await expect(
			activateLoginCredentials(credentials, credentialsFile),
		).rejects.toThrow();

		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
	});
});
