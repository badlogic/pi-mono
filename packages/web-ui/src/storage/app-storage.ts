import { SessionsRepository } from "./sessions-repository.js";
import type { StorageBackend } from "./types.js";

/**
 * High-level storage API providing access to all storage operations.
 * Subclasses can extend this to add domain-specific repositories.
 */
export class AppStorage {
	readonly backend: StorageBackend;
	readonly sessions: SessionsRepository;

	constructor(backend: StorageBackend) {
		this.backend = backend;
		this.sessions = new SessionsRepository(backend);
	}

	// Settings access (delegates to "settings" store)
	async getSetting<T>(key: string): Promise<T | null> {
		return this.backend.get("settings", key);
	}

	async setSetting<T>(key: string, value: T): Promise<void> {
		await this.backend.set("settings", key, value);
	}

	async deleteSetting(key: string): Promise<void> {
		await this.backend.delete("settings", key);
	}

	async listSettings(): Promise<string[]> {
		return this.backend.keys("settings");
	}

	// Provider keys access (delegates to "provider-keys" store)
	async getProviderKey(provider: string): Promise<string | null> {
		return this.backend.get("provider-keys", provider);
	}

	async setProviderKey(provider: string, key: string): Promise<void> {
		await this.backend.set("provider-keys", provider, key);
	}

	async deleteProviderKey(provider: string): Promise<void> {
		await this.backend.delete("provider-keys", provider);
	}

	async listProviderKeys(): Promise<string[]> {
		return this.backend.keys("provider-keys");
	}

	// Quota management
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
