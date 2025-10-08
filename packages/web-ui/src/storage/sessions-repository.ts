import type { SessionData, SessionMetadata, StorageBackend } from "./types.js";

/**
 * Repository for managing sessions using a multi-store backend.
 * Handles session data and metadata with atomic operations.
 */
export class SessionsRepository {
	constructor(private backend: StorageBackend) {}

	async saveSession(data: SessionData, metadata: SessionMetadata): Promise<void> {
		await this.backend.transaction(["sessions-metadata", "sessions-data"], "readwrite", async (tx) => {
			await tx.set("sessions-metadata", metadata.id, metadata);
			await tx.set("sessions-data", data.id, data);
		});
	}

	async getSession(id: string): Promise<SessionData | null> {
		return this.backend.get("sessions-data", id);
	}

	async getMetadata(id: string): Promise<SessionMetadata | null> {
		return this.backend.get("sessions-metadata", id);
	}

	async getAllMetadata(): Promise<SessionMetadata[]> {
		const keys = await this.backend.keys("sessions-metadata");
		const metadata = await Promise.all(
			keys.map((key) => this.backend.get<SessionMetadata>("sessions-metadata", key)),
		);
		return metadata.filter((m): m is SessionMetadata => m !== null);
	}

	async deleteSession(id: string): Promise<void> {
		await this.backend.transaction(["sessions-metadata", "sessions-data"], "readwrite", async (tx) => {
			await tx.delete("sessions-metadata", id);
			await tx.delete("sessions-data", id);
		});
	}

	async updateTitle(id: string, title: string): Promise<void> {
		const metadata = await this.getMetadata(id);
		if (metadata) {
			metadata.title = title;
			await this.backend.set("sessions-metadata", id, metadata);
		}

		// Also update in full session data
		const data = await this.getSession(id);
		if (data) {
			data.title = title;
			await this.backend.set("sessions-data", id, data);
		}
	}

	async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
		return this.backend.getQuotaInfo();
	}

	async requestPersistence(): Promise<boolean> {
		return this.backend.requestPersistence();
	}
}
