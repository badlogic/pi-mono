import type { StorageBackend } from "../types.js";

/**
 * Storage backend using IndexedDB.
 * Good for: Large data, binary blobs, complex queries.
 * Limits: ~50MB-unlimited (browser dependent), async API, more complex.
 */
export class IndexedDBBackend implements StorageBackend {
	private dbPromise: Promise<IDBDatabase> | null = null;

	constructor(
		private dbName: string,
		private storeName: string = "keyvalue",
	) {}

	private async getDB(): Promise<IDBDatabase> {
		if (this.dbPromise) {
			return this.dbPromise;
		}

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 1);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
				}
			};
		});

		return this.dbPromise;
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(this.storeName, "readonly");
			const store = transaction.objectStore(this.storeName);
			const request = store.get(key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const value = request.result;
				resolve(value !== undefined ? (value as T) : null);
			};
		});
	}

	async set<T = unknown>(key: string, value: T): Promise<void> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(this.storeName, "readwrite");
			const store = transaction.objectStore(this.storeName);
			const request = store.put(value, key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async delete(key: string): Promise<void> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(this.storeName, "readwrite");
			const store = transaction.objectStore(this.storeName);
			const request = store.delete(key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async keys(): Promise<string[]> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(this.storeName, "readonly");
			const store = transaction.objectStore(this.storeName);
			const request = store.getAllKeys();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				resolve(request.result.map((key) => String(key)));
			};
		});
	}

	async clear(): Promise<void> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(this.storeName, "readwrite");
			const store = transaction.objectStore(this.storeName);
			const request = store.clear();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async has(key: string): Promise<boolean> {
		const value = await this.get(key);
		return value !== null;
	}
}
