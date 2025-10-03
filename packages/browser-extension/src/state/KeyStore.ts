import { getProviders } from "@mariozechner/pi-ai";

declare const browser: any;

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
 * Cross-browser storage implementation of KeyStore
 */
class BrowserKeyStore implements KeyStore {
	private readonly prefix = "apiKey_";
	private readonly storage: typeof chrome.storage.local;

	constructor() {
		// Use browser.storage in Firefox, chrome.storage in Chrome
		const isFirefox = typeof browser !== "undefined" && browser.storage !== undefined;
		this.storage = isFirefox ? browser.storage.local : chrome.storage.local;
	}

	async getKey(provider: string): Promise<string | null> {
		const key = `${this.prefix}${provider}`;
		const result = await this.storage.get(key);
		return result[key] || null;
	}

	async setKey(provider: string, key: string): Promise<void> {
		const storageKey = `${this.prefix}${provider}`;
		await this.storage.set({ [storageKey]: key });
	}

	async removeKey(provider: string): Promise<void> {
		const key = `${this.prefix}${provider}`;
		await this.storage.remove(key);
	}

	async getAllKeys(): Promise<Record<string, boolean>> {
		const providers = getProviders();
		const storage = await this.storage.get();
		const result: Record<string, boolean> = {};

		for (const provider of providers) {
			const key = `${this.prefix}${provider}`;
			result[provider] = !!storage[key];
		}

		return result;
	}
}

// Export singleton instance
export const keyStore = new BrowserKeyStore();
