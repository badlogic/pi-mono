import { Store } from "../store.js";
import type { StoreConfig } from "../types.js";

/**
 * Store for application settings (theme, proxy config, etc.).
 */
export class SettingsStore extends Store {
	getConfig(): StoreConfig {
		return {
			name: "settings",
			// No keyPath - uses out-of-line keys
		};
	}

	async get<T>(key: string): Promise<T | null> {
		return this.getBackend().get("settings", key);
	}

	async set<T>(key: string, value: T): Promise<void> {
		await this.getBackend().set("settings", key, value);
	}

	async delete(key: string): Promise<void> {
		await this.getBackend().delete("settings", key);
	}

	async list(): Promise<string[]> {
		return this.getBackend().keys("settings");
	}

	async clear(): Promise<void> {
		await this.getBackend().clear("settings");
	}
}
