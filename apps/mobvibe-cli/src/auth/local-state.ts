import path from "node:path";
import { base64ToUint8, initCrypto } from "@mobvibe/shared";
import { CliCryptoService } from "../e2ee/crypto-service.js";
import { hasDurableWalData, WalStore } from "../wal/wal-store.js";
import {
	type Credentials,
	getCredentialsFilePath,
	getMobvibeHome,
	isCanonicalMasterSecret,
	loadCredentials,
} from "./credentials.js";

export type LocalCredentialStateOptions = {
	credentialsFile?: string;
	walDbPath?: string;
};

const missingCredentialsMessage = (walDbPath: string): string =>
	`Credentials are missing, but ${walDbPath} contains identity-bound local data. Restore credentials.json from backup. If recovery is impossible, back up and move events.db aside before starting fresh.`;

const RECOVERY_KEY_PAGE_SIZE = 100;

const environmentCredentialConflictMessage = (): string =>
	"MOBVIBE_MASTER_SECRET does not match credentials.json. Unset the conflicting environment variable or restore the matching credential before continuing.";

const invalidEnvironmentCredentialMessage = (): string =>
	"MOBVIBE_MASTER_SECRET must be the canonical base64 encoding of exactly 32 bytes.";

const validateEnvironmentRecoveryAgainstWal = async (
	masterSecret: string,
	walDbPath: string,
): Promise<void> => {
	await initCrypto();
	const cryptoService = new CliCryptoService(base64ToUint8(masterSecret));
	const walStore = new WalStore(walDbPath);
	try {
		const persistedIdentity = walStore.getEncryptionIdentity();
		if (persistedIdentity) {
			if (persistedIdentity !== cryptoService.getKeyIdentity()) {
				throw new Error(
					"MOBVIBE_MASTER_SECRET does not match the encryption identity bound to the local WAL.",
				);
			}
			return;
		}

		let verifiedKeyCount = 0;
		let after: { sessionId: string; revision: number } | undefined;
		while (true) {
			const keys = walStore.getSessionRevisionKeysPage(
				after,
				RECOVERY_KEY_PAGE_SIZE,
			);
			for (const key of keys) {
				verifiedKeyCount += 1;
				if (!cryptoService.canUnwrapDek(key.wrappedDek)) {
					throw new Error(
						"MOBVIBE_MASTER_SECRET cannot decrypt the revision keys stored in the local WAL.",
					);
				}
			}
			if (keys.length < RECOVERY_KEY_PAGE_SIZE) break;
			const lastKey = keys.at(-1);
			if (!lastKey) break;
			after = { sessionId: lastKey.sessionId, revision: lastKey.revision };
		}
		if (verifiedKeyCount === 0) {
			throw new Error(
				"The local WAL contains durable data but no encryption identity that can verify MOBVIBE_MASTER_SECRET. Restore credentials.json or move the WAL to a separate MOBVIBE_HOME.",
			);
		}
	} finally {
		walStore.close();
	}
};

/**
 * Load the root credential without ever treating corruption or existing WAL
 * state as a first login. This is shared by login and logout preflights.
 */
export async function loadRecoverableCredentials(
	options: LocalCredentialStateOptions = {},
): Promise<Credentials | null> {
	const credentialsFile = options.credentialsFile ?? getCredentialsFilePath();
	const walDbPath =
		options.walDbPath ?? path.join(getMobvibeHome(), "events.db");
	const credentials = await loadCredentials(credentialsFile);
	const environmentSecret = process.env.MOBVIBE_MASTER_SECRET;
	if (
		environmentSecret !== undefined &&
		!isCanonicalMasterSecret(environmentSecret)
	) {
		throw new Error(invalidEnvironmentCredentialMessage());
	}
	if (credentials) {
		if (
			environmentSecret !== undefined &&
			environmentSecret !== credentials.masterSecret
		) {
			throw new Error(environmentCredentialConflictMessage());
		}
		return credentials;
	}

	let containsDurableData: boolean;
	try {
		containsDurableData = hasDurableWalData(walDbPath);
	} catch {
		throw new Error(
			`Credentials are missing and ${walDbPath} could not be safely inspected. Restore credentials.json or back up and move events.db aside before continuing.`,
		);
	}
	if (environmentSecret !== undefined) {
		if (containsDurableData) {
			await validateEnvironmentRecoveryAgainstWal(environmentSecret, walDbPath);
		}
		return {
			masterSecret: environmentSecret,
			createdAt: Date.now(),
			gatewayUrl: process.env.MOBVIBE_GATEWAY_URL,
		};
	}
	if (containsDurableData) {
		throw new Error(missingCredentialsMessage(walDbPath));
	}
	return null;
}
