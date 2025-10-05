import type { StorageBackend } from "../types.js";

// Chrome extension API types (optional)
declare const chrome: any;

/**
 * Storage backend using chrome.storage.local.
 * Good for: Browser extensions, syncing across devices (with chrome.storage.sync).
 * Limits: ~10MB for local, ~100KB for sync, async API.
 */
export class ChromeStorageBackend implements StorageBackend {
	constructor(private prefix: string = "") {}

	private getKey(key: string): string {
		return this.prefix ? `${this.prefix}:${key}` : key;
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		if (!chrome?.storage?.local) {
			throw new Error("chrome.storage.local is not available");
		}

		const fullKey = this.getKey(key);
		const result = await chrome.storage.local.get([fullKey]);
		return result[fullKey] !== undefined ? (result[fullKey] as T) : null;
	}

	async set<T = unknown>(key: string, value: T): Promise<void> {
		if (!chrome?.storage?.local) {
			throw new Error("chrome.storage.local is not available");
		}

		const fullKey = this.getKey(key);
		await chrome.storage.local.set({ [fullKey]: value });
	}

	async delete(key: string): Promise<void> {
		if (!chrome?.storage?.local) {
			throw new Error("chrome.storage.local is not available");
		}

		const fullKey = this.getKey(key);
		await chrome.storage.local.remove(fullKey);
	}

	async keys(): Promise<string[]> {
		if (!chrome?.storage?.local) {
			throw new Error("chrome.storage.local is not available");
		}

		const allData = await chrome.storage.local.get(null);
		const allKeys = Object.keys(allData);
		const prefixWithColon = this.prefix ? `${this.prefix}:` : "";

		if (this.prefix) {
			return allKeys
				.filter((key) => key.startsWith(prefixWithColon))
				.map((key) => key.substring(prefixWithColon.length));
		}

		return allKeys;
	}

	async clear(): Promise<void> {
		if (!chrome?.storage?.local) {
			throw new Error("chrome.storage.local is not available");
		}

		if (this.prefix) {
			const keysToRemove = await this.keys();
			const fullKeys = keysToRemove.map((key) => this.getKey(key));
			await chrome.storage.local.remove(fullKeys);
		} else {
			await chrome.storage.local.clear();
		}
	}

	async has(key: string): Promise<boolean> {
		const value = await this.get(key);
		return value !== null;
	}
}
