import { getProviders } from "@mariozechner/pi-ai";

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
 * Chrome storage implementation of KeyStore
 */
class ChromeKeyStore implements KeyStore {
	private readonly prefix = "apiKey_";

	async getKey(provider: string): Promise<string | null> {
		const key = `${this.prefix}${provider}`;
		const result = await chrome.storage.local.get(key);
		return result[key] || null;
	}

	async setKey(provider: string, key: string): Promise<void> {
		const storageKey = `${this.prefix}${provider}`;
		await chrome.storage.local.set({ [storageKey]: key });
	}

	async removeKey(provider: string): Promise<void> {
		const key = `${this.prefix}${provider}`;
		await chrome.storage.local.remove(key);
	}

	async getAllKeys(): Promise<Record<string, boolean>> {
		const providers = getProviders();
		const storage = await chrome.storage.local.get();
		const result: Record<string, boolean> = {};

		for (const provider of providers) {
			const key = `${this.prefix}${provider}`;
			result[provider] = !!storage[key];
		}

		return result;
	}
}

// Export singleton instance
export const keyStore = new ChromeKeyStore();
