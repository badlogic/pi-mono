import type { CustomProvidersStore } from "./stores/custom-providers-store.js";
import type { ProviderKeysStore } from "./stores/provider-keys-store.js";
import type { SessionsStore } from "./stores/sessions-store.js";
import type { SettingsStore } from "./stores/settings-store.js";
import type { StorageBackend } from "./types.js";

/**
 * High-level storage API providing access to all storage operations.
 * Subclasses can extend this to add domain-specific stores.
 */
export class AppStorage {
	readonly backend: StorageBackend;
	readonly settings: SettingsStore;
	readonly providerKeys: ProviderKeysStore;
	readonly sessions: SessionsStore;
	readonly customProviders: CustomProvidersStore;

	constructor(
		settings: SettingsStore,
		providerKeys: ProviderKeysStore,
		sessions: SessionsStore,
		customProviders: CustomProvidersStore,
		backend: StorageBackend,
	) {
		this.settings = settings;
		this.providerKeys = providerKeys;
		this.sessions = sessions;
		this.customProviders = customProviders;
		this.backend = backend;
	}

	async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
		return this.backend.getQuotaInfo();
	}

	async requestPersistence(): Promise<boolean> {
		return this.backend.requestPersistence();
	}
}

// Global instance management
let globalAppStorage: AppStorage | null = null;

/**
 * Get the global AppStorage instance.
 * Throws if not initialized.
 */
export function getAppStorage(): AppStorage {
	if (!globalAppStorage) {
		throw new Error("AppStorage not initialized. Call setAppStorage() first.");
	}
	return globalAppStorage;
}

/**
 * Set the global AppStorage instance.
 */
export function setAppStorage(storage: AppStorage): void {
	globalAppStorage = storage;
}
