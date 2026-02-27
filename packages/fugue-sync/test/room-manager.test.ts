import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomManager } from "../src/room-manager.js";
import type { RoomStore } from "../src/store.js";

// ─── Mock RoomStore ───────────────────────────────────────────────────────────

function createMockStore(initialSnapshot: Record<string, unknown> | null = null): RoomStore {
	const snapshots: Map<string, unknown> = new Map();
	if (initialSnapshot) snapshots.set("room-1", initialSnapshot);

	return {
		load: vi.fn(async (id: string) => snapshots.get(id) ?? null),
		save: vi.fn(async (id: string, snapshot: unknown) => {
			snapshots.set(id, snapshot);
		}),
		delete: vi.fn(async (id: string) => {
			snapshots.delete(id);
		}),
		listRoomIds: vi.fn(async () => [...snapshots.keys()]),
		setup: vi.fn(async () => {}),
	} as unknown as RoomStore;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RoomManager", () => {
	let store: RoomStore;
	let manager: RoomManager;

	beforeEach(() => {
		store = createMockStore();
		manager = new RoomManager(store);
	});

	it("creates a room on first access", async () => {
		const room = await manager.getOrCreate("room-1");
		expect(room).toBeTruthy();
		expect(manager.activeRoomCount).toBe(1);
	});

	it("returns the same room instance on second access", async () => {
		const r1 = await manager.getOrCreate("room-1");
		const r2 = await manager.getOrCreate("room-1");
		expect(r1).toBe(r2);
	});

	it("loads initial snapshot from store", async () => {
		const loadMock = vi.fn().mockResolvedValue({ clock: 5, documents: [] });
		const storeWithData = { ...store, load: loadMock };
		const m = new RoomManager(storeWithData as unknown as RoomStore);

		await m.getOrCreate("room-1");
		expect(loadMock).toHaveBeenCalledWith("room-1");
		await m.close();
	});

	it("creates separate rooms for different ids", async () => {
		const r1 = await manager.getOrCreate("room-1");
		const r2 = await manager.getOrCreate("room-2");
		expect(r1).not.toBe(r2);
		expect(manager.activeRoomCount).toBe(2);
	});

	it("tracks connection count with onConnectionOpen/Close", async () => {
		await manager.getOrCreate("room-1");
		manager.onConnectionOpen("room-1");
		manager.onConnectionOpen("room-1");
		// 2 connections open — room should not be evicted
		expect(manager.activeRoomCount).toBe(1);

		manager.onConnectionClose("room-1");
		// 1 connection still open — room still active
		expect(manager.activeRoomCount).toBe(1);
	});

	it("close() evicts all rooms", async () => {
		await manager.getOrCreate("room-1");
		await manager.getOrCreate("room-2");
		expect(manager.activeRoomCount).toBe(2);

		await manager.close();
		expect(manager.activeRoomCount).toBe(0);
	});

	it("onConnectionOpen on unknown room is safe", () => {
		expect(() => manager.onConnectionOpen("ghost-room")).not.toThrow();
	});

	it("onConnectionClose on unknown room is safe", () => {
		expect(() => manager.onConnectionClose("ghost-room")).not.toThrow();
	});
});
