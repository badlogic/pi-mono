import { getProviders } from "@mariozechner/pi-ai";

/**
 * Generic storage adapter interface
 */
export interface StorageAdapter {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	getAll(): Promise<Record<string, string>>;
}

/**
 * Interface for API key storage
 */
export interface KeyStore {
	getKey(provider: string): Promise<string | null>;
	setKey(provider: string, key: string): Promise<void>;
	removeKey(provider: string): Promise<void>;
	getAllKeys(): Promise<Record<string, boolean>>; // provider -> isConfigured
}

/**
 * Default localStorage implementation for web
 */
class LocalStorageAdapter implements StorageAdapter {
	async get(key: string): Promise<string | null> {
		return localStorage.getItem(key);
	}

	async set(key: string, value: string): Promise<void> {
		localStorage.setItem(key, value);
	}

	async remove(key: string): Promise<void> {
		localStorage.removeItem(key);
	}

	async getAll(): Promise<Record<string, string>> {
		const result: Record<string, string> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key) {
				const value = localStorage.getItem(key);
				if (value) result[key] = value;
			}
		}
		return result;
	}
}

/**
 * Generic KeyStore implementation
 */
class GenericKeyStore implements KeyStore {
	private readonly prefix = "apiKey_";
	private readonly storage: StorageAdapter;

	constructor(storage?: StorageAdapter) {
		this.storage = storage || new LocalStorageAdapter();
	}

	async getKey(provider: string): Promise<string | null> {
		const key = `${this.prefix}${provider}`;
		return await this.storage.get(key);
	}

	async setKey(provider: string, key: string): Promise<void> {
		const storageKey = `${this.prefix}${provider}`;
		await this.storage.set(storageKey, key);
	}

	async removeKey(provider: string): Promise<void> {
		const key = `${this.prefix}${provider}`;
		await this.storage.remove(key);
	}

	async getAllKeys(): Promise<Record<string, boolean>> {
		const providers = getProviders();
		const allStorage = await this.storage.getAll();
		const result: Record<string, boolean> = {};

		for (const provider of providers) {
			const key = `${this.prefix}${provider}`;
			result[provider] = !!allStorage[key];
		}

		return result;
	}
}

// Export singleton instance (uses localStorage by default)
export const keyStore = new GenericKeyStore();

// Export class for custom storage implementations
export { GenericKeyStore as KeyStoreImpl };
