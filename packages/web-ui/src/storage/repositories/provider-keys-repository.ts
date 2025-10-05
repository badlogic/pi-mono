import type { StorageBackend } from "../types.js";

/**
 * Repository for managing provider API keys.
 * Provides domain-specific methods for key management.
 */
export class ProviderKeysRepository {
	constructor(private backend: StorageBackend) {}

	/**
	 * Get the API key for a provider.
	 */
	async getKey(provider: string): Promise<string | null> {
		return this.backend.get<string>(`key:${provider}`);
	}

	/**
	 * Set the API key for a provider.
	 */
	async setKey(provider: string, key: string): Promise<void> {
		await this.backend.set(`key:${provider}`, key);
	}

	/**
	 * Remove the API key for a provider.
	 */
	async removeKey(provider: string): Promise<void> {
		await this.backend.delete(`key:${provider}`);
	}

	/**
	 * Get all providers that have keys stored.
	 */
	async getProviders(): Promise<string[]> {
		const allKeys = await this.backend.keys();
		return allKeys.filter((key) => key.startsWith("key:")).map((key) => key.substring(4));
	}

	/**
	 * Check if a provider has a key stored.
	 */
	async hasKey(provider: string): Promise<boolean> {
		return this.backend.has(`key:${provider}`);
	}

	/**
	 * Clear all stored API keys.
	 */
	async clearAll(): Promise<void> {
		const providers = await this.getProviders();
		for (const provider of providers) {
			await this.removeKey(provider);
		}
	}
}
