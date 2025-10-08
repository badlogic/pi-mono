import { Store } from "../store.js";
import type { SessionData, SessionMetadata, StoreConfig } from "../types.js";

/**
 * Store for chat sessions (data and metadata).
 * Uses two object stores: sessions (full data) and sessions-metadata (lightweight).
 */
export class SessionsStore extends Store {
	getConfig(): StoreConfig {
		return {
			name: "sessions",
			keyPath: "id",
			indices: [{ name: "lastModified", keyPath: "lastModified" }],
		};
	}

	/**
	 * Additional config for sessions-metadata store.
	 * Must be included when creating the backend.
	 */
	static getMetadataConfig(): StoreConfig {
		return {
			name: "sessions-metadata",
			keyPath: "id",
			indices: [{ name: "lastModified", keyPath: "lastModified" }],
		};
	}

	async save(data: SessionData, metadata: SessionMetadata): Promise<void> {
		await this.getBackend().transaction(["sessions", "sessions-metadata"], "readwrite", async (tx) => {
			await tx.set("sessions", data.id, data);
			await tx.set("sessions-metadata", metadata.id, metadata);
		});
	}

	async get(id: string): Promise<SessionData | null> {
		return this.getBackend().get("sessions", id);
	}

	async getMetadata(id: string): Promise<SessionMetadata | null> {
		return this.getBackend().get("sessions-metadata", id);
	}

	async getAllMetadata(): Promise<SessionMetadata[]> {
		const keys = await this.getBackend().keys("sessions-metadata");
		const metadata = await Promise.all(
			keys.map((key) => this.getBackend().get<SessionMetadata>("sessions-metadata", key)),
		);
		return metadata.filter((m): m is SessionMetadata => m !== null);
	}

	async delete(id: string): Promise<void> {
		await this.getBackend().transaction(["sessions", "sessions-metadata"], "readwrite", async (tx) => {
			await tx.delete("sessions", id);
			await tx.delete("sessions-metadata", id);
		});
	}

	// Alias for backward compatibility
	async deleteSession(id: string): Promise<void> {
		return this.delete(id);
	}

	async updateTitle(id: string, title: string): Promise<void> {
		const metadata = await this.getMetadata(id);
		if (metadata) {
			metadata.title = title;
			await this.getBackend().set("sessions-metadata", id, metadata);
		}

		// Also update in full session data
		const data = await this.get(id);
		if (data) {
			data.title = title;
			await this.getBackend().set("sessions", id, data);
		}
	}

	async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
		return this.getBackend().getQuotaInfo();
	}

	async requestPersistence(): Promise<boolean> {
		return this.getBackend().requestPersistence();
	}
}
