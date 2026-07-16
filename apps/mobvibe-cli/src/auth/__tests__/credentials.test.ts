import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uint8ToBase64 } from "@mobvibe/shared";
import {
	deleteCredentials,
	getGatewayUrl,
	getLogoutStateFilePath,
	getMasterSecret,
	hasCredentials,
	isAuthenticationActive,
	isAuthenticationLoggedOut,
	loadCredentials,
	markAuthenticationLoggedOut,
	saveCredentials,
} from "../credentials.js";

describe("loadCredentials", () => {
	let tempDir: string;
	let credentialsFile: string;
	let originalMasterSecret: string | undefined;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobvibe-credentials-"));
		credentialsFile = path.join(tempDir, "credentials.json");
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

	test("returns null only when the credentials file is missing", async () => {
		await expect(loadCredentials(credentialsFile)).resolves.toBeNull();
	});

	test("fails closed without replacing malformed credentials", async () => {
		const malformed = '{"masterSecret":';
		await fs.writeFile(credentialsFile, malformed);

		await expect(loadCredentials(credentialsFile)).rejects.toThrow(
			"credentials file is invalid",
		);
		expect(await fs.readFile(credentialsFile, "utf8")).toBe(malformed);
	});

	test("fails closed when the credentials path cannot be read as a file", async () => {
		await fs.mkdir(credentialsFile);

		await expect(loadCredentials(credentialsFile)).rejects.toThrow(
			"Unable to read credentials",
		);
	});

	test("rejects a structurally invalid master secret", async () => {
		const invalid = JSON.stringify({
			masterSecret: "not-a-32-byte-secret",
			createdAt: Date.now(),
		});
		await fs.writeFile(credentialsFile, invalid);

		await expect(loadCredentials(credentialsFile)).rejects.toThrow(
			"credentials file is invalid",
		);
	});

	test("atomically stores credentials with owner-only permissions", async () => {
		const credentials = {
			masterSecret: uint8ToBase64(new Uint8Array(32).fill(4)),
			createdAt: Date.now(),
		};

		await saveCredentials(credentials, credentialsFile);

		expect(await loadCredentials(credentialsFile)).toEqual(credentials);
		expect((await fs.stat(credentialsFile)).mode & 0o777).toBe(0o600);
		expect(
			(await fs.readdir(tempDir)).filter((name) => name.endsWith(".tmp")),
		).toEqual([]);
	});

	test("logged-out recovery material is inactive but retains its gateway", async () => {
		await saveCredentials(
			{
				masterSecret: uint8ToBase64(new Uint8Array(32).fill(5)),
				createdAt: Date.now(),
				gatewayUrl: "https://self-hosted.example",
				loggedOutAt: Date.now(),
			},
			credentialsFile,
		);

		await expect(getMasterSecret(credentialsFile)).resolves.toBeUndefined();
		await expect(hasCredentials(credentialsFile)).resolves.toBeFalse();
		await expect(getGatewayUrl(credentialsFile)).resolves.toBe(
			"https://self-hosted.example",
		);
	});

	test("a legacy logged-out credential cannot be bypassed by the environment override", async () => {
		const environmentSecret = uint8ToBase64(new Uint8Array(32).fill(6));
		process.env.MOBVIBE_MASTER_SECRET = environmentSecret;
		await saveCredentials(
			{
				masterSecret: uint8ToBase64(new Uint8Array(32).fill(5)),
				createdAt: Date.now(),
				loggedOutAt: Date.now(),
			},
			credentialsFile,
		);

		await expect(getMasterSecret(credentialsFile)).resolves.toBeUndefined();
	});

	test("the persistent logout sentinel disables an env-only daemon", async () => {
		const environmentSecret = uint8ToBase64(new Uint8Array(32).fill(6));
		process.env.MOBVIBE_MASTER_SECRET = environmentSecret;

		await expect(getMasterSecret(credentialsFile)).resolves.toBe(
			environmentSecret,
		);
		await markAuthenticationLoggedOut(credentialsFile, 123);

		await expect(
			isAuthenticationLoggedOut(credentialsFile),
		).resolves.toBeTrue();
		await expect(getMasterSecret(credentialsFile)).resolves.toBeUndefined();
		expect(getLogoutStateFilePath(credentialsFile)).toBe(
			path.join(tempDir, "auth-state.json"),
		);
	});

	test("credential consumers report a sentinel-logged-out key as recovery-only", async () => {
		const credentials = {
			masterSecret: uint8ToBase64(new Uint8Array(32).fill(7)),
			createdAt: Date.now(),
		};
		await saveCredentials(credentials, credentialsFile);
		await expect(
			isAuthenticationActive(credentials, credentialsFile),
		).resolves.toBeTrue();

		await markAuthenticationLoggedOut(credentialsFile, 123);

		await expect(
			isAuthenticationActive(credentials, credentialsFile),
		).resolves.toBeFalse();
	});

	test("an invalid logout sentinel fails closed with recovery guidance", async () => {
		process.env.MOBVIBE_MASTER_SECRET = uint8ToBase64(
			new Uint8Array(32).fill(6),
		);
		await fs.writeFile(getLogoutStateFilePath(credentialsFile), "{broken");

		await expect(getMasterSecret(credentialsFile)).rejects.toThrow(
			"Run 'mobvibe login' to recover",
		);
	});

	test("delete ignores only a missing file", async () => {
		await expect(deleteCredentials(credentialsFile)).resolves.toBeUndefined();
		await fs.mkdir(credentialsFile);
		await expect(deleteCredentials(credentialsFile)).rejects.toThrow();
	});
});
