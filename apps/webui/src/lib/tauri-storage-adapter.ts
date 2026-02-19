import type { SyncStateStorage } from "@/lib/storage-adapter";

// Type for the Tauri Store instance
type TauriStore = Awaited<
	ReturnType<typeof import("@tauri-apps/plugin-store").load>
>;

/**
 * Create a storage adapter for Tauri that uses an in-memory cache
 * backed by Tauri Store for persistence.
 *
 * The adapter is synchronous (required by Zustand) but persists
 * changes to Tauri Store asynchronously.
 */
export const createTauriStorageAdapter = (): SyncStateStorage => {
	const cache = new Map<string, string>();
	let store: TauriStore | null = null;
	let storePromise: Promise<void> | null = null;
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;

	// Initialize store asynchronously
	const initStore = async () => {
		if (storePromise) {
			return storePromise;
		}

		storePromise = (async () => {
			try {
				const { load } = await import("@tauri-apps/plugin-store");
				const tauriStore = await load("app-state.json");

				// Load all existing data into cache
				const entries = await tauriStore.entries();
				for (const [key, value] of entries) {
					if (typeof value === "string") {
						cache.set(key, value);
					}
				}

				store = tauriStore;
			} catch (error) {
				console.warn("[TauriStorage] Failed to initialize store:", error);
			}
		})();

		return storePromise;
	};

	// Start initialization immediately
	initStore();

	// Debounced save to disk
	const scheduleSave = () => {
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}

		saveTimeout = setTimeout(async () => {
			if (store) {
				try {
					await store.save();
				} catch (error) {
					console.warn("[TauriStorage] Failed to save store:", error);
				}
			}
		}, 100);
	};

	// Persist a single item asynchronously
	const persistItem = async (key: string, value: string | null) => {
		await initStore();
		if (!store) return;

		try {
			if (value === null) {
				await store.delete(key);
			} else {
				await store.set(key, value);
			}
			scheduleSave();
		} catch (error) {
			console.warn("[TauriStorage] Failed to persist item:", error);
		}
	};

	return {
		getItem: (name: string) => {
			return cache.get(name) ?? null;
		},
		setItem: (name: string, value: string) => {
			cache.set(name, value);
			void persistItem(name, value);
		},
		removeItem: (name: string) => {
			cache.delete(name);
			void persistItem(name, null);
		},
	};
};

/**
 * Initialize the Tauri storage adapter if running in Tauri.
 * Should be called early in the app lifecycle (e.g., in main.tsx).
 */
export const initTauriStorage = async (): Promise<void> => {
	const { setStorageAdapter } = await import("@/lib/storage-adapter");
	const adapter = createTauriStorageAdapter();
	setStorageAdapter(adapter);
};
