import type { IndexedDBConfig, StorageBackend, StorageTransaction } from "../types.js";

/**
 * IndexedDB implementation of StorageBackend.
 * Provides multi-store key-value storage with transactions and quota management.
 */
export class IndexedDBStorageBackend implements StorageBackend {
	private dbPromise: Promise<IDBDatabase> | null = null;

	constructor(private config: IndexedDBConfig) {}

	private async getDB(): Promise<IDBDatabase> {
		if (!this.dbPromise) {
			this.dbPromise = new Promise((resolve, reject) => {
				const request = indexedDB.open(this.config.dbName, this.config.version);

				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result);

				request.onupgradeneeded = (_event) => {
					const db = request.result;

					// Create object stores from config
					for (const storeConfig of this.config.stores) {
						if (!db.objectStoreNames.contains(storeConfig.name)) {
							const store = db.createObjectStore(storeConfig.name, {
								keyPath: storeConfig.keyPath,
								autoIncrement: storeConfig.autoIncrement,
							});

							// Create indices
							if (storeConfig.indices) {
								for (const indexConfig of storeConfig.indices) {
									store.createIndex(indexConfig.name, indexConfig.keyPath, {
										unique: indexConfig.unique,
									});
								}
							}
						}
					}
				};
			});
		}

		return this.dbPromise;
	}

	private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readonly");
		const store = tx.objectStore(storeName);
		const result = await this.promisifyRequest(store.get(key));
		return result ?? null;
	}

	async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		// If store has keyPath, only pass value (in-line key)
		// Otherwise pass both value and key (out-of-line key)
		if (store.keyPath) {
			await this.promisifyRequest(store.put(value));
		} else {
			await this.promisifyRequest(store.put(value, key));
		}
	}

	async delete(storeName: string, key: string): Promise<void> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		await this.promisifyRequest(store.delete(key));
	}

	async keys(storeName: string, prefix?: string): Promise<string[]> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readonly");
		const store = tx.objectStore(storeName);

		if (prefix) {
			// Use IDBKeyRange for efficient prefix filtering
			const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false);
			const keys = await this.promisifyRequest(store.getAllKeys(range));
			return keys.map((k) => String(k));
		} else {
			const keys = await this.promisifyRequest(store.getAllKeys());
			return keys.map((k) => String(k));
		}
	}

	async getAllFromIndex<T = unknown>(
		storeName: string,
		indexName: string,
		direction: "asc" | "desc" = "asc",
	): Promise<T[]> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readonly");
		const store = tx.objectStore(storeName);
		const index = store.index(indexName);

		return new Promise((resolve, reject) => {
			const results: T[] = [];
			const request = index.openCursor(null, direction === "desc" ? "prev" : "next");

			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					results.push(cursor.value as T);
					cursor.continue();
				} else {
					resolve(results);
				}
			};

			request.onerror = () => reject(request.error);
		});
	}

	async clear(storeName: string): Promise<void> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		await this.promisifyRequest(store.clear());
	}

	async has(storeName: string, key: string): Promise<boolean> {
		const db = await this.getDB();
		const tx = db.transaction(storeName, "readonly");
		const store = tx.objectStore(storeName);
		const result = await this.promisifyRequest(store.getKey(key));
		return result !== undefined;
	}

	async transaction<T>(
		storeNames: string[],
		mode: "readonly" | "readwrite",
		operation: (tx: StorageTransaction) => Promise<T>,
	): Promise<T> {
		const db = await this.getDB();
		const idbTx = db.transaction(storeNames, mode);

		const storageTx: StorageTransaction = {
			get: async <T>(storeName: string, key: string) => {
				const store = idbTx.objectStore(storeName);
				const result = await this.promisifyRequest(store.get(key));
				return (result ?? null) as T | null;
			},
			set: async <T>(storeName: string, key: string, value: T) => {
				const store = idbTx.objectStore(storeName);
				// If store has keyPath, only pass value (in-line key)
				// Otherwise pass both value and key (out-of-line key)
				if (store.keyPath) {
					await this.promisifyRequest(store.put(value));
				} else {
					await this.promisifyRequest(store.put(value, key));
				}
			},
			delete: async (storeName: string, key: string) => {
				const store = idbTx.objectStore(storeName);
				await this.promisifyRequest(store.delete(key));
			},
		};

		return operation(storageTx);
	}

	async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
		if (navigator.storage?.estimate) {
			const estimate = await navigator.storage.estimate();
			return {
				usage: estimate.usage || 0,
				quota: estimate.quota || 0,
				percent: estimate.quota ? ((estimate.usage || 0) / estimate.quota) * 100 : 0,
			};
		}
		return { usage: 0, quota: 0, percent: 0 };
	}

	async requestPersistence(): Promise<boolean> {
		if (navigator.storage?.persist) {
			return await navigator.storage.persist();
		}
		return false;
	}
}
