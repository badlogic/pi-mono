import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../src/store.js";
import { RoomStore } from "../src/store.js";

// ─── PGlite Pool Adapter ──────────────────────────────────────────────────────

/**
 * Minimal pool-compatible wrapper around PGlite for unit tests.
 * Implements only the subset used by RoomStore.
 */
function createPglitePool(client: PGlite): Pool {
	return {
		connect: async () => {
			return {
				query: async (sql: string, params?: unknown[]) => {
					const result = await client.query(sql, params as unknown[]);
					return { rows: result.rows as Record<string, unknown>[] };
				},
				release: () => {},
			};
		},
	} as unknown as Pool;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const ROOMS_DDL = `
	CREATE TABLE IF NOT EXISTS fugue_rooms (
		id TEXT PRIMARY KEY,
		snapshot JSONB NOT NULL DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)
`;

let _client: PGlite | null = null;

async function getClient(): Promise<PGlite> {
	if (!_client) {
		_client = new PGlite();
		await _client.exec(ROOMS_DDL);
	}
	return _client;
}

let store: RoomStore;

beforeEach(async () => {
	const c = await getClient();
	await c.exec(`TRUNCATE fugue_rooms`);
	const pool = createPglitePool(c);
	store = new RoomStore(pool);
});

describe("RoomStore", () => {
	it("returns null for unknown room", async () => {
		const snapshot = await store.load("unknown-room");
		expect(snapshot).toBeNull();
	});

	it("saves and loads a snapshot", async () => {
		const snapshot: RoomSnapshot = {
			clock: 42,
			documents: [{ state: { id: "shape:1", typeName: "shape" }, lastChangedClock: 42 }],
		};

		await store.save("room-1", snapshot);
		const loaded = await store.load("room-1");

		expect(loaded).toEqual(snapshot);
	});

	it("overwrites snapshot on second save", async () => {
		await store.save("room-1", { clock: 1, documents: [] });
		await store.save("room-1", { clock: 99, documents: [] });

		const loaded = await store.load("room-1");
		expect(loaded!.clock).toBe(99);
	});

	it("deletes a room", async () => {
		await store.save("room-1", { clock: 1, documents: [] });
		await store.delete("room-1");

		const loaded = await store.load("room-1");
		expect(loaded).toBeNull();
	});

	it("lists room ids", async () => {
		await store.save("room-a", { clock: 1, documents: [] });
		await store.save("room-b", { clock: 2, documents: [] });

		const ids = await store.listRoomIds();
		expect(ids).toContain("room-a");
		expect(ids).toContain("room-b");
		expect(ids.length).toBe(2);
	});

	it("lists room ids in reverse-updated order", async () => {
		await store.save("room-old", { clock: 1, documents: [] });
		// Update room-new more recently
		await store.save("room-new", { clock: 2, documents: [] });

		const ids = await store.listRoomIds();
		// room-new should appear first (most recently updated)
		expect(ids[0]).toBe("room-new");
	});

	it("setup() creates table idempotently", async () => {
		const pool = createPglitePool(await getClient());
		const freshStore = new RoomStore(pool);
		// Should not throw even though table already exists
		await expect(freshStore.setup()).resolves.toBeUndefined();
		await expect(freshStore.setup()).resolves.toBeUndefined();
	});
});
