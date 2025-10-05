import type { StorageBackend } from "../types.js";

/**
 * Repository for simple application settings (proxy, theme, etc.).
 * Uses a single backend for all settings.
 */
export class SettingsRepository {
	constructor(private backend: StorageBackend) {}

	/**
	 * Get a setting value by key.
	 */
	async get<T = unknown>(key: string): Promise<T | null> {
		return this.backend.get<T>(key);
	}

	/**
	 * Set a setting value.
	 */
	async set<T = unknown>(key: string, value: T): Promise<void> {
		await this.backend.set(key, value);
	}

	/**
	 * Delete a setting.
	 */
	async delete(key: string): Promise<void> {
		await this.backend.delete(key);
	}

	/**
	 * Get all setting keys.
	 */
	async keys(): Promise<string[]> {
		return this.backend.keys();
	}

	/**
	 * Check if a setting exists.
	 */
	async has(key: string): Promise<boolean> {
		return this.backend.has(key);
	}

	/**
	 * Clear all settings.
	 */
	async clear(): Promise<void> {
		await this.backend.clear();
	}
}
