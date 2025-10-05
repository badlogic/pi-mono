/**
 * Generic storage adapter interface for key/value persistence
 */
export interface StorageAdapter {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	getAll(): Promise<Record<string, string>>;
}

/**
 * LocalStorage implementation
 */
export class LocalStorageAdapter implements StorageAdapter {
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
 * Chrome/Firefox extension storage implementation
 */
export class ChromeStorageAdapter implements StorageAdapter {
	private readonly storage: any;

	constructor() {
		const isBrowser = typeof globalThis !== "undefined";
		const hasChrome = isBrowser && (globalThis as any).chrome?.storage;
		const hasBrowser = isBrowser && (globalThis as any).browser?.storage;

		if (hasBrowser) {
			this.storage = (globalThis as any).browser.storage.local;
		} else if (hasChrome) {
			this.storage = (globalThis as any).chrome.storage.local;
		} else {
			throw new Error("Chrome/Browser storage not available");
		}
	}

	async get(key: string): Promise<string | null> {
		const result = await this.storage.get(key);
		return result[key] || null;
	}

	async set(key: string, value: string): Promise<void> {
		await this.storage.set({ [key]: value });
	}

	async remove(key: string): Promise<void> {
		await this.storage.remove(key);
	}

	async getAll(): Promise<Record<string, string>> {
		const result = await this.storage.get();
		return result || {};
	}
}
