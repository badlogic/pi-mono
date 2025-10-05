import { getProviders } from "@mariozechner/pi-ai";
import { LocalStorageAdapter, type StorageAdapter } from "./storage-adapter.js";

/**
 * API key storage interface
 */
export interface KeyStore {
	getKey(provider: string): Promise<string | null>;
	setKey(provider: string, key: string): Promise<void>;
	removeKey(provider: string): Promise<void>;
	getAllKeys(): Promise<Record<string, boolean>>;
}

/**
 * API key storage implementation using a pluggable storage adapter
 */
export class LocalStorageKeyStore implements KeyStore {
	private readonly prefix = "apiKey_";

	constructor(private readonly storage: StorageAdapter) {}

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

// Default instance using localStorage
let _keyStore: KeyStore = new LocalStorageKeyStore(new LocalStorageAdapter());

/**
 * Get the current KeyStore instance
 */
export function getKeyStore(): KeyStore {
	return _keyStore;
}

/**
 * Set a custom KeyStore implementation
 * Call this once at application startup before any components are initialized
 */
export function setKeyStore(store: KeyStore): void {
	_keyStore = store;
}
