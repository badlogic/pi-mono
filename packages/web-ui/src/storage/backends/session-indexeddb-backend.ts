import type { SessionData, SessionMetadata, SessionStorageBackend } from "../types.js";

/**
 * IndexedDB implementation of session storage.
 * Uses two object stores:
 * - "metadata": Fast access for listing/searching
 * - "data": Full session data loaded on demand
 */
export class SessionIndexedDBBackend implements SessionStorageBackend {
	private dbPromise: Promise<IDBDatabase> | null = null;
	private readonly DB_NAME: string;
	private readonly DB_VERSION = 1;

	constructor(dbName = "pi-sessions") {
		this.DB_NAME = dbName;
	}

	private async getDB(): Promise<IDBDatabase> {
		if (this.dbPromise) {
			return this.dbPromise;
		}

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Object store for metadata (lightweight, frequently accessed)
				if (!db.objectStoreNames.contains("metadata")) {
					const metaStore = db.createObjectStore("metadata", { keyPath: "id" });
					// Index for sorting by last modified
					metaStore.createIndex("lastModified", "lastModified", { unique: false });
				}

				// Object store for full session data (heavy, rarely accessed)
				if (!db.objectStoreNames.contains("data")) {
					db.createObjectStore("data", { keyPath: "id" });
				}
			};
		});

		return this.dbPromise;
	}

	async saveSession(data: SessionData, metadata: SessionMetadata): Promise<void> {
		const db = await this.getDB();

		// Use transaction to ensure atomicity (both or neither)
		return new Promise((resolve, reject) => {
			const tx = db.transaction(["metadata", "data"], "readwrite");
			const metaStore = tx.objectStore("metadata");
			const dataStore = tx.objectStore("data");

			// Save both in same transaction
			const metaReq = metaStore.put(metadata);
			const dataReq = dataStore.put(data);

			// Handle errors
			metaReq.onerror = () => reject(metaReq.error);
			dataReq.onerror = () => reject(dataReq.error);

			// Transaction complete = both saved
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async getSession(id: string): Promise<SessionData | null> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction("data", "readonly");
			const store = tx.objectStore("data");
			const request = store.get(id);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				resolve(request.result !== undefined ? (request.result as SessionData) : null);
			};
		});
	}

	async getMetadata(id: string): Promise<SessionMetadata | null> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction("metadata", "readonly");
			const store = tx.objectStore("metadata");
			const request = store.get(id);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				resolve(request.result !== undefined ? (request.result as SessionMetadata) : null);
			};
		});
	}

	async getAllMetadata(): Promise<SessionMetadata[]> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction("metadata", "readonly");
			const store = tx.objectStore("metadata");
			const request = store.getAll();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				resolve(request.result as SessionMetadata[]);
			};
		});
	}

	async deleteSession(id: string): Promise<void> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(["metadata", "data"], "readwrite");
			const metaStore = tx.objectStore("metadata");
			const dataStore = tx.objectStore("data");

			// Delete both in transaction
			const metaReq = metaStore.delete(id);
			const dataReq = dataStore.delete(id);

			metaReq.onerror = () => reject(metaReq.error);
			dataReq.onerror = () => reject(dataReq.error);

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async updateTitle(id: string, title: string): Promise<void> {
		const db = await this.getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(["metadata", "data"], "readwrite");

			// Update metadata
			const metaStore = tx.objectStore("metadata");
			const metaReq = metaStore.get(id);

			metaReq.onsuccess = () => {
				const metadata = metaReq.result as SessionMetadata;
				if (!metadata) {
					reject(new Error(`Session ${id} not found`));
					return;
				}
				metadata.title = title;
				metadata.lastModified = new Date().toISOString();
				metaStore.put(metadata);
			};

			// Update data
			const dataStore = tx.objectStore("data");
			const dataReq = dataStore.get(id);

			dataReq.onsuccess = () => {
				const data = dataReq.result as SessionData;
				if (!data) {
					reject(new Error(`Session ${id} not found`));
					return;
				}
				data.title = title;
				data.lastModified = new Date().toISOString();
				dataStore.put(data);
			};

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
		if (!navigator.storage || !navigator.storage.estimate) {
			return { usage: 0, quota: 0, percent: 0 };
		}

		const estimate = await navigator.storage.estimate();
		const usage = estimate.usage || 0;
		const quota = estimate.quota || 0;
		const percent = quota > 0 ? (usage / quota) * 100 : 0;

		return { usage, quota, percent };
	}

	async requestPersistence(): Promise<boolean> {
		if (!navigator.storage || !navigator.storage.persist) {
			return false;
		}

		// Check if already persistent
		const isPersisted = await navigator.storage.persisted();
		if (isPersisted) {
			return true;
		}

		// Request persistence
		return await navigator.storage.persist();
	}
}
