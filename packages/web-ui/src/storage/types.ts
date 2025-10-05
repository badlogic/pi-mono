/**
 * Base interface for all storage backends.
 * Provides a simple key-value storage abstraction that can be implemented
 * by localStorage, IndexedDB, chrome.storage, or remote APIs.
 */
export interface StorageBackend {
	/**
	 * Get a value by key. Returns null if key doesn't exist.
	 */
	get<T = unknown>(key: string): Promise<T | null>;

	/**
	 * Set a value for a key.
	 */
	set<T = unknown>(key: string, value: T): Promise<void>;

	/**
	 * Delete a key.
	 */
	delete(key: string): Promise<void>;

	/**
	 * Get all keys.
	 */
	keys(): Promise<string[]>;

	/**
	 * Clear all data.
	 */
	clear(): Promise<void>;

	/**
	 * Check if a key exists.
	 */
	has(key: string): Promise<boolean>;
}

/**
 * Options for configuring AppStorage.
 */
export interface AppStorageConfig {
	/** Backend for simple settings (proxy, theme, etc.) */
	settings?: StorageBackend;
	/** Backend for provider API keys */
	providerKeys?: StorageBackend;
	/** Backend for sessions (chat history, attachments) */
	sessions?: StorageBackend;
}
