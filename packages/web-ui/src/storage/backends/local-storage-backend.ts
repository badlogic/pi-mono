import type { StorageBackend } from "../types.js";

/**
 * Storage backend using browser localStorage.
 * Good for: Simple settings, small data.
 * Limits: ~5MB, synchronous API (wrapped in promises), string-only (JSON serialization).
 */
export class LocalStorageBackend implements StorageBackend {
	constructor(private prefix: string = "") {}

	private getKey(key: string): string {
		return this.prefix ? `${this.prefix}:${key}` : key;
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const fullKey = this.getKey(key);
		const value = localStorage.getItem(fullKey);
		if (value === null) return null;

		try {
			return JSON.parse(value) as T;
		} catch {
			// If JSON parse fails, return as string
			return value as T;
		}
	}

	async set<T = unknown>(key: string, value: T): Promise<void> {
		const fullKey = this.getKey(key);
		const serialized = JSON.stringify(value);
		localStorage.setItem(fullKey, serialized);
	}

	async delete(key: string): Promise<void> {
		const fullKey = this.getKey(key);
		localStorage.removeItem(fullKey);
	}

	async keys(): Promise<string[]> {
		const allKeys: string[] = [];
		const prefixWithColon = this.prefix ? `${this.prefix}:` : "";

		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key) {
				if (this.prefix) {
					if (key.startsWith(prefixWithColon)) {
						allKeys.push(key.substring(prefixWithColon.length));
					}
				} else {
					allKeys.push(key);
				}
			}
		}

		return allKeys;
	}

	async clear(): Promise<void> {
		if (this.prefix) {
			const keysToRemove = await this.keys();
			for (const key of keysToRemove) {
				await this.delete(key);
			}
		} else {
			localStorage.clear();
		}
	}

	async has(key: string): Promise<boolean> {
		const fullKey = this.getKey(key);
		return localStorage.getItem(fullKey) !== null;
	}
}
