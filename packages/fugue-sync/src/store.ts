import type { Pool } from "pg";

/**
 * A serialized snapshot of a tldraw room.
 * Stored as JSONB in Postgres.
 */
export interface RoomSnapshot {
	clock: number;
	documents: Array<{ state: unknown; lastChangedClock: number }>;
	tombstones?: Record<string, number>;
	schema?: unknown;
}

/**
 * Postgres-backed storage for tldraw room snapshots.
 * One row per canvas/room identified by roomId.
 */
export class RoomStore {
	constructor(private readonly pool: Pool) {}

	/**
	 * Create the rooms table if it doesn't exist. Call once on startup.
	 */
	async setup(): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query(`
				CREATE TABLE IF NOT EXISTS fugue_rooms (
					id TEXT PRIMARY KEY,
					snapshot JSONB NOT NULL DEFAULT '{}',
					created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
				)
			`);
		} finally {
			client.release();
		}
	}

	async load(roomId: string): Promise<RoomSnapshot | null> {
		const client = await this.pool.connect();
		try {
			const result = await client.query<{ snapshot: RoomSnapshot }>(
				`SELECT snapshot FROM fugue_rooms WHERE id = $1`,
				[roomId],
			);
			return result.rows[0]?.snapshot ?? null;
		} finally {
			client.release();
		}
	}

	async save(roomId: string, snapshot: RoomSnapshot): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query(
				`
				INSERT INTO fugue_rooms (id, snapshot, updated_at)
				VALUES ($1, $2, NOW())
				ON CONFLICT (id) DO UPDATE
					SET snapshot = EXCLUDED.snapshot,
					    updated_at = NOW()
				`,
				[roomId, JSON.stringify(snapshot)],
			);
		} finally {
			client.release();
		}
	}

	async delete(roomId: string): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query(`DELETE FROM fugue_rooms WHERE id = $1`, [roomId]);
		} finally {
			client.release();
		}
	}

	async listRoomIds(): Promise<string[]> {
		const client = await this.pool.connect();
		try {
			const result = await client.query<{ id: string }>(`SELECT id FROM fugue_rooms ORDER BY updated_at DESC`);
			return result.rows.map((r) => r.id);
		} finally {
			client.release();
		}
	}
}
