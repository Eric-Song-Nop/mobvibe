/**
 * Utility helpers for interacting with @tauri-apps/plugin-store.
 * Centralises the dynamic import + load pattern that was previously duplicated
 * across e2ee.ts, auth-token.ts and gateway-config.ts.
 */

type TauriStore = Awaited<
	ReturnType<typeof import("@tauri-apps/plugin-store")["load"]>
>;

/**
 * Open a Tauri Store by filename and pass it to `callback`.
 * Returns the callback's result.
 */
export async function withTauriStore<T>(
	filename: string,
	callback: (store: TauriStore) => Promise<T>,
): Promise<T> {
	const { load } = await import("@tauri-apps/plugin-store");
	const store = await load(filename);
	return callback(store);
}

/** Read a typed value from a Tauri Store file. */
export async function tauriStoreGet<T>(
	filename: string,
	key: string,
): Promise<T | null> {
	const value = await withTauriStore(filename, (s) => s.get<T>(key));
	return value ?? null;
}

/** Write a value to a Tauri Store file and persist. */
export async function tauriStoreSet<T>(
	filename: string,
	key: string,
	value: T,
): Promise<void> {
	await withTauriStore(filename, async (s) => {
		await s.set(key, value);
		await s.save();
	});
}

/** Delete a key from a Tauri Store file and persist. */
export async function tauriStoreDelete(
	filename: string,
	key: string,
): Promise<void> {
	await withTauriStore(filename, async (s) => {
		await s.delete(key);
		await s.save();
	});
}
