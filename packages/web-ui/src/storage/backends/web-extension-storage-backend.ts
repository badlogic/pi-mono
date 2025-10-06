import type { StorageBackend } from "../types.js";

// Cross-browser extension API compatibility
// @ts-expect-error - browser global exists in Firefox, chrome in Chrome
const browserAPI = globalThis.browser || globalThis.chrome;

/**
 * Storage backend using browser.storage.local (Firefox) or chrome.storage.local (Chrome).
 * Good for: Browser extensions, syncing across devices (with storage.sync).
 * Limits: ~10MB for local, ~100KB for sync, async API.
 */
export class WebExtensionStorageBackend implements StorageBackend {
	constructor(private prefix: string = "") {}

	private getKey(key: string): string {
		return this.prefix ? `${this.prefix}:${key}` : key;
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		if (!browserAPI?.storage?.local) {
			throw new Error("browser/chrome.storage.local is not available");
		}

		const fullKey = this.getKey(key);
		const result = await browserAPI.storage.local.get([fullKey]);
		return result[fullKey] !== undefined ? (result[fullKey] as T) : null;
	}

	async set<T = unknown>(key: string, value: T): Promise<void> {
		if (!browserAPI?.storage?.local) {
			throw new Error("browser/chrome.storage.local is not available");
		}

		const fullKey = this.getKey(key);
		await browserAPI.storage.local.set({ [fullKey]: value });
	}

	async delete(key: string): Promise<void> {
		if (!browserAPI?.storage?.local) {
			throw new Error("browser/chrome.storage.local is not available");
		}

		const fullKey = this.getKey(key);
		await browserAPI.storage.local.remove(fullKey);
	}

	async keys(): Promise<string[]> {
		if (!browserAPI?.storage?.local) {
			throw new Error("browser/chrome.storage.local is not available");
		}

		const allData = await browserAPI.storage.local.get(null);
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
		if (!browserAPI?.storage?.local) {
			throw new Error("browser/chrome.storage.local is not available");
		}

		if (this.prefix) {
			const keysToRemove = await this.keys();
			const fullKeys = keysToRemove.map((key) => this.getKey(key));
			await browserAPI.storage.local.remove(fullKeys);
		} else {
			await browserAPI.storage.local.clear();
		}
	}

	async has(key: string): Promise<boolean> {
		const value = await this.get(key);
		return value !== null;
	}
}
