import { LocalStorageBackend } from "./backends/local-storage-backend.js";
import { ProviderKeysRepository } from "./repositories/provider-keys-repository.js";
import { SettingsRepository } from "./repositories/settings-repository.js";
import type { AppStorageConfig } from "./types.js";

/**
 * High-level storage API aggregating all repositories.
 * Apps configure backends and use repositories through this interface.
 */
export class AppStorage {
	readonly settings: SettingsRepository;
	readonly providerKeys: ProviderKeysRepository;

	constructor(config: AppStorageConfig = {}) {
		// Use LocalStorage with prefixes as defaults
		const settingsBackend = config.settings ?? new LocalStorageBackend("settings");
		const providerKeysBackend = config.providerKeys ?? new LocalStorageBackend("providerKeys");

		this.settings = new SettingsRepository(settingsBackend);
		this.providerKeys = new ProviderKeysRepository(providerKeysBackend);
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

/**
 * Initialize AppStorage with default configuration if not already set.
 */
export function initAppStorage(config: AppStorageConfig = {}): AppStorage {
	if (!globalAppStorage) {
		globalAppStorage = new AppStorage(config);
	}
	return globalAppStorage;
}
